import { describe, expect, it } from "vitest";
import {
  DAILY_ANALYST_TARGET, achievementPct, connectPct, fmtPctNA, gap, momPct, summarizeTargets,
  targetsByAgent, targetsByDate, weightedAvg, type TargetRowLike,
} from "./reginaldMetrics";

const row = (agent: string, date: string, target: number, totalCdr: number, revenue = 0): TargetRowLike => ({
  agent, agentName: null, date, eligibleDays: target / DAILY_ANALYST_TARGET, target, totalCdr, aprTalkSec: 0, revenue,
});

describe("Reginald target roll-ups", () => {
  // UAT-05: 3 present days + 1 absent day -> period target 40,500
  const rows = [
    row("A", "2026-09-01", 13500, 12150),
    row("A", "2026-09-02", 13500, 13500),
    row("A", "2026-09-03", 13500, 14850),
    row("A", "2026-09-04", 0, 300),
    row("B", "2026-09-01", 0, 0),
  ];

  it("period target = 13,500 x present days; absence adds nothing", () => {
    const s = summarizeTargets(rows.filter(r => r.agent === "A"), "totalCdr");
    expect(s.target).toBe(40500);
    expect(s.eligibleDays).toBe(3);
    expect(s.actual).toBe(40800);
    expect(s.gap).toBe(300);
    expect(s.achievementPct).toBe(100.74);
  });

  it("ranks analysts with N/A achievement last", () => {
    const by = targetsByAgent(rows, "totalCdr");
    expect(by.map(a => a.agent)).toEqual(["A", "B"]);
    expect(by[1].achievementPct).toBeNull();
  });

  it("totals per date for the target-vs-actual chart", () => {
    const d = targetsByDate(rows, "totalCdr");
    expect(d[0]).toEqual({ date: "2026-09-01", target: 13500, actual: 12150, achievementPct: 90 });
    expect(d[3]).toEqual({ date: "2026-09-04", target: 0, actual: 300, achievementPct: null });
  });

  it("can measure actual on another basis", () => {
    expect(summarizeTargets([row("A", "2026-09-01", 13500, 0, 6750)], "revenue").achievementPct).toBe(50);
  });
});

describe("Reginald formulas", () => {
  it("gap, achievement, MoM and connect %", () => {
    expect(gap(12150, 13500)).toBe(-1350);
    expect(achievementPct(12150, 13500)).toBe(90);
    expect(achievementPct(1, 0)).toBeNull();
    expect(momPct(120, 100)).toBe(20);
    expect(momPct(120, 0)).toBeNull();
    expect(connectPct(25, 100)).toBe(25);
    expect(connectPct(5, 0)).toBe(0);
    expect(weightedAvg(2400, 100)).toBe(24);
  });
  it("shows N/A rather than a broken number", () => {
    expect(fmtPctNA(null)).toBe("N/A");
    expect(fmtPctNA(Number.NaN)).toBe("N/A");
    expect(fmtPctNA(90)).toBe("90.0%");
  });
});
