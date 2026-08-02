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

import { IN_FLIGHT_LEASE_MS, nextBatch } from "./drain";
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

/** The house response envelope. */
interface Envelope<T> {
	ok: boolean;
	data: T;
}

/**
 * Frappe datetime: `YYYY-MM-DD HH:mm:ss.ffffff`, no timezone marker.
 *
 * Sent as epoch milliseconds it would land in a Datetime column as nonsense, and
 * `queued_at` is what an operator reads when reconstructing what an attendant
 * actually did on the floor.
 */
function toFrappeDatetime(epochMs: number): string {
	return new Date(epochMs).toISOString().replace("T", " ").replace("Z", "000");
}

export function toWireOperation(row: OutboxRow): WireOperation {
	const wire: WireOperation = {
		client_request_id: row.clientRequestId,
		action: row.action,
		payload: { ...row.payload },
		queued_at: toFrappeDatetime(row.createdAt),
	};
	if (row.targetDoctype) wire.target_doctype = row.targetDoctype;
	if (row.targetName) wire.target_name = row.targetName;
	// Omitted rather than empty: the server only compares when it is present, and
	// an empty string would mismatch every stored `modified` and conflict forever.
	if (row.baseModified) wire.base_modified = row.baseModified;
	return wire;
}

export function fromWireResult(wire: WireResult): SyncResult {
	// A replayed operation comes back as Duplicate with the real outcome in
	// `original_status`. Taken at face value Duplicate maps to `applied`, which
	// would quietly mark a conflicted row resolved and discard the attendant's
	// queued change without anyone having chosen anything.
	const status =
		wire.status === "Duplicate" && wire.original_status ? wire.original_status : wire.status;

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

/** What the outbox needs from a repository in order to drain. */
interface DrainableRepository {
	list(): Promise<OutboxRow[]>;
	markInFlight(ids: readonly number[], leaseUntil: number): Promise<void>;
	applyResults(results: readonly SyncResult[], now: number): Promise<void>;
}

/** The authenticated caller — `createClient(...).call` satisfies this. */
type Call = <T>(method: string, body?: unknown) => Promise<T>;

export const SYNC_PUSH = "the_reezort.mobile.api.sync_push";

/**
 * One drain pass: take the next batch, send it, record what came back.
 *
 * Deliberately a single pass rather than a loop — retry timing belongs to the
 * caller, which knows about connectivity and the app's foreground state.
 */
export async function drainOnce(
	repo: DrainableRepository,
	call: Call,
	now: number,
	limit = 50,
): Promise<SyncResult[]> {
	const batch = nextBatch(await repo.list(), now, limit);
	if (!batch.length) return [];

	await repo.markInFlight(batch.map((row) => row.id), now + IN_FLIGHT_LEASE_MS);

	const response = await call<Envelope<{ results: WireResult[] }>>(SYNC_PUSH, {
		operations: batch.map(toWireOperation),
	});

	const results = (response?.data?.results ?? []).map(fromWireResult);
	await repo.applyResults(results, now);
	return results;
}
