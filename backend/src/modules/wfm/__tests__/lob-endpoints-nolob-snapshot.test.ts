/**
 * Baseline guard for the compliance / audit / live-monitoring / status-summary endpoints: unfiltered
 * calls (legacy query shapes only) must produce the same whitespace-normalised SQL and params as
 * before. Snapshot generated on origin/main; passes on both trees.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { norm } from './lobTestUtils';
import { buildRunners } from './lob-endpoints-harness';

const { calls, mockExecute } = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const mockExecute = vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return [[], []]; });
  return { calls, mockExecute };
});
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mockExecute, query: mockExecute } }));
vi.mock('../../../middleware/authMiddleware.js', () => ({ requireAuth: (_q: any, _s: any, n: any) => n() }));
vi.mock('../../../middleware/requireRole.js', () => ({ requireRole: () => (_q: any, _s: any, n: any) => n() }));
vi.mock('../../../middleware/scopeMiddleware.js', () => ({ requireQueryScope: () => (_q: any, _s: any, n: any) => n() }));
vi.mock('../wfm-compliance-analytics.service.js', () => ({ getEmployeeWfmCompliance: vi.fn(), getBranchWfmCompliance: vi.fn() }));
vi.mock('../../../shared/roleResolver.js', () => ({ getUserRoleContext: async () => ({ primaryRole: 'branch_head' }) }));
vi.mock('../../../shared/dashboardScope.js', () => ({
  resolveDashboardScopeForRequest: async () => ({ level: 'BRANCH', branchIds: ['scope-b1', 'scope-b2'], processIds: undefined }),
}));

const runners = buildRunners(true);

// Some endpoints derive their default date window from "today" (compliance trend = last 6 months).
// The recorded snapshot is for September 2026, so pin the clock; without this the test fails every
// time the calendar leaves that month. Only Date is faked so promises and timers behave normally.
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T06:30:00Z')); });
afterAll(() => { vi.useRealTimers(); });

describe('unfiltered SQL is unchanged', () => {
  it.each(Object.keys(runners))('%s', async (name) => {
    calls.length = 0;
    await runners[name]();
    expect(calls.map((c) => ({ sql: norm(c.sql), params: c.params }))).toMatchSnapshot();
  });
});
