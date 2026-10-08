import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request memoisation store.
 *
 * Authorization lookups (hasRole, getEmployeeForUser) are called several times
 * while serving a single request — the attendance endpoints alone hit them
 * three or four times before touching any attendance data, and each call ran its
 * own query. Caching them for the life of ONE request removes the duplicates.
 *
 * Deliberately request-scoped rather than a TTL cache: role and employee records
 * are authorization data, and a time-based cache would keep serving a revoked
 * role for the length of the TTL. This store is created when the request starts
 * and discarded when it ends, so a permission change takes effect on the very
 * next request.
 *
 * Outside a request (workers, scripts, tests) there is no store and callers fall
 * through to a direct query — behaviour is unchanged.
 */
const storage = new AsyncLocalStorage<Map<string, unknown>>();

/** Run `fn` with a fresh memoisation store bound to the current async context. */
export function runWithRequestContext<T>(fn: () => T): T {
  return storage.run(new Map<string, unknown>(), fn);
}

/**
 * Memoise `compute` under `key` for the current request.
 * With no active request context this simply calls `compute`.
 */
export async function memoizeForRequest<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return compute();

  if (store.has(key)) return store.get(key) as T;

  // Store the in-flight promise so concurrent callers share one query rather
  // than each starting their own before the first resolves.
  const pending = compute();
  store.set(key, pending);
  try {
    const value = await pending;
    store.set(key, Promise.resolve(value));
    return value;
  } catch (err) {
    // Never cache a failure — the next caller should retry.
    store.delete(key);
    throw err;
  }
}

/** True when running inside a request context. Exposed for tests. */
export function hasRequestContext(): boolean {
  return storage.getStore() !== undefined;
}
