/**
 * Which queued photos may be sent, and in what order.
 *
 * A photo is an attachment to a document the write produces, so it can only be
 * sent once that write has actually landed. Everything else about the ordering
 * follows from that.
 */
import type { OutboxRow, PendingUpload } from "./types";
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
export declare function eligibleUploads(rows: readonly OutboxRow[], uploads: readonly PendingUpload[]): PendingUpload[];
