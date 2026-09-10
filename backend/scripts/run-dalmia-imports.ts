/**
 * One-off: loads the real Dalmia Cement MIS workbook's raw sheets
 * (exported to JSON by _export_dalmia_json.py) into upload_batch(es) and
 * runs each real import function against mas_hrms. See sql/1731, 1732,
 * 1734 and the corresponding dalmia-*-bulk.service.ts files for what
 * these are.
 *
 * Only 3 of the workbook's original 5 sheets are imported here: IB CDR
 * Raw (sql/1730) and APR-Utilization Raw (sql/1733) were RETRACTED
 * 2026-09-10 -- dialer_db.cdr_in_249/cdr_in_4 and mas_hrms.apr already
 * carry this exact data live (see runPendingMigrations.ts's retraction
 * comments for both).
 *
 * Run with: npx tsx scripts/run-dalmia-imports.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/db/mysql.js";
import { importDalmiaDdBatch } from "../src/modules/bulk-upload/dalmia-dd-bulk.service.js";
import { importDalmiaOutboundBatch } from "../src/modules/bulk-upload/dalmia-outbound-bulk.service.js";
import { importDalmiaAfterHourBatch } from "../src/modules/bulk-upload/dalmia-after-hour-bulk.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_ID = "demo-super-admin-id";

async function runOne(
  key: string,
  uploadTypeCode: string,
  importFn: (batchId: string, userId: string) => Promise<{ importedRows: number; errorRows: number; errors: string[] }>,
) {
  const rows: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, `_${key}.json`), "utf8"),
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
    await db.execute(
      `INSERT INTO upload_batch_row (id, upload_batch_id, row_no, raw_data, normalized_data, row_status)
       VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), 'valid')`,
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
  results.dd = await runOne("dalmia_dd", "DALMIA_DD_RAW", importDalmiaDdBatch);
  results.outbound = await runOne("dalmia_outbound", "DALMIA_OUTBOUND_RAW", importDalmiaOutboundBatch);
  results.after_hour = await runOne("dalmia_after_hour", "DALMIA_AFTER_HOUR", importDalmiaAfterHourBatch);

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));

  const anyFailed = Object.values(results).some((r) => r.errorRows > 0 && r.importedRows === 0);
  process.exit(anyFailed ? 1 : 0);
}
main().catch((e) => { console.error("[IMPORT] FAILED", e); process.exit(1); });
