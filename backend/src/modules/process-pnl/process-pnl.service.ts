import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import type {
  PnlQueryFilters,
  PnlSummaryResponse,
  ProcessPnlDetailBundle,
  ProcessPnlRecord,
} from "./process-pnl.types.js";

type NumericMap = Map<string, number>;
type TextMap = Map<string, string>;

interface ProcessBaseRow {
  process_id: string;
  process_name: string;
  client_id: string | null;
  client_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
}

interface ContractMeta {
  billingModel: string | null;
  billingRate: number;
  contractedSeats: number | null;
}

interface WorkforceMeta {
  productiveHc: number;
  rosterHc: number;
  bufferPct: number | null;
}

interface RevenueSnapshot {
  revenue: number;
  forecast: number;
  revenueAtRisk: number;
  billableHc: number;
  requiredHc: number;
  availableHc: number;
  freshness: string | null;
}

interface InvoiceMeta {
  invoicedRevenue: number;
  recognizedRevenue: number;
  collectedRevenue: number;
  outstandingRevenue: number;
  invoiceCount: number;
  adjustments: number;
  freshness: string | null;
}

interface PayrollMeta {
  total: number;
  gross: number;
  pfEmployer: number;
  esicEmployer: number;
  gratuity: number;
  headcount: number;
  status: "actual" | "forecast";
  runId: string | null;
  freshness: string | null;
}

interface ExpenseMeta {
  approvedAmount: number;
  accrualAmount: number;
  itemCount: number;
  freshness: string | null;
}

interface IndirectAllocationMeta {
  allocatedAmount: number;
  branchPoolAmount: number;
}

interface ProcessPnlComputationContext {
  filters: PnlQueryFilters;
  processes: ProcessBaseRow[];
  contracts: Map<string, ContractMeta>;
  workforce: Map<string, WorkforceMeta>;
  activeHeadcount: NumericMap;
  revenueDaily: Map<string, RevenueSnapshot>;
  invoices: Map<string, InvoiceMeta>;
  payroll: Map<string, PayrollMeta>;
  expenses: Map<string, ExpenseMeta>;
  indirectAllocations: Map<string, IndirectAllocationMeta>;
  generatedAt: string;
}

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  const start = `${period}-01`;
  const endDate = new Date(year, month, 0);
  const end = `${period}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function shiftMonth(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function placeholders(items: unknown[]): string {
  return items.map(() => "?").join(",");
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function maxDate(...values: Array<string | null | undefined>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value));
  if (filtered.length === 0) return null;
  return filtered.sort().at(-1) ?? null;
}

function statusFromProfit(record: {
  operatingProfit: number;
  operatingMarginPct: number | null;
  revenueAtRisk: number;
}): "profitable" | "at-risk" | "loss-making" {
  if (record.operatingProfit < 0) return "loss-making";
  if ((record.operatingMarginPct ?? 0) < 10 || record.revenueAtRisk > 0) return "at-risk";
  return "profitable";
}

function reconciliationStatus(record: {
  revenue: number;
  payroll: number;
  hasContract: boolean;
}): "matched" | "pending" | "exception" {
  if (record.revenue <= 0 && record.payroll > 0) return "exception";
  if (!record.hasContract || record.revenue <= 0 || record.payroll <= 0) return "pending";
  return "matched";
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const rows = await queryRows<RowDataPacket>(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function listColumns(tableName: string): Promise<Set<string>> {
  const rows = await queryRows<RowDataPacket>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => String(row.column_name)));
}

async function getBaseProcesses(filters: PnlQueryFilters): Promise<ProcessBaseRow[]> {
  const conds = ["COALESCE(p.active_status, 1) = 1"];
  const params: unknown[] = [];

  if (filters.branchId) {
    conds.push("p.branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.processId) {
    conds.push("p.id = ?");
    params.push(filters.processId);
  }
  if (filters.clientId) {
    conds.push("p.client_id = ?");
    params.push(filters.clientId);
  }
  if (filters.search?.trim()) {
    const like = `%${filters.search.trim()}%`;
    conds.push("(p.process_name LIKE ? OR p.process_code LIKE ? OR cm.client_name LIKE ? OR bm.branch_name LIKE ?)");
    params.push(like, like, like, like);
  }

  return queryRows<ProcessBaseRow & RowDataPacket>(
    `SELECT
        p.id AS process_id,
        p.process_name,
        p.client_id,
        cm.client_name,
        p.branch_id,
        COALESCE(bm.branch_name, bm.name) AS branch_name
      FROM process_master p
      LEFT JOIN client_master cm ON cm.id = p.client_id
      LEFT JOIN branch_master bm ON bm.id = p.branch_id
      WHERE ${conds.join(" AND ")}
      ORDER BY cm.client_name, p.process_name`,
    params
  );
}

async function getContractMap(processIds: string[], period: string): Promise<Map<string, ContractMeta>> {
  const map = new Map<string, ContractMeta>();
  if (processIds.length === 0) return map;

  if (await tableExists("client_contract_master")) {
    const rows = await queryRows<RowDataPacket>(
      `SELECT process_id, billing_type, billing_rate, monthly_minimum_commitment
         FROM client_contract_master
        WHERE status = 'active'
          AND process_id IN (${placeholders(processIds)})
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC`,
      [...processIds, `${period}-28`, `${period}-01`]
    );

    for (const row of rows) {
      const processId = String(row.process_id);
      if (map.has(processId)) continue;
      map.set(processId, {
        billingModel: (row.billing_type as string | null) ?? null,
        billingRate: toNumber(row.billing_rate),
        contractedSeats: row.monthly_minimum_commitment != null
          ? Math.max(0, Math.round(toNumber(row.monthly_minimum_commitment) / Math.max(toNumber(row.billing_rate, 1), 1)))
          : null,
      });
    }
  }

  if (await tableExists("billing_unit")) {
    const rows = await queryRows<RowDataPacket>(
      `SELECT process_id, billing_type, rate
         FROM billing_unit
        WHERE is_active = 1
          AND process_id IN (${placeholders(processIds)})
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC`,
      [...processIds, `${period}-28`, `${period}-01`]
    );

    for (const row of rows) {
      const processId = String(row.process_id);
      if (map.has(processId)) continue;
      map.set(processId, {
        billingModel: (row.billing_type as string | null) ?? null,
        billingRate: toNumber(row.rate),
        contractedSeats: null,
      });
    }
  }

  return map;
}

async function getWorkforceMap(processIds: string[], start: string, end: string): Promise<Map<string, WorkforceMeta>> {
  const map = new Map<string, WorkforceMeta>();
  if (processIds.length === 0 || !(await tableExists("workforce_mandate"))) return map;

  const rows = await queryRows<RowDataPacket>(
    `SELECT
        process_id,
        SUM(COALESCE(mandated_hc, 0)) AS productive_hc,
        SUM(COALESCE(mandated_hc, 0) * (1 + COALESCE(buffer_pct, 0) / 100 + COALESCE(shrinkage_pct, 0) / 100)) AS roster_hc,
        AVG(NULLIF(buffer_pct, 0)) AS buffer_pct
      FROM workforce_mandate
      WHERE active_status = 1
        AND process_id IN (${placeholders(processIds)})
        AND (effective_from IS NULL OR effective_from <= ?)
        AND (effective_to IS NULL OR effective_to >= ?)
      GROUP BY process_id`,
    [...processIds, end, start]
  );

  for (const row of rows) {
    map.set(String(row.process_id), {
      productiveHc: toNumber(row.productive_hc),
      rosterHc: Math.round(toNumber(row.roster_hc)),
      bufferPct: row.buffer_pct != null ? toNumber(row.buffer_pct) : null,
    });
  }

  return map;
}

async function getActiveHeadcountMap(processIds: string[], end: string): Promise<NumericMap> {
  const map = new Map<string, number>();
  if (processIds.length === 0) return map;

  const rows = await queryRows<RowDataPacket>(
    `SELECT
        e.process_id,
        COUNT(*) AS active_hc
      FROM employees e
      WHERE e.process_id IN (${placeholders(processIds)})
        AND COALESCE(e.active_status, 1) = 1
        AND (e.date_of_joining IS NULL OR e.date_of_joining <= ?)
        AND (e.date_of_exit IS NULL OR e.date_of_exit = '' OR e.date_of_exit >= ?)
        AND LOWER(COALESCE(e.employment_status, 'active')) <> 'inactive'
      GROUP BY e.process_id`,
    [...processIds, end, end]
  );

  for (const row of rows) {
    map.set(String(row.process_id), toNumber(row.active_hc));
  }

  return map;
}

async function getRevenueDailyMap(processIds: string[], start: string, end: string): Promise<Map<string, RevenueSnapshot>> {
  const map = new Map<string, RevenueSnapshot>();
  if (processIds.length === 0 || !(await tableExists("process_revenue_daily"))) return map;

  const rows = await queryRows<RowDataPacket>(
    `SELECT prd.*
       FROM process_revenue_daily prd
       JOIN (
         SELECT process_id, MAX(revenue_date) AS latest_date
           FROM process_revenue_daily
          WHERE process_id IN (${placeholders(processIds)})
            AND revenue_date BETWEEN ? AND ?
          GROUP BY process_id
       ) latest
         ON latest.process_id = prd.process_id
        AND latest.latest_date = prd.revenue_date`,
    [...processIds, start, end]
  );

  for (const row of rows) {
    map.set(String(row.process_id), {
      revenue: toNumber(row.actual_revenue_estimate),
      forecast: Math.max(toNumber(row.expected_revenue), toNumber(row.actual_revenue_estimate)),
      revenueAtRisk: toNumber(row.revenue_at_risk),
      billableHc: toNumber(row.available_hc),
      requiredHc: toNumber(row.required_hc),
      availableHc: toNumber(row.available_hc),
      freshness: maxDate(row.generated_at as string | null, row.revenue_date as string | null),
    });
  }

  return map;
}

async function getInvoiceMap(processIds: string[], start: string, end: string): Promise<Map<string, InvoiceMeta>> {
  const map = new Map<string, InvoiceMeta>();
  if (processIds.length === 0 || !(await tableExists("billing_invoice"))) return map;

  const rows = await queryRows<RowDataPacket>(
    `SELECT
        process_id,
        SUM(CASE WHEN status <> 'draft' THEN COALESCE(net_amount, 0) ELSE 0 END) AS recognized_revenue,
        SUM(CASE WHEN status <> 'draft' THEN COALESCE(net_amount, 0) ELSE 0 END) AS invoiced_revenue,
        SUM(CASE WHEN status = 'paid' THEN COALESCE(net_amount, 0) ELSE 0 END) AS collected_revenue,
        SUM(CASE WHEN status <> 'paid' AND status <> 'draft' THEN COALESCE(net_amount, 0) ELSE 0 END) AS outstanding_revenue,
        SUM(COALESCE(adjustments, 0)) AS adjustments,
        COUNT(*) AS invoice_count,
        MAX(COALESCE(paid_at, sent_at, created_at)) AS freshness
      FROM billing_invoice
      WHERE process_id IN (${placeholders(processIds)})
        AND period_from <= ?
        AND period_to >= ?
      GROUP BY process_id`,
    [...processIds, end, start]
  );

  for (const row of rows) {
    map.set(String(row.process_id), {
      invoicedRevenue: toNumber(row.invoiced_revenue),
      recognizedRevenue: toNumber(row.recognized_revenue),
      collectedRevenue: toNumber(row.collected_revenue),
      outstandingRevenue: toNumber(row.outstanding_revenue),
      invoiceCount: toNumber(row.invoice_count),
      adjustments: toNumber(row.adjustments),
      freshness: (row.freshness as string | null) ?? null,
    });
  }

  return map;
}

async function getPayrollMap(processIds: string[], period: string, end: string): Promise<Map<string, PayrollMeta>> {
  const map = new Map<string, PayrollMeta>();
  if (processIds.length === 0 || !(await tableExists("salary_prep_run")) || !(await tableExists("salary_prep_line"))) {
    return map;
  }

  const salaryColumns = await listColumns("salary_prep_line");
  const grossExpr = salaryColumns.has("gross_salary") ? "COALESCE(spl.gross_salary, 0)" : "0";
  const pfExpr = salaryColumns.has("pf_employer") ? "COALESCE(spl.pf_employer, 0)" : "0";
  const esicExpr = salaryColumns.has("esic_employer") ? "COALESCE(spl.esic_employer, 0)" : "0";
  const gratuityExpr = salaryColumns.has("gratuity")
    ? "COALESCE(spl.gratuity, 0)"
    : (salaryColumns.has("basic") ? "COALESCE(spl.basic, 0) * 0.0481" : "0");

  const runRows = await queryRows<RowDataPacket>(
    `SELECT id, run_month, status, created_at
       FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [period]
  );

  if (runRows.length > 0) {
    const runId = String(runRows[0].id);
    const rows = await queryRows<RowDataPacket>(
      `SELECT
          e.process_id,
          COUNT(DISTINCT spl.employee_id) AS headcount,
          SUM(${grossExpr}) AS gross_total,
          SUM(${pfExpr}) AS pf_employer_total,
          SUM(${esicExpr}) AS esic_employer_total,
          SUM(${gratuityExpr}) AS gratuity_total,
          SUM(${grossExpr} + ${pfExpr} + ${esicExpr} + ${gratuityExpr}) AS loaded_total
        FROM salary_prep_line spl
        JOIN employees e ON e.id = spl.employee_id
        WHERE spl.run_id = ?
          AND e.process_id IN (${placeholders(processIds)})
        GROUP BY e.process_id`,
      [runId, ...processIds]
    );

    for (const row of rows) {
      map.set(String(row.process_id), {
        total: toNumber(row.loaded_total),
        gross: toNumber(row.gross_total),
        pfEmployer: toNumber(row.pf_employer_total),
        esicEmployer: toNumber(row.esic_employer_total),
        gratuity: toNumber(row.gratuity_total),
        headcount: toNumber(row.headcount),
        status: "actual",
        runId,
        freshness: (runRows[0].created_at as string | null) ?? null,
      });
    }

    return map;
  }

  if (!(await tableExists("employee_salary_assignment"))) return map;

  const rows = await queryRows<RowDataPacket>(
    `SELECT
        e.process_id,
        COUNT(DISTINCT esa.employee_id) AS headcount,
        SUM(COALESCE(esa.ctc_annual, 0) / 12) AS estimated_total
      FROM employee_salary_assignment esa
      JOIN employees e ON e.id = esa.employee_id
      WHERE e.process_id IN (${placeholders(processIds)})
        AND COALESCE(e.active_status, 1) = 1
        AND esa.effective_from <= ?
        AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
        AND esa.id = (
          SELECT esa2.id
            FROM employee_salary_assignment esa2
           WHERE esa2.employee_id = esa.employee_id
             AND esa2.effective_from <= ?
             AND (esa2.effective_to IS NULL OR esa2.effective_to >= ?)
           ORDER BY esa2.effective_from DESC
           LIMIT 1
        )
      GROUP BY e.process_id`,
    [...processIds, end, `${period}-01`, end, `${period}-01`]
  );

  for (const row of rows) {
    map.set(String(row.process_id), {
      total: toNumber(row.estimated_total),
      gross: toNumber(row.estimated_total),
      pfEmployer: 0,
      esicEmployer: 0,
      gratuity: 0,
      headcount: toNumber(row.headcount),
      status: "forecast",
      runId: null,
      freshness: null,
    });
  }

  return map;
}

async function getExpenseMap(processIds: string[], start: string, end: string): Promise<Map<string, ExpenseMeta>> {
  const map = new Map<string, ExpenseMeta>();
  if (
    processIds.length === 0 ||
    !(await tableExists("expense_claims")) ||
    !(await tableExists("expense_items"))
  ) {
    return map;
  }

  const rows = await queryRows<RowDataPacket>(
    `SELECT
        ec.process_id,
        SUM(CASE WHEN ec.status IN ('FINANCE_APPROVED', 'PAID') THEN COALESCE(ei.amount, 0) ELSE 0 END) AS approved_amount,
        SUM(CASE WHEN ec.status IN ('SUBMITTED', 'MANAGER_APPROVED') THEN COALESCE(ei.amount, 0) ELSE 0 END) AS accrual_amount,
        COUNT(ei.id) AS item_count,
        MAX(COALESCE(ec.finance_approved_date, ec.updated_at, ec.created_at)) AS freshness
      FROM expense_claims ec
      JOIN expense_items ei ON ei.expense_claim_id = ec.id
      WHERE CAST(ec.process_id AS CHAR) IN (${placeholders(processIds)})
        AND ei.expense_date BETWEEN ? AND ?
      GROUP BY ec.process_id`,
    [...processIds, start, end]
  );

  for (const row of rows) {
    map.set(String(row.process_id), {
      approvedAmount: toNumber(row.approved_amount),
      accrualAmount: toNumber(row.accrual_amount),
      itemCount: toNumber(row.item_count),
      freshness: (row.freshness as string | null) ?? null,
    });
  }

  return map;
}

async function getIndirectAllocationMap(
  processes: ProcessBaseRow[],
  activeHeadcount: NumericMap,
  start: string,
  end: string
): Promise<Map<string, IndirectAllocationMeta>> {
  const map = new Map<string, IndirectAllocationMeta>();
  if (processes.length === 0) return map;

  const branchProcessMap = new Map<string, ProcessBaseRow[]>();
  const branchHeadcount = new Map<string, number>();
  for (const process of processes) {
    const branchId = process.branch_id ?? "unassigned";
    const rows = branchProcessMap.get(branchId) ?? [];
    rows.push(process);
    branchProcessMap.set(branchId, rows);
    branchHeadcount.set(branchId, (branchHeadcount.get(branchId) ?? 0) + (activeHeadcount.get(process.process_id) ?? 0));
  }

  const branchIds = Array.from(branchProcessMap.keys()).filter((id) => id !== "unassigned");
  const poolByBranch = new Map<string, number>();

  if (branchIds.length > 0 && await tableExists("vendor_payment_tracking")) {
    const rows = await queryRows<RowDataPacket>(
      `SELECT branch_id, SUM(COALESCE(due_amount, 0)) AS pool_amount
         FROM vendor_payment_tracking
        WHERE branch_id IN (${placeholders(branchIds)})
          AND due_date BETWEEN ? AND ?
        GROUP BY branch_id`,
      [...branchIds, start, end]
    );
    for (const row of rows) {
      poolByBranch.set(String(row.branch_id), toNumber(row.pool_amount));
    }
  } else if (branchIds.length > 0 && await tableExists("grn_request")) {
    const rows = await queryRows<RowDataPacket>(
      `SELECT branch_id, SUM(COALESCE(amount, 0)) AS pool_amount
         FROM grn_request
        WHERE branch_id IN (${placeholders(branchIds)})
          AND status = 'approved'
          AND COALESCE(due_date, bill_date, created_at) BETWEEN ? AND ?
        GROUP BY branch_id`,
      [...branchIds, start, end]
    );
    for (const row of rows) {
      poolByBranch.set(String(row.branch_id), toNumber(row.pool_amount));
    }
  }

  for (const [branchId, branchProcesses] of branchProcessMap.entries()) {
    const pool = poolByBranch.get(branchId) ?? 0;
    const totalHc = branchHeadcount.get(branchId) ?? 0;
    const evenShare = branchProcesses.length > 0 ? pool / branchProcesses.length : 0;

    for (const process of branchProcesses) {
      const hc = activeHeadcount.get(process.process_id) ?? 0;
      const allocation = totalHc > 0 ? (pool * hc) / totalHc : evenShare;
      map.set(process.process_id, {
        allocatedAmount: allocation,
        branchPoolAmount: pool,
      });
    }
  }

  return map;
}

function buildRecord(
  process: ProcessBaseRow,
  contracts: Map<string, ContractMeta>,
  workforce: Map<string, WorkforceMeta>,
  activeHeadcount: NumericMap,
  revenueDaily: Map<string, RevenueSnapshot>,
  invoices: Map<string, InvoiceMeta>,
  payroll: Map<string, PayrollMeta>,
  expenses: Map<string, ExpenseMeta>,
  indirectAllocations: Map<string, IndirectAllocationMeta>
): ProcessPnlRecord {
  const contract = contracts.get(process.process_id);
  const workforceMeta = workforce.get(process.process_id);
  const revenue = revenueDaily.get(process.process_id);
  const invoice = invoices.get(process.process_id);
  const payrollMeta = payroll.get(process.process_id);
  const expense = expenses.get(process.process_id);
  const indirect = indirectAllocations.get(process.process_id);

  const activeHc = activeHeadcount.get(process.process_id) ?? 0;
  const billableHc = revenue?.billableHc ?? activeHc;
  const requiredProductiveHc = workforceMeta?.productiveHc ?? revenue?.requiredHc ?? activeHc;
  const requiredRosterHc = workforceMeta?.rosterHc ?? requiredProductiveHc;
  const actualBufferPct = requiredRosterHc > 0 ? ((activeHc - requiredRosterHc) / requiredRosterHc) * 100 : null;

  const revenueMtd = invoice?.recognizedRevenue && invoice.recognizedRevenue > 0
    ? invoice.recognizedRevenue
    : revenue?.revenue ?? 0;
  const revenueForecast = Math.max(
    revenue?.forecast ?? 0,
    invoice?.recognizedRevenue ?? 0,
    revenueMtd
  );
  const salaryMtd = payrollMeta?.gross ?? 0;
  const directPeopleCost = payrollMeta?.total ?? 0;
  const directNonPeopleCost = expense?.approvedAmount ?? 0;
  const directCost = directPeopleCost + directNonPeopleCost;
  const indirectCost = indirect?.allocatedAmount ?? 0;
  const totalCost = directCost + indirectCost;
  const contributionMargin = revenueMtd - directCost;
  const operatingProfit = revenueMtd - totalCost;
  const operatingMarginPct = revenueMtd > 0 ? (operatingProfit / revenueMtd) * 100 : null;
  const revenueAtRisk = (revenue?.revenueAtRisk ?? 0) + Math.max(0, invoice?.outstandingRevenue ?? 0);
  const monthEndProjectedProfit = revenueForecast - totalCost;
  const financialStatus: "actual" | "forecast" | "mixed" =
    (invoice?.recognizedRevenue ?? 0) > 0 && payrollMeta?.status === "actual"
      ? "actual"
      : payrollMeta?.status === "forecast"
      ? "forecast"
      : "mixed";

  return {
    processId: process.process_id,
    processName: process.process_name,
    clientId: process.client_id,
    clientName: process.client_name,
    branchId: process.branch_id,
    branchName: process.branch_name,
    billingModel: contract?.billingModel ?? null,
    contractedSeats: contract?.contractedSeats ?? workforceMeta?.rosterHc ?? null,
    billableHc,
    requiredProductiveHc,
    requiredRosterHc,
    activeHc,
    deployedHc: revenue?.availableHc ?? activeHc,
    bufferTargetPct: workforceMeta?.bufferPct ?? null,
    actualBufferPct,
    revenueMtd,
    revenueForecast,
    invoicedRevenueMtd: invoice?.invoicedRevenue ?? revenueMtd,
    collectedRevenueMtd: invoice?.collectedRevenue ?? 0,
    outstandingReceivable: invoice?.outstandingRevenue ?? 0,
    salaryMtd,
    directPeopleCost,
    directNonPeopleCost,
    directCost,
    indirectCost,
    totalCost,
    contributionMargin,
    operatingProfit,
    operatingMarginPct,
    budgetVariance: null,
    revenueAtRisk,
    monthEndProjectedProfit,
    reconciliationStatus: reconciliationStatus({
      revenue: revenueMtd,
      payroll: directPeopleCost,
      hasContract: Boolean(contract),
    }),
    financialStatus,
    processStatus: statusFromProfit({ operatingProfit, operatingMarginPct, revenueAtRisk }),
    freshness: maxDate(
      revenue?.freshness,
      invoice?.freshness,
      payrollMeta?.freshness,
      expense?.freshness
    ),
  };
}

async function buildComputationContext(filters: Partial<PnlQueryFilters>): Promise<ProcessPnlComputationContext> {
  const normalizedFilters: PnlQueryFilters = {
    period: filters.period && /^\d{4}-\d{2}$/.test(filters.period) ? filters.period : defaultPeriod(),
    branchId: filters.branchId,
    processId: filters.processId,
    clientId: filters.clientId,
    search: filters.search,
  };
  const { start, end } = monthRange(normalizedFilters.period);
  const processes = await getBaseProcesses(normalizedFilters);
  const processIds = processes.map((process) => process.process_id);

  const [
    contracts,
    workforce,
    activeHeadcount,
    revenueDaily,
    invoices,
    payroll,
    expenses,
  ] = await Promise.all([
    getContractMap(processIds, normalizedFilters.period),
    getWorkforceMap(processIds, start, end),
    getActiveHeadcountMap(processIds, end),
    getRevenueDailyMap(processIds, start, end),
    getInvoiceMap(processIds, start, end),
    getPayrollMap(processIds, normalizedFilters.period, end),
    getExpenseMap(processIds, start, end),
  ]);

  const indirectAllocations = await getIndirectAllocationMap(processes, activeHeadcount, start, end);

  return {
    filters: normalizedFilters,
    processes,
    contracts,
    workforce,
    activeHeadcount,
    revenueDaily,
    invoices,
    payroll,
    expenses,
    indirectAllocations,
    generatedAt: new Date().toISOString(),
  };
}

async function buildTrend(processId: string | null, filters: PnlQueryFilters) {
  const months = Array.from({ length: 6 }, (_, index) => shiftMonth(filters.period, index - 5));
  const series: Array<{
    month: string;
    revenue: number;
    directCost: number;
    indirectCost: number;
    operatingProfit: number;
  }> = [];

  const processClause = processId ? "AND process_id = ?" : "";
  const processJoinClause = processId ? "AND e.process_id = ?" : "";
  const expenseProcessClause = processId ? "AND CAST(ec.process_id AS CHAR) = ?" : "";
  const branchFilters = filters.branchId ? [filters.branchId] : [];

  for (const month of months) {
    const { start, end } = monthRange(month);
    const revenueRows = await queryRows<RowDataPacket>(
      await tableExists("billing_invoice")
        ? `SELECT SUM(CASE WHEN status <> 'draft' THEN COALESCE(net_amount, 0) ELSE 0 END) AS total
             FROM billing_invoice
            WHERE period_from <= ? AND period_to >= ? ${processClause}`
        : `SELECT SUM(COALESCE(actual_revenue_estimate, 0)) AS total
             FROM process_revenue_daily
            WHERE revenue_date BETWEEN ? AND ? ${processClause}`,
      processId ? [end, start, processId] : [end, start]
    );

    const salaryColumns = await listColumns("salary_prep_line");
    const grossExpr = salaryColumns.has("gross_salary") ? "COALESCE(spl.gross_salary, 0)" : "0";
    const pfExpr = salaryColumns.has("pf_employer") ? "COALESCE(spl.pf_employer, 0)" : "0";
    const esicExpr = salaryColumns.has("esic_employer") ? "COALESCE(spl.esic_employer, 0)" : "0";
    const gratuityExpr = salaryColumns.has("gratuity")
      ? "COALESCE(spl.gratuity, 0)"
      : (salaryColumns.has("basic") ? "COALESCE(spl.basic, 0) * 0.0481" : "0");

    const payrollRows = await queryRows<RowDataPacket>(
      `SELECT SUM(${grossExpr} + ${pfExpr} + ${esicExpr} + ${gratuityExpr}) AS total
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id
         JOIN employees e ON e.id = spl.employee_id
        WHERE spr.run_month = ? ${processJoinClause}`,
      processId ? [month, processId] : [month]
    ).catch(() => [{ total: 0 } as RowDataPacket]);

    const expenseRows = await queryRows<RowDataPacket>(
      await tableExists("expense_claims") && await tableExists("expense_items")
        ? `SELECT SUM(CASE WHEN ec.status IN ('FINANCE_APPROVED', 'PAID') THEN COALESCE(ei.amount, 0) ELSE 0 END) AS total
             FROM expense_claims ec
             JOIN expense_items ei ON ei.expense_claim_id = ec.id
            WHERE ei.expense_date BETWEEN ? AND ? ${expenseProcessClause}`
        : `SELECT 0 AS total`,
      processId ? [start, end, processId] : [start, end]
    ).catch(() => [{ total: 0 } as RowDataPacket]);

    let indirectTotal = 0;
    if (await tableExists("vendor_payment_tracking")) {
      const indirectRows = await queryRows<RowDataPacket>(
        `SELECT SUM(COALESCE(due_amount, 0)) AS total
           FROM vendor_payment_tracking
          WHERE due_date BETWEEN ? AND ?`,
        [start, end]
      );
      indirectTotal = toNumber(indirectRows[0]?.total);
    } else if (await tableExists("grn_request")) {
      const indirectRows = await queryRows<RowDataPacket>(
        `SELECT SUM(COALESCE(amount, 0)) AS total
           FROM grn_request
          WHERE status = 'approved'
            AND COALESCE(due_date, bill_date, created_at) BETWEEN ? AND ?`,
        [start, end]
      );
      indirectTotal = toNumber(indirectRows[0]?.total);
    }

    if (processId) {
      const monthlyContext = await buildComputationContext({ ...filters, period: month, processId });
      const monthlyRecord = monthlyContext.processes
        .map((process) =>
          buildRecord(
            process,
            monthlyContext.contracts,
            monthlyContext.workforce,
            monthlyContext.activeHeadcount,
            monthlyContext.revenueDaily,
            monthlyContext.invoices,
            monthlyContext.payroll,
            monthlyContext.expenses,
            monthlyContext.indirectAllocations
          )
        )
        .find((record) => record.processId === processId);

      series.push({
        month,
        revenue: monthlyRecord?.revenueMtd ?? toNumber(revenueRows[0]?.total),
        directCost: monthlyRecord?.directCost ?? (toNumber(payrollRows[0]?.total) + toNumber(expenseRows[0]?.total)),
        indirectCost: monthlyRecord?.indirectCost ?? 0,
        operatingProfit: monthlyRecord?.operatingProfit
          ?? (toNumber(revenueRows[0]?.total) - toNumber(payrollRows[0]?.total) - toNumber(expenseRows[0]?.total)),
      });
      continue;
    }

    const directCost = toNumber(payrollRows[0]?.total) + toNumber(expenseRows[0]?.total);
    const revenue = toNumber(revenueRows[0]?.total);
    series.push({
      month,
      revenue,
      directCost,
      indirectCost: indirectTotal,
      operatingProfit: revenue - directCost - indirectTotal,
    });
  }

  return series;
}

function buildAlerts(records: ProcessPnlRecord[]): PnlSummaryResponse["alerts"] {
  const alerts: PnlSummaryResponse["alerts"] = [];

  for (const record of records) {
    if (record.processStatus === "loss-making") {
      alerts.push({
        type: "critical",
        title: `${record.processName} is loss-making`,
        detail: `Operating loss of Rs ${Math.round(Math.abs(record.operatingProfit)).toLocaleString("en-IN")} in ${record.processId}.`,
        processId: record.processId,
        processName: record.processName,
        impact: record.operatingProfit,
      });
    }
    if (record.revenueAtRisk > 0) {
      alerts.push({
        type: "warning",
        title: `${record.processName} has revenue at risk`,
        detail: `Risk exposure of Rs ${Math.round(record.revenueAtRisk).toLocaleString("en-IN")} with outstanding or shortage-driven leakage.`,
        processId: record.processId,
        processName: record.processName,
        impact: record.revenueAtRisk,
      });
    }
    if (record.reconciliationStatus !== "matched") {
      alerts.push({
        type: "info",
        title: `${record.processName} needs reconciliation`,
        detail: `Commercial, payroll, or billing inputs are incomplete for the selected month.`,
        processId: record.processId,
        processName: record.processName,
      });
    }
  }

  return alerts
    .sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0))
    .slice(0, 8);
}

async function buildRecords(filters: Partial<PnlQueryFilters>): Promise<{
  context: ProcessPnlComputationContext;
  records: ProcessPnlRecord[];
}> {
  const context = await buildComputationContext(filters);
  const records = context.processes.map((process) =>
    buildRecord(
      process,
      context.contracts,
      context.workforce,
      context.activeHeadcount,
      context.revenueDaily,
      context.invoices,
      context.payroll,
      context.expenses,
      context.indirectAllocations
    )
  );

  records.sort((left, right) => right.operatingProfit - left.operatingProfit);
  return { context, records };
}

async function getProcessRecord(processId: string, filters: Partial<PnlQueryFilters>) {
  const { context, records } = await buildRecords({ ...filters, processId });
  const record = records.find((item) => item.processId === processId);
  if (!record) {
    throw Object.assign(new Error("Process P&L record not found"), { statusCode: 404 });
  }
  return { context, record };
}

export const processPnlService = {
  async getSummary(filters: Partial<PnlQueryFilters>): Promise<PnlSummaryResponse> {
    const { context, records } = await buildRecords(filters);
    const organisationRevenue = records.reduce((sum, record) => sum + record.revenueMtd, 0);
    const totalDirectCost = records.reduce((sum, record) => sum + record.directCost, 0);
    const totalIndirectCost = records.reduce((sum, record) => sum + record.indirectCost, 0);
    const operatingProfit = records.reduce((sum, record) => sum + record.operatingProfit, 0);
    const mostProfitable = records[0]
      ? { processId: records[0].processId, processName: records[0].processName, value: records[0].operatingProfit }
      : null;
    const trend = await buildTrend(null, context.filters);

    return {
      period: context.filters.period,
      filters: {
        branchId: context.filters.branchId,
        processId: context.filters.processId,
        clientId: context.filters.clientId,
        search: context.filters.search,
      },
      kpis: {
        organisationRevenue,
        totalDirectCost,
        totalIndirectCost,
        operatingProfit,
        operatingMarginPct: organisationRevenue > 0 ? (operatingProfit / organisationRevenue) * 100 : null,
        mostProfitableProcess: mostProfitable,
        lossMakingProcesses: records.filter((record) => record.processStatus === "loss-making").length,
        revenueAtRisk: records.reduce((sum, record) => sum + record.revenueAtRisk, 0),
        monthEndProjectedProfit: records.reduce((sum, record) => sum + record.monthEndProjectedProfit, 0),
        billableHeadcount: records.reduce((sum, record) => sum + record.billableHc, 0),
        activeHeadcount: records.reduce((sum, record) => sum + record.activeHc, 0),
      },
      alerts: buildAlerts(records),
      trend,
      generatedAt: context.generatedAt,
    };
  },

  async listProcesses(filters: Partial<PnlQueryFilters>) {
    const { records } = await buildRecords(filters);
    return records;
  },

  async getOverview(processId: string, filters: Partial<PnlQueryFilters>) {
    const { context, record } = await getProcessRecord(processId, filters);
    const topPositiveContributors = [
      { label: "Recognized revenue", value: record.revenueMtd },
      { label: "Collected revenue", value: record.collectedRevenueMtd },
      { label: "Contribution margin", value: record.contributionMargin },
    ]
      .sort((left, right) => right.value - left.value)
      .slice(0, 3);
    const topNegativeContributors = [
      { label: "Direct people cost", value: record.directPeopleCost },
      { label: "Direct non-people cost", value: record.directNonPeopleCost },
      { label: "Indirect allocation", value: record.indirectCost },
      { label: "Revenue at risk", value: record.revenueAtRisk },
    ]
      .sort((left, right) => right.value - left.value)
      .slice(0, 4);

    return {
      period: context.filters.period,
      ...record,
      topPositiveContributors,
      topNegativeContributors,
    };
  },

  async getRevenue(processId: string, filters: Partial<PnlQueryFilters>) {
    const { context, record } = await getProcessRecord(processId, filters);
    const { start, end } = monthRange(context.filters.period);

    const invoices = await queryRows<RowDataPacket>(
      await tableExists("billing_invoice")
        ? `SELECT
            id,
            invoice_ref,
            period_from,
            period_to,
            billable_units,
            rate,
            gross_amount,
            adjustments,
            net_amount,
            gst_amount,
            total_amount,
            status,
            sent_at,
            paid_at,
            created_at
           FROM billing_invoice
          WHERE process_id = ?
            AND period_from <= ?
            AND period_to >= ?
          ORDER BY created_at DESC`
        : `SELECT NULL AS id, NULL AS invoice_ref, NULL AS period_from, NULL AS period_to,
                  0 AS billable_units, 0 AS rate, 0 AS gross_amount, 0 AS adjustments,
                  0 AS net_amount, 0 AS gst_amount, 0 AS total_amount, NULL AS status,
                  NULL AS sent_at, NULL AS paid_at, NULL AS created_at
           WHERE 1 = 0`,
      [processId, end, start]
    ).catch(() => []);

    const contract = await queryRows<RowDataPacket>(
      await tableExists("client_contract_master")
        ? `SELECT contract_name, billing_type, billing_rate, currency, monthly_minimum_commitment,
                  effective_from, effective_to, status
             FROM client_contract_master
            WHERE process_id = ?
              AND effective_from <= ?
              AND (effective_to IS NULL OR effective_to >= ?)
            ORDER BY effective_from DESC
            LIMIT 1`
        : `SELECT NULL AS contract_name, NULL AS billing_type, NULL AS billing_rate,
                  NULL AS currency, NULL AS monthly_minimum_commitment,
                  NULL AS effective_from, NULL AS effective_to, NULL AS status
           WHERE 1 = 0`,
      [processId, end, start]
    ).catch(() => []);

    return {
      period: context.filters.period,
      summary: {
        recognizedRevenue: record.revenueMtd,
        invoicedRevenue: record.invoicedRevenueMtd,
        collectedRevenue: record.collectedRevenueMtd,
        outstandingReceivable: record.outstandingReceivable,
        revenueAtRisk: record.revenueAtRisk,
        forecastRevenue: record.revenueForecast,
      },
      contract: contract[0] ?? null,
      invoices,
    };
  },

  async getWorkforce(processId: string, filters: Partial<PnlQueryFilters>) {
    const { context, record } = await getProcessRecord(processId, filters);

    const employees = await queryRows<RowDataPacket>(
      `SELECT
          e.id,
          e.employee_code,
          e.full_name,
          d.designation_name,
          e.date_of_joining,
          e.date_of_exit,
          e.employment_status
        FROM employees e
        LEFT JOIN designation_master d ON d.id = e.designation_id
        WHERE e.process_id = ?
          AND COALESCE(e.active_status, 1) = 1
        ORDER BY e.full_name
        LIMIT 250`,
      [processId]
    ).catch(() => []);

    return {
      period: context.filters.period,
      metrics: {
        requiredProductiveHc: record.requiredProductiveHc,
        requiredRosterHc: record.requiredRosterHc,
        activeHc: record.activeHc,
        deployedHc: record.deployedHc,
        billableHc: record.billableHc,
        plannedBufferPct: record.bufferTargetPct,
        actualBufferPct: record.actualBufferPct,
      },
      employees,
    };
  },

  async getPeopleCost(processId: string, filters: Partial<PnlQueryFilters>) {
    const { context, record } = await getProcessRecord(processId, filters);

    const hasRuns = await tableExists("salary_prep_run") && await tableExists("salary_prep_line");
    const columns = hasRuns ? await listColumns("salary_prep_line") : new Set<string>();
    const basicExpr = columns.has("basic") ? "COALESCE(spl.basic, 0)" : "0";
    const grossExpr = columns.has("gross_salary") ? "COALESCE(spl.gross_salary, 0)" : "0";
    const pfExpr = columns.has("pf_employer") ? "COALESCE(spl.pf_employer, 0)" : "0";
    const esicExpr = columns.has("esic_employer") ? "COALESCE(spl.esic_employer, 0)" : "0";
    const gratuityExpr = columns.has("gratuity")
      ? "COALESCE(spl.gratuity, 0)"
      : (columns.has("basic") ? "COALESCE(spl.basic, 0) * 0.0481" : "0");
    const incentiveExpr = columns.has("incentive_total") ? "COALESCE(spl.incentive_total, 0)" : "0";
    const overtimeExpr = columns.has("overtime_pay") ? "COALESCE(spl.overtime_pay, 0)" : "0";

    let rows: RowDataPacket[] = [];

    if (hasRuns) {
      rows = await queryRows<RowDataPacket>(
        `SELECT id
           FROM salary_prep_run
          WHERE run_month = ?
          ORDER BY created_at DESC
          LIMIT 1`,
        [context.filters.period]
      );
    }

    if (rows.length > 0) {
      const runId = String(rows[0].id);
      const peopleRows = await queryRows<RowDataPacket>(
        `SELECT
            e.id AS employee_id,
            e.employee_code,
            e.full_name,
            d.designation_name,
            ${basicExpr} AS basic_salary,
            ${grossExpr} AS gross_salary,
            ${pfExpr} AS pf_employer,
            ${esicExpr} AS esic_employer,
            ${gratuityExpr} AS gratuity,
            ${incentiveExpr} AS incentive,
            ${overtimeExpr} AS overtime,
            (${grossExpr} + ${pfExpr} + ${esicExpr} + ${gratuityExpr}) AS loaded_cost
          FROM salary_prep_line spl
          JOIN employees e ON e.id = spl.employee_id
          LEFT JOIN designation_master d ON d.id = e.designation_id
          WHERE spl.run_id = ?
            AND e.process_id = ?
          ORDER BY loaded_cost DESC
          LIMIT 250`,
        [runId, processId]
      ).catch(() => []);

      return {
        period: context.filters.period,
        source: "salary_prep_line",
        summary: {
          directPeopleCost: record.directPeopleCost,
          salaryMtd: record.salaryMtd,
        },
        employees: peopleRows,
      };
    }

    const estimatedRows = await queryRows<RowDataPacket>(
      await tableExists("employee_salary_assignment")
        ? `SELECT
            e.id AS employee_id,
            e.employee_code,
            e.full_name,
            d.designation_name,
            ROUND(COALESCE(esa.ctc_annual, 0) / 12, 2) AS loaded_cost
           FROM employee_salary_assignment esa
           JOIN employees e ON e.id = esa.employee_id
           LEFT JOIN designation_master d ON d.id = e.designation_id
          WHERE e.process_id = ?
            AND COALESCE(e.active_status, 1) = 1
            AND esa.effective_from <= ?
            AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
          ORDER BY loaded_cost DESC
          LIMIT 250`
        : `SELECT NULL AS employee_id, NULL AS employee_code, NULL AS full_name, NULL AS designation_name, 0 AS loaded_cost WHERE 1 = 0`,
      [processId, `${context.filters.period}-28`, `${context.filters.period}-01`]
    ).catch(() => []);

    return {
      period: context.filters.period,
      source: "employee_salary_assignment",
      summary: {
        directPeopleCost: record.directPeopleCost,
        salaryMtd: record.salaryMtd,
      },
      employees: estimatedRows,
    };
  },

  async getDirectCost(processId: string, filters: Partial<PnlQueryFilters>) {
    const { context, record } = await getProcessRecord(processId, filters);
    const { start, end } = monthRange(context.filters.period);

    const expenses = await queryRows<RowDataPacket>(
      await tableExists("expense_claims") && await tableExists("expense_items")
        ? `SELECT
            ei.id,
            ei.expense_date,
            ei.amount,
            ei.description,
            ei.vendor_name,
            ec.claim_number,
            ec.status,
            cat.name AS category_name
           FROM expense_claims ec
           JOIN expense_items ei ON ei.expense_claim_id = ec.id
           LEFT JOIN expense_categories cat ON cat.id = ei.category_id
          WHERE CAST(ec.process_id AS CHAR) = ?
            AND ei.expense_date BETWEEN ? AND ?
          ORDER BY ei.expense_date DESC
          LIMIT 250`
        : `SELECT NULL AS id, NULL AS expense_date, 0 AS amount, NULL AS description,
                  NULL AS vendor_name, NULL AS claim_number, NULL AS status, NULL AS category_name
           WHERE 1 = 0`,
      [processId, start, end]
    ).catch(() => []);

    return {
      period: context.filters.period,
      summary: {
        directPeopleCost: record.directPeopleCost,
        directNonPeopleCost: record.directNonPeopleCost,
        directCost: record.directCost,
      },
      expenses,
    };
  },

  async getIndirectAllocation(processId: string, filters: Partial<PnlQueryFilters>) {
    const { context, record } = await getProcessRecord(processId, filters);
    const { start, end } = monthRange(context.filters.period);
    const branchId = record.branchId;

    const rows = branchId && await tableExists("vendor_payment_tracking")
      ? await queryRows<RowDataPacket>(
          `SELECT
              head,
              sub_head,
              SUM(COALESCE(due_amount, 0)) AS branch_pool_amount
            FROM vendor_payment_tracking
           WHERE branch_id = ?
             AND due_date BETWEEN ? AND ?
           GROUP BY head, sub_head
           ORDER BY branch_pool_amount DESC`,
          [branchId, start, end]
        ).catch(() => [])
      : branchId && await tableExists("grn_request")
      ? await queryRows<RowDataPacket>(
          `SELECT
              head,
              sub_head,
              SUM(COALESCE(amount, 0)) AS branch_pool_amount
            FROM grn_request
           WHERE branch_id = ?
             AND status = 'approved'
             AND COALESCE(due_date, bill_date, created_at) BETWEEN ? AND ?
           GROUP BY head, sub_head
           ORDER BY branch_pool_amount DESC`,
          [branchId, start, end]
        ).catch(() => [])
      : [];

    const branchPool = context.indirectAllocations.get(processId)?.branchPoolAmount ?? 0;
    const branchProcesses = context.processes.filter((item) => item.branch_id === branchId);
    const branchHeadcount = branchProcesses.reduce(
      (sum, item) => sum + (context.activeHeadcount.get(item.process_id) ?? 0),
      0
    );
    const processHeadcount = context.activeHeadcount.get(processId) ?? 0;
    const allocationPct = branchHeadcount > 0 ? (processHeadcount / branchHeadcount) * 100 : 0;

    return {
      period: context.filters.period,
      summary: {
        branchPoolAmount: branchPool,
        processAllocationAmount: record.indirectCost,
        processAllocationPct: allocationPct,
      },
      pools: rows.map((row) => ({
        category: row.head ?? "Shared overhead",
        subCategory: row.sub_head ?? null,
        branchPoolAmount: toNumber(row.branch_pool_amount),
        processAllocationPct: allocationPct,
        processAllocationAmount: toNumber(row.branch_pool_amount) * (allocationPct / 100),
      })),
    };
  },

  async getTrend(processId: string, filters: Partial<PnlQueryFilters>) {
    const { context } = await getProcessRecord(processId, filters);
    const trend = await buildTrend(processId, context.filters);
    return { period: context.filters.period, trend };
  },

  async getReconciliation(processId: string, filters: Partial<PnlQueryFilters>) {
    const { context, record } = await getProcessRecord(processId, filters);
    const issues: Array<{ severity: string; code: string; message: string }> = [];

    if (!context.contracts.has(processId)) {
      issues.push({
        severity: "critical",
        code: "MISSING_CONTRACT",
        message: "No active commercial contract or billing unit is configured for this process.",
      });
    }
    if ((context.invoices.get(processId)?.invoiceCount ?? 0) === 0 && record.revenueMtd <= 0) {
      issues.push({
        severity: "warning",
        code: "MISSING_REVENUE",
        message: "No invoice or recognized revenue was found in the selected month.",
      });
    }
    if ((context.payroll.get(processId)?.total ?? 0) <= 0) {
      issues.push({
        severity: "warning",
        code: "MISSING_PAYROLL",
        message: "Payroll actuals are missing; the page is using estimated people cost.",
      });
    }
    if (record.revenueAtRisk > 0) {
      issues.push({
        severity: "warning",
        code: "REVENUE_AT_RISK",
        message: `Revenue at risk is Rs ${Math.round(record.revenueAtRisk).toLocaleString("en-IN")} for this process.`,
      });
    }

    return {
      period: context.filters.period,
      status: record.reconciliationStatus,
      freshness: record.freshness,
      issues,
    };
  },

  async getLedger(processId: string, filters: Partial<PnlQueryFilters>) {
    const { context, record } = await getProcessRecord(processId, filters);
    const { start, end } = monthRange(context.filters.period);
    const entries: Array<Record<string, unknown>> = [];

    if (await tableExists("billing_invoice")) {
      const invoiceRows = await queryRows<RowDataPacket>(
        `SELECT invoice_ref, created_at, net_amount, status
           FROM billing_invoice
          WHERE process_id = ?
            AND period_from <= ?
            AND period_to >= ?`,
        [processId, end, start]
      ).catch(() => []);

      for (const row of invoiceRows) {
        entries.push({
          entryType: "revenue",
          reference: row.invoice_ref,
          entryDate: row.created_at,
          amount: toNumber(row.net_amount),
          status: row.status,
        });
      }
    }

    if (await tableExists("expense_claims") && await tableExists("expense_items")) {
      const expenseRows = await queryRows<RowDataPacket>(
        `SELECT ec.claim_number, ei.expense_date, ei.amount, ec.status
           FROM expense_claims ec
           JOIN expense_items ei ON ei.expense_claim_id = ec.id
          WHERE CAST(ec.process_id AS CHAR) = ?
            AND ei.expense_date BETWEEN ? AND ?`,
        [processId, start, end]
      ).catch(() => []);

      for (const row of expenseRows) {
        entries.push({
          entryType: "direct_cost",
          reference: row.claim_number,
          entryDate: row.expense_date,
          amount: toNumber(row.amount),
          status: row.status,
        });
      }
    }

    entries.push({
      entryType: "indirect_allocation",
      reference: `${record.branchName ?? "Branch"} shared overhead`,
      entryDate: end,
      amount: record.indirectCost,
      status: "allocated",
    });

    entries.sort((left, right) => String(right.entryDate).localeCompare(String(left.entryDate)));

    return {
      period: context.filters.period,
      summary: {
        revenue: record.revenueMtd,
        directCost: record.directCost,
        indirectCost: record.indirectCost,
        operatingProfit: record.operatingProfit,
      },
      entries,
    };
  },

  async getDetailBundle(processId: string, filters: Partial<PnlQueryFilters>): Promise<ProcessPnlDetailBundle> {
    const [overview, revenue, workforce, peopleCost, directCost, indirectAllocation, trend, reconciliation, ledger] =
      await Promise.all([
        this.getOverview(processId, filters),
        this.getRevenue(processId, filters),
        this.getWorkforce(processId, filters),
        this.getPeopleCost(processId, filters),
        this.getDirectCost(processId, filters),
        this.getIndirectAllocation(processId, filters),
        this.getTrend(processId, filters),
        this.getReconciliation(processId, filters),
        this.getLedger(processId, filters),
      ]);

    return {
      record: overview as ProcessPnlRecord,
      overview,
      revenue,
      workforce,
      peopleCost,
      directCost,
      indirectAllocation,
      trend,
      reconciliation,
      ledger,
    };
  },

  async exportCsv(filters: Partial<PnlQueryFilters>) {
    const records = await this.listProcesses(filters);
    const headers = [
      "Process",
      "Client",
      "Branch",
      "Billing Model",
      "Billable HC",
      "Required HC",
      "Active HC",
      "Revenue MTD",
      "Direct Cost",
      "Indirect Cost",
      "Operating Profit",
      "OP Margin %",
      "Revenue At Risk",
      "Reconciliation",
      "Freshness",
    ];

    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      headers.map(escape).join(","),
      ...records.map((record) =>
        [
          record.processName,
          record.clientName ?? "",
          record.branchName ?? "",
          record.billingModel ?? "",
          record.billableHc,
          record.requiredRosterHc,
          record.activeHc,
          record.revenueMtd.toFixed(2),
          record.directCost.toFixed(2),
          record.indirectCost.toFixed(2),
          record.operatingProfit.toFixed(2),
          record.operatingMarginPct?.toFixed(2) ?? "",
          record.revenueAtRisk.toFixed(2),
          record.reconciliationStatus,
          record.freshness ?? "",
        ].map(escape).join(",")
      ),
    ];

    return rows.join("\n");
  },
};
