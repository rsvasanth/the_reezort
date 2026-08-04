import { describe, expect, it } from "vitest";
import { applySyncResult, nextBatch, retryDelayMs } from "./drain";
const row = (over = {}) => ({
    id: 1,
    clientRequestId: "req-1",
    action: "housekeeping.set_room_status",
    payload: { housekeeping_status: "Clean" },
    targetDoctype: "Room",
    targetName: "RM-214",
    baseModified: "2026-08-02 09:10:00.000000",
    state: "pending",
    attempts: 0,
    createdAt: 0,
    ...over,
});
const result = (over = {}) => ({
    clientRequestId: "req-1",
    status: "Applied",
    ...over,
});
describe("nextBatch", () => {
    it("drains strictly in id order", () => {
        // A photo upload must never precede the write it attaches to, and two
        // status changes on one room must land in the order they were made.
        const rows = [row({ id: 3 }), row({ id: 1 }), row({ id: 2 })];
        expect(nextBatch(rows, 0, 10).map((r) => r.id)).toEqual([1, 2, 3]);
    });
    it("skips rows that are waiting on a person", () => {
        const rows = [
            row({ id: 1, state: "conflict", targetName: "RM-101" }),
            row({ id: 2, state: "refused", targetName: "RM-102" }),
            row({ id: 3, targetName: "RM-103" }),
        ];
        expect(nextBatch(rows, 0, 10).map((r) => r.id)).toEqual([3]);
    });
    it("holds later writes to a target whose earlier row awaits review", () => {
        // The conflict screen has not been answered yet. Sending the next change to
        // the same room would apply the attendant's work out of order, and would
        // then be silently overwritten by whatever they choose on the review screen.
        const rows = [
            row({ id: 1, state: "conflict", targetName: "RM-214" }),
            row({ id: 2, targetName: "RM-214" }),
            row({ id: 3, targetName: "RM-301" }),
        ];
        expect(nextBatch(rows, 0, 10).map((r) => r.id)).toEqual([3]);
    });
    it("skips rows whose backoff has not elapsed", () => {
        const rows = [
            row({ id: 1, state: "failed", retryAfter: 5_000, targetName: "RM-101" }),
            row({ id: 2, targetName: "RM-102" }),
        ];
        expect(nextBatch(rows, 1_000, 10).map((r) => r.id)).toEqual([2]);
        expect(nextBatch(rows, 6_000, 10).map((r) => r.id)).toEqual([1, 2]);
    });
    it("does not re-send a row still inside its in-flight lease", () => {
        expect(nextBatch([row({ id: 1, state: "in_flight", retryAfter: 5_000 })], 0, 10)).toEqual([]);
    });
    it("respects the batch cap", () => {
        const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })];
        expect(nextBatch(rows, 0, 2).map((r) => r.id)).toEqual([1, 2]);
    });
    it("does NOT let an already-applied row block later work on the same target", () => {
        // Applied rows are never deleted, so treating them as blockers meant the
        // first successful sync for a room permanently stopped every later change
        // to that room — the queue silently dying the moment it first worked.
        const rows = [row({ id: 1, state: "applied" }), row({ id: 2 })];
        expect(nextBatch(rows, 0, 10).map((r) => r.id)).toEqual([2]);
    });
    it("recovers a row stranded in_flight by a crash", () => {
        // Android kills backgrounded apps routinely. A row marked in_flight and
        // never answered for must be retried, or the attendant's work sits there
        // until max_outbox_age_hours discards it.
        const rows = [row({ id: 1, state: "in_flight", retryAfter: 5_000 })];
        expect(nextBatch(rows, 1_000, 10)).toEqual([]);
        expect(nextBatch(rows, 6_000, 10).map((r) => r.id)).toEqual([1]);
    });
    it("re-sends an in_flight row carrying no lease at all", () => {
        // Shouldn't happen once markInFlight always writes a lease, but a legacy or
        // half-written row must fail toward retrying: the server is idempotent, and
        // stranding an attendant's work is the worse outcome.
        expect(nextBatch([row({ id: 1, state: "in_flight" })], 0, 10).map((r) => r.id)).toEqual([1]);
    });
    it("stops at the first blocked row for the same target", () => {
        // Sending #2 while #1 is stuck would apply the attendant's changes to one
        // room out of order — the later status silently winning over the earlier.
        const rows = [
            row({ id: 1, state: "failed", retryAfter: 9_000, targetName: "RM-214" }),
            row({ id: 2, targetName: "RM-214" }),
            row({ id: 3, targetName: "RM-301" }),
        ];
        expect(nextBatch(rows, 0, 10).map((r) => r.id)).toEqual([3]);
    });
});
describe("applySyncResult", () => {
    it("marks Applied rows applied", () => {
        expect(applySyncResult(row(), result({ status: "Applied" }), 0).state).toBe("applied");
    });
    it("treats Duplicate as applied without re-applying", () => {
        // The server already has this write. Retrying it is the whole point of the
        // idempotency key; surfacing it as an error would be a lie.
        expect(applySyncResult(row(), result({ status: "Duplicate" }), 0).state).toBe("applied");
    });
    it("records conflict detail for the review screen", () => {
        const next = applySyncResult(row(), result({
            status: "Conflict",
            conflictReason: "Room was reassigned by a supervisor",
            changedByName: "Anita",
            serverModified: "2026-08-02 09:15:40.221904",
            serverValues: { housekeeping_status: "Inspected" },
            yourValues: { housekeeping_status: "Clean" },
        }), 0);
        expect(next.state).toBe("conflict");
        expect(next.conflict?.changedByName).toBe("Anita");
        expect(next.conflict?.serverModified).toBe("2026-08-02 09:15:40.221904");
        expect(next.retryAfter).toBeUndefined();
    });
    it("does not schedule a retry for a conflict", () => {
        // A conflict is resolved by a person, not by waiting. Retrying would just
        // conflict again against the same base_modified, forever.
        const next = applySyncResult(row(), result({ status: "Conflict", serverModified: "x" }), 0);
        expect(next.retryAfter).toBeUndefined();
        expect(next.attempts).toBe(0);
    });
    it("sends a Rejected row to refused when it was a resolved conflict", () => {
        const next = applySyncResult(row({ state: "in_flight", attempts: 1, resolvedFromConflict: true }), result({ status: "Rejected", errorMessage: "Room is occupied" }), 0);
        expect(next.state).toBe("refused");
        expect(next.lastError).toBe("Room is occupied");
    });
    it("sends an ordinary Rejected row to failed, with no retry", () => {
        // Business validation said no. Retrying an unchanged payload cannot help.
        const next = applySyncResult(row(), result({ status: "Rejected", errorMessage: "nope" }), 0);
        expect(next.state).toBe("failed");
        expect(next.retryAfter).toBeUndefined();
    });
    it("schedules a backoff retry for a transient Failed", () => {
        const next = applySyncResult(row({ attempts: 1 }), result({ status: "Failed" }), 1_000);
        expect(next.state).toBe("failed");
        expect(next.attempts).toBe(2);
        expect(next.retryAfter).toBe(1_000 + retryDelayMs(2));
    });
});
describe("retryDelayMs", () => {
    it("grows with each attempt", () => {
        expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
        expect(retryDelayMs(3)).toBeGreaterThan(retryDelayMs(2));
    });
    it("caps so a long outage cannot push the next try past the shift", () => {
        // An attendant coming back into signal must resync in minutes, not hours.
        expect(retryDelayMs(50)).toBeLessThanOrEqual(5 * 60_000);
    });
});
