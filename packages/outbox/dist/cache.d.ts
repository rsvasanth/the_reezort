export type { SqlExecutor } from "./repository";
import type { SqlExecutor } from "./repository";
export declare function createCacheRepository(sql: SqlExecutor): {
    init(): Promise<void>;
    upsert(collection: string, documents: readonly Record<string, unknown>[], now: number): Promise<void>;
    list<T>(collection: string): Promise<T[]>;
    knownIds(collection: string): Promise<string[]>;
    /** Drop documents the server says are no longer the caller's. */
    evict(collection: string, names: readonly string[]): Promise<void>;
    watermarks(): Promise<Record<string, string>>;
    setWatermark(collection: string, watermark: string, now: number): Promise<void>;
    /**
     * Drop anything cached before `cutoff`.
     *
     * AD-016-007: cached documents outside the working window are purged on each
     * successful sync. On a handset the resort does not own, minimising what is
     * held at all is a security control rather than a storage optimisation.
     */
    purgeOlderThan(cutoff: number): Promise<void>;
    /** Logout and remote revoke. */
    wipe(): Promise<void>;
};
export type CacheRepository = ReturnType<typeof createCacheRepository>;
