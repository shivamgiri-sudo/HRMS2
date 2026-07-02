import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, "0": 0,
  monday: 1, mon: 1, "1": 1,
  tuesday: 2, tue: 2, "2": 2,
  wednesday: 3, wed: 3, "3": 3,
  thursday: 4, thu: 4, "4": 4,
  friday: 5, fri: 5, "5": 5,
  saturday: 6, sat: 6, "6": 6,
};

function parseDay(val: string | undefined): number | null {
  if (val === undefined || val === null || val.trim() === "") return null;
  const n = DAY_NAMES[val.trim().toLowerCase()];
  return n !== undefined ? n : null;
}

export async function importWeekOffPreferenceBatch(
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

    const { employee_code, week_start_date, preferred_day_1, preferred_day_2, reason } = raw;

    if (!employee_code || !week_start_date || preferred_day_1 === undefined) {
      const msg = `Row ${batchRow.row_no}: missing employee_code, week_start_date or preferred_day_1`;
      errors.push(msg);
      await db.execute(
        "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
        [JSON.stringify([msg]), batchRow.id]
      );
      skipped++;
      continue;
    }

    const day1 = parseDay(preferred_day_1);
    if (day1 === null) {
      const msg = `Row ${batchRow.row_no}: invalid preferred_day_1 '${preferred_day_1}'`;
      errors.push(msg);
      await db.execute(
        "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
        [JSON.stringify([msg]), batchRow.id]
      );
      skipped++;
      continue;
    }

    const day2 = parseDay(preferred_day_2) ?? null;

    // Resolve employee
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
    const emp = (empRows as RowDataPacket[])[0];

    // Get next submission_order for this process/week
    const [seqRows] = await db.execute<RowDataPacket[]>(
      "SELECT COALESCE(MAX(submission_order),0)+1 AS next_order FROM week_off_preference WHERE week_start_date=? AND process_id=?",
      [week_start_date, emp.process_id]
    );
    const submissionOrder = (seqRows as RowDataPacket[])[0]?.next_order ?? 1;

    const prefId = randomUUID();
    await db.execute(
      `INSERT INTO week_off_preference
         (id, employee_id, process_id, branch_id, week_start_date,
          preferred_day_1, preferred_day_2, reason, status, submission_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
       ON DUPLICATE KEY UPDATE
         preferred_day_1 = VALUES(preferred_day_1),
         preferred_day_2 = VALUES(preferred_day_2),
         reason = VALUES(reason),
         status = 'submitted'`,
      [prefId, emp.id, emp.process_id, emp.branch_id, week_start_date,
       day1, day2, reason ?? null, submissionOrder, userId]
    );

    await db.execute(
      "UPDATE upload_batch_row SET row_status='imported', target_record_id=? WHERE id=?",
      [prefId, batchRow.id]
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
