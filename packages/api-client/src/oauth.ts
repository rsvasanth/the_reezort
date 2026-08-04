/**
 * The four Frappe OAuth2 legs, exactly as verified against the bench in
 * `specs/016-mobile-apps/auth-spike-findings.md`.
 *
 * All of these are public-client calls: no `client_secret` is sent, because a
 * secret shipped inside an APK is not a secret.
 */
import { AuthError } from "./errors";
import type { PkcePair } from "./pkce";
import { type TokenResponse, type TokenSet, toTokenSet } from "./tokens";

export interface OAuthConfig {
	readonly baseUrl: string;
	readonly clientId: string;
	readonly redirectUri: string;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const AUTHORIZE = "frappe.integrations.oauth2.authorize";
const GET_TOKEN = "frappe.integrations.oauth2.get_token";
const REVOKE_TOKEN = "frappe.integrations.oauth2.revoke_token";

const SCOPE = "all openid";

const endpoint = (baseUrl: string, method: string): string =>
	`${baseUrl}/api/method/${method}`;

/**
 * The URL to open in an in-app Custom Tab.
 *
 * `code_challenge` is not optional here even though the server treats it as
 * such — the spike confirmed Frappe issues tokens to clients that omit it, so
 * the only guarantee that this flow is PKCE-protected is that this function
 * cannot construct a URL without one.
 *
 * Caller obligation: `state` must be freshly random per attempt, and the value
 * returned on the redirect must be compared against it before the code is
 * exchanged. Nothing in this package can enforce that, because the redirect is
 * handled by the app's deep-link layer. Skipping the comparison leaves the flow
 * open to having someone else's authorization code injected into this session.
 */
export function buildAuthorizeUrl(
	config: OAuthConfig,
	pkce: PkcePair,
	state: string,
): string {
	const params = new URLSearchParams({
		client_id: config.clientId,
		response_type: "code",
		scope: SCOPE,
		redirect_uri: config.redirectUri,
		state,
		code_challenge: pkce.challenge,
		code_challenge_method: pkce.method,
	});

	return `${endpoint(config.baseUrl, AUTHORIZE)}?${params.toString()}`;
}

async function postForm(
	url: string,
	form: URLSearchParams,
	doFetch: Fetch,
): Promise<Response> {
	return doFetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: form.toString(),
		credentials: "omit",
	});
}

async function readTokens(response: Response, now: number): Promise<TokenSet> {
	const payload = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
		error?: string;
		error_description?: string;
	};

	// Both tokens are required. `TokenSet` declares them non-optional, so letting
	// a partial response through would smuggle `undefined` past the type system
	// and resurface an hour later as an unexplained logout.
	if (!response.ok || !payload.access_token || !payload.refresh_token) {
		throw new AuthError(
			payload.error ?? "invalid_response",
			response.status,
			payload.error_description,
		);
	}

	return toTokenSet(payload as TokenResponse, now);
}

export async function exchangeCode(
	config: OAuthConfig,
	code: string,
	pkce: PkcePair,
	doFetch: Fetch,
): Promise<TokenSet> {
	const response = await postForm(
		endpoint(config.baseUrl, GET_TOKEN),
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			client_id: config.clientId,
			redirect_uri: config.redirectUri,
			code_verifier: pkce.verifier,
		}),
		doFetch,
	);

	return readTokens(response, Date.now());
}

export async function refreshTokens(
	config: OAuthConfig,
	refreshToken: string,
	doFetch: Fetch,
): Promise<TokenSet> {
	const response = await postForm(
		endpoint(config.baseUrl, GET_TOKEN),
		new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: config.clientId,
			redirect_uri: config.redirectUri,
		}),
		doFetch,
	);

	return readTokens(response, Date.now());
}

/**
 * Revoke one token. Verified against the bench: a revoked token answers 401,
 * the same as an expired or forged one, so the client needs no special case.
 *
 * This revokes exactly what it is given. Frappe's rotation leaves prior tokens
 * live and has no reuse detection, so a clean logout calls this for the refresh
 * token as well as the access token, and the server-side `mobile_logout` walks
 * whatever is left of the chain.
 */
export async function revokeToken(
	config: OAuthConfig,
	token: string,
	doFetch: Fetch,
): Promise<void> {
	await postForm(
		endpoint(config.baseUrl, REVOKE_TOKEN),
		new URLSearchParams({ token, client_id: config.clientId }),
		doFetch,
	);
}
