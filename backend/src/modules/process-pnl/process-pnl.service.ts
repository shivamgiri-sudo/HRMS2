import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import { getInvoicedRevenueActuals, OWN_COMPANY_SQL } from "./pnl-actuals.service.js";
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
  billingRate: number | null;
  contractedSeats: number | null;
  rateSource: "process_billing_rate" | "client_contract_master" | "billing_unit" | "missing" | "overlap_exception";
  rateType: string | null;
  unit: string | null;
  effectiveFrom: string | null;
  approvalReference: string | null;
  configurationStatus: "approved" | "fallback" | "missing" | "overlap_exception";
  overlapException: boolean;
}

interface WorkforceMeta {
  productiveHc: number;
  rosterHc: number;
  bufferPct: number | null;
}

interface MonthlyPlanMeta {
  contractedSeats: number | null;
  requiredProductiveHc: number | null;
  requiredRosterHc: number | null;
  bufferTargetPct: number | null;
  revenueBudget: number | null;
  directCostBudget: number | null;
  indirectCostBudget: number | null;
  profitBudget: number | null;
  status: string | null;
}

interface RevenueSnapshot {
  revenue: number;
  forecast: number;
  revenueAtRisk: number;
  billableHc: number | null;
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

interface VendorCostMeta {
  approvedAmount: number;
  itemCount: number;
  freshness: string | null;
}

interface IndirectAllocationMeta {
  allocatedAmount: number;
  branchPoolAmount: number;
}

interface AdjustmentMeta {
  revenue: number;
  directPeopleCost: number;
  directNonPeopleCost: number;
  indirectCost: number;
  operatingProfit: number;
}

interface ProcessPnlComputationContext {
  filters: PnlQueryFilters;
  processes: ProcessBaseRow[];
  contracts: Map<string, ContractMeta>;
  workforce: Map<string, WorkforceMeta>;
  monthlyPlans: Map<string, MonthlyPlanMeta>;
  activeHeadcount: NumericMap;
  revenueDaily: Map<string, RevenueSnapshot>;
  invoices: Map<string, InvoiceMeta>;
  payroll: Map<string, PayrollMeta>;
  expenses: Map<string, ExpenseMeta>;
  vendorDirectCosts: Map<string, VendorCostMeta>;
  indirectAllocations: Map<string, IndirectAllocationMeta>;
  approvedAdjustments: Map<string, AdjustmentMeta>;
  generatedAt: string;
}

interface TrendPoint {
  month: string;
  revenue: number;
  directCost: number;
  indirectCost: number;
  operatingProfit: number;
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

function buildMonthSeries(months: string[]) {
  return months.map((month) => {
    const { start, end } = monthRange(month);
    return { month, start, end };
  });
}

function monthSeriesSql(months: string[]) {
  return months.map(() => "SELECT ? AS month_key, ? AS start_date, ? AS end_date").join(" UNION ALL ");
}

function monthSeriesParams(months: string[]) {
  return buildMonthSeries(months).flatMap((month) => [month.month, month.start, month.end]);
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
  const columns = await listColumns(tableName);
  return columns.has(columnName);
}

const columnListCache = new Map<string, Promise<Set<string>>>();

async function listColumns(tableName: string): Promise<Set<string>> {
  if (!columnListCache.has(tableName)) {
    columnListCache.set(
      tableName,
      queryRows<RowDataPacket>(
        `SELECT column_name AS column_name
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = ?`,
        [tableName]
      )
        .then((rows) => new Set(rows.map((row) => String(row.column_name ?? (row as any).COLUMN_NAME))))
        .catch((error) => {
          columnListCache.delete(tableName);
          throw error;
        })
    );
  }
  return columnListCache.get(tableName)!;
}

let costCentreProcessIdSupportPromise: Promise<boolean> | null = null;
const TREND_CACHE_TTL_MS = 60_000;
const COMPUTATION_CACHE_TTL_MS = 60_000;
const DEBUG_PROCESS_PNL_TIMINGS = process.env.DEBUG_PROCESS_PNL_TIMINGS === "true";
const trendCache = new Map<string, {
  expiresAt: number;
  value?: TrendPoint[];
  promise?: Promise<TrendPoint[]>;
}>();
const computationCache = new Map<string, {
  expiresAt: number;
  value?: ProcessPnlComputationContext;
  promise?: Promise<ProcessPnlComputationContext>;
}>();

async function hasCostCentreProcessId(): Promise<boolean> {
  if (!costCentreProcessIdSupportPromise) {
    costCentreProcessIdSupportPromise = columnExists("cost_centre_master", "process_id").catch(() => false);
  }
  return costCentreProcessIdSupportPromise;
}

function trendCacheKey(processId: string | null, filters: PnlQueryFilters): string {
  return [
    processId ?? "all",
    filters.period,
    filters.branchId ?? "",
    filters.processId ?? "",
    filters.clientId ?? "",
    filters.search?.trim() ?? "",
  ].join("|");
}

function computationCacheKey(filters: PnlQueryFilters): string {
  return [
    filters.period,
    filters.branchId ?? "",
    filters.processId ?? "",
    filters.clientId ?? "",
    filters.search?.trim() ?? "",
  ].join("|");
}

async function measurePnlStep<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!DEBUG_PROCESS_PNL_TIMINGS) {
    return task();
  }

  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    console.info(`[process-pnl] ${label} ${Date.now() - startedAt}ms`);
  }
}

function effectiveProcessExpr(alias: string, costCentreProcessIdSupported: boolean): string {
  return costCentreProcessIdSupported
    ? `COALESCE(${alias}.process_id, ccm.process_id)`
    : `${alias}.process_id`;
}

async function getBaseProcesses(filters: PnlQueryFilters): Promise<ProcessBaseRow[]> {
  const conds = ["COALESCE(p.active_status, 1) = 1"];
  const params: unknown[] = [];

  if (filters.branchId) {
    conds.push("p.branch_id = ?");
    params.push(filters.branchId);
  }
  // The entitlement, ANDed with whatever branch was asked for. An empty array means the caller
  // holds no branch at all, and must see nothing — `1=0` rather than a dropped predicate,
  // because a dropped predicate here silently returns every branch's P&L.
  if (filters.branchIds) {
    if (!filters.branchIds.length) {
      conds.push("1=0");
    } else {
      conds.push(`p.branch_id IN (${filters.branchIds.map(() => "?").join(", ")})`);
      params.push(...filters.branchIds);
    }
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
        bm.branch_name AS branch_name
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
  const periodEnd = `${period}-28`;
  const periodStart = `${period}-01`;

  const setMissing = (processId: string) => {
    if (map.has(processId)) return;
    map.set(processId, {
      billingModel: null,
      billingRate: null,
      contractedSeats: null,
      rateSource: "missing",
      rateType: null,
      unit: null,
      effectiveFrom: null,
      approvalReference: null,
      configurationStatus: "missing",
      overlapException: false,
    });
  };

  if (await tableExists("process_billing_rate")) {
    const rows = await queryRows<RowDataPacket>(
      `SELECT
          pbr.process_id,
          pbr.rate_type,
          pbr.rate_amount,
          pbr.unit,
          pbr.effective_from,
          pbr.effective_to,
          pbr.approval_reference,
          COALESCE(ccm.billing_type, 'per_seat') AS billing_type
         FROM process_billing_rate pbr
         LEFT JOIN client_contract_master ccm ON ccm.id = pbr.contract_id
        WHERE pbr.process_id IN (${placeholders(processIds)})
          AND pbr.effective_from <= ?
          AND (pbr.effective_to IS NULL OR pbr.effective_to >= ?)
          AND (pbr.approved_by IS NOT NULL OR COALESCE(pbr.approval_reference, '') <> '')
        ORDER BY pbr.process_id, pbr.effective_from DESC, pbr.created_at DESC`,
      [...processIds, periodEnd, periodStart]
    );

    const grouped = new Map<string, RowDataPacket[]>();
    for (const row of rows) {
      const key = String(row.process_id);
      const existing = grouped.get(key) ?? [];
      existing.push(row);
      grouped.set(key, existing);
    }

    for (const processId of processIds) {
      const candidates = grouped.get(processId) ?? [];
      if (candidates.length === 0) continue;
      const primary = candidates[0];
      map.set(processId, {
        billingModel: (primary.billing_type as string | null) ?? null,
        billingRate: toNumber(primary.rate_amount),
        contractedSeats: null,
        rateSource: candidates.length > 1 ? "overlap_exception" : "process_billing_rate",
        rateType: (primary.rate_type as string | null) ?? null,
        unit: (primary.unit as string | null) ?? null,
        effectiveFrom: (primary.effective_from as string | null) ?? null,
        approvalReference: (primary.approval_reference as string | null) ?? null,
        configurationStatus: candidates.length > 1 ? "overlap_exception" : "approved",
        overlapException: candidates.length > 1,
      });
    }
  }

  if (await tableExists("client_contract_master")) {
    const rows = await queryRows<RowDataPacket>(
      `SELECT process_id, billing_type, billing_rate, monthly_minimum_commitment, effective_from
         FROM client_contract_master
        WHERE status = 'active'
          AND process_id IN (${placeholders(processIds)})
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC`,
      [...processIds, periodEnd, periodStart]
    );

    for (const row of rows) {
      const processId = String(row.process_id);
      if (map.has(processId)) continue;
      map.set(processId, {
        billingModel: (row.billing_type as string | null) ?? null,
        billingRate: row.billing_rate != null ? toNumber(row.billing_rate) : null,
        contractedSeats: null,
        rateSource: "client_contract_master",
        rateType: row.billing_type === "per_hour"
          ? "hour_rate"
          : row.billing_type === "per_transaction"
          ? "transaction_rate"
          : row.billing_type === "fixed_monthly"
          ? "fixed_fee"
          : "seat_rate",
        unit: row.billing_type === "per_hour"
          ? "hour"
          : row.billing_type === "per_transaction"
          ? "transaction"
          : row.billing_type === "fixed_monthly"
          ? "month"
          : "seat",
        effectiveFrom: (row.effective_from as string | null) ?? null,
        approvalReference: null,
        configurationStatus: "fallback",
        overlapException: false,
      });
    }
  }

  if (await tableExists("billing_unit")) {
    const rows = await queryRows<RowDataPacket>(
      `SELECT process_id, billing_type, rate, effective_from
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
        billingRate: row.rate != null ? toNumber(row.rate) : null,
        contractedSeats: null,
        rateSource: "billing_unit",
        rateType: row.billing_type === "per_hour"
          ? "hour_rate"
          : row.billing_type === "per_transaction"
          ? "transaction_rate"
          : row.billing_type === "fixed_monthly"
          ? "fixed_fee"
          : "seat_rate",
        unit: row.billing_type === "per_hour"
          ? "hour"
          : row.billing_type === "per_transaction"
          ? "transaction"
          : row.billing_type === "fixed_monthly"
          ? "month"
          : "seat",
        effectiveFrom: (row.effective_from as string | null) ?? null,
        approvalReference: null,
        configurationStatus: "fallback",
        overlapException: false,
      });
    }
  }

  for (const processId of processIds) {
    setMissing(processId);
  }

  return map;
}

async function getMonthlyPlanMap(processIds: string[], period: string): Promise<Map<string, MonthlyPlanMeta>> {
  const map = new Map<string, MonthlyPlanMeta>();
  if (processIds.length === 0 || !(await tableExists("process_monthly_plan"))) return map;

  const rows = await queryRows<RowDataPacket>(
    `SELECT
        process_id,
        contracted_seats,
        required_productive_hc,
        required_roster_hc,
        buffer_target_pct,
        revenue_budget,
        direct_cost_budget,
        indirect_cost_budget,
        profit_budget,
        status
       FROM process_monthly_plan
      WHERE process_id IN (${placeholders(processIds)})
        AND period_code = ?
      ORDER BY FIELD(status, 'locked', 'approved', 'draft'), updated_at DESC`,
    [...processIds, period]
  );

  for (const row of rows) {
    const processId = String(row.process_id);
    if (map.has(processId)) continue;
    map.set(processId, {
      contractedSeats: row.contracted_seats != null ? toNumber(row.contracted_seats) : null,
      requiredProductiveHc: row.required_productive_hc != null ? toNumber(row.required_productive_hc) : null,
      requiredRosterHc: row.required_roster_hc != null ? toNumber(row.required_roster_hc) : null,
      bufferTargetPct: row.buffer_target_pct != null ? toNumber(row.buffer_target_pct) : null,
      revenueBudget: row.revenue_budget != null ? toNumber(row.revenue_budget) : null,
      directCostBudget: row.direct_cost_budget != null ? toNumber(row.direct_cost_budget) : null,
      indirectCostBudget: row.indirect_cost_budget != null ? toNumber(row.indirect_cost_budget) : null,
      profitBudget: row.profit_budget != null ? toNumber(row.profit_budget) : null,
      status: row.status ? String(row.status) : null,
    });
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
        AND (e.date_of_exit IS NULL OR e.date_of_exit >= ?)
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
      billableHc: row.available_hc != null ? toNumber(row.available_hc) : null,
      requiredHc: toNumber(row.required_hc),
      availableHc: toNumber(row.available_hc),
      freshness: maxDate(row.generated_at as string | null, row.revenue_date as string | null),
    });
  }

  return map;
}

/*
 * `billing_invoice` (the HRMS-native invoice table this used to read) has 0 rows in production —
 * it is a real, separate ERP invoicing feature (erp.service.ts, migration 036_erp_billing.sql)
 * that nobody has switched on yet, not an abandoned table. Real, reconciled billing revenue lives
 * in the db_bill mirror instead: billing_invoice_particular_snapshot (line items) with
 * billing_provision_snapshot as the confirmed-billing fallback and billing_credit_note_snapshot
 * netted out, exactly as ceo-overview.service.ts / pnl-actuals.service.ts already read it.
 * getInvoicedRevenueActuals() is that same query, exported so every P&L surface (this one,
 * bpo-pnl.service.ts, pnl-statement.service.ts) shares one implementation instead of drifting.
 *
 * Only the net revenue figure is available from that source at process grain — the legacy mirror
 * does not carry per-invoice payment status joined to a process the way billing_invoice's schema
 * implied, so collectedRevenue/outstandingRevenue/invoiceCount stay at 0 rather than inventing a
 * shape no sibling service uses. They were already 0 in production (billing_invoice being empty),
 * so this is not a regression on those fields — only invoicedRevenue/recognizedRevenue move from
 * always-zero to the real figure.
 */
async function getInvoiceMap(processIds: string[], start: string, end: string): Promise<Map<string, InvoiceMeta>> {
  const map = new Map<string, InvoiceMeta>();
  if (processIds.length === 0) return map;

  const period = start.slice(0, 7);
  const actuals = await getInvoicedRevenueActuals(period);
  const processIdSet = new Set(processIds);

  for (const [processId, amount] of actuals.byProcess.entries()) {
    if (!processIdSet.has(processId)) continue;
    const revenue = toNumber(amount);
    map.set(processId, {
      invoicedRevenue: revenue,
      recognizedRevenue: revenue,
      collectedRevenue: 0,
      outstandingRevenue: 0,
      invoiceCount: 0,
      adjustments: 0,
      freshness: null,
    });
  }

  return map;
}

/*
 * Invoice-line detail for a single process, for the Revenue-tab and Ledger UI lists that used to
 * read individual billing_invoice rows. billing_invoice_particular_snapshot is the line-item
 * mirror those rows came from in spirit, joined to the process the same way
 * getIndirectCostActuals/revenueByBranch resolve one: through the employees posted to the cost
 * centre, because cost_centre_master.process_id is NULL on every live row.
 *
 * Fields with no equivalent in the mirror (status, gst_amount, sent_at, paid_at) are left null
 * rather than guessed — the mirror does not carry a payment/dispatch lifecycle, only what was
 * billed.
 */
async function getSnapshotInvoiceLines(processId: string, period: string): Promise<RowDataPacket[]> {
  if (!(await tableExists("billing_invoice_particular_snapshot"))) return [];
  return queryRows<RowDataPacket>(
    `SELECT p.bill_source_id, p.cost_centre_code, p.period_code, p.service, p.sub_category,
            p.particulars, p.rate, p.qty, p.amount, p.billing_pattern, p.is_seat_line,
            p.source_created_at
       FROM billing_invoice_particular_snapshot p
       LEFT JOIN cost_centre_master ccm
              ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
               = p.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE p.period_code = ?
        AND ${OWN_COMPANY_SQL}
        AND ccm.id IN (
          SELECT DISTINCT e.cost_centre_id FROM employees e
           WHERE e.process_id = ? AND e.cost_centre_id IS NOT NULL
        )
      ORDER BY p.source_created_at DESC`,
    [period, processId]
  ).catch(() => []);
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

  /*
   * EVERY run in the month, not the most recent one.
   *
   * salary_prep_run's unique key is (run_month, branch_filter, process_filter), so several runs
   * per month are legal and are used: 2026-03 holds two, and they share ZERO employees —
   * 1,140 in one and 226 in the other, measured against production. They are disjoint cohorts,
   * not a correction and its original, so taking one and discarding the other simply loses
   * whichever cohort lost the sort.
   *
   * That was doing real damage. Three services picked three different strategies and produced
   * three different March people-costs from the same table:
   *   ceo-overview.service.ts   sums all runs   Rs 2,37,71,979.56  (1,366 employees) — correct
   *   this file                 created_at DESC Rs 2,17,27,117.00  (1,140) — omitted 226
   *   bpo-pnl.service.ts        FIELD(status)   Rs    20,44,862.56 (  226) — omitted 1,140
   * The last of those under-reported the month by 91.4%.
   *
   * Employee-level de-duplication is still enforced by COUNT(DISTINCT spl.employee_id), so if a
   * genuine correction run ever DOES repeat an employee, headcount stays honest; the money
   * columns would then need a run-precedence rule, which no data has ever required.
   */
  const runRows = await queryRows<RowDataPacket>(
    `SELECT id, run_month, status, created_at
       FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY created_at DESC`,
    [period]
  );

  if (runRows.length > 0) {
    const runIds = runRows.map((row) => String(row.id));
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
        WHERE spl.run_id IN (${placeholders(runIds)})
          AND e.process_id IN (${placeholders(processIds)})
        GROUP BY e.process_id`,
      [...runIds, ...processIds]
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
        // The newest run of the month still identifies the figure's provenance; runRows is
        // ordered created_at DESC so [0] is that one, as it was when only one was read.
        runId: runIds[0],
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

function directCostClassExpr(alias: string, effectiveProcessExpr: string) {
  return `COALESCE(${alias}.cost_class, CASE WHEN ${effectiveProcessExpr} IS NOT NULL THEN 'direct' ELSE 'indirect' END)`;
}

function actualVendorStatusExpr(alias: string, columns: Set<string>) {
  const statusColumns = [
    columns.has("payment_status") ? `${alias}.payment_status` : null,
    columns.has("status") ? `${alias}.status` : null,
  ].filter(Boolean);

  if (statusColumns.length === 0) {
    return "0 = 1";
  }

  return `LOWER(COALESCE(${statusColumns.join(", ")}, '')) IN ('approved','finance_approved','posted','paid')`;
}

function actualGrnStatusExpr(alias: string) {
  return `LOWER(COALESCE(${alias}.status, '')) IN ('approved','posted','paid')`;
}

async function getVendorDirectCostMap(processIds: string[], start: string, end: string, period: string): Promise<Map<string, VendorCostMeta>> {
  const map = new Map<string, VendorCostMeta>();
  if (processIds.length === 0) return map;
  const costCentreProcessIdSupported = await hasCostCentreProcessId();
  const vendorPaymentColumns = await listColumns("vendor_payment_tracking").catch(() => new Set<string>());

  if (await tableExists("vendor_payment_tracking")) {
    const resolvedProcessExpr = effectiveProcessExpr("vpt", costCentreProcessIdSupported);
    const rows = await queryRows<RowDataPacket>(
      `SELECT
          ${resolvedProcessExpr} AS process_id,
          SUM(COALESCE(vpt.due_amount, 0)) AS approved_amount,
          COUNT(vpt.id) AS item_count,
          MAX(COALESCE(vpt.payment_date, vpt.due_date, vpt.updated_at, vpt.created_at)) AS freshness
        FROM vendor_payment_tracking vpt
         LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
        WHERE ${resolvedProcessExpr} IN (${placeholders(processIds)})
          AND ${directCostClassExpr("vpt", resolvedProcessExpr)} = 'direct'
          AND ${actualVendorStatusExpr("vpt", vendorPaymentColumns)}
          AND COALESCE(vpt.due_date, vpt.created_at) BETWEEN ? AND ?
        GROUP BY ${resolvedProcessExpr}`,
      [...processIds, start, end]
    ).catch(() => []);

    for (const row of rows) {
      map.set(String(row.process_id), {
        approvedAmount: toNumber(row.approved_amount),
        itemCount: toNumber(row.item_count),
        freshness: (row.freshness as string | null) ?? null,
      });
    }
  }

  if (await tableExists("grn_request")) {
    const resolvedProcessExpr = effectiveProcessExpr("g", costCentreProcessIdSupported);
    const rows = await queryRows<RowDataPacket>(
      `SELECT
          ${resolvedProcessExpr} AS process_id,
          SUM(COALESCE(g.amount, 0)) AS approved_amount,
          COUNT(g.id) AS item_count,
          MAX(COALESCE(g.reviewed_at, g.due_date, g.bill_date, g.updated_at, g.created_at)) AS freshness
        FROM grn_request g
         LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
         LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = g.id
        WHERE ${resolvedProcessExpr} IN (${placeholders(processIds)})
          AND ${directCostClassExpr("g", resolvedProcessExpr)} = 'direct'
          AND ${actualGrnStatusExpr("g")}
          AND vpt.id IS NULL
          AND g.accounting_period = ?
        GROUP BY ${resolvedProcessExpr}`,
      [...processIds, period]
    ).catch(() => []);

    for (const row of rows) {
      const processId = String(row.process_id);
      const existing = map.get(processId);
      map.set(processId, {
        approvedAmount: (existing?.approvedAmount ?? 0) + toNumber(row.approved_amount),
        itemCount: (existing?.itemCount ?? 0) + toNumber(row.item_count),
        freshness: maxDate(existing?.freshness ?? null, (row.freshness as string | null) ?? null),
      });
    }
  }

  return map;
}

async function getIndirectAllocationMap(
  processes: ProcessBaseRow[],
  activeHeadcount: NumericMap,
  start: string,
  end: string,
  period: string
): Promise<Map<string, IndirectAllocationMeta>> {
  const map = new Map<string, IndirectAllocationMeta>();
  if (processes.length === 0) return map;
  const costCentreProcessIdSupported = await hasCostCentreProcessId();
  const vendorPaymentColumns = await listColumns("vendor_payment_tracking").catch(() => new Set<string>());

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
    const resolvedProcessExpr = effectiveProcessExpr("vpt", costCentreProcessIdSupported);
    const rows = await queryRows<RowDataPacket>(
      `SELECT vpt.branch_id, SUM(COALESCE(vpt.due_amount, 0)) AS pool_amount
        FROM vendor_payment_tracking vpt
         LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
        WHERE vpt.branch_id IN (${placeholders(branchIds)})
          AND ${directCostClassExpr("vpt", resolvedProcessExpr)} = 'indirect'
          AND ${actualVendorStatusExpr("vpt", vendorPaymentColumns)}
          AND COALESCE(vpt.due_date, vpt.created_at) BETWEEN ? AND ?
        GROUP BY vpt.branch_id`,
      [...branchIds, start, end]
    );
    for (const row of rows) {
      poolByBranch.set(String(row.branch_id), toNumber(row.pool_amount));
    }
  } else if (branchIds.length > 0 && await tableExists("grn_request")) {
    const resolvedProcessExpr = effectiveProcessExpr("g", costCentreProcessIdSupported);
    const rows = await queryRows<RowDataPacket>(
      `SELECT g.branch_id, SUM(COALESCE(g.amount, 0)) AS pool_amount
        FROM grn_request g
         LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
        WHERE g.branch_id IN (${placeholders(branchIds)})
          AND ${directCostClassExpr("g", resolvedProcessExpr)} = 'indirect'
          AND ${actualGrnStatusExpr("g")}
          AND g.accounting_period = ?
        GROUP BY g.branch_id`,
      [...branchIds, period]
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

function classifyAdjustmentMetric(metricKey: string) {
  switch (metricKey) {
    case "recognized_revenue":
    case "variable_billing":
    case "reward":
      return "revenue";
    case "penalty":
    case "credit_note":
      return "revenue_negative";
    case "direct_people_cost":
      return "direct_people_cost";
    case "direct_non_people_cost":
    case "other_operating_adjustment":
      return "direct_non_people_cost";
    case "indirect_cost":
      return "indirect_cost";
    case "operating_profit":
      return "operating_profit";
    default:
      return "unsupported";
  }
}

async function getApprovedAdjustmentMap(processIds: string[], period: string): Promise<Map<string, AdjustmentMeta>> {
  const map = new Map<string, AdjustmentMeta>();
  if (processIds.length === 0 || !(await tableExists("pnl_adjustment_journal"))) return map;

  const rows = await queryRows<RowDataPacket>(
    `SELECT process_id, metric_key, adjustment_amount
       FROM pnl_adjustment_journal
      WHERE process_id IN (${placeholders(processIds)})
        AND period_code = ?
        AND approval_status = 'approved'
        AND reversed_at IS NULL`,
    [...processIds, period]
  ).catch(() => []);

  for (const row of rows) {
    const processId = String(row.process_id);
    const current = map.get(processId) ?? {
      revenue: 0,
      directPeopleCost: 0,
      directNonPeopleCost: 0,
      indirectCost: 0,
      operatingProfit: 0,
    };
    const amount = toNumber(row.adjustment_amount);
    switch (classifyAdjustmentMetric(String(row.metric_key ?? ""))) {
      case "revenue":
        current.revenue += amount;
        break;
      case "revenue_negative":
        current.revenue -= Math.abs(amount);
        break;
      case "direct_people_cost":
        current.directPeopleCost += amount;
        break;
      case "direct_non_people_cost":
        current.directNonPeopleCost += amount;
        break;
      case "indirect_cost":
        current.indirectCost += amount;
        break;
      case "operating_profit":
        current.operatingProfit += amount;
        break;
      default:
        break;
    }
    map.set(processId, current);
  }

  return map;
}

function buildRecord(
  process: ProcessBaseRow,
  contracts: Map<string, ContractMeta>,
  workforce: Map<string, WorkforceMeta>,
  monthlyPlans: Map<string, MonthlyPlanMeta>,
  activeHeadcount: NumericMap,
  revenueDaily: Map<string, RevenueSnapshot>,
  invoices: Map<string, InvoiceMeta>,
  payroll: Map<string, PayrollMeta>,
  expenses: Map<string, ExpenseMeta>,
  vendorDirectCosts: Map<string, VendorCostMeta>,
  indirectAllocations: Map<string, IndirectAllocationMeta>,
  approvedAdjustments: Map<string, AdjustmentMeta>
): ProcessPnlRecord {
  const contract = contracts.get(process.process_id);
  const workforceMeta = workforce.get(process.process_id);
  const monthlyPlan = monthlyPlans.get(process.process_id);
  const revenue = revenueDaily.get(process.process_id);
  const invoice = invoices.get(process.process_id);
  const payrollMeta = payroll.get(process.process_id);
  const expense = expenses.get(process.process_id);
  const vendorDirectCost = vendorDirectCosts.get(process.process_id);
  const indirect = indirectAllocations.get(process.process_id);
  const adjustments = approvedAdjustments.get(process.process_id);

  const activeHc = activeHeadcount.get(process.process_id) ?? 0;
  const billableHc = revenue?.billableHc ?? null;
  const requiredProductiveHc = monthlyPlan?.requiredProductiveHc ?? workforceMeta?.productiveHc ?? revenue?.requiredHc ?? activeHc;
  const requiredRosterHc = monthlyPlan?.requiredRosterHc ?? workforceMeta?.rosterHc ?? requiredProductiveHc;
  const actualBufferPct = requiredRosterHc > 0 ? ((activeHc - requiredRosterHc) / requiredRosterHc) * 100 : null;

  const baseRevenueMtd = invoice?.recognizedRevenue && invoice.recognizedRevenue > 0
    ? invoice.recognizedRevenue
    : revenue?.revenue ?? 0;
  const revenueMtd = baseRevenueMtd + (adjustments?.revenue ?? 0);
  const revenueForecast = Math.max(
    revenue?.forecast ?? 0,
    invoice?.recognizedRevenue ?? 0,
    baseRevenueMtd
  ) + (adjustments?.revenue ?? 0);
  const salaryMtd = payrollMeta?.gross ?? 0;
  const directPeopleCost = (payrollMeta?.total ?? 0) + (adjustments?.directPeopleCost ?? 0);
  const directNonPeopleCost = (expense?.approvedAmount ?? 0) + (vendorDirectCost?.approvedAmount ?? 0) + (adjustments?.directNonPeopleCost ?? 0);
  const directCost = directPeopleCost + directNonPeopleCost;
  const indirectCost = (indirect?.allocatedAmount ?? 0) + (adjustments?.indirectCost ?? 0);
  const totalCost = directCost + indirectCost;
  const contributionMargin = revenueMtd - directCost;
  const operatingProfit = revenueMtd - totalCost + (adjustments?.operatingProfit ?? 0);
  const operatingMarginPct = revenueMtd > 0 ? (operatingProfit / revenueMtd) * 100 : null;
  const revenueLeakage = revenue?.revenueAtRisk ?? 0;
  const receivableRisk = Math.max(0, invoice?.outstandingRevenue ?? 0);
  const revenueAtRisk = revenueLeakage;
  const monthEndProjectedProfit = revenueForecast - totalCost;
  const revenueBudget = monthlyPlan?.revenueBudget ?? null;
  const directCostBudget = monthlyPlan?.directCostBudget ?? null;
  const indirectCostBudget = monthlyPlan?.indirectCostBudget ?? null;
  const profitBudget = monthlyPlan?.profitBudget ?? null;
  const revenueVariance = revenueBudget != null ? revenueMtd - revenueBudget : null;
  const directCostVariance = directCostBudget != null ? directCost - directCostBudget : null;
  const indirectCostVariance = indirectCostBudget != null ? indirectCost - indirectCostBudget : null;
  const operatingProfitVariance = profitBudget != null ? operatingProfit - profitBudget : null;
  const operatingMarginVariance = revenueBudget != null && profitBudget != null
    ? operatingMarginPct == null
      ? null
      : operatingMarginPct - ((profitBudget / Math.max(revenueBudget, 1)) * 100)
    : null;
  const headcountVariance = monthlyPlan?.requiredProductiveHc != null ? activeHc - monthlyPlan.requiredProductiveHc : null;
  const bufferVariance = monthlyPlan?.bufferTargetPct != null && actualBufferPct != null ? actualBufferPct - monthlyPlan.bufferTargetPct : null;
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
    resolvedRate: contract?.billingRate ?? null,
    rateSource: contract?.rateSource ?? "missing",
    rateType: contract?.rateType ?? null,
    billingUnit: contract?.unit ?? null,
    rateEffectiveFrom: contract?.effectiveFrom ?? null,
    approvalReference: contract?.approvalReference ?? null,
    configurationStatus: contract?.configurationStatus ?? "missing",
    contractedSeats: monthlyPlan?.contractedSeats ?? contract?.contractedSeats ?? null,
    billableHc,
    requiredProductiveHc,
    requiredRosterHc,
    activeHc,
    deployedHc: revenue?.availableHc ?? activeHc,
    bufferTargetPct: monthlyPlan?.bufferTargetPct ?? workforceMeta?.bufferPct ?? null,
    actualBufferPct,
    revenueMtd,
    revenueForecast,
    invoicedRevenueMtd: invoice?.invoicedRevenue ?? revenueMtd,
    collectedRevenueMtd: invoice?.collectedRevenue ?? 0,
    outstandingReceivable: invoice?.outstandingRevenue ?? 0,
    receivableRisk,
    totalCommercialExposure: revenueLeakage + receivableRisk,
    salaryMtd,
    directPeopleCost,
    directNonPeopleCost,
    directCost,
    indirectCost,
    totalCost,
    contributionMargin,
    operatingProfit,
    operatingMarginPct,
    revenueBudget,
    directCostBudget,
    indirectCostBudget,
    profitBudget,
    revenueVariance,
    directCostVariance,
    indirectCostVariance,
    operatingProfitVariance,
    operatingMarginVariance,
    headcountVariance,
    bufferVariance,
    budgetVariance: operatingProfitVariance,
    revenueLeakage,
    revenueAtRisk,
    monthEndProjectedProfit,
    reconciliationStatus: reconciliationStatus({
      revenue: revenueMtd,
      payroll: directPeopleCost,
      hasContract: Boolean(contract) && (contract?.rateSource !== "missing") && !contract?.overlapException && billableHc != null,
    }),
    financialStatus,
    processStatus: statusFromProfit({ operatingProfit, operatingMarginPct, revenueAtRisk }),
    freshness: maxDate(
      revenue?.freshness,
      invoice?.freshness,
      payrollMeta?.freshness,
      expense?.freshness,
      vendorDirectCost?.freshness
    ),
  };
}

async function buildComputationContext(filters: Partial<PnlQueryFilters>): Promise<ProcessPnlComputationContext> {
  const normalizedFilters: PnlQueryFilters = {
    period: filters.period && /^\d{4}-\d{2}$/.test(filters.period) ? filters.period : defaultPeriod(),
    branchId: filters.branchId,
    // Rebuilt field by field, so a new filter has to be added here explicitly or it is silently
    // dropped on the way to the query — which is what happened to branchIds first time round.
    branchIds: filters.branchIds,
    processId: filters.processId,
    clientId: filters.clientId,
    search: filters.search,
  };
  const cacheKey = computationCacheKey(normalizedFilters);
  const cached = computationCache.get(cacheKey);
  const now = Date.now();

  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const contextPromise = (async (): Promise<ProcessPnlComputationContext> => {
  const { start, end } = monthRange(normalizedFilters.period);
  const processes = await measurePnlStep("getBaseProcesses", () => getBaseProcesses(normalizedFilters));
  const processIds = processes.map((process) => process.process_id);

  // This was 10 sequential awaits, each paying its own DB round trip — the
  // dominant cost of the whole P&L computation (self-audit finding: a
  // single cold call measured ~31-33s standalone, and calling this function
  // twice in the same process dropped the second call to ~60ms purely from
  // this function's own computationCache below — meaning essentially all of
  // that 31-33s was these 10 queries running one at a time). Each of the 10
  // reads only processIds + a date range/period, none reads another's
  // result — getIndirectAllocationMap is the sole exception, which is why
  // it stays sequential after this Promise.all (it needs `processes` and
  // `activeHeadcount`, both resolved here). Same pattern already applied
  // ~5 times elsewhere this session; 10 concurrent queries also happens to
  // fit exactly within DB_POOL_MAX=10, so none of them queue for a slot.
  const [
    contracts,
    workforce,
    monthlyPlans,
    activeHeadcount,
    revenueDaily,
    invoices,
    payroll,
    expenses,
    vendorDirectCosts,
    approvedAdjustments,
  ] = await Promise.all([
    measurePnlStep("getContractMap", () => getContractMap(processIds, normalizedFilters.period)),
    measurePnlStep("getWorkforceMap", () => getWorkforceMap(processIds, start, end)),
    measurePnlStep("getMonthlyPlanMap", () => getMonthlyPlanMap(processIds, normalizedFilters.period)),
    measurePnlStep("getActiveHeadcountMap", () => getActiveHeadcountMap(processIds, end)),
    measurePnlStep("getRevenueDailyMap", () => getRevenueDailyMap(processIds, start, end)),
    measurePnlStep("getInvoiceMap", () => getInvoiceMap(processIds, start, end)),
    measurePnlStep("getPayrollMap", () => getPayrollMap(processIds, normalizedFilters.period, end)),
    measurePnlStep("getExpenseMap", () => getExpenseMap(processIds, start, end)),
    measurePnlStep("getVendorDirectCostMap", () => getVendorDirectCostMap(processIds, start, end, normalizedFilters.period)),
    measurePnlStep("getApprovedAdjustmentMap", () => getApprovedAdjustmentMap(processIds, normalizedFilters.period)),
  ]);

  const indirectAllocations = await measurePnlStep("getIndirectAllocationMap", () =>
    getIndirectAllocationMap(processes, activeHeadcount, start, end, normalizedFilters.period)
  );

  return {
    filters: normalizedFilters,
    processes,
    contracts,
    workforce,
    monthlyPlans,
    activeHeadcount,
    revenueDaily,
    invoices,
    payroll,
    expenses,
    vendorDirectCosts,
    indirectAllocations,
    approvedAdjustments,
    generatedAt: new Date().toISOString(),
  };
  })();

  computationCache.set(cacheKey, { expiresAt: now + COMPUTATION_CACHE_TTL_MS, promise: contextPromise });

  try {
    const value = await contextPromise;
    computationCache.set(cacheKey, {
      expiresAt: Date.now() + COMPUTATION_CACHE_TTL_MS,
      value,
    });
    return value;
  } catch (error) {
    const current = computationCache.get(cacheKey);
    if (current?.promise === contextPromise) {
      computationCache.delete(cacheKey);
    }
    throw error;
  }
}

async function buildTrend(processId: string | null, filters: PnlQueryFilters) {
  const cacheKey = trendCacheKey(processId, filters);
  const cached = trendCache.get(cacheKey);
  const now = Date.now();

  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const trendPromise = (async (): Promise<TrendPoint[]> => {
  const months = Array.from({ length: 6 }, (_, index) => shiftMonth(filters.period, index - 5));
  const processClause = processId ? "AND process_id = ?" : "";
  const processJoinClause = processId ? "AND e.process_id = ?" : "";
  const expenseProcessClause = processId ? "AND CAST(ec.process_id AS CHAR) = ?" : "";
  // See getInvoiceMap's comment: billing_invoice is a genuinely separate, unused ERP feature
  // with 0 rows. Real revenue for the trend comes from the same snapshot mirror every other
  // process-pnl surface reads, via the shared getInvoicedRevenueActuals() helper.
  const hasInvoiceSnapshot = await tableExists("billing_invoice_particular_snapshot");
  const salaryColumns = await listColumns("salary_prep_line").catch(() => new Set<string>());
  const hasExpenseClaims = await tableExists("expense_claims");
  const hasExpenseItems = await tableExists("expense_items");
  const costCentreProcessIdSupported = await hasCostCentreProcessId();
  const hasVendorPayments = await tableExists("vendor_payment_tracking");
  const hasGrnRequest = await tableExists("grn_request");
  const vendorPaymentColumns = await listColumns("vendor_payment_tracking").catch(() => new Set<string>());

  const grossExpr = salaryColumns.has("gross_salary") ? "COALESCE(spl.gross_salary, 0)" : "0";
  const pfExpr = salaryColumns.has("pf_employer") ? "COALESCE(spl.pf_employer, 0)" : "0";
  const esicExpr = salaryColumns.has("esic_employer") ? "COALESCE(spl.esic_employer, 0)" : "0";
  const gratuityExpr = salaryColumns.has("gratuity")
    ? "COALESCE(spl.gratuity, 0)"
    : (salaryColumns.has("basic") ? "COALESCE(spl.basic, 0) * 0.0481" : "0");

  const series: TrendPoint[] = [];
  const monthSeries = buildMonthSeries(months);

  if (!processId) {
    const seriesByMonth = new Map<string, TrendPoint>(
      monthSeries.map(({ month }) => [
        month,
        {
          month,
          revenue: 0,
          directCost: 0,
          indirectCost: 0,
          operatingProfit: 0,
        },
      ])
    );
    const seriesSql = monthSeriesSql(months);
    const seriesParams = monthSeriesParams(months);

    if (hasInvoiceSnapshot) {
      // getInvoicedRevenueActuals is period-based (not a date-range join), so each month in the
      // series is resolved with its own call rather than folded into the UNION ALL month-series
      // trick the SQL fallback below still uses.
      for (const month of months) {
        const actuals = await getInvoicedRevenueActuals(month);
        let total = 0;
        for (const amount of actuals.byProcess.values()) total += amount;
        const entry = seriesByMonth.get(month);
        if (entry) entry.revenue = total;
      }
    } else {
      const revenueRows = await queryRows<RowDataPacket>(
        `SELECT ms.month_key, SUM(COALESCE(prd.actual_revenue_estimate, 0)) AS total
           FROM (${seriesSql}) ms
           LEFT JOIN process_revenue_daily prd
             ON prd.revenue_date BETWEEN ms.start_date AND ms.end_date
          GROUP BY ms.month_key`,
        seriesParams
      );
      for (const row of revenueRows) {
        const entry = seriesByMonth.get(String(row.month_key));
        if (entry) entry.revenue = toNumber(row.total);
      }
    }

    const payrollRows = await queryRows<RowDataPacket>(
      `SELECT ms.month_key, SUM(${grossExpr} + ${pfExpr} + ${esicExpr} + ${gratuityExpr}) AS total
         FROM (${seriesSql}) ms
         LEFT JOIN salary_prep_run spr ON spr.run_month = ms.month_key
         LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
         LEFT JOIN employees e ON e.id = spl.employee_id
        GROUP BY ms.month_key`,
      seriesParams
    ).catch(() => []);
    for (const row of payrollRows) {
      const entry = seriesByMonth.get(String(row.month_key));
      if (entry) entry.directCost = toNumber(row.total);
    }

    const expenseRows = await queryRows<RowDataPacket>(
      hasExpenseClaims && hasExpenseItems
        ? `SELECT ms.month_key,
                  SUM(CASE WHEN ec.status IN ('FINANCE_APPROVED', 'PAID') THEN COALESCE(ei.amount, 0) ELSE 0 END) AS total
             FROM (${seriesSql}) ms
             LEFT JOIN expense_items ei
               ON ei.expense_date BETWEEN ms.start_date AND ms.end_date
             LEFT JOIN expense_claims ec
               ON ec.id = ei.expense_claim_id
            GROUP BY ms.month_key`
        : `SELECT ms.month_key, 0 AS total
             FROM (${seriesSql}) ms`,
      seriesParams
    ).catch(() => []);
    for (const row of expenseRows) {
      const entry = seriesByMonth.get(String(row.month_key));
      if (entry) entry.directCost += toNumber(row.total);
    }

    const indirectRows = hasVendorPayments
      ? await queryRows<RowDataPacket>(
          `SELECT ms.month_key, SUM(COALESCE(vpt.due_amount, 0)) AS total
             FROM (${seriesSql}) ms
             LEFT JOIN vendor_payment_tracking vpt
               ON COALESCE(vpt.due_date, vpt.created_at) BETWEEN ms.start_date AND ms.end_date
             LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
            WHERE ${directCostClassExpr("vpt", effectiveProcessExpr("vpt", costCentreProcessIdSupported))} = 'indirect'
              AND ${actualVendorStatusExpr("vpt", vendorPaymentColumns)}
            GROUP BY ms.month_key`,
          seriesParams
        ).catch(() => [])
      : hasGrnRequest
      ? await queryRows<RowDataPacket>(
          `SELECT ms.month_key, SUM(COALESCE(g.amount, 0)) AS total
             FROM (${seriesSql}) ms
             LEFT JOIN grn_request g
               ON g.accounting_period = ms.month_key
             LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
            WHERE ${directCostClassExpr("g", effectiveProcessExpr("g", costCentreProcessIdSupported))} = 'indirect'
              AND ${actualGrnStatusExpr("g")}
            GROUP BY ms.month_key`,
          seriesParams
        ).catch(() => [])
      : [];
    for (const row of indirectRows) {
      const entry = seriesByMonth.get(String(row.month_key));
      if (entry) entry.indirectCost = toNumber(row.total);
    }

    for (const month of months) {
      const entry = seriesByMonth.get(month);
      if (!entry) continue;
      entry.operatingProfit = entry.revenue - entry.directCost - entry.indirectCost;
      series.push(entry);
    }

    return series;
  }

  for (const month of months) {
    const { start, end } = monthRange(month);
    let monthRevenue: number;
    if (hasInvoiceSnapshot) {
      const actuals = await getInvoicedRevenueActuals(month);
      monthRevenue = processId ? (actuals.byProcess.get(processId) ?? 0) : 0;
    } else {
      const revenueRows = await queryRows<RowDataPacket>(
        `SELECT SUM(COALESCE(actual_revenue_estimate, 0)) AS total
           FROM process_revenue_daily
          WHERE revenue_date BETWEEN ? AND ? ${processClause}`,
        processId ? [end, start, processId] : [end, start]
      );
      monthRevenue = toNumber(revenueRows[0]?.total);
    }

    const payrollRows = await queryRows<RowDataPacket>(
      `SELECT SUM(${grossExpr} + ${pfExpr} + ${esicExpr} + ${gratuityExpr}) AS total
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id
         JOIN employees e ON e.id = spl.employee_id
        WHERE spr.run_month = ? ${processJoinClause}`,
      processId ? [month, processId] : [month]
    ).catch(() => [{ total: 0 } as RowDataPacket]);

    const expenseRows = await queryRows<RowDataPacket>(
      hasExpenseClaims && hasExpenseItems
        ? `SELECT SUM(CASE WHEN ec.status IN ('FINANCE_APPROVED', 'PAID') THEN COALESCE(ei.amount, 0) ELSE 0 END) AS total
             FROM expense_claims ec
             JOIN expense_items ei ON ei.expense_claim_id = ec.id
            WHERE ei.expense_date BETWEEN ? AND ? ${expenseProcessClause}`
        : `SELECT 0 AS total`,
      processId ? [start, end, processId] : [start, end]
    ).catch(() => [{ total: 0 } as RowDataPacket]);

    let indirectTotal = 0;
    if (hasVendorPayments) {
      const resolvedProcessExpr = effectiveProcessExpr("vpt", costCentreProcessIdSupported);
      const indirectRows = await queryRows<RowDataPacket>(
        `SELECT SUM(COALESCE(vpt.due_amount, 0)) AS total
           FROM vendor_payment_tracking vpt
           LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
          WHERE ${directCostClassExpr("vpt", resolvedProcessExpr)} = 'indirect'
            AND ${actualVendorStatusExpr("vpt", vendorPaymentColumns)}
            AND COALESCE(vpt.due_date, vpt.created_at) BETWEEN ? AND ?`,
        [start, end]
      );
      indirectTotal = toNumber(indirectRows[0]?.total);
    } else if (hasGrnRequest) {
      const resolvedProcessExpr = effectiveProcessExpr("g", costCentreProcessIdSupported);
      const indirectRows = await queryRows<RowDataPacket>(
        `SELECT SUM(COALESCE(g.amount, 0)) AS total
           FROM grn_request g
           LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
          WHERE ${directCostClassExpr("g", resolvedProcessExpr)} = 'indirect'
            AND ${actualGrnStatusExpr("g")}
            AND g.accounting_period = ?`,
        [month]
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
            monthlyContext.monthlyPlans,
            monthlyContext.activeHeadcount,
            monthlyContext.revenueDaily,
            monthlyContext.invoices,
            monthlyContext.payroll,
            monthlyContext.expenses,
            monthlyContext.vendorDirectCosts,
            monthlyContext.indirectAllocations,
            monthlyContext.approvedAdjustments
          )
          )
        .find((record) => record.processId === processId);

      series.push({
        month,
        revenue: monthlyRecord?.revenueMtd ?? monthRevenue,
        directCost: monthlyRecord?.directCost ?? (toNumber(payrollRows[0]?.total) + toNumber(expenseRows[0]?.total)),
        indirectCost: monthlyRecord?.indirectCost ?? 0,
        operatingProfit: monthlyRecord?.operatingProfit
          ?? (monthRevenue - toNumber(payrollRows[0]?.total) - toNumber(expenseRows[0]?.total)),
      });
      continue;
    }

    const revenue = monthRevenue;
    const directCost = toNumber(payrollRows[0]?.total) + toNumber(expenseRows[0]?.total);
    const indirectCost = indirectTotal;

    series.push({
      month,
      revenue,
      directCost,
      indirectCost,
      operatingProfit: revenue - directCost - indirectCost,
    });
  }

  return series;
  })();

  trendCache.set(cacheKey, { expiresAt: now + TREND_CACHE_TTL_MS, promise: trendPromise });

  try {
    const value = await trendPromise;
    trendCache.set(cacheKey, {
      expiresAt: Date.now() + TREND_CACHE_TTL_MS,
      value,
    });
    return value;
  } catch (error) {
    const current = trendCache.get(cacheKey);
    if (current?.promise === trendPromise) {
      trendCache.delete(cacheKey);
    }
    throw error;
  }
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
        detail: `Operational revenue leakage of Rs ${Math.round(record.revenueAtRisk).toLocaleString("en-IN")} is unresolved for the selected month.`,
        processId: record.processId,
        processName: record.processName,
        impact: record.revenueAtRisk,
      });
    }
    if (record.billableHc == null) {
      alerts.push({
        type: "critical",
        title: `${record.processName} is missing billable headcount`,
        detail: `The process does not have a traceable billable headcount source for the selected month.`,
        processId: record.processId,
        processName: record.processName,
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
      context.monthlyPlans,
      context.activeHeadcount,
      context.revenueDaily,
      context.invoices,
      context.payroll,
      context.expenses,
      context.vendorDirectCosts,
      context.indirectAllocations,
      context.approvedAdjustments
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

interface ProcessDetailContext {
  context: ProcessPnlComputationContext;
  record: ProcessPnlRecord;
  start: string;
  end: string;
  costCentreProcessIdSupported: boolean;
}

async function getProcessDetailContext(
  processId: string,
  filters: Partial<PnlQueryFilters>
): Promise<ProcessDetailContext> {
  const { context, record } = await getProcessRecord(processId, filters);
  const { start, end } = monthRange(context.filters.period);

  return {
    context,
    record,
    start,
    end,
    costCentreProcessIdSupported: await hasCostCentreProcessId(),
  };
}

export const processPnlService = {
  invalidateCaches() {
    computationCache.clear();
    trendCache.clear();
  },

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
        receivableRisk: records.reduce((sum, record) => sum + record.receivableRisk, 0),
        monthEndProjectedProfit: records.reduce((sum, record) => sum + record.monthEndProjectedProfit, 0),
        billableHeadcount: records.reduce((sum, record) => sum + (record.billableHc ?? 0), 0),
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

  async getOverview(processId: string, filters: Partial<PnlQueryFilters>, detailContext?: ProcessDetailContext) {
    const { context, record } = detailContext ?? await getProcessDetailContext(processId, filters);
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

  async getRevenue(processId: string, filters: Partial<PnlQueryFilters>, detailContext?: ProcessDetailContext) {
    const { context, record, start, end } = detailContext ?? await getProcessDetailContext(processId, filters);

    // billing_invoice has 0 rows in production (unused ERP feature, see getInvoiceMap's comment) —
    // the line-item detail comes from the same db_bill snapshot mirror as the revenue KPI above.
    const invoiceLines = await getSnapshotInvoiceLines(processId, context.filters.period);
    const invoices = invoiceLines.map((row) => ({
      id: String(row.bill_source_id),
      invoice_ref: (row.particulars as string | null) || (row.service as string | null) || null,
      period_from: start,
      period_to: end,
      billable_units: toNumber(row.qty),
      rate: toNumber(row.rate),
      gross_amount: toNumber(row.amount),
      adjustments: 0,
      net_amount: toNumber(row.amount),
      // No equivalent in the mirror — left null rather than guessed; see getSnapshotInvoiceLines.
      gst_amount: null,
      total_amount: toNumber(row.amount),
      status: null,
      sent_at: null,
      paid_at: null,
      created_at: row.source_created_at,
    }));

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

  async getWorkforce(processId: string, filters: Partial<PnlQueryFilters>, detailContext?: ProcessDetailContext) {
    const { context, record } = detailContext ?? await getProcessDetailContext(processId, filters);

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

  async getPeopleCost(processId: string, filters: Partial<PnlQueryFilters>, detailContext?: ProcessDetailContext) {
    const { context, record } = detailContext ?? await getProcessDetailContext(processId, filters);

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
      // Every run in the month, matching getPeopleCostByProcess above. This list is the
      // employee-level backing for the same figure, so reading one run here while the summary
      // reads all of them would put a total on screen that its own rows cannot add up to.
      rows = await queryRows<RowDataPacket>(
        `SELECT id
           FROM salary_prep_run
          WHERE run_month = ?
          ORDER BY created_at DESC`,
        [context.filters.period]
      );
    }

    if (rows.length > 0) {
      const runIds = rows.map((row) => String(row.id));
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
          WHERE spl.run_id IN (${placeholders(runIds)})
            AND e.process_id = ?
          ORDER BY loaded_cost DESC
          LIMIT 250`,
        [...runIds, processId]
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

  async getDirectCost(processId: string, filters: Partial<PnlQueryFilters>, detailContext?: ProcessDetailContext) {
    const {
      context,
      record,
      start,
      end,
      costCentreProcessIdSupported,
    } = detailContext ?? await getProcessDetailContext(processId, filters);
    const expenseAmount = context.expenses.get(processId)?.approvedAmount ?? 0;
    const vendorAmount = context.vendorDirectCosts.get(processId)?.approvedAmount ?? 0;
    const vendorPaymentColumns = await listColumns("vendor_payment_tracking").catch(() => new Set<string>());

    const expenseRows = await queryRows<RowDataPacket>(
      await tableExists("expense_claims") && await tableExists("expense_items")
        ? `SELECT
            ei.id,
            'expense_claim' AS source_type,
            ec.claim_number AS reference,
            ei.expense_date AS entry_date,
            ei.amount,
            ei.description,
            ei.vendor_name,
            ec.status,
            cat.name AS category_name,
            NULL AS sub_category,
            'direct' AS cost_class
           FROM expense_claims ec
           JOIN expense_items ei ON ei.expense_claim_id = ec.id
           LEFT JOIN expense_categories cat ON cat.id = ei.category_id
          WHERE CAST(ec.process_id AS CHAR) = ?
            AND ei.expense_date BETWEEN ? AND ?
          ORDER BY ei.expense_date DESC
          LIMIT 250`
        : `SELECT NULL AS id, NULL AS source_type, NULL AS reference, NULL AS entry_date, 0 AS amount, NULL AS description,
                  NULL AS vendor_name, NULL AS status, NULL AS category_name, NULL AS sub_category, NULL AS cost_class
           WHERE 1 = 0`,
      [processId, start, end]
    ).catch(() => []);

    const vendorRows = await queryRows<RowDataPacket>(
      await tableExists("vendor_payment_tracking")
        ? `SELECT
            vpt.id,
            CASE WHEN grn.grn_type = 'imprest' THEN 'imprest_grn' ELSE 'vendor_grn' END AS source_type,
            COALESCE(vpt.grn_number, CONCAT('GRN-', vpt.id)) AS reference,
            COALESCE(vpt.due_date, grn.bill_date, vpt.created_at) AS entry_date,
            vpt.due_amount AS amount,
            NULL AS description,
            vpt.vendor_name,
           vpt.payment_status AS status,
           vpt.head AS category_name,
           vpt.sub_head AS sub_category,
           vpt.cost_class
           FROM vendor_payment_tracking vpt
          LEFT JOIN grn_request grn ON grn.id = vpt.grn_request_id
          LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
          WHERE ${effectiveProcessExpr("vpt", costCentreProcessIdSupported)} = ?
            AND ${directCostClassExpr("vpt", effectiveProcessExpr("vpt", costCentreProcessIdSupported))} = 'direct'
            AND ${actualVendorStatusExpr("vpt", vendorPaymentColumns)}
            AND COALESCE(vpt.due_date, grn.bill_date, vpt.created_at) BETWEEN ? AND ?
          ORDER BY entry_date DESC
          LIMIT 250`
        : `SELECT NULL AS id, NULL AS source_type, NULL AS reference, NULL AS entry_date, 0 AS amount, NULL AS description,
                  NULL AS vendor_name, NULL AS status, NULL AS category_name, NULL AS sub_category, NULL AS cost_class
           WHERE 1 = 0`,
      [processId, start, end]
    ).catch(() => []);

    const grnRows = await queryRows<RowDataPacket>(
      await tableExists("grn_request")
        ? `SELECT
            g.id,
            CASE WHEN g.grn_type = 'imprest' THEN 'imprest_grn' ELSE 'vendor_grn' END AS source_type,
            COALESCE(g.grn_number, CONCAT('GRN-', g.id)) AS reference,
            COALESCE(g.due_date, g.bill_date, g.reviewed_at, g.created_at) AS entry_date,
            g.amount,
            g.remarks AS description,
            g.vendor_name,
            g.status,
            g.head AS category_name,
            g.sub_head AS sub_category,
           g.cost_class
           FROM grn_request g
           LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
           LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = g.id
          WHERE ${effectiveProcessExpr("g", costCentreProcessIdSupported)} = ?
            AND ${directCostClassExpr("g", effectiveProcessExpr("g", costCentreProcessIdSupported))} = 'direct'
            AND ${actualGrnStatusExpr("g")}
            AND vpt.id IS NULL
            AND g.accounting_period = ?
          ORDER BY entry_date DESC
          LIMIT 250`
        : `SELECT NULL AS id, NULL AS source_type, NULL AS reference, NULL AS entry_date, 0 AS amount, NULL AS description,
                  NULL AS vendor_name, NULL AS status, NULL AS category_name, NULL AS sub_category, NULL AS cost_class
           WHERE 1 = 0`,
      [processId, context.filters.period]
    ).catch(() => []);

    const expenses = [...expenseRows, ...vendorRows, ...grnRows]
      .sort((left, right) => String(right.entry_date ?? "").localeCompare(String(left.entry_date ?? "")))
      .slice(0, 250)
      .map((row) => ({
        id: row.id,
        sourceType: row.source_type,
        reference: row.reference,
        entryDate: row.entry_date,
        category: row.category_name,
        subCategory: row.sub_category,
        vendorName: row.vendor_name,
        description: row.description,
        amount: toNumber(row.amount),
        status: row.status,
        costClass: row.cost_class ?? "direct",
      }));

    return {
      period: context.filters.period,
      summary: {
        directPeopleCost: record.directPeopleCost,
        directExpenseCost: expenseAmount,
        directVendorCost: vendorAmount,
        directNonPeopleCost: record.directNonPeopleCost,
        directCost: record.directCost,
      },
      expenses,
    };
  },

  async getIndirectAllocation(processId: string, filters: Partial<PnlQueryFilters>, detailContext?: ProcessDetailContext) {
    const {
      context,
      record,
      start,
      end,
      costCentreProcessIdSupported,
    } = detailContext ?? await getProcessDetailContext(processId, filters);
    const branchId = record.branchId;
    const vendorPaymentColumns = await listColumns("vendor_payment_tracking").catch(() => new Set<string>());

    const rows = branchId && await tableExists("vendor_payment_tracking")
      ? await queryRows<RowDataPacket>(
          `SELECT
              vpt.head,
              vpt.sub_head,
              SUM(COALESCE(vpt.due_amount, 0)) AS branch_pool_amount
            FROM vendor_payment_tracking vpt
            LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
           WHERE vpt.branch_id = ?
             AND ${directCostClassExpr("vpt", effectiveProcessExpr("vpt", costCentreProcessIdSupported))} = 'indirect'
             AND ${actualVendorStatusExpr("vpt", vendorPaymentColumns)}
             AND COALESCE(vpt.due_date, vpt.created_at) BETWEEN ? AND ?
           GROUP BY vpt.head, vpt.sub_head
           ORDER BY branch_pool_amount DESC`,
          [branchId, start, end]
        ).catch(() => [])
      : branchId && await tableExists("grn_request")
      ? await queryRows<RowDataPacket>(
          `SELECT
              g.head,
              g.sub_head,
              SUM(COALESCE(g.amount, 0)) AS branch_pool_amount
            FROM grn_request g
            LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
           WHERE g.branch_id = ?
             AND ${directCostClassExpr("g", effectiveProcessExpr("g", costCentreProcessIdSupported))} = 'indirect'
             AND ${actualGrnStatusExpr("g")}
             AND g.accounting_period = ?
           GROUP BY g.head, g.sub_head
           ORDER BY branch_pool_amount DESC`,
          [branchId, context.filters.period]
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

  async getTrend(processId: string, filters: Partial<PnlQueryFilters>, detailContext?: ProcessDetailContext) {
    const { context } = detailContext ?? await getProcessDetailContext(processId, filters);
    const trend = await buildTrend(processId, context.filters);
    return { period: context.filters.period, trend };
  },

  async getReconciliation(processId: string, filters: Partial<PnlQueryFilters>, detailContext?: ProcessDetailContext) {
    const { context, record } = detailContext ?? await getProcessDetailContext(processId, filters);
    const issues: Array<{ severity: string; code: string; message: string }> = [];

    const contract = context.contracts.get(processId);
    const monthlyPlan = context.monthlyPlans.get(processId);

    if (!contract || contract.rateSource === "missing") {
      issues.push({
        severity: "critical",
        code: "MISSING_CONTRACT",
        message: "No approved process rate, active contract rate, or billing-unit rate is configured for this process.",
      });
    }
    if (contract?.overlapException) {
      issues.push({
        severity: "critical",
        code: "OVERLAPPING_BILLING_RATES",
        message: "Multiple approved process rates overlap for the selected period. Finance reconciliation is required.",
      });
    }
    if (!monthlyPlan || !["approved", "locked"].includes(String(monthlyPlan.status ?? ""))) {
      issues.push({
        severity: "warning",
        code: "MISSING_APPROVED_MONTHLY_PLAN",
        message: "No approved or locked monthly plan was found for this process and month.",
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
    if (record.billableHc == null) {
      issues.push({
        severity: "critical",
        code: "MISSING_BILLABLE_HC",
        message: "Billable headcount is not traceable for this process in the selected month.",
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

  async getLedger(processId: string, filters: Partial<PnlQueryFilters>, detailContext?: ProcessDetailContext) {
    const {
      context,
      record,
      start,
      end,
      costCentreProcessIdSupported,
    } = detailContext ?? await getProcessDetailContext(processId, filters);
    const entries: Array<Record<string, unknown>> = [];
    const vendorPaymentColumns = await listColumns("vendor_payment_tracking").catch(() => new Set<string>());

    // billing_invoice has 0 rows in production (unused ERP feature, see getInvoiceMap's comment) —
    // ledger revenue entries come from the same db_bill snapshot mirror as the revenue KPI above.
    {
      const invoiceRows = await getSnapshotInvoiceLines(processId, context.filters.period);

      for (const row of invoiceRows) {
        entries.push({
          entryType: "revenue",
          reference: (row.particulars as string | null) || (row.service as string | null) || `INV-${row.bill_source_id}`,
          entryDate: row.source_created_at,
          amount: toNumber(row.amount),
          // No payment-lifecycle status in the mirror; see getSnapshotInvoiceLines.
          status: null,
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

    if (await tableExists("vendor_payment_tracking")) {
      const resolvedVendorProcessExpr = effectiveProcessExpr("vpt", costCentreProcessIdSupported);
      const vendorRows = await queryRows<RowDataPacket>(
        `SELECT
            COALESCE(vpt.grn_number, CONCAT('GRN-', vpt.id)) AS reference,
            COALESCE(vpt.due_date, grn.bill_date, vpt.created_at) AS entry_date,
            vpt.due_amount AS amount,
            vpt.payment_status AS status,
            NULLIF(TRIM(COALESCE(grn.description, '')), '') AS note
           FROM vendor_payment_tracking vpt
          LEFT JOIN grn_request grn ON grn.id = vpt.grn_request_id
          LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
          WHERE ${resolvedVendorProcessExpr} = ?
            AND ${directCostClassExpr("vpt", resolvedVendorProcessExpr)} = 'direct'
            AND ${actualVendorStatusExpr("vpt", vendorPaymentColumns)}
            AND COALESCE(vpt.due_date, grn.bill_date, vpt.created_at) BETWEEN ? AND ?`,
        [processId, start, end]
      ).catch(() => []);

      for (const row of vendorRows) {
        entries.push({
          entryType: "vendor_cost",
          reference: row.reference,
          entryDate: row.entry_date,
          amount: toNumber(row.amount),
          status: row.status,
          note: row.note ?? null,
        });
      }
    }

    if (await tableExists("grn_request")) {
      const resolvedGrnProcessExpr = effectiveProcessExpr("g", costCentreProcessIdSupported);
      const grnRows = await queryRows<RowDataPacket>(
        `SELECT
            COALESCE(g.grn_number, CONCAT('GRN-', g.id)) AS reference,
            COALESCE(g.due_date, g.bill_date, g.reviewed_at, g.created_at) AS entry_date,
            g.amount,
            g.status,
            -- The Note column was empty on five of the ledger's six entry types because only
            -- adjustments supplied one. A GRN carries the raiser's own description of what was
            -- bought, which is precisely what a reader scanning a cost ledger wants.
            NULLIF(TRIM(COALESCE(g.description, '')), '') AS note
           FROM grn_request g
           LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
           LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = g.id
          WHERE ${resolvedGrnProcessExpr} = ?
            AND ${directCostClassExpr("g", resolvedGrnProcessExpr)} = 'direct'
            AND ${actualGrnStatusExpr("g")}
            AND vpt.id IS NULL
            AND g.accounting_period = ?`,
        [processId, context.filters.period]
      ).catch(() => []);

      for (const row of grnRows) {
        entries.push({
          entryType: "grn_cost",
          reference: row.reference,
          entryDate: row.entry_date,
          amount: toNumber(row.amount),
          status: row.status,
          note: row.note ?? null,
        });
      }
    }

    if (await tableExists("pnl_adjustment_journal")) {
      const adjustmentRows = await queryRows<RowDataPacket>(
        `SELECT metric_key, adjustment_amount, approval_status, approved_at, created_at, reason
           FROM pnl_adjustment_journal
          WHERE process_id = ?
            AND period_code = ?
            AND approval_status = 'approved'
            AND reversed_at IS NULL`,
        [processId, context.filters.period]
      ).catch(() => []);

      for (const row of adjustmentRows) {
        entries.push({
          entryType: "adjustment",
          reference: String(row.metric_key ?? "adjustment"),
          entryDate: row.approved_at ?? row.created_at,
          amount: toNumber(row.adjustment_amount),
          status: row.approval_status,
          note: row.reason,
        });
      }
    }

    entries.push({
      entryType: "indirect_allocation",
      reference: `${record.branchName ?? "Branch"} shared overhead`,
      entryDate: end,
      amount: record.indirectCost,
      status: "allocated",
      // Synthesised rather than read from a row, so it has no note of its own — but it is the
      // one line whose origin a reader is most likely to question, so it explains itself.
      note: "Branch indirect cost apportioned to this process",
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
    const detailContext = await getProcessDetailContext(processId, filters);
    const [overview, revenue, workforce, peopleCost, directCost, indirectAllocation, trend, reconciliation, ledger] =
      await Promise.all([
        this.getOverview(processId, filters, detailContext),
        this.getRevenue(processId, filters, detailContext),
        this.getWorkforce(processId, filters, detailContext),
        this.getPeopleCost(processId, filters, detailContext),
        this.getDirectCost(processId, filters, detailContext),
        this.getIndirectAllocation(processId, filters, detailContext),
        this.getTrend(processId, filters, detailContext),
        this.getReconciliation(processId, filters, detailContext),
        this.getLedger(processId, filters, detailContext),
      ]);

    return {
      record: detailContext.record,
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
      "Revenue Leakage",
      "Receivable Risk",
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
          record.receivableRisk.toFixed(2),
          record.reconciliationStatus,
          record.freshness ?? "",
        ].map(escape).join(",")
      ),
    ];

    return rows.join("\n");
  },
};
