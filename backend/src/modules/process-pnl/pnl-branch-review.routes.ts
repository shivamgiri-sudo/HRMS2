import { Router, type NextFunction, type Response } from "express";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { assertFinanceRecordBranch, resolveFinanceBranchScopeSet } from "../finance/finance-access-scope.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { refuse } from "./finance-error.js";
import { acknowledgeBranch, getBranchReview, getQueryBranch, raiseQuery, resolveQuery } from "./pnl-branch-review.service.js";

/**
 * /api/finance/pnl-branch-review: a branch reviews its monthly P&L (migration 2158).
 * Branch Head / Branch Admin acknowledge or raise queries for their own branch; Finance resolves queries.
 * Every read and write is branch-scoped through finance-access-scope, like the revenue forecast.
 */
const READ_ROLES = ["super_admin", "admin", "branch_head", "branch_admin", "finance_head", "payroll_head", "accounts_head", "finance", "ceo", "coo"] as const;
const REVIEW_ROLES = ["super_admin", "branch_head", "branch_admin"] as const;
const RESOLVE_ROLES = ["super_admin", "finance_head", "accounts_head", "finance"] as const;

export const pnlBranchReviewRouter = Router();
pnlBranchReviewRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

function actor(req: AuthenticatedRequest) {
  return {
    id: req.authUser.id,
    role: String(req.authUser.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: (req.userRoles ?? []).map((r) => String(r).toLowerCase()),
  };
}

/** finance-access-scope refuses with a plain Error; answer 403, not 500. */
async function forbiddenOnScope<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    if (!err.statusCode && /^(Your user account is not mapped|You cannot access|You can only access)/.test(String(err.message))) err.statusCode = 403;
    throw err;
  }
}

async function assertBranch(req: AuthenticatedRequest, branchId: string) {
  const u = actor(req);
  await forbiddenOnScope(assertFinanceRecordBranch({ userId: u.id, primaryRole: u.role, userRoles: u.roles, recordBranchId: branchId }));
}

pnlBranchReviewRouter.get(
  "/",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const u = actor(req);
    const scope = await forbiddenOnScope(resolveFinanceBranchScopeSet({
      userId: u.id, primaryRole: u.role, userRoles: u.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    }));
    const data = await getBranchReview(String(req.query.period ?? ""), scope.mode === "all" ? null : scope.branchIds);
    res.json({ success: true, data });
  }),
);

pnlBranchReviewRouter.post(
  "/acknowledge",
  requireWriteAccess,
  requireRole(...REVIEW_ROLES),
  h(async (req, res) => {
    const branchId = String(req.body?.branchId ?? "");
    const period = String(req.body?.period ?? "");
    if (!branchId) throw refuse(400, "BRANCH_REQUIRED", "Choose a branch");
    await assertBranch(req, branchId);
    const figures = await acknowledgeBranch(branchId, period, actor(req).id, req.body?.comment ?? null);
    await writeAuditLog({
      actor_user_id: actor(req).id, actor_role: actor(req).role, action_type: "PNL_BRANCH_REVIEW_ACKNOWLEDGE",
      module_key: "finance", entity_type: "pnl_branch_review", entity_id: `${branchId}:${period}`, req,
      new_value_json: figures as unknown as Record<string, unknown>,
    });
    res.json({ success: true, data: figures });
  }),
);

pnlBranchReviewRouter.post(
  "/queries",
  requireWriteAccess,
  requireRole(...REVIEW_ROLES),
  h(async (req, res) => {
    const branchId = String(req.body?.branchId ?? "");
    if (!branchId) throw refuse(400, "BRANCH_REQUIRED", "Choose a branch");
    await assertBranch(req, branchId);
    const data = await raiseQuery({
      branchId, period: String(req.body?.period ?? ""), section: String(req.body?.section ?? ""),
      costCentreId: req.body?.costCentreId ? String(req.body.costCentreId) : null, message: String(req.body?.message ?? ""),
    }, actor(req).id);
    await writeAuditLog({
      actor_user_id: actor(req).id, actor_role: actor(req).role, action_type: "PNL_BRANCH_REVIEW_QUERY_RAISED",
      module_key: "finance", entity_type: "pnl_branch_review_query", entity_id: data.id, req,
    });
    res.json({ success: true, data });
  }),
);

pnlBranchReviewRouter.post(
  "/queries/:id/resolve",
  requireWriteAccess,
  requireRole(...RESOLVE_ROLES),
  h(async (req, res) => {
    const q = await getQueryBranch(req.params.id);
    if (!q) throw refuse(404, "QUERY_NOT_FOUND", "Query not found");
    await resolveQuery(req.params.id, actor(req).id, req.body?.note ?? null);
    await writeAuditLog({
      actor_user_id: actor(req).id, actor_role: actor(req).role, action_type: "PNL_BRANCH_REVIEW_QUERY_RESOLVED",
      module_key: "finance", entity_type: "pnl_branch_review_query", entity_id: req.params.id, req,
    });
    res.json({ success: true });
  }),
);
