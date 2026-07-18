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
      )
        .then((rows) => new Set(rows.map((row) => String(row.column_name))))
        .catch((error) => {
          columnCache.delete(tableName);
          throw error;
        })
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
  const runs = await safeRows<RowDataPacket>(
    `SELECT id
       FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY FIELD(status, 'locked', 'approved', 'completed', 'processed', 'draft') DESC, created_at DESC
      LIMIT 1`,
    [period]
  );
  if (!runs[0]?.id) return [];

  const salaryColumns = await listColumns("salary_prep_line");
  const employeeColumns = await listColumns("employees");
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
  const processExpr = employeeColumns.has("process_id") ? "e.process_id" : "NULL";
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
       ${designationJoin}
       ${departmentJoin}
      WHERE spl.run_id = ?
      GROUP BY e.id, e.employee_code, process_id, branch_id, designation_id, designation_name, department_id, department_name`,
    [String(runs[0].id)]
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

function allocationDriverValue(row: ProcessPnlRecord, driver: AllocationDriver): number {
  switch (driver) {
    case "billable_hc": return toNumber(row.billableHc);
    case "contracted_seats": return toNumber(row.contractedSeats);
    case "revenue": return toNumber(row.revenueMtd);
    case "equal": return 1;
    case "active_hc":
    default: return toNumber(row.activeHc);
  }
}

function allocateBranchPools<T extends { amount: number }>(
  baseRows: ProcessPnlRecord[],
  pools: ReadonlyMap<string, T>,
  policies: AllocationPolicyRow[],
  poolType: string
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
      rows.forEach((row, index) => {
        const manualPct = toNumber(processPolicies[index]?.manual_allocation_pct);
        result.set(row.processId, poolAmount * (manualPct / 100));
      });
      continue;
    }

    const driver = branchPolicy?.allocation_driver ?? "active_hc";
    const values = rows.map((row) => allocationDriverValue(row, driver));
    const total = values.reduce((sum, value) => sum + value, 0);
    rows.forEach((row, index) => {
      result.set(row.processId, total > 0 ? poolAmount * (values[index] / total) : poolAmount / rows.length);
    });
  }
  return result;
}

async function getPeopleCosts(
  baseRows: ProcessPnlRecord[],
  period: string,
  policies: AllocationPolicyRow[]
) {
  const processMap = new Map<string, PeopleCostMeta>();
  const branchPool = new Map<string, { amount: number; headcount: number }>();
  const [people, rules] = await Promise.all([getPayrollPeople(period), getClassificationRules(period)]);

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

  return {
    processMap,
    bmcPeopleByProcess: allocateBranchPools(baseRows, branchPool, policies, "bmc_people"),
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
  policies: AllocationPolicyRow[]
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
    const allocated = allocateBranchPools(baseRows, pools, policies, "shared_service");
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
  policies: AllocationPolicyRow[]
): Promise<Map<string, BudgetMeta>> {
  const result = new Map<string, BudgetMeta>();
  if (!(await tableExists("finance_budget_header")) || !(await tableExists("finance_budget_line"))) return result;
  const costCentreColumns = await listColumns("cost_centre_master").catch(() => new Set<string>());
  const processExpr = costCentreColumns.has("process_id") ? "COALESCE(fbl.process_id, ccm.process_id)" : "fbl.process_id";
  const rows = await safeRows<RowDataPacket>(
    `SELECT
        fbh.branch_id,
        ${processExpr} AS process_id,
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

  const branchApproved = new Map<string, { amount: number }>();
  const branchReserved = new Map<string, { amount: number }>();
  const branchConsumed = new Map<string, { amount: number }>();
  for (const row of rows) {
    if (row.process_id) {
      result.set(String(row.process_id), {
        approvedBudget: toNumber(row.approved_budget),
        reservedBudget: toNumber(row.reserved_budget),
        consumedBudget: toNumber(row.consumed_budget),
      });
    } else if (row.branch_id) {
      const branchId = String(row.branch_id);
      branchApproved.set(branchId, { amount: toNumber(row.approved_budget) });
      branchReserved.set(branchId, { amount: toNumber(row.reserved_budget) });
      branchConsumed.set(branchId, { amount: toNumber(row.consumed_budget) });
    }
  }

  const allocatedApproved = allocateBranchPools(baseRows, branchApproved, policies, "bmc_non_people");
  const allocatedReserved = allocateBranchPools(baseRows, branchReserved, policies, "bmc_non_people");
  const allocatedConsumed = allocateBranchPools(baseRows, branchConsumed, policies, "bmc_non_people");
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
  policies: AllocationPolicyRow[]
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
    const rows = await safeRows<RowDataPacket>(
      `SELECT
          vpt.branch_id,
          ${resolveProcess("vpt")} AS process_id,
          ${bucketExpr} AS pnl_bucket,
          SUM(${amountExpr}) AS amount,
          COUNT(*) AS item_count
         FROM vendor_payment_tracking vpt
         LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
        WHERE ${recognitionExpr} = ?
          AND ${actualVendorStatusExpr(columns)}
        GROUP BY vpt.branch_id, process_id, pnl_bucket`,
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
    const rows = await safeRows<RowDataPacket>(
      `SELECT
          g.branch_id,
          ${resolveProcess("g")} AS process_id,
          ${bucketExpr} AS pnl_bucket,
          SUM(${amountExpr}) AS amount,
          COUNT(*) AS item_count
         FROM grn_request g
         LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
         LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = g.id
        WHERE ${recognitionExpr} = ?
          AND LOWER(REPLACE(COALESCE(g.status, ''), '_', ' ')) IN (
            'approved','finance head approved','pending accounts payment','payment scheduled',
            'partially paid','paid','posted'
          )
          AND vpt.id IS NULL
        GROUP BY g.branch_id, process_id, pnl_bucket`,
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

  const allocatedBmc = allocateBranchPools(baseRows, branchPools, policies, "bmc_non_people");
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
  const [rulesMap, deliveryMap, componentsMap, plans, people, costComponents, budgets, grnActuals, costCentres] = await Promise.all([
    getRevenueRules(processIds, normalized.period),
    getDeliveryActuals(processIds, normalized.period),
    getRevenueComponents(processIds, normalized.period),
    getMonthlyPlans(processIds, normalized.period),
    getPeopleCosts(baseRows, normalized.period, policies),
    getCostComponents(baseRows, normalized.period, policies),
    getBudgets(baseRows, normalized.period, policies),
    getGrnVendorActuals(baseRows, normalized.period, policies),
    getCostCentres(processIds),
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
    const recognizedRevenue = toNumber(base.revenueMtd) > 0 ? toNumber(base.revenueMtd) : revenue.earnedRevenue;
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
    const rewardRevenue = componentAmount(componentRows, "reward", "increase");
    const trainingRevenue = componentAmount(componentRows, "training_revenue", "increase");
    const penalty = componentAmount(componentRows, "penalty", "decrease");
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
        : "accounting_fallback",
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
  };
}

function sum(rows: BpoPnlRow[], field: keyof BpoPnlRow): number {
  return rows.reduce((total, row) => total + toNumber(row[field]), 0);
}

function ratio(rows: BpoPnlRow[], numerator: keyof BpoPnlRow, denominator: keyof BpoPnlRow) {
  return pct(sum(rows, numerator), sum(rows, denominator));
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

    const severity = { critical: 0, warning: 1, info: 2 } as const;
    alerts.sort((left, right) => severity[left.type] - severity[right.type] || toNumber(right.impact) - toNumber(left.impact));

    return {
      period: bundle.filters.period,
      filters: bundle.filters,
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
        configuredProcesses: rows.filter((row) => row.revenueDataStatus !== "accounting_fallback").length,
        totalProcesses: rows.length,
        revenueModelCoveragePct: pct(
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
    return { id };
  },

  async saveDeliveryActual(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    const status = String(payload.status ?? "draft");
    const validated = status === "validated" || status === "locked";
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
    return { id };
  },
};
