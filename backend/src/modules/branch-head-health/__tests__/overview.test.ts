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

  describe("enriched sections", () => {
    const rich = () => raw({
      headcount: { totalActive: 10, joinedToday: 2, leftToday: 1, joinedMtd: 2, leftMtd: 1, upcomingExits: 0, exitsNotClosed: 0, mandateSeatsTotal: 12,
        joinedNames: ["Priya Sharma"], leftNames: ["Old Leaver"],
        byProcess: [{ process: "P1", active: 6, joinedToday: 1, joinedMtd: 2, leftToday: 0, leftMtd: 1, mandateSeats: 8, mandateSource: "workforce" }],
        byLob: [{ lob: "Voice", active: 10 }] },
      shrinkage: { scheduled: 8, present: 7, absent: 1, onLeave: 0, shrinkagePct: 12.5, yetToStart: 0, weekOffWorked: 3, rosterBased: true,
        bySlot: [{ process: "P1", shift: "09:00-18:00", planned: 8, present: 7, absent: 1, late: 2 }] },
      prevShrinkage: { scheduled: 9, present: 8, absent: 1, onLeave: 0, shrinkagePct: 11.1, yetToStart: 0, weekOffWorked: 0, bySlot: [] },
      lateStats: { totalLate: 3, processWise: [{ process: "P1", count: 3 }], byManager: [{ process: "P1", manager: "Mgr X", count: 3 }] },
      absence: { total: 1, rows: [{ name: "Absent Person", manager: "Boss Person" }] },
      openHiring: { openPositions: 5, inPipeline: 2, selected: 1, requested: 6, fulfilled: 1, pendingApproval: 0, upcomingRequisitions: 1, pastDeliveryRequisitions: 0, pastDeliveryOpenPositions: 0,
        rows: [{ code: "REQ-1", designation: "Agent", process: "P1", priority: "high", requested: 6, fulfilled: 1, openPositions: 5, inPipeline: 2, selected: 1, deliveryDate: "2026-10-30", daysToDelivery: 15, plannedBatch: "B1" }] },
      offers: { offered: 10, joined: 7, notJoined: 3, conversionPct: 70, joiningNext7Days: 2, mtd: { offered: 5, joined: 3, notJoined: 2, conversionPct: 60 } },
      ats: { walkins: 4, tokens: 4, tokensClosed: 3, selected: 1, rejected: 1, noShow: 0, clientRound: 0, hold: 0, otherClosed: 0, open: 1, noFeedback: 0, openQueueCompleted: 0, slaBreaches: 1, slaTotal: 4 },
      pendingActions: [{ type: "grn_pending", count: 2, label: "GRNs awaiting approval" }],
      runningPnl: { periodCode: "2026-10", daysInMonth: 31, daysElapsed: 15, mode: "LIVE_MTD", revenueInvoice: 100, revenueAccrual: 0, revenueEstimated: 0, creditNote: 0, revenueRunning: 150, salaryRunning: 60, grnConsumed: 10, grnReserved: 5, totalCostRunning: 90, operatingProfit: 60, opPct: 40, staffPaid: 9, estimatedCostCentres: 0, costCentres: 2, dataAvailable: true },
      budget: { periodCode: "2026-10", totalBudget: 100, consumed: 10, reserved: 5, available: 85, utilizationPct: 15 },
      budgetHeader: { missing: false, status: "active" },
      budgetByHead: { top: [{ head: "Rent", budget: 10, charged: 5, pct: 50 }], overBudget: [] },
      budgetHistory: [{ periodCode: "2026-09", headerStatus: "active", declared: 100, used: 90, effective: 95, headsTotal: 3, headsClosed: 1, openRows: [{ head: "Rent", subHead: "x", budget: 1, used: 1 }] }],
      grnStats: { raised: 5, approved: 3, pending: 2, oldestPendingDays: 4, pendingOver3Days: 1, totalRaisedAmount: 500,
        bridge: { raisedExGst: 400, awaitingApproval: 1, earlierBudget: 0, noBudgetLine: 0, chargedThisMonth: 3, fromEarlierMonths: 0, budgetChargeTotal: 15 },
        unbudgeted: { count: 1, amountExGst: 50, rows: [{ grnNumber: "GRN-9", head: "Rent", amountExGst: 50, status: "submitted", raisedOn: "2026-10-01" }] },
        pendingByStage: [{ status: "submitted", stage: "Finance Head", count: 2, amountInclGst: 100, oldestDays: 4 }],
        byType: [{ type: "vendor", label: "Vendor", raised: 5, raisedInclGst: 500, raisedExGst: 400, approved: 3, pending: 2, pendingInclGst: 100 }] },
      recentGrns: [{ grnNumber: "GRN-1", requestedBy: "Requester Person", vendor: "V" }],
      pnlGrnTieOut: { budgetConsumed: 10, budgetReserved: 5, hrmsNoBudgetLine: 0, hrmsOrdinary: 0, imprestReservedNoCostCentre: 0 },
      payrollReadiness: { cycleMonth: "2026-09", calendar: null, pendingRegularization: 1, pendingLeave: 2, incentivesExpected: null, incentiveState: null, pendingIncrements: 0, oldestIncrementDays: null },
      leaveAging: { pending: 3, oldestDays: 8, over3Days: 2, over7Days: 1, staleOlderThanWindow: 4 },
      regularization: { pending: 5, oldestDays: 9, over3Days: 3, over7Days: 2, escalated: 1 },
      attrition: { headcount: 10, critical: 1, high: 2, medium: 3, low: 4, expectedExits30: 1.5, absentStreak: 1, newJoinerRisk: 2, exits30: 3, exitsPrev30: 2, exits90: 6, earlyExitSharePct: 33.3,
        monthlyExits: [{ month: "2026-09", exits: 3 }], byProcess: [{ process: "P1", headcount: 6, highRisk: 2, absentStreak: 1 }],
        topRisk: [{ code: "E1", name: "Risky Person", process: "P1", aonDays: 5, score: 90, tier: "HIGH", reasons: ["r"], absentStreak: 3 }, { code: "E2", name: "Another Risky", process: "P1", aonDays: 5, score: 80, tier: "HIGH", reasons: [], absentStreak: 0 }],
        calibrationNote: "note" },
    });
    const NAMES = ["Priya Sharma", "Old Leaver", "Absent Person", "Boss Person", "Mgr X", "Requester Person", "Risky Person", "Another Risky", "GRN-9", "GRN-1", "REQ-1", "E1"];
    const run = async (r: unknown) => { fetchAll.mockResolvedValue(r); build.mockReturnValue(report(r)); return buildOverview(branch, "2026-10-15"); };

    it("people, attendance, hiring carry the new fields", async () => {
      const o: any = await run(rich());
      expect(o.people.data.byProcess).toEqual([{ process: "P1", active: 6, joinedMtd: 2, leftMtd: 1, mandateSeats: 8 }]);
      expect(o.people.data.byLob).toEqual([{ lob: "Voice", active: 10 }]);
      expect(o.attendance.data.bySlot).toEqual([{ process: "P1", shift: "09:00-18:00", planned: 8, present: 7, absent: 1, late: 2 }]);
      expect(o.attendance.data.processWise).toEqual([{ process: "P1", late: 3 }]);
      expect(o.attendance.data.previousDay).toEqual({ shrinkagePct: 11.1, absent: 1, scheduled: 9 });
      expect(o.attendance.data.weekOffWorked).toBe(3);
      expect(o.hiring.data.batches).toHaveLength(1);
      expect(o.hiring.data.batches[0]).toMatchObject({ process: "P1", designation: "Agent", openPositions: 5, deliveryDate: "2026-10-30" });
      expect(o.hiring.data.offers).toEqual({
        last30: { offered: 10, joined: 7, notJoined: 3, conversionPct: 70 }, mtd: { offered: 5, joined: 3, notJoined: 2, conversionPct: 60 }, joiningNext7Days: 2 });
      expect(o.hiring.data.ats).toMatchObject({ walkins: 4, slaBreaches: 1, slaTotal: 4 });
      expect(o.hiring.data.pendingActions).toEqual([{ type: "grn_pending", count: 2, label: "GRNs awaiting approval" }]);
    });
    it("previousDay is null without prevShrinkage", async () => {
      const o: any = await run(rich() && { ...rich(), prevShrinkage: null });
      expect(o.attendance.data.previousDay).toBeNull();
    });
    it("finance carries pnl, projection, budget, heads, history, grn, tieOut, payroll", async () => {
      const o: any = await run(rich());
      const f = o.finance.data;
      expect(f.pnl.salaryRunning).toBe(60);
      expect(f.pnl.grnReserved).toBe(5);
      expect(f.projection).toEqual({ revenue: (150 / 15) * 31, cost: (90 / 15) * 31, operatingProfit: ((150 - 90) / 15) * 31, opPct: 40, basis: "linear on days elapsed" });
      expect(f.budget).toMatchObject({ totalBudget: 100, available: 85, headerMissing: false, headerStatus: "active" });
      expect(f.byHead.top).toHaveLength(1);
      expect(f.history[0]).toMatchObject({ periodCode: "2026-09", used: 90, headsClosed: 1 });
      expect(f.grn).toMatchObject({ raised: 5, pending: 2, unbudgeted: { count: 1, amountExGst: 50 } });
      expect(f.grn.unbudgeted.rows).toBeUndefined();
      expect(f.grn.pendingByStage[0].stage).toBe("Finance Head");
      expect(f.grn.byType[0].type).toBe("vendor");
      expect(f.grn.bridge.raisedExGst).toBe(400);
      expect(f.tieOut.budgetConsumed).toBe(10);
      expect(f.payrollReadiness.pendingLeave).toBe(2);
      expect(f.revenueRunning).toBe(150);
    });
    it("projection is null-safe when daysElapsed is 0", async () => {
      const base: any = rich();
      const o: any = await run({ ...base, runningPnl: { ...base.runningPnl, daysElapsed: 0 } });
      expect(o.finance.data.projection).toBeNull();
    });
    it("attrition aggregate with topRiskCount, empty when absent", async () => {
      const o: any = await run(rich());
      expect(o.attrition.status).toBe("ok");
      expect(o.attrition.data.topRiskCount).toBe(2);
      expect(o.attrition.data.critical).toBe(1);
      expect(o.attrition.data.byProcess[0]).toEqual({ process: "P1", headcount: 6, highRisk: 2, absentStreak: 1 });
      expect(o.attrition.data.topRisk).toBeUndefined();
      const o2: any = await run({ ...(rich() as any), attrition: undefined });
      expect(o2.attrition.status).toBe("empty");
    });
    it("backlogs carry counts and ages only", async () => {
      const o: any = await run(rich());
      expect(o.backlogs.data.regularization).toEqual({ pending: 5, oldestDays: 9, over3Days: 3, over7Days: 2, escalated: 1 });
      expect(o.backlogs.data.leaveAging).toEqual({ pending: 3, oldestDays: 8, over3Days: 2, over7Days: 1, staleOlderThanWindow: 4 });
    });
    it("a throwing new slice stays isolated", async () => {
      const o: any = await run({ ...(rich() as any), leaveAging: undefined });
      expect(o.backlogs.status).toBe("error");
      expect(o.finance.status).toBe("ok");
    });
    it("serialized overview contains no names from the enriched raw structures", async () => {
      const o = await run(rich());
      const json = JSON.stringify(o);
      for (const n of NAMES) expect(json).not.toContain(n);
    });
  });
});
