import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export async function importRosterAssignmentBatch(
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

    const { cycle_id, employee_code, roster_date, shift_code, is_week_off, notes } = raw;

    if (!cycle_id || !employee_code || !roster_date) {
      const msg = `Row ${batchRow.row_no}: missing cycle_id, employee_code or roster_date`;
      errors.push(msg);
      await db.execute(
        "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
        [JSON.stringify([msg]), batchRow.id]
      );
      skipped++;
      continue;
    }

    // Resolve employee_id from code
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

    // Resolve shift_template_id from code (if not week-off)
    let shiftTemplateId: string | null = null;
    const isWeekOff = is_week_off === "1" || is_week_off === "true";
    if (!isWeekOff && shift_code) {
      const [shiftRows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM wfm_shift_template WHERE shift_code = ? AND active_status = 1 LIMIT 1",
        [shift_code]
      );
      if (!(shiftRows as RowDataPacket[]).length) {
        const msg = `Row ${batchRow.row_no}: shift_code '${shift_code}' not found`;
        errors.push(msg);
        await db.execute(
          "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
          [JSON.stringify([msg]), batchRow.id]
        );
        skipped++;
        continue;
      }
      shiftTemplateId = (shiftRows as RowDataPacket[])[0].id as string;
    }

    const assignmentId = randomUUID();
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
      [assignmentId, cycle_id, employeeId, roster_date, shiftTemplateId,
       isWeekOff ? 1 : 0, notes ?? null, userId, userId]
    );

    await db.execute(
      "UPDATE upload_batch_row SET row_status='imported', target_record_id=? WHERE id=?",
      [assignmentId, batchRow.id]
    );
    imported++;
  }

  await db.execute(
    `UPDATE upload_batch SET batch_status=?, imported_rows=?, imported_by=?, imported_at=NOW()
     WHERE id=?`,
    [errors.length > 0 ? "imported_with_errors" : "imported", imported, userId, batchId]
  );

  return { imported, skipped, errors };
}
