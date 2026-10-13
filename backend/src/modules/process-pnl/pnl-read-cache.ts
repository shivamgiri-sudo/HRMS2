/**
 * Short-lived result cache + single-flight for the heavy, read-only Process P&L builders
 * (CEO Overview, Live P&L reconciliation, YTD summary, full waterfall) and the period-level reads
 * they share.
 *
 * Same pattern as getLiveRevenueEstimate's liveEstimateCache (pnl-statement.service.ts) and CEO
 * Overview's estimateCache: the PROMISE is stored under the key, so
 *   - a second identical request inside the TTL gets the same result without touching the DB, and
 *   - concurrent identical requests share one in-flight computation (single-flight) instead of
 *     each running the full multi-query build.
 * A rejected promise is evicted at once, so a transient failure is never cached. The TTL is 60s,
 * matching getCachedAllocationSummary and computationCache, so no figure is staler than the P&L
 * already accepts elsewhere.
 *
 * SCOPE SAFETY. The key is built from EVERY input that shapes the result: period, the caller's
 * resolved branch entitlement (branchIds), processIds, cost centres, client/search-derived
 * process lists, flags and the as-of date. Callers pass the already-resolved scope (after
 * resolveFinanceBranchScope etc.), so one user's scope can never be served another's numbers:
 * a different branch list is a different key. Lists are treated as sets (sorted, de-duplicated),
 * because every builder here treats them as sets.
 *
 * Callers must treat a returned value as read-only: it is shared between requests.
 */

const DEFAULT_TTL_MS = 60_000;
/** A month that has ended does not move minute to minute (its invoices, payroll and GRN are in); the running month keeps the short life. */
const CLOSED_PERIOD_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 300;

interface Entry {
  at: number;
  ttlMs: number;
  value: Promise<unknown>;
}

const store = new Map<string, Entry>();

/*
 * Off under the test runner by default: the existing unit tests call each builder many times with
 * different mocked DB rows for the same period, and a shared cache would serve one test's figures
 * to the next. Tests of the cache itself switch it on explicitly.
 */
let enabled = process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";

export function setPnlReadCacheEnabled(on: boolean): void {
  enabled = on;
  if (!on) store.clear();
}

export function clearPnlReadCache(): void {
  store.clear();
}

export function pnlReadCacheSize(): number {
  return store.size;
}

function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    const items = value.map((item) => normalise(item));
    // Sets of ids: order carries no meaning, duplicates none.
    if (items.every((item) => typeof item === "string" || typeof item === "number")) {
      return Array.from(new Set(items.map(String))).sort();
    }
    return items;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = normalise(v);
    }
    return out;
  }
  return value;
}

/** Deterministic cache key for a namespace and the full set of inputs that shape its result. */
export function pnlCacheKey(namespace: string, inputs: Record<string, unknown>): string {
  return `${namespace}:${JSON.stringify(normalise(inputs))}`;
}

/** TTL for a read: the explicit one, else 10 minutes when `inputs.period` is a month before the current IST month, else 60 s. */
export function ttlFor(inputs: Record<string, unknown>, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const period = typeof inputs.period === "string" ? inputs.period : "";
  if (!/^\d{4}-\d{2}$/.test(period)) return DEFAULT_TTL_MS;
  const current = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
  return period < current ? CLOSED_PERIOD_TTL_MS : DEFAULT_TTL_MS;
}

/**
 * Returns the cached result for `namespace` + `inputs`, or runs `compute` once and shares it.
 * Concurrent callers with the same key await the same promise.
 */
export function cachedPnlRead<T>(
  namespace: string,
  inputs: Record<string, unknown>,
  compute: () => Promise<T>,
  ttlMs?: number,
): Promise<T> {
  if (!enabled) return compute();
  const key = pnlCacheKey(namespace, inputs);
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < hit.ttlMs) return hit.value as Promise<T>;

  const value = compute();
  store.delete(key); // re-inserted at the end, so eviction order stays oldest-first
  store.set(key, { at: now, ttlMs: ttlFor(inputs, ttlMs), value });
  value.catch(() => {
    // Evict only our own entry: a newer one may already have replaced it.
    if (store.get(key)?.value === value) store.delete(key);
  });
  // Bounded: drop the oldest entries first (a Map iterates in insertion order).
  for (const k of store.keys()) {
    if (store.size <= MAX_ENTRIES) break;
    store.delete(k);
  }
  return value;
}
