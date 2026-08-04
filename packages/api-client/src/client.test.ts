import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "./client";
import { SessionExpiredError } from "./errors";
import type { TokenSet, TokenStore } from "./tokens";

const CONFIG = {
	baseUrl: "https://the-reezort.localhost",
	clientId: "reezort-ops",
	redirectUri: "reezort://auth/callback",
} as const;

const HOUR = 3_600_000;

const tokens = (suffix: string, expiresAt: number): TokenSet => ({
	accessToken: `at-${suffix}`,
	refreshToken: `rt-${suffix}`,
	expiresAt,
});

const memoryStore = (initial: TokenSet | null): TokenStore & { current: TokenSet | null } => {
	const store = {
		current: initial,
		load: async () => store.current,
		save: async (next: TokenSet) => {
			store.current = next;
		},
		clear: async () => {
			store.current = null;
		},
	};
	return store;
};

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const refreshResponse = {
	access_token: "at-2",
	refresh_token: "rt-2",
	token_type: "Bearer",
	expires_in: 3600,
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-08-02T10:00:00Z"));
});

describe("createClient", () => {
	it("authenticates with a bearer token and sends no cookies", async () => {
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		const fetchMock = vi.fn(async () => json({ message: { ok: true } }));
		const client = createClient(CONFIG, store, fetchMock);

		await client.call("frappe.auth.get_logged_user");

		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
		// Frappe stamps `sid=Guest` on every response; a live cookie jar would
		// accumulate that in app storage on a personal handset.
		expect(init.credentials).toBe("omit");
	});

	it("unwraps Frappe's `message` envelope", async () => {
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		const fetchMock = vi.fn(async () => json({ message: { user: "hk@x.com" } }));
		const client = createClient(CONFIG, store, fetchMock);

		await expect(client.call("whoami")).resolves.toEqual({ user: "hk@x.com" });
	});

	it("refreshes once on 401 and retries the original call", async () => {
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({ exc_type: "AuthenticationError" }, 401))
			.mockResolvedValueOnce(json(refreshResponse))
			.mockResolvedValueOnce(json({ message: "ok" }));
		const client = createClient(CONFIG, store, fetchMock);

		await expect(client.call("whoami")).resolves.toBe("ok");
		expect(store.current?.accessToken).toBe("at-2");
	});

	it("refreshes ONCE for concurrent 401s, not once per caller", async () => {
		// Ten screens waking from background at the same moment is the real case.
		// Parallel refreshes race to write the store and all but one lose, leaving
		// the device holding a token the server has already rotated past.
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		let refreshCalls = 0;
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			const body = String(init?.body ?? "");
			if (body.includes("grant_type=refresh_token")) {
				refreshCalls += 1;
				return json(refreshResponse);
			}
			const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
			return auth === "Bearer at-2" ? json({ message: "ok" }) : json({}, 401);
		});
		const client = createClient(CONFIG, store, fetchMock);

		const results = await Promise.all(
			Array.from({ length: 10 }, () => client.call<string>("whoami")),
		);

		expect(results).toEqual(Array.from({ length: 10 }, () => "ok"));
		expect(refreshCalls).toBe(1);
	});

	it("does not refresh again for a straggler that 401s after someone else refreshed", async () => {
		// The single-flight latch only covers callers that overlap. A request that
		// left before the refresh and returns 401 after it lands with a token that
		// is stale but a latch that is already clear — and Frappe accepts the old
		// refresh token (no reuse detection), so the second refresh silently
		// succeeds and strands an extra Active token row on the server.
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		let refreshCalls = 0;
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			if (String(init?.body ?? "").includes("grant_type=refresh_token")) {
				refreshCalls += 1;
				return json(refreshResponse);
			}
			const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
			return auth === "Bearer at-2" ? json({ message: "ok" }) : json({}, 401);
		});
		let releaseStraggler = () => {};
		const stragglerHeld = new Promise<void>((resolve) => {
			releaseStraggler = resolve;
		});
		let stragglerReached = () => {};
		const stragglerAtWire = new Promise<void>((resolve) => {
			stragglerReached = resolve;
		});

		let held = false;
		const gated = async (url: string, init?: RequestInit): Promise<Response> => {
			// Hold the straggler's first attempt open across the other refresh.
			if (url.includes("straggler") && !held) {
				held = true;
				stragglerReached();
				await stragglerHeld;
			}
			return fetchMock(url, init);
		};
		const client = createClient(CONFIG, store, gated);

		const straggler = client.call("straggler"); // loads at-1, then blocks
		await stragglerAtWire;

		await client.call("first"); // 401 -> refresh -> at-2 -> ok
		expect(refreshCalls).toBe(1);

		releaseStraggler(); // now the straggler's at-1 attempt finally 401s
		await straggler;

		// It must adopt the token the store already holds, not refresh again.
		expect(refreshCalls).toBe(1);
	});

	it("refreshes proactively when the token has already expired", async () => {
		const store = memoryStore(tokens("1", Date.now() - 1));
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
			String(init?.body ?? "").includes("grant_type=refresh_token")
				? json(refreshResponse)
				: json({ message: "ok" }),
		);
		const client = createClient(CONFIG, store, fetchMock);

		await client.call("whoami");

		// The expired token must never reach the wire.
		const attempted = fetchMock.mock.calls.map(
			([, init]) => (init?.headers as Record<string, string> | undefined)?.Authorization,
		);
		expect(attempted).not.toContain("Bearer at-1");
	});

	it("wipes the session when the refresh itself is rejected", async () => {
		// AD-016-007: a revoked device must treat rejection as a wipe trigger, not
		// as a retryable error. This is the lost-handset path.
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({}, 401))
			.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
		const client = createClient(CONFIG, store, fetchMock);

		await expect(client.call("whoami")).rejects.toBeInstanceOf(SessionExpiredError);
		expect(store.current).toBeNull();
	});

	it("does NOT wipe the session when the refresh fails for want of a network", async () => {
		// The wipe exists for revoked devices. Losing signal is not a revocation —
		// and on an offline-first ops app it is the normal state, not the
		// exception. Wiping here would log an attendant out in a service lift and
		// take the unsynced half of their round with it.
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({}, 401))
			.mockRejectedValueOnce(new TypeError("Network request failed"));
		const client = createClient(CONFIG, store, fetchMock);

		await expect(client.call("whoami")).rejects.not.toBeInstanceOf(SessionExpiredError);
		expect(store.current).not.toBeNull();
		expect(store.current?.refreshToken).toBe("rt-1");
	});

	it("wipes only when the server actually rejects the grant", async () => {
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({}, 401))
			.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
		const client = createClient(CONFIG, store, fetchMock);

		await expect(client.call("whoami")).rejects.toBeInstanceOf(SessionExpiredError);
		expect(store.current).toBeNull();
	});

	it("notifies onRefreshed so the server can revoke the superseded token", async () => {
		// Frappe issues a new bearer token per refresh and revokes nothing, so a
		// handset accumulates live credentials unless it tells the server which
		// device just rotated. Nothing in Frappe's token endpoint identifies the
		// device, so this callback is the only place that can.
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		const onRefreshed = vi.fn(async () => {});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({}, 401))
			.mockResolvedValueOnce(json(refreshResponse))
			.mockResolvedValueOnce(json({ message: "ok" }));
		const client = createClient(CONFIG, store, fetchMock, { onRefreshed });

		await client.call("whoami");

		expect(onRefreshed).toHaveBeenCalledWith(
			expect.objectContaining({ accessToken: "at-2" }),
		);
	});

	it("does not let a failing onRefreshed break the call it interrupted", async () => {
		// Bookkeeping is not worth losing an attendant's request over. Worst case
		// the server holds one stale token, which the scheduled purge collects.
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({}, 401))
			.mockResolvedValueOnce(json(refreshResponse))
			.mockResolvedValueOnce(json({ message: "ok" }));
		const client = createClient(CONFIG, store, fetchMock, {
			onRefreshed: async () => {
				throw new Error("network blip");
			},
		});

		await expect(client.call("whoami")).resolves.toBe("ok");
	});

	it("does not retry indefinitely when the retry also 401s", async () => {
		const store = memoryStore(tokens("1", Date.now() + HOUR));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({}, 401))
			.mockResolvedValueOnce(json(refreshResponse))
			.mockResolvedValueOnce(json({}, 401));
		const client = createClient(CONFIG, store, fetchMock);

		await expect(client.call("whoami")).rejects.toBeInstanceOf(SessionExpiredError);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("fails closed when there is no session at all", async () => {
		const client = createClient(CONFIG, memoryStore(null), vi.fn());

		await expect(client.call("whoami")).rejects.toBeInstanceOf(SessionExpiredError);
	});
});
