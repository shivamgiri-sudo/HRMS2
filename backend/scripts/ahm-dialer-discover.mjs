/**
 * GPI VICIdial servers (apr_server_gpi01 / gpi02 / gpi5) -- read-only production diagnosis.
 *   node scripts/ahm-dialer-discover.mjs
 * Uses the connector rows exactly as scripts/check-apr-server-coverage.ts does (inactive rows are read here on purpose), in READ ONLY
 * sessions: SELECTs only, time-boxed. Reports per server: reachability, call tables with row counts, daily vicidial_log calls for
 * the last 10 days, campaign / status mix, and how many of the AHM telesales ids and the GPI process's employee codes appear as
 * vicidial_log.user. Never prints credentials; hosts are the connector keys.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const main = await mysql.createConnection({
  host: strip(process.env.DB_HOST), port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER), password: strip(process.env.DB_PASSWORD), database: strip(process.env.DB_NAME),
  connectTimeout: 20000, dateStrings: true,
});
const out = (t, rows) => { console.log(`\n## ${t}`); for (const r of rows) console.log(JSON.stringify(r)); if (!rows.length) console.log("(none)"); };
const q = async (c, t, sql, params = []) => { try { const [r] = await c.query(sql, params); out(t, r); return r; } catch (e) { out(t, [{ ERROR: `${e.code ?? ""} ${String(e.message).slice(0, 140)}` }]); return []; } };
try {
  await main.query("SET SESSION TRANSACTION READ ONLY");
  const [cfgs] = await main.query(`SELECT integration_key, config_json, encrypted_credentials FROM integration_config WHERE integration_key LIKE 'apr_server_%' ORDER BY integration_key`);
  const [ahm] = await main.query(`SELECT DISTINCT LOWER(TRIM(telesales_id)) id FROM db_masmis.ahm_dump_raw WHERE telesales_id IS NOT NULL AND TRIM(telesales_id) <> '' LIMIT 2000`);
  const [emp] = await main.query(
    `SELECT DISTINCT LOWER(TRIM(e.employee_code)) id FROM employees e JOIN process_master p ON p.id = e.process_id
      WHERE e.active_status = 1 AND (p.process_code IN ('GODFREY_PHILIPS','FINFORT') OR p.process_name REGEXP 'GPI|FINFORT|GODFREY') LIMIT 3000`);
  const ahmIds = ahm.map((r) => r.id), empIds = emp.map((r) => r.id);
  console.log(`(ahm telesales ids: ${ahmIds.length}; GPI/Finfort employee codes: ${empIds.length})`);
  const inList = (a) => (a.length ? a.map(() => "?").join(",") : "NULL");

  for (const row of cfgs) {
    const key = row.integration_key;
    console.log(`\n==================== ${key} ====================`);
    let conn;
    try {
      const cfg = typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json;
      const cr = typeof row.encrypted_credentials === "string" ? JSON.parse(row.encrypted_credentials) : row.encrypted_credentials;
      if (!cfg?.host || !cr?.username || !cr?.password) { console.log("no usable host/credentials on this connector"); continue; }
      conn = await mysql.createConnection({
        host: cfg.host, port: cfg.port || 3306, user: cr.username, password: cr.password,
        database: cfg.database || "asterisk", connectTimeout: 15000, dateStrings: true,
      });
    } catch (e) { console.log(`CONNECT FAILED: ${e.code ?? ""} ${String(e.message).slice(0, 160)}`); continue; }
    try {
      await conn.query("SET SESSION TRANSACTION READ ONLY");
      await conn.query("SET SESSION MAX_EXECUTION_TIME = 25000").catch(() => {});
      await q(conn, "server", "SELECT NOW() now_db, @@hostname host, DATABASE() db");
      await q(conn, "call tables (rows, last update)",
        `SELECT TABLE_NAME, TABLE_ROWS, UPDATE_TIME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('vicidial_log','vicidial_closer_log','vicidial_agent_log','call_log','vicidial_list','vicidial_users','vicidial_campaigns','recording_log') ORDER BY TABLE_ROWS DESC`);
      await q(conn, "vicidial_log columns", "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) cols FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vicidial_log'");
      await q(conn, "daily outbound calls, last 10 days (vicidial_log)",
        `SELECT DATE(call_date) d, COUNT(*) calls, COUNT(DISTINCT user) users, SUM(length_in_sec > 0) with_talk
           FROM vicidial_log WHERE call_date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY) GROUP BY d ORDER BY d`);
      await q(conn, "daily inbound calls, last 10 days (vicidial_closer_log)",
        `SELECT DATE(call_date) d, COUNT(*) calls, COUNT(DISTINCT user) users FROM vicidial_closer_log
          WHERE call_date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY) GROUP BY d ORDER BY d`);
      await q(conn, "campaigns, last 10 days", `SELECT campaign_id, COUNT(*) calls, COUNT(DISTINCT user) users FROM vicidial_log WHERE call_date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY) GROUP BY campaign_id ORDER BY calls DESC LIMIT 15`);
      await q(conn, "status mix (outbound), last 10 days", `SELECT status, COUNT(*) n, ROUND(AVG(length_in_sec),1) avg_len FROM vicidial_log WHERE call_date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY) GROUP BY status ORDER BY n DESC LIMIT 30`);
      await q(conn, "vicidial_log.user format sample", `SELECT DISTINCT user FROM vicidial_log WHERE call_date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY) ORDER BY user LIMIT 8`);
      if (ahmIds.length) await q(conn, "AHM telesales ids found as vicidial_log.user (last 30 days)",
        `SELECT COUNT(DISTINCT user) matched_users, COUNT(*) calls FROM vicidial_log WHERE call_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND LOWER(TRIM(user)) IN (${inList(ahmIds)})`, ahmIds);
      if (empIds.length) await q(conn, "GPI/Finfort employee codes found as vicidial_log.user (last 30 days)",
        `SELECT COUNT(DISTINCT user) matched_users, COUNT(*) calls FROM vicidial_log WHERE call_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND LOWER(TRIM(user)) IN (${inList(empIds)})`, empIds);
    } finally {
      await conn.end().catch(() => {});
    }
  }
} finally {
  await main.end();
}
