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
  resolveFinanceBranchScopeSet,
  resolveFinanceProcessScope,
} from "../finance/finance-access-scope.js";
import { resolveFinanceStageRole } from "../finance/finance-workflow-role.js";
import { bpoPnlRouter } from "./bpo-pnl.routes.js";
import { canonicalPnlService } from "./canonical-pnl.service.js";
import { pnlBulkUploadRouter } from "./pnl-bulk-upload.routes.js";
import { branchBudgetService, getCompanyBudgetConsolidation } from "./branch-budget.service.js";
import { getCeoOverview, getYtdSummary, type CeoFilters } from "./ceo-overview.service.js";
import { budgetTopupService } from "./budget-topup.service.js";
import { budgetCostCentreUtilizationService } from "./budget-cost-centre-utilization.service.js";
import { branchBudgetAllocationService } from "./branch-budget-allocation.service.js";
import { meterService } from "./meter.service.js";
import { costCentreMappingService } from "./cost-centre-mapping.service.js";
import { savedViewService } from "./saved-view.service.js";
import { gradeEngineService } from "./grade-engine.service.js";
import { checkBudgetExceptions, checkSharingMethodReadiness } from "./budget-readiness.service.js";
import { budgetCoverageService } from "./budget-coverage.service.js";
import { isPeriodLocked } from "./finance-period-lock.js";
import { pnlStatementService, type StatementViewBy } from "./pnl-statement.service.js";
import { refreshRunningSalarySnapshot } from "./pnl-running-salary.service.js";
import { processLobRouter } from "./process-lob.routes.js";
import { processPnlGovernanceService } from "./process-pnl.governance.service.js";
import { processPnlService } from "./process-pnl.service.js";
import {
  listRewardPenalty,
  createRewardPenaltyEntry,
  approveRewardPenaltyEntry,
  rejectRewardPenaltyEntry,
  getRewardPenaltySummary,
} from "./reward-penalty.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

/**
 * A repeatable filter parameter, as either `?ids=a,b,c` or `?ids=a&ids=b&ids=c`.
 *
 * Express hands the second form back as an array, so a naive String() would produce "a,b" — which
 * happens to parse correctly here and would not elsewhere. Both forms are handled explicitly.
 */
const csv = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .flatMap((v) => (v === undefined || v === null ? [] : String(v).split(",")))
    .map((v) => v.trim())
    .filter(Boolean);

const PNL_READ_ROLES = [
  "super_admin",
  "admin",
  "ceo",
  "coo",
  "finance",
  "finance_head",
  "accounts_head",
  "payroll_head",
  // Row-scoped, not unrestricted: neither role appears in GLOBAL_FINANCE_ROLES, so
  // resolveFinanceBranchScope pins a branch head to their own branch and
  // resolveFinanceProcessScope pins a process manager to their own process. Both refuse a
  // request for someone else's rather than silently ignoring the parameter.
  "branch_head",
  "process_manager",
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
  // Matches the ceo/coo addition to READ_ROLES in budget-coverage.routes.ts — without it the
  // capabilities call would succeed while every actual budget read (cost-centres, monthly
  // drivers, readiness, cost-centre-utilization) still 403d, which is a worse failure than
  // the lockout it replaces. Read-only: BUDGET_CREATE_ROLES and BUDGET_REVIEW_ROLES are
  // deliberately unchanged, so ceo/coo can view budgets but cannot create or approve one.
  "ceo",
  "coo",
] as const;
const BUDGET_CREATE_ROLES = ["super_admin", "admin", "branch_admin"] as const;
const BUDGET_REVIEW_ROLES = ["branch_head", "finance_head", "accounts_head", "super_admin"] as const;
// Company-wide, all-branches budget consolidation (PR 11) — deliberately excludes
// branch_admin/branch_head/finance (branch-scoped roles that shouldn't see all-branch data).
const BUDGET_CONSOLIDATION_ROLES = ["super_admin", "admin", "ceo", "coo", "finance_head", "accounts_head"] as const;
// Whoever hits "exceeds available budget" while raising/approving a GRN — the branch side
// of budget work, not the review side.
const TOPUP_CREATE_ROLES = ["super_admin", "admin", "branch_admin", "branch_head"] as const;
const TOPUP_REVIEW_ROLES = ["branch_head", "finance_head", "accounts_head", "super_admin"] as const;

function actor(req: AuthenticatedRequest) {
  return {
    id: req.authUser.id,
    role: String(req.authUser.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: req.userRoles ?? [],
  };
}

/**
 * Asserts that a record's owning branch is one the caller may touch.
 *
 * The endpoints below address a record by its own id (a meter, a cost centre) rather than by
 * branch, so resolveFinanceBranchScope has nothing to pin — the branch has to be read off the
 * record first. A null branch is a denial for a branch-scoped caller, never a free pass.
 */
async function assertBranchOf(req: AuthenticatedRequest, recordBranchId: string | null | undefined) {
  const user = actor(req);
  await assertFinanceRecordBranch({
    userId: user.id,
    primaryRole: user.role,
    userRoles: user.roles,
    recordBranchId,
  });
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
  const exceptions = await checkBudgetExceptions(budgetId);
  return { ...budget, exceptions };
}

router.use(requireAuth);

router.get(
  "/pnl/budgets",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchScope = await resolveFinanceBranchScopeSet({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    });
    const data = await branchBudgetService.list({
      period: req.query.period ? String(req.query.period) : undefined,
      branchScope,
      status: req.query.status ? String(req.query.status) : undefined,
    });
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/budgets/prior-mirror",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    /*
     * The previous month's budget, for the workspace's Prev/Variance columns and Copy-forward,
     * when that month exists only in the db_bill mirror. Read-only and branch-scoped through the
     * same resolveFinanceBranchScope every other budget read uses, so a branch user cannot read
     * another branch's budget through the mirror any more than through the workspace.
     *
     * Declared BEFORE /pnl/budgets/:id — Express matches in order, and ":id" would otherwise
     * swallow "prior-mirror" and try to load a budget with that id.
     */
    const user = actor(req);
    const branchId = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    });
    if (!branchId || !req.query.period) {
      res.json({ success: true, data: [] });
      return;
    }
    const data = await branchBudgetService.getPriorBudgetFromMirror(String(req.query.period), branchId);
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/budgets/consolidation",
  requireRole(...BUDGET_CONSOLIDATION_ROLES),
  h(async (req, res) => {
    const periodCode = String(req.query.period ?? "");
    if (!/^\d{4}-\d{2}$/.test(periodCode)) throw Object.assign(new Error("A valid period (YYYY-MM) is required"), { statusCode: 400 });
    const [branchSummaries, headBreakdown, periodLocked] = await Promise.all([
      branchBudgetService.list({ period: periodCode }),
      getCompanyBudgetConsolidation(periodCode),
      isPeriodLocked(periodCode),
    ]);
    const readiness = await Promise.all(
      (branchSummaries as any[]).map(async (summary) => {
        // A failed coverage query used to be reported as fact: completionPct 0 and
        // readyToSubmit false, inside a success:true response, so a transient failure on one
        // branch made that branch look 0% complete on the CEO consolidation screen with no
        // error anywhere in the payload. The catch stays — one branch's failure must not take
        // down the whole rollup — but the row now says it could not be measured rather than
        // asserting a zero, and completionPct is null so no client can chart it as progress.
        const coverage = await budgetCoverageService.getCoverage(summary.id).catch((error) => {
          console.error(
            `[budget-consolidation] coverage unavailable for budget ${summary.id}: `
              + (error instanceof Error ? error.message : String(error))
          );
          return null;
        });
        return {
          budgetId: summary.id,
          branchName: summary.branch_name,
          completionPct: coverage ? coverage.summary.completionPct : null,
          readyToSubmit: coverage ? coverage.summary.readyToSubmit : false,
          /** false only when the coverage read failed — distinguishes "0% planned" from
           *  "we could not tell". */
          coverageAvailable: Boolean(coverage),
        };
      })
    );
    // Same transparency-flag pattern as bpo-pnl.routes.ts's read endpoints: this rollup still
    // recomputes live from finance_budget_header/finance_budget_line even once the period's P&L
    // has been signed and snapshotted (canonical-pnl.service.ts's lock()), so a number here can
    // legitimately move after the period's official P&L is frozen. Surfacing the flag makes that
    // visible instead of silent; serving the frozen figure itself is follow-up work, since budget
    // consolidation has no snapshot table of its own to substitute in.
    res.json({ success: true, data: { branchSummaries, headBreakdown, readiness, isPeriodLocked: periodLocked } });
  })
);

// Declared BEFORE /pnl/budgets/:id — Express matches in order.
router.get(
  "/pnl/budgets/pending-my-review",
  requireRole(...BUDGET_REVIEW_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const data = await branchBudgetService.listPendingForReviewer(user.role, user.id, user.roles);
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
    if (!branchId) throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
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
      throw Object.assign(new Error("Invalid budget decision"), { statusCode: 400 });
    }
    const effectiveRole = resolveFinanceStageRole({
      primaryRole: user.role,
      userRoles: user.roles,
      currentStatus: String(budget.status ?? ""),
      workflow: "budget",
    });
    const rawCorrections = Array.isArray(req.body?.lineCorrections)
      ? req.body.lineCorrections
      : [];
    const lineCorrections = rawCorrections.map((entry: Record<string, unknown>) => ({
      lineId: entry.lineId ? String(entry.lineId) : null,
      head: String(entry.head ?? ""),
      subHead: entry.subHead ? String(entry.subHead) : null,
      itemName: entry.itemName ? String(entry.itemName) : null,
      note: String(entry.note ?? ""),
    }));
    const data = await branchBudgetService.review(
      req.params.id,
      decision,
      user.id,
      effectiveRole,
      req.body?.remarks ? String(req.body.remarks) : undefined,
      lineCorrections
    );
    res.json({ success: true, data });
  })
);

// Preflight read: checks whether a tax treatment amendment is eligible for a given budget line.
// Returns current financial values plus canAmend / blockedReason. Safe to call frequently.
router.get(
  "/pnl/budgets/:budgetId/lines/:lineId/tax-amendment-preflight",
  requireAuth,
  requireRole(...PNL_READ_ROLES),
  h(async (req, res) => {
    const data = await branchBudgetService.getTaxAmendmentPreflight(
      req.params.budgetId,
      req.params.lineId
    );
    res.json({ success: true, data });
  })
);

// Tax Treatment Amendment — Step 1 (request).
// Creates a pending amendment record; does NOT mutate the budget line.
// A different finance_head / super_admin must call /review to apply.
// Blocked if: period locked, line has reservations/consumption, open GRN, or existing pending amendment.
router.patch(
  "/pnl/budgets/:budgetId/lines/:lineId/tax-treatment",
  requireWriteAccess,
  requireRole("finance_head", "super_admin"),
  h(async (req, res) => {
    const user = actor(req);
    const { taxTreatment, gstRate, gstType, recoverableTaxPct, reason } = req.body ?? {};
    const VALID_TREATMENTS = ["inclusive", "exclusive", "exempt", "reverse_charge", "non_gst"];
    if (!VALID_TREATMENTS.includes(String(taxTreatment ?? ""))) {
      throw Object.assign(new Error("taxTreatment must be one of: " + VALID_TREATMENTS.join(", ")), { statusCode: 400 });
    }
    if (!String(reason ?? "").trim()) {
      throw Object.assign(new Error("reason is required for a tax treatment amendment"), { statusCode: 400 });
    }
    const data = await branchBudgetService.requestTaxAmendment(
      req.params.budgetId,
      req.params.lineId,
      {
        taxTreatment: String(taxTreatment) as any,
        gstRate: Number(gstRate ?? 0),
        gstType: String(gstType ?? "none") as any,
        recoverableTaxPct: Number(recoverableTaxPct ?? 0),
      },
      user.id,
      user.role,
      String(reason)
    );
    res.status(201).json({ success: true, data });
  })
);

// List tax amendments for a budget (pending + recent history).
router.get(
  "/pnl/budget-tax-amendments",
  requireAuth,
  requireRole(...PNL_READ_ROLES),
  h(async (req, res) => {
    const budgetId = String(req.query.budgetId ?? "").trim();
    if (!budgetId) throw Object.assign(new Error("budgetId query param is required"), { statusCode: 400 });
    const data = await branchBudgetService.listTaxAmendments(budgetId);
    res.json({ success: true, data });
  })
);

// Tax Treatment Amendment — Step 2 (review: approve or reject).
// Maker-checker: the requestor cannot be the approver.
router.post(
  "/pnl/budget-tax-amendments/:id/review",
  requireWriteAccess,
  requireRole("finance_head", "super_admin"),
  h(async (req, res) => {
    const user = actor(req);
    const { decision, reason } = req.body ?? {};
    if (!["approved", "rejected"].includes(String(decision ?? ""))) {
      throw Object.assign(new Error("decision must be 'approved' or 'rejected'"), { statusCode: 400 });
    }
    if (String(decision) === "rejected" && !String(reason ?? "").trim()) {
      throw Object.assign(new Error("reason is required when rejecting an amendment"), { statusCode: 400 });
    }
    const data = await branchBudgetService.reviewTaxAmendment(
      req.params.id,
      String(decision) as "approved" | "rejected",
      user.id,
      user.role,
      reason ? String(reason) : undefined
    );
    res.json({ success: true, data });
  })
);

// 2-A: Budget transfer / virement — submit creates a pending request; a distinct authorised
// actor must approve via /budget-transfers/:id/review before lines are mutated (P1-7).
router.post(
  "/pnl/budgets/:budgetId/transfer",
  requireWriteAccess,
  requireRole("finance_head", "accounts_head", "super_admin"),
  h(async (req, res) => {
    const user = actor(req);
    await assertBranchOf(req, await branchBudgetService.get(req.params.budgetId).then((b: any) => b?.branch_id));
    const { fromLineId, toLineId, transferAmount, reason } = req.body ?? {};
    if (!fromLineId || !toLineId) throw Object.assign(new Error("fromLineId and toLineId are required"), { statusCode: 400 });
    const data = await branchBudgetService.submitTransfer({
      budgetId: req.params.budgetId,
      fromLineId: String(fromLineId),
      toLineId: String(toLineId),
      transferAmount: Number(transferAmount ?? 0),
      reason: String(reason ?? ""),
      actorId: user.id,
      actorRole: user.role,
    });
    res.status(201).json({ success: true, data });
  })
);

// 2-A: Review a pending virement — approve (applies with canonical recalc) or reject.
// Maker-checker: approver cannot be the person who submitted.
router.post(
  "/pnl/budget-transfers/:id/review",
  requireWriteAccess,
  requireRole("finance_head", "accounts_head", "super_admin"),
  h(async (req, res) => {
    const user = actor(req);
    const { decision, remarks } = req.body ?? {};
    if (!["approve", "reject"].includes(String(decision ?? ""))) {
      throw Object.assign(new Error("decision must be 'approve' or 'reject'"), { statusCode: 400 });
    }
    const data = await branchBudgetService.reviewTransfer(
      req.params.id,
      String(decision) as "approve" | "reject",
      user.id,
      user.role,
      remarks ? String(remarks) : undefined
    );
    res.json({ success: true, data });
  })
);

// 2-A: List all transfers for a budget — pending, approved, and rejected.
router.get(
  "/pnl/budgets/:budgetId/transfers",
  requireRole("finance_head", "accounts_head", "super_admin"),
  h(async (req, res) => {
    await assertBranchOf(req, await branchBudgetService.get(req.params.budgetId).then((b: any) => b?.branch_id));
    const data = await branchBudgetService.listTransfers(req.params.budgetId);
    res.json({ success: true, data });
  })
);

// Per-cost-centre budget vs actual, with the head / sub-head breakdown the tab drills into.
// Server-side because the figures come from three tables the budget-detail payload does not carry
// (finance_budget_line_allocation and grn_cost_allocation above all), and because row scope has to
// be enforced here rather than by whatever the browser happens to ask for.
router.get(
  "/pnl/budgets/:id/cost-centre-utilization",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchId = await budgetCostCentreUtilizationService.getBudgetBranch(req.params.id);
    await assertFinanceRecordBranch({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      recordBranchId: branchId,
    });
    const data = await budgetCostCentreUtilizationService.get(req.params.id);
    res.json({ success: true, data });
  })
);

// 4-D: GRN drill-through per budget line — shows all GRN cost allocations that consumed a line.
router.get(
  "/pnl/budget-lines/:lineId/grns",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const data = await branchBudgetService.getGrnsForLine(req.params.lineId);
    res.json({ success: true, data });
  })
);

// A reviewer correcting the lines in place at their own stage, rather than sending the whole budget
// back for a small fix. Status is unchanged by this call — the reviewer must still Approve — so it
// cannot be used to bypass a stage. Same review roles and row scope as the review endpoint.
// Deletes a budget outright when nothing has consumed against it, and closes it instead when GRN
// activity exists, because deleting then would take real spend history with it.
//
// The role list here only narrows the field to roles that can raise a budget at all. The real
// authority check is in deleteOrSupersede: super_admin may act on any budget, anyone else only on
// a draft they created themselves. Keeping it there means the rule holds for every caller, not
// just this route.
router.delete(
  "/pnl/budgets/:id",
  requireWriteAccess,
  requireRole("super_admin", "admin", "branch_admin"),
  h(async (req, res) => {
    const user = actor(req);
    await scopedBudget(req, req.params.id);
    const data = await branchBudgetService.deleteOrSupersede(
      req.params.id,
      user.id,
      user.role,
      String(req.body?.reason ?? "")
    );
    res.json({ success: true, data });
  })
);

router.post(
  "/pnl/budgets/:id/reviewer-revise",
  requireWriteAccess,
  requireRole(...BUDGET_REVIEW_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const budget = await scopedBudget(req, req.params.id);
    const effectiveRole = resolveFinanceStageRole({
      primaryRole: user.role,
      userRoles: user.roles,
      currentStatus: String(budget.status ?? ""),
      workflow: "budget",
    });
    const data = await branchBudgetService.reviewerRevise(
      req.params.id,
      Array.isArray(req.body?.lines) ? req.body.lines : [],
      user.id,
      effectiveRole,
      String(req.body?.reason ?? "")
    );
    // Keep head/sub-head coverage in step with the edited line set, exactly as the create path does.
    await budgetCoverageService.syncPlannedFromLines(req.params.id, user.id);
    res.json({ success: true, data: await branchBudgetService.get(req.params.id) });
  })
);

// Budget top-up requests: the formal "ask for more against this exact line" path, gated by
// the same branch_head -> finance_head chain as everything else here. See budget-topup.service.ts.
router.get(
  "/pnl/budget-topups",
  requireRole(...TOPUP_REVIEW_ROLES, ...TOPUP_CREATE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchScope = await resolveFinanceBranchScopeSet({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    });
    const data = await budgetTopupService.list({
      branchScope,
      status: req.query.status ? String(req.query.status) : undefined,
      head: req.query.head ? String(req.query.head) : undefined,
      subHead: req.query.subHead ? String(req.query.subHead) : undefined,
      requestedBy: req.query.requestedBy ? String(req.query.requestedBy) : undefined,
      period: req.query.period ? String(req.query.period) : undefined,
      raisedFrom: req.query.raisedFrom ? String(req.query.raisedFrom) : undefined,
      raisedTo: req.query.raisedTo ? String(req.query.raisedTo) : undefined,
      pendingWithRole: req.query.pendingWith ? String(req.query.pendingWith) : undefined,
    });
    // `data` stays the array it has always been so BudgetTopupPanel keeps working unchanged;
    // the tab counts ride alongside it rather than wrapping it.
    res.json({ success: true, data: data.rows, counts: data.counts });
  })
);

router.get(
  "/pnl/budget-topups/:id",
  requireRole(...TOPUP_REVIEW_ROLES, ...TOPUP_CREATE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const data = await budgetTopupService.get(req.params.id);
    await assertFinanceRecordBranch({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      recordBranchId: String((data as any).branch_id),
    });
    res.json({ success: true, data });
  })
);

router.post(
  "/pnl/budget-topups",
  requireWriteAccess,
  requireRole(...TOPUP_CREATE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const budgetLineId = String(req.body?.budgetLineId ?? "");
    if (!budgetLineId) throw Object.assign(new Error("A budget line is required"), { statusCode: 400 });
    const lineBranchId = await budgetTopupService.getLineBranch(budgetLineId);
    await assertFinanceRecordBranch({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      recordBranchId: lineBranchId,
    });
    const data = await budgetTopupService.create(
      {
        budgetLineId,
        requestedAmount: Number(req.body?.requestedAmount ?? 0),
        requestedQuantity: Number(req.body?.requestedQuantity ?? 0),
        reason: String(req.body?.reason ?? ""),
      },
      user.id,
      user.role
    );
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/pnl/budget-topups/:id/review",
  requireWriteAccess,
  requireRole(...TOPUP_REVIEW_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const request = await budgetTopupService.get(req.params.id);
    await assertFinanceRecordBranch({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      recordBranchId: String((request as any).branch_id),
    });
    const decision = String(req.body?.decision ?? "") as "approve" | "reject";
    if (!["approve", "reject"].includes(decision)) throw Object.assign(new Error("Invalid top-up decision"), { statusCode: 400 });
    const effectiveRole = resolveFinanceStageRole({
      primaryRole: user.role,
      userRoles: user.roles,
      currentStatus: String((request as any).status ?? ""),
      workflow: "grn", // same two-stage shape: submitted -> branch_head -> finance_head
    });
    const data = await budgetTopupService.review(
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
    if (!branchId) throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
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
    if (!branchId) throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
    const periodCode = String(req.query.period ?? "");
    if (!/^\d{4}-\d{2}$/.test(periodCode)) throw Object.assign(new Error("A valid budget period (YYYY-MM) is required"), { statusCode: 400 });
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
    if (!branchId) throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
    const periodCode = String(req.body?.periodCode ?? "");
    if (!/^\d{4}-\d{2}$/.test(periodCode)) throw Object.assign(new Error("A valid budget period (YYYY-MM) is required"), { statusCode: 400 });
    const drivers = Array.isArray(req.body?.drivers) ? req.body.drivers : [];
    const data = await branchBudgetAllocationService.saveMonthlyDrivers(
      branchId,
      periodCode,
      // Every driver the sharing methods can divide by must be mapped here. This whitelist
      // silently dropped seat/area/device/hiring — the UI sent them and the API answered 200, so
      // the values simply vanished and the method then failed with "Monthly seat count is missing".
      drivers.map((d: any) => ({
        costCentreId: String(d.costCentreId),
        plannedHeadcount: Number(d.plannedHeadcount ?? 0),
        revenueRatePerHead: Number(d.revenueRatePerHead ?? 0),
        seatCount: Number(d.seatCount ?? 0),
        floorAreaSqft: Number(d.floorAreaSqft ?? 0),
        deviceCount: Number(d.deviceCount ?? 0),
        hiringVolume: Number(d.hiringVolume ?? 0),
        remarks: d.remarks ? String(d.remarks) : null,
      })),
      user.id
    );
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/branch-budget/meters",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchId = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    });
    if (!branchId) throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
    const data = await meterService.listMeters(branchId);
    res.json({ success: true, data });
  })
);

router.post(
  "/pnl/branch-budget/meters",
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
    if (!branchId) throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
    const data = await meterService.createMeter(
      {
        branchId,
        costCentreId: String(req.body?.costCentreId ?? ""),
        meterCode: String(req.body?.meterCode ?? ""),
        meterName: String(req.body?.meterName ?? ""),
        location: req.body?.location ? String(req.body.location) : null,
        readingUnit: String(req.body?.readingUnit ?? "Unit"),
        fixedRate: Number(req.body?.fixedRate ?? 0),
        effectiveFrom: String(req.body?.effectiveFrom ?? new Date().toISOString().slice(0, 10)),
      },
      user.id
    );
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/branch-budget/meters/:id/reading",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const periodCode = String(req.query.period ?? "");
    if (!/^\d{4}-\d{2}$/.test(periodCode)) throw Object.assign(new Error("A valid budget period (YYYY-MM) is required"), { statusCode: 400 });
    await assertBranchOf(req, await meterService.getMeterBranchId(String(req.params.id)));
    const data = await meterService.listReadings(String(req.params.id), periodCode);
    res.json({ success: true, data });
  })
);

router.put(
  "/pnl/branch-budget/meters/:id/reading",
  requireWriteAccess,
  requireRole(...BUDGET_CREATE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const periodCode = String(req.body?.periodCode ?? "");
    await assertBranchOf(req, await meterService.getMeterBranchId(String(req.params.id)));
    const data = await meterService.saveReading(
      String(req.params.id),
      periodCode,
      {
        openingReading: Number(req.body?.openingReading ?? 0),
        closingReading: Number(req.body?.closingReading ?? 0),
        readingType: req.body?.readingType === "estimated" ? "estimated" : "actual",
        estimationMethod: req.body?.estimationMethod ? String(req.body.estimationMethod) : null,
        estimationReason: req.body?.estimationReason ? String(req.body.estimationReason) : null,
      },
      user.id
    );
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/cost-centres/:id/mapping-history",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    await assertBranchOf(req, await costCentreMappingService.getCostCentreBranchId(String(req.params.id)));
    const data = await costCentreMappingService.getMappingHistory(String(req.params.id));
    res.json({ success: true, data });
  })
);

router.put(
  "/pnl/cost-centres/:id/mapping",
  requireWriteAccess,
  requireRole(...BUDGET_CREATE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const requestedBranchId = req.body?.branchId ? String(req.body.branchId) : null;
    // Two checks, not one. The cost centre must already belong to the caller's branch, AND the
    // branch it is being moved to must also be theirs — otherwise a branch admin could pull
    // another branch's cost centre into their own, or push their own out of reach. Only resolved
    // when a branch was actually supplied: a process-only remap sends null, and feeding that
    // through the resolver would turn it into an unrequested branch reassignment.
    await assertBranchOf(req, await costCentreMappingService.getCostCentreBranchId(String(req.params.id)));
    if (requestedBranchId) {
      await resolveFinanceBranchScope({
        userId: user.id,
        primaryRole: user.role,
        userRoles: user.roles,
        requestedBranchId,
      });
    }
    const data = await costCentreMappingService.recordMappingChange(
      String(req.params.id),
      {
        branchId: requestedBranchId,
        processId: req.body?.processId ? String(req.body.processId) : null,
        effectiveFrom: String(req.body?.effectiveFrom ?? ""),
        changeReason: String(req.body?.changeReason ?? ""),
      },
      user.id
    );
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/saved-views",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const moduleKey = String(req.query.moduleKey ?? "");
    if (!moduleKey) throw Object.assign(new Error("moduleKey is required"), { statusCode: 400 });
    const data = await savedViewService.listSavedViews(user.id, moduleKey);
    res.json({ success: true, data });
  })
);

router.post(
  "/pnl/saved-views",
  requireWriteAccess,
  requireRole(...BUDGET_CREATE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const data = await savedViewService.createSavedView(
      user.id,
      String(req.body?.moduleKey ?? ""),
      String(req.body?.viewName ?? ""),
      req.body?.config ?? {}
    );
    res.json({ success: true, data });
  })
);

router.delete(
  "/pnl/saved-views/:id",
  requireWriteAccess,
  requireRole(...BUDGET_CREATE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    await savedViewService.deleteSavedView(String(req.params.id), user.id);
    res.json({ success: true });
  })
);

router.get(
  "/pnl/branch-budget/grade-drivers",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const costCentreId = String(req.query.costCentreId ?? "");
    const periodCode = String(req.query.period ?? "");
    if (!costCentreId) throw Object.assign(new Error("Cost centre is required"), { statusCode: 400 });
    if (!/^\d{4}-\d{2}$/.test(periodCode)) throw Object.assign(new Error("A valid budget period (YYYY-MM) is required"), { statusCode: 400 });
    // The sibling PUT already resolves scope from its body's branchId; this GET is addressed by
    // cost centre alone, so the branch has to come off the cost centre itself.
    await assertBranchOf(req, await costCentreMappingService.getCostCentreBranchId(costCentreId));
    const data = await gradeEngineService.listGradeDrivers(costCentreId, periodCode);
    res.json({ success: true, data });
  })
);

router.put(
  "/pnl/branch-budget/grade-drivers",
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
    if (!branchId) throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
    const costCentreId = String(req.body?.costCentreId ?? "");
    const periodCode = String(req.body?.periodCode ?? "");
    if (!costCentreId) throw Object.assign(new Error("Cost centre is required"), { statusCode: 400 });
    if (!/^\d{4}-\d{2}$/.test(periodCode)) throw Object.assign(new Error("A valid budget period (YYYY-MM) is required"), { statusCode: 400 });
    const drivers = Array.isArray(req.body?.drivers) ? req.body.drivers : [];
    const data = await gradeEngineService.saveGradeDrivers(
      branchId,
      costCentreId,
      periodCode,
      drivers.map((d: any) => ({
        gradeId: String(d.gradeId),
        plannedHeadcount: Number(d.plannedHeadcount ?? 0),
        remarks: d.remarks ? String(d.remarks) : null,
      })),
      user.id
    );
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/branch-budget/readiness",
  requireRole(...BUDGET_READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchId = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    });
    if (!branchId) throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
    const periodCode = String(req.query.period ?? "");
    if (!/^\d{4}-\d{2}$/.test(periodCode)) throw Object.assign(new Error("A valid budget period (YYYY-MM) is required"), { statusCode: 400 });
    const data = await checkSharingMethodReadiness(branchId, periodCode);
    res.json({ success: true, data });
  })
);

// Scoped to "/pnl" on purpose. This router is mounted on the SHARED "/api/finance" base
// (app.ts), so a path-less router.use() runs for every /api/finance/* request that no earlier
// router handled — and requireRole answers 403, it never calls next(). That silently denied
// /api/finance/billability/* (mounted after this router) to any role outside PNL_READ_ROLES;
// payroll_branch is in BILLABILITY_ROLES and not in PNL_READ_ROLES, with no alias bridging
// them, so the entire Billability & Seat Cost API was 403 for that role. Every route this gate
// is meant to protect is under /pnl (including the /pnl/bpo, /pnl/lobs and /pnl/bulk-upload
// sub-routers below), so the prefix costs nothing and confines the blast radius to this module.
router.use("/pnl", requireRole(...PNL_READ_ROLES));
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
  // Resolves the SET. A user entitled to several branches previously hit "this finance screen
  // does not support multi-branch access yet", which made the canonical P&L — summary, trend
  // and export — unusable for exactly the people most likely to hold more than one branch.
  const scope = await resolveFinanceBranchScopeSet({
    userId: user.id,
    primaryRole: user.role,
    userRoles: req.userRoles,
    requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
  });
  const base = readFilters(req, scope.mode === "branches" && scope.branchIds.length === 1
    ? scope.branchIds[0]
    : undefined);
  return scope.mode === "all" ? base : { ...base, branchIds: scope.branchIds };
}

// Canonical endpoints: summary/trend/export/close all use the same allocation-aware engine.
router.get(
  "/pnl/ceo-overview",
  requireRole(...PNL_READ_ROLES),
  h(async (req, res) => {
    /*
     * Branch-scoped through the same resolveFinanceBranchScope every other P&L read uses, so a
     * branch-restricted user sees their own branch and cannot request another. Declared before
     * "/pnl/budgets/:id" style routes for the same reason as prior-mirror: Express matches in
     * order and a ":id" pattern would otherwise swallow this path.
     */
    const user = actor(req);
    /*
     * Multi-select, WITHOUT loosening the row scope.
     *
     * The resolvers are asked what this user is confined to first, with nothing requested. A global
     * user gets undefined and their whole list is honoured. A branch-bound or process-bound user
     * gets their own id back, and that single id REPLACES whatever list arrived — so adding
     * `branchIds=a,b,c` to the URL cannot widen a scoped user's view. The resolver is still called
     * with the singular parameter as well, so asking for someone else's branch outright keeps
     * failing loudly instead of being silently narrowed.
     */
    const requestedBranchIds = csv(req.query.branchIds);
    const requestedProcessIds = csv(req.query.processIds);
    const branchId = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: req.userRoles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    });
    const confinedBranch = await resolveFinanceBranchScope({
      userId: user.id, primaryRole: user.role, userRoles: req.userRoles,
    });
    const period = req.query.period ? String(req.query.period) : "";
    const processId = await resolveFinanceProcessScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: req.userRoles,
      requestedProcessId: req.query.processId ? String(req.query.processId) : undefined,
    });
    const confinedProcess = await resolveFinanceProcessScope({
      userId: user.id, primaryRole: user.role, userRoles: req.userRoles,
    });
    const data = await getCeoOverview(period, {
      branchId: branchId ?? undefined,
      processId: processId ?? undefined,
      costCentreId: req.query.costCentreId ? String(req.query.costCentreId) : undefined,
      branchIds: confinedBranch ? [confinedBranch] : requestedBranchIds,
      processIds: confinedProcess ? [confinedProcess] : requestedProcessIds,
      costCentreIds: csv(req.query.costCentreIds),
    });
    res.json({ success: true, data });
  })
);

router.get(
  "/pnl/ytd-summary",
  requireRole(...PNL_READ_ROLES),
  h(async (req, res) => {
    const upTo = req.query.upTo ? String(req.query.upTo) : "";
    if (!/^\d{4}-\d{2}$/.test(upTo)) throw Object.assign(new Error("upTo must be YYYY-MM"), { statusCode: 400 });
    const user = actor(req);
    const confinedBranch = await resolveFinanceBranchScope({
      userId: user.id, primaryRole: user.role, userRoles: user.roles,
    });
    const confinedProcess = await resolveFinanceProcessScope({
      userId: user.id, primaryRole: user.role, userRoles: user.roles,
    });
    const filters: CeoFilters = {};
    if (confinedBranch !== undefined) filters.branchId = confinedBranch;
    if (confinedProcess !== undefined) filters.processId = confinedProcess;
    const data = await getYtdSummary(upTo, filters);
    res.json({ success: true, data });
  })
);

router.get("/pnl/summary", h(async (req, res) => {
  const data = await canonicalPnlService.getSummary(await scopedFilters(req));
  res.json({ success: true, data });
}));

// Recomputes the per-employee running-salary snapshot the P&L reads for Agent/DSC/BMC. Explicit
// rather than automatic on read: it calls computeRunningSalary once per employee, so it belongs
// behind a deliberate refresh, not on the path of every statement load.
router.post(
  "/pnl/running-salary/refresh",
  requireWriteAccess,
  requireRole(...PNL_WRITE_ROLES),
  h(async (req, res) => {
    const period = String(req.body?.period ?? "");
    const user = actor(req);
    const requestedBranchId = req.body?.branchId ? String(req.body.branchId) : undefined;
    const confinedBranch = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId,
    });
    const data = await refreshRunningSalarySnapshot(period, {
      branchId: confinedBranch ?? requestedBranchId,
      asOfDate: req.body?.asOfDate ? String(req.body.asOfDate) : undefined,
    });
    res.json({ success: true, data });
  })
);

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

// ── Rewards & Penalties ─────────────────────────────────────────────────────

const RP_READ_ROLES = [...PNL_READ_ROLES] as const;
const RP_WRITE_ROLES = ["super_admin", "admin", "finance", "finance_head", "accounts_head"] as const;
const RP_APPROVE_ROLES = ["super_admin", "finance_head", "accounts_head"] as const;

router.get("/pnl/reward-penalty", requireAuth, requireRole(...RP_READ_ROLES), h(async (req, res) => {
  const period = String(req.query.period ?? "");
  const costCentreId = req.query.costCentreId ? String(req.query.costCentreId) : undefined;
  const data = await listRewardPenalty(period, costCentreId);
  res.json({ success: true, data });
}));

router.get("/pnl/reward-penalty/summary", requireAuth, requireRole(...RP_READ_ROLES), h(async (req, res) => {
  const period = String(req.query.period ?? "");
  const data = await getRewardPenaltySummary(period);
  res.json({ success: true, data });
}));

router.post("/pnl/reward-penalty", requireAuth, requireWriteAccess, requireRole(...RP_WRITE_ROLES), h(async (req, res) => {
  const entry = await createRewardPenaltyEntry(req.body, req.authUser.id);
  res.status(201).json({ success: true, data: entry });
}));

router.put("/pnl/reward-penalty/:id/approve", requireAuth, requireWriteAccess, requireRole(...RP_APPROVE_ROLES), h(async (req, res) => {
  const result = await approveRewardPenaltyEntry(req.params.id, req.authUser.id);
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true });
}));

router.put("/pnl/reward-penalty/:id/reject", requireAuth, requireWriteAccess, requireRole(...RP_APPROVE_ROLES), h(async (req, res) => {
  const reason = String(req.body?.reason ?? "");
  const result = await rejectRewardPenaltyEntry(req.params.id, req.authUser.id, reason);
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true });
}));

export { router as processPnlRouter };
