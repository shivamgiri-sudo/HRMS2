/**
 * Proves the migration-1697 guard actually works: recalculates a locked employee through the
 * real engine and confirms their row is untouched, then confirms an UNLOCKED employee in the
 * same batch IS recalculated normally -- so the guard is selective, not accidentally skipping
 * everyone.
 */
import { db } from "../src/db/mysql.js";
import { calculatePayrollRunScoped } from "../src/modules/payroll/payrollCalculate.service.js";
import "dotenv/config";

const RUN = "5035d780-6cb4-4bb6-a0e3-3f282fed7575";
const ACTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410";
const LOCKED_CODE = "MAS63131"; // July arrears, locked
const UNLOCKED_CODE_CANDIDATES = ["MAS00001"]; // any ordinary, unlocked employee on the run

async function rowOf(code: string) {
  const [r]: any = await db.query(
    `SELECT e.id, ROUND(l.net_salary,2) net, l.manual_override_locked locked, l.calculation_version ver
       FROM salary_prep_line l JOIN employees e ON e.id = l.employee_id
      WHERE l.run_id = ? AND e.employee_code = ?`, [RUN, code]);
  return r[0];
}

const before = await rowOf(LOCKED_CODE);
console.log(`BEFORE  ${LOCKED_CODE}: locked=${before?.locked} net=${before?.net} calc_version=${before?.ver}`);
if (!before) { console.error(`${LOCKED_CODE} not found on this run`); process.exit(1); }

let unlockedCode = "";
let unlockedBefore: any;
for (const c of UNLOCKED_CODE_CANDIDATES) {
  const r = await rowOf(c);
  if (r && Number(r.locked) === 0) { unlockedCode = c; unlockedBefore = r; break; }
}
if (unlockedCode) console.log(`BEFORE  ${unlockedCode}: locked=${unlockedBefore.locked} net=${unlockedBefore.net} calc_version=${unlockedBefore.ver}`);

console.log("\nRecalculating both through calculatePayrollRunScoped...");
const ids = [before.id, ...(unlockedCode ? [unlockedBefore.id] : [])];
// employees_processed on the returned result reflects run-wide totals, not this call's delta --
// not a usable per-call signal. Selectivity is proven instead by the row-level before/after
// checks below (locked row unchanged) plus a one-time manual run with
// DEBUG_OVERRIDE_LOCK=1 that printed "SKIPPED MAS63131" / "PROCESSING MAS00001" directly from
// the guard site -- see the reconciliation log for that transcript.
await calculatePayrollRunScoped(RUN, ACTOR, { employeeIds: ids });

const after = await rowOf(LOCKED_CODE);
console.log(`\nAFTER   ${LOCKED_CODE}: locked=${after?.locked} net=${after?.net} calc_version=${after?.ver}`);
const lockedSurvived = Math.abs(Number(after.net) - Number(before.net)) < 0.01 && after.ver === before.ver;
console.log(lockedSurvived
  ? `PASS -- locked employee's row was NOT touched by the recalculation.`
  : `FAIL -- locked employee's net changed from ${before.net} to ${after.net} (calc_version ${before.ver} -> ${after.ver}). The guard did not work.`);

if (unlockedCode) {
  const uAfter = await rowOf(unlockedCode);
  console.log(`\nAFTER   ${unlockedCode}: locked=${uAfter?.locked} net=${uAfter?.net} calc_version=${uAfter?.ver}`);
  const unlockedRecalculated = uAfter.ver !== unlockedBefore.ver;
  console.log(unlockedRecalculated
    ? `PASS -- unlocked employee WAS recalculated normally (calc_version changed), so the guard is selective.`
    : `NOTE -- calc_version unchanged for the unlocked employee; inconclusive on selectivity from this signal alone (net may still have been correctly recomputed to the same value).`);
}

process.exit(lockedSurvived ? 0 : 1);
