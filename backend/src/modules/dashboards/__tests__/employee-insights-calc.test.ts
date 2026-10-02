import { describe, expect, it } from "vitest";
import {
  buildLeaveBalances,
  calendarCell,
  canonicalPayLines,
  cumulativePct,
  daysUntilAnnual,
  summariseLeave,
  summariseMonth,
  todayState,
  ytdTotals,
  type DayRow,
  type PayLine,
} from "../role-insights/providers/employeeCalc.js";

const day = (d: string, s: string, extra: Partial<DayRow> = {}): DayRow => ({ d, s, late: 0, lateBy: 0, lwp: 0, mins: 0, ...extra });

describe("employee dashboard attendance calc", () => {
  const rows = [
    day("2026-10-01", "present"),
    day("2026-10-02", "week_off"),
    day("2026-10-03", "half_day", { lwp: 0.5, late: 1, lateBy: 40 }),
    day("2026-10-04", "leave_approved"),
    day("2026-10-05", "absent", { lwp: 1 }),
    day("2026-10-06", "holiday"),
    day("2026-10-07", "missing_punch"),
    // today: created at start-of-day, not yet reconciled
    day("2026-10-08", "absent", { lwp: 1 }),
  ];
  const s = summariseMonth(rows, "2026-10", "2026-10-08");

  it("never counts today (an unreconciled day would read as an absence)", () => {
    expect(s.absent).toBe(1);
    expect(s.lop).toBe(1.5);
    expect(s.settledThrough).toBe("2026-10-07");
  });

  it("denominator excludes week-off, holiday and approved leave; half day is 0.5", () => {
    // expected = present, half_day, absent, missing_punch
    expect(s.expected).toBe(4);
    expect(s.attended).toBe(1.5);
    expect(s.pct).toBe(37.5);
  });

  it("flags days that still need regularising and the oldest of them", () => {
    expect(s.openDays).toBe(2);
    expect(s.missing).toBe(1);
    expect(s.oldestOpenDay).toBe("2026-10-05");
  });

  it("returns null, not 0%, when no day has completed", () => {
    const empty = summariseMonth([day("2026-10-08", "absent")], "2026-10", "2026-10-08");
    expect(empty.pct).toBeNull();
    expect(empty.settledThrough).toBeNull();
    expect(summariseMonth([], "2026-10", "2026-10-08").pct).toBeNull();
  });

  it("only reads the requested month", () => {
    expect(summariseMonth(rows, "2026-09", "2026-10-08").settledRows).toBe(0);
  });

  it("builds a cumulative series that ends at the month figure", () => {
    const series = cumulativePct(rows, "2026-10", "2026-10-08");
    expect(series.at(-1)).toBe(s.pct);
    expect(series.length).toBe(s.expected);
  });

  it("maps calendar cells with today / future / missing-row handling", () => {
    expect(calendarCell(undefined, "2026-10-20", "2026-10-08", false)).toBe("future");
    expect(calendarCell(rows[7], "2026-10-08", "2026-10-08", false)).toBe("today");
    expect(calendarCell(undefined, "2026-10-06", "2026-10-08", true)).toBe("holiday");
    expect(calendarCell(undefined, "2026-10-06", "2026-10-08", false)).toBe("norecord");
    expect(calendarCell(rows[6], "2026-10-07", "2026-10-08", false)).toBe("missing");
  });
});

describe("employee dashboard leave calc", () => {
  const raw = [
    { code: "CL", name: "Casual Leave", carryForward: false, allocated: 7, used: 2, adjusted: 0 },
    { code: "EL", name: "Earned Leave", carryForward: true, allocated: 18, used: 3, adjusted: 1 },
    { code: "LWP", name: "Leave Without Pay", carryForward: false, allocated: 0, used: 0, adjusted: 0 },
    { code: "MTRL", name: "Maternity Leave", carryForward: false, allocated: 180, used: 0, adjusted: 0 },
    { code: "PTRL", name: "Paternity Leave (Legacy)", carryForward: false, allocated: 4, used: 0, adjusted: 0 },
    { code: "PL", name: "Paternity Leave", carryForward: false, allocated: 5, used: 0, adjusted: 0 },
    { code: "ML", name: "Medical Leave", carryForward: false, allocated: 0, used: 0, adjusted: 0 },
  ];
  const balances = buildLeaveBalances(raw);

  it("drops LWP and types never granted; merges legacy twins", () => {
    const names = balances.map((b) => b.name);
    expect(names).not.toContain("Leave Without Pay");
    expect(names).not.toContain("Medical Leave");
    expect(names.filter((n) => n.startsWith("Paternity")).length).toBe(1);
    expect(balances.find((b) => b.name === "Paternity Leave")?.allocated).toBe(9);
  });

  it("available = allocated + adjusted - used", () => {
    expect(balances.find((b) => b.code === "EL")?.remaining).toBe(16);
  });

  it("does not pool maternity / paternity into 'leave available'", () => {
    const sum = summariseLeave(balances, "2026-10-02");
    // CL 5 + EL 16 only — before the fix the dashboard added the 180-day maternity row
    expect(sum.available).toBe(21);
    expect(sum.lapsing).toBe(5);
    expect(sum.lapsesOn).toBe("2026-12-31");
    expect(sum.lapsesInDays).toBe(90);
  });

  it("reports null when nothing is allocated", () => {
    expect(summariseLeave(buildLeaveBalances([]), "2026-10-02").available).toBeNull();
  });
});

describe("employee dashboard payslip calc", () => {
  const line = (runMonth: string, rank: number, gross: number, net: number, tds = 0): PayLine => ({ runMonth, rank, gross, net, deductions: gross - net, tds });
  const lines = [
    line("2026-04", 4, 100, 90, 1),
    line("2026-05", 3, 100, 90, 1),
    line("2026-05", 4, 120, 108, 2), // re-run of May: the more final line wins, no double count
    line("2026-06", 4, 100, 90, 1),
    line("2026-03", 4, 999, 999, 99), // previous FY
  ];

  it("keeps one line per run month, preferring the more final run", () => {
    const c = canonicalPayLines(lines);
    expect(c.filter((l) => l.runMonth === "2026-05")).toHaveLength(1);
    expect(c.find((l) => l.runMonth === "2026-05")?.gross).toBe(120);
  });

  it("sums the financial year from April only", () => {
    expect(ytdTotals(lines, "2026-06")).toEqual({ gross: 320, net: 288, tds: 4, months: 3 });
  });

  it("returns null totals, not zero, when there are no lines", () => {
    expect(ytdTotals([], "2026-06")).toEqual({ gross: null, net: null, tds: null, months: 0 });
  });
});

describe("employee dashboard today state", () => {
  const base = { weekOff: false, holiday: false, onLeave: false, punchIn: null, punchOut: null, shiftStart: "10:00", nowMinutes: 9 * 60 };
  it("is not_started before the shift and no_punch an hour after start", () => {
    expect(todayState(base)).toBe("not_started");
    expect(todayState({ ...base, nowMinutes: 11 * 60 + 5 })).toBe("no_punch");
  });
  it("tracks punch in / out", () => {
    expect(todayState({ ...base, punchIn: "09:58" })).toBe("working");
    expect(todayState({ ...base, punchIn: "09:58", punchOut: "19:02" })).toBe("completed");
  });
  it("leave, holiday and week-off outrank a missing punch", () => {
    expect(todayState({ ...base, nowMinutes: 15 * 60, holiday: true })).toBe("holiday");
    expect(todayState({ ...base, nowMinutes: 15 * 60, weekOff: true })).toBe("week_off");
    expect(todayState({ ...base, nowMinutes: 15 * 60, onLeave: true })).toBe("leave");
  });
});

describe("recurring dates", () => {
  it("rolls to next year once the day has passed", () => {
    expect(daysUntilAnnual("10-05", "2026-10-02")).toBe(3);
    expect(daysUntilAnnual("10-01", "2026-10-02")).toBe(364);
    expect(daysUntilAnnual("10-02", "2026-10-02")).toBe(0);
  });
  it("celebrates a 29 Feb birthday on 28 Feb in non-leap years", () => {
    expect(daysUntilAnnual("02-29", "2027-02-27")).toBe(1);
  });
});
