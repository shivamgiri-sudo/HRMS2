import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const VALID_TYPES = new Set(["frozen", "weekly", "daily", "rotating"]);

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: unknown;
}

interface UpdateResultRow extends RowDataPacket {
  affectedRows: number;
}

export async function importShiftRotationTypeBatch(
  batchId: string,
  userId: string
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no ASC",
    [batchId]
  );

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const batchRow of batchRows) {
    const raw = (typeof batchRow.normalized_data === "string"
      ? JSON.parse(batchRow.normalized_data)
      : batchRow.normalized_data) as Record<string, string>;

    const { employee_code, shift_rotation_type } = raw;

    if (!employee_code || !shift_rotation_type) {
      const msg = `Row ${batchRow.row_no}: missing employee_code or shift_rotation_type`;
      errors.push(msg);
      await db.execute(
        "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
        [JSON.stringify([msg]), batchRow.id]
      );
      skipped++;
      continue;
    }

    if (!VALID_TYPES.has(shift_rotation_type.toLowerCase())) {
      const msg = `Row ${batchRow.row_no}: invalid shift_rotation_type '${shift_rotation_type}' — must be frozen/weekly/daily/rotating`;
      errors.push(msg);
      await db.execute(
        "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
        [JSON.stringify([msg]), batchRow.id]
      );
      skipped++;
      continue;
    }

    const [result] = await db.execute<UpdateResultRow[]>(
      "UPDATE employees SET shift_rotation_type = ?, updated_by = ? WHERE employee_code = ? AND employment_status = 'active'",
      [shift_rotation_type.toLowerCase(), userId, employee_code]
    );
    const affected = result[0]?.affectedRows ?? 0;
    if (affected === 0) {
      const msg = `Row ${batchRow.row_no}: employee_code '${employee_code}' not found or inactive`;
      errors.push(msg);
      await db.execute(
        "UPDATE upload_batch_row SET row_status='error', error_messages=? WHERE id=?",
        [JSON.stringify([msg]), batchRow.id]
      );
      skipped++;
      continue;
    }

    await db.execute(
      "UPDATE upload_batch_row SET row_status='imported' WHERE id=?",
      [batchRow.id]
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
