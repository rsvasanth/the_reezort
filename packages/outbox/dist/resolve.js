function assertConflicted(row) {
    if (row.state !== "conflict" || !row.conflict) {
        throw new Error(`Outbox row ${row.id} is not awaiting conflict review (state: ${row.state})`);
    }
}
/** The attendant accepted the server's version; their queued work is discarded. */
export function keepServer(row) {
    assertConflicted(row);
    return { deleteOutboxId: row.id, deleteUploadsForOutboxId: row.id };
}
/**
 * The attendant kept their own version; it goes back on the queue.
 *
 * `newClientRequestId` is injected so this stays deterministic under test —
 * and because getting it wrong is silent: reusing the original id hits the
 * server's idempotency ledger, which replays the recorded `Conflict` outcome as
 * `Duplicate`, so the resolution looks successful and does nothing.
 */
export function keepMine(row, newClientRequestId) {
    assertConflicted(row);
    return {
        row: {
            ...row,
            // Same id: queued photos reference it, and a new one would orphan them.
            clientRequestId: newClientRequestId(),
            // Rebase, or the re-push conflicts against the same document again.
            baseModified: row.conflict?.serverModified,
            state: "pending",
            attempts: 0,
            retryAfter: undefined,
            lastError: undefined,
            conflict: undefined,
            resolvedFromConflict: true,
        },
    };
}
