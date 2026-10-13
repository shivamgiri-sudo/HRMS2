/**
 * Stale-while-revalidate for the heavy Hiring Engine reads. A fresh answer (under `freshMs`) is returned as is; an older complete answer
 * (under `staleMs`) is returned at once while one background refresh runs with a long statement timeout; with nothing stored the read runs
 * normally and, if it fails, the failure is raised and a background build is started so the next call has an answer. One refresh per key.
 */
import { withReadTimeout } from "./he-read-limit.js";

const store = new Map<string, { at: number; value: unknown }>();
const running = new Map<string, Promise<void>>();
const SLOW_STATEMENT_MS = 90_000;

function refresh<T>(key: string, compute: () => Promise<T>): Promise<void> {
  const existing = running.get(key);
  if (existing) return existing;
  const p = withReadTimeout(SLOW_STATEMENT_MS, async () => { store.set(key, { at: Date.now(), value: await compute() }); })
    .catch(() => undefined).finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

export async function swr<T>(key: string, compute: () => Promise<T>, o: { freshMs?: number; staleMs?: number } = {}): Promise<T> {
  const freshMs = o.freshMs ?? 60_000, staleMs = o.staleMs ?? 6 * 3600_000;
  const hit = store.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < freshMs) return hit.value as T;
  if (hit && age < staleMs) { void refresh(key, compute); return hit.value as T; }
  try {
    const value = await compute();
    store.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    if (!process.env.VITEST) void refresh(key, compute);
    throw err;
  }
}

export const clearSwr = (): void => { store.clear(); running.clear(); };

export const dropSwr = (key: string): void => { store.delete(key); };
