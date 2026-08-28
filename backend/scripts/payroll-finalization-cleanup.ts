/**
 * Cleanup for payroll-finalization-walkthrough.ts — restores the scratch month to its
 * pre-test baseline and self-verifies.
 *
 * Baseline for 2099-01, captured read-only 2026-08-28:
 *   salary_prep_run          WHERE run_month='2099-01'      -> 0 rows
 *   payroll_branch_readiness WHERE process_month='2099-01'  -> 7 rows, ALL flags 0
 *
 *   npx tsx scripts/payroll-finalization-cleanup.ts [YYYY-MM]
 *
 * Audit rows in payroll_calculation_audit are REPORTED, never deleted. Scrubbing an audit
 * trail is worse practice than leaving a test breadcrumb in it — remove them by hand if you
 * genuinely need to.
 *
 * BASELINE_IDS applies to 2099-01 only. Against any other month the row-count assertion is
 * skipped, since the correct baseline there is unknown to this script.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";

const MONTH = process.argv[2] ?? "2099-01";

/** The 7 payroll_branch_readiness rows that pre-existed in 2099-01. */
const BASELINE_IDS = [
  "fcb66b04-9747-11f1-adb1-00155d0ab410",
  "fd5636e2-9747-11f1-adb1-00155d0ab410",
  "ffc1fdef-9747-11f1-adb1-00155d0ab410",
  "033fd421-9748-11f1-adb1-00155d0ab410",
  "052f2929-9748-11f1-adb1-00155d0ab410",
  "0590a76f-9748-11f1-adb1-00155d0ab410",
  "08f0a804-9748-11f1-adb1-00155d0ab410",
];
const IS_SCRATCH = MONTH === "2099-01";

async function q(sql: string, params: unknown[] = []): Promise<any> {
  const [rows] = await db.execute<any>(sql, params);
  return rows;
}

async function main() {
  console.log(`--- runs to remove (${MONTH}) ---`);
  const runs = await q("SELECT id,status,total_employees FROM salary_prep_run WHERE run_month=?", [MONTH]);
  console.log(runs.length ? JSON.stringify(runs, null, 1) : "  (none)");
  const ids: string[] = runs.map((r: { id: string }) => r.id);

  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const lines = await q(`DELETE FROM salary_prep_line WHERE run_id IN (${ph})`, ids);
    console.log(`  salary_prep_line           deleted ${lines.affectedRows}`);
    const aud = await q(`SELECT COUNT(*) c FROM payroll_calculation_audit WHERE run_id IN (${ph})`, ids);
    console.log(`  payroll_calculation_audit  ${aud[0].c} rows LEFT IN PLACE (audit trail)`);
    const del = await q(`DELETE FROM salary_prep_run WHERE id IN (${ph})`, ids);
    console.log(`  salary_prep_run            deleted ${del.affectedRows}`);
  }

  console.log("\n--- reset readiness flags ---");
  const upd = await q(
    `UPDATE payroll_branch_readiness
        SET attendance_data_ready=0, attendance_data_ready_at=NULL, attendance_data_ready_by=NULL,
            leave_finalized=0, leave_finalized_at=NULL,
            regularization_complete=0, regularization_complete_at=NULL,
            custom_deductions_uploaded=0, custom_deductions_confirmed_at=NULL,
            overtime_entered=0, overtime_confirmed_at=NULL,
            attendance_frozen=0, attendance_frozen_at=NULL, attendance_frozen_by=NULL,
            branch_head_signoff=0, branch_head_signoff_at=NULL, branch_head_signoff_by=NULL, branch_head_remarks=NULL,
            process_manager_signoff=0, process_manager_signoff_at=NULL, process_manager_signoff_by=NULL, process_manager_remarks=NULL,
            ho_override_ready=0, ho_override_by=NULL, ho_override_at=NULL, ho_override_reason=NULL,
            salary_verification_done=0, salary_verification_at=NULL, salary_verification_by=NULL
      WHERE process_month=?`,
    [MONTH],
  );
  console.log(`  reset ${upd.affectedRows} rows`);

  if (IS_SCRATCH) {
    const ph2 = BASELINE_IDS.map(() => "?").join(",");
    const extra = await q(
      `DELETE FROM payroll_branch_readiness WHERE process_month=? AND id NOT IN (${ph2})`,
      [MONTH, ...BASELINE_IDS],
    );
    console.log(`  removed ${extra.affectedRows} rows created by the test`);
  } else {
    console.log("  (non-scratch month: leaving readiness rows in place, flags reset only)");
  }

  console.log("\n--- verify against baseline ---");
  const chk = await q(
    `SELECT (SELECT COUNT(*) FROM salary_prep_run WHERE run_month=?) AS runs,
            (SELECT COUNT(*) FROM payroll_branch_readiness WHERE process_month=?) AS readiness,
            (SELECT COUNT(*) FROM payroll_branch_readiness WHERE process_month=?
               AND (attendance_data_ready+leave_finalized+regularization_complete
                   +custom_deductions_uploaded+overtime_entered+branch_head_signoff
                   +ho_override_ready+attendance_frozen) > 0) AS dirty`,
    [MONTH, MONTH, MONTH],
  );
  const r = chk[0];
  const wantReadiness = IS_SCRATCH ? " (want 7)" : "";
  console.log(`  runs=${r.runs} (want 0)   readiness=${r.readiness}${wantReadiness}   dirty=${r.dirty} (want 0)`);

  const clean =
    Number(r.runs) === 0 && Number(r.dirty) === 0 && (!IS_SCRATCH || Number(r.readiness) === 7);
  console.log(clean ? "\nCLEAN - baseline restored." : "\nNOT CLEAN - inspect manually.");
  if (!clean) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("FATAL", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
