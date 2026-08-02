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
