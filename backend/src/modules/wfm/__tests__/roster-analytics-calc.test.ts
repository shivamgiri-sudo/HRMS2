import { describe, it, expect } from "vitest";
import {
  buildForecast,
  classifyRow,
  clockToMinutes,
  isValidPeriod,
  mondayOf,
  pearson,
  periodBounds,
  previousPeriod,
  shiftHours,
} from "../roster-analytics.calc";

const PAST = new Date(2026, 8, 30, 12, 0, 0); // 30 Sep 2026 12:00 local

describe("clockToMinutes", () => {
  it("parses TIME and DATETIME strings (DATETIME used to give NaN)", () => {
    expect(clockToMinutes("09:05:00")).toBe(545);
    expect(clockToMinutes("2026-09-28 09:05:00")).toBe(545);
    expect(clockToMinutes(null)).toBeNull();
    expect(clockToMinutes("garbage")).toBeNull();
  });
  it("handles overnight shift length", () => {
    expect(shiftHours("22:00:00", "06:00:00")).toBe(8);
    expect(shiftHours("09:00:00", "18:00:00")).toBe(9);
    expect(shiftHours(null, null)).toBe(8);
  });
});

describe("period helpers", () => {
  it("previousPeriod has no month-overflow", () => {
    expect(previousPeriod(new Date(2026, 9, 31))).toBe("2026-09"); // 31 Oct: old setMonth(-1) gave 1 Oct -> 2026-10
    expect(previousPeriod(new Date(2026, 0, 15))).toBe("2025-12");
  });
  it("validates YYYY-MM", () => {
    expect(isValidPeriod("2026-08")).toBe(true);
    expect(isValidPeriod("2026-13")).toBe(false);
    expect(isValidPeriod("2026-8")).toBe(false);
  });
  it("clamps the period end to yesterday", () => {
    expect(periodBounds("2026-09", PAST)).toEqual({
      first: "2026-09-01",
      last: "2026-09-29",
      empty: false,
    });
    expect(periodBounds("2026-08", PAST).last).toBe("2026-08-31");
    expect(periodBounds("2026-10", PAST).empty).toBe(true);
  });
  it("mondayOf uses the local calendar day", () => {
    expect(mondayOf(new Date(2026, 8, 30, 1, 0, 0))).toBe("2026-09-28"); // Wed 01:00 local
    expect(mondayOf(new Date(2026, 8, 28, 0, 30, 0))).toBe("2026-09-28"); // Mon 00:30 local (UTC reading would give Sunday)
    expect(mondayOf(new Date(2026, 8, 27, 12, 0, 0))).toBe("2026-09-21"); // Sunday belongs to the previous week
  });
});

describe("classifyRow", () => {
  const base = {
    roster_date: "2026-09-10",
    assignment_type: "SHIFT",
    shift_start_time: "09:00:00",
    shift_end_time: "18:00:00",
  };
  it("absent = full shift lost", () => {
    const o = classifyRow({ ...base, first_in: null, total_hours: null }, PAST);
    expect(o.status).toBe("ABSENT");
    expect(o.hoursLost).toBe(9);
  });
  it("detects late from a DATETIME clock-in and never double counts with the shortfall", () => {
    const o = classifyRow(
      { ...base, first_in: "2026-09-10 10:00:00", total_hours: 8 },
      PAST,
    );
    expect(o.late).toBe(true);
    expect(o.lateMinutes).toBe(60);
    expect(o.short).toBe(false);
    expect(o.hoursLost).toBe(1); // shortfall 9-8, late 1h: counted once
    expect(o.lostLate).toBe(1);
  });
  it("late but stayed the full shift loses nothing", () => {
    const o = classifyRow(
      { ...base, first_in: "2026-09-10 09:30:00", total_hours: 9.5 },
      PAST,
    );
    expect(o.late).toBe(true);
    expect(o.hoursLost).toBe(0);
  });
  it("short shift < 80% is early departure, < 50% is incomplete", () => {
    expect(
      classifyRow({ ...base, first_in: "09:00:00", total_hours: 6 }, PAST)
        .lostEarly,
    ).toBe(3);
    const inc = classifyRow(
      { ...base, first_in: "09:00:00", total_hours: 3 },
      PAST,
    );
    expect(inc.incomplete).toBe(true);
    expect(inc.lostIncomplete).toBe(6);
  });
  it("worked minutes without a punch (dialler source) is present", () => {
    expect(
      classifyRow({ ...base, first_in: null, total_hours: 8.5 }, PAST).status,
    ).toBe("PRESENT");
  });
  it("overtime is capped so planned = worked + lost", () => {
    const o = classifyRow(
      { ...base, first_in: "09:00:00", total_hours: 11 },
      PAST,
    );
    expect(o.workedCapped).toBe(9);
    expect(o.hoursLost).toBe(0);
  });
  it("NULL assignment_type is a working day; leave/training are shrinkage but carry no lost hours", () => {
    expect(
      classifyRow({ ...base, assignment_type: null, first_in: null }, PAST)
        .status,
    ).toBe("ABSENT");
    const l = classifyRow({ ...base, assignment_type: "LEAVE" }, PAST);
    expect(l.isShrinkage).toBe(true);
    expect(l.hoursLost).toBe(0);
    expect(
      classifyRow({ ...base, assignment_type: "WEEK_OFF" }, PAST).inBase,
    ).toBe(false);
  });
  it("a today shift that is not yet due is skipped", () => {
    expect(
      classifyRow(
        {
          ...base,
          roster_date: "2026-09-30",
          shift_start_time: "19:00:00",
          first_in: null,
        },
        PAST,
      ).status,
    ).toBe("NOT_DUE");
  });
});

describe("pearson", () => {
  it("returns null for n<5 or zero variance, r for real data", () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull();
    expect(pearson([1, 1, 1, 1, 1], [1, 2, 3, 4, 5])).toBeNull();
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBe(1);
    expect(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBe(-1);
  });
});

describe("buildForecast", () => {
  const b = (planned: number, absent: number) => ({ planned, absent });
  it("a weekday with no history has effect 0, not -baseline", () => {
    const f = buildForecast(
      { dow: new Map([[2, b(100, 10)]]), dom: new Map() },
      "2026-10-05",
    );
    expect(f.baseRate).toBe(10);
    expect(f.mondayEffect).toBe(0);
    expect(f.fridayEffect).toBe(0);
    expect(f.monthEndEffect).toBe(0);
    expect(f.avgPredicted).toBe(10);
  });
  it("headline is the mean of the 7 daily predictions and only positive effects add", () => {
    const dow = new Map([
      [1, b(100, 20)],
      [2, b(100, 8)],
      [3, b(100, 8)],
      [4, b(100, 8)],
      [5, b(100, 8)],
    ]);
    const f = buildForecast({ dow, dom: new Map() }, "2026-10-05"); // Mon 5 Oct
    const mon = f.days[0];
    expect(mon.day).toBe("Monday");
    expect(mon.predictedPct).toBeGreaterThan(f.baseRate);
    expect(mon.reasons).toContain("Monday effect");
    const mean =
      Math.round((f.days.reduce((s, d) => s + d.predictedPct, 0) / 7) * 10) /
      10;
    expect(f.avgPredicted).toBe(mean);
  });
  it("month-end effect applies to day-of-month >= 27", () => {
    const dom = new Map([
      [28, b(100, 30)],
      [15, b(100, 5)],
    ]);
    const dow = new Map([[3, b(200, 35)]]);
    const f = buildForecast({ dow, dom }, "2026-09-28");
    expect(f.monthEndEffect).toBeGreaterThan(2);
    expect(f.days.find((d) => d.date === "2026-09-30")?.reasons).toContain(
      "Month-end",
    );
    expect(f.days.find((d) => d.date === "2026-10-01")?.reasons).not.toContain(
      "Month-end",
    );
  });
});
