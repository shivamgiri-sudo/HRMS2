// Short-lived cache for the (unscoped) Ops Control Tower summary.
//
// The summary runs 15 branch-wise queries and measured 12-40 s on production under normal load; every
// open page re-polls it every 2 minutes and every user triggered their own run. Branch scoping is applied
// AFTER this (scopeSummaryToBranches), so what is cached is org-wide data that is the same for every caller.
//
//   fresh   (< TTL)         served as is
//   stale   (< STALE)       served immediately, refreshed once in the background
//   missing / too old       computed once; concurrent callers share that single computation
//
// Failures are never cached, so a bad moment does not stick. The summary carries its own `nowMs`, so the
// page's "As of" label always tells the truth about how old the numbers are.
export const SUMMARY_TTL_MS = 60_000;
// Served-while-refreshing window. The summary takes 12-40 s to compute, so a long stale window keeps the page
// instant even after quiet periods; the page's "As of" label shows the true age of what it is looking at.
export const SUMMARY_STALE_MS = 60 * 60_000;
const MAX_ENTRIES = 8;

interface Entry<T> { at: number; value?: T; inflight?: Promise<T> }
const cache = new Map<string, Entry<unknown>>();

export function clearSummaryCache(): void { cache.clear(); }

export async function cachedSummary<T>(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const entry = cache.get(key) as Entry<T> | undefined;

  const start = (): Promise<T> => {
    const p = load().then(
      (value) => { cache.set(key, { at: Date.now(), value }); return value; },
      (err) => {
        const cur = cache.get(key) as Entry<T> | undefined;
        if (cur) { delete cur.inflight; if (cur.value === undefined) cache.delete(key); }
        throw err;
      },
    );
    const cur = (cache.get(key) as Entry<T> | undefined) ?? { at: 0 };
    cur.inflight = p;
    cache.set(key, cur);
    return p;
  };

  if (entry?.value !== undefined) {
    const age = now - entry.at;
    if (age < SUMMARY_TTL_MS) return entry.value;
    if (age < SUMMARY_STALE_MS) {
      if (!entry.inflight) void start().catch(() => undefined); // background refresh; the stale value is served now
      return entry.value;
    }
  }
  if (entry?.inflight) return entry.inflight;

  // evict the oldest entries so a client cycling through dates cannot grow this without bound
  if (cache.size >= MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return start();
}

/**
 * Recompute a key now (used by the background warmer) so the next caller gets a fresh value instantly.
 * Shares an in-flight computation instead of starting a second one.
 */
export async function refreshSummary<T>(key: string, load: () => Promise<T>): Promise<void> {
  const entry = cache.get(key) as Entry<T> | undefined;
  if (entry?.inflight) { await entry.inflight.catch(() => undefined); return; }
  if (entry?.value !== undefined && Date.now() - entry.at < SUMMARY_TTL_MS / 2) return;
  // Evaluate "now" just past the TTL so a cached value is served stale (callers are never blocked) while the
  // single background computation starts; with no cached value this computes and awaits it.
  await cachedSummary(key, load, (entry?.at ?? 0) + SUMMARY_TTL_MS + 1).catch(() => undefined);
  const running = (cache.get(key) as Entry<T> | undefined)?.inflight;
  if (running) await running.catch(() => undefined);
}
