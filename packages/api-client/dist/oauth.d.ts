import type { PkcePair } from "./pkce";
import { type TokenSet } from "./tokens";
export interface OAuthConfig {
    readonly baseUrl: string;
    readonly clientId: string;
    readonly redirectUri: string;
}
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
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
export declare function buildAuthorizeUrl(config: OAuthConfig, pkce: PkcePair, state: string): string;
export declare function exchangeCode(config: OAuthConfig, code: string, pkce: PkcePair, doFetch: Fetch): Promise<TokenSet>;
export declare function refreshTokens(config: OAuthConfig, refreshToken: string, doFetch: Fetch): Promise<TokenSet>;
/**
 * Revoke one token. Verified against the bench: a revoked token answers 401,
 * the same as an expired or forged one, so the client needs no special case.
 *
 * This revokes exactly what it is given. Frappe's rotation leaves prior tokens
 * live and has no reuse detection, so a clean logout calls this for the refresh
 * token as well as the access token, and the server-side `mobile_logout` walks
 * whatever is left of the chain.
 */
export declare function revokeToken(config: OAuthConfig, token: string, doFetch: Fetch): Promise<void>;
