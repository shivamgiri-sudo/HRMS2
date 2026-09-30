import { sharedInFlight } from "../dashboards/metrics-in-flight.js";

/**
 * The readiness summaries recompute ~540 metric queries per call (every branch x process) and write
 * the results back, taking 50-70 s on production. The browser aborts at 30 s but the server keeps
 * working, so each retry started ANOTHER full recomputation on top of the first. The three summary
 * methods take only (month[, branchId]) - no user or scope input - so every caller gets identical
 * data and one computation can safely serve them all. Concurrent calls now share one computation
 * and a finished result is reused for 30 s. Failures are never cached; callers get a private copy.
 */
export const READINESS_SUMMARY_TTL_MS = 30_000;
const READINESS_SUMMARY_CACHE_MAX = 60;
const readinessSummaryCache = new Map<string, { at: number; value: unknown }>();

/** Called by the readiness routers around any state-changing request so a user never sees their own action reverted. */
export function invalidateReadinessSummaryCache(): void {
  readinessSummaryCache.clear();
}

export async function cachedReadinessSummary<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = readinessSummaryCache.get(key);
  if (hit && Date.now() - hit.at < READINESS_SUMMARY_TTL_MS) return structuredClone(hit.value) as T;
  const value = await sharedInFlight(key, async () => {
    const v = await compute();
    readinessSummaryCache.set(key, { at: Date.now(), value: v });
    if (readinessSummaryCache.size > READINESS_SUMMARY_CACHE_MAX) {
      const oldest = [...readinessSummaryCache.entries()].sort((a, b) => a[1].at - b[1].at);
      for (const [k] of oldest.slice(0, readinessSummaryCache.size - READINESS_SUMMARY_CACHE_MAX)) readinessSummaryCache.delete(k);
    }
    return v as unknown as Record<string, unknown>;
  });
  return structuredClone(value) as unknown as T;
}

