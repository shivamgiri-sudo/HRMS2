/**
 * NOC cases still open for one branch, with the stages each is waiting on, plus the roles of one user. READ-ONLY.
 *
 *   npx tsx scripts/probe-noc-pending.ts NOIDA-2 sheelu.verma@teammas.in
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const BRANCH = String(process.argv[2] ?? "NOIDA-2").trim();
const EMAIL = String(process.argv[3] ?? "").trim();
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as RowDataPacket[];

(async () => {
  const [b] = await q(`SELECT id, branch_name FROM branch_master WHERE branch_name = ? LIMIT 1`, [BRANCH]);
  if (!b) { console.log("no such branch"); process.exit(1); }
  console.log(`branch ${b.branch_name} (${b.id})`);

  if (EMAIL) {
    console.log("== user roles ==");
    console.table(await q(
      `SELECT u.email, GROUP_CONCAT(DISTINCT r.role_key) AS roles FROM auth_user u
         LEFT JOIN user_roles r ON r.user_id = u.id AND r.active_status = 1 WHERE u.email = ? GROUP BY u.id`, [EMAIL]));
  }

  const open = await q(
    `SELECT c.id, c.employee_code, c.employee_name, c.status, DATE_FORMAT(c.last_working_day,'%Y-%m-%d') AS lwd,
            DATEDIFF(CURDATE(), COALESCE(c.initiated_at, c.employee_submitted_at)) AS days_open,
            DATE_FORMAT(c.payroll_head_approved_at,'%Y-%m-%d') AS ph_approved
       FROM noc_case c
      WHERE c.branch_id = ? AND c.status IN ('invited','employee_submitted','in_progress')
      ORDER BY c.initiated_at`, [b.id]);
  console.log(`== open NOC cases at ${BRANCH}: ${open.length} ==`);
  const stages = open.length
    ? await q(`SELECT noc_case_id, stage_key, status, is_mandatory, role_key, DATE_FORMAT(sla_due_at,'%Y-%m-%d') AS sla_due, reminder_count, acted_by_name
                 FROM noc_signatory WHERE noc_case_id IN (${open.map(() => "?").join(",")}) ORDER BY noc_case_id, display_no`, open.map((o) => o.id))
    : [];
  for (const o of open) {
    const mine = stages.filter((s) => s.noc_case_id === o.id);
    const waiting = mine.filter((s) => s.status === "pending").map((s) => `${s.stage_key}${Number(s.is_mandatory) ? "*" : ""}[${s.role_key}]`).join(", ");
    console.log(`${o.employee_code} ${o.employee_name} | ${o.status} | LWD ${o.lwd ?? "-"} | open ${o.days_open}d | waiting on: ${waiting || "(none: all stages acted)"}`);
  }
  const closed7 = await q(
    `SELECT COUNT(*) n FROM noc_case WHERE branch_id = ? AND status = 'completed' AND completed_at >= NOW() - INTERVAL 7 DAY`, [b.id]);
  console.log(`completed in the last 7 days at ${BRANCH}: ${closed7[0].n}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
