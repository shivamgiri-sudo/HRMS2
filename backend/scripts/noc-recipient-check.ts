/**
 * Read-only: why did a given person receive NOC emails? Prints their branch, designation, roles and
 * scope rows, and the NOC mail the system logged to their address. SELECT only; no body text.
 *
 *   NOC_CHECK_EMAIL=name@domain npx tsx scripts/noc-recipient-check.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const email = String(process.env.NOC_CHECK_EMAIL ?? "").trim().toLowerCase();
if (!email.includes("@")) throw new Error("NOC_CHECK_EMAIL is required");
const q = async (sql: string, p: unknown[] = []) => {
  if (!/^\s*select/i.test(sql)) throw new Error("read-only");
  const [rows] = await db.execute<RowDataPacket[]>(sql, p as never[]);
  return rows;
};
const show = (l: string, v: unknown) => console.log(`\n== ${l} ==\n${JSON.stringify(v, null, 1)}`);

const emp = await q(
  `SELECT e.id, e.user_id, e.employee_code, e.designation_id, d.designation_name,
          b.branch_name, e.branch_id, e.employment_status, e.active_status
     FROM employees e
     LEFT JOIN designation_master d ON d.id = e.designation_id
     LEFT JOIN branch_master b ON b.id = e.branch_id
    WHERE LOWER(e.official_email) = ? OR LOWER(e.office_email) = ? OR LOWER(e.email) = ? LIMIT 3`,
  [email, email, email],
);
show("employee", emp);
for (const e of emp) {
  show("user_roles", await q(`SELECT role_key, active_status FROM user_roles WHERE user_id = ?`, [e.user_id]));
  show("user_assignment_scope", await q(
    `SELECT role_key, scope_type, branch_id, process_id, active_status FROM user_assignment_scope WHERE user_id = ?`, [e.user_id]));
  show("branch_head_assignments", await q(
    `SELECT bha.branch_name, bha.is_active FROM branch_head_assignments bha WHERE bha.branch_head_id = ?`, [e.id]));
}
show("NOC mail logged to this address (latest 15)", await q(
  `SELECT template_code, subject, status, sent_at FROM notification_log
    WHERE LOWER(recipient_email) = ? AND (template_code LIKE 'noc%' OR LOWER(subject) LIKE '%noc%')
    ORDER BY created_at DESC LIMIT 15`, [email]));
show("NOC mail count by template (all time)", await q(
  `SELECT template_code, COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM notification_log
    WHERE LOWER(recipient_email) = ? AND (template_code LIKE 'noc%' OR LOWER(subject) LIKE '%noc%')
    GROUP BY template_code`, [email]));
show("recent NOC dispatches: which selectors reached anyone (last 2 days)", await q(
  `SELECT event_code, COUNT(*) AS dispatches, SUM(recipient_count) AS to_total, SUM(cc_count) AS cc_total
     FROM notification_dispatch_claim
    WHERE event_code LIKE 'noc%' AND claimed_at > NOW() - INTERVAL 2 DAY GROUP BY event_code`));
await db.end?.();
