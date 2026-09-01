import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import {
  allocatePoolAmount,
  calculateBpoCostWaterfall,
  calculateRevenue,
  type AllocationShare,
  type BpoBillingModel,
  type DeliveryMetricInput,
  type ManualAllocationWarning,
  type RevenueComponentInput,
  type RevenueRuleInput,
} from "./bpo-pnl.calculation.js";
import { PROCESS_BY_COST_CENTRE, getInvoicedRevenueActuals } from "./pnl-actuals.service.js";
import type { PeopleCostByKey, PnlPeopleBucket } from "./pnl-running-salary.service.js";
import { processPnlService } from "./process-pnl.service.js";
import type { PnlQueryFilters, ProcessPnlRecord } from "./process-pnl.types.js";

type NumericMap = Map<string, number>;
type AllocationDriver =
  | "direct"
  | "active_hc"
  | "billable_hc"
  | "contracted_seats"
  | "revenue"
  | "floor_area"
  | "device_count"
  | "equal"
  | "manual";
type PnlBucket =
  | "agent_salary"
  | "dsc_people"
  | "dsc_non_people"
  | "bmc_people"
  | "bmc_non_people"
  | "depreciation"
  | "amortization"
  | "finance_cost"
  | "tax"
  | "capex"
  | "excluded";

interface RevenueRuleRow extends RowDataPacket {
  id: string;
  process_id: string;
  contract_id: string | null;
  rule_name: string;
  billing_model: BpoBillingModel;
  metric_key: string;
  rate_amount: number;
  currency_code: string;
  fx_to_inr: number;
  monthly_minimum_commitment: number;
  included_units: number;
  overage_rate: number;
  mandated_seats: number | null;
  quality_gate_pct: number | null;
  sla_gate_pct: number | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  approval_reference: string | null;
}

interface DeliveryRow extends RowDataPacket {
  id: string;
  process_id: string;
  period_code: string;
  metric_key: string;
  planned_units: number;
  delivered_units: number;
  accepted_units: number;
  rejected_units: number;
  billable_units: number;
  productive_hours: number;
  login_hours: number;
  talk_minutes: number;
  quality_score: number | null;
  sla_score: number | null;
  data_source: string;
  source_reference: string;
  status: string;
  updated_at: string | null;
}

interface RevenueComponentRow extends RowDataPacket {
  id: string;
  process_id: string;
  period_code: string;
  component_type: string;
  direction: "increase" | "decrease";
  description: string;
  units: number | null;
  rate: number | null;
  amount_inr: number;
  recognition_date: string | null;
  invoice_reference: string | null;
  source_reference: string | null;
  status: string;
}

interface ClassificationRuleRow extends RowDataPacket {
  scope_type: string;
  scope_key: string;
  process_id: string | null;
  branch_id: string | null;
  pnl_bucket: PnlBucket;
  priority: number;
}

interface AllocationPolicyRow extends RowDataPacket {
  branch_id: string;
  process_id: string | null;
  pool_type: string;
  allocation_driver: AllocationDriver;
  manual_allocation_pct: number | null;
}

interface PayrollPersonRow extends RowDataPacket {
  employee_id: string;
  employee_code: string | null;
  process_id: string | null;
  branch_id: string | null;
  designation_id: string | null;
  designation_name: string | null;
  department_id: string | null;
  department_name: string | null;
  loaded_cost: number;
}

interface PeopleCostMeta {
  agentSalary: number;
  dscPeople: number;
  agentHeadcount: number;
  dscHeadcount: number;
  unclassifiedPeopleCost: number;
}

interface BudgetMeta {
  approvedBudget: number;
  reservedBudget: number;
  consumedBudget: number;
}

interface GrnVendorMeta {
  directActual: number;
  bmcAllocatedActual: number;
  itemCount: number;
}

interface CostComponentMeta {
  depreciation: number;
  amortization: number;
  financeCost: number;
  tax: number;
  otherOperatingCost: number;
  otherOperatingIncome: number;
  nonOperatingIncome: number;
  exceptionalCost: number;
  exceptionalIncome: number;
}

export interface BpoPnlRow {
  processId: string;
  processName: string;
  clientId: string | null;
  clientName: string | null;
  branchId: string | null;
  branchName: string | null;
  costCentreId: string | null;
  costCentreCode: string | null;
  billingModels: string[];
  primaryBillingModel: string | null;
  revenueDataStatus:
    | "configured"
    | "configured_no_delivery"
    | "accounting_fallback"
    | "invoiced_fallback";
  mandatedSeats: number | null;
  contractedSeats: number | null;
  requiredProductiveHc: number;
  requiredRosterHc: number;
  activeHc: number;
  agentHeadcount: number;
  supportHeadcount: number;
  billableHc: number | null;
  seatFillPct: number | null;
  billableSeatUtilizationPct: number | null;
  plannedDeliveryUnits: number;
  deliveredUnits: number;
  acceptedUnits: number;
  rejectedUnits: number;
  billableUnits: number;
  productiveHours: number;
  loginHours: number;
  talkMinutes: number;
  qualityScore: number | null;
  slaScore: number | null;
  deliveryAttainmentPct: number | null;
  acceptancePct: number | null;
  grossPotentialRevenue: number;
  baseEarnedRevenue: number;
  minimumCommitmentTopUp: number;
  incentiveRevenue: number;
  rewardRevenue: number;
  trainingRevenue: number;
  otherRevenueIncrease: number;
  penalty: number;
  slaDeduction: number;
  creditNote: number;
  otherRevenueDecrease: number;
  earnedRevenue: number;
  recognizedRevenue: number;
  invoicedRevenue: number;
  collectedRevenue: number;
  outstandingReceivable: number;
  unbilledRevenue: number;
  deferredRevenue: number;
  revenueLeakage: number;
  revenueAtRisk: number;
  revenueBudget: number | null;
  revenueVariance: number | null;
  agentSalary: number;
  averageAgentSalary: number | null;
  agentSalaryPctRevenue: number | null;
  dscPeople: number;
  dscNonPeople: number;
  dsc: number;
  dscPctRevenue: number | null;
  bmcPeople: number;
  bmcNonPeople: number;
  bmc: number;
  bmcPctRevenue: number | null;
  grnVendorActual: number;
  totalPeopleCost: number;
  peopleCostPctRevenue: number | null;
  contribution: number;
  contributionMarginPct: number | null;
  ebitda: number;
  ebitdaMarginPct: number | null;
  depreciation: number;
  amortization: number;
  ebit: number;
  operatingProfit: number;
  operatingProfitPct: number | null;
  financeCost: number;
  pbt: number;
  tax: number;
  pat: number;
  totalOperatingCost: number;
  totalCostPctRevenue: number | null;
  revenuePerAgent: number | null;
  revenuePerActiveEmployee: number | null;
  revenuePerContractedSeat: number | null;
  loadedCostPerBillableSeat: number | null;
  approvedBudget: number;
  reservedBudget: number;
  consumedBudget: number;
  availableBudget: number;
  budgetUtilizationPct: number | null;
  ebitdaBudget: number | null;
  ebitdaVariance: number | null;
  processStatus: "profitable" | "at-risk" | "loss-making";
  freshness: string | null;
}

const columnCache = new Map<string, Promise<Set<string>>>();
const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;
const placeholders = (values: unknown[]): string => values.map(() => "?").join(",");
const lower = (value: unknown): string => String(value ?? "").trim().toLowerCase();

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeFilters(filters: Partial<PnlQueryFilters>): PnlQueryFilters {
  return {
    period: filters.period && /^\d{4}-\d{2}$/.test(filters.period) ? filters.period : defaultPeriod(),
    branchId: filters.branchId,
    branchIds: filters.branchIds,
    processId: filters.processId,
    clientId: filters.clientId,
    search: filters.search,
  };
}

function monthRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(lastDay).padStart(2, "0")}`,
  };
}

/*
 * information_schema returns its keys UPPERCASED — a row arrives as { COLUMN_NAME: 'id' }, not
 * { column_name: 'id' }, however the SELECT is written. Reading row.column_name yielded undefined
 * for every row, String(undefined) made the set literally {"undefined"}, and every has() answered
 * false.
 *
 * Nothing errored. Callers simply took their "column missing" branch: gross_salary, pf_employer
 * and esic_employer collapsed to the literal "0" and branch_id/process_id to "NULL", so every
 * payroll person came back costing nothing and attributed nowhere. That is why the Process P&L
 * grid reported Rs 0 for agent salary, DSC and BMC in every month, and why reading actual payroll
 * returned an empty result and silently fell back to the snapshot.
 *
 * Aliased in the SQL so the casing is fixed at source, with a defensive read as well.
 */
async function listColumns(tableName: string): Promise<Set<string>> {
  if (!columnCache.has(tableName)) {
    columnCache.set(
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
          columnCache.delete(tableName);
          throw error;
        })
    );
  }
  return columnCache.get(tableName)!;
}

/**
 * The one failure this module tolerates: the table is not there.
 *
 * Several tables read here are optional on an older database, which is why tableExists() guards
 * appear throughout. A missing table is therefore a known shape, not a fault.
 */
const TOLERATED_QUERY_ERRORS = new Set(["ER_NO_SUCH_TABLE"]);

/**
 * Runs a query that may legitimately have no table behind it.
 *
 * It used to be `catch { return [] }` — every error, silently, with no log of any kind. That
 * backs the budget query, the vendor-actuals query, the GRN query and getPayrollPeople, so a
 * column rename or a lock-wait timeout on vendor_payment_tracking returned HTTP 200 with cost 0
 * and a spectacular EBITDA, indistinguishable from a genuinely cost-free month. The comment
 * fifty lines above this one describes the same class of incident — every payroll person costing
 * nothing because a lookup quietly answered "no" — and this function was the other way in.
 *
 * A fabricated zero on a finance screen is worse than an error: nobody investigates a number
 * that looks plausible. So a missing table still yields no rows, loudly; anything else now
 * propagates and the endpoint fails honestly.
 */
export async function safeRows<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return await queryRows<T>(sql, params);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    // First line of the statement is enough to identify which read degraded.
    const excerpt = sql.replace(/\s+/g, " ").trim().slice(0, 120);
    if (code && TOLERATED_QUERY_ERRORS.has(code)) {
      console.warn(`[bpo-pnl] ${code} — treating as no rows: ${excerpt}`);
      return [];
    }
    console.error(
      `[bpo-pnl] query failed (${code ?? "no code"}), refusing to report it as zero: ${excerpt}`
    );
    throw error;
  }
}

function normalizeBillingModel(value: string | null | undefined): BpoBillingModel {
  switch (lower(value)) {
    case "per_fte": return "per_fte";
    case "per_hour":
    case "per_productive_hour": return "per_productive_hour";
    case "per_login_hour": return "per_login_hour";
    case "per_talk_minute": return "per_talk_minute";
    case "per_transaction": return "per_transaction";
    case "per_mandate": return "per_mandate";
    case "per_case": return "per_case";
    case "fixed_monthly": return "fixed_monthly";
    case "outcome_based": return "outcome_based";
    default: return "per_seat";
  }
}

function metricKeyForModel(model: BpoBillingModel): string {
  switch (model) {
    case "per_productive_hour": return "productive_hours";
    case "per_login_hour": return "login_hours";
    case "per_talk_minute": return "talk_minutes";
    case "per_transaction": return "transactions";
    case "per_mandate": return "mandates";
    case "per_case": return "cases";
    case "fixed_monthly": return "fixed_monthly";
    case "outcome_based": return "outcomes";
    case "per_fte": return "billable_fte";
    default: return "billable_seats";
  }
}

async function getRevenueRules(processIds: string[], period: string) {
  const result = new Map<string, RevenueRuleRow[]>();
  if (processIds.length === 0 || !(await tableExists("process_revenue_rule"))) return result;
  const { start, end } = monthRange(period);
  const rows = await safeRows<RevenueRuleRow>(
    `SELECT *
       FROM process_revenue_rule
      WHERE process_id IN (${placeholders(processIds)})
        AND status = 'approved'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY process_id, effective_from DESC, created_at DESC`,
    [...processIds, end, start]
  );
  for (const row of rows) {
    const items = result.get(String(row.process_id)) ?? [];
    items.push(row);
    result.set(String(row.process_id), items);
  }
  return result;
}

async function getDeliveryActuals(processIds: string[], period: string) {
  const result = new Map<string, DeliveryRow[]>();
  if (processIds.length === 0 || !(await tableExists("process_delivery_actual"))) return result;
  const rows = await safeRows<DeliveryRow>(
    `SELECT
        MIN(id) AS id,
        process_id,
        period_code,
        metric_key,
        SUM(planned_units) AS planned_units,
        SUM(delivered_units) AS delivered_units,
        SUM(accepted_units) AS accepted_units,
        SUM(rejected_units) AS rejected_units,
        SUM(billable_units) AS billable_units,
        SUM(productive_hours) AS productive_hours,
        SUM(login_hours) AS login_hours,
        SUM(talk_minutes) AS talk_minutes,
        AVG(quality_score) AS quality_score,
        AVG(sla_score) AS sla_score,
        GROUP_CONCAT(DISTINCT data_source ORDER BY data_source SEPARATOR ', ') AS data_source,
        GROUP_CONCAT(DISTINCT source_reference ORDER BY source_reference SEPARATOR ', ') AS source_reference,
        MIN(status) AS status,
        MAX(updated_at) AS updated_at
       FROM process_delivery_actual
      WHERE process_id IN (${placeholders(processIds)})
        AND period_code = ?
        AND status IN ('validated','locked')
      GROUP BY process_id, period_code, metric_key`,
    [...processIds, period]
  );
  for (const row of rows) {
    const items = result.get(String(row.process_id)) ?? [];
    items.push(row);
    result.set(String(row.process_id), items);
  }
  return result;
}

async function getRevenueComponents(processIds: string[], period: string) {
  const result = new Map<string, RevenueComponentRow[]>();
  if (processIds.length === 0 || !(await tableExists("process_revenue_component"))) return result;
  const rows = await safeRows<RevenueComponentRow>(
    `SELECT *
       FROM process_revenue_component
      WHERE process_id IN (${placeholders(processIds)})
        AND period_code = ?
        AND status = 'approved'
      ORDER BY process_id, recognition_date, created_at`,
    [...processIds, period]
  );
  for (const row of rows) {
    const items = result.get(String(row.process_id)) ?? [];
    items.push(row);
    result.set(String(row.process_id), items);
  }
  return result;
}

async function getRewardPenaltyForPeriod(period: string): Promise<Map<string, { rewards: number; penalties: number }>> {
  const result = new Map<string, { rewards: number; penalties: number }>();
  if (!period || !(await tableExists("cost_centre_reward_penalty"))) return result;
  const rows = await safeRows<RowDataPacket>(
    `SELECT pc.process_id,
            SUM(CASE WHEN rp.entry_type = 'reward' THEN rp.amount_inr ELSE 0 END) AS rewards,
            SUM(CASE WHEN rp.entry_type = 'penalty' THEN rp.amount_inr ELSE 0 END) AS penalties
       FROM cost_centre_reward_penalty rp
       JOIN cost_centre_master ccm ON ccm.id = rp.cost_centre_id
       LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
      WHERE rp.period_code = ? AND rp.approval_status = 'approved'
      GROUP BY pc.process_id`,
    [period]
  );
  for (const row of rows) {
    if (row.process_id) {
      result.set(String(row.process_id), {
        rewards: Number(row.rewards ?? 0),
        penalties: Number(row.penalties ?? 0),
      });
    }
  }
  return result;
}

async function getMonthlyPlans(processIds: string[], period: string) {
  const result = new Map<string, RowDataPacket>();
  if (processIds.length === 0 || !(await tableExists("process_monthly_plan"))) return result;
  const columns = await listColumns("process_monthly_plan");
  const optional = [
    "planned_delivery_metric",
    "planned_delivery_units",
    "agent_salary_budget",
    "dsc_budget",
    "bmc_budget",
    "ebitda_budget",
  ].filter((column) => columns.has(column));
  const rows = await safeRows<RowDataPacket>(
    `SELECT process_id, contracted_seats, revenue_budget, profit_budget${optional.length ? `, ${optional.join(", ")}` : ""}
       FROM process_monthly_plan
      WHERE process_id IN (${placeholders(processIds)})
        AND period_code = ?
      ORDER BY FIELD(status, 'locked', 'approved', 'draft'), updated_at DESC`,
    [...processIds, period]
  );
  for (const row of rows) {
    const key = String(row.process_id);
    if (!result.has(key)) result.set(key, row);
  }
  return result;
}

async function getAllocationPolicies(period: string): Promise<AllocationPolicyRow[]> {
  if (!(await tableExists("pnl_allocation_policy"))) return [];
  const { start, end } = monthRange(period);
  return safeRows<AllocationPolicyRow>(
    `SELECT branch_id, process_id, pool_type, allocation_driver, manual_allocation_pct
       FROM pnl_allocation_policy
      WHERE status = 'approved'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY branch_id, pool_type, process_id`,
    [end, start]
  );
}

async function getClassificationRules(period: string): Promise<ClassificationRuleRow[]> {
  if (!(await tableExists("pnl_cost_classification_rule"))) return [];
  const { start, end } = monthRange(period);
  return safeRows<ClassificationRuleRow>(
    `SELECT scope_type, scope_key, process_id, branch_id, pnl_bucket, priority
       FROM pnl_cost_classification_rule
      WHERE active_status = 1
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY priority ASC, created_at ASC`,
    [end, start]
  );
}

/**
 * A5 FIX (2026-09-01): the real date real payroll data is "as of", for getActualPeopleCost().
 *
 * salary_prep_run has no single `finalized_at` column, so this takes the latest of the columns
 * that actually get stamped as a run is closed out — disbursement, then the payroll-window
 * auto-close, then finance approval, then (for a run still open) its own last update — the same
 * precedence a reader would use to answer "when was this run last touched toward being final".
 * NOW() is the last resort only when the period's runs somehow carry none of those (a run that
 * was only ever INSERTed and never updated), so the caller still gets a real date rather than
 * silently going back to null.
 */
async function getPayrollRunAsOfDate(period: string): Promise<string | null> {
  if (!(await tableExists("salary_prep_run"))) return null;
  const rows = await safeRows<RowDataPacket>(
    `SELECT MAX(COALESCE(disbursed_at, auto_closed_at, finance_approved_at, updated_at, created_at)) AS as_of
       FROM salary_prep_run
      WHERE run_month = ?`,
    [period]
  );
  const asOf = rows[0]?.as_of;
  return asOf ? new Date(asOf).toISOString() : null;
}

function isSupportRole(person: PayrollPersonRow): boolean {
  const department = lower(person.department_name);
  const designation = lower(person.designation_name);
  const supportDepartment = /(quality|training|learning|wfm|workforce|mis|human resource|\bhr\b|admin|information technology|\bit\b|finance|accounts|recruit|facility|security|maintenance|compliance|payroll)/;
  const supportDesignation = /(team leader|\btl\b|assistant manager|\bam\b|manager|supervisor|trainer|quality|auditor|wfm|mis|hr|recruiter|admin|it support|engineer|accounts|finance|facility|security|coach|sme|subject matter)/;
  return supportDepartment.test(department) || supportDesignation.test(designation);
}

function matchClassification(person: PayrollPersonRow, rules: ClassificationRuleRow[]) {
  const values: Record<string, string[]> = {
    employee: [lower(person.employee_id), lower(person.employee_code)],
    designation: [lower(person.designation_id), lower(person.designation_name)],
    department: [lower(person.department_id), lower(person.department_name)],
  };
  return rules.find((rule) => {
    if (rule.process_id && String(rule.process_id) !== String(person.process_id ?? "")) return false;
    if (rule.branch_id && String(rule.branch_id) !== String(person.branch_id ?? "")) return false;
    return (values[rule.scope_type] ?? []).includes(lower(rule.scope_key));
  }) ?? null;
}

async function getPayrollPeople(period: string): Promise<PayrollPersonRow[]> {
  if (!(await tableExists("salary_prep_run")) || !(await tableExists("salary_prep_line"))) return [];
  /*
   * EVERY run in the month. Two separate faults were compounding here.
   *
   * First the ordering. FIELD() returns 0 for any value not in its list, and the statuses this
   * table actually holds are FINALIZED, approved, draft and processing — of which the list named
   * only 'approved' and 'draft'. So FINALIZED scored 0 and sorted LAST under DESC, while 'draft'
   * scored 5 and sorted FIRST: the ranking preferred a draft run over a finalized one and was
   * inverted from its evident intent.
   *
   * Then the LIMIT 1 itself. salary_prep_run is keyed (run_month, branch_filter, process_filter),
   * so a month legitimately holds several runs covering different cohorts. 2026-03 holds two
   * with ZERO employees in common — 1,140 and 226, measured against production. Combining both
   * faults, this function reported March people cost as the 226-employee run's Rs 20,44,862.56
   * against a true Rs 2,37,71,979.56: a 91.4% under-report, and the same table read by
   * ceo-overview.service.ts gave the right answer on the same screen refresh.
   *
   * The SELECT below already groups by e.id, so an employee appearing in more than one run is
   * summed once per employee rather than emitted twice.
   */
  const runs = await safeRows<RowDataPacket>(
    `SELECT id
       FROM salary_prep_run
      WHERE run_month = ?`,
    [period]
  );
  if (!runs.length) return [];
  const runIds = runs.map((row) => String(row.id));

  const salaryColumns = await listColumns("salary_prep_line");
  const employeeColumns = await listColumns("employees");
  const costCentreColumns = (await tableExists("cost_centre_master"))
    ? await listColumns("cost_centre_master")
    : new Set<string>();
  const designationExists = await tableExists("designation_master");
  const departmentExists = await tableExists("department_master");
  const departmentColumns = departmentExists ? await listColumns("department_master") : new Set<string>();

  const grossExpr = salaryColumns.has("gross_salary") ? "COALESCE(spl.gross_salary, 0)" : "0";
  const pfExpr = salaryColumns.has("pf_employer") ? "COALESCE(spl.pf_employer, 0)" : "0";
  const esicExpr = salaryColumns.has("esic_employer") ? "COALESCE(spl.esic_employer, 0)" : "0";
  const gratuityExpr = salaryColumns.has("gratuity")
    ? "COALESCE(spl.gratuity, 0)"
    : salaryColumns.has("basic")
    ? "COALESCE(spl.basic, 0) * 0.0481"
    : "0";
  /*
   * Process resolved via two sources in order:
   *   1. employees.process_id — set directly on the employee (most agents and DSC staff)
   *   2. cost_centre_master.process_id — the process that owns this employee's cost centre
   *
   * Every employee has a cost_centre_id set (100% mapped per production data). The cost_centre
   * carries process_id. COALESCE ensures BMC/support staff whose employees.process_id is NULL
   * are resolved to a process via their cost centre rather than falling to the branch pool.
   * Without this, those employees could not be allocated to any process (allocation policies
   * table is empty) and their salary was silently excluded from the canonical P&L.
   */
  const hasCostCentreId = employeeColumns.has("cost_centre_id") && costCentreColumns.has("process_id");
  const ccJoin = hasCostCentreId
    ? "LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id"
    : "";
  const processExpr = employeeColumns.has("process_id")
    ? (hasCostCentreId ? "COALESCE(e.process_id, ccm.process_id)" : "e.process_id")
    : "NULL";
  const branchExpr = employeeColumns.has("branch_id") ? "e.branch_id" : "NULL";
  const designationIdExpr = employeeColumns.has("designation_id") ? "e.designation_id" : "NULL";
  const departmentIdExpr = employeeColumns.has("department_id") ? "e.department_id" : "NULL";
  const designationJoin = designationExists && employeeColumns.has("designation_id")
    ? "LEFT JOIN designation_master d ON d.id = e.designation_id"
    : "";
  const departmentJoin = departmentExists && employeeColumns.has("department_id")
    ? "LEFT JOIN department_master dep ON dep.id = e.department_id"
    : "";
  const designationNameExpr = designationJoin ? "d.designation_name" : "NULL";
  const departmentNameExpr = departmentJoin
    ? departmentColumns.has("dept_name")
      ? "dep.dept_name"
      : departmentColumns.has("department_name")
      ? "dep.department_name"
      : "NULL"
    : "NULL";

  return safeRows<PayrollPersonRow>(
    `SELECT
        e.id AS employee_id,
        e.employee_code,
        ${processExpr} AS process_id,
        ${branchExpr} AS branch_id,
        ${designationIdExpr} AS designation_id,
        ${designationNameExpr} AS designation_name,
        ${departmentIdExpr} AS department_id,
        ${departmentNameExpr} AS department_name,
        SUM(${grossExpr} + ${pfExpr} + ${esicExpr} + ${gratuityExpr}) AS loaded_cost
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       ${ccJoin}
       ${designationJoin}
       ${departmentJoin}
      WHERE spl.run_id IN (${runIds.map(() => "?").join(", ")})
      GROUP BY e.id, e.employee_code, process_id, branch_id, designation_id, designation_name, department_id, department_name`,
    runIds
  );
}

function policyFor(
  policies: AllocationPolicyRow[],
  branchId: string,
  poolType: string,
  processId?: string
) {
  return policies.find((policy) =>
    String(policy.branch_id) === branchId
    && policy.pool_type === poolType
    && (processId ? String(policy.process_id ?? "") === processId : !policy.process_id)
  );
}

/**
 * Drivers the Process-P&L allocator can actually satisfy from ProcessPnlRecord.
 *
 * floor_area and device_count are deliberately absent. They are declared in the AllocationDriver
 * union but no per-process floor area or device count exists anywhere in this module, so a policy
 * configured with either used to fall through the switch's `default` and be split by ACTIVE
 * HEADCOUNT instead — the wrong basis, applied silently, with the policy still displaying the
 * driver the user chose. (The floor_area_sqft / device_count columns added in migration 434 are
 * per COST CENTRE per period, for branch budgets — a different grain, not usable here.)
 */
export const SUPPORTED_ALLOCATION_DRIVERS = [
  "direct", "active_hc", "billable_hc", "contracted_seats", "revenue", "equal", "manual",
] as const;

export function isSupportedAllocationDriver(driver: string): boolean {
  return (SUPPORTED_ALLOCATION_DRIVERS as readonly string[]).includes(driver);
}

function allocationDriverValue(row: ProcessPnlRecord, driver: AllocationDriver): number {
  switch (driver) {
    case "billable_hc": return toNumber(row.billableHc);
    case "contracted_seats": return toNumber(row.contractedSeats);
    case "revenue": return toNumber(row.revenueMtd);
    case "equal": return 1;
    // Named explicitly rather than left to `default`, so the substitution is a visible decision in
    // the code instead of an accident. New policies using these are refused at save time; this
    // path only exists for rows saved before that validation.
    case "floor_area":
    case "device_count":
    case "active_hc":
    default: return toNumber(row.activeHc);
  }
}

export function allocateBranchPools<T extends { amount: number }>(
  baseRows: ProcessPnlRecord[],
  pools: ReadonlyMap<string, T>,
  policies: AllocationPolicyRow[],
  poolType: string,
  warnings?: ManualAllocationWarning[]
): NumericMap {
  const result = new Map<string, number>();
  const byBranch = new Map<string, ProcessPnlRecord[]>();
  for (const row of baseRows) {
    if (!row.branchId) continue;
    const rows = byBranch.get(row.branchId) ?? [];
    rows.push(row);
    byBranch.set(row.branchId, rows);
  }

  for (const [branchId, rows] of byBranch.entries()) {
    const poolAmount = toNumber(pools.get(branchId)?.amount);
    if (poolAmount <= 0 || rows.length === 0) continue;
    const branchPolicy = policyFor(policies, branchId, poolType);
    const processPolicies = rows.map((row) => policyFor(policies, branchId, poolType, row.processId));
    const usesManual = processPolicies.some((policy) => policy?.allocation_driver === "manual");

    if (usesManual) {
      const shares: AllocationShare[] = rows.map((row, index) => ({
        key: row.processId,
        weight: toNumber(processPolicies[index]?.manual_allocation_pct),
      }));
      const outcome = allocatePoolAmount(poolAmount, shares, "manual_percentage");
      if (!outcome.balanced) {
        console.warn(
          `[bpo-pnl] manual allocation for branch ${branchId} / pool ${poolType} sums to ` +
          `${outcome.percentTotal}% (expected 100%) — amounts are applied as configured, not rebalanced.`
        );
        warnings?.push({ branchId, poolType, percentTotal: outcome.percentTotal ?? 0 });
      }
      for (const [processId, amount] of outcome.amounts) result.set(processId, amount);
      continue;
    }

    const driver = branchPolicy?.allocation_driver ?? "active_hc";
    const shares: AllocationShare[] = rows.map((row) => ({
      key: row.processId,
      weight: allocationDriverValue(row, driver),
    }));
    const outcome = allocatePoolAmount(poolAmount, shares, driver === "equal" ? "equal" : "weighted");
    for (const [processId, amount] of outcome.amounts) result.set(processId, amount);
  }
  return result;
}

/**
 * Approved per-employee cost-centre splits for the period, resolved to PROCESSES.
 *
 * Support staff who serve several cost centres are pooled at branch level today and spread by
 * the allocation driver, which is a reasonable guess and nothing more. Where finance has
 * recorded what someone actually splits across, the guess should not be used at all.
 *
 * The cost centre is mapped to a process by the same modal-employee rule the actuals use
 * (cost_centre_master.process_id is NULL on all 927 rows, so there is no FK to follow). A share
 * pointing at a cost centre with no derivable process is dropped HERE and left in the branch
 * pool by the caller, because posting it nowhere would quietly delete salary.
 */
async function getApprovedCostCentreSplits(
  period: string
): Promise<Map<string, { processId: string; pct: number }[]>> {
  const splits = new Map<string, { processId: string; pct: number }[]>();
  if (!(await tableExists("employee_cost_centre_allocation"))) return splits;
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return splits;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.employee_id, a.allocation_pct, pc.process_id
       FROM employee_cost_centre_allocation a
       LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = a.cost_centre_id
      WHERE a.status = 'approved'
        AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to >= ?)`,
    [periodEnd, periodEnd]
  );
  for (const row of rows) {
    if (!row.process_id) continue;
    const key = String(row.employee_id);
    const list = splits.get(key) ?? [];
    list.push({ processId: String(row.process_id), pct: toNumber(row.allocation_pct) });
    splits.set(key, list);
  }
  return splits;
}

/**
 * People cost from ACTUAL PAYROLL, in the shape the statement consumes.
 *
 * WHY THIS EXISTS. The statement reads pnl_running_salary_snapshot, which is a RECOMPUTATION —
 * it holds only the employees computeRunningSalary can reproduce for the period. Measured against
 * what payroll actually paid:
 *
 *   April   snapshot Rs 112.11 lakh   salary_prep_line Rs 221.65 lakh (1,085 people)
 *   June    snapshot Rs 141.23 lakh   salary_prep_line Rs 227.88 lakh (1,530 people)
 *
 * About half the wage bill was missing, and it lands in Operating Profit as though it were margin:
 * June reported a 42.9% operating margin for a BPO that runs at 10-30%. Substituting actual
 * payroll puts June at 16.2% and April at 9.7%.
 *
 * salary_prep_line is what was paid. It needs no recomputation and cannot omit a leaver.
 *
 * The bucket split is the snapshot's real contribution, so it is reproduced here with the SAME
 * inputs the process-level engine uses — getPayrollPeople, getClassificationRules,
 * matchClassification and isSupportRole — rather than a second classifier that could drift from
 * it. An employee with no process falls to bmc_people exactly as in getPeopleCosts.
 *
 * Coverage is reported honestly: every person in the payroll run is by definition covered, so
 * coverage is 100% wherever payroll ran. That is not a way of hiding the gap — the gap WAS the
 * snapshot's partial population, and reading payroll directly removes it.
 */
export async function getActualPeopleCost(period: string): Promise<PeopleCostByKey> {
  const out: PeopleCostByKey = {
    byBranch: new Map(),
    byProcess: new Map(),
    coverageByBranch: new Map(),
    coverageByProcess: new Map(),
    asOfDate: null,
  };
  if (!/^\d{4}-\d{2}$/.test(period)) return out;

  const [people, rules] = await Promise.all([getPayrollPeople(period), getClassificationRules(period)]);
  if (people.length === 0) return out;
  /*
   * A5 FIX (2026-09-01): stamp a real asOfDate whenever real salary_prep_line payroll data is
   * being used (people.length > 0, just confirmed above) instead of leaving it hardcoded null.
   * pnl-statement.service.ts's StatementColumn.peopleCostAsOf / the "No people-cost snapshot"
   * amber warning read this field to decide whether the people-cost figure is trustworthy — with
   * it always null, a column backed by real finalized payroll still displayed the warning as if
   * no data existed at all. getPayrollRunAsOfDate() falls back to NOW() only if the period's runs
   * somehow carry no date at all, so this is never null again once real rows are present.
   */
  out.asOfDate = (await getPayrollRunAsOfDate(period)) ?? new Date().toISOString();

  const empty = (): Record<PnlPeopleBucket, number> =>
    ({ agent_salary: 0, dsc_people: 0, bmc_people: 0 });

  for (const person of people) {
    const cost = toNumber(person.loaded_cost);
    const configured = matchClassification(person, rules)?.pnl_bucket;
    const bucket: PnlBucket = configured
      ?? (person.process_id ? (isSupportRole(person) ? "dsc_people" : "agent_salary") : "bmc_people");

    if (person.branch_id) {
      const key = String(person.branch_id);
      const bucketsForBranch = out.byBranch.get(key) ?? empty();
      bucketsForBranch[bucket] += cost;
      out.byBranch.set(key, bucketsForBranch);
      const cov = out.coverageByBranch.get(key) ?? { activeEmployees: 0, coveredEmployees: 0 };
      cov.activeEmployees += 1;
      cov.coveredEmployees += 1;
      out.coverageByBranch.set(key, cov);
    }
    if (person.process_id) {
      const key = String(person.process_id);
      const bucketsForProcess = out.byProcess.get(key) ?? empty();
      bucketsForProcess[bucket] += cost;
      out.byProcess.set(key, bucketsForProcess);
      const cov = out.coverageByProcess.get(key) ?? { activeEmployees: 0, coveredEmployees: 0 };
      cov.activeEmployees += 1;
      cov.coveredEmployees += 1;
      out.coverageByProcess.set(key, cov);
    }
  }
  return out;
}

async function getPeopleCosts(
  baseRows: ProcessPnlRecord[],
  period: string,
  policies: AllocationPolicyRow[],
  warnings?: ManualAllocationWarning[]
) {
  const processMap = new Map<string, PeopleCostMeta>();
  const branchPool = new Map<string, { amount: number; headcount: number }>();
  const [people, rules, splits] = await Promise.all([
    getPayrollPeople(period), getClassificationRules(period), getApprovedCostCentreSplits(period),
  ]);
  /** BMC cost posted straight to a process by an approved split, bypassing the branch pool. */
  const directBmcByProcess = new Map<string, number>();

  for (const person of people) {
    const cost = toNumber(person.loaded_cost);
    const configuredBucket = matchClassification(person, rules)?.pnl_bucket;
    const bucket: PnlBucket = configuredBucket
      ?? (person.process_id ? (isSupportRole(person) ? "dsc_people" : "agent_salary") : "bmc_people");

    if (person.process_id && (bucket === "agent_salary" || bucket === "dsc_people")) {
      const key = String(person.process_id);
      const current = processMap.get(key) ?? {
        agentSalary: 0,
        dscPeople: 0,
        agentHeadcount: 0,
        dscHeadcount: 0,
        unclassifiedPeopleCost: 0,
      };
      if (bucket === "agent_salary") {
        current.agentSalary += cost;
        current.agentHeadcount += 1;
      } else {
        current.dscPeople += cost;
        current.dscHeadcount += 1;
      }
      processMap.set(key, current);
      continue;
    }

    if (bucket === "bmc_people") {
      /*
       * PEEL BEFORE POOLING. Anyone with an approved split is posted directly and must NOT also
       * enter the branch pool, or their cost is counted twice — once directly and again as a
       * share of the pool. The two paths are disjoint by construction, which is what keeps
       * total people cost identical whether or not splits exist.
       *
       * allocatePoolAmount does the arithmetic so the shares reconcile to the paisa, and it
       * deliberately does not renormalise an unbalanced set: if finance approved rows summing to
       * 90%, the missing 10% surfaces as a warning and the remainder stays in the pool rather
       * than being silently inflated to make the total look right.
       */
      const split = splits.get(String(person.employee_id));
      if (split && split.length > 0) {
        const outcome = allocatePoolAmount(
          cost,
          split.map((s) => ({ key: s.processId, weight: s.pct })),
          "manual_percentage"
        );
        let posted = 0;
        for (const [processId, amount] of outcome.amounts.entries()) {
          directBmcByProcess.set(processId, (directBmcByProcess.get(processId) ?? 0) + amount);
          posted += amount;
        }
        if (!outcome.balanced && warnings) {
          // The employee id travels in poolType because ManualAllocationWarning has no field for
          // it; without that the reader gets a percentage and no way to find whose split is wrong.
          warnings.push({
            branchId: person.branch_id ? String(person.branch_id) : "",
            poolType: `bmc_people_split:${person.employee_id}`,
            percentTotal: outcome.percentTotal ?? 0,
          });
        }
        // Whatever the split did not cover falls back to the pool; nothing is dropped.
        const remainder = cost - posted;
        if (Math.abs(remainder) > 0.005 && person.branch_id) {
          const key = String(person.branch_id);
          const current = branchPool.get(key) ?? { amount: 0, headcount: 0 };
          current.amount += remainder;
          branchPool.set(key, current);
        }
        continue;
      }

      if (person.branch_id) {
        const key = String(person.branch_id);
        const current = branchPool.get(key) ?? { amount: 0, headcount: 0 };
        current.amount += cost;
        current.headcount += 1;
        branchPool.set(key, current);
      }
    }
  }

  for (const row of baseRows) {
    const current = processMap.get(row.processId) ?? {
      agentSalary: 0,
      dscPeople: 0,
      agentHeadcount: 0,
      dscHeadcount: 0,
      unclassifiedPeopleCost: 0,
    };
    const classified = current.agentSalary + current.dscPeople;
    const residual = Math.max(0, toNumber(row.directPeopleCost) - classified);
    if (classified <= 0 && row.directPeopleCost > 0) {
      current.agentSalary = row.directPeopleCost;
      current.agentHeadcount = Math.max(1, row.activeHc);
    } else if (residual > 0.5) {
      current.dscPeople += residual;
      current.unclassifiedPeopleCost += residual;
    }
    processMap.set(row.processId, current);
  }

  const bmcPeopleByProcess = allocateBranchPools(baseRows, branchPool, policies, "bmc_people", warnings);
  for (const [processId, amount] of directBmcByProcess.entries()) {
    bmcPeopleByProcess.set(processId, (bmcPeopleByProcess.get(processId) ?? 0) + amount);
  }

  return {
    processMap,
    bmcPeopleByProcess,
    branchPool,
    people,
  };
}

function emptyCostComponent(): CostComponentMeta {
  return {
    depreciation: 0,
    amortization: 0,
    financeCost: 0,
    tax: 0,
    otherOperatingCost: 0,
    otherOperatingIncome: 0,
    nonOperatingIncome: 0,
    exceptionalCost: 0,
    exceptionalIncome: 0,
  };
}

function addCostComponent(target: CostComponentMeta, type: string, amount: number) {
  switch (type) {
    case "depreciation": target.depreciation += amount; break;
    case "amortization": target.amortization += amount; break;
    case "finance_cost": target.financeCost += amount; break;
    case "tax": target.tax += amount; break;
    case "other_operating_cost": target.otherOperatingCost += amount; break;
    case "other_operating_income": target.otherOperatingIncome += amount; break;
    case "non_operating_income": target.nonOperatingIncome += amount; break;
    case "exceptional_cost": target.exceptionalCost += amount; break;
    case "exceptional_income": target.exceptionalIncome += amount; break;
    default: break;
  }
}

async function getCostComponents(
  baseRows: ProcessPnlRecord[],
  period: string,
  policies: AllocationPolicyRow[],
  warnings?: ManualAllocationWarning[]
) {
  const result = new Map<string, CostComponentMeta>();
  if (!(await tableExists("process_pnl_cost_component"))) return result;
  const rows = await safeRows<RowDataPacket>(
    `SELECT process_id, branch_id, cost_type, amount_inr, allocation_driver, manual_allocation_pct
       FROM process_pnl_cost_component
      WHERE period_code = ?
        AND status = 'approved'`,
    [period]
  );
  const branchPools = new Map<string, { amount: number }>();
  const branchTypes = new Set<string>();

  for (const row of rows) {
    const amount = toNumber(row.amount_inr);
    if (row.process_id) {
      const key = String(row.process_id);
      const current = result.get(key) ?? emptyCostComponent();
      addCostComponent(current, String(row.cost_type), amount);
      result.set(key, current);
    } else if (row.branch_id) {
      const key = `${row.branch_id}|${row.cost_type}`;
      const current = branchPools.get(key) ?? { amount: 0 };
      current.amount += amount;
      branchPools.set(key, current);
      branchTypes.add(String(row.cost_type));
    }
  }

  for (const type of branchTypes) {
    const pools = new Map<string, { amount: number }>();
    for (const [key, value] of branchPools.entries()) {
      const separator = key.indexOf("|");
      const branchId = key.slice(0, separator);
      const costType = key.slice(separator + 1);
      if (costType === type) pools.set(branchId, value);
    }
    const allocated = allocateBranchPools(baseRows, pools, policies, "shared_service", warnings);
    for (const [processId, amount] of allocated.entries()) {
      const current = result.get(processId) ?? emptyCostComponent();
      addCostComponent(current, type, amount);
      result.set(processId, current);
    }
  }
  return result;
}

async function getBudgets(
  baseRows: ProcessPnlRecord[],
  period: string,
  policies: AllocationPolicyRow[],
  warnings?: ManualAllocationWarning[]
): Promise<Map<string, BudgetMeta>> {
  const result = new Map<string, BudgetMeta>();
  if (!(await tableExists("finance_budget_header")) || !(await tableExists("finance_budget_line"))) return result;
  const costCentreColumns = await listColumns("cost_centre_master").catch(() => new Set<string>());
  const processExpr = costCentreColumns.has("process_id") ? "COALESCE(fbl.process_id, ccm.process_id)" : "fbl.process_id";
  const rows = await safeRows<RowDataPacket>(
    `SELECT
        fbh.branch_id,
        ${processExpr} AS process_id,
        SUM(COALESCE(fbl.gross_amount, 0)) AS approved_budget,
        SUM(COALESCE(fbl.reserved_amount, 0)) AS reserved_budget,
        SUM(COALESCE(fbl.consumed_amount, 0)) AS consumed_budget
       -- 'closed' is deliberately NOT in the status filter below. branchBudgetService's
       -- deleteOrSupersede writes exactly that status when a budget is superseded because GRN
       -- activity exists against it, and saveDraft then creates a REPLACEMENT budget for the
       -- same branch and period. Counting both reported the branch's approved budget at roughly
       -- twice its real figure and halved every variance derived from it. Spend already booked
       -- against a superseded budget still reaches the P&L through the GRN allocations, which
       -- are read separately; it is only the budget ceiling that must not be counted twice.
       FROM finance_budget_header fbh
       JOIN finance_budget_line fbl ON fbl.budget_id = fbh.id
       LEFT JOIN cost_centre_master ccm ON ccm.id = fbl.cost_centre_id
      WHERE fbh.period_code = ?
        AND fbh.status IN ('finance_head_approved','accounts_head_approved','active')
      GROUP BY fbh.branch_id, process_id`,
    [period]
  );

  const branchApproved = new Map<string, { amount: number }>();
  const branchReserved = new Map<string, { amount: number }>();
  const branchConsumed = new Map<string, { amount: number }>();
  for (const row of rows) {
    if (row.process_id) {
      /*
       * ACCUMULATE, do not assign.
       *
       * The query groups by (branch_id, process_id), so a process budgeted in more than one
       * branch produces one row per branch. `result.set(...)` kept only whichever arrived last
       * and silently discarded the rest — a process running in two branches reported one
       * branch's budget as its whole approved budget, and every budget-vs-actual variance
       * derived from it was wrong by the amount dropped.
       *
       * The vendor-actuals loop further down this file already does `current.amount += ...`
       * for the same shape, so the two halves of the same report disagreed with each other.
       * No live data exercises this yet (no process is currently budgeted in two branches),
       * which is why it has never been visible.
       */
      const processId = String(row.process_id);
      const current = result.get(processId)
        ?? { approvedBudget: 0, reservedBudget: 0, consumedBudget: 0 };
      current.approvedBudget += toNumber(row.approved_budget);
      current.reservedBudget += toNumber(row.reserved_budget);
      current.consumedBudget += toNumber(row.consumed_budget);
      result.set(processId, current);
    } else if (row.branch_id) {
      const branchId = String(row.branch_id);
      branchApproved.set(branchId, { amount: toNumber(row.approved_budget) });
      branchReserved.set(branchId, { amount: toNumber(row.reserved_budget) });
      branchConsumed.set(branchId, { amount: toNumber(row.consumed_budget) });
    }
  }

  const allocatedApproved = allocateBranchPools(baseRows, branchApproved, policies, "bmc_non_people", warnings);
  const allocatedReserved = allocateBranchPools(baseRows, branchReserved, policies, "bmc_non_people", warnings);
  const allocatedConsumed = allocateBranchPools(baseRows, branchConsumed, policies, "bmc_non_people", warnings);
  for (const row of baseRows) {
    const current = result.get(row.processId) ?? { approvedBudget: 0, reservedBudget: 0, consumedBudget: 0 };
    current.approvedBudget += allocatedApproved.get(row.processId) ?? 0;
    current.reservedBudget += allocatedReserved.get(row.processId) ?? 0;
    current.consumedBudget += allocatedConsumed.get(row.processId) ?? 0;
    result.set(row.processId, current);
  }
  return result;
}

function actualVendorStatusExpr(columns: Set<string>) {
  if (!columns.has("payment_status")) return "1=1";
  return `LOWER(REPLACE(COALESCE(vpt.payment_status, ''), '_', ' ')) IN (
    'payment pending','pending','approved','posted','scheduled','payment scheduled',
    'partially paid','paid','closed'
  )`;
}

async function getGrnVendorActuals(
  baseRows: ProcessPnlRecord[],
  period: string,
  policies: AllocationPolicyRow[],
  warnings?: ManualAllocationWarning[]
): Promise<Map<string, GrnVendorMeta>> {
  const direct = new Map<string, { amount: number; count: number }>();
  const branchPools = new Map<string, { amount: number }>();
  const branchCounts = new Map<string, number>();
  const costCentreColumns = await listColumns("cost_centre_master").catch(() => new Set<string>());
  const resolveProcess = (alias: string) => costCentreColumns.has("process_id")
    ? `COALESCE(${alias}.process_id, ccm.process_id)`
    : `${alias}.process_id`;

  if (await tableExists("vendor_payment_tracking")) {
    const columns = await listColumns("vendor_payment_tracking");
    const amountExpr = columns.has("pnl_cost_amount")
      ? "COALESCE(vpt.pnl_cost_amount, vpt.due_amount, 0)"
      : "COALESCE(vpt.due_amount, 0)";
    const recognitionExpr = columns.has("recognition_period")
      ? "COALESCE(vpt.recognition_period, DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m'))"
      : "DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m')";
    const bucketExpr = columns.has("pnl_bucket")
      ? "COALESCE(vpt.pnl_bucket, CASE WHEN vpt.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END)"
      : "CASE WHEN vpt.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END";
    // GROUP BY through a derived table, not by the raw alias names: vendor_payment_tracking
    // carries real columns named process_id and pnl_bucket, so `GROUP BY ... process_id,
    // pnl_bucket` resolved to those raw columns rather than the COALESCE/CASE aliases above
    // them (SQL prefers a real column over a same-named SELECT alias) — every row whose
    // vpt.pnl_bucket was NULL fell into one NULL group whose CASE-derived bucket still depends
    // on vpt.cost_class, so MySQL rightly refused it under only_full_group_by (ER_WRONG_FIELD_
    // WITH_GROUP), and the whole /pnl/bpo/summary and /pnl/bpo/export endpoints 500'd. A derived
    // table gives the outer GROUP BY columns that cannot collide with any real table column.
    const rows = await safeRows<RowDataPacket>(
      `SELECT branch_id, process_id, pnl_bucket, SUM(amount) AS amount, SUM(item_count) AS item_count
         FROM (
           SELECT
               vpt.branch_id AS branch_id,
               ${resolveProcess("vpt")} AS process_id,
               ${bucketExpr} AS pnl_bucket,
               ${amountExpr} AS amount,
               1 AS item_count
             FROM vendor_payment_tracking vpt
             LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
            WHERE ${recognitionExpr} = ?
              AND ${actualVendorStatusExpr(columns)}
         ) x
        GROUP BY branch_id, process_id, pnl_bucket`,
      [period]
    );
    for (const row of rows) {
      const isDirect = String(row.pnl_bucket) === "dsc_non_people" || Boolean(row.process_id);
      if (isDirect && row.process_id) {
        const key = String(row.process_id);
        const current = direct.get(key) ?? { amount: 0, count: 0 };
        current.amount += toNumber(row.amount);
        current.count += toNumber(row.item_count);
        direct.set(key, current);
      } else if (row.branch_id) {
        const key = String(row.branch_id);
        const current = branchPools.get(key) ?? { amount: 0 };
        current.amount += toNumber(row.amount);
        branchPools.set(key, current);
        branchCounts.set(key, (branchCounts.get(key) ?? 0) + toNumber(row.item_count));
      }
    }
  }

  if (await tableExists("grn_request")) {
    const columns = await listColumns("grn_request");
    const amountExpr = columns.has("pnl_cost_amount")
      ? "COALESCE(g.pnl_cost_amount, g.amount, 0)"
      : "COALESCE(g.amount, 0)";
    const recognitionExpr = columns.has("recognition_period")
      ? "COALESCE(g.recognition_period, DATE_FORMAT(COALESCE(g.bill_date, g.reviewed_at, g.created_at), '%Y-%m'))"
      : "DATE_FORMAT(COALESCE(g.bill_date, g.reviewed_at, g.created_at), '%Y-%m')";
    const bucketExpr = columns.has("pnl_bucket")
      ? "COALESCE(g.pnl_bucket, CASE WHEN g.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END)"
      : "CASE WHEN g.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END";
    // Same derived-table fix as the vendor_payment_tracking query above, and for the identical
    // reason: grn_request also carries real process_id/pnl_bucket columns that shadowed the
    // COALESCE/CASE aliases in a raw GROUP BY.
    const rows = await safeRows<RowDataPacket>(
      `SELECT branch_id, process_id, pnl_bucket, SUM(amount) AS amount, SUM(item_count) AS item_count
         FROM (
           SELECT
               g.branch_id AS branch_id,
               ${resolveProcess("g")} AS process_id,
               ${bucketExpr} AS pnl_bucket,
               ${amountExpr} AS amount,
               1 AS item_count
             FROM grn_request g
             LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
             LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = g.id
            WHERE ${recognitionExpr} = ?
              AND LOWER(REPLACE(COALESCE(g.status, ''), '_', ' ')) IN (
                'approved','finance head approved','pending accounts payment','payment scheduled',
                'partially paid','paid','posted'
              )
              AND vpt.id IS NULL
         ) x
        GROUP BY branch_id, process_id, pnl_bucket`,
      [period]
    );
    for (const row of rows) {
      const isDirect = String(row.pnl_bucket) === "dsc_non_people" || Boolean(row.process_id);
      if (isDirect && row.process_id) {
        const key = String(row.process_id);
        const current = direct.get(key) ?? { amount: 0, count: 0 };
        current.amount += toNumber(row.amount);
        current.count += toNumber(row.item_count);
        direct.set(key, current);
      } else if (row.branch_id) {
        const key = String(row.branch_id);
        const current = branchPools.get(key) ?? { amount: 0 };
        current.amount += toNumber(row.amount);
        branchPools.set(key, current);
        branchCounts.set(key, (branchCounts.get(key) ?? 0) + toNumber(row.item_count));
      }
    }
  }

  const allocatedBmc = allocateBranchPools(baseRows, branchPools, policies, "bmc_non_people", warnings);
  const result = new Map<string, GrnVendorMeta>();
  for (const row of baseRows) {
    const directMeta = direct.get(row.processId) ?? { amount: 0, count: 0 };
    result.set(row.processId, {
      directActual: directMeta.amount,
      bmcAllocatedActual: allocatedBmc.get(row.processId) ?? 0,
      itemCount: directMeta.count + (row.branchId ? branchCounts.get(row.branchId) ?? 0 : 0),
    });
  }
  return result;
}

async function getCostCentres(processIds: string[]) {
  const result = new Map<string, { id: string; code: string | null }>();
  if (processIds.length === 0 || !(await tableExists("cost_centre_master"))) return result;
  const columns = await listColumns("cost_centre_master");
  if (!columns.has("process_id")) return result;
  const codeExpr = columns.has("cost_centre_code") ? "cost_centre_code" : columns.has("code") ? "code" : "NULL";
  const orderExpr = columns.has("updated_at") ? "updated_at DESC" : "id";
  const rows = await safeRows<RowDataPacket>(
    `SELECT id, process_id, ${codeExpr} AS cost_centre_code
       FROM cost_centre_master
      WHERE process_id IN (${placeholders(processIds)})
        AND COALESCE(active_status, 1) = 1
      ORDER BY ${orderExpr}`,
    processIds
  );
  for (const row of rows) {
    const key = String(row.process_id);
    if (!result.has(key)) {
      result.set(key, {
        id: String(row.id),
        code: row.cost_centre_code ? String(row.cost_centre_code) : null,
      });
    }
  }
  return result;
}

function componentAmount(rows: RevenueComponentRow[], type: string, direction?: "increase" | "decrease") {
  return rows
    .filter((row) => row.component_type === type && (!direction || row.direction === direction))
    .reduce((sum, row) => sum + toNumber(row.amount_inr), 0);
}

function otherComponentAmount(
  rows: RevenueComponentRow[],
  direction: "increase" | "decrease",
  excluded: string[]
) {
  return rows
    .filter((row) => row.direction === direction && !excluded.includes(row.component_type))
    .reduce((sum, row) => sum + toNumber(row.amount_inr), 0);
}

function potentialRevenue(rules: RevenueRuleInput[], deliveries: DeliveryMetricInput[]) {
  const deliveryMap = new Map(deliveries.map((delivery) => [delivery.metricKey, delivery]));
  return rules.reduce((sum, rule) => {
    const fx = toNumber(rule.fxToInr, 1) || 1;
    const rate = toNumber(rule.rateAmount) * fx;
    if (rule.billingModel === "fixed_monthly") {
      return sum + Math.max(rate, toNumber(rule.monthlyMinimumCommitment) * fx);
    }
    const planned = toNumber(deliveryMap.get(rule.metricKey)?.plannedUnits || rule.mandatedSeats);
    const included = toNumber(rule.includedUnits);
    const overageRate = toNumber(rule.overageRate) > 0 ? toNumber(rule.overageRate) * fx : rate;
    const calculated = included > 0 && planned > included
      ? included * rate + (planned - included) * overageRate
      : planned * rate;
    return sum + Math.max(calculated, toNumber(rule.monthlyMinimumCommitment) * fx);
  }, 0);
}

function averageNullable(values: Array<number | null | undefined>): number | null {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  return usable.length > 0 ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function statusFrom(row: {
  ebitda: number;
  recognizedRevenue: number;
  revenueAtRisk: number;
  deliveryAttainmentPct: number | null;
}) {
  if (row.ebitda < 0) return "loss-making" as const;
  if (
    row.recognizedRevenue <= 0
    || row.revenueAtRisk > 0
    || (row.deliveryAttainmentPct != null && row.deliveryAttainmentPct < 90)
  ) return "at-risk" as const;
  return "profitable" as const;
}

async function buildRows(filters: Partial<PnlQueryFilters>) {
  const normalized = normalizeFilters(filters);
  const baseRows = await processPnlService.listProcesses(normalized);
  const processIds = baseRows.map((row) => row.processId);
  const policies = await getAllocationPolicies(normalized.period);
  const warnings: ManualAllocationWarning[] = [];
  /*
   * What clients were actually invoiced, as the last-resort revenue source.
   *
   * The tiers above it are empty in production: process_revenue_rule and process_delivery_actual
   * hold zero rows and base.revenueMtd is 0, so every process resolved to Rs 0 revenue. That was
   * survivable while the cost side was also zero, but the information_schema fix revived people
   * cost — leaving Rs 241.97 lakh of cost against no revenue and an EBITDA of MINUS Rs 242 lakh.
   * A plausible-looking catastrophe is worse than an obvious blank.
   */
  const [rulesMap, deliveryMap, componentsMap, plans, people, costComponents, budgets, grnActuals, costCentres, invoiced, rpByProcess, actualPeople] = await Promise.all([
    getRevenueRules(processIds, normalized.period),
    getDeliveryActuals(processIds, normalized.period),
    getRevenueComponents(processIds, normalized.period),
    getMonthlyPlans(processIds, normalized.period),
    getPeopleCosts(baseRows, normalized.period, policies, warnings),
    getCostComponents(baseRows, normalized.period, policies, warnings),
    getBudgets(baseRows, normalized.period, policies, warnings),
    getGrnVendorActuals(baseRows, normalized.period, policies, warnings),
    getCostCentres(processIds),
    getInvoicedRevenueActuals(normalized.period ?? ""),
    getRewardPenaltyForPeriod(normalized.period ?? ""),
    /*
     * Direct salary_prep_line read as a safety net for the canonical engine.
     *
     * getPeopleCosts() builds processMap through cost_centre_master.process_id. In production
     * most cost centres carry NULL for that column, so the payroll pool ends up in branchPool
     * and never flows to processMap (allocation policies table is empty, so allocateBranchPools
     * is a no-op). The fallback below was base.directPeopleCost from processPnlService, which
     * is also 0 because process_delivery_actual / process_revenue_rule are empty in production.
     *
     * Result: agentSalary = 0 on every BpoPnlRow → Overview, Matrix, CEO tabs show phantom
     * EBITDA = Revenue (Rs 200–240 lakh/month of people cost simply not appearing).
     *
     * getActualPeopleCost() groups salary_prep_line by (branchId, processId) from both the
     * salary_prep_line.process_id column AND cost_centre_master.process_id (via LEFT JOIN),
     * then aggregates into byProcess and byBranch. It finds payroll even when cost_centre
     * mapping is incomplete. The statement layer already uses this path; now the canonical
     * engine does too.
     */
    getActualPeopleCost(normalized.period ?? ""),
  ]);

  const rows: BpoPnlRow[] = baseRows.map((base) => {
    const configuredRules = rulesMap.get(base.processId) ?? [];
    const deliveryRows = deliveryMap.get(base.processId) ?? [];
    const componentRows = componentsMap.get(base.processId) ?? [];
    const plan = plans.get(base.processId);
    /*
     * Safety net: read actual payroll from getActualPeopleCost() which accumulates by process
     * and branch. byProcess is used here rather than byBranch because:
     *
     *   - processMap from getPeopleCosts() correctly handles agents and DSC staff (those with
     *     employees.process_id set, bucket != bmc_people). It misses BMC people because they
     *     go to branchPool and can only be allocated with allocation policies (empty in production).
     *
     *   - actualPeople.byProcess.get(processId) includes ALL buckets (agent+DSC+BMC) for the
     *     same process_id, so the fallback correctly covers BMC workers who have a process_id.
     *
     *   - byBranch is intentionally NOT used here. BMC employees have process_id = NULL, so they
     *     are only in byBranch (not byProcess for any process). Using byBranch as a per-process
     *     fallback would assign the entire branch BMC pool to every process in the branch,
     *     multiplying it by the number of processes (e.g., 5 processes × Rs 10L = Rs 50L shown
     *     vs Rs 10L actual). The statement service avoids this by only using byBranch when there
     *     is a single-grain "view by branch" column.
     *
     * Result: processes where all agents have process_id set → correct. Processes with no
     * process_id mapping anywhere (edge case) → agent cost = 0, same as before this fix. BMC
     * allocation for those employees still requires allocation policies to be configured.
     */
    const fromActual = base.processId ? actualPeople.byProcess.get(base.processId) : undefined;
    const peopleMeta = people.processMap.get(base.processId) ?? {
      agentSalary: fromActual?.agent_salary ?? base.directPeopleCost,
      dscPeople:   fromActual?.dsc_people   ?? 0,
      agentHeadcount: Math.max(1, base.activeHc),
      dscHeadcount: 0,
      unclassifiedPeopleCost: 0,
    };
    const bmcPeople = people.bmcPeopleByProcess.get(base.processId)
      ?? fromActual?.bmc_people
      ?? 0;
    const otherCosts = costComponents.get(base.processId) ?? emptyCostComponent();
    const budget = budgets.get(base.processId) ?? { approvedBudget: 0, reservedBudget: 0, consumedBudget: 0 };
    const grn = grnActuals.get(base.processId) ?? { directActual: 0, bmcAllocatedActual: 0, itemCount: 0 };
    const costCentre = costCentres.get(base.processId);

    const fallbackModel = normalizeBillingModel(base.billingModel);
    const fallbackRule: RevenueRuleInput = {
      billingModel: fallbackModel,
      metricKey: metricKeyForModel(fallbackModel),
      rateAmount: toNumber(base.resolvedRate),
      fxToInr: 1,
      monthlyMinimumCommitment: 0,
      mandatedSeats: toNumber(base.contractedSeats),
    };
    const rules: RevenueRuleInput[] = configuredRules.length > 0
      ? configuredRules.map((rule) => ({
          billingModel: normalizeBillingModel(rule.billing_model),
          metricKey: rule.metric_key,
          rateAmount: toNumber(rule.rate_amount),
          fxToInr: toNumber(rule.fx_to_inr, 1),
          monthlyMinimumCommitment: toNumber(rule.monthly_minimum_commitment),
          includedUnits: toNumber(rule.included_units),
          overageRate: toNumber(rule.overage_rate),
          mandatedSeats: toNumber(rule.mandated_seats || base.contractedSeats),
        }))
      : toNumber(base.resolvedRate) > 0
      ? [fallbackRule]
      : [];

    const deliveries: DeliveryMetricInput[] = deliveryRows.map((delivery) => ({
      metricKey: delivery.metric_key,
      plannedUnits: toNumber(delivery.planned_units),
      deliveredUnits: toNumber(delivery.delivered_units),
      acceptedUnits: toNumber(delivery.accepted_units),
      rejectedUnits: toNumber(delivery.rejected_units),
      billableUnits: toNumber(delivery.billable_units),
      productiveHours: toNumber(delivery.productive_hours),
      loginHours: toNumber(delivery.login_hours),
      talkMinutes: toNumber(delivery.talk_minutes),
      qualityScore: delivery.quality_score == null ? null : toNumber(delivery.quality_score),
      slaScore: delivery.sla_score == null ? null : toNumber(delivery.sla_score),
    }));
    if (deliveries.length === 0 && rules.length > 0) {
      deliveries.push({
        metricKey: rules[0].metricKey,
        plannedUnits: toNumber(plan?.planned_delivery_units || base.contractedSeats),
        deliveredUnits: toNumber(base.billableHc || base.deployedHc),
        acceptedUnits: toNumber(base.billableHc || base.deployedHc),
        billableUnits: toNumber(base.billableHc || base.deployedHc),
      });
    }

    const revenueComponents: RevenueComponentInput[] = componentRows.map((component) => ({
      type: component.component_type,
      direction: component.direction,
      amountInr: toNumber(component.amount_inr),
    }));
    const revenue = calculateRevenue(rules, deliveries, revenueComponents);
    /*
     * Revenue, most-specific source first:
     *   1. base.revenueMtd        accounting/invoice figure already on the row
     *   2. revenue.earnedRevenue  computed from approved rules x validated delivery
     *   3. invoiced               what the client was actually billed this month
     *
     * Three is a real number, not an estimate, and it is the only one populated today. It stays a
     * fallback rather than the default because a configured rule knows things an invoice does not
     * — minimum commitments, SLA deductions, incentive components — and must win wherever finance
     * has set one up.
     */
    const invoicedForProcess = invoiced.byProcess.get(base.processId) ?? 0;
    const ruleRevenue = toNumber(base.revenueMtd) > 0 ? toNumber(base.revenueMtd) : revenue.earnedRevenue;
    const usedInvoicedFallback = ruleRevenue <= 0 && invoicedForProcess > 0;
    const recognizedRevenue = usedInvoicedFallback ? invoicedForProcess : ruleRevenue;
    const cost = calculateBpoCostWaterfall({
      revenue: recognizedRevenue,
      agentSalary: peopleMeta.agentSalary,
      dscPeople: peopleMeta.dscPeople,
      dscNonPeople: toNumber(base.directNonPeopleCost),
      bmcPeople,
      bmcNonPeople: toNumber(base.indirectCost),
      otherOperatingCost: otherCosts.otherOperatingCost,
      otherOperatingIncome: otherCosts.otherOperatingIncome,
      depreciation: otherCosts.depreciation,
      amortization: otherCosts.amortization,
      financeCost: otherCosts.financeCost,
      nonOperatingIncome: otherCosts.nonOperatingIncome,
      tax: otherCosts.tax,
      exceptionalCost: otherCosts.exceptionalCost,
      exceptionalIncome: otherCosts.exceptionalIncome,
      agentHeadcount: peopleMeta.agentHeadcount,
      activeHeadcount: base.activeHc,
      contractedSeats: base.contractedSeats,
      billableSeats: base.billableHc,
    });

    const incentiveRevenue = componentAmount(componentRows, "incentive", "increase");
    const rpEntry = rpByProcess.get(base.processId);
    const rewardRevenue = componentAmount(componentRows, "reward", "increase") + (rpEntry?.rewards ?? 0);
    const trainingRevenue = componentAmount(componentRows, "training_revenue", "increase");
    const penalty = componentAmount(componentRows, "penalty", "decrease") + (rpEntry?.penalties ?? 0);
    const slaDeduction = componentAmount(componentRows, "sla_deduction", "decrease");
    const creditNote = componentAmount(componentRows, "credit_note", "decrease");
    const otherRevenueIncrease = otherComponentAmount(componentRows, "increase", ["incentive", "reward", "training_revenue"]);
    const otherRevenueDecrease = otherComponentAmount(componentRows, "decrease", ["penalty", "sla_deduction", "credit_note"]);
    const availableBudget = budget.approvedBudget - budget.reservedBudget - budget.consumedBudget;
    const freshnessValues = [base.freshness, ...deliveryRows.map((delivery) => delivery.updated_at)]
      .filter((value): value is string => Boolean(value))
      .sort();
    const deliveryAttainmentPct = revenue.deliveryAttainmentPct;
    const ebitda = cost.ebitda;

    return {
      processId: base.processId,
      processName: base.processName,
      clientId: base.clientId,
      clientName: base.clientName,
      branchId: base.branchId,
      branchName: base.branchName,
      costCentreId: costCentre?.id ?? null,
      costCentreCode: costCentre?.code ?? null,
      billingModels: Array.from(new Set(rules.map((rule) => rule.billingModel))),
      primaryBillingModel: rules[0]?.billingModel ?? base.billingModel,
      revenueDataStatus: configuredRules.length > 0
        ? deliveryRows.length > 0 ? "configured" : "configured_no_delivery"
        : usedInvoicedFallback ? "invoiced_fallback" : "accounting_fallback",
      mandatedSeats: configuredRules[0]?.mandated_seats ?? base.contractedSeats,
      contractedSeats: base.contractedSeats,
      requiredProductiveHc: base.requiredProductiveHc,
      requiredRosterHc: base.requiredRosterHc,
      activeHc: base.activeHc,
      agentHeadcount: peopleMeta.agentHeadcount,
      supportHeadcount: peopleMeta.dscHeadcount,
      billableHc: base.billableHc,
      seatFillPct: pct(base.activeHc, toNumber(base.contractedSeats)),
      billableSeatUtilizationPct: pct(toNumber(base.billableHc), toNumber(base.contractedSeats)),
      plannedDeliveryUnits: revenue.plannedUnits,
      deliveredUnits: revenue.deliveredUnits,
      acceptedUnits: revenue.acceptedUnits,
      rejectedUnits: revenue.rejectedUnits,
      billableUnits: revenue.billableUnits,
      productiveHours: deliveries.reduce((sum, delivery) => sum + toNumber(delivery.productiveHours), 0),
      loginHours: deliveries.reduce((sum, delivery) => sum + toNumber(delivery.loginHours), 0),
      talkMinutes: deliveries.reduce((sum, delivery) => sum + toNumber(delivery.talkMinutes), 0),
      qualityScore: averageNullable(deliveries.map((delivery) => delivery.qualityScore)),
      slaScore: averageNullable(deliveries.map((delivery) => delivery.slaScore)),
      deliveryAttainmentPct,
      acceptancePct: revenue.acceptancePct,
      grossPotentialRevenue: potentialRevenue(rules, deliveries),
      baseEarnedRevenue: revenue.baseRevenue,
      minimumCommitmentTopUp: revenue.minimumCommitmentTopUp,
      incentiveRevenue,
      rewardRevenue,
      trainingRevenue,
      otherRevenueIncrease,
      penalty,
      slaDeduction,
      creditNote,
      otherRevenueDecrease,
      earnedRevenue: revenue.earnedRevenue,
      recognizedRevenue,
      invoicedRevenue: toNumber(base.invoicedRevenueMtd),
      collectedRevenue: toNumber(base.collectedRevenueMtd),
      outstandingReceivable: toNumber(base.outstandingReceivable),
      unbilledRevenue: Math.max(0, revenue.earnedRevenue - toNumber(base.invoicedRevenueMtd)),
      deferredRevenue: Math.max(0, toNumber(base.invoicedRevenueMtd) - revenue.earnedRevenue),
      revenueLeakage: toNumber(base.revenueLeakage),
      revenueAtRisk: toNumber(base.revenueAtRisk),
      revenueBudget: base.revenueBudget,
      revenueVariance: base.revenueBudget == null ? null : recognizedRevenue - base.revenueBudget,
      agentSalary: cost.agentSalary,
      averageAgentSalary: cost.averageAgentSalary,
      agentSalaryPctRevenue: cost.agentSalaryPctRevenue,
      dscPeople: cost.dscPeople,
      dscNonPeople: cost.dscNonPeople,
      dsc: cost.dsc,
      dscPctRevenue: cost.dscPctRevenue,
      bmcPeople: cost.bmcPeople,
      bmcNonPeople: cost.bmcNonPeople,
      bmc: cost.bmc,
      bmcPctRevenue: cost.bmcPctRevenue,
      grnVendorActual: grn.directActual + grn.bmcAllocatedActual,
      totalPeopleCost: cost.totalPeopleCost,
      peopleCostPctRevenue: cost.peopleCostPctRevenue,
      contribution: cost.contribution,
      contributionMarginPct: cost.contributionMarginPct,
      ebitda,
      ebitdaMarginPct: cost.ebitdaMarginPct,
      depreciation: otherCosts.depreciation,
      amortization: otherCosts.amortization,
      ebit: cost.ebit,
      operatingProfit: cost.operatingProfit,
      operatingProfitPct: cost.operatingProfitPct,
      financeCost: otherCosts.financeCost,
      pbt: cost.pbt,
      tax: otherCosts.tax,
      pat: cost.pat,
      totalOperatingCost: cost.totalOperatingCostBeforeDa,
      totalCostPctRevenue: cost.totalCostPctRevenue,
      revenuePerAgent: cost.revenuePerAgent,
      revenuePerActiveEmployee: cost.revenuePerActiveEmployee,
      revenuePerContractedSeat: cost.revenuePerContractedSeat,
      loadedCostPerBillableSeat: cost.loadedCostPerBillableSeat,
      approvedBudget: budget.approvedBudget,
      reservedBudget: budget.reservedBudget,
      consumedBudget: budget.consumedBudget,
      availableBudget,
      budgetUtilizationPct: pct(budget.reservedBudget + budget.consumedBudget, budget.approvedBudget),
      ebitdaBudget: plan?.ebitda_budget == null ? null : toNumber(plan.ebitda_budget),
      ebitdaVariance: plan?.ebitda_budget == null ? null : ebitda - toNumber(plan.ebitda_budget),
      processStatus: statusFrom({
        ebitda,
        recognizedRevenue,
        revenueAtRisk: toNumber(base.revenueAtRisk),
        deliveryAttainmentPct,
      }),
      freshness: freshnessValues.at(-1) ?? null,
    };
  });

  return {
    filters: normalized,
    rows,
    rulesMap,
    deliveryMap,
    componentsMap,
    people,
    costComponents,
    budgets,
    grnActuals,
    warnings,
  };
}

function sum(rows: BpoPnlRow[], field: keyof BpoPnlRow): number {
  return rows.reduce((total, row) => total + toNumber(row[field]), 0);
}

function ratio(rows: BpoPnlRow[], numerator: keyof BpoPnlRow, denominator: keyof BpoPnlRow) {
  return pct(sum(rows, numerator), sum(rows, denominator));
}

/** Pre-read the row a config save is about to touch, so the audit entry can carry a real
 *  before/after diff instead of just "something changed". Returns null for a genuine create
 *  (no existing id) — that absence is itself meaningful, not a failure. */
async function readExistingConfigRow(table: string, id: string): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

async function auditConfigSave(
  actionType: string,
  table: string,
  id: string,
  before: RowDataPacket | null,
  payload: Record<string, unknown>,
  userId: string
) {
  await writeAuditLog({
    actor_user_id: userId,
    action_type: actionType,
    module_key: "process_pnl_configuration",
    entity_type: table,
    entity_id: id,
    metadata: { before, after: payload },
  });
}

export const bpoPnlService = {
  async getSummary(filters: Partial<PnlQueryFilters>) {
    const bundle = await buildRows(filters);
    const rows = bundle.rows;
    const recognizedRevenue = sum(rows, "recognizedRevenue");
    const ebitda = sum(rows, "ebitda");
    const operatingProfit = sum(rows, "operatingProfit");
    const alerts: Array<{
      type: "critical" | "warning" | "info";
      code: string;
      title: string;
      detail: string;
      processId?: string;
      processName?: string;
      impact?: number;
    }> = [];

    for (const row of rows) {
      if (row.revenueDataStatus === "accounting_fallback") {
        alerts.push({
          type: "warning",
          code: "REVENUE_RULE_MISSING",
          title: "Revenue logic not configured",
          detail: `${row.processName} is using invoice/accounting revenue because no approved BPO revenue rule exists.`,
          processId: row.processId,
          processName: row.processName,
        });
      } else if (row.revenueDataStatus === "invoiced_fallback") {
        alerts.push({
          type: "warning",
          code: "REVENUE_FROM_INVOICES",
          title: "Revenue taken from invoices",
          detail: `${row.processName} has no approved revenue rule and no accounting figure, so what the client was actually invoiced is used. Minimum commitments, SLA deductions and incentives are not reflected.`,
          processId: row.processId,
          processName: row.processName,
        });
      } else if (row.revenueDataStatus === "configured_no_delivery") {
        alerts.push({
          type: "warning",
          code: "DELIVERY_ACTUAL_MISSING",
          title: "Delivery actual missing",
          detail: `${row.processName} has an approved billing rule but no validated delivery data for ${bundle.filters.period}.`,
          processId: row.processId,
          processName: row.processName,
        });
      }
      if (row.ebitda < 0) {
        alerts.push({
          type: "critical",
          code: "NEGATIVE_EBITDA",
          title: "Negative EBITDA",
          detail: `${row.processName} is EBITDA negative for the selected period.`,
          processId: row.processId,
          processName: row.processName,
          impact: Math.abs(row.ebitda),
        });
      }
      if ((row.deliveryAttainmentPct ?? 100) < 90) {
        alerts.push({
          type: "warning",
          code: "DELIVERY_SHORTFALL",
          title: "Delivery below plan",
          detail: `${row.processName} delivered ${(row.deliveryAttainmentPct ?? 0).toFixed(1)}% of planned units.`,
          processId: row.processId,
          processName: row.processName,
          impact: Math.max(0, row.grossPotentialRevenue - row.earnedRevenue),
        });
      }
      if ((row.budgetUtilizationPct ?? 0) > 100) {
        alerts.push({
          type: "critical",
          code: "BUDGET_OVERSPEND",
          title: "Budget exceeded",
          detail: `${row.processName} has consumed or reserved more than its approved allocated budget.`,
          processId: row.processId,
          processName: row.processName,
          impact: Math.abs(Math.min(0, row.availableBudget)),
        });
      }
      const configuredRules = bundle.rulesMap.get(row.processId) ?? [];
      const qualityGate = configuredRules
        .map((rule) => rule.quality_gate_pct)
        .filter((value): value is number => value != null)
        .sort((a, b) => b - a)[0];
      const slaGate = configuredRules
        .map((rule) => rule.sla_gate_pct)
        .filter((value): value is number => value != null)
        .sort((a, b) => b - a)[0];
      if (qualityGate != null && row.qualityScore != null && row.qualityScore < qualityGate) {
        alerts.push({
          type: "warning",
          code: "QUALITY_GATE_BREACH",
          title: "Quality gate breached",
          detail: `${row.processName} quality is ${row.qualityScore.toFixed(2)}% against a ${qualityGate.toFixed(2)}% commercial gate.`,
          processId: row.processId,
          processName: row.processName,
          impact: row.revenueAtRisk,
        });
      }
      if (slaGate != null && row.slaScore != null && row.slaScore < slaGate) {
        alerts.push({
          type: "warning",
          code: "SLA_GATE_BREACH",
          title: "SLA gate breached",
          detail: `${row.processName} SLA is ${row.slaScore.toFixed(2)}% against a ${slaGate.toFixed(2)}% commercial gate.`,
          processId: row.processId,
          processName: row.processName,
          impact: row.revenueAtRisk,
        });
      }
    }

    const seenImbalance = new Set<string>();
    for (const warning of bundle.warnings) {
      const key = `${warning.branchId}|${warning.poolType}`;
      if (seenImbalance.has(key)) continue;
      seenImbalance.add(key);
      alerts.push({
        type: "critical",
        code: "MANUAL_ALLOCATION_NOT_BALANCED",
        title: "Manual allocation not balanced",
        detail: `Branch ${warning.branchId} manual allocation policy for ${warning.poolType} sums to ` +
          `${warning.percentTotal.toFixed(2)}% (expected 100%). Amounts are applied as configured, not rebalanced.`,
      });
    }

    // Payroll draft indicator — only relevant for Aug 2026+ (first live HRMS payroll run).
    // Pre-Aug 2026 data is legacy-migrated and confirmed finalized; no alert needed there.
    const period = bundle.filters.period ?? "";
    if (period >= "2026-08") {
      const [payrollRuns] = await db.execute<RowDataPacket[]>(
        `SELECT status FROM salary_prep_run WHERE run_month = ?`,
        [period],
      );
      if (payrollRuns.length > 0) {
        const FINALIZED = new Set(["approved", "paid", "disbursed", "finalized", "final", "completed"]);
        const allFinalized = payrollRuns.every((r) => FINALIZED.has(String(r.status ?? "").toLowerCase()));
        if (!allFinalized) {
          alerts.push({
            type: "warning",
            code: "PAYROLL_RUN_DRAFT",
            title: "Payroll not yet finalized",
            detail: `The payroll run for ${period} is still in draft/pending state. Agent salary, DSC and BMC people-cost will show ₹0 until the run is approved and finalized.`,
          });
        }
      }
    }

    const severity = { critical: 0, warning: 1, info: 2 } as const;
    alerts.sort((left, right) => severity[left.type] - severity[right.type] || toNumber(right.impact) - toNumber(left.impact));

    const payrollRunPending = (() => {
      const a = alerts.find((al) => al.code === "PAYROLL_RUN_DRAFT");
      return a != null;
    })();

    return {
      period: bundle.filters.period,
      filters: bundle.filters,
      payrollRunPending,
      kpis: {
        grossPotentialRevenue: sum(rows, "grossPotentialRevenue"),
        earnedRevenue: sum(rows, "earnedRevenue"),
        recognizedRevenue,
        invoicedRevenue: sum(rows, "invoicedRevenue"),
        collectedRevenue: sum(rows, "collectedRevenue"),
        outstandingReceivable: sum(rows, "outstandingReceivable"),
        unbilledRevenue: sum(rows, "unbilledRevenue"),
        revenueAtRisk: sum(rows, "revenueAtRisk"),
        agentSalary: sum(rows, "agentSalary"),
        agentSalaryPctRevenue: ratio(rows, "agentSalary", "recognizedRevenue"),
        dsc: sum(rows, "dsc"),
        dscPctRevenue: ratio(rows, "dsc", "recognizedRevenue"),
        bmc: sum(rows, "bmc"),
        bmcPctRevenue: ratio(rows, "bmc", "recognizedRevenue"),
        grnVendorActual: sum(rows, "grnVendorActual"),
        totalPeopleCost: sum(rows, "totalPeopleCost"),
        peopleCostPctRevenue: ratio(rows, "totalPeopleCost", "recognizedRevenue"),
        contribution: sum(rows, "contribution"),
        ebitda,
        ebitdaMarginPct: pct(ebitda, recognizedRevenue),
        operatingProfit,
        operatingProfitPct: pct(operatingProfit, recognizedRevenue),
        pbt: sum(rows, "pbt"),
        pat: sum(rows, "pat"),
        approvedBudget: sum(rows, "approvedBudget"),
        consumedBudget: sum(rows, "consumedBudget"),
        reservedBudget: sum(rows, "reservedBudget"),
        availableBudget: sum(rows, "availableBudget"),
        activeHeadcount: sum(rows, "activeHc"),
        agentHeadcount: sum(rows, "agentHeadcount"),
        configuredProcesses: rows.filter((row) => row.revenueDataStatus === "configured" || row.revenueDataStatus === "configured_no_delivery").length,
        totalProcesses: rows.length,
        revenueModelCoveragePct: pct(
          rows.filter((row) => row.revenueDataStatus === "configured" || row.revenueDataStatus === "configured_no_delivery").length,
          rows.length
        ),
        lossMakingProcesses: rows.filter((row) => row.processStatus === "loss-making").length,
      },
      revenueMix: {
        baseRevenue: sum(rows, "baseEarnedRevenue"),
        minimumCommitment: sum(rows, "minimumCommitmentTopUp"),
        incentivesAndRewards: sum(rows, "incentiveRevenue") + sum(rows, "rewardRevenue"),
        trainingAndOtherRevenue: sum(rows, "trainingRevenue") + sum(rows, "otherRevenueIncrease"),
        penaltiesAndSla: sum(rows, "penalty") + sum(rows, "slaDeduction"),
        creditNotesAndOtherDeductions: sum(rows, "creditNote") + sum(rows, "otherRevenueDecrease"),
      },
      costMix: {
        agentSalary: sum(rows, "agentSalary"),
        dscPeople: sum(rows, "dscPeople"),
        dscNonPeople: sum(rows, "dscNonPeople"),
        bmcPeople: sum(rows, "bmcPeople"),
        bmcNonPeople: sum(rows, "bmcNonPeople"),
        depreciation: sum(rows, "depreciation"),
        amortization: sum(rows, "amortization"),
        financeCost: sum(rows, "financeCost"),
        tax: sum(rows, "tax"),
      },
      alerts,
      rows,
      generatedAt: new Date().toISOString(),
    };
  },

  async getProcessDetail(processId: string, filters: Partial<PnlQueryFilters>) {
    const bundle = await buildRows({ ...filters, processId });
    const row = bundle.rows.find((item) => item.processId === processId);
    if (!row) throw new Error("Process P&L record not found");
    return {
      period: bundle.filters.period,
      row,
      revenueRules: bundle.rulesMap.get(processId) ?? [],
      deliveryActuals: bundle.deliveryMap.get(processId) ?? [],
      revenueComponents: bundle.componentsMap.get(processId) ?? [],
      payrollClassification: {
        agentSalary: row.agentSalary,
        agentHeadcount: row.agentHeadcount,
        averageAgentSalary: row.averageAgentSalary,
        dscPeople: row.dscPeople,
        supportHeadcount: row.supportHeadcount,
        bmcPeopleAllocated: row.bmcPeople,
      },
      costStack: {
        dscNonPeople: row.dscNonPeople,
        bmcNonPeople: row.bmcNonPeople,
        grnVendorActual: row.grnVendorActual,
        depreciation: row.depreciation,
        amortization: row.amortization,
        financeCost: row.financeCost,
        tax: row.tax,
      },
      budget: bundle.budgets.get(processId) ?? { approvedBudget: 0, reservedBudget: 0, consumedBudget: 0 },
      generatedAt: new Date().toISOString(),
    };
  },

  async exportCsv(filters: Partial<PnlQueryFilters>) {
    const summary = await this.getSummary(filters);
    const headers = [
      "Process", "Client", "Branch", "Cost Centre", "Billing Model", "Mandated Seats", "Active HC", "Agent HC",
      "Planned Units", "Delivered Units", "Billable Units", "Delivery %", "Potential Revenue", "Earned Revenue",
      "Recognized Revenue", "Invoiced Revenue", "Collected Revenue", "Outstanding", "Unbilled Revenue",
      "Agent Salary", "Agent Salary %", "DSC", "DSC %", "BMC", "BMC %", "GRN/Vendor Actual",
      "EBITDA", "EBITDA %", "EBIT", "Operating Profit %", "PBT", "PAT", "Approved Budget",
      "Reserved Budget", "Consumed Budget", "Available Budget", "Status",
    ];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return [
      headers.map(escape).join(","),
      ...summary.rows.map((row) => [
        row.processName,
        row.clientName,
        row.branchName,
        row.costCentreCode,
        row.billingModels.join(" + "),
        row.mandatedSeats,
        row.activeHc,
        row.agentHeadcount,
        row.plannedDeliveryUnits,
        row.deliveredUnits,
        row.billableUnits,
        row.deliveryAttainmentPct?.toFixed(2),
        row.grossPotentialRevenue.toFixed(2),
        row.earnedRevenue.toFixed(2),
        row.recognizedRevenue.toFixed(2),
        row.invoicedRevenue.toFixed(2),
        row.collectedRevenue.toFixed(2),
        row.outstandingReceivable.toFixed(2),
        row.unbilledRevenue.toFixed(2),
        row.agentSalary.toFixed(2),
        row.agentSalaryPctRevenue?.toFixed(2),
        row.dsc.toFixed(2),
        row.dscPctRevenue?.toFixed(2),
        row.bmc.toFixed(2),
        row.bmcPctRevenue?.toFixed(2),
        row.grnVendorActual.toFixed(2),
        row.ebitda.toFixed(2),
        row.ebitdaMarginPct?.toFixed(2),
        row.ebit.toFixed(2),
        row.operatingProfitPct?.toFixed(2),
        row.pbt.toFixed(2),
        row.pat.toFixed(2),
        row.approvedBudget.toFixed(2),
        row.reservedBudget.toFixed(2),
        row.consumedBudget.toFixed(2),
        row.availableBudget.toFixed(2),
        row.processStatus,
      ].map(escape).join(",")),
    ].join("\n");
  },

  async listRevenueRules(processId?: string) {
    if (!(await tableExists("process_revenue_rule"))) return [];
    return safeRows<RowDataPacket>(
      `SELECT *
         FROM process_revenue_rule
         ${processId ? "WHERE process_id = ?" : ""}
        ORDER BY process_id, effective_from DESC`,
      processId ? [processId] : []
    );
  },

  async saveRevenueRule(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
    const before = await readExistingConfigRow("process_revenue_rule", id);
    await db.execute(
      `INSERT INTO process_revenue_rule
        (id, process_id, contract_id, rule_name, billing_model, metric_key, rate_amount, currency_code,
         fx_to_inr, monthly_minimum_commitment, included_units, overage_rate, mandated_seats,
         quality_gate_pct, sla_gate_pct, effective_from, effective_to, status, approved_by, approved_at,
         approval_reference, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         contract_id=VALUES(contract_id), rule_name=VALUES(rule_name), billing_model=VALUES(billing_model),
         metric_key=VALUES(metric_key), rate_amount=VALUES(rate_amount), currency_code=VALUES(currency_code),
         fx_to_inr=VALUES(fx_to_inr), monthly_minimum_commitment=VALUES(monthly_minimum_commitment),
         included_units=VALUES(included_units), overage_rate=VALUES(overage_rate), mandated_seats=VALUES(mandated_seats),
         quality_gate_pct=VALUES(quality_gate_pct), sla_gate_pct=VALUES(sla_gate_pct),
         effective_from=VALUES(effective_from), effective_to=VALUES(effective_to), status=VALUES(status),
         approved_by=VALUES(approved_by), approved_at=VALUES(approved_at),
         approval_reference=VALUES(approval_reference), updated_by=VALUES(updated_by)`,
      [
        id,
        payload.processId,
        payload.contractId ?? null,
        payload.ruleName,
        payload.billingModel,
        payload.metricKey,
        toNumber(payload.rateAmount),
        String(payload.currencyCode ?? "INR"),
        toNumber(payload.fxToInr, 1),
        toNumber(payload.monthlyMinimumCommitment),
        toNumber(payload.includedUnits),
        toNumber(payload.overageRate),
        payload.mandatedSeats ?? null,
        payload.qualityGatePct ?? null,
        payload.slaGatePct ?? null,
        payload.effectiveFrom,
        payload.effectiveTo ?? null,
        status,
        status === "approved" ? userId : null,
        status === "approved" ? new Date() : null,
        payload.approvalReference ?? null,
        userId,
        userId,
      ]
    );
    await auditConfigSave("revenue_rule_saved", "process_revenue_rule", id, before, payload, userId);
    return { id };
  },

  async saveDeliveryActual(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
    const validated = status === "validated" || status === "locked";
    const before = await readExistingConfigRow("process_delivery_actual", id);
    await db.execute(
      `INSERT INTO process_delivery_actual
        (id, process_id, period_code, activity_date, metric_key, planned_units, delivered_units,
         accepted_units, rejected_units, billable_units, productive_hours, login_hours, talk_minutes,
         quality_score, sla_score, data_source, source_reference, status, validated_by, validated_at,
         created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         planned_units=VALUES(planned_units), delivered_units=VALUES(delivered_units),
         accepted_units=VALUES(accepted_units), rejected_units=VALUES(rejected_units), billable_units=VALUES(billable_units),
         productive_hours=VALUES(productive_hours), login_hours=VALUES(login_hours), talk_minutes=VALUES(talk_minutes),
         quality_score=VALUES(quality_score), sla_score=VALUES(sla_score), status=VALUES(status),
         validated_by=VALUES(validated_by), validated_at=VALUES(validated_at), updated_by=VALUES(updated_by)`,
      [
        id,
        payload.processId,
        payload.periodCode,
        payload.activityDate ?? null,
        payload.metricKey,
        toNumber(payload.plannedUnits),
        toNumber(payload.deliveredUnits),
        toNumber(payload.acceptedUnits),
        toNumber(payload.rejectedUnits),
        toNumber(payload.billableUnits),
        toNumber(payload.productiveHours),
        toNumber(payload.loginHours),
        toNumber(payload.talkMinutes),
        payload.qualityScore ?? null,
        payload.slaScore ?? null,
        String(payload.dataSource ?? "manual"),
        String(payload.sourceReference ?? "manual"),
        status,
        validated ? userId : null,
        validated ? new Date() : null,
        userId,
        userId,
      ]
    );
    await auditConfigSave("delivery_actual_saved", "process_delivery_actual", id, before, payload, userId);
    return { id };
  },

  async saveRevenueComponent(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
    const before = await readExistingConfigRow("process_revenue_component", id);
    await db.execute(
      `INSERT INTO process_revenue_component
        (id, process_id, period_code, component_type, direction, description, units, rate, amount_inr,
         recognition_date, invoice_reference, source_reference, status, approved_by, approved_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         component_type=VALUES(component_type), direction=VALUES(direction), description=VALUES(description),
         units=VALUES(units), rate=VALUES(rate), amount_inr=VALUES(amount_inr), recognition_date=VALUES(recognition_date),
         invoice_reference=VALUES(invoice_reference), source_reference=VALUES(source_reference), status=VALUES(status),
         approved_by=VALUES(approved_by), approved_at=VALUES(approved_at)`,
      [
        id,
        payload.processId,
        payload.periodCode,
        payload.componentType,
        payload.direction,
        payload.description,
        payload.units ?? null,
        payload.rate ?? null,
        toNumber(payload.amountInr),
        payload.recognitionDate ?? null,
        payload.invoiceReference ?? null,
        payload.sourceReference ?? null,
        status,
        status === "approved" ? userId : null,
        status === "approved" ? new Date() : null,
        userId,
      ]
    );
    await auditConfigSave("revenue_component_saved", "process_revenue_component", id, before, payload, userId);
    return { id };
  },

  async saveCostComponent(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
    const before = await readExistingConfigRow("process_pnl_cost_component", id);
    await db.execute(
      `INSERT INTO process_pnl_cost_component
        (id, process_id, branch_id, period_code, cost_type, description, amount_inr, allocation_driver,
         manual_allocation_pct, source_reference, status, approved_by, approved_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         process_id=VALUES(process_id), branch_id=VALUES(branch_id), cost_type=VALUES(cost_type),
         description=VALUES(description), amount_inr=VALUES(amount_inr), allocation_driver=VALUES(allocation_driver),
         manual_allocation_pct=VALUES(manual_allocation_pct), source_reference=VALUES(source_reference),
         status=VALUES(status), approved_by=VALUES(approved_by), approved_at=VALUES(approved_at)`,
      [
        id,
        payload.processId ?? null,
        payload.branchId ?? null,
        payload.periodCode,
        payload.costType,
        payload.description,
        toNumber(payload.amountInr),
        String(payload.allocationDriver ?? "direct"),
        payload.manualAllocationPct ?? null,
        payload.sourceReference ?? null,
        status,
        status === "approved" ? userId : null,
        status === "approved" ? new Date() : null,
        userId,
      ]
    );
    await auditConfigSave("cost_component_saved", "process_pnl_cost_component", id, before, payload, userId);
    return { id };
  },

  async saveAllocationPolicy(payload: Record<string, unknown>, userId: string) {
    // Nothing validated the driver, so a policy could be saved with one the allocator cannot
    // satisfy and would quietly split by headcount instead.
    const driver = String(payload.allocationDriver ?? payload.allocation_driver ?? "");
    if (driver && !isSupportedAllocationDriver(driver)) {
      throw new Error(
        `Allocation driver "${driver}" is not supported for Process P&L. `
        + `Supported drivers: ${SUPPORTED_ALLOCATION_DRIVERS.join(", ")}.`
      );
    }
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
    const before = await readExistingConfigRow("pnl_allocation_policy", id);
    await db.execute(
      `INSERT INTO pnl_allocation_policy
        (id, branch_id, process_id, pool_type, allocation_driver, manual_allocation_pct,
         effective_from, effective_to, status, approved_by, approved_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         process_id=VALUES(process_id), pool_type=VALUES(pool_type), allocation_driver=VALUES(allocation_driver),
         manual_allocation_pct=VALUES(manual_allocation_pct), effective_from=VALUES(effective_from),
         effective_to=VALUES(effective_to), status=VALUES(status), approved_by=VALUES(approved_by),
         approved_at=VALUES(approved_at), updated_by=VALUES(updated_by)`,
      [
        id,
        payload.branchId,
        payload.processId ?? null,
        payload.poolType,
        String(payload.allocationDriver ?? "active_hc"),
        payload.manualAllocationPct ?? null,
        payload.effectiveFrom,
        payload.effectiveTo ?? null,
        status,
        status === "approved" ? userId : null,
        status === "approved" ? new Date() : null,
        userId,
        userId,
      ]
    );
    await auditConfigSave("allocation_policy_saved", "pnl_allocation_policy", id, before, payload, userId);
    return { id };
  },
};
