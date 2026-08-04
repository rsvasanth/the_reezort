import { describe, expect, it } from "vitest";
import { keepMine, keepServer } from "./resolve";
const conflicted = (over = {}) => ({
    id: 7,
    clientRequestId: "req-original",
    action: "housekeeping.set_room_status",
    payload: { housekeeping_status: "Clean" },
    targetDoctype: "Room",
    targetName: "RM-214",
    baseModified: "2026-08-02 09:10:00.000000",
    state: "conflict",
    attempts: 1,
    createdAt: 0,
    conflict: {
        reason: "Room was reassigned by a supervisor",
        changedByName: "Anita",
        serverModified: "2026-08-02 09:15:40.221904",
        serverValues: { housekeeping_status: "Inspected" },
        yourValues: { housekeeping_status: "Clean" },
    },
    ...over,
});
describe("keepServer", () => {
    it("drops the row and every upload behind it", () => {
        // pending_upload is ordered strictly behind its parent write. Dropping the
        // parent alone would leave photos that can never be attached and that the
        // worker retries forever.
        const plan = keepServer(conflicted());
        expect(plan.deleteOutboxId).toBe(7);
        expect(plan.deleteUploadsForOutboxId).toBe(7);
    });
});
describe("keepMine", () => {
    it("re-enqueues with a FRESH client_request_id", () => {
        // Reusing the original hits the server's idempotency ledger, which returns
        // the recorded Conflict outcome as Duplicate. The resolution would appear to
        // succeed and change nothing.
        const plan = keepMine(conflicted(), () => "req-fresh");
        expect(plan.row.clientRequestId).toBe("req-fresh");
        expect(plan.row.clientRequestId).not.toBe("req-original");
    });
    it("rebases onto the server's modified stamp", () => {
        // Otherwise the re-push carries the stale base_modified and conflicts against
        // the very same document again — an unbreakable loop.
        const plan = keepMine(conflicted(), () => "req-fresh");
        expect(plan.row.baseModified).toBe("2026-08-02 09:15:40.221904");
    });
    it("marks the row as resolved so a later Rejected reads as refused", () => {
        const plan = keepMine(conflicted(), () => "req-fresh");
        expect(plan.row.resolvedFromConflict).toBe(true);
    });
    it("returns the row to the queue with the conflict cleared and no backoff", () => {
        const plan = keepMine(conflicted(), () => "req-fresh");
        expect(plan.row.state).toBe("pending");
        expect(plan.row.conflict).toBeUndefined();
        expect(plan.row.retryAfter).toBeUndefined();
    });
    it("keeps the same row id so queued uploads stay attached", () => {
        // The photo rows reference outbox_id. A new id would orphan them.
        const plan = keepMine(conflicted(), () => "req-fresh");
        expect(plan.row.id).toBe(7);
    });
    it("preserves the attendant's payload untouched", () => {
        const plan = keepMine(conflicted(), () => "req-fresh");
        expect(plan.row.payload).toEqual({ housekeeping_status: "Clean" });
    });
    it("refuses to resolve a row that is not in conflict", () => {
        expect(() => keepMine(conflicted({ state: "pending", conflict: undefined }), () => "x")).toThrow();
    });
});
