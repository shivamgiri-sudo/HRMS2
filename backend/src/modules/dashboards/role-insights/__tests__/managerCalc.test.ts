import { describe, expect, it } from "vitest";
import {
  achievement, attendanceRate, expandLeaveDays, lateRate, rollupKpis, teamHealth, upcomingMonthDays, yearsOn,
  type DayCounts, type KpiGroupRow,
} from "../providers/managerCalc.js";
import { dayDiff, deltaPoints, queueSeverity, scopeIsEmptyTeam, toAction } from "../providers/mgmtOpsQaShared.js";
import type { InsightContext } from "../types.js";

const day = (o: Partial<DayCounts>): DayCounts => ({ present: 0, half: 0, absent: 0, leave: 0, missing: 0, late: 0, notExpected: 0, total: 0, ...o });

describe("manager attendance maths", () => {
  it("excludes week-offs, holidays and approved leave from the denominator, and credits half days at 0.5", () => {
    // 100 rows: 60 present, 10 half, 10 absent, 10 leave, 10 week-off. Expected = 100 - 10 - 10 = 80. Attended = 65.
    expect(attendanceRate(day({ present: 60, half: 10, absent: 10, leave: 10, notExpected: 10, total: 100 }))).toBe(81.3);
  });
  it("is null (not 0) when nobody was expected to work", () => {
    expect(attendanceRate(day({ notExpected: 20, total: 20 }))).toBeNull();
    expect(attendanceRate(day({}))).toBeNull();
  });
  it("late share is of days worked, null when none worked", () => {
    expect(lateRate(day({ present: 8, half: 2, late: 5 }))).toBe(50);
    expect(lateRate(day({ late: 3 }))).toBeNull();
  });
});

describe("calendar helpers", () => {
  it("upcomingMonthDays wraps the year", () => {
    expect(upcomingMonthDays("2026-12-29", 5).map((d) => d.md)).toEqual(["12-29", "12-30", "12-31", "01-01", "01-02"]);
    expect(upcomingMonthDays("2026-12-29", 5)[3].date).toBe("2027-01-01");
  });
  it("yearsOn counts completed anniversary years", () => {
    expect(yearsOn("2023-10-05", "2026-10-05")).toBe(3);
  });
  it("expandLeaveDays counts people per day across overlapping ranges", () => {
    const out = expandLeaveDays([{ from: "2026-10-01", to: "2026-10-03" }, { from: "2026-10-03", to: "2026-10-04", people: 2 }], "2026-10-02", "2026-10-05");
    expect(out).toEqual([{ date: "2026-10-02", out: 1 }, { date: "2026-10-03", out: 3 }, { date: "2026-10-04", out: 2 }, { date: "2026-10-05", out: 0 }]);
  });
});

describe("KPI roll-up", () => {
  const row = (o: Partial<KpiGroupRow>): KpiGroupRow => ({ code: "QUALITY_SCORE", name: "Quality", unit: "percent", direction: "higher_is_better", processId: "p1", n: 80, d: 100, avg: 74, samples: 10, employees: 4, ...o });
  it("uses sum(numerator)/sum(denominator), scaled x100 for percent metrics - not an average of daily percentages", () => {
    const [r] = rollupKpis([row({ n: 90, d: 100, avg: 50, samples: 1 }), row({ processId: "p2", n: 10, d: 100, avg: 99, samples: 9 })], new Map());
    expect(r.value).toBe(50); // (90+10)/(100+100) = 0.5 -> 50%, whereas the sample-weighted mean of avg would be 94.1
  });
  it("falls back to the sample-weighted mean when a metric has no numerator/denominator", () => {
    const [r] = rollupKpis([row({ code: "DIALS", unit: "count", n: null, d: null, avg: 100, samples: 1 }), row({ code: "DIALS", unit: "count", processId: "p2", n: null, d: null, avg: 200, samples: 3 })], new Map());
    expect(r.value).toBe(175);
  });
  it("shows a target only when processes holding at least half the samples have one", () => {
    const targets = new Map([["p1|QUALITY_SCORE", 85]]);
    const half = rollupKpis([row({ samples: 5 }), row({ processId: "p2", samples: 5 })], targets)[0];
    expect(half.target).toBe(85);
    const minority = rollupKpis([row({ samples: 2 }), row({ processId: "p2", samples: 8 })], targets)[0];
    expect(minority.target).toBeNull();
    expect(minority.achievementPct).toBeNull();
  });
  it("attainment arithmetic", () => {
    expect(achievement(50, 100, "higher_is_better")).toBe(50);
    expect(achievement(200, 100, "lower_is_better")).toBe(50);
    expect(achievement(10, 0, "higher_is_better")).toBeNull();
    expect(achievement(null, 100, "higher_is_better")).toBeNull();
    expect(achievement(500, 100, "higher_is_better")).toBe(120);
  });
});

describe("team health", () => {
  it("is null with fewer than two components", () => {
    expect(teamHealth({ attendancePct: 90, overdueShare: null, highRiskShare: null })).toBeNull();
  });
  it("re-normalises weights over the available parts", () => {
    expect(teamHealth({ attendancePct: 80, overdueShare: 0, highRiskShare: null })?.score).toBe(88); // (80*.5 + 100*.3)/.8
    expect(teamHealth({ attendancePct: 100, overdueShare: 0, highRiskShare: 0.25 })?.score).toBe(80); // risk component = 100-100 = 0 at 25% high-risk
  });
});

describe("shared queue helpers", () => {
  it("dayDiff is whole days and null-safe", () => {
    expect(dayDiff("2026-10-02", "2026-09-25")).toBe(7);
    expect(dayDiff(null, "2026-09-25")).toBeNull();
    expect(dayDiff("garbage", "2026-09-25")).toBeNull();
  });
  it("queueSeverity escalates with overdue items and is info for empty / unknown queues", () => {
    expect(queueSeverity(null, 5)).toBe("info");
    expect(queueSeverity(0, 5)).toBe("info");
    expect(queueSeverity(4, 0)).toBe("normal");
    expect(queueSeverity(4, 1)).toBe("high");
    expect(queueSeverity(9, 3)).toBe("critical");
  });
  it("toAction never reports age or overdue for an unavailable (null) queue", () => {
    const a = toAction({ id: "x", label: "x", href: "/x", count: null, oldestDays: 9, overdue: 4, unavailable: "down" });
    expect(a).toMatchObject({ count: null, oldestDays: null, overdue: null, severity: "info", unavailable: "down" });
  });
  it("deltaPoints is null when either side is unknown", () => {
    expect(deltaPoints(92.2, 52.8)).toBe(39.4);
    expect(deltaPoints(null, 1)).toBeNull();
  });
  it("scopeIsEmptyTeam detects a team scope that resolved to nobody", () => {
    const ctx = (level: string, ids: string[]) => ({ scope: { level, employeeIds: ids, branchIds: [], processIds: [], userId: "u", role: "manager" } }) as unknown as InsightContext;
    expect(scopeIsEmptyTeam(ctx("TEAM_ONLY", []))).toBe(true);
    expect(scopeIsEmptyTeam(ctx("TEAM_ONLY", ["a"]))).toBe(false);
    expect(scopeIsEmptyTeam(ctx("BRANCH_ALL", []))).toBe(false);
  });
});
