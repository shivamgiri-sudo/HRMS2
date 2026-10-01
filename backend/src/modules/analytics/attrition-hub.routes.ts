/**
 * Attrition hub routes - /api/analytics/attrition-hub/*
 *
 * Open to people leaders by what they do, not just by role: HR / ops roles, or anyone with direct
 * reports (team leads often hold only the plain employee role). What each caller RECEIVES is
 * narrowed to their own scope plus reporting span in the service layer - the role check only
 * decides who may open the page.
 */
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasRole } from "../../shared/accessGuard.js";
import { hasDirectReports } from "../../shared/reportingSpan.js";
import { FACTOR_GROUP_ORDER, type FactorGroup } from "./attrition-model.js";
import { getModel, getPopulation, loadExits, loadModelHistory, loadSnapshotModel, scopedPopulation } from "./attrition-hub.service.js";
import { loadFirstPresence } from "./attrition-hub.data.js";
import { addFollowup, followupEffect, latestFollowups, listFollowups, validateFollowup } from "./attrition-hub.followups.js";
import { buildBatches, buildDrill, buildOutlook, buildPulse, buildScorecard, type DrillFilters } from "./attrition-hub.drill.js";
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

/**
 * The calibration model. A restart leaves the live test (about 25 s of queries) cold, so rather than make the
 * page wait or report a failure, fall back to the last saved calibration while the live one finishes.
 */
async function modelIfReady(ms = 10_000): Promise<Model | null> {
  try {
    const live = await Promise.race([getModel(), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
    if (live) return live;
  } catch { /* fall through to the saved one */ }
  return loadSnapshotModel();
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
  const [pop, model, followups] = await Promise.all([scopedPopulation(viewer(req)), modelIfReady(), latestFollowups()]);
  const tier = str(req.query.tier)?.toUpperCase();
  const group = str(req.query.group);
  const sort = str(req.query.sort);
  const filters: RiskFilters = {
    tier: tier && ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(tier) ? (tier as Tier) : undefined,
    group: group && (FACTOR_GROUP_ORDER as string[]).includes(group) ? (group as FactorGroup) : undefined,
    branchId: str(req.query.branchId), processId: str(req.query.processId), managerId: str(req.query.managerId), q: str(req.query.q),
    absentOnly: bool(req.query.absentOnly), newJoinerOnly: bool(req.query.newJoinerOnly),
    sort: sort === "aon" || sort === "name" ? sort : "score",
    limit: Number(req.query.limit) || 25, offset: Number(req.query.offset) || 0,
  };
  res.json({ success: true, data: buildRisk(pop.people, filters, model, followups) });
}));

attritionHubRouter.get("/employee/:id", h(async (req, res) => {
  const [pop, model, followups] = await Promise.all([scopedPopulation(viewer(req)), modelIfReady(), latestFollowups()]);
  const p = pop.people.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, message: "Employee not found in your scope" });
  return res.json({ success: true, data: buildEmployeeRisk(p, model, followups.get(p.id)) });
}));

attritionHubRouter.get("/model", h(async (_req, res) => {
  const [model, history] = await Promise.all([getModel(), loadModelHistory()]);
  res.json({ success: true, data: { ...model, history } });
}));

const flag = (v: unknown) => v === "1" || v === "true";
const DRILL_STR = ["tier", "group", "branchId", "processId", "managerId", "designationId", "source", "aonBucket", "tenureBin", "month", "reason", "exitType", "joinWeek", "q"] as const;

/** The people behind any number on the page. */
attritionHubRouter.get("/drill", h(async (req, res) => {
  const pop = String(req.query.population ?? "active");
  if (!["active", "exits", "joiners"].includes(pop)) return res.status(400).json({ success: false, message: "population must be active, exits or joiners" });
  const f: DrillFilters = { population: pop as DrillFilters["population"] };
  for (const k of DRILL_STR) { const v = str(req.query[k]); if (v) (f as unknown as Record<string, unknown>)[k] = v; }
  if (f.tier) f.tier = f.tier.toUpperCase() as Tier;
  if (f.group && !(FACTOR_GROUP_ORDER as string[]).includes(f.group)) delete f.group;
  f.absentOnly = flag(req.query.absentOnly); f.newJoinerOnly = flag(req.query.newJoinerOnly); f.notice = flag(req.query.notice); f.noReason = flag(req.query.noReason);
  const fu = str(req.query.followup); if (fu === "none" || fu === "any") f.followup = fu;
  const sort = str(req.query.sort); if (sort && ["score", "aon", "name", "date"].includes(sort)) f.sort = sort as DrillFilters["sort"];
  f.minAbsentStreak = Math.min(Math.max(Number(req.query.minAbsentStreak) || 0, 0), 30) || undefined;
  f.windowDays = Number(req.query.windowDays) || undefined; f.limit = Number(req.query.limit) || 50; f.offset = Number(req.query.offset) || 0;
  const [popn, ex, model, followups] = await Promise.all([scopedPopulation(viewer(req)), loadExits(viewer(req)), modelIfReady(), latestFollowups()]);
  res.json({ success: true, data: buildDrill({ asOf: popn.asOf, filters: f, people: popn.people, events: ex.headcountEvents, model, followups }) });
}));

attritionHubRouter.get("/followups/effectiveness", h(async (req, res) => {
  const [pop, model] = await Promise.all([scopedPopulation(viewer(req)), modelIfReady()]);
  // people who have left are no longer in the active list, so scope by the exits dataset too
  const ex = await loadExits(viewer(req));
  const allowed = pop.orgWide ? null : new Set([...pop.people.map((p) => p.id), ...ex.headcountEvents.map((e) => e.id)]);
  res.json({ success: true, data: await followupEffect(allowed, model) });
}));

attritionHubRouter.get("/followups", h(async (req, res) => {
  const employeeId = str(req.query.employeeId);
  if (!employeeId) return res.status(400).json({ success: false, message: "employeeId is required" });
  const [pop, ex] = await Promise.all([scopedPopulation(viewer(req)), loadExits(viewer(req))]);
  if (!pop.people.some((p) => p.id === employeeId) && !ex.headcountEvents.some((e) => e.id === employeeId))
    return res.status(404).json({ success: false, message: "Employee not found in your scope" });
  return res.json({ success: true, data: await listFollowups(employeeId) });
}));

attritionHubRouter.post("/followups", express.json(), h(async (req, res) => {
  const v = validateFollowup(req.body ?? {});
  if (!v.ok) return res.status(400).json({ success: false, message: v.message });
  const employeeId = str(req.body?.employeeId);
  if (!employeeId) return res.status(400).json({ success: false, message: "employeeId is required" });
  const pop = await scopedPopulation(viewer(req));
  const p = pop.people.find((x) => x.id === employeeId);
  if (!p) return res.status(403).json({ success: false, message: "This employee is not in your team or branch" });
  const saved = await addFollowup({ employeeId, kind: v.kind, outcome: v.outcome, note: v.note, userId: viewer(req).id, tier: p.tier, score: Math.round(p.score) });
  return res.status(201).json({ success: true, data: saved });
}));

attritionHubRouter.get("/batches", h(async (req, res) => {
  const [pop, ex, presence] = await Promise.all([scopedPopulation(viewer(req)), loadExits(viewer(req)), loadFirstPresence().catch(() => ({ firstPresent: new Map<string, number | null>(), seen: new Set<string>() }))]);
  const absent = new Set(pop.people.filter((p) => !p.inNotice && (p.features.absentStreak ?? 0) >= 3).map((p) => p.id));
  res.json({ success: true, data: buildBatches({ asOf: pop.asOf, events: ex.headcountEvents, firstPresent: presence.firstPresent, seen: presence.seen, absent }) });
}));

attritionHubRouter.get("/scorecard", h(async (req, res) => {
  const by = str(req.query.by);
  const dim = by === "branch" || by === "process" || by === "designation" ? by : "source";
  const [pop, ex] = await Promise.all([scopedPopulation(viewer(req)), loadExits(viewer(req))]);
  res.json({ success: true, data: buildScorecard({ asOf: pop.asOf, events: ex.headcountEvents, by: dim }) });
}));

attritionHubRouter.get("/outlook", h(async (req, res) => {
  const [pop, ex, model] = await Promise.all([scopedPopulation(viewer(req)), loadExits(viewer(req)), modelIfReady()]);
  res.json({ success: true, data: buildOutlook({ people: pop.people, data: ex, model }) });
}));

attritionHubRouter.get("/pulse", h(async (req, res) => {
  const [pop, ex, model] = await Promise.all([scopedPopulation(viewer(req)), loadExits(viewer(req)), modelIfReady()]);
  const base = { asOf: pop.asOf, people: pop.people, exits: ex.exits, events: ex.headcountEvents, model, degraded: pop.degraded };
  const overview = buildOverview(base);
  const alerts = buildAlerts(base);
  const branchLevel = pop.orgWide ? false : await hasRole(viewer(req).id, "hr", "branch_head", "branch_wfm", "wfm", "payroll_head");
  res.json({ success: true, data: buildPulse({ overview, alerts, people: pop.people, scope: pop.orgWide ? "org" : branchLevel ? "branch" : "team" }) });
}));

// Warm the risk list and the backtest shortly after boot so the first person to open the page does not wait.
if (process.env.NODE_ENV !== "test") {
  setTimeout(() => {
    for (const warm of [getPopulation, getModel, loadFirstPresence]) warm().catch((e) => console.error("[attrition-hub] warm-up failed:", e instanceof Error ? e.message : e));
  }, 45_000).unref();
}
