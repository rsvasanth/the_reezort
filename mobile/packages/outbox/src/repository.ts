/**
 * SQLite persistence for the outbox.
 *
 * The SQL lives here rather than in the app so it can be tested against real
 * SQLite under Node; the app supplies only an executor over expo-sqlite. State
 * transitions are delegated to `drain.ts` and `resolve.ts` — this file moves
 * rows in and out of storage and owns nothing else.
 */
import { applySyncResult } from "./drain";
import { keepMine, keepServer } from "./resolve";
import { SCHEMA } from "./schema";
import type { ConflictDetail, OutboxRow, PendingUpload, SyncResult } from "./types";

export interface SqlExecutor {
	run(sql: string, params?: readonly unknown[]): Promise<void>;
	all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
	transaction<T>(work: () => Promise<T>): Promise<T>;
}

export interface EnqueueInput {
	readonly clientRequestId: string;
	readonly action: string;
	readonly payload: Readonly<Record<string, unknown>>;
	readonly targetDoctype?: string;
	readonly targetName?: string;
	readonly baseModified?: string;
	readonly createdAt: number;
}

export interface OutboxSummary {
	readonly pending: number;
	readonly needsReview: number;
	readonly failed: number;
}

interface OutboxDbRow {
	id: number;
	client_request_id: string;
	action: string;
	payload_json: string;
	target_doctype: string | null;
	target_name: string | null;
	base_modified: string | null;
	state: string;
	attempts: number;
	last_error: string | null;
	retry_after: number | null;
	conflict_json: string | null;
	resolved_from_conflict: number;
	created_at: number;
}

const COLUMNS = `id, client_request_id, action, payload_json, target_doctype, target_name,
	base_modified, state, attempts, last_error, retry_after, conflict_json,
	resolved_from_conflict, created_at`;

function toRow(db: OutboxDbRow): OutboxRow {
	return {
		id: db.id,
		clientRequestId: db.client_request_id,
		action: db.action,
		payload: JSON.parse(db.payload_json) as Record<string, unknown>,
		targetDoctype: db.target_doctype ?? undefined,
		targetName: db.target_name ?? undefined,
		baseModified: db.base_modified ?? undefined,
		state: db.state as OutboxRow["state"],
		attempts: db.attempts,
		lastError: db.last_error ?? undefined,
		retryAfter: db.retry_after ?? undefined,
		conflict: db.conflict_json ? (JSON.parse(db.conflict_json) as ConflictDetail) : undefined,
		resolvedFromConflict: db.resolved_from_conflict === 1,
		createdAt: db.created_at,
	};
}

export function createOutboxRepository(sql: SqlExecutor) {
	const persist = async (row: OutboxRow): Promise<void> => {
		await sql.run(
			`UPDATE outbox SET client_request_id = ?, base_modified = ?, state = ?, attempts = ?,
			 last_error = ?, retry_after = ?, conflict_json = ?, resolved_from_conflict = ?
			 WHERE id = ?`,
			[
				row.clientRequestId,
				row.baseModified ?? null,
				row.state,
				row.attempts,
				row.lastError ?? null,
				row.retryAfter ?? null,
				row.conflict ? JSON.stringify(row.conflict) : null,
				row.resolvedFromConflict ? 1 : 0,
				row.id,
			],
		);
	};

	const byClientRequestId = async (id: string): Promise<OutboxRow | null> => {
		const found = await sql.all<OutboxDbRow>(
			`SELECT ${COLUMNS} FROM outbox WHERE client_request_id = ?`,
			[id],
		);
		return found[0] ? toRow(found[0]) : null;
	};

	const byId = async (id: number): Promise<OutboxRow | null> => {
		const found = await sql.all<OutboxDbRow>(`SELECT ${COLUMNS} FROM outbox WHERE id = ?`, [id]);
		return found[0] ? toRow(found[0]) : null;
	};

	return {
		async init(): Promise<void> {
			await sql.run(SCHEMA);
			// SQLite disables foreign keys by default, in node:sqlite and in
			// expo-sqlite alike, so ON DELETE CASCADE would silently not fire.
			// Enabled here as a second line of defence — deletes are also explicit.
			await sql.run("PRAGMA foreign_keys = ON");
		},

		async enqueue(input: EnqueueInput): Promise<OutboxRow> {
			await sql.run(
				`INSERT INTO outbox
				 (client_request_id, action, payload_json, target_doctype, target_name, base_modified, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					input.clientRequestId,
					input.action,
					JSON.stringify(input.payload),
					input.targetDoctype ?? null,
					input.targetName ?? null,
					input.baseModified ?? null,
					input.createdAt,
				],
			);
			const row = await byClientRequestId(input.clientRequestId);
			if (!row) throw new Error(`Enqueue of ${input.clientRequestId} did not persist`);
			return row;
		},

		async list(): Promise<OutboxRow[]> {
			// Ascending id is drain order — the order the attendant acted in.
			const rows = await sql.all<OutboxDbRow>(`SELECT ${COLUMNS} FROM outbox ORDER BY id ASC`);
			return rows.map(toRow);
		},

		get: byId,

		async markInFlight(ids: readonly number[]): Promise<void> {
			for (const id of ids) {
				await sql.run("UPDATE outbox SET state = 'in_flight' WHERE id = ?", [id]);
			}
		},

		async applyResults(results: readonly SyncResult[], now: number): Promise<void> {
			await sql.transaction(async () => {
				for (const result of results) {
					const row = await byClientRequestId(result.clientRequestId);
					// A result for a row we no longer hold — a response that arrived
					// after a wipe, say. Dropping it is correct; recreating the row
					// would resurrect work the device was told to forget.
					if (!row) continue;
					await persist(applySyncResult(row, result, now));
				}
			});
		},

		async resolveKeepServer(id: number): Promise<void> {
			const row = await byId(id);
			if (!row) throw new Error(`No outbox row ${id}`);
			const plan = keepServer(row);

			await sql.transaction(async () => {
				// Explicit, not relying on the cascade: the pragma is per-connection
				// and a future executor could forget it. Losing this ordering leaves
				// photos that can never attach and are retried forever.
				await sql.run("DELETE FROM pending_upload WHERE outbox_id = ?", [
					plan.deleteUploadsForOutboxId,
				]);
				await sql.run("DELETE FROM outbox WHERE id = ?", [plan.deleteOutboxId]);
			});
		},

		async resolveKeepMine(id: number, newClientRequestId: () => string): Promise<void> {
			const row = await byId(id);
			if (!row) throw new Error(`No outbox row ${id}`);
			// Updated in place: the row id is what queued photos reference.
			await persist(keepMine(row, newClientRequestId).row);
		},

		async queueUpload(
			outboxId: number,
			localUri: string,
			contentHash: string,
			clientRequestId: string,
		): Promise<void> {
			await sql.run(
				`INSERT INTO pending_upload (client_request_id, outbox_id, local_uri, content_hash)
				 VALUES (?, ?, ?, ?)`,
				[clientRequestId, outboxId, localUri, contentHash],
			);
		},

		/** Every queued photo, for the drain worker to filter. */
		async listUploads(): Promise<PendingUpload[]> {
			const rows = await sql.all<{
				id: number; client_request_id: string; outbox_id: number; local_uri: string;
				content_hash: string; state: string; attempts: number;
			}>(
				`SELECT id, client_request_id, outbox_id, local_uri, content_hash, state, attempts
				 FROM pending_upload ORDER BY outbox_id ASC, id ASC`,
			);
			return rows.map((r) => ({
				id: r.id, clientRequestId: r.client_request_id, outboxId: r.outbox_id,
				localUri: r.local_uri, contentHash: r.content_hash,
				state: r.state as PendingUpload["state"], attempts: r.attempts,
			}));
		},

		async markUploadState(
			id: number,
			state: PendingUpload["state"],
			bumpAttempts = false,
		): Promise<void> {
			await sql.run(
				`UPDATE pending_upload SET state = ?, attempts = attempts + ? WHERE id = ?`,
				[state, bumpAttempts ? 1 : 0, id],
			);
		},

		/** Called once the server confirms the attachment. */
		async deleteUpload(id: number): Promise<void> {
			await sql.run("DELETE FROM pending_upload WHERE id = ?", [id]);
		},

		async uploadsFor(outboxId: number): Promise<PendingUpload[]> {
			const rows = await sql.all<{
				id: number;
				client_request_id: string;
				outbox_id: number;
				local_uri: string;
				content_hash: string;
				state: string;
				attempts: number;
			}>(
				`SELECT id, client_request_id, outbox_id, local_uri, content_hash, state, attempts
				 FROM pending_upload WHERE outbox_id = ? ORDER BY id ASC`,
				[outboxId],
			);
			return rows.map((r) => ({
				id: r.id,
				clientRequestId: r.client_request_id,
				outboxId: r.outbox_id,
				localUri: r.local_uri,
				contentHash: r.content_hash,
				state: r.state as PendingUpload["state"],
				attempts: r.attempts,
			}));
		},

		async summary(): Promise<OutboxSummary> {
			const rows = await sql.all<{ state: string; n: number }>(
				"SELECT state, COUNT(*) AS n FROM outbox GROUP BY state",
			);
			const count = (...states: string[]) =>
				rows.filter((r) => states.includes(r.state)).reduce((sum, r) => sum + r.n, 0);

			return {
				pending: count("pending", "in_flight"),
				needsReview: count("conflict", "refused"),
				failed: count("failed"),
			};
		},

		/** BYOD logout and remote revoke: nothing of ours survives on the handset. */
		async wipe(): Promise<void> {
			await sql.transaction(async () => {
				await sql.run("DELETE FROM pending_upload");
				await sql.run("DELETE FROM outbox");
				await sql.run("DELETE FROM cache_meta");
			});
		},
	};
}
