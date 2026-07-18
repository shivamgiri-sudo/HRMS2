import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import {
  calculateBpoCostWaterfall,
  calculateRevenue,
  type BpoBillingModel,
  type DeliveryMetricInput,
  type RevenueComponentInput,
  type RevenueRuleInput,
} from "./bpo-pnl.calculation.js";
import { processPnlService } from "./process-pnl.service.js";
import type { PnlQueryFilters, ProcessPnlRecord } from "./process-pnl.types.js";

type NumericMap = Map<string, number>;

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

interface CostComponentRow extends RowDataPacket {
  id: string;
  process_id: string | null;
  branch_id: string | null;
  period_code: string;
  cost_type: string;
  description: string;
  amount_inr: number;
  allocation_driver: AllocationDriver;
  manual_allocation_pct: number | null;
  source_reference: string | null;
  status: string;
}

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

interface AllocationPolicyRow extends RowDataPacket {
  branch_id: string;
  process_id: string | null;
  pool_type: string;
  allocation_driver: AllocationDriver;
  manual_allocation_pct: number | null;
}

interface ClassificationRuleRow extends RowDataPacket {
  scope_type: string;
  scope_key: string;
  process_id: string | null;
  branch_id: string | null;
  pnl_bucket: PnlBucket;
  priority: number;
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
  revenueDataStatus: "configured" | "configured_no_delivery" | "accounting_fallback";
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

const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const percentage = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

const placeholders = (items: unknown[]): string => items.map(() => "?").join(",");

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeFilters(filters: Partial<PnlQueryFilters>): PnlQueryFilters {
  return {
    period: filters.period && /^\d{4}-\d{2}$/.test(filters.period) ? filters.period : defaultPeriod(),
    branchId: filters.branchId,
    processId: filters.processId,
    clientId: filters.clientId,
    search: filters.search,
  };
}

function monthRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, "0")}` };
}

const columnCache = new Map<string, Promise<Set<string>>>();

async function listColumns(tableName: string): Promise<Set<string>> {
  if (!columnCache.has(tableName)) {
    columnCache.set(
      tableName,
      queryRows<RowDataPacket>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = ?`,
        [tableName]
      ).then((rows) => new Set(rows.map((row) => String(row.column_name))))
    );
  }
  return columnCache.get(tableName)!;
}

async function safeRows<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return await queryRows<T>(sql, params);
  } catch {
    return [];
  }
}

function normalizeBillingModel(value: string | null | undefined): BpoBillingModel {
  switch (String(value ?? "").toLowerCase()) {
    case "per_fte":
      return "per_fte";
    case "per_hour":
    case "per_productive_hour":
      return "per_productive_hour";
    case "per_login_hour":
      return "per_login_hour";
    case "per_talk_minute":
      return "per_talk_minute";
    case "per_transaction":
      return "per_transaction";
    case "per_mandate":
      return "per_mandate";
    case "per_case":
      return "per_case";
    case "fixed_monthly":
      return "fixed_monthly";
    case "outcome_based":
      return "outcome_based";
    default:
      return "per_seat";
  }
}

function metricKeyForModel(model: BpoBillingModel): string {
  switch (model) {
    case "per_productive_hour":
      return "productive_hours";
    case "per_login_hour":
      return "login_hours";
    case "per_talk_minute":
      return "talk_minutes";
    case "per_transaction":
      return "transactions";
    case "per_mandate":
      return "mandates";
    case "per_case":
      return "cases";
    case "fixed_monthly":
      return "fixed_monthly";
    case "outcome_based":
      return "outcomes";
    case "per_fte":
      return "billable_fte";
    default:
      return "billable_seats";
  }
}

async function revenueRules(processIds: string[], period: string) {
  const map = new Map<string, RevenueRuleRow[]>();
  if (processIds.length === 0 || !(await tableExists("process_revenue_rule"))) return map;
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
    const list = map.get(String(row.process_id)) ?? [];
    list.push(row);
    map.set(String(row.process_id), list);
  }
  return map;
}

async function deliveryActuals(processIds: string[], period: string) {
  const map = new Map<string, DeliveryRow[]>();
  if (processIds.length === 0 || !(await tableExists("process_delivery_actual"))) return map;
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
    const list = map.get(String(row.process_id)) ?? [];
    list.push(row);
    map.set(String(row.process_id), list);
  }
  return map;
}

async function revenueComponents(processIds: string[], period: string) {
  const map = new Map<string, RevenueComponentRow[]>();
  if (processIds.length === 0 || !(await tableExists("process_revenue_component"))) return map;
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
    const list = map.get(String(row.process_id)) ?? [];
    list.push(row);
    map.set(String(row.process_id), list);
  }
  return map;
}

async function monthlyPlanExtensions(processIds: string[], period: string) {
  const map = new Map<string, RowDataPacket>();
  if (processIds.length === 0 || !(await tableExists("process_monthly_plan"))) return map;
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
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

async function classificationRules(period: string) {
  if (!(await tableExists("pnl_cost_classification_rule"))) return [] as ClassificationRuleRow[];
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

function lower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isSupportRole(person: PayrollPersonRow): boolean {
  const department = lower(person.department_name);
  const designation = lower(person.designation_name);
  const supportDepartment = /(quality|training|learning|wfm|workforce|mis|human resource|\bhr\b|admin|information technology|\bit\b|finance|accounts|recruit|facility|security|maintenance|compliance|payroll)/;
  const supportDesignation = /(team leader|\btl\b|assistant manager|\bam\b|manager|supervisor|trainer|quality|auditor|wfm|mis|hr|recruiter|admin|it support|engineer|accounts|finance|facility|security|coach|sme|subject matter)/;
  return supportDepartment.test(department) || supportDesignation.test(designation);
}

function matchingRule(person: PayrollPersonRow, rules: ClassificationRuleRow[]): ClassificationRuleRow | null {
  const values: Record<string, string[]> = {
    employee: [lower(person.employee_id), lower(person.employee_code)],
    designation: [lower(person.designation_id), lower(person.designation_name)],
    department: [lower(person.department_id), lower(person.department_name)],
  };
  return rules.find((rule) => {
    if (rule.process_id && String(rule.process_id) !== String(person.process_id ?? "")) return false;
    if (rule.branch_id && String(rule.branch_id) !== String(person.branch_id ?? "")) return false;
    const candidates = values[rule.scope_type] ?? [];
    return candidates.includes(lower(rule.scope_key));
  }) ?? null;
}

async function payrollPeople(period: string): Promise<PayrollPersonRow[]> {
  if (!(await tableExists("salary_prep_run")) || !(await tableExists("salary_prep_line"))) return [];
  const run = await safeRows<RowDataPacket>(
    `SELECT id
       FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY FIELD(status, 'locked', 'approved', 'completed', 'processed', 'draft') DESC, created_at DESC
      LIMIT 1`,
    [period]
  );
  if (!run[0]?.id) return [];

  const salaryColumns = await listColumns("salary_prep_line");
  const employeeColumns = await listColumns("employees");
  const hasDesignation = await tableExists("designation_master");
  const hasDepartment = await tableExists("department_master");
  const grossExpr = salaryColumns.has("gross_salary") ? "COALESCE(spl.gross_salary, 0)" : "0";
  const pfExpr = salaryColumns.has("pf_employer") ? "COALESCE(spl.pf_employer, 0)" : "0";
  const esicExpr = salaryColumns.has("esic_employer") ? "COALESCE(spl.esic_employer, 0)" : "0";
  const gratuityExpr = salaryColumns.has("gratuity")
    ? "COALESCE(spl.gratuity, 0)"
    : salaryColumns.has("basic")
    ? "COALESCE(spl.basic, 0) * 0.0481"
    : "0";
  const designationIdExpr = employeeColumns.has("designation_id") ? "e.designation_id" : "NULL";
  const departmentIdExpr = employeeColumns.has("department_id") ? "e.department_id" : "NULL";
  const branchIdExpr = employeeColumns.has("branch_id") ? "e.branch_id" : "NULL";
  const processIdExpr = employeeColumns.has("process_id") ? "e.process_id" : "NULL";
  const designationJoin = hasDesignation && employeeColumns.has("designation_id")
    ? "LEFT JOIN designation_master d ON d.id = e.designation_id"
    : "";
  const departmentJoin = hasDepartment && employeeColumns.has("department_id")
    ? "LEFT JOIN department_master dep ON dep.id = e.department_id"
    : "";
  const designationNameExpr = designationJoin ? "d.designation_name" : "NULL";
  const departmentNameExpr = departmentJoin ? "dep.department_name" : "NULL";

  return safeRows<PayrollPersonRow>(
    `SELECT
        e.id AS employee_id,
        e.employee_code,
        ${processIdExpr} AS process_id,
        ${branchIdExpr} AS branch_id,
        ${designationIdExpr} AS designation_id,
        ${designationNameExpr} AS designation_name,
        ${departmentIdExpr} AS department_id,
        ${departmentNameExpr} AS department_name,
        SUM(${grossExpr} + ${pfExpr} + ${esicExpr} + ${gratuityExpr}) AS loaded_cost
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       ${designationJoin}
       ${departmentJoin}
      WHERE spl.run_id = ?
      GROUP BY e.id, e.employee_code, process_id, branch_id, designation_id, designation_name, department_id, department_name`,
    [String(run[0].id)]
  );
}

async function peopleCostMaps(
  baseRows: ProcessPnlRecord[],
  period: string,
  policies: AllocationPolicyRow[]
) {
  const processMap = new Map<string, PeopleCostMeta>();
  const branchPool = new Map<string, { amount: number; headcount: number }>();
  const people = await payrollPeople(period);
  const rules = await classificationRules(period);

  for (const person of people) {
    const cost = numberValue(person.loaded_cost);
    const configured = matchingRule(person, rules)?.pnl_bucket;
    let bucket: PnlBucket;
    if (configured) bucket = configured;
    else if (person.process_id) bucket = isSupportRole(person) ? "dsc_people" : "agent_salary";
    else bucket = "bmc_people";

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

    if (bucket === "bmc_people" && person.branch_id) {
      const key = String(person.branch_id);
      const current = branchPool.get(key) ?? { amount: 0, headcount: 0 };
      current.amount += cost;
      current.headcount += 1;
      branchPool.set(key, current);
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
    const residual = Math.max(0, numberValue(row.directPeopleCost) - classified);
    if (classified <= 0 && row.directPeopleCost > 0) {
      current.agentSalary = row.directPeopleCost;
      current.agentHeadcount = Math.max(1, row.activeHc);
    } else if (residual > 0.5) {
      current.dscPeople += residual;
      current.unclassifiedPeopleCost += residual;
    }
    processMap.set(row.processId, current);
  }

  const bmcPeopleByProcess = allocateBranchPools(baseRows, branchPool, policies, "bmc_people");
  return { processMap, bmcPeopleByProcess, branchPool, people };
}

async function allocationPolicies(period: string): Promise<AllocationPolicyRow[]> {
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

function driverValue(row: ProcessPnlRecord, driver: AllocationDriver): number {
  switch (driver) {
    case "billable_hc":
      return numberValue(row.billableHc);
    case "contracted_seats":
      return numberValue(row.contractedSeats);
    case "revenue":
      return numberValue(row.revenueMtd);
    case "equal":
      return 1;
    case "active_hc":
    default:
      return numberValue(row.activeHc);
  }
}

function policyFor(
  policies: AllocationPolicyRow[],
  branchId: string,
  poolType: string,
  processId?: string
): AllocationPolicyRow | undefined {
  return policies.find((item) =>
    String(item.branch_id) === branchId
    && item.pool_type === poolType
    && (processId ? String(item.process_id ?? "") === processId : !item.process_id)
  );
}

function allocateBranchPools(
  baseRows: ProcessPnlRecord[],
  pools: Map<string, { amount: number }>,
  policies: AllocationPolicyRow[],
  poolType: string
): NumericMap {
  const result = new Map<string, number>();
  const rowsByBranch = new Map<string, ProcessPnlRecord[]>();
  for (const row of baseRows) {
    if (!row.branchId) continue;
    const list = rowsByBranch.get(row.branchId) ?? [];
    list.push(row);
    rowsByBranch.set(row.branchId, list);
  }

  for (const [branchId, rows] of rowsByBranch.entries()) {
    const pool = numberValue(pools.get(branchId)?.amount);
    if (pool <= 0 || rows.length === 0) continue;
    const branchPolicy = policyFor(policies, branchId, poolType);
    const driver = branchPolicy?.allocation_driver ?? "active_hc";
    const manualPolicies = rows.map((row) => policyFor(policies, branchId, poolType, row.processId));
    const hasManual = manualPolicies.some((policy) => policy?.allocation_driver === "manual");

    if (hasManual) {
      for (let index = 0; index < rows.length; index += 1) {
        const manualPct = numberValue(manualPolicies[index]?.manual_allocation_pct);
        result.set(rows[index].processId, pool * (manualPct / 100));
      }
      continue;
    }

    const values = rows.map((row) => driverValue(row, driver));
    const total = values.reduce((sum, value) => sum + value, 0);
    rows.forEach((row, index) => {
      result.set(row.processId, total > 0 ? pool * (values[index] / total) : pool / rows.length);
    });
  }
  return result;
}

async function costComponents(
  baseRows: ProcessPnlRecord[],
  period: string,
  policies: AllocationPolicyRow[]
) {
  const result = new Map<string, CostComponentMeta>();
  const empty = (): CostComponentMeta => ({
    depreciation: 0,
    amortization: 0,
    financeCost: 0,
    tax: 0,
    otherOperatingCost: 0,
    otherOperatingIncome: 0,
    nonOperatingIncome: 0,
    exceptionalCost: 0,
    exceptionalIncome: 0,
  });
  if (!(await tableExists("process_pnl_cost_component"))) return result;
  const rows = await safeRows<CostComponentRow>(
    `SELECT *
       FROM process_pnl_cost_component
      WHERE period_code = ?
        AND status = 'approved'`,
    [period]
  );
  const branchTypePools = new Map<string, { amount: number }>();

  const apply = (target: CostComponentMeta, type: string, amount: number) => {
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
  };

  for (const row of rows) {
    const amount = numberValue(row.amount_inr);
    if (row.process_id) {
      const target = result.get(String(row.process_id)) ?? empty();
      apply(target, row.cost_type, amount);
      result.set(String(row.process_id), target);
    } else if (row.branch_id) {
      const key = `${row.branch_id}|${row.cost_type}`;
      const current = branchTypePools.get(key) ?? { amount: 0 };
      current.amount += amount;
      branchTypePools.set(key, current);
    }
  }

  const types = Array.from(new Set(rows.map((row) => row.cost_type)));
  for (const type of types) {
    const branchPools = new Map<string, { amount: number }>();
    for (const [key, value] of branchTypePools.entries()) {
      const [branchId, costType] = key.split("|");
      if (costType === type) branchPools.set(branchId, value);
    }
    const allocated = allocateBranchPools(baseRows, branchPools, policies, "shared_service");
    for (const [processId, amount] of allocated.entries()) {
      const target = result.get(processId) ?? empty();
      apply(target, type, amount);
      result.set(processId, target);
    }
  }
  return result;
}

async function budgetMaps(
  baseRows: ProcessPnlRecord[],
  period: string,
  policies: AllocationPolicyRow[]
): Promise<Map<string, BudgetMeta>> {
  const result = new Map<string, BudgetMeta>();
  if (!(await tableExists("finance_budget_header")) || !(await tableExists("finance_budget_line"))) return result;
  const costCentreColumns = await listColumns("cost_centre_master").catch(() => new Set<string>());
  const resolvedProcess = costCentreColumns.has("process_id") ? "COALESCE(fbl.process_id, ccm.process_id)" : "fbl.process_id";
  const rows = await safeRows<RowDataPacket>(
    `SELECT
        fbh.branch_id,
        ${resolvedProcess} AS process_id,
        SUM(COALESCE(fbl.pnl_cost_amount, 0)) AS approved_budget,
        SUM(COALESCE(fbl.reserved_amount, 0)) AS reserved_budget,
        SUM(COALESCE(fbl.consumed_amount, 0)) AS consumed_budget
       FROM finance_budget_header fbh
       JOIN finance_budget_line fbl ON fbl.budget_id = fbh.id
       LEFT JOIN cost_centre_master ccm ON ccm.id = fbl.cost_centre_id
      WHERE fbh.period_code = ?
        AND fbh.status IN ('finance_head_approved','accounts_head_approved','active','closed')
      GROUP BY fbh.branch_id, process_id`,
    [period]
  );
  const branchPools = new Map<string, { amount: number; reserved: number; consumed: number }>();
  for (const row of rows) {
    if (row.process_id) {
      result.set(String(row.process_id), {
        approvedBudget: numberValue(row.approved_budget),
        reservedBudget: numberValue(row.reserved_budget),
        consumedBudget: numberValue(row.consumed_budget),
      });
    } else if (row.branch_id) {
      branchPools.set(String(row.branch_id), {
        amount: numberValue(row.approved_budget),
        reserved: numberValue(row.reserved_budget),
        consumed: numberValue(row.consumed_budget),
      });
    }
  }

  const approvedPools = new Map(Array.from(branchPools.entries()).map(([key, value]) => [key, { amount: value.amount }]));
  const reservedPools = new Map(Array.from(branchPools.entries()).map(([key, value]) => [key, { amount: value.reserved }]));
  const consumedPools = new Map(Array.from(branchPools.entries()).map(([key, value]) => [key, { amount: value.consumed }]));
  const approvedAllocated = allocateBranchPools(baseRows, approvedPools, policies, "bmc_non_people");
  const reservedAllocated = allocateBranchPools(baseRows, reservedPools, policies, "bmc_non_people");
  const consumedAllocated = allocateBranchPools(baseRows, consumedPools, policies, "bmc_non_people");
  for (const row of baseRows) {
    const current = result.get(row.processId) ?? { approvedBudget: 0, reservedBudget: 0, consumedBudget: 0 };
    current.approvedBudget += approvedAllocated.get(row.processId) ?? 0;
    current.reservedBudget += reservedAllocated.get(row.processId) ?? 0;
    current.consumedBudget += consumedAllocated.get(row.processId) ?? 0;
    result.set(row.processId, current);
  }
  return result;
}

async function grnVendorMaps(
  baseRows: ProcessPnlRecord[],
  period: string,
  policies: AllocationPolicyRow[]
): Promise<Map<string, GrnVendorMeta>> {
  const direct = new Map<string, { amount: number; count: number }>();
  const branchPools = new Map<string, { amount: number }>();
  const branchCounts = new Map<string, number>();
  const costCentreColumns = await listColumns("cost_centre_master").catch(() => new Set<string>());
  const resolve = (alias: string) => costCentreColumns.has("process_id")
    ? `COALESCE(${alias}.process_id, ccm.process_id)`
    : `${alias}.process_id`;

  if (await tableExists("vendor_payment_tracking")) {
    const columns = await listColumns("vendor_payment_tracking");
    const amountExpr = columns.has("pnl_cost_amount") ? "COALESCE(vpt.pnl_cost_amount, vpt.due_amount, 0)" : "COALESCE(vpt.due_amount, 0)";
    const periodExpr = columns.has("recognition_period")
      ? "COALESCE(vpt.recognition_period, DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m'))"
      : "DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m')";
    const statusExpr = columns.has("payment_status")
      ? "LOWER(COALESCE(vpt.payment_status, '')) IN ('approved','posted','scheduled','partially_paid','paid','pending')"
      : "1=1";
    const rows = await safeRows<RowDataPacket>(
      `SELECT vpt.branch_id, ${resolve("vpt")} AS process_id, vpt.cost_class,
              SUM(${amountExpr}) AS amount, COUNT(*) AS item_count
         FROM vendor_payment_tracking vpt
         LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
        WHERE ${periodExpr} = ?
          AND ${statusExpr}
        GROUP BY vpt.branch_id, process_id, vpt.cost_class`,
      [period]
    );
    for (const row of rows) {
      if (row.process_id || String(row.cost_class) === "direct") {
        const key = String(row.process_id ?? "");
        if (!key) continue;
        const current = direct.get(key) ?? { amount: 0, count: 0 };
        current.amount += numberValue(row.amount);
        current.count += numberValue(row.item_count);
        direct.set(key, current);
      } else if (row.branch_id) {
        const key = String(row.branch_id);
        branchPools.set(key, { amount: numberValue(row.amount) });
        branchCounts.set(key, numberValue(row.item_count));
      }
    }
  }

  if (await tableExists("grn_request")) {
    const columns = await listColumns("grn_request");
    const amountExpr = columns.has("pnl_cost_amount")
      ? "COALESCE(g.pnl_cost_amount, g.amount, 0)"
      : "COALESCE(g.amount, 0)";
    const periodExpr = columns.has("recognition_period")
      ? "COALESCE(g.recognition_period, DATE_FORMAT(COALESCE(g.bill_date, g.reviewed_at, g.created_at), '%Y-%m'))"
      : "DATE_FORMAT(COALESCE(g.bill_date, g.reviewed_at, g.created_at), '%Y-%m')";
    const rows = await safeRows<RowDataPacket>(
      `SELECT g.branch_id, ${resolve("g")} AS process_id, g.cost_class,
              SUM(${amountExpr}) AS amount, COUNT(*) AS item_count
         FROM grn_request g
         LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
         LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = g.id
        WHERE ${periodExpr} = ?
          AND LOWER(COALESCE(g.status, '')) IN ('approved','finance_head_approved','pending_accounts_payment','payment_scheduled','partially_paid','paid','posted')
          AND vpt.id IS NULL
        GROUP BY g.branch_id, process_id, g.cost_class`,
      [period]
    );
    for (const row of rows) {
      if (row.process_id || String(row.cost_class) === "direct") {
        const key = String(row.process_id ?? "");
        if (!key) continue;
        const current = direct.get(key) ?? { amount: 0, count: 0 };
        current.amount += numberValue(row.amount);
        current.count += numberValue(row.item_count);
        direct.set(key, current);
      } else if (row.branch_id) {
        const key = String(row.branch_id);
        const current = branchPools.get(key) ?? { amount: 0 };
        current.amount += numberValue(row.amount);
        branchPools.set(key, current);
        branchCounts.set(key, (branchCounts.get(key) ?? 0) + numberValue(row.item_count));
      }
    }
  }

  const bmcAllocated = allocateBranchPools(baseRows, branchPools, policies, "bmc_non_people");
  const result = new Map<string, GrnVendorMeta>();
  for (const row of baseRows) {
    const directMeta = direct.get(row.processId) ?? { amount: 0, count: 0 };
    const branchCount = row.branchId ? branchCounts.get(row.branchId) ?? 0 : 0;
    result.set(row.processId, {
      directActual: directMeta.amount,
      bmcAllocatedActual: bmcAllocated.get(row.processId) ?? 0,
      itemCount: directMeta.count + branchCount,
    });
  }
  return result;
}

async function costCentreMap(processIds: string[]) {
  const map = new Map<string, { id: string; code: string | null }>();
  if (processIds.length === 0 || !(await tableExists("cost_centre_master"))) return map;
  const columns = await listColumns("cost_centre_master");
  if (!columns.has("process_id")) return map;
  const codeColumn = columns.has("cost_centre_code") ? "cost_centre_code" : columns.has("code") ? "code" : "NULL";
  const rows = await safeRows<RowDataPacket>(
    `SELECT id, process_id, ${codeColumn} AS cost_centre_code
       FROM cost_centre_master
      WHERE process_id IN (${placeholders(processIds)})
        AND COALESCE(active_status, 1) = 1
      ORDER BY updated_at DESC`,
    processIds
  );
  for (const row of rows) {
    const key = String(row.process_id);
    if (!map.has(key)) map.set(key, { id: String(row.id), code: row.cost_centre_code ? String(row.cost_centre_code) : null });
  }
  return map;
}

function componentAmount(rows: RevenueComponentRow[], type: string, direction?: "increase" | "decrease") {
  return rows
    .filter((row) => row.component_type === type && (!direction || row.direction === direction))
    .reduce((sum, row) => sum + numberValue(row.amount_inr), 0);
}

function otherComponentAmount(
  rows: RevenueComponentRow[],
  direction: "increase" | "decrease",
  excluded: string[]
) {
  return rows
    .filter((row) => row.direction === direction && !excluded.includes(row.component_type))
    .reduce((sum, row) => sum + numberValue(row.amount_inr), 0);
}

function grossPotentialRevenue(rules: RevenueRuleInput[], deliveries: DeliveryMetricInput[]) {
  const deliveryMap = new Map(deliveries.map((item) => [item.metricKey, item]));
  return rules.reduce((sum, rule) => {
    const fx = numberValue(rule.fxToInr, 1) || 1;
    const rate = numberValue(rule.rateAmount) * fx;
    if (rule.billingModel === "fixed_monthly") return sum + Math.max(rate, numberValue(rule.monthlyMinimumCommitment) * fx);
    const planned = numberValue(deliveryMap.get(rule.metricKey)?.plannedUnits || rule.mandatedSeats);
    const included = numberValue(rule.includedUnits);
    const overageRate = numberValue(rule.overageRate) > 0 ? numberValue(rule.overageRate) * fx : rate;
    const amount = included > 0 && planned > included
      ? included * rate + (planned - included) * overageRate
      : planned * rate;
    return sum + Math.max(amount, numberValue(rule.monthlyMinimumCommitment) * fx);
  }, 0);
}

function statusFrom(row: { ebitda: number; recognizedRevenue: number; revenueAtRisk: number; deliveryAttainmentPct: number | null }) {
  if (row.ebitda < 0) return "loss-making" as const;
  if (row.recognizedRevenue <= 0 || row.revenueAtRisk > 0 || (row.deliveryAttainmentPct != null && row.deliveryAttainmentPct < 90)) {
    return "at-risk" as const;
  }
  return "profitable" as const;
}

async function buildRows(filters: Partial<PnlQueryFilters>) {
  const normalized = normalizeFilters(filters);
  const baseRows = await processPnlService.listProcesses(normalized);
  const processIds = baseRows.map((row) => row.processId);
  const policies = await allocationPolicies(normalized.period);
  const [rulesMap, deliveryMap, componentsMap, plans, people, costMap, budgets, grnVendors, costCentres] = await Promise.all([
    revenueRules(processIds, normalized.period),
    deliveryActuals(processIds, normalized.period),
    revenueComponents(processIds, normalized.period),
    monthlyPlanExtensions(processIds, normalized.period),
    peopleCostMaps(baseRows, normalized.period, policies),
    costComponents(baseRows, normalized.period, policies),
    budgetMaps(baseRows, normalized.period, policies),
    grnVendorMaps(baseRows, normalized.period, policies),
    costCentreMap(processIds),
  ]);

  const rows: BpoPnlRow[] = baseRows.map((base) => {
    const configuredRules = rulesMap.get(base.processId) ?? [];
    const deliveryRows = deliveryMap.get(base.processId) ?? [];
    const componentRows = componentsMap.get(base.processId) ?? [];
    const plan = plans.get(base.processId);
    const peopleMeta = people.processMap.get(base.processId) ?? {
      agentSalary: base.directPeopleCost,
      dscPeople: 0,
      agentHeadcount: Math.max(1, base.activeHc),
      dscHeadcount: 0,
      unclassifiedPeopleCost: 0,
    };
    const bmcPeople = people.bmcPeopleByProcess.get(base.processId) ?? 0;
    const additional = costMap.get(base.processId) ?? {
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
    const budget = budgets.get(base.processId) ?? { approvedBudget: 0, reservedBudget: 0, consumedBudget: 0 };
    const grnVendor = grnVendors.get(base.processId) ?? { directActual: 0, bmcAllocatedActual: 0, itemCount: 0 };
    const costCentre = costCentres.get(base.processId);
    const fallbackModel = normalizeBillingModel(base.billingModel);
    const fallbackRule: RevenueRuleInput = {
      billingModel: fallbackModel,
      metricKey: metricKeyForModel(fallbackModel),
      rateAmount: numberValue(base.resolvedRate),
      fxToInr: 1,
      monthlyMinimumCommitment: 0,
      mandatedSeats: numberValue(base.contractedSeats),
    };
    const rules: RevenueRuleInput[] = configuredRules.length > 0
      ? configuredRules.map((rule) => ({
          billingModel: normalizeBillingModel(rule.billing_model),
          metricKey: rule.metric_key,
          rateAmount: numberValue(rule.rate_amount),
          fxToInr: numberValue(rule.fx_to_inr, 1),
          monthlyMinimumCommitment: numberValue(rule.monthly_minimum_commitment),
          includedUnits: numberValue(rule.included_units),
          overageRate: numberValue(rule.overage_rate),
          mandatedSeats: numberValue(rule.mandated_seats || base.contractedSeats),
        }))
      : numberValue(base.resolvedRate) > 0
      ? [fallbackRule]
      : [];
    const deliveries: DeliveryMetricInput[] = deliveryRows.map((row) => ({
      metricKey: row.metric_key,
      plannedUnits: numberValue(row.planned_units),
      deliveredUnits: numberValue(row.delivered_units),
      acceptedUnits: numberValue(row.accepted_units),
      rejectedUnits: numberValue(row.rejected_units),
      billableUnits: numberValue(row.billable_units),
      productiveHours: numberValue(row.productive_hours),
      loginHours: numberValue(row.login_hours),
      talkMinutes: numberValue(row.talk_minutes),
      qualityScore: row.quality_score == null ? null : numberValue(row.quality_score),
      slaScore: row.sla_score == null ? null : numberValue(row.sla_score),
    }));
    if (deliveries.length === 0 && rules.length > 0) {
      deliveries.push({
        metricKey: rules[0].metricKey,
        plannedUnits: numberValue(plan?.planned_delivery_units || base.contractedSeats),
        deliveredUnits: numberValue(base.billableHc || base.deployedHc),
        acceptedUnits: numberValue(base.billableHc || base.deployedHc),
        billableUnits: numberValue(base.billableHc || base.deployedHc),
      });
    }
    const revenueInputComponents: RevenueComponentInput[] = componentRows.map((row) => ({
      type: row.component_type,
      direction: row.direction,
      amountInr: numberValue(row.amount_inr),
    }));
    const revenueCalc = calculateRevenue(rules, deliveries, revenueInputComponents);
    const hasConfiguredRules = configuredRules.length > 0;
    const hasValidatedDelivery = deliveryRows.length > 0;
    const recognizedRevenue = numberValue(base.revenueMtd) > 0 ? numberValue(base.revenueMtd) : revenueCalc.earnedRevenue;
    const cost = calculateBpoCostWaterfall({
      revenue: recognizedRevenue,
      agentSalary: peopleMeta.agentSalary,
      dscPeople: peopleMeta.dscPeople,
      dscNonPeople: numberValue(base.directNonPeopleCost),
      bmcPeople,
      bmcNonPeople: numberValue(base.indirectCost),
      otherOperatingCost: additional.otherOperatingCost,
      otherOperatingIncome: additional.otherOperatingIncome,
      depreciation: additional.depreciation,
      amortization: additional.amortization,
      financeCost: additional.financeCost,
      nonOperatingIncome: additional.nonOperatingIncome,
      tax: additional.tax,
      exceptionalCost: additional.exceptionalCost,
      exceptionalIncome: additional.exceptionalIncome,
      agentHeadcount: peopleMeta.agentHeadcount,
      activeHeadcount: base.activeHc,
      contractedSeats: base.contractedSeats,
      billableSeats: base.billableHc,
    });
    const availableBudget = budget.approvedBudget - budget.reservedBudget - budget.consumedBudget;
    const qualityScores = deliveries.map((item) => item.qualityScore).filter((value): value is number => value != null);
    const slaScores = deliveries.map((item) => item.slaScore).filter((value): value is number => value != null);
    const incentiveRevenue = componentAmount(componentRows, "incentive", "increase");
    const rewardRevenue = componentAmount(componentRows, "reward", "increase");
    const trainingRevenue = componentAmount(componentRows, "training_revenue", "increase");
    const penalty = componentAmount(componentRows, "penalty", "decrease");
    const slaDeduction = componentAmount(componentRows, "sla_deduction", "decrease");
    const creditNote = componentAmount(componentRows, "credit_note", "decrease");
    const otherRevenueIncrease = otherComponentAmount(componentRows, "increase", ["incentive", "reward", "training_revenue"]);
    const otherRevenueDecrease = otherComponentAmount(componentRows, "decrease", ["penalty", "sla_deduction", "credit_note"]);
    const rowBase = {
      ebitda: cost.ebitda,
      recognizedRevenue,
      revenueAtRisk: numberValue(base.revenueAtRisk),
      deliveryAttainmentPct: revenueCalc.deliveryAttainmentPct,
    };

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
      revenueDataStatus: hasConfiguredRules
        ? hasValidatedDelivery ? "configured" : "configured_no_delivery"
        : "accounting_fallback",
      mandatedSeats: configuredRules[0]?.mandated_seats ?? base.contractedSeats,
      contractedSeats: base.contractedSeats,
      requiredProductiveHc: base.requiredProductiveHc,
      requiredRosterHc: base.requiredRosterHc,
      activeHc: base.activeHc,
      agentHeadcount: peopleMeta.agentHeadcount,
      supportHeadcount: peopleMeta.dscHeadcount,
      billableHc: base.billableHc,
      seatFillPct: percentage(base.activeHc, numberValue(base.contractedSeats)),
      billableSeatUtilizationPct: percentage(numberValue(base.billableHc), numberValue(base.contractedSeats)),
      plannedDeliveryUnits: revenueCalc.plannedUnits,
      deliveredUnits: revenueCalc.deliveredUnits,
      acceptedUnits: revenueCalc.acceptedUnits,
      rejectedUnits: revenueCalc.rejectedUnits,
      billableUnits: revenueCalc.billableUnits,
      productiveHours: deliveries.reduce((sum, item) => sum + numberValue(item.productiveHours), 0),
      loginHours: deliveries.reduce((sum, item) => sum + numberValue(item.loginHours), 0),
      talkMinutes: deliveries.reduce((sum, item) => sum + numberValue(item.talkMinutes), 0),
      qualityScore: qualityScores.length ? qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length : null,
      slaScore: slaScores.length ? slaScores.reduce((sum, value) => sum + value, 0) / slaScores.length : null,
      deliveryAttainmentPct: revenueCalc.deliveryAttainmentPct,
      acceptancePct: revenueCalc.acceptancePct,
      grossPotentialRevenue: grossPotentialRevenue(rules, deliveries),
      baseEarnedRevenue: revenueCalc.baseRevenue,
      minimumCommitmentTopUp: revenueCalc.minimumCommitmentTopUp,
      incentiveRevenue,
      rewardRevenue,
      trainingRevenue,
      otherRevenueIncrease,
      penalty,
      slaDeduction,
      creditNote,
      otherRevenueDecrease,
      earnedRevenue: revenueCalc.earnedRevenue,
      recognizedRevenue,
      invoicedRevenue: numberValue(base.invoicedRevenueMtd),
      collectedRevenue: numberValue(base.collectedRevenueMtd),
      outstandingReceivable: numberValue(base.outstandingReceivable),
      unbilledRevenue: Math.max(0, revenueCalc.earnedRevenue - numberValue(base.invoicedRevenueMtd)),
      deferredRevenue: Math.max(0, numberValue(base.invoicedRevenueMtd) - revenueCalc.earnedRevenue),
      revenueLeakage: numberValue(base.revenueLeakage),
      revenueAtRisk: numberValue(base.revenueAtRisk),
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
      grnVendorActual: grnVendor.directActual + grnVendor.bmcAllocatedActual,
      totalPeopleCost: cost.totalPeopleCost,
      peopleCostPctRevenue: cost.peopleCostPctRevenue,
      contribution: cost.contribution,
      contributionMarginPct: cost.contributionMarginPct,
      ebitda: cost.ebitda,
      ebitdaMarginPct: cost.ebitdaMarginPct,
      depreciation: additional.depreciation,
      amortization: additional.amortization,
      ebit: cost.ebit,
      operatingProfit: cost.operatingProfit,
      operatingProfitPct: cost.operatingProfitPct,
      financeCost: additional.financeCost,
      pbt: cost.pbt,
      tax: additional.tax,
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
      budgetUtilizationPct: percentage(budget.consumedBudget + budget.reservedBudget, budget.approvedBudget),
      ebitdaBudget: plan?.ebitda_budget == null ? null : numberValue(plan.ebitda_budget),
      ebitdaVariance: plan?.ebitda_budget == null ? null : cost.ebitda - numberValue(plan.ebitda_budget),
      processStatus: statusFrom(rowBase),
      freshness: [
        base.freshness,
        ...deliveryRows.map((item) => item.updated_at),
      ].filter(Boolean).sort().at(-1) ?? null,
    };
  });

  return { filters: normalized, rows, rulesMap, deliveryMap, componentsMap, people, costMap, budgets, grnVendors };
}

function sum(rows: BpoPnlRow[], field: keyof BpoPnlRow): number {
  return rows.reduce((total, row) => total + numberValue(row[field]), 0);
}

function weightedPct(rows: BpoPnlRow[], numerator: keyof BpoPnlRow, denominator: keyof BpoPnlRow) {
  return percentage(sum(rows, numerator), sum(rows, denominator));
}

export const bpoPnlService = {
  async getSummary(filters: Partial<PnlQueryFilters>) {
    const { filters: normalized, rows } = await buildRows(filters);
    const revenue = sum(rows, "recognizedRevenue");
    const ebitda = sum(rows, "ebitda");
    const operatingProfit = sum(rows, "operatingProfit");
    const pbt = sum(rows, "pbt");
    const pat = sum(rows, "pat");
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
      } else if (row.revenueDataStatus === "configured_no_delivery") {
        alerts.push({
          type: "warning",
          code: "DELIVERY_ACTUAL_MISSING",
          title: "Delivery actual missing",
          detail: `${row.processName} has a billing rule but no validated delivery data for ${normalized.period}.`,
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
    }

    return {
      period: normalized.period,
      filters: normalized,
      kpis: {
        grossPotentialRevenue: sum(rows, "grossPotentialRevenue"),
        earnedRevenue: sum(rows, "earnedRevenue"),
        recognizedRevenue: revenue,
        invoicedRevenue: sum(rows, "invoicedRevenue"),
        collectedRevenue: sum(rows, "collectedRevenue"),
        outstandingReceivable: sum(rows, "outstandingReceivable"),
        unbilledRevenue: sum(rows, "unbilledRevenue"),
        revenueAtRisk: sum(rows, "revenueAtRisk"),
        agentSalary: sum(rows, "agentSalary"),
        agentSalaryPctRevenue: weightedPct(rows, "agentSalary", "recognizedRevenue"),
        dsc: sum(rows, "dsc"),
        dscPctRevenue: weightedPct(rows, "dsc", "recognizedRevenue"),
        bmc: sum(rows, "bmc"),
        bmcPctRevenue: weightedPct(rows, "bmc", "recognizedRevenue"),
        grnVendorActual: sum(rows, "grnVendorActual"),
        totalPeopleCost: sum(rows, "totalPeopleCost"),
        peopleCostPctRevenue: weightedPct(rows, "totalPeopleCost", "recognizedRevenue"),
        contribution: sum(rows, "contribution"),
        ebitda,
        ebitdaMarginPct: percentage(ebitda, revenue),
        operatingProfit,
        operatingProfitPct: percentage(operatingProfit, revenue),
        pbt,
        pat,
        approvedBudget: sum(rows, "approvedBudget"),
        consumedBudget: sum(rows, "consumedBudget"),
        reservedBudget: sum(rows, "reservedBudget"),
        availableBudget: sum(rows, "availableBudget"),
        activeHeadcount: sum(rows, "activeHc"),
        agentHeadcount: sum(rows, "agentHeadcount"),
        configuredProcesses: rows.filter((row) => row.revenueDataStatus !== "accounting_fallback").length,
        totalProcesses: rows.length,
        revenueModelCoveragePct: percentage(
          rows.filter((row) => row.revenueDataStatus !== "accounting_fallback").length,
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
      alerts: alerts.sort((left, right) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[left.type] - order[right.type] || numberValue(right.impact) - numberValue(left.impact);
      }),
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
      "Reserved Budget", "Consumed Budget", "Available Budget", "Status"
    ];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return [
      headers.map(escape).join(","),
      ...summary.rows.map((row) => [
        row.processName, row.clientName, row.branchName, row.costCentreCode, row.billingModels.join(" + "), row.mandatedSeats,
        row.activeHc, row.agentHeadcount, row.plannedDeliveryUnits, row.deliveredUnits, row.billableUnits,
        row.deliveryAttainmentPct?.toFixed(2), row.grossPotentialRevenue.toFixed(2), row.earnedRevenue.toFixed(2),
        row.recognizedRevenue.toFixed(2), row.invoicedRevenue.toFixed(2), row.collectedRevenue.toFixed(2),
        row.outstandingReceivable.toFixed(2), row.unbilledRevenue.toFixed(2), row.agentSalary.toFixed(2),
        row.agentSalaryPctRevenue?.toFixed(2), row.dsc.toFixed(2), row.dscPctRevenue?.toFixed(2), row.bmc.toFixed(2),
        row.bmcPctRevenue?.toFixed(2), row.grnVendorActual.toFixed(2), row.ebitda.toFixed(2), row.ebitdaMarginPct?.toFixed(2),
        row.ebit.toFixed(2), row.operatingProfitPct?.toFixed(2), row.pbt.toFixed(2), row.pat.toFixed(2),
        row.approvedBudget.toFixed(2), row.reservedBudget.toFixed(2), row.consumedBudget.toFixed(2),
        row.availableBudget.toFixed(2), row.processStatus,
      ].map(escape).join(",")),
    ].join("\n");
  },

  async listRevenueRules(processId?: string) {
    if (!(await tableExists("process_revenue_rule"))) return [];
    return safeRows<RowDataPacket>(
      `SELECT * FROM process_revenue_rule ${processId ? "WHERE process_id = ?" : ""} ORDER BY process_id, effective_from DESC`,
      processId ? [processId] : []
    );
  },

  async saveRevenueRule(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
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
        id, payload.processId, payload.contractId ?? null, payload.ruleName, payload.billingModel, payload.metricKey,
        numberValue(payload.rateAmount), String(payload.currencyCode ?? "INR"), numberValue(payload.fxToInr, 1),
        numberValue(payload.monthlyMinimumCommitment), numberValue(payload.includedUnits), numberValue(payload.overageRate),
        payload.mandatedSeats ?? null, payload.qualityGatePct ?? null, payload.slaGatePct ?? null,
        payload.effectiveFrom, payload.effectiveTo ?? null, status,
        status === "approved" ? userId : null, status === "approved" ? new Date() : null,
        payload.approvalReference ?? null, userId, userId,
      ]
    );
    return { id };
  },

  async saveDeliveryActual(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
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
        id, payload.processId, payload.periodCode, payload.activityDate ?? null, payload.metricKey,
        numberValue(payload.plannedUnits), numberValue(payload.deliveredUnits), numberValue(payload.acceptedUnits),
        numberValue(payload.rejectedUnits), numberValue(payload.billableUnits), numberValue(payload.productiveHours),
        numberValue(payload.loginHours), numberValue(payload.talkMinutes), payload.qualityScore ?? null, payload.slaScore ?? null,
        String(payload.dataSource ?? "manual"), String(payload.sourceReference ?? "manual"), String(payload.status ?? "draft"),
        ["validated", "locked"].includes(String(payload.status)) ? userId : null,
        ["validated", "locked"].includes(String(payload.status)) ? new Date() : null,
        userId, userId,
      ]
    );
    return { id };
  },

  async saveRevenueComponent(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
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
        id, payload.processId, payload.periodCode, payload.componentType, payload.direction, payload.description,
        payload.units ?? null, payload.rate ?? null, numberValue(payload.amountInr), payload.recognitionDate ?? null,
        payload.invoiceReference ?? null, payload.sourceReference ?? null, status,
        status === "approved" ? userId : null, status === "approved" ? new Date() : null, userId,
      ]
    );
    return { id };
  },

  async saveCostComponent(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
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
        id, payload.processId ?? null, payload.branchId ?? null, payload.periodCode, payload.costType,
        payload.description, numberValue(payload.amountInr), String(payload.allocationDriver ?? "direct"),
        payload.manualAllocationPct ?? null, payload.sourceReference ?? null, status,
        status === "approved" ? userId : null, status === "approved" ? new Date() : null, userId,
      ]
    );
    return { id };
  },

  async saveAllocationPolicy(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
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
        id, payload.branchId, payload.processId ?? null, payload.poolType,
        String(payload.allocationDriver ?? "active_hc"), payload.manualAllocationPct ?? null,
        payload.effectiveFrom, payload.effectiveTo ?? null, status,
        status === "approved" ? userId : null, status === "approved" ? new Date() : null, userId, userId,
      ]
    );
    return { id };
  },
};
