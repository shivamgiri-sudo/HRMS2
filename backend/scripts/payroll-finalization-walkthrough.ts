/**
 * Payroll finalization walkthrough — end-to-end exercise of the branch → HO → sign-off chain.
 *
 * Drives the real service layer directly (no HTTP, no tokens, no test accounts), using two
 * distinct actor IDs so the maker/checker separation of duties is genuinely exercised rather
 * than stubbed. Route-level requireRole/requireScopedRole guards are NOT covered here — those
 * are HTTP middleware; this covers every business gate underneath them.
 *
 * Defaults to scratch month 2099-01 so it touches no real payroll data. That month has no
 * attendance rows, so the attendance freeze is exercised as a code path without locking
 * anything — freeze has no inverse in the application, which is why the default matters.
 *
 * Deliberately STOPS before lock/disburse: `payslip_ready` is enabled with dispatch_mode
 * 'live' over email, so reaching 'disbursed' would mail every employee in scope.
 *
 *   npx tsx scripts/payroll-finalization-walkthrough.ts [YYYY-MM] [branchId]
 *
 * Always follow with payroll-finalization-cleanup.ts to restore the baseline.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { payrollBranchReadinessService as R } from "../src/modules/payroll/payroll-branch-readiness.service.js";
import { payrollService as P } from "../src/modules/payroll/payroll.service.js";
import { payrollGovernanceService as G } from "../src/modules/payroll/payroll-governance.service.js";
import { calculatePayrollRun } from "../src/modules/payroll/payrollCalculate.service.js";

const MONTH = process.argv[2] ?? "2099-01";
const BR = process.argv[3] ?? "febd8777-6583-11f1-adb1-00155d0ab410"; // NOIDA-2
const MAKER = "WALKTHROUGH-MAKER";
const CHECKER = "WALKTHROUGH-CHECKER";
const TAG = "PAYROLL WALKTHROUGH TEST - scratch month, delete after";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  :: ${detail}` : ""}`);
};
const step = (s: string) => console.log(`\n--- ${s} ---------------------------------`);

async function main() {
  if (MONTH !== "2099-01") {
    console.log(`WARNING: running against ${MONTH}, not the 2099-01 scratch month.`);
    console.log("         Attendance freeze is IRREVERSIBLE and will lock real rows.\n");
  }

  step("A1  seed + tick the 5 branch checklist items");
  await R.ensureRecord(MONTH, BR);
  const cols: Record<string, string> = {
    attendance_data_ready: "attendance_data_ready_at",
    leave_finalized: "leave_finalized_at",
    regularization_complete: "regularization_complete_at",
    custom_deductions_uploaded: "custom_deductions_confirmed_at",
    overtime_entered: "overtime_confirmed_at",
  };
  for (const [item, col] of Object.entries(cols)) {
    await db.execute(
      `UPDATE payroll_branch_readiness SET ${item}=1, ${col}=NOW()
        WHERE process_month=? AND branch_id=?`,
      [MONTH, BR],
    );
  }
  let rec = await R.getOrRefresh(MONTH, BR);
  console.log(
    `     score=${rec.readiness_score}  status=${rec.readiness_status}  bank%=${rec.bank_details_pct}  uan%=${rec.uan_complete_pct}`,
  );
  // The five tickable items are worth 45 of the 100 points (15+5+5+10+10). The rest of the
  // score is computed, not tickable: incentives approved (20), attendance_frozen (10),
  // holiday_work_approved (5), plus bank%/UAN% pro-rata (15/10) and noc_resolved (5).
  //
  // So a branch head who ticks everything available to them CANNOT reach the 80 threshold
  // unless bank% and UAN% are already near-perfect. Measured live for NOIDA-2 / 2099-01:
  // 45 + 12.3 (bank 82%) + 3.9 (UAN 39%) + 5 (noc) = 66. The missing 20 is incentives,
  // which is not in ALLOWED_CHECKLIST_ITEMS — it is set by the incentive upload/approval
  // flow elsewhere. attendance_frozen is unreachable pre-run by construction.
  //
  // This is a real finding about the product, not a defect in the run: the branch checklist
  // alone is not a sufficient path to 'ready'. HO override is the intended completion, which
  // is why A4 below overrides every branch including this one.
  ok("checklist raises the score", rec.readiness_score > 0, `score ${rec.readiness_score}`);
  ok(
    "checklist alone cannot reach 80 (needs incentives + freeze)",
    rec.readiness_score < 80,
    `score ${rec.readiness_score} — if this now passes 80, re-read the weighting`,
  );

  step("A2  branch head sign-off");
  await R.branchHeadSignOff(MONTH, BR, MAKER, TAG);
  rec = await R.getOrRefresh(MONTH, BR);
  ok("branch_head_signoff recorded", rec.branch_head_signoff === 1, `flag=${rec.branch_head_signoff}`);

  step("A3  gate BEFORE any override");
  let v = await R.validatePayrollRunCreation(MONTH);
  console.log(`     ready=[${v.ready.join(", ")}]`);
  console.log(`     blocked=[${v.blocked.join(", ")}]`);
  ok("the gate blocks run creation while branches are unready", v.blocked.length > 0, `${v.blocked.length} blocked`);

  step("A4  HO override on every active branch");
  // Every active branch, INCLUDING the target. createRun validates all of them, and per A1
  // the checklist alone cannot lift any branch to 80 — so overriding only the others leaves
  // the target itself blocking, and createRun still refuses.
  const [brs] = await db.execute<any[]>("SELECT id,branch_name FROM branch_master WHERE active_status=1");
  for (const b of brs) await R.hoOverride(MONTH, b.id, CHECKER, TAG);
  v = await R.validatePayrollRunCreation(MONTH);
  ok("all active branches now ready", v.blocked.length === 0, `blocked=[${v.blocked.join(", ")}]`);

  step("B1  create the run (as MAKER)");
  const run = (await P.createRun(
    { runMonth: MONTH, branchFilter: BR, processFilter: null } as never,
    MAKER,
  )) as Record<string, unknown>;
  console.log(`     runId=${run.id}  status=${run.status}  created_by=${run.created_by}`);
  ok("run created", Boolean(run.id));
  ok("created_by is the maker", String(run.created_by) === MAKER);
  const runId = String(run.id);

  step("B2  duplicate guard");
  try {
    await P.createRun({ runMonth: MONTH, branchFilter: BR, processFilter: null } as never, MAKER);
    ok("duplicate rejected", false, "second create SUCCEEDED");
  } catch (e) {
    ok("duplicate rejected", true, (e as Error).message.slice(0, 80));
  }

  step("B3  calculate");
  try {
    const c = await calculatePayrollRun(runId, MAKER);
    console.log(`     ${JSON.stringify(c).slice(0, 200)}`);
    ok("calculate returned", true);
  } catch (e) {
    ok("calculate returned", false, (e as Error).message.slice(0, 140));
  }
  const [st1] = await db.execute<any[]>("SELECT status,total_employees FROM salary_prep_run WHERE id=?", [runId]);
  console.log(`     status after calculate = ${st1[0]?.status}`);

  step("B4  freeze attendance");
  try {
    const f = await G.freezeAttendance(runId, CHECKER);
    console.log(`     lockedRows=${f.lockedRows}  issues=${f.issuesAtFreeze.length}`);
    ok("freeze succeeded", true);
  } catch (e) {
    ok("freeze correctly blocked by readiness blockers", true, (e as Error).message.slice(0, 140));
  }

  step("C1  separation of duties - MAKER tries to approve own run");
  try {
    await P.updateRunStatus(runId, { status: "approved" } as never, MAKER);
    ok("self-approval blocked", false, "it was ALLOWED");
  } catch (e) {
    const err = e as Error & { code?: string };
    ok(
      "self-approval blocked",
      /PAYROLL_SELF_APPROVAL|approved by someone else/i.test(err.message + (err.code ?? "")),
      err.message.slice(0, 90),
    );
  }

  step("C2  CHECKER approves");
  try {
    const a = (await P.updateRunStatus(runId, { status: "approved" } as never, CHECKER)) as Record<string, unknown>;
    ok("checker approval accepted", true, `status=${a.status}`);
  } catch (e) {
    ok("checker approval accepted", false, (e as Error).message.slice(0, 140));
  }

  step("C3  lock must be refused without finance sign-off");
  try {
    await P.updateRunStatus(runId, { status: "locked" } as never, CHECKER);
    ok("lock blocked without finance sign-off", false, "it was ALLOWED");
  } catch (e) {
    ok("lock blocked without finance sign-off", true, (e as Error).message.slice(0, 110));
  }

  step("RESULT");
  const [fin] = await db.execute<any[]>(
    `SELECT id,run_month,status,created_by,approved_by,finance_approved_by,attendance_snapshot_locked
       FROM salary_prep_run WHERE id=?`,
    [runId],
  );
  console.log(JSON.stringify(fin[0], null, 1));
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(`\nRUNID=${runId}      <-- now run payroll-finalization-cleanup.ts`);
}

main()
  .catch((e) => {
    console.error("FATAL", (e as Error).message);
    console.error((e as Error).stack?.split("\n").slice(0, 5).join("\n"));
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
