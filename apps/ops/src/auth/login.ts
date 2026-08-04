/**
 * The PKCE login flow, Android half.
 *
 * `/authorize` needs a Frappe session cookie, so this runs in an in-app Custom
 * Tab rather than a native form. Credentials never touch app code — a real BYOD
 * gain (AD-016-007) — at the cost of a login UX that looks like a browser.
 */
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

import {
	AuthError,
	buildAuthorizeUrl,
	createPkcePair,
	exchangeCode,
	type OAuthConfig,
	type TokenSet,
} from "@reezort/api-client";

import { expoCrypto } from "./expoCrypto";

WebBrowser.maybeCompleteAuthSession();

/**
 * In Expo Go this is `exp://<host>:8081/--/auth/callback`; in a dev or release
 * build it is `reezort://auth/callback`. Both must be registered on the
 * `OAuth Client`, because Frappe rejects any redirect_uri it has not been told
 * about — verified in the spike.
 */
export const redirectUri = AuthSession.makeRedirectUri({ path: "auth/callback" });

export class LoginCancelled extends Error {
	constructor() {
		super("Login cancelled");
		this.name = "LoginCancelled";
	}
}

export async function login(config: OAuthConfig): Promise<TokenSet> {
	const pkce = await createPkcePair(expoCrypto);
	const state = Array.from(expoCrypto.randomBytes(16), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");

	const result = await WebBrowser.openAuthSessionAsync(
		buildAuthorizeUrl(config, pkce, state),
		config.redirectUri,
	);

	if (result.type !== "success") throw new LoginCancelled();

	const returned = new URL(result.url);
	const params = returned.searchParams;

	const error = params.get("error");
	if (error) throw new AuthError(error, 400, params.get("error_description") ?? undefined);

	// State check. `buildAuthorizeUrl` cannot enforce this — the redirect lands
	// here, not in the package — and without it someone else's authorization code
	// can be injected into this session.
	if (params.get("state") !== state) {
		throw new AuthError("state_mismatch", 400, "Authorization response did not match the request");
	}

	const code = params.get("code");
	if (!code) throw new AuthError("no_code", 400, "Authorization response carried no code");

	return exchangeCode(config, code, pkce, fetch);
}
