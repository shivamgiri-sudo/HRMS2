import { Router, type Response } from "express";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  assertFinanceRecordBranch,
  resolveFinanceBranchScope,
} from "./finance-access-scope.js";
import { costCentreManagementService } from "./cost-centre-management.service.js";
import type { RoleKey } from "../../platform/policy/index.js";

// ============================================================================
// Role definitions
// ============================================================================

const CC_READ_ROLES: RoleKey[] = [
  "super_admin",
  "admin",
  "finance_head",
  "accounts_head",
  "finance",
  "branch_head",
  "branch_admin",
];

const CC_CREATE_ROLES: RoleKey[] = ["super_admin", "admin", "finance_head", "accounts_head"];

const CC_L1_APPROVAL_ROLES: RoleKey[] = ["super_admin", "admin", "finance_head", "accounts_head"];

const CC_L2_APPROVAL_ROLES: RoleKey[] = ["super_admin", "admin"];

// ============================================================================
// Helpers
// ============================================================================

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) =>
    fn(req, res).catch(next);

/**
 * The branch this caller may read, from the one they asked for.
 *
 * CC_READ_ROLES admits branch_head and branch_admin, and neither holds global finance scope —
 * but no endpoint in this file resolved a branch, so both saw all 927 cost centres across all
 * 26 branches, and list() applied its branch_id filter only when the CLIENT chose to send one.
 *
 * It was latent until yesterday: migration 1129 seeded the FINANCE_COST_CENTRES page grants that
 * had never existed, so before that only super_admin could reach the page at all. Granting the
 * page is what made the missing scope reachable.
 *
 * resolveFinanceBranchScope returns the requested branch unchanged for a global finance role,
 * pins a branch-scoped caller to their own, and refuses a request for someone else's rather than
 * quietly substituting — the same treatment every other finance read already gets.
 */
function scopedBranchId(req: AuthenticatedRequest, requested?: unknown) {
  return resolveFinanceBranchScope({
    userId: req.authUser!.id,
    primaryRole: req.authUser!.role,
    userRoles: req.userRoles,
    requestedBranchId: requested ? String(requested) : undefined,
  });
}

/** Refuses a record that belongs to a branch this caller may not see. */
async function assertRecordBranch(req: AuthenticatedRequest, branchId: unknown) {
  await assertFinanceRecordBranch({
    userId: req.authUser!.id,
    primaryRole: req.authUser!.role,
    userRoles: req.userRoles,
    recordBranchId: String(branchId ?? ""),
  });
}

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw Object.assign(new Error("Authenticated user required"), { statusCode: 401 });
  return {
    id,
    role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown"),
  };
}

function primaryRole(req: AuthenticatedRequest): string {
  return String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown").toLowerCase();
}

// ============================================================================
// Router
// ============================================================================

const router = Router();

router.use(requireAuth);

/**
 * GET /api/finance/cost-centres
 * List cost centres with filters
 */
router.get(
  "/",
  requireRole(...CC_READ_ROLES),
  h(async (req, res) => {
    const { q, status, client_id, client_name, branch_id, page, limit } = req.query;
    const result = await costCentreManagementService.list({
      q: q as string,
      status: status as any,
      client_id: client_id as string,
      // The filter that actually matches anything — client_id is NULL on every row.
      client_name: client_name as string,
      branch_id: await scopedBranchId(req, branch_id),
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 50,
    });
    res.json(result);
  })
);

/**
 * GET /api/finance/cost-centres/status-counts
 * Get status counts for dashboard
 */
router.get(
  "/status-counts",
  requireRole(...CC_READ_ROLES),
  h(async (req, res) => {
    // Scoped like the list, so the tab badges cannot advertise rows the tab will not show.
    const counts = await costCentreManagementService.getStatusCounts(
      await scopedBranchId(req, req.query.branch_id)
    );
    res.json({ data: counts });
  })
);

/**
 * GET /api/finance/cost-centres/approval-queue
 * Get items pending approval for current user's role
 */
router.get(
  "/approval-queue",
  requireRole(...CC_L1_APPROVAL_ROLES),
  h(async (req, res) => {
    const role = primaryRole(req);
    const queue = await costCentreManagementService.getApprovalQueue(role);
    res.json({ data: queue });
  })
);

/**
 * GET /api/finance/cost-centres/:id
 * Get cost centre by ID with contacts and history
 */
router.get(
  "/:id",
  requireRole(...CC_READ_ROLES),
  h(async (req, res) => {
    const item = await costCentreManagementService.getById(req.params.id);
    if (!item) return res.status(404).json({ error: "Cost centre not found" });
    // Fetched first, asserted second: the branch cannot be known until the row is read. A uuid
    // is not an access control, and this record carries the client, the billing rates and the
    // whole approval trail.
    await assertRecordBranch(req, (item as { branch_id?: unknown }).branch_id);
    res.json({ data: item });
  })
);

/**
 * GET /api/finance/cost-centres/:id/history
 * Get approval history for a cost centre
 */
router.get(
  "/:id/history",
  requireRole(...CC_READ_ROLES),
  h(async (req, res) => {
    // Same guard as the record itself — the history carries reviewer commentary and rejection
    // reasons, which is the most candid text this module holds.
    const item = await costCentreManagementService.getById(req.params.id);
    if (!item) return res.status(404).json({ error: "Cost centre not found" });
    await assertRecordBranch(req, (item as { branch_id?: unknown }).branch_id);
    const history = await costCentreManagementService.getApprovalHistory(req.params.id);
    res.json({ data: history });
  })
);

/**
 * POST /api/finance/cost-centres
 * Create new cost centre (draft)
 */
router.post(
  "/",
  requireRole(...CC_CREATE_ROLES),
  h(async (req, res) => {
    const item = await costCentreManagementService.create(req.body, actor(req));
    res.status(201).json({ data: item });
  })
);

/**
 * PUT /api/finance/cost-centres/:id
 * Update cost centre (only draft/revision_required)
 */
router.put(
  "/:id",
  requireRole(...CC_CREATE_ROLES),
  h(async (req, res) => {
    const item = await costCentreManagementService.update(req.params.id, req.body, actor(req));
    res.json({ data: item });
  })
);

/**
 * POST /api/finance/cost-centres/:id/submit
 * Submit for L1 approval
 */
router.post(
  "/:id/submit",
  requireRole(...CC_CREATE_ROLES),
  h(async (req, res) => {
    const item = await costCentreManagementService.submit(req.params.id, actor(req));
    res.json({ data: item });
  })
);

/**
 * POST /api/finance/cost-centres/:id/approve-l1
 * L1 approval (Finance Head / Accounts Head)
 */
router.post(
  "/:id/approve-l1",
  requireRole(...CC_L1_APPROVAL_ROLES),
  h(async (req, res) => {
    const { remarks } = req.body;
    const item = await costCentreManagementService.approveL1(req.params.id, actor(req), remarks);
    res.json({ data: item });
  })
);

/**
 * POST /api/finance/cost-centres/:id/approve-l2
 * L2 approval (Super Admin / CEO)
 */
router.post(
  "/:id/approve-l2",
  requireRole(...CC_L2_APPROVAL_ROLES),
  h(async (req, res) => {
    const { remarks } = req.body;
    const item = await costCentreManagementService.approveL2(req.params.id, actor(req), remarks);
    res.json({ data: item });
  })
);

/**
 * POST /api/finance/cost-centres/:id/reject
 * Reject at any pending stage
 */
router.post(
  "/:id/reject",
  requireRole(...CC_L1_APPROVAL_ROLES),
  h(async (req, res) => {
    const { reason } = req.body;
    if (!reason?.trim()) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }
    const item = await costCentreManagementService.reject(req.params.id, actor(req), reason);
    res.json({ data: item });
  })
);

/**
 * POST /api/finance/cost-centres/:id/request-revision
 * Send back for revision
 */
router.post(
  "/:id/request-revision",
  requireRole(...CC_L1_APPROVAL_ROLES),
  h(async (req, res) => {
    const { reason } = req.body;
    if (!reason?.trim()) {
      return res.status(400).json({ error: "Revision reason is required" });
    }
    const item = await costCentreManagementService.requestRevision(req.params.id, actor(req), reason);
    res.json({ data: item });
  })
);

/**
 * POST /api/finance/cost-centres/:id/activate
 * Activate an approved cost centre
 */
router.post(
  "/:id/activate",
  requireRole(...CC_L2_APPROVAL_ROLES),
  h(async (req, res) => {
    const item = await costCentreManagementService.activate(req.params.id, actor(req));
    res.json({ data: item });
  })
);

/**
 * POST /api/finance/cost-centres/:id/close
 * Close an active cost centre
 */
router.post(
  "/:id/close",
  requireRole(...CC_L1_APPROVAL_ROLES),
  h(async (req, res) => {
    const { reason } = req.body;
    const item = await costCentreManagementService.close(req.params.id, actor(req), reason);
    res.json({ data: item });
  })
);

export const costCentreManagementRouter = router;
