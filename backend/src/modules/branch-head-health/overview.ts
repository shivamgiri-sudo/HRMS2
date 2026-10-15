import { fetchAllBranchHealthData } from "../branch-health-report/query.js";
import { buildBranchHealthReport, type BranchHealthReport } from "../branch-health-report/metrics.js";
import type { HeadBranch } from "./scope.js";
import type { BranchOverview, LeaderboardRow, SectionResult } from "./types.js";

/** Fetch once and build the report. Uses the branch CODE: name lookup is ambiguous for HEAD OFFICE. */
export async function loadReport(branch: HeadBranch, date: string): Promise<BranchHealthReport | null> {
  const raw = await fetchAllBranchHealthData(branch.branchCode, date);
  if (raw.branchId == null) return null;
  return buildBranchHealthReport(branch.branchName, date, raw);
}

function safe<T>(fn: () => T, asOf: string): SectionResult<T> {
  try {
    const data = fn();
    return { status: "ok", data, asOf };
  } catch (err) {
    return { status: "error", data: null, asOf, message: err instanceof Error ? err.message : "Section failed" };
  }
}

const empty = <T>(asOf: string, message: string): SectionResult<T> =>
  ({ status: "empty", data: null, asOf, message });

export async function buildOverview(
  branch: HeadBranch,
  date: string,
  report?: BranchHealthReport | null,
): Promise<BranchOverview> {
  const rep = report === undefined ? await loadReport(branch, date) : report;
  if (!rep) {
    const msg = "No data for this branch";
    return {
      branch, date, status: "no_data", attention: [], positives: [],
      people: empty(date, msg), attendance: empty(date, msg), hiring: empty(date, msg),
      finance: empty(date, msg), leaderboard: empty(date, msg),
    };
  }
  const raw = rep.raw;
  return {
    branch,
    date,
    status: rep.overallStatus,
    attention: rep.criticalPoints.map((p) => ({ label: p.label, detail: p.detail, severity: p.severity })),
    positives: rep.positiveAchievements.map((p) => ({ label: p.label, detail: p.detail })),
    people: safe(() => {
      const h = raw.headcount;
      return {
        totalActive: h.totalActive, joinedToday: h.joinedToday, leftToday: h.leftToday,
        joinedMtd: h.joinedMtd, leftMtd: h.leftMtd, upcomingExits: h.upcomingExits,
        exitsNotClosed: h.exitsNotClosed, mandateSeatsTotal: h.mandateSeatsTotal,
      };
    }, date),
    attendance: safe(() => {
      const s = raw.shrinkage;
      return {
        scheduled: s.scheduled, present: s.present, absent: s.absent, onLeave: s.onLeave,
        shrinkagePct: s.shrinkagePct, yetToStart: s.yetToStart, totalLate: raw.lateStats.totalLate,
      };
    }, date),
    hiring: safe(() => {
      const o = raw.openHiring;
      return {
        openPositions: o.openPositions, inPipeline: o.inPipeline, selected: o.selected,
        requested: o.requested, fulfilled: o.fulfilled, pendingApproval: o.pendingApproval,
      };
    }, date),
    finance: safe(() => {
      const p = raw.runningPnl;
      return {
        periodCode: p.periodCode, revenueRunning: p.revenueRunning, totalCostRunning: p.totalCostRunning,
        operatingProfit: p.operatingProfit, opPct: p.opPct,
        budgetUtilizationPct: raw.budget.utilizationPct,
      };
    }, date),
    leaderboard: safe((): LeaderboardRow[] => {
      const totals = new Map<string, number>();
      for (const r of raw.lateStats.byManager) totals.set(r.manager, (totals.get(r.manager) ?? 0) + r.count);
      return [...totals.entries()]
        .map(([manager, late]) => ({ manager, late, shrinkagePct: null }))
        .sort((a, b) => b.late - a.late);
    }, date),
  };
}
