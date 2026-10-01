import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  allowed: null as null | string[],
  employeeBranch: vi.fn(),
  nudgeEmployee: vi.fn(),
  nudgeBranchPending: vi.fn(),
  enrich: vi.fn(),
  loader: vi.fn(),
}));

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: any, _r: express.Response, next: express.NextFunction) => { req.authUser = { id: 'u1' }; next(); },
}));
vi.mock('../../../middleware/requireRole.js', () => ({
  requireRole: () => (_q: any, _r: express.Response, next: express.NextFunction) => next(),
}));
vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../shared/dashboardScope.js', () => ({
  DashboardScopeConfigurationError: class extends Error {},
  resolveDashboardScopeForRequest: vi.fn(async () =>
    m.allowed === null ? { level: 'ORG_ALL', branchIds: [] } : { level: 'BRANCH_ALL', branchIds: m.allowed }),
}));
vi.mock('../ops-control-tower.logic.js', () => ({ scopeSummaryToBranches: (x: unknown) => x }));
vi.mock('../ops-control-tower.service.js', () => ({
  getOpsControlTowerSummary: vi.fn(),
  getAttendanceMismatchDetail: vi.fn(), getFnfPendingDetail: vi.fn(), getNocPendingDetail: vi.fn(),
  getDigilockerPendingDetail: (...a: unknown[]) => m.loader(...a),
  getEsignPendingDetail: vi.fn(), getAppointmentLetterDetail: vi.fn(), getPennyDropMissingDetail: vi.fn(),
  getAccountDetailsMissingDetail: vi.fn(), getBgvPendingDetail: vi.fn(), getItProvisioningPendingDetail: vi.fn(),
  getAdminProvisioningPendingDetail: vi.fn(), getWfmProvisioningPendingDetail: vi.fn(),
}));
vi.mock('../ops-nudge.service.js', () => ({
  employeeBranchId: m.employeeBranch,
  nudgeEmployee: m.nudgeEmployee,
  nudgeBranchPending: m.nudgeBranchPending,
  enrichDetailRows: m.enrich,
  whatsappConfigured: () => false,
}));

import { opsControlTowerRouter } from '../ops-control-tower.routes.js';

const app = express();
app.use(express.json());
app.use('/api/ops-control-tower', opsControlTowerRouter);

const EMP = '11111111-1111-1111-1111-111111111111';
const B1 = '22222222-2222-2222-2222-222222222222';
const B2 = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  Object.values(m).forEach((f) => typeof f === 'function' && (f as any).mockReset?.());
  m.allowed = null;
  m.employeeBranch.mockResolvedValue(B1);
  m.nudgeEmployee.mockResolvedValue({ employeeId: EMP, status: 'sent' });
  m.nudgeBranchPending.mockResolvedValue([{ employeeId: 'a', status: 'sent' }, { employeeId: 'b', status: 'skipped_cooldown' }]);
  m.loader.mockResolvedValue([{ employeeId: EMP }]);
  m.enrich.mockImplementation(async (_b: string, rows: unknown[]) => rows);
});

describe('POST /nudge', () => {
  it('rejects bad ids and non-nudgeable issues', async () => {
    expect((await request(app).post('/api/ops-control-tower/nudge').send({ employeeId: 'x', issue: 'digilocker-pending' })).status).toBe(400);
    expect((await request(app).post('/api/ops-control-tower/nudge').send({ employeeId: EMP, issue: 'fnf-pending' })).status).toBe(400);
    expect(m.nudgeEmployee).not.toHaveBeenCalled();
  });
  it('404 for unknown employee', async () => {
    m.employeeBranch.mockResolvedValue(null);
    expect((await request(app).post('/api/ops-control-tower/nudge').send({ employeeId: EMP, issue: 'digilocker-pending' })).status).toBe(404);
  });
  it('403 when the employee branch is outside caller scope; sends nothing', async () => {
    m.allowed = [B2];
    const r = await request(app).post('/api/ops-control-tower/nudge').send({ employeeId: EMP, issue: 'digilocker-pending' });
    expect(r.status).toBe(403);
    expect(m.nudgeEmployee).not.toHaveBeenCalled();
  });
  it('sends as manual with the caller as actor when in scope', async () => {
    m.allowed = [B1];
    const r = await request(app).post('/api/ops-control-tower/nudge').send({ employeeId: EMP, issue: 'digilocker-pending' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('sent');
    expect(m.nudgeEmployee).toHaveBeenCalledWith({ employeeId: EMP, issue: 'digilocker-pending', trigger: 'manual', actorId: 'u1' });
  });
});

describe('POST /nudge/bulk', () => {
  it('403 outside scope, 400 bad input', async () => {
    m.allowed = [B2];
    expect((await request(app).post('/api/ops-control-tower/nudge/bulk').send({ branchId: B1, issue: 'bgv-pending' })).status).toBe(403);
    expect((await request(app).post('/api/ops-control-tower/nudge/bulk').send({ branchId: 'bad', issue: 'bgv-pending' })).status).toBe(400);
    expect((await request(app).post('/api/ops-control-tower/nudge/bulk').send({ branchId: B1, issue: 'noc-pending' })).status).toBe(400);
    expect(m.nudgeBranchPending).not.toHaveBeenCalled();
  });
  it('returns per-row results and a status tally', async () => {
    const r = await request(app).post('/api/ops-control-tower/nudge/bulk').send({ branchId: B1, issue: 'bgv-pending' });
    expect(r.status).toBe(200);
    expect(r.body.tally).toEqual({ sent: 1, skipped_cooldown: 1 });
    expect(m.nudgeBranchPending).toHaveBeenCalledWith({ branchId: B1, issue: 'bgv-pending', actorId: 'u1' });
  });
});

describe('GET /:block/:branchId', () => {
  it('returns enriched rows plus nudge capability flags', async () => {
    const r = await request(app).get(`/api/ops-control-tower/digilocker-pending/${B1}`);
    expect(r.status).toBe(200);
    expect(r.body.nudge).toEqual({ supported: true, whatsappConfigured: false });
    expect(m.enrich).toHaveBeenCalled();
  });
  it('marks non-nudgeable blocks unsupported', async () => {
    const r = await request(app).get(`/api/ops-control-tower/fnf-pending/${B1}`);
    expect(r.body.nudge.supported).toBe(false);
  });
});
