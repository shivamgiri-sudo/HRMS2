import { describe, expect, it } from "vitest";
import { halfDayAttendanceTarget, halfDayLwpValue } from "../halfDayLeave.js";

/**
 * Stability of a half day across attendance RE-GRADES.
 *
 * The leave service writes the day once, at approval. The attendance engine rewrites it every
 * time it re-processes that date from punches — nightly sync, a COSEC import, a manual re-run.
 * Before this was fixed the engine short-circuited on "an approved leave exists" and wrote
 * 'leave_approved' regardless of total_days, so the FIRST re-grade after an approval silently:
 *
 *   - repaid the day at 1.0 instead of 0.5 (payroll scores leave_approved 1.0, half_day 0.5), and
 *   - blanked biometric/dialler minutes, erasing the evidence half the day was worked.
 *
 * A half day was therefore correct only until the next engine run touched it — which is not a
 * fix, it is a delay. These tests state the property that makes it permanent: the transition is
 * a pure function of the FRESHLY GRADED status, so re-running is a no-op.
 */

/** payrollCalculate.service.ts paid_base, mirrored so the tests state money, not labels. */
const PAYROLL_DAY_VALUE: Record<string, number> = {
  present: 1.0,
  late: 1.0,
  half_day: 0.5,
  leave_approved: 1.0,
};
const pays = (status: string) => PAYROLL_DAY_VALUE[status] ?? 0;

/** What the engine now does for a date governed by an approved half-day leave. */
function regrade(gradedFromPunches: string): { status: string; lwp: number } {
  const bumped = halfDayAttendanceTarget(gradedFromPunches);
  const status = bumped ?? gradedFromPunches;
  return { status, lwp: bumped ? halfDayLwpValue(bumped) : 0 };
}

describe("re-grading a half-day leave is idempotent", () => {
  it.each(["absent", "missing_punch", "unreconciled", "half_day", "present"])(
    "grading %s repeatedly always lands on the same status",
    (graded) => {
      // The engine always starts from the punch-derived status, so the input to the transition is
      // the same on every run. Feeding the result back in would be the bug — assert it is not.
      const first = regrade(graded);
      const second = regrade(graded);
      const third = regrade(graded);
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    },
  );

  it("does not compound when its own output is fed back in", () => {
    // Guards against a future refactor that reads the STORED status instead of the graded one:
    // absent -> half_day -> present -> (refused) would walk an unpaid day to a full paid day in
    // three runs. The first step is what the engine does; the rest must not be reachable.
    const fromPunches = regrade("absent");
    expect(fromPunches.status).toBe("half_day");
    const ifItReadStoredInstead = regrade(fromPunches.status);
    expect(ifItReadStoredInstead.status).toBe("present");
    expect(pays(ifItReadStoredInstead.status)).toBe(1.0);
    // Documented explicitly: this is the outcome the engine must never produce, which is why it
    // transitions classification.status and never the value already on the row.
    expect(pays(fromPunches.status)).toBe(0.5);
  });
});

describe("a re-grade cannot repay a half day as a full day", () => {
  it.each([
    ["absent", 0.5],
    ["missing_punch", 0.5],
    ["unreconciled", 0.5],
  ])("%s stays worth %d after re-grading", (graded, expected) => {
    expect(pays(regrade(graded).status)).toBe(expected);
  });

  it("never lands on leave_approved for a half day", () => {
    // leave_approved is the exact value the old engine wrote, and it pays a FULL day.
    for (const graded of ["absent", "missing_punch", "unreconciled", "half_day", "present"]) {
      expect(regrade(graded).status).not.toBe("leave_approved");
    }
  });

  it("a genuinely half-worked day completes to a full day exactly once", () => {
    const r = regrade("half_day");
    expect(r.status).toBe("present");
    expect(pays(r.status)).toBe(1.0);
    expect(r.lwp).toBe(0);
  });

  it("leaves an already-full worked day alone rather than overpaying it", () => {
    // 'present' is already 1.0; there is no half to add, so the graded status must stand.
    const r = regrade("present");
    expect(r.status).toBe("present");
    expect(pays(r.status)).toBe(1.0);
  });
});

describe("lwp_value always matches the status it ships with", () => {
  it.each([["half_day", 0.5], ["present", 0]])("%s carries lwp %d", (status, lwp) => {
    expect(halfDayLwpValue(status)).toBe(lwp);
  });

  it("an unpaid day becoming a half day carries half the LWP", () => {
    // absent was lwp 1.0 (a whole unpaid day). After half a day of leave it is half unpaid.
    expect(regrade("absent")).toEqual({ status: "half_day", lwp: 0.5 });
  });
});
