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

/** Server-issued credentials, held in Android Keystore via expo-secure-store. */
export interface MobileSession {
	readonly apiKey: string;
	readonly apiSecret: string;
	readonly user: string;
	readonly fullName: string;
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
