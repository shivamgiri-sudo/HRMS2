/**
 * Small in-process TTL + LRU cache with in-flight de-duplication.
 *
 * - `getOrCompute(key, compute, { ttlMs, bypass })` returns `{ value, hit }`.
 * - Concurrent calls with the same key share ONE compute() (the followers report hit=true).
 * - `bypass: true` skips the read and in-flight sharing, runs compute() and repopulates the entry.
 * - A rejected compute() is never cached and never poisons followers' future calls.
 * - Insertion-ordered Map gives LRU eviction (max entries, default 200).
 * - Optional stale-while-revalidate (`staleMs`, default 0 = off): once an entry's TTL has passed, getOrCompute
 *   keeps answering with the old value for up to `staleMs` more while ONE background compute() refreshes it.
 *   A failed refresh keeps serving the stale value (and retries on the next call); it never throws to a caller.
 */
export interface TtlCacheOptions {
  maxEntries?: number;
  defaultTtlMs?: number;
  /** Extra time after the TTL during which the expired value is still served while it refreshes. */
  defaultStaleMs?: number;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
  staleUntil: number;
}

export interface GetOrComputeOptions {
  ttlMs?: number;
  staleMs?: number;
  bypass?: boolean;
}

export class TtlCache<V = unknown> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inFlight = new Map<string, Promise<V>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly defaultStaleMs: number;
  private readonly now: () => number;

  constructor(opts: TtlCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 200;
    this.defaultTtlMs = opts.defaultTtlMs ?? 180_000;
    this.defaultStaleMs = opts.defaultStaleMs ?? 0;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      if (entry.staleUntil <= this.now()) this.entries.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number = this.defaultTtlMs, staleMs: number = this.defaultStaleMs): void {
    this.entries.delete(key);
    const expiresAt = this.now() + ttlMs;
    this.entries.set(key, { value, expiresAt, staleUntil: expiresAt + staleMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  async getOrCompute(
    key: string,
    compute: () => Promise<V>,
    opts: GetOrComputeOptions = {},
  ): Promise<{ value: V; hit: boolean }> {
    const ttlMs = opts.ttlMs ?? this.defaultTtlMs;
    const staleMs = opts.staleMs ?? this.defaultStaleMs;
    if (!opts.bypass) {
      const cached = this.get(key);
      if (cached !== undefined) return { value: cached, hit: true };
      const pending = this.inFlight.get(key);
      const stale = this.entries.get(key);
      if (stale && stale.staleUntil > this.now()) {
        // Expired but inside the stale window: answer now, refresh once in the background.
        if (!pending) {
          const refresh = compute();
          this.inFlight.set(key, refresh);
          refresh
            .then((value) => this.set(key, value, ttlMs, staleMs))
            .catch(() => undefined)
            .finally(() => { if (this.inFlight.get(key) === refresh) this.inFlight.delete(key); });
        }
        return { value: stale.value, hit: true };
      }
      if (pending) return { value: await pending, hit: true };
    }
    const promise = compute();
    if (!opts.bypass) this.inFlight.set(key, promise);
    try {
      const value = await promise;
      this.set(key, value, ttlMs, staleMs);
      return { value, hit: false };
    } finally {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    }
  }
}
