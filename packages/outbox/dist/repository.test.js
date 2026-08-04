import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createOutboxRepository } from "./repository";
/**
 * Exercised against real SQLite via node:sqlite rather than a hand-rolled fake,
 * so the SQL in `repository.ts` is genuinely under test — expo-sqlite on device
 * runs the same statements.
 */
function nodeSqlite(options = {}) {
    // node:sqlite turns foreign keys ON at open time, unlike bare SQLite and
    // unlike expo-sqlite. Opting out is what makes the "cascade cannot fire" case
    // reachable in a test at all.
    const db = new DatabaseSync(":memory:", {
        enableForeignKeyConstraints: !options.swallowPragma,
    });
    return {
        async run(sql, params = []) {
            // node:sqlite's exec() takes no params; prepare() takes one statement.
            for (const statement of sql.split(";").filter((s) => s.trim())) {
                // `swallowPragma` models a connection where foreign keys stay off —
                // SQLite's default, and a real possibility on a pooled or replaced
                // expo-sqlite connection. ON DELETE CASCADE then does nothing.
                if (options.swallowPragma && statement.trim().toUpperCase().startsWith("PRAGMA")) {
                    continue;
                }
                db.prepare(statement).run(...params);
            }
        },
        async all(sql, params = []) {
            return db.prepare(sql).all(...params);
        },
        async transaction(work) {
            db.exec("BEGIN");
            try {
                const out = await work();
                db.exec("COMMIT");
                return out;
            }
            catch (cause) {
                db.exec("ROLLBACK");
                throw cause;
            }
        },
    };
}
const input = {
    action: "housekeeping.set_room_status",
    payload: { housekeeping_status: "Clean" },
    targetDoctype: "Room",
    targetName: "RM-214",
    baseModified: "2026-08-02 09:10:00.000000",
};
let repo;
beforeEach(async () => {
    repo = createOutboxRepository(nodeSqlite());
    await repo.init();
});
describe("enqueue", () => {
    it("round-trips a row including its payload", async () => {
        const row = await repo.enqueue({ ...input, clientRequestId: "req-1", createdAt: 100 });
        expect(row.id).toBeGreaterThan(0);
        expect(row.state).toBe("pending");
        const [stored] = await repo.list();
        expect(stored?.payload).toEqual({ housekeeping_status: "Clean" });
        expect(stored?.baseModified).toBe("2026-08-02 09:10:00.000000");
    });
    it("assigns ids in the order actions were taken", async () => {
        await repo.enqueue({ ...input, clientRequestId: "a", createdAt: 1 });
        await repo.enqueue({ ...input, clientRequestId: "b", createdAt: 2 });
        expect((await repo.list()).map((r) => r.clientRequestId)).toEqual(["a", "b"]);
    });
    it("rejects a duplicate client_request_id", async () => {
        // The idempotency key is the whole safety net for flaky-Wi-Fi retries. Two
        // local rows sharing one would let the same action apply twice.
        await repo.enqueue({ ...input, clientRequestId: "dup", createdAt: 1 });
        await expect(repo.enqueue({ ...input, clientRequestId: "dup", createdAt: 2 })).rejects.toThrow();
    });
});
describe("applyResults", () => {
    it("persists conflict detail for the review screen", async () => {
        await repo.enqueue({ ...input, clientRequestId: "req-1", createdAt: 1 });
        await repo.applyResults([
            {
                clientRequestId: "req-1",
                status: "Conflict",
                conflictReason: "Room was reassigned by a supervisor",
                changedByName: "Anita",
                serverModified: "2026-08-02 09:15:40.221904",
                serverValues: { housekeeping_status: "Inspected" },
                yourValues: { housekeeping_status: "Clean" },
            },
        ], 1_000);
        const [row] = await repo.list();
        expect(row?.state).toBe("conflict");
        expect(row?.conflict?.changedByName).toBe("Anita");
        expect(row?.conflict?.serverValues).toEqual({ housekeeping_status: "Inspected" });
    });
    it("ignores a result for a row this device does not have", async () => {
        // A stale response after a wipe must not resurrect anything.
        await expect(repo.applyResults([{ clientRequestId: "unknown", status: "Applied" }], 0)).resolves.not.toThrow();
        expect(await repo.list()).toEqual([]);
    });
});
describe("resolveKeepServer", () => {
    it("deletes the row and its queued photos together", async () => {
        const row = await repo.enqueue({ ...input, clientRequestId: "req-1", createdAt: 1 });
        await repo.queueUpload(row.id, "file:///tmp/a.jpg", "hash-a", `upload-${row.id}`);
        await repo.applyResults([{ clientRequestId: "req-1", status: "Conflict", serverModified: "2026-08-02 09:15:40" }], 0);
        await repo.resolveKeepServer(row.id);
        expect(await repo.list()).toEqual([]);
        // The photo must go too — it can never attach to a write that no longer
        // exists, and left behind it is retried forever.
        expect(await repo.uploadsFor(row.id)).toEqual([]);
    });
    it("deletes the photos even when foreign keys are off", async () => {
        // SQLite disables foreign keys by default, so ON DELETE CASCADE cannot be
        // the only defence — on a connection where the pragma never ran, the
        // cascade silently does nothing and the photo outlives its parent write.
        const bare = createOutboxRepository(nodeSqlite({ swallowPragma: true }));
        await bare.init();
        const row = await bare.enqueue({ ...input, clientRequestId: "req-1", createdAt: 1 });
        await bare.queueUpload(row.id, "file:///tmp/a.jpg", "hash-a", `upload-${row.id}`);
        await bare.applyResults([{ clientRequestId: "req-1", status: "Conflict", serverModified: "2026-08-02 09:15:40" }], 0);
        await bare.resolveKeepServer(row.id);
        expect(await bare.uploadsFor(row.id)).toEqual([]);
    });
});
describe("resolveKeepMine", () => {
    it("rebases, re-keys, and keeps the photo attached", async () => {
        const row = await repo.enqueue({ ...input, clientRequestId: "req-original", createdAt: 1 });
        await repo.queueUpload(row.id, "file:///tmp/a.jpg", "hash-a", `upload-${row.id}`);
        await repo.applyResults([
            {
                clientRequestId: "req-original",
                status: "Conflict",
                serverModified: "2026-08-02 09:15:40.221904",
            },
        ], 0);
        await repo.resolveKeepMine(row.id, () => "req-fresh");
        const [next] = await repo.list();
        expect(next?.clientRequestId).toBe("req-fresh");
        expect(next?.baseModified).toBe("2026-08-02 09:15:40.221904");
        expect(next?.state).toBe("pending");
        expect(next?.resolvedFromConflict).toBe(true);
        expect(await repo.uploadsFor(row.id)).toHaveLength(1);
    });
    it("lands in refused, not failed, when the re-push is rejected", async () => {
        const row = await repo.enqueue({ ...input, clientRequestId: "req-original", createdAt: 1 });
        await repo.applyResults([{ clientRequestId: "req-original", status: "Conflict", serverModified: "s" }], 0);
        await repo.resolveKeepMine(row.id, () => "req-fresh");
        await repo.applyResults([{ clientRequestId: "req-fresh", status: "Rejected", errorMessage: "Room is occupied" }], 0);
        const [next] = await repo.list();
        expect(next?.state).toBe("refused");
        expect(next?.lastError).toBe("Room is occupied");
    });
});
describe("summary", () => {
    it("counts what the sync indicator has to show", async () => {
        await repo.enqueue({ ...input, clientRequestId: "a", targetName: "RM-1", createdAt: 1 });
        await repo.enqueue({ ...input, clientRequestId: "b", targetName: "RM-2", createdAt: 2 });
        await repo.applyResults([{ clientRequestId: "b", status: "Conflict", serverModified: "s" }], 0);
        expect(await repo.summary()).toEqual({ pending: 1, needsReview: 1, failed: 0 });
    });
});
describe("wipe", () => {
    it("leaves nothing behind", async () => {
        // AD-016-007: logout and remote revoke must destroy local data on a handset
        // the resort does not own.
        const row = await repo.enqueue({ ...input, clientRequestId: "a", createdAt: 1 });
        await repo.queueUpload(row.id, "file:///tmp/a.jpg", "hash-a", `upload-${row.id}`);
        await repo.wipe();
        expect(await repo.list()).toEqual([]);
        expect(await repo.uploadsFor(row.id)).toEqual([]);
    });
});
