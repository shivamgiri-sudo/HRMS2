import type { RowDataPacket } from "mysql2";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import { canonicalPnlService } from "./canonical-pnl.service.js";
import {
  getDriverRevenueActuals, getIndirectCostActuals, getInvoicedRevenueActuals, getSeatRevenueActuals,
  type ActualsByKey, type SeatRevenueActuals,
} from "./pnl-actuals.service.js";
import { getRunningPeopleCost, type PeopleCostByKey } from "./pnl-running-salary.service.js";
import { processLobService } from "./process-lob.service.js";
import { getActualPeopleCost } from "./bpo-pnl.service.js";
import type { BpoPnlRow } from "./bpo-pnl.service.js";
import type { PnlQueryFilters } from "./process-pnl.types.js";
import { getApprovedAdjustmentsByProcess } from "./pnl-manual-adjustment.service.js";

/**
 * P&L redesign (PR 3): transposed statement — components as rows, entities as dynamic columns.
 * Read-only composition over the existing canonical engine (canonicalPnlService.getSummary /
 * processLobService.getProcessSummary) — no calculation logic lives here. Row ordering/labels
 * come from finance_pnl_component_master (sql/426_pnl_component_master.sql).
 */

export type StatementViewBy = "process" | "branch" | "lob";

export interface ComponentDefinition extends RowDataPacket {
  component_key: string;
  display_name: string;
  section_key: "headcount" | "revenue" | "cost" | "profitability";
  parent_component_key: string | null;
  display_order: number;
  component_type: "SOURCE_ACTUAL" | "SUM" | "SUBTOTAL" | "RATIO";
  source_field: string;
  format_type: "CURRENCY" | "PERCENTAGE" | "COUNT";
  sign_convention: "+" | "-";
  is_subtotal: number;
}

export interface StatementColumn {
  id: string;
  code: string;
  name: string;
  branchName: string | null;
  processName: string | null;
  status: string | null;
  /**
   * How much of this column's active headcount the people cost accounts for, as a percentage.
   * Below 100 the Operating Profit shown is overstated by whatever the uncovered staff would have
   * cost, so a consumer must surface the shortfall rather than present the profit as final.
   * Absent when no snapshot has been refreshed for the period.
   */
  peopleCostCoveragePct?: number;
  peopleCostActiveEmployees?: number;
  peopleCostCoveredEmployees?: number;
  /**
   * Manual Adjustments (Part B, 2026-09-01) — APPROVED projected_revenue/penalty/reward entries
   * for this process/period only, folded into a figure shown ALONGSIDE `recognizedRevenue`, never
   * in place of it. See pnl-manual-adjustment.service.ts. Absent for a branch/lob column — manual
   * adjustments are process-scoped, and summing them across a branch's processes here would let a
   * reader mistake a branch subtotal for a per-process approval decision.
   */
  manualAdjustment?: {
    approvedProjectedRevenue: number;
    approvedRewards: number;
    approvedPenalties: number;
    /** systemRevenue (recognizedRevenue) + approvedRewards - approvedPenalties. */
    adjustedTotal: number;
    pendingAdjustmentCount: number;
  };
}

export interface StatementRow {
  componentKey: string;
  displayName: string;
  section: string;
  /**
   * The line this one explains, when it is a breakdown rather than a figure in its own right.
   *
   * Invoiced Revenue, Contracted Revenue, Earned Seat Revenue and Seat Shortfall all sit under
   * Recognised Revenue: they say where that number came from and what it would have been, and
   * they must never read as additional revenue. The statement is rendered as a flat list, so
   * without this a reader scanning the Revenue section sees the same money on five consecutive
   * lines and reasonably concludes it has been counted five times.
   */
  parentComponentKey: string | null;
  format: string;
  isSubtotal: boolean;
  values: Record<string, number | null>;
}

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

async function getComponents(): Promise<ComponentDefinition[]> {
  if (!(await tableExists("finance_pnl_component_master"))) {
    throw new Error("Run the P&L component master migration first (sql/426_pnl_component_master.sql).");
  }
  return queryRows<ComponentDefinition>(
    `SELECT * FROM finance_pnl_component_master WHERE active_status = 1 ORDER BY display_order`
  );
}

/** Derives a component value from a generic row object, handling the few subtotal fields
 *  (dsc/bmc) that Process/Branch rows carry pre-summed but LOB rows do not. */
function resolveValue(row: Record<string, unknown>, component: ComponentDefinition): number | null {
  const field = component.source_field;
  if (row[field] !== undefined && row[field] !== null) return n(row[field]);
  if (field === "dsc") return n(row.dscPeople) + n(row.dscNonPeople);
  if (field === "bmc") return n(row.bmcPeople) + n(row.bmcNonPeople);
  if (field === "contributionMarginPct") return pct(n(row.contribution), n(row.recognizedRevenue));
  if (field === "ebitdaMarginPct") return pct(n(row.ebitda), n(row.recognizedRevenue));
  return null;
}

function sumField(rows: Record<string, unknown>[], field: string): number {
  return rows.reduce((total, row) => total + n(row[field]), 0);
}

const ADDITIVE_FIELDS: (keyof BpoPnlRow)[] = [
  "contractedSeats", "activeHc", "agentHeadcount", "billableHc",
  "grossPotentialRevenue", "baseEarnedRevenue", "minimumCommitmentTopUp", "incentiveRevenue",
  "penalty", "slaDeduction", "creditNote", "recognizedRevenue",
  "agentSalary", "dscPeople", "dscNonPeople", "dsc", "bmcPeople", "bmcNonPeople", "bmc",
  "contribution", "ebitda", "depreciation", "amortization", "ebit", "financeCost", "pbt", "tax", "pat",
];

function aggregateByBranch(rows: BpoPnlRow[]): { column: StatementColumn; data: Record<string, unknown> }[] {
  const byBranch = new Map<string, BpoPnlRow[]>();
  for (const row of rows) {
    const key = row.branchId ?? "unassigned";
    const bucket = byBranch.get(key) ?? [];
    bucket.push(row);
    byBranch.set(key, bucket);
  }
  return [...byBranch.entries()].map(([branchId, bucket]) => {
    const data: Record<string, unknown> = {};
    for (const field of ADDITIVE_FIELDS) data[field] = sumField(bucket as unknown as Record<string, unknown>[], field);
    return {
      column: {
        id: branchId,
        code: branchId,
        name: bucket[0]?.branchName ?? "Unassigned",
        branchName: bucket[0]?.branchName ?? null,
        processName: null,
        status: null,
      },
      data,
    };
  });
}

async function buildLobColumns(
  rows: BpoPnlRow[],
  period: string,
  deps: Pick<StatementDependencies, "getProcessSummary">
) {
  const results: { column: StatementColumn; data: Record<string, unknown> }[] = [];
  for (const row of rows) {
    const summary = await deps.getProcessSummary(row.processId, period).catch(() => null);
    const lobRows = (summary?.rows ?? []) as Array<Record<string, unknown> & { rowType: string; lobName?: string; processLobId?: string | null }>;
    for (const lobRow of lobRows) {
      const id = lobRow.processLobId ? `${row.processId}:${lobRow.processLobId}` : `${row.processId}:unallocated`;
      results.push({
        column: {
          id,
          code: id,
          name: lobRow.rowType === "unallocated" ? `${row.processName} — Unallocated` : `${row.processName} — ${lobRow.lobName ?? "LOB"}`,
          branchName: row.branchName,
          processName: row.processName,
          status: null,
        },
        data: lobRow,
      });
    }
  }
  return results;
}

/**
 * Fills the lines the raw P&L row does not carry, then derives the real waterfall:
 *   DC Total = Agent Salary + DSC + BMC
 *   Total Cost = DC Total + IDC
 *   Operating Profit = Revenue - Total Cost
 * Percentages are all of revenue, matching the workbook.
 */
/**
 * Is this period still running?
 *
 * Compared in IST, matching how running-salary.service.ts resolves month boundaries — an hour
 * either side of midnight UTC would otherwise flip a month a day early and switch the people
 * cost source under a report someone is reading.
 */
function isOpenPeriod(periodCode: string): boolean {
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return periodCode >= nowIst.toISOString().slice(0, 7);
}

function enrichColumn(
  data: Record<string, unknown>,
  key: { branchId?: string | null; processId?: string | null },
  idc: ActualsByKey,
  revenue: ActualsByKey,
  invoicedRevenue: ActualsByKey,
  seat: SeatRevenueActuals,
  people: PeopleCostByKey,
  periodOpen: boolean,
  /**
   * True only for a "process" view column, where `data` IS one single, unmodified canonical
   * BpoPnlRow (see the plain `row as unknown as Record<string, unknown>` mapping in getStatement)
   * — the same row bpoPnlAllocationOverlayService.getProcessDetail's sub-tab reads its own `ebit`
   * from. A2 below trusts `data.ebit` ONLY in that case.
   *
   * NOT for "branch": aggregateByBranch() pre-sums every ADDITIVE_FIELDS entry including `ebit`
   * via sumField()/n(), which defaults a row with no `ebit` field at all to 0 — indistinguishable
   * from a genuine canonical ebit of zero. Worse, even a real sum would be inconsistent with the
   * branch column's OWN revenue/cost figures below, which this function recomputes from different
   * sources (running-salary snapshot people cost, actuals-based IDC) than whatever each underlying
   * canonical row itself used — so "operatingProfit = recognizedRevenue - totalCost" would stop
   * holding for the branch total even though every number on the branch column is internally
   * consistent. See pnl-running-salary.test.ts's "reconciles: Operating Profit equals Revenue
   * minus Total Cost", which pins exactly that identity for the branch view.
   *
   * NOT for "lob": buildLobColumns() rows come from processLobService.getProcessSummary and carry
   * no `ebit` field at all — a different engine, different waterfall shape.
   */
  trustCanonicalEbit: boolean
): Record<string, unknown> {
  /*
   * A6 FIX (2026-09-01): idc/seat must never inherit the WHOLE branch's total just because a
   * process has no per-process entry — the identical defect class as the A3 revenue fix below,
   * left unapplied to idc/people/seat until now (flagged as a follow-up in 8172b98a's commit
   * message once that fix made a genuine per-process figure available for revenue to stop
   * guessing at). Confirmed live, period 2026-07, calling pnlStatementService.getStatement()
   * directly for both "process" and "branch" views and comparing the process-column sum against
   * the real branch-column total:
   *   NOIDA (18 processes):        total_idc  Rs 3,52,18,732.71 vs branch Rs 23,58,008.71 (~15x)
   *                                 total_cost Rs 5,20,67,268.71 vs branch Rs 1,08,68,876.71 (~4.8x)
   *   AHMEDABAD-JALDARSHAN (9):     total_idc  Rs 64,42,794.24  vs branch Rs 8,05,349.28   (~8x)
   *                                 total_cost Rs 1,59,17,339.24 vs branch Rs 40,30,370.28 (~4x)
   *   NOIDA-2 (6 processes):        total_idc  Rs 2,23,87,140.36 vs branch Rs 37,31,190.06 (~6x)
   *                                 total_cost Rs 2,73,89,771.36 vs branch Rs 1,03,20,490.06 (~2.7x)
   * because every process with no per-process idc/seat entry of its own was credited with the
   * WHOLE branch's idc/seat figures via this fallback. After the fix, same live data: NOIDA's
   * total_idc reconciles to Rs 22,06,610.77 vs branch Rs 23,58,008.71 (was ~15x, now ~94%);
   * AHMEDABAD-JALDARSHAN's and NOIDA-2's total_idc match the branch total EXACTLY
   * (Rs 8,05,349.28 and Rs 37,31,190.06 respectively) — the residual on NOIDA and on NOIDA-2's
   * dsc/bmc salary lines is the genuinely unconfigured share (processes with no per-process
   * entry now correctly show their own figure instead of a fabricated share), not a leftover of
   * this bug.
   *
   * Fix: for a process-scoped column (key.processId set), use ONLY that process's own
   * byProcess entry — no byBranch fallback. A branch-scoped column (key.processId unset,
   * aggregateByBranch) keeps the real branch total via byBranch, same as before.
   */
  const pick = (source: ActualsByKey): number =>
    key.processId
      ? (source.byProcess.get(key.processId) ?? 0)
      : key.branchId
        ? (source.byBranch.get(key.branchId) ?? 0)
        : 0;

  /*
   * A3 FIX (2026-09-01): revenue must never inherit the WHOLE branch's invoiced/planned total
   * just because a process has no per-process entry in these actuals maps.
   *
   * `pick()` above falls back to `source.byBranch.get(branchId)` whenever `byProcess` has
   * nothing for this key — a reasonable default for a genuine BRANCH column (viewBy="branch",
   * where key.processId is unset and the branch total IS the right answer), but wrong for a
   * PROCESS column: it silently broadcasts 100% of the branch's revenue onto every process that
   * has no configured process_revenue_rule / no attributable invoice line. Confirmed live on
   * branch febd8777-6583-11f1-adb1-00155d0ab410, period 2026-07: MNP REJECTION, Finnable and
   * Captureatrip — three different processes — all showed the identical Rs 1,17,81,253 branch
   * total here, while the canonical per-process row (bpo-pnl.service.ts buildRows, which never
   * falls back past its own process, see recognizedRevenue there) correctly had Rs 0 for all
   * three (revenueDataStatus: "accounting_fallback" — no rule, no invoice, no accounting figure).
   *
   * Fix: for a process-scoped column, use ONLY the process's own entry — no branch fallback. A
   * branch-scoped column (aggregateByBranch, key.processId unset) keeps the real branch total.
   * Mirrors the REVENUE_RULE_MISSING alert bpo-pnl.service.ts already raises for exactly this
   * "no rule configured" case (see bpoPnlService.getSummary) rather than inventing a new fallback.
   */
  const pickOwnRevenue = (source: ActualsByKey): number | undefined =>
    key.processId ? source.byProcess.get(key.processId)
    : key.branchId ? (source.byBranch.get(key.branchId) ?? 0)
    : 0;

  const out = { ...data };

  /*
   * Revenue: what was invoiced for a CLOSED period, what was planned for an OPEN one.
   *
   * Same reasoning as people cost below. planned_headcount x revenue_rate_per_head is a
   * budgeting figure — it exists for only three periods in production (2026-07/08/09) while
   * real invoicing runs from April, and its July value of Rs 119 lakh does not match the
   * Rs 77.05 lakh actually billed. Once a month closes, what the client was invoiced is the
   * answer and nothing needs estimating.
   *
   * Mid-month the reverse holds: invoicing lags delivery, so July showed Rs 77 lakh against a
   * Rs 325-372 lakh run rate. Using it live would report a collapse that is really just an
   * unfinished billing cycle, so an open period keeps the planned figure.
   *
   * Both are published either way — contracted against earned is the seat-shortfall view, and
   * a reader cannot judge one without seeing the other.
   */
  const plannedRevenue = pickOwnRevenue(revenue) ?? 0;
  const invoiced = pickOwnRevenue(invoicedRevenue) ?? 0;
  const existingRevenue = n(out.recognizedRevenue);
  /*
   * Priority for a CLOSED period: actual invoiced amount.
   *
   * existingRevenue comes from the canonical row. When process_revenue_rule is populated (future)
   * it is a rule-computed estimate; when empty (production today) it IS the invoiced figure from
   * getInvoicedRevenueActuals(). Regardless, a closed month's canonical answer is the invoice —
   * the comment above documents this and the fix enforces it:
   *
   *   closed + invoiced > 0  →  invoiced   (actual billing)
   *   closed + invoiced = 0  →  existingRevenue or plannedRevenue (no invoice data yet)
   *   open                   →  existingRevenue or plannedRevenue (billing lag during live month)
   *
   * invoiced/plannedRevenue are now the process's OWN figures only (pickOwnRevenue, no branch
   * broadcast — see A3 fix above), so this chain can no longer inherit branch-wide revenue.
   */
  const recognizedRevenue = (!periodOpen && invoiced > 0)
    ? invoiced
    : (existingRevenue > 0 ? existingRevenue : plannedRevenue);
  out.recognizedRevenue = recognizedRevenue;
  out.plannedRevenue = plannedRevenue;
  out.invoicedRevenue = invoiced;
  /*
   * A4: surface "no revenue rule configured" on the statement the same way bpo-pnl.service.ts's
   * REVENUE_RULE_MISSING alert already does for the per-process detail — the canonical row already
   * carries revenueDataStatus ("configured" | "configured_no_delivery" | "invoiced_fallback" |
   * "accounting_fallback") via the `...data` spread below reads from the source row; passed through
   * unchanged here for a process column so both surfaces agree on WHY a revenue figure is what it is.
   */
  out.revenueBasis = (!periodOpen && invoiced > 0)
    ? "invoiced"
    : (existingRevenue > 0 ? "row" : "planned");

  /*
   * Seat revenue: what the billable people actually on the floor are worth, as against the
   * planned seat count. The gap between them is the seat shortfall — unfilled seats — which no
   * per-head rate can reveal on its own.
   *
   * The shortfall is published ONLY where every billable person in the column resolved to a
   * rate. Rates exist for 7 cost centres out of ~95 trading today, so a blanket subtraction
   * would report about Rs 290 lakh of "lost revenue" that is really unconfigured rates. Where
   * the count is non-zero the shortfall is null and the count is shown instead, so the reader
   * sees an incomplete setup rather than a fictitious loss.
   */
  const seatEarned = pick(seat);
  const seatRateMissing = pick(seat.rateMissingByKey);
  out.seatRevenueEarned = seatEarned;
  out.seatRateMissingEmployees = seatRateMissing;
  out.seatShortfall = seatRateMissing === 0 && plannedRevenue > 0 && seatEarned > 0
    ? plannedRevenue - seatEarned
    : null;

  /*
   * People cost: the snapshot for an OPEN period, actual payroll for a CLOSED one.
   *
   * While a month is running, only the snapshot can answer the question — it holds
   * earned-till-date per employee, split Agent / DSC / BMC. Without it the upstream row reports
   * the whole people cost as Agent, because a residual rule dumps everything there when no
   * payroll person matched a process. That is why it was preferred unconditionally.
   *
   * Once a month closes, preferring it is backwards. The snapshot only covers employees
   * computeRunningSalary can still produce a figure for, and it cannot for a leaver: April 2026
   * paid 1,085 people Rs 211.57 lakh, and the snapshot held 790 of them at Rs 141.23 lakh. The
   * missing Rs 70 lakh — a third of the month's people cost — landed in operating profit as if
   * it were margin. July had the same hole, 1,000 rows against 1,464 people paid. Widening the
   * snapshot's population recovered only Rs 1.19 lakh of it, because the shortfall is in what
   * can be recomputed, not in who is considered.
   *
   * For a closed month there is no need to recompute anything: salary_prep_line is what was
   * actually paid, and bpo-pnl.service.ts already reads it. So the snapshot's job ends when the
   * month does.
   */
  /*
   * A6 FIX (2026-09-01): same branch-broadcast removal as pick() above, applied to the
   * people-cost snapshot lookup — a process with no snapshot entry of its own must not silently
   * inherit the whole branch's Agent/DSC/BMC snapshot. See pick()'s doc comment for the live
   * numbers this was confirmed against (NOIDA, period 2026-07).
   */
  const snapshot = key.processId
    ? people.byProcess.get(key.processId)
    : key.branchId
      ? people.byBranch.get(key.branchId)
      : undefined;
  /*
   * Use the snapshot whenever it holds anything; fall back to the upstream figure when it does not.
   *
   * REVERTED. This briefly read `periodOpen && Boolean(snapshot) && ...`, on the reasoning that a
   * closed month needs no recomputation because salary_prep_line is what was actually paid and the
   * row engine reads it. Two things were wrong with that.
   *
   * First the premise: canonicalPnlService returns 0.00 for agentSalary, dscPeople, bmcPeople AND
   * directPeopleCost in every month measured — April, June and July alike. So skipping the
   * snapshot on a closed month did not swap one people-cost source for a better one, it removed
   * people cost altogether. April lost Rs 112.11 lakh and June Rs 141.23 lakh, and Operating
   * Profit rose to 81-82% of revenue for a business that runs nowhere near that.
   *
   * Second the purpose: the snapshot is not a stand-in for a missing number, it is the only
   * source of the Agent/DSC/BMC SPLIT. Upstream carries one undifferentiated people figure and
   * the snapshot replaces it, so a row-first rule is also wrong — it keeps the lump and discards
   * the split. See "uses the snapshot's Agent/DSC/BMC split in place of the undifferentiated
   * upstream figure" in pnl-running-salary.test.ts, which caught exactly that.
   *
   * So: snapshot when present, upstream when not, never nothing. Both branches are pinned by
   * tests and mutation-verified.
   */
  const hasSnapshot = Boolean(snapshot)
    && (snapshot!.agent_salary + snapshot!.dsc_people + snapshot!.bmc_people) > 0;

  const agentSalary = hasSnapshot ? snapshot!.agent_salary : n(out.agentSalary);
  const dscSalary = hasSnapshot ? snapshot!.dsc_people : n(out.dscSalary ?? out.dscPeople);
  const bmcSalary = hasSnapshot ? snapshot!.bmc_people : n(out.bmcSalary ?? out.bmcPeople);
  out.agentSalary = agentSalary;
  const indirectCostTotal = pick(idc);

  const directCostTotal = agentSalary + dscSalary + bmcSalary;
  const totalCost = directCostTotal + indirectCostTotal;

  out.dscSalary = dscSalary;
  out.bmcSalary = bmcSalary;
  /*
   * Keep the "Total DSC"/"Total BMC" aggregates in step with the salary figures above them.
   *
   * Those two components read source fields `dsc` and `bmc`, and resolveValue falls back to
   * dscPeople + dscNonPeople when the row has no `dsc` of its own. But the people figure resolved
   * here is written to dscSalary/bmcSalary, and dscPeople is left as upstream had it — zero,
   * since upstream carries no people cost. So the statement rendered "DSC Salary Rs 23.13 lakh"
   * with "Total DSC Rs 0" directly beneath it, and the same for BMC. The waterfall itself was
   * right (DC Total sums the salary fields), which is what kept it hidden: only the two subtotal
   * lines lied.
   */
  out.dsc = dscSalary + n(out.dscNonPeople);
  out.bmc = bmcSalary + n(out.bmcNonPeople);
  out.indirectCostTotal = indirectCostTotal;
  out.directCostTotal = directCostTotal;
  out.totalCost = totalCost;
  /*
   * A2 FIX (2026-09-01): Operating Profit reads the CANONICAL ebit from the underlying
   * bpoPnlAllocationOverlayService/canonicalPnlService row (`data.ebit`, carried through
   * unchanged by the `out = {...data}` spread above) whenever that row actually has one, instead
   * of always overwriting it with this function's own local `recognizedRevenue - totalCost`
   * recompute.
   *
   * Why this mattered: the local recompute here uses `indirectCostTotal = pick(idc)`, which reads
   * the SAME branch-broadcast-shaped actuals map as the A3 revenue bug (pnl-actuals.service.ts's
   * ActualsByKey) — a process with no per-process IDC entry silently inherited cost figures scoped
   * to a different grain than the canonical engine's own per-process GRN/allocation attribution
   * (bpo-pnl.service.ts buildRows + bpo-pnl-allocation-overlay.service.ts adjustedRow, which is
   * what canonical ebit already is). Combined with the pre-A3 revenue broadcast this produced the
   * live sign flip: MNP REJECTION, period 2026-07, branch febd8777-6583-11f1-adb1-00155d0ab410 —
   * this statement's local recompute gave +Rs 79,85,596.94 while the canonical detail row's ebit
   * (bpoPnlAllocationOverlayService.getProcessDetail, the ProcessPnlDetailPage sub-tab's source)
   * was -Rs 8,91,003.06. Same process, same period, opposite sign.
   *
   * Fallback preserved for when there IS no canonical ebit to read: buildLobColumns' LOB rows
   * (processLobService.getProcessSummary) carry no `ebit` field at all — that engine's P&L stops
   * at a different waterfall shape — so `data.ebit` is undefined there and the local recompute is
   * the only source that exists for a LOB column. It is also literally what the LOB engine
   * produces on its own terms, not a stand-in for a missing better answer, so this is not a case of
   * silently accepting worse data — the two are cross-checked in lob reconciliation elsewhere.
   */
  const canonicalEbit = out.ebit;
  out.operatingProfit = (trustCanonicalEbit && canonicalEbit !== undefined && canonicalEbit !== null)
    ? n(canonicalEbit)
    : recognizedRevenue - totalCost;

  // How much of this column's headcount the people cost actually covers. An employee who earned
  // nothing this month — no present days, or no salary assigned — contributes no cost, so a column
  // whose staff are largely uncovered shows an Operating Profit far higher than the real one. The
  // figure is published rather than silently corrected, because the shortfall is upstream data and
  // guessing at the missing salary would be worse than naming the gap.
  //
  // Only meaningful once a snapshot exists for the period. Without one there is nothing to be
  // short of: a future month legitimately has no running salary, and reporting it as "0% covered"
  // would flag a healthy period as broken.
  const coverage = people.asOfDate
    ? (key.processId ? people.coverageByProcess.get(key.processId) : undefined)
      ?? (key.branchId ? people.coverageByBranch.get(key.branchId) : undefined)
    : undefined;
  if (coverage && coverage.activeEmployees > 0) {
    out.peopleCostActiveEmployees = coverage.activeEmployees;
    out.peopleCostCoveredEmployees = coverage.coveredEmployees;
    out.peopleCostCoveragePct =
      Math.round((coverage.coveredEmployees / coverage.activeEmployees) * 1000) / 10;
  }

  out.agentSalaryPct = pct(agentSalary, recognizedRevenue);
  out.dscPct = pct(dscSalary, recognizedRevenue);
  out.bmcPct = pct(bmcSalary, recognizedRevenue);
  out.directCostPct = pct(directCostTotal, recognizedRevenue);
  out.indirectCostPct = pct(indirectCostTotal, recognizedRevenue);
  out.totalCostPct = pct(totalCost, recognizedRevenue);
  out.operatingProfitPct = pct(n(out.operatingProfit), recognizedRevenue);
  return out;
}

export interface StatementDependencies {
  getComponents: () => Promise<ComponentDefinition[]>;
  getSummary: (filters: Partial<PnlQueryFilters>) => Promise<{ rows: BpoPnlRow[]; generatedAt: string; calculationEngine?: string }>;
  getProcessSummary: (processId: string, period: string) => Promise<{ rows?: unknown[] } | null>;
  /** Optional so an existing caller or test injecting only the original three keeps working —
   *  they fall back to the live readers. */
  getIndirectCost?: (period: string) => Promise<ActualsByKey>;
  getDriverRevenue?: (period: string) => Promise<ActualsByKey>;
  getInvoicedRevenue?: (period: string) => Promise<ActualsByKey>;
  getSeatRevenue?: (period: string) => Promise<SeatRevenueActuals>;
  getPeopleCost?: (period: string) => Promise<PeopleCostByKey>;
  /** Part B: approved-only manual adjustments, batched per process for the period. Optional for
   *  the same reason as the rest — an existing test injecting only the original deps still works,
   *  simply without a manualAdjustment field on any column. */
  getManualAdjustments?: (period: string) => Promise<Map<string, {
    approvedProjectedRevenue: number; approvedRewards: number; approvedPenalties: number; pendingCount: number;
  }>>;
}

const defaultDependencies: StatementDependencies = {
  getComponents,
  getSummary: (filters) => canonicalPnlService.getSummary(filters),
  getProcessSummary: (processId, period) => processLobService.getProcessSummary(processId, period),
  getIndirectCost: (period) => getIndirectCostActuals(period),
  getDriverRevenue: (period) => getDriverRevenueActuals(period),
  getInvoicedRevenue: (period) => getInvoicedRevenueActuals(period),
  getSeatRevenue: (period) => getSeatRevenueActuals(period),
  /*
   * Actual payroll first; the recomputed snapshot only if payroll has nothing for the period.
   *
   * The snapshot holds only the employees computeRunningSalary can reproduce, which was about
   * half the wage bill — April Rs 112.11 lakh against Rs 221.65 lakh actually paid, June
   * Rs 141.23 lakh against Rs 227.88 lakh. The missing half landed in Operating Profit as
   * margin, reporting 42.9% for June against the 10-30% this business actually runs at. Reading
   * salary_prep_line puts June at 16.2% and April at 9.7%.
   *
   * The snapshot is kept as the fallback rather than deleted: it still answers for a period whose
   * payroll run has not happened yet, where it is the only estimate available.
   */
  getPeopleCost: async (period) => {
    const actual = await getActualPeopleCost(period);
    if (actual.byBranch.size > 0 || actual.byProcess.size > 0) return actual;
    return getRunningPeopleCost(period);
  },
  getManualAdjustments: (period) => getApprovedAdjustmentsByProcess(period),
};

export async function getStatement(
  filters: Partial<PnlQueryFilters>,
  viewBy: StatementViewBy = "process",
  deps: StatementDependencies = defaultDependencies
) {
  if ((viewBy as string) === "cost_centre" || (viewBy as string) === "company") {
    throw new Error(
      `View by "${viewBy}" is not yet supported — cost centre and company are not independent P&L grains in this ` +
      `data model today (cost centre resolves via a fallback join to process; company is not modelled at all). ` +
      `Supported: process, branch, lob.`
    );
  }

  const [components, summary] = await Promise.all([deps.getComponents(), deps.getSummary(filters)]);
  const rows = summary.rows as BpoPnlRow[];

  let columnData: { column: StatementColumn; data: Record<string, unknown> }[];
  if (viewBy === "branch") {
    columnData = aggregateByBranch(rows);
  } else if (viewBy === "lob") {
    columnData = await buildLobColumns(rows, String(filters.period ?? summary.generatedAt).slice(0, 7), deps);
  } else {
    columnData = rows.map((row) => ({
      column: {
        id: row.processId,
        code: row.processId,
        name: row.processName,
        branchName: row.branchName,
        processName: row.processName,
        status: row.processStatus,
      },
      data: row as unknown as Record<string, unknown>,
    }));
  }

  // Indirect cost and driver revenue are keyed by cost centre at source; resolve them per column.
  const periodCode = String(filters.period ?? summary.generatedAt).slice(0, 7);
  // Resolved once for the whole statement: every column in it belongs to the same period, and
  // deciding per column would let two columns of one report use different cost sources.
  const periodOpen = isOpenPeriod(periodCode);
  const [idc, revenue, invoicedRevenue, seat, people, manualAdjustments] = await Promise.all([
    (deps.getIndirectCost ?? getIndirectCostActuals)(periodCode),
    (deps.getDriverRevenue ?? getDriverRevenueActuals)(periodCode),
    (deps.getInvoicedRevenue ?? getInvoicedRevenueActuals)(periodCode),
    (deps.getSeatRevenue ?? getSeatRevenueActuals)(periodCode),
    (deps.getPeopleCost ?? getRunningPeopleCost)(periodCode),
    (deps.getManualAdjustments ?? getApprovedAdjustmentsByProcess)(periodCode),
  ]);
  columnData = columnData.map((item) => {
    const data = enrichColumn(
      item.data,
      {
        branchId: viewBy === "branch" ? item.column.id : (item.data.branchId as string | undefined),
        processId: viewBy === "process" ? item.column.id : (item.data.processId as string | undefined),
      },
      idc,
      revenue,
      invoicedRevenue,
      seat,
      people,
      periodOpen,
      viewBy === "process"
    );
    // Coverage belongs on the column, not among the money rows: it qualifies how far the whole
    // column can be trusted, and a consumer must be able to see that before reading any figure in it.
    let column = data.peopleCostCoveragePct === undefined
      ? item.column
      : {
          ...item.column,
          peopleCostCoveragePct: data.peopleCostCoveragePct as number,
          peopleCostActiveEmployees: data.peopleCostActiveEmployees as number,
          peopleCostCoveredEmployees: data.peopleCostCoveredEmployees as number,
        };
    // Part B: manual adjustments are process-scoped (see StatementColumn.manualAdjustment doc) —
    // attached only for a "process" view column, keyed on the column id, which IS the processId there.
    if (viewBy === "process") {
      const bucket = manualAdjustments.get(item.column.id);
      if (bucket && (bucket.approvedRewards !== 0 || bucket.approvedPenalties !== 0
        || bucket.approvedProjectedRevenue !== 0 || bucket.pendingCount !== 0)) {
        const systemRevenue = n(data.recognizedRevenue);
        column = {
          ...column,
          manualAdjustment: {
            approvedProjectedRevenue: bucket.approvedProjectedRevenue,
            approvedRewards: bucket.approvedRewards,
            approvedPenalties: bucket.approvedPenalties,
            adjustedTotal: systemRevenue + bucket.approvedRewards - bucket.approvedPenalties,
            pendingAdjustmentCount: bucket.pendingCount,
          },
        };
      }
    }
    return { column, data };
  });

  const statementRows: StatementRow[] = components.map((component) => ({
    componentKey: component.component_key,
    displayName: component.display_name,
    section: component.section_key,
    parentComponentKey: component.parent_component_key ?? null,
    format: component.format_type,
    isSubtotal: Boolean(component.is_subtotal),
    values: Object.fromEntries(
      columnData.map(({ column, data }) => [column.id, resolveValue(data, component)])
    ),
  }));

  return {
    viewBy,
    calculationEngine: summary.calculationEngine,
    generatedAt: summary.generatedAt,
    // So the caller can say how current the people cost is instead of implying it is live.
    peopleCostAsOf: people.asOfDate,
    /*
     * Which basis the revenue line is on, said out loud.
     *
     * A closed month recognises what was invoiced; an open one keeps the planned figure because
     * invoicing lags delivery. The two can differ enormously — July showed Rs 175.57 lakh planned
     * against Rs 56.57 lakh invoiced so far — and a reader given both numbers and no explanation
     * reasonably concludes one of them is wrong. Stating the basis is what makes the pair
     * intelligible rather than alarming.
     */
    revenueBasis: periodOpen ? "planned" : "invoiced",
    periodOpen,
    columns: columnData.map((item) => item.column),
    rows: statementRows,
  };
}

export const pnlStatementService = { getStatement };
