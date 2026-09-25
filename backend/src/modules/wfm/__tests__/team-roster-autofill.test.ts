import { describe, expect, it } from "vitest";
import { shiftDate, suggestCopyLastWeek, suggestUsual, usualPattern, type HistoryCell } from "../team-roster-autofill.js";

const shift = (date: string, start = "10:00", end = "19:00"): HistoryCell => ({ date, type: "SHIFT", start, end });
const off = (date: string): HistoryCell => ({ date, type: "WEEK_OFF", start: null, end: null });

describe("usualPattern", () => {
  it("picks the most common shift and a weekday that was off at least twice", () => {
    // 2026-09-06, 09-13, 09-20 are Sundays
    const history = [off("2026-09-06"), off("2026-09-13"), shift("2026-09-07"), shift("2026-09-08"), shift("2026-09-09", "14:00", "23:00")];
    const p = usualPattern(history);
    expect(p.shift).toEqual({ start: "10:00", end: "19:00" });
    expect(p.weekOffDays).toEqual([0]);
  });
  it("ignores a weekday that was off only once", () => {
    expect(usualPattern([off("2026-09-06"), shift("2026-09-07")]).weekOffDays).toEqual([]);
  });
  it("returns nothing for an empty history", () => {
    expect(usualPattern([])).toEqual({ shift: null, weekOffDays: [] });
  });
});

describe("suggestUsual", () => {
  const history = [off("2026-09-06"), off("2026-09-13"), shift("2026-09-07"), shift("2026-09-08")];
  it("puts week-off on the usual weekday and the usual shift elsewhere", () => {
    const out = suggestUsual("e1", ["2026-09-27", "2026-09-28"], history); // Sun, Mon
    expect(out.map((s) => [s.date, s.type])).toEqual([["2026-09-27", "WEEK_OFF"], ["2026-09-28", "SHIFT"]]);
    expect(out[1]).toMatchObject({ shiftStart: "10:00", shiftEnd: "19:00" });
  });
  it("suggests nothing when there is no history", () => {
    expect(suggestUsual("e1", ["2026-09-28"], [])).toEqual([]);
  });
});

describe("suggestCopyLastWeek", () => {
  it("copies the cell from exactly seven days earlier, including one-off types", () => {
    const history = [shift("2026-09-21", "07:00", "16:00"), off("2026-09-22"), { date: "2026-09-23", type: "TRAINING", start: null, end: null } as HistoryCell];
    const out = suggestCopyLastWeek("e1", ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"], history);
    expect(out.map((s) => [s.date, s.type])).toEqual([["2026-09-28", "SHIFT"], ["2026-09-29", "WEEK_OFF"], ["2026-09-30", "TRAINING"]]);
    expect(out[0]).toMatchObject({ shiftStart: "07:00", shiftEnd: "16:00" });
  });
  it("skips source rows that are not a carryable type", () => {
    expect(suggestCopyLastWeek("e1", ["2026-09-28"], [{ date: "2026-09-21", type: "UNASSIGNED", start: null, end: null }])).toEqual([]);
  });
});

describe("shiftDate", () => {
  it("moves across month ends", () => {
    expect(shiftDate("2026-10-03", -7)).toBe("2026-09-26");
  });
});
