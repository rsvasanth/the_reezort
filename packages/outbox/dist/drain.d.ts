/**
 * The drain state machine.
 *
 * Pure functions over rows and `sync_push` results, deliberately free of SQLite
 * and of the network: this is where the data-loss bugs would live, so it is the
 * part that has to be exhaustively testable.
 */
import type { OutboxRow, SyncResult } from "./types";
/**
 * How long a row may sit `in_flight` before another pass may re-send it.
 *
 * Long enough that a slow request on bad signal is not duplicated, short enough
 * that a crashed drain recovers within a round rather than a shift.
 */
export declare const IN_FLIGHT_LEASE_MS = 60000;
/**
 * Exponential backoff, capped at five minutes.
 *
 * The cap matters more than the curve. Uncapped doubling puts attempt 12 about
 * two hours out, so an attendant who walks back into signal would keep a synced
 * phone that silently holds unsent work until long after the shift ended.
 */
export declare function retryDelayMs(attempts: number): number;
/**
 * The next rows to send, in drain order.
 *
 * Ordering is strictly by `id`, which is the order the attendant acted in.
 * A row is held back if it is already in flight, waiting on a person, or inside
 * its backoff window — and, critically, if an earlier row against the *same
 * target* is held back, because applying a later change to a document whose
 * earlier change never landed silently reorders the attendant's work.
 */
export declare function nextBatch(rows: readonly OutboxRow[], now: number, limit: number): OutboxRow[];
/** The row's next state given one `sync_push` result. */
export declare function applySyncResult(row: OutboxRow, result: SyncResult, now: number): OutboxRow;
