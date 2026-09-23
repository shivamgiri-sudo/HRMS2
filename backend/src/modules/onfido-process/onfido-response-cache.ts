import type { NextFunction, Request, Response } from "express";

/**
 * Short-lived response cache for the Onfido dashboard's GET endpoints.
 *
 * Why: the dashboard's source tables are batch uploads (onfido_doc_raw alone is ~2.6 GB / 745k rows),
 * so one page fires 15-25 aggregate queries that each take 3-8 s, and the same numbers are
 * recomputed on every tab switch and every page load. The data only changes when someone uploads a
 * file through the Bulk Upload Hub, so identical requests inside a short window can share one answer.
 *
 * - Keyed by the full URL (path + query); callers are already authenticated and Onfido-scoped by the
 *   router-level middleware before this runs, and no response here varies per user.
 * - Concurrent identical requests share one in-flight computation (no thundering herd).
 * - Only successful (2xx) JSON responses are stored; errors are never cached.
 * - Cleared after every Onfido bulk import (clearOnfidoResponseCache) so fresh uploads show at once.
 * - /live/* is excluded: it is a today-so-far view that is polled every minute.
 */

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 400;

interface CacheEntry { body: unknown; expiresAt: number }

const store = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

export function clearOnfidoResponseCache(): void {
  store.clear();
  inFlight.clear();
}

function isCacheable(req: Request): boolean {
  // /wfm-inputs is hand-entered and can differ per viewer (can-edit), so it is never shared.
  return req.method === "GET" && !req.path.startsWith("/live/") && !req.path.startsWith("/live") && !req.path.startsWith("/wfm-inputs");
}

function remember(key: string, body: unknown): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { body, expiresAt: Date.now() + TTL_MS });
}

export function onfidoResponseCache(req: Request, res: Response, next: NextFunction): void {
  if (!isCacheable(req)) { next(); return; }
  const key = req.originalUrl;

  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    res.setHeader("X-Onfido-Cache", "hit");
    res.json(hit.body);
    return;
  }
  if (hit) store.delete(key);

  const waiting = inFlight.get(key);
  if (waiting) {
    waiting.then((body) => { res.setHeader("X-Onfido-Cache", "shared"); res.json(body); }, () => next());
    return;
  }

  let settle: (body: unknown) => void = () => undefined;
  let fail: () => void = () => undefined;
  const mine = new Promise<unknown>((resolve, reject) => { settle = resolve; fail = () => reject(new Error("uncached")); });
  // A rejected in-flight promise with no waiter must not surface as an unhandled rejection.
  mine.catch(() => undefined);
  inFlight.set(key, mine);

  const originalJson = res.json.bind(res);
  res.json = (body: unknown): Response => {
    if (inFlight.get(key) === mine) inFlight.delete(key);
    if (res.statusCode >= 200 && res.statusCode < 300) { remember(key, body); settle(body); } else { fail(); }
    return originalJson(body);
  };
  res.on("close", () => {
    // Request aborted or errored before res.json ran: release waiters so they recompute themselves.
    if (inFlight.get(key) === mine) { inFlight.delete(key); fail(); }
  });
  next();
}
