import { fetchAllBranchHealthData } from "../branch-health-report/query.js";
import { buildBranchHealthReport, type BranchHealthReport } from "../branch-health-report/metrics.js";
import type { HeadBranch } from "./scope.js";
import type { AttritionData, BranchOverview, LeaderboardRow, SectionResult } from "./types.js";

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

const aged = <E extends object>(b: { pending: number; oldestDays: number; over3Days: number; over7Days: number }, extra: E) =>
  ({ pending: b.pending, oldestDays: b.oldestDays, over3Days: b.over3Days, over7Days: b.over7Days, ...extra });

function attritionData(a: NonNullable<BranchHealthReport["raw"]["attrition"]>): AttritionData {
  return {
    critical: a.critical, high: a.high, medium: a.medium, low: a.low, expectedExits30: a.expectedExits30,
    absentStreak: a.absentStreak, newJoinerRisk: a.newJoinerRisk, exits30: a.exits30, exitsPrev30: a.exitsPrev30,
    exits90: a.exits90, earlyExitSharePct: a.earlyExitSharePct,
    monthlyExits: a.monthlyExits.map((m) => ({ month: m.month, exits: m.exits })),
    byProcess: a.byProcess.map((p) => ({ process: p.process, headcount: p.headcount, highRisk: p.highRisk, absentStreak: p.absentStreak })),
    // Count only: the people behind it are in the process drill-down.
    topRiskCount: a.topRisk.length,
    calibrationNote: a.calibrationNote,
  };
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
        byProcess: (h.byProcess ?? []).map((r) => ({
          process: r.process, active: r.active, joinedMtd: r.joinedMtd, leftMtd: r.leftMtd, mandateSeats: r.mandateSeats ?? null,
        })),
        byLob: (h.byLob ?? []).map((r) => ({ lob: r.lob, active: r.active })),
      };
    }, date),
    attendance: safe(() => {
      const s = raw.shrinkage;
      const p = raw.prevShrinkage;
      return {
        scheduled: s.scheduled, present: s.present, absent: s.absent, onLeave: s.onLeave,
        shrinkagePct: s.shrinkagePct, yetToStart: s.yetToStart, totalLate: raw.lateStats.totalLate,
        bySlot: (s.bySlot ?? []).map((r) => ({
          process: r.process, shift: r.shift, planned: r.planned, present: r.present, absent: r.absent, late: r.late,
        })),
        processWise: (raw.lateStats.processWise ?? []).map((r) => ({ process: r.process, late: r.count })),
        previousDay: p ? { shrinkagePct: p.shrinkagePct, absent: p.absent, scheduled: p.scheduled } : null,
        weekOffWorked: s.weekOffWorked ?? 0,
      };
    }, date),
    hiring: safe(() => {
      const o = raw.openHiring;
      const f = raw.offers;
      const a = raw.ats;
      const win = (w: { offered: number; joined: number; notJoined: number; conversionPct: number | null }) =>
        ({ offered: w.offered, joined: w.joined, notJoined: w.notJoined, conversionPct: w.conversionPct });
      return {
        openPositions: o.openPositions, inPipeline: o.inPipeline, selected: o.selected,
        requested: o.requested, fulfilled: o.fulfilled, pendingApproval: o.pendingApproval,
        // Requisition code and designation are not personal; no candidate or requester field is carried.
        batches: (o.rows ?? []).map((r) => ({
          process: r.process, designation: r.designation, priority: r.priority, requested: r.requested,
          fulfilled: r.fulfilled, openPositions: r.openPositions, inPipeline: r.inPipeline, selected: r.selected,
          deliveryDate: r.deliveryDate, daysToDelivery: r.daysToDelivery, plannedBatch: r.plannedBatch,
        })),
        offers: f ? { last30: win(f), mtd: win(f.mtd), joiningNext7Days: f.joiningNext7Days } : null,
        ats: a ? {
          walkins: a.walkins, tokens: a.tokens, tokensClosed: a.tokensClosed, selected: a.selected, rejected: a.rejected,
          noShow: a.noShow, clientRound: a.clientRound, hold: a.hold, otherClosed: a.otherClosed, open: a.open,
          noFeedback: a.noFeedback, openQueueCompleted: a.openQueueCompleted, slaBreaches: a.slaBreaches, slaTotal: a.slaTotal,
        } : null,
        pendingActions: (raw.pendingActions ?? []).map((x) => ({ type: x.type, count: x.count, label: x.label })),
      };
    }, date),
    finance: safe(() => {
      const p = raw.runningPnl;
      const g = raw.grnStats;
      const t = raw.pnlGrnTieOut;
      const pr = raw.payrollReadiness;
      const head = (r: { head: string; budget: number; charged: number; pct: number }) =>
        ({ head: r.head, budget: r.budget, charged: r.charged, pct: r.pct });
      const proj = (v: number) => (v / p.daysElapsed) * p.daysInMonth;
      const canProject = p.daysElapsed > 0 && p.daysInMonth > 0;
      return {
        periodCode: p.periodCode, revenueRunning: p.revenueRunning, totalCostRunning: p.totalCostRunning,
        operatingProfit: p.operatingProfit, opPct: p.opPct,
        budgetUtilizationPct: raw.budget.utilizationPct,
        pnl: {
          periodCode: p.periodCode, daysInMonth: p.daysInMonth, daysElapsed: p.daysElapsed, mode: p.mode,
          revenueInvoice: p.revenueInvoice, revenueAccrual: p.revenueAccrual, revenueEstimated: p.revenueEstimated,
          creditNote: p.creditNote, revenueRunning: p.revenueRunning, salaryRunning: p.salaryRunning,
          grnConsumed: p.grnConsumed, grnReserved: p.grnReserved, totalCostRunning: p.totalCostRunning,
          operatingProfit: p.operatingProfit, opPct: p.opPct, staffPaid: p.staffPaid,
          estimatedCostCentres: p.estimatedCostCentres, costCentres: p.costCentres, dataAvailable: p.dataAvailable,
        },
        projection: !canProject ? null : {
          revenue: proj(p.revenueRunning), cost: proj(p.totalCostRunning),
          operatingProfit: proj(p.revenueRunning - p.totalCostRunning), opPct: p.opPct,
          basis: "linear on days elapsed" as const,
        },
        budget: {
          periodCode: raw.budget.periodCode, totalBudget: raw.budget.totalBudget, consumed: raw.budget.consumed,
          reserved: raw.budget.reserved, available: raw.budget.available, utilizationPct: raw.budget.utilizationPct,
          headerMissing: raw.budgetHeader?.missing ?? null, headerStatus: raw.budgetHeader?.status ?? null,
        },
        byHead: {
          top: (raw.budgetByHead?.top ?? []).map(head),
          overBudget: (raw.budgetByHead?.overBudget ?? []).map(head),
        },
        history: (raw.budgetHistory ?? []).map((m) => ({
          periodCode: m.periodCode, headerStatus: m.headerStatus, declared: m.declared, used: m.used,
          effective: m.effective, headsTotal: m.headsTotal, headsClosed: m.headsClosed,
          openRows: (m.openRows ?? []).map((r) => ({ head: r.head, subHead: r.subHead, budget: r.budget, used: r.used })),
        })),
        grn: g ? {
          raised: g.raised, approved: g.approved, pending: g.pending, oldestPendingDays: g.oldestPendingDays,
          pendingOver3Days: g.pendingOver3Days, totalRaisedAmount: g.totalRaisedAmount,
          pendingByStage: g.pendingByStage.map((s) => ({
            status: s.status, stage: s.stage, count: s.count, amountInclGst: s.amountInclGst, oldestDays: s.oldestDays,
          })),
          byType: g.byType.map((x) => ({
            type: x.type, label: x.label, raised: x.raised, raisedInclGst: x.raisedInclGst, raisedExGst: x.raisedExGst,
            approved: x.approved, pending: x.pending, pendingInclGst: x.pendingInclGst,
          })),
          bridge: {
            raisedExGst: g.bridge.raisedExGst, awaitingApproval: g.bridge.awaitingApproval, earlierBudget: g.bridge.earlierBudget,
            noBudgetLine: g.bridge.noBudgetLine, chargedThisMonth: g.bridge.chargedThisMonth,
            fromEarlierMonths: g.bridge.fromEarlierMonths, budgetChargeTotal: g.bridge.budgetChargeTotal,
          },
          unbudgeted: { count: g.unbudgeted.count, amountExGst: g.unbudgeted.amountExGst },
        } : null,
        tieOut: t ? {
          budgetConsumed: t.budgetConsumed, budgetReserved: t.budgetReserved, hrmsNoBudgetLine: t.hrmsNoBudgetLine,
          hrmsOrdinary: t.hrmsOrdinary, imprestReservedNoCostCentre: t.imprestReservedNoCostCentre,
        } : null,
        payrollReadiness: pr ? {
          cycleMonth: pr.cycleMonth,
          calendar: pr.calendar ? {
            attendanceCutoff: pr.calendar.attendanceCutoff, incentiveDeadline: pr.calendar.incentiveDeadline,
            branchReadinessDeadline: pr.calendar.branchReadinessDeadline, payrollRunDate: pr.calendar.payrollRunDate,
          } : null,
          pendingRegularization: pr.pendingRegularization, pendingLeave: pr.pendingLeave,
          incentivesExpected: pr.incentivesExpected, incentiveState: pr.incentiveState,
          pendingIncrements: pr.pendingIncrements, oldestIncrementDays: pr.oldestIncrementDays,
        } : null,
      };
    }, date),
    attrition: raw.attrition ? safe(() => attritionData(raw.attrition!), date) : empty<AttritionData>(date, "Attrition data is not available"),
    backlogs: safe(() => ({
      regularization: aged(raw.regularization, { escalated: raw.regularization.escalated }),
      leaveAging: aged(raw.leaveAging, { staleOlderThanWindow: raw.leaveAging.staleOlderThanWindow }),
    }), date),
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
