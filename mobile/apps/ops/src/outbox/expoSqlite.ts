/**
 * SqlExecutor over expo-sqlite — the Android half of `packages/outbox`.
 *
 * Thin on purpose. The package holds the SQL and is tested against real SQLite
 * under Node; this only supplies a connection, so the statements running on a
 * handset are the ones the test suite exercised.
 */
import * as SQLite from "expo-sqlite";

import type { SqlExecutor } from "@reezort/outbox";

const DB_NAME = "reezort-ops.db";

let handle: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
	if (!handle) {
		handle = await SQLite.openDatabaseAsync(DB_NAME);
		// SQLite disables foreign keys per connection, so ON DELETE CASCADE would
		// silently do nothing. The repository also deletes dependents explicitly —
		// this is the belt to that pair of braces.
		await handle.execAsync("PRAGMA foreign_keys = ON");
	}
	return handle;
}

export const expoSqlExecutor: SqlExecutor = {
	async run(sql, params = []) {
		const connection = await db();
		// Multi-statement SQL (the schema) has no parameters; parameterised calls
		// are always a single statement.
		if (!params.length) {
			await connection.execAsync(sql);
			return;
		}
		await connection.runAsync(sql, params as SQLite.SQLiteBindValue[]);
	},

	async all<T>(sql: string, params: readonly unknown[] = []) {
		const connection = await db();
		return connection.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
	},

	async transaction<T>(work: () => Promise<T>) {
		const connection = await db();
		let out: T;
		// withExclusiveTransactionAsync serialises against other writers, which
		// matters because the drain worker and the UI both write.
		await connection.withExclusiveTransactionAsync(async () => {
			out = await work();
		});
		return out!;
	},
};

/**
 * Destroy the local database.
 *
 * AD-016-007: logout and remote revoke must leave nothing readable on a handset
 * the resort does not own. Dropping the file is stronger than deleting rows —
 * SQLite leaves deleted content in freed pages until they are reused.
 */
export async function deleteLocalDatabase(): Promise<void> {
	if (handle) {
		await handle.closeAsync();
		handle = null;
	}
	await SQLite.deleteDatabaseAsync(DB_NAME);
}
