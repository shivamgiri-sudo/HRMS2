import { Router } from "express";
import {
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  assertFinanceRecordBranch,
  resolveFinanceBranchScope,
} from "../finance/finance-access-scope.js";
import { branchBudgetService } from "./branch-budget.service.js";
import { budgetCoverageService } from "./budget-coverage.service.js";
import { checkBudgetExceptions } from "./budget-readiness.service.js";

const READ_ROLES = [
  "super_admin",
  "admin",
  "branch_admin",
  "branch_head",
  "finance",
  "finance_head",
  "accounts_head",
  // ceo/coo were absent here while being present in PNL_READ_ROLES, so they 403d on this
  // endpoint. That is worse than a plain denial: the frontend reads branchLocked off a
  // SUCCESSFUL capabilities call (BranchBudgetManagementWorkspace.tsx), and treats any
  // failure as "scope unknown -> lock the picker". With no scopedBranchId to filter on, the
  // branch dropdown then rendered ZERO branches — the whole workspace was unusable for the
  // four live ceo-role holders. Both already hold global finance scope via
  // OVERRIDING_GLOBAL_FINANCE_ROLES, so this grants no data they were not already entitled
  // to on every other P&L surface; it only stops the page locking itself.
  "ceo",
  "coo",
] as const;
const CREATE_ROLES = ["super_admin", "admin", "branch_admin"] as const;

function actor(req: AuthenticatedRequest) {
  return {
    id: req.authUser.id,
    role: String(req.authUser.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: req.userRoles ?? [],
  };
}

function normalizedRoles(req: AuthenticatedRequest) {
  return Array.from(
    new Set([req.authUser.role, ...(req.userRoles ?? [])].filter(Boolean).map((role) => String(role).toLowerCase()))
  );
}

async function scopedBudget(req: AuthenticatedRequest, budgetId: string) {
  const user = actor(req);
  const budget = await branchBudgetService.get(budgetId) as any;
  await assertFinanceRecordBranch({
    userId: user.id,
    primaryRole: user.role,
    userRoles: user.roles,
    recordBranchId: String(budget.branch_id),
  });
  return budget;
}

export const budgetCoverageRouter = Router();

budgetCoverageRouter.get(
  "/pnl/budgets/capabilities",
  requireRole(...READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const roles = normalizedRoles(req);
      // branch_head / branch_admin users who are not linked to an active employee record
      // fail here with "not mapped to an active employee branch". Their review capabilities
      // (canReviewBranchStage) are still valid — the branch filter just cannot be derived.
      // Catch and default to undefined so the response succeeds and buttons appear.
      let scopedBranchId: string | undefined = undefined;
      try {
        scopedBranchId = await resolveFinanceBranchScope({
          userId: user.id,
          primaryRole: user.role,
          userRoles: user.roles,
        });
      } catch {
        // Not all reviewer accounts have a mapped employee row — capabilities still apply.
      }
      const isSuperAdmin = roles.includes("super_admin");
      res.json({
        success: true,
        data: {
          roles,
          scopedBranchId,
          branchLocked: Boolean(scopedBranchId),
          // Must mirror BUDGET_CREATE_ROLES in process-pnl.routes.ts exactly. It previously
          // also listed branch_head/finance_head/accounts_head, none of which the create
          // route accepts — so those roles were shown an enabled "Create budget" control that
          // always 403d on submit. The route is the security boundary; this is only the UI
          // telling the truth about it. (A finance_head who also holds branch_admin, which is
          // the live case, still gets canCreate through branch_admin.)
          canCreate: isSuperAdmin || roles.some(r => ["admin", "branch_admin"].includes(r)),
          canManageExpenseMaster: isSuperAdmin || roles.includes("finance_head"),
          // Changing or removing a head/sub-head that budgets already reference is Super Admin
          // only; Finance Head keeps the ability to add new ones via canManageExpenseMaster.
          canEditExpenseMaster: isSuperAdmin,
          // Finance Head reviews at EVERY stage (owner decision, 2026-08-19), so it appears in
          // both. Must stay in step with REVIEW_STAGES in branch-budget.service.ts, which is
          // the enforcing side — these flags only decide whether the UI offers the buttons.
          // The Accounts Head review stage was removed from this workflow (owner decision,
          // 2026-08-21) — that flag no longer exists here; accounts_head remains a valid role
          // for other, unrelated finance workflows (GRN reversal, budget transfer, P&L signoff).
          canReviewBranchStage: isSuperAdmin || roles.some(r => ["branch_head", "finance_head"].includes(r)),
          canReviewFinanceStage: isSuperAdmin || roles.includes("finance_head"),
          // Finance Head direct budget top-up (owner decision, 2026-08-21): finance_head +
          // super_admin only, deliberately excluding branch_admin/branch_head/accounts_head.
          canDirectTopup: isSuperAdmin || roles.includes("finance_head"),
          // Monthly business-case close (owner decision, 2026-08-21): Branch Admin and Finance
          // Head only, per the owner's own wording — deliberately excludes branch_head, unlike
          // canReviewBranchStage above.
          canCloseBusinessCase: isSuperAdmin || roles.some(r => ["branch_admin", "finance_head"].includes(r)),
          // Reopening a closed head/sub-head needs Finance Head approval — same actors as
          // canReviewFinanceStage, kept as its own flag since the two questions ("can I approve a
          // budget stage" vs "can I approve a reopen request") are conceptually separate even
          // though the role set is identical today.
          canReviewReopen: isSuperAdmin || roles.includes("finance_head"),
        },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to resolve budget capabilities",
      });
    }
  }
);

budgetCoverageRouter.post(
  "/pnl/budgets",
  requireWriteAccess,
  requireRole(...CREATE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const branchId = await resolveFinanceBranchScope({
        userId: user.id,
        primaryRole: user.role,
        userRoles: user.roles,
        requestedBranchId: req.body?.branchId,
      });
      if (!branchId) throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
      const budget = await branchBudgetService.saveDraft(
        { ...req.body, branchId },
        user.id,
        user.role
      ) as any;
      await budgetCoverageService.syncPlannedFromLines(String(budget.id), user.id);
      const data = await branchBudgetService.get(String(budget.id)) as any;
      const exceptions = await checkBudgetExceptions(String(budget.id));
      res.status(201).json({ success: true, data: { ...data, exceptions } });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to save budget",
      });
    }
  }
);

budgetCoverageRouter.get(
  "/pnl/budgets/:id/coverage",
  requireRole(...READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      await scopedBudget(req, req.params.id);
      const data = await budgetCoverageService.getCoverage(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to load budget coverage",
      });
    }
  }
);

budgetCoverageRouter.put(
  "/pnl/budgets/:id/coverage",
  requireWriteAccess,
  requireRole(...CREATE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      await scopedBudget(req, req.params.id);
      const data = await budgetCoverageService.saveCoverage(
        req.params.id,
        Array.isArray(req.body?.entries) ? req.body.entries : [],
        user.id
      );
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to save budget coverage",
      });
    }
  }
);

budgetCoverageRouter.post(
  "/pnl/budgets/:id/submit",
  requireWriteAccess,
  requireRole(...CREATE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      await scopedBudget(req, req.params.id);
      await budgetCoverageService.submitBudget(
        req.params.id,
        user.id,
        user.role
      );
      const data = await branchBudgetService.get(req.params.id) as any;
      const exceptions = await checkBudgetExceptions(req.params.id);
      res.json({ success: true, data: { ...data, exceptions } });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to submit budget",
      });
    }
  }
);
