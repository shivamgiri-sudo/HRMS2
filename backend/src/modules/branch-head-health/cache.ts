/** Shown when a slow section hit its timeout; the load keeps running and fills the cache. */
export const STILL_CALCULATING = "Still calculating - first load of a month can take up to a minute. Refresh shortly.";

/** Small in-process TTL cache with FIFO eviction. Branch-level data is identical for every authorised head. */
export class TtlCache<T> {
  private store = new Map<string, { at: number; value: T }>();
  constructor(private ttlMs = 60_000, private maxEntries = 64) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at >= this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  /** Age of a live entry in ms (undefined when absent or expired). Does not change `get` behaviour. */
  ageMs(key: string): number | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    const age = Date.now() - e.at;
    return age >= this.ttlMs ? undefined : age;
  }

  set(key: string, value: T): void {
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { at: Date.now(), value });
  }

  clear(): void { this.store.clear(); }
}

const inflightByCache = new WeakMap<TtlCache<any>, Map<string, Promise<any>>>();
function inflightOf<T>(cache: TtlCache<T>): Map<string, Promise<T>> {
  let m = inflightByCache.get(cache);
  if (!m) { m = new Map(); inflightByCache.set(cache, m); }
  return m;
}

/**
 * Return the cached value or compute it. A throw is never cached; `cacheable` can veto caching a result.
 * Concurrent callers for one key share a single loader run. The value is stored when the loader settles,
 * even if a caller stopped waiting (see `cachedOrWithin`), so a late result still fills the cache.
 */
export async function cachedOr<T>(
  cache: TtlCache<T>, key: string, fn: () => Promise<T>, cacheable: (v: T) => boolean = () => true,
  opts: { refreshIfOlderThanMs?: number } = {},
): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) {
    const stale = opts.refreshIfOlderThanMs !== undefined && (cache.ageMs(key) ?? 0) > opts.refreshIfOlderThanMs;
    if (!stale) return hit;
  }
  const inflight = inflightOf(cache);
  const running = inflight.get(key);
  if (running) return running;
  // Registered before the loader runs (even a synchronous throw), removed only by the run that owns it.
  const p: Promise<T> = Promise.resolve().then(fn).then((v) => {
    if (cacheable(v)) cache.set(key, v);
    return v;
  }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

/** Like `cachedOr`, but the caller gets `fallback()` after `ms`; the loader keeps running and late-fills the cache. */
export function cachedOrWithin<T>(
  cache: TtlCache<T>, key: string, fn: () => Promise<T>, cacheable: (v: T) => boolean,
  ms: number, fallback: () => T, opts: { refreshIfOlderThanMs?: number } = {},
): Promise<T> {
  const p = cachedOr(cache, key, fn, cacheable, opts);
  p.catch(() => undefined); // a rejection after the caller gave up must not be unhandled
  return withTimeout(p, ms, fallback);
}

/** Resolve with `fallback()` when `p` does not settle within `ms`; the timer is always cleared. */
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
