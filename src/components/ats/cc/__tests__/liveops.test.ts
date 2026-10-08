import { describe, expect, it } from "vitest";
import type { AtsOperations } from "@/hooks/useAtsDashboards";
import { buildLiveFindings, capacityByBranch, escalationCounts, filterQueue, fmtWait, groupBreaches, istHour, peakCells, rateByKey, slotTotals, sortEscalations, waitTone, weekdayBreaches } from "../liveops-helpers";

const row = (o: Partial<AtsOperations["queue"][number]>) => ({ id: "1", code: "C", name: "N", status: "waiting", stage: "Token", process: null, branch: "A", recruiter: "R1", arrival: "2026-10-01T04:00:00Z", waitMin: 5, token: "T1", ...o });
const ops = (o: Partial<AtsOperations> = {}): AtsOperations => ({
  generatedAt: "", slaMinutes: 20, today: { arrived: 10, selected: 0, rejected: 0, noShow: 0, waiting: 4, breach: 3 },
  queue: [row({ waitMin: 50 }), row({ id: "2", waitMin: 30 }), row({ id: "3", waitMin: 25 }), row({ id: "4", waitMin: 5, branch: "B" })],
  waitBuckets: [], hourly: [], branches: [], roster: [], sla: { daily: [], recent: [] }, recoverable: { noShow30: 0, hold30: 0, list: [] }, ...o,
});

describe("liveops helpers", () => {
  it("formats waits", () => {
    expect(fmtWait(45)).toBe("45m"); expect(fmtWait(125)).toBe("2h 05m"); expect(fmtWait(4000)).toBe("2d 18h");
    expect(fmtWait(-1)).toBe("–"); expect(fmtWait(null)).toBe("–"); expect(fmtWait(NaN)).toBe("–");
  });
  it("classifies wait tone", () => {
    expect(waitTone(10, 20)).toBe("ok"); expect(waitTone(20, 20)).toBe("warn"); expect(waitTone(40, 20)).toBe("crit");
  });
  it("filters and sorts the queue", () => {
    const q = ops().queue;
    expect(filterQueue(q, "all", 20).map((r) => r.waitMin)).toEqual([50, 30, 25, 5]);
    expect(filterQueue(q, "breached", 20)).toHaveLength(3);
    expect(filterQueue(q, "all", 20, "B")).toHaveLength(1);
  });
  it("converts to IST hour", () => {
    expect(istHour("2026-10-01T04:00:00Z")).toBe(9); expect(istHour("2026-10-01T19:00:00Z")).toBe(0); expect(istHour("bad")).toBe(-1);
  });
  it("groups breaches", () => {
    const g = groupBreaches(ops().queue, 20);
    expect(g.total).toBe(3); expect(g.byBranch[0]).toEqual({ name: "A", n: 3 }); expect(g.byHour).toEqual([{ hour: 9, n: 3 }]); expect(g.byRecruiter[0].n).toBe(3);
  });
  it("groups SLA events by weekday", () => {
    const w = weekdayBreaches([{ date: "2026-09-28", events: 4, avgBreach: 1 }, { date: "2026-10-05T00:00:00Z", events: 2, avgBreach: 1 }]);
    expect(w[1]).toMatchObject({ label: "Mon", events: 6, days: 2, perDay: 3 }); expect(w[0].perDay).toBe(0);
  });
  it("counts and sorts escalations", () => {
    const l = [{ level: 1 as const, overSlaMin: 5 }, { level: 3 as const, overSlaMin: 10 }, { level: 3 as const, overSlaMin: 90 }];
    expect(escalationCounts(l)).toEqual({ l1: 1, l2: 0, l3: 2 }); expect(sortEscalations(l)[0].overSlaMin).toBe(90);
  });
  it("computes rates and slots", () => {
    expect(rateByKey([{ key: 1, n: 10 }, { key: 2, n: 0 }], [{ key: 1, n: 3 }])).toEqual([{ key: 1, total: 10, hit: 3, rate: 30 }]);
    const grid = [{ dow: 2, hour: 9, total: 5 }, { dow: 2, hour: 11, total: 7 }, { dow: 3, hour: 16, total: 1 }];
    expect(slotTotals(grid).map((s) => s.total)).toEqual([5, 7, 0, 1]); expect(peakCells(grid, 1)[0].hour).toBe(11);
  });
  it("rolls capacity up by branch", () => {
    const c = capacityByBranch([{ name: "a", branch: "X", capacity: 4, assigned: 5, available: true }, { name: "b", branch: "X", capacity: 4, assigned: 1, available: false }]);
    expect(c[0]).toMatchObject({ branch: "X", capacity: 8, assigned: 6, util: 75, available: 1 });
  });
  it("builds findings", () => {
    const f = buildLiveFindings(ops());
    expect(f[0].tone).toBe("bad"); expect(f.some((x) => x.title.includes("holds 100%"))).toBe(true);
    expect(buildLiveFindings(ops({ queue: [], today: { arrived: 1, selected: 0, rejected: 0, noShow: 0, waiting: 0, breach: 0 } }))[0].tone).toBe("good");
  });
});
