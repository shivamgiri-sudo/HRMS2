import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  assetCode: string;
  assetName: string;
  category: string;
  purchaseCost: number | null;
  purchaseDate: string | null;
  serialNumber: string | null;
  assetCondition: string;
}

const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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

  if (batchRows.length === 0) {
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];
  let errorRows = 0;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : (row.normalized_data ?? {});

    const assetCode = String(data.asset_code ?? "").trim();
    const assetName = String(data.asset_name ?? "").trim();

    if (!assetCode || !assetName) {
      const msg = `Row ${row.row_no}: asset_code and asset_name are required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    parsed.push({
      rowId: row.id, rowNo: row.row_no, assetCode, assetName,
      category: data.category ? String(data.category).trim() : "General",
      purchaseCost: data.cost ? parseFloat(String(data.cost)) : null,
      purchaseDate: data.purchase_date ? String(data.purchase_date).slice(0, 10) : null,
      serialNumber: data.serial_number ? String(data.serial_number).trim() : null,
      assetCondition: data.condition ? String(data.condition).trim() : "good",
    });
  }

  let importedRows = 0;
  const importedRowIds: string[] = [];

  // Chunked multi-row upsert instead of one INSERT per row. If a chunk's
  // statement fails (a constraint violation on one of its rows), that chunk
  // alone is retried row-by-row so only the actually-bad row ends up marked
  // as an error — every other row in the batch still lands, matching the
  // original per-row loop's error isolation.
  for (const rowsInChunk of chunk(parsed, CHUNK_SIZE)) {
    const placeholders = rowsInChunk.map(() => "(?,?,?,?,?,?,?,'available')").join(", ");
    const params = rowsInChunk.flatMap((r) => [
      r.assetCode, r.assetName, r.category, r.purchaseCost, r.purchaseDate, r.serialNumber, r.assetCondition,
    ]);

    try {
      await db.execute(
        `INSERT INTO asset_master
           (asset_code, asset_name, asset_category, purchase_cost, purchase_date,
            serial_number, asset_condition, asset_status)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           asset_name = VALUES(asset_name),
           asset_category = VALUES(asset_category),
           purchase_cost = COALESCE(VALUES(purchase_cost), purchase_cost),
           purchase_date = COALESCE(VALUES(purchase_date), purchase_date),
           serial_number = COALESCE(VALUES(serial_number), serial_number),
           asset_condition = VALUES(asset_condition)`,
        params
      );
      for (const r of rowsInChunk) {
        importedRowIds.push(r.rowId);
        importedRows++;
      }
    } catch {
      for (const r of rowsInChunk) {
        try {
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
            [r.assetCode, r.assetName, r.category, r.purchaseCost, r.purchaseDate, r.serialNumber, r.assetCondition]
          );
          importedRowIds.push(r.rowId);
          importedRows++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Row ${r.rowNo}: ${msg}`);
          errorUpdates.push({ rowId: r.rowId, message: msg.slice(0, 500) });
          errorRows++;
        }
      }
    }
  }

  if (importedRowIds.length > 0) {
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported'
       WHERE id IN (${importedRowIds.map(() => "?").join(",")})`,
      importedRowIds
    );
  }
  if (errorUpdates.length > 0) {
    const cases = errorUpdates.map(() => "WHEN ? THEN ?").join(" ");
    const caseParams = errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]);
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...caseParams, ...ids]
    );
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
