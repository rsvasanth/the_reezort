/**
 * Client-side SQLite schema, per `data-model.md`.
 *
 * `pending_upload.outbox_id` cascades: resolving a conflict in favour of the
 * server deletes the parent write, and its photos must go with it or the worker
 * retries an attachment that can never land.
 */
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
  retry_after INTEGER,
  conflict_json TEXT,
  resolved_from_conflict INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_state_id ON outbox (state, id);
CREATE TABLE IF NOT EXISTS pending_upload (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_request_id TEXT NOT NULL UNIQUE,
  outbox_id INTEGER NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  local_uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pending_upload_outbox ON pending_upload (outbox_id);
CREATE TABLE IF NOT EXISTS cache_meta (
  collection TEXT PRIMARY KEY,
  last_synced_at TEXT NOT NULL
);
`;
