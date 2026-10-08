import { describe, it, expect } from "vitest";
import { dayNumber, isSunday, stintEmploymentSummary, isDateEmployed, type Stint } from "../stint-window.js";

const SEP = { monthStart: "2026-09-01", monthEnd: "2026-09-30" };
const rejoiner: Stint[] = [
  { startDate: "2024-01-15", endDate: "2026-09-10" },
  { startDate: "2026-09-20", endDate: null },
];

describe("dayNumber / isSunday", () => {
  it("counts days from the epoch without timezone drift", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("2026-09-02") - dayNumber("2026-09-01")).toBe(1);
  });
  it("finds Sundays (2026-09-06 and 2026-09-13 are Sundays, 2026-09-07 is not)", () => {
    expect(isSunday("2026-09-06")).toBe(true);
    expect(isSunday("2026-09-13")).toBe(true);
    expect(isSunday("2026-09-07")).toBe(false);
    expect(isSunday("1970-01-04")).toBe(true);
  });
});

describe("stintEmploymentSummary", () => {
  it("September 2026: employed Sep 1-10 and Sep 20-30 = 21 days, 3 Sundays (6, 20, 27)", () => {
    const s = stintEmploymentSummary(rejoiner, SEP.monthStart, SEP.monthEnd);
    expect(s.ranges).toEqual([{ from: "2026-09-01", to: "2026-09-10" }, { from: "2026-09-20", to: "2026-09-30" }]);
    expect(s.employedDays).toBe(21);
    expect(s.sundays).toBe(3);
  });

  it("a month after the rejoin is the whole month", () => {
    const s = stintEmploymentSummary(rejoiner, "2026-10-01", "2026-10-31");
    expect(s.employedDays).toBe(31);
    expect(s.sundays).toBe(4);
  });

  it("the old stint's final month alone, caps at the old last working day", () => {
    const s = stintEmploymentSummary([rejoiner[0]!], SEP.monthStart, SEP.monthEnd);
    expect(s.employedDays).toBe(10);
  });

  it("a month wholly inside the gap has no employed days", () => {
    const s = stintEmploymentSummary(
      [{ startDate: "2026-01-01", endDate: "2026-06-30" }, { startDate: "2026-10-15", endDate: null }],
      "2026-08-01", "2026-08-31");
    expect(s.employedDays).toBe(0);
    expect(s.ranges).toEqual([]);
    expect(s.sundays).toBe(0);
  });

  it("clamps a stint that started before the month and ends inside it", () => {
    const s = stintEmploymentSummary([{ startDate: "2020-01-01", endDate: "2026-09-05" }], SEP.monthStart, SEP.monthEnd);
    expect(s.ranges).toEqual([{ from: "2026-09-01", to: "2026-09-05" }]);
  });

  it("merges overlapping or touching stints so no day is counted twice", () => {
    const s = stintEmploymentSummary(
      [{ startDate: "2026-09-01", endDate: "2026-09-10" }, { startDate: "2026-09-10", endDate: "2026-09-15" }, { startDate: "2026-09-16", endDate: null }],
      SEP.monthStart, SEP.monthEnd);
    expect(s.ranges).toEqual([{ from: "2026-09-01", to: "2026-09-30" }]);
    expect(s.employedDays).toBe(30);
  });

  it("ignores days before salary_start_date", () => {
    const s = stintEmploymentSummary(rejoiner, SEP.monthStart, SEP.monthEnd, "2026-09-05");
    expect(s.ranges[0]).toEqual({ from: "2026-09-05", to: "2026-09-10" });
    expect(s.employedDays).toBe(6 + 11);
  });

  it("a salary_start_date after the whole month leaves nothing", () => {
    expect(stintEmploymentSummary(rejoiner, SEP.monthStart, SEP.monthEnd, "2026-10-01").employedDays).toBe(0);
  });

  it("tolerates unsorted input and datetime strings", () => {
    const s = stintEmploymentSummary(
      [{ startDate: "2026-09-20T00:00:00.000Z", endDate: null }, { startDate: "2024-01-15", endDate: "2026-09-10T00:00:00.000Z" }],
      SEP.monthStart, SEP.monthEnd);
    expect(s.employedDays).toBe(21);
  });

  it("a stint with an end date before its start date contributes nothing", () => {
    expect(stintEmploymentSummary([{ startDate: "2026-09-20", endDate: "2026-09-10" }], SEP.monthStart, SEP.monthEnd).employedDays).toBe(0);
  });
});

describe("isDateEmployed", () => {
  const ranges = stintEmploymentSummary(rejoiner, SEP.monthStart, SEP.monthEnd).ranges;
  it("is true inside a range and on its boundaries", () => {
    expect(isDateEmployed(ranges, "2026-09-01")).toBe(true);
    expect(isDateEmployed(ranges, "2026-09-10")).toBe(true);
    expect(isDateEmployed(ranges, "2026-09-20")).toBe(true);
  });
  it("is false inside the gap", () => {
    expect(isDateEmployed(ranges, "2026-09-11")).toBe(false);
    expect(isDateEmployed(ranges, "2026-09-15")).toBe(false);
    expect(isDateEmployed(ranges, "2026-09-19")).toBe(false);
  });
});
