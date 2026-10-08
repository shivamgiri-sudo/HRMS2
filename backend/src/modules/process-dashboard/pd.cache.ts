/** Process Dashboard -- small in-memory TTL cache, bounded, invalidated per process on config change. */
interface Entry { at: number; value: unknown }
export class TtlCache {
  private m = new Map<string, Entry>();
  constructor(private ttlMs: number, private max: number) {}
  get<T>(key: string): T | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) { this.m.delete(key); return undefined; }
    this.m.delete(key); this.m.set(key, e); // refresh recency
    return e.value as T;
  }
  set<T>(key: string, value: T): T {
    this.m.delete(key); this.m.set(key, { at: Date.now(), value });
    while (this.m.size > this.max) { const oldest = this.m.keys().next().value as string; this.m.delete(oldest); }
    return value;
  }
  /** Deduplicates concurrent loads for the same key. */
  private inflight = new Map<string, Promise<unknown>>();
  async wrap<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key); if (hit !== undefined) return hit;
    const pending = this.inflight.get(key); if (pending) return pending as Promise<T>;
    const p = load().then((v) => this.set(key, v)).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
  invalidate(prefix: string): void { for (const k of [...this.m.keys()]) if (k.startsWith(prefix)) this.m.delete(k); }
  clear(): void { this.m.clear(); }
  get size(): number { return this.m.size; }
}
/** Keys are `${processId}|...`; datasets are the heavy entries so the cap is small. */
export const datasetCache = new TtlCache(20_000, 12);
export const smallCache = new TtlCache(15_000, 300);
export const invalidateProcess = (processId: string): void => { datasetCache.invalidate(`${processId}|`); smallCache.invalidate(`${processId}|`); };
