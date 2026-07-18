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

const READ_ROLES = [
  "super_admin",
  "admin",
  "branch_admin",
  "branch_head",
  "finance",
  "finance_head",
  "accounts_head",
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
      const scopedBranchId = await resolveFinanceBranchScope({
        userId: user.id,
        primaryRole: user.role,
        userRoles: user.roles,
      });
      const isSuperAdmin = roles.includes("super_admin");
      res.json({
        success: true,
        data: {
          roles,
          scopedBranchId,
          branchLocked: Boolean(scopedBranchId),
          canCreate: isSuperAdmin || roles.includes("admin") || roles.includes("branch_admin"),
          canManageExpenseMaster: isSuperAdmin || roles.includes("finance_head"),
          canReviewBranchStage: isSuperAdmin || roles.includes("branch_head"),
          canReviewFinanceStage: isSuperAdmin || roles.includes("finance_head"),
          canReviewAccountsStage: isSuperAdmin || roles.includes("accounts_head"),
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
      if (!branchId) throw new Error("Branch is required");
      const budget = await branchBudgetService.saveDraft(
        { ...req.body, branchId },
        user.id,
        user.role
      ) as any;
      await budgetCoverageService.syncPlannedFromLines(String(budget.id), user.id);
      const data = await branchBudgetService.get(String(budget.id));
      res.status(201).json({ success: true, data });
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
      const data = await branchBudgetService.get(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to submit budget",
      });
    }
  }
);
