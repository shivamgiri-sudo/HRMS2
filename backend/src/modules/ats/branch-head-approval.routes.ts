import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getPendingApprovals,
  processBranchHeadApproval,
  getApprovalHistory,
  getBranchHeadStats,
  listBranchHeadDecisions,
  type ApprovalInput,
} from './branch-head-approval.service.js';
import {
  resolveEmployeeIdForAuthUser,
  assertBranchHeadCanSeeCandidate,
} from './branch-head-scope.js';
import { getCandidateFullJourney } from './candidate-journey.service.js';

export const branchHeadApprovalRouter = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

// All routes require authentication.
//
// The role list must be a superset of the roles granted ATS_OFFER_APPROVALS in
// the UI, or a user can open the page and every request on it 403s. `hr` was
// missing exactly that way. payroll_hr is included to match
// ats.onboarding.routes.ts:206, which backs the same screen.
//
// Row scope — not this list — is the security boundary: every endpoint below
// resolves the caller's branches and filters to them.
branchHeadApprovalRouter.use(requireAuth);
branchHeadApprovalRouter.use(
  requireRole('super_admin', 'admin', 'hr', 'payroll_hr', 'manager', 'branch_head'),
);

// ── 1. Get pending approvals ──────────────────────────────────────────────────
branchHeadApprovalRouter.get('/pending', h(async (req, res) => {
  try {
    const branchHeadId = await resolveEmployeeIdForAuthUser(req.authUser!.id);
    const approvals = await getPendingApprovals(branchHeadId, req.authUser!.id);

    return res.json({
      success: true,
      data: approvals,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
}));

// ── 2. Process approval (approve/reject) ──────────────────────────────────────
branchHeadApprovalRouter.post('/process', h(async (req, res) => {
  try {
    const branchHeadEmployeeId = await resolveEmployeeIdForAuthUser(req.authUser!.id);
    const input: ApprovalInput = {
      approval_id: req.body.approval_id,
      branch_head_id: branchHeadEmployeeId,
      branch_head_user_id: req.authUser!.id,
      approval_status: req.body.approval_status,
      remarks: req.body.remarks,
    };

    if (!input.approval_id || !input.approval_status) {
      return res.status(400).json({
        success: false,
        message: 'approval_id and approval_status are required',
      });
    }

    if (!['approved', 'rejected'].includes(input.approval_status)) {
      return res.status(400).json({
        success: false,
        message: 'approval_status must be approved or rejected',
      });
    }

    const result = await processBranchHeadApproval(input);

    return res.json(result);
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
}));

// ── 3. Get approval history for a candidate ───────────────────────────────────
branchHeadApprovalRouter.get('/history/:candidateId', h(async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    // This endpoint shipped unscoped. Any candidate's trail was readable by any
    // admin/manager/branch_head; it was simply never called.
    await assertBranchHeadCanSeeCandidate((req as AuthenticatedRequest).authUser!.id, candidateId);
    const history = await getApprovalHistory(candidateId);

    return res.json({
      success: true,
      data: history,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
}));

// ── 4. Get branch head statistics ─────────────────────────────────────────────
branchHeadApprovalRouter.get('/stats', h(async (req, res) => {
  try {
    const branchHeadId = await resolveEmployeeIdForAuthUser(req.authUser!.id);
    const stats = await getBranchHeadStats(branchHeadId, req.authUser!.id);

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
}));


// ── 5. Past decisions: what this branch head already approved or rejected ─────
//
// The queue only ever showed pending work; once a decision was made the row
// vanished with no way to look it up again.
branchHeadApprovalRouter.get('/decisions', h(async (req, res) => {
  try {
    const status = String(req.query.status ?? 'all');
    const data = await listBranchHeadDecisions(req.authUser!.id, {
      status: status === 'approved' || status === 'rejected' ? status : 'all',
      search: typeof req.query.search === 'string' ? req.query.search : null,
      limit: Math.min(Number(req.query.limit ?? 100) || 100, 500),
      offset: Number(req.query.offset ?? 0) || 0,
    });
    return res.json({ success: true, ...data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 6. One candidate's complete journey ──────────────────────────────────────
branchHeadApprovalRouter.get('/journey/:candidateId', h(async (req, res) => {
  try {
    const { candidateId } = req.params;
    await assertBranchHeadCanSeeCandidate(req.authUser!.id, candidateId);
    return res.json({ success: true, data: await getCandidateFullJourney(candidateId) });
  } catch (error: unknown) {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return res.status(status).json({ success: false, message: getErrorMessage(error) });
  }
}));
