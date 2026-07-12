import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importDepartmentMasterBatch(
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

      const deptCode = String(data.dept_code ?? "").trim();
      const deptName = String(data.dept_name ?? "").trim();

      if (!deptCode || !deptName) {
        throw new Error(`Row ${row.row_no}: dept_code and dept_name are required`);
      }

      const costCentre = data.cost_centre ? String(data.cost_centre).trim() : null;
      const description = data.description ? String(data.description).trim() : null;

      await db.execute(
        `INSERT INTO department_master (dept_code, dept_name, cost_centre, description, active_status)
         VALUES (?,?,?,?,1)
         ON DUPLICATE KEY UPDATE
           dept_name = VALUES(dept_name),
           cost_centre = COALESCE(VALUES(cost_centre), cost_centre),
           description = COALESCE(VALUES(description), description)`,
        [deptCode, deptName, costCentre, description]
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
