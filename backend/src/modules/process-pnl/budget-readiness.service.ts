import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { listActiveCostCentres, getMonthlyDrivers, type CostCentreOption } from "./branch-budget-allocation.service.js";
import { getBranchMeterConsumption } from "./meter.service.js";
import { getCostCentreGradeWeightedCost } from "./grade-engine.service.js";

// Structurally identical to the Executor interfaces used across this session's other
// process-pnl services — same dependency-injection pattern for testability.
interface Executor {
  execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

/**
 * Branch Budget foundation (PR 13): proactive readiness checks for the three weighted
 * sharing methods, and per-budget exception detection. Every check here is read-only and reuses
 * the exact same data functions computeLineAllocations() calls right before it throws
 * "X data is missing for: ..." — no duplicated logic, just surfaced *before* save instead of only
 * as a save-time failure.
 */

// seat_count/floor_area/device_count/hiring_volume were absent here while being HARD BLOCKERS in
// computeLineAllocations' shared else-branch (MONTHLY_DRIVER_MISSING, 409) — and they are the
// seeded default_allocation_driver on 26 of the 38 sub-heads, so they are the methods most likely
// to be picked. The result was the worst possible ordering: no warning anywhere, then a failed
// save. They behave exactly like total_manpower (a zero or absent value is "missing"), so they
// are checked exactly like it.
export type WeightedSharingMethod =
  | "total_manpower"
  | "revenue_share"
  | "meter_wise"
  | "grade_weighted_headcount"
  | "seat_count"
  | "floor_area"
  | "device_count"
  | "hiring_volume";

const METHOD_LABELS: Record<WeightedSharingMethod, string> = {
  total_manpower: "Manpower (planned headcount)",
  revenue_share: "Revenue share",
  meter_wise: "Meter-wise (utility consumption)",
  grade_weighted_headcount: "Grade-weighted headcount (blended CTC)",
  seat_count: "Seat count",
  floor_area: "Floor area (sq ft)",
  device_count: "Device count",
  hiring_volume: "Hiring volume",
};

/** The finance_cost_centre_monthly_driver field each simple-driver method divides by. Mirrors
 *  driverQuantity() in branch-budget-allocation.service.ts — the engine treats <= 0 as missing,
 *  so the same rule is applied here rather than a second, kinder one. */
const SIMPLE_DRIVER_FIELDS = {
  seat_count: "seatCount",
  floor_area: "floorAreaSqft",
  device_count: "deviceCount",
  hiring_volume: "hiringVolume",
} as const;

export interface SharingMethodReadiness {
  method: WeightedSharingMethod;
  label: string;
  ready: boolean;
  missingCostCentres: { id: string; name: string }[];
}

export async function checkSharingMethodReadiness(
  branchId: string,
  periodCode: string,
  executor: Executor = db
): Promise<SharingMethodReadiness[]> {
  const costCentres = await listActiveCostCentres(branchId, executor);

  function toReadiness(method: WeightedSharingMethod, missing: CostCentreOption[]): SharingMethodReadiness {
    return {
      method,
      label: METHOD_LABELS[method],
      ready: costCentres.length > 0 && missing.length === 0,
      missingCostCentres: missing.map((cc) => ({ id: cc.id, name: cc.costCentreName })),
    };
  }

  if (costCentres.length === 0) {
    return (Object.keys(METHOD_LABELS) as WeightedSharingMethod[]).map((method) => toReadiness(method, []));
  }

  const drivers = await getMonthlyDrivers(branchId, periodCode, executor);
  const driverByCostCentre = new Map(drivers.map((d) => [d.costCentreId, d]));

  const missingManpower = costCentres.filter((cc) => (driverByCostCentre.get(cc.id)?.plannedHeadcount ?? 0) <= 0);
  const missingRevenue = costCentres.filter((cc) => (driverByCostCentre.get(cc.id)?.calculatedPlannedRevenue ?? 0) <= 0);

  // Meter-wise is ready as soon as ANY cost centre is metered: an unmetered cost centre simply
  // carries no share of a metered cost. Reporting "not ready" while computeLineAllocations
  // allocates the line happily would contradict the engine. The unmetered cost centres are still
  // listed, as information rather than a blocker.
  const meterConsumption = await getBranchMeterConsumption(branchId, periodCode, executor);
  const unmetered = costCentres.filter((cc) => !meterConsumption.has(cc.id));
  const meterReady = meterConsumption.size > 0;

  const missingGrade: CostCentreOption[] = [];
  for (const cc of costCentres) {
    const cost = await getCostCentreGradeWeightedCost(cc.id, periodCode, executor);
    if (!cost) missingGrade.push(cc);
  }

  const simpleDriverReadiness = (Object.keys(SIMPLE_DRIVER_FIELDS) as (keyof typeof SIMPLE_DRIVER_FIELDS)[])
    .map((method) => toReadiness(
      method,
      costCentres.filter((cc) => {
        const driver = driverByCostCentre.get(cc.id);
        return !driver || Number(driver[SIMPLE_DRIVER_FIELDS[method]] ?? 0) <= 0;
      })
    ));

  return [
    toReadiness("total_manpower", missingManpower),
    toReadiness("revenue_share", missingRevenue),
    { ...toReadiness("meter_wise", unmetered), ready: meterReady },
    toReadiness("grade_weighted_headcount", missingGrade),
    ...simpleDriverReadiness,
  ];
}

export interface BudgetException {
  lineId: string;
  itemName: string;
  type: "missing_driver_data" | "manual_split_imbalance";
  message: string;
}

/**
 * Flags branch-common lines in an already-saved budget whose sharing method now has missing
 * driver data (a "drift" case — the data existed when the line was saved, or a cost centre was
 * added since) and manual-split lines whose recorded percentages no longer sum to 100%.
 * Read-only, non-blocking — this does not re-run or invalidate anything.
 */
export async function checkBudgetExceptions(
  budgetId: string,
  executor: Executor = db
): Promise<BudgetException[]> {
  const [headerRows] = await executor.execute<RowDataPacket[]>(
    `SELECT branch_id, period_code FROM finance_budget_header WHERE id = ? LIMIT 1`,
    [budgetId]
  );
  const header = headerRows[0];
  if (!header) return [];
  const branchId = String(header.branch_id);
  const periodCode = String(header.period_code);

  const [lines] = await executor.execute<RowDataPacket[]>(
    `SELECT id, item_name, allocation_driver
       FROM finance_budget_line
      WHERE budget_id = ? AND planning_level = 'branch'`,
    [budgetId]
  );
  if (lines.length === 0) return [];

  const exceptions: BudgetException[] = [];
  let readiness: SharingMethodReadiness[] | null = null;

  for (const line of lines) {
    const method = String(line.allocation_driver ?? "");
    const lineId = String(line.id);
    const itemName = String(line.item_name);

    if (method === "manual") {
      const [allocRows] = await executor.execute<RowDataPacket[]>(
        `SELECT SUM(allocation_percentage) AS total FROM finance_budget_line_allocation WHERE budget_line_id = ?`,
        [lineId]
      );
      const total = Number(allocRows[0]?.total ?? 0);
      if (Math.abs(total - 100) > 0.01) {
        exceptions.push({
          lineId,
          itemName,
          type: "manual_split_imbalance",
          message: `Manual split totals ${total.toFixed(2)}%, not 100%`,
        });
      }
      continue;
    }

    const normalizedMethod = (method === "agent_headcount" ? "total_manpower" : method) as WeightedSharingMethod;
    if (!(normalizedMethod in METHOD_LABELS)) continue;

    if (!readiness) readiness = await checkSharingMethodReadiness(branchId, periodCode, executor);
    const methodReadiness = readiness.find((r) => r.method === normalizedMethod);
    if (methodReadiness && !methodReadiness.ready) {
      exceptions.push({
        lineId,
        itemName,
        type: "missing_driver_data",
        message: `${methodReadiness.label} data is missing for: ${methodReadiness.missingCostCentres.map((c) => c.name).join(", ")}`,
      });
    }
  }

  return exceptions;
}

export const budgetReadinessService = {
  checkSharingMethodReadiness,
  checkBudgetExceptions,
};
