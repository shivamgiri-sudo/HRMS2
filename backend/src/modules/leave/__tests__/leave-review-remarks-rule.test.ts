import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Remarks are mandatory on a REJECTION and optional on an APPROVAL.
 *
 * Owner ruling, 2026-08-27. The rule used to be the exact inverse: an approver had to
 * type something to approve and could reject in silence. That is backwards — an approval
 * carries its own meaning, while a refusal the employee cannot see a reason for is the
 * case that needs a written record.
 *
 * These four cases pin both halves. Two of them (approve-without-remarks succeeds,
 * reject-without-remarks is refused) fail against the pre-2026-08-27 code, which is what
 * makes this a regression test rather than a restatement.
 */

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: 'reviewer-user' };
    next();
  },
}));

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reviewRequest: vi.fn(),
  hasAnyRole: vi.fn(),
  getEmployeeForUser: vi.fn(),
}));

vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
vi.mock('../leave.service.js', () => ({ leaveService: { reviewRequest: mocks.reviewRequest } }));
vi.mock('../../../shared/accessGuard.js', () => ({ getEmployeeForUser: mocks.getEmployeeForUser }));
vi.mock('../../../shared/scopeAccess.js', () => ({
  hasAnyRole: mocks.hasAnyRole,
  buildScopeWhereClause: vi.fn(async () => ({ sql: '1=1', params: [] })),
}));
vi.mock('../../../shared/approvalEscalation.js', () => ({
  resolveEffectiveApprover: vi.fn(async () => ({ approverId: 'emp-reviewer' })),
}));
vi.mock('../leave-policy.service.js', () => ({
  leavePolicyService: { getExceptionApproverRole: vi.fn(async () => 'branch_head') },
}));

describe('PATCH /leave/requests/:id/review — remarks rule', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    // canReviewLeave: the request exists, belongs to someone else, and the caller is HR.
    mocks.execute.mockResolvedValue([[{
      employee_id: 'emp-target', status: 'pending', leave_type_id: 'lt-1',
      branch_id: 'b1', process_id: 'p1', lob_id: null, department_id: 'd1',
      reporting_manager_id: 'emp-reviewer', manager_id: 'emp-reviewer',
    }]]);
    mocks.getEmployeeForUser.mockResolvedValue({ id: 'emp-reviewer' });
    mocks.hasAnyRole.mockResolvedValue(true);
    mocks.reviewRequest.mockResolvedValue({ id: 'lr-1' });

    const { leaveSecureRouter } = await import('../leave.secure.routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/leave', leaveSecureRouter);
  });

  it('APPROVES with no remarks at all', async () => {
    const res = await request(app).patch('/api/leave/requests/lr-1/review').send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(mocks.reviewRequest).toHaveBeenCalledWith(
      'lr-1', { status: 'approved', remarks: null }, 'reviewer-user',
    );
  });

  it('APPROVES at the branch-head tier with no remarks either', async () => {
    const res = await request(app)
      .patch('/api/leave/requests/lr-1/review')
      .send({ status: 'branch_head_approved' });

    expect(res.status).toBe(200);
    expect(mocks.reviewRequest).toHaveBeenCalled();
  });

  it('REFUSES a rejection carrying no remarks', async () => {
    const res = await request(app).patch('/api/leave/requests/lr-1/review').send({ status: 'rejected' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required to reject/i);
    // The refusal must happen before anything is written.
    expect(mocks.reviewRequest).not.toHaveBeenCalled();
  });

  it('REFUSES a rejection whose remarks are only whitespace', async () => {
    const res = await request(app)
      .patch('/api/leave/requests/lr-1/review')
      .send({ status: 'branch_head_rejected', remarks: '   ' });

    expect(res.status).toBe(400);
    expect(mocks.reviewRequest).not.toHaveBeenCalled();
  });

  it('ACCEPTS a rejection with a real reason, under either body key', async () => {
    const viaRemarks = await request(app)
      .patch('/api/leave/requests/lr-1/review')
      .send({ status: 'rejected', remarks: 'Peak season, cover unavailable' });
    expect(viaRemarks.status).toBe(200);

    // TeamLeaveTab posts reviewNotes rather than remarks — both must satisfy the guard.
    const viaReviewNotes = await request(app)
      .patch('/api/leave/requests/lr-1/review')
      .send({ status: 'rejected', reviewNotes: 'Duplicate request' });
    expect(viaReviewNotes.status).toBe(200);
  });
});
