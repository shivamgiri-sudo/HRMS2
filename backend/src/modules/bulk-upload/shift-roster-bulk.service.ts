import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { logRosterChange } from "../roster/roster-change-log.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * Parse timing strings like:
 *   09:00am-06:00pm   09:00AM-06:00PM
 *   09:00-18:00       21:00-06:00
 *   09:00pm-06:00am
 * Returns { startTime: "HH:MM:SS", endTime: "HH:MM:SS" } or null if unparseable.
 */
function parseShiftTiming(raw: string): { startTime: string; endTime: string } | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  const match = s.match(/^(\d{1,2}:\d{2}(?:am|pm)?)-(\d{1,2}:\d{2}(?:am|pm)?)$/);
  if (!match) return null;

  const to24 = (t: string): string | null => {
    const m = t.match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2];
    const suffix = m[3];
    if (suffix === "pm" && h !== 12) h += 12;
    if (suffix === "am" && h === 12) h = 0;
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2, "0")}:${min}:00`;
  };

  const startTime = to24(match[1]);
  const endTime = to24(match[2]);
  if (!startTime || !endTime) return null;
  return { startTime, endTime };
}

type Conn = {
  execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
};

/**
 * Find existing shift template by start+end time, or auto-create one.
 */
async function resolveShiftTemplate(
  conn: Conn,
  startTime: string,
  endTime: string,
  rawCell: string,
  userId: string
): Promise<string> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    "SELECT id FROM wfm_shift_template WHERE start_time = ? AND end_time = ? AND active_status = 1 LIMIT 1",
    [startTime, endTime]
  );
  if ((rows as RowDataPacket[]).length) {
    return (rows as RowDataPacket[])[0].id as string;
  }

  // Auto-create a shift template keyed by timing string
  const shiftCode = rawCell.trim().toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9:apm-]/g, "")
    .slice(0, 50);

  // Check if shift_code already exists (different start/end — shouldn't happen but guard it)
  const [codeRows] = await conn.execute<RowDataPacket[]>(
    "SELECT id FROM wfm_shift_template WHERE shift_code = ? AND active_status = 1 LIMIT 1",
    [shiftCode]
  );
  if ((codeRows as RowDataPacket[]).length) {
    return (codeRows as RowDataPacket[])[0].id as string;
  }

  // Determine if night shift (end_time < start_time)
  const nightShift = endTime < startTime ? 1 : 0;

  const id = randomUUID();
  await conn.execute(
    `INSERT INTO wfm_shift_template
       (id, shift_code, shift_name, start_time, end_time, night_shift,
        productive_minutes, grace_minutes, break_entitlement, effective_from, active_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 480, 5, 30, CURDATE(), 1, ?)`,
    [id, shiftCode, `Shift ${startTime.slice(0, 5)}-${endTime.slice(0, 5)}`, startTime, endTime, nightShift, userId]
  );
  return id;
}

export async function importShiftRosterBatch(
  batchId: string,
  userId: string
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  // Same transaction rationale as roster-assignment-bulk.service.ts: every write below
  // used to autocommit independently, so a mid-run crash left an arbitrary subset of
  // this batch's rows in wfm_roster_assignment while upload_batch never got marked
  // imported. Row-level validation failures still just record and continue — only an
  // unexpected throw rolls the whole batch back.
  const conn = await db.getConnection();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    await conn.beginTransaction();

    const [batchRows] = await conn.execute<RowDataPacket[]>(
      "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no ASC",
      [batchId]
    );

    // Collect all assignments for batch insert
    const allAssignments: {
      id: string; cycle_id: string; employee_id: string; roster_date: string;
      shift_template_id: string | null; is_week_off: number; system_decision_reason: string | null;
    }[] = [];
    const rowStatusUpdates: { id: string; status: string; errors?: string[]; targetRecordIds: string[] }[] = [];

    for (const batchRow of batchRows as RowDataPacket[]) {
      const raw = (typeof batchRow.normalized_data === "string"
        ? JSON.parse(batchRow.normalized_data)
        : batchRow.normalized_data) as Record<string, string>;

      const { employee_code, week_start_date, notes } = raw;

      if (!employee_code || !week_start_date) {
        const msg = `Row ${batchRow.row_no}: employee_code and week_start_date are required`;
        errors.push(msg);
        await conn.execute(
          "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
          [JSON.stringify([msg]), batchRow.id]
        );
        skipped++;
        continue;
      }

      // Resolve employee and get process_id/branch_id for cycle
      const [empRows] = await conn.execute<RowDataPacket[]>(
        "SELECT id, process_id, branch_id FROM employees WHERE employee_code = ? AND employment_status = 'active' LIMIT 1",
        [employee_code]
      );
      if (!(empRows as RowDataPacket[]).length) {
        const msg = `Row ${batchRow.row_no}: employee_code '${employee_code}' not found or inactive`;
        errors.push(msg);
        await conn.execute(
          "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
          [JSON.stringify([msg]), batchRow.id]
        );
        skipped++;
        continue;
      }
      const employee = (empRows as RowDataPacket[])[0];
      const employeeId = employee.id as string;
      const employeeProcessId = employee.process_id as string | null;
      const employeeBranchId = employee.branch_id as string | null;

      // Validate employee has process_id (required for weekly_roster_cycle)
      if (!employeeProcessId) {
        const msg = `Row ${batchRow.row_no}: employee '${employee_code}' has no process_id assigned`;
        errors.push(msg);
        await conn.execute(
          "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
          [JSON.stringify([msg]), batchRow.id]
        );
        skipped++;
        continue;
      }

      // Parse week_start_date — accept YYYY-MM-DD or DD-MM-YYYY
      let startDate: Date;
      if (/^\d{2}-\d{2}-\d{4}$/.test(week_start_date)) {
        const [d, m, y] = week_start_date.split("-");
        startDate = new Date(`${y}-${m}-${d}`);
      } else {
        startDate = new Date(week_start_date);
      }
      if (isNaN(startDate.getTime())) {
        const msg = `Row ${batchRow.row_no}: invalid week_start_date '${week_start_date}' (use YYYY-MM-DD or DD-MM-YYYY)`;
        errors.push(msg);
        await conn.execute(
          "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
          [JSON.stringify([msg]), batchRow.id]
        );
        skipped++;
        continue;
      }

      // Find or create roster cycle for this week
      const weekEnd = new Date(startDate);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const weekStartStr = startDate.toISOString().slice(0, 10);
      const weekEndStr = weekEnd.toISOString().slice(0, 10);

      // Find or create weekly roster cycle for this employee's process
      const [cycleRows] = await conn.execute<RowDataPacket[]>(
        "SELECT id FROM weekly_roster_cycle WHERE week_start_date = ? AND week_end_date = ? AND process_id = ? LIMIT 1",
        [weekStartStr, weekEndStr, employeeProcessId]
      );
      let cycleId: string;
      if ((cycleRows as RowDataPacket[]).length) {
        cycleId = (cycleRows as RowDataPacket[])[0].id as string;
      } else {
        cycleId = randomUUID();
        await conn.execute(
          `INSERT INTO weekly_roster_cycle
             (id, week_start_date, week_end_date, status, created_by, process_id, branch_id)
           VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
          [cycleId, weekStartStr, weekEndStr, userId, employeeProcessId, employeeBranchId]
        );
      }

      // Process each day - collect assignments for batch insert
      let dayImported = 0;
      const rowErrors: string[] = [];
      const rowAssignmentIds: string[] = [];

      for (let i = 0; i < DAYS.length; i++) {
        const dayKey = `${DAYS[i]}_shift`;
        const cellValue = (raw[dayKey] || "").trim();
        if (!cellValue) continue;

        const upper = cellValue.toUpperCase();
        const isWeekOff = upper === "WO" || upper === "WEEKOFF" || upper === "OFF" || upper === "W/O";

        const rosterDate = new Date(startDate);
        rosterDate.setDate(rosterDate.getDate() + i);
        const rosterDateStr = rosterDate.toISOString().slice(0, 10);

        let shiftTemplateId: string | null = null;

        if (!isWeekOff) {
          const parsed = parseShiftTiming(cellValue);
          if (!parsed) {
            rowErrors.push(`${DAYS[i].toUpperCase()}: '${cellValue}' is not a valid timing (use 09:00am-06:00pm or 09:00-18:00) or WO`);
            continue;
          }
          try {
            shiftTemplateId = await resolveShiftTemplate(conn, parsed.startTime, parsed.endTime, cellValue, userId);
          } catch (e) {
            rowErrors.push(`${DAYS[i].toUpperCase()}: failed to resolve shift template — ${(e as Error).message}`);
            continue;
          }
        }

        // Collect assignment for batch insert
        const assignmentId = randomUUID();
        allAssignments.push({
          id: assignmentId,
          cycle_id: cycleId,
          employee_id: employeeId,
          roster_date: rosterDateStr,
          shift_template_id: shiftTemplateId,
          is_week_off: isWeekOff ? 1 : 0,
          system_decision_reason: notes ?? null
        });
        rowAssignmentIds.push(assignmentId);
        dayImported++;
      }

      if (rowErrors.length > 0) {
        errors.push(`Row ${batchRow.row_no} (${employee_code}): ${rowErrors.join("; ")}`);
        rowStatusUpdates.push({ id: batchRow.id, status: 'error', errors: rowErrors, targetRecordIds: [] });
        skipped++;
      } else {
        rowStatusUpdates.push({ id: batchRow.id, status: 'imported', targetRecordIds: rowAssignmentIds });
        imported += dayImported > 0 ? 1 : 0;
      }
    }

    // Batch insert all assignments — parameterized rather than the previous manual
    // string-concatenation + single-quote-doubling escape, which was an incomplete
    // defense against injection through the uploaded CSV's free-text notes field.
    //
    // Before the overwrite: capture what each (employee, date) pair currently holds,
    // so a same employee+date re-upload leaves a trace in roster_change_log instead
    // of silently replacing the prior shift with no record of what it used to be.
    const before = new Map<string, { id: string; shift_template_id: string | null; is_week_off: number }>();
    if (allAssignments.length > 0) {
      const pairPlaceholders = allAssignments.map(() => "(?,?)").join(",");
      const pairParams = allAssignments.flatMap((a) => [a.employee_id, a.roster_date]);
      const [existingRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, employee_id, roster_date, shift_template_id, is_week_off
           FROM wfm_roster_assignment
          WHERE (employee_id, roster_date) IN (${pairPlaceholders})`,
        pairParams,
      );
      for (const row of existingRows as RowDataPacket[]) {
        before.set(`${row.employee_id}|${String(row.roster_date).slice(0, 10)}`, {
          id: row.id as string,
          shift_template_id: row.shift_template_id as string | null,
          is_week_off: Number(row.is_week_off),
        });
      }

      const placeholders = allAssignments.map(() => "(?,?,?,?,?,?,'published','published','bulk_upload',?)").join(",");
      const params = allAssignments.flatMap((a) => [
        a.id, a.cycle_id, a.employee_id, a.roster_date, a.shift_template_id, a.is_week_off, a.system_decision_reason,
      ]);
      await conn.execute(
        `INSERT INTO wfm_roster_assignment
           (id, cycle_id, employee_id, roster_date, shift_template_id, is_week_off,
            roster_status, publish_status, decision_source, system_decision_reason)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           shift_template_id = VALUES(shift_template_id),
           is_week_off = VALUES(is_week_off),
           decision_source = 'bulk_upload',
           system_decision_reason = VALUES(system_decision_reason),
           updated_at = CURRENT_TIMESTAMP`,
        params,
      );

      for (const a of allAssignments) {
        const prior = before.get(`${a.employee_id}|${a.roster_date}`);
        if (prior && (prior.shift_template_id !== a.shift_template_id || Boolean(prior.is_week_off) !== Boolean(a.is_week_off))) {
          await logRosterChange(conn, {
            entityType: "wfm_roster_assignment",
            entityId: prior.id,
            changedBy: userId,
            reason: `Bulk shift-roster upload (batch ${batchId})`,
            cycleId: a.cycle_id,
            oldValue: { shift_template_id: prior.shift_template_id, is_week_off: Boolean(prior.is_week_off) },
            newValue: { shift_template_id: a.shift_template_id, is_week_off: Boolean(a.is_week_off) },
          });
        }
      }
    }

    // Batch update row statuses. target_record_id was previously never set here
    // (unlike roster-assignment-bulk.service.ts), so there was no way to trace a
    // specific wfm_roster_assignment row back to the batch/row that imported it —
    // a row can cover up to 7 assignments (one per day), so the first is recorded
    // as the representative link.
    for (const update of rowStatusUpdates) {
      if (update.status === 'error') {
        await conn.execute(
          "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
          [JSON.stringify(update.errors), update.id]
        );
      } else {
        await conn.execute(
          "UPDATE upload_batch_row SET row_status='imported', target_record_id=? WHERE id=?",
          [update.targetRecordIds[0] ?? null, update.id]
        );
      }
    }

    // imported_by and imported_at are added by migration 1134. They did not exist
    // when this statement was first written, which is why naming them meant a batch
    // was never marked imported at all - imported_rows stayed unset and
    // batch_status stayed at whatever it was before.
    await conn.execute(
      `UPDATE upload_batch SET batch_status=?, imported_rows=?, imported_by=?, imported_at=NOW(), updated_at=NOW()
       WHERE id=?`,
      [errors.length > 0 ? "imported_with_errors" : "imported", imported, userId ?? null, batchId]
    );

    await conn.commit();
    return { imported, skipped, errors };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
