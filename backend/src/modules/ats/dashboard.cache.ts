/**
 * Small stale-while-revalidate cache for dashboard aggregates.
 * fresh → return; stale → return immediately and refresh in background; cold → await.
 * Concurrent callers for the same key share one in-flight computation.
 */
export function createSwrCache<T>(
  opts: { freshMs?: number; staleMs?: number } = {},
) {
  const freshMs = opts.freshMs ?? 60_000;
  const staleMs = opts.staleMs ?? 15 * 60_000;
  const store = new Map<string, { at: number; data: T }>();
  const inflight = new Map<string, Promise<T>>();

  const refresh = (key: string, compute: () => Promise<T>) => {
    let p = inflight.get(key);
    if (!p) {
      p = compute()
        .then((data) => {
          store.set(key, { at: Date.now(), data });
          return data;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  };

  return {
    refresh,
    async get(key: string, compute: () => Promise<T>): Promise<T> {
      const hit = store.get(key);
      const age = hit ? Date.now() - hit.at : Infinity;
      if (hit && age < freshMs) return hit.data;
      if (hit && age < staleMs) {
        void refresh(key, compute).catch((e) =>
          console.error(
            `[dashboard-cache] refresh ${key} failed:`,
            (e as Error).message,
          ),
        );
        return hit.data;
      }
      return refresh(key, compute);
    },
  };
}
