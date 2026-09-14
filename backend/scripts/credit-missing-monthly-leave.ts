/**
 * Top up the CL/ML monthly credits the worker never ran. Additive only — nothing is reduced.
 *
 * WHY. leave_credit_schedule is correct (one whole day in alternate months: CL in 1,3,5,7,8,10,12
 * and ML in 2,4,6,9,11, giving 7 CL + 5 ML a year) and the worker implements it correctly. But
 * the credit log shows the monthly run reached a different, growing population each month — 623
 * employees in January against 1,102 in September — so anyone who joined, or whose worker run was
 * missed, is short the months they should have accrued.
 *
 * WHAT IT DOES NOT DO. It never touches allocated_days downward and never touches used_days at
 * all. Balances currently holding MORE than the schedule explains (CL 8 and ML 7 are common,
 * above even the annual 7/5) are left exactly as they are: correcting those downward would take
 * leave off 1,105 people, and the legacy balance sync is the intended source of truth for that.
 * Additive-only means the worst case here is that someone keeps days they already had.
 *
 * HOW. It calls the worker's own creditMonthlyLeaves() month by month, rather than reimplementing
 * accrual. That function is idempotent per employee/leave type/year/month via leave_el_credit_log,
 * so a month already credited for an employee is skipped and only genuine gaps are filled — and
 * because it is the same code the live worker runs, this cannot drift from it.
 *
 * Dry-run by default: reports the gaps per month and type without writing. Set APPLY=1 to credit.
 *
 * Run: ./node_modules/.bin/tsx scripts/credit-missing-monthly-leave.ts
 *      APPLY=1 ./node_modules/.bin/tsx scripts/credit-missing-monthly-leave.ts
 */
import "dotenv/config";

const APPLY = process.env.APPLY === "1";
const YEAR = Number(process.env.YEAR ?? 2026);
/** Only months that have actually arrived. Defaults to the current month. */
const THROUGH_MONTH = Number(process.env.THROUGH_MONTH ?? new Date().getMonth() + 1);

async function main() {
  const { db } = await import("../src/db/mysql.js");
  const { creditMonthlyLeaves } = await import("../src/workers/leave-monthly-credit.worker.js");

  const [schedule]: any = await db.query(
    `SELECT lcs.month, lcs.leave_code, lcs.credit_days, lt.id AS leave_type_id
       FROM leave_credit_schedule lcs
       JOIN leave_type_master lt ON lt.leave_code = lcs.leave_code AND lt.active_status = 1
      WHERE lcs.month <= ? ORDER BY lcs.month`,
    [THROUGH_MONTH],
  );
  if (!schedule.length) throw new Error("leave_credit_schedule has no rows — nothing to credit from");

  // Who SHOULD have a credit for a given month: active employees whose accrual had started.
  // prorateMonthlyCredit returns 0 for anyone who joined after the month, so they are not a gap.
  const [employees]: any = await db.query(
    `SELECT id, COALESCE(salary_start_date, date_of_joining) AS accrual_start_date
       FROM employees
      WHERE active_status = 1 AND employment_status = 'active'
        AND COALESCE(salary_start_date, date_of_joining) IS NOT NULL`,
  );

  const [logged]: any = await db.query(
    `SELECT employee_id, leave_type_id, credit_month
       FROM leave_el_credit_log
      WHERE credit_year = ? AND credit_type = 'monthly' AND credit_month <= ?`,
    [YEAR, THROUGH_MONTH],
  );
  const have = new Set(logged.map((r: any) => `${r.employee_id}|${r.leave_type_id}|${r.credit_month}`));

  const { leavePolicyService } = await import("../src/modules/leave/leave-policy.service.js");
  const { prorateMonthlyCredit } = leavePolicyService;

  const gaps: Record<string, number> = {};
  let totalGaps = 0;
  for (const s of schedule) {
    const key = `${String(s.month).padStart(2, "0")} ${s.leave_code}`;
    for (const emp of employees) {
      const p = prorateMonthlyCredit(String(emp.accrual_start_date).slice(0, 10), Number(s.month), YEAR);
      // Apply the WORKER'S OWN rounding, not just `p > 0`. Someone who joined on the last day
      // of a month prorates to 1/31 = 0.03, which the worker rounds to 0.0 days and correctly
      // skips without writing a log row. Testing `p > 0` alone reported 45 of those as missing
      // credits that could never be filled — a detector that can never reach zero is one people
      // learn to ignore.
      const daysToCredit = Math.round(p * Number(s.credit_days) * 10) / 10;
      if (daysToCredit <= 0) continue; // not accruing, or rounds to nothing — not a gap
      if (have.has(`${emp.id}|${s.leave_type_id}|${s.month}`)) continue;
      gaps[key] = (gaps[key] ?? 0) + 1;
      totalGaps++;
    }
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${YEAR}, months 1..${THROUGH_MONTH}, ${employees.length} active employees`);
  console.log(`missing monthly credits: ${totalGaps}\n`);
  if (totalGaps) {
    console.table(Object.entries(gaps).sort().map(([k, n]) => {
      const [month, code] = k.split(" ");
      return { month, type: code, employees_missing: n };
    }));
  }

  if (!totalGaps) { console.log("Every scheduled credit is already in place."); await (db as any).end?.(); return; }
  if (!APPLY) { console.log("No changes written. Re-run with APPLY=1 to credit the gaps."); await (db as any).end?.(); return; }

  // The worker's own function, month by month. Idempotent per employee/type/month, so this
  // fills the gaps and leaves everything already credited untouched.
  for (let mo = 1; mo <= THROUGH_MONTH; mo++) {
    await creditMonthlyLeaves(YEAR, mo);
  }

  const [after]: any = await db.query(
    `SELECT COUNT(*) n FROM leave_el_credit_log WHERE credit_year = ? AND credit_type = 'monthly' AND credit_month <= ?`,
    [YEAR, THROUGH_MONTH],
  );
  console.log(`\nCredit rows before: ${logged.length}   after: ${after[0].n}   (+${after[0].n - logged.length})`);
  await (db as any).end?.();
}

main().catch((e) => { console.error("ERR", e instanceof Error ? e.message : String(e)); process.exit(1); });
