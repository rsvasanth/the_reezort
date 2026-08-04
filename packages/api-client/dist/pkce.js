/**
 * PKCE verifier/challenge generation (RFC 7636, S256 only).
 *
 * The crypto primitives are injected rather than imported so this package stays
 * unit-testable under Node and free of React Native-only dependencies. The ops
 * app wires `expo-crypto`.
 */
const STANDARD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/**
 * base64url per RFC 4648 §5 — URL-safe alphabet, padding stripped.
 *
 * Written out rather than delegated to `btoa` because React Native does not
 * ship one, and because Frappe's comparison (`frappe/oauth.py`) is a literal
 * string match: a single `+` or trailing `=` we fail to substitute surfaces as
 * `invalid_grant` at the token exchange, with nothing in the error to say why.
 */
export function base64UrlEncode(bytes) {
    let out = "";
    for (let index = 0; index < bytes.length; index += 3) {
        const a = bytes[index] ?? 0;
        const b = bytes[index + 1];
        const c = bytes[index + 2];
        const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
        out += STANDARD_ALPHABET[(triple >> 18) & 0x3f];
        out += STANDARD_ALPHABET[(triple >> 12) & 0x3f];
        if (b !== undefined)
            out += STANDARD_ALPHABET[(triple >> 6) & 0x3f];
        if (c !== undefined)
            out += STANDARD_ALPHABET[triple & 0x3f];
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_");
}
/** 32 random bytes → a 43-character verifier, the RFC 7636 minimum. */
const VERIFIER_BYTES = 32;
export async function createPkcePair(crypto) {
    const verifier = base64UrlEncode(crypto.randomBytes(VERIFIER_BYTES));
    const challenge = base64UrlEncode(await crypto.sha256(verifier));
    return { verifier, challenge, method: "S256" };
}
