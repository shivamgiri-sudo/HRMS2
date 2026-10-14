/**
 * Stale-while-revalidate cache for GET /api/finance/grns/summary.
 *
 * The summary is one GROUP BY over every grn_request row (~77k) and measured 11.4 s on production
 * (2026-10-15, twice in a row), and the GRN page re-asks for it after every approve / reject, so an
 * approver waited on it each time. Counts and rupee totals tolerate being a few seconds old; they do
 * not tolerate making the whole page crawl.
 *
 *  - fresh (< FRESH_MS): served from memory.
 *  - stale (< MAX_STALE_MS): served from memory immediately, refreshed once in the background.
 *  - older or missing: computed (concurrent callers share one computation).
 *
 * Any GRN write (POST/PUT/PATCH/DELETE under /grns) calls bustGrnSummaryCache(), which marks entries
 * stale rather than dropping them — the next read still answers at once and refreshes behind it.
 * One backend process (pm2 fork_mode), so in-memory is coherent; a second process would only
 * be at most FRESH_MS..MAX_STALE_MS behind, which is the same tolerance.
 */

const FRESH_MS = 30_000;
const MAX_STALE_MS = 10 * 60_000;
const MAX_ENTRIES = 200;

type Entry<T> = { value: T; at: number; stale: boolean };

const entries = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export function summaryCacheKey(parts: {
  mode: string;
  branchIds?: string[];
  financialYear?: string;
}): string {
  return JSON.stringify([parts.mode, [...(parts.branchIds ?? [])].sort(), parts.financialYear ?? ""]);
}

function compute<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = load()
    .then((value) => {
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
      entries.set(key, { value, at: Date.now(), stale: false });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p;
}

export async function cachedGrnSummary<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key) as Entry<T> | undefined;
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && !hit.stale && age < FRESH_MS) return hit.value;
  if (hit && age < MAX_STALE_MS) {
    // Answer now, refresh behind the response. A failed refresh keeps the stale value for next time.
    void compute(key, load).catch(() => undefined);
    return hit.value;
  }
  return compute(key, load);
}

/** Mark every cached summary stale (called after any GRN write). Never throws. */
export function bustGrnSummaryCache(): void {
  for (const entry of entries.values()) entry.stale = true;
}

/** Test hook. */
export function _resetGrnSummaryCacheForTests(): void {
  entries.clear();
  inFlight.clear();
}
