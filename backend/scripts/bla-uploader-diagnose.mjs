/**
 * BLA / BLI / BLU bulk uploaders — read-only production diagnosis.
 *   node scripts/bla-uploader-diagnose.mjs
 * READ ONLY session. Lists recent upload_batch rows for the Bla Bli Blu upload types, the status mix,
 * the validation / import errors, and the first error messages per batch.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
  connectTimeout: 20000,
  dateStrings: true,
});
const show = async (title, sql, params = []) => {
  try {
    const [rows] = await conn.query(sql, params);
    console.log(`\n## ${title}`);
    for (const r of rows) console.log(JSON.stringify(r));
    if (!rows.length) console.log("(none)");
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${e.code ?? ""} ${e.message}`);
  }
};
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  await show("now", "SELECT NOW() now_db");
  await show("bla upload types registered", "SELECT code, name, active_status FROM upload_type WHERE code LIKE '%BLA%' OR name LIKE '%Bla%' OR code LIKE '%BELLA%'");
  await show("bla batches, status mix (30 days)", "SELECT upload_type_code, batch_status, COUNT(*) n, MAX(created_at) latest FROM upload_batch WHERE (upload_type_code LIKE '%BLA%' OR upload_type_code LIKE '%bla%') AND created_at >= NOW() - INTERVAL 30 DAY GROUP BY upload_type_code, batch_status ORDER BY latest DESC");
  await show("latest 15 bla batches", "SELECT upload_batch_no, upload_type_code, original_file_name, batch_status, approval_status, total_rows, valid_rows, error_rows, imported_rows, created_at, validated_at, imported_at, LEFT(error_summary,300) err FROM upload_batch WHERE upload_type_code LIKE '%BLA%' OR upload_type_code LIKE '%bla%' ORDER BY created_at DESC LIMIT 15");
  await show("latest 3 bla batches: metadata + error_summary + updated_at", "SELECT upload_batch_no, batch_status, updated_at, job_owner, job_heartbeat_at, LEFT(error_summary,600) err, LEFT(CAST(metadata AS CHAR),500) meta FROM upload_batch WHERE upload_type_code LIKE '%BLA%' ORDER BY created_at DESC LIMIT 3");
  await show("bulk_import_queue (recent)", "SELECT q.batch_id, b.upload_batch_no, q.rpc_name, q.queued_at, q.claimed_at, q.user_id FROM bulk_import_queue q LEFT JOIN upload_batch b ON b.id = q.batch_id ORDER BY q.queued_at DESC LIMIT 8");
  await show("queue depth", "SELECT COUNT(*) total, SUM(claimed_at IS NULL) unclaimed, MIN(queued_at) oldest_unclaimed FROM bulk_import_queue WHERE claimed_at IS NULL");
  await show("batches by status, last 3 days, all types", "SELECT batch_status, COUNT(*) n FROM upload_batch WHERE created_at >= NOW() - INTERVAL 3 DAY GROUP BY batch_status");
  await show("job-lost failures last 3 days, all types", "SELECT upload_type_code, COUNT(*) n, MAX(created_at) latest FROM upload_batch WHERE batch_status = 'failed' AND error_summary LIKE '%job tracking it was lost%' AND created_at >= NOW() - INTERVAL 3 DAY GROUP BY upload_type_code");
  await show("running statements (>5s)", "SELECT id, time, state, LEFT(info,240) q FROM information_schema.PROCESSLIST WHERE command <> 'Sleep' AND time > 5 AND id <> CONNECTION_ID() ORDER BY time DESC LIMIT 10");
  await show("overall sales table size + history size", "SELECT TABLE_NAME, TABLE_ROWS, ROUND(DATA_LENGTH/1048576) data_mb, ROUND(INDEX_LENGTH/1048576) idx_mb FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'bla_bli_blu_overall_sales%' OR TABLE_NAME LIKE 'bbb_%sales%history%' OR TABLE_NAME LIKE '%sales_history%')");
  await show("indexes on overall sales raw", "SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols, MAX(NON_UNIQUE) non_unique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bla_bli_blu_overall_sales_raw' GROUP BY INDEX_NAME");
  await show("rows already written by this batch", "SELECT COUNT(*) n FROM bla_bli_blu_overall_sales_raw WHERE source_reference = 'BATCH-1791372390102'");
  await show("sample row errors on latest failed bla batches", "SELECT b.upload_batch_no, LEFT(r.error_messages,200) errs, COUNT(*) n FROM upload_batch b JOIN upload_batch_row r ON r.upload_batch_id = b.id WHERE (b.upload_type_code LIKE '%BLA%') AND r.row_status IN ('error','failed','invalid') AND b.created_at >= NOW() - INTERVAL 14 DAY GROUP BY b.upload_batch_no, LEFT(r.error_messages,200) ORDER BY b.upload_batch_no DESC, n DESC LIMIT 12");
  await show("row status mix on latest 5 bla batches", "SELECT b.upload_batch_no, r.row_status, COUNT(*) n FROM (SELECT id, upload_batch_no FROM upload_batch WHERE upload_type_code LIKE '%BLA%' OR upload_type_code LIKE '%bla%' ORDER BY created_at DESC LIMIT 5) b JOIN upload_batch_row r ON r.upload_batch_id = b.id GROUP BY b.upload_batch_no, r.row_status");
  await show("all batches stuck in a working state (any type)", "SELECT upload_batch_no, upload_type_code, batch_status, job_owner, job_heartbeat_at, created_at FROM upload_batch WHERE batch_status IN ('importing','validating','processing','queued') AND created_at >= NOW() - INTERVAL 7 DAY ORDER BY created_at DESC LIMIT 15");
} finally {
  await conn.end();
}
