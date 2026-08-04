/**
 * The wire seam between the outbox and `sync_push`.
 *
 * The outbox is camelCase TypeScript; Frappe is snake_case Python. Nothing
 * bridged them until this module, and the failure mode was silent in both
 * directions: an unrecognised key is ignored by Frappe rather than rejected, and
 * `applyResults` skips results whose row it cannot find — deliberately, so a
 * response arriving after a BYOD wipe cannot resurrect work. Together that meant
 * a mismatched batch would look like it drained and change nothing.
 */
import type { SyncStatus } from "@reezort/domain-types";
import type { OutboxRow, SyncResult } from "./types";
/** One entry of the `operations` array `sync_push` reads. */
export interface WireOperation {
    client_request_id: string;
    action: string;
    target_doctype?: string;
    target_name?: string;
    base_modified?: string;
    queued_at?: string;
    payload: Record<string, unknown>;
}
/** One entry of the per-operation result array `sync_push` returns. */
export interface WireResult {
    client_request_id: string;
    status: SyncStatus;
    /** Present on a Duplicate: the outcome originally recorded for this key. */
    original_status?: SyncStatus;
    conflict_reason?: string;
    changed_by?: string;
    changed_by_name?: string;
    server_modified?: string;
    server_values?: Record<string, unknown>;
    your_values?: Record<string, unknown>;
    error_message?: string;
}
export declare function toWireOperation(row: OutboxRow): WireOperation;
export declare function fromWireResult(wire: WireResult): SyncResult;
/** What the outbox needs from a repository in order to drain. */
interface DrainableRepository {
    list(): Promise<OutboxRow[]>;
    markInFlight(ids: readonly number[], leaseUntil: number): Promise<void>;
    applyResults(results: readonly SyncResult[], now: number): Promise<void>;
}
/** The authenticated caller — `createClient(...).call` satisfies this. */
type Call = <T>(method: string, body?: unknown) => Promise<T>;
export declare const SYNC_PUSH = "the_reezort.mobile.api.sync_push";
/**
 * One drain pass: take the next batch, send it, record what came back.
 *
 * Deliberately a single pass rather than a loop — retry timing belongs to the
 * caller, which knows about connectivity and the app's foreground state.
 */
export declare function drainOnce(repo: DrainableRepository, call: Call, now: number, limit?: number): Promise<SyncResult[]>;
export {};
