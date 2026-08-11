import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importLobMasterBatch(
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

      const lobCode = String(data.lob_code ?? "").trim();
      const lobName = String(data.lob_name ?? "").trim();

      if (!lobCode || !lobName) {
        throw new Error(`Row ${row.row_no}: lob_code and lob_name are required`);
      }

      const description = data.description ? String(data.description).trim() : null;

      await db.execute(
        `INSERT INTO lob_master (lob_code, lob_name, description, active_status)
         VALUES (?,?,?,1)
         ON DUPLICATE KEY UPDATE
           lob_name = VALUES(lob_name),
           description = COALESCE(VALUES(description), description)`,
        [lobCode, lobName, description]
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
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = ? WHERE id = ?`,
        // error_messages, plural, and it is a JSON column holding an array of
        // strings - the same shape reporting-manager-bulk and roster-assignment-bulk
        // already write. The column named here was error_message, which does not
        // exist, so this UPDATE raised ER_BAD_FIELD_ERROR. It sits inside the per-row
        // catch, so the failure of one row made the handler itself throw and took the
        // whole import down with an error about a column instead of recording why the
        // row failed.
        [JSON.stringify([msg.slice(0, 500)]), row.id]
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
