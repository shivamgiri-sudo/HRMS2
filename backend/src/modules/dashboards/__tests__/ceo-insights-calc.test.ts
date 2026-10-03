import { describe, expect, it } from "vitest";
import {
  ageDays, attendancePct, buildFlow, completeDays, compositeHealth, earlyExitShare, expectedPayrollMonth, filingStatus,
  hiringGap, monthKeys, pivotAttendance, requiredHeadcount, rollingAttrition, scaleScore, shrinkagePct,
} from "../role-insights/providers/ceoCalc.js";

describe("CEO insight calculations", () => {
  it("monthKeys ends at the current month, oldest first, across a year boundary", () => {
    expect(monthKeys("2026-02-10", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("buildFlow rebuilds month-end headcount backwards and rates attrition on the average headcount", () => {
    const months = ["2026-07", "2026-08", "2026-09"];
    const flow = buildFlow(
      months,
      new Map([["2026-07", 100], ["2026-08", 50], ["2026-09", 80]]),
      new Map([["2026-07", 40], ["2026-08", 60], ["2026-09", 20]]),
      new Map([["2026-09", 10]]),
      1000,
    );
    expect(flow.map((p) => p.headcountEnd)).toEqual([950, 940, 1000]);
    // Sept: start = 1000 - 80 + 20 = 940, avg 970, 20 / 970
    expect(flow[2]!.attritionPct).toBe(2.1);
    expect(flow[2]!.earlyExits).toBe(10);
  });

  it("rolling attrition divides 12 months of exits by the MEAN month-end headcount, not the latest", () => {
    const flow = Array.from({ length: 12 }, (_, i) => ({ month: `m${i}`, joins: 0, exits: 10, earlyExits: 5, headcountEnd: i < 6 ? 100 : 200, attritionPct: null }));
    const r = rollingAttrition(flow);
    expect(r.exits).toBe(120);
    expect(r.avgHeadcount).toBe(150);
    expect(r.pct).toBe(80);
    expect(earlyExitShare(flow, 3)).toBe(50);
  });

  it("rolling attrition is null, never 0, when there is no headcount", () => {
    expect(rollingAttrition([{ month: "m", joins: 0, exits: 0, earlyExits: 0, headcountEnd: 0, attritionPct: null }]).pct).toBeNull();
    expect(earlyExitShare([], 3)).toBeNull();
  });

  it("requiredHeadcount grosses the mandate up by every buffer, rounding up", () => {
    expect(requiredHeadcount(100, [10, 15, 0, 0])).toBe(125);
    expect(requiredHeadcount(7, [10, 15, 0, 0])).toBe(9);
  });

  it("hiringGap caps fill per process so a surplus cannot hide a shortage", () => {
    const g = hiringGap([
      { branch: "A", process: "P1", mandate: 100, seatTarget: 110, required: 120, active: 60 },
      { branch: "A", process: "P2", mandate: 10, seatTarget: 11, required: 12, active: 50 },
    ]);
    expect(g.shortToRequired).toBe(60);
    expect(g.shortToTarget).toBe(50);
    expect(g.shortToMandate).toBe(40);
    expect(g.fillPct).toBe(Math.round(((60 + 11) / 121) * 1000) / 10);
    expect(g.understaffed).toBe(1);
  });

  it("attendance and shrinkage use the shared vocabulary and null on an empty denominator", () => {
    const d = pivotAttendance([
      { date: "2026-09-30", status: "present", n: 70 }, { date: "2026-09-30", status: "half_day", n: 10 },
      { date: "2026-09-30", status: "absent", n: 10 }, { date: "2026-09-30", status: "missing_punch", n: 10 },
      { date: "2026-09-30", status: "week_off", n: 40 }, { date: "2026-09-30", status: "leave_approved", n: 5 },
    ])[0]!;
    expect(d.expected).toBe(100);
    expect(attendancePct(d)).toBe(75);
    expect(shrinkagePct(d)).toBe(15);
    expect(attendancePct({ present: 0, halfDay: 0, expected: 0 })).toBeNull();
  });

  it("completeDays drops the partial newest day", () => {
    const mk = (date: string, rows: number) => ({ date, present: 1, halfDay: 0, absent: 0, expected: rows, rows });
    expect(completeDays([mk("a", 1000), mk("b", 990), mk("c", 40)]).map((d) => d.date)).toEqual(["a", "b"]);
  });

  it("filingStatus flags unfiled past-due filings and ignores filed ones", () => {
    expect(filingStatus({ status: "pending", dueDate: "2026-09-15" }, "2026-10-02")).toBe("overdue");
    expect(filingStatus({ status: "pending", dueDate: "2026-10-07" }, "2026-10-02")).toBe("due_soon");
    expect(filingStatus({ status: "pending", dueDate: "2026-10-30" }, "2026-10-02")).toBe("upcoming");
    expect(filingStatus({ status: "filed", dueDate: "2026-09-15" }, "2026-10-02")).toBe("filed");
  });

  it("expectedPayrollMonth is the previous calendar month", () => {
    expect(expectedPayrollMonth("2026-10-02")).toBe("2026-09");
    expect(expectedPayrollMonth("2026-01-05")).toBe("2025-12");
  });

  it("compositeHealth re-normalises over measurable parts and refuses a single-source score", () => {
    const ok = compositeHealth([
      { key: "a", label: "A", score: 100, weight: 50 }, { key: "b", label: "B", score: 50, weight: 50 }, { key: "c", label: "C", score: null, weight: 50 },
    ]);
    expect(ok.score).toBe(75);
    expect(ok.basis).toContain("Not measurable: C");
    expect(compositeHealth([{ key: "a", label: "A", score: 90, weight: 1 }, { key: "b", label: "B", score: null, weight: 1 }]).score).toBeNull();
  });

  it("scaleScore maps in both directions and clamps", () => {
    expect(scaleScore(95, 70, 95)).toBe(100);
    expect(scaleScore(60, 70, 95)).toBe(0);
    expect(scaleScore(15, 25, 5)).toBe(50);
    expect(scaleScore(null, 0, 1)).toBeNull();
  });

  it("ageDays floors at zero and tolerates garbage", () => {
    expect(ageDays("2026-09-30T00:00:00Z", "2026-10-02")).toBe(2);
    expect(ageDays("2026-10-05T00:00:00Z", "2026-10-02")).toBe(0);
    expect(ageDays("nope", "2026-10-02")).toBeNull();
  });
});

describe("completeDays (processed-attendance anchor)", () => {
  const day = (date: string, rows: number) => ({ date, rows, expected: rows, absent: 0, halfDay: 0, present: rows, leave: 0, weekOff: 0 } as never);

  it("never treats today as complete, even when it already has more than half the usual rows", async () => {
    const { completeDays } = await import("../role-insights/providers/ceoCalc.js");
    const out = completeDays([day("2026-10-01", 1100), day("2026-10-02", 1100), day("2026-10-03", 671)], "2026-10-03");
    expect(out.map((d: { date: string }) => d.date)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("drops a still-arriving day at 60% of the usual volume (the old 50% rule kept it and read as a collapse)", async () => {
    const { completeDays } = await import("../role-insights/providers/ceoCalc.js");
    const out = completeDays([day("2026-09-30", 1100), day("2026-10-01", 660)], "2026-10-03");
    expect(out.map((d: { date: string }) => d.date)).toEqual(["2026-09-30"]);
  });
});
