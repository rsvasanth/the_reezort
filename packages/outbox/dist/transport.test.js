import { describe, expect, it, vi } from "vitest";
import { drainOnce, fromWireResult, toWireOperation } from "./transport";
const row = (over = {}) => ({
    id: 1,
    clientRequestId: "req-1",
    action: "housekeeping.complete_task",
    payload: { notes: "done" },
    targetDoctype: "Housekeeping Task",
    targetName: "RZ-HKT-2026-00042",
    baseModified: "2026-08-02 09:14:22.118431",
    state: "pending",
    attempts: 0,
    createdAt: Date.parse("2026-08-02T09:13:58.000Z"),
    ...over,
});
describe("toWireOperation", () => {
    it("emits the snake_case keys sync_push actually reads", () => {
        // The whole seam: the outbox is camelCase, Frappe is snake_case. A key the
        // server does not recognise is not an error there — it is silently ignored,
        // so a wrong name here produces a write that applies against the wrong base.
        const wire = toWireOperation(row());
        expect(wire).toMatchObject({
            client_request_id: "req-1",
            action: "housekeeping.complete_task",
            target_doctype: "Housekeeping Task",
            target_name: "RZ-HKT-2026-00042",
            base_modified: "2026-08-02 09:14:22.118431",
            payload: { notes: "done" },
        });
        expect(Object.keys(wire)).not.toContain("clientRequestId");
    });
    it("formats queued_at as a Frappe datetime, not epoch milliseconds", () => {
        // `created_at` is a number on the device. Sent raw it lands in a Datetime
        // column as garbage, and queued_at is what operators read when reconstructing
        // what an attendant did.
        expect(toWireOperation(row()).queued_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });
    it("omits base_modified when the row has none", () => {
        // A create has nothing to conflict against. Sending an empty string would
        // make the server compare against "" and reject every time.
        expect(toWireOperation(row({ baseModified: undefined }))).not.toHaveProperty("base_modified");
    });
});
describe("fromWireResult", () => {
    it("maps the snake_case response back onto the outbox shape", () => {
        const wire = {
            client_request_id: "req-1",
            status: "Conflict",
            conflict_reason: "Housekeeping Task was changed after this was queued",
            changed_by_name: "Anita",
            server_modified: "2026-08-02 09:15:40.221904",
            server_values: { task_status: "Inspected" },
            your_values: { task_status: "Completed" },
        };
        expect(fromWireResult(wire)).toEqual({
            clientRequestId: "req-1",
            status: "Conflict",
            conflictReason: "Housekeeping Task was changed after this was queued",
            changedByName: "Anita",
            serverModified: "2026-08-02 09:15:40.221904",
            serverValues: { task_status: "Inspected" },
            yourValues: { task_status: "Completed" },
            errorMessage: undefined,
        });
    });
    it("resolves a Duplicate back to the outcome it replays", () => {
        // The server answers a replayed conflict with status Duplicate and the real
        // outcome in original_status. Taken at face value, Duplicate maps to
        // `applied` — which would mark a conflicted row resolved and drop the
        // attendant's queued change without anyone choosing to.
        const resolved = fromWireResult({
            client_request_id: "req-1",
            status: "Duplicate",
            original_status: "Conflict",
            conflict_reason: "changed after queueing",
            server_modified: "2026-08-02 09:15:40.221904",
            server_values: { task_status: "Inspected" },
        });
        expect(resolved.status).toBe("Conflict");
        expect(resolved.serverModified).toBe("2026-08-02 09:15:40.221904");
    });
    it("leaves a Duplicate of a genuine success as applied", () => {
        expect(fromWireResult({ client_request_id: "r", status: "Duplicate", original_status: "Applied" })
            .status).toBe("Applied");
    });
    it("treats a bare Duplicate as applied", () => {
        expect(fromWireResult({ client_request_id: "r", status: "Duplicate" }).status).toBe("Duplicate");
    });
});
describe("drainOnce", () => {
    const repo = (rows) => ({
        list: vi.fn(async () => rows),
        markInFlight: vi.fn(async () => { }),
        applyResults: vi.fn(async () => { }),
    });
    it("unwraps the house envelope before reading results", async () => {
        // sync_push returns {ok, data:{results}}, not a bare array.
        const store = repo([row()]);
        const call = vi.fn(async () => ({
            ok: true,
            data: { results: [{ client_request_id: "req-1", status: "Applied" }] },
        }));
        await drainOnce(store, call, 0);
        expect(store.applyResults).toHaveBeenCalledWith([expect.objectContaining({ clientRequestId: "req-1", status: "Applied" })], 0);
    });
    it("marks the batch in flight before sending it", async () => {
        const store = repo([row()]);
        const call = vi.fn(async () => ({ ok: true, data: { results: [] } }));
        await drainOnce(store, call, 0);
        // The lease is what lets a crashed drain recover the row.
        expect(store.markInFlight).toHaveBeenCalledWith([1], expect.any(Number));
        const [, leaseUntil] = store.markInFlight.mock.calls[0];
        expect(leaseUntil).toBeGreaterThan(0);
    });
    it("does not call the server when there is nothing to send", async () => {
        const store = repo([row({ state: "conflict" })]);
        const call = vi.fn();
        await drainOnce(store, call, 0);
        expect(call).not.toHaveBeenCalled();
    });
});
