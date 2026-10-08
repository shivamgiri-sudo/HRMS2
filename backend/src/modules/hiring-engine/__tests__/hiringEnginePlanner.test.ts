import { describe, expect, it } from "vitest";
import { buildPlan, smooth } from "../he-planner.js";

const hist = [
  { source: "Naukri", attempts: 2000, uniqueLeads: 1200, walkins: 300, selected: 90, joined: 60 },
  { source: "Meta", attempts: 1500, uniqueLeads: 1000, walkins: 150, selected: 30, joined: 15 },
  { source: "Referral", attempts: 100, uniqueLeads: 80, walkins: 40, selected: 20, joined: 16 },
  { source: "Walk-in", attempts: 50, uniqueLeads: 50, walkins: 50, selected: 10, joined: 6 },
  { source: "Apna", attempts: 30, uniqueLeads: 20, walkins: 2, selected: 0, joined: 0 },
];

describe("hiring planner", () => {
  it("smooths small samples toward the baseline", () => {
    expect(smooth(1, 1, 0.2, 90, 0.08, 0.75)).toBeLessThan(0.25);
    expect(smooth(300, 1200, 0.2, 25, 0.08, 0.75)).toBeCloseTo(0.25, 1);
  });
  it("reverse funnel: selected -> walk-ins -> leads -> calls, with buffer and recruiters", () => {
    const p = buildPlan({ targetSelected: 20, days: 10, history: hist });
    expect(p.withBuffer).toBe(23);
    expect(p.sources.reduce((a, s) => a + s.expectedSelected, 0)).toBe(23);
    expect(p.totals.walkins).toBeGreaterThan(23);
    expect(p.totals.uniqueLeads).toBeGreaterThan(p.totals.walkins);
    expect(p.totals.callAttempts).toBeGreaterThan(p.totals.uniqueLeads);
    expect(p.recruiters.needed).toBeGreaterThanOrEqual(1);
    expect(p.sources[0].source).toBe("Naukri");
  });
  it("90% from top-4 sources when backups exist; tight deadline flags high risk", () => {
    const p = buildPlan({ targetSelected: 30, days: 2, history: hist });
    const backup = p.sources.filter((s) => s.source === "Apna").reduce((a, s) => a + s.expectedSelected, 0);
    expect(backup).toBeLessThanOrEqual(Math.ceil(p.withBuffer * 0.1));
    expect(p.risk).toBe("high");
  });
  it("no history -> conservative default plan with a note", () => {
    const p = buildPlan({ targetSelected: 5, days: 7, history: [] });
    expect(p.sources).toHaveLength(1);
    expect(p.notes.join(" ")).toMatch(/No history/);
  });
});
