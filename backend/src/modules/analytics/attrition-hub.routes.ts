/**
 * Attrition hub routes - /api/analytics/attrition-hub/*
 *
 * Open to people leaders by what they do, not just by role: HR / ops roles, or anyone with direct
 * reports (team leads often hold only the plain employee role). What each caller RECEIVES is
 * narrowed to their own scope plus reporting span in the service layer - the role check only
 * decides who may open the page.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasRole } from "../../shared/accessGuard.js";
import { hasDirectReports } from "../../shared/reportingSpan.js";
import { getModel, loadExits, scopedPopulation } from "./attrition-hub.service.js";
import { buildAlerts, buildEmployeeRisk, buildInsights, buildOverview, buildRisk, type RiskFilters } from "./attrition-hub.builders.js";
import type { Model } from "./attrition-hub.service.js";
import type { Tier } from "./attrition-model.js";

export const attritionHubRouter = Router();
attritionHubRouter.use(requireAuth);

const LEADER_ROLES = ["hr", "wfm", "branch_wfm", "manager", "process_manager", "assistant_manager", "branch_head", "tl", "team_leader", "ceo", "coo", "payroll_head"];

attritionHubRouter.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthenticatedRequest).authUser!.id;
    if ((await hasRole(userId, ...LEADER_ROLES)) || (await hasDirectReports(userId))) return next();
    return res.status(403).json({ success: false, message: "Attrition analytics is for people leaders and HR" });
  } catch (err) { return next(err); }
});

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req as AuthenticatedRequest, res).catch(next);

/** The calibration model, if it is ready within a few seconds; never blocks the page on a cold start. */
async function modelIfReady(ms = 8_000): Promise<Model | null> {
  try {
    return await Promise.race([getModel(), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  } catch { return null; }
}

const viewer = (req: AuthenticatedRequest) => ({ id: req.authUser!.id });
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const bool = (v: unknown) => v === "1" || v === "true";

attritionHubRouter.get("/overview", h(async (req, res) => {
  const [pop, ex, model] = await Promise.all([scopedPopulation(viewer(req)), loadExits(viewer(req)), modelIfReady()]);
  res.json({ success: true, data: buildOverview({ asOf: pop.asOf, people: pop.people, exits: ex.exits, events: ex.headcountEvents, model, degraded: pop.degraded }) });
}));

attritionHubRouter.get("/insights", h(async (req, res) => {
  const [pop, ex] = await Promise.all([scopedPopulation(viewer(req)), loadExits(viewer(req))]);
  res.json({ success: true, data: buildInsights({ asOf: pop.asOf, people: pop.people, exits: ex.exits, events: ex.headcountEvents }) });
}));

attritionHubRouter.get("/alerts", h(async (req, res) => {
  const [pop, ex, model] = await Promise.all([scopedPopulation(viewer(req)), loadExits(viewer(req)), modelIfReady()]);
  res.json({ success: true, data: buildAlerts({ asOf: pop.asOf, people: pop.people, exits: ex.exits, events: ex.headcountEvents, model, degraded: pop.degraded }) });
}));

attritionHubRouter.get("/risk", h(async (req, res) => {
  const [pop, model] = await Promise.all([scopedPopulation(viewer(req)), modelIfReady()]);
  const tier = str(req.query.tier)?.toUpperCase();
  const sort = str(req.query.sort);
  const filters: RiskFilters = {
    tier: tier && ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(tier) ? (tier as Tier) : undefined,
    branchId: str(req.query.branchId), processId: str(req.query.processId), managerId: str(req.query.managerId), q: str(req.query.q),
    absentOnly: bool(req.query.absentOnly), newJoinerOnly: bool(req.query.newJoinerOnly),
    sort: sort === "aon" || sort === "name" ? sort : "score",
    limit: Number(req.query.limit) || 25, offset: Number(req.query.offset) || 0,
  };
  res.json({ success: true, data: buildRisk(pop.people, filters, model) });
}));

attritionHubRouter.get("/employee/:id", h(async (req, res) => {
  const [pop, model] = await Promise.all([scopedPopulation(viewer(req)), modelIfReady()]);
  const p = pop.people.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, message: "Employee not found in your scope" });
  return res.json({ success: true, data: buildEmployeeRisk(p, model) });
}));

attritionHubRouter.get("/model", h(async (_req, res) => {
  res.json({ success: true, data: await getModel() });
}));

// Warm the backtest shortly after boot so the first person to open the page gets calibrated odds.
if (process.env.NODE_ENV !== "test") {
  setTimeout(() => { getModel().catch((e) => console.error("[attrition-hub] model warm-up failed:", e instanceof Error ? e.message : e)); }, 60_000).unref();
}
