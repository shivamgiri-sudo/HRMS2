import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

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

/**
 * Find existing shift template by start+end time, or auto-create one.
 */
async function resolveShiftTemplate(
  startTime: string,
  endTime: string,
  rawCell: string,
  userId: string
): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
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
  const [codeRows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM wfm_shift_template WHERE shift_code = ? AND active_status = 1 LIMIT 1",
    [shiftCode]
  );
  if ((codeRows as RowDataPacket[]).length) {
    return (codeRows as RowDataPacket[])[0].id as string;
  }

  // Determine if night shift (end_time < start_time)
  const nightShift = endTime < startTime ? 1 : 0;

  const id = randomUUID();
  await db.execute(
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
  const [batchRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no ASC",
    [batchId]
  );

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const batchRow of batchRows as RowDataPacket[]) {
    const raw = (typeof batchRow.normalized_data === "string"
      ? JSON.parse(batchRow.normalized_data)
      : batchRow.normalized_data) as Record<string, string>;

    const { employee_code, week_start_date, notes } = raw;

    if (!employee_code || !week_start_date) {
      const msg = `Row ${batchRow.row_no}: employee_code and week_start_date are required`;
      errors.push(msg);
      await db.execute(
        "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
        [JSON.stringify([msg]), batchRow.id]
      );
      skipped++;
      continue;
    }

    // Resolve employee and get process_id/branch_id for cycle
    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, process_id, branch_id FROM employees WHERE employee_code = ? AND employment_status = 'active' LIMIT 1",
      [employee_code]
    );
    if (!(empRows as RowDataPacket[]).length) {
      const msg = `Row ${batchRow.row_no}: employee_code '${employee_code}' not found or inactive`;
      errors.push(msg);
      await db.execute(
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
      await db.execute(
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
      await db.execute(
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
    const [cycleRows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM weekly_roster_cycle WHERE week_start_date = ? AND week_end_date = ? AND process_id = ? LIMIT 1",
      [weekStartStr, weekEndStr, employeeProcessId]
    );
    let cycleId: string;
    if ((cycleRows as RowDataPacket[]).length) {
      cycleId = (cycleRows as RowDataPacket[])[0].id as string;
    } else {
      cycleId = randomUUID();
      await db.execute(
        `INSERT INTO weekly_roster_cycle
           (id, week_start_date, week_end_date, status, created_by, process_id, branch_id)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
        [cycleId, weekStartStr, weekEndStr, userId, employeeProcessId, employeeBranchId]
      );
    }

    // Process each day
    let dayImported = 0;
    const rowErrors: string[] = [];

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
          shiftTemplateId = await resolveShiftTemplate(parsed.startTime, parsed.endTime, cellValue, userId);
        } catch (e) {
          rowErrors.push(`${DAYS[i].toUpperCase()}: failed to resolve shift template — ${(e as Error).message}`);
          continue;
        }
      }

      await db.execute(
        `INSERT INTO wfm_roster_assignment
           (id, cycle_id, employee_id, roster_date, shift_template_id, is_week_off,
            roster_status, publish_status, decision_source, system_decision_reason)
         VALUES (?, ?, ?, ?, ?, ?, 'published', 'published', 'bulk_upload', ?)
         ON DUPLICATE KEY UPDATE
           shift_template_id = VALUES(shift_template_id),
           is_week_off = VALUES(is_week_off),
           decision_source = 'bulk_upload',
           system_decision_reason = VALUES(system_decision_reason),
           updated_at = CURRENT_TIMESTAMP`,
        [randomUUID(), cycleId, employeeId, rosterDateStr, shiftTemplateId,
         isWeekOff ? 1 : 0, notes ?? null]
      );
      dayImported++;
    }

    if (rowErrors.length > 0) {
      errors.push(`Row ${batchRow.row_no} (${employee_code}): ${rowErrors.join("; ")}`);
      await db.execute(
        "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
        [JSON.stringify(rowErrors), batchRow.id]
      );
      skipped++;
    } else {
      await db.execute(
        "UPDATE upload_batch_row SET row_status='imported', target_record_id=? WHERE id=?",
        [cycleId, batchRow.id]
      );
      imported += dayImported > 0 ? 1 : 0;
    }
  }

  await db.execute(
    `UPDATE upload_batch SET batch_status=?, imported_rows=?, imported_by=?, imported_at=NOW()
     WHERE id=?`,
    [errors.length > 0 ? "imported_with_errors" : "imported", imported, userId, batchId]
  );

  return { imported, skipped, errors };
}
