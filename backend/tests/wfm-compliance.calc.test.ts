import { describe, expect, it } from "vitest";
import {
  addDays,
  classifyAttendance,
  compliancePercent,
  evaluateRules,
  isoWeekStart,
  pointsDelta,
  previousMonth,
  summarizeAttendance,
  summarizeMonth,
  type RosterDay,
  type ShiftTemplate,
} from "../src/modules/wfm/wfm-compliance.calc.js";

const tpl = (
  id: string,
  startMin: number,
  endMin: number,
  extra: Partial<ShiftTemplate> = {},
): ShiftTemplate => ({
  id,
  name: id,
  startMin,
  endMin,
  nightShift: false,
  productiveMinutes: null,
  breakMinutes: 60,
  ...extra,
});
const DAY = tpl("day", 9 * 60, 18 * 60, { productiveMinutes: 480 });
const LATE_DAY = tpl("late", 22 * 60, 6 * 60, {
  nightShift: true,
  productiveMinutes: 480,
}); // 22:00 -> 06:00 next day
const EARLY = tpl("early", 6 * 60, 14 * 60, { productiveMinutes: 480 });
const templates = new Map([DAY, LATE_DAY, EARLY].map((t) => [t.id, t]));

const work = (emp: string, date: string, shiftId = "day"): RosterDay => ({
  employeeId: emp,
  date,
  isWeekOff: false,
  shiftId,
});
const off = (emp: string, date: string): RosterDay => ({
  employeeId: emp,
  date,
  isWeekOff: true,
  shiftId: null,
});
const run = (
  start: string,
  n: number,
  mk: (d: string, i: number) => RosterDay,
) => Array.from({ length: n }, (_, i) => mk(addDays(start, i), i));

describe("date helpers", () => {
  it("isoWeekStart is Monday", () => {
    expect(isoWeekStart("2026-09-30")).toBe("2026-09-28"); // Wed -> Mon
    expect(isoWeekStart("2026-09-28")).toBe("2026-09-28");
    expect(isoWeekStart("2026-10-04")).toBe("2026-09-28"); // Sun
  });
  it("previousMonth crosses the year", () =>
    expect(previousMonth("2026-01")).toBe("2025-12"));
});

describe("MIN_REST", () => {
  it("flags 0h rest when a night shift ends exactly as the next early shift starts", () => {
    // late 22:00-06:00 on the 1st ends 06:00 on the 2nd; early starts 06:00 on the 2nd -> 0h rest
    const inc = evaluateRules(
      [work("e", "2026-09-01", "late"), work("e", "2026-09-02", "early")],
      templates,
    );
    expect(inc.map((i) => i.ruleId)).toEqual(["MIN_REST"]);
  });
  it("does NOT flag a normal overnight shift followed by an evening start (used to yield negative rest)", () => {
    // night ends 06:00 on the 2nd, next night starts 22:00 on the 2nd = 16h rest
    const inc = evaluateRules(
      [work("e", "2026-09-01", "late"), work("e", "2026-09-02", "late")],
      templates,
    );
    expect(inc.filter((i) => i.ruleId === "MIN_REST")).toHaveLength(0);
  });
  it("ignores week-off days and non-adjacent dates", () => {
    const inc = evaluateRules(
      [
        work("e", "2026-09-01", "late"),
        off("e", "2026-09-02"),
        work("e", "2026-09-04", "early"),
      ],
      templates,
    );
    expect(inc.filter((i) => i.ruleId === "MIN_REST")).toHaveLength(0);
  });
});

describe("CONSECUTIVE_DAYS", () => {
  it("6 days ok, 7 flagged once with streak length", () => {
    expect(
      evaluateRules(
        run("2026-09-01", 6, (d) => work("e", d)),
        templates,
      ).filter((i) => i.ruleId === "CONSECUTIVE_DAYS"),
    ).toHaveLength(0);
    const inc = evaluateRules(
      run("2026-09-01", 9, (d) => work("e", d)),
      templates,
    ).filter((i) => i.ruleId === "CONSECUTIVE_DAYS");
    expect(inc).toHaveLength(1);
    expect(inc[0].date).toBe("2026-09-07");
    expect(inc[0].detail).toContain("9 consecutive");
  });
  it("a week-off or a missing date resets the streak", () => {
    const days = [
      ...run("2026-09-01", 6, (d) => work("e", d)),
      off("e", "2026-09-07"),
      ...run("2026-09-08", 6, (d) => work("e", d)),
    ];
    expect(
      evaluateRules(days, templates).filter(
        (i) => i.ruleId === "CONSECUTIVE_DAYS",
      ),
    ).toHaveLength(0);
  });
  it("keeps employees separate", () => {
    const days = [
      ...run("2026-09-01", 4, (d) => work("a", d)),
      ...run("2026-09-05", 4, (d) => work("b", d)),
    ];
    expect(
      evaluateRules(days, templates).filter(
        (i) => i.ruleId === "CONSECUTIVE_DAYS",
      ),
    ).toHaveLength(0);
  });
});

describe("WEEKOFF_FAIRNESS", () => {
  it("flags an employee with ZERO week-offs (previously invisible: only employees with >=1 week-off were grouped)", () => {
    const inc = evaluateRules(
      run("2026-09-01", 30, (d) => work("e", d)),
      templates,
    ).filter((i) => i.ruleId === "WEEKOFF_FAIRNESS");
    expect(inc).toHaveLength(1);
    expect(inc[0].detail).toContain("0 week-off");
  });
  it("threshold scales with rostered days: 10 days needs 1, 30 days needs 4", () => {
    const ten = run("2026-09-01", 10, (d, i) =>
      i === 6 ? off("e", d) : work("e", d),
    );
    expect(
      evaluateRules(ten, templates).filter(
        (i) => i.ruleId === "WEEKOFF_FAIRNESS",
      ),
    ).toHaveLength(0);
    const thirty = run("2026-09-01", 30, (d, i) =>
      i % 7 === 6 && i < 21 ? off("e", d) : work("e", d),
    ); // only 3 offs
    expect(
      evaluateRules(thirty, templates).filter(
        (i) => i.ruleId === "WEEKOFF_FAIRNESS",
      ),
    ).toHaveLength(1);
  });
  it("does not evaluate a month with fewer than 7 rostered days", () => {
    expect(
      evaluateRules(
        run("2026-09-01", 5, (d) => work("e", d)),
        templates,
      ).filter((i) => i.ruleId === "WEEKOFF_FAIRNESS"),
    ).toHaveLength(0);
  });
});

describe("MAX_HOURS", () => {
  it("6 x 8h = 48h is fine; 7 x 8h = 56h flags on the day the cap is crossed (Mon-Sun week)", () => {
    const six = run("2026-09-28", 6, (d) => work("e", d));
    expect(
      evaluateRules(six, templates).filter((i) => i.ruleId === "MAX_HOURS"),
    ).toHaveLength(0);
    const seven = run("2026-09-28", 7, (d) => work("e", d));
    const inc = evaluateRules(seven, templates).filter(
      (i) => i.ruleId === "MAX_HOURS",
    );
    expect(inc).toHaveLength(1);
    expect(inc[0].date).toBe("2026-10-04");
  });
  it("hours across a week split by Sunday are not merged", () => {
    const days = run("2026-09-30", 7, (d) => work("e", d)); // Wed..Tue crosses two ISO weeks
    expect(
      evaluateRules(days, templates).filter((i) => i.ruleId === "MAX_HOURS"),
    ).toHaveLength(0);
  });
});

describe("NIGHT_SHIFT_LIMIT", () => {
  it("6 consecutive nights flagged, 5 not", () => {
    expect(
      evaluateRules(
        run("2026-09-01", 5, (d) => work("e", d, "late")),
        templates,
      ).filter((i) => i.ruleId === "NIGHT_SHIFT_LIMIT"),
    ).toHaveLength(0);
    expect(
      evaluateRules(
        run("2026-09-01", 6, (d) => work("e", d, "late")),
        templates,
      ).filter((i) => i.ruleId === "NIGHT_SHIFT_LIMIT"),
    ).toHaveLength(1);
  });
});

describe("scoring", () => {
  it("never reports a fake 100% when nobody is rostered", () =>
    expect(compliancePercent(0, 0)).toBeNull());
  it("caps at 99.9 while any breach exists", () => {
    expect(compliancePercent(1, 5000)).toBe(99.9);
    expect(compliancePercent(0, 5000)).toBe(100);
    expect(compliancePercent(5, 10)).toBe(50);
  });
  it("pointsDelta is null when either side is missing", () => {
    expect(pointsDelta(80, null)).toBeNull();
    expect(pointsDelta(80.5, 75)).toBe(5.5);
  });
  it("summary, per-rule counts and employees agree with the incident list", () => {
    const days = [
      ...run("2026-09-01", 30, (d) => work("a", d)),
      ...run("2026-09-01", 30, (d, i) =>
        i % 7 === 6 ? off("b", d) : work("b", d),
      ),
    ];
    const inc = evaluateRules(days, templates);
    const s = summarizeMonth(inc, days, "2026-09");
    expect(s.rostered).toBe(2);
    expect(s.employeesWithViolations).toBe(1);
    expect(s.compliancePct).toBe(50);
    expect(s.totalViolations).toBe(
      s.rules.reduce((n, r) => n + r.violationCount, 0),
    );
  });
});

describe("attendance", () => {
  it("excuses leave/holiday, separates unreconciled from absent", () => {
    expect(classifyAttendance("leave_approved", 0)).toBe("excused");
    expect(classifyAttendance("holiday", 0)).toBe("excused");
    expect(classifyAttendance(null, 0)).toBe("unreconciled");
    expect(classifyAttendance("absent", 0)).toBe("absent");
    expect(classifyAttendance("present", 1)).toBe("late");
  });
  it("adherence excludes excused days from the denominator and is null with nothing measurable", () => {
    const s = summarizeAttendance([
      { status: "present", late: 0, n: 8 },
      { status: "absent", late: 0, n: 1 },
      { status: null, late: 0, n: 1 },
      { status: "leave_approved", late: 0, n: 5 },
    ]);
    expect(s.adherencePct).toBe(80);
    expect(
      summarizeAttendance([{ status: "holiday", late: 0, n: 3 }]).adherencePct,
    ).toBeNull();
  });
});
