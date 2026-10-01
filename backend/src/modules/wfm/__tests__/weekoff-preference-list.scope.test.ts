import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * GET /api/wfm/week-off-preference: admin / hr / wfm passed the role gate and then saw EVERY branch's preferences
 * (or any ?branchId=). Owner ruling 2026-10-01: admin is branch-scoped like hr; a browser ?branchId= can only narrow.
 * Org-wide roles keep the unfiltered list.
 */
vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: 'u1' }; next(); },
}));
vi.mock('../../../shared/accessGuard.js', () => ({
  hasRole: vi.fn().mockResolvedValue(true),
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: 'emp-self' }),
}));
const mocks = vi.hoisted(() => ({ execute: vi.fn(), resolveScope: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
vi.mock('../../../shared/enterpriseScope.js', async (orig) => ({
  ...(await orig<typeof import('../../../shared/enterpriseScope.js')>()),
  resolveUserBusinessScope: mocks.resolveScope,
}));

const scope = (roles: string[], over: Record<string, unknown> = {}) => ({
  userId: 'u1', roles, employeeId: 'emp-self', employeeCode: 'C1', branchId: 'branch-a', processId: null, lobId: null, departmentId: null,
  isSuperAdmin: roles.includes('super_admin'), isAdmin: roles.includes('admin'), isHr: roles.includes('hr'), isPayroll: false, isFinance: false,
  assignments: [], ...over,
});
const adminBranch = { roleKey: 'admin', scopeType: 'branch', branchId: 'branch-a', processId: null, lobId: null, departmentId: null, managerEmployeeId: null, clientId: null };
const listCall = () => mocks.execute.mock.calls.find(([sql]) => /FROM week_off_preference wop/.test(String(sql)) && /ORDER BY/.test(String(sql)));

let app: express.Application;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue([[]]);
  const { wfmRouter } = await import('../wfm.routes.js');
  app = express();
  app.use('/api/wfm', wfmRouter);
});

describe('week-off preference list scope', () => {
  it('admin sees only its own branch', async () => {
    mocks.resolveScope.mockResolvedValue(scope(['admin'], { assignments: [adminBranch] }));
    const res = await request(app).get('/api/wfm/week-off-preference');
    expect(res.status).toBe(200);
    const [sql, params] = listCall()!;
    expect(String(sql)).toContain('e.branch_id IN (?)');
    expect(params).toEqual(['branch-a']);
  });
  it("admin asking for another branch is refused (the filter can only narrow)", async () => {
    mocks.resolveScope.mockResolvedValue(scope(['admin'], { assignments: [adminBranch] }));
    expect((await request(app).get('/api/wfm/week-off-preference?branchId=branch-z')).status).toBe(403);
    expect(listCall()).toBeUndefined();
  });
  it('admin with no branch sees nothing (fail closed)', async () => {
    mocks.resolveScope.mockResolvedValue(scope(['admin'], { branchId: null, employeeId: null }));
    expect((await request(app).get('/api/wfm/week-off-preference')).status).toBe(403);
    expect(listCall()).toBeUndefined();
  });
  it('hr is limited to its own branch too', async () => {
    mocks.resolveScope.mockResolvedValue(scope(['hr']));
    await request(app).get('/api/wfm/week-off-preference');
    expect(listCall()![1]).toEqual(['branch-a']);
  });
  it('an org-wide role keeps the unfiltered list, and may filter by any branch', async () => {
    mocks.resolveScope.mockResolvedValue(scope(['super_admin']));
    await request(app).get('/api/wfm/week-off-preference');
    expect(String(listCall()![0])).not.toContain('IN (?)');
    mocks.execute.mockClear(); mocks.execute.mockResolvedValue([[]]);
    await request(app).get('/api/wfm/week-off-preference?branchId=branch-z');
    expect(listCall()![1]).toEqual(['branch-z']);
  });
});
