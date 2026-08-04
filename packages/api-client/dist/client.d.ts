import { type Fetch, type OAuthConfig } from "./oauth";
import { type TokenSet, type TokenStore } from "./tokens";
export interface FrappeClient {
    call<T>(method: string, body?: unknown): Promise<T>;
}
export interface ClientHooks {
    /**
     * Called after a successful token refresh, before the retry.
     *
     * Frappe issues a new `OAuth Bearer Token` row per refresh and revokes
     * nothing, so a handset quietly accumulates live credentials — each one a
     * working key to operational data on a phone the resort does not own. The ops
     * app uses this to call `rotate_session`, which revokes the superseded row.
     * Nothing in Frappe's token endpoint identifies the device, so the client is
     * the only thing that can say which one rotated.
     */
    onRefreshed?: (tokens: TokenSet) => Promise<void>;
}
export declare function createClient(config: OAuthConfig, store: TokenStore, doFetch: Fetch, hooks?: ClientHooks): FrappeClient;
