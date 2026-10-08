import { describe, expect, it } from "vitest";
import { change, fteGaps, insightUnit, lastCompletedMonth, league, marginPct, opsHealth, opsHref, staleDays, type ProcessRowLite } from "../providers/operationsCalc.js";

const p = (id: string, m: ProcessRowLite["m"]): ProcessRowLite => ({ id, name: id.toUpperCase(), m });

describe("operations deep links", () => {
  it("builds URLs the unified Operations page parses (tab, by, branch, process)", () => {
    expect(opsHref()).toBe("/operations-dashboard");
    expect(opsHref({ tab: "overview" })).toBe("/operations-dashboard");
    expect(opsHref({ tab: "shrinkage", by: "process" })).toBe("/operations-dashboard?tab=shrinkage&by=process");
    expect(opsHref({ by: "manager", process: "p1", branch: "b1" })).toBe("/operations-dashboard?by=manager&branch=b1&process=p1");
  });
});

describe("FTE vs required", () => {
  it("ranks by gap and excludes processes without a mandate rather than showing '0 required'", () => {
    const out = fteGaps([p("a", { mandate_hc: 100, hc_closing: 80 }), p("b", { mandate_hc: 50, hc_closing: 60 }), p("c", { hc_closing: 30 }), p("d", { mandate_hc: 0, hc_closing: 10 })]);
    expect(out.map((r) => [r.id, r.gap, r.fillPct])).toEqual([["a", 20, 80], ["b", -10, 120]]);
  });
});

describe("league", () => {
  it("ignores groups with too few scheduled days and orders by direction", () => {
    const rows = [p("a", { attendance_pct: 90, scheduled_days: 500 }), p("b", { attendance_pct: 70, scheduled_days: 500 }), p("c", { attendance_pct: 99, scheduled_days: 10 }), p("d", { attendance_pct: 80, scheduled_days: 100 })];
    const l = league(rows, "attendance_pct", true, 2);
    expect(l.top.map((r) => r.id)).toEqual(["a", "d"]);
    expect(l.bottom.map((r) => r.id)).toEqual(["b", "d"]);
  });
});

describe("operations health", () => {
  it("is null with fewer than two components", () => {
    expect(opsHealth({ attendance_pct: 90 })).toBeNull();
  });
  it("scores every component against the catalogue's own warn level", () => {
    expect(opsHealth({ attendance_pct: 90, shrinkage_pct: 15, mandate_fill_pct: 95, qa_score_pct: 85 })?.score).toBe(100);
    expect(opsHealth({ attendance_pct: 45, shrinkage_pct: 35 })?.score).toBe(Math.round((50 * 0.3 + 0 * 0.25) / 0.55));
  });
});

describe("misc", () => {
  it("change is null if either side is unknown", () => {
    expect(change(83.7, 84.7)).toBe(-1);
    expect(change(null, 1)).toBeNull();
    expect(change(1, undefined)).toBeNull();
  });
  it("marginPct is null (never 0) without revenue", () => {
    expect(marginPct(0, -50)).toBeNull();
    expect(marginPct(200, 50)).toBe(25);
  });
  it("lastCompletedMonth crosses the year boundary", () => {
    expect(lastCompletedMonth("2026-10-02")).toBe("2026-09");
    expect(lastCompletedMonth("2027-01-15")).toBe("2026-12");
  });
  it("staleDays and unit mapping", () => {
    expect(staleDays("2026-09-10", "2026-10-02")).toBe(22);
    expect(staleDays(null, "2026-10-02")).toBeNull();
    expect(insightUnit("pct")).toBe("percent");
    expect(insightUnit("hours")).toBe("hours");
  });
});
