import { describe, it, expect, vi } from 'vitest';
import { LOB_UUID, norm, expectParamPosition } from './lobTestUtils';
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

const runners = buildRunners(false);

describe.each(Object.keys(runners))('%s lobId', (name) => {
  const go = async (lobId?: string) => {
    calls.length = 0;
    const out = await runners[name](lobId);
    return { out, calls: calls.map((c) => ({ sql: c.sql, params: c.params })) };
  };

  it('no lobId: no lob fragment, placeholders match params', async () => {
    const r = await go();
    expect(r.calls.length).toBeGreaterThan(0);
    for (const x of r.calls) {
      expect(x.sql).not.toContain('lob_id');
      expect((x.sql.match(/\?/g) ?? []).length).toBe(x.params.length);
    }
  });
  it('uuid: e.lob_id = ? with correct param order', async () => {
    const r = await go(LOB_UUID);
    const hit = r.calls.filter((x) => x.sql.includes('e.lob_id = ?'));
    expect(hit.length).toBeGreaterThan(0);
    for (const x of hit) {
      expectParamPosition(x, 'e.lob_id = ?', LOB_UUID);
      expect((x.sql.match(/\?/g) ?? []).length).toBe(x.params.length);
    }
  });
  it('__none__: e.lob_id IS NULL', async () => {
    const r = await go('__none__');
    expect(r.calls.some((x) => x.sql.includes('e.lob_id IS NULL'))).toBe(true);
    expect(r.calls.every((x) => !x.params.includes('__none__'))).toBe(true);
  });
  it('invalid: 400 and no db call', async () => {
    const r = await go('nope');
    expect(r.out.status).toBe(400);
    expect(r.calls).toHaveLength(0);
  });
  it('no COLLATE / lob_master join', async () => {
    const r = await go(LOB_UUID);
    for (const x of r.calls) expect(norm(x.sql)).not.toMatch(/COLLATE|lob_master/i);
  });
});

describe('unplanned-absences narrows within RBAC scope', () => {
  it('keeps the scope IN (...) and ANDs branch/process/lob after it', async () => {
    calls.length = 0;
    await runners['unplanned-absences'](LOB_UUID);
    const x = calls[0];
    const sql = norm(x.sql);
    expect(sql).toContain('e.branch_id IN (?,?) AND e.branch_id = ? AND e.process_id = ? AND e.lob_id = ?');
    expect(x.params.slice(2)).toEqual(['scope-b1', 'scope-b2', 'b1', 'p1', LOB_UUID]);
  });
});
