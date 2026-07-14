import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

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

    // Resolve employee
    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM employees WHERE employee_code = ? AND employment_status = 'active' LIMIT 1",
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
    const employeeId = (empRows as RowDataPacket[])[0].id as string;

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

    const [cycleRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM wfm_roster_cycle
       WHERE cycle_start_date = ? AND cycle_end_date = ?
       LIMIT 1`,
      [weekStartStr, weekEndStr]
    );
    let cycleId: string;
    if ((cycleRows as RowDataPacket[]).length) {
      cycleId = (cycleRows as RowDataPacket[])[0].id as string;
    } else {
      cycleId = randomUUID();
      await db.execute(
        `INSERT INTO wfm_roster_cycle
           (id, cycle_name, cycle_start_date, cycle_end_date, cycle_status, created_by)
         VALUES (?, ?, ?, ?, 'draft', ?)`,
        [cycleId, `Week ${weekStartStr}`, weekStartStr, weekEndStr, userId]
      );
    }

    // Insert one assignment per day
    let dayImported = 0;
    const rowErrors: string[] = [];
    for (let i = 0; i < DAYS.length; i++) {
      const dayKey = `${DAYS[i]}_shift`;
      const shiftCode = (raw[dayKey] || "").trim().toUpperCase();
      if (!shiftCode) continue;

      const rosterDate = new Date(startDate);
      rosterDate.setDate(rosterDate.getDate() + i);
      const rosterDateStr = rosterDate.toISOString().slice(0, 10);

      const isWeekOff = shiftCode === "WO" || shiftCode === "WEEKOFF" || shiftCode === "OFF";
      let shiftTemplateId: string | null = null;

      if (!isWeekOff) {
        const [shiftRows] = await db.execute<RowDataPacket[]>(
          "SELECT id FROM wfm_shift_template WHERE shift_code = ? AND active_status = 1 LIMIT 1",
          [shiftCode]
        );
        if (!(shiftRows as RowDataPacket[]).length) {
          rowErrors.push(`${DAYS[i].toUpperCase()} shift_code '${shiftCode}' not found`);
          continue;
        }
        shiftTemplateId = (shiftRows as RowDataPacket[])[0].id as string;
      }

      await db.execute(
        `INSERT INTO wfm_roster_assignment
           (id, cycle_id, employee_id, roster_date, shift_template_id, is_week_off,
            roster_status, publish_status, decision_source, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 'published', 'published', 'bulk_upload', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           shift_template_id = VALUES(shift_template_id),
           is_week_off = VALUES(is_week_off),
           decision_source = 'bulk_upload',
           notes = VALUES(notes),
           updated_by = VALUES(updated_by)`,
        [randomUUID(), cycleId, employeeId, rosterDateStr, shiftTemplateId,
         isWeekOff ? 1 : 0, notes ?? null, userId, userId]
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
