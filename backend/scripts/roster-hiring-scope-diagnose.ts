/**
 * Why branch WFM / Process Manager see an empty Roster Command Center and branch HR sees no hiring
 * entries. READ-ONLY (SELECTs only). Arg: branch name fragment (default "Ahmedabad").
 *
 *   npx tsx scripts/roster-hiring-scope-diagnose.ts Ahmedabad
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { getUserRoleContext } from "../src/shared/roleResolver.js";
import { resolveDashboardScope } from "../src/shared/dashboardScope.js";

const BRANCH = String(process.argv[2] ?? "Ahmedabad").trim() || "Ahmedabad";
const ROLES = ["branch_wfm", "wfm", "process_manager", "branch_head", "branch_hr", "hr", "payroll_hr", "recruiter"];
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as RowDataPacket[];

(async () => {
  console.log(`== branches matching "${BRANCH}" ==`);
  console.table(await q(`SELECT id, branch_name, branch_code FROM branch_master WHERE branch_name LIKE ? OR branch_code LIKE ?`, [`%${BRANCH}%`, `%${BRANCH}%`]));

  const ph = ROLES.map(() => "?").join(",");
  const users = await q(
    `SELECT DISTINCT u.id, e.employee_code, e.full_name, e.process_id, pm.process_name, b.branch_name,
            GROUP_CONCAT(DISTINCT ur.role_key) AS roles
       FROM user_roles ur
       JOIN auth_user u ON u.id = ur.user_id
       JOIN employees e ON e.user_id = u.id AND e.active_status = 1
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE ur.active_status = 1 AND ur.role_key IN (${ph}) AND b.branch_name LIKE ?
      GROUP BY u.id, e.employee_code, e.full_name, e.process_id, pm.process_name, b.branch_name
      ORDER BY roles, e.full_name LIMIT 80`, [...ROLES, `%${BRANCH}%`]);
  console.log(`== ${users.length} users in branch with relevant roles ==`);
  for (const u of users) {
    let line = `${u.employee_code} ${u.full_name} roles=[${u.roles}] process=${u.process_name ?? "NULL"}`;
    try {
      const ctx = await getUserRoleContext(String(u.id));
      line += ` primary=${ctx.primaryRole}`;
      const sc = await resolveDashboardScope(String(u.id), ctx.primaryRole);
      line += ` scope=${sc.level} branches=${sc.branchIds.length} processes=${sc.processIds.length}`;
    } catch (e) {
      line += ` SCOPE-ERROR=${(e as Error).message}`;
    }
    const [{ n }] = await q(`SELECT COUNT(*) AS n FROM user_assignment_scope WHERE user_id = ?`, [u.id]).catch(() => [{ n: "?" }] as RowDataPacket[]);
    console.log(`${line} assignmentRows=${n}`);
  }

  console.log("== hiring entries: stored branch_name / location_name for the branch ==");
  console.table(await q(
    `SELECT branch_name, location_name, COUNT(*) AS entries FROM ats_recruiter_hiring_activity
      WHERE branch_name LIKE ? OR location_name LIKE ? GROUP BY branch_name, location_name ORDER BY entries DESC LIMIT 30`,
    [`%${BRANCH}%`, `%${BRANCH}%`]));

  const { getActorBranch } = await import("../src/modules/ats/recruiter-hiring.service.js");
  console.log("== per HR user: branch used for scoping, employee rows, entries OLD exact vs NEW tolerant ==");
  const hr = users.filter((u) => /branch_hr|(^|,)hr(,|$)|recruiter/.test(String(u.roles)));
  for (const u of hr) {
    try {
      const actor = await getActorBranch(String(u.id));
      const [rowsN] = await q(`SELECT COUNT(*) AS n, SUM(active_status = 1) AS active FROM employees WHERE user_id = ?`, [u.id]);
      const [o] = await q(`SELECT COUNT(*) AS n FROM ats_recruiter_hiring_activity WHERE branch_name = ? OR created_by = ? OR recruiter_id = ?`, [actor ?? "", u.id, u.id]);
      const [t] = await q(
        `SELECT COUNT(*) AS n FROM ats_recruiter_hiring_activity a WHERE
           LOWER(TRIM(COALESCE(a.branch_name,''))) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(a.location_name,''))) = LOWER(TRIM(?))
           OR EXISTS (SELECT 1 FROM branch_master bm WHERE LOWER(TRIM(bm.branch_name)) = LOWER(TRIM(?))
                AND (LOWER(TRIM(COALESCE(a.branch_name,''))) IN (LOWER(TRIM(bm.branch_name)), LOWER(TRIM(COALESCE(bm.branch_code,''))))
                  OR LOWER(TRIM(COALESCE(a.location_name,''))) IN (LOWER(TRIM(bm.branch_name)), LOWER(TRIM(COALESCE(bm.branch_code,''))))))
           OR a.created_by = ? OR a.recruiter_id = ?`, [actor ?? "", actor ?? "", actor ?? "", u.id, u.id]);
      const [own] = await q(`SELECT COUNT(*) AS n FROM ats_recruiter_hiring_activity WHERE created_by = ? OR recruiter_id = ?`, [u.id, u.id]);
      console.log(`${u.employee_code} ${u.full_name} [${u.roles}] empBranch=${u.branch_name} actorBranch=${actor} empRows=${rowsN.n}/active ${rowsN.active} own=${own.n} old=${o.n} new=${t.n}`);
    } catch (e) {
      console.log(`${u.employee_code} ${u.full_name} ERROR ${(e as Error).message}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
