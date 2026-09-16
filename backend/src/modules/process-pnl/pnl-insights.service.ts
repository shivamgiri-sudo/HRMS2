import { getCurrentDateIST } from "../../shared/istDate.js";
import type { PnlReconciliation, PnlReconciliationRow } from "./pnl-reconciliation.service.js";
import { monthlyReconciliation, pool, shiftMonth } from "./pnl-trend-series.service.js";

/**
 * P&L Insights — four views of the Live P&L that the tables cannot show at a glance.
 *
 *   heatmap        cost centre x month OP%        where profit is leaking, and since when
 *   contribution   OP by cost centre, one month   who makes the money and who gives it back
 *   unitEconomics  revenue vs cost per head       which cost centres are priced below their cost
 *   revenueMix     invoiced / accrual / estimate  how much of this month's revenue is real yet
 *
 * ONE SOURCE OF TRUTH. Every figure is a Live P&L row (getPnlReconciliation, through the Trend
 * tab's 5-minute cache), so a number here always equals the same number on the Live P&L tab.
 * Nothing is recomputed or re-attributed.
 *
 * A month whose payroll has not run yet has no people cost at all: its margins would read ~80%.
 * Those months are marked salaryMissing and carry no OP% — the same rule Live P&L applies. A month
 * with no indirect cost recorded anywhere (Live P&L idcMissing — March 2026) is treated the same.
 */

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]}-${period.slice(2, 4)}`;
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export interface InsightCell {
  period: string;
  revenue: number;
  cost: number;
  op: number;
  /** Null when there is no revenue to measure against, or the month's payroll has not run. */
  opPct: number | null;
  estimated: boolean;
  /** Revenue with no salary booked while the month's payroll did run: the margin is an attribution
   *  gap (the people are paid under another cost centre), not performance. No OP% is shown. */
  noPayroll: boolean;
}

export interface InsightHeatRow {
  costCentreId: string;
  code: string;
  name: string;
  /** The process the cost centre serves (see cost-centre-label.ts); null when unknown. */
  processName: string | null;
  branchName: string;
  cells: InsightCell[];
  /** Revenue across the window — the sort key, so the rows that matter most sit on top. */
  windowRevenue: number;
  windowOp: number;
  windowOpPct: number | null;
}

export interface InsightContribution {
  costCentreId: string;
  code: string;
  name: string;
  /** The process the cost centre serves (see cost-centre-label.ts); null when unknown. */
  processName: string | null;
  branchName: string;
  revenue: number;
  payroll: number;
  idc: number;
  op: number;
  opPct: number | null;
  estimated: boolean;
  revenueEstimated: number;
  /** trading = bills and pays people; no_revenue = cost with no revenue this month (an overhead such
   *  as corporate, or a client process not billed or estimated yet); no_payroll = revenue with no
   *  salary booked, so its profit is overstated. */
  kind: "trading" | "no_revenue" | "no_payroll";
}

export interface InsightUnit {
  costCentreId: string;
  code: string;
  name: string;
  /** The process the cost centre serves (see cost-centre-label.ts); null when unknown. */
  processName: string | null;
  branchName: string;
  staff: number;
  revenue: number;
  revenuePerHead: number;
  costPerHead: number;
  opPct: number | null;
}

export interface InsightMix {
  branchId: string | null;
  branchName: string;
  invoiced: number;
  accrual: number;
  estimated: number;
  creditNote: number;
  revenue: number;
}

export interface PnlInsights {
  period: string;
  months: { period: string; label: string; salaryMissing: boolean; idcMissing: boolean }[];
  salaryMissing: boolean;
  heatmap: InsightHeatRow[];
  contribution: InsightContribution[];
  unitEconomics: InsightUnit[];
  revenueMix: { branches: InsightMix[]; totals: Omit<InsightMix, "branchId" | "branchName"> };
  notes: string[];
}

const costOf = (r: PnlReconciliationRow) => n(r.payrollCost) + n(r.grnActual) + n(r.grnEstimated);
const hasActivity = (r: PnlReconciliationRow) =>
  n(r.recognisedRevenue) !== 0 || n(r.payrollCost) !== 0 || n(r.grnActual) !== 0 || n(r.grnEstimated) !== 0;
const margin = (op: number, revenue: number) => (revenue > 0 ? r1((op / revenue) * 100) : null);
const noPayrollRow = (r: PnlReconciliationRow) => n(r.recognisedRevenue) > 0 && n(r.payrollCost) <= 0;

/** Payroll not run = the whole month has no people cost. A single cost centre at 0 is data, not this. */
export const salaryMissingFor = (rec: PnlReconciliation) => n(rec.totals.payrollCost) <= 0;
/** A cost line is absent for the whole month — people cost or every overhead — so no margin is shown. */
export const costMissingFor = (rec: PnlReconciliation) => salaryMissingFor(rec) || Boolean(rec.idcMissing);

export function buildHeatmap(periods: string[], recs: PnlReconciliation[], limit = 40): InsightHeatRow[] {
  const byCc = new Map<string, InsightHeatRow>();
  recs.forEach((rec, i) => {
    const missing = costMissingFor(rec);
    for (const r of rec.rows) {
      if (!hasActivity(r)) continue;
      let row = byCc.get(r.costCentreId);
      if (!row) {
        row = {
          costCentreId: r.costCentreId, code: r.costCentreCode, name: r.costCentreName,
          processName: r.costCentreProcess ?? null, branchName: r.branchName, cells: [], windowRevenue: 0, windowOp: 0, windowOpPct: null,
        };
        byCc.set(r.costCentreId, row);
      }
      const revenue = n(r.recognisedRevenue);
      const op = n(r.operatingProfit);
      const noPayroll = !missing && noPayrollRow(r);
      row.cells.push({
        period: periods[i], revenue: r2(revenue), cost: r2(costOf(r)), op: r2(op),
        opPct: missing || noPayroll ? null : margin(op, revenue),
        estimated: n(r.revenueEstimated) > 0,
        noPayroll,
      });
      // The window margin counts only months that carry their own cost line.
      if (!missing && !noPayroll) { row.windowRevenue += revenue; row.windowOp += op; }
    }
  });
  // Every row gets one cell per month, in order — a gap is an explicit empty cell, not a shift.
  const rows = [...byCc.values()].map((row) => {
    const at = new Map(row.cells.map((c) => [c.period, c]));
    return {
      ...row,
      windowRevenue: r2(row.windowRevenue),
      windowOp: r2(row.windowOp),
      windowOpPct: margin(row.windowOp, row.windowRevenue),
      cells: periods.map((p) => at.get(p) ?? { period: p, revenue: 0, cost: 0, op: 0, opPct: null, estimated: false, noPayroll: false }),
    };
  });
  // Sorted by ALL revenue in the window, including months with no salary booked — those rows are
  // exactly the ones a reader needs to see, so they must not sink for lacking a margin.
  const billed = (row: InsightHeatRow) => row.cells.reduce((t, c) => t + c.revenue, 0);
  rows.sort((a, b) => billed(b) - billed(a) || a.code.localeCompare(b.code));
  return rows.slice(0, limit);
}

export function buildContribution(rec: PnlReconciliation): InsightContribution[] {
  const missing = costMissingFor(rec);
  const rows: InsightContribution[] = rec.rows
    .filter(hasActivity)
    .map((r) => {
      const revenue = n(r.recognisedRevenue);
      const op = n(r.operatingProfit);
      const kind: InsightContribution["kind"] = revenue <= 0 ? "no_revenue" : !missing && noPayrollRow(r) ? "no_payroll" : "trading";
      return {
        costCentreId: r.costCentreId, code: r.costCentreCode, name: r.costCentreName, processName: r.costCentreProcess ?? null, branchName: r.branchName,
        revenue: r2(revenue), payroll: r2(n(r.payrollCost)), idc: r2(n(r.grnActual) + n(r.grnEstimated)), op: r2(op),
        opPct: missing || kind !== "trading" ? null : margin(op, revenue),
        estimated: n(r.revenueEstimated) > 0,
        revenueEstimated: r2(n(r.revenueEstimated)),
        kind,
      };
    })
    ;
  // Staff with no cost centre are in the company OP (Live P&L totals) but in no row: one explicit
  // no-revenue bar, so the bars add up to the company figure instead of silently overstating it.
  const unallocated = n(rec.totals.unallocatedPayroll);
  if (unallocated > 0) {
    rows.push({
      costCentreId: "unallocated-payroll", code: "No cost centre", name: "Payroll of staff with no cost centre",
      processName: `${n(rec.totals.unallocatedStaff)} employee(s) — map them to attribute this`, branchName: "",
      revenue: 0, payroll: r2(unallocated), idc: 0, op: r2(-unallocated), opPct: null,
      estimated: false, revenueEstimated: 0, kind: "no_revenue",
    });
  }
  return rows.sort((a, b) => b.op - a.op || a.code.localeCompare(b.code));
}

/**
 * Only cost centres that bill AND pay people: revenue per head means nothing without both.
 * Cost per head is full cost (payroll + IDC) over the staff paid, so the diagonal where the two are
 * equal is exactly break-even.
 */
export function buildUnitEconomics(rec: PnlReconciliation): InsightUnit[] {
  if (costMissingFor(rec)) return [];
  return rec.rows
    .filter((r) => n(r.staffPaid) > 0 && n(r.recognisedRevenue) > 0 && n(r.payrollCost) > 0)
    .map((r) => {
      const staff = n(r.staffPaid);
      const revenue = n(r.recognisedRevenue);
      return {
        costCentreId: r.costCentreId, code: r.costCentreCode, name: r.costCentreName, processName: r.costCentreProcess ?? null, branchName: r.branchName,
        staff, revenue: r2(revenue),
        revenuePerHead: r2(revenue / staff),
        costPerHead: r2(costOf(r) / staff),
        opPct: margin(n(r.operatingProfit), revenue),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function buildRevenueMix(rec: PnlReconciliation): PnlInsights["revenueMix"] {
  const byBranch = new Map<string, InsightMix>();
  for (const r of rec.rows) {
    const key = r.branchId ?? "";
    const m = byBranch.get(key) ?? {
      branchId: r.branchId, branchName: r.branchName || "Unassigned",
      invoiced: 0, accrual: 0, estimated: 0, creditNote: 0, revenue: 0,
    };
    m.invoiced += n(r.revenueInvoice);
    m.accrual += n(r.revenueAccrual);
    m.estimated += n(r.revenueEstimated);
    m.creditNote += n(r.creditNote);
    m.revenue += n(r.recognisedRevenue);
    byBranch.set(key, m);
  }
  const branches = [...byBranch.values()]
    .filter((m) => m.invoiced || m.accrual || m.estimated || m.creditNote)
    .map((m) => ({ ...m, invoiced: r2(m.invoiced), accrual: r2(m.accrual), estimated: r2(m.estimated), creditNote: r2(m.creditNote), revenue: r2(m.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
  const totals = branches.reduce(
    (t, m) => ({
      invoiced: t.invoiced + m.invoiced, accrual: t.accrual + m.accrual, estimated: t.estimated + m.estimated,
      creditNote: t.creditNote + m.creditNote, revenue: t.revenue + m.revenue,
    }),
    { invoiced: 0, accrual: 0, estimated: 0, creditNote: 0, revenue: 0 },
  );
  return {
    branches,
    totals: { invoiced: r2(totals.invoiced), accrual: r2(totals.accrual), estimated: r2(totals.estimated), creditNote: r2(totals.creditNote), revenue: r2(totals.revenue) },
  };
}

export async function getPnlInsights(input: {
  period: string; months?: number; branchScope?: string | null; asOfDate?: string;
}): Promise<PnlInsights> {
  if (!PERIOD_RE.test(input.period)) throw httpError(400, "period must be YYYY-MM");
  const asOfDate = input.asOfDate ?? getCurrentDateIST();
  const today = asOfDate.slice(0, 7);
  const period = input.period > today ? today : input.period;
  const count = Math.min(Math.max(Math.trunc(input.months ?? 6) || 6, 2), 12);
  const periods = Array.from({ length: count }, (_, i) => shiftMonth(period, i - count + 1));
  const branchIds = input.branchScope ? [input.branchScope] : [];
  const recs = await pool(periods, 3, (p) => monthlyReconciliation(p, branchIds, asOfDate));
  const current = recs[recs.length - 1];

  const months = periods.map((p, i) => ({ period: p, label: monthLabel(p), salaryMissing: salaryMissingFor(recs[i]), idcMissing: Boolean(recs[i].idcMissing) }));
  // "salaryMissing" drives the panel's empty states: true whenever a whole cost line is absent.
  const salaryMissing = costMissingFor(current);
  const notes: string[] = [];
  if (salaryMissingFor(current)) {
    notes.push(`Payroll for ${monthLabel(period)} has not run, so its margins are not shown and unit economics are empty. Pick an earlier month for a complete picture.`);
  } else if (current.idcMissing) {
    notes.push(`No indirect cost (GRN) maps to any cost centre for ${monthLabel(period)}, so its margins are not shown — a margin with every overhead missing is not comparable.`);
  }
  const idcGaps = months.filter((m) => m.idcMissing && m.period !== period).map((m) => m.label);
  if (idcGaps.length) notes.push(`No indirect cost maps to any cost centre for ${idcGaps.join(", ")}; those heatmap columns show NA.`);
  if (n(current.totals.unallocatedPayroll) > 0) {
    notes.push(`Rs ${(n(current.totals.unallocatedPayroll) / 1e5).toFixed(2)} L of payroll for ${n(current.totals.unallocatedStaff)} employee(s) with no cost centre is in company OP and shown as its own bar under profit contribution.`);
  }
  const contribution = buildContribution(current);
  const unpaid = contribution.filter((c) => c.kind === "no_payroll");
  if (unpaid.length) {
    const billed = unpaid.reduce((t, c) => t + c.revenue, 0);
    notes.push(`${unpaid.length} cost centre(s) bill Rs ${(billed / 1e5).toFixed(2)} L in ${monthLabel(period)} with no salary booked against them — their staff are paid under another cost centre, so their profit is overstated and that one's understated. Shown as "no pay", without a margin.`);
  }
  const estimated = n(current.totals.revenueEstimated);
  if (estimated > 0) {
    notes.push(`${monthLabel(period)} includes a seat-rate estimate for ${current.totals.estimatedCostCentres} cost centre(s) not invoiced yet; those cells are marked "est".`);
  }

  return {
    period,
    months,
    salaryMissing,
    heatmap: buildHeatmap(periods, recs),
    contribution,
    unitEconomics: buildUnitEconomics(current),
    revenueMix: buildRevenueMix(current),
    notes,
  };
}
