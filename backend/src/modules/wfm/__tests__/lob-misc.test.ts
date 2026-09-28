import { describe, it, expect, vi } from 'vitest';
import { LOB_UUID, expectParamPosition, norm } from './lobTestUtils';
import { getPendingInterventions, getInterventionOutcomes } from '../../analytics/intervention-recommendation.service';
import { getProcessTeamRosterView } from '../process-team-roster.service';
import { appendFilterConditions } from '../../reporting/executors/types';
import { buildLobCoverageQuery } from '../roster-console-lob-coverage.routes';
import { buildEmployeeScope } from '../wfm-compliance-analytics.routes';

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
vi.mock('../roster-intelligence.routes.js', () => ({ resolveLiveMonitoringScope: vi.fn() }));

const fakeRes = () => {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
  return { out, res };
};
const placeholders = (s: string) => (s.match(/\?/g) ?? []).length;

describe('interventions', () => {
  const cases: Array<[string, (q: any) => Promise<{ status: number }>]> = [
    ['pending', async (q) => { const f = fakeRes(); await getPendingInterventions({ query: q } as any, f.res); return f.out; }],
    ['outcomes', async (q) => { const f = fakeRes(); await getInterventionOutcomes({ query: q } as any, f.res); return f.out; }],
  ];
  it.each(cases)('%s: branch/process/lob narrow with params in order', async (_n, run) => {
    calls.length = 0;
    await run({ branchId: 'b1', processId: 'p1', lobId: LOB_UUID });
    const x = calls[0];
    expect(x.sql).toContain('e.branch_id = ? AND e.process_id = ? AND e.lob_id = ?');
    expectParamPosition(x, 'e.lob_id = ?', LOB_UUID);
    expectParamPosition(x, 'e.branch_id = ?', 'b1');
    if (_n === 'outcomes') expect(placeholders(x.sql)).toBe(x.params.length);
  });
  it.each(cases)('%s: __none__ uses IS NULL, invalid gives 400 and no query', async (_n, run) => {
    calls.length = 0;
    await run({ lobId: '__none__' });
    expect(calls[0].sql).toContain('e.lob_id IS NULL');
    calls.length = 0;
    const bad = await run({ lobId: 'x' });
    expect(bad.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('pending: owner first, narrowing next, limit last', async () => {
    calls.length = 0;
    await getPendingInterventions({ query: { owner: 'manager', limit: '20', branchId: 'b1' } } as any, fakeRes().res);
    expect(calls[0].params).toEqual(['manager', 'b1', 20]);
  });
});

describe('process team roster', () => {
  const answer = (rows: unknown[]) => async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return [rows, []] as any; };

  it('adds the lob filter after process and names LOBs via a parameterised lookup', async () => {
    calls.length = 0;
    mockExecute.mockImplementationOnce(answer([{ process_name: 'P' }]));
    mockExecute.mockImplementationOnce(answer([{ employee_id: 'e1', employee_code: 'C1', employee_name: 'A', lob_id: LOB_UUID, assignment_type: 'WORK' }]));
    mockExecute.mockImplementationOnce(answer([{ id: LOB_UUID, lob_name: 'Sales' }]));
    const view = await getProcessTeamRosterView('p1', '2026-09-01', { kind: 'lob', id: LOB_UUID });
    expect(calls[1].sql).toContain('e.lob_id = ?');
    expect(calls[1].params).toEqual(['2026-09-01', '2026-09-01', '2026-09-01', 'p1', LOB_UUID]);
    expectParamPosition(calls[1], 'e.lob_id = ?', LOB_UUID);
    expect(calls[2].sql).toContain('FROM lob_master WHERE id IN (?)');
    expect(calls[2].params).toEqual([LOB_UUID]);
    expect(view.members[0]).toMatchObject({ lobId: LOB_UUID, lobName: 'Sales' });
  });
  it('unassigned uses IS NULL and skips the name lookup when nobody has a LOB', async () => {
    calls.length = 0;
    await getProcessTeamRosterView('p1', '2026-09-01', { kind: 'unassigned' });
    expect(calls[1].sql).toContain('e.lob_id IS NULL');
    expect(calls).toHaveLength(2);
  });
});

describe('report executors appendFilterConditions', () => {
  it('no lobId leaves the clauses untouched', () => {
    const c: string[] = []; const p: unknown[] = [];
    appendFilterConditions({ branchId: 'b1' }, c, p);
    expect(c).toEqual(['e.branch_id = ?']);
    expect(p).toEqual(['b1']);
  });
  it('uuid, sentinel, alias and invalid', () => {
    let c: string[] = []; let p: unknown[] = [];
    appendFilterConditions({ processId: 'p1', lobId: LOB_UUID }, c, p, 'emp');
    expect(c).toEqual(['emp.process_id = ?', 'emp.lob_id = ?']);
    expect(p).toEqual(['p1', LOB_UUID]);
    c = []; p = [];
    appendFilterConditions({ lobId: '__none__' }, c, p);
    expect(c).toEqual(['e.lob_id IS NULL']);
    expect(p).toEqual([]);
    expect(() => appendFilterConditions({ lobId: 'bad' }, [], [])).toThrow();
  });
});

describe('lob-coverage query', () => {
  it('single conditional-sum query without lob_master, scope params before narrowing params', () => {
    const q = buildLobCoverageQuery({ branchIds: ['s1', 's2'] }, 'b1', 'p1');
    const sql = norm(q.sql);
    expect(sql).toContain('SUM(CASE WHEN e.lob_id IS NOT NULL THEN 1 ELSE 0 END) AS with_lob');
    expect(sql).not.toMatch(/lob_master|COLLATE|JOIN/i);
    expect(sql).toContain('e.branch_id IN (?,?) AND e.branch_id = ? AND e.process_id = ?');
    expect(q.params).toEqual(['s1', 's2', 'b1', 'p1']);
    expect(placeholders(q.sql)).toBe(q.params.length);
  });
  it('unrestricted scope with no narrowing has no params', () => {
    expect(buildLobCoverageQuery(undefined).params).toEqual([]);
  });
});

describe('compliance buildEmployeeScope', () => {
  it('orders branch, process, lob and matches params', () => {
    const s = buildEmployeeScope({ branchId: 'b', processId: 'p', lob: { kind: 'lob', id: LOB_UUID } });
    expect(s.sql).toBe('AND e.branch_id = ? AND e.process_id = ? AND e.lob_id = ?');
    expect(s.params).toEqual(['b', 'p', LOB_UUID]);
    expect(buildEmployeeScope({})).toEqual({ sql: '', params: [] });
    expect(buildEmployeeScope({ processId: 'p' })).toEqual({ sql: 'AND e.process_id = ?', params: ['p'] });
  });
});
