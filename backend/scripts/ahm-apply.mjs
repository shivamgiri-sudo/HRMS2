/**
 * AHM Dump storage + Appreciate Wealth disposition widening - apply on production.
 *
 *   node scripts/ahm-apply.mjs            # dry-run: reports state (READ ONLY session), writes nothing
 *   node scripts/ahm-apply.mjs --apply    # registers the AHM process + upload templates (mas_hrms), then tries
 *                                         # CREATE TABLE db_masmis.ahm_dump_raw and the two ALTERs of sql/1811
 *
 * sql/1875 and sql/1811 are not in MIGRATION_MANIFEST on purpose: the tables live in db_masmis, where the app DB user
 * normally has no CREATE/ALTER. The mas_hrms rows are always applied; a refused DDL statement is reported as
 * "needs a DBA", with the file to hand over, instead of failing the run. Same shape as alt-rx-apply.mjs.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const here = dirname(fileURLToPath(import.meta.url));
const ahm = readFileSync(resolve(here, "../sql/1875_ahm_dump_raw.sql"), "utf8");
const createStart = ahm.indexOf("CREATE TABLE IF NOT EXISTS db_masmis.ahm_dump_raw");
const createEnd = ahm.indexOf(";", ahm.indexOf("ENGINE=InnoDB", createStart)) + 1;
const createStmt = ahm.slice(createStart, createEnd);
const hrmsStmts = ahm.slice(createEnd);
const alters = [
  "ALTER TABLE db_masmis.aw_new_cdr MODIFY COLUMN disposition TEXT NULL",
  "ALTER TABLE db_masmis.aw_inbound MODIFY COLUMN disposition TEXT NULL",
];
const MAX_ALTER_ROWS = 2_000_000;

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  multipleStatements: true,
});

async function report(label) {
  console.log(`--- ${label}`);
  const [t] = await conn.query(`SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'db_masmis' AND TABLE_NAME = 'ahm_dump_raw'`);
  console.log(`db_masmis.ahm_dump_raw: ${Number(t[0].n) ? "EXISTS" : "missing"}`);
  const [p] = await conn.query(`SELECT COUNT(*) n FROM process_master WHERE process_code = 'AHM'`);
  console.log(`process_master AHM: ${Number(p[0].n) ? "present" : "missing"}`);
  const [tpl] = await conn.query(`SELECT upload_type_code c, active_status a FROM upload_template_master WHERE upload_type_code IN ('AHM_DUMP_MP','AHM_DUMP_MM')`);
  console.log(`upload templates: ${tpl.length ? tpl.map((r) => `${r.c}(active=${r.a})`).join(", ") : "missing"}`);
  for (const tbl of ["aw_new_cdr", "aw_inbound"]) {
    const [c] = await conn.query(
      `SELECT c.DATA_TYPE d, t.TABLE_ROWS r FROM information_schema.COLUMNS c
         JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
        WHERE c.TABLE_SCHEMA = 'db_masmis' AND c.TABLE_NAME = ? AND c.COLUMN_NAME = 'disposition'`, [tbl]);
    console.log(`db_masmis.${tbl}.disposition: ${c.length ? `${c[0].d} (~${c[0].r} rows)` : "not visible / missing"}`);
  }
  const [g] = await conn.query("SHOW GRANTS");
  console.log("grants:", g.map((r) => Object.values(r)[0]).filter((s) => /masmis|ALL PRIVILEGES/i.test(String(s))).join(" | ") || "(none mention db_masmis)");
}

if (!APPLY) await conn.query("SET SESSION TRANSACTION READ ONLY");
await report(APPLY ? "before" : "dry-run (nothing written)");
if (APPLY) {
  await conn.query(hrmsStmts);
  console.log("AHM process + upload templates applied (mas_hrms)");
  try {
    await conn.query(createStmt);
    console.log("db_masmis.ahm_dump_raw created (or already present)");
  } catch (e) {
    console.log(`db_masmis.ahm_dump_raw NOT created: ${e.code ?? ""} ${e.message}`);
    console.log("needs a DBA: run the CREATE TABLE in backend/sql/1875_ahm_dump_raw.sql as a user with CREATE on db_masmis");
  }
  for (const stmt of alters) {
    const tbl = stmt.match(/db_masmis\.(\w+)/)[1];
    try {
      const [r] = await conn.query(`SELECT TABLE_ROWS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'db_masmis' AND TABLE_NAME = ?`, [tbl]);
      if (r.length && Number(r[0].n) > MAX_ALTER_ROWS) { console.log(`${tbl}: SKIPPED, ~${r[0].n} rows is large; run sql/1811 off-hours as a DBA`); continue; }
      await conn.query(stmt);
      console.log(`${tbl}.disposition widened to TEXT`);
    } catch (e) {
      console.log(`${tbl}: NOT altered: ${e.code ?? ""} ${e.message}`);
      console.log("needs a DBA: run backend/sql/1811_aw_new_cdr_disposition_text.sql as a user with ALTER on db_masmis");
    }
  }
  await report("after");
}
await conn.end();
