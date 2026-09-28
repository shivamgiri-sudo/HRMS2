/**
 * August 2026: add the mid-month leavers the run never selected.
 *
 * On 2026-09-07 exit dates were backfilled for 96 employees who were marked inactive with no
 * date_of_exit (source: db_bill masjclrentry, cross-checked against attendance evidence — see
 * memory hrms2-dbbill-resignation-dates-bulk-backdated). The August run was calculated on
 * 2026-09-04, BEFORE those dates existed, so employmentWindowPredicate() could not see them:
 * with no resolvable end date and employment_status = 'inactive' they failed both arms of the
 * predicate and got no line at all. They are eligible now.
 *
 * Targeted, for the reasons in hrms2-payroll-recalc-traps: it skips the stale-line purge, it is
 * fast enough not to die mid-flight, and it still repairs the run header. Signature is
 * (runId, userId, { employeeIds }) — passing ids as the 2nd argument silently runs a FULL
 * recalculation. Imports from src, never dist: the local dist predates the 2026-09-06
 * leave-reversal idempotency fix and reintroduces the ER_DUP_ENTRY that aborts a recalc.
 *
 * Selection re-derives the population from the engine's own predicate at runtime rather than a
 * hardcoded list, so it stays correct if more exit dates land before it runs.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { calculatePayrollRunScoped } from "../src/modules/payroll/payrollCalculate.service.js";
import type { RowDataPacket } from "mysql2";

const RUN = "5035d780-6cb4-4bb6-a0e3-3f282fed7575";
const MONTH = "2026-08";
const ACTOR = process.env.RECALC_ACTOR_ID || "a4a4902e-6222-11f1-adb1-00155d0ab410";
const APPLY = process.argv.includes("--apply");
const inr = (n: unknown) => "Rs " + Math.round(Number(n || 0)).toLocaleString("en-IN");

// The engine's own eligibility rule (employment-end-date.ts), inlined so this script reports the
// same population the recalculation will actually select.
const END = `COALESCE(
  (SELECT COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed)
     FROM exit_request x
    WHERE x.employee_id = e.id
      AND LOWER(x.status) IN ('accepted','notice_serving','exited')
    ORDER BY COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed) DESC
    LIMIT 1),
  e.date_of_exit, e.date_of_leaving)`;

const [rows] = await db.execute<RowDataPacket[]>(
  `SELECT e.id, e.employee_code c, DATE_FORMAT(${END}, '%Y-%m-%d') endd,
          (SELECT ROUND(SUM(CASE a.attendance_status WHEN 'present' THEN 1
                                                     WHEN 'half_day' THEN 0.5 ELSE 0 END), 1)
             FROM attendance_daily_record a
            WHERE a.employee_id = e.id
              AND a.record_date BETWEEN CONCAT(?, '-01') AND LAST_DAY(CONCAT(?, '-01'))) days
     FROM employees e
     -- Same point-in-time salary join the engine uses: no assignment means no line is possible.
     JOIN employee_salary_assignment esa ON esa.id = COALESCE(
          (SELECT p.id FROM employee_salary_assignment p
            WHERE p.employee_id = e.id AND p.effective_from <= LAST_DAY(CONCAT(?, '-01'))
            ORDER BY p.effective_from DESC, p.active_status DESC, p.created_at DESC LIMIT 1),
          (SELECT a2.id FROM employee_salary_assignment a2
            WHERE a2.employee_id = e.id AND a2.active_status = 1
            ORDER BY a2.effective_from DESC, a2.created_at DESC LIMIT 1))
     JOIN salary_structure_master ss ON ss.id = esa.structure_id
    WHERE COALESCE(e.salary_start_date, e.date_of_joining) <= LAST_DAY(CONCAT(?, '-01'))
      AND ( ${END} >= CONCAT(?, '-01')
            OR (${END} IS NULL AND LOWER(e.employment_status) = 'active') )
      AND NOT EXISTS (SELECT 1 FROM salary_prep_line l WHERE l.run_id = ? AND l.employee_id = e.id)
    ORDER BY days DESC`,
  [MONTH, MONTH, MONTH, MONTH, MONTH, RUN],
);

console.log(`eligible for ${MONTH} with no line in the run: ${rows.length}`);
if (!rows.length) { console.log("nothing to add"); process.exit(0); }
console.table(rows.map((r) => ({ code: r.c, end: r.endd ?? "-", augDays: r.days ?? 0 })));

const totals = async () => {
  const [t] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) n, COALESCE(SUM(net_salary),0) net, COALESCE(SUM(final_payable_days),0) days
       FROM salary_prep_line WHERE run_id = ?`, [RUN]);
  return t[0];
};

const before = await totals();
console.log(`before: ${before.n} lines, ${before.days} payable days, ${inr(before.net)}`);

if (!APPLY) { console.log("\nDRY RUN — pass --apply to recalculate."); process.exit(0); }

const res = await calculatePayrollRunScoped(RUN, ACTOR, { employeeIds: rows.map((r) => String(r.id)) });
console.log("engine result:", JSON.stringify(res));

const after = await totals();
console.log(`after:  ${after.n} lines, ${after.days} payable days, ${inr(after.net)}`);
console.log(`delta:  +${Number(after.n) - Number(before.n)} lines, ` +
  `+${Number(after.days) - Number(before.days)} days, +${inr(Number(after.net) - Number(before.net))}`);

const ids = rows.map((r) => String(r.id));
const [added] = await db.execute<RowDataPacket[]>(
  `SELECT employee_code, present_days, eligible_holiday_days, final_payable_days, net_salary
     FROM salary_prep_line
    WHERE run_id = ? AND employee_id IN (${ids.map(() => "?").join(",")})
    ORDER BY net_salary DESC`, [RUN, ...ids]);
console.table(added);
process.exit(0);
