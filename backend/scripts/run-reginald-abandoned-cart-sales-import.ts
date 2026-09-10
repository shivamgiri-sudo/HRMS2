/**
 * One-off: loads the real "Abandan Cart REPORT - Form Responses 1" export
 * (10,740 real rows, the Reginald Men Abandoned Cart Dashboard's live
 * sales Google Form, downloaded via an authenticated Chrome session with
 * real access to the sheet) into an upload_batch and runs the real import
 * function against mas_hrms. See reginald-abandoned-cart-sales-bulk.
 * service.ts / sql/1752.
 *
 * Run with: npx tsx scripts/run-reginald-abandoned-cart-sales-import.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/db/mysql.js";
import { importReginaldAbandonedCartSalesBatch } from "../src/modules/bulk-upload/reginald-abandoned-cart-sales-bulk.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_ID = "demo-super-admin-id";

async function main() {
  const rows: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, "_reginald_abc_sales.json"), "utf8"),
  );
  console.log("[IMPORT] real rows loaded:", rows.length);

  const batchId = randomUUID();
  const batchNo = `REGINALD_ABC_SALES_${Date.now()}`;
  await db.execute(
    `INSERT INTO upload_batch (id, upload_batch_no, upload_type_code, total_rows, valid_rows, batch_status, uploaded_by)
     VALUES (?, ?, 'REGINALD_ABANDONED_CART_SALES', ?, ?, 'processing', ?)`,
    [batchId, batchNo, rows.length, rows.length, USER_ID],
  );

  // Chunked staging insert -- 10,740 rows one at a time would be thousands of
  // round trips; a single multi-row VALUES insert per chunk matches the
  // established /batches/:id/rows endpoint's own chunking rationale.
  const CHUNK = 500;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    chunk.forEach((row, i) => {
      placeholders.push("(?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), 'valid')");
      values.push(randomUUID(), batchId, start + i + 1, JSON.stringify(row), JSON.stringify(row));
    });
    await db.execute(
      `INSERT INTO upload_batch_row (id, upload_batch_id, row_no, raw_data, normalized_data, row_status)
       VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
  console.log("[IMPORT] batch rows staged:", rows.length);

  const result = await importReginaldAbandonedCartSalesBatch(batchId, USER_ID);
  console.log("[IMPORT] result:", JSON.stringify({ ...result, errors: result.errors.slice(0, 10) }, null, 2));
  console.log("[IMPORT] total errors:", result.errors.length);

  await db.execute(
    `UPDATE upload_batch SET batch_status = 'completed', imported_rows = ?, error_rows = ? WHERE id = ?`,
    [result.importedRows, result.errorRows, batchId],
  );

  process.exit(result.errorRows > 0 && result.importedRows === 0 ? 1 : 0);
}
main().catch((e) => { console.error("[IMPORT] FAILED", e); process.exit(1); });
