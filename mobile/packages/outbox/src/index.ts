/**
 * Write-behind outbox for the ops app. Ops only — the guest app is online-first.
 *
 * Drain order is strictly by row id, so a photo upload never precedes the write
 * it attaches to. Every row carries a client-generated idempotency key and the
 * `modified` timestamp it was based on; the server rejects rather than clobbers
 * (see data-model.md). Conflicts surface as "needs review" — never auto-resolved.
 */
import type { SyncStatus } from "@reezort/domain-types";

export type OutboxState = "pending" | "in_flight" | "applied" | "conflict" | "failed";

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
	readonly createdAt: string;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_request_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  target_doctype TEXT,
  target_name TEXT,
  base_modified TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_upload (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outbox_id INTEGER NOT NULL REFERENCES outbox(id),
  local_uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cache_meta (
  collection TEXT PRIMARY KEY,
  last_synced_at TEXT NOT NULL
);
`;

export function isTerminal(state: OutboxState): boolean {
	return state === "applied" || state === "conflict";
}

export function stateForSyncStatus(status: SyncStatus): OutboxState {
	switch (status) {
		case "Applied":
		case "Duplicate":
			return "applied";
		case "Conflict":
			return "conflict";
		default:
			return "failed";
	}
}
