/**
 * One-off: loads the real Housing Owner "Look up Data" sheet (exported to
 * JSON by _export_lead_pipeline_json.py, 398,363 real rows) into an
 * upload_batch and runs the real import function against mas_hrms. See
 * housing-owner-lead-pipeline-bulk.service.ts / sql/1738 for what this is.
 *
 * This is by far the largest single import this session -- staging and
 * importing run as individual row-by-row statements (matching the exact
 * same code path a real end-user upload goes through), so this is
 * expected to take a long time. Progress is logged every 10,000 rows.
 *
 * Run with: npx tsx scripts/run-housing-owner-lead-pipeline-import.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/db/mysql.js";
import { importHousingOwnerLeadPipelineBatch } from "../src/modules/bulk-upload/housing-owner-lead-pipeline-bulk.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_ID = "demo-super-admin-id";

async function main() {
  const rows: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, "_lead_pipeline_raw.json"), "utf8"),
  );
  console.log("[IMPORT] real rows loaded:", rows.length);

  const batchId = randomUUID();
  const batchNo = `HOUSING_OWNER_LEAD_PIPELINE_${Date.now()}`;
  await db.execute(
    `INSERT INTO upload_batch (id, upload_batch_no, upload_type_code, total_rows, valid_rows, batch_status, uploaded_by)
     VALUES (?, ?, 'HOUSING_OWNER_LEAD_PIPELINE', ?, ?, 'processing', ?)`,
    [batchId, batchNo, rows.length, rows.length, USER_ID],
  );

  const t0 = Date.now();
  for (let i = 0; i < rows.length; i++) {
    // ON DUPLICATE KEY UPDATE id=id (a no-op) rather than a plain INSERT:
    // withTransientRetry can retry a statement that actually succeeded
    // server-side before a transient error was reported client-side (a
    // real ER_DUP_ENTRY on this row's own randomUUID() was hit live at
    // row ~19,730 of a first attempt) -- across 398,363 attempts that
    // stops being negligible. Idempotent by construction either way.
    await db.execute(
      `INSERT INTO upload_batch_row (id, upload_batch_id, row_no, raw_data, normalized_data, row_status)
       VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), 'valid')
       ON DUPLICATE KEY UPDATE id = id`,
      [randomUUID(), batchId, i + 1, JSON.stringify(rows[i]), JSON.stringify(rows[i])],
    );
    if ((i + 1) % 10000 === 0) {
      console.log(`[IMPORT] staged ${i + 1}/${rows.length} (${Math.round((Date.now() - t0) / 1000)}s elapsed)`);
    }
  }
  console.log("[IMPORT] batch rows staged:", rows.length, `(${Math.round((Date.now() - t0) / 1000)}s)`);

  const t1 = Date.now();
  const result = await importHousingOwnerLeadPipelineBatch(batchId, USER_ID);
  console.log("[IMPORT] result:", JSON.stringify(result, null, 2), `(${Math.round((Date.now() - t1) / 1000)}s)`);

  await db.execute(
    `UPDATE upload_batch SET batch_status = 'completed', imported_rows = ?, error_rows = ? WHERE id = ?`,
    [result.importedRows, result.errorRows, batchId],
  );

  process.exit(result.errorRows > 0 && result.importedRows === 0 ? 1 : 0);
}
main().catch((e) => { console.error("[IMPORT] FAILED", e); process.exit(1); });
