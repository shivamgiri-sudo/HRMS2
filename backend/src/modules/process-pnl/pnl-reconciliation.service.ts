import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { OWN_COMPANY_SQL } from "./pnl-actuals.service.js";

export type PnlReconciliationMode = "FINAL" | "LIVE_MTD" | "BLOCKED";
export type PnlSourceStatus = "ACTUAL" | "ACCRUAL" | "MISSING" | "PARTIAL";

export interface PnlReconciliationFilters {
  branchIds?: string[];
  includeInactive?: boolean;
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
  companyName: string | null;
  active: boolean;
  revenueInvoice: number;
  revenueProvision: number;
  revenueAccrual: number;
  creditNote: number;
  recognisedRevenue: number;
  grnActual: number;
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
  revenue: number;
  grnActual: number;
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
  revenue: number;
  revenueInvoice: number;
  revenueAccrual: number;
  creditNote: number;
  grnActual: number;
  allocatedBudget: number;
  branchBudget: number;
  payrollCost: number;
  staffPaid: number;
  operatingProfit: number;
  marginPct: number | null;
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
}

interface CostCentreRow extends RowDataPacket {
  id: string;
  cost_centre_code: string | null;
  cost_centre_name: string | null;
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
const pct = (part: number, whole: number) => (whole !== 0 ? (part / whole) * 100 : null);

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
            ccm.active_status, ccm.branch_id, bm.branch_name
       FROM cost_centre_master ccm
       LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
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

async function readGrn(period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("grn_entry_line_snapshot"))) return out;
  const [rows] = await db.execute<MoneyRow[]>(
    `SELECT ccm.id AS cost_centre_id, SUM(l.total) AS amount
       FROM grn_entry_line_snapshot l
       JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
       LEFT JOIN cost_centre_master ccm
              ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
               = l.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE g.period_code = ? AND g.is_rejected = 0 AND ${OWN_COMPANY_SQL}
      GROUP BY ccm.id`,
    [period],
  );
  for (const row of rows) if (row.cost_centre_id) out.set(String(row.cost_centre_id), n(row.amount));
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
  const [rows] = await db.execute<MoneyRow[]>(
    `SELECT e.cost_centre_id AS cost_centre_id,
            COUNT(*) AS staff,
            SUM(COALESCE(l.gross_salary, 0)
              + COALESCE(l.pf_employer, 0)
              + COALESCE(l.esic_employer, 0)
              + COALESCE(l.gratuity, 0)) AS amount
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id
       JOIN employees e ON e.id = l.employee_id
      WHERE r.run_month = ?
      GROUP BY e.cost_centre_id`,
    [period],
  );
  for (const row of rows) if (row.cost_centre_id) out.set(String(row.cost_centre_id), { cost: n(row.amount), staff: n(row.staff) });
  if (out.size > 0 || !(await tableExists("pnl_running_salary_snapshot"))) return out;

  const [runningRows] = await db.execute<MoneyRow[]>(
    `SELECT cost_centre_id,
            COUNT(*) AS staff,
            SUM(earned_salary_till_date) AS amount
       FROM pnl_running_salary_snapshot
      WHERE period_code = ?
      GROUP BY cost_centre_id`,
    [period],
  );
  for (const row of runningRows) {
    if (row.cost_centre_id) out.set(String(row.cost_centre_id), { cost: n(row.amount), staff: n(row.staff) });
  }
  return out;
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
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count,
              SUM(COALESCE(l.gross_salary, 0)
                + COALESCE(l.pf_employer, 0)
                + COALESCE(l.esic_employer, 0)
                + COALESCE(l.gratuity, 0)) AS amount
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id
         JOIN employees e ON e.id = l.employee_id
        WHERE r.run_month = ? AND e.cost_centre_id IS NULL`,
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

  const [costCentres, revenue, grn, budgets, payroll, freshness, exceptionsOut] = await Promise.all([
    readCostCentres(filters),
    readRevenue(period),
    readGrn(period),
    readBudgets(period),
    readPayroll(period),
    Promise.all([
      sourceFreshness("Invoice lines", "billing_invoice_particular_snapshot", period),
      sourceFreshness("Billing provision", "billing_provision_snapshot", period),
      sourceFreshness("Credit notes", "billing_credit_note_snapshot", period),
      sourceFreshness("GRN", "grn_entry_snapshot", period),
      payrollFreshness(period),
      runningSalaryFreshness(period),
    ]),
    exceptions(period),
  ]);

  const payrollPosted = (freshness.find((item) => item.source === "Payroll")?.rows ?? 0) > 0;
  const rows: PnlReconciliationRow[] = costCentres.map((cc) => {
    const rev = revenue.get(cc.id);
    const revenueInvoice = n(rev?.invoice_amount);
    const revenueProvision = n(rev?.provision_amount);
    const revenueAccrual = n(rev?.accrual_amount);
    const creditNote = n(rev?.credit_note);
    const recognisedRevenue = revenueInvoice + revenueAccrual - creditNote;
    const grnActual = grn.get(cc.id) ?? 0;
    const allocatedBudget = budgets.byCostCentre.get(cc.id) ?? 0;
    const branchBudget = budgets.byBranch.get(cc.branch_id ? String(cc.branch_id) : "") ?? 0;
    const pay = payroll.get(cc.id);
    const payrollCost = pay?.cost ?? 0;
    const staffPaid = pay?.staff ?? 0;
    const operatingProfit = recognisedRevenue - payrollCost - grnActual;
    const issues: string[] = [];
    addIssue(issues, !payrollPosted && payrollCost > 0, "PAYROLL_ACCRUED_NOT_FINAL");
    addIssue(issues, !payrollPosted && payrollCost === 0, "PAYROLL_NOT_POSTED_FOR_PERIOD");
    addIssue(issues, recognisedRevenue > 0 && payrollCost === 0, "REVENUE_WITH_NO_PAYROLL");
    addIssue(issues, recognisedRevenue === 0 && (payrollCost > 0 || grnActual > 0), "COST_WITH_NO_REVENUE");
    addIssue(issues, grnActual > 0 && allocatedBudget === 0, "GRN_WITHOUT_COST_CENTRE_BUDGET");
    addIssue(issues, allocatedBudget > 0 && grnActual > allocatedBudget, "GRN_OVER_ALLOCATED_BUDGET");
    addIssue(issues, branchBudget === 0 && (allocatedBudget > 0 || grnActual > 0), "BRANCH_BUDGET_MISSING");
    return {
      branchId: cc.branch_id ? String(cc.branch_id) : null,
      branchName: cc.branch_name ? String(cc.branch_name) : "Unassigned",
      costCentreId: String(cc.id),
      costCentreCode: String(cc.cost_centre_code ?? ""),
      costCentreName: String(cc.cost_centre_name ?? cc.cost_centre_code ?? "Unnamed cost centre"),
      companyName: cc.company_name ? String(cc.company_name) : null,
      active: Number(cc.active_status ?? 0) === 1,
      revenueInvoice,
      revenueProvision,
      revenueAccrual,
      creditNote,
      recognisedRevenue,
      grnActual,
      allocatedBudget,
      branchBudget,
      payrollCost,
      staffPaid,
      operatingProfit,
      marginPct: pct(operatingProfit, recognisedRevenue),
      sourceStatus: sourceStatus({ invoice: revenueInvoice, accrual: revenueAccrual, payroll: payrollCost, grn: grnActual, budget: allocatedBudget }, payrollPosted),
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
      revenue: 0,
      grnActual: 0,
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
    current.allocatedBudget += row.allocatedBudget;
    current.branchBudget = Math.max(current.branchBudget, row.branchBudget);
    current.payrollCost += row.payrollCost;
    current.staffPaid += row.staffPaid;
    current.operatingProfit += row.operatingProfit;
    for (const issue of row.issues) if (!current.issues.includes(issue)) current.issues.push(issue);
    current.marginPct = pct(current.operatingProfit, current.revenue);
    branchMap.set(key, current);
  }

  const sum = (pick: (row: PnlReconciliationRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const totals: PnlReconciliationTotals = {
    activeCostCentres: rows.filter((row) => row.active).length,
    revenue: sum((row) => row.recognisedRevenue),
    revenueInvoice: sum((row) => row.revenueInvoice),
    revenueAccrual: sum((row) => row.revenueAccrual),
    creditNote: sum((row) => row.creditNote),
    grnActual: sum((row) => row.grnActual),
    allocatedBudget: sum((row) => row.allocatedBudget),
    branchBudget: Array.from(branchMap.values()).reduce((total, row) => total + row.branchBudget, 0),
    payrollCost: sum((row) => row.payrollCost),
    staffPaid: sum((row) => row.staffPaid),
    operatingProfit: sum((row) => row.operatingProfit),
    marginPct: null,
  };
  totals.marginPct = pct(totals.operatingProfit, totals.revenue);

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
  };
}
