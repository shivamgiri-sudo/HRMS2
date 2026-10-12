/**
 * AHM call data discovery -- read-only production diagnosis.
 *   node scripts/ahm-dialer-discover.mjs
 * Connects to the dialer DB with the app's own DIALER_DB_* settings (the same read-only pool the inbound dashboards use), in a
 * READ ONLY session, and reports: which table families exist, which look like call/CDR/agent/disposition tables with their
 * columns, and where an AHM / GPI / Godfrey Phillips campaign name shows up. SELECTs only; every probe is time-boxed.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: strip(process.env.DIALER_DB_HOST) || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DIALER_DB_PORT) || 3306),
  user: strip(process.env.DIALER_DB_USER),
  password: strip(process.env.DIALER_DB_PASSWORD),
  database: strip(process.env.DIALER_DB_NAME),
  connectTimeout: 20000,
  dateStrings: true,
});
const schema = strip(process.env.DIALER_DB_NAME);
const show = async (title, sql, params = []) => {
  try {
    const [rows] = await conn.query(sql, params);
    console.log(`\n## ${title}`);
    for (const r of rows) console.log(JSON.stringify(r));
    if (!rows.length) console.log("(none)");
    return rows;
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${e.code ?? ""} ${e.message}`);
    return [];
  }
};
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  await conn.query("SET SESSION MAX_EXECUTION_TIME = 15000");
  await show("server", "SELECT NOW() now_db, @@hostname host, DATABASE() db");
  await show("table families (name with digits stripped)",
    `SELECT REGEXP_REPLACE(TABLE_NAME, '[0-9_]+$', '') AS family, COUNT(*) tables, SUM(TABLE_ROWS) approx_rows, MAX(UPDATE_TIME) last_update
       FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' GROUP BY family ORDER BY approx_rows DESC LIMIT 80`, [schema]);
  const cand = await show("call / agent / disposition looking tables (not cdr_in_*)",
    `SELECT TABLE_NAME, TABLE_ROWS, UPDATE_TIME FROM information_schema.tables
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME NOT LIKE 'cdr\\_in\\_%'
        AND TABLE_NAME REGEXP 'cdr|call|dial|agent|campaign|dispo|outbound|manual|predictive|survey|lead|data_master'
      ORDER BY TABLE_ROWS DESC LIMIT 120`, [schema]);
  const names = cand.map((r) => String(r.TABLE_NAME ?? r.table_name)).slice(0, 40);
  if (names.length) {
    await show("columns of those tables (first 40)",
      `SELECT TABLE_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') cols
         FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${names.map(() => "?").join(",")}) GROUP BY TABLE_NAME`,
      [schema, ...names]);
  }
  // Where does an AHM-ish campaign name appear?
  const campCols = await show("tables with a campaign-like column",
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns
      WHERE TABLE_SCHEMA = ? AND COLUMN_NAME REGEXP '^(campaign|campaign_name|campaignname|camp|process|process_name|queue|queue_name)$'
      ORDER BY TABLE_NAME LIMIT 200`, [schema]);
  let probed = 0;
  for (const c of campCols) {
    if (probed >= 40) break;
    const t = String(c.TABLE_NAME ?? c.table_name), col = String(c.COLUMN_NAME ?? c.column_name);
    if (!/^[A-Za-z0-9_]+$/.test(t) || !/^[A-Za-z0-9_]+$/.test(col)) continue;
    probed++;
    await show(`AHM-like values in ${t}.${col}`,
      `SELECT \`${col}\` AS value, COUNT(*) n FROM \`${t}\`
        WHERE \`${col}\` LIKE '%AHM%' OR \`${col}\` LIKE '%GPI%' OR \`${col}\` LIKE '%GODFREY%' OR \`${col}\` LIKE '%PHILLIP%'
        GROUP BY \`${col}\` ORDER BY n DESC LIMIT 15`);
  }
} finally {
  await conn.end();
}
