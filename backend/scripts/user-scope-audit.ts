/**
 * User scope audit. READ-ONLY.
 * Shows why a user sees the branches they do on scoped pages (Ops Control Tower etc.):
 * login, roles, own employee branch, assignment rows, and the scope the resolver returns.
 *
 *   npx tsx scripts/user-scope-audit.ts user@teammas.in
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { resolveDashboardScopeForRequest } from "../src/shared/dashboardScope.js";
import type { RowDataPacket } from "mysql2";

const EMAIL = process.argv[2];
if (!EMAIL) { console.error("usage: tsx scripts/user-scope-audit.ts <email>"); process.exit(1); }
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  const users = await q(`SELECT id, email FROM auth_user WHERE email = ?`, [EMAIL]);
  console.log("== user =="); console.table(users);
  const u = (users as any[])[0];
  if (!u) { await db.end(); return; }
  console.log("== roles ==");
  console.table(await q(`SELECT * FROM user_roles WHERE user_id = ?`, [u.id]).catch((e) => [{ err: e.message }]));
  console.log("== own employee record ==");
  console.table(await q(
    `SELECT e.employee_code, e.full_name, e.active_status, e.branch_id, bm.branch_name, e.process_id, pm.process_name
       FROM employees e LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id WHERE e.user_id = ?`, [u.id]));
  console.log("== user_assignment_scope rows ==");
  console.table(await q(
    `SELECT a.*, bm.branch_name, pm.process_name FROM user_assignment_scope a
       LEFT JOIN branch_master bm ON bm.id = a.branch_id
       LEFT JOIN process_master pm ON pm.id = a.process_id WHERE a.user_id = ?`, [u.id]).catch((e) => [{ err: e.message }]));
  try {
    const scope = await resolveDashboardScopeForRequest({ id: u.id }, "");
    const names = scope.branchIds.length
      ? await q(`SELECT id, branch_name FROM branch_master WHERE id IN (${scope.branchIds.map(() => "?").join(",")})`, scope.branchIds) : [];
    console.log("== resolved scope =="); console.log(scope.level, "role=", scope.role, "branchIds=", JSON.stringify(scope.branchIds), "processIds=", JSON.stringify(scope.processIds)); console.table(names);
  } catch (e: any) { console.log("resolver threw:", e?.message ?? e); }
  await db.end();
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
