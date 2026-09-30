import { describe, expect, it } from "vitest";
import { buildInsights, sortRows, weightedAdherence, weightedQuality } from "../insights";
import { fmtDate, fmtDateTime, fmtPct, toneFor, THRESH, type BreakResponse, type ShiftRow } from "../types";

const shift = (o: Partial<ShiftRow> & { adh: number | null; sched?: number }): ShiftRow => ({
  shiftId: o.shiftId ?? "s", shiftName: o.shiftName ?? "S", shiftTime: "09:00 - 18:00", shiftType: "MORNING", processId: null,
  totalEmployees: 10, scheduledDays: o.sched ?? 100, presentDays: o.adh == null ? 0 : Math.round(((o.sched ?? 100) * o.adh) / 100), breakDays: 0,
  qualityDays: o.qualityDays ?? 0,
  metrics: { adherencePct: o.adh, onTimePct: null, qualityAvg: o.metrics?.qualityAvg ?? null, breakCompliancePct: null, avgBreakMinutes: null, breakBudget: 60, productivityScore: null },
  trend: o.trend ?? { adherence: null, quality: null }, spark: [], rank: 1, isOptimal: false,
});
const breaks = (o: Partial<BreakResponse["overall"]>): BreakResponse => ({
  overall: { compliancePct: 95, avgBreakMinutes: 30, budgetMinutes: 60, overBreakCount: 0, underBreakCount: 0, sessions: 10, employeesTracked: 5, delta: null, ...o },
  window: { cur: { from: "", to: "" }, prev: { from: "", to: "" } }, byShift: [], byProcess: [], topViolators: [], daily: [],
});

describe("weighted roll-ups", () => {
  it("weights adherence by counted days and returns null with no data", () => {
    expect(weightedAdherence([shift({ adh: 100, sched: 10 }), shift({ adh: 50, sched: 90 })])).toBe(55);
    expect(weightedAdherence([])).toBeNull();
    expect(weightedAdherence([shift({ adh: null, sched: 0 })])).toBeNull();
  });
  it("quality ignores shifts with no scored days (no zero-fill)", () => {
    const a = shift({ adh: 90, qualityDays: 10, metrics: { qualityAvg: 80 } as never });
    const b = shift({ adh: 90 });
    expect(weightedQuality([a, b])).toBe(80);
    expect(weightedQuality([b])).toBeNull();
  });
});

describe("buildInsights", () => {
  it("orders by severity then count and points at the worst shift", () => {
    const list = buildInsights(
      [shift({ shiftId: "a", shiftName: "Night", adh: 60 }), shift({ shiftId: "b", adh: 80 })],
      breaks({ overBreakCount: 3 }),
      [{ employeeId: "e" } as never],
    );
    expect(list.map((i) => i.id)).toEqual(["adh-red", "brk-over", "adh-amber", "recs"]);
    expect(list[0].target).toEqual({ kind: "shift", shiftId: "a" });
    expect(list[0].severity).toBe("critical");
  });
  it("says so when there is no break data instead of scoring it", () => {
    const list = buildInsights([], breaks({ sessions: 0, compliancePct: null }), []);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "brk-none", severity: "info" });
  });
  it("critical break alert when compliance under threshold", () => {
    expect(buildInsights([], breaks({ compliancePct: 60, overBreakCount: 4 }), [])[0]).toMatchObject({ id: "brk-red", severity: "critical", count: 4 });
  });
  it("flags a 5+ point drop", () => {
    expect(buildInsights([shift({ adh: 95, trend: { adherence: -7, quality: null } })], undefined, []).map((i) => i.id)).toEqual(["adh-drop"]);
  });
});

describe("sortRows", () => {
  it("keeps nulls last in both directions and is stable", () => {
    const rows = [{ v: 2 }, { v: null }, { v: 1 }, { v: 2, k: 1 }];
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.v)).toEqual([1, 2, 2, null]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.v)).toEqual([2, 2, 1, null]);
    expect(sortRows(rows, (r) => r.v, "desc")[1]).toHaveProperty("k");
  });
});

describe("formatters and tones", () => {
  it("formats Indian dates", () => {
    expect(fmtDate("2026-09-30")).toBe("30/09/2026");
    expect(fmtDateTime("2026-09-30 07:05")).toBe("30/09/2026 07:05");
    expect(fmtDate(null)).toBe("—");
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(83.3)).toBe("83.3%");
  });
  it("tones use shared thresholds", () => {
    expect(toneFor(90, THRESH.adherence)).toBe("green");
    expect(toneFor(75, THRESH.adherence)).toBe("amber");
    expect(toneFor(74.9, THRESH.adherence)).toBe("red");
    expect(toneFor(null, THRESH.adherence)).toBe("neutral");
  });
});
