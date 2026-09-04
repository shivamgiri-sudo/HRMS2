import { describe, expect, it } from "vitest";
import {
  HALF_DAY_ALREADY_FULL,
  HALF_DAY_ATTENDANCE_TRANSITION,
  HALF_DAY_LEAVE_CODES,
  halfDayAttendanceTarget,
  halfDayRefusalMessage,
} from "../leave.service.js";

/**
 * The half-day rules, owner-decided 2026-09-04.
 *
 * These are asserted as PAY outcomes, not just status strings, because the status IS the pay:
 * payrollCalculate.service.ts's paid_base scores present 1.0, late 1.0, half_day 0.5,
 * leave_approved 1.0, everything else 0. A regression that swapped 'half_day' for
 * 'leave_approved' here would silently pay every half-day leave as a full day — which is
 * exactly the bug this replaced, and it is invisible in any leave-side assertion.
 */

/** payrollCalculate.service.ts paid_base, mirrored so the tests state the money, not the label. */
const PAYROLL_DAY_VALUE: Record<string, number> = {
  present: 1.0,
  late: 1.0,
  half_day: 0.5,
  leave_approved: 1.0,
};
const pays = (status: string | null) => (status === null ? null : PAYROLL_DAY_VALUE[status] ?? 0);

describe("a half day on an unpaid day makes it a half-paid day", () => {
  it.each([
    ["absent", 0],
    ["missing_punch", 0],
    ["unreconciled", 0],
  ])("%s (pays %d) becomes half_day, paying 0.5", (existing) => {
    const target = halfDayAttendanceTarget(existing);
    expect(target).toBe("half_day");
    expect(pays(target)).toBe(0.5);
  });

  it("a date with no attendance row at all also becomes half_day", () => {
    // Nothing recorded means nothing paid, so it behaves exactly like 'absent'. This is the
    // common case for leave applied against a past month before attendance was written.
    expect(halfDayAttendanceTarget(null)).toBe("half_day");
    expect(halfDayAttendanceTarget(undefined)).toBe("half_day");
    expect(halfDayAttendanceTarget("")).toBe("half_day");
    expect(pays(halfDayAttendanceTarget(null))).toBe(0.5);
  });
});

describe("a half day on an existing half day completes it", () => {
  it("half_day becomes present, taking the day from 0.5 to a full 1.0", () => {
    const target = halfDayAttendanceTarget("half_day");
    expect(target).toBe("present");
    expect(pays(target)).toBe(1.0);
  });

  it("records it as worked, not as a whole day of leave", () => {
    // Owner decision (a). 'leave_approved' would pay the same 1.0 but would book the ENTIRE
    // day as leave in attendance reporting, overstating leave taken for a day half of which
    // was genuinely worked.
    expect(halfDayAttendanceTarget("half_day")).not.toBe("leave_approved");
  });
});

describe("a half day on an already fully paid day is refused", () => {
  it.each([...HALF_DAY_ALREADY_FULL])("%s is refused rather than transitioned", (existing) => {
    // Owner decision (c). Silently allowing it would leave pay at 1.0 while still spending
    // half a day of CL/ML balance — the employee loses balance and gains nothing.
    expect(halfDayAttendanceTarget(existing)).toBeNull();
  });

  it("every refused status is one that already pays a full day", () => {
    for (const status of HALF_DAY_ALREADY_FULL) expect(pays(status)).toBe(1.0);
  });

  it("names the day and the blocking status so the row error is actionable", () => {
    const msg = halfDayRefusalMessage("2026-08-14", "leave_approved");
    expect(msg).toContain("2026-08-14");
    expect(msg).toContain("leave approved");
  });
});

describe("the transition table cannot drift from what payroll actually pays", () => {
  it("never maps a day to a status payroll scores at zero", () => {
    // A target payroll scores 0 would mean applying leave made the employee WORSE off.
    for (const target of Object.values(HALF_DAY_ATTENDANCE_TRANSITION)) {
      expect(pays(target)).toBeGreaterThan(0);
    }
  });

  it("never decreases the value of a day", () => {
    for (const [from, to] of Object.entries(HALF_DAY_ATTENDANCE_TRANSITION)) {
      expect(pays(to)!).toBeGreaterThan(pays(from) ?? 0);
    }
  });

  it("adds exactly half a day of pay in every mapped case", () => {
    // This is the whole point of the feature: 0.5 of leave buys 0.5 of pay, never 1.0.
    for (const [from, to] of Object.entries(HALF_DAY_ATTENDANCE_TRANSITION)) {
      expect(pays(to)! - (pays(from) ?? 0)).toBeCloseTo(0.5, 5);
    }
  });

  it("no status is both transitionable and already-full", () => {
    for (const key of Object.keys(HALF_DAY_ATTENDANCE_TRANSITION)) {
      expect(HALF_DAY_ALREADY_FULL.has(key)).toBe(false);
    }
  });

  it("an unrecognised status falls back to half_day rather than throwing", () => {
    // A new attendance_status added later must not crash approval; the safe default is the
    // conservative one — half a day's pay, never a full one.
    expect(halfDayAttendanceTarget("some_future_status")).toBe("half_day");
    expect(pays(halfDayAttendanceTarget("some_future_status"))).toBe(0.5);
  });
});

describe("the half-day bucket is CL and ML only", () => {
  it("allows exactly CL and ML", () => {
    expect([...HALF_DAY_LEAVE_CODES].sort()).toEqual(["CL", "ML"]);
  });

  it.each(["EL", "LWP", "SL", "PL", "MTRL", "CO", "DL", "PML", "PTRL"])(
    "%s is not a half-day type",
    (code) => expect(HALF_DAY_LEAVE_CODES.has(code)).toBe(false),
  );
});
