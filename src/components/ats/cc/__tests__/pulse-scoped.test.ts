import { describe, expect, it } from "vitest";
import { addDays, funnelFilter, heatGrid, kpiDeltas, pctDelta, previousWindow, scoreRows, splitNames, weekWindow } from "../pulse-scoped-helpers";
import type { DrillData } from "@/hooks/useAtsDashboards";

const mk = (o: Partial<DrillData["kpis"]>): DrillData => ({
  total: o.total ?? 0, kpis: { total: 0, selected: 0, rejected: 0, noShow: 0, hold: 0, waiting: 0, joined: 0, selRate: 0, rejRate: 0, noShowRate: 0, joinRate: 0, ...o },
  trend: [], weekly: false, weekday: [], splits: { branch: [], process: [], source: [], recruiter: [], stage: [], status: [] },
});

describe("previousWindow", () => {
  it("is yesterday for today", () => expect(previousWindow("today", "2026-10-02")).toEqual({ from: "2026-10-01", to: "2026-10-01" }));
  it("is the 7 days before the current 7", () => expect(previousWindow("7d", "2026-10-02")).toEqual({ from: "2026-09-19", to: "2026-09-25" }));
  it("crosses month and year ends", () => expect(previousWindow("30d", "2026-01-10")).toEqual({ from: "2025-11-12", to: "2025-12-11" }));
  it("is null for all", () => expect(previousWindow("all", "2026-10-02")).toBeNull());
});

describe("deltas", () => {
  it("rounds relative change", () => expect(pctDelta(110, 100)).toBe(10));
  it("has no delta without a baseline", () => { expect(pctDelta(5, 0)).toBeNull(); expect(pctDelta(5, null)).toBeNull(); });
  it("computes per KPI and skips an empty previous window", () => {
    const d = kpiDeltas(mk({ total: 150, selected: 30, noShowRate: 10 }), mk({ total: 100, selected: 40, noShowRate: 20 }));
    expect(d.total).toBe(50); expect(d.selected).toBe(-25); expect(d.noShowRate).toBe(-50); expect(d.joined).toBeNull();
    expect(kpiDeltas(mk({ total: 5 }), mk({})).total).toBeNull();
    expect(kpiDeltas(mk({ total: 5 }), null).total).toBeNull();
  });
});

describe("heatGrid", () => {
  it("places dow 1=Sun at row 0, trims hours and finds the max", () => {
    const g = heatGrid([{ dow: 1, hour: 9, total: 4, selected: 1 }, { dow: 7, hour: 11, total: 9, selected: 2 }, { dow: 9, hour: 3, total: 99, selected: 0 }]);
    expect(g.grid[0][9]).toBe(4); expect(g.grid[6][11]).toBe(9); expect(g.max).toBe(9); expect(g.hours).toEqual([9, 10, 11]);
  });
  it("copes with missing data", () => expect(heatGrid(undefined)).toMatchObject({ max: 0, hours: [] }));
});

describe("misc", () => {
  it("scoreRows falls back to counts", () => {
    const [r] = scoreRows([{ name: "A", total: 50, selected: 10, rejected: 5, selRate: 20 }]);
    expect(r).toMatchObject({ selPct: 20, rejPct: 10, noShowPct: 0, joinPct: 0 });
    expect(scoreRows([{ name: "B", total: 0, selected: 0, rejected: 0, selRate: 0 }])).toEqual([]);
  });
  it("splitNames drops placeholders", () => expect(splitNames([{ name: "A", total: 1, selected: 0, rejected: 0, selRate: 0 }, { name: "Unspecified", total: 1, selected: 0, rejected: 0, selRate: 0 }])).toEqual(["A"]));
  it("funnelFilter", () => { expect(funnelFilter("registered")).toEqual({}); expect(funnelFilter("offerApproved")).toEqual({ outcome: "offered" }); expect(funnelFilter("joined")).toEqual({ outcome: "joined" }); });
  it("weekWindow", () => { expect(weekWindow("2026-09-28")).toEqual({ from: "2026-09-28", to: "2026-10-04" }); expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); });
});
