/**
 * Report requests (emailed reports) — read-only production diagnosis.
 *
 *   node scripts/report-requests-diagnose.mjs
 *
 * READ ONLY session. Answers: how many requests sit in each status, how old the oldest
 * QUEUED / PROCESSING / GENERATED ones are, what the failure codes are, how the delivery
 * rows look, how long reports take end to end, and which worker locks / runs exist.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
  connectTimeout: 20000,
  dateStrings: true,
});
const show = async (title, sql, params = []) => {
  try {
    const [rows] = await conn.query(sql, params);
    console.log(`\n## ${title}`);
    for (const r of rows) console.log(JSON.stringify(r));
    if (!rows.length) console.log("(none)");
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${e.code ?? ""} ${e.message}`);
  }
};
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  await show("now", "SELECT NOW() AS now_db");
  await show("requests by status (all time)", "SELECT status, COUNT(*) n, MIN(requested_at) oldest, MAX(requested_at) newest FROM report_request GROUP BY status ORDER BY n DESC");
  await show("requests last 7 days by status", "SELECT status, COUNT(*) n FROM report_request WHERE requested_at >= NOW() - INTERVAL 7 DAY GROUP BY status");
  await show("not-finished requests older than 2 minutes", "SELECT request_reference, report_code, status, requested_at, processing_started_at, generation_completed_at, email_queued_at, retry_count, failure_code, LEFT(failure_message,160) fm FROM report_request WHERE status IN ('REQUESTED','QUEUED','PROCESSING','GENERATED') AND requested_at < NOW() - INTERVAL 2 MINUTE ORDER BY requested_at LIMIT 40");
  await show("failure codes", "SELECT status, failure_stage, failure_code, COUNT(*) n, MAX(LEFT(failure_message,200)) sample FROM report_request WHERE failure_code IS NOT NULL GROUP BY status, failure_stage, failure_code ORDER BY n DESC LIMIT 30");
  await show("delivery rows by status", "SELECT status, failure_code, COUNT(*) n, MIN(queued_at) oldest, MAX(LEFT(failure_message,200)) sample FROM report_email_delivery GROUP BY status, failure_code ORDER BY n DESC");
  await show("GENERATED requests with no delivery row", "SELECT rr.request_reference, rr.status, rr.generation_completed_at FROM report_request rr LEFT JOIN report_email_delivery d ON d.report_request_id = rr.id WHERE rr.status = 'GENERATED' AND d.id IS NULL LIMIT 20");
  await show("GENERATED/QUEUED delivery but request still GENERATED", "SELECT rr.request_reference, d.status dstatus, d.queued_at, d.next_retry_at, d.delivery_attempt_number FROM report_request rr JOIN report_email_delivery d ON d.report_request_id = rr.id WHERE rr.status = 'GENERATED' ORDER BY d.queued_at LIMIT 20");
  await show("end-to-end minutes, EMAILED last 7 days (request -> generated -> emailed)", "SELECT COUNT(*) n, ROUND(AVG(TIMESTAMPDIFF(SECOND, requested_at, generation_completed_at))) avg_gen_s, MAX(TIMESTAMPDIFF(SECOND, requested_at, generation_completed_at)) max_gen_s, ROUND(AVG(TIMESTAMPDIFF(SECOND, generation_completed_at, email_sent_at))) avg_mail_s, MAX(TIMESTAMPDIFF(SECOND, generation_completed_at, email_sent_at)) max_mail_s FROM report_request WHERE status = 'EMAILED' AND requested_at >= NOW() - INTERVAL 7 DAY");
  await show("report codes by count and avg generation seconds (7d)", "SELECT report_code, COUNT(*) n, ROUND(AVG(TIMESTAMPDIFF(SECOND, processing_started_at, generation_completed_at))) avg_gen_s FROM report_request WHERE requested_at >= NOW() - INTERVAL 7 DAY GROUP BY report_code ORDER BY n DESC LIMIT 15");
  await show("blank-column check on recent rows", "SELECT SUM(report_name_snapshot IS NULL OR report_name_snapshot='') no_name, SUM(official_email IS NULL OR official_email='') no_email, SUM(generation_completed_at IS NULL) no_gen, SUM(email_sent_at IS NULL) no_sent, COUNT(*) total FROM report_request WHERE requested_at >= NOW() - INTERVAL 7 DAY");
  await show("worker locks", "SELECT * FROM worker_lock WHERE worker_name LIKE 'report%' LIMIT 10");
  await show("recent audit errors", "SELECT event_type, error_code, LEFT(error_detail,200) detail, MAX(created_at) last_at, COUNT(*) n FROM report_audit_event WHERE error_code IS NOT NULL AND created_at >= NOW() - INTERVAL 3 DAY GROUP BY event_type, error_code, LEFT(error_detail,200) ORDER BY n DESC LIMIT 15");
  await show("employee_master_snapshot dup check", "SELECT COUNT(*) total_rows, COUNT(DISTINCT employee_code) distinct_codes, MAX(snapshot_refreshed_at) last_refreshed FROM employee_master_snapshot");
  await show("employees count", "SELECT COUNT(*) total, COUNT(DISTINCT employee_code) distinct_codes, SUM(active_status=1) active FROM employees");
  await show("employee-master join row count (same join the report uses)", "SELECT COUNT(*) n FROM employees e JOIN employee_master_snapshot ems ON ems.employee_code = e.employee_code");
  await show("snapshot codes with most duplicates", "SELECT employee_code, COUNT(*) n FROM employee_master_snapshot GROUP BY employee_code HAVING n > 1 ORDER BY n DESC LIMIT 5");
  await show("employees codes with most duplicates", "SELECT employee_code, COUNT(*) n FROM employees GROUP BY employee_code HAVING n > 1 ORDER BY n DESC LIMIT 5");
  await show("snapshot indexes", "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_master_snapshot'");
  await show("employees.employee_code collation vs snapshot", "SELECT TABLE_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'employee_code' AND TABLE_NAME IN ('employees','employee_master_snapshot')");
  await show("smtp env present (names only)", "SELECT 1 AS dummy");
  console.log("SMTP_HOST set:", !!process.env.SMTP_HOST, " SMTP_USER set:", !!process.env.SMTP_USER, " SMTP_FROM set:", !!process.env.SMTP_FROM);
} finally {
  await conn.end();
}
