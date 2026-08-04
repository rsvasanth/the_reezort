import { IN_FLIGHT_LEASE_MS, nextBatch } from "./drain";
/**
 * Frappe datetime: `YYYY-MM-DD HH:mm:ss.ffffff`, no timezone marker.
 *
 * Sent as epoch milliseconds it would land in a Datetime column as nonsense, and
 * `queued_at` is what an operator reads when reconstructing what an attendant
 * actually did on the floor.
 */
function toFrappeDatetime(epochMs) {
    return new Date(epochMs).toISOString().replace("T", " ").replace("Z", "000");
}
export function toWireOperation(row) {
    const wire = {
        client_request_id: row.clientRequestId,
        action: row.action,
        payload: { ...row.payload },
        queued_at: toFrappeDatetime(row.createdAt),
    };
    if (row.targetDoctype)
        wire.target_doctype = row.targetDoctype;
    if (row.targetName)
        wire.target_name = row.targetName;
    // Omitted rather than empty: the server only compares when it is present, and
    // an empty string would mismatch every stored `modified` and conflict forever.
    if (row.baseModified)
        wire.base_modified = row.baseModified;
    return wire;
}
export function fromWireResult(wire) {
    // A replayed operation comes back as Duplicate with the real outcome in
    // `original_status`. Taken at face value Duplicate maps to `applied`, which
    // would quietly mark a conflicted row resolved and discard the attendant's
    // queued change without anyone having chosen anything.
    const status = wire.status === "Duplicate" && wire.original_status ? wire.original_status : wire.status;
    return {
        clientRequestId: wire.client_request_id,
        status,
        conflictReason: wire.conflict_reason,
        changedByName: wire.changed_by_name,
        serverModified: wire.server_modified,
        serverValues: wire.server_values,
        yourValues: wire.your_values,
        errorMessage: wire.error_message,
    };
}
export const SYNC_PUSH = "the_reezort.mobile.api.sync_push";
/**
 * One drain pass: take the next batch, send it, record what came back.
 *
 * Deliberately a single pass rather than a loop — retry timing belongs to the
 * caller, which knows about connectivity and the app's foreground state.
 */
export async function drainOnce(repo, call, now, limit = 50) {
    const batch = nextBatch(await repo.list(), now, limit);
    if (!batch.length)
        return [];
    await repo.markInFlight(batch.map((row) => row.id), now + IN_FLIGHT_LEASE_MS);
    const response = await call(SYNC_PUSH, {
        operations: batch.map(toWireOperation),
    });
    const results = (response?.data?.results ?? []).map(fromWireResult);
    await repo.applyResults(results, now);
    return results;
}
