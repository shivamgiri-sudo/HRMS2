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
export async function saveReading(
  meterId: string,
  periodCode: string,
  input: SaveReadingInput,
  actorUserId: string,
  executor: Executor = db
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
export async function getCostCentreMeterConsumption(
  costCentreId: string,
  periodCode: string,
  executor: Executor = db
): Promise<{ consumption: number; amount: number } | null> {
  const [meterRows] = await executor.execute<RowDataPacket[]>(
    `SELECT id FROM finance_meter_master
      WHERE cost_centre_id = ? AND active_status = 1
        AND (effective_to IS NULL OR effective_to >= CURDATE())`,
    [costCentreId]
  );
  if (meterRows.length === 0) return null;

  let consumption = 0;
  let amount = 0;
  let hasAnyReading = false;
  for (const meterRow of meterRows) {
    const meterId = String(meterRow.id);
    const actual = await getReadingRow(meterId, periodCode, "actual", executor);
    const chosen = actual ?? (await getReadingRow(meterId, periodCode, "estimated", executor));
    if (!chosen) continue;
    hasAnyReading = true;
    consumption += Number(chosen.consumption);
    amount += Number(chosen.amount);
  }
  if (!hasAnyReading) return null;
  return { consumption: Math.round(consumption * 10000) / 10000, amount: Math.round(amount * 100) / 100 };
}

export const meterService = {
  listMeters,
  createMeter,
  listReadings,
  saveReading,
  getCostCentreMeterConsumption,
};
