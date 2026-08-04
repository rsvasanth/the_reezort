/**
 * Outbox vocabulary. Mirrors `data-model.md` — the client-side SQLite schema
 * section, not a Frappe doctype.
 */
import type { SyncStatus } from "@reezort/domain-types";
/**
 * `conflict` — the server refused because the document moved underneath us. The
 * attendant has not seen it yet.
 *
 * `refused` — the attendant resolved a conflict in favour of their own version,
 * it was re-pushed, and business validation rejected it. Distinct from
 * `conflict` on purpose: a decision has already been made about this row, and
 * re-presenting it as a fresh conflict makes them re-litigate it.
 */
export type OutboxState = "pending" | "in_flight" | "applied" | "conflict" | "refused" | "failed";
export interface OutboxRow {
    readonly id: number;
    readonly clientRequestId: string;
    readonly action: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly targetDoctype?: string;
    readonly targetName?: string;
    /** Server `modified` this change was based on. Absent for pure creates. */
    readonly baseModified?: string;
    readonly state: OutboxState;
    readonly attempts: number;
    readonly lastError?: string;
    /** Epoch ms, device clock. Operator context only — never business ordering. */
    readonly createdAt: number;
    /** Epoch ms before which the drain worker must not retry this row. */
    readonly retryAfter?: number;
    readonly conflict?: ConflictDetail;
    /**
     * True once an attendant has resolved a conflict in favour of this version.
     * Decides whether a later `Rejected` reads as `failed` or as `refused` — the
     * attendant has already decided about this row, and it must not come back
     * looking like a fresh conflict.
     */
    readonly resolvedFromConflict?: boolean;
}
export interface ConflictDetail {
    readonly reason: string;
    readonly changedByName?: string;
    readonly serverModified: string;
    readonly serverValues: Readonly<Record<string, unknown>>;
    readonly yourValues: Readonly<Record<string, unknown>>;
}
export interface PendingUpload {
    readonly id: number;
    /**
     * Idempotency key for `attach_mobile_file`, generated at capture.
     *
     * Not the content hash: the same photograph attached to two different rooms
     * would collide, and the second attach would come back Duplicate and silently
     * never happen.
     */
    readonly clientRequestId: string;
    readonly outboxId: number;
    readonly localUri: string;
    readonly contentHash: string;
    readonly state: "pending" | "in_flight" | "uploaded" | "failed";
    readonly attempts: number;
}
/** One entry of the `sync_push` per-operation result array. */
export interface SyncResult {
    readonly clientRequestId: string;
    readonly status: SyncStatus;
    readonly conflictReason?: string;
    readonly changedByName?: string;
    readonly serverModified?: string;
    readonly serverValues?: Readonly<Record<string, unknown>>;
    readonly yourValues?: Readonly<Record<string, unknown>>;
    readonly errorMessage?: string;
}
/** A row in `conflict` or `refused` is waiting on a person, not on the network. */
export declare function needsReview(state: OutboxState): boolean;
/** Terminal means the drain worker is finished with it — not that it succeeded. */
export declare function isTerminal(state: OutboxState): boolean;
