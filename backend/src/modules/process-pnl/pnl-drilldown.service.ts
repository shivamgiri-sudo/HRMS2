import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { assertNotFuturePeriod } from "./pnl-period-guard.js";

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

/** The employee-side scope predicate for people cost — peopleByBranch() filters directly on the
 *  employee's own branch_id/process_id/cost_centre_id, no cost-centre-master join needed. */
function employeeScopeSql(scope: PnlDrilldownScope): { sql: string; param: string } {
  if (scope.costCentreId) return { sql: "e.cost_centre_id = ?", param: scope.costCentreId };
  if (scope.processId) return { sql: "e.process_id = ?", param: scope.processId };
  return { sql: "e.branch_id = ?", param: scope.branchId! };
}

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
    // Provision-shortfall fallback — same GREATEST(provision - invoice, 0) rule as
    // revenueByBranch(), only for cost centres in scope that raised NO invoice line this period
    // (mirroring revenueByBranch()'s own "SOURCE A empty" condition).
    if (await tableExists("billing_provision_snapshot")) {
      const [provisionRows] = await db.execute<RowDataPacket[]>(
        `SELECT ps.cost_centre_code, ccm.cost_centre_name,
                SUM(CASE WHEN ps.billing_amt > 0 THEN ps.billing_amt ELSE ps.provision_amt END) AS provision_amount
           FROM billing_provision_snapshot ps
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = ps.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE ps.period_code = ? AND ps.revenue_active = 1 AND ${cc.sql} AND ${OWN_COMPANY_SQL}
            AND ps.cost_centre_code COLLATE utf8mb4_unicode_ci NOT IN (
                  SELECT p.cost_centre_code COLLATE utf8mb4_unicode_ci
                    FROM billing_invoice_particular_snapshot p WHERE p.period_code = ?
                )
          GROUP BY ps.cost_centre_code, ccm.cost_centre_name
         HAVING provision_amount > 0`,
        [period, cc.param, period],
      );
      for (const r of provisionRows) {
        hasEstimatedRows = true;
        rows.push({
          id: `prov-${r.cost_centre_code}`,
          label: r.cost_centre_name ? String(r.cost_centre_name) : String(r.cost_centre_code ?? ""),
          detail: "Provision estimate — invoice not yet raised this period",
          amount: n(r.provision_amount),
          date: null,
        });
      }
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  return { metric: "revenue", scope: { period, ...scope }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows };
}

/**
 * The employee-side scope predicate against pnl_running_salary_snapshot, which carries its own
 * branch/process/cost-centre attribution (resolved once at snapshot time) rather than joining
 * back to employees.
 */
function snapshotScopeSql(scope: PnlDrilldownScope): { sql: string; param: string } {
  if (scope.costCentreId) return { sql: "s.cost_centre_id = ?", param: scope.costCentreId };
  if (scope.processId) return { sql: "s.process_id = ?", param: scope.processId };
  return { sql: "s.branch_id = ?", param: scope.branchId! };
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
  const s = snapshotScopeSql(scope);
  const bucketSql = bucket ? " AND s.pnl_bucket = ?" : "";
  const bucketParams = bucket ? [bucket] : [];
  const rows: DrilldownRow[] = [];
  if (aggregate) {
    const [groupRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(TRIM(s.designation_name), ''), 'Unspecified designation') AS designation_name,
              COUNT(*) AS headcount, SUM(COALESCE(s.earned_salary_till_date,0)) AS amount
         FROM pnl_running_salary_snapshot s
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
  const emp = employeeScopeSql(scope);
  if (await tableExists("salary_prep_line")) {
    const [groupRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(des.designation_name, 'Unspecified designation') AS designation_name,
              COUNT(*) AS headcount,
              SUM(COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)+COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)) AS amount
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id
         JOIN employees e ON e.id = l.employee_id
         LEFT JOIN designation_master des ON des.id = e.designation_id
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
  const emp = employeeScopeSql(scope);
  if (await tableExists("salary_prep_line")) {
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT l.id, e.employee_code, e.full_name, e.cost_center_code,
              (COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)+COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)) AS amount
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id
         JOIN employees e ON e.id = l.employee_id
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

async function indirectDrilldownRows(period: string, scope: PnlDrilldownScope): Promise<PnlDrilldownResult> {
  const rows: DrilldownRow[] = [];
  const cc = costCentreScopeSql(scope);
  if (await tableExists("grn_entry_line_snapshot")) {
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT l.bill_source_id, l.particular, l.entry_type, l.amount, l.cost_centre_code, ccm.cost_centre_name
         FROM grn_entry_line_snapshot l
         JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = l.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE g.period_code = ? AND g.is_rejected = 0 AND ${cc.sql} AND ${OWN_COMPANY_SQL}
        ORDER BY l.amount DESC`,
      [period, cc.param],
    );
    for (const r of lineRows) {
      rows.push({
        id: `grn-${r.bill_source_id}`,
        label: r.particular ? String(r.particular) : (r.cost_centre_name ? String(r.cost_centre_name) : "GRN line"),
        detail: [r.entry_type, r.cost_centre_name].filter(Boolean).join(" · ") || null,
        amount: n(r.amount),
        date: null,
      });
    }
  }
  return { metric: "indirect", scope: { period, ...scope }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: false };
}

/**
 * The cost-centre-side scope predicate for budget lines.
 *
 * finance_budget_line_snapshot carries no cost_centre_id (or code) column of its own: for
 * expense_type='CostCenter' rows the cost centre lives in `expense_type_name`, holding the centre's
 * code (e.g. 'BSS/BO/CORP/318'). Measured live on 2026-09 data, all 93 of that period's CostCenter
 * lines join cleanly to cost_centre_master on that code, so process/cost-centre scope is resolvable
 * without a schema change — it just has to go through this join rather than a direct column.
 */
function budgetCostCentreScopeSql(scope: PnlDrilldownScope): { sql: string; param: string } | null {
  if (scope.costCentreId) {
    return {
      sql: `l.expense_type_name COLLATE utf8mb4_unicode_ci IN (
              SELECT ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                FROM cost_centre_master ccm WHERE ccm.id = ?)`,
      param: scope.costCentreId,
    };
  }
  if (scope.processId) {
    return {
      sql: `l.expense_type_name COLLATE utf8mb4_unicode_ci IN (
              SELECT ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                FROM cost_centre_master ccm
               WHERE ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                                 WHERE e.process_id = ? AND e.cost_centre_id IS NOT NULL))`,
      param: scope.processId,
    };
  }
  return null;
}

async function budgetDrilldownRows(period: string, scope: PnlDrilldownScope): Promise<PnlDrilldownResult> {
  const rows: DrilldownRow[] = [];
  const cc = budgetCostCentreScopeSql(scope);
  if (await tableExists("finance_budget_line_snapshot")) {
    // Branch scope filters on the budget header's branch; process/cost-centre scope filters on the
    // line's own cost centre and deliberately leaves the header unrestricted, since a budget header
    // for one branch can carry lines for a cost centre a process spans.
    const lineScopeSql = cc ? cc.sql : "bm.id = ?";
    const lineScopeParam = cc ? cc.param : scope.branchId!;
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT l.bill_source_id, l.expense_type_name, l.amount, b.branch_name
         FROM finance_budget_line_snapshot l
         JOIN finance_budget_snapshot b
           ON b.bill_source_id = l.budget_source_id AND b.period_code = l.period_code
         LEFT JOIN (SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm FROM branch_master GROUP BY UPPER(TRIM(branch_name))) bm
                ON bm.nm COLLATE utf8mb4_unicode_ci = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
        WHERE l.period_code = ? AND l.expense_type = 'CostCenter' AND ${lineScopeSql}
          AND b.active_status = 1 AND b.is_rejected = 0
        ORDER BY l.amount DESC`,
      [period, lineScopeParam],
    );
    for (const r of lineRows) {
      rows.push({
        id: `bud-${r.bill_source_id}`,
        label: r.expense_type_name ? String(r.expense_type_name) : "Budget line",
        detail: r.branch_name ? String(r.branch_name) : null,
        amount: n(r.amount),
        date: null,
      });
    }
    // Header-level top-ups (expense_reopen_master.AdditionalAmount, mirrored as
    // reopen_additional_amount) — sanctioned extra budget with no lines of its own, added once
    // per header. budgetByBranch() (ceo-overview.service.ts) UNIONs this into its summary; a
    // drilldown that only listed lines would under-total by exactly this amount, caught live by
    // this session's own reconciliation strip (Rs 36,500 mismatch, 2026-08-22) before shipping.
    //
    // Branch scope only. A top-up is recorded against the budget HEADER with no cost centre of its
    // own, so there is no honest way to attribute it to one process or cost centre — including it
    // under those scopes would inflate their total by another scope's money. Omitted rather than
    // guessed, matching how budget-cost-centre-utilization.service.ts refuses to pro-rate
    // unattributed spend.
    if (!cc && (await tableExists("finance_budget_snapshot"))) {
      const [topUpRows] = await db.execute<RowDataPacket[]>(
        `SELECT b.bill_source_id, b.reopen_additional_amount, b.branch_name
           FROM finance_budget_snapshot b
           LEFT JOIN (SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm FROM branch_master GROUP BY UPPER(TRIM(branch_name))) bm
                  ON bm.nm COLLATE utf8mb4_unicode_ci = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
          WHERE b.period_code = ? AND bm.id = ? AND b.active_status = 1 AND b.is_rejected = 0
            AND b.reopen_additional_amount <> 0`,
        [period, scope.branchId!],
      );
      for (const r of topUpRows) {
        rows.push({
          id: `topup-${r.bill_source_id}`,
          label: "Sanctioned top-up",
          detail: `Header-level addition${r.branch_name ? ` — ${r.branch_name}` : ""}, not tied to a specific line`,
          amount: n(r.reopen_additional_amount),
          date: null,
        });
      }
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
