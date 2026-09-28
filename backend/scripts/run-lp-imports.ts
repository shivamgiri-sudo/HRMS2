/**
 * One-off: loads the real "Leads", "APR", and "CR Report" sheets from both
 * real LP workbooks ("Lp Regional Sale Dashboard July26.xlsx" and "Lp Non
 * Regional Dashboard July'26.xlsx", exported to JSON by
 * scripts/export-lp-sheets.ps1) into upload_batch and runs each real
 * import function against mas_hrms -- fixing the "shipped but never run"
 * gap for lp_leads_raw, lp_cr_report_raw, lp_apr_daily_actual (all 0 rows
 * despite the import code already existing).
 *
 * Run with: npx tsx scripts/run-lp-imports.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/db/mysql.js";
import { importLpLeadsRegionalBatch, importLpLeadsNonRegionalBatch } from "../src/modules/bulk-upload/lp-leads-bulk.service.js";
import { importLpAprDailyBatch } from "../src/modules/bulk-upload/lp-apr-daily-bulk.service.js";
import { importLpCrReportRegionalBatch, importLpCrReportNonRegionalBatch } from "../src/modules/bulk-upload/lp-cdr-cr-report-bulk.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_ID = "demo-super-admin-id";

function loadJson(file: string): Record<string, unknown>[] {
  let raw = fs.readFileSync(path.join(__dirname, file), "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function runOne(
  key: string,
  jsonFile: string,
  uploadTypeCode: string,
  importFn: (batchId: string, userId: string) => Promise<{ importedRows: number; errorRows: number; errors: string[] }>,
) {
  const rows = loadJson(jsonFile);
  console.log(`[${key}] real rows loaded:`, rows.length);
  if (rows.length === 0) return { importedRows: 0, errorRows: 0 };

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
  results.leads_regional = await runOne("leads_regional", "_lp_regional_leads.json", "LP_LEADS_REGIONAL", importLpLeadsRegionalBatch);
  results.leads_non_regional = await runOne("leads_non_regional", "_lp_non_regional_leads.json", "LP_LEADS_NON_REGIONAL", importLpLeadsNonRegionalBatch);
  results.apr_regional = await runOne("apr_regional", "_lp_regional_apr.json", "LP_APR_DAILY", importLpAprDailyBatch);
  results.apr_non_regional = await runOne("apr_non_regional", "_lp_non_regional_apr.json", "LP_APR_DAILY", importLpAprDailyBatch);
  results.cr_report_regional = await runOne("cr_report_regional", "_lp_regional_cr_report.json", "LP_CR_REPORT_REGIONAL", importLpCrReportRegionalBatch);
  results.cr_report_non_regional = await runOne("cr_report_non_regional", "_lp_non_regional_cr_report.json", "LP_CR_REPORT_NON_REGIONAL", importLpCrReportNonRegionalBatch);

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));

  const anyFailed = Object.values(results).some((r) => r.errorRows > 0 && r.importedRows === 0);
  process.exit(anyFailed ? 1 : 0);
}
main().catch((e) => { console.error("[IMPORT] FAILED", e); process.exit(1); });
