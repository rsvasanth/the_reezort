import { needsReview } from "./types";
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;
/**
 * How long a row may sit `in_flight` before another pass may re-send it.
 *
 * Long enough that a slow request on bad signal is not duplicated, short enough
 * that a crashed drain recovers within a round rather than a shift.
 */
export const IN_FLIGHT_LEASE_MS = 60_000;
/**
 * Exponential backoff, capped at five minutes.
 *
 * The cap matters more than the curve. Uncapped doubling puts attempt 12 about
 * two hours out, so an attendant who walks back into signal would keep a synced
 * phone that silently holds unsent work until long after the shift ended.
 */
export function retryDelayMs(attempts) {
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
export function nextBatch(rows, now, limit) {
    const ordered = [...rows].sort((a, b) => a.id - b.id);
    const blockedTargets = new Set();
    const batch = [];
    for (const row of ordered) {
        // Applied rows are finished. They are not deleted, so treating them as
        // blockers meant the first successful sync for a room permanently stopped
        // every later change to it — the queue dying the moment it first worked.
        if (row.state === "applied")
            continue;
        const target = `${row.targetDoctype ?? ""}:${row.targetName ?? ""}`;
        // `retryAfter` governs both cases: a backoff delay for a failed row, and a
        // lease for one in flight. Android kills backgrounded apps mid-drain
        // routinely, so a row nobody ever answers for has to come back rather than
        // sit until max_outbox_age_hours discards the attendant's work. Re-sending
        // is safe — the server is idempotent on client_request_id.
        const ready = !blockedTargets.has(target) &&
            !needsReview(row.state) &&
            (row.retryAfter === undefined || row.retryAfter <= now);
        if (!ready) {
            blockedTargets.add(target);
            continue;
        }
        if (batch.length < limit)
            batch.push(row);
    }
    return batch;
}
/** The row's next state given one `sync_push` result. */
export function applySyncResult(row, result, now) {
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
