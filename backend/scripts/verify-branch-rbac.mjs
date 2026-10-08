/**
 * Read-only check of the branch-scoping rollout against the live database. Runs SELECTs only.
 *
 *   node scripts/verify-branch-rbac.mjs
 *
 * Reports (never prints credentials):
 *   1. schema_migrations rows for 1986 / 1987 / 1988
 *   2. role_page_access grants for branch_wfm / branch_head / payroll_branch
 *   3. process_master rows for the TPZ process codes the catalogue maps
 */
import "dotenv/config";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
});

async function show(title, sql, params = []) {
  console.log(`\n== ${title}`);
  try {
    const [rows] = await conn.query(sql, params);
    if (!rows.length) console.log("(no rows)");
    else console.table(rows);
  } catch (e) {
    console.log(`query failed: ${e.code || ""} ${e.message}`);
  }
}

try {
  await show(
    "migrations 1986-1988 recorded",
    "SELECT * FROM schema_migrations WHERE filename LIKE '1986\\_%' OR filename LIKE '1987\\_%' OR filename LIKE '1988\\_%'",
  );
  await show(
    "role_page_access grants (expect 5: branch_wfm x3, branch_head x1, payroll_branch x1)",
    `SELECT role_key, page_code, can_view, can_create, can_edit, active_status FROM role_page_access
      WHERE (role_key='branch_wfm'  AND page_code IN ('WFM_ROSTER','PROVISIONING_WFM_ALIGNMENT','PAYROLL_HOLIDAY_WORK'))
         OR (role_key='branch_head' AND page_code='PROVISIONING_WFM_ALIGNMENT')
         OR (role_key='payroll_branch' AND page_code='PAYROLL_HOLIDAY_WORK')
      ORDER BY role_key, page_code`,
  );
  await show(
    "TPZ process codes in process_master",
    `SELECT process_code, process_name, branch_id, active_status FROM process_master
      WHERE process_code IN ('APPRICIATE_WEALTH','SATYA_RETAIL','ERESOLUTION','DU_DIGITAL','DUBANGLADESH')
         OR LOWER(process_name) LIKE '%satya%' OR LOWER(process_name) LIKE '%appreciate%' OR LOWER(process_name) LIKE '%appriciate%'
         OR LOWER(process_name) LIKE '%eresolution%' OR LOWER(process_name) LIKE '%lawyer%'
         OR LOWER(process_name) LIKE '%bangladesh%' OR LOWER(process_name) LIKE '%du digital%' OR LOWER(process_name) LIKE '%puresta%'
      ORDER BY process_code`,
  );
} finally {
  await conn.end();
}
