/**
 * Frappe REST client for both mobile apps.
 *
 * Auth is OAuth2 authorization-code + PKCE (S256) as a public client, per
 * AD-016-002 — bearer tokens, no client secret, no session cookies. The earlier
 * `Authorization: token key:secret` exchange was replaced after the Phase 1
 * spike proved PKCE works against our bench and, more decisively, that
 * key/secret cannot revoke one device without revoking them all. See
 * `specs/016-mobile-apps/auth-spike-findings.md`.
 *
 * The platform pieces — crypto, the Custom Tab, secure storage — are injected
 * by the app rather than imported here, so this package stays unit-testable and
 * usable from both apps.
 */
export { createClient, type FrappeClient } from "./client";
export { AuthError, FrappeApiError, SessionExpiredError } from "./errors";
export { buildAuthorizeUrl, exchangeCode, refreshTokens, revokeToken, type Fetch, type OAuthConfig, } from "./oauth";
export { base64UrlEncode, createPkcePair, type PkceCrypto, type PkcePair } from "./pkce";
export { isExpired, toTokenSet, type TokenResponse, type TokenSet, type TokenStore, } from "./tokens";
