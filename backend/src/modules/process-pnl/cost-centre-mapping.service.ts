import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// Structurally identical to the Executor interfaces in branch-budget-allocation.service.ts and
// meter.service.ts — same dependency-injection pattern for testability.
interface Executor {
  execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

/**
 * Branch Budget foundation (PR 8): effective-dated cost-centre -> branch/process mapping.
 * cost_centre_master.branch_id/process_id remain the "current mapping" columns (read by
 * listActiveCostCentres and everywhere else that wants today's state); this table is the audit
 * trail, kept in sync by recordMappingChange() whenever a change is recorded through this path.
 */

export interface CostCentreMappingRecord {
  id: string;
  costCentreId: string;
  branchId: string | null;
  processId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface RecordMappingChangeInput {
  branchId: string | null;
  processId: string | null;
  effectiveFrom: string;
  changeReason: string;
}

function toRecord(row: RowDataPacket): CostCentreMappingRecord {
  return {
    id: String(row.id),
    costCentreId: String(row.cost_centre_id),
    branchId: row.branch_id ? String(row.branch_id) : null,
    processId: row.process_id ? String(row.process_id) : null,
    effectiveFrom: String(row.effective_from),
    effectiveTo: row.effective_to ? String(row.effective_to) : null,
    changeReason: row.change_reason ?? null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
  };
}

export async function getMappingHistory(
  costCentreId: string,
  executor: Executor = db
): Promise<CostCentreMappingRecord[]> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT * FROM finance_cost_centre_mapping_history
      WHERE cost_centre_id = ?
      ORDER BY effective_from DESC`,
    [costCentreId]
  );
  return rows.map(toRecord);
}

/**
 * A cost centre's CURRENT branch, for the route-level branch guard.
 *
 * Reads cost_centre_master's own branch_id — today's state, which is what an access check must
 * be judged against — rather than the history table, where an as-of-date lookup could answer
 * with a branch the cost centre has since left. Returns null when the cost centre does not
 * exist or is unmapped; assertFinanceRecordBranch treats null as a denial, not as unrestricted.
 */
export async function getCostCentreBranchId(
  costCentreId: string,
  executor: Executor = db
): Promise<string | null> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT branch_id FROM cost_centre_master WHERE id = ? LIMIT 1`,
    [costCentreId]
  );
  return rows[0]?.branch_id ? String(rows[0].branch_id) : null;
}

/**
 * Resolves a cost centre's branch/process mapping as of a given date. Falls back to
 * cost_centre_master's own current columns when no history row matches — defensive only; the
 * PR 8 backfill migration seeds one open-ended row per existing cost centre, so this fallback
 * should not normally be exercised.
 */
export async function resolveCostCentreMapping(
  costCentreId: string,
  asOfDate: string,
  executor: Executor = db
): Promise<{ branchId: string | null; processId: string | null } | null> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id FROM finance_cost_centre_mapping_history
      WHERE cost_centre_id = ?
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY effective_from DESC
      LIMIT 1`,
    [costCentreId, asOfDate, asOfDate]
  );
  if (rows[0]) {
    return {
      branchId: rows[0].branch_id ? String(rows[0].branch_id) : null,
      processId: rows[0].process_id ? String(rows[0].process_id) : null,
    };
  }

  const [ccmRows] = await executor.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id FROM cost_centre_master WHERE id = ? LIMIT 1`,
    [costCentreId]
  );
  if (!ccmRows[0]) return null;
  return {
    branchId: ccmRows[0].branch_id ? String(ccmRows[0].branch_id) : null,
    processId: ccmRows[0].process_id ? String(ccmRows[0].process_id) : null,
  };
}

/**
 * Records a cost-centre branch/process reassignment effective from a given (present-or-future)
 * date: closes the currently open-ended history row and inserts the new one, then keeps
 * cost_centre_master's own branch_id/process_id columns in sync so every existing "current
 * mapping" reader keeps working unchanged. Forward-only by design — do not silently rewrite
 * already-reported history; a past effectiveFrom is rejected outright.
 */
export async function recordMappingChange(
  costCentreId: string,
  input: RecordMappingChangeInput,
  actorUserId: string
): Promise<CostCentreMappingRecord> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    throw new Error("A valid effective date (YYYY-MM-DD) is required");
  }
  if (!input.changeReason?.trim()) {
    throw new Error("A change reason is mandatory when reassigning a cost centre's branch/process mapping");
  }
  if (!input.branchId && !input.processId) {
    throw new Error("At least a branch or a process must be provided");
  }

  const [ccmRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id, go_live_date FROM cost_centre_master WHERE id = ? LIMIT 1`,
    [costCentreId]
  );
  if (!ccmRows[0]) throw new Error("Cost centre was not found");

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Forward-only guard, checked inside the transaction against the DB's own CURDATE() so a
    // long-running request can't race a stale application-clock check.
    const [dateCheck] = await connection.execute<RowDataPacket[]>(
      `SELECT (? < CURDATE()) AS is_past`,
      [input.effectiveFrom]
    );
    if (Number(dateCheck[0]?.is_past) === 1) {
      throw new Error("Effective date cannot be in the past — cost-centre mapping changes are forward-only and must not rewrite already-reported history");
    }

    const [openRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, effective_from FROM finance_cost_centre_mapping_history
        WHERE cost_centre_id = ? AND effective_to IS NULL
        ORDER BY effective_from DESC LIMIT 1`,
      [costCentreId]
    );
    const openRow = openRows[0];
    if (openRow && String(openRow.effective_from) >= input.effectiveFrom) {
      throw new Error("Effective date must be after the current mapping's effective date");
    }
    if (openRow) {
      await connection.execute(
        `UPDATE finance_cost_centre_mapping_history
            SET effective_to = DATE_SUB(?, INTERVAL 1 DAY)
          WHERE id = ?`,
        [input.effectiveFrom, String(openRow.id)]
      );
    } else {
      // No history row exists yet for this cost centre (e.g. it was created after the PR 8
      // backfill migration ran). Without this, resolveCostCentreMapping would have a gap for
      // every date before effectiveFrom and would incorrectly fall back to cost_centre_master —
      // which the UPDATE below is about to overwrite with the *new* mapping. Close out the
      // cost centre's actual original mapping as a historical row first, so "as of" queries for
      // any past-to-present date still see what was really assigned before this change.
      await connection.execute(
        `INSERT INTO finance_cost_centre_mapping_history
           (id, cost_centre_id, branch_id, process_id, effective_from, effective_to, change_reason, created_by)
         VALUES (?,?,?,?,?, DATE_SUB(?, INTERVAL 1 DAY), ?, ?)`,
        [
          randomUUID(),
          costCentreId,
          ccmRows[0].branch_id ?? null,
          ccmRows[0].process_id ?? null,
          ccmRows[0].go_live_date ?? "2000-01-01",
          input.effectiveFrom,
          "Backfilled retroactively — no prior mapping-history row existed before this change",
          null,
        ]
      );
    }

    const id = randomUUID();
    await connection.execute(
      `INSERT INTO finance_cost_centre_mapping_history
         (id, cost_centre_id, branch_id, process_id, effective_from, effective_to, change_reason, created_by)
       VALUES (?,?,?,?,?,NULL,?,?)`,
      [id, costCentreId, input.branchId, input.processId, input.effectiveFrom, input.changeReason.trim(), actorUserId]
    );

    await connection.execute(
      `UPDATE cost_centre_master
          SET branch_id = COALESCE(?, branch_id),
              process_id = COALESCE(?, process_id),
              updated_at = NOW()
        WHERE id = ?`,
      [input.branchId, input.processId, costCentreId]
    );

    await connection.commit();

    const [saved] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM finance_cost_centre_mapping_history WHERE id = ? LIMIT 1`,
      [id]
    );
    return toRecord(saved[0]);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const costCentreMappingService = {
  getMappingHistory,
  getCostCentreBranchId,
  resolveCostCentreMapping,
  recordMappingChange,
};
