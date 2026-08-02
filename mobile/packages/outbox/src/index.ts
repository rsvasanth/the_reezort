/**
 * Write-behind outbox for the ops app. Ops only — the guest app is online-first.
 *
 * Drain order is strictly by row id, so a photo upload never precedes the write
 * it attaches to. Every row carries a client-generated idempotency key and the
 * `modified` timestamp it was based on; the server rejects rather than clobbers
 * (see data-model.md). Conflicts surface as "needs review" — never auto-resolved.
 *
 * The state machine and the resolution semantics are pure functions over rows,
 * deliberately free of SQLite and of the network: that is where silent data loss
 * would live, so it is the part that has to be exhaustively testable. The
 * expo-sqlite adapter belongs in the ops app.
 */
export { SCHEMA } from "./schema";
export {
	drainOnce,
	fromWireResult,
	toWireOperation,
	SYNC_PUSH,
	type WireOperation,
	type WireResult,
} from "./transport";
export { createOutboxRepository, type EnqueueInput, type OutboxSummary, type SqlExecutor } from "./repository";
export { applySyncResult, nextBatch, retryDelayMs } from "./drain";
export { keepMine, keepServer, type KeepMinePlan, type KeepServerPlan } from "./resolve";
export {
	isTerminal,
	needsReview,
	type ConflictDetail,
	type OutboxRow,
	type OutboxState,
	type PendingUpload,
	type SyncResult,
} from "./types";
