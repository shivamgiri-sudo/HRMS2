import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { TtlCache } from '../ttlCache.js';
import { buildAnalyticsCacheKey, createAnalyticsCache, normalizeQuery } from '../analyticsCache.js';

function makeReq(userId: string, roles: string[], query: Record<string, unknown> = {}) {
  return { authUser: { id: userId, roles }, userRoles: roles, query } as unknown as Request;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: (k: string, v: string) => { headers[k] = v; },
    once: vi.fn(),
    json(b: unknown) { this.body = b; return this; },
  };
  return { res: res as unknown as Response & { body: unknown }, headers };
}

/** Run the middleware then a handler that returns `payload` (counts invocations). */
function run(mw: ReturnType<ReturnType<typeof createAnalyticsCache>>, req: Request, handler: (res: Response) => void) {
  const { res, headers } = makeRes();
  const next: NextFunction = () => handler(res);
  mw(req, res, next);
  return { res, headers };
}

describe('TtlCache', () => {
  it('expires entries after ttl and evicts least recently used beyond max', () => {
    let t = 0;
    const c = new TtlCache<number>({ maxEntries: 2, defaultTtlMs: 100, now: () => t });
    c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    t = 101;
    expect(c.get('a')).toBeUndefined();
  });

  it('shares one compute between concurrent identical calls and honours bypass', async () => {
    const c = new TtlCache<number>();
    let calls = 0;
    const compute = async () => { calls += 1; await Promise.resolve(); return calls; };
    const [x, y] = await Promise.all([c.getOrCompute('k', compute), c.getOrCompute('k', compute)]);
    expect(calls).toBe(1);
    expect([x.hit, y.hit].sort()).toEqual([false, true]);
    const fresh = await c.getOrCompute('k', compute, { bypass: true });
    expect(fresh).toEqual({ value: 2, hit: false });
    expect((await c.getOrCompute('k', compute)).value).toBe(2);
  });

  it('does not cache a rejected compute', async () => {
    const c = new TtlCache<number>();
    await expect(c.getOrCompute('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await c.getOrCompute('k', async () => 7)).value).toBe(7);
  });
});

describe('analyticsCache middleware', () => {
  it('isolates cache entries between users and role sets', () => {
    const cache = new TtlCache<{ body: unknown }>();
    const mw = createAnalyticsCache(cache)('ep');
    const handler = vi.fn((res: Response) => { res.json({ owner: 'computed' }); });

    const a1 = run(mw, makeReq('user-a', ['wfm'], { branchId: 'b1' }), handler);
    expect(a1.headers['X-Cache']).toBe('MISS');
    const a2 = run(mw, makeReq('user-a', ['wfm'], { branchId: 'b1' }), handler);
    expect(a2.headers['X-Cache']).toBe('HIT');
    const b1 = run(mw, makeReq('user-b', ['wfm'], { branchId: 'b1' }), handler);
    expect(b1.headers['X-Cache']).toBe('MISS');
    const a3 = run(mw, makeReq('user-a', ['hr'], { branchId: 'b1' }), handler);
    expect(a3.headers['X-Cache']).toBe('MISS');
    expect(handler).toHaveBeenCalledTimes(3);
    expect(buildAnalyticsCacheKey('ep', makeReq('user-a', ['wfm']))).not.toBe(
      buildAnalyticsCacheKey('ep', makeReq('user-b', ['wfm'])),
    );
  });

  it('keys on the normalized query (order-insensitive) but not on refresh', () => {
    expect(normalizeQuery({ b: '2', a: '1', refresh: '1' })).toBe('a=1&b=2');
    const cache = new TtlCache<{ body: unknown }>();
    const mw = createAnalyticsCache(cache)('ep');
    const handler = vi.fn((res: Response) => { res.json({ n: 1 }); });
    run(mw, makeReq('u', ['wfm'], { a: '1', b: '2' }), handler);
    expect(run(mw, makeReq('u', ['wfm'], { b: '2', a: '1' }), handler).headers['X-Cache']).toBe('HIT');
    expect(run(mw, makeReq('u', ['wfm'], { a: '1', b: '3' }), handler).headers['X-Cache']).toBe('MISS');
  });

  it('refresh=1 bypasses the cache and repopulates it', () => {
    const cache = new TtlCache<{ body: unknown }>();
    const mw = createAnalyticsCache(cache)('ep');
    let n = 0;
    const handler = (res: Response) => { n += 1; res.json({ n }); };
    run(mw, makeReq('u', ['wfm']), handler);
    const refreshed = run(mw, makeReq('u', ['wfm'], { refresh: '1' }), handler);
    expect(refreshed.headers['X-Cache']).toBe('MISS');
    expect(refreshed.res.body).toEqual({ n: 2 });
    const after = run(mw, makeReq('u', ['wfm']), handler);
    expect(after.headers['X-Cache']).toBe('HIT');
    expect(after.res.body).toEqual({ n: 2 });
  });

  it('does not cache non-200 responses', () => {
    const cache = new TtlCache<{ body: unknown }>();
    const mw = createAnalyticsCache(cache)('ep');
    const failing = (res: Response) => { (res as { statusCode: number }).statusCode = 500; res.json({ error: 'x' }); };
    run(mw, makeReq('u', ['wfm']), failing);
    expect(run(mw, makeReq('u', ['wfm']), (res) => res.json({ ok: true })).headers['X-Cache']).toBe('MISS');
  });
});
