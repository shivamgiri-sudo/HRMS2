import { describe, it, expect } from "vitest";
import {
  alertSeverity, severityCounts, pct, summarize, effectivenessScore, fmtDateTime, fmtDuration, type ManagerDigest, type LiveAlert,
} from "../roster-command-center/live-monitoring/liveMonitoringCalc";

const dg = (o: Partial<ManagerDigest>): ManagerDigest => ({
  managerId: "m", managerName: "M", managerEmail: null, date: "2026-09-30", branchId: null, branchName: null,
  teamSize: 0, planned: 0, present: 0, shrinkagePct: 0, unplannedAbsences: [], lateArrivals: [], incompleteShifts: [], onTime: [], aprPending: 0, ...o,
});
const mem = (n: number) => Array.from({ length: n }, (_, i) => ({ employeeId: `e${i}`, employeeCode: `C${i}`, employeeName: `N${i}` }));

describe("severity", () => {
  it("uses one threshold set", () => {
    expect(alertSeverity(29)).toBe("info");
    expect(alertSeverity(30)).toBe("warning");
    expect(alertSeverity(60)).toBe("critical");
  });
  it("counts", () => {
    const a = [10, 45, 90, 61].map((m) => ({ minutesSinceShiftStart: m } as LiveAlert));
    expect(severityCounts(a)).toEqual({ critical: 2, warning: 1, info: 1 });
  });
});
describe("summarize", () => {
  it("pools shrinkage by planned (not mean of percents)", () => {
    const s = summarize([
      dg({ planned: 100, present: 90, shrinkagePct: 10, onTime: mem(90) }),
      dg({ planned: 2, present: 0, shrinkagePct: 100, unplannedAbsences: mem(2) }),
    ]);
    expect(s.planned).toBe(102);
    expect(s.coveragePct).toBe(88);
    expect(s.shrinkagePct).toBe(12); // mean-of-percents would have said 55
    expect(s.absent).toBe(2);
  });
  it("empty => nulls, no NaN", () => {
    const s = summarize([]);
    expect(s.coveragePct).toBeNull();
    expect(s.shrinkagePct).toBeNull();
  });
});
describe("effectivenessScore", () => {
  it("null when nothing planned (no free 100)", () => expect(effectivenessScore(dg({}))).toBeNull());
  it("perfect team = 100", () => expect(effectivenessScore(dg({ planned: 5, present: 5, onTime: mem(5) }))).toBe(100));
  it("all absent scores low", () => expect(effectivenessScore(dg({ planned: 5, present: 0, shrinkagePct: 100, aprPending: 6 }))).toBe(0));
});
describe("format", () => {
  it("pct", () => { expect(pct(1, 0)).toBeNull(); expect(pct(1, 3)).toBe(33); });
  it("dates", () => {
    expect(fmtDateTime("2026-09-30 09:05:00")).toBe("30/09/2026 09:05");
    expect(fmtDateTime("2026-09-30")).toBe("30/09/2026");
    expect(fmtDateTime(null)).toBe("—");
  });
  it("duration", () => { expect(fmtDuration(75)).toBe("1h 15m"); expect(fmtDuration(-1)).toBe("—"); });
});
