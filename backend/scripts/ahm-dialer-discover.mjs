/**
 * Configured connectors that could carry GPI / Finfort call data -- read-only production diagnosis.
 *   node scripts/ahm-dialer-discover.mjs
 * Lists integration_config rows (key, name, type, the host/port/database shown in config_json, active flag, last update) whose key,
 * name or shown host looks like a dialer / GPI / Finfort / 192.168.1.x server. NEVER selects or prints encrypted_credentials.
 * Also lists process_master rows for GPI and Finfort with their cost-centre codes and active headcount. SELECTs in a READ ONLY session.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: strip(process.env.DB_HOST), port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER), password: strip(process.env.DB_PASSWORD), database: strip(process.env.DB_NAME),
  connectTimeout: 20000, dateStrings: true,
});
const show = async (title, sql, params = []) => {
  try {
    const [rows] = await conn.query(sql, params);
    console.log(`\n## ${title}`);
    for (const r of rows) console.log(JSON.stringify(r));
    if (!rows.length) console.log("(none)");
  } catch (e) { console.log(`\n## ${title}\nERROR ${e.code ?? ""} ${e.message}`); }
};
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  await show("integration_config columns", "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'integration_config' ORDER BY ORDINAL_POSITION");
  await show("connectors that look like a dialer / GPI / Finfort / 192.168.1.x server (no credentials selected)",
    `SELECT integration_key, integration_name,
            JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.type')) AS db_type,
            JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.host')) AS shown_host,
            JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.port')) AS shown_port,
            JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.database')) AS shown_db,
            (encrypted_credentials IS NOT NULL) AS has_credentials, active_status, updated_at
       FROM integration_config
      WHERE integration_key REGEXP 'dialer|vici|gpi|finfort|godfrey|cdr|call|ob_|outbound|apr'
         OR integration_name REGEXP 'dialer|vici|gpi|finfort|godfrey|cdr|call|outbound'
         OR JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.host')) LIKE '192.168.1.%'
      ORDER BY integration_key LIMIT 100`);
  await show("all connector keys (names only)", "SELECT integration_key, integration_name, active_status FROM integration_config ORDER BY integration_key LIMIT 300");
  await show("GPI / Finfort processes",
    `SELECT p.id, p.process_name, p.process_code, p.active_status,
            (SELECT COUNT(*) FROM employees e WHERE e.process_id = p.id AND e.active_status = 1) active_employees
       FROM process_master p WHERE p.process_name REGEXP 'GPI|FINFORT|FIN FORT|GODFREY' OR p.process_code REGEXP 'GPI|FINFORT|GODFREY'`);
} finally {
  await conn.end();
}
