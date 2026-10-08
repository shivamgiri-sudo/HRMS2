/**
 * Tiny TTL memo with in-flight coalescing. Operations Command reads a handful of large, slowly
 * changing fact sets (attendance rows, exits, roster aggregates) that many endpoints share; loading each once per
 * window turns a page load from dozens of table scans into a few.
 *
 * Cached facts are ORG-WIDE and never returned directly: every consumer filters them through the caller's
 * scoped employee view (ops-command.dim.ts), so a cache hit cannot widen anyone's scope.
 */
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 60;
/** Past the TTL a value is still served (and refreshed in the background) for this long, so users rarely wait on a cold scan. */
const STALE_MS = 30 * 60 * 1000;

interface Entry {
  at: number;
  value?: unknown;
  pending?: Promise<unknown>;
}

const store = new Map<string, Entry>();

export async function memo<T>(key: string, fn: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
  const hit = store.get(key);
  if (hit) {
    if (hit.pending) return (hit.value !== undefined ? Promise.resolve(hit.value as T) : (hit.pending as Promise<T>));
    const age = Date.now() - hit.at;
    if (age < ttlMs) return hit.value as T;
    if (age < STALE_MS) {
      // stale-while-revalidate: answer now, refresh behind the scenes.
      const stale = hit.value as T;
      const pending = fn().then(
        (value) => { store.set(key, { at: Date.now(), value }); return value; },
        () => { store.set(key, hit); return stale; },
      );
      store.set(key, { at: hit.at, value: stale, pending });
      return stale;
    }
  }
  const pending = fn().then(
    (value) => {
      store.set(key, { at: Date.now(), value });
      if (store.size > MAX_ENTRIES) {
        const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) store.delete(oldest[0]);
      }
      return value;
    },
    (err) => {
      store.delete(key);
      throw err;
    },
  );
  store.set(key, { at: Date.now(), pending });
  return pending;
}

export function clearOpsCache(): void {
  store.clear();
}
