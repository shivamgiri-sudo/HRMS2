const inFlight = new Map<string, Promise<Record<string, unknown>>>();

/**
 * Runs `compute` once per key at a time; concurrent callers share its promise. Holds nothing once
 * it settles (a rejection is delivered to every waiter and then forgotten, never cached), so it
 * composes with a TTL cache in front of it without changing what that cache stores.
 */
export function sharedInFlight(
  key: string,
  compute: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const started = compute().finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}
