import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[]]) } }));

import { buildEscalations } from "../metrics.js";
import { renderEmail, subjectLine } from "../template.js";
import { buildBranchHealthReport } from "../metrics.js";

const calm = (over: Record<string, unknown> = {}): any => ({
  branchId: "b1",
  budget: { periodCode: "2026-10", totalBudget: 100, consumed: 10, reserved: 0, available: 90, utilizationPct: 10 },
  budgetHeader: { missing: false, status: "active" },
  grnStats: { pending: 0, oldestPendingDays: 0, pendingOver3Days: 0, unbudgeted: { count: 0, amountExGst: 0, rows: [] } },
  shrinkage: { shrinkagePct: 2, scheduled: 10, present: 9, absent: 0 },
  prevShrinkage: { shrinkagePct: 2 },
  leaveAging: { oldestDays: 0, over7Days: 0 },
  regularization: { oldestDays: 0, over7Days: 0, escalated: 0 },
  openHiring: { pastDeliveryRequisitions: 0, pastDeliveryOpenPositions: 0, rows: [] },
  offers: { offered: 0, joined: 0, conversionPct: null },
  headcount: { exitsNotClosed: 0 },
  runningPnl: { dataAvailable: false, opPct: null },
  budgetByHead: { top: [], overBudget: [] },
  attrition: null,
  ...over,
});

describe("buildEscalations", () => {
  it("is silent on a calm day", () => {
    expect(buildEscalations(calm(), "2026-10-15")).toEqual([]);
  });
  it("does not flag a missing budget on day 1 but does on day 2", () => {
    const raw = calm({ budgetHeader: { missing: true, status: null } });
    expect(buildEscalations(raw, "2026-10-01")).toEqual([]);
    expect(buildEscalations(raw, "2026-10-02")[0].label).toMatch(/October 2026 budget NOT CREATED/);
  });
  it("flags an unapproved budget after day 5", () => {
    const raw = calm({ budgetHeader: { missing: false, status: "submitted" } });
    expect(buildEscalations(raw, "2026-10-04")).toEqual([]);
    expect(buildEscalations(raw, "2026-10-06")[0].label).toMatch(/NOT ACTIVE.*Branch Head/);
  });
  it("never flags an ACTIVE budget, however late in the month", () => {
    const raw = calm({ budgetHeader: { missing: false, status: "active" } });
    expect(buildEscalations(raw, "2026-10-28")).toEqual([]);
  });
  it("branch-head-approved budget waits on the Finance Head", () => {
    const raw = calm({ budgetHeader: { missing: false, status: "branch_head_approved" } });
    expect(buildEscalations(raw, "2026-10-06")[0].owner).toBe("Finance Head");
  });
  it("a draft or closed-only budget is flagged from day 2", () => {
    expect(buildEscalations(calm({ budgetHeader: { missing: false, status: "draft" } }), "2026-10-02")[0].key).toBe("budget_not_submitted");
    expect(buildEscalations(calm({ budgetHeader: { missing: false, status: "closed" } }), "2026-10-02")[0].key).toBe("budget_not_submitted");
  });
  it("every escalation carries a source line", () => {
    const raw = calm({ budgetHeader: { missing: true, status: null } });
    expect(buildEscalations(raw, "2026-10-05").every((e) => !!e.source)).toBe(true);
  });
  it("stuck GRNs: says HRMS-only and names the stage holding them", () => {
    const raw = calm({ grnStats: { pending: 3, oldestPendingDays: 9, unbudgeted: { count: 0, amountExGst: 0 },
      pendingByStage: [{ status: "submitted", stage: "With Branch Head (submitted)", count: 3, oldestDays: 9 }] } });
    const e = buildEscalations(raw, "2026-10-15").find((x) => x.key === "grn_stuck")!;
    expect(e.label).toMatch(/3 HRMS GRNs stuck/);
    expect(e.detail).toMatch(/3 with branch head \(submitted\) \(oldest 9d\).*db_bill GRNs are excluded/);
  });
  it("flags shrinkage that stays high two days running", () => {
    const raw = calm({ shrinkage: { shrinkagePct: 14 }, prevShrinkage: { shrinkagePct: 12 } });
    expect(buildEscalations(raw, "2026-10-15")[0].label).toMatch(/Shrinkage above 10%.*14% today, 12% yesterday/);
  });
  it("flags spend far ahead of the calendar", () => {
    const raw = calm({ budget: { totalBudget: 100, consumed: 70, reserved: 0 } });
    expect(buildEscalations(raw, "2026-10-10")[0].label).toMatch(/ahead of the month/);
  });
  it("puts a red banner at the top of the email and counts it in the subject", async () => {
    const { fetchAllBranchHealthData } = await import("../query.js");
    const full: any = await fetchAllBranchHealthData("Nowhere", "2026-10-05"); // unknown branch -> complete empty shape
    const raw = { ...full, branchId: "b1", budgetHeader: { missing: true, status: null } };
    const report = buildBranchHealthReport("Kolkata", "2026-10-05", raw);
    expect(report.overallStatus).toBe("critical");
    expect(subjectLine(report)).toMatch(/1 ESCALATION$/);
    const html = renderEmail(report, { generatedAt: "now" });
    expect(html).toContain("October 2026 budget NOT CREATED");
    expect(html.indexOf("ESCALATION")).toBeLessThan(html.indexOf("Budget vs Consumption"));
  });

  it("shows the red streak and the next-level notice once an item is chronic", async () => {
    const { fetchAllBranchHealthData } = await import("../query.js");
    const full: any = await fetchAllBranchHealthData("Nowhere", "2026-10-05");
    const raw = { ...full, branchId: "b1", budgetHeader: { missing: true, status: null } };
    const report = buildBranchHealthReport("Kolkata", "2026-10-05", raw);
    report.escalations[0].days = 4;
    report.escalations[0].since = "2026-10-02";
    const html = renderEmail(report, { generatedAt: "now" });
    expect(html).toContain("RED 4 DAYS · since 2 Oct");
    expect(html).toContain("HR Head and Operations Head");
    report.escalations[0].days = 1;
    expect(renderEmail(report, { generatedAt: "now" })).toContain("NEW TODAY");
  });
});
