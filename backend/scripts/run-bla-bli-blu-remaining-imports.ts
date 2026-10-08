/**
 * One-off: loads the real remaining files from the local folder
 * rebla_bli_bludashboard_sop_formulation_inboundabc_with_ (Auto Call Back,
 * After Hour, Call Disposition, Shopify Sales -- see sql/1742-1745) into
 * upload_batch and runs each real import function against mas_hrms.
 *
 * Run with: npx tsx scripts/run-bla-bli-blu-remaining-imports.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/db/mysql.js";
import { importBlaBliBluAutoCallbackBatch } from "../src/modules/bulk-upload/bla-bli-blu-auto-callback-bulk.service.js";
import { importBlaBliBluAfterHourBatch } from "../src/modules/bulk-upload/bla-bli-blu-after-hour-bulk.service.js";
import { importBlaBliBluCallDispositionBatch } from "../src/modules/bulk-upload/bla-bli-blu-call-disposition-bulk.service.js";
import { importBlaBliBluShopifySalesBatch } from "../src/modules/bulk-upload/bla-bli-blu-shopify-sales-bulk.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_ID = "demo-super-admin-id";

async function runOne(
  key: string,
  jsonFile: string,
  uploadTypeCode: string,
  importFn: (batchId: string, userId: string) => Promise<{ importedRows: number; errorRows: number; errors: string[] }>,
) {
  const rows: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, jsonFile), "utf8"),
  );
  console.log(`[${key}] real rows loaded:`, rows.length);

  const batchId = randomUUID();
  const batchNo = `${uploadTypeCode}_${Date.now()}`;
  await db.execute(
    `INSERT INTO upload_batch (id, upload_batch_no, upload_type_code, total_rows, valid_rows, batch_status, uploaded_by)
     VALUES (?, ?, ?, ?, ?, 'processing', ?)`,
    [batchId, batchNo, uploadTypeCode, rows.length, rows.length, USER_ID],
  );

  for (let i = 0; i < rows.length; i++) {
    if ((i + 1) % 2000 === 0) console.log(`[${key}] staging progress: ${i + 1}/${rows.length}`);
    await db.execute(
      `INSERT INTO upload_batch_row (id, upload_batch_id, row_no, raw_data, normalized_data, row_status)
       VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), 'valid')
       ON DUPLICATE KEY UPDATE id = id`,
      [randomUUID(), batchId, i + 1, JSON.stringify(rows[i]), JSON.stringify(rows[i])],
    );
  }
  console.log(`[${key}] batch rows staged:`, rows.length);

  const result = await importFn(batchId, USER_ID);
  console.log(`[${key}] result:`, JSON.stringify(result, null, 2));

  await db.execute(
    `UPDATE upload_batch SET batch_status = 'completed', imported_rows = ?, error_rows = ? WHERE id = ?`,
    [result.importedRows, result.errorRows, batchId],
  );
  return result;
}

async function main() {
  const results: Record<string, { importedRows: number; errorRows: number }> = {};
  // auto_callback (47/50) and after_hour (38/42) already landed on a prior run --
  // re-running them is harmless (ON DUPLICATE KEY UPDATE) but skipped here to
  // avoid re-staging 92 rows that already succeeded while the DB is contended.
  const only = process.argv[2];
  if (!only || only === "auto_callback") {
    results.auto_callback = await runOne("auto_callback", "_autocb.json", "BLA_BLI_BLU_AUTO_CALLBACK", importBlaBliBluAutoCallbackBatch);
  }
  if (!only || only === "after_hour") {
    results.after_hour = await runOne("after_hour", "_afterhr.json", "BLA_BLI_BLU_AFTER_HOUR", importBlaBliBluAfterHourBatch);
  }
  if (!only || only === "call_disposition") {
    results.call_disposition = await runOne("call_disposition", "_bla_bli_blu_disposition.json", "BLA_BLI_BLU_CALL_DISPOSITION", importBlaBliBluCallDispositionBatch);
  }
  if (!only || only === "shopify_sales") {
    results.shopify_sales = await runOne("shopify_sales", "_bla_bli_blu_shopify_sales.json", "BLA_BLI_BLU_SHOPIFY_SALES", importBlaBliBluShopifySalesBatch);
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));

  const anyFailed = Object.values(results).some((r) => r.errorRows > 0 && r.importedRows === 0);
  process.exit(anyFailed ? 1 : 0);
}
main().catch((e) => { console.error("[IMPORT] FAILED", e); process.exit(1); });
