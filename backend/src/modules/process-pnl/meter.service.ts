import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// Structurally identical to branch-budget-allocation.service.ts's Executor — lets
// getCostCentreMeterConsumption run against either the shared pool or a fake executor in tests,
// same dependency-injection pattern already established for computeLineAllocations.
interface Executor {
  execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

/**
 * Branch Budget foundation (PR 7): meter master/reading subsystem (spec Part 10) feeding
 * meter-wise sharing. Consumption/amount are MySQL GENERATED columns on finance_meter_reading
 * (sql/427_finance_meter_subsystem.sql) — computed by the database from opening/closing
 * reading + rate, never recomputed in JS, so there is no float-drift risk on these values.
 */

export interface MeterOption {
  id: string;
  meterCode: string;
  meterName: string;
  branchId: string;
  costCentreId: string;
  location: string | null;
  readingUnit: string;
  fixedRate: number;
}

export interface MeterReadingRecord {
  id: string;
  meterId: string;
  periodCode: string;
  openingReading: number;
  closingReading: number;
  consumption: number;
  rate: number;
  amount: number;
  readingType: "actual" | "estimated";
  estimationMethod: string | null;
  estimationReason: string | null;
  reconciliationStatus: "pending" | "reconciled";
}

export interface SaveReadingInput {
  openingReading: number;
  closingReading: number;
  readingType: "actual" | "estimated";
  estimationMethod?: string | null;
  estimationReason?: string | null;
}

export interface CreateMeterInput {
  branchId: string;
  costCentreId: string;
  meterCode: string;
  meterName: string;
  location?: string | null;
  readingUnit: string;
  fixedRate: number;
  effectiveFrom: string;
}

function toReading(row: RowDataPacket): MeterReadingRecord {
  return {
    id: String(row.id),
    meterId: String(row.meter_id),
    periodCode: String(row.period_code),
    openingReading: Number(row.opening_reading),
    closingReading: Number(row.closing_reading),
    consumption: Number(row.consumption),
    rate: Number(row.rate),
    amount: Number(row.amount),
    readingType: row.reading_type as "actual" | "estimated",
    estimationMethod: row.estimation_method ?? null,
    estimationReason: row.estimation_reason ?? null,
    reconciliationStatus: row.reconciliation_status as "pending" | "reconciled",
  };
}

export async function listMeters(branchId: string): Promise<MeterOption[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, meter_code, meter_name, branch_id, cost_centre_id, location, reading_unit, fixed_rate
       FROM finance_meter_master
      WHERE branch_id = ? AND active_status = 1
        AND (effective_to IS NULL OR effective_to >= CURDATE())
      ORDER BY meter_name`,
    [branchId]
  );
  return rows.map((row) => ({
    id: String(row.id),
    meterCode: String(row.meter_code),
    meterName: String(row.meter_name),
    branchId: String(row.branch_id),
    costCentreId: String(row.cost_centre_id),
    location: row.location ?? null,
    readingUnit: String(row.reading_unit),
    fixedRate: Number(row.fixed_rate),
  }));
}

export async function createMeter(input: CreateMeterInput, actorUserId: string): Promise<MeterOption> {
  if (!input.meterCode?.trim()) throw new Error("Meter code is required");
  if (!input.meterName?.trim()) throw new Error("Meter name is required");
  if (!Number.isFinite(input.fixedRate) || input.fixedRate < 0) throw new Error("Fixed rate cannot be negative");
  if (!input.costCentreId?.trim()) throw new Error("Cost centre is required");

  /*
   * The cost centre must belong to the meter's own branch.
   *
   * The route resolves branchId through resolveFinanceBranchScope but took costCentreId straight
   * from the body, so a branch admin could create a meter in their own branch pointing at another
   * branch's cost centre. Nothing rejected it and nothing showed it: the damage surfaces later
   * and silently, in computeLineAllocations, which keys meter consumption by cost centre and
   * then does
   *     costCentres.filter((cc) => branchConsumption.has(cc.id))
   * against the branch's OWN active cost centres. A foreign cost centre is not in that list, so
   * its consumption is filtered out and the metered amount simply disappears from the split —
   * the branch's electricity is apportioned as though that meter did not exist, and if it was
   * the only meter the line fails with "nothing to apportion by" instead.
   *
   * Checked here rather than at the route because this is the only write path to
   * finance_meter_master, so the rule holds for every caller.
   *
   * Measured before adding: 3 meters in production, none cross-branch and none orphaned.
   */
  const [ownerRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id FROM cost_centre_master WHERE id = ? LIMIT 1`,
    [input.costCentreId]
  );
  if (!ownerRows[0]) throw new Error("Cost centre not found");
  if (String(ownerRows[0].branch_id) !== String(input.branchId)) {
    throw new Error("A meter's cost centre must belong to the same branch as the meter");
  }

  const id = randomUUID();
  await db.execute(
    `INSERT INTO finance_meter_master
      (id, meter_code, meter_name, branch_id, cost_centre_id, location, reading_unit, fixed_rate,
       effective_from, created_by, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.meterCode.trim(),
      input.meterName.trim(),
      input.branchId,
      input.costCentreId,
      input.location?.trim() || null,
      input.readingUnit,
      input.fixedRate,
      input.effectiveFrom,
      actorUserId,
      actorUserId,
    ]
  );
  const meters = await listMeters(input.branchId);
  const created = meters.find((m) => m.id === id);
  if (!created) throw new Error("Meter was created but could not be reloaded");
  return created;
}

async function getReadingRow(
  meterId: string,
  periodCode: string,
  readingType: "actual" | "estimated",
  executor: Executor = db
) {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT * FROM finance_meter_reading WHERE meter_id = ? AND period_code = ? AND reading_type = ? LIMIT 1`,
    [meterId, periodCode, readingType]
  );
  return rows[0] ?? null;
}

/**
 * The branch that owns a meter, for the route-level branch guard.
 *
 * The reading endpoints address a meter by id alone, so without this a branch-scoped caller
 * could read or write another branch's readings by guessing/holding an id. Same shape as
 * budget-topup.service.ts's getLineBranch(). Returns null when the meter does not exist, which
 * assertFinanceRecordBranch treats as a denial rather than as "unrestricted".
 */
export async function getMeterBranchId(meterId: string, executor: Executor = db): Promise<string | null> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT branch_id FROM finance_meter_master WHERE id = ? LIMIT 1`,
    [meterId]
  );
  return rows[0]?.branch_id ? String(rows[0].branch_id) : null;
}

export async function listReadings(meterId: string, periodCode: string): Promise<MeterReadingRecord[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM finance_meter_reading WHERE meter_id = ? AND period_code = ? ORDER BY reading_type`,
    [meterId, periodCode]
  );
  return rows.map(toReading);
}

/**
 * Saves an opening/closing reading for a meter/period. An actual reading never overwrites an
 * already-approved estimated reading for the same meter/period in place — both coexist (the
 * unique key is meter_id+period_code+reading_type, not just meter_id+period_code) and a
 * finance_meter_reconciliation row is written capturing the delta, per spec 10.2.
 */
/**
 * Saves a meter reading, and reconciles an earlier estimate against it.
 *
 * Runs in a transaction when it owns the work, which it does from its only caller. It performs
 * up to three writes — the reading upsert, the reconciliation row, and the UPDATE that marks the
 * estimate reconciled — and previously ran them as independent statements on the pool. If the
 * status UPDATE failed after the reconciliation row was inserted, the estimate stayed 'pending',
 * so the next actual reading inserted a SECOND reconciliation row for the same meter and period
 * and the adjustment was recorded twice.
 *
 * A caller that supplies its own executor keeps ownership of the transaction, exactly as before;
 * this only adds one where there was none.
 */
export async function saveReading(
  meterId: string,
  periodCode: string,
  input: SaveReadingInput,
  actorUserId: string,
  executor?: Executor
): Promise<{ reading: MeterReadingRecord; reconciliation: boolean }> {
  if (executor) return saveReadingWith(meterId, periodCode, input, actorUserId, executor);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await saveReadingWith(meterId, periodCode, input, actorUserId, connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function saveReadingWith(
  meterId: string,
  periodCode: string,
  input: SaveReadingInput,
  actorUserId: string,
  executor: Executor
): Promise<{ reading: MeterReadingRecord; reconciliation: boolean }> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) throw new Error("A valid budget period (YYYY-MM) is required");
  if (input.closingReading < input.openingReading) {
    throw new Error("Closing reading cannot be less than opening reading");
  }
  if (input.readingType === "estimated" && !input.estimationMethod?.trim()) {
    throw new Error("Estimation method is required for an estimated reading");
  }
  if (input.readingType === "estimated" && !input.estimationReason?.trim()) {
    throw new Error("Estimation reason is required for an estimated reading");
  }

  const [meterRows] = await executor.execute<RowDataPacket[]>(
    `SELECT id, fixed_rate FROM finance_meter_master WHERE id = ? LIMIT 1`,
    [meterId]
  );
  const meter = meterRows[0];
  if (!meter) throw new Error("Meter was not found");
  const rate = Number(meter.fixed_rate);

  const id = randomUUID();
  await executor.execute(
    `INSERT INTO finance_meter_reading
       (id, meter_id, period_code, opening_reading, closing_reading, rate, reading_type,
        estimation_method, estimation_reason, entered_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       opening_reading = VALUES(opening_reading),
       closing_reading = VALUES(closing_reading),
       rate = VALUES(rate),
       estimation_method = VALUES(estimation_method),
       estimation_reason = VALUES(estimation_reason),
       entered_by = VALUES(entered_by),
       entered_at = NOW()`,
    [
      id,
      meterId,
      periodCode,
      input.openingReading,
      input.closingReading,
      rate,
      input.readingType,
      input.estimationMethod?.trim() || null,
      input.estimationReason?.trim() || null,
      actorUserId,
    ]
  );
  const saved = await getReadingRow(meterId, periodCode, input.readingType, executor);
  if (!saved) throw new Error("Reading was saved but could not be reloaded");
  const reading = toReading(saved);

  let reconciliation = false;
  if (input.readingType === "actual") {
    const estimatedRow = await getReadingRow(meterId, periodCode, "estimated", executor);
    if (estimatedRow && String(estimatedRow.reconciliation_status) !== "reconciled") {
      const estimatedAmount = Number(estimatedRow.amount);
      const actualAmount = reading.amount;
      await executor.execute(
        `INSERT INTO finance_meter_reconciliation
          (id, meter_id, period_code, estimated_reading_id, actual_reading_id,
           estimated_amount, actual_amount, adjustment_amount, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          randomUUID(),
          meterId,
          periodCode,
          String(estimatedRow.id),
          reading.id,
          estimatedAmount,
          actualAmount,
          Math.round((actualAmount - estimatedAmount) * 100) / 100,
          actorUserId,
        ]
      );
      await executor.execute(
        `UPDATE finance_meter_reading SET reconciliation_status = 'reconciled' WHERE id = ?`,
        [String(estimatedRow.id)]
      );
      reconciliation = true;
    }
  }

  return { reading, reconciliation };
}

/**
 * Sums consumption/amount across a cost centre's active meters for a period, preferring each
 * meter's actual reading over its estimated one when both exist (actual is authoritative once
 * available). Returns null (not zero) when the cost centre has meters but none have any reading
 * for the period yet — callers must treat that as missing data, not a zero pool, matching the
 * "do not silently allocate" principle already established for the other sharing methods.
 */
export type MeterUtilityType = "electricity" | "diesel" | "water" | "gas" | "other";
export type MeterShareRule = "fixed_pct" | "headcount" | "seats" | "floor_area" | "sub_meter_remainder";

type Usage = { consumption: number; amount: number };
const addUsage = (map: Map<string, Usage>, ccId: string, consumption: number, amount: number) => {
  const cur = map.get(ccId) ?? { consumption: 0, amount: 0 };
  cur.consumption += consumption;
  cur.amount += amount;
  map.set(ccId, cur);
};
const roundUsage = (u: Usage): Usage => ({
  consumption: Math.round(u.consumption * 10000) / 10000,
  amount: Math.round(u.amount * 100) / 100,
});

/** Last day of a YYYY-MM period, for resolving effective-dated meter shares as at that month. */
function periodEndDate(periodCode: string): string {
  const [y, m] = periodCode.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Every cost centre's metered consumption for a branch and period, keyed by cost centre id.
 *
 * A shared meter is not owned by any one cost centre, so it cannot be found by querying
 * `WHERE cost_centre_id = ?`. This resolves the whole branch at once:
 *
 *  - a dedicated meter (also any legacy row, where meter_type defaults to 'dedicated') gives all
 *    of its consumption to its own cost centre, exactly as before migration 434;
 *  - a sub-meter charges its own cost centre with its actual reading;
 *  - a shared meter shares only what its sub-meters did not already account for — its own reading
 *    minus the sum of its sub-meters' readings — divided by its share_rule. Money follows the
 *    same proportion as the units, so a partially sub-metered main meter cannot double-charge.
 *
 * `utilityType` matters: without it, an electricity line would be apportioned by kWh plus litres
 * plus KL added together, which is not a quantity.
 */
export async function getBranchMeterConsumption(
  branchId: string,
  periodCode: string,
  executor: Executor = db,
  utilityType?: MeterUtilityType
): Promise<Map<string, Usage>> {
  const params: unknown[] = [branchId];
  let utilityFilter = "";
  if (utilityType) { utilityFilter = " AND utility_type = ?"; params.push(utilityType); }

  const [meterRows] = await executor.execute<RowDataPacket[]>(
    `SELECT id, cost_centre_id, meter_type, utility_type, parent_meter_id, share_rule
       FROM finance_meter_master
      WHERE branch_id = ? AND active_status = 1
        AND (effective_to IS NULL OR effective_to >= CURDATE())${utilityFilter}`,
    params
  );
  if (meterRows.length === 0) return new Map();

  // Reading per meter: an actual always beats an estimate for the same month.
  const usageByMeter = new Map<string, Usage>();
  for (const row of meterRows) {
    const meterId = String(row.id);
    const actual = await getReadingRow(meterId, periodCode, "actual", executor);
    const chosen = actual ?? (await getReadingRow(meterId, periodCode, "estimated", executor));
    if (!chosen) continue;
    usageByMeter.set(meterId, {
      consumption: Number(chosen.consumption),
      amount: Number(chosen.amount),
    });
  }
  if (usageByMeter.size === 0) return new Map();

  const subsByParent = new Map<string, RowDataPacket[]>();
  for (const row of meterRows) {
    if (!row.parent_meter_id) continue;
    const key = String(row.parent_meter_id);
    subsByParent.set(key, [...(subsByParent.get(key) ?? []), row]);
  }

  const out = new Map<string, Usage>();
  for (const row of meterRows) {
    const meterId = String(row.id);
    const usage = usageByMeter.get(meterId);
    if (!usage) continue;
    const owner = String(row.cost_centre_id);
    const shared = String(row.meter_type ?? "dedicated") === "shared";

    if (!shared) { addUsage(out, owner, usage.consumption, usage.amount); continue; }

    // Only the part no sub-meter has already claimed is shareable.
    const subs = subsByParent.get(meterId) ?? [];
    const subConsumption = subs.reduce((a, s) => a + (usageByMeter.get(String(s.id))?.consumption ?? 0), 0);
    const shareable = Math.max(0, usage.consumption - subConsumption);
    if (shareable <= 0) continue;
    const amountRatio = usage.consumption > 0 ? shareable / usage.consumption : 0;
    const shareableAmount = usage.amount * amountRatio;

    const weights = await shareWeights(
      row, subs, branchId, periodCode, executor
    );
    const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) {
      // Nothing to apportion by — attribute to the owning cost centre rather than lose the cost.
      addUsage(out, owner, shareable, shareableAmount);
      continue;
    }
    for (const [ccId, w] of weights) {
      if (w <= 0) continue;
      addUsage(out, ccId, shareable * (w / totalWeight), shareableAmount * (w / totalWeight));
    }
  }

  const rounded = new Map<string, Usage>();
  out.forEach((u, k) => rounded.set(k, roundUsage(u)));
  return rounded;
}

/** How one shared meter divides, per its share_rule. */
async function shareWeights(
  meter: RowDataPacket,
  subs: RowDataPacket[],
  branchId: string,
  periodCode: string,
  executor: Executor
): Promise<Map<string, number>> {
  const rule = (meter.share_rule ?? "headcount") as MeterShareRule;
  const weights = new Map<string, number>();

  if (rule === "fixed_pct") {
    const [shares] = await executor.execute<RowDataPacket[]>(
      `SELECT cost_centre_id, share_pct
         FROM finance_meter_cost_centre_share
        WHERE meter_id = ?
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)`,
      [String(meter.id), periodEndDate(periodCode), periodEndDate(periodCode)]
    );
    shares.forEach((s) => weights.set(String(s.cost_centre_id), Number(s.share_pct)));
    return weights;
  }

  // Driver-based rules read finance_cost_centre_monthly_driver directly rather than going through
  // branch-budget-allocation.service, which already imports this module — routing through it would
  // create an import cycle.
  const column = rule === "seats" ? "seat_count" : rule === "floor_area" ? "floor_area_sqft" : "planned_headcount";
  const [drivers] = await executor.execute<RowDataPacket[]>(
    `SELECT cost_centre_id, ${column} AS weight
       FROM finance_cost_centre_monthly_driver
      WHERE branch_id = ? AND period_code = ?`,
    [branchId, periodCode]
  );

  // sub_meter_remainder: the leftover belongs to the cost centres that are NOT separately metered.
  const metered = new Set(subs.map((s) => String(s.cost_centre_id)));
  drivers.forEach((d) => {
    const ccId = String(d.cost_centre_id);
    if (rule === "sub_meter_remainder" && metered.has(ccId)) return;
    weights.set(ccId, Number(d.weight ?? 0));
  });
  return weights;
}

/**
 * One cost centre's metered consumption. Kept for callers that ask per cost centre
 * (budget-readiness). Returns null when the cost centre has no metered usage at all, so callers
 * can tell "no data" from a genuine zero — deliberately not 0.
 */
export async function getCostCentreMeterConsumption(
  costCentreId: string,
  periodCode: string,
  executor: Executor = db,
  utilityType?: MeterUtilityType
): Promise<Usage | null> {
  const [own] = await executor.execute<RowDataPacket[]>(
    `SELECT branch_id FROM finance_meter_master WHERE cost_centre_id = ? LIMIT 1`,
    [costCentreId]
  );
  // Without a meter of its own the cost centre may still hold a share of a shared meter, so fall
  // back to its branch via the cost-centre master.
  let branchId = own[0]?.branch_id ? String(own[0].branch_id) : null;
  if (!branchId) {
    const [cc] = await executor.execute<RowDataPacket[]>(
      `SELECT branch_id FROM cost_centre_master WHERE id = ? LIMIT 1`,
      [costCentreId]
    );
    branchId = cc[0]?.branch_id ? String(cc[0].branch_id) : null;
  }
  if (!branchId) return null;

  const byCostCentre = await getBranchMeterConsumption(branchId, periodCode, executor, utilityType);
  return byCostCentre.get(costCentreId) ?? null;
}

export const meterService = {
  listMeters,
  createMeter,
  getMeterBranchId,
  listReadings,
  saveReading,
  getCostCentreMeterConsumption,
  getBranchMeterConsumption,
};
