/**
 * Approval Center pending-approvals audit. READ-ONLY, aggregate counts only (no names, no amounts, no ids).
 *
 * What is waiting at which stage for GRN, Branch Budget, Budget top-up and Bulk Upload, how old, and how many
 * people hold the role that can act at each stage. Used to sanity-check the Approval Center against live data
 * before it ships.
 *
 *   npx tsx scripts/approval-pending-audit.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const section = async (title: string, sql: string) => {
  console.log(`\n== ${title} ==`);
  try {
    const rows = await q(sql);
    rows.length ? console.table(rows) : console.log("(none)");
  } catch (e) {
    console.log("query failed:", (e as Error).message);
  }
};

(async () => {
  await section("GRN pending by stage",
    `SELECT status, COUNT(*) n, COUNT(DISTINCT branch_id) branches,
            MIN(created_at) oldest, MAX(created_at) newest
       FROM grn_request WHERE status IN ('submitted','branch_head_approved','accounts_head_approved')
      GROUP BY status`);
  await section("Branch budget pending by stage",
    `SELECT status, COUNT(*) n, COUNT(DISTINCT branch_id) branches, MIN(submitted_at) oldest
       FROM finance_budget_header WHERE status IN ('submitted','branch_head_approved') GROUP BY status`);
  await section("Budget top-up pending by stage",
    `SELECT t.status, COUNT(*) n, COUNT(DISTINCT h.branch_id) branches, MIN(t.created_at) oldest
       FROM finance_budget_topup_request t LEFT JOIN finance_budget_header h ON h.id = t.budget_id
      WHERE t.status IN ('submitted','pending','branch_head_approved') GROUP BY t.status`);
  await section("Bulk upload pending by stage and type",
    `SELECT approval_status, upload_type_code, COUNT(*) n, COUNT(DISTINCT branch_id) branches,
            MIN(COALESCE(submitted_for_approval_at, created_at)) oldest
       FROM upload_batch WHERE approval_status IN ('pending_branch_head','pending_payroll_head')
      GROUP BY approval_status, upload_type_code`);
  await section("People holding each approving role (active)",
    `SELECT role_key, COUNT(DISTINCT user_id) users FROM user_roles
      WHERE active_status = 1 AND role_key IN ('branch_head','accounts_head','finance_head','payroll_head','super_admin')
      GROUP BY role_key`);
  await section("Branch heads with a branch scope row",
    `SELECT COUNT(DISTINCT ur.user_id) users_with_scope
       FROM user_roles ur JOIN user_assignment_scope s ON s.user_id = ur.user_id
      WHERE ur.active_status = 1 AND ur.role_key = 'branch_head'`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
