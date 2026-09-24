import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LOB_UUID, callHandler, getHandler, norm, expectParamPosition, type Captured } from './lobTestUtils';

const { calls, mockExecute } = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const mockExecute = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return [[], []];
  });
  return { calls, mockExecute };
});
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mockExecute, query: mockExecute } }));
vi.mock('../../../middleware/authMiddleware.js', () => ({ requireAuth: (_q: any, _s: any, n: any) => n() }));
vi.mock('../../../middleware/requireRole.js', () => ({ requireRole: () => (_q: any, _s: any, n: any) => n() }));

import { rosterAnalyticsRouter } from '../roster-analytics.routes';

type Case = { name: string; path: string; query?: Record<string, string>; params?: Record<string, string> };
const CASES: Case[] = [
  { name: 'shrinkage-intelligence', path: '/shrinkage-intelligence/:branchId', params: { branchId: 'b1' }, query: { weekStart: '2026-09-14' } },
  { name: 'quality-correlation', path: '/quality-correlation', query: { period: '2026-08', branchId: 'b1', processId: 'p1' } },
  { name: 'cost-impact', path: '/cost-impact', query: { period: '2026-08', branchId: 'b1', processId: 'p1' } },
  { name: 'forecast', path: '/forecast/:branchId', params: { branchId: 'b1' } },
  { name: 'shift-effectiveness', path: '/shift-effectiveness', query: { branchId: 'b1', processId: 'p1' } },
  { name: 'shift-recommendations', path: '/shift-recommendations', query: { branchId: 'b1', processId: 'p1' } },
  { name: 'break-compliance', path: '/break-compliance', query: { branchId: 'b1', processId: 'p1' } },
  { name: 'team-comparison', path: '/team-comparison', query: { branchId: 'b1' } },
  { name: 'team-status-mobile', path: '/team-status-mobile' },
];

async function run(c: Case, lobId?: string) {
  calls.length = 0;
  const h = getHandler(rosterAnalyticsRouter, 'get', c.path);
  const query = { ...(c.query ?? {}), ...(lobId !== undefined ? { lobId } : {}) };
  const out = await callHandler(h, { query, params: c.params });
  return { out, calls: calls.map((x) => ({ sql: x.sql, params: x.params }) as Captured) };
}

beforeEach(() => mockExecute.mockClear());

describe.each(CASES)('roster-analytics $name lobId', (c) => {
  it('without lobId there is no lob fragment', async () => {
    const r = await run(c);
    expect(r.calls.length).toBeGreaterThan(0);
    for (const x of r.calls) {
      expect(x.sql).not.toContain('lob_id');
      expect((x.sql.match(/\?/g) ?? []).length).toBe(x.params.length);
    }
  });
  it('with a uuid filters on e.lob_id = ? at the right param position', async () => {
    const r = await run(c, LOB_UUID);
    const hit = r.calls.filter((x) => x.sql.includes('e.lob_id = ?'));
    expect(hit.length).toBeGreaterThan(0);
    for (const x of hit) {
      expect(x.params).toContain(LOB_UUID);
      expectParamPosition(x, 'e.lob_id = ?', LOB_UUID);
      expect((x.sql.match(/\?/g) ?? []).length).toBe(x.params.length);
    }
  });
  it('with __none__ filters e.lob_id IS NULL and adds no param', async () => {
    const plain = await run(c);
    const r = await run(c, '__none__');
    const hit = r.calls.filter((x) => x.sql.includes('e.lob_id IS NULL'));
    expect(hit.length).toBeGreaterThan(0);
    expect(r.calls.map((x) => x.params.length)).toEqual(plain.calls.map((x) => x.params.length));
  });
  it('rejects an invalid lobId with 400 before touching the db', async () => {
    const r = await run(c, 'not-a-uuid');
    expect(r.out.status).toBe(400);
    expect(String(r.out.body?.error)).toContain('lobId');
    expect(r.calls).toHaveLength(0);
  });
  it('never uses COLLATE or joins lob_master', async () => {
    const r = await run(c, LOB_UUID);
    for (const x of r.calls) expect(norm(x.sql)).not.toMatch(/COLLATE|lob_master/i);
  });
});
