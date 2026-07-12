import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importDesignationMasterBatch(
  batchId: string,
  importedByUserId: string
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId]
  );

  let importedRows = 0;
  let errorRows = 0;
  const errors: string[] = [];

  for (const row of batchRows) {
    try {
      const data =
        typeof row.normalized_data === "string"
          ? JSON.parse(row.normalized_data)
          : (row.normalized_data ?? {});

      const designationCode = String(data.designation_code ?? "").trim();
      const designationName = String(data.designation_name ?? "").trim();

      if (!designationCode || !designationName) {
        throw new Error(
          `Row ${row.row_no}: designation_code and designation_name are required`
        );
      }

      const grade = data.grade ? String(data.grade).trim() : null;
      const level = data.level ? String(data.level).trim() : null;

      await db.execute(
        `INSERT INTO designation_master (designation_code, designation_name, grade, level, active_status)
         VALUES (?,?,?,?,1)
         ON DUPLICATE KEY UPDATE
           designation_name = VALUES(designation_name),
           grade = COALESCE(VALUES(grade), grade),
           level = COALESCE(VALUES(level), level)`,
        [designationCode, designationName, grade, level]
      );

      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'imported' WHERE id = ?`,
        [row.id]
      );
      importedRows++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_message = ? WHERE id = ?`,
        [msg.slice(0, 500), row.id]
      );
      errorRows++;
    }
  }

  const finalStatus =
    errorRows === 0
      ? "imported"
      : importedRows === 0
      ? "validation_failed"
      : "imported_with_errors";

  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId]
  );

  return { importedRows, errorRows, errors };
}
