/**
 * ALT RX Dump storage - apply sql/2117 on production.
 *
 *   node scripts/alt-rx-apply.mjs            # dry-run: reports db_masmis.altdump and the upload template (READ ONLY session)
 *   node scripts/alt-rx-apply.mjs --apply    # registers the upload template, then tries CREATE TABLE db_masmis.altdump
 *
 * Not in MIGRATION_MANIFEST on purpose (same as sql/1965, 1966): the table lives in db_masmis, where the app DB
 * user normally has no CREATE. The template row (mas_hrms) is always applied; a refused CREATE is reported as
 * "needs a DBA", with the statement to hand over, instead of failing the run.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, "../sql/2117_alt_rx_dump.sql"), "utf8");
const createStmt = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS db_masmis.altdump"), sql.indexOf(";", sql.indexOf("CREATE TABLE IF NOT EXISTS db_masmis.altdump")) + 1);
const templateStmt = sql.slice(sql.indexOf("INSERT INTO upload_template_master"), sql.lastIndexOf(";") + 1);

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

async function report(label) {
  const [t] = await conn.query(`SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'db_masmis' AND TABLE_NAME = 'altdump'`);
  const [tpl] = await conn.query(`SELECT active_status a FROM upload_template_master WHERE upload_type_code = 'ALT_RX_DUMP_MASMIS'`);
  console.log(`--- ${label}`);
  console.log(`db_masmis.altdump: ${Number(t[0].n) ? "EXISTS" : "missing"}`);
  console.log(`upload template ALT_RX_DUMP_MASMIS: ${tpl.length ? `registered (active=${tpl[0].a})` : "missing"}`);
}

if (!APPLY) await conn.query("SET SESSION TRANSACTION READ ONLY");
await report(APPLY ? "before" : "dry-run (nothing written)");
if (APPLY) {
  await conn.query(templateStmt);
  console.log("upload template applied");
  try {
    await conn.query(createStmt);
    console.log("db_masmis.altdump created (or already present)");
  } catch (e) {
    console.log(`db_masmis.altdump NOT created: ${e.code ?? ""} ${e.message}`);
    console.log("needs a DBA: run the CREATE TABLE in backend/sql/2117_alt_rx_dump.sql as a user with CREATE on db_masmis");
  }
  await report("after");
}
await conn.end();
