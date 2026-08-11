import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
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
import { bpoPnlAllocationOverlayService } from "./bpo-pnl-allocation-overlay.service.js";
import type { BpoPnlRow } from "./bpo-pnl.service.js";
import type { PnlQueryFilters } from "./process-pnl.types.js";

type LobStatus = "draft" | "approved" | "inactive";
type PlanStatus = "draft" | "approved" | "locked";
type CostBucket = "agent_salary" | "dsc_people";
type SharedCostDriver =
  | "contracted_seats"
  | "billable_seats"
  | "occupied_seats"
  | "active_hc"
  | "revenue"
  | "equal"
  | "manual";

export interface SaveProcessLobInput {
  id?: string;
  processId: string;
  lobCode: string;
  lobName: string;
  description?: string | null;
  costCentreId?: string | null;
  allocationScope?: "direct_lob" | "shared_process";
  effectiveFrom: string;
  effectiveTo?: string | null;
  activeStatus?: boolean;
  approvalStatus?: LobStatus;
}

export interface SaveLobPlanInput {
  id?: string;
  processLobId: string;
  periodCode: string;
  contractedSeats?: number | null;
  billableSeats?: number | null;
  occupiedSeats?: number | null;
  requiredProductiveHc?: number | null;
  requiredRosterHc?: number | null;
  revenueBudget?: number | null;
  agentCostBudget?: number | null;
  directVendorCostBudget?: number | null;
  sharedCostBudget?: number | null;
  ebitdaBudget?: number | null;
  sharedCostDriver?: SharedCostDriver;
  manualAllocationPct?: number | null;
  status?: PlanStatus;
}

export interface SaveEmployeeLobAssignmentInput {
  id?: string;
  employeeId: string;
  processLobId: string;
  costBucket?: CostBucket;
  allocationPct: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  assignmentSource?: "manual" | "roster" | "timesheet" | "bulk_upload" | "system";
  status?: "draft" | "approved" | "inactive";
}

interface LobRow extends RowDataPacket {
  id: string;
  process_id: string;
  lob_code: string;
  lob_name: string;
  description: string | null;
  cost_centre_id: string | null;
  allocation_scope: "direct_lob" | "shared_process";
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  approval_status: LobStatus;
  process_name?: string;
  client_id?: string | null;
  client_name?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  cost_centre_code?: string | null;
  cost_centre_name?: string | null;
}

interface LobPlanRow extends RowDataPacket {
  id: string;
  process_lob_id: string;
  period_code: string;
  contracted_seats: number | null;
  billable_seats: number | null;
  occupied_seats: number | null;
  required_productive_hc: number | null;
  required_roster_hc: number | null;
  revenue_budget: number | null;
  agent_cost_budget: number | null;
  direct_vendor_cost_budget: number | null;
  shared_cost_budget: number | null;
  ebitda_budget: number | null;
  shared_cost_driver: SharedCostDriver;
  manual_allocation_pct: number | null;
  status: PlanStatus;
}

interface LobRevenueRuleRow extends RowDataPacket {
  process_lob_id: string;
  billing_model: BpoBillingModel;
  metric_key: string;
  rate_amount: number;
  fx_to_inr: number;
  monthly_minimum_commitment: number;
  included_units: number;
  overage_rate: number;
  mandated_seats: number | null;
}

interface LobDeliveryRow extends RowDataPacket {
  process_lob_id: string;
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
  updated_at: string | null;
}

interface LobRevenueComponentRow extends RowDataPacket {
  process_lob_id: string;
  component_type: string;
  direction: "increase" | "decrease";
  amount_inr: number;
}

interface LobPayrollRow extends RowDataPacket {
  process_lob_id: string;
  cost_bucket: CostBucket;
  loaded_cost: number;
  employee_count: number;
  allocation_pct_total: number;
}

interface LobGrnRow extends RowDataPacket {
  process_lob_id: string;
  pnl_bucket: string;
  pnl_cost_amount: number;
  gross_amount: number;
  allocation_count: number;
  freshness: string | null;
}

interface LobCostComponentRow extends RowDataPacket {
  process_lob_id: string;
  cost_type: string;
  amount_inr: number;
}

interface DirectLobData {
  revenue: ReturnType<typeof calculateRevenue>;
  agentSalary: number;
  dscPeople: number;
  agentHeadcount: number;
  dscHeadcount: number;
  dscNonPeople: number;
  bmcNonPeople: number;
  depreciation: number;
  amortization: number;
  financeCost: number;
  tax: number;
  otherOperatingCost: number;
  otherOperatingIncome: number;
  nonOperatingIncome: number;
  exceptionalCost: number;
  exceptionalIncome: number;
  grnGrossAmount: number;
  grnAllocationCount: number;
  freshness: string | null;
}

const columnCache = new Map<string, Promise<Set<string>>>();

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizePeriod(value?: string): string {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : currentPeriod();
}

function monthRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(lastDay).padStart(2, "0")}`,
  };
}

function dateRangeOverlaps(
  existingFrom: string,
  existingTo: string | null,
  nextFrom: string,
  nextTo: string | null
) {
  const existingEnd = existingTo ?? "9999-12-31";
  const nextEnd = nextTo ?? "9999-12-31";
  return existingFrom <= nextEnd && nextFrom <= existingEnd;
}

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
      ).then((rows) => new Set(rows.map((row) => String(row.column_name ?? (row as any).COLUMN_NAME))))
    );
  }
  return columnCache.get(tableName)!;
}

async function ensureFoundation() {
  const required = [
    "process_lob_master",
    "process_lob_monthly_plan",
    "employee_lob_assignment",
    "pnl_period_snapshot",
    "pnl_period_snapshot_row",
  ];
  const missing: string[] = [];
  for (const table of required) {
    if (!(await tableExists(table))) missing.push(table);
  }
  if (missing.length) {
    throw Object.assign(
      new Error(`Process LOB P&L foundation is unavailable: ${missing.join(", ")}. Run migration 421 first.`),
      { statusCode: 503 }
    );
  }
}

function numericOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Numeric values must be zero or greater");
  return parsed;
}

function defaultDirectData(): DirectLobData {
  return {
    revenue: calculateRevenue([], [], []),
    agentSalary: 0,
    dscPeople: 0,
    agentHeadcount: 0,
    dscHeadcount: 0,
    dscNonPeople: 0,
    bmcNonPeople: 0,
    depreciation: 0,
    amortization: 0,
    financeCost: 0,
    tax: 0,
    otherOperatingCost: 0,
    otherOperatingIncome: 0,
    nonOperatingIncome: 0,
    exceptionalCost: 0,
    exceptionalIncome: 0,
    grnGrossAmount: 0,
    grnAllocationCount: 0,
    freshness: null,
  };
}

function addCostComponent(target: DirectLobData, type: string, amount: number) {
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
  }
}

function sum<T>(values: T[], selector: (value: T) => number) {
  return values.reduce((total, value) => total + selector(value), 0);
}

export function allocateAmountByWeights(
  amount: number,
  weights: Map<string, number>
): { allocated: Map<string, number>; unallocated: number } {
  const allocated = new Map<string, number>();
  const positive = [...weights.entries()].map(([key, value]) => [key, Math.max(0, n(value))] as const);
  const total = positive.reduce((result, [, value]) => result + value, 0);
  if (Math.abs(amount) < 0.000001) return { allocated, unallocated: 0 };
  if (total <= 0) return { allocated, unallocated: amount };
  let assigned = 0;
  positive.forEach(([key, value], index) => {
    const share = index === positive.length - 1 ? amount - assigned : amount * (value / total);
    allocated.set(key, share);
    assigned += share;
  });
  return { allocated, unallocated: amount - assigned };
}

function planDriver(plans: LobPlanRow[]): { driver: SharedCostDriver; conflict: boolean } {
  const approved = plans.filter((plan) => plan.status === "approved" || plan.status === "locked");
  const drivers = new Set(approved.map((plan) => plan.shared_cost_driver));
  return {
    driver: approved[0]?.shared_cost_driver ?? "contracted_seats",
    conflict: drivers.size > 1,
  };
}

function weightsFor(
  lobs: LobRow[],
  plans: Map<string, LobPlanRow>,
  direct: Map<string, DirectLobData>,
  driver: SharedCostDriver
) {
  const weights = new Map<string, number>();
  for (const lob of lobs) {
    const plan = plans.get(lob.id);
    const data = direct.get(lob.id) ?? defaultDirectData();
    let value = 0;
    switch (driver) {
      case "billable_seats": value = n(plan?.billable_seats); break;
      case "occupied_seats": value = n(plan?.occupied_seats); break;
      case "active_hc": value = data.agentHeadcount + data.dscHeadcount; break;
      case "revenue": value = data.revenue.earnedRevenue; break;
      case "equal": value = 1; break;
      case "manual": value = n(plan?.manual_allocation_pct); break;
      case "contracted_seats":
      default: value = n(plan?.contracted_seats); break;
    }
    weights.set(lob.id, value);
  }
  return weights;
}

async function listEffectiveLobs(processId: string, period: string): Promise<LobRow[]> {
  const { start, end } = monthRange(period);
  return queryRows<LobRow>(
    `SELECT l.*, p.process_name, p.client_id, cm.client_name,
            p.branch_id, bm.branch_name,
            ccm.cost_centre_code AS cost_centre_code,
            ccm.cost_centre_name
       FROM process_lob_master l
       JOIN process_master p ON p.id = l.process_id
       LEFT JOIN client_master cm ON cm.id = p.client_id
       LEFT JOIN branch_master bm ON bm.id = p.branch_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = l.cost_centre_id
      WHERE l.process_id = ?
        AND l.active_status = 1
        AND l.approval_status = 'approved'
        AND l.effective_from <= ?
        AND (l.effective_to IS NULL OR l.effective_to >= ?)
      ORDER BY l.lob_code`,
    [processId, end, start]
  );
}

async function loadPlans(processId: string, period: string) {
  const rows = await queryRows<LobPlanRow>(
    `SELECT p.*
       FROM process_lob_monthly_plan p
       JOIN process_lob_master l ON l.id = p.process_lob_id
      WHERE l.process_id = ? AND p.period_code = ?`,
    [processId, period]
  );
  return new Map(rows.map((row) => [String(row.process_lob_id), row]));
}

async function loadRevenueData(processId: string, period: string, lobIds: string[]) {
  const direct = new Map<string, DirectLobData>(lobIds.map((id) => [id, defaultDirectData()]));
  if (!lobIds.length) return direct;
  const placeholders = lobIds.map(() => "?").join(",");
  const { start, end } = monthRange(period);

  const [rules, deliveries, components] = await Promise.all([
    queryRows<LobRevenueRuleRow>(
      `SELECT process_lob_id, billing_model, metric_key, rate_amount, fx_to_inr,
              monthly_minimum_commitment, included_units, overage_rate, mandated_seats
         FROM process_revenue_rule
        WHERE process_id = ?
          AND process_lob_id IN (${placeholders})
          AND status = 'approved'
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)`,
      [processId, ...lobIds, end, start]
    ),
    queryRows<LobDeliveryRow>(
      `SELECT process_lob_id, metric_key,
              SUM(planned_units) planned_units,
              SUM(delivered_units) delivered_units,
              SUM(accepted_units) accepted_units,
              SUM(rejected_units) rejected_units,
              SUM(billable_units) billable_units,
              SUM(productive_hours) productive_hours,
              SUM(login_hours) login_hours,
              SUM(talk_minutes) talk_minutes,
              AVG(quality_score) quality_score,
              AVG(sla_score) sla_score,
              MAX(updated_at) updated_at
         FROM process_delivery_actual
        WHERE process_id = ?
          AND process_lob_id IN (${placeholders})
          AND period_code = ?
          AND status IN ('validated','locked')
        GROUP BY process_lob_id, metric_key`,
      [processId, ...lobIds, period]
    ),
    queryRows<LobRevenueComponentRow>(
      `SELECT process_lob_id, component_type, direction, amount_inr
         FROM process_revenue_component
        WHERE process_id = ?
          AND process_lob_id IN (${placeholders})
          AND period_code = ?
          AND status = 'approved'`,
      [processId, ...lobIds, period]
    ),
  ]);

  for (const lobId of lobIds) {
    const ruleInputs: RevenueRuleInput[] = rules
      .filter((row) => String(row.process_lob_id) === lobId)
      .map((row) => ({
        billingModel: row.billing_model,
        metricKey: row.metric_key,
        rateAmount: n(row.rate_amount),
        fxToInr: n(row.fx_to_inr) || 1,
        monthlyMinimumCommitment: n(row.monthly_minimum_commitment),
        includedUnits: n(row.included_units),
        overageRate: n(row.overage_rate),
        mandatedSeats: n(row.mandated_seats),
      }));
    const deliveryInputs: DeliveryMetricInput[] = deliveries
      .filter((row) => String(row.process_lob_id) === lobId)
      .map((row) => ({
        metricKey: row.metric_key,
        plannedUnits: n(row.planned_units),
        deliveredUnits: n(row.delivered_units),
        acceptedUnits: n(row.accepted_units),
        rejectedUnits: n(row.rejected_units),
        billableUnits: n(row.billable_units),
        productiveHours: n(row.productive_hours),
        loginHours: n(row.login_hours),
        talkMinutes: n(row.talk_minutes),
        qualityScore: row.quality_score == null ? null : n(row.quality_score),
        slaScore: row.sla_score == null ? null : n(row.sla_score),
      }));
    const componentInputs: RevenueComponentInput[] = components
      .filter((row) => String(row.process_lob_id) === lobId)
      .map((row) => ({
        type: row.component_type,
        direction: row.direction,
        amountInr: n(row.amount_inr),
      }));
    const item = direct.get(lobId)!;
    item.revenue = calculateRevenue(ruleInputs, deliveryInputs, componentInputs);
    item.freshness = deliveries
      .filter((row) => String(row.process_lob_id) === lobId && row.updated_at)
      .map((row) => String(row.updated_at))
      .sort()
      .at(-1) ?? null;
  }
  return direct;
}

async function loadPayrollCosts(processId: string, period: string, direct: Map<string, DirectLobData>) {
  if (!(await tableExists("salary_prep_run")) || !(await tableExists("salary_prep_line"))) {
    return { available: false, assignedCost: 0, source: "salary tables unavailable" };
  }
  // Every run in the month — a fourth rival strategy for the same question, and a fourth answer.
  // Note this one ordered FIELD(...) ASCENDING while bpo-pnl.service.ts ordered the identical
  // expression DESCENDING, so the two picked opposite runs from the same two rows. Neither
  // ranking meant anything: FIELD() scores 0 for a status not in its list, and the statuses in
  // use are FINALIZED, approved, draft and processing. See the note in bpo-pnl.service.ts's
  // getPayrollPeople for the measured impact; 2026-03's two runs share no employees, so
  // whichever run lost the sort was simply dropped.
  const runs = await queryRows<RowDataPacket>(
    `SELECT id FROM salary_prep_run WHERE run_month = ?`,
    [period]
  );
  if (!runs.length) return { available: false, assignedCost: 0, source: "salary run unavailable" };
  const runIds = runs.map((row) => String(row.id));

  const salaryColumns = await listColumns("salary_prep_line");
  const gross = salaryColumns.has("gross_salary") ? "COALESCE(spl.gross_salary,0)" : "0";
  const pf = salaryColumns.has("pf_employer") ? "COALESCE(spl.pf_employer,0)" : "0";
  const esic = salaryColumns.has("esic_employer") ? "COALESCE(spl.esic_employer,0)" : "0";
  const gratuity = salaryColumns.has("gratuity")
    ? "COALESCE(spl.gratuity,0)"
    : salaryColumns.has("basic")
      ? "COALESCE(spl.basic,0) * 0.0481"
      : "0";
  const { start, end } = monthRange(period);
  const rows = await queryRows<LobPayrollRow>(
    `SELECT a.process_lob_id, a.cost_bucket,
            SUM((${gross} + ${pf} + ${esic} + ${gratuity}) * a.allocation_pct / 100) loaded_cost,
            COUNT(DISTINCT a.employee_id) employee_count,
            SUM(a.allocation_pct) allocation_pct_total
       FROM salary_prep_line spl
       JOIN employee_lob_assignment a ON a.employee_id = spl.employee_id
       JOIN process_lob_master l ON l.id = a.process_lob_id
      WHERE spl.run_id IN (${runIds.map(() => "?").join(", ")})
        AND l.process_id = ?
        AND a.status = 'approved'
        AND a.effective_from <= ?
        AND (a.effective_to IS NULL OR a.effective_to >= ?)
      GROUP BY a.process_lob_id, a.cost_bucket`,
    [...runIds, processId, end, start]
  );
  let assignedCost = 0;
  for (const row of rows) {
    const item = direct.get(String(row.process_lob_id));
    if (!item) continue;
    const amount = n(row.loaded_cost);
    assignedCost += amount;
    if (row.cost_bucket === "dsc_people") {
      item.dscPeople += amount;
      item.dscHeadcount += n(row.employee_count);
    } else {
      item.agentSalary += amount;
      item.agentHeadcount += n(row.employee_count);
    }
  }
  return { available: true, assignedCost, source: "salary_prep_line" };
}

async function loadGrnCosts(processId: string, period: string, direct: Map<string, DirectLobData>) {
  if (!(await tableExists("grn_cost_allocation"))) {
    return { available: false, source: "grn allocation unavailable" };
  }
  const rows = await queryRows<LobGrnRow>(
    `SELECT process_lob_id, pnl_bucket,
            SUM(pnl_cost_amount) pnl_cost_amount,
            SUM(gross_amount) gross_amount,
            SUM(allocation_count) allocation_count,
            MAX(freshness) freshness
       FROM vw_process_lob_grn_allocation
      WHERE process_id = ? AND period_code = ? AND process_lob_id IS NOT NULL
      GROUP BY process_lob_id, pnl_bucket`,
    [processId, period]
  );
  for (const row of rows) {
    const item = direct.get(String(row.process_lob_id));
    if (!item) continue;
    const amount = n(row.pnl_cost_amount);
    if (row.pnl_bucket === "dsc_non_people") item.dscNonPeople += amount;
    else if (row.pnl_bucket === "bmc_non_people") item.bmcNonPeople += amount;
    else addCostComponent(item, row.pnl_bucket, amount);
    item.grnGrossAmount += n(row.gross_amount);
    item.grnAllocationCount += n(row.allocation_count);
    item.freshness = [item.freshness, row.freshness]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  }
  return { available: true, source: "vw_process_lob_grn_allocation" };
}

async function loadCostComponents(processId: string, period: string, direct: Map<string, DirectLobData>) {
  if (!(await tableExists("process_pnl_cost_component"))) return;
  const rows = await queryRows<LobCostComponentRow>(
    `SELECT process_lob_id, cost_type, SUM(amount_inr) amount_inr
       FROM process_pnl_cost_component
      WHERE process_id = ? AND period_code = ?
        AND process_lob_id IS NOT NULL AND status = 'approved'
      GROUP BY process_lob_id, cost_type`,
    [processId, period]
  );
  for (const row of rows) {
    const item = direct.get(String(row.process_lob_id));
    if (item) addCostComponent(item, row.cost_type, n(row.amount_inr));
  }
}

function allocationForPool(
  amount: number,
  lobs: LobRow[],
  weights: Map<string, number>,
  target: Map<string, number>
) {
  const result = allocateAmountByWeights(amount, weights);
  for (const lob of lobs) target.set(lob.id, result.allocated.get(lob.id) ?? 0);
  return result.unallocated;
}

export const processLobService = {
  async listLobs(filters: { processId?: string; includeInactive?: boolean } = {}) {
    await ensureFoundation();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.processId) {
      conditions.push("l.process_id = ?");
      params.push(filters.processId);
    }
    if (!filters.includeInactive) conditions.push("l.active_status = 1");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return queryRows<LobRow>(
      `SELECT l.*, p.process_name, p.client_id, cm.client_name,
              p.branch_id, bm.branch_name,
              ccm.cost_centre_code cost_centre_code,
              ccm.cost_centre_name
         FROM process_lob_master l
         JOIN process_master p ON p.id = l.process_id
         LEFT JOIN client_master cm ON cm.id = p.client_id
         LEFT JOIN branch_master bm ON bm.id = p.branch_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = l.cost_centre_id
         ${where}
        ORDER BY cm.client_name, p.process_name, l.lob_code`,
      params
    );
  },

  async saveLob(input: SaveProcessLobInput, actorUserId: string) {
    await ensureFoundation();
    const processId = String(input.processId ?? "").trim();
    const lobCode = String(input.lobCode ?? "").trim().toUpperCase();
    const lobName = String(input.lobName ?? "").trim();
    if (!processId || !lobCode || !lobName || !input.effectiveFrom) {
      throw Object.assign(new Error("Process, LOB code, LOB name and effective-from date are required"), { statusCode: 400 });
    }
    if (!/^[A-Z0-9_-]{2,64}$/.test(lobCode)) {
      throw Object.assign(new Error("LOB code may contain only letters, numbers, underscore and hyphen"), { statusCode: 400 });
    }
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw Object.assign(new Error("Effective-to date cannot precede effective-from date"), { statusCode: 400 });
    }
    const processRows = await queryRows<RowDataPacket>("SELECT id FROM process_master WHERE id = ? LIMIT 1", [processId]);
    if (!processRows[0]) throw Object.assign(new Error("Process not found"), { statusCode: 404 });

    const id = input.id?.trim() || randomUUID();
    const conflicts = await queryRows<RowDataPacket>(
      `SELECT id, effective_from, effective_to
         FROM process_lob_master
        WHERE process_id = ? AND UPPER(lob_code) = ? AND id <> ?`,
      [processId, lobCode, id]
    );
    if (conflicts.some((row) => dateRangeOverlaps(
      String(row.effective_from).slice(0, 10),
      row.effective_to ? String(row.effective_to).slice(0, 10) : null,
      input.effectiveFrom,
      input.effectiveTo ?? null
    ))) {
      throw Object.assign(new Error("An overlapping LOB with this code already exists for the process"), { statusCode: 409 });
    }

    const approvalStatus = input.approvalStatus ?? "draft";
    await db.execute(
      `INSERT INTO process_lob_master
        (id, process_id, lob_code, lob_name, description, cost_centre_id, allocation_scope,
         effective_from, effective_to, active_status, approval_status, created_by,
         approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         process_id=VALUES(process_id), lob_code=VALUES(lob_code), lob_name=VALUES(lob_name),
         description=VALUES(description), cost_centre_id=VALUES(cost_centre_id),
         allocation_scope=VALUES(allocation_scope), effective_from=VALUES(effective_from),
         effective_to=VALUES(effective_to), active_status=VALUES(active_status),
         approval_status=VALUES(approval_status), approved_by=VALUES(approved_by),
         approved_at=VALUES(approved_at), updated_at=NOW()`,
      [
        id,
        processId,
        lobCode,
        lobName,
        input.description?.trim() || null,
        input.costCentreId?.trim() || null,
        input.allocationScope ?? "direct_lob",
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.activeStatus === false ? 0 : 1,
        approvalStatus,
        actorUserId,
        approvalStatus === "approved" ? actorUserId : null,
        approvalStatus === "approved" ? new Date() : null,
      ]
    );
    return { id };
  },

  async listPlans(periodCode?: string, processId?: string) {
    await ensureFoundation();
    const period = normalizePeriod(periodCode);
    const params: unknown[] = [period];
    const processFilter = processId ? "AND l.process_id = ?" : "";
    if (processId) params.push(processId);
    return queryRows<RowDataPacket>(
      `SELECT p.*, l.lob_code, l.lob_name, l.process_id,
              pm.process_name, pm.branch_id, bm.branch_name
         FROM process_lob_monthly_plan p
         JOIN process_lob_master l ON l.id = p.process_lob_id
         JOIN process_master pm ON pm.id = l.process_id
         LEFT JOIN branch_master bm ON bm.id = pm.branch_id
        WHERE p.period_code = ? ${processFilter}
        ORDER BY pm.process_name, l.lob_code`,
      params
    );
  },

  async savePlan(input: SaveLobPlanInput, actorUserId: string) {
    await ensureFoundation();
    const periodCode = normalizePeriod(input.periodCode);
    if (!input.processLobId) throw Object.assign(new Error("LOB is required"), { statusCode: 400 });
    const lobRows = await queryRows<RowDataPacket>(
      "SELECT id, process_id, active_status FROM process_lob_master WHERE id = ? LIMIT 1",
      [input.processLobId]
    );
    if (!lobRows[0]) throw Object.assign(new Error("LOB not found"), { statusCode: 404 });
    if (Number(lobRows[0].active_status) !== 1) throw Object.assign(new Error("Inactive LOB cannot receive a monthly plan"), { statusCode: 400 });

    const driver = input.sharedCostDriver ?? "contracted_seats";
    const manualPct = numericOrNull(input.manualAllocationPct);
    if (driver === "manual" && (manualPct == null || manualPct > 100)) {
      throw Object.assign(new Error("Manual allocation requires a percentage between 0 and 100"), { statusCode: 400 });
    }
    const status = input.status ?? "draft";
    const id = input.id?.trim() || randomUUID();
    await db.execute(
      `INSERT INTO process_lob_monthly_plan
        (id, process_lob_id, period_code, contracted_seats, billable_seats, occupied_seats,
         required_productive_hc, required_roster_hc, revenue_budget, agent_cost_budget,
         direct_vendor_cost_budget, shared_cost_budget, ebitda_budget, shared_cost_driver,
         manual_allocation_pct, status, created_by, updated_by, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         contracted_seats=VALUES(contracted_seats), billable_seats=VALUES(billable_seats),
         occupied_seats=VALUES(occupied_seats), required_productive_hc=VALUES(required_productive_hc),
         required_roster_hc=VALUES(required_roster_hc), revenue_budget=VALUES(revenue_budget),
         agent_cost_budget=VALUES(agent_cost_budget), direct_vendor_cost_budget=VALUES(direct_vendor_cost_budget),
         shared_cost_budget=VALUES(shared_cost_budget), ebitda_budget=VALUES(ebitda_budget),
         shared_cost_driver=VALUES(shared_cost_driver), manual_allocation_pct=VALUES(manual_allocation_pct),
         status=VALUES(status), updated_by=VALUES(updated_by), approved_by=VALUES(approved_by),
         approved_at=VALUES(approved_at), updated_at=NOW()`,
      [
        id,
        input.processLobId,
        periodCode,
        numericOrNull(input.contractedSeats),
        numericOrNull(input.billableSeats),
        numericOrNull(input.occupiedSeats),
        numericOrNull(input.requiredProductiveHc),
        numericOrNull(input.requiredRosterHc),
        numericOrNull(input.revenueBudget),
        numericOrNull(input.agentCostBudget),
        numericOrNull(input.directVendorCostBudget),
        numericOrNull(input.sharedCostBudget),
        numericOrNull(input.ebitdaBudget),
        driver,
        driver === "manual" ? manualPct : null,
        status,
        actorUserId,
        actorUserId,
        status === "approved" || status === "locked" ? actorUserId : null,
        status === "approved" || status === "locked" ? new Date() : null,
      ]
    );
    return { id, periodCode };
  },

  async listAssignments(processId: string, periodCode?: string) {
    await ensureFoundation();
    const period = normalizePeriod(periodCode);
    const { start, end } = monthRange(period);
    return queryRows<RowDataPacket>(
      `SELECT a.*, l.lob_code, l.lob_name, e.employee_code,
              CONCAT(e.first_name, ' ', e.last_name) employee_name
         FROM employee_lob_assignment a
         JOIN process_lob_master l ON l.id = a.process_lob_id
         JOIN employees e ON e.id = a.employee_id
        WHERE l.process_id = ?
          AND a.effective_from <= ?
          AND (a.effective_to IS NULL OR a.effective_to >= ?)
        ORDER BY e.employee_code, a.effective_from`,
      [processId, end, start]
    );
  },

  async saveAssignment(input: SaveEmployeeLobAssignmentInput, actorUserId: string) {
    await ensureFoundation();
    const allocationPct = n(input.allocationPct);
    if (!input.employeeId || !input.processLobId || !input.effectiveFrom) {
      throw Object.assign(new Error("Employee, LOB and effective-from date are required"), { statusCode: 400 });
    }
    if (allocationPct <= 0 || allocationPct > 100) {
      throw Object.assign(new Error("Allocation percentage must be greater than 0 and not exceed 100"), { statusCode: 400 });
    }
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw Object.assign(new Error("Effective-to date cannot precede effective-from date"), { statusCode: 400 });
    }

    const id = input.id?.trim() || randomUUID();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [lobRows] = await connection.execute<RowDataPacket[]>(
        `SELECT l.id, l.process_id, l.active_status, e.process_id employee_process_id
           FROM process_lob_master l
           JOIN employees e ON e.id = ?
          WHERE l.id = ? FOR UPDATE`,
        [input.employeeId, input.processLobId]
      );
      const lob = lobRows[0];
      if (!lob) throw Object.assign(new Error("Employee or LOB not found"), { statusCode: 404 });
      if (Number(lob.active_status) !== 1) throw new Error("Inactive LOB cannot receive employee assignments");
      if (lob.employee_process_id && String(lob.employee_process_id) !== String(lob.process_id)) {
        throw new Error("Employee process does not match the selected LOB process");
      }
      const [overlaps] = await connection.execute<RowDataPacket[]>(
        `SELECT id, allocation_pct, effective_from, effective_to
           FROM employee_lob_assignment
          WHERE employee_id = ? AND id <> ? AND status <> 'inactive'
          FOR UPDATE`,
        [input.employeeId, id]
      );
      const overlappingTotal = overlaps
        .filter((row) => dateRangeOverlaps(
          String(row.effective_from).slice(0, 10),
          row.effective_to ? String(row.effective_to).slice(0, 10) : null,
          input.effectiveFrom,
          input.effectiveTo ?? null
        ))
        .reduce((total, row) => total + n(row.allocation_pct), 0);
      if (overlappingTotal + allocationPct > 100.0001) {
        throw new Error(`Employee LOB allocation would total ${(overlappingTotal + allocationPct).toFixed(2)}%`);
      }
      const status = input.status ?? "draft";
      await connection.execute(
        `INSERT INTO employee_lob_assignment
          (id, employee_id, process_lob_id, cost_bucket, allocation_pct, effective_from,
           effective_to, assignment_source, status, created_by, approved_by, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           process_lob_id=VALUES(process_lob_id), cost_bucket=VALUES(cost_bucket),
           allocation_pct=VALUES(allocation_pct), effective_from=VALUES(effective_from),
           effective_to=VALUES(effective_to), assignment_source=VALUES(assignment_source),
           status=VALUES(status), approved_by=VALUES(approved_by), approved_at=VALUES(approved_at),
           updated_at=NOW()`,
        [
          id,
          input.employeeId,
          input.processLobId,
          input.costBucket ?? "agent_salary",
          allocationPct,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.assignmentSource ?? "manual",
          status,
          actorUserId,
          status === "approved" ? actorUserId : null,
          status === "approved" ? new Date() : null,
        ]
      );
      await connection.commit();
      return { id };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async getDiagnostics(processId: string, periodCode?: string) {
    await ensureFoundation();
    const period = normalizePeriod(periodCode);
    const lobs = await listEffectiveLobs(processId, period);
    const plans = await loadPlans(processId, period);
    const planRows = [...plans.values()];
    const manualTotal = sum(planRows.filter((plan) => plan.shared_cost_driver === "manual"), (plan) => n(plan.manual_allocation_pct));
    const driver = planDriver(planRows);
    const ruleRows = await queryRows<RowDataPacket>(
      `SELECT process_lob_id, COUNT(*) count
         FROM process_revenue_rule
        WHERE process_id = ? AND status = 'approved'
          AND process_lob_id IS NOT NULL
        GROUP BY process_lob_id`,
      [processId]
    );
    const ruleLobs = new Set(ruleRows.map((row) => String(row.process_lob_id)));
    const deliveryRows = await queryRows<RowDataPacket>(
      `SELECT process_lob_id, COUNT(*) count
         FROM process_delivery_actual
        WHERE process_id = ? AND period_code = ?
          AND status IN ('validated','locked') AND process_lob_id IS NOT NULL
        GROUP BY process_lob_id`,
      [processId, period]
    );
    const deliveryLobs = new Set(deliveryRows.map((row) => String(row.process_lob_id)));
    const blockers: Array<{ code: string; message: string; lobId?: string }> = [];
    if (!lobs.length) blockers.push({ code: "NO_ACTIVE_LOB", message: "No approved active LOB exists for this process and period" });
    if (driver.conflict) blockers.push({ code: "MIXED_SHARED_DRIVERS", message: "Approved LOB plans use conflicting shared-cost drivers" });
    if (driver.driver === "manual" && Math.abs(manualTotal - 100) > 0.01) {
      blockers.push({ code: "MANUAL_ALLOCATION_NOT_100", message: `Manual shared-cost allocation totals ${manualTotal.toFixed(2)}%, not 100%` });
    }
    for (const lob of lobs) {
      if (!plans.has(lob.id)) blockers.push({ code: "MISSING_LOB_PLAN", message: `${lob.lob_name} has no monthly plan`, lobId: lob.id });
      if (!ruleLobs.has(lob.id)) blockers.push({ code: "MISSING_LOB_REVENUE_RULE", message: `${lob.lob_name} has no approved revenue rule`, lobId: lob.id });
      if (!deliveryLobs.has(lob.id)) blockers.push({ code: "MISSING_LOB_DELIVERY", message: `${lob.lob_name} has no validated delivery actual`, lobId: lob.id });
    }
    return {
      period,
      processId,
      activeLobCount: lobs.length,
      plannedLobCount: planRows.length,
      revenueRuleCoveragePct: pct(lobs.filter((lob) => ruleLobs.has(lob.id)).length, lobs.length),
      deliveryCoveragePct: pct(lobs.filter((lob) => deliveryLobs.has(lob.id)).length, lobs.length),
      planCoveragePct: pct(lobs.filter((lob) => plans.has(lob.id)).length, lobs.length),
      sharedCostDriver: driver.driver,
      manualAllocationPct: manualTotal,
      readyForClose: blockers.length === 0,
      blockers,
    };
  },

  async getProcessSummary(processId: string, periodCode?: string) {
    await ensureFoundation();
    const period = normalizePeriod(periodCode);
    const processSummary = await bpoPnlAllocationOverlayService.getSummary({ period, processId });
    const processRow = processSummary.rows.find((row) => row.processId === processId);
    if (!processRow) throw Object.assign(new Error("Process P&L record not found"), { statusCode: 404 });
    const lobs = await listEffectiveLobs(processId, period);
    const plans = await loadPlans(processId, period);
    const direct = await loadRevenueData(processId, period, lobs.map((lob) => lob.id));
    const [payrollSource, grnSource] = await Promise.all([
      loadPayrollCosts(processId, period, direct),
      loadGrnCosts(processId, period, direct),
      loadCostComponents(processId, period, direct),
    ]).then(([payroll, grn]) => [payroll, grn]);

    const planRows = [...plans.values()];
    const driverState = planDriver(planRows);
    const weights = weightsFor(lobs, plans, direct, driverState.driver);
    const allocatedBmcPeople = new Map<string, number>();
    const allocatedBmcNonPeople = new Map<string, number>();
    const allocatedOtherOperating = new Map<string, number>();
    const allocatedDepreciation = new Map<string, number>();
    const allocatedAmortization = new Map<string, number>();
    const allocatedFinanceCost = new Map<string, number>();
    const allocatedTax = new Map<string, number>();

    const directRevenue = sum([...direct.values()], (item) => item.revenue.earnedRevenue);
    const directAgentSalary = sum([...direct.values()], (item) => item.agentSalary);
    const directDscPeople = sum([...direct.values()], (item) => item.dscPeople);
    const directDscNonPeople = sum([...direct.values()], (item) => item.dscNonPeople);
    const directBmcNonPeople = sum([...direct.values()], (item) => item.bmcNonPeople);
    const directDepreciation = sum([...direct.values()], (item) => item.depreciation);
    const directAmortization = sum([...direct.values()], (item) => item.amortization);
    const directFinanceCost = sum([...direct.values()], (item) => item.financeCost);
    const directTax = sum([...direct.values()], (item) => item.tax);
    const directOtherOperatingNet = sum([...direct.values()], (item) => item.otherOperatingCost - item.otherOperatingIncome);
    const processOtherOperatingNet = processRow.totalOperatingCost - (
      processRow.agentSalary + processRow.dsc + processRow.bmc
    );

    const unallocatedPools = {
      bmcPeople: allocationForPool(processRow.bmcPeople, lobs, weights, allocatedBmcPeople),
      bmcNonPeople: allocationForPool(processRow.bmcNonPeople - directBmcNonPeople, lobs, weights, allocatedBmcNonPeople),
      otherOperatingNet: allocationForPool(processOtherOperatingNet - directOtherOperatingNet, lobs, weights, allocatedOtherOperating),
      depreciation: allocationForPool(processRow.depreciation - directDepreciation, lobs, weights, allocatedDepreciation),
      amortization: allocationForPool(processRow.amortization - directAmortization, lobs, weights, allocatedAmortization),
      financeCost: allocationForPool(processRow.financeCost - directFinanceCost, lobs, weights, allocatedFinanceCost),
      tax: allocationForPool(processRow.tax - directTax, lobs, weights, allocatedTax),
    };

    const rows: Array<Record<string, unknown> & { rowType: "lob" | "unallocated"; processLobId: string | null }> = lobs.map((lob) => {
      const item = direct.get(lob.id) ?? defaultDirectData();
      const plan = plans.get(lob.id);
      const otherOperatingNet = item.otherOperatingCost - item.otherOperatingIncome + (allocatedOtherOperating.get(lob.id) ?? 0);
      const cost = calculateBpoCostWaterfall({
        revenue: item.revenue.earnedRevenue,
        agentSalary: item.agentSalary,
        dscPeople: item.dscPeople,
        dscNonPeople: item.dscNonPeople,
        bmcPeople: allocatedBmcPeople.get(lob.id) ?? 0,
        bmcNonPeople: item.bmcNonPeople + (allocatedBmcNonPeople.get(lob.id) ?? 0),
        otherOperatingCost: Math.max(0, otherOperatingNet),
        otherOperatingIncome: Math.max(0, -otherOperatingNet),
        depreciation: item.depreciation + (allocatedDepreciation.get(lob.id) ?? 0),
        amortization: item.amortization + (allocatedAmortization.get(lob.id) ?? 0),
        financeCost: item.financeCost + (allocatedFinanceCost.get(lob.id) ?? 0),
        nonOperatingIncome: item.nonOperatingIncome,
        tax: item.tax + (allocatedTax.get(lob.id) ?? 0),
        exceptionalCost: item.exceptionalCost,
        exceptionalIncome: item.exceptionalIncome,
        agentHeadcount: item.agentHeadcount,
        activeHeadcount: item.agentHeadcount + item.dscHeadcount,
        contractedSeats: plan?.contracted_seats,
        billableSeats: plan?.billable_seats,
      });
      return {
        rowType: "lob" as const,
        processId,
        processLobId: lob.id,
        lobCode: lob.lob_code,
        lobName: lob.lob_name,
        branchId: lob.branch_id ?? processRow.branchId,
        branchName: lob.branch_name ?? processRow.branchName,
        clientId: lob.client_id ?? processRow.clientId,
        clientName: lob.client_name ?? processRow.clientName,
        costCentreId: lob.cost_centre_id,
        costCentreCode: lob.cost_centre_code,
        contractedSeats: n(plan?.contracted_seats),
        billableSeats: n(plan?.billable_seats),
        occupiedSeats: n(plan?.occupied_seats),
        seatFillPct: pct(n(plan?.occupied_seats), n(plan?.contracted_seats)),
        agentHeadcount: item.agentHeadcount,
        supportHeadcount: item.dscHeadcount,
        plannedUnits: item.revenue.plannedUnits,
        deliveredUnits: item.revenue.deliveredUnits,
        billableUnits: item.revenue.billableUnits,
        deliveryAttainmentPct: item.revenue.deliveryAttainmentPct,
        earnedRevenue: item.revenue.earnedRevenue,
        recognizedRevenue: item.revenue.earnedRevenue,
        accountingRevenueVariance: 0,
        agentSalary: cost.agentSalary,
        dscPeople: cost.dscPeople,
        dscNonPeople: cost.dscNonPeople,
        bmcPeople: cost.bmcPeople,
        bmcNonPeople: cost.bmcNonPeople,
        directVendorCost: item.dscNonPeople,
        grnGrossAmount: item.grnGrossAmount,
        sharedCost: cost.bmc + Math.max(0, otherOperatingNet),
        contribution: cost.contribution,
        ebitda: cost.ebitda,
        ebitdaMarginPct: cost.ebitdaMarginPct,
        depreciation: item.depreciation + (allocatedDepreciation.get(lob.id) ?? 0),
        amortization: item.amortization + (allocatedAmortization.get(lob.id) ?? 0),
        financeCost: item.financeCost + (allocatedFinanceCost.get(lob.id) ?? 0),
        pbt: cost.pbt,
        tax: item.tax + (allocatedTax.get(lob.id) ?? 0),
        pat: cost.pat,
        revenueBudget: n(plan?.revenue_budget),
        ebitdaBudget: n(plan?.ebitda_budget),
        ebitdaVariance: plan?.ebitda_budget == null ? null : cost.ebitda - n(plan.ebitda_budget),
        sharedCostDriver: plan?.shared_cost_driver ?? driverState.driver,
        manualAllocationPct: plan?.manual_allocation_pct == null ? null : n(plan.manual_allocation_pct),
        planStatus: plan?.status ?? "missing",
        dataStatus: {
          revenue: item.revenue.rules.length ? "configured" : "missing_rule",
          delivery: item.revenue.deliveredUnits || item.revenue.billableUnits ? "available" : "missing",
          payroll: payrollSource.available ? "available" : "unavailable",
          grn: grnSource.available ? "available" : "unavailable",
        },
        freshness: item.freshness,
      };
    });

    const revenueResidual = processRow.recognizedRevenue - directRevenue;
    const agentResidual = processRow.agentSalary - directAgentSalary;
    const dscPeopleResidual = processRow.dscPeople - directDscPeople;
    const dscNonPeopleResidual = processRow.dscNonPeople - directDscNonPeople;
    const unallocatedShared = Object.values(unallocatedPools).reduce((total, value) => total + value, 0);
    const needsUnallocated = [revenueResidual, agentResidual, dscPeopleResidual, dscNonPeopleResidual, unallocatedShared]
      .some((value) => Math.abs(value) > 0.01);
    if (needsUnallocated) {
      const unallocatedCost = calculateBpoCostWaterfall({
        revenue: revenueResidual,
        agentSalary: agentResidual,
        dscPeople: dscPeopleResidual,
        dscNonPeople: dscNonPeopleResidual,
        bmcPeople: unallocatedPools.bmcPeople,
        bmcNonPeople: unallocatedPools.bmcNonPeople,
        otherOperatingCost: Math.max(0, unallocatedPools.otherOperatingNet),
        otherOperatingIncome: Math.max(0, -unallocatedPools.otherOperatingNet),
        depreciation: unallocatedPools.depreciation,
        amortization: unallocatedPools.amortization,
        financeCost: unallocatedPools.financeCost,
        tax: unallocatedPools.tax,
      });
      rows.push({
        rowType: "unallocated",
        processId,
        processLobId: null,
        lobCode: "UNALLOCATED",
        lobName: "Unallocated / Accounting Difference",
        branchId: processRow.branchId,
        branchName: processRow.branchName,
        clientId: processRow.clientId,
        clientName: processRow.clientName,
        costCentreId: null,
        costCentreCode: null,
        contractedSeats: 0,
        billableSeats: 0,
        occupiedSeats: 0,
        seatFillPct: null,
        agentHeadcount: 0,
        supportHeadcount: 0,
        plannedUnits: 0,
        deliveredUnits: 0,
        billableUnits: 0,
        deliveryAttainmentPct: null,
        earnedRevenue: 0,
        recognizedRevenue: revenueResidual,
        accountingRevenueVariance: revenueResidual,
        agentSalary: unallocatedCost.agentSalary,
        dscPeople: unallocatedCost.dscPeople,
        dscNonPeople: unallocatedCost.dscNonPeople,
        bmcPeople: unallocatedCost.bmcPeople,
        bmcNonPeople: unallocatedCost.bmcNonPeople,
        directVendorCost: dscNonPeopleResidual,
        grnGrossAmount: 0,
        sharedCost: unallocatedCost.bmc + Math.max(0, unallocatedPools.otherOperatingNet),
        contribution: unallocatedCost.contribution,
        ebitda: unallocatedCost.ebitda,
        ebitdaMarginPct: unallocatedCost.ebitdaMarginPct,
        depreciation: unallocatedPools.depreciation,
        amortization: unallocatedPools.amortization,
        financeCost: unallocatedPools.financeCost,
        pbt: unallocatedCost.pbt,
        tax: unallocatedPools.tax,
        pat: unallocatedCost.pat,
        revenueBudget: 0,
        ebitdaBudget: 0,
        ebitdaVariance: null,
        sharedCostDriver: driverState.driver,
        manualAllocationPct: null,
        planStatus: "exception",
        dataStatus: {
          revenue: Math.abs(revenueResidual) > 0.01 ? "accounting_difference" : "reconciled",
          delivery: "not_applicable",
          payroll: Math.abs(agentResidual + dscPeopleResidual) > 0.01 ? "unassigned_cost" : "reconciled",
          grn: Math.abs(dscNonPeopleResidual) > 0.01 ? "unassigned_cost" : "reconciled",
        },
        freshness: processRow.freshness,
      });
    }

    const totals = {
      recognizedRevenue: sum(rows, (row) => n(row.recognizedRevenue)),
      agentSalary: sum(rows, (row) => n(row.agentSalary)),
      dscPeople: sum(rows, (row) => n(row.dscPeople)),
      dscNonPeople: sum(rows, (row) => n(row.dscNonPeople)),
      bmcPeople: sum(rows, (row) => n(row.bmcPeople)),
      bmcNonPeople: sum(rows, (row) => n(row.bmcNonPeople)),
      ebitda: sum(rows, (row) => n(row.ebitda)),
      pbt: sum(rows, (row) => n(row.pbt)),
      pat: sum(rows, (row) => n(row.pat)),
    };
    const diagnostics = await this.getDiagnostics(processId, period);
    return {
      period,
      calculationEngine: "lob_reconciliation_v1",
      process: processRow,
      totals,
      reconciliation: {
        revenueVariance: totals.recognizedRevenue - processRow.recognizedRevenue,
        agentSalaryVariance: totals.agentSalary - processRow.agentSalary,
        dscVariance: totals.dscPeople + totals.dscNonPeople - processRow.dsc,
        bmcVariance: totals.bmcPeople + totals.bmcNonPeople - processRow.bmc,
        ebitdaVariance: totals.ebitda - processRow.ebitda,
        isReconciled: [
          totals.recognizedRevenue - processRow.recognizedRevenue,
          totals.agentSalary - processRow.agentSalary,
          totals.dscPeople + totals.dscNonPeople - processRow.dsc,
          totals.bmcPeople + totals.bmcNonPeople - processRow.bmc,
          totals.ebitda - processRow.ebitda,
        ].every((value) => Math.abs(value) <= 0.02),
      },
      diagnostics,
      rows,
      generatedAt: new Date().toISOString(),
    };
  },

  async getPortfolio(filters: Partial<PnlQueryFilters>) {
    await ensureFoundation();
    const period = normalizePeriod(filters.period);
    const summary = await bpoPnlAllocationOverlayService.getSummary({ ...filters, period });
    const counts = await queryRows<RowDataPacket>(
      `SELECT l.process_id,
              COUNT(*) lob_count,
              SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) planned_lob_count,
              SUM(COALESCE(p.contracted_seats,0)) contracted_seats,
              SUM(COALESCE(p.billable_seats,0)) billable_seats
         FROM process_lob_master l
         LEFT JOIN process_lob_monthly_plan p
           ON p.process_lob_id = l.id AND p.period_code = ?
        WHERE l.active_status = 1 AND l.approval_status = 'approved'
        GROUP BY l.process_id`,
      [period]
    );
    const countMap = new Map(counts.map((row) => [String(row.process_id), row]));
    return {
      period,
      calculationEngine: "bpo_allocation_v2",
      rows: summary.rows.map((row: BpoPnlRow) => {
        const meta = countMap.get(row.processId);
        return {
          ...row,
          lobCount: n(meta?.lob_count),
          plannedLobCount: n(meta?.planned_lob_count),
          lobContractedSeats: n(meta?.contracted_seats),
          lobBillableSeats: n(meta?.billable_seats),
          lobPlanCoveragePct: pct(n(meta?.planned_lob_count), n(meta?.lob_count)),
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  },
};
