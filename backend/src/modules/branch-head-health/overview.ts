import { fetchAllBranchHealthData } from "../branch-health-report/query.js";
import { buildBranchHealthReport, type BranchHealthReport } from "../branch-health-report/metrics.js";
import { CONSECUTIVE_ABSENCE_DAYS_LABEL, grnStatusLabel } from "../branch-health-report/template.js";
import { BANDS, bandOf, lateNotOnRoster } from "../branch-health-report/shifts.js";
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

/**
 * Person names present in the raw report. The explicit lists (absence, top risk, joined/left today, requester)
 * carry names on purpose, as the emailed report does; free-text attention/positives lines still must not.
 * Phone numbers, e-mail addresses, bank details and per-person salary never enter the payload.
 */
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

const MAX_RECENT_GRNS = 15;
const MAX_MOVEMENT_NAMES = 30;
const MAX_ABSENCE_ROWS = 10;
const MAX_TOP_RISK = 8;

const isoDate = (d: unknown): string => {
  const t = String(d ?? "").trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : "";
};

const daysBetween = (from: string, to: string): number => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86_400_000)) : 0;
};

/** Slice that must never fail its section: a throw yields `fallback`. */
function tolerant<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

const ageText = (b: { oldestDays: number; over3Days: number; over7Days: number }): string =>
  b.over7Days > 0 ? `oldest ${b.oldestDays}d · ${b.over7Days} over 7d`
    : b.over3Days > 0 ? `oldest ${b.oldestDays}d · ${b.over3Days} over 3d` : `oldest ${b.oldestDays}d`;

/** The email's "Pending actions" table rows: GRNs, leave, regularizations, exit clearances (plus any other raw type). */
function pendingActionRows(raw: any) {
  const rows: Array<{ type: string; count: number; label: string; age: string | null; oldestDays: number | null; over3Days: number | null; over7Days: number | null }> = [];
  const g = raw.grnStats;
  if (g && g.pending > 0) {
    rows.push({ type: "grn_pending", count: g.pending, label: "GRNs awaiting approval",
      age: `oldest ${g.oldestPendingDays}d · ${g.pendingOver3Days} over 3d`, oldestDays: g.oldestPendingDays, over3Days: g.pendingOver3Days, over7Days: null });
  }
  const l = raw.leaveAging;
  if (l && (l.pending > 0 || l.staleOlderThanWindow > 0)) {
    rows.push({ type: "leave_pending", count: l.pending, label: "Leave requests pending",
      age: `${ageText(l)}${l.staleOlderThanWindow > 0 ? ` · +${l.staleOlderThanWindow} stale (>90d)` : ""}`,
      oldestDays: l.oldestDays, over3Days: l.over3Days, over7Days: l.over7Days });
  }
  const r = raw.regularization;
  if (r && r.pending > 0) {
    rows.push({ type: "regularization_pending", count: r.pending, label: "Attendance regularizations pending",
      age: `${ageText(r)}${r.escalated > 0 ? ` · ${r.escalated} escalated` : ""}`,
      oldestDays: r.oldestDays, over3Days: r.over3Days, over7Days: r.over7Days });
  }
  for (const a of raw.pendingActions ?? []) {
    if (a.type === "grn_pending" || a.type === "leave_pending") continue;
    rows.push({ type: a.type, count: a.count, label: a.label, age: null, oldestDays: null, over3Days: null, over7Days: null });
  }
  return rows;
}

function attritionData(a: NonNullable<BranchHealthReport["raw"]["attrition"]>): AttritionData {
  return {
    critical: a.critical, high: a.high, medium: a.medium, low: a.low, expectedExits30: a.expectedExits30,
    absentStreak: a.absentStreak, newJoinerRisk: a.newJoinerRisk, exits30: a.exits30, exitsPrev30: a.exitsPrev30,
    exits90: a.exits90, earlyExitSharePct: a.earlyExitSharePct,
    monthlyExits: a.monthlyExits.map((m) => ({ month: m.month, exits: m.exits })),
    byProcess: a.byProcess.map((p) => ({ process: p.process, headcount: p.headcount, highRisk: p.highRisk, absentStreak: p.absentStreak })),
    topRiskCount: a.topRisk.length,
    // Same people the email lists (top 8 by score): code, name, process, tenure, score, tier, reasons.
    topRisk: a.topRisk.slice(0, MAX_TOP_RISK).map((p) => ({
      code: p.code, name: p.name, process: p.process ?? null, aonDays: p.aonDays, score: p.score, tier: p.tier,
      reasons: (p.reasons ?? []).map(String), absentStreak: p.absentStreak,
    })),
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
      const netMtd = h.joinedMtd - h.leftMtd;
      const mtdPct = (active: number, joined: number, left: number): number | null => {
        const avg = (active + left - joined + active) / 2;
        return avg > 0 ? Math.round((left / avg) * 1000) / 10 : null;
      };
      const names = (list: unknown) =>
        (Array.isArray(list) ? list : []).map((n) => String(n ?? "").trim()).filter(Boolean).slice(0, MAX_MOVEMENT_NAMES).map((name) => ({ name }));
      return {
        totalActive: h.totalActive, joinedToday: h.joinedToday, leftToday: h.leftToday,
        joinedMtd: h.joinedMtd, leftMtd: h.leftMtd, upcomingExits: h.upcomingExits,
        exitsNotClosed: h.exitsNotClosed, mandateSeatsTotal: h.mandateSeatsTotal,
        netMtd, attritionMtdPct: mtdPct(h.totalActive, h.joinedMtd, h.leftMtd),
        joinedNames: tolerant(() => names(h.joinedNames), []), leftNames: tolerant(() => names(h.leftNames), []),
        absence: tolerant(() => {
          const a = raw.absence;
          if (!a) return null;
          const rows = (a.rows ?? []).slice(0, MAX_ABSENCE_ROWS).map((r: any) => ({
            name: String(r.name ?? ""), code: String(r.code ?? ""), process: String(r.process ?? ""), manager: String(r.manager ?? ""),
          }));
          return { total: Number(a.total) || 0, days: CONSECUTIVE_ABSENCE_DAYS_LABEL, rows };
        }, null),
        byProcess: (h.byProcess ?? []).map((r) => ({
          process: r.process, active: r.active, joinedMtd: r.joinedMtd, leftMtd: r.leftMtd, mandateSeats: r.mandateSeats ?? null,
          joinedToday: r.joinedToday ?? 0, leftToday: r.leftToday ?? 0, netMtd: r.joinedMtd - r.leftMtd,
          attritionMtdPct: mtdPct(r.active, r.joinedMtd, r.leftMtd),
          mandateGap: r.mandateSeats == null ? null : r.active - r.mandateSeats,
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
        // Same band classifier and not-on-roster rule as the emailed report (branch-health-report/shifts.ts).
        bands: tolerant(() => BANDS.map((band) => {
          const inBand = (s.bySlot ?? []).filter((x) => bandOf(x.shift) === band);
          return {
            band, planned: inBand.reduce((n, x) => n + x.planned, 0),
            absent: inBand.reduce((n, x) => n + x.absent, 0), late: inBand.reduce((n, x) => n + x.late, 0),
          };
        }), []),
        lateNotOnRoster: tolerant(() => {
          const procs = new Set([...(s.bySlot ?? []).map((x) => x.process), ...raw.lateStats.byManager.map((m) => m.process)]);
          let total = 0;
          for (const name of procs) {
            const late = raw.lateStats.byManager.filter((m) => m.process === name).reduce((n, m) => n + m.count, 0);
            total += lateNotOnRoster((s.bySlot ?? []).filter((x) => x.process === name), late);
          }
          return total;
        }, 0),
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
        pendingActions: tolerant(() => pendingActionRows(raw), []),
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
        // Email section 3: latest GRNs (drafts excluded by the query). No requester or phone is carried.
        recentGrns: tolerant(() => (raw.recentGrns ?? []).slice(0, MAX_RECENT_GRNS).map((r) => {
          const raisedOn = isoDate(r.raisedOn);
          return {
            grnNo: r.grnNumber ?? null, vendor: r.vendorName ?? null, head: r.head ?? null, subHead: r.subHead ?? null,
            amountInclGst: Number(r.amount) || 0, status: r.status, stageLabel: grnStatusLabel(r.status),
            raisedOn, ageDays: raisedOn ? daysBetween(raisedOn, date) : 0,
          };
        }), []),
        // Email section 1: "Still open (not closed) sub-heads" of the previous months.
        openSubheads: tolerant(() => (raw.budgetHistory ?? []).flatMap((m) =>
          (m.openRows ?? []).map((r) => ({ periodCode: m.periodCode, head: r.head, subhead: r.subHead, budgetHeld: r.budget, spent: r.used }))), []),
        history: (raw.budgetHistory ?? []).map((m) => ({
          periodCode: m.periodCode, headerStatus: m.headerStatus, declared: m.declared, used: m.used,
          effective: m.effective, afterClosure: m.effective,
          usedPct: m.declared > 0 ? Math.round((m.used / m.declared) * 1000) / 10 : null, headsTotal: m.headsTotal, headsClosed: m.headsClosed,
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
