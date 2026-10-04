/**
 * Investigate the SAL_DIFF ("Salary Diff. Days") incentive lines and the salary/package history of
 * the three employees who carry one that db_bill does not. READ-ONLY (SELECTs only).
 *
 *   npx tsx scripts/sal-diff-investigate.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

const CODES = ["62516C", "62654C", "63107C"];
const ph = CODES.map(() => "?").join(",");
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const who = (col: string) => `(SELECT CONCAT(au.email, ' / ', COALESCE((SELECT e2.full_name FROM employees e2 WHERE e2.user_id = au.id LIMIT 1), '?')) FROM auth_user au WHERE au.id = ${col})`;

const section = async (title: string, sql: string, params: unknown[] = []) => {
  console.log(`\n== ${title} ==`);
  try { const r = await q(sql, params); console.log(`rows: ${r.length}`); if (r.length) console.table(r.slice(0, 60)); }
  catch (e) { console.log("query failed:", (e as Error).message); }
};

(async () => {
  await section("employees",
    `SELECT e.id, e.employee_code, DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj, e.active_status, bm.branch_name, e.employment_type
       FROM employees e LEFT JOIN branch_master bm ON bm.id = e.branch_id WHERE e.employee_code IN (${ph})`, CODES);

  await section("SAL_DIFF batches (Aug 2026): who uploaded, when, status",
    `SELECT b.batch_ref, b.status, b.total_employees, b.total_amount, b.created_at, b.updated_at,
            ${who("b.uploaded_by")} uploaded_by, b.remarks, b.approval_chain
       FROM incentive_upload_batch b WHERE b.pay_month = '2026-08' AND b.batch_ref LIKE '%SAL_DIFF%'`);

  await section("SAL_DIFF batch approval steps",
    `SELECT b.batch_ref, s.step_number, s.required_role, s.status, ${who("COALESCE(s.actioned_by, s.approver_user_id)")} decided_by,
            COALESCE(s.actioned_at, s.decided_at) decided_at, s.remarks
       FROM incentive_approval_step s JOIN incentive_upload_batch b ON b.id = s.batch_id
      WHERE b.pay_month = '2026-08' AND b.batch_ref LIKE '%SAL_DIFF%' ORDER BY s.step_number`);

  await section("SAL_DIFF lines in HRMS (Aug 2026): totals",
    `SELECT COUNT(*) line_count, COUNT(DISTINCT l.employee_code) employees, SUM(l.amount) total, MIN(l.amount) min_amt, MAX(l.amount) max_amt
       FROM incentive_upload_line l JOIN incentive_upload_batch b ON b.id = l.batch_id
      WHERE b.pay_month = '2026-08' AND l.incentive_code = 'SAL_DIFF'`);

  await section("SAL_DIFF lines for the 3 employees (with remarks)",
    `SELECT l.employee_code, l.amount, l.remarks, l.validation_status, l.validation_msg, l.created_at, b.batch_ref, b.status
       FROM incentive_upload_line l JOIN incentive_upload_batch b ON b.id = l.batch_id
      WHERE b.pay_month = '2026-08' AND l.incentive_code = 'SAL_DIFF' AND l.employee_code IN (${ph})`, CODES);

  await section("who has SAL_DIFF in HRMS Aug, by branch/amount (how widespread)",
    `SELECT l.amount, COUNT(*) n FROM incentive_upload_line l JOIN incentive_upload_batch b ON b.id = l.batch_id
      WHERE b.pay_month = '2026-08' AND l.incentive_code = 'SAL_DIFF' GROUP BY l.amount ORDER BY n DESC LIMIT 20`);

  console.log("\n== db_bill: distinct incentive types in Aug 2026 (does db_bill have a 'salary diff' type at all?) ==");
  try {
    console.table(await billQuery(
      `SELECT IncentiveType, ApproveStatus, COUNT(*) n, SUM(Amount) amt FROM upload_incentive_breakup
        WHERE SalaryMonth >= '2026-08-01' AND SalaryMonth < '2026-09-01' GROUP BY IncentiveType, ApproveStatus ORDER BY amt DESC`));
  } catch (e) { console.log("failed:", (e as Error).message); }

  console.log("\n== db_bill salary_data (Aug) for the 3: columns about diff/incentive/days ==");
  try {
    const rows = (await billQuery(
      `SELECT * FROM salary_data WHERE EmpCode IN (${CODES.map((c) => `'${c}'`).join(",")}) ORDER BY SalayDate DESC LIMIT 6`)) as any[];
    for (const r of rows) {
      const keep: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) if (/^(EmpCode|SalayDate)$|diff|incentive|payable|paiddays|workingdays|gross$|^basic$|ctc|package|adj/i.test(k)) keep[k] = v;
      console.log(JSON.stringify(keep));
    }
  } catch (e) { console.log("failed:", (e as Error).message); }

  await section("salary_component_assignments: every row (who assigned, when, package, approval ref)",
    `SELECT e.employee_code, s.id, s.status, s.effective_date, s.salary_slab, s.package_id, s.basic, s.hra, s.gross, s.ctc,
            ${who("s.assigned_by")} assigned_by, s.assigned_at, s.approval_reference, s.created_at
       FROM salary_component_assignments s JOIN employees e ON e.id = s.employee_id
      WHERE e.employee_code IN (${ph}) ORDER BY e.employee_code, s.created_at`, CODES);

  await section("employee_salary_assignment: every row",
    `SELECT e.employee_code, a.id, a.active_status, a.ctc_annual, a.structure_id, a.salary_slab_id, a.salary_proposal_id,
            a.governance_mode, ${who("a.assigned_by")} assigned_by, a.assignment_reason, a.effective_from, a.effective_to, a.created_at
       FROM employee_salary_assignment a JOIN employees e ON e.id = a.employee_id
      WHERE e.employee_code IN (${ph}) ORDER BY e.employee_code, a.created_at`, CODES);

  await section("salary_proposal: who raised, branch/payroll/finance head approvals",
    `SELECT e.employee_code, p.id, p.status, p.proposed_ctc_annual, p.reason, p.created_at,
            ${who("p.created_by")} raised_by,
            ${who("p.approved_by_branch_head")} branch_head, p.approved_by_branch_head_at,
            ${who("p.approved_by_payroll_head")} payroll_head, p.approved_by_payroll_head_at,
            ${who("p.approved_by_finance_head")} finance_head, p.approved_by_finance_head_at, p.final_approved_at
       FROM salary_proposal p JOIN employees e ON e.id = p.employee_id
      WHERE e.employee_code IN (${ph}) ORDER BY e.employee_code, p.created_at`, CODES);

  await section("salary_proposal_approval_step",
    `SELECT e.employee_code, st.approval_level, st.status, ${who("st.approver_id")} approver, st.acted_at, st.remarks
       FROM salary_proposal_approval_step st JOIN salary_proposal p ON p.id = st.proposal_id JOIN employees e ON e.id = p.employee_id
      WHERE e.employee_code IN (${ph}) ORDER BY e.employee_code, st.approval_level`, CODES);

  await section("employee_salary_change_log",
    `SELECT e.employee_code, c.old_ctc, c.new_ctc, c.effective_date, c.reason, c.requested_by_name,
            ${who("c.actor_user_id")} actor, c.created_at
       FROM employee_salary_change_log c JOIN employees e ON e.id = c.employee_id
      WHERE e.employee_code IN (${ph}) ORDER BY e.employee_code, c.created_at`, CODES);

  await section("salary_increment_request",
    `SELECT e.employee_code, r.status, r.current_ctc, r.proposed_ctc, r.reason_code, r.effective_from, r.source,
            ${who("r.requested_by")} requested_by, ${who("r.approved_by")} approved_by, r.approved_at, r.implemented_at
       FROM salary_increment_request r JOIN employees e ON e.id = r.employee_id
      WHERE e.employee_code IN (${ph}) ORDER BY e.employee_code, r.created_at`, CODES);

  await section("salary_package_audit_log mentioning these assignments",
    `SELECT a.table_name, a.action, ${who("a.changed_by")} changed_by, LEFT(a.change_summary, 200) summary, a.created_at
       FROM salary_package_audit_log a
      WHERE a.record_id IN (SELECT id FROM salary_component_assignments WHERE employee_id IN (SELECT id FROM employees WHERE employee_code IN (${ph}))
                           UNION SELECT id FROM employee_salary_assignment WHERE employee_id IN (SELECT id FROM employees WHERE employee_code IN (${ph})))
      ORDER BY a.created_at`, [...CODES, ...CODES]);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
