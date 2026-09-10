import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./process-operations.service.js";
import { getFeedHealth } from "./feed-health.service.js";

/**
 * Process Operations HTTP surface.
 *
 * Read-only. The role gate decides who may reach these routes; it is not the data
 * boundary. Which processes a caller can see is resolved inside the service from
 * their own scope, so a process id guessed in the URL returns 404 rather than
 * another team's numbers.
 */

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

const VIEWER_ROLES = [
  "super_admin", "admin", "ceo", "coo", "manager", "process_manager",
  "operations_manager", "branch_head", "qa", "quality_analyst", "tq_head",
  "hr", "team_leader",
] as const;

/** Shared by both the summary and drill-down routes below, so a drawer opened
 *  while a period tab is active trims to the same calendar range the tile does. */
const REPORT_PERIODS = new Set(["trend", "today", "wtd", "mtd"]);
type ReportPeriodParam = "trend" | "today" | "wtd" | "mtd";
function readPeriod(req: AuthenticatedRequest): ReportPeriodParam {
  const raw = String(req.query.period ?? "trend");
  return (REPORT_PERIODS.has(raw) ? raw : "trend") as ReportPeriodParam;
}

router.get("/processes", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await svc.listProcesses(req.authUser!.id) });
}));

/**
 * Declared BEFORE /:processId, or Express matches "feeds" as a process id and
 * this route becomes unreachable — the same shadowing that left an exit-status
 * guard 100% dead in this codebase.
 */
router.get("/feeds", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const allowed = await svc.readableProcessIds(req.authUser!.id);
  res.json({ success: true, data: await getFeedHealth(allowed) });
}));

/**
 * Drill-down for one metric on one process: the formula, the source and its
 * filters, every daily reading with its parts, and who defined it.
 *
 * Declared before /:processId so the two-segment path is not swallowed by the
 * one-segment route.
 */
router.get("/:processId/metric/:metricKey", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const days = Number(req.query.days);
  const windowDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 7), 120) : 30;
  const data = await svc.getMetricDrilldown(
    req.authUser!.id, req.params.processId, req.params.metricKey, windowDays, readPeriod(req));
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process or metric, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

/**
 * The last drill-down level: the individual rows behind one day's number.
 * Four path segments, so it is never shadowed by /:processId/metric/:metricKey
 * above regardless of declaration order — Express matches by segment count —
 * but declared right after its two-segment sibling for the same readability
 * reason that comment gives.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
router.get("/:processId/metric/:metricKey/raw", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const date = String(req.query.date ?? "");
  if (!ISO_DATE.test(date)) {
    return res.status(400).json({
      success: false, code: "BAD_DATE", message: "?date=YYYY-MM-DD is required.",
    });
  }
  const data = await svc.getMetricRawRows(req.authUser!.id, req.params.processId, req.params.metricKey, date);
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process or metric, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

/**
 * The metric's own formula recomputed per employee: name, code, score,
 * real designation, and the real reporting chain (Team Leader / Assistant
 * Manager picked out of it when one genuinely exists). Same period the
 * caller is currently viewing on the tile, so this explains that exact
 * number, not an unrelated window.
 *
 * Four path segments for the same shadowing reason as /raw above.
 */
router.get("/:processId/metric/:metricKey/by-analyst", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getMetricAnalystBreakdown(
    req.authUser!.id, req.params.processId, req.params.metricKey, readPeriod(req));
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process or metric, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

/**
 * Voice of the Customer for the whole process (not one metric): the real CLAP
 * root-cause split (Customer/Logistic/Agent/Product) and verbatim customer
 * quotes for audited calls, reusing the taxonomy already proven live in the
 * sibling Mydashboards project against the same upstream db_audit source.
 *
 * Declared before /:processId for the same shadowing reason as its siblings.
 */
router.get("/:processId/voice-of-customer", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getProcessVoiceOfCustomer(req.authUser!.id, req.params.processId, readPeriod(req));
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

const CLAP_VALUES = ["Customer", "Logistic", "Agent", "Product"] as const;

/**
 * Sub-scenario drill for one CLAP bucket (Phase B of the Mydashboards
 * port) — clicking "Agent: 34%" on the breakdown bar answers WHICH real
 * scenarios make up that share, grouped on the exact same q.scenario field
 * CLAP_CASE itself classifies on. Declared before /:processId for the same
 * shadowing reason as its siblings.
 */
router.get("/:processId/voice-of-customer/scenarios", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const clap = req.query.clap as string;
  if (!CLAP_VALUES.includes(clap as any)) {
    return res.status(400).json({
      success: false, code: "BAD_REQUEST",
      message: `clap must be one of ${CLAP_VALUES.join(", ")}.`,
    });
  }
  const data = await svc.getClapScenarioBreakdown(
    req.authUser!.id, req.params.processId, readPeriod(req), clap as typeof CLAP_VALUES[number],
  );
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

/**
 * Row-level companion to /voice-of-customer/scenarios (Phase C) -- the real
 * calls behind one scenario, newest first, capped at 50. Declared before
 * /:processId for the same shadowing reason as its siblings.
 */
router.get("/:processId/voice-of-customer/scenario-calls", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const clap = req.query.clap as string;
  const scenario = req.query.scenario as string;
  if (!CLAP_VALUES.includes(clap as any)) {
    return res.status(400).json({
      success: false, code: "BAD_REQUEST",
      message: `clap must be one of ${CLAP_VALUES.join(", ")}.`,
    });
  }
  if (!scenario || !scenario.trim()) {
    return res.status(400).json({ success: false, code: "BAD_REQUEST", message: "scenario is required." });
  }
  const data = await svc.getClapScenarioCalls(
    req.authUser!.id, req.params.processId, readPeriod(req), clap as typeof CLAP_VALUES[number], scenario,
  );
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

/**
 * One call's full audit detail -- transcript, recording, scenario and every
 * scored parameter's pass/fail/blank state (Phase C). Declared before
 * /:processId for the same shadowing reason as its siblings.
 */
router.get("/:processId/call-detail", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const employeeCode = req.query.employeeCode as string;
  const callDate = req.query.callDate as string;
  if (!employeeCode || !callDate) {
    return res.status(400).json({
      success: false, code: "BAD_REQUEST", message: "employeeCode and callDate are both required.",
    });
  }
  const data = await svc.getCallDetail(req.authUser!.id, req.params.processId, employeeCode, callDate);
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process/employee, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

/**
 * Fatal calls -- every call this period where all six FATAL_PARAM_COLS
 * scored 0. Declared before /:processId for the same shadowing reason as
 * its siblings.
 */
router.get("/:processId/fatal-calls", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getFatalCalls(req.authUser!.id, req.params.processId, readPeriod(req));
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

/**
 * Root Cause vs. Workforce: the CLAP Agent-share trend alongside ramp-cohort
 * tenure, attrition and roster staffing gap for the same process/dates — a
 * plain juxtaposition, not a computed correlation (see the service function
 * for why). Declared before /:processId for the same shadowing reason as
 * its siblings.
 */
router.get("/:processId/workforce-correlation", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getWorkforceCorrelation(req.authUser!.id, req.params.processId, readPeriod(req));
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

/**
 * Business Health: revenue/GRN/expenses/Op% from the real P&L engine,
 * headcount vs. sanctioned mandate, and the hiring pipeline — for this one
 * process, this month. Declared before /:processId for the same shadowing
 * reason as its siblings.
 */
router.get("/:processId/business-health", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getProcessBusinessHealth(req.authUser!.id, req.params.processId);
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

router.get("/:processId", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const days = Number(req.query.days);
  // Clamped rather than trusted: an unbounded window here is a full-table scan
  // per metric, and the page only ever asks for a month.
  const windowDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 7), 90) : 30;
  const data = await svc.getProcessOperations(req.authUser!.id, req.params.processId, windowDays, readPeriod(req));
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

export { router as processOperationsRouter };
