import { describe, expect, it } from "vitest";
import { addDaysIso, buildCalendar, datesBetween, isMonth, monthBounds, weekdayOf } from "../fc.calendar.js";

const wd = (from: string, to: string, days: number[]) => datesBetween(from, to).filter((d) => days.includes(weekdayOf(d)));

describe("date helpers", () => {
  it("monthBounds handles 30/31-day months and leap Februaries", () => {
    expect(monthBounds("2026-09")).toEqual({ first: "2026-09-01", last: "2026-09-30", days: 30 });
    expect(monthBounds("2026-12").last).toBe("2026-12-31");
    expect(monthBounds("2026-02").days).toBe(28);
    expect(monthBounds("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29", days: 29 });
    expect(monthBounds("2100-02").days).toBe(28); // century non-leap
    expect(monthBounds("2000-02").days).toBe(29);
  });
  it("addDaysIso crosses month, year and leap-day boundaries", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("isMonth validates", () => { expect(isMonth("2026-09")).toBe(true); expect(isMonth("2026-13")).toBe(false); expect(isMonth("2026-9")).toBe(false); expect(isMonth(undefined)).toBe(false); });
});

describe("buildCalendar", () => {
  const cutoff = "2026-09-16"; // Wednesday
  it("falls back to Mon-Fri and says so when there is no history", () => {
    const c = buildCalendar({ cutoff, workedDates: new Set(), holidays: [] });
    expect(c.basis).toBe("weekday-only"); expect(c.workingWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(c.isWorking("2026-09-19")).toBe(false); // Saturday
  });
  it("Mon-Fri history: weekends are off in the future, worked days are the observed ones", () => {
    const worked = new Set(wd("2026-07-22", cutoff, [1, 2, 3, 4, 5]));
    const c = buildCalendar({ cutoff, workedDates: worked, holidays: [] });
    expect(c.basis).toBe("observed"); expect(c.workingWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(c.isWorked("2026-09-12")).toBe(false); // a Saturday in the past
    expect(c.workingDaysBetween("2026-09-17", "2026-09-30")).toHaveLength(10);
  });
  it("Mon-Sat history keeps Saturdays", () => {
    const c = buildCalendar({ cutoff, workedDates: new Set(wd("2026-07-22", cutoff, [1, 2, 3, 4, 5, 6])), holidays: [] });
    expect(c.workingWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(c.isWorking("2026-09-19")).toBe(true); expect(c.isWorking("2026-09-20")).toBe(false);
  });
  it("a Saturday worked in fewer than half the weeks is treated as off, worked in half or more as on", () => {
    const sats = wd("2026-07-22", cutoff, [6]); // 8 Saturdays
    const base = wd("2026-07-22", cutoff, [1, 2, 3, 4, 5]);
    expect(buildCalendar({ cutoff, workedDates: new Set([...base, ...sats.slice(0, 3)]), holidays: [] }).workingWeekdays).not.toContain(6);
    expect(buildCalendar({ cutoff, workedDates: new Set([...base, ...sats.slice(0, 4)]), holidays: [] }).workingWeekdays).toContain(6);
  });
  it("honours a future holiday when past holidays were closed, and past closed holidays do not dent their weekday", () => {
    const base = wd("2026-07-22", cutoff, [1, 2, 3, 4, 5]).filter((d) => d !== "2026-08-17"); // Monday 17 Aug closed
    const c = buildCalendar({ cutoff, workedDates: new Set(base), holidays: ["2026-08-17", "2026-09-21"] });
    expect(c.holidaysHonoured).toBe(true); expect(c.isWorking("2026-09-21")).toBe(false); expect(c.isWorking("2026-09-22")).toBe(true);
    expect(c.weekdayRate[1]).toBe(1); // Mondays: 100% of the non-holiday ones
  });
  it("ignores holidays for a process that worked them", () => {
    const c = buildCalendar({ cutoff, workedDates: new Set(wd("2026-07-22", cutoff, [1, 2, 3, 4, 5])), holidays: ["2026-08-17", "2026-09-21"] });
    expect(c.holidaysHonoured).toBe(false); expect(c.isWorking("2026-09-21")).toBe(true);
  });
  it("honours holidays when none fell in the window", () => {
    const c = buildCalendar({ cutoff, workedDates: new Set(wd("2026-07-22", cutoff, [1, 2, 3, 4, 5])), holidays: ["2026-10-02"] });
    expect(c.holidaysHonoured).toBe(true); expect(c.isWorking("2026-10-02")).toBe(false);
  });
  it("a process that started recently is not penalised for days before its first row", () => {
    const c = buildCalendar({ cutoff, workedDates: new Set(wd("2026-09-01", cutoff, [1, 2, 3, 4, 5])), holidays: [] });
    expect(c.firstDataDate).toBe("2026-09-01"); expect(c.weekdayRate[1]).toBe(1);
  });
});
