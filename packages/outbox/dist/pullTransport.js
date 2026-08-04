export const SYNC_PULL = "the_reezort.mobile.api.sync_pull";
export async function syncPullOnce(cache, call, collections, now) {
    const since = await cache.watermarks();
    const known = {};
    for (const collection of collections) {
        known[collection] = await cache.knownIds(collection);
    }
    // Deliberately before any cache write: a failure here must leave the list the
    // attendant is working from exactly as it was. Losing signal is not a reason
    // to empty their round.
    const response = await call(SYNC_PULL, { collections, since, known });
    const body = response?.data ?? {};
    const received = {};
    const evicted = {};
    for (const [collection, tombstoned] of Object.entries(body.tombstones ?? {})) {
        if (!tombstoned?.length)
            continue;
        await cache.evict(collection, tombstoned);
        evicted[collection] = tombstoned.length;
    }
    for (const [collection, documents] of Object.entries(body.collections ?? {})) {
        await cache.upsert(collection, documents ?? [], now);
        received[collection] = documents?.length ?? 0;
    }
    for (const [collection, watermark] of Object.entries(body.watermarks ?? {})) {
        // Only when the server actually sent one. rooms_summary carries no
        // watermark by design, and writing an undefined would clear the stored one
        // and turn every later pull into a full refetch.
        if (watermark)
            await cache.setWatermark(collection, watermark, now);
    }
    return { received, evicted, hasMore: Boolean(body.has_more) };
}
