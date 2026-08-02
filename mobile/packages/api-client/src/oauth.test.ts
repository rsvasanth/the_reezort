import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "./errors";
import { buildAuthorizeUrl, exchangeCode, refreshTokens, revokeToken } from "./oauth";

const CONFIG = {
	baseUrl: "https://the-reezort.localhost",
	clientId: "reezort-ops",
	redirectUri: "reezort://auth/callback",
} as const;

const PKCE = { verifier: "v".repeat(43), challenge: "chal", method: "S256" } as const;

const tokenResponse = {
	access_token: "at-1",
	refresh_token: "rt-1",
	id_token: "it-1",
	token_type: "Bearer",
	scope: "all openid",
	expires_in: 3600,
};

const respond = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

describe("buildAuthorizeUrl", () => {
	it("always carries a code_challenge and S256 method", () => {
		// The spike proved the server issues tokens to clients that omit the
		// challenge entirely — PKCE is opt-in server-side. This assertion is the
		// only thing standing between us and a silently unprotected flow.
		const url = new URL(buildAuthorizeUrl(CONFIG, PKCE, "state-1"));

		expect(url.searchParams.get("code_challenge")).toBe("chal");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
	});

	it("requests an authorization code against the native redirect", () => {
		const url = new URL(buildAuthorizeUrl(CONFIG, PKCE, "state-1"));

		expect(url.pathname).toBe("/api/method/frappe.integrations.oauth2.authorize");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("client_id")).toBe("reezort-ops");
		expect(url.searchParams.get("redirect_uri")).toBe("reezort://auth/callback");
		expect(url.searchParams.get("state")).toBe("state-1");
		expect(url.searchParams.get("scope")).toBe("all openid");
	});
});

describe("exchangeCode", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("sends the verifier and no client_secret", async () => {
		const fetchMock = vi.fn(async () => respond(tokenResponse));

		await exchangeCode(CONFIG, "code-1", PKCE, fetchMock);

		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		const body = new URLSearchParams(init.body as string);
		expect(body.get("grant_type")).toBe("authorization_code");
		expect(body.get("code_verifier")).toBe(PKCE.verifier);
		expect(body.get("code")).toBe("code-1");
		// A public client that ships a secret in the APK is not a public client.
		expect(body.has("client_secret")).toBe(false);
	});

	it("maps the response onto a token set with an absolute expiry", async () => {
		vi.setSystemTime(new Date("2026-08-02T10:00:00Z"));
		const fetchMock = vi.fn(async () => respond(tokenResponse));

		const tokens = await exchangeCode(CONFIG, "code-1", PKCE, fetchMock);

		expect(tokens.accessToken).toBe("at-1");
		expect(tokens.refreshToken).toBe("rt-1");
		// Absolute, not a duration — a queued write can outlive the process that
		// received `expires_in`.
		expect(tokens.expiresAt).toBe(Date.parse("2026-08-02T11:00:00Z"));
	});

	it("rejects a response missing a refresh_token instead of typing undefined as string", async () => {
		// Without a refresh token the session is unrenewable, and TokenSet declares
		// the field non-optional. Accepting it here would push `undefined` past the
		// type system and surface an hour later as an unexplained logout.
		const { refresh_token: _omitted, ...withoutRefresh } = tokenResponse;
		const fetchMock = vi.fn(async () => respond(withoutRefresh));

		await expect(exchangeCode(CONFIG, "code-1", PKCE, fetchMock)).rejects.toBeInstanceOf(
			AuthError,
		);
	});

	it("raises AuthError on invalid_grant rather than returning a broken token set", async () => {
		const fetchMock = vi.fn(async () => respond({ error: "invalid_grant" }, 400));

		await expect(exchangeCode(CONFIG, "code-1", PKCE, fetchMock)).rejects.toBeInstanceOf(
			AuthError,
		);
	});
});

describe("refreshTokens", () => {
	it("uses the refresh grant with no secret", async () => {
		const fetchMock = vi.fn(async () => respond(tokenResponse));

		await refreshTokens(CONFIG, "rt-0", fetchMock);

		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		const body = new URLSearchParams(init.body as string);
		expect(body.get("grant_type")).toBe("refresh_token");
		expect(body.get("refresh_token")).toBe("rt-0");
		expect(body.has("client_secret")).toBe(false);
	});
});

describe("revokeToken", () => {
	it("posts the token to the revoke endpoint", async () => {
		const fetchMock = vi.fn(async () => respond({}));

		await revokeToken(CONFIG, "at-1", fetchMock);

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toContain("frappe.integrations.oauth2.revoke_token");
		expect(new URLSearchParams(init.body as string).get("token")).toBe("at-1");
	});
});
