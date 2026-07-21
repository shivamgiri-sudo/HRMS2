import { Router } from "express";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  assertFinanceRecordBranch,
  resolveFinanceBranchScope,
} from "../finance/finance-access-scope.js";
import { resolveFinanceStageRole } from "../finance/finance-workflow-role.js";
import { bpoPnlRouter } from "./bpo-pnl.routes.js";
import { pnlBulkUploadRouter } from "./pnl-bulk-upload.routes.js";
import { branchBudgetService } from "./branch-budget.service.js";
import { processPnlGovernanceService } from "./process-pnl.governance.service.js";
import { processPnlService } from "./process-pnl.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

const PNL_READ_ROLES = [
  "super_admin",
  "admin",
  "ceo",
  "coo",
  "finance",
  "finance_head",
  "accounts_head",
  "payroll_head",
] as const;

const PNL_WRITE_ROLES = [
  "super_admin",
  "admin",
  "finance",
  "finance_head",
  "accounts_head",
  "payroll_head",
] as const;

const PNL_SIGNOFF_ROLES = [...PNL_WRITE_ROLES, "ceo", "coo"] as const;
const BUDGET_READ_ROLES = [
  "super_admin",
  "admin",
  "branch_admin",
  "branch_head",
  "finance",
  "finance_head",
  "accounts_head",
] as const;
const BUDGET_CREATE_ROLES = ["super_admin", "admin", "branch_admin"] as const;
const BUDGET_REVIEW_ROLES = ["branch_head", "finance_head", "accounts_head", "super_admin"] as const;

function actor(req: AuthenticatedRequest) {
  return {
    id: req.authUser.id,
    role: String(req.authUser.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: req.userRoles ?? [],
  };
}

async function scopedBudget(req: AuthenticatedRequest, budgetId: string) {
  const user = actor(req);
  const budget = await branchBudgetService.get(budgetId) as any;
  await assertFinanceRecordBranch({
    userId: user.id,
    primaryRole: user.role,
    userRoles: user.roles,
    recordBranchId: budget.branch_id,
  });
  return budget;
}

router.use(requireAuth);

router.get(
  "/pnl/budgets",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchId = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    });
    const data = await branchBudgetService.list({
      period: req.query.period ? String(req.query.period) : undefined,
      branchId,
      status: req.query.status ? String(req.query.status) : undefined,
    });
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/budgets/:id",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const data = await scopedBudget(req, req.params.id);
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/budget-lines/available",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchId = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    });
    if (!branchId) throw new Error("Branch is required");
    const data = await branchBudgetService.availableLines({
      branchId,
      processId: req.query.processId ? String(req.query.processId) : undefined,
      costCentreId: req.query.costCentreId
        ? String(req.query.costCentreId)
        : undefined,
      period: req.query.period ? String(req.query.period) : undefined,
    });
    res.json({ success: true, data });
  })
);

router.post(
  "/pnl/budgets",
  requireWriteAccess,
  requireRole(...BUDGET_CREATE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchId = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.body?.branchId,
    });
    if (!branchId) throw new Error("Branch is required");
    const data = await branchBudgetService.saveDraft(
      { ...req.body, branchId },
      user.id,
      user.role
    );
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/pnl/budgets/:id/submit",
  requireWriteAccess,
  requireRole(...BUDGET_CREATE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    await scopedBudget(req, req.params.id);
    const data = await branchBudgetService.submit(
      req.params.id,
      user.id,
      user.role
    );
    res.json({ success: true, data });
  })
);

router.post(
  "/pnl/budgets/:id/review",
  requireWriteAccess,
  requireRole(...BUDGET_REVIEW_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const budget = await scopedBudget(req, req.params.id);
    const decision = String(req.body?.decision ?? "") as
      | "approve"
      | "reject"
      | "revision";
    if (!["approve", "reject", "revision"].includes(decision)) {
      throw new Error("Invalid budget decision");
    }
    const effectiveRole = resolveFinanceStageRole({
      primaryRole: user.role,
      userRoles: user.roles,
      currentStatus: String(budget.status ?? ""),
      workflow: "budget",
    });
    const data = await branchBudgetService.review(
      req.params.id,
      decision,
      user.id,
      effectiveRole,
      req.body?.remarks ? String(req.body.remarks) : undefined
    );
    res.json({ success: true, data });
  })
);

router.use(requireRole(...PNL_READ_ROLES));
router.use("/pnl/bpo", bpoPnlRouter);
router.use("/", pnlBulkUploadRouter);

function readFilters(req: AuthenticatedRequest, scopedBranchId?: string | null) {
  return {
    period: req.query.period ? String(req.query.period) : undefined,
    branchId: scopedBranchId ?? (req.query.branchId ? String(req.query.branchId) : undefined),
    processId: req.query.processId ? String(req.query.processId) : undefined,
    clientId: req.query.clientId ? String(req.query.clientId) : undefined,
    search: req.query.search ? String(req.query.search) : undefined,
  };
}

async function scopedFilters(req: AuthenticatedRequest) {
  const user = req.authUser;
  const branchId = await resolveFinanceBranchScope({
    userId: user.id,
    primaryRole: user.role,
    userRoles: req.userRoles,
    requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
  });
  return readFilters(req, branchId);
}

router.get("/pnl/summary", h(async (req, res) => {
  const data = await processPnlService.getSummary(await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes", h(async (req, res) => {
  const data = await processPnlService.listProcesses(await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/overview", h(async (req, res) => {
  const data = await processPnlService.getOverview(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/revenue", h(async (req, res) => {
  const data = await processPnlService.getRevenue(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/workforce", h(async (req, res) => {
  const data = await processPnlService.getWorkforce(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/people-cost", h(async (req, res) => {
  const data = await processPnlService.getPeopleCost(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/direct-cost", h(async (req, res) => {
  const data = await processPnlService.getDirectCost(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/indirect-allocation", h(async (req, res) => {
  const data = await processPnlService.getIndirectAllocation(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/trend", h(async (req, res) => {
  const data = await processPnlService.getTrend(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/reconciliation", h(async (req, res) => {
  const data = await processPnlService.getReconciliation(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/ledger", h(async (req, res) => {
  const data = await processPnlService.getLedger(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/detail", h(async (req, res) => {
  const data = await processPnlService.getDetailBundle(req.params.processId, await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/config/reference-data", h(async (_req, res) => {
  const data = await processPnlGovernanceService.getReferenceData();
  res.json({ success: true, data });
}));

router.get("/pnl/config/contracts", h(async (_req, res) => {
  const data = await processPnlGovernanceService.listContracts();
  res.json({ success: true, data });
}));

router.get("/pnl/config/rates", h(async (_req, res) => {
  const data = await processPnlGovernanceService.listRates();
  res.json({ success: true, data });
}));

router.get("/pnl/config/monthly-plan", h(async (req, res) => {
  const data = await processPnlGovernanceService.listMonthlyPlans(
    req.query.period ? String(req.query.period) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/pnl/config/periods", h(async (_req, res) => {
  const data = await processPnlGovernanceService.listPeriods();
  res.json({ success: true, data });
}));

router.get("/pnl/config/adjustments", h(async (req, res) => {
  const data = await processPnlGovernanceService.listAdjustments(
    req.query.period ? String(req.query.period) : undefined,
    req.query.processId ? String(req.query.processId) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/pnl/period-close", h(async (req, res) => {
  const data = await processPnlGovernanceService.getPeriodClose(
    req.query.period ? String(req.query.period) : undefined,
    req.userRoles,
    req.authUser.role
  );
  res.json({ success: true, data });
}));

router.get("/pnl/export", h(async (req, res) => {
  const csv = await processPnlService.exportCsv(await scopedFilters(req));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="process-pnl-${req.query.period ?? "current"}.csv"`
  );
  res.send(csv);
}));

router.post("/pnl/contracts", requireWriteAccess, requireRole(...PNL_WRITE_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.saveContract(req.body, req.authUser.id);
  res.status(201).json({ success: true, data });
}));

router.post("/pnl/rates", requireWriteAccess, requireRole(...PNL_WRITE_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.saveRate(req.body, req.authUser.id);
  res.status(201).json({ success: true, data });
}));

router.post("/pnl/monthly-plan", requireWriteAccess, requireRole(...PNL_WRITE_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.saveMonthlyPlan(req.body, req.authUser.id);
  res.status(201).json({ success: true, data });
}));

router.post("/pnl/adjustments", requireWriteAccess, requireRole(...PNL_WRITE_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.createAdjustment(req.body, req.authUser.id);
  res.status(201).json({ success: true, data });
}));

router.post("/pnl/adjustments/:adjustmentId/approve", requireWriteAccess, requireRole(...PNL_WRITE_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.approveAdjustment(
    req.params.adjustmentId,
    req.authUser.id
  );
  res.json({ success: true, data });
}));

router.post("/pnl/adjustments/:adjustmentId/reject", requireWriteAccess, requireRole(...PNL_WRITE_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.rejectAdjustment(
    req.params.adjustmentId,
    req.authUser.id,
    req.body?.reason ? String(req.body.reason) : null
  );
  res.json({ success: true, data });
}));

router.post("/pnl/adjustments/:adjustmentId/reverse", requireWriteAccess, requireRole(...PNL_WRITE_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.reverseAdjustment(
    req.params.adjustmentId,
    req.authUser.id,
    req.body?.reason ? String(req.body.reason) : null
  );
  res.json({ success: true, data });
}));

router.post("/pnl/recalculate", requireWriteAccess, requireRole(...PNL_WRITE_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.recalculate(
    req.body?.period ? String(req.body.period) : undefined
  );
  res.json({ success: true, data });
}));

router.post("/pnl/period/:periodId/signoff", requireWriteAccess, requireRole(...PNL_SIGNOFF_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.signoffPeriod(
    req.params.periodId,
    req.body?.note ? String(req.body.note) : null,
    req.authUser.id,
    req.userRoles,
    req.authUser.role
  );
  res.json({ success: true, data });
}));

router.post("/pnl/period/:periodId/lock", requireWriteAccess, requireRole(...PNL_SIGNOFF_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.lockPeriod(
    req.params.periodId,
    req.authUser.id
  );
  res.json({ success: true, data });
}));

export { router as processPnlRouter };
