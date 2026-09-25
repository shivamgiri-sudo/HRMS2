/**
 * Express wrapper that caches a read-only analytics endpoint's successful JSON body.
 *
 * Key = endpoint name + caller user id + sorted role set + normalized query string (all params
 * except `refresh`, keys sorted), so one user's RBAC-scoped result can never be served to another.
 * `?refresh=1` bypasses the read and repopulates. Response header `X-Cache: HIT|MISS`.
 * Only HTTP 200 bodies are cached; errors pass through untouched and are never stored.
 * Place AFTER requireRole so unauthorised callers never reach the cache.
 */
import type { NextFunction, Request, Response } from 'express';
import { TtlCache } from './ttlCache.js';

export const ANALYTICS_CACHE_TTL_MS = 180_000;
export const ANALYTICS_CACHE_MAX_ENTRIES = 200;

interface CachedBody {
  body: unknown;
}

const sharedCache = new TtlCache<CachedBody>({
  maxEntries: ANALYTICS_CACHE_MAX_ENTRIES,
  defaultTtlMs: ANALYTICS_CACHE_TTL_MS,
});

type CallerRequest = Request & {
  authUser?: { id?: string; role?: string; roles?: string[] };
  userRoles?: string[];
};

export function isRefreshRequested(query: Request['query']): boolean {
  const raw = query.refresh;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === '1' || v === 'true';
}

export function normalizeQuery(query: Request['query']): string {
  return Object.keys(query)
    .filter((k) => k !== 'refresh')
    .sort()
    .map((k) => {
      const v = query[k];
      const vals = (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
      return `${k}=${vals.join(',')}`;
    })
    .join('&');
}

export function buildAnalyticsCacheKey(name: string, req: CallerRequest): string {
  const user = req.authUser?.id ?? 'anonymous';
  const roles = [...new Set([...(req.userRoles ?? []), ...(req.authUser?.roles ?? []), ...(req.authUser?.role ? [req.authUser.role] : [])])]
    .sort()
    .join(',');
  return `${name}|u:${user}|r:${roles}|q:${normalizeQuery(req.query)}`;
}

/** Test seam: lets a test use an isolated cache instance. */
export function createAnalyticsCache(cache: TtlCache<CachedBody> = sharedCache, ttlMs = ANALYTICS_CACHE_TTL_MS) {
  // In-flight de-duplication: concurrent identical requests share the first one's query.
  const inFlight = new Map<string, Promise<CachedBody | undefined>>();

  return function analyticsCache(name: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const key = buildAnalyticsCacheKey(name, req as CallerRequest);
      const bypass = isRefreshRequested(req.query);
      const hit = bypass ? undefined : cache.get(key);
      if (hit !== undefined) {
        res.setHeader('X-Cache', 'HIT');
        res.json(hit.body);
        return;
      }

      const pending = bypass ? undefined : inFlight.get(key);
      if (pending) {
        void pending.then((shared) => {
          if (shared !== undefined) {
            res.setHeader('X-Cache', 'HIT');
            res.json(shared.body);
          } else {
            // Leader failed / non-200: run our own handler rather than propagate its error.
            res.setHeader('X-Cache', 'MISS');
            next();
          }
        });
        return;
      }

      res.setHeader('X-Cache', 'MISS');
      let settle: (v: CachedBody | undefined) => void = () => undefined;
      const leader = new Promise<CachedBody | undefined>((resolve) => { settle = resolve; });
      inFlight.set(key, leader);
      const finish = (v: CachedBody | undefined) => {
        if (inFlight.get(key) === leader) inFlight.delete(key);
        settle(v);
      };
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (res.statusCode === 200) {
          const entry = { body };
          cache.set(key, entry, ttlMs);
          finish(entry);
        } else {
          finish(undefined);
        }
        return originalJson(body);
      }) as Response['json'];
      res.once('close', () => finish(undefined));
      next();
    };
  };
}

export const analyticsCache = createAnalyticsCache();
