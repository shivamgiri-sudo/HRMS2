/**
 * Result cache for live-dashboard queries that read the dialler database.
 *
 * Why it exists: cdr_ob_25 has no campaign index (and it is an upstream,
 * read-only system), so a 15-day Reginald Cart aggregate costs a 25–35 s scan.
 * Unshared, every browser refresh re-ran those scans on a five-connection pool;
 * a couple of refreshes filled the pool and the page stopped responding.
 *
 * Two protections:
 *  - results are cached — six hours for a range wholly in the past (dialler
 *    logs for a closed day never change), five minutes when it includes today;
 *  - concurrent callers for the same key share one in-flight query instead of
 *    each starting their own.
 *
 * Only for dialler-backed endpoints. Upload-driven tables (GS1, billing) must
 * not use it: a cached empty result would hide data just uploaded.
 */
import { cacheInstance, type CacheValue } from '../../lib/cache/quality-cache.js';

const PAST_TTL_SECONDS = 6 * 60 * 60;
const LIVE_TTL_SECONDS = 5 * 60;

const inFlight = new Map<string, Promise<unknown>>();

/** Today as YYYY-MM-DD in IST — the dialler's own calendar. */
function todayIst(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function cachedLive<T>(
  name: string, range: { from: string; to: string }, fetcher: () => Promise<T>,
): Promise<T> {
  const key = `process-live:${name}:${range.from}:${range.to}`;
  const hit = await cacheInstance.get<CacheValue>(key);
  if (hit) return hit as unknown as T;

  const running = inFlight.get(key);
  if (running) return running as Promise<T>;

  const job = (async () => {
    try {
      const value = await fetcher();
      await cacheInstance.set(key, value as unknown as CacheValue, range.to < todayIst() ? PAST_TTL_SECONDS : LIVE_TTL_SECONDS);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}
