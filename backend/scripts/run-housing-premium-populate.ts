/**
 * One-off: housing_premium_agent_target (sql/1715) and
 * housing_premium_sale_raw (sql/1706) were built and pushed earlier this
 * session, but were never actually run against real data -- both sat at
 * 0 rows in production. This loads the real "Housing Premium MIS
 * Dashboard Aug'26 (1).xlsb" workbook's "Team Details" and "Sale Raw"
 * sheets (exported to JSON by _export_hp_team_details.py /
 * _export_hp_sale_raw.py) through the existing, already-correct import
 * functions.
 *
 * Run with: npx tsx scripts/run-housing-premium-populate.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/db/mysql.js";
import { importHousingPremiumAgentTargetBatch } from "../src/modules/bulk-upload/housing-premium-agent-target-bulk.service.js";
import { importHousingPremiumSaleRawBatch } from "../src/modules/bulk-upload/housing-premium-sale-raw-bulk.service.js";

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
  results.hp_team_details = await runOne("hp_team_details", "HOUSING_PREMIUM_AGENT_TARGET", importHousingPremiumAgentTargetBatch);
  results.hp_sale_raw = await runOne("hp_sale_raw", "HOUSING_PREMIUM_SALE_RAW", importHousingPremiumSaleRawBatch);

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));

  const anyFailed = Object.values(results).some((r) => r.errorRows > 0 && r.importedRows === 0);
  process.exit(anyFailed ? 1 : 0);
}
main().catch((e) => { console.error("[IMPORT] FAILED", e); process.exit(1); });
