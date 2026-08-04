/**
 * One `sync_pull` pass into the read cache.
 *
 * This is where the server's per-collection watermarks, tombstones and `known`
 * become behaviour rather than API surface: without it the client refetches
 * everything every time and a reassigned task never leaves the device.
 */
import type { CacheRepository } from "./cache";
export declare const SYNC_PULL = "the_reezort.mobile.api.sync_pull";
type Call = <T>(method: string, body?: unknown) => Promise<T>;
export interface PullOutcome {
    readonly received: Record<string, number>;
    readonly evicted: Record<string, number>;
    readonly hasMore: boolean;
}
export declare function syncPullOnce(cache: CacheRepository, call: Call, collections: readonly string[], now: number): Promise<PullOutcome>;
export {};
