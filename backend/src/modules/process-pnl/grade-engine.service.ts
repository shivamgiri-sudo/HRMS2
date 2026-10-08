import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// Structurally identical to the Executor interfaces used across this session's other
// process-pnl services — same dependency-injection pattern for testability.
interface Executor {
  execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

/**
 * Branch Budget foundation (PR 12): grade-wise headcount planning per cost centre/period,
 * feeding the "grade_weighted_headcount" branch-common sharing method. Reuses grade_band_master
 * (already real, populated, wired into payroll CTC banding) rather than modelling a new grade
 * concept for Finance. Blended cost uses grade_band_master's (min_ctc+max_ctc)/2 midpoint as a
 * transparent first approximation — not salary_package_master's more precise slab-level CTC,
 * which would require resolving a slab per employee/cost-centre (out of scope, documented).
 */

export interface GradeDriverRecord {
  gradeId: string;
  gradeName: string;
  band: string | null;
  minCtc: number;
  maxCtc: number;
  plannedHeadcount: number;
  monthlyCost: number;
  remarks: string | null;
  status: "draft" | "approved";
}

export interface SaveGradeDriverInput {
  gradeId: string;
  plannedHeadcount: number;
  remarks?: string | null;
}

function avgMonthlyCtc(minCtc: number, maxCtc: number): number {
  return Math.round(((minCtc + maxCtc) / 2 / 12) * 100) / 100;
}

export async function listGradeDrivers(
  costCentreId: string,
  periodCode: string,
  executor: Executor = db
): Promise<GradeDriverRecord[]> {
  const [gradeRows] = await executor.execute<RowDataPacket[]>(
    `SELECT id, grade_name, band, min_ctc, max_ctc FROM grade_band_master WHERE active_status = 1 ORDER BY grade_name`
  );
  const [driverRows] = await executor.execute<RowDataPacket[]>(
    `SELECT grade_id, planned_headcount, remarks, status
       FROM finance_cost_centre_grade_driver
      WHERE cost_centre_id = ? AND period_code = ?`,
    [costCentreId, periodCode]
  );
  const byGrade = new Map(driverRows.map((row) => [String(row.grade_id), row]));

  return gradeRows.map((grade) => {
    const driver = byGrade.get(String(grade.id));
    const minCtc = Number(grade.min_ctc);
    const maxCtc = Number(grade.max_ctc);
    const plannedHeadcount = Number(driver?.planned_headcount ?? 0);
    return {
      gradeId: String(grade.id),
      gradeName: String(grade.grade_name),
      band: grade.band ? String(grade.band) : null,
      minCtc,
      maxCtc,
      plannedHeadcount,
      monthlyCost: Math.round(plannedHeadcount * avgMonthlyCtc(minCtc, maxCtc) * 100) / 100,
      remarks: driver?.remarks ?? null,
      status: (driver?.status as "draft" | "approved") ?? "draft",
    };
  });
}

export async function saveGradeDrivers(
  branchId: string,
  costCentreId: string,
  periodCode: string,
  drivers: SaveGradeDriverInput[],
  actorUserId: string
): Promise<GradeDriverRecord[]> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) {
    throw new Error("A valid budget period (YYYY-MM) is required");
  }
  const [activeGrades] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM grade_band_master WHERE active_status = 1`
  );
  const activeGradeIds = new Set(activeGrades.map((row) => String(row.id)));
  for (const driver of drivers) {
    if (!activeGradeIds.has(driver.gradeId)) {
      throw new Error(`Grade ${driver.gradeId} is not an active grade band`);
    }
    if (!Number.isFinite(driver.plannedHeadcount) || driver.plannedHeadcount < 0) {
      throw new Error("Planned headcount cannot be negative");
    }
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const driver of drivers) {
      await connection.execute(
        `INSERT INTO finance_cost_centre_grade_driver
           (id, branch_id, cost_centre_id, period_code, grade_id, planned_headcount, remarks, status, updated_by)
         VALUES (?,?,?,?,?,?,?,'draft',?)
         ON DUPLICATE KEY UPDATE
           planned_headcount = VALUES(planned_headcount),
           remarks = VALUES(remarks),
           updated_by = VALUES(updated_by)`,
        [
          randomUUID(),
          branchId,
          costCentreId,
          periodCode,
          driver.gradeId,
          driver.plannedHeadcount,
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
  return listGradeDrivers(costCentreId, periodCode);
}

/**
 * Sums grade-weighted monthly cost across a cost centre's planned grades for a period. Returns
 * null (not zero) when the cost centre has no grade-driver rows for the period yet — callers
 * must treat that as missing data, not a zero pool, matching the "do not silently allocate"
 * principle already established for meter-wise/monthly-driver sharing methods.
 */
export async function getCostCentreGradeWeightedCost(
  costCentreId: string,
  periodCode: string,
  executor: Executor = db
): Promise<{ totalHeadcount: number; blendedMonthlyCost: number } | null> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT d.planned_headcount, g.min_ctc, g.max_ctc
       FROM finance_cost_centre_grade_driver d
       JOIN grade_band_master g ON g.id = d.grade_id
      WHERE d.cost_centre_id = ? AND d.period_code = ? AND d.planned_headcount > 0`,
    [costCentreId, periodCode]
  );
  if (rows.length === 0) return null;

  let totalHeadcount = 0;
  let blendedMonthlyCost = 0;
  for (const row of rows) {
    const headcount = Number(row.planned_headcount);
    totalHeadcount += headcount;
    blendedMonthlyCost += headcount * avgMonthlyCtc(Number(row.min_ctc), Number(row.max_ctc));
  }
  return {
    totalHeadcount: Math.round(totalHeadcount * 100) / 100,
    blendedMonthlyCost: Math.round(blendedMonthlyCost * 100) / 100,
  };
}

export const gradeEngineService = {
  listGradeDrivers,
  saveGradeDrivers,
  getCostCentreGradeWeightedCost,
};
