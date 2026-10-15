import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAll = vi.fn();
const build = vi.fn();
vi.mock("../../branch-health-report/query.js", () => ({ fetchAllBranchHealthData: (...a: unknown[]) => fetchAll(...a) }));
vi.mock("../../branch-health-report/metrics.js", () => ({ buildBranchHealthReport: (...a: unknown[]) => build(...a) }));

import { buildOverview } from "../overview.js";

const branch = { branchId: "b1", branchCode: "CORP", branchName: "HEAD OFFICE" };

function raw(over: Record<string, unknown> = {}) {
  return {
    branchId: "b1",
    headcount: { totalActive: 10, joinedToday: 1, leftToday: 0, joinedMtd: 2, leftMtd: 1, upcomingExits: 0, exitsNotClosed: 0, mandateSeatsTotal: null, joinedNames: ["Agent A"], leftNames: [] },
    shrinkage: { scheduled: 8, present: 7, absent: 1, onLeave: 0, shrinkagePct: 12.5, yetToStart: 0 },
    lateStats: { totalLate: 3, processWise: [], byManager: [
      { process: "P1", manager: "Mgr X", count: 2 }, { process: "P2", manager: "Mgr X", count: 1 }, { process: "P1", manager: "Mgr Y", count: 4 } ] },
    openHiring: { openPositions: 5, inPipeline: 2, selected: 1, requested: 6, fulfilled: 1, pendingApproval: 0, rows: [] },
    runningPnl: { periodCode: "2026-10", revenueRunning: 100, totalCostRunning: 80, operatingProfit: 20, opPct: 20 },
    budget: { utilizationPct: 50 },
    ...over,
  };
}
const report = (r: unknown) => ({ branch: "HEAD OFFICE", reportDate: "2026-10-15", raw: r, criticalPoints: [{ label: "L", detail: "D", severity: "critical" }], positiveAchievements: [{ label: "P", detail: "Q" }], overallStatus: "watch" });

beforeEach(() => { fetchAll.mockReset(); build.mockReset(); });

describe("buildOverview", () => {
  it("passes branch_code (not name) to fetchAllBranchHealthData", async () => {
    const r = raw(); fetchAll.mockResolvedValue(r); build.mockReturnValue(report(r));
    await buildOverview(branch, "2026-10-15");
    expect(fetchAll).toHaveBeenCalledWith("CORP", "2026-10-15");
    expect(build).toHaveBeenCalledWith("HEAD OFFICE", "2026-10-15", r);
  });
  it("overallStatus, criticalPoints equal buildBranchHealthReport output", async () => {
    const r = raw(); fetchAll.mockResolvedValue(r); build.mockReturnValue(report(r));
    const o = await buildOverview(branch, "2026-10-15");
    expect(o.status).toBe("watch");
    expect(o.attention).toEqual([{ label: "L", detail: "D", severity: "critical" }]);
    expect(o.positives).toEqual([{ label: "P", detail: "Q" }]);
  });
  it("a section that throws becomes status error while the others stay ok", async () => {
    const r = raw({ shrinkage: undefined }); fetchAll.mockResolvedValue(r); build.mockReturnValue(report(r));
    const o = await buildOverview(branch, "2026-10-15");
    expect(o.attendance.status).toBe("error");
    expect(o.people.status).toBe("ok");
    expect(o.hiring.status).toBe("ok");
    expect(o.finance.status).toBe("ok");
  });
  it("leaderboard is aggregate per manager and carries no agent names", async () => {
    const r = raw(); fetchAll.mockResolvedValue(r); build.mockReturnValue(report(r));
    const o = await buildOverview(branch, "2026-10-15");
    expect(o.leaderboard.data).toEqual([
      { manager: "Team 1", late: 4, shrinkagePct: null }, { manager: "Team 2", late: 3, shrinkagePct: null } ]);
    expect(JSON.stringify(o)).not.toMatch(/Mgr X|Mgr Y/);
    expect(JSON.stringify(o)).not.toContain("Agent A");
  });
  it("branchId null from the fetcher yields empty sections, not an exception", async () => {
    fetchAll.mockResolvedValue({ branchId: null });
    const o = await buildOverview(branch, "2026-10-15");
    expect(build).not.toHaveBeenCalled();
    expect(o.status).toBe("no_data");
    expect(o.people.status).toBe("empty");
    expect(o.leaderboard.status).toBe("empty");
  });

  it("loadReport returns null when the fetcher resolved a different branch", async () => {
    fetchAll.mockResolvedValue(raw({ branchId: "other" }));
    const o = await buildOverview(branch, "2026-10-15");
    expect(o.status).toBe("no_data");
    expect(build).not.toHaveBeenCalled();
  });
  it("no person names in attention, positives or anywhere in the serialized overview", async () => {
    const r = raw({
      headcount: { totalActive: 10, joinedToday: 2, leftToday: 1, joinedMtd: 2, leftMtd: 1, upcomingExits: 0, exitsNotClosed: 0, mandateSeatsTotal: null, joinedNames: ["Priya Sharma", "Rahul Verma"], leftNames: ["Old Leaver"] },
      absence: { total: 1, rows: [{ name: "Absent Person", manager: "Boss Person" }] },
    });
    fetchAll.mockResolvedValue(r);
    build.mockReturnValue({
      ...report(r),
      criticalPoints: [{ label: "1 employee absent 3+ days running", detail: "Absent Person (Boss Person)", severity: "warning" }],
      positiveAchievements: [{ label: "2 new joiners today", detail: "Priya Sharma, Rahul Verma" }],
    });
    const o = await buildOverview(branch, "2026-10-15");
    const json = JSON.stringify(o);
    for (const n of ["Priya Sharma", "Rahul Verma", "Old Leaver", "Absent Person", "Boss Person", "Mgr X", "Mgr Y"]) expect(json).not.toContain(n);
    expect(o.positives[0].detail).toBe("2 joined today");
    expect(o.attention).toHaveLength(1);
  });
});
