import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCacheRepository, type SqlExecutor } from "./cache";
import { syncPullOnce } from "./pullTransport";

function nodeSqlite(): SqlExecutor {
	const db = new DatabaseSync(":memory:");
	return {
		async run(sql, params = []) {
			for (const statement of sql.split(";").filter((s) => s.trim())) {
				db.prepare(statement).run(...(params as never[]));
			}
		},
		async all<T>(sql: string, params: readonly unknown[] = []) {
			return db.prepare(sql).all(...(params as never[])) as T[];
		},
		async transaction<T>(work: () => Promise<T>) {
			db.exec("BEGIN");
			try {
				const out = await work();
				db.exec("COMMIT");
				return out;
			} catch (cause) {
				db.exec("ROLLBACK");
				throw cause;
			}
		},
	};
}

const task = (name: string, over: Record<string, unknown> = {}) => ({
	name,
	room: "RZ-DEMO-102",
	task_status: "Assigned",
	modified: "2026-08-02 09:00:00.000000",
	...over,
});

let cache: ReturnType<typeof createCacheRepository>;

beforeEach(async () => {
	cache = createCacheRepository(nodeSqlite());
	await cache.init();
});

describe("cache", () => {
	it("round-trips documents for a collection", async () => {
		await cache.upsert("housekeeping_tasks", [task("A"), task("B")], 1_000);

		const rows = await cache.list<{ name: string }>("housekeeping_tasks");
		expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
	});

	it("replaces a document rather than duplicating it", async () => {
		await cache.upsert("housekeeping_tasks", [task("A")], 1_000);
		await cache.upsert("housekeeping_tasks", [task("A", { task_status: "In Progress" })], 2_000);

		const rows = await cache.list<{ name: string; task_status: string }>("housekeeping_tasks");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.task_status).toBe("In Progress");
	});

	it("keeps collections apart", async () => {
		await cache.upsert("housekeeping_tasks", [task("A")], 1_000);
		await cache.upsert("maintenance_tickets", [task("A")], 1_000);

		expect(await cache.list("housekeeping_tasks")).toHaveLength(1);
		expect(await cache.knownIds("maintenance_tickets")).toEqual(["A"]);
	});

	it("evicts tombstoned documents", async () => {
		await cache.upsert("housekeeping_tasks", [task("A"), task("B")], 1_000);

		await cache.evict("housekeeping_tasks", ["A"]);

		expect(await cache.knownIds("housekeeping_tasks")).toEqual(["B"]);
	});

	it("stores a watermark per collection", async () => {
		await cache.setWatermark("housekeeping_tasks", "2026-08-02 09:00:00", 1_000);
		await cache.setWatermark("maintenance_tickets", "2026-08-02 10:00:00", 1_000);

		expect(await cache.watermarks()).toEqual({
			housekeeping_tasks: "2026-08-02 09:00:00",
			maintenance_tickets: "2026-08-02 10:00:00",
		});
	});

	it("purges documents outside the working window", async () => {
		// AD-016-007: on a handset the resort does not own, cached documents older
		// than the working window are dropped on each successful sync. Minimising
		// what is held at all is a security control here, not a storage tweak.
		await cache.upsert("housekeeping_tasks", [task("old")], 1_000);
		await cache.upsert("housekeeping_tasks", [task("fresh")], 90_000);

		await cache.purgeOlderThan(50_000);

		expect(await cache.knownIds("housekeeping_tasks")).toEqual(["fresh"]);
	});

	it("wipe leaves nothing", async () => {
		await cache.upsert("housekeeping_tasks", [task("A")], 1_000);
		await cache.setWatermark("housekeeping_tasks", "x", 1_000);

		await cache.wipe();

		expect(await cache.knownIds("housekeeping_tasks")).toEqual([]);
		expect(await cache.watermarks()).toEqual({});
	});
});

describe("syncPullOnce", () => {
	it("sends stored watermarks and held ids, then applies the response", async () => {
		await cache.upsert("housekeeping_tasks", [task("A"), task("GONE")], 1_000);
		await cache.setWatermark("housekeeping_tasks", "2026-08-02 09:00:00", 1_000);

		const call = vi.fn(async () => ({
			data: {
				collections: { housekeeping_tasks: [task("B")] },
				watermarks: { housekeeping_tasks: "2026-08-02 11:00:00" },
				tombstones: { housekeeping_tasks: ["GONE"] },
				has_more: false,
			},
		}));

		await syncPullOnce(cache, call as never, ["housekeeping_tasks"], 2_000);

		const firstCall = call.mock.calls[0] as unknown as [string, Record<string, unknown>] | undefined;
		if (!firstCall) throw new Error("sync_pull was never called");
		const [, body] = firstCall;
		expect(body.since).toEqual({ housekeeping_tasks: "2026-08-02 09:00:00" });
		const known = (body.known as Record<string, string[]>).housekeeping_tasks ?? [];
		expect([...known].sort()).toEqual(["A", "GONE"]);

		// Tombstoned row evicted, new row added, existing row untouched.
		expect((await cache.knownIds("housekeeping_tasks")).sort()).toEqual(["A", "B"]);
		expect(await cache.watermarks()).toEqual({
			housekeeping_tasks: "2026-08-02 11:00:00",
		});
	});

	it("does not advance a watermark the server did not return", async () => {
		// rooms_summary carries no watermark by design. Writing `undefined` would
		// wipe the stored one and turn every later pull into a full refetch.
		await cache.setWatermark("housekeeping_tasks", "2026-08-02 09:00:00", 1_000);
		const call = vi.fn(async () => ({
			data: {
				collections: { rooms_summary: [task("R1")] },
				watermarks: {},
				tombstones: {},
				has_more: false,
			},
		}));

		await syncPullOnce(cache, call as never, ["rooms_summary"], 2_000);

		expect(await cache.watermarks()).toEqual({
			housekeeping_tasks: "2026-08-02 09:00:00",
		});
	});

	it("leaves the cache untouched when the call fails", async () => {
		await cache.upsert("housekeeping_tasks", [task("A")], 1_000);
		const call = vi.fn(async () => {
			throw new Error("offline");
		});

		await expect(
			syncPullOnce(cache, call as never, ["housekeeping_tasks"], 2_000),
		).rejects.toThrow();

		// Losing signal must not empty the list an attendant is working from.
		expect(await cache.knownIds("housekeeping_tasks")).toEqual(["A"]);
	});
});
