import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getCurrentDateIST } from "../../shared/istDate.js";
import { resolveHeadBranches, type HeadBranch } from "./scope.js";
import { buildOverview, loadReport } from "./overview.js";
import { listBranchProcesses, getProcessDrilldown } from "./processes.js";
import { buildOpsSections, monthStart } from "./ops.js";
import { buildDataHealth } from "./dataHealth.js";
import { computeScore } from "./score.js";
import { writeSnapshot, readTrend } from "./snapshot.js";
import type { BranchHeadHealthPayload, BranchOverview, SectionResult } from "./types.js";

export const branchHeadHealthRouter = Router();

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Flag is read per request so it can be toggled without a restart (and in tests).
branchHeadHealthRouter.use((_req, res, next) => {
  if (process.env.BRANCH_HEAD_HEALTH_ENABLED !== "true") {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  next();
});
branchHeadHealthRouter.use(requireAuth);
branchHeadHealthRouter.use(requireRole("branch_head", "ceo", "coo", "super_admin"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function errorSection<T>(date: string): SectionResult<T> {
  return { status: "error", data: null, asOf: date, message: "Branch data could not be loaded" };
}

function errorOverview(branch: HeadBranch, date: string): BranchOverview {
  return {
    branch, date, status: "no_data", attention: [], positives: [],
    people: errorSection(date), attendance: errorSection(date), hiring: errorSection(date),
    finance: errorSection(date), leaderboard: errorSection(date),
  };
}

const MAX_CONCURRENCY = 3;

/** Order-preserving map with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const TREND_METRICS = new Set([
  "score", "shrinkagePct", "totalLate", "totalActive", "joinedMtd", "leftMtd",
  "upcomingExits", "openPositions", "budgetUtilizationPct", "opPct",
]);
const DRILL_METRIC_RE = /^[A-Z0-9_]{1,64}$/;

function numeric(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function snapshotMetrics(report: any): Record<string, number> {
  const raw = report?.raw ?? {};
  const candidates: Record<string, unknown> = {
    shrinkagePct: raw.shrinkage?.shrinkagePct,
    totalLate: raw.lateStats?.totalLate,
    totalActive: raw.headcount?.totalActive,
    joinedMtd: raw.headcount?.joinedMtd,
    leftMtd: raw.headcount?.leftMtd,
    upcomingExits: raw.headcount?.upcomingExits,
    openPositions: raw.openHiring?.openPositions,
    budgetUtilizationPct: raw.budget?.utilizationPct,
    opPct: raw.runningPnl?.opPct,
  };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(candidates)) {
    const n = numeric(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

branchHeadHealthRouter.get(
  "/overview",
  h(async (req, res) => {
    const today = getCurrentDateIST();
    const rawDate = req.query.date === undefined || req.query.date === "" ? today : String(req.query.date);
    if (!DATE_RE.test(rawDate) || !isRealDate(rawDate)) {
      return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD" });
    }
    if (rawDate > today) {
      return res.status(400).json({ success: false, message: "date cannot be in the future" });
    }
    const date = rawDate;

    const scope = await resolveHeadBranches(req.authUser.id);
    const requested = String(req.query.branchIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const branches = requested.length
      ? scope.branches.filter((b) => requested.includes(b.branchId))
      : scope.branches;

    const rows = await mapLimit(branches, MAX_CONCURRENCY, async (branch) => {
      try {
        const report = await loadReport(branch, date);
        const overview = await buildOverview(branch, date, report);
        const score = report ? computeScore(report) : null;
        if (score && date === today) {
          Promise.resolve()
            .then(() => writeSnapshot(branch.branchId, date, score.score, score.pillars, snapshotMetrics(report)))
            .catch((err) => console.error("[branch-head-health] snapshot write failed", err));
        }
        return { branch, overview, score };
      } catch (err) {
        console.error("[branch-head-health] branch load failed", branch.branchId, err);
        return { branch, overview: errorOverview(branch, date), score: null };
      }
    });

    let processes: BranchHeadHealthPayload["processes"] = { active: [], unmapped: [] };
    let processesError = false;
    try {
      processes = await listBranchProcesses(branches.map((b) => b.branchId));
    } catch (err) {
      processesError = true;
      console.error("[branch-head-health] process list failed", err);
    }
    if (processesError) {
      for (const row of rows) {
        row.overview = { ...row.overview, operations: errorSection(date), quality: errorSection(date), callmaster: errorSection(date), dataHealth: errorSection(date) };
      }
    } else {
      let dataHealth: SectionResult<unknown>;
      try {
        dataHealth = await buildDataHealth(branches.map((b) => b.branchId), date);
      } catch (err) {
        console.error("[branch-head-health] data health failed", err);
        dataHealth = errorSection(date);
      }
      const range = { startDate: monthStart(date), endDate: date };
      await mapLimit(rows, MAX_CONCURRENCY, async (row) => {
        const mine = processes.active.filter((p) => !p.billingMirror && p.branchIds.includes(row.branch.branchId));
        try {
          const s = await buildOpsSections(mine, range);
          row.overview = { ...row.overview, ...s, dataHealth };
        } catch (err) {
          console.error("[branch-head-health] ops sections failed", row.branch.branchId, err);
          row.overview = { ...row.overview, operations: errorSection(date), quality: errorSection(date), callmaster: errorSection(date), dataHealth };
        }
      });
    }
    const data: BranchHeadHealthPayload = {
      scope: { viaHomeFallback: scope.viaHomeFallback, orgWide: scope.orgWide, emptyReason: scope.emptyReason },
      branches: rows,
      processes,
      ...(processesError ? { processesError: true } : {}),
      generatedAt: new Date().toISOString(),
    };
    return res.json({ success: true, data });
  }),
);

branchHeadHealthRouter.get(
  "/process/:processId/drilldown",
  h(async (req, res) => {
    const branchId = String(req.query.branchId ?? "");
    const scope = await resolveHeadBranches(req.authUser.id);
    if (!branchId || !scope.branches.some((b) => b.branchId === branchId)) {
      return res.status(403).json({ success: false, message: "Branch not in your scope" });
    }
    const metric = String(req.query.metric || "QA_QUALITY_PCT");
    if (!DRILL_METRIC_RE.test(metric)) {
      return res.status(400).json({ success: false, message: "Invalid metric" });
    }
    const data = await getProcessDrilldown(branchId, String(req.params.processId), metric);
    return res.json({ success: true, data });
  }),
);

branchHeadHealthRouter.get(
  "/trend",
  h(async (req, res) => {
    const branchId = String(req.query.branchId ?? "");
    const scope = await resolveHeadBranches(req.authUser.id);
    if (!branchId || !scope.branches.some((b) => b.branchId === branchId)) {
      return res.status(403).json({ success: false, message: "Branch not in your scope" });
    }
    const metric = String(req.query.metric || "score");
    if (!TREND_METRICS.has(metric)) {
      return res.status(400).json({ success: false, message: "Unknown metric" });
    }
    const parsed = Math.floor(Number(req.query.days));
    const days = Math.max(1, Math.min(90, Number.isFinite(parsed) && parsed > 0 ? parsed : 30));
    const data = await readTrend(branchId, metric, days);
    return res.json({ success: true, data });
  }),
);
