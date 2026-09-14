/**
 * One-off: loads the real "Overall Sales Raw" sheet (exported to JSON by
 * _export_sales_json.py) into an upload_batch and runs
 * importBlaBliBluOverallSalesBatch for real against mas_hrms. See
 * bla-bli-blu-overall-sales-bulk.service.ts / sql/1729 for what this is.
 *
 * Run with: npx tsx scripts/run-bla-bli-blu-sales-import.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/db/mysql.js";
import { importBlaBliBluOverallSalesBatch } from "../src/modules/bulk-upload/bla-bli-blu-overall-sales-bulk.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_ID = "demo-super-admin-id";

async function main() {
  const rows: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, "_sales_raw.json"), "utf8"),
  );
  console.log("[IMPORT] real rows loaded:", rows.length);

  const batchId = randomUUID();
  const batchNo = `BLA_BLI_BLU_SALES_${Date.now()}`;
  await db.execute(
    `INSERT INTO upload_batch (id, upload_batch_no, upload_type_code, total_rows, valid_rows, batch_status, uploaded_by)
     VALUES (?, ?, 'BLA_BLI_BLU_OVERALL_SALES', ?, ?, 'processing', ?)`,
    [batchId, batchNo, rows.length, rows.length, USER_ID],
  );

  for (let i = 0; i < rows.length; i++) {
    await db.execute(
      `INSERT INTO upload_batch_row (id, upload_batch_id, row_no, raw_data, normalized_data, row_status)
       VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), 'valid')`,
      [randomUUID(), batchId, i + 1, JSON.stringify(rows[i]), JSON.stringify(rows[i])],
    );
  }
  console.log("[IMPORT] batch rows staged:", rows.length);

  const result = await importBlaBliBluOverallSalesBatch(batchId, USER_ID);
  console.log("[IMPORT] result:", JSON.stringify(result, null, 2));

  await db.execute(
    `UPDATE upload_batch SET batch_status = 'completed', imported_rows = ?, error_rows = ? WHERE id = ?`,
    [result.importedRows, result.errorRows, batchId],
  );

  process.exit(result.errorRows > 0 && result.importedRows === 0 ? 1 : 0);
}
main().catch((e) => { console.error("[IMPORT] FAILED", e); process.exit(1); });
