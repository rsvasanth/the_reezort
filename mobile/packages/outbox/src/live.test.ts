import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll } from "vitest";

import { createOutboxRepository, type SqlExecutor } from "./repository";
import { keepMine } from "./resolve";
import { drainOnce } from "./transport";

/**
 * The end-to-end proof that the client and the server actually speak to each
 * other. Everything else in this package is tested in isolation, which is
 * exactly how the camelCase/snake_case seam stayed broken while both halves were
 * green.
 *
 * Skipped unless a bench is pointed at:
 *   REEZORT_BENCH_URL=http://the-reezort.localhost:8004 \
 *   REEZORT_USER=… REEZORT_PASSWORD=… REEZORT_ADMIN_PASSWORD=… yarn test
 */
const BENCH = process.env.REEZORT_BENCH_URL;
const USER = process.env.REEZORT_USER;
const PASSWORD = process.env.REEZORT_PASSWORD;
const ADMIN_PASSWORD = process.env.REEZORT_ADMIN_PASSWORD;
const live = BENCH && USER && PASSWORD && ADMIN_PASSWORD ? describe : describe.skip;

const b64url = (raw: Buffer) => raw.toString("base64url");

/** Minimal cookie-jar fetch — Frappe's /authorize leg needs a session. */
function session() {
	let cookies = "";
	return async (url: string, init: RequestInit = {}): Promise<Response> => {
		const response = await fetch(url, {
			...init,
			redirect: "manual",
			headers: { ...(init.headers ?? {}), ...(cookies ? { Cookie: cookies } : {}) },
		});
		const set = response.headers.getSetCookie?.() ?? [];
		if (set.length) cookies = set.map((c) => c.split(";")[0]).join("; ");
		return response;
	};
}

async function bearerToken(clientId: string): Promise<string> {
	const s = session();
	await s(`${BENCH}/api/method/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ usr: USER, pwd: PASSWORD }),
	});

	const verifier = b64url(randomBytes(32));
	const challenge = b64url(createHash("sha256").update(verifier).digest());
	const params = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		scope: "all openid",
		redirect_uri: "reezort://auth/callback",
		state: "live",
		code_challenge: challenge,
		code_challenge_method: "S256",
	});
	const redirect = await s(
		`${BENCH}/api/method/frappe.integrations.oauth2.authorize?${params}`,
	);
	const location = redirect.headers.get("location") ?? "";
	const code = new URL(location).searchParams.get("code");
	if (!code) throw new Error(`No authorization code. Location: ${location}`);

	const token = await fetch(`${BENCH}/api/method/frappe.integrations.oauth2.get_token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			client_id: clientId,
			redirect_uri: "reezort://auth/callback",
			code_verifier: verifier,
		}),
	}).then((r) => r.json());
	if (!token.access_token) throw new Error(`No token: ${JSON.stringify(token)}`);
	return token.access_token;
}

/** Admin session, for setting up and inspecting fixtures. */
async function adminCall() {
	const s = session();
	await s(`${BENCH}/api/method/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ usr: "Administrator", pwd: ADMIN_PASSWORD }),
	});
	return async (path: string, init: RequestInit = {}) =>
		(await s(`${BENCH}${path}`, init)).json();
}

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

live("outbox against a real bench", () => {
	let call: <T>(method: string, body?: unknown) => Promise<T>;
	let admin: (path: string, init?: RequestInit) => Promise<never>;
	let taskName: string;
	let taskModified: string;

	beforeAll(async () => {
		admin = (await adminCall()) as never;
		const clients: never = await admin(
			`/api/resource/OAuth Client?filters=[["app_name","=","reezort-ops"]]&fields=["client_id"]`,
		);
		const clientId = (clients as { data: { client_id: string }[] }).data[0]?.client_id;
		if (!clientId) throw new Error("No reezort-ops OAuth Client — run seed_mobile on the bench");
		const token = await bearerToken(clientId);

		call = async <T>(method: string, body?: unknown): Promise<T> => {
			const response = await fetch(`${BENCH}/api/method/${method}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				credentials: "omit",
			});
			const payload = (await response.json()) as { message?: T; exception?: string };
			if (!response.ok) throw new Error(payload.exception ?? `HTTP ${response.status}`);
			return payload.message as T;
		};

		const rooms = (await admin(
			`/api/resource/Room?fields=["name"]&limit_page_length=1`,
		)) as unknown as { data: { name: string }[] };
		const room = rooms.data[0]?.name;
		if (!room) throw new Error("No Room on the bench to attach a task to");

		const created: never = await admin("/api/method/the_reezort.housekeeping.api.create_task", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				payload: {
					room,
					task_type: "Departure Cleaning",
					assigned_user: USER,
					idempotency_key: `live-${randomUUID()}`,
				},
			}),
		});
		taskName = (created as { message: { data: { task: { name: string } } } }).message.data.task
			.name;
		await admin("/api/method/the_reezort.housekeeping.api.assign_task", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ task: taskName, assigned_user: USER }),
		});
		const doc: never = await admin(`/api/resource/Housekeeping Task/${taskName}`);
		taskModified = (doc as { data: { modified: string } }).data.modified;
	}, 60_000);

	it("drains a queued write all the way to Applied", async () => {
		const repo = createOutboxRepository(nodeSqlite());
		await repo.init();
		await repo.enqueue({
			clientRequestId: randomUUID(),
			action: "housekeeping.start_task",
			payload: {},
			targetDoctype: "Housekeeping Task",
			targetName: taskName,
			baseModified: taskModified,
			createdAt: Date.now(),
		});

		const results = await drainOnce(repo, call, Date.now());

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("Applied");
		expect((await repo.list())[0]?.state).toBe("applied");
	}, 30_000);

	it("surfaces a stale base_modified as a reviewable conflict", async () => {
		const repo = createOutboxRepository(nodeSqlite());
		await repo.init();
		await repo.enqueue({
			clientRequestId: randomUUID(),
			action: "housekeeping.pause_task",
			payload: {},
			targetDoctype: "Housekeeping Task",
			targetName: taskName,
			baseModified: "2020-01-01 00:00:00.000000",
			createdAt: Date.now(),
		});

		await drainOnce(repo, call, Date.now());

		const [row] = await repo.list();
		expect(row?.state).toBe("conflict");
		// The review screen needs all of this, mapped out of snake_case.
		expect(row?.conflict?.serverModified).toBeTruthy();
		expect(row?.conflict?.changedByName).toBeTruthy();
		expect(row?.conflict?.serverValues).toHaveProperty("task_status");
	}, 30_000);

	it("re-pushes a conflict resolved in the attendant's favour", async () => {
		const repo = createOutboxRepository(nodeSqlite());
		await repo.init();
		const queued = await repo.enqueue({
			clientRequestId: randomUUID(),
			action: "housekeeping.pause_task",
			payload: {},
			targetDoctype: "Housekeeping Task",
			targetName: taskName,
			baseModified: "2020-01-01 00:00:00.000000",
			createdAt: Date.now(),
		});
		await drainOnce(repo, call, Date.now());
		expect((await repo.list())[0]?.state).toBe("conflict");

		await repo.resolveKeepMine(queued.id, () => randomUUID());
		const results = await drainOnce(repo, call, Date.now());

		// Rebased onto the server's modified, with a fresh idempotency key, so the
		// server applies it rather than replaying the recorded Conflict.
		expect(results[0]?.status).toBe("Applied");
		expect((await repo.list())[0]?.state).toBe("applied");
	}, 30_000);

	it("replays a repeated key as its original outcome, not as success", async () => {
		const repo = createOutboxRepository(nodeSqlite());
		await repo.init();
		const key = randomUUID();
		const enqueue = () =>
			repo.enqueue({
				clientRequestId: key,
				action: "housekeeping.pause_task",
				payload: {},
				targetDoctype: "Housekeeping Task",
				targetName: taskName,
				baseModified: "2020-01-01 00:00:00.000000",
				createdAt: Date.now(),
			});
		await enqueue();
		await drainOnce(repo, call, Date.now());

		// A second device-side attempt with the same key: the server replays the
		// recorded Conflict as Duplicate. If that mapped to `applied` the queued
		// change would vanish without anyone reviewing it.
		const repo2 = createOutboxRepository(nodeSqlite());
		await repo2.init();
		await repo2.enqueue({
			clientRequestId: key,
			action: "housekeeping.pause_task",
			payload: {},
			targetDoctype: "Housekeeping Task",
			targetName: taskName,
			baseModified: "2020-01-01 00:00:00.000000",
			createdAt: Date.now(),
		});
		const results = await drainOnce(repo2, call, Date.now());

		expect(results[0]?.status).toBe("Conflict");
		expect((await repo2.list())[0]?.state).toBe("conflict");
	}, 30_000);
});
