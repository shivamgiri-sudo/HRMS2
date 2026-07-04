import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getPendingApprovals,
  processBranchHeadApproval,
  getApprovalHistory,
  getBranchHeadStats,
  type ApprovalInput,
} from './branch-head-approval.service.js';

export const branchHeadApprovalRouter = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

// All routes require authentication and branch head role
branchHeadApprovalRouter.use(requireAuth);
branchHeadApprovalRouter.use(requireRole('admin', 'manager', 'branch_head'));

// ── 1. Get pending approvals ──────────────────────────────────────────────────
branchHeadApprovalRouter.get('/pending', h(async (req, res) => {
  try {
    const branchHeadId = req.authUser!.id;
    const approvals = await getPendingApprovals(branchHeadId);

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
    const input: ApprovalInput = {
      approval_id: req.body.approval_id,
      branch_head_id: req.authUser!.id,
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
    const branchHeadId = req.authUser!.id;
    const stats = await getBranchHeadStats(branchHeadId);

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
