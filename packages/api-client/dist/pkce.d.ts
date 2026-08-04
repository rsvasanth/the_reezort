/**
 * PKCE verifier/challenge generation (RFC 7636, S256 only).
 *
 * The crypto primitives are injected rather than imported so this package stays
 * unit-testable under Node and free of React Native-only dependencies. The ops
 * app wires `expo-crypto`.
 */
/** Platform crypto the ops app supplies from `expo-crypto`. */
export interface PkceCrypto {
    readonly randomBytes: (length: number) => Uint8Array;
    readonly sha256: (input: string) => Promise<Uint8Array>;
}
export interface PkcePair {
    readonly verifier: string;
    readonly challenge: string;
    /** Always `S256`. `plain` is accepted by Frappe but never offered here. */
    readonly method: "S256";
}
/**
 * base64url per RFC 4648 §5 — URL-safe alphabet, padding stripped.
 *
 * Written out rather than delegated to `btoa` because React Native does not
 * ship one, and because Frappe's comparison (`frappe/oauth.py`) is a literal
 * string match: a single `+` or trailing `=` we fail to substitute surfaces as
 * `invalid_grant` at the token exchange, with nothing in the error to say why.
 */
export declare function base64UrlEncode(bytes: Uint8Array): string;
export declare function createPkcePair(crypto: PkceCrypto): Promise<PkcePair>;
