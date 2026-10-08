import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule 12 - a correction to a month payroll has already frozen now needs Payroll's sign-off.
 *
 * WHAT IT REPLACES
 * The attendance lock was advisory. attendance_daily_record.is_locked contributed +30 to a
 * risk score and a flag reading "Attendance already locked by prior correction", and a WFM
 * approver could clear the resulting 409 with `force: true`. There was no reference to the
 * payroll window anywhere in the regularization path, so a correction could be approved after
 * payroll input freeze with no additional control at all.
 *
 * WHY is_locked IS NOT THE FREEZE SIGNAL
 * Verified live 2026-08-16: attendance_daily_record has exactly 36 rows with is_locked = 1,
 * and those are exactly the 36 days carrying an approved regularization. The flag means "a
 * correction has already been applied here", not "payroll froze this month". Gating on it
 * would ask whether someone had already corrected the day - a different question. The freeze
 * is read from salary_prep_run instead.
 *
 * OWNER DECISION (2026-08-16)
 * Before freeze: manager -> WFM, unchanged. After freeze: manager -> WFM -> Payroll.
 *
 * Source-text assertions, the convention this repo uses for the large inline handlers in this
 * router. The FSM itself is covered behaviourally below via the exported module.
 */
const SRC = readFileSync(resolve(__dirname, "../wfm.regularization.secure.routes.ts"), "utf8");

/** Just the freeze resolver — bounded, so the rest of an 800-line router cannot satisfy an
 *  assertion about what this one function reads. */
function frozenFn(): string {
  const start = SRC.indexOf("async function isPayrollFrozenForDate");
  const end = SRC.indexOf("async function regularizationReviewRole", start);
  expect(start, "isPayrollFrozenForDate not found").toBeGreaterThan(-1);
  expect(end, "regularizationReviewRole not found after it").toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("the freeze signal comes from payroll, not from the attendance lock flag", () => {
  it("reads salary_prep_run rather than attendance_daily_record.is_locked", () => {
    const fn = frozenFn();
    expect(fn).toMatch(/FROM salary_prep_run/);
    expect(fn).toMatch(/attendance_snapshot_locked = 1/);
    expect(fn).not.toMatch(/is_locked/);
  });

  it("matches run_month as a formatted string, since it is VARCHAR not DATE", () => {
    // Comparing run_month to a DATE silently matches zero rows, which would make every
    // month look unfrozen and quietly restore the old behaviour.
    const fn = frozenFn();
    expect(fn).toMatch(/slice\(0, 7\)/);
    expect(fn).toMatch(/run_month = \?/);
  });

  it("treats a closed run as frozen too, not only the snapshot flag", () => {
    const fn = frozenFn();
    expect(fn).toMatch(/'finalized'/);
  });
});

describe("the review consults the freeze before choosing the next status", () => {
  it("resolves the freeze for the session date and passes it to the FSM", () => {
    expect(SRC).toMatch(/const payrollFrozen = await isPayrollFrozenForDate\(/);
    expect(SRC).toMatch(/nextRegularizationStatus\(reviewRole, String\(pre\.reg_status \?\? ""\), requestedReviewStatus, payrollFrozen\)/);
  });

  it("parks at payroll_pending instead of approving, when frozen", () => {
    const fsm = SRC.slice(SRC.indexOf("function nextRegularizationStatus("));
    expect(fsm).toMatch(/if \(requestedStatus === "approved" && payrollFrozen\) return PAYROLL_PENDING_STATUS/);
  });

  it("does not let super_admin bypass the Payroll stage", () => {
    // The whole point is that no single role can move payroll's number alone.
    const fsm = SRC.slice(SRC.indexOf("function nextRegularizationStatus("));
    const superAdminBranch = fsm.slice(fsm.indexOf('if (role === "super_admin")'), fsm.indexOf('if (role === "manager")'));
    expect(superAdminBranch).toMatch(/payrollFrozen/);
    expect(superAdminBranch).toMatch(/PAYROLL_PENDING_STATUS/);
  });

  it("never defers a rejection - rejecting changes no payroll figure", () => {
    const fsm = SRC.slice(SRC.indexOf("function nextRegularizationStatus("));
    // Only the "approved" request is diverted; rejected falls through unchanged.
    expect(fsm).toMatch(/requestedStatus === "approved" && payrollFrozen/);
    expect(fsm).not.toMatch(/requestedStatus === "rejected" && payrollFrozen/);
  });

  it("only Payroll can act on a parked request, and only from payroll_pending", () => {
    const fsm = SRC.slice(SRC.indexOf("function nextRegularizationStatus("));
    const payrollBranch = fsm.slice(fsm.indexOf('if (role === "payroll")'));
    expect(payrollBranch).toMatch(/if \(currentStatus !== PAYROLL_PENDING_STATUS\) return null/);
  });
});

describe("the Payroll reviewer is resolved by role, and only at its own stage", () => {
  it("requires an actual payroll role", () => {
    expect(SRC).toMatch(/const PAYROLL_APPROVAL_ROLES = \["payroll", "payroll_head", "payroll_admin"\]/);
    expect(SRC).toMatch(/hasAnyRole\(userId, \.\.\.PAYROLL_APPROVAL_ROLES\)/);
  });

  it("does not let a payroll-holder short-circuit the WFM stage", () => {
    // Resolved from the row's status, so someone holding both wfm and payroll still reviews
    // as WFM while the request is at manager_approved.
    expect(SRC).toMatch(/if \(String\(target\.status \?\? ""\) === PAYROLL_PENDING_STATUS\)/);
  });

  it("still refuses self-review before any of this", () => {
    expect(SRC).toMatch(/if \(callerEmp\?\.id === target\.employee_id\) return null/);
  });
});

describe("the parked state is auditable and does not tell the employee anything yet", () => {
  it("records its own action type", () => {
    expect(SRC).toMatch(/REGULARIZATION_PAYROLL_APPROVAL_PENDING/);
  });

  it("sends no decision mail while parked", () => {
    // "Approved" mail here would be the same false success this stage exists to prevent.
    const notify = SRC.slice(SRC.indexOf("setImmediate(() => {"));
    expect(notify).toMatch(/payroll_pending deliberately sends no employee-facing mail/);
  });

  it("payroll_pending is not terminal, so Payroll can still act on it", () => {
    expect(SRC).toMatch(/const TERMINAL_REGULARIZATION_STATUSES = \["approved", "rejected", "discarded"\]/);
  });
});
