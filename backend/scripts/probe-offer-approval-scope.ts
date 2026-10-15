/**
 * Why does a user see other branches' offer approvals? READ-ONLY. Arg: user email.
 * Runs the real queue / decisions / stats code as that user and groups results by branch.
 *
 *   npx tsx scripts/probe-offer-approval-scope.ts tejas.ahuja@teammas.in
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { buildScopeWhereClause } from "../src/shared/scopeAccess.js";
import { listPendingApprovals } from "../src/modules/ats/ats.onboarding.service.js";
import { getPendingApprovals, listBranchHeadDecisions, getBranchHeadStats } from "../src/modules/ats/branch-head-approval.service.js";
import { resolveBranchHeadScope } from "../src/modules/ats/branch-head-scope.js";

const email = String(process.argv[2] ?? "").trim();
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as RowDataPacket[];
const tally = (rows: any[], key: (r: any) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].map(([branch, n]) => ({ branch, n }));
};

(async () => {
  const [u] = await q(`SELECT id FROM auth_user WHERE email = ?`, [email]);
  if (!u) { console.log("no such user"); process.exit(1); }
  const uid = String(u.id);
  const [emp] = await q(`SELECT e.id, e.branch_id, b.branch_name FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id WHERE e.user_id = ? AND e.active_status = 1 LIMIT 1`, [uid]);
  console.log("own branch:", emp?.branch_name);

  console.log("== departments where this user is head (grants org-wide via synthetic department_head role) ==");
  console.table(await q(`SELECT d.id, d.dept_name, d.active_status FROM department_master d WHERE d.dept_head_employee_id = ?`, [emp?.id ?? ""]).catch(async () => q(`SELECT d.id, d.active_status FROM department_master d WHERE d.dept_head_employee_id = ?`, [emp?.id ?? ""])));
  console.log("== branch_head_assignments (legacy, any is_active) ==");
  console.table(await q(`SELECT branch_name, is_active FROM branch_head_assignments WHERE branch_head_id = ?`, [emp?.id ?? ""]));
  console.log("== resolveBranchHeadScope ==");
  console.log(JSON.stringify(await resolveBranchHeadScope(uid)));

  const sf = await buildScopeWhereClause(uid, ["branch_head"], { branchId: "r.branch_id" }, { allowAdminBypass: true });
  console.log("pending-approval scope sql:", sf.sql, JSON.stringify(sf.params));
  const pend: any[] = await listPendingApprovals(sf);
  console.log(`/onboarding/pending-approval: ${pend.length} offers`);
  console.table(tally(pend, (r) => String(r.branch_name ?? "(none)")));

  const legacy: any[] = await getPendingApprovals(String(emp?.id ?? uid), uid);
  console.log(`/branch-head-approval/pending: ${legacy.length}`);
  console.table(tally(legacy, (r) => String(r.applied_for_branch ?? r.branch_name ?? "(none)")));

  const dec: any = await listBranchHeadDecisions(uid, { status: "all", search: null, limit: 500, offset: 0 });
  const drows: any[] = dec.rows ?? dec.data ?? dec.items ?? [];
  console.log(`/decisions: ${drows.length} (keys: ${Object.keys(dec).join(",")})`);
  console.table(tally(drows, (r) => String(r.applied_for_branch ?? r.branch_name ?? r.branch_display_name ?? "(none)")));

  console.log("stats:", JSON.stringify(await getBranchHeadStats(String(emp?.id ?? uid), uid)));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
