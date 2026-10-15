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

  set(key: string, value: T): void {
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { at: Date.now(), value });
  }

  clear(): void { this.store.clear(); }
}

/** Return the cached value or compute it. A throw is never cached; `cacheable` can veto caching a result. */
export async function cachedOr<T>(cache: TtlCache<T>, key: string, fn: () => Promise<T>, cacheable: (v: T) => boolean = () => true): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = await fn();
  if (cacheable(v)) cache.set(key, v);
  return v;
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
