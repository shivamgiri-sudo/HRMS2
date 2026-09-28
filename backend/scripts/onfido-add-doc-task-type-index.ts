/**
 * One-off, idempotent, ONLINE speed-up for the Onfido dashboard (2026-09-19).
 *
 * onfido_doc_raw is ~2.6 GB / 745k rows, mostly the raw_data JSON. Every DOC average-AHT query had to
 * read that JSON to learn each row's task type. This adds:
 *   1. doc_task_type_old — a VIRTUAL generated column (no data stored, added INSTANT) exposing
 *      raw_data."Task Information Task Type Old";
 *   2. idx_onfido_doc_raw_date_tasktype_aht (report_date, doc_task_type_old, manual_processing_time_secs)
 *      — lets the AHT averages be answered from the index alone.
 * Both use ALGORITHM/LOCK options that FAIL rather than lock the table, so a live upload is never blocked.
 * Old code that ignores the column keeps working. Usage: npx tsx scripts/onfido-add-doc-task-type-index.ts
 */
import { getOnfidoPool } from "../src/db/onfidoDb.js";

const TABLE = "onfido_doc_raw";
const COLUMN = "doc_task_type_old";
const INDEX = "idx_onfido_doc_raw_date_tasktype_aht";

const pool = await getOnfidoPool();
const conn = await pool.getConnection();
try {
  await conn.query("SET SESSION lock_wait_timeout = 30");

  const [cols] = await conn.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", [TABLE, COLUMN]);
  if ((cols as unknown[]).length === 0) {
    const t = Date.now();
    await conn.query(
      `ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} VARCHAR(100)
         GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."Task Information Task Type Old"'))) VIRTUAL,
         ALGORITHM = INSTANT`);
    console.log(`column added in ${Date.now() - t} ms`);
  } else console.log("column already present");

  const [idx] = await conn.query(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?", [TABLE, INDEX]);
  if ((idx as unknown[]).length === 0) {
    const t = Date.now();
    await conn.query(
      `ALTER TABLE ${TABLE} ADD INDEX ${INDEX} (report_date, ${COLUMN}, manual_processing_time_secs), ALGORITHM = INPLACE, LOCK = NONE`);
    console.log(`index built in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  } else console.log("index already present");
} finally {
  conn.release();
  await pool.end();
}
