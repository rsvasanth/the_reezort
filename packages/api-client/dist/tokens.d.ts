/** What the device holds after a successful OAuth exchange. */
export interface TokenSet {
    readonly accessToken: string;
    readonly refreshToken: string;
    /**
     * Absolute epoch milliseconds, not the server's `expires_in` duration.
     * A duration is meaningless once the process that received it has been
     * killed, which on Android is routine.
     */
    readonly expiresAt: number;
}
/**
 * Persistence for the token set.
 *
 * The ops app implements this over `expo-secure-store` so tokens land in the
 * Android Keystore. Nothing here may be written to AsyncStorage.
 */
export interface TokenStore {
    load(): Promise<TokenSet | null>;
    save(tokens: TokenSet): Promise<void>;
    clear(): Promise<void>;
}
/** Frappe's `get_token` response body. */
export interface TokenResponse {
    readonly access_token: string;
    readonly refresh_token: string;
    readonly expires_in: number;
}
export declare function toTokenSet(response: TokenResponse, now: number): TokenSet;
export declare function isExpired(tokens: TokenSet, now: number): boolean;
