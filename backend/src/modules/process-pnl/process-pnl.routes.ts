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
import { canonicalPnlService } from "./canonical-pnl.service.js";
import { pnlBulkUploadRouter } from "./pnl-bulk-upload.routes.js";
import { branchBudgetService } from "./branch-budget.service.js";
import { branchBudgetAllocationService } from "./branch-budget-allocation.service.js";
import { pnlStatementService, type StatementViewBy } from "./pnl-statement.service.js";
import { processLobRouter } from "./process-lob.routes.js";
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
      costCentreId: req.query.costCentreId ? String(req.query.costCentreId) : undefined,
      period: req.query.period ? String(req.query.period) : undefined,
    });
    res.json({ success: true, data });
  })
);

// NOTE: POST /pnl/budgets and POST /pnl/budgets/:id/submit are owned exclusively by
// budgetCoverageRouter (backend/src/modules/process-pnl/budget-coverage.routes.ts), which is
// mounted ahead of this router (via grn.routes.ts, app.ts). Registering them here as well used
// to shadow-collide with identical paths and leave this router's handlers dead code (Express
// resolves to whichever router registered the path first). Do not re-add them here — extend
// budgetCoverageService instead so there is exactly one submit/create path.

router.post(
  "/pnl/budgets/:id/review",
  requireWriteAccess,
  requireRole(...BUDGET_REVIEW_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const budget = await scopedBudget(req, req.params.id);
    const decision = String(req.body?.decision ?? "") as "approve" | "reject" | "revision";
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

router.get(
  "/pnl/branch-budget/cost-centres",
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
    const data = await branchBudgetAllocationService.listActiveCostCentres(branchId);
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/branch-budget/monthly-drivers",
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
    const periodCode = String(req.query.period ?? "");
    if (!/^\d{4}-\d{2}$/.test(periodCode)) throw new Error("A valid budget period (YYYY-MM) is required");
    const data = await branchBudgetAllocationService.getMonthlyDrivers(branchId, periodCode);
    res.json({ success: true, data });
  })
);

router.put(
  "/pnl/branch-budget/monthly-drivers",
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
    const periodCode = String(req.body?.periodCode ?? "");
    if (!/^\d{4}-\d{2}$/.test(periodCode)) throw new Error("A valid budget period (YYYY-MM) is required");
    const drivers = Array.isArray(req.body?.drivers) ? req.body.drivers : [];
    const data = await branchBudgetAllocationService.saveMonthlyDrivers(
      branchId,
      periodCode,
      drivers.map((d: any) => ({
        costCentreId: String(d.costCentreId),
        plannedHeadcount: Number(d.plannedHeadcount ?? 0),
        revenueRatePerHead: Number(d.revenueRatePerHead ?? 0),
        remarks: d.remarks ? String(d.remarks) : null,
      })),
      user.id
    );
    res.json({ success: true, data });
  })
);

router.use(requireRole(...PNL_READ_ROLES));
router.use("/pnl/bpo", bpoPnlRouter);
router.use("/pnl/lobs", processLobRouter);
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

// The legacy processPnlService detail routes (below) compute their own
// contributionMargin/operatingProfit/operatingMarginPct from a simpler
// revenue-direct-indirect formula with no EBITDA/D&A/finance-cost/tax concept, while
// canonicalPnlService's bpo_allocation_v2 engine computes a full EBITDA->EBIT->PBT->PAT
// waterfall from GRN/vendor-allocation-aware cost inputs. The two can diverge for the same
// process/period. Rather than restructure the service layering (process-pnl.service.ts is the
// upstream base-row input for bpo-pnl.service.ts, so it cannot import canonical/bpo services
// without creating a circular dependency), this composes both at the route layer: legacy
// breakdown data stays as-is, but the profit/margin figures are always overwritten with the
// canonical numbers before the response is sent.
async function fetchCanonicalProfitRow(
  processId: string,
  filters: Partial<import("./process-pnl.types.js").PnlQueryFilters>
): Promise<Record<string, unknown> | null> {
  try {
    const canonical = await canonicalPnlService.getProcessDetail(processId, filters);
    return (canonical as { row?: Record<string, unknown> })?.row ?? null;
  } catch {
    // Canonical detail unavailable for this process (e.g. no revenue rule configured yet) —
    // callers fall back to the legacy figures but flag it so the drift is visible, not silently
    // hidden.
    return null;
  }
}

function mergeCanonicalProfit(
  legacy: object,
  row: Record<string, unknown> | null
): Record<string, unknown> & { calculationEngine: string } {
  const base = legacy as Record<string, unknown>;
  if (!row) return { ...base, calculationEngine: "legacy_fallback" };
  return {
    ...base,
    contributionMargin: row.contribution,
    contributionMarginPct: row.contributionMarginPct,
    operatingProfit: row.ebit,
    operatingMarginPct: row.operatingProfitPct,
    ebitda: row.ebitda,
    ebitdaMarginPct: row.ebitdaMarginPct,
    pbt: row.pbt,
    pat: row.pat,
    calculationEngine: "bpo_allocation_v2",
  };
}

async function overlayCanonicalProfit(
  processId: string,
  filters: Partial<import("./process-pnl.types.js").PnlQueryFilters>,
  legacy: object
): Promise<Record<string, unknown> & { calculationEngine: string }> {
  const row = await fetchCanonicalProfitRow(processId, filters);
  return mergeCanonicalProfit(legacy, row);
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

// Canonical endpoints: summary/trend/export/close all use the same allocation-aware engine.
router.get("/pnl/summary", h(async (req, res) => {
  const data = await canonicalPnlService.getSummary(await scopedFilters(req));
  res.json({ success: true, data });
}));

// Transposed statement (P&L components as rows, entities as dynamic columns) — read-only
// composition over the same canonical engine as /pnl/summary. See pnl-statement.service.ts.
router.get("/pnl/statement", h(async (req, res) => {
  const viewBy = (req.query.viewBy ? String(req.query.viewBy) : "process") as StatementViewBy;
  const data = await pnlStatementService.getStatement(await scopedFilters(req), viewBy);
  res.json({ success: true, data });
}));

// Keep the legacy process list contract for existing detail-page consumers.
router.get("/pnl/processes", h(async (req, res) => {
  const data = await processPnlService.listProcesses(await scopedFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/overview", h(async (req, res) => {
  const filters = await scopedFilters(req);
  const legacy = await processPnlService.getOverview(req.params.processId, filters);
  const data = await overlayCanonicalProfit(req.params.processId, filters, legacy);
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
  const filters = await scopedFilters(req);
  const data = await canonicalPnlService.getProcessTrend(req.params.processId, filters);
  res.json({ success: true, data: { period: filters.period, ...data } });
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
  const filters = await scopedFilters(req);
  const bundle = await processPnlService.getDetailBundle(req.params.processId, filters);
  const canonicalRow = await fetchCanonicalProfitRow(req.params.processId, filters);
  const data = {
    ...bundle,
    overview: mergeCanonicalProfit(bundle.overview, canonicalRow),
    record: mergeCanonicalProfit(bundle.record, canonicalRow),
  };
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/canonical-detail", h(async (req, res) => {
  const data = await canonicalPnlService.getProcessDetail(req.params.processId, await scopedFilters(req));
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
  const data = await canonicalPnlService.getPeriodClose(
    req.query.period ? String(req.query.period) : undefined,
    req.userRoles,
    req.authUser.role
  );
  res.json({ success: true, data });
}));

router.get("/pnl/export", h(async (req, res) => {
  const csv = await canonicalPnlService.exportCsv(await scopedFilters(req));
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
  const data = await processPnlGovernanceService.approveAdjustment(req.params.adjustmentId, req.authUser.id);
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
  const data = await canonicalPnlService.recalculate(
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
  const data = await canonicalPnlService.lockPeriod(req.params.periodId, req.authUser.id);
  res.json({ success: true, data });
}));

export { router as processPnlRouter };
