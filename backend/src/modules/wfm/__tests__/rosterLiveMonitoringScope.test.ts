import { describe, it, expect, vi } from 'vitest';

let level = 'BRANCH_ALL';
let processIds: string[] = [];
vi.mock('../../../shared/roleResolver.js', () => ({ getUserRoleContext: async () => ({ primaryRole: 'branch_wfm' }) }));
vi.mock('../../../shared/dashboardScope.js', () => ({
  resolveDashboardScopeForRequest: async () => ({ level, branchIds: ['b1'], processIds }),
}));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: vi.fn(async () => [[], []]), query: vi.fn(async () => [[], []]) } }));

const { resolveLiveMonitoringScope } = await import('../roster-intelligence.routes.js');
const req = { authUser: { id: 'u1', role: 'branch_wfm' } } as any;

describe('resolveLiveMonitoringScope', () => {
  it('BRANCH_ALL: branch only, no process restriction (empty processIds must not read as zero processes)', async () => {
    level = 'BRANCH_ALL'; processIds = [];
    const s = await resolveLiveMonitoringScope(req);
    expect(s).toEqual({ branchIds: ['b1'], processIds: undefined });
  });
  it('PROCESS_ALL keeps both dimensions', async () => {
    level = 'PROCESS_ALL'; processIds = ['p1'];
    expect(await resolveLiveMonitoringScope(req)).toEqual({ branchIds: ['b1'], processIds: ['p1'] });
  });
  it('TEAM_ONLY fails closed', async () => {
    level = 'TEAM_ONLY'; processIds = [];
    expect(await resolveLiveMonitoringScope(req)).toEqual({ branchIds: [], processIds: [] });
  });
});
