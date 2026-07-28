import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { allocatePoolAmount, type AllocationShare } from "./bpo-pnl.calculation.js";

/**
 * Branch Budget foundation (PR 2): normalized cost-centre allocation for branch-planned budget
 * lines. Reuses the shared allocatePoolAmount() primitive (bpo-pnl.calculation.ts) so branch
 * budgets and Process P&L are backed by the same canonical allocation math, not a third copy.
 */

// Deliberately a fresh structural interface (not Pick<Pool|PoolConnection, "execute">) — the
// app's db wrapper (backend/src/db/mysql.ts) and mysql2's PoolConnection both satisfy this via
// TS method-parameter bivariance, letting the same functions run either on the shared pool (for
// standalone reads) or inside branch-budget.service.ts's existing transaction connection (so a
// branch-planned line's allocation rows commit atomically with the line itself).
interface Executor {
  execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

export type SharingMethod =
  | "total_manpower"
  | "agent_headcount"
  | "revenue_share"
  | "equal_split"
  | "manual";

const SUPPORTED_SHARING_METHODS: SharingMethod[] = [
  "total_manpower",
  "agent_headcount",
  "revenue_share",
  "equal_split",
  "manual",
];

export interface CostCentreOption {
  id: string;
  costCentreCode: string;
  costCentreName: string;
}

export interface MonthlyDriverInput {
  costCentreId: string;
  plannedHeadcount: number;
  revenueRatePerHead: number;
  remarks?: string | null;
}

export interface MonthlyDriverRecord {
  costCentreId: string;
  costCentreName: string;
  plannedHeadcount: number;
  revenueRatePerHead: number;
  calculatedPlannedRevenue: number;
  remarks: string | null;
  status: "draft" | "approved";
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface ManualAllocationInput {
  costCentreId: string;
  percentage: number;
}

export interface LineAmounts {
  baseAmount: number;
  taxAmount: number;
  grossAmount: number;
  pnlCostAmount: number;
}

export interface LineAllocationRow {
  costCentreId: string;
  driverValue: number;
  allocationPercentage: number;
  plannedUnit: number;
  baseAmount: number;
  taxAmount: number;
  grossAmount: number;
  pnlCostAmount: number;
  roundingAdjustment: number;
}

export async function listActiveCostCentres(
  branchId: string,
  executor: Executor = db
): Promise<CostCentreOption[]> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT id, cost_centre_code, cost_centre_name
       FROM cost_centre_master
      WHERE branch_id = ? AND active_status = 1
      ORDER BY cost_centre_name`,
    [branchId]
  );
  return rows.map((row) => ({
    id: String(row.id),
    costCentreCode: String(row.cost_centre_code ?? ""),
    costCentreName: String(row.cost_centre_name ?? ""),
  }));
}

export async function getMonthlyDrivers(
  branchId: string,
  periodCode: string,
  executor: Executor = db
): Promise<MonthlyDriverRecord[]> {
  const costCentres = await listActiveCostCentres(branchId, executor);
  const [driverRows] = await executor.execute<RowDataPacket[]>(
    `SELECT cost_centre_id, planned_headcount, revenue_rate_per_head, remarks,
            status, updated_by, updated_at
       FROM finance_cost_centre_monthly_driver
      WHERE branch_id = ? AND period_code = ?`,
    [branchId, periodCode]
  );
  const byCostCentre = new Map(driverRows.map((row) => [String(row.cost_centre_id), row]));

  return costCentres.map((cc) => {
    const row = byCostCentre.get(cc.id);
    const plannedHeadcount = Number(row?.planned_headcount ?? 0);
    const revenueRatePerHead = Number(row?.revenue_rate_per_head ?? 0);
    return {
      costCentreId: cc.id,
      costCentreName: cc.costCentreName,
      plannedHeadcount,
      revenueRatePerHead,
      calculatedPlannedRevenue: Math.round(plannedHeadcount * revenueRatePerHead * 100) / 100,
      remarks: row?.remarks ?? null,
      status: (row?.status as "draft" | "approved") ?? "draft",
      updatedBy: row?.updated_by ? String(row.updated_by) : null,
      updatedAt: row?.updated_at ? String(row.updated_at) : null,
    };
  });
}

export async function saveMonthlyDrivers(
  branchId: string,
  periodCode: string,
  drivers: MonthlyDriverInput[],
  actorUserId: string
): Promise<MonthlyDriverRecord[]> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) {
    throw new Error("A valid budget period (YYYY-MM) is required");
  }
  const activeCostCentres = new Set((await listActiveCostCentres(branchId)).map((cc) => cc.id));
  for (const driver of drivers) {
    if (!activeCostCentres.has(driver.costCentreId)) {
      throw new Error(`Cost centre ${driver.costCentreId} is not an active cost centre for this branch`);
    }
    if (!Number.isFinite(driver.plannedHeadcount) || driver.plannedHeadcount < 0) {
      throw new Error("Planned headcount cannot be negative");
    }
    if (!Number.isFinite(driver.revenueRatePerHead) || driver.revenueRatePerHead < 0) {
      throw new Error("Revenue rate per head cannot be negative");
    }
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const driver of drivers) {
      await connection.execute(
        `INSERT INTO finance_cost_centre_monthly_driver
           (id, branch_id, period_code, cost_centre_id, planned_headcount,
            revenue_rate_per_head, remarks, status, updated_by)
         VALUES (?,?,?,?,?,?,?,'draft',?)
         ON DUPLICATE KEY UPDATE
           planned_headcount = VALUES(planned_headcount),
           revenue_rate_per_head = VALUES(revenue_rate_per_head),
           remarks = VALUES(remarks),
           updated_by = VALUES(updated_by)`,
        [
          randomUUID(),
          branchId,
          periodCode,
          driver.costCentreId,
          driver.plannedHeadcount,
          driver.revenueRatePerHead,
          driver.remarks?.trim() || null,
          actorUserId,
        ]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getMonthlyDrivers(branchId, periodCode);
}

function driverWeight(driverMethod: SharingMethod, driver: MonthlyDriverRecord): number {
  if (driverMethod === "total_manpower" || driverMethod === "agent_headcount") {
    return driver.plannedHeadcount;
  }
  if (driverMethod === "revenue_share") {
    return driver.calculatedPlannedRevenue;
  }
  return 1; // equal_split
}

function unitFor(driverMethod: SharingMethod, driver: MonthlyDriverRecord): number {
  if (driverMethod === "total_manpower" || driverMethod === "agent_headcount") {
    return driver.plannedHeadcount;
  }
  if (driverMethod === "revenue_share") {
    return driver.calculatedPlannedRevenue;
  }
  return 0;
}

/**
 * Splits one branch-planned budget line's already-computed amounts (base/tax/gross/pnl_cost —
 * from the existing calculateBudgetLine, not recomputed here) across the branch's active cost
 * centres by the line's sharing method, returning one row per cost centre whose amounts always
 * sum exactly to the input line amounts (allocatePoolAmount's largest-remainder guarantee).
 *
 * Throws rather than silently defaulting when: the sharing method isn't supported yet, there are
 * no active cost centres, manpower/revenue-share data is missing for some cost centres, or a
 * manual split doesn't name every active cost centre. "Do not silently allocate."
 */
export async function computeLineAllocations(
  branchId: string,
  periodCode: string,
  sharingMethod: string | null | undefined,
  amounts: LineAmounts,
  manualAllocations: ManualAllocationInput[] | undefined,
  executor: Executor = db
): Promise<LineAllocationRow[]> {
  const method = (sharingMethod ?? "").trim() as SharingMethod;
  if (!SUPPORTED_SHARING_METHODS.includes(method)) {
    throw new Error(
      `Sharing method "${sharingMethod ?? ""}" is not yet supported for branch-level splitting. ` +
      `Supported methods: ${SUPPORTED_SHARING_METHODS.join(", ")}.`
    );
  }

  const costCentres = await listActiveCostCentres(branchId, executor);
  if (costCentres.length === 0) {
    throw new Error("This branch has no active cost centres to allocate a branch-level line to");
  }

  let shares: AllocationShare[];
  let mode: "weighted" | "equal" | "manual_percentage";
  let unitByCostCentre = new Map<string, number>();
  let driverValueByCostCentre = new Map<string, number>();

  if (method === "manual") {
    if (!manualAllocations?.length) {
      throw new Error("Manual sharing requires a percentage for at least one cost centre");
    }
    const activeIds = new Set(costCentres.map((cc) => cc.id));
    const missing = costCentres.filter((cc) => !manualAllocations.some((m) => m.costCentreId === cc.id));
    if (missing.length > 0) {
      throw new Error(
        `Manual sharing requires a percentage for every active cost centre. Missing: ` +
        missing.map((cc) => cc.costCentreName).join(", ")
      );
    }
    const unknown = manualAllocations.filter((m) => !activeIds.has(m.costCentreId));
    if (unknown.length > 0) {
      throw new Error("Manual sharing references a cost centre that is not active for this branch");
    }
    shares = manualAllocations.map((m) => ({ key: m.costCentreId, weight: m.percentage }));
    mode = "manual_percentage";
    driverValueByCostCentre = new Map(manualAllocations.map((m) => [m.costCentreId, m.percentage]));
  } else if (method === "equal_split") {
    shares = costCentres.map((cc) => ({ key: cc.id, weight: 1 }));
    mode = "equal";
  } else {
    const drivers = await getMonthlyDrivers(branchId, periodCode, executor);
    const driverByCostCentre = new Map(drivers.map((d) => [d.costCentreId, d]));
    const missingDrivers = costCentres.filter((cc) => {
      const driver = driverByCostCentre.get(cc.id);
      return !driver || driverWeight(method, driver) <= 0;
    });
    if (missingDrivers.length > 0) {
      throw new Error(
        `Monthly ${method === "revenue_share" ? "revenue rate" : "planned headcount"} is missing for: ` +
        missingDrivers.map((cc) => cc.costCentreName).join(", ") +
        ". Set monthly drivers for every active cost centre before using this sharing method."
      );
    }
    shares = costCentres.map((cc) => {
      const driver = driverByCostCentre.get(cc.id)!;
      return { key: cc.id, weight: driverWeight(method, driver) };
    });
    unitByCostCentre = new Map(costCentres.map((cc) => [cc.id, unitFor(method, driverByCostCentre.get(cc.id)!)]));
    driverValueByCostCentre = new Map(shares.map((s) => [s.key, s.weight]));
    mode = "weighted";
  }

  const base = allocatePoolAmount(amounts.baseAmount, shares, mode);
  const tax = allocatePoolAmount(amounts.taxAmount, shares, mode);
  const gross = allocatePoolAmount(amounts.grossAmount, shares, mode);
  const pnl = allocatePoolAmount(amounts.pnlCostAmount, shares, mode);

  return costCentres.map((cc) => {
    const grossShare = gross.amounts.get(cc.id) ?? 0;
    const expectedGross = amounts.grossAmount > 0 ? amounts.grossAmount : 1;
    const allocationPercentage = Math.round((grossShare / expectedGross) * 100 * 1_000_000) / 1_000_000;
    return {
      costCentreId: cc.id,
      driverValue: driverValueByCostCentre.get(cc.id) ?? 0,
      allocationPercentage,
      plannedUnit: unitByCostCentre.get(cc.id) ?? 0,
      baseAmount: base.amounts.get(cc.id) ?? 0,
      taxAmount: tax.amounts.get(cc.id) ?? 0,
      grossAmount: grossShare,
      pnlCostAmount: pnl.amounts.get(cc.id) ?? 0,
      roundingAdjustment: 0,
    };
  });
}

export async function replaceLineAllocations(
  connection: PoolConnection,
  budgetLineId: string,
  rows: LineAllocationRow[],
  actorUserId: string
): Promise<void> {
  await connection.execute(`DELETE FROM finance_budget_line_allocation WHERE budget_line_id = ?`, [budgetLineId]);
  for (const row of rows) {
    await connection.execute(
      `INSERT INTO finance_budget_line_allocation
        (id, budget_line_id, cost_centre_id, driver_value, allocation_percentage,
         planned_unit, base_amount, tax_amount, gross_amount, pnl_cost_amount,
         rounding_adjustment, entry_source, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'calculated',?,?)`,
      [
        randomUUID(),
        budgetLineId,
        row.costCentreId,
        row.driverValue,
        row.allocationPercentage,
        row.plannedUnit,
        row.baseAmount,
        row.taxAmount,
        row.grossAmount,
        row.pnlCostAmount,
        row.roundingAdjustment,
        actorUserId,
        actorUserId,
      ]
    );
  }
}

export async function getLineAllocations(budgetLineId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.*, ccm.cost_centre_name, ccm.cost_centre_code
       FROM finance_budget_line_allocation a
       LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id
      WHERE a.budget_line_id = ?
      ORDER BY ccm.cost_centre_name`,
    [budgetLineId]
  );
  return rows;
}

export const branchBudgetAllocationService = {
  listActiveCostCentres,
  getMonthlyDrivers,
  saveMonthlyDrivers,
  computeLineAllocations,
  replaceLineAllocations,
  getLineAllocations,
};
