import { fetchAllBranchHealthData } from "../branch-health-report/query.js";
import { buildBranchHealthReport, type BranchHealthReport } from "../branch-health-report/metrics.js";
import type { HeadBranch } from "./scope.js";
import type { BranchOverview, LeaderboardRow, SectionResult } from "./types.js";

/** Fetch once and build the report. Uses the branch CODE: name lookup is ambiguous for HEAD OFFICE. */
export async function loadReport(branch: HeadBranch, date: string): Promise<BranchHealthReport | null> {
  const raw = await fetchAllBranchHealthData(branch.branchCode, date);
  if (raw.branchId == null) return null;
  // The fetcher resolves by name-or-code LIMIT 1 and can land on another branch: never show that data.
  if (String(raw.branchId) !== branch.branchId) return null;
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

/** Person names present in the raw report; branch level is aggregate, so they must never reach the payload. */
function personNames(raw: any): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => { const t = String(v ?? "").trim(); if (t.length >= 2) out.add(t); };
  for (const n of raw?.headcount?.joinedNames ?? []) add(n);
  for (const n of raw?.headcount?.leftNames ?? []) add(n);
  for (const r of raw?.absence?.rows ?? []) { add(r?.name); add(r?.manager); }
  for (const r of raw?.lateStats?.byManager ?? []) add(r?.manager);
  return [...out];
}

function stripNames<T extends { label: string; detail: string }>(items: T[], names: string[], raw: any): T[] {
  const lower = names.map((n) => n.toLowerCase());
  const has = (t: string) => { const l = t.toLowerCase(); return lower.some((n) => l.includes(n)); };
  return items.map((it) => {
    const hit = has(it.detail) || has(it.label);
    if (!hit) return it;
    const joined = Number(raw?.headcount?.joinedToday) || 0;
    const detail = /new joiner/i.test(it.label) && joined > 0 ? `${joined} joined today` : "Names are available in the process drill-down";
    return { ...it, label: has(it.label) ? "Details in process drill-down" : it.label, detail };
  });
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
  const names = personNames(raw);
  return {
    branch,
    date,
    status: rep.overallStatus,
    attention: stripNames(rep.criticalPoints.map((p) => ({ label: p.label, detail: p.detail, severity: p.severity })), names, raw),
    positives: stripNames(rep.positiveAchievements.map((p) => ({ label: p.label, detail: p.detail })), names, raw),
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
      // Aggregate only: managers are anonymised as ranked "Team n" labels (late desc, then name for stability).
      return [...totals.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([, late], i) => ({ manager: `Team ${i + 1}`, late, shrinkagePct: null }));
    }, date),
  };
}
