import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importBranchMasterBatch(
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

      const branchCode = String(data.branch_code ?? "").trim();
      const branchName = String(data.branch_name ?? "").trim();

      if (!branchCode || !branchName) {
        throw new Error(`Row ${row.row_no}: branch_code and branch_name are required`);
      }

      const city = data.city ? String(data.city).trim() : null;
      const state = data.state ? String(data.state).trim() : null;
      const address = data.address ? String(data.address).trim() : null;
      const pincode = data.pincode ? String(data.pincode).trim() : null;

      await db.execute(
        `INSERT INTO branch_master (branch_code, branch_name, city, state, address, pincode, active_status)
         VALUES (?,?,?,?,?,?,1)
         ON DUPLICATE KEY UPDATE
           branch_name = VALUES(branch_name),
           city = COALESCE(VALUES(city), city),
           state = COALESCE(VALUES(state), state),
           address = COALESCE(VALUES(address), address),
           pincode = COALESCE(VALUES(pincode), pincode)`,
        [branchCode, branchName, city, state, address, pincode]
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
