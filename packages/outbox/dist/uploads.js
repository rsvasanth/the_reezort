/**
 * Photos whose parent write is applied, ordered by the sequence the attendant
 * worked in.
 *
 * A photo is held when its parent is still queued (the target document is not in
 * the state the photo documents), and when the parent is awaiting review (the
 * attendant may still discard that write, and the photo with it — uploading now
 * would leave an orphan attached to a room whose change was reverted).
 *
 * A photo whose parent row has vanished is dropped, not retried. Conflict
 * resolution deletes dependants in the same transaction, but a queue read taken
 * before that must not resurrect an attachment that can never land.
 */
export function eligibleUploads(rows, uploads) {
    const applied = new Map(rows.filter((row) => row.state === "applied").map((row) => [row.id, row]));
    return uploads
        .filter((upload) => upload.state === "pending" && applied.has(upload.outboxId))
        .sort((a, b) => a.outboxId - b.outboxId || a.id - b.id);
}
