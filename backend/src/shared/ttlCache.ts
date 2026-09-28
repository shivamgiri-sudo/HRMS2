/**
 * Small in-process TTL + LRU cache with in-flight de-duplication.
 *
 * - `getOrCompute(key, compute, { ttlMs, bypass })` returns `{ value, hit }`.
 * - Concurrent calls with the same key share ONE compute() (the followers report hit=true).
 * - `bypass: true` skips the read and in-flight sharing, runs compute() and repopulates the entry.
 * - A rejected compute() is never cached and never poisons followers' future calls.
 * - Insertion-ordered Map gives LRU eviction (max entries, default 200).
 */
export interface TtlCacheOptions {
  maxEntries?: number;
  defaultTtlMs?: number;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface GetOrComputeOptions {
  ttlMs?: number;
  bypass?: boolean;
}

export class TtlCache<V = unknown> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inFlight = new Map<string, Promise<V>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  constructor(opts: TtlCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 200;
    this.defaultTtlMs = opts.defaultTtlMs ?? 180_000;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number = this.defaultTtlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
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
    if (!opts.bypass) {
      const cached = this.get(key);
      if (cached !== undefined) return { value: cached, hit: true };
      const pending = this.inFlight.get(key);
      if (pending) return { value: await pending, hit: true };
    }
    const promise = compute();
    if (!opts.bypass) this.inFlight.set(key, promise);
    try {
      const value = await promise;
      this.set(key, value, ttlMs);
      return { value, hit: false };
    } finally {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    }
  }
}
