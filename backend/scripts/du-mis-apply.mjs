/**
 * DU Digital CDR + MIS email scheduler - apply sql/1965 and sql/1966 on production.
 *
 *   node scripts/du-mis-apply.mjs            # dry-run: report only, SELECTs in a READ ONLY session
 *   node scripts/du-mis-apply.mjs --apply    # runs sql/1965_mis_email_schedule.sql then sql/1966_du_cdr_daily_actual.sql
 *
 * Both files are additive and idempotent (CREATE TABLE IF NOT EXISTS; 1966 also re-seeds the two DU_CDR_* upload templates
 * with DELETE + INSERT keyed on upload_type_code). Neither is in MIGRATION_MANIFEST on purpose: they are applied here, after approval.
 * migrations/453 (db_masmis copies) is NOT run by this script - the app DB user has no CREATE on db_masmis; it is reported only.
 * Loads env like the other ops scripts (dotenv/config, honouring DOTENV_CONFIG_PATH).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const here = dirname(fileURLToPath(import.meta.url));
const FILES = ["1965_mis_email_schedule.sql", "1966_du_cdr_daily_actual.sql"];

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

async function report(label) {
  console.log(`--- ${label}`);
  const [t] = await conn.query(
    `SELECT TABLE_SCHEMA s, TABLE_NAME n FROM information_schema.TABLES
      WHERE (TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('mis_email_schedule','mis_email_schedule_run','du_cdr_daily_actual','du_apr_daily_actual'))
         OR (TABLE_SCHEMA = 'db_masmis' AND TABLE_NAME IN ('du_cdr_daily_actual','du_apr_daily_actual'))
      ORDER BY 1, 2`);
  for (const w of ["mis_email_schedule", "mis_email_schedule_run"]) console.log(`${w} (app db): ${t.some((r) => r.n === w) ? "EXISTS" : "missing"}`);
  console.log(`du_cdr_daily_actual (app db): ${t.some((r) => r.n === "du_cdr_daily_actual" && r.s !== "db_masmis") ? "EXISTS" : "missing"}`);
  console.log(`du_cdr_daily_actual (db_masmis): ${t.some((r) => r.n === "du_cdr_daily_actual" && r.s === "db_masmis") ? "EXISTS" : "missing  -> needs migrations/453 by a DBA"}`);
  console.log(`du_apr_daily_actual (db_masmis): ${t.some((r) => r.n === "du_apr_daily_actual" && r.s === "db_masmis") ? "EXISTS" : "missing"}`);
  const [tpl] = await conn.query(`SELECT upload_type_code c, active_status a FROM upload_template_master WHERE upload_type_code IN ('DU_CDR_KOREA','DU_CDR_THAILAND') ORDER BY 1`);
  console.log(`upload templates: ${tpl.length ? tpl.map((r) => `${r.c}(active=${r.a})`).join(", ") : "none registered"}`);
}

if (!APPLY) await conn.query("SET SESSION TRANSACTION READ ONLY");
await report(APPLY ? "before" : "dry-run (nothing written)");
if (APPLY) {
  for (const f of FILES) {
    const sql = readFileSync(resolve(here, "../sql", f), "utf8");
    await conn.query(sql);
    console.log(`applied ${f}`);
  }
  await report("after");
}
await conn.end();
