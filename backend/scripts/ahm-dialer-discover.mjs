/**
 * Finfort / GPI cost centres -- read-only production diagnosis.
 *   node scripts/ahm-dialer-discover.mjs
 * SELECTs only, in a READ ONLY session. Lists cost_centre_master rows and process_master rows that look like Finfort / GPI /
 * Godfrey, with the linked process and active headcount, plus employees per matching cost centre.
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
  try { const [rows] = await conn.query(sql, params); console.log(`\n## ${title}`); for (const r of rows) console.log(JSON.stringify(r)); if (!rows.length) console.log("(none)"); }
  catch (e) { console.log(`\n## ${title}\nERROR ${e.code ?? ""} ${e.message}`); }
};
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  await show("cost_centre_master columns", "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) cols FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cost_centre_master'");
  await show("cost centres that look like Finfort / GPI / Godfrey",
    `SELECT c.* FROM cost_centre_master c
      WHERE CONCAT_WS(' ', c.cost_centre_code, c.cost_centre_name, c.client_name) REGEXP 'FINFORT|FIN FORT|GPI|GODFREY|PHILLIP|PHILIP' LIMIT 60`);
  await show("process_master rows named Finfort",
    `SELECT p.id, p.process_name, p.process_code, p.active_status, p.client_name,
            (SELECT COUNT(*) FROM employees e WHERE e.process_id = p.id AND e.active_status = 1) active_employees
       FROM process_master p WHERE CONCAT_WS(' ', p.process_name, p.process_code, p.client_name) REGEXP 'FINFORT|FIN FORT'`);
  await show("employees on Finfort-like cost centres (by process / cost centre text)",
    `SELECT p.process_name, p.process_code, COUNT(*) employees FROM employees e JOIN process_master p ON p.id = e.process_id
      WHERE e.active_status = 1 AND CONCAT_WS(' ', p.process_name, p.process_code, p.client_name) REGEXP 'FINFORT|FIN FORT' GROUP BY p.id`);
} finally { await conn.end(); }
