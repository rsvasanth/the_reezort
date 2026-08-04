/**
 * The read cache: the user's own assigned work, held locally so the app opens to
 * a task list rather than a spinner when there is no signal.
 *
 * Disposable by definition. It is never the source of truth and is rebuilt from
 * `sync_pull`; anything that cannot be rebuilt belongs in the outbox instead.
 */
import { SCHEMA } from "./schema";
export function createCacheRepository(sql) {
    return {
        async init() {
            await sql.run(SCHEMA);
            await sql.run("PRAGMA foreign_keys = ON");
        },
        async upsert(collection, documents, now) {
            for (const doc of documents) {
                const name = String(doc.name ?? "");
                if (!name)
                    continue;
                await sql.run(`INSERT INTO cache_document (collection, name, data_json, cached_at)
					 VALUES (?, ?, ?, ?)
					 ON CONFLICT(collection, name) DO UPDATE SET
					   data_json = excluded.data_json, cached_at = excluded.cached_at`, [collection, name, JSON.stringify(doc), now]);
            }
        },
        async list(collection) {
            const rows = await sql.all("SELECT name, data_json FROM cache_document WHERE collection = ? ORDER BY name ASC", [collection]);
            return rows.map((row) => JSON.parse(row.data_json));
        },
        async knownIds(collection) {
            const rows = await sql.all("SELECT name FROM cache_document WHERE collection = ? ORDER BY name ASC", [collection]);
            return rows.map((row) => row.name);
        },
        /** Drop documents the server says are no longer the caller's. */
        async evict(collection, names) {
            for (const name of names) {
                await sql.run("DELETE FROM cache_document WHERE collection = ? AND name = ?", [
                    collection,
                    name,
                ]);
            }
        },
        async watermarks() {
            const rows = await sql.all("SELECT collection, watermark FROM cache_meta");
            return Object.fromEntries(rows.filter((r) => r.watermark).map((r) => [r.collection, r.watermark]));
        },
        async setWatermark(collection, watermark, now) {
            await sql.run(`INSERT INTO cache_meta (collection, watermark, last_synced_at)
				 VALUES (?, ?, ?)
				 ON CONFLICT(collection) DO UPDATE SET
				   watermark = excluded.watermark, last_synced_at = excluded.last_synced_at`, [collection, watermark, now]);
        },
        /**
         * Drop anything cached before `cutoff`.
         *
         * AD-016-007: cached documents outside the working window are purged on each
         * successful sync. On a handset the resort does not own, minimising what is
         * held at all is a security control rather than a storage optimisation.
         */
        async purgeOlderThan(cutoff) {
            await sql.run("DELETE FROM cache_document WHERE cached_at < ?", [cutoff]);
        },
        /** Logout and remote revoke. */
        async wipe() {
            await sql.transaction(async () => {
                await sql.run("DELETE FROM cache_document");
                await sql.run("DELETE FROM cache_meta");
            });
        },
    };
}
