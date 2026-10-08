import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

import {
  abscondRisk, absentStreak, ageBucket, attendanceRate, completeDays, composite, expectedToWork, forecastAbsence,
  ratio, shrinkage, unreconciledPct, type DayCounts,
} from "../providers/wfmParts/shared.js";
import { floorTotals, heatRows, publishTotals, type HeatCell, type HeatKey } from "../providers/wfmParts/floor.js";
import { queueAction } from "../providers/wfmParts/queues.js";
import { ageProfile, daysToCutoff } from "../providers/wfmAttendanceParts/corrections.js";
import { pipelineLag } from "../providers/wfmAttendanceParts/integrity.js";
import wfm from "../providers/wfm.js";
import wfmAttendance from "../providers/wfmAttendance.js";

const day = (o: Partial<DayCounts> = {}): DayCounts => ({ total: 100, present: 50, half: 10, absent: 20, leave: 10, missing: 5, late: 8, off: 5, ...o });

describe("attendance rate and shrinkage (WFM)", () => {
  it("rate denominator excludes approved leave and week-off/holiday", () => {
    const c = day();
    expect(expectedToWork(c)).toBe(85);
    // (50 + 0.5 * 10) / 85, not 60 / 100
    expect(attendanceRate(c)).toBe(64.7);
  });

  it("counts a half day as half, never as a full day", () => {
    expect(attendanceRate(day({ present: 0, half: 20, absent: 0, leave: 0, off: 0, total: 20, missing: 0 }))).toBe(50);
  });

  it("planned + unplanned shrinkage share one denominator and add up", () => {
    const s = shrinkage(day());
    expect(s.unplanned).toBe(21.1);
    expect(s.planned).toBe(10.5);
    expect(s.total).toBe(31.6);
    expect(Math.round(((s.unplanned ?? 0) + (s.planned ?? 0)) * 10) / 10).toBeCloseTo(s.total ?? 0, 0);
  });

  it("never returns a confident 0 from an empty day", () => {
    const empty = day({ total: 0, present: 0, half: 0, absent: 0, leave: 0, missing: 0, late: 0, off: 0 });
    expect(attendanceRate(empty)).toBeNull();
    expect(shrinkage(empty)).toEqual({ unplanned: null, planned: null, total: null });
    expect(unreconciledPct(empty)).toBeNull();
    expect(ratio(5, 0)).toBeNull();
  });

  it("treats a partially written day as incomplete", () => {
    const kept = completeDays([{ total: 1100 }, { total: 750 }, { total: 23 }]);
    expect(kept.map((d) => d.total)).toEqual([1100, 750]);
  });
});

describe("abscond risk and forecast", () => {
  it("measures the streak ending on the anchor day only", () => {
    expect(absentStreak(["2026-09-29", "2026-09-30", "2026-10-01"], "2026-10-01")).toBe(3);
    // absent earlier but present on the anchor: not an active streak
    expect(absentStreak(["2026-09-27", "2026-09-28", "2026-09-29"], "2026-10-01")).toBe(0);
    expect(absentStreak(["2026-09-25", "2026-09-27", "2026-10-01"], "2026-10-01")).toBe(1);
  });

  it("classifies 3-4 days as watch and 5+ as abscond", () => {
    expect([2, 3, 4, 5, 7].map(abscondRisk)).toEqual([null, "watch", "watch", "abscond", "abscond"]);
  });

  it("forecast is null without history, otherwise rate x headcount plus booked leave", () => {
    expect(forecastAbsence([], 800, 3)).toBeNull();
    expect(forecastAbsence([10, 20], null, 3)).toBeNull();
    const f = forecastAbsence([10, 20, 15], 800, 8)!;
    expect(f.meanPct).toBe(15);
    expect(f.unplanned).toBe(120);
    expect(f.total).toBe(128);
    expect(f.shrinkagePct).toBe(16);
  });

  it("composite health ignores unmeasurable inputs instead of scoring them 0", () => {
    expect(composite([80, null, 60])).toBe(70);
    expect(composite([null, undefined])).toBeNull();
    expect(composite([150, -20])).toBe(50);
  });
});

describe("floor, roster and queues", () => {
  it("floor fill is logged-in over DUE agents, null before any shift starts", () => {
    expect(floorTotals([{ shift: "A", startAt: "09:00", rostered: 100, due: 0, inNow: 0, noShow: 0 }]).fillPct).toBeNull();
    const t = floorTotals([
      { shift: "A", startAt: "09:00", rostered: 100, due: 100, inNow: 90, noShow: 6 },
      { shift: "B", startAt: "14:00", rostered: 50, due: 0, inNow: 0, noShow: 0 },
    ]);
    expect(t).toMatchObject({ rostered: 150, due: 100, inNow: 90, noShow: 6, fillPct: 90 });
  });

  it("heat rows give null (not 0) where nothing was rostered", () => {
    const cells = new Map<HeatKey, HeatCell>([["Gen|2026-10-01", { rostered: 20, absent: 5, late: 2, adhered: 15 }]]);
    const r = heatRows(["Gen"], ["2026-09-30", "2026-10-01"], cells, (c) => c.absent);
    expect(r[0]).toEqual({ shift: "Gen", d0: null, d1: 25 });
  });

  it("publish totals report the first unpublished day", () => {
    const t = publishTotals([
      { date: "2026-10-02", total: 10, published: 10, acked: 4 },
      { date: "2026-10-03", total: 10, published: 4, acked: 0 },
    ]);
    expect(t).toMatchObject({ total: 20, published: 14, draft: 6, publishedPct: 70, firstDraft: "2026-10-03" });
    expect(publishTotals([]).publishedPct).toBeNull();
  });

  it("an aged queue is escalated even when small, and an empty one is info", () => {
    const base = { id: "q", label: "Q", href: "/x" };
    expect(queueAction({ ...base, count: 2, overdue: 0 }).severity).toBe("normal");
    expect(queueAction({ ...base, count: 2, overdue: 2 }).severity).toBe("high");
    expect(queueAction({ ...base, count: 0, overdue: 0 }).severity).toBe("info");
    expect(queueAction({ ...base, count: 40, overdue: 0 }).severity).toBe("critical");
    expect(queueAction({ ...base, count: null }).severity).toBe("info");
  });

  it("buckets queue age and finds the median / SLA share", () => {
    expect([0, 1, 2, 3, 5, 9].map(ageBucket)).toEqual(["0-1d", "0-1d", "2-3d", "2-3d", "4-7d", "8d+"]);
    const p = ageProfile([1, 2, 5, 10]);
    expect(p.counts).toEqual({ "0-1d": 1, "2-3d": 1, "4-7d": 1, "8d+": 1 });
    expect(p.median).toBe(2);
    expect(p.withinSla).toBe(50);
    expect(ageProfile([]).median).toBeNull();
  });
});

describe("attendance desk helpers", () => {
  it("payroll cutoff countdown is null with no calendar, negative once passed", () => {
    expect(daysToCutoff(null, "2026-10-02")).toBeNull();
    expect(daysToCutoff("2026-10-05", "2026-10-02")).toBe(3);
    expect(daysToCutoff("2026-10-01", "2026-10-02")).toBe(-1);
  });

  it("pipeline lag is never negative and is null when a source is missing", () => {
    expect(pipelineLag(null, 5)).toBeNull();
    expect(pipelineLag(30, 10)).toEqual({ waiting: 20, pct: 66.7 });
    expect(pipelineLag(10, 25)).toEqual({ waiting: 0, pct: 0 });
  });
});

describe("providers are split into isolated sections", () => {
  it("WFM exposes the live-floor sections", () => {
    expect(Object.keys(wfm.sections)).toEqual(expect.arrayContaining([
      "liveFloor", "rosterHeat", "publishHealth", "leaveConflicts", "shrinkageByProcess", "forecast", "absconders", "breaks", "regularizations", "rosterRequests", "health",
    ]));
    expect(Object.keys(wfm.sections).length).toBeGreaterThanOrEqual(8);
  });

  it("WFM Attendance exposes the data-integrity sections", () => {
    expect(Object.keys(wfmAttendance.sections)).toEqual(expect.arrayContaining([
      "punchPipeline", "missedPunch", "coverage", "cosec", "corrections", "payrollLock", "absconders", "health",
    ]));
  });
});
