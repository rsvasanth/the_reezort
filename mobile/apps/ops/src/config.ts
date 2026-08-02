/**
 * Runtime config, read from `app.json`'s `expo.extra` rather than hard-coded.
 *
 * Dev points at the Legion bench over Tailscale. Production values come from
 * the build profile once EAS is configured.
 */
import Constants from "expo-constants";

import type { OAuthConfig } from "@reezort/api-client";

import { redirectUri } from "./auth/login";

const extra = (Constants.expoConfig?.extra ?? {}) as {
	apiBaseUrl?: string;
	oauthClientId?: string;
};

if (!extra.apiBaseUrl || !extra.oauthClientId) {
	throw new Error("apiBaseUrl and oauthClientId must be set in app.json expo.extra");
}

export const oauthConfig: OAuthConfig = {
	baseUrl: extra.apiBaseUrl,
	clientId: extra.oauthClientId,
	redirectUri,
};
