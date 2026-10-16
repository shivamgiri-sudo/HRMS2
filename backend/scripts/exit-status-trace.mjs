/**
 * exit-status-trace.mjs <employee_code> — READ-ONLY. Shows one employee's exit requests and who moved them
 * to which status and when: exit_request row, exit_approval_log (actor resolved to name/email), and the
 * audit/sensitive-action logs that mention the exit request or employee. Writes nothing.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const CODE = process.argv[2];
if (!CODE) { console.error("usage: node scripts/exit-status-trace.mjs <employee_code>"); process.exit(1); }
const c = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  dateStrings: true,
});
const q = async (title, sql, params = []) => {
  try { const [rows] = await c.query(sql, params); console.log(`== ${title} (${rows.length})`); console.table(rows); return rows; }
  catch (e) { console.log(`== ${title}: ${e.code ?? e.message}`); return []; }
};

const emp = await q("employee", `SELECT id, employee_code, full_name, active_status, employment_status, branch_id, date_of_joining, updated_at FROM employees WHERE employee_code = ?`, [CODE]);
if (!emp.length) { await c.end(); process.exit(0); }
const empId = emp[0].id;

const reqs = await q("exit_request rows", `SELECT * FROM exit_request WHERE employee_id = ? ORDER BY created_at`, [empId]);
const ids = reqs.map((r) => r.id);
const who = `COALESCE(e.full_name, u.email, l.action_by) AS actor, u.email AS actor_email`;
if (ids.length) {
  const ph = ids.map(() => "?").join(",");
  await q("exit_approval_log (who moved it, in order)",
    `SELECT l.created_at, l.exit_request_id, l.stage, l.action, l.action_by_role, ${who}, l.discussion_remarks
       FROM exit_approval_log l
       LEFT JOIN auth_user u ON u.id = l.action_by
       LEFT JOIN employees e ON e.user_id = l.action_by
      WHERE l.exit_request_id IN (${ph}) ORDER BY l.created_at`, ids);
  for (const col of ["revoked_by", "created_by", "updated_by", "submitted_by"]) {
    if (reqs.some((r) => r[col])) {
      await q(`resolve ${col}`, `SELECT u.id, u.email, e.employee_code, e.full_name FROM auth_user u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id IN (${reqs.map((r) => r[col]).filter(Boolean).map(() => "?").join(",")})`, reqs.map((r) => r[col]).filter(Boolean));
    }
  }
  await q("sensitive_action_log mentioning these exit requests / employee",
    `SELECT s.*, u.email AS actor_email FROM sensitive_action_log s LEFT JOIN auth_user u ON u.id = s.actor_user_id
      WHERE (s.entity_id IN (${ph}) OR s.entity_id = ?) ORDER BY s.created_at`, [...ids, empId]);
  await q("audit_action_log mentioning these exit requests / employee",
    `SELECT a.*, u.email AS actor_email FROM audit_action_log a LEFT JOIN auth_user u ON u.id = a.actor_user_id
      WHERE (a.entity_id IN (${ph}) OR a.entity_id = ?) ORDER BY a.created_at`, [...ids, empId]);
}
await q("other exit-adjacent events for the employee (noc cases)", `SELECT id, status, initiated_at, last_working_day, updated_at FROM noc_case WHERE employee_id = ?`, [empId]);
await c.end();
