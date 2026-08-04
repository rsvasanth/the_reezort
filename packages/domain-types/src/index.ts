/**
 * Doctype-mirrored types shared by both mobile apps.
 *
 * Every string-literal union here MUST equal its backing doctype Select
 * options exactly. `yarn check:contracts` enforces it. Drift here is what
 * caused the production 417 the guard was written for — a hand-typed value
 * the backend never emits.
 *
 * Populated per screen as Phase 3 lands. Kept empty rather than guessed:
 * a wrong union is worse than a missing one.
 */

/* ── Housekeeping Task ─────────────────────────────────────────────────── */

/** `housekeeping_task.task_status`. */
export type HousekeepingTaskStatus =
	| "Draft"
	| "Queued"
	| "Assigned"
	| "In Progress"
	| "Paused"
	| "Completed"
	| "Inspection Required"
	| "Rework Required"
	| "Skipped"
	| "Cancelled";

/**
 * `housekeeping_task.dnd_status`.
 *
 * "None" is a real option, not an empty field — the doctype spells the cleared
 * state rather than leaving it null, and a client that tests for falsiness would
 * read "None" as set.
 */
export type HousekeepingDndStatus = "None" | "DND" | "Refused" | "Access Issue";

/** `housekeeping_task.priority`. Note "Normal", not "Medium". */
export type HousekeepingPriority = "Low" | "Normal" | "High" | "Urgent" | "VIP";

/* ── Maintenance Ticket ────────────────────────────────────────────────── */

/** `maintenance_ticket.state`. */
export type MaintenanceTicketState =
	| "Reported"
	| "Assigned"
	| "In Progress"
	| "Waiting for Parts"
	| "On Hold"
	| "Resolved"
	| "Verification Required"
	| "Released"
	| "Closed"
	| "Duplicate";

/** `maintenance_ticket.priority`. Wider than housekeeping's, and different. */
export type MaintenanceTicketPriority =
	| "Low"
	| "Normal"
	| "High"
	| "Urgent"
	| "Guest Impacting"
	| "Safety Critical"
	| "Revenue Blocking";

/**
 * The signed-in user, as returned by `register_session`.
 *
 * Deliberately carries no credentials. Tokens live in `TokenSet`
 * (`@reezort/api-client`), held in Android Keystore via expo-secure-store and
 * never surfaced to screens — see AD-016-002.
 */
export interface MobileSession {
	readonly user: string;
	readonly fullName: string;
	/** UI gating only. Server-side permission remains the enforcement truth. */
	readonly roles: readonly string[];
	/** Server clock at login, for detecting device clock skew on queued writes. */
	readonly serverTime: string;
}

/** Result of one queued write, per contracts/api.md. */
export type SyncStatus = "Applied" | "Duplicate" | "Conflict" | "Rejected" | "Failed";

export interface SyncResult {
	readonly clientRequestId: string;
	readonly status: SyncStatus;
	readonly conflictReason?: string;
	readonly serverModified?: string;
	readonly serverValues?: Readonly<Record<string, unknown>>;
	readonly yourValues?: Readonly<Record<string, unknown>>;
}
