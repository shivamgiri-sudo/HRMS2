/**
 * db-lock-diagnose.mjs — READ-ONLY. Shows what is holding row locks right now, to explain
 * ER_LOCK_WAIT_TIMEOUT on employee_bank_detail inserts. SELECTs only against information_schema /
 * performance_schema / sys; statement text is cut to 140 chars with long digit runs masked.
 */
import mysql from "mysql2/promise";
import "dotenv/config";
const mask = (s) => String(s ?? "").replace(/\d{6,}/g, "#").replace(/\s+/g, " ").slice(0, 140);
const c = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
const q = async (label, sql) => {
  try { const [r] = await c.query(sql); console.log(`\n== ${label} (${r.length})`); for (const row of r) console.log(JSON.stringify(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? mask(v) : v])))); }
  catch (e) { console.log(`\n== ${label}: ${e.code ?? e.message}`); }
};
await q("settings", "SELECT @@innodb_lock_wait_timeout AS lock_wait_timeout_s, @@transaction_isolation AS isolation, VERSION() AS version");
await q("open transactions, oldest first", `SELECT trx_mysql_thread_id AS thread, trx_state AS state, TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS open_s,
  trx_rows_locked AS rows_locked, trx_rows_modified AS rows_modified, trx_query AS q FROM information_schema.innodb_trx ORDER BY trx_started LIMIT 20`);
await q("current lock waits", `SELECT waiting_pid, waiting_query, blocking_pid, blocking_query, wait_age_secs FROM sys.innodb_lock_waits LIMIT 20`);
await q("long statements / idle-in-transaction", `SELECT ID AS thread, USER AS user, COMMAND AS command, TIME AS secs, STATE AS state, INFO AS q
  FROM information_schema.processlist WHERE (TIME > 20 AND COMMAND <> 'Sleep') ORDER BY TIME DESC LIMIT 20`);
await q("who holds employee_bank_detail / employees locks", `SELECT object_name AS tbl, lock_type, lock_mode, lock_status, COUNT(*) AS n
  FROM performance_schema.data_locks WHERE object_name IN ('employee_bank_detail','employees') GROUP BY 1,2,3,4`);
await c.end();
