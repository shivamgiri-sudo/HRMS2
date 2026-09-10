/**
 * One-off: loads the real "DD tagging (Dial Desk) INbound.xls" export
 * (178 real rows, exported to JSON by inline python parsing of its HTML
 * table) into an upload_batch and runs the real import function against
 * mas_hrms. See bla-bli-blu-dd-tagging-bulk.service.ts / sql/1739.
 *
 * Run with: npx tsx scripts/run-bla-bli-blu-dd-tagging-import.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/db/mysql.js";
import { importBlaBliBluDdTaggingBatch } from "../src/modules/bulk-upload/bla-bli-blu-dd-tagging-bulk.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_ID = "demo-super-admin-id";

async function main() {
  const rows: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, "_dd_tagging.json"), "utf8"),
  );
  console.log("[IMPORT] real rows loaded:", rows.length);

  const batchId = randomUUID();
  const batchNo = `BLA_BLI_BLU_DD_TAGGING_${Date.now()}`;
  await db.execute(
    `INSERT INTO upload_batch (id, upload_batch_no, upload_type_code, total_rows, valid_rows, batch_status, uploaded_by)
     VALUES (?, ?, 'BLA_BLI_BLU_DD_TAGGING', ?, ?, 'processing', ?)`,
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

  const result = await importBlaBliBluDdTaggingBatch(batchId, USER_ID);
  console.log("[IMPORT] result:", JSON.stringify(result, null, 2));

  await db.execute(
    `UPDATE upload_batch SET batch_status = 'completed', imported_rows = ?, error_rows = ? WHERE id = ?`,
    [result.importedRows, result.errorRows, batchId],
  );

  process.exit(result.errorRows > 0 && result.importedRows === 0 ? 1 : 0);
}
main().catch((e) => { console.error("[IMPORT] FAILED", e); process.exit(1); });
