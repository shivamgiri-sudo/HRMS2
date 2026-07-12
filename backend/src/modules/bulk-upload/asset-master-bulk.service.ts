import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importAssetMasterBatch(
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

      const assetCode = String(data.asset_code ?? "").trim();
      const assetName = String(data.asset_name ?? "").trim();

      if (!assetCode || !assetName) {
        throw new Error(`Row ${row.row_no}: asset_code and asset_name are required`);
      }

      const category = data.category ? String(data.category).trim() : "General";
      const purchaseCost = data.cost ? parseFloat(String(data.cost)) : null;
      const purchaseDate = data.purchase_date
        ? String(data.purchase_date).slice(0, 10)
        : null;
      const serialNumber = data.serial_number
        ? String(data.serial_number).trim()
        : null;
      const assetCondition = data.condition
        ? String(data.condition).trim()
        : "good";

      await db.execute(
        `INSERT INTO asset_master
           (asset_code, asset_name, asset_category, purchase_cost, purchase_date,
            serial_number, asset_condition, asset_status)
         VALUES (?,?,?,?,?,?,?,'available')
         ON DUPLICATE KEY UPDATE
           asset_name = VALUES(asset_name),
           asset_category = VALUES(asset_category),
           purchase_cost = COALESCE(VALUES(purchase_cost), purchase_cost),
           purchase_date = COALESCE(VALUES(purchase_date), purchase_date),
           serial_number = COALESCE(VALUES(serial_number), serial_number),
           asset_condition = VALUES(asset_condition)`,
        [assetCode, assetName, category, purchaseCost, purchaseDate, serialNumber, assetCondition]
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
