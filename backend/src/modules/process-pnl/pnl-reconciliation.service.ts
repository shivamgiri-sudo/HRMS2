import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { OWN_COMPANY_SQL } from "./pnl-actuals.service.js";
import { getSeatBillingEstimate, isEstimateWindow, type CostCentreSeatBilling } from "./pnl-seat-billing.service.js";
import { getCurrentDateIST } from "../../shared/istDate.js";
import { ccProcessJoin, ccProcessNameSql } from "./cost-centre-label.js";
import { overrideJoinSql } from "./pnl-cost-centre-override.service.js";

export type PnlReconciliationMode = "FINAL" | "LIVE_MTD" | "BLOCKED";
export type PnlSourceStatus = "ACTUAL" | "ACCRUAL" | "MISSING" | "PARTIAL" | "ESTIMATED";
/** Where a cost centre's recognised revenue came from. ESTIMATED = seat rate x seats. */
export type PnlRevenueBasis = "INVOICE" | "ACCRUAL" | "ESTIMATED" | "NONE";

export interface PnlReconciliationFilters {
  branchIds?: string[];
  includeInactive?: boolean;
  /** IST calendar date the estimate window and month-to-date are measured from. Defaults to today. */
  asOfDate?: string;
}

export interface PnlSourceFreshness {
  source: string;
  table: string;
  rows: number;
  latestSyncedAt: string | null;
  status: PnlSourceStatus;
}

export interface PnlReconciliationRow {
  branchId: string | null;
  branchName: string;
  costCentreId: string;
  costCentreCode: string;
  costCentreName: string;
  /** The process this cost centre serves (mapped process, else billing process name); null if unknown. */
  costCentreProcess: string | null;
  companyName: string | null;
  active: boolean;
  revenueInvoice: number;
  revenueProvision: number;
  revenueAccrual: number;
  creditNote: number;
  /** Seat rate x seats, used only when the cost centre has no invoice and no provision. */
  revenueEstimated: number;
  recognisedRevenue: number;
  revenueBasis: PnlRevenueBasis;
  /** configured = P&L Configuration > Seat billing; invoice = the cost centre's last invoice. */
  estimateSource: "configured" | "invoice" | null;
  estimateSourcePeriod: string | null;
  /** Monthly seat billing / days in month — the daily run-rate, whatever the revenue basis. */
  perDayRevenue: number;
  grnActual: number;
  /** Approved GRN spend (reserved, not yet consumed) for the open month — a committed estimate,
   *  same treatment as revenueEstimated. Zero for a closed month or once the bill is consumed. */
  grnEstimated: number;
  allocatedBudget: number;
  branchBudget: number;
  payrollCost: number;
  staffPaid: number;
  operatingProfit: number;
  marginPct: number | null;
  sourceStatus: PnlSourceStatus;
  issues: string[];
}

export interface PnlBranchRollup {
  branchId: string | null;
  branchName: string;
  costCentres: number;
  /** Part of payrollCost that belongs to this branch's staff with no cost centre. */
  unallocatedPayroll: number;
  revenue: number;
  grnActual: number;
  grnEstimated: number;
  allocatedBudget: number;
  branchBudget: number;
  payrollCost: number;
  staffPaid: number;
  operatingProfit: number;
  marginPct: number | null;
  issues: string[];
}

export interface PnlReconciliationTotals {
  activeCostCentres: number;
  /** Payroll of MAS staff with no cost centre. Real MAS cost, so it IS in payrollCost and
   *  operatingProfit here and in the branch rollups — but in no cost-centre row. */
  unallocatedPayroll: number;
  unallocatedStaff: number;
  revenue: number;
  revenueInvoice: number;
  revenueAccrual: number;
  creditNote: number;
  revenueEstimated: number;
  estimatedCostCentres: number;
  perDayRevenue: number;
  grnActual: number;
  grnEstimated: number;
  allocatedBudget: number;
  branchBudget: number;
  payrollCost: number;
  staffPaid: number;
  operatingProfit: number;
  marginPct: number | null;
  /** Below-the-line — company-wide only, manually entered by Finance (process_pnl_cost_component,
   *  scoped to no process/branch). See readBelowTheLine(). */
  depreciation: number;
  financeCost: number;
  taxProvision: number;
  belowTheLineTotal: number;
  /** operatingProfit - belowTheLineTotal. Deeper than OP% above: OP% is a contribution margin
   *  (revenue - payroll - GRN); this also subtracts depreciation, loan interest and tax, matching
   *  the owner's own manual P&L (EBITDA -> EBDTA -> PBT/PAT). Company-wide only, never allocated
   *  to a branch or cost centre. */
  truePat: number;
  truePatPct: number | null;
}

export interface PnlReconciliationException {
  code: string;
  label: string;
  amount: number;
  count: number;
}

export interface PnlReconciliation {
  period: string;
  company: string;
  mode: PnlReconciliationMode;
  generatedAt: string;
  totals: PnlReconciliationTotals;
  branches: PnlBranchRollup[];
  rows: PnlReconciliationRow[];
  freshness: PnlSourceFreshness[];
  exceptions: PnlReconciliationException[];
  blockers: string[];
  /** No indirect cost (GRN) exists for the month anywhere in the company — margin is NA. */
  idcMissing: boolean;
  /** Basis of the seat-rate estimate, so the page can say what "estimated" means. */
  estimate: {
    applied: boolean;
    daysInMonth: number;
    daysElapsed: number;
    configurationAvailable: boolean;
  };
}

interface CostCentreRow extends RowDataPacket {
  id: string;
  cost_centre_code: string | null;
  cost_centre_name: string | null;
  process_name: string | null;
  company_name: string | null;
  active_status: number | null;
  branch_id: string | null;
  branch_name: string | null;
}

interface RevenueRow extends RowDataPacket {
  cost_centre_id: string | null;
  cost_centre_code: string | null;
  invoice_amount: number | string | null;
  provision_amount: number | string | null;
  accrual_amount: number | string | null;
  credit_note: number | string | null;
}

interface MoneyRow extends RowDataPacket {
  cost_centre_id: string | null;
  branch_id?: string | null;
  amount: number | string | null;
  staff?: number | string | null;
}

const PERIOD_RE = /^\d{4}-\d{2}$/;
const marks = (list: string[]) => list.map(() => "?").join(",");
const n = (value: unknown) => {
  const out = Number(value ?? 0);
  return Number.isFinite(out) ? out : 0;
};
// A margin needs positive revenue: on a negative base (credit notes above invoices) the ratio flips
// sign and reads as a large positive margin — BSS/OB/Noida/974 showed +164.7% in June 2026.
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

function addIssue(target: string[], condition: boolean, issue: string) {
  if (condition) target.push(issue);
}

async function readCostCentres(filters: PnlReconciliationFilters): Promise<CostCentreRow[]> {
  const where = [OWN_COMPANY_SQL];
  const params: unknown[] = [];
  if (!filters.includeInactive) where.push("ccm.active_status = 1");
  if (filters.branchIds?.length) {
    where.push(`ccm.branch_id IN (${marks(filters.branchIds)})`);
    params.push(...filters.branchIds);
  }
  const [rows] = await db.execute<CostCentreRow[]>(
    `SELECT ccm.id, ccm.cost_centre_code, ccm.cost_centre_name, ccm.company_name,
            ccm.active_status, ccm.branch_id, bm.branch_name, ${ccProcessNameSql()} AS process_name
       FROM cost_centre_master ccm
       LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
       ${ccProcessJoin()}
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(bm.branch_name, 'Unassigned'), ccm.cost_centre_code`,
    params,
  );
  return rows;
}

async function readRevenue(period: string): Promise<Map<string, RevenueRow>> {
  const out = new Map<string, RevenueRow>();
  if (!(await tableExists("billing_invoice_particular_snapshot"))) return out;
  const hasProvision = await tableExists("billing_provision_snapshot");
  const hasCreditNote = await tableExists("billing_credit_note_snapshot");
  const [rows] = await db.execute<RevenueRow[]>(
    `${hasProvision ? `
     WITH invoice_actual AS (
       SELECT p.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
              ccm.id AS cost_centre_id,
              SUM(p.amount) AS invoice_amount
         FROM billing_invoice_particular_snapshot p
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = p.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE p.period_code = ? AND ${OWN_COMPANY_SQL}
        GROUP BY p.cost_centre_code COLLATE utf8mb4_unicode_ci, ccm.id
     ),
     provision_actual AS (
       SELECT ps.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
              ccm.id AS cost_centre_id,
              SUM(CASE WHEN ps.billing_amt > 0 THEN ps.billing_amt ELSE ps.provision_amt END) AS provision_amount
         FROM billing_provision_snapshot ps
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = ps.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE ps.period_code = ? AND ps.revenue_active = 1 AND ${OWN_COMPANY_SQL}
        GROUP BY ps.cost_centre_code COLLATE utf8mb4_unicode_ci, ccm.id
     )
     SELECT cost_centre_id, cost_centre_code,
            SUM(invoice_amount) AS invoice_amount,
            SUM(provision_amount) AS provision_amount,
            SUM(accrual_amount) AS accrual_amount,
            SUM(credit_note) AS credit_note
       FROM (
         SELECT cost_centre_id, cost_centre_code, invoice_amount,
                0 AS provision_amount, 0 AS accrual_amount, 0 AS credit_note
           FROM invoice_actual
         UNION ALL
         SELECT p.cost_centre_id, p.cost_centre_code, 0,
                p.provision_amount,
                GREATEST(p.provision_amount - COALESCE(i.invoice_amount, 0), 0),
                0
           FROM provision_actual p
           LEFT JOIN invoice_actual i
                  ON i.cost_centre_code = p.cost_centre_code
                 AND COALESCE(i.cost_centre_id, '') = COALESCE(p.cost_centre_id, '')
         ${hasCreditNote ? `
         UNION ALL
         SELECT ccm.id, cn.cost_centre_code COLLATE utf8mb4_unicode_ci,
                0, 0, 0, cn.total_amt
           FROM billing_credit_note_snapshot cn
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                   = cn.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE cn.period_code = ? AND cn.is_approved = 1 AND ${OWN_COMPANY_SQL}` : ""}
       ) revenue
      GROUP BY cost_centre_id, cost_centre_code` : `
     SELECT cost_centre_id, cost_centre_code,
            SUM(invoice_amount) AS invoice_amount,
            0 AS provision_amount,
            0 AS accrual_amount,
            SUM(credit_note) AS credit_note
       FROM (
         SELECT ccm.id AS cost_centre_id,
                p.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
                p.amount AS invoice_amount,
                0 AS credit_note
           FROM billing_invoice_particular_snapshot p
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                   = p.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE p.period_code = ? AND ${OWN_COMPANY_SQL}
         ${hasCreditNote ? `
         UNION ALL
         SELECT ccm.id, cn.cost_centre_code COLLATE utf8mb4_unicode_ci, 0, cn.total_amt
           FROM billing_credit_note_snapshot cn
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                   = cn.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE cn.period_code = ? AND cn.is_approved = 1 AND ${OWN_COMPANY_SQL}` : ""}
       ) revenue
      GROUP BY cost_centre_id, cost_centre_code`}`,
    hasProvision
      ? [period, period, ...(hasCreditNote ? [period] : [])]
      : [period, ...(hasCreditNote ? [period] : [])],
  );
  for (const row of rows) {
    const key = row.cost_centre_id ? String(row.cost_centre_id) : "";
    if (key) out.set(key, row);
  }
  return out;
}

/**
 * GRN actual spend by cost centre, for the Live P&L / Alerts tab's grnActual column.
 *
 * RESOLVED 2026-08-29 — was mirror-only, is now app-side-first. Same defect, same fix, as
 * ceo-overview.service.ts's spendByBranch() and the P&L Statement tab's getIndirectCostActuals():
 * this read ONLY the db_bill mirror, which was the whole GRN story when it was written and has
 * not been since — matching by GRN NUMBER found 97% of the app's own consumed allocations already
 * present in the mirror under the same number, so this tab was double-counting the same real
 * spend. The app's own grn_cost_allocation (carrying pnl_cost_amount, proper tax treatment) is now
 * the primary source; the mirror UNION only ever contributes a GRN the app has not captured.
 */
async function readGrn(period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  const [appRows] = await db.execute<MoneyRow[]>(
    `SELECT a.cost_centre_id AS cost_centre_id, SUM(a.pnl_cost_amount) AS amount
       FROM grn_cost_allocation a
       JOIN grn_request gr ON gr.id = a.grn_request_id
      WHERE a.lifecycle_status = 'consumed'
        AND gr.accounting_period = ?
      GROUP BY a.cost_centre_id`,
    [period],
  );
  for (const row of appRows) if (row.cost_centre_id) out.set(String(row.cost_centre_id), n(row.amount));

  if (await tableExists("grn_entry_line_snapshot")) {
    const [rows] = await db.execute<MoneyRow[]>(
      `SELECT ccm.id AS cost_centre_id, SUM(l.amount) AS amount
         FROM grn_entry_line_snapshot l
         JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = l.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE g.period_code = ? AND g.is_rejected = 0 AND ${OWN_COMPANY_SQL}
          AND NOT EXISTS (
                SELECT 1
                  FROM grn_request gr2
                  JOIN grn_cost_allocation a2 ON a2.grn_request_id = gr2.id
                 WHERE gr2.grn_number = g.grn_no
                   AND a2.lifecycle_status = 'consumed'
              )
        GROUP BY ccm.id`,
      [period],
    );
    for (const row of rows) {
      if (!row.cost_centre_id) continue;
      const key = String(row.cost_centre_id);
      out.set(key, (out.get(key) ?? 0) + n(row.amount));
    }
  }

  return out;
}

/**
 * GRN spend that is approved and committed but not yet consumed — 'reserved' lifecycle_status,
 * i.e. a branch head has signed off the request and it is booked against a cost centre, but the
 * bill has not been fully processed. Real spend the company is on the hook for, just not final.
 *
 * Read only for the open estimate window (see isEstimateWindow / the seat-rate revenue estimate
 * it mirrors): a closed month's IDC is whatever was actually consumed, never a committed figure
 * that should have long since resolved to consumed-or-cancelled. Live-checked 2026-09-16: Sep-26
 * carried Rs 1.37 L consumed against Rs 11.65 L reserved — the whole reason live GRN read as
 * near-zero while real committed spend already existed.
 *
 * No mirror UNION: 'reserved' is a workflow state internal to this app's own GRN approval chain,
 * not something the legacy db_bill snapshot (a bill inventory, not an approval queue) ever holds.
 */
async function readGrnCommitted(period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const [rows] = await db.execute<MoneyRow[]>(
    `SELECT a.cost_centre_id AS cost_centre_id, SUM(a.pnl_cost_amount) AS amount
       FROM grn_cost_allocation a
       JOIN grn_request gr ON gr.id = a.grn_request_id
      WHERE a.lifecycle_status = 'reserved'
        AND gr.accounting_period = ?
      GROUP BY a.cost_centre_id`,
    [period],
  );
  for (const row of rows) if (row.cost_centre_id) out.set(String(row.cost_centre_id), n(row.amount));
  return out;
}

/**
 * Depreciation, finance cost (loan interest) and tax provision — company-wide only, manually
 * entered by Finance via the "Below-the-line costs" P&L Configuration tab, into the same
 * process_pnl_cost_component table the older canonical/BPO P&L engine already uses. Filtered to
 * process_id IS NULL AND branch_id IS NULL deliberately: a process/branch-scoped row on this table
 * belongs to that other engine's per-process allocation model, not this company-level figure, and
 * mixing the two would silently invent a branch allocation nobody asked for.
 *
 * 2026-09-16: the owner's own manual G-Sheet P&L subtracts these (EBITDA -> minus finance cost ->
 * EBDTA -> minus depreciation -> PBT/PAT) and its own Risk Dashboard already flags that once they
 * are subtracted, FY26-27 is a real loss — Live P&L's Operating Profit never reflected that because
 * it is a contribution margin (revenue - payroll - GRN only). This is intentionally read into
 * totals ONLY (see truePat below), never into a row or branch rollup.
 */
async function readBelowTheLine(period: string): Promise<{ depreciation: number; financeCost: number; taxProvision: number }> {
  const out = { depreciation: 0, financeCost: 0, taxProvision: 0 };
  if (!(await tableExists("process_pnl_cost_component"))) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cost_type, SUM(amount_inr) AS amount
       FROM process_pnl_cost_component
      WHERE period_code = ? AND status = 'approved'
        AND process_id IS NULL AND branch_id IS NULL
        AND cost_type IN ('depreciation', 'finance_cost', 'tax')
      GROUP BY cost_type`,
    [period],
  );
  for (const row of rows) {
    const amount = n(row.amount);
    if (row.cost_type === "depreciation") out.depreciation = amount;
    else if (row.cost_type === "finance_cost") out.financeCost = amount;
    else if (row.cost_type === "tax") out.taxProvision = amount;
  }
  return out;
}

async function readBudgets(period: string) {
  const byCostCentre = new Map<string, number>();
  const byBranch = new Map<string, number>();
  if (await tableExists("finance_budget_line")) {
    const [rows] = await db.execute<MoneyRow[]>(
      `SELECT cost_centre_id, SUM(amount) AS amount FROM (
          SELECT l.cost_centre_id AS cost_centre_id, l.pnl_cost_amount AS amount
            FROM finance_budget_line l
            JOIN finance_budget_header h ON h.id = l.budget_id
           WHERE h.period_code = ? AND h.status = 'active' AND l.cost_centre_id IS NOT NULL
          UNION ALL
          SELECT a.cost_centre_id, a.pnl_cost_amount
            FROM finance_budget_line_allocation a
            JOIN finance_budget_line l ON l.id = a.budget_line_id
            JOIN finance_budget_header h ON h.id = l.budget_id
           WHERE h.period_code = ? AND h.status = 'active'
       ) budgeted
      GROUP BY cost_centre_id`,
      [period, period],
    );
    for (const row of rows) if (row.cost_centre_id) byCostCentre.set(String(row.cost_centre_id), n(row.amount));
  }
  if (await tableExists("finance_budget_header")) {
    const [rows] = await db.execute<MoneyRow[]>(
      `SELECT branch_id, SUM(pnl_budget_amount) AS amount
         FROM finance_budget_header
        WHERE period_code = ? AND status = 'active'
        GROUP BY branch_id`,
      [period],
    );
    for (const row of rows) byBranch.set(row.branch_id ? String(row.branch_id) : "", n(row.amount));
  }
  return { byCostCentre, byBranch };
}

async function readPayroll(period: string): Promise<Map<string, { cost: number; staff: number }>> {
  const out = new Map<string, { cost: number; staff: number }>();
  if (!(await tableExists("salary_prep_line"))) return out;
  const ov = await overrideJoinSql("e.id", "e.cost_centre_id");
  const [rows] = await db.execute<MoneyRow[]>(
    `SELECT ${ov.effectiveCostCentreExpr} AS cost_centre_id,
            COUNT(*) AS staff,
            SUM(COALESCE(l.gross_salary, 0)
              + COALESCE(l.pf_employer, 0)
              + COALESCE(l.esic_employer, 0)
              + COALESCE(l.gratuity, 0)) AS amount
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id
       JOIN employees e ON e.id = l.employee_id
       ${ov.join}
      WHERE r.run_month = ?
      GROUP BY ${ov.effectiveCostCentreExpr}`,
    [period],
  );
  for (const row of rows) if (row.cost_centre_id) out.set(String(row.cost_centre_id), { cost: n(row.amount), staff: n(row.staff) });
  if (out.size > 0 || !(await tableExists("pnl_running_salary_snapshot"))) return out;

  const ovSnapshot = await overrideJoinSql("s.employee_id", "s.cost_centre_id");
  const [runningRows] = await db.execute<MoneyRow[]>(
    `SELECT ${ovSnapshot.effectiveCostCentreExpr} AS cost_centre_id,
            COUNT(*) AS staff,
            SUM(earned_salary_till_date) AS amount
       FROM pnl_running_salary_snapshot s
       ${ovSnapshot.join}
      WHERE period_code = ?
      GROUP BY ${ovSnapshot.effectiveCostCentreExpr}`,
    [period],
  );
  for (const row of runningRows) {
    if (row.cost_centre_id) out.set(String(row.cost_centre_id), { cost: n(row.amount), staff: n(row.staff) });
  }
  return out;
}

/**
 * Payroll of staff with no cost centre, by their branch (owner rule, recorded in
 * ceo-overview.service.ts: every employee here is MAS Callnet, so their wages are MAS cost even
 * without a mapping). Until 2026-09-15 this was only listed as an exception and left out of the
 * totals, which overstated OP: Rs 1.11 L for 7 people in August 2026 (7.09% instead of 6.70%).
 * Final payroll run only — the running-salary snapshot is keyed by cost centre, so it has none.
 */
async function readUnallocatedPayroll(period: string, branchIds: string[] | undefined): Promise<Array<{ branchId: string | null; branchName: string; cost: number; staff: number }>> {
  if (!(await tableExists("salary_prep_line"))) return [];
  const branchClause = branchIds?.length ? `AND e.branch_id IN (${marks(branchIds)})` : "";
  // A mapped override takes an employee out of "unallocated" too — that is a real use of this
  // feature (someone with no HR cost centre at all can still be pointed at one for P&L purposes).
  const ov = await overrideJoinSql("e.id", "e.cost_centre_id");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id AS branch_id, MAX(bm.branch_name) AS branch_name,
            COUNT(*) AS staff,
            SUM(COALESCE(l.gross_salary, 0)
              + COALESCE(l.pf_employer, 0)
              + COALESCE(l.esic_employer, 0)
              + COALESCE(l.gratuity, 0)) AS amount
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id
       JOIN employees e ON e.id = l.employee_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       ${ov.join}
      WHERE r.run_month = ? AND ${ov.effectiveCostCentreExpr} IS NULL ${branchClause}
      GROUP BY e.branch_id`,
    [period, ...(branchIds ?? [])],
  );
  return rows
    .map((r) => ({ branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_name ? String(r.branch_name) : "Unassigned", cost: n(r.amount), staff: n(r.staff) }))
    .filter((r) => r.cost !== 0 || r.staff > 0);
}

async function sourceFreshness(source: string, table: string, period: string, periodColumn = "period_code"): Promise<PnlSourceFreshness> {
  if (!(await tableExists(table))) return { source, table, rows: 0, latestSyncedAt: null, status: "MISSING" };
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS \`rows\`, MAX(synced_at) AS latest_synced_at FROM ${table} WHERE ${periodColumn} = ?`,
    [period],
  );
  const first = rows[0] ?? {};
  const count = n(first.rows);
  return {
    source,
    table,
    rows: count,
    latestSyncedAt: first.latest_synced_at ? String(first.latest_synced_at) : null,
    status: count > 0 ? "ACTUAL" : "MISSING",
  };
}

async function payrollFreshness(period: string): Promise<PnlSourceFreshness> {
  if (!(await tableExists("salary_prep_line"))) {
    return { source: "Payroll", table: "salary_prep_line", rows: 0, latestSyncedAt: null, status: "MISSING" };
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(l.id) AS \`rows\`, MAX(r.created_at) AS latest_synced_at
       FROM salary_prep_run r
       LEFT JOIN salary_prep_line l ON l.run_id = r.id
      WHERE r.run_month = ?`,
    [period],
  );
  const first = rows[0] ?? {};
  const count = n(first.rows);
  return {
    source: "Payroll",
    table: "salary_prep_line",
    rows: count,
    latestSyncedAt: first.latest_synced_at ? String(first.latest_synced_at) : null,
    status: count > 0 ? "ACTUAL" : "MISSING",
  };
}

async function runningSalaryFreshness(period: string): Promise<PnlSourceFreshness> {
  if (!(await tableExists("pnl_running_salary_snapshot"))) {
    return { source: "Running salary", table: "pnl_running_salary_snapshot", rows: 0, latestSyncedAt: null, status: "MISSING" };
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS \`rows\`, MAX(computed_at) AS latest_synced_at
       FROM pnl_running_salary_snapshot
      WHERE period_code = ?`,
    [period],
  );
  const first = rows[0] ?? {};
  const count = n(first.rows);
  return {
    source: "Running salary",
    table: "pnl_running_salary_snapshot",
    rows: count,
    latestSyncedAt: first.latest_synced_at ? String(first.latest_synced_at) : null,
    status: count > 0 ? "ACCRUAL" : "MISSING",
  };
}

async function exceptions(period: string): Promise<PnlReconciliationException[]> {
  const out: PnlReconciliationException[] = [];
  if (await tableExists("salary_prep_line")) {
    const ov = await overrideJoinSql("e.id", "e.cost_centre_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count,
              SUM(COALESCE(l.gross_salary, 0)
                + COALESCE(l.pf_employer, 0)
                + COALESCE(l.esic_employer, 0)
                + COALESCE(l.gratuity, 0)) AS amount
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id
         JOIN employees e ON e.id = l.employee_id
         ${ov.join}
        WHERE r.run_month = ? AND ${ov.effectiveCostCentreExpr} IS NULL`,
      [period],
    );
    const first = rows[0] ?? {};
    if (n(first.count) > 0 || n(first.amount) > 0) {
      out.push({ code: "PAYROLL_UNMAPPED_COST_CENTRE", label: "Payroll without cost centre", count: n(first.count), amount: n(first.amount) });
    }
  }
  return out;
}

function sourceStatus(row: {
  invoice: number;
  accrual: number;
  payroll: number;
  grn: number;
  budget: number;
}, payrollPosted: boolean): PnlSourceStatus {
  if (!payrollPosted && (row.invoice + row.accrual + row.grn + row.budget > 0)) return "PARTIAL";
  if (row.accrual > 0 && row.invoice === 0) return "ACCRUAL";
  if (row.invoice + row.accrual + row.payroll + row.grn + row.budget === 0) return "MISSING";
  return row.accrual > 0 ? "PARTIAL" : "ACTUAL";
}

export async function getPnlReconciliation(
  period: string,
  filters: PnlReconciliationFilters = {},
): Promise<PnlReconciliation> {
  if (!PERIOD_RE.test(period)) {
    throw Object.assign(new Error("period must be YYYY-MM"), { statusCode: 400 });
  }

  const [costCentres, revenue, grn, grnCommitted, budgets, payroll, belowTheLine, freshness, exceptionsOut, unallocated] = await Promise.all([
    readCostCentres(filters),
    readRevenue(period),
    readGrn(period),
    readGrnCommitted(period),
    readBudgets(period),
    readPayroll(period),
    readBelowTheLine(period),
    Promise.all([
      sourceFreshness("Invoice lines", "billing_invoice_particular_snapshot", period),
      sourceFreshness("Billing provision", "billing_provision_snapshot", period),
      sourceFreshness("Credit notes", "billing_credit_note_snapshot", period),
      sourceFreshness("GRN", "grn_entry_snapshot", period),
      payrollFreshness(period),
      runningSalaryFreshness(period),
    ]),
    exceptions(period),
    readUnallocatedPayroll(period, filters.branchIds),
  ]);

  const payrollPosted = (freshness.find((item) => item.source === "Payroll")?.rows ?? 0) > 0;

  // Seat-rate estimate for cost centres the month has not invoiced yet. Only inside the open
  // billing window: a closed month with no invoice stays at zero instead of acquiring revenue
  // nobody billed. A failure here degrades to "no estimate", never to a broken Live P&L.
  const asOfDate = filters.asOfDate ?? getCurrentDateIST();
  const estimateApplies = isEstimateWindow(period, asOfDate);
  const seatBilling = await getSeatBillingEstimate(period, { branchIds: filters.branchIds, asOfDate })
    .catch(() => null);
  const seatByCc = new Map<string, CostCentreSeatBilling>(
    (seatBilling?.costCentres ?? []).map((item) => [item.costCentreId, item]),
  );

  const rows: PnlReconciliationRow[] = costCentres.map((cc) => {
    const rev = revenue.get(cc.id);
    const revenueInvoice = n(rev?.invoice_amount);
    const revenueProvision = n(rev?.provision_amount);
    const revenueAccrual = n(rev?.accrual_amount);
    const creditNote = n(rev?.credit_note);
    const seat = seatByCc.get(String(cc.id));
    const useEstimate = estimateApplies && revenueInvoice === 0 && revenueAccrual === 0 && (seat?.toDate ?? 0) > 0;
    const revenueEstimated = useEstimate ? seat!.toDate : 0;
    const revenueBasis: PnlRevenueBasis = revenueInvoice > 0 ? "INVOICE" : revenueAccrual > 0 ? "ACCRUAL" : useEstimate ? "ESTIMATED" : "NONE";
    const recognisedRevenue = revenueInvoice + revenueAccrual + revenueEstimated - creditNote;
    const grnActual = grn.get(cc.id) ?? 0;
    // Committed-not-yet-consumed GRN, only inside the open window — same rule as revenueEstimated.
    const grnEstimated = estimateApplies ? (grnCommitted.get(cc.id) ?? 0) : 0;
    const allocatedBudget = budgets.byCostCentre.get(cc.id) ?? 0;
    const branchBudget = budgets.byBranch.get(cc.branch_id ? String(cc.branch_id) : "") ?? 0;
    const pay = payroll.get(cc.id);
    const payrollCost = pay?.cost ?? 0;
    const staffPaid = pay?.staff ?? 0;
    const grnTotal = grnActual + grnEstimated;
    const operatingProfit = recognisedRevenue - payrollCost - grnTotal;
    const issues: string[] = [];
    addIssue(issues, !payrollPosted && payrollCost > 0, "PAYROLL_ACCRUED_NOT_FINAL");
    addIssue(issues, !payrollPosted && payrollCost === 0, "PAYROLL_NOT_POSTED_FOR_PERIOD");
    addIssue(issues, recognisedRevenue > 0 && payrollCost === 0, "REVENUE_WITH_NO_PAYROLL");
    addIssue(issues, recognisedRevenue === 0 && (payrollCost > 0 || grnTotal > 0), "COST_WITH_NO_REVENUE");
    addIssue(issues, grnTotal > 0 && allocatedBudget === 0, "GRN_WITHOUT_COST_CENTRE_BUDGET");
    addIssue(issues, allocatedBudget > 0 && grnTotal > allocatedBudget, "GRN_OVER_ALLOCATED_BUDGET");
    addIssue(issues, branchBudget === 0 && (allocatedBudget > 0 || grnTotal > 0), "BRANCH_BUDGET_MISSING");
    addIssue(issues, useEstimate, "REVENUE_ESTIMATED_FROM_SEAT_RATE");
    addIssue(issues, grnEstimated > 0, "GRN_ESTIMATED_FROM_RESERVED");
    return {
      branchId: cc.branch_id ? String(cc.branch_id) : null,
      branchName: cc.branch_name ? String(cc.branch_name) : "Unassigned",
      costCentreId: String(cc.id),
      costCentreCode: String(cc.cost_centre_code ?? ""),
      costCentreName: String(cc.cost_centre_name ?? cc.cost_centre_code ?? "Unnamed cost centre"),
      costCentreProcess: cc.process_name ? String(cc.process_name) : null,
      companyName: cc.company_name ? String(cc.company_name) : null,
      active: Number(cc.active_status ?? 0) === 1,
      revenueInvoice,
      revenueProvision,
      revenueAccrual,
      creditNote,
      revenueEstimated,
      recognisedRevenue,
      revenueBasis,
      estimateSource: useEstimate ? (seat!.source === "configured" ? "configured" : "invoice") : null,
      estimateSourcePeriod: useEstimate ? seat!.sourcePeriod : null,
      perDayRevenue: seat?.perDay ?? 0,
      grnActual,
      grnEstimated,
      allocatedBudget,
      branchBudget,
      payrollCost,
      staffPaid,
      operatingProfit,
      marginPct: pct(operatingProfit, recognisedRevenue),
      sourceStatus: useEstimate
        ? "ESTIMATED"
        : sourceStatus({ invoice: revenueInvoice, accrual: revenueAccrual, payroll: payrollCost, grn: grnTotal, budget: allocatedBudget }, payrollPosted),
      issues,
    };
  });

  const branchMap = new Map<string, PnlBranchRollup>();
  for (const row of rows) {
    const key = row.branchId ?? "";
    const current = branchMap.get(key) ?? {
      branchId: row.branchId,
      branchName: row.branchName,
      costCentres: 0,
      unallocatedPayroll: 0,
      revenue: 0,
      grnActual: 0,
      grnEstimated: 0,
      allocatedBudget: 0,
      branchBudget: row.branchBudget,
      payrollCost: 0,
      staffPaid: 0,
      operatingProfit: 0,
      marginPct: null,
      issues: [],
    };
    current.costCentres += 1;
    current.revenue += row.recognisedRevenue;
    current.grnActual += row.grnActual;
    current.grnEstimated += row.grnEstimated;
    current.allocatedBudget += row.allocatedBudget;
    current.branchBudget = Math.max(current.branchBudget, row.branchBudget);
    current.payrollCost += row.payrollCost;
    current.staffPaid += row.staffPaid;
    current.operatingProfit += row.operatingProfit;
    for (const issue of row.issues) if (!current.issues.includes(issue)) current.issues.push(issue);
    current.marginPct = pct(current.operatingProfit, current.revenue);
    branchMap.set(key, current);
  }

  // Staff with no cost centre: their pay joins their branch and the company, never a row.
  const unallocatedPayroll = payrollPosted ? unallocated : [];
  for (const u of unallocatedPayroll) {
    const key = u.branchId ?? "unassigned";
    const current = branchMap.get(key) ?? {
      branchId: u.branchId, branchName: u.branchName, costCentres: 0, unallocatedPayroll: 0, revenue: 0,
      grnActual: 0, grnEstimated: 0, allocatedBudget: 0, branchBudget: 0, payrollCost: 0, staffPaid: 0,
      operatingProfit: 0, marginPct: null, issues: [],
    };
    current.unallocatedPayroll += u.cost;
    current.payrollCost += u.cost;
    current.staffPaid += u.staff;
    current.operatingProfit -= u.cost;
    if (!current.issues.includes("PAYROLL_WITHOUT_COST_CENTRE")) current.issues.push("PAYROLL_WITHOUT_COST_CENTRE");
    current.marginPct = pct(current.operatingProfit, current.revenue);
    branchMap.set(key, current);
  }
  const unallocatedCost = unallocatedPayroll.reduce((t, u) => t + u.cost, 0);
  const unallocatedStaff = unallocatedPayroll.reduce((t, u) => t + u.staff, 0);

  const sum = (pick: (row: PnlReconciliationRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const totals: PnlReconciliationTotals = {
    activeCostCentres: rows.filter((row) => row.active).length,
    unallocatedPayroll: unallocatedCost,
    unallocatedStaff,
    revenue: sum((row) => row.recognisedRevenue),
    revenueInvoice: sum((row) => row.revenueInvoice),
    revenueAccrual: sum((row) => row.revenueAccrual),
    creditNote: sum((row) => row.creditNote),
    revenueEstimated: sum((row) => row.revenueEstimated),
    estimatedCostCentres: rows.filter((row) => row.revenueBasis === "ESTIMATED").length,
    perDayRevenue: sum((row) => row.perDayRevenue),
    grnActual: sum((row) => row.grnActual),
    grnEstimated: sum((row) => row.grnEstimated),
    allocatedBudget: sum((row) => row.allocatedBudget),
    branchBudget: Array.from(branchMap.values()).reduce((total, row) => total + row.branchBudget, 0),
    payrollCost: sum((row) => row.payrollCost) + unallocatedCost,
    staffPaid: sum((row) => row.staffPaid) + unallocatedStaff,
    operatingProfit: sum((row) => row.operatingProfit) - unallocatedCost,
    marginPct: null,
    depreciation: belowTheLine.depreciation,
    financeCost: belowTheLine.financeCost,
    taxProvision: belowTheLine.taxProvision,
    belowTheLineTotal: belowTheLine.depreciation + belowTheLine.financeCost + belowTheLine.taxProvision,
    truePat: 0,
    truePatPct: null,
  };
  totals.marginPct = pct(totals.operatingProfit, totals.revenue);
  totals.truePat = totals.operatingProfit - totals.belowTheLineTotal;
  totals.truePatPct = pct(totals.truePat, totals.revenue);
  // No GRN mapped anywhere in the company for the month (readGrn is company-wide, whatever the
  // branch filter) means the overhead data is absent, not that overheads were nil: March 2026 read
  // 40.6% with Rs 0 of indirect cost — its 406 mirror GRNs match no MAS cost centre (Feb: 367, 32.6%). A margin without any overhead is not comparable with any other
  // month, so it is NA — the same treatment as a month with no people cost. Reserved (committed,
  // not yet consumed) GRN counts as IDC data existing too, but only inside the estimate window —
  // exactly the cases readGrnCommitted() is read for.
  const idcMissing = grn.size === 0 && (!estimateApplies || grnCommitted.size === 0) && totals.payrollCost > 0;
  if (idcMissing) {
    totals.marginPct = null;
    totals.truePatPct = null;
    for (const branch of branchMap.values()) branch.marginPct = null;
    for (const row of rows) row.marginPct = null;
  }
  // An estimate fills the revenue side of a month whose people cost may not exist yet (the open
  // month before its running-salary snapshot). Revenue against no people cost reads as a ~99%
  // margin, which is not a margin at all — so say NA until there is a cost to set against it.
  const peopleCostMissing = totals.payrollCost === 0 && totals.revenueEstimated > 0;
  if (peopleCostMissing) {
    totals.marginPct = null;
    totals.truePatPct = null;
    for (const branch of branchMap.values()) if (branch.payrollCost === 0) branch.marginPct = null;
  }

  const blockers: string[] = [];
  if (!payrollPosted) {
    const runningRows = freshness.find((item) => item.source === "Running salary")?.rows ?? 0;
    blockers.push(
      runningRows > 0
        ? "Payroll run is not posted; Live P&L uses accrued running salary. Uploaded incentives or deductions are reflected only after they are applied to payroll inputs/final run."
        : "Payroll run and running salary snapshot are both missing for this period, so live OP excludes people cost.",
    );
  }
  if ((freshness.find((item) => item.source === "Billing provision")?.rows ?? 0) === 0) {
    blockers.push("Billing provision snapshot has no rows for this period; uninvoiced revenue cannot be accrued.");
  }
  if ((freshness.find((item) => item.source === "GRN")?.rows ?? 0) === 0) {
    blockers.push("GRN snapshot has no rows for this period; indirect cost may be missing.");
  }
  if (idcMissing) {
    blockers.push(`No indirect cost (GRN) maps to any MAS cost centre for ${period} — the month's GRNs, if any, carry cost-centre codes that match none — so OP would exclude every overhead. Margin is shown as NA rather than an inflated figure.`);
  }
  if (unallocatedCost !== 0) {
    blockers.push(`Rs ${(unallocatedCost / 100000).toFixed(2)} L of payroll for ${unallocatedStaff} employee(s) with no cost centre is included in company and branch cost (it belongs to no cost-centre row). Map them to a cost centre to attribute it.`);
  }
  if (totals.estimatedCostCentres > 0) {
    const partial = seatBilling && seatBilling.daysElapsed < seatBilling.daysInMonth
      ? `, counted for ${seatBilling.daysElapsed} of ${seatBilling.daysInMonth} days`
      : "";
    blockers.push(
      `${totals.estimatedCostCentres} cost centre(s) have no invoice or provision for ${period} yet, so their revenue is ESTIMATED as seat rate x seats (their last invoice, or lines configured under P&L Configuration > Seat billing)${partial}. It is replaced automatically once the month is invoiced.`,
    );
    if (peopleCostMissing) {
      blockers.push(`No people cost exists for ${period} yet, so margin is shown as NA — estimated revenue against zero salary cost is not a margin.`);
    }
  }
  if (totals.grnEstimated > 0) {
    const grnCcCount = rows.filter((row) => row.grnEstimated > 0).length;
    blockers.push(
      `${grnCcCount} cost centre(s) also carry Rs ${(totals.grnEstimated / 100000).toFixed(2)} L of GRN that is approved and reserved but not yet consumed for ${period} — included as a committed estimate so OP is not understated while the bill finishes processing.`,
    );
  }
  if (totals.belowTheLineTotal === 0) {
    blockers.push(`Depreciation, finance cost and tax have not been entered for ${period} (P&L Configuration > Below-the-line costs) — the True Bottom Line (PAT) figure below excludes them until they are.`);
  }

  const mode: PnlReconciliationMode = blockers.length ? "LIVE_MTD" : "FINAL";
  return {
    period,
    company: "MAS Callnet India Pvt Ltd",
    mode,
    generatedAt: new Date().toISOString(),
    totals,
    branches: Array.from(branchMap.values()).sort((a, b) => b.revenue - a.revenue),
    rows: rows.sort((a, b) => (b.recognisedRevenue - a.recognisedRevenue) || a.costCentreCode.localeCompare(b.costCentreCode)),
    freshness,
    exceptions: exceptionsOut,
    blockers,
    idcMissing,
    estimate: {
      applied: estimateApplies,
      daysInMonth: seatBilling?.daysInMonth ?? 0,
      daysElapsed: seatBilling?.daysElapsed ?? 0,
      configurationAvailable: seatBilling?.configurationAvailable ?? false,
    },
  };
}
