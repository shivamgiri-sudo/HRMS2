import { Router } from "express";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
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

const PNL_SIGNOFF_ROLES = [
  ...PNL_WRITE_ROLES,
  "ceo",
  "coo",
] as const;

router.use(requireAuth);
router.use(requireRole(...PNL_READ_ROLES));

function readFilters(req: AuthenticatedRequest) {
  return {
    period: req.query.period ? String(req.query.period) : undefined,
    branchId: req.query.branchId ? String(req.query.branchId) : undefined,
    processId: req.query.processId ? String(req.query.processId) : undefined,
    clientId: req.query.clientId ? String(req.query.clientId) : undefined,
    search: req.query.search ? String(req.query.search) : undefined,
  };
}

router.get("/pnl/summary", h(async (req, res) => {
  const data = await processPnlService.getSummary(readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes", h(async (req, res) => {
  const data = await processPnlService.listProcesses(readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/overview", h(async (req, res) => {
  const data = await processPnlService.getOverview(req.params.processId, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/revenue", h(async (req, res) => {
  const data = await processPnlService.getRevenue(req.params.processId, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/workforce", h(async (req, res) => {
  const data = await processPnlService.getWorkforce(req.params.processId, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/people-cost", h(async (req, res) => {
  const data = await processPnlService.getPeopleCost(req.params.processId, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/direct-cost", h(async (req, res) => {
  const data = await processPnlService.getDirectCost(req.params.processId, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/indirect-allocation", h(async (req, res) => {
  const data = await processPnlService.getIndirectAllocation(req.params.processId, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/trend", h(async (req, res) => {
  const data = await processPnlService.getTrend(req.params.processId, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/reconciliation", h(async (req, res) => {
  const data = await processPnlService.getReconciliation(req.params.processId, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/ledger", h(async (req, res) => {
  const data = await processPnlService.getLedger(req.params.processId, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/pnl/processes/:processId/detail", h(async (req, res) => {
  const data = await processPnlService.getDetailBundle(req.params.processId, readFilters(req));
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
  const data = await processPnlGovernanceService.listMonthlyPlans(req.query.period ? String(req.query.period) : undefined);
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
  const data = await processPnlGovernanceService.getPeriodClose(req.query.period ? String(req.query.period) : undefined);
  res.json({ success: true, data });
}));

router.get("/pnl/export", h(async (req, res) => {
  const csv = await processPnlService.exportCsv(readFilters(req));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="process-pnl-${req.query.period ?? "current"}.csv"`);
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

router.post("/pnl/recalculate", requireWriteAccess, requireRole(...PNL_WRITE_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.recalculate(req.body?.period ? String(req.body.period) : undefined);
  res.json({ success: true, data });
}));

router.post("/pnl/period/:periodId/signoff", requireWriteAccess, requireRole(...PNL_SIGNOFF_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.signoffPeriod(
    req.params.periodId,
    String(req.body?.signoffRole ?? "") as "finance_preparer" | "finance_head" | "accounts_head" | "ceo",
    req.body?.note ? String(req.body.note) : null,
    req.authUser.id
  );
  res.json({ success: true, data });
}));

router.post("/pnl/period/:periodId/lock", requireWriteAccess, requireRole(...PNL_SIGNOFF_ROLES), h(async (req, res) => {
  const data = await processPnlGovernanceService.lockPeriod(req.params.periodId, req.authUser.id);
  res.json({ success: true, data });
}));

export { router as processPnlRouter };
