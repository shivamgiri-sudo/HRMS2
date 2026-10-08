import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { getCurrentDateIST } from "../../shared/istDate.js";
import { getPnlReconciliation, type PnlReconciliation } from "./pnl-reconciliation.service.js";
import { costCentreLabel } from "./cost-centre-label.js";

/**
 * P&L trend — revenue, salary cost, IDC and OP% by day, week or month, for the company, one
 * branch, or one cost centre.
 *
 * ONE SOURCE OF TRUTH. Every month's totals come from getPnlReconciliation — the Live P&L — so the
 * trend can never disagree with the headline strip or the Live P&L tab: invoices, then billing
 * provisions, then seat rate x seats for cost centres not invoiced yet; salary from the payroll
 * run (or the running-salary accrual); IDC = vendor/GRN spend.
 *
 * Days and weeks DISTRIBUTE those monthly totals rather than inventing daily figures, and say so:
 *   revenue — evenly over the month's days (a seat is billed per month; no daily revenue event
 *             exists). For the open month, over the days elapsed, because the estimate is itself
 *             month-to-date.
 *   salary  — by that day's payable attendance in the scope (present/half/leave/week-off weights,
 *             the payroll treatment), evenly if no attendance was recorded.
 *   IDC     — by GRN bill date in the scope, evenly if no dated GRN exists.
 * So any set of days or weeks sums back to its months exactly.
 *
 * A month with no people cost at all (the open month before its payroll or running-salary
 * snapshot) reports salary as missing and OP% as null — a gap on the chart, never a ~100% margin.
 */

export type TrendGrain = "day" | "week" | "month";
export type TrendScopeType = "company" | "branch" | "cost_centre";

export interface TrendPoint {
  key: string;
  label: string;
  start: string;
  end: string;
  revenue: number;
  revenueActual: number;
  revenueEstimated: number;
  salary: number | null;
  idc: number;
  cost: number | null;
  op: number | null;
  opPct: number | null;
  salaryMissing: boolean;
  /** No indirect cost recorded for the month anywhere (Live P&L idcMissing) — OP% is NA. */
  idcMissing: boolean;
  /** true when the bucket extends past today (open month / current week). */
  isPartial: boolean;
}

export interface TrendSeries {
  grain: TrendGrain;
  scope: { type: TrendScopeType; id: string | null; label: string };
  asOfDate: string;
  points: TrendPoint[];
  totals: { revenue: number; revenueEstimated: number; salary: number | null; idc: number; op: number | null; opPct: number | null };
  notes: string[];
  options: {
    branches: Array<{ id: string; name: string }>;
    costCentres: Array<{ id: string; code: string; name: string; processName: string | null; branchId: string | null; branchName: string }>;
  };
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 12;
const MAX_WEEKS = 26;
const CACHE_MS = 5 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Mirrors pnl-daily-trend.service.ts PAYABLE_WEIGHT_SQL (the payroll treatment of a day).
const PAYABLE_WEIGHT_SQL = `
  CASE a.attendance_status
    WHEN 'present' THEN 1
    WHEN 'half_day' THEN 0.5
    WHEN 'week_off' THEN 1
    WHEN 'week_off_worked' THEN 1
    WHEN 'holiday' THEN 1
    WHEN 'leave_approved' THEN 1
    ELSE 0
  END`;

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const daysIn = (period: string) => { const [y, m] = period.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const dayKey = (period: string, day: number) => `${period}-${String(day).padStart(2, "0")}`;
const monthLabel = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]}-${period.slice(2, 4)}`;
const dayLabel = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/** Monday (ISO week start) of the week containing `date` (YYYY-MM-DD). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
const addDays = (date: string, k: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

// ── Live P&L per month, cached ──────────────────────────────────────────────────────────────

const cache = new Map<string, { at: number; data: Promise<PnlReconciliation> }>();
export function clearTrendCache() { cache.clear(); }

export function monthlyReconciliation(period: string, branchIds: string[], asOfDate: string): Promise<PnlReconciliation> {
  const key = `${period}|${[...branchIds].sort().join(",")}|${asOfDate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = getPnlReconciliation(period, { branchIds, asOfDate });
  data.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  return data;
}

export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

interface ScopeTotals { revenue: number; revenueEstimated: number; payroll: number; grn: number; label: string; idcMissing: boolean }

function scopeTotals(rec: PnlReconciliation, scope: { type: TrendScopeType; id: string | null }): ScopeTotals {
  if (scope.type === "cost_centre") {
    const row = rec.rows.find((r) => r.costCentreId === scope.id);
    return {
      revenue: n(row?.recognisedRevenue), revenueEstimated: n(row?.revenueEstimated),
      payroll: n(row?.payrollCost), grn: n(row?.grnActual) + n(row?.grnEstimated), idcMissing: Boolean(rec.idcMissing),
      label: row ? costCentreLabel(row.costCentreCode, row.costCentreProcess ?? (row.costCentreName !== row.costCentreCode ? row.costCentreName : null)) : "Cost centre",
    };
  }
  if (scope.type === "branch") {
    const rows = rec.rows.filter((r) => r.branchId === scope.id);
    const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    // The branch's staff with no cost centre are in its rollup, not in any row — same as Live P&L.
    const unallocated = n(rec.branches.find((b) => b.branchId === scope.id)?.unallocatedPayroll);
    return {
      revenue: sum((r) => r.recognisedRevenue), revenueEstimated: sum((r) => r.revenueEstimated),
      payroll: sum((r) => r.payrollCost) + unallocated, grn: sum((r) => r.grnActual) + sum((r) => r.grnEstimated), idcMissing: Boolean(rec.idcMissing),
      label: rows[0]?.branchName ?? rec.branches.find((b) => b.branchId === scope.id)?.branchName ?? "Branch",
    };
  }
  return {
    revenue: rec.totals.revenue, revenueEstimated: rec.totals.revenueEstimated ?? 0,
    payroll: rec.totals.payrollCost, grn: rec.totals.grnActual + rec.totals.grnEstimated, label: rec.company, idcMissing: Boolean(rec.idcMissing),
  };
}

// ── Daily weights ───────────────────────────────────────────────────────────────────────────

async function attendanceWeights(period: string, scope: { type: TrendScopeType; id: string | null }): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("attendance_daily_record"))) return out;
  const from = `${period}-01`, to = `${shiftMonth(period, 1)}-01`;
  const join = scope.type === "cost_centre" ? "JOIN employees e ON e.id = a.employee_id AND e.cost_centre_id = ?" : "";
  const where = scope.type === "branch" ? "AND a.branch_id = ?" : "";
  const params: unknown[] = [];
  if (scope.type === "cost_centre") params.push(scope.id);
  params.push(from, to);
  if (scope.type === "branch") params.push(scope.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(a.record_date, '%Y-%m-%d') AS d, SUM(${PAYABLE_WEIGHT_SQL}) AS w
       FROM attendance_daily_record a ${join}
      WHERE a.record_date >= ? AND a.record_date < ? ${where}
      GROUP BY d`,
    params,
  );
  for (const r of rows) out.set(String(r.d), n(r.w));
  return out;
}

/*
 * Indirect cost is spread evenly over the month's days (accrual), NOT by GRN bill date.
 * Changed 2026-09-15 after the OP% check: rent, power and vendor bills are monthly costs, but
 * they are billed on a handful of dates — spreading by bill date put most of August's Rs 75 L on
 * the 1st, so one day read -575% and the weeks after read 13-36% against a 7% month.
 */

/** Spread `total` over `days` by `weights` (evenly when the weights sum to nothing). */
export function distribute(total: number, days: string[], weights: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const sum = days.reduce((t, d) => t + (weights.get(d) ?? 0), 0);
  for (const d of days) out.set(d, sum > 0 ? (total * (weights.get(d) ?? 0)) / sum : days.length ? total / days.length : 0);
  return out;
}

interface DayValue { date: string; revenue: number; revenueEstimated: number; salary: number | null; idc: number; partial: boolean; idcMissing: boolean }

async function dailyValues(period: string, scope: { type: TrendScopeType; id: string | null }, branchIds: string[], asOfDate: string): Promise<{ days: DayValue[]; totals: ScopeTotals }> {
  const rec = await monthlyReconciliation(period, branchIds, asOfDate);
  const t = scopeTotals(rec, scope);
  const all = Array.from({ length: daysIn(period) }, (_, i) => dayKey(period, i + 1));
  const open = asOfDate.slice(0, 7) === period;
  const days = open ? all.filter((d) => d <= asOfDate) : all;
  const att = await attendanceWeights(period, scope);
  const rev = distribute(t.revenue, days, new Map());
  const est = distribute(t.revenueEstimated, days, new Map());
  const sal = distribute(t.payroll, days, att);
  const idc = distribute(t.grn, days, new Map());
  return {
    totals: t,
    days: days.map((d) => ({
      date: d,
      revenue: rev.get(d) ?? 0,
      revenueEstimated: est.get(d) ?? 0,
      salary: t.payroll > 0 ? sal.get(d) ?? 0 : null,
      idc: idc.get(d) ?? 0,
      partial: open,
      idcMissing: t.idcMissing,
    })),
  };
}

function toPoint(key: string, label: string, start: string, end: string, v: { revenue: number; revenueEstimated: number; salary: number | null; idc: number; idcMissing?: boolean }, isPartial: boolean): TrendPoint {
  const salaryMissing = v.salary === null;
  const idcMissing = Boolean(v.idcMissing);
  const cost = salaryMissing ? null : (v.salary as number) + v.idc;
  const op = cost === null ? null : v.revenue - cost;
  return {
    key, label, start, end,
    revenue: r2(v.revenue),
    revenueActual: r2(v.revenue - v.revenueEstimated),
    revenueEstimated: r2(v.revenueEstimated),
    salary: v.salary === null ? null : r2(v.salary),
    idc: r2(v.idc),
    cost: cost === null ? null : r2(cost),
    op: op === null ? null : r2(op),
    // Positive revenue only (a credit-note month reads as a flipped margin), and never without overheads.
    opPct: op === null || idcMissing || v.revenue < 0.5 ? null : r2((op / v.revenue) * 100),
    salaryMissing,
    idcMissing,
    isPartial,
  };
}

export async function getPnlTrendSeries(input: {
  grain: string; scopeType: string; scopeId?: string | null; anchor: string; count?: number;
  branchScope?: string | null; costCentreBranchId?: string | null; asOfDate?: string;
}): Promise<TrendSeries> {
  const grain = input.grain as TrendGrain;
  if (!["day", "week", "month"].includes(grain)) throw httpError(400, "grain must be day, week or month");
  const scopeType = input.scopeType as TrendScopeType;
  if (!["company", "branch", "cost_centre"].includes(scopeType)) throw httpError(400, "scope must be company, branch or cost_centre");
  if (scopeType !== "company" && !input.scopeId) throw httpError(400, "scopeId is required for branch or cost centre");
  if (!PERIOD_RE.test(input.anchor)) throw httpError(400, "anchor must be YYYY-MM");
  const asOfDate = input.asOfDate ?? getCurrentDateIST();
  const today = asOfDate.slice(0, 7);
  const anchor = input.anchor > today ? today : input.anchor;
  const scope = { type: scopeType, id: scopeType === "company" ? null : String(input.scopeId) };

  // What the monthly Live P&L call is restricted to: the caller's own branch (branch-scoped
  // users), the requested branch, or the cost centre's branch. Keeps each call to one branch.
  const branchId = input.branchScope ?? (scopeType === "branch" ? scope.id : scopeType === "cost_centre" ? input.costCentreBranchId ?? null : null);
  const branchIds = branchId ? [branchId] : [];

  let points: TrendPoint[] = [];
  let label = "";
  const notes: string[] = [];

  if (grain === "month") {
    const count = Math.min(Math.max(input.count ?? 6, 2), MAX_MONTHS);
    const periods = Array.from({ length: count }, (_, i) => shiftMonth(anchor, i - count + 1));
    const recs = await pool(periods, 3, (p) => monthlyReconciliation(p, branchIds, asOfDate));
    points = periods.map((p, i) => {
      const t = scopeTotals(recs[i], scope);
      label = t.label;
      return toPoint(p, monthLabel(p), `${p}-01`, dayKey(p, daysIn(p)), {
        revenue: t.revenue, revenueEstimated: t.revenueEstimated, salary: t.payroll > 0 ? t.payroll : null, idc: t.grn, idcMissing: t.idcMissing,
      }, p === today);
    });
  } else if (grain === "day") {
    const { days, totals } = await dailyValues(anchor, scope, branchIds, asOfDate);
    label = totals.label;
    points = days.map((d) => toPoint(d.date, dayLabel(d.date), d.date, d.date, d, d.date === asOfDate));
    notes.push("Daily revenue and IDC are the month's figures spread evenly across its days (accrual); salary follows each day's attendance. Days add up to the month exactly.");
  } else {
    const count = Math.min(Math.max(input.count ?? 8, 2), MAX_WEEKS);
    const lastDay = anchor === today ? asOfDate : dayKey(anchor, daysIn(anchor));
    const lastWeek = weekStart(lastDay);
    const firstWeek = addDays(lastWeek, -7 * (count - 1));
    const periods: string[] = [];
    for (let p = firstWeek.slice(0, 7); p <= lastDay.slice(0, 7); p = shiftMonth(p, 1)) periods.push(p);
    const months = await pool(periods, 3, (p) => dailyValues(p, scope, branchIds, asOfDate));
    label = months[months.length - 1]?.totals.label ?? "";
    const byWeek = new Map<string, { revenue: number; revenueEstimated: number; salary: number | null; idc: number; missing: boolean; partial: boolean; idcMissing: boolean }>();
    for (const m of months) for (const d of m.days) {
      if (d.date < firstWeek) continue;
      const wk = weekStart(d.date);
      const b = byWeek.get(wk) ?? { revenue: 0, revenueEstimated: 0, salary: 0, idc: 0, missing: false, partial: false, idcMissing: false };
      if (d.idcMissing) b.idcMissing = true;
      b.revenue += d.revenue; b.revenueEstimated += d.revenueEstimated; b.idc += d.idc;
      if (d.salary === null) b.missing = true; else b.salary = (b.salary ?? 0) + d.salary;
      if (d.date === asOfDate || addDays(wk, 6) > lastDay) b.partial = true;
      byWeek.set(wk, b);
    }
    points = [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([wk, b]) =>
      toPoint(wk, `${dayLabel(wk)}`, wk, addDays(wk, 6), { ...b, salary: b.missing ? null : b.salary }, b.partial));
    notes.push("Weeks run Monday–Sunday and are built from the same daily spread, so they add up to the months.");
    if (points.some((p) => p.salaryMissing)) notes.push("A week that includes days with no salary cost yet shows no OP% rather than an inflated one.");
  }

  if (points.some((p) => p.revenueEstimated > 0)) notes.push("Dashed revenue is estimated from seat rate × seats (last invoice or P&L Configuration › Seat billing) for cost centres not invoiced yet.");
  if (points.some((p) => p.salaryMissing)) notes.push("No people cost exists yet for some periods — their OP% is left blank instead of showing revenue against zero salary.");
  if (points.some((p) => p.idcMissing)) notes.push("Some months have no indirect cost (GRN) mapped to any cost centre — their OP% is left blank rather than showing a margin with every overhead missing.");

  const sum = (f: (p: TrendPoint) => number) => r2(points.reduce((t, p) => t + f(p), 0));
  const salaryKnown = points.every((p) => !p.salaryMissing && !p.idcMissing);
  const revenue = sum((p) => p.revenue);
  const salary = salaryKnown ? sum((p) => p.salary ?? 0) : null;
  const idc = sum((p) => p.idc);
  const op = salary === null ? null : r2(revenue - salary - idc);

  // Dropdown options from the anchor month's Live P&L (MAS cost centres, with name + code).
  const anchorRec = await monthlyReconciliation(anchor, input.branchScope ? [input.branchScope] : [], asOfDate);
  return {
    grain,
    scope: { type: scopeType, id: scope.id, label: scopeType === "company" ? "MAS Callnet — company" : label },
    asOfDate,
    points,
    totals: { revenue, revenueEstimated: sum((p) => p.revenueEstimated), salary, idc, op, opPct: op === null || Math.abs(revenue) < 0.5 ? null : r2((op / revenue) * 100) },
    notes,
    options: {
      branches: anchorRec.branches.filter((b) => b.branchId).map((b) => ({ id: String(b.branchId), name: b.branchName })),
      costCentres: anchorRec.rows.map((r) => ({ id: r.costCentreId, code: r.costCentreCode, name: r.costCentreName, processName: r.costCentreProcess ?? null, branchId: r.branchId, branchName: r.branchName })),
    },
  };
}
