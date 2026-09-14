import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { allocatePoolAmount, type AllocationShare } from "./bpo-pnl.calculation.js";
import { getBranchMeterConsumption, type MeterUtilityType } from "./meter.service.js";
import { getCostCentreGradeWeightedCost } from "./grade-engine.service.js";

import { refuse } from "./finance-error.js";
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
/** The pool wrapper and a PoolConnection both satisfy this. Their `execute` overloads differ
 *  enough that a stricter signature rejects a connection outright — and a caller already inside a
 *  transaction is exactly who must NOT be pushed onto the pool, or its reads miss its own
 *  uncommitted writes. */
interface Executor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(sql: string, params?: any[]): Promise<any>;
}

/**
 * Per-save memo for the reference data an allocation needs.
 *
 * computeLineAllocations is called once per branch-level budget line, and every lookup it makes is
 * keyed on the branch and the period — which are identical for every line in a save. Saving a
 * 58-line budget therefore issued ~58 identical cost-centre queries, ~58 identical monthly-driver
 * queries, and for grade-weighted lines 58 × (cost centres) grade queries, all sequentially inside
 * one transaction. That is what pushed Save draft past the client's 30s abort.
 *
 * Caching is safe within a save because none of this reference data is written by that
 * transaction — saveDraft only touches finance_budget_line and finance_budget_line_allocation.
 * Pass one cache per save; omit it and every call behaves exactly as before.
 */
export interface AllocationLookupCache {
  costCentres: Map<string, Promise<CostCentreOption[]>>;
  monthlyDrivers: Map<string, Promise<MonthlyDriverRecord[]>>;
  meterConsumption: Map<string, Promise<Awaited<ReturnType<typeof getBranchMeterConsumption>>>>;
  gradeCost: Map<string, Promise<Awaited<ReturnType<typeof getCostCentreGradeWeightedCost>>>>;
}

export function createAllocationLookupCache(): AllocationLookupCache {
  return {
    costCentres: new Map(),
    monthlyDrivers: new Map(),
    meterConsumption: new Map(),
    gradeCost: new Map(),
  };
}

/** Memoises the in-flight promise, not just the result, so concurrent callers share one query. */
function memo<T>(store: Map<string, Promise<T>> | undefined, key: string, run: () => Promise<T>): Promise<T> {
  if (!store) return run();
  const existing = store.get(key);
  if (existing) return existing;
  const started = run();
  store.set(key, started);
  return started;
}

export type SharingMethod =
  | "total_manpower"
  | "agent_headcount"
  | "revenue_share"
  | "equal_split"
  | "manual"
  | "meter_wise"
  | "grade_weighted_headcount"
  // Added because finance_expense_sub_head_master seeds these four as
  // default_allocation_driver on 26 of the 38 sub-heads, yet the engine rejected all of them:
  // applying a sub-head's own seeded default threw "Sharing method ... is not yet supported".
  // Their driver data lives on finance_cost_centre_monthly_driver (migration 434).
  | "seat_count"
  | "floor_area"
  | "device_count"
  | "hiring_volume";

const SUPPORTED_SHARING_METHODS: SharingMethod[] = [
  "total_manpower",
  "agent_headcount",
  "revenue_share",
  "equal_split",
  "manual",
  "meter_wise",
  "grade_weighted_headcount",
  "seat_count",
  "floor_area",
  "device_count",
  "hiring_volume",
];

/** Sub-head defaults that name a concept rather than a driver. Mapped so a sub-head's seeded
 *  default can be applied as-is instead of throwing:
 *   - usage_units   -> meter_wise (metered consumption is what "usage" meant)
 *   - direct_tagging-> not a branch-level split at all; the caller plans the line straight against
 *                     one cost centre (planning_level 'cost_centre'), so it never reaches here. */
export const SEEDED_DRIVER_ALIASES: Record<string, SharingMethod> = {
  usage_units: "meter_wise",
};

export interface CostCentreOption {
  id: string;
  costCentreCode: string;
  costCentreName: string;
  /** The process this cost centre serves, from cost_centre_master's text columns rather than a
   *  process_id join — process_id is NULL on live rows whose process name IS recorded. */
  processName?: string | null;
  processMapped?: boolean;
}

export interface MonthlyDriverInput {
  costCentreId: string;
  plannedHeadcount: number;
  revenueRatePerHead: number;
  /** Optional so existing callers that only send headcount/revenue keep working unchanged. */
  seatCount?: number;
  floorAreaSqft?: number;
  deviceCount?: number;
  hiringVolume?: number;
  remarks?: string | null;
}

export interface MonthlyDriverRecord {
  /** "planned" when Finance typed a headcount, "live_employees" when it was derived from the
   *  staff actually posted to the cost centre. */
  headcountSource?: "planned" | "live_employees";
  costCentreId: string;
  costCentreName: string;
  plannedHeadcount: number;
  revenueRatePerHead: number;
  calculatedPlannedRevenue: number;
  seatCount: number;
  floorAreaSqft: number;
  deviceCount: number;
  hiringVolume: number;
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
  // active_status alone is not reliable on the live table — confirmed by direct query that at
  // least one cost centre has active_status = 1 but a close_date years in the past (the flag was
  // never updated when it closed). Excluding closed/not-yet-live rows here prevents a stale or
  // future cost centre from silently appearing as an allocation/statement column.
  // Which process a cost centre serves is NOT cost_centre_master.process_id — that column is NULL
  // on every live row. The mapping that actually exists runs through the people: the process of the
  // employees posted to the cost centre. This is the same derivation /api/org/cost-centres uses, so
  // the planner's column labels agree with the Org Masters screen instead of contradicting it.
  // The db_bill snapshot text is kept as a fallback for a cost centre with no staff mapped yet.
  const [rows] = (await executor.execute(
    `SELECT ccm.id, ccm.cost_centre_code, ccm.cost_centre_name,
            COALESCE(
              (SELECT pm.process_name
                 FROM employees e
                 JOIN process_master pm ON pm.id = e.process_id
                WHERE e.cost_centre_id = ccm.id AND e.active_status = 1
                GROUP BY pm.id
                ORDER BY COUNT(*) DESC
                LIMIT 1),
              NULLIF(TRIM(ccm.process_name_bill), ''),
              NULLIF(TRIM(ccm.client_name), '')
            ) AS resolved_process_name
       FROM cost_centre_master ccm
      WHERE ccm.branch_id = ? AND ccm.active_status = 1
        AND (ccm.close_date IS NULL OR ccm.close_date > CURDATE())
        AND (ccm.go_live_date IS NULL OR ccm.go_live_date <= CURDATE())
      ORDER BY ccm.cost_centre_name`,
    [branchId]
  )) as [RowDataPacket[], unknown];
  return rows.map((row) => {
    const processName = row.resolved_process_name ? String(row.resolved_process_name).trim() : null;
    return {
      id: String(row.id),
      costCentreCode: String(row.cost_centre_code ?? ""),
      costCentreName: String(row.cost_centre_name ?? ""),
      processName,
      // Surfaced so the UI can flag a genuine gap instead of asserting one.
      processMapped: Boolean(processName),
    };
  });
}

export async function getMonthlyDrivers(
  branchId: string,
  periodCode: string,
  executor: Executor = db
): Promise<MonthlyDriverRecord[]> {
  const costCentres = await listActiveCostCentres(branchId, executor);
  const [driverRows] = (await executor.execute(
    `SELECT cost_centre_id, planned_headcount, revenue_rate_per_head,
            seat_count, floor_area_sqft, device_count, hiring_volume, remarks,
            status, updated_by, updated_at
       FROM finance_cost_centre_monthly_driver
      WHERE branch_id = ? AND period_code = ?`,
    [branchId, periodCode]
  )) as [RowDataPacket[], unknown];
  const byCostCentre = new Map(driverRows.map((row) => [String(row.cost_centre_id), row]));

  /*
   * HEADCOUNT FALLS BACK TO THE PEOPLE ACTUALLY POSTED TO THE COST CENTRE.
   *
   * planned_headcount is a number somebody types into Branch Budget → Drivers, once per cost
   * centre per month, and the sharing methods that use it refuse to run until every active cost
   * centre has one. On 2026-08 that was 331 cost centres short across the live budget branches,
   * which is not a data-entry backlog anyone was going to clear — and it silently stopped every
   * branch-common cost (rent, electricity, cafeteria) from being shared out at all.
   *
   * The number was already in the database. `employees.cost_centre_id` says who works where, and
   * it is the same derivation the cost-centre master screen uses for its own process mapping.
   * A typed plan still wins where one exists — planning ahead of a hire is the whole point of a
   * PLANNED headcount — but where nobody has typed one, the real staff count is a far better
   * answer than zero.
   */
  const [liveHeadcountRows] = (await executor.execute(
    `SELECT e.cost_centre_id, COUNT(*) AS live_headcount
       FROM employees e
       JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      WHERE cc.branch_id = ? AND e.active_status = 1 AND e.cost_centre_id IS NOT NULL
      GROUP BY e.cost_centre_id`,
    [branchId]
  )) as [RowDataPacket[], unknown];
  const liveHeadcount = new Map(
    liveHeadcountRows.map((row) => [String(row.cost_centre_id), Number(row.live_headcount ?? 0)])
  );

  return costCentres.map((cc) => {
    const row = byCostCentre.get(cc.id);
    const typedHeadcount = Number(row?.planned_headcount ?? 0);
    const plannedHeadcount = typedHeadcount > 0 ? typedHeadcount : (liveHeadcount.get(cc.id) ?? 0);
    const revenueRatePerHead = Number(row?.revenue_rate_per_head ?? 0);
    return {
      costCentreId: cc.id,
      costCentreName: cc.costCentreName,
      plannedHeadcount,
      revenueRatePerHead,
      calculatedPlannedRevenue: Math.round(plannedHeadcount * revenueRatePerHead * 100) / 100,
      /** Where plannedHeadcount came from, so a screen can show a derived number as derived
       *  rather than passing it off as something Finance entered. */
      headcountSource: typedHeadcount > 0 ? ("planned" as const) : ("live_employees" as const),
      seatCount: Number(row?.seat_count ?? 0),
      floorAreaSqft: Number(row?.floor_area_sqft ?? 0),
      deviceCount: Number(row?.device_count ?? 0),
      hiringVolume: Number(row?.hiring_volume ?? 0),
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
    throw refuse(400, "ALLOCATION_PERIOD_INVALID", "A valid budget period (YYYY-MM) is required");
  }
  const activeCostCentres = new Set((await listActiveCostCentres(branchId)).map((cc) => cc.id));
  for (const driver of drivers) {
    if (!activeCostCentres.has(driver.costCentreId)) {
      throw refuse(400, "COST_CENTRE_NOT_ACTIVE", `Cost centre ${driver.costCentreId} is not an active cost centre for this branch`);
    }
    if (!Number.isFinite(driver.plannedHeadcount) || driver.plannedHeadcount < 0) {
      throw refuse(400, "HEADCOUNT_NEGATIVE", "Planned headcount cannot be negative");
    }
    if (!Number.isFinite(driver.revenueRatePerHead) || driver.revenueRatePerHead < 0) {
      throw refuse(400, "REVENUE_RATE_NEGATIVE", "Revenue rate per head cannot be negative");
    }
    for (const [label, value] of [
      ["Seat count", driver.seatCount],
      ["Floor area", driver.floorAreaSqft],
      ["Device count", driver.deviceCount],
      ["Hiring volume", driver.hiringVolume],
    ] as const) {
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        throw refuse(400, "DRIVER_VALUE_NEGATIVE", `${label} cannot be negative`);
      }
    }
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const driver of drivers) {
      await connection.execute(
        `INSERT INTO finance_cost_centre_monthly_driver
           (id, branch_id, period_code, cost_centre_id, planned_headcount,
            revenue_rate_per_head, seat_count, floor_area_sqft, device_count,
            hiring_volume, remarks, status, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?)
         ON DUPLICATE KEY UPDATE
           planned_headcount = VALUES(planned_headcount),
           revenue_rate_per_head = VALUES(revenue_rate_per_head),
           seat_count = VALUES(seat_count),
           floor_area_sqft = VALUES(floor_area_sqft),
           device_count = VALUES(device_count),
           hiring_volume = VALUES(hiring_volume),
           remarks = VALUES(remarks),
           updated_by = VALUES(updated_by)`,
        [
          randomUUID(),
          branchId,
          periodCode,
          driver.costCentreId,
          driver.plannedHeadcount,
          driver.revenueRatePerHead,
          driver.seatCount ?? 0,
          driver.floorAreaSqft ?? 0,
          driver.deviceCount ?? 0,
          driver.hiringVolume ?? 0,
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

/** What to call each driver when telling the user which one is missing. */
const DRIVER_LABELS: Partial<Record<SharingMethod, string>> = {
  total_manpower: "planned headcount",
  agent_headcount: "planned headcount",
  revenue_share: "revenue rate",
  seat_count: "seat count",
  floor_area: "floor area",
  device_count: "device count",
  hiring_volume: "hiring volume",
};

/** The per-cost-centre quantity a method divides by. Kept in one place so driverWeight and
 *  unitFor cannot drift apart — they returned different values for the same method before. */
function driverQuantity(driverMethod: SharingMethod, driver: MonthlyDriverRecord): number | null {
  switch (driverMethod) {
    case "total_manpower":
    case "agent_headcount":
      return driver.plannedHeadcount;
    case "revenue_share":
      return driver.calculatedPlannedRevenue;
    case "seat_count":
      return driver.seatCount;
    case "floor_area":
      return driver.floorAreaSqft;
    case "device_count":
      return driver.deviceCount;
    case "hiring_volume":
      return driver.hiringVolume;
    default:
      return null; // equal_split, manual, meter_wise, grade_weighted_headcount
  }
}

function driverWeight(driverMethod: SharingMethod, driver: MonthlyDriverRecord): number {
  return driverQuantity(driverMethod, driver) ?? 1; // equal_split
}

function unitFor(driverMethod: SharingMethod, driver: MonthlyDriverRecord): number {
  return driverQuantity(driverMethod, driver) ?? 0;
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
  executor: Executor = db,
  /** Restricts meter-wise sharing to one kind of meter. Without it an electricity line would be
   *  apportioned by kWh + litres + KL added together, which is not a quantity. Omit to use every
   *  meter regardless of utility (the pre-434 behaviour). */
  utilityType?: MeterUtilityType,
  /** Restricts the split to these cost centres. Omit (or pass an empty list) to spread across every
   *  active cost centre, which is the long-standing behaviour. Real costs are rarely branch-wide —
   *  air-conditioner maintenance touches only the floors a few processes occupy — and without this
   *  the only way to exclude a cost centre was a manual split giving it 0%. */
  includedCostCentreIds?: string[] | null,
  /** Share one cache across every line of a save — see AllocationLookupCache. */
  cache?: AllocationLookupCache
): Promise<LineAllocationRow[]> {
  const method = (SEEDED_DRIVER_ALIASES[(sharingMethod ?? "").trim()]
    ?? (sharingMethod ?? "").trim()) as SharingMethod;
  if (!SUPPORTED_SHARING_METHODS.includes(method)) {
    throw refuse(400, "SHARING_METHOD_UNSUPPORTED",
      `Sharing method "${sharingMethod ?? ""}" is not yet supported for branch-level splitting. ` +
      `Supported methods: ${SUPPORTED_SHARING_METHODS.join(", ")}.`
    );
  }

  const allActive = await memo(cache?.costCentres, branchId, () =>
    listActiveCostCentres(branchId, executor)
  );
  if (allActive.length === 0) {
    throw refuse(409, "NO_ACTIVE_COST_CENTRES", "This branch has no active cost centres to allocate a branch-level line to");
  }

  // Narrow to the line's own cost-centre scope. Everything downstream — driver checks, manual
  // percentages, the split itself — then works against the selected set only, so an excluded cost
  // centre neither needs driver data nor receives an allocation row.
  const scopeIds = (includedCostCentreIds ?? []).filter(Boolean);
  let costCentres = allActive;
  if (scopeIds.length) {
    const activeIds = new Set(allActive.map((cc) => cc.id));
    const unknown = scopeIds.filter((id) => !activeIds.has(id));
    if (unknown.length) {
      throw refuse(400, "COST_CENTRE_NOT_ACTIVE",
        `Cost centre scope names ${unknown.length} cost centre(s) that are not active for this branch`
      );
    }
    const wanted = new Set(scopeIds);
    costCentres = allActive.filter((cc) => wanted.has(cc.id));
    if (costCentres.length === 0) {
      throw refuse(400, "COST_CENTRE_SCOPE_REQUIRED", "Select at least one cost centre for this branch-level line");
    }
  }

  let shares: AllocationShare[];
  let mode: "weighted" | "equal" | "manual_percentage";
  let unitByCostCentre = new Map<string, number>();
  let driverValueByCostCentre = new Map<string, number>();

  if (method === "manual") {
    if (!manualAllocations?.length) {
      throw refuse(400, "MANUAL_SPLIT_INCOMPLETE", "Manual sharing requires a percentage for at least one cost centre");
    }
    const activeIds = new Set(costCentres.map((cc) => cc.id));
    const missing = costCentres.filter((cc) => !manualAllocations.some((m) => m.costCentreId === cc.id));
    if (missing.length > 0) {
      throw refuse(400, "MANUAL_SPLIT_INCOMPLETE",
        `Manual sharing requires a percentage for every ${scopeIds.length ? "selected" : "active"} cost centre. Missing: ` +
        missing.map((cc) => cc.costCentreName).join(", ")
      );
    }
    const unknown = manualAllocations.filter((m) => !activeIds.has(m.costCentreId));
    if (unknown.length > 0) {
      throw refuse(400, "COST_CENTRE_NOT_ACTIVE", "Manual sharing references a cost centre that is not active for this branch");
    }
    shares = manualAllocations.map((m) => ({ key: m.costCentreId, weight: m.percentage }));
    mode = "manual_percentage";
    driverValueByCostCentre = new Map(manualAllocations.map((m) => [m.costCentreId, m.percentage]));
  } else if (method === "equal_split") {
    shares = costCentres.map((cc) => ({ key: cc.id, weight: 1 }));
    mode = "equal";
  } else if (method === "meter_wise") {
    // Resolved for the whole branch in one pass: a shared meter belongs to no single cost centre,
    // so it cannot be found by asking each cost centre in turn.
    const branchConsumption = await memo(
      cache?.meterConsumption,
      `${branchId}|${periodCode}|${utilityType ?? "*"}`,
      () => getBranchMeterConsumption(branchId, periodCode, executor, utilityType)
    );
    const consumptionByCostCentre = new Map(
      costCentres
        .filter((cc) => branchConsumption.has(cc.id))
        .map((cc) => [cc.id, branchConsumption.get(cc.id)!])
    );
    // An unmetered cost centre carries no share of a metered cost, so it gets weight 0 rather
    // than blocking the whole line. Requiring EVERY active cost centre to be metered rejected the
    // ordinary real case — a dedicated meter on a few processes and none on the rest — which is
    // exactly what meter-wise sharing exists for. Only a branch with no meter data anywhere is an
    // error, because then there is nothing to apportion by.
    if (consumptionByCostCentre.size === 0) {
      throw refuse(409, "METER_READING_MISSING",
        "No meter reading exists for this branch and period"
        + (utilityType ? ` for ${utilityType}` : "")
        + ". Record at least one meter reading before using meter-wise sharing."
      );
    }
    shares = costCentres.map((cc) => ({
      key: cc.id,
      weight: consumptionByCostCentre.get(cc.id)?.consumption ?? 0,
    }));
    unitByCostCentre = new Map(
      costCentres.map((cc) => [cc.id, consumptionByCostCentre.get(cc.id)?.consumption ?? 0])
    );
    driverValueByCostCentre = new Map(shares.map((s) => [s.key, s.weight]));
    mode = "weighted";
  } else if (method === "grade_weighted_headcount") {
    const costByCostCentre = new Map<string, { totalHeadcount: number; blendedMonthlyCost: number }>();
    // Sequential per cost centre, but memoised across lines: the same cost centre's grade cost was
    // otherwise re-read once per branch-level line.
    for (const cc of costCentres) {
      const cost = await memo(cache?.gradeCost, `${cc.id}|${periodCode}`, () =>
        getCostCentreGradeWeightedCost(cc.id, periodCode, executor)
      );
      if (cost) costByCostCentre.set(cc.id, cost);
    }
    const missingGradeData = costCentres.filter((cc) => !costByCostCentre.has(cc.id));
    if (missingGradeData.length > 0) {
      throw refuse(409, "GRADE_HEADCOUNT_MISSING",
        `Grade-wise headcount data is missing for: ` +
        missingGradeData.map((cc) => cc.costCentreName).join(", ") +
        ". Set grade drivers for every active cost centre before using grade-weighted sharing."
      );
    }
    shares = costCentres.map((cc) => ({ key: cc.id, weight: costByCostCentre.get(cc.id)!.blendedMonthlyCost }));
    unitByCostCentre = new Map(
      costCentres.map((cc) => [cc.id, costByCostCentre.get(cc.id)!.totalHeadcount])
    );
    driverValueByCostCentre = new Map(shares.map((s) => [s.key, s.weight]));
    mode = "weighted";
  } else if (method === "revenue_share") {
    // Unlike the other weighted drivers below, a cost centre legitimately has zero revenue —
    // a new floor, a support function that isn't billed — so requiring every active cost centre
    // to carry a rate before ANY branch-common line (rent, internet, anything) could be planned
    // was blocking unrelated costs on missing revenue data. A cost centre with no revenue simply
    // carries no share of the pool, the same treatment meter_wise already gives an unmetered cost
    // centre. The gap is still surfaced as a non-blocking caution via checkSharingMethodReadiness
    // (Exceptions & Readiness tab), which is where "add revenue" belongs — not a save-time throw.
    const drivers = await memo(cache?.monthlyDrivers, `${branchId}|${periodCode}`, () =>
      getMonthlyDrivers(branchId, periodCode, executor)
    );
    const driverByCostCentre = new Map(drivers.map((d) => [d.costCentreId, d]));
    shares = costCentres.map((cc) => ({
      key: cc.id,
      weight: Math.max(0, driverByCostCentre.get(cc.id)?.calculatedPlannedRevenue ?? 0),
    }));
    unitByCostCentre = new Map(
      costCentres.map((cc) => [cc.id, driverByCostCentre.get(cc.id)?.calculatedPlannedRevenue ?? 0])
    );
    driverValueByCostCentre = new Map(shares.map((s) => [s.key, s.weight]));
    mode = "weighted";
  } else {
    const drivers = await memo(cache?.monthlyDrivers, `${branchId}|${periodCode}`, () =>
      getMonthlyDrivers(branchId, periodCode, executor)
    );
    const driverByCostCentre = new Map(drivers.map((d) => [d.costCentreId, d]));
    /*
     * A COST CENTRE WITH NOTHING IN IT CARRIES NO SHARE — it does not block the split.
     *
     * This branch used to demand a positive driver value for EVERY active cost centre and refuse
     * the whole line otherwise. That reads as a data-quality gate and behaves as a denial of
     * service: on 2026-08, 331 active cost centres across the live budget branches had no
     * headcount, 325 of them because they have no staff at all — imported site codes that exist
     * on the master and employ nobody. One of those was enough to stop rent, electricity and the
     * cafeteria being shared out across the cost centres that DO have people, which is how
     * Rs 3.46 crore ended up owned by nobody.
     *
     * Zero is not missing. A cost centre with no people should carry none of a headcount-shared
     * cost — that is the arithmetic working, not failing. `meter_wise` and `revenue_share`
     * directly above already take this position and say why; this branch was simply never given
     * the same treatment.
     *
     * What IS still an error is every cost centre reading zero, because then there is nothing to
     * apportion by and an "even" split would be an invention.
     */
    shares = costCentres.map((cc) => {
      const driver = driverByCostCentre.get(cc.id);
      return { key: cc.id, weight: driver ? Math.max(0, driverWeight(method, driver)) : 0 };
    });
    if (shares.every((share) => share.weight <= 0)) {
      throw refuse(409, "MONTHLY_DRIVER_MISSING",
        `No cost centre in this branch has any ${DRIVER_LABELS[method] ?? "driver data"} for ${periodCode}, ` +
        "so there is nothing to share this cost out by. Set monthly drivers, or pick a different sharing method."
      );
    }
    unitByCostCentre = new Map(
      costCentres.map((cc) => {
        const driver = driverByCostCentre.get(cc.id);
        return [cc.id, driver ? unitFor(method, driver) : 0];
      })
    );
    driverValueByCostCentre = new Map(shares.map((s) => [s.key, s.weight]));
    mode = "weighted";
  }

  // A budget is a plan, and the grid shows it in whole rupees. Allocating in paise yields shares
  // like 1428.57 which each display as 1,429, so a column of seven reads 10,003 against a 10,000
  // total. Rupee granularity is ignored automatically when a pool is not a whole number of rupees,
  // so the shares still sum to the line exactly in every case.
  //
  // The decision is taken ONCE for the whole line rather than per component. allocatePoolAmount
  // falls back to paise for a non-integer pool on its own, so passing "rupee" four times could
  // give one component whole-rupee shares and its neighbour paise shares — a line with base
  // 10,001.00 (integer, so rupees) and tax 1,800.18 (not, so paise) would write allocation rows
  // whose base_amount + tax_amount did not equal their own gross_amount. Splitting four figures
  // that are arithmetically related to each other means they must be split the same way.
  //
  // Where all four are whole rupees this is identical to the previous behaviour, which is every
  // allocation row in production today: 0 of 410 currently mismatch.
  const wholeRupeeLine = [
    amounts.baseAmount, amounts.taxAmount, amounts.grossAmount, amounts.pnlCostAmount,
  ].every((value) => Number.isInteger(Number(value)));
  const granularity = wholeRupeeLine ? "rupee" : "paise";

  const base = allocatePoolAmount(amounts.baseAmount, shares, mode, granularity);
  const tax = allocatePoolAmount(amounts.taxAmount, shares, mode, granularity);
  const gross = allocatePoolAmount(amounts.grossAmount, shares, mode, granularity);
  const pnl = allocatePoolAmount(amounts.pnlCostAmount, shares, mode, granularity);

  // Backend-authoritative block for manual splits (the frontend already validates this
  // pre-save, but the API must not silently persist an unbalanced split reached by any other
  // caller). balanced/percentTotal are identical across all four calls above since they share
  // the same `shares` — checking one is sufficient.
  if (mode === "manual_percentage" && !gross.balanced) {
    throw refuse(400, "MANUAL_SPLIT_NOT_100", 
      `Manual cost-centre split must total 100% (currently ${(gross.percentTotal ?? 0).toFixed(2)}%)`
    );
  }

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
  if (rows.length === 0) return;

  // One multi-row INSERT rather than one per cost centre. Every row here is generated by
  // computeLineAllocations above — no user-supplied text reaches the SQL, and the values are still
  // bound as parameters; only the placeholder list is built from rows.length.
  const placeholders = rows.map(() => "(?,?,?,?,?,?,?,?,?,?,?,'calculated',?,?)").join(",");
  const params = rows.flatMap((row) => [
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
  ]);
  await connection.execute(
    `INSERT INTO finance_budget_line_allocation
      (id, budget_line_id, cost_centre_id, driver_value, allocation_percentage,
       planned_unit, base_amount, tax_amount, gross_amount, pnl_cost_amount,
       rounding_adjustment, entry_source, created_by, updated_by)
     VALUES ${placeholders}`,
    params
  );
}

/**
 * Re-derives a branch-level line's cost-centre split from the driver already recorded on it.
 *
 * THE SPLIT HAS TO FOLLOW THE LINE, and until now it did not.
 *
 * A branch-level line (`planning_level = 'branch'`) is a cost nobody owns on their own — rent,
 * electricity, the cafeteria — and the raiser records HOW it should be shared by picking an
 * allocation driver. `finance_budget_line_allocation` is where that sharing becomes real numbers.
 * It was written in exactly one place: the full budget save. Every other path that changes a
 * line's amount — a tax amendment, its review, and both sides of a budget transfer — updated
 * `gross_amount` and left the split behind, so it silently stopped describing the line it belongs
 * to. And a line that never went through a full save after being set to branch level had no split
 * at all.
 *
 * The state that produced: 100 of 103 branch-level lines, Rs 3.46 crore, with a driver recorded
 * and nothing computed from it. Replayed read-only, 78 of those 100 would compute cleanly today —
 * the data was never the problem, nothing had asked.
 *
 * REFUSALS ARE REPORTED, NOT THROWN. `computeLineAllocations` refuses when the branch is missing
 * driver data (19 of the 100) or when a manual split has no percentages (3). Letting that abort a
 * tax amendment would block unrelated finance work on a data gap somewhere else in the branch —
 * the same trap `revenue_share` already documents above. The caller gets the reason back and can
 * surface it; the previous split, if any, is left untouched rather than deleted.
 *
 * MANUAL SPLITS KEEP THEIR PERCENTAGES. For a manual driver the percentages ARE the plan and are
 * not re-derivable from anything, so they are read back off the existing split and re-applied to
 * the new amount. A manual line with no split yet has nothing to read and is reported instead.
 */
export async function resyncLineAllocations(
  connection: PoolConnection,
  budgetLineId: string,
  actorUserId: string
): Promise<{ status: "written" | "not_applicable" | "skipped"; rows?: number; reason?: string }> {
  const [lineRows] = await connection.execute<RowDataPacket[]>(
    `SELECT l.id, l.planning_level, l.allocation_driver,
            l.base_amount, l.tax_amount, l.gross_amount, l.pnl_cost_amount,
            h.branch_id, h.period_code
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE l.id = ?
      LIMIT 1`,
    [budgetLineId]
  );
  const line = lineRows[0] as any;
  if (!line) return { status: "not_applicable", reason: "LINE_NOT_FOUND" };
  if (String(line.planning_level) !== "branch") return { status: "not_applicable" };

  // The cost centres this line actually covers. A branch-level line may deliberately exclude part
  // of the branch (one floor's air conditioning), and that scope lives only in the split it
  // already has — so re-deriving without it would silently widen the line to the whole branch.
  const [existing] = await connection.execute<RowDataPacket[]>(
    `SELECT cost_centre_id, allocation_percentage
       FROM finance_budget_line_allocation
      WHERE budget_line_id = ?`,
    [budgetLineId]
  );
  const scope = (existing as RowDataPacket[]).map((row) => String(row.cost_centre_id));

  const method = String(line.allocation_driver ?? "").trim();
  let manualAllocations: ManualAllocationInput[] | undefined;
  if (method === "manual") {
    if (!existing.length) {
      return { status: "skipped", reason: "MANUAL_SPLIT_INCOMPLETE" };
    }
    manualAllocations = (existing as RowDataPacket[]).map((row) => ({
      costCentreId: String(row.cost_centre_id),
      percentage: Number(row.allocation_percentage),
    }));
  }

  try {
    const rows = await computeLineAllocations(
      String(line.branch_id),
      String(line.period_code),
      line.allocation_driver,
      {
        baseAmount: Number(line.base_amount),
        taxAmount: Number(line.tax_amount),
        grossAmount: Number(line.gross_amount),
        pnlCostAmount: Number(line.pnl_cost_amount),
      },
      manualAllocations,
      connection,
      undefined,
      scope.length ? scope : undefined
    );
    await replaceLineAllocations(connection, budgetLineId, rows, actorUserId);
    return { status: "written", rows: rows.length };
  } catch (error) {
    const refusal = error as { code?: string; statusCode?: number };
    /*
     * Only OUR OWN refusals are survivable, and they are identified by `statusCode` — which
     * refuse() sets and nothing else does.
     *
     * Keying on `code` alone looked equivalent and is not: every mysql2 error carries one too, so
     * a genuine database fault (ER_DATA_TOO_LONG on a mis-sized actor id, a lock timeout, a
     * dropped column) was caught here and reported as though it were a routine missing-driver
     * gap. Found exactly that way — 78 lines reported as "needs a person" when the computation had
     * in fact succeeded and only the write failed.
     */
    if (typeof refusal.statusCode !== "number") throw error;
    return { status: "skipped", reason: refusal.code ?? `HTTP_${refusal.statusCode}` };
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
  resyncLineAllocations,
  getLineAllocations,
};
