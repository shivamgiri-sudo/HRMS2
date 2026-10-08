import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  allowed: null as null | string[],
  fullTower: true,
  employeeBranch: vi.fn(),
  nudgeEmployee: vi.fn(),
  nudgeBranchPending: vi.fn(),
  enrich: vi.fn(),
  loader: vi.fn(),
  issueLink: vi.fn(),
  emailLink: vi.fn(),
  audit: vi.fn(),
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
vi.mock('../ops-control-tower.logic.js', async (orig) => ({
  ...(await orig<typeof import('../ops-control-tower.logic.js')>()),
  scopeSummaryToBranches: (x: unknown) => x,
}));
vi.mock('../../../shared/auditLog.js', () => ({ logSensitiveAction: (...a: unknown[]) => m.audit(...a) }));
vi.mock('../../../shared/accessGuard.js', () => ({ hasRole: vi.fn(async () => m.fullTower) }));
vi.mock('../ops-control-tower.service.js', () => ({
  getOpsControlTowerSummary: vi.fn(),
  getAttendanceMismatchDetail: vi.fn(), getFnfPendingDetail: vi.fn(), getNocPendingDetail: vi.fn(),
  getDigilockerPendingDetail: (...a: unknown[]) => m.loader(...a),
  getEsignPendingDetail: vi.fn(), getAppointmentLetterDetail: vi.fn(), getPennyDropMissingDetail: vi.fn(),
  getAccountDetailsMissingDetail: vi.fn(), getDocsPendingDetail: vi.fn(), getBgvPendingDetail: vi.fn(), getAddressReviewPendingDetail: vi.fn(), getItProvisioningPendingDetail: vi.fn(),
  getAdminProvisioningPendingDetail: vi.fn(), getWfmProvisioningPendingDetail: vi.fn(),
}));
vi.mock('../ops-nudge.service.js', () => ({
  employeeBranchId: m.employeeBranch,
  nudgeEmployee: m.nudgeEmployee,
  nudgeBranchPending: m.nudgeBranchPending,
  enrichDetailRows: m.enrich,
  issueOnboardingLink: m.issueLink,
  emailOnboardingLink: m.emailLink,
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
  m.fullTower = true;
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

describe('payroll_hr-only callers', () => {
  beforeEach(() => { m.fullTower = false; });
  it('may open and nudge bank / penny-drop blocks', async () => {
    expect((await request(app).get(`/api/ops-control-tower/account-details-missing/${B1}`)).status).toBe(200);
    const r = await request(app).post('/api/ops-control-tower/nudge').send({ employeeId: EMP, issue: 'penny-drop-missing' });
    expect(r.status).toBe(200);
  });
  it('is refused every other block, on read and on nudge; nothing is sent', async () => {
    expect((await request(app).get(`/api/ops-control-tower/digilocker-pending/${B1}`)).status).toBe(403);
    expect((await request(app).get(`/api/ops-control-tower/fnf-pending/${B1}`)).status).toBe(403);
    expect((await request(app).post('/api/ops-control-tower/nudge').send({ employeeId: EMP, issue: 'bgv-pending' })).status).toBe(403);
    expect((await request(app).post('/api/ops-control-tower/nudge/bulk').send({ branchId: B1, issue: 'docs-pending' })).status).toBe(403);
    expect(m.nudgeEmployee).not.toHaveBeenCalled();
    expect(m.nudgeBranchPending).not.toHaveBeenCalled();
  });
});

describe('POST /onboarding-link', () => {
  const link = { link: 'https://hrms.test/onboard-full?token=t', expiresAt: '2026-10-06T00:00:00.000Z' };
  beforeEach(() => { m.issueLink.mockResolvedValue(link); });

  it('validates input', async () => {
    expect((await request(app).post('/api/ops-control-tower/onboarding-link').send({ employeeId: 'x', issue: 'bgv-pending' })).status).toBe(400);
    expect((await request(app).post('/api/ops-control-tower/onboarding-link').send({ employeeId: EMP, issue: 'fnf-pending' })).status).toBe(400);
  });
  it('403 outside branch scope, issues nothing', async () => {
    m.allowed = [B2];
    const r = await request(app).post('/api/ops-control-tower/onboarding-link').send({ employeeId: EMP, issue: 'bgv-pending' });
    expect(r.status).toBe(403);
    expect(m.issueLink).not.toHaveBeenCalled();
  });
  it('payroll_hr-only may issue for bank issues but not others', async () => {
    m.fullTower = false;
    expect((await request(app).post('/api/ops-control-tower/onboarding-link').send({ employeeId: EMP, issue: 'bgv-pending' })).status).toBe(403);
    expect((await request(app).post('/api/ops-control-tower/onboarding-link').send({ employeeId: EMP, issue: 'penny-drop-missing' })).status).toBe(200);
  });
  it('409 when the employee has nothing to link to', async () => {
    m.issueLink.mockResolvedValue(null);
    expect((await request(app).post('/api/ops-control-tower/onboarding-link').send({ employeeId: EMP, issue: 'bgv-pending' })).status).toBe(409);
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('returns the link and audits who issued it, without the token in the audit record', async () => {
    m.allowed = [B1];
    const r = await request(app).post('/api/ops-control-tower/onboarding-link').send({ employeeId: EMP, issue: 'digilocker-pending' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual(link);
    const a = m.audit.mock.calls[0][0];
    expect(a).toMatchObject({ action_type: 'ONBOARDING_LINK_ISSUED', entity_id: EMP, actor_user_id: 'u1' });
    expect(JSON.stringify(a.change_summary)).not.toContain('token=');
  });
});

describe('POST /onboarding-link/email', () => {
  const url = '/api/ops-control-tower/onboarding-link/email';
  beforeEach(() => { m.emailLink.mockResolvedValue({ status: 'sent', sentTo: 'a@b.com' }); });

  it('validates input', async () => {
    expect((await request(app).post(url).send({ employeeId: 'x', issue: 'bgv-pending' })).status).toBe(400);
    expect((await request(app).post(url).send({ employeeId: EMP, issue: 'fnf-pending' })).status).toBe(400);
    expect(m.emailLink).not.toHaveBeenCalled();
  });
  it('404 for an unknown employee, 403 outside branch scope — nothing emailed either way', async () => {
    m.employeeBranch.mockResolvedValue(null);
    expect((await request(app).post(url).send({ employeeId: EMP, issue: 'bgv-pending' })).status).toBe(404);
    m.employeeBranch.mockResolvedValue(B1); m.allowed = [B2];
    expect((await request(app).post(url).send({ employeeId: EMP, issue: 'bgv-pending' })).status).toBe(403);
    expect(m.emailLink).not.toHaveBeenCalled();
  });
  it('payroll_hr-only may email for bank issues but not others', async () => {
    m.fullTower = false;
    expect((await request(app).post(url).send({ employeeId: EMP, issue: 'bgv-pending' })).status).toBe(403);
    expect((await request(app).post(url).send({ employeeId: EMP, issue: 'penny-drop-missing' })).status).toBe(200);
  });
  it('200 with the masked-safe recipient and an audit entry that carries no token', async () => {
    m.allowed = [B1];
    const r = await request(app).post(url).send({ employeeId: EMP, issue: 'digilocker-pending' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'sent', sentTo: 'a@b.com' });
    const a = m.audit.mock.calls[0][0];
    expect(a).toMatchObject({ action_type: 'ONBOARDING_LINK_EMAILED', entity_id: EMP, actor_user_id: 'u1' });
    expect(JSON.stringify(a.change_summary)).not.toContain('token');
  });
  it.each([
    [{ status: 'no_email' }, 409], [{ status: 'no_link' }, 409], [{ status: 'not_found' }, 404],
    [{ status: 'failed', error: '421 busy' }, 502],
  ])('maps %j to HTTP %i', async (outcome, code) => {
    m.emailLink.mockResolvedValue(outcome);
    const r = await request(app).post(url).send({ employeeId: EMP, issue: 'bgv-pending' });
    expect(r.status).toBe(code);
    if (code === 502) expect(r.body.error).toContain('421 busy');
  });
});
