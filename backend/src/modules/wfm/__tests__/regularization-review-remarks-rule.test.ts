import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Regularization review follows the same rule as leave: remarks mandatory on a
 * REJECTION, optional on an APPROVAL (owner ruling, 2026-08-27).
 *
 * The old inverted guard did more damage here than on leave, because _performReview is
 * also the per-id worker behind PATCH /regularizations/bulk-review — and both bulk
 * callers (AttendanceRegularization.tsx and wfm/TeamAttendanceMonth.tsx) post
 * `{ ids, status: 'approved' }` with no remarks field at all. Every bulk approval was
 * therefore refused 400 per row. The last case below pins that path specifically.
 */

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: 'reviewer-user' };
    next();
  },
}));

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reviewRegularization: vi.fn(),
  hasAnyRole: vi.fn(),
}));

vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
vi.mock('../wfm.service.js', () => ({ wfmService: { reviewRegularization: mocks.reviewRegularization } }));
vi.mock('../../../shared/accessGuard.js', () => ({ getEmployeeForUser: vi.fn(async () => ({ id: 'emp-reviewer' })) }));
vi.mock('../../../shared/scopeAccess.js', () => ({
  hasAnyRole: mocks.hasAnyRole,
  hasScopedAccess: vi.fn(async () => false),
  buildScopeWhereClause: vi.fn(async () => ({ sql: '1=1', params: [] })),
  getUserAssignmentScopes: vi.fn(async () => []),
}));
vi.mock('../../../shared/approvalEscalation.js', () => ({
  resolveEffectiveApprover: vi.fn(async () => ({ approverId: null })),
}));
vi.mock('../../../shared/auditLog.js', () => ({ logSensitiveAction: vi.fn() }));
vi.mock('../attendance.notifications.js', () => ({
  notifyRegularizationDecision: vi.fn(),
  notifyRegularizationStage2Pending: vi.fn(),
}));
vi.mock('../wfm.validation.js', () => ({ regularizationSchema: { parse: (v: unknown) => v } }));

const PRE_ROW = {
  reg_status: 'pending', status: 'pending', requested_status: 'present',
  employee_id: 'emp-target', session_date: '2026-08-01',
  old_status: 'absent', new_status: 'present', dispute_type: null,
  same_day_request_count: 0, recent_request_count: 0, total_punches: 2,
};

describe('PATCH /wfm/regularizations/:id/review — remarks rule', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    // super_admin short-circuits regularizationReviewRole, so 'approved'/'rejected' pass
    // straight through nextRegularizationStatus unchanged.
    mocks.hasAnyRole.mockResolvedValue(true);
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('salary_prep_run')) return [[]];        // month is not frozen
      if (sql.includes('adr.attendance_status')) return [[PRE_ROW]];
      return [[]];
    });
    mocks.reviewRegularization.mockResolvedValue({ id: 'reg-1' });

    const { wfmRegularizationSecureRouter } = await import('../wfm.regularization.secure.routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/wfm', wfmRegularizationSecureRouter);
  });

  it('APPROVES with no remarks at all', async () => {
    const res = await request(app).patch('/api/wfm/regularizations/reg-1/review').send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(mocks.reviewRegularization).toHaveBeenCalledWith(
      'reg-1', { status: 'approved', reviewerNote: null }, 'reviewer-user',
    );
  });

  it('REFUSES a rejection carrying no remarks', async () => {
    const res = await request(app).patch('/api/wfm/regularizations/reg-1/review').send({ status: 'rejected' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required to reject/i);
    expect(mocks.reviewRegularization).not.toHaveBeenCalled();
  });

  it('REFUSES a rejection whose remarks are only whitespace', async () => {
    const res = await request(app)
      .patch('/api/wfm/regularizations/reg-1/review')
      .send({ status: 'rejected', reviewerNote: '  \t ' });

    expect(res.status).toBe(400);
    expect(mocks.reviewRegularization).not.toHaveBeenCalled();
  });

  it('ACCEPTS a rejection with a reason, under either body key', async () => {
    const viaNote = await request(app)
      .patch('/api/wfm/regularizations/reg-1/review')
      .send({ status: 'rejected', reviewerNote: 'No punch evidence on the day' });
    expect(viaNote.status).toBe(200);

    const viaRemarks = await request(app)
      .patch('/api/wfm/regularizations/reg-1/review')
      .send({ status: 'rejected', remarks: 'Raised after the correction window' });
    expect(viaRemarks.status).toBe(200);
  });

  it('BULK approve — the exact payload both UIs send — is no longer refused per row', async () => {
    const res = await request(app)
      .patch('/api/wfm/regularizations/bulk-review')
      .send({ ids: ['reg-1', 'reg-2'], status: 'approved' }); // no remarks, as shipped

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toBe(2);
    expect(res.body.failed).toBe(0);
  });
});
