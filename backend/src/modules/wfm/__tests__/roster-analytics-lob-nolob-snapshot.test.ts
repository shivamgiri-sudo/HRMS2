/**
 * Baseline guard: unfiltered calls (no lobId) must produce the same whitespace-normalised SQL and
 * params as before the LOB change. The .snap file was generated on origin/main (no LOB support),
 * so this test only uses legacy call shapes and passes on both trees.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { callHandler, getHandler, norm } from './lobTestUtils';

const { calls, mockExecute } = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const mockExecute = vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return [[], []]; });
  return { calls, mockExecute };
});
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mockExecute, query: mockExecute } }));
vi.mock('../../../middleware/authMiddleware.js', () => ({ requireAuth: (_q: any, _s: any, n: any) => n() }));
vi.mock('../../../middleware/requireRole.js', () => ({ requireRole: () => (_q: any, _s: any, n: any) => n() }));

import { rosterAnalyticsRouter } from '../roster-analytics.routes';

const CASES: Array<[string, string, Record<string, string>, Record<string, string>]> = [
  ['shrinkage', '/shrinkage-intelligence/:branchId', { weekStart: '2026-09-14' }, { branchId: 'b1' }],
  ['quality', '/quality-correlation', { period: '2026-08', branchId: 'b1', processId: 'p1' }, {}],
  ['cost', '/cost-impact', { period: '2026-08', branchId: 'b1', processId: 'p1' }, {}],
  ['forecast', '/forecast/:branchId', {}, { branchId: 'b1' }],
  ['shift-eff', '/shift-effectiveness', { branchId: 'b1', processId: 'p1' }, {}],
  ['shift-eff-nofilter', '/shift-effectiveness', {}, {}],
  ['shift-rec', '/shift-recommendations', { branchId: 'b1', processId: 'p1' }, {}],
  ['break', '/break-compliance', { branchId: 'b1' }, {}],
  ['team-cmp', '/team-comparison', { branchId: 'b1' }, {}],
  ['team-cmp-nofilter', '/team-comparison', {}, {}],
  ['mobile', '/team-status-mobile', {}, {}],
];

describe('roster-analytics unfiltered SQL is unchanged', () => {
  // Handlers derive default dates from "today"; pin the clock so the snapshot never rots.
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 24, 12, 0, 0)); });
  afterAll(() => { vi.useRealTimers(); });
  it.each(CASES)('%s', async (_n, path, query, params) => {
    calls.length = 0;
    await callHandler(getHandler(rosterAnalyticsRouter, 'get', path), { query, params });
    const shape = calls.map((c) => ({ sql: norm(c.sql), params: c.params }));
    expect(shape).toMatchSnapshot();
  });
});
