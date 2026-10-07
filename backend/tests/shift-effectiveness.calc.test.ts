import { describe, it, expect } from "vitest";
import {
  addDays,
  analysisWindows,
  buildRecommendations,
  dailyBreakBudget,
  deltaPts,
  pct,
  productivityScore,
  rankShifts,
  shiftMetrics,
  shiftTypeFromStartHour,
  type CohortShift,
  type EmployeeShiftRow,
} from "../src/modules/wfm/shift-effectiveness.calc";

describe("pct / deltaPts", () => {
  it("returns null (not 0/100/NaN) when the denominator is 0", () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(5, 0)).toBeNull();
    expect(pct(3, 4)).toBe(75);
    expect(pct(1, 3)).toBe(33.3);
  });
  it("delta needs both periods", () => {
    expect(deltaPts(80, 75)).toBe(5);
    expect(deltaPts(null, 75)).toBeNull();
    expect(deltaPts(80, undefined)).toBeNull();
  });
});

describe("analysisWindows", () => {
  it("ends yesterday (today and future excluded) and previous window is adjacent", () => {
    const w = analysisWindows(new Date(2026, 8, 30, 15, 0, 0));
    expect(w.cur).toEqual({ from: "2026-08-31", to: "2026-09-29" });
    expect(w.prev).toEqual({ from: "2026-08-01", to: "2026-08-30" });
    expect(addDays(w.prev.to, 1)).toBe(w.cur.from);
  });
  it("crosses year boundary", () => {
    expect(analysisWindows(new Date(2026, 0, 2)).cur.to).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("productivityScore", () => {
  it("weights 40/40/20", () => expect(productivityScore(90, 80, 100)).toBe(88));
  it("re-weights, not zero-fills, when quality is unknown", () =>
    expect(productivityScore(90, null, 100)).toBe(93));
  it("null when adherence unknown", () =>
    expect(productivityScore(null, 80, 90)).toBeNull());
});

describe("shiftMetrics", () => {
  const base = {
    shiftId: "s",
    scheduledDays: 0,
    presentDays: 0,
    onTimeDays: 0,
    qualityAvg: null,
    qualityDays: 0,
    breakDays: 0,
    compliantBreakDays: 0,
    avgBreakMinutes: null,
    avgBudget: null,
  };
  it("no data => all null, never a fabricated 100% / 30 minutes", () => {
    const m = shiftMetrics(base);
    expect(m.adherencePct).toBeNull();
    expect(m.breakCompliancePct).toBeNull();
    expect(m.avgBreakMinutes).toBeNull();
    expect(m.qualityAvg).toBeNull();
    expect(m.breakBudget).toBe(60);
  });
  it("on-time is measured against attended days, break compliance against tracked days", () => {
    const m = shiftMetrics({
      ...base,
      scheduledDays: 10,
      presentDays: 8,
      onTimeDays: 6,
      breakDays: 4,
      compliantBreakDays: 3,
      avgBreakMinutes: 41.6,
      avgBudget: 60,
      qualityAvg: 82.34,
      qualityDays: 3,
    });
    expect(m.adherencePct).toBe(80);
    expect(m.onTimePct).toBe(75);
    expect(m.breakCompliancePct).toBe(75);
    expect(m.avgBreakMinutes).toBe(42);
    expect(m.qualityAvg).toBe(82.3);
  });
});

describe("rankShifts", () => {
  const mk = (adh: number | null, days: number) => ({
    metrics: { adherencePct: adh },
    scheduledDays: days,
  });
  it("does not crown a shift with a tiny sample; nulls sort last", () => {
    const r = rankShifts([mk(100, 3), mk(null, 0), mk(90, 50)]);
    expect(r.map((s) => s.metrics.adherencePct)).toEqual([100, 90, null]);
    expect(r.map((s) => s.isOptimal)).toEqual([false, true, false]);
    expect(r.map((s) => s.rank)).toEqual([1, 2, 3]);
  });
  it("no optimal when nothing qualifies", () =>
    expect(rankShifts([mk(99, 2)])[0].isOptimal).toBe(false));
});

describe("shiftTypeFromStartHour / dailyBreakBudget", () => {
  it("buckets", () => {
    expect(
      [5, 6, 11, 12, 16, 17, 19, 20, 23].map(shiftTypeFromStartHour),
    ).toEqual([
      "NIGHT",
      "MORNING",
      "MORNING",
      "AFTERNOON",
      "AFTERNOON",
      "EVENING",
      "EVENING",
      "NIGHT",
      "NIGHT",
    ]);
  });
  it("caps at kiosk hard max and defaults", () => {
    expect(dailyBreakBudget(90)).toBe(60);
    expect(dailyBreakBudget(45)).toBe(45);
    expect(dailyBreakBudget(null)).toBe(60);
    expect(dailyBreakBudget(0)).toBe(60);
  });
});

describe("buildRecommendations", () => {
  const shift = (
    id: string,
    adh: number,
    emps = 10,
    proc: string | null = null,
  ): CohortShift => ({
    shiftId: id,
    shiftName: id,
    shiftTime: "09:00 - 18:00",
    templateProcessId: proc,
    templateBranchId: null,
    totalEmployees: emps,
    scheduledDays: 100,
    presentDays: adh,
  });
  const emp = (
    id: string,
    shiftId: string,
    sched: number,
    present: number,
    processId: string | null = "p1",
  ): EmployeeShiftRow => ({
    employeeId: id,
    employeeCode: id.toUpperCase(),
    employeeName: id,
    processId,
    branchId: "b1",
    shiftId,
    scheduledDays: sched,
    presentDays: present,
  });

  it("flags low-adherence employees once each, towards the best eligible shift", () => {
    const rec = buildRecommendations(
      [shift("A", 60), shift("B", 95)],
      [emp("e1", "A", 10, 4), emp("e1", "B", 2, 0), emp("e2", "A", 10, 9)],
    );
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({
      employeeId: "e1",
      currentShiftId: "A",
      recommendedShiftId: "B",
      scheduledDays: 12,
      presentDays: 4,
    });
    expect(rec[0].expectedImprovement).toBe(Math.round(95 - (4 / 12) * 100));
  });
  it("never recommends a shift owned by another process or one the employee is already on", () => {
    const rec = buildRecommendations(
      [shift("A", 60), shift("B", 95, 10, "other"), shift("C", 85, 10, "p1")],
      [emp("e1", "A", 10, 3)],
    );
    expect(rec[0].recommendedShiftId).toBe("C");
    expect(
      buildRecommendations(
        [shift("A", 60), shift("B", 95)],
        [emp("e1", "B", 10, 3)],
      ),
    ).toHaveLength(0);
  });
  it("needs >=2 cohorts of >=5 employees and >=5 counted days", () => {
    expect(
      buildRecommendations(
        [shift("A", 60), shift("B", 95, 4)],
        [emp("e1", "A", 10, 3)],
      ),
    ).toHaveLength(0);
    expect(
      buildRecommendations(
        [shift("A", 60), shift("B", 95)],
        [emp("e1", "A", 4, 0)],
      ),
    ).toHaveLength(0);
  });
});
