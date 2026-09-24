import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { assertNotFuturePeriod } from "./pnl-period-guard.js";
import { entriesForCodes, readBudgetEntries, topUpsForCodes, type BudgetEntry } from "./pnl-budget-source.js";
import { readGrnSpend, type GrnSpendRow } from "./pnl-actuals.service.js";
import { getSeatBillingEstimate, isEstimateWindow } from "./pnl-seat-billing.service.js";
import { payrollAttributionSql } from "./pnl-cost-centre-override.service.js";
import { getCurrentDateIST } from "../../shared/istDate.js";

/**
 * The row-level detail behind every clickable P&L cell — "what actually makes up this number".
 *
 * CORRECTNESS DESIGN NOTE. The ideal is that a drilldown's total ties to its summary cell BY
 * CONSTRUCTION (the summary literally sums these same rows). For people cost and GRN spend that
 * refactor is safe and done here — peopleByBranch()/spendByBranch() in ceo-overview.service.ts
 * are simple single-purpose queries. Revenue is not: revenueByBranch() is a multi-source UNION
 * (invoice lines, a provision-shortfall fallback, credit notes) with COLLATE joins and a
 * GREATEST(provision - invoice, 0) rule to avoid double-counting — algebraically inlining that
 * into a row-returning function is a materially bigger, riskier rewrite of a live revenue
 * function than this fix warrants. Instead, revenueDrilldownRows() below is built from the
 * IDENTICAL WHERE-clause predicates as revenueByBranch() (same OWN_COMPANY_SQL, same period/
 * branch/process scoping), just ungrouped — and verify-pnl-reconciliation.ts's Section E
 * empirically checks drilldown-sum === summary-cell before this is trusted, rather than
 * asserting it can never diverge by construction. Documented, not hidden.
 *
 * SCOPE. A cell can be scoped by branch (the branch comparison table), by process, or by cost
 * centre (the Focus panel, shown when a filter narrows to exactly one of either) — exactly the
 * same three scope kinds ceo-overview.service.ts's own revenueByBranch()/peopleByBranch()/
 * spendByBranch() already accept via CeoScope. Exactly one of branchId/processId/costCentreId
 * must be set; the route validates this before calling in.
 */

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};

export interface DrilldownRow {
  id: string;
  label: string;
  detail: string | null;
  amount: number;
  date: string | null;
}

export interface PnlDrilldownResult {
  metric: string;
  scope: Record<string, string | undefined>;
  rows: DrilldownRow[];
  total: number;
  /** True when the underlying source could only be matched by a looser/synthetic rule (e.g. a
   *  provision estimate standing in for an invoice not yet raised) — surfaced so the UI can label
   *  it, not hide it. */
  hasEstimatedRows: boolean;
}

export interface PnlDrilldownScope {
  branchId?: string;
  processId?: string;
  costCentreId?: string;
}

export type PnlDrilldownQuery = PnlDrilldownScope & {
  metric: "revenue" | "people" | "indirect" | "budget";
  period: string;
  /**
   * Return people cost grouped by designation (headcount + total) instead of one row per employee.
   *
   * CLAUDE.md forbids exposing payroll/salary data through management or any non-payroll surface,
   * and the per-employee form of this drilldown is exactly that: a named person against their
   * gross + employer contributions. The route sets this for every caller who is entitled to the
   * P&L but not to payroll (ceo, coo, admin, branch_head, process_manager), so those roles still
   * get a truthful breakdown of the same total without a single individual's salary in it.
   *
   * Enforced at the route, not in the component — a frontend that forgot to pass it must not be
   * able to leak salary.
   */
  aggregatePeople?: boolean;
  /**
   * Narrow people cost to one P&L line: Agent Salary, DSC People or BMC People.
   *
   * Without this, clicking any one of those three cells would open the same undifferentiated list
   * of everyone in scope, whose total is the sum of all three — a drilldown that visibly disagrees
   * with the cell it was opened from. The Agent/DSC/BMC split exists only on
   * pnl_running_salary_snapshot.pnl_bucket (resolved once at snapshot time by resolveBucket), and
   * pnl-statement.service.ts sources those three lines from exactly that split, so a bucketed
   * drilldown reads the snapshot rather than posted payroll — the same basis as the cell.
   */
  peopleBucket?: PnlPeopleBucket;
};

export type PnlPeopleBucket = "agent_salary" | "dsc_people" | "bmc_people";

const OWN_COMPANY_SQL = `REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'`;

/** The cost-centre-side scope predicate shared by revenue and indirect (both join through
 *  cost_centre_master as `ccm`) — mirrors revenueByBranch()/spendByBranch()'s own scope
 *  handling in ceo-overview.service.ts exactly, so a drilldown can never see a different set of
 *  cost centres than the summary cell it was clicked from. */
function costCentreScopeSql(scope: PnlDrilldownScope): { sql: string; param: string } {
  if (scope.costCentreId) return { sql: "ccm.id = ?", param: scope.costCentreId };
  if (scope.processId) {
    return {
      sql: `ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                        WHERE e.process_id = ? AND e.cost_centre_id IS NOT NULL)`,
      param: scope.processId,
    };
  }
  return { sql: "ccm.branch_id = ?", param: scope.branchId! };
}

/**
 * The employee-side scope predicate for people cost, on the SAME attribution the summaries use
 * (audit item 17b): Live P&L's readPayroll() and CEO Overview's peopleByBranch() both place a
 * person on their EFFECTIVE cost centre (post-override, pnl_employee_cost_centre_override), and on
 * that cost centre's branch — falling back to the home branch only when there is no cost centre at
 * all. This used to filter on the raw e.cost_centre_id / e.branch_id, so an overridden employee
 * appeared under their HR cost centre's drilldown while their pay was counted in another's tile.
 *
 * `personId` / `homeCostCentre` / `homeBranch` / `process` are the caller's aliased columns — the
 * employees table (e.*) for posted payroll, the running snapshot (s.*) for the accrual fallback.
 */
async function effectivePeopleScope(
  scope: PnlDrilldownScope,
  cols: { personId: string; homeCostCentre: string; homeBranch: string; process: string },
): Promise<{ join: string; sql: string; param: string }> {
  // payrollAttributionSql: the one attribution the summaries use. Process scope too (2026-09-23,
  // owner rule): a mapped employee sits under the MAPPED cost centre's process, as on CEO Overview
  // and the Statement's process view, never under their home process as well.
  const ov = await payrollAttributionSql({
    employeeIdExpr: cols.personId, homeCostCentreExpr: cols.homeCostCentre,
    homeBranchExpr: cols.homeBranch, homeProcessExpr: cols.process, ccAlias: "pcc",
  });
  const join = ov.join;
  if (scope.costCentreId) return { join, sql: `${ov.effectiveCostCentreExpr} = ?`, param: scope.costCentreId };
  if (scope.processId) return { join, sql: `${ov.effectiveProcessExpr} = ?`, param: scope.processId };
  return {
    join,
    sql: `(${ov.effectiveBranchExpr}) = ?`,
    param: scope.branchId!,
  };
}

const EMPLOYEE_COLS = { personId: "e.id", homeCostCentre: "e.cost_centre_id", homeBranch: "e.branch_id", process: "e.process_id" };
const SNAPSHOT_COLS = { personId: "s.employee_id", homeCostCentre: "s.cost_centre_id", homeBranch: "s.branch_id", process: "s.process_id" };

async function revenueDrilldownRows(period: string, scope: PnlDrilldownScope): Promise<PnlDrilldownResult> {
  const rows: DrilldownRow[] = [];
  let hasEstimatedRows = false;
  const cc = costCentreScopeSql(scope);
  if (await tableExists("billing_invoice_particular_snapshot")) {
    const [invoiceRows] = await db.execute<RowDataPacket[]>(
      `SELECT p.bill_source_id, p.cost_centre_code, ccm.cost_centre_name, p.particulars, p.service,
              p.amount, p.source_created_at
         FROM billing_invoice_particular_snapshot p
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = p.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE p.period_code = ? AND ${cc.sql} AND ${OWN_COMPANY_SQL}
        ORDER BY p.amount DESC`,
      [period, cc.param],
    );
    for (const r of invoiceRows) {
      rows.push({
        id: `inv-${r.bill_source_id}`,
        label: r.cost_centre_name ? String(r.cost_centre_name) : String(r.cost_centre_code ?? ""),
        detail: [r.service, r.particulars].filter(Boolean).join(" — ") || null,
        amount: n(r.amount),
        date: r.source_created_at ? String(r.source_created_at) : null,
      });
    }
    if (await tableExists("billing_credit_note_snapshot")) {
      const [creditRows] = await db.execute<RowDataPacket[]>(
        `SELECT cn.bill_source_id, cn.credit_no, cn.cost_centre_code, ccm.cost_centre_name, cn.total_amt, cn.credit_date, cn.description
           FROM billing_credit_note_snapshot cn
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = cn.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE cn.period_code = ? AND cn.is_approved = 1 AND ${cc.sql} AND ${OWN_COMPANY_SQL}`,
        [period, cc.param],
      );
      for (const r of creditRows) {
        rows.push({
          id: `credit-${r.bill_source_id}-${r.credit_no}`,
          label: r.cost_centre_name ? String(r.cost_centre_name) : String(r.cost_centre_code ?? ""),
          detail: `Credit note${r.description ? `: ${r.description}` : ""}`,
          amount: -n(r.total_amt),
          date: r.credit_date ? String(r.credit_date) : null,
        });
      }
    }
    // Provision accrual — the same GREATEST(provision - invoice, 0) per cost centre that
    // revenueByBranch() (CEO) and readRevenue() (Live P&L's revenueAccrual) add to the summary.
    // Audit item 17c: this used to add a provision only for cost centres with NO invoice line at
    // all, so a PARTIALLY invoiced cost centre (provision above its invoices) showed less in the
    // drilldown than in the tile, by exactly the un-invoiced remainder.
    if (await tableExists("billing_provision_snapshot")) {
      const [provisionRows] = await db.execute<RowDataPacket[]>(
        `SELECT pa.cost_centre_code, pa.cost_centre_name, pa.provision_amount,
                COALESCE(ia.invoice_amount, 0) AS invoice_amount
           FROM (
             SELECT ps.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
                    MAX(ccm.cost_centre_name) AS cost_centre_name,
                    SUM(CASE WHEN ps.billing_amt > 0 THEN ps.billing_amt ELSE ps.provision_amt END) AS provision_amount
               FROM billing_provision_snapshot ps
               LEFT JOIN cost_centre_master ccm
                      ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = ps.cost_centre_code COLLATE utf8mb4_unicode_ci
              WHERE ps.period_code = ? AND ps.revenue_active = 1 AND ${cc.sql} AND ${OWN_COMPANY_SQL}
              GROUP BY ps.cost_centre_code COLLATE utf8mb4_unicode_ci
           ) pa
           LEFT JOIN (
             SELECT p.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code, SUM(p.amount) AS invoice_amount
               FROM billing_invoice_particular_snapshot p
               LEFT JOIN cost_centre_master ccm
                      ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = p.cost_centre_code COLLATE utf8mb4_unicode_ci
              WHERE p.period_code = ? AND ${cc.sql} AND ${OWN_COMPANY_SQL}
              GROUP BY p.cost_centre_code COLLATE utf8mb4_unicode_ci
           ) ia ON ia.cost_centre_code = pa.cost_centre_code`,
        [period, cc.param, period, cc.param],
      );
      for (const r of provisionRows) {
        const invoiced = n(r.invoice_amount);
        const accrual = Math.max(n(r.provision_amount) - invoiced, 0);
        if (accrual <= 0) continue;
        hasEstimatedRows = true;
        rows.push({
          id: `prov-${r.cost_centre_code}`,
          label: r.cost_centre_name ? String(r.cost_centre_name) : String(r.cost_centre_code ?? ""),
          detail: invoiced > 0
            ? `Provision not yet invoiced — provision ${n(r.provision_amount).toLocaleString("en-IN")} less ${invoiced.toLocaleString("en-IN")} invoiced`
            : "Provision estimate — invoice not yet raised this period",
          amount: accrual,
          date: null,
        });
      }
    }
  }
  // Seat-rate estimate (audit item 17d): the Live P&L's "Est" revenue cell for a cost centre with no
  // invoice and no provision had no rows behind it at all, so the drawer opened empty.
  const invoicedOrAccrued = rows.some((r) => r.id.startsWith("inv-") || r.id.startsWith("prov-"));
  if (scope.costCentreId && !invoicedOrAccrued) {
    const estimate = await seatEstimateRows(period, scope.costCentreId);
    if (estimate.length) {
      hasEstimatedRows = true;
      rows.push(...estimate);
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  return { metric: "revenue", scope: { period, ...scope }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows };
}

/**
 * The seat-rate estimate behind a Live P&L "Est" revenue cell, one row per seat/fixed line —
 * the same getSeatBillingEstimate() figure pnl-reconciliation.service.ts adds as revenueEstimated,
 * under the same conditions: inside the open estimate window, and only for a cost centre (and
 * branch) that is open today. Rows are scaled to the month-to-date figure (toDate) the tile shows;
 * the last row absorbs rounding so the drawer total equals the cell exactly. Never invents a line:
 * no configured or invoiced rate means no rows.
 */
async function seatEstimateRows(period: string, costCentreId: string): Promise<DrilldownRow[]> {
  const asOfDate = getCurrentDateIST();
  if (!isEstimateWindow(period, asOfDate)) return [];
  const [status] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.active_status AS cc_active, bm.active_status AS branch_active
       FROM cost_centre_master ccm LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
      WHERE ccm.id = ?`,
    [costCentreId],
  );
  const open = status[0] && Number(status[0].cc_active ?? 0) === 1 && Number(status[0].branch_active ?? 1) === 1;
  if (!open) return [];
  const estimate = await getSeatBillingEstimate(period, { costCentreId, asOfDate }).catch(() => null);
  const cc = estimate?.costCentres.find((c) => c.costCentreId === costCentreId);
  if (!estimate || !cc || !(cc.toDate > 0) || !(cc.monthlyValue > 0) || cc.lines.length === 0) return [];
  const ratio = cc.toDate / cc.monthlyValue;
  const basis = cc.source === "configured"
    ? "configured under P&L Configuration > Seat billing"
    : `from the ${cc.sourcePeriod ?? "last"} invoice`;
  const days = estimate.daysElapsed < estimate.daysInMonth
    ? `, counted for ${estimate.daysElapsed} of ${estimate.daysInMonth} days`
    : "";
  const out: DrilldownRow[] = cc.lines.map((line, i) => ({
    id: `est-${costCentreId}-${line.id ?? i}`,
    label: line.lineLabel || "Seat billing line",
    detail: `Seat-rate ESTIMATE, no invoice or provision yet — ${line.seats > 0 ? `${line.seats} x ${line.rateMonthly.toLocaleString("en-IN")}` : "fixed"} per month, ${basis}${days}`,
    amount: Math.round(line.monthlyValue * ratio * 100) / 100,
    date: null,
  }));
  const drift = cc.toDate - out.reduce((t, r) => t + r.amount, 0);
  out[out.length - 1] = { ...out[out.length - 1], amount: Math.round((out[out.length - 1].amount + drift) * 100) / 100 };
  return out;
}

/**
 * Running-salary fallback for a period payroll has not run for yet.
 *
 * Without this the people drilldown was silently empty for every open period. Measured live
 * 2026-09-03: the latest salary_prep_run is 2026-07, so both 2026-08 and 2026-09 have zero
 * salary_prep_line rows — while the statement's own people cost for 2026-08 is real (Rs 138.19
 * lakh across 1,011 snapshot rows), because pnl-statement.service.ts prefers salary_prep_line
 * only once payroll has actually run and otherwise reads pnl_running_salary_snapshot. A drilldown
 * that reads only the posted payroll therefore renders "None" underneath a populated cell — the
 * exact drilldown-does-not-tie-to-summary failure this module's own doc comment warns about.
 *
 * Same precedence as the statement: posted payroll wins; this is consulted only when there is
 * none. Rows are flagged estimated, since an earned-till-date accrual is not a locked payslip.
 */
async function peopleSnapshotRows(
  period: string,
  scope: PnlDrilldownScope,
  aggregate: boolean,
  bucket?: PnlPeopleBucket,
): Promise<DrilldownRow[]> {
  if (!(await tableExists("pnl_running_salary_snapshot"))) return [];
  // Both the un-bucketed accrual fallback (a Live P&L / CEO cell, audit item 17b) and a bucketed
  // Statement Agent/DSC/BMC cell use the effective (post-mapping) attribution: since 2026-09-23 the
  // Statement's running-salary reader (pnl-running-salary.service.ts getRunningPeopleCost) groups
  // the snapshot by the same effective branch/process, so this still ties to the clicked cell.
  const s = await effectivePeopleScope(scope, SNAPSHOT_COLS);
  const bucketSql = bucket ? " AND s.pnl_bucket = ?" : "";
  const bucketParams = bucket ? [bucket] : [];
  const rows: DrilldownRow[] = [];
  if (aggregate) {
    const [groupRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(TRIM(s.designation_name), ''), 'Unspecified designation') AS designation_name,
              COUNT(*) AS headcount, SUM(COALESCE(s.earned_salary_till_date,0)) AS amount
         FROM pnl_running_salary_snapshot s
         ${s.join}
        WHERE s.period_code = ? AND ${s.sql}${bucketSql}
        GROUP BY designation_name
        ORDER BY amount DESC`,
      [period, s.param, ...bucketParams],
    );
    for (const r of groupRows) {
      const headcount = n(r.headcount);
      rows.push({
        id: `snap-grp-${String(r.designation_name)}`,
        label: String(r.designation_name),
        detail: `${headcount} employee${headcount === 1 ? "" : "s"} · ${basisNote(bucket)}`,
        amount: n(r.amount),
        date: null,
      });
    }
    return rows;
  }
  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT s.id, s.employee_code, s.designation_name, s.pnl_bucket, s.as_of_date,
            COALESCE(s.earned_salary_till_date,0) AS amount, e.full_name
       FROM pnl_running_salary_snapshot s
       LEFT JOIN employees e ON e.id = s.employee_id
       ${s.join}
      WHERE s.period_code = ? AND ${s.sql}${bucketSql}
      ORDER BY amount DESC`,
    [period, s.param, ...bucketParams],
  );
  for (const r of lineRows) {
    rows.push({
      id: `snap-${r.id}`,
      label: r.full_name ? String(r.full_name) : String(r.employee_code ?? "Unnamed"),
      detail: [r.employee_code, r.designation_name, basisNote(bucket)]
        .filter(Boolean).join(" · "),
      amount: n(r.amount),
      date: r.as_of_date ? String(r.as_of_date) : null,
    });
  }
  return rows;
}

/** Why this row's figure is what it is — the snapshot means two different things depending on
 *  whether it was reached as a fallback or asked for by bucket. */
function basisNote(bucket?: PnlPeopleBucket): string {
  return bucket
    ? "earned to date, per the Agent/DSC/BMC classification snapshot"
    : "earned to date, payroll not yet run";
}

/**
 * People cost grouped by designation — the payroll-safe form of peopleDrilldownRows().
 *
 * Same source rows, same scope predicate, same total; only the grain differs. Sums the identical
 * gross + employer-contribution expression so a role that sees this and a role that sees the
 * per-employee list can never be shown two different numbers for the same cell.
 */
async function peopleDrilldownRowsAggregated(period: string, scope: PnlDrilldownScope): Promise<PnlDrilldownResult> {
  const rows: DrilldownRow[] = [];
  if (await tableExists("salary_prep_line")) {
    const emp = await effectivePeopleScope(scope, EMPLOYEE_COLS);
    const [groupRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(des.designation_name, 'Unspecified designation') AS designation_name,
              COUNT(*) AS headcount,
              SUM(COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)+COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)) AS amount
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id
         JOIN employees e ON e.id = l.employee_id
         LEFT JOIN designation_master des ON des.id = e.designation_id
         ${emp.join}
        WHERE r.run_month = ? AND ${emp.sql}
        GROUP BY designation_name
        ORDER BY amount DESC`,
      [period, emp.param],
    );
    for (const r of groupRows) {
      const headcount = n(r.headcount);
      rows.push({
        id: `sal-grp-${String(r.designation_name)}`,
        label: String(r.designation_name),
        detail: `${headcount} employee${headcount === 1 ? "" : "s"}`,
        amount: n(r.amount),
        date: null,
      });
    }
  }
  if (rows.length === 0) {
    const fallback = await peopleSnapshotRows(period, scope, true);
    return {
      metric: "people", scope: { period, ...scope }, rows: fallback,
      total: fallback.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: fallback.length > 0,
    };
  }
  return { metric: "people", scope: { period, ...scope }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: false };
}

async function peopleDrilldownRows(period: string, scope: PnlDrilldownScope): Promise<PnlDrilldownResult> {
  const rows: DrilldownRow[] = [];
  if (await tableExists("salary_prep_line")) {
    const emp = await effectivePeopleScope(scope, EMPLOYEE_COLS);
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT l.id, e.employee_code, e.full_name, e.cost_center_code,
              (COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)+COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)) AS amount
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id
         JOIN employees e ON e.id = l.employee_id
         ${emp.join}
        WHERE r.run_month = ? AND ${emp.sql}
        ORDER BY amount DESC`,
      [period, emp.param],
    );
    for (const r of lineRows) {
      rows.push({
        id: `sal-${r.id}`,
        label: r.full_name ? String(r.full_name) : String(r.employee_code ?? "Unnamed"),
        detail: [r.employee_code, r.cost_center_code].filter(Boolean).join(" · ") || null,
        amount: n(r.amount),
        date: null,
      });
    }
  }
  if (rows.length === 0) {
    const fallback = await peopleSnapshotRows(period, scope, false);
    return {
      metric: "people", scope: { period, ...scope }, rows: fallback,
      total: fallback.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: fallback.length > 0,
    };
  }
  return { metric: "people", scope: { period, ...scope }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: false };
}

const GRN_SOURCE_LABEL: Record<string, string> = {
  app_allocation: "Smart GRN allocation",
  app_grn: "GRN",
  db_bill_mirror: "db_bill GRN (not captured in-app)",
};

/**
 * GRN rows behind an Indirect cell — read through readGrnSpend(), the one GRN reader Live P&L's
 * grnActual, the Statement's total_idc and CEO Overview's spendByBranch all sum (audit item 17a).
 * This used to read only the db_bill mirror: no app grn_cost_allocation, no ordinary GRNs, and no
 * de-dup guard against GRNs the app had already captured — so it neither contained the app's
 * spend nor excluded the mirror's duplicates of it, and could not tie to the tile.
 *
 * Same legs, same company rule, same ex-GST amount (2026-09-24), same dedup; only one row per GRN. Branch
 * scope keeps the reader's own branch attribution (cost centre's branch, else the GRN's). Reserved
 * (approved, not yet consumed) GRN is added inside the open estimate window — the same rule both
 * Live P&L (grnEstimated) and CEO Overview apply — and flagged as estimated.
 */
async function indirectDrilldownRows(period: string, scope: PnlDrilldownScope): Promise<PnlDrilldownResult> {
  const readerScope = scope.costCentreId
    ? { costCentreIds: [scope.costCentreId] }
    : scope.processId ? { processIds: [scope.processId] } : {};
  const inBranch = (r: GrnSpendRow) => !scope.branchId || r.branchId === scope.branchId;
  const toRow = (r: GrnSpendRow, reserved: boolean, i: number): DrilldownRow => ({
    id: `grn-${reserved ? "reserved" : r.source ?? "grn"}-${r.grnRef ?? i}-${r.costCentreId ?? ""}-${i}`,
    label: r.label || (r.grnRef ? `GRN ${r.grnRef}` : "GRN"),
    detail: [
      r.grnRef ? `GRN ${r.grnRef}` : null,
      reserved ? "Approved, not yet consumed (committed estimate)" : GRN_SOURCE_LABEL[r.source ?? ""] ?? null,
    ].filter(Boolean).join(" · ") || null,
    amount: r.amount,
    date: r.billDate ?? null,
  });

  const consumed = (await readGrnSpend(period, "consumed", { ...readerScope, withDetail: true })).filter(inBranch);
  const reserved = isEstimateWindow(period, getCurrentDateIST())
    ? (await readGrnSpend(period, "reserved", { ...readerScope, withDetail: true })).filter(inBranch)
    : [];
  const rows = [
    ...consumed.map((r, i) => toRow(r, false, i)),
    ...reserved.map((r, i) => toRow(r, true, i)),
  ].sort((a, b) => b.amount - a.amount);
  return {
    metric: "indirect", scope: { period, ...scope }, rows,
    total: rows.reduce((s, r) => s + r.amount, 0),
    hasEstimatedRows: reserved.length > 0,
  };
}

/** The cost centre codes a process / cost-centre scope covers — the same resolution the CEO focus
 *  panel (buildFocus) uses for its budget lines. The mirror carries no cost_centre_id, only the
 *  centre's code (expense_type_name), so budget scope is always matched on the code. */
async function scopeCostCentreCodes(scope: PnlDrilldownScope): Promise<string[]> {
  const [codes] = await db.execute<RowDataPacket[]>(
    scope.costCentreId
      ? `SELECT cost_centre_code AS code FROM cost_centre_master WHERE id = ?`
      : `SELECT DISTINCT ccm.cost_centre_code AS code
           FROM employees e JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
          WHERE e.process_id = ?`,
    [scope.costCentreId ?? scope.processId],
  );
  return codes.map((r) => String(r.code ?? "")).filter(Boolean);
}

const BUDGET_SOURCE_LABEL: Record<string, string> = { hrms: "HRMS budget", mirror: "db_bill budget" };

function budgetEntryRow(e: BudgetEntry): DrilldownRow {
  const where = e.kind === "top_up"
    ? `Header-level addition${e.branchName ? ` — ${e.branchName}` : ""}, not tied to a specific line`
    : [e.costCentreCode && e.costCentreCode !== e.label ? e.costCentreCode : null, e.branchName]
        .filter(Boolean).join(" · ");
  return {
    id: e.entryRef,
    label: e.label,
    detail: [where || null, BUDGET_SOURCE_LABEL[e.source]].filter(Boolean).join(" · ") || null,
    amount: e.amount,
    date: null,
  };
}

/**
 * The rows behind a budget cell. Read from pnl-budget-source.ts readBudgetEntries() — the SAME
 * reader Live P&L's allocatedBudget/branchBudget and CEO Overview's budget use (owner rule
 * 2026-09-23: HRMS budget for any branch + month with an active HRMS budget, db_bill mirror
 * otherwise), so a budget cell and the drawer it opens always total the same. Before this the
 * drawer read the mirror only while Live's cell read HRMS only.
 *
 *   - branch scope: every entry keyed to that branch id, including mirror header-level top-ups
 *     (without them the drawer under-totalled CEO's figure — Rs 36,500 mismatch caught live
 *     2026-08-22).
 *   - process / cost-centre scope: the lines of the cost centres in scope (matched on code), plus
 *     only those top-ups whose budget funds nothing but this scope (focusBudgetTopUps' rule, the
 *     CEO focus panel's figure). A shared budget's top-up is never pro-rated.
 */
async function budgetDrilldownRows(period: string, scope: PnlDrilldownScope): Promise<PnlDrilldownResult> {
  const entries = await readBudgetEntries(period);
  const rows: DrilldownRow[] = [];
  if (!scope.costCentreId && !scope.processId) {
    for (const e of entries) if (e.branchId === scope.branchId) rows.push(budgetEntryRow(e));
  } else {
    const codes = await scopeCostCentreCodes(scope);
    for (const e of entriesForCodes(entries, codes)) rows.push(budgetEntryRow(e));
    const topUps = topUpsForCodes(entries, codes);
    if (topUps.attributable !== 0) {
      rows.push({
        id: "topup-in-scope",
        label: "Sanctioned top-up",
        detail: "Header-level additions on budgets that fund only this scope's cost centres",
        amount: topUps.attributable,
        date: null,
      });
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  return { metric: "budget", scope: { period, ...scope }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: false };
}

export async function getPnlDrilldown(query: PnlDrilldownQuery): Promise<PnlDrilldownResult> {
  assertNotFuturePeriod(query.period);
  const scope: PnlDrilldownScope = {
    branchId: query.branchId,
    processId: query.processId,
    costCentreId: query.costCentreId,
  };
  switch (query.metric) {
    case "revenue": return revenueDrilldownRows(query.period, scope);
    case "people": {
      // A bucketed request is answered from the snapshot outright — posted payroll carries no
      // Agent/DSC/BMC column to filter on, and the statement's own bucket lines read the same
      // snapshot, so this is the source that ties to the clicked cell.
      if (query.peopleBucket) {
        const rows = await peopleSnapshotRows(
          query.period, scope, Boolean(query.aggregatePeople), query.peopleBucket,
        );
        return {
          metric: "people", scope: { period: query.period, ...scope, bucket: query.peopleBucket },
          rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: rows.length > 0,
        };
      }
      return query.aggregatePeople
        ? peopleDrilldownRowsAggregated(query.period, scope)
        : peopleDrilldownRows(query.period, scope);
    }
    case "indirect": return indirectDrilldownRows(query.period, scope);
    case "budget":
      return budgetDrilldownRows(query.period, scope);
  }
}
