/**
 * The drain state machine.
 *
 * Pure functions over rows and `sync_push` results, deliberately free of SQLite
 * and of the network: this is where the data-loss bugs would live, so it is the
 * part that has to be exhaustively testable.
 */
import type { OutboxRow, SyncResult } from "./types";
import { needsReview } from "./types";

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/**
 * Exponential backoff, capped at five minutes.
 *
 * The cap matters more than the curve. Uncapped doubling puts attempt 12 about
 * two hours out, so an attendant who walks back into signal would keep a synced
 * phone that silently holds unsent work until long after the shift ended.
 */
export function retryDelayMs(attempts: number): number {
	return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
}

/**
 * The next rows to send, in drain order.
 *
 * Ordering is strictly by `id`, which is the order the attendant acted in.
 * A row is held back if it is already in flight, waiting on a person, or inside
 * its backoff window — and, critically, if an earlier row against the *same
 * target* is held back, because applying a later change to a document whose
 * earlier change never landed silently reorders the attendant's work.
 */
export function nextBatch(rows: readonly OutboxRow[], now: number, limit: number): OutboxRow[] {
	const ordered = [...rows].sort((a, b) => a.id - b.id);
	const blockedTargets = new Set<string>();
	const batch: OutboxRow[] = [];

	for (const row of ordered) {
		const target = `${row.targetDoctype ?? ""}:${row.targetName ?? ""}`;
		const ready =
			!blockedTargets.has(target) &&
			row.state !== "in_flight" &&
			row.state !== "applied" &&
			!needsReview(row.state) &&
			(row.retryAfter === undefined || row.retryAfter <= now);

		if (!ready) {
			blockedTargets.add(target);
			continue;
		}
		if (batch.length < limit) batch.push(row);
	}

	return batch;
}

/** The row's next state given one `sync_push` result. */
export function applySyncResult(row: OutboxRow, result: SyncResult, now: number): OutboxRow {
	switch (result.status) {
		case "Applied":
		case "Duplicate":
			// Duplicate means the server already holds this write — that is the
			// idempotency key doing its job, not a failure.
			return { ...row, state: "applied", lastError: undefined, retryAfter: undefined };

		case "Conflict":
			// Resolved by a person, never by waiting: a retry would re-send the same
			// base_modified and conflict identically, forever.
			return {
				...row,
				state: "conflict",
				retryAfter: undefined,
				conflict: {
					reason: result.conflictReason ?? "",
					changedByName: result.changedByName,
					serverModified: result.serverModified ?? "",
					serverValues: result.serverValues ?? {},
					yourValues: result.yourValues ?? row.payload,
				},
			};

		case "Rejected":
			// Business validation said no. The payload is unchanged, so retrying
			// cannot succeed — this needs a person either way.
			return {
				...row,
				state: row.resolvedFromConflict ? "refused" : "failed",
				lastError: result.errorMessage,
				retryAfter: undefined,
			};

		default: {
			// Transient. Back off and try again.
			const attempts = row.attempts + 1;
			return {
				...row,
				state: "failed",
				attempts,
				lastError: result.errorMessage,
				retryAfter: now + retryDelayMs(attempts),
			};
		}
	}
}
