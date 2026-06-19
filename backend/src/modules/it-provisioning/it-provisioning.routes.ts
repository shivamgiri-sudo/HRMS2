import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { hasRole } from '../../shared/accessGuard.js';
import {
  listProvisioningRequests,
  getProvisioningRequest,
  actionProvisioningRequest,
  waiveProvisioningRequest,
  confirmAndLockRequest,
} from './it-provisioning.service.js';

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── GET /api/it-provisioning/requests ─────────────────────────────────────────
// branch_it sees only their branch; admin/hr see all
router.get('/requests', requireRole('admin', 'branch_it', 'wfm', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdmin = await hasRole(userId, 'admin', 'hr');

  const filters: Record<string, any> = {
    status:      req.query.status as string | undefined,
    requestType: req.query.request_type as string | undefined,
    page:        req.query.page   ? Number(req.query.page)  : 1,
    limit:       req.query.limit  ? Number(req.query.limit) : 50,
  };

  if (!isAdmin) {
    // Scoped: branch_it and wfm see only their branch requests
    const isBranchIT = await hasRole(userId, 'branch_it');
    const isWFM      = await hasRole(userId, 'wfm');

    if (isBranchIT) filters.assignedRole = 'branch_it';
    else if (isWFM) filters.assignedRole = 'wfm';

    if (req.query.branch_id) filters.branchId = req.query.branch_id as string;
  } else {
    if (req.query.branch_id)      filters.branchId     = req.query.branch_id as string;
    if (req.query.assigned_role)  filters.assignedRole = req.query.assigned_role as string;
  }

  const result = await listProvisioningRequests(filters);
  return res.json({ success: true, ...result });
}));

// ── GET /api/it-provisioning/requests/:id ─────────────────────────────────────
router.get('/requests/:id', requireRole('admin', 'branch_it', 'wfm', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

// ── PATCH /api/it-provisioning/requests/:id/action ───────────────────────────
router.patch('/requests/:id/action', requireRole('admin', 'branch_it', 'wfm', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { evidence_note } = req.body as { evidence_note?: string };
  await actionProvisioningRequest({
    requestId:    req.params.id,
    actionedBy:   req.authUser!.id,
    evidenceNote: evidence_note,
  });
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

// ── PATCH /api/it-provisioning/requests/:id/waive ────────────────────────────
router.patch('/requests/:id/waive', requireRole('admin', 'branch_it', 'wfm', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { evidence_note } = req.body as { evidence_note?: string };
  await waiveProvisioningRequest({
    requestId:    req.params.id,
    actionedBy:   req.authUser!.id,
    evidenceNote: evidence_note ?? '',
  });
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

// ── POST /api/it-provisioning/requests/:id/confirm ───────────────────────────
// Admin-only: manually lock a request immediately
router.post('/requests/:id/confirm', requireRole('admin', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  await confirmAndLockRequest(req.params.id, req.authUser!.id);
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

export { router as itProvisioningRouter };
