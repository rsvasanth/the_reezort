/**
 * Refresh this many milliseconds before the nominal expiry.
 *
 * Covers clock skew between handset and server plus request flight time, so a
 * token that is about to lapse is replaced rather than sent and rejected.
 */
const EXPIRY_SKEW_MS = 60_000;
export function toTokenSet(response, now) {
    return {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: now + response.expires_in * 1000,
    };
}
export function isExpired(tokens, now) {
    return tokens.expiresAt - EXPIRY_SKEW_MS <= now;
}
