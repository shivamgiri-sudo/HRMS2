/**
 * WFM provisioning pending audit. READ-ONLY.
 *
 * Why does a branch show N pending WFM provisioning employees while the
 * /provisioning/wfm-alignment queue lists nothing? Lists every open WFM request for the branch
 * and flags what the queue filters hide (pre-cutover, legacy employee, other branch, role).
 *
 *   npx tsx scripts/wfm-pending-audit.ts [branch-name-fragment]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const FRAG = process.argv[2] ?? "noida";
const CUTOVER = "2026-08-24";
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  const branches = await q(
    `SELECT id, branch_name FROM branch_master WHERE LOWER(branch_name) LIKE ?`, [`%${FRAG.toLowerCase()}%`]);
  console.log("\n== branches ==");
  console.table(branches);
  const ids = (branches as any[]).map((b) => b.id);
  if (!ids.length) { console.log("no branch matched"); process.exit(0); }
  const inList = ids.map(() => "?").join(",");

  const rows = await q(
    `SELECT ipr.id, e.employee_code, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS name,
            bm.branch_name, ipr.task_code, ipr.assigned_role, ipr.assigned_user_id, ipr.status,
            ipr.request_type, DATE_FORMAT(ipr.created_at,'%Y-%m-%d') created,
            (ipr.created_at >= ?) AS in_queue_window,
            (e.legacy_emp_id IS NOT NULL) AS legacy_emp,
            e.employment_status, e.active_status, ipr.locked
       FROM it_provisioning_request ipr
       JOIN employees e ON e.id = ipr.employee_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE e.branch_id IN (${inList})
        AND (ipr.assigned_role IN ('wfm','branch_wfm') OR ipr.task_code = 'WFM_PROCESS_ALIGNMENT')
        AND ipr.status IN ('pending','pending_unassigned','actioned')
      ORDER BY ipr.created_at DESC LIMIT 100`, [CUTOVER, ...ids]);
  console.log(`\n== open WFM requests for matched branches (${rows.length}) ==`);
  console.table(rows);

  const summary = await q(
    `SELECT ipr.status, ipr.assigned_role, ipr.task_code,
            (ipr.created_at >= ?) AS in_queue_window, (e.legacy_emp_id IS NOT NULL) AS legacy_emp,
            COUNT(*) n, COUNT(DISTINCT ipr.employee_id) employees
       FROM it_provisioning_request ipr JOIN employees e ON e.id = ipr.employee_id
      WHERE e.branch_id IN (${inList})
        AND (ipr.assigned_role IN ('wfm','branch_wfm') OR ipr.task_code = 'WFM_PROCESS_ALIGNMENT')
        AND ipr.status IN ('pending','pending_unassigned')
      GROUP BY 1,2,3,4,5`, [CUTOVER, ...ids]);
  console.log("\n== pending summary ==");
  console.table(summary);

  const holders = await q(
    `SELECT e.employee_code, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) name, ur.role_key,
            bm.branch_name AS own_branch
       FROM user_roles ur JOIN employees e ON e.user_id = ur.user_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE ur.active_status = 1 AND ur.role_key IN ('wfm','branch_wfm') AND e.branch_id IN (${inList})
      LIMIT 50`, [...ids]).catch((err) => [{ note: `role lookup skipped: ${err.message}` }]);
  console.log("\n== WFM role holders in branch ==");
  console.table(holders);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
