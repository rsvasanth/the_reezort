/**
 * Conflict resolution, as decided on the "needs review" screen.
 *
 * Returns a plan rather than performing the writes, so the semantics — which are
 * where the silent-data-loss bugs live — are testable without a database. See
 * `specs/016-mobile-apps/ui-ux-conflict-review.md`.
 */
import type { OutboxRow } from "./types";
export interface KeepServerPlan {
    /** Delete this outbox row. */
    readonly deleteOutboxId: number;
    /**
     * Delete its queued uploads too, in the same transaction. They are ordered
     * behind the parent write and become unattachable once it is gone.
     */
    readonly deleteUploadsForOutboxId: number;
}
export interface KeepMinePlan {
    readonly row: OutboxRow;
}
/** The attendant accepted the server's version; their queued work is discarded. */
export declare function keepServer(row: OutboxRow): KeepServerPlan;
/**
 * The attendant kept their own version; it goes back on the queue.
 *
 * `newClientRequestId` is injected so this stays deterministic under test —
 * and because getting it wrong is silent: reusing the original id hits the
 * server's idempotency ledger, which replays the recorded `Conflict` outcome as
 * `Duplicate`, so the resolution looks successful and does nothing.
 */
export declare function keepMine(row: OutboxRow, newClientRequestId: () => string): KeepMinePlan;
