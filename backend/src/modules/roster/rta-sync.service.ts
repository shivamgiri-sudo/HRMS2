import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyAssignmentRow extends RowDataPacket {
  employee_id: string;
  roster_date: string;
  shift_template_id: string | null;
  is_week_off: number;
  is_holiday: number;
  start_time: string | null;
  end_time: string | null;
  productive_minutes: number | null;
}

interface CycleRow extends RowDataPacket {
  id: string;
  process_id: string;
  branch_id: string | null;
  week_start_date: string;
  week_end_date: string;
  status: string;
}

export interface RtaSyncResult {
  sync_log_id: string;
  cycle_id: string;
  records_synced: number;
  records_updated: number;
  errors: string[];
}

// ── Service ───────────────────────────────────────────────────────────────────

export const rtaSyncService = {
  async syncCycleToRta(
    cycleId: string,
    syncType: "initial_publish" | "rerun" | "manual_resync",
    syncedBy: string,
    req?: Request
  ): Promise<RtaSyncResult> {
    // Load cycle
    const [cycleRows] = await db.execute<CycleRow[]>(
      "SELECT * FROM weekly_roster_cycle WHERE id = ? LIMIT 1",
      [cycleId]
    );
    const cycle = cycleRows[0];
    if (!cycle) throw Object.assign(new Error("Cycle not found"), { statusCode: 404 });

    // Only allow sync for published/acknowledged/active+ cycles
    const syncableStatuses = ["published", "acknowledged", "active", "variance_review", "attendance_locked", "payroll_input_ready", "closed"];
    if (!syncableStatuses.includes(cycle.status)) {
      throw Object.assign(new Error(`Cycle must be published before syncing to RTA (current: ${cycle.status})`), { statusCode: 409 });
    }

    const syncLogId = randomUUID();
    await db.execute(
      `INSERT INTO rta_roster_sync_log (id, cycle_id, sync_type, sync_status, synced_by)
       VALUES (?, ?, ?, 'running', ?)`,
      [syncLogId, cycleId, syncType, syncedBy]
    );

    const result: RtaSyncResult = {
      sync_log_id: syncLogId,
      cycle_id: cycleId,
      records_synced: 0,
      records_updated: 0,
      errors: [],
    };

    try {
      // Load all roster_daily_assignment rows for the cycle, joined with shift template times
      const [assignments] = await db.execute<DailyAssignmentRow[]>(
        `SELECT
           rda.employee_id,
           rda.roster_date,
           rda.shift_template_id,
           rda.is_week_off,
           rda.is_holiday,
           wst.start_time,
           wst.end_time,
           wst.productive_minutes
         FROM roster_daily_assignment rda
         LEFT JOIN wfm_shift_template wst ON wst.id = rda.shift_template_id
         WHERE rda.cycle_id = ?
         ORDER BY rda.roster_date ASC, rda.employee_id ASC`,
        [cycleId]
      );

      for (const row of assignments) {
        try {
          await upsertReconciliationRecord(row, cycleId, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`emp:${row.employee_id} date:${row.roster_date} — ${msg}`);
        }
      }

      await db.execute(
        `UPDATE rta_roster_sync_log SET
           sync_status = 'completed',
           records_synced = ?,
           records_updated = ?,
           completed_at = NOW()
         WHERE id = ?`,
        [result.records_synced, result.records_updated, syncLogId]
      );
    } catch (fatalErr) {
      const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
      await db.execute(
        "UPDATE rta_roster_sync_log SET sync_status = 'failed', error_details = ?, completed_at = NOW() WHERE id = ?",
        [JSON.stringify([msg]), syncLogId]
      );
      throw fatalErr;
    }

    await logSensitiveAction({
      actor_user_id: syncedBy,
      action_type: "RTA_ROSTER_SYNC",
      module_key: "rta",
      entity_type: "weekly_roster_cycle",
      entity_id: cycleId,
      change_summary: {
        sync_type: syncType,
        sync_log_id: syncLogId,
        records_synced: result.records_synced,
        records_updated: result.records_updated,
      },
      req,
    });

    return result;
  },

  async getSyncLogs(cycleId: string): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM rta_roster_sync_log WHERE cycle_id = ? ORDER BY started_at DESC",
      [cycleId]
    );
    return rows;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upsertReconciliationRecord(
  row: DailyAssignmentRow,
  cycleId: string,
  result: RtaSyncResult
): Promise<void> {
  // Determine attendance_status seed value
  let seedStatus: string;
  if (row.is_holiday) {
    seedStatus = "holiday";
  } else if (row.is_week_off) {
    seedStatus = "week_off";
  } else {
    seedStatus = "unreconciled";
  }

  // Convert HH:MM strings to TIME-safe values
  const plannedStart = row.start_time ? row.start_time.slice(0, 5) : null;
  const plannedEnd = row.end_time ? row.end_time.slice(0, 5) : null;

  // Use INSERT ... ON DUPLICATE KEY UPDATE but preserve actual attendance if already present
  // Logic: only update planned_* and status when actual_login_time IS NULL (not yet reconciled)
  await db.execute(
    `INSERT INTO attendance_reconciliation_record
       (id, employee_id, roster_date, roster_cycle_id,
        planned_shift_start, planned_shift_end, required_minutes,
        attendance_status)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       roster_cycle_id    = VALUES(roster_cycle_id),
       planned_shift_start = VALUES(planned_shift_start),
       planned_shift_end   = VALUES(planned_shift_end),
       required_minutes    = VALUES(required_minutes),
       attendance_status   = IF(actual_login_time IS NULL, VALUES(attendance_status), attendance_status)`,
    [
      row.employee_id,
      row.roster_date,
      cycleId,
      plannedStart,
      plannedEnd,
      row.productive_minutes ?? null,
      seedStatus,
    ]
  );

  result.records_synced++;
}
