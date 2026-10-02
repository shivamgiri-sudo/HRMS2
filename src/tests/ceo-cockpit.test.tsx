import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { CeoReferenceLayout } from "@/pages/dashboards/reference/CeoReferenceLayout";
import {
  actionScore, buildCeoModel, costCoverage, qualityTone, rankAttention, revenueByBranch, revenueView, summaryAttention,
} from "@/pages/dashboards/reference/ceo/ceoModel";
import type { ReferenceDashboardData } from "@/pages/dashboards/reference-dashboard-model";
import type { RoleInsights } from "@/pages/dashboards/kit";

const INSIGHTS: RoleInsights = {
  dashboardCode: "CEO_DASHBOARD", generatedAt: "2026-10-02T10:00:00Z", scopeLevel: "ORG_ALL", healthScore: 62, healthBasis: "Attendance 70 · Attrition 55",
  actions: [
    { id: "ceo-payment-vouchers", group: "Needs your decision", label: "Payment vouchers awaiting CEO approval", count: 2, oldestDays: 21, overdue: 2, severity: "high", href: "/finance/ledger?tab=payments" },
    { id: "ceo-payroll-ack", group: "Needs your decision", label: "Payroll runs awaiting CEO acknowledgement", count: 2, oldestDays: 93, overdue: 2, severity: "critical", href: "/payroll/sign-off" },
    { id: "exit-chain", group: "Oversight", label: "Exits in the approval chain", count: 16, oldestDays: 1, overdue: 0, severity: "normal", href: "/exit/command-center" },
  ],
  kpis: [
    { key: "attrition_12m", label: "Attrition", value: 273.2, unit: "percent", helper: "2,795 exits", spark: [19, 21, 26] },
    { key: "hiring_gap", label: "Hiring gap", value: 120, unit: "count", helper: "852 on roll" },
    { key: "net_flow_30d", label: "Net flow", value: 78, unit: "count", helper: "209 joined − 131 left" },
    { key: "payroll_runs_open", label: "Payroll runs not finalized", value: 2, unit: "count", href: "/payroll/sign-off" },
  ],
  series: [{ key: "attendance_30d", title: "Attendance & shrinkage — last 30 processed days", kind: "line", unit: "percent", points: [{ label: "09-01", a: 60 }, { label: "09-02", a: 62 }], keys: [{ key: "a", label: "A" }] }],
  tables: [{
    key: "branch_league", title: "Branch league table",
    columns: [{ key: "branch", label: "Branch" }, { key: "attendance", label: "Attendance 10-01", unit: "percent" }],
    rows: [{ branchId: "b1", branch: "NOIDA", headcount: 444, attendance: 89, exits90: 164, exitRate90: 31.2, href: "/dashboards/drill/CEO_DASHBOARD/HEADCOUNT?branchId=b1" }],
  }],
  signals: [{ tone: "bad", title: "Statutory filings past due", detail: "4 filings unfiled", value: 4 }],
  sectionErrors: {},
};

function baseData(overrides: Partial<ReferenceDashboardData> = {}): ReferenceDashboardData {
  return {
    variant: "ceo", dashboardCode: "CEO_DASHBOARD", summary: {} as never, metrics: {} as never,
    employee: { attendance: {}, balances: [], onboarding: {}, lms: {}, engagement: {}, sourceErrors: [], sourceFreshness: {} },
    ats: {}, system: {}, workforce: {}, pnl: {}, payroll: {}, biometric: {}, devices: {}, opsPulse: {},
    managerLeaves: [], managerInsights: {}, managerAccountability: [], quality: {}, orgKpi: {}, loading: false, ...overrides,
  } as unknown as ReferenceDashboardData;
}

function render(data: ReferenceDashboardData): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><CeoReferenceLayout data={data} filters={null} /></MemoryRouter></QueryClientProvider>);
}

const METRICS = {
  hc: { value: 1063, available: true, detail: { active: 1063 } },
  att: { value: 72.2, available: true, detail: { attendanceRate: 72.2 }, asOf: "2026-10-01T00:00:00.000Z" },
  payroll: { value: 882, available: true, detail: { readyCount: 882, blockerCount: 238 } },
  bgv: { value: 109, available: true, detail: { pending: 109 } },
  onb: { value: 28, available: true, detail: { pending: 28 } },
  resign: { value: 16, available: true, detail: { pendingDiscussion: 15 } },
};

describe("CEO cockpit layout", () => {
  it("renders the hero, the top-3 banner and drillable tiles from summary + insights", () => {
    const html = render(baseData({ metrics: METRICS as never, insights: INSIGHTS }));
    expect(html).toContain("Organisation at a glance");
    expect(html).toContain("1,063");
    // Top-3: the 93-day payroll acknowledgement outranks everything, then the 21-day vouchers.
    const banner = html.slice(html.indexOf("What needs the CEO"), html.indexOf("Waiting on the CEO"));
    expect(banner.indexOf("Payroll runs awaiting CEO acknowledgement")).toBeGreaterThan(-1);
    expect(banner.indexOf("Payroll runs awaiting CEO acknowledgement")).toBeLessThan(banner.indexOf("Payment vouchers awaiting CEO approval"));
    expect(banner.match(/Needs the CEO/g)?.length).toBe(3);
    // Every metric tile drills to a real full-page route.
    const drills = html.match(/href="\/dashboards\/drill\/CEO_DASHBOARD\/[A-Z_]+/g) ?? [];
    expect(drills.length).toBeGreaterThanOrEqual(10);
    for (const route of ["/payroll/sign-off", "/finance/ledger?tab=payments", "/exit/command-center", "/finance/process-pnl"]) {
      expect(html).toContain(`href="${route.replace("?", "?")}"`);
    }
    // Branch league row drills to that branch.
    expect(html).toContain("branchId=b1");
  });

  it("shows an em-dash, never a confident zero, when sources are empty or unloaded", () => {
    const html = render(baseData({ insightsLoading: true }));
    expect(html).toContain("—");
    expect(html).not.toMatch(/Active headcount[\s\S]{0,200}>0</);
    expect(html).toContain("Revenue at risk (MTD)");
  });

  it("names a failed insight section instead of silently dropping it", () => {
    const html = render(baseData({ metrics: METRICS as never, insights: { ...INSIGHTS, sectionErrors: { people_flow: "timed out" } } }));
    expect(html).toContain("Some insight sections could not load (people_flow)");
  });
});

describe("CEO model calculations", () => {
  it("flags a month whose direct or indirect cost is not booked so its margin is not trusted", () => {
    const cov = costCoverage([
      { month: "2026-07", revenue: 100, ebitda: 7, directCost: 68, indirectCost: 25 },
      { month: "2026-08", revenue: 100, ebitda: 7, directCost: 69, indirectCost: 24 },
      { month: "2026-09", revenue: 100, ebitda: 16, directCost: 72, indirectCost: 12 },
      { month: "2026-10", revenue: 100, ebitda: 12, directCost: 88, indirectCost: 0 },
      { month: "2026-11", revenue: 100, ebitda: 90, directCost: 3, indirectCost: 7 },
    ]);
    expect(cov.map((c) => c.costBooked)).toEqual([true, true, true, false, false]);
  });

  it("headlines the selected period and withholds margin for months with unbooked cost", () => {
    const view = revenueView({
      period: "2026-10",
      trend: [
        { month: "2026-07", revenue: 100, ebitda: 7, directCost: 68, indirectCost: 25 },
        { month: "2026-08", revenue: 110, ebitda: 8, directCost: 76, indirectCost: 27 },
        { month: "2026-09", revenue: 120, ebitda: 19, directCost: 90, indirectCost: 6 },
        { month: "2026-10", revenue: 105, ebitda: 12, directCost: 93, indirectCost: 0 },
      ],
    });
    expect(view.month).toBe("2026-10");
    expect(view.revenue).toBe(105);
    expect(view.priorRevenue).toBe(120);
    expect(view.marginMonth).toBe("2026-08");
    expect(view.marginPct).toBe(7.3);
    expect(view.marginCaveat).toContain("2026-10");
  });

  it("returns null revenue (not 0) when the P&L has no trend", () => {
    const view = revenueView({});
    expect(view.revenue).toBeNull();
    expect(view.marginPct).toBeNull();
  });

  it("ranks the CEO's own old decisions above oversight queues", () => {
    const own = actionScore({ id: "a", label: "a", count: 1, severity: "high", href: "/x", group: "Needs your decision", oldestDays: 20, overdue: 1 });
    const oversight = actionScore({ id: "b", label: "b", count: 50, severity: "high", href: "/x", group: "Oversight", oldestDays: 20, overdue: 1 });
    expect(own).toBeGreaterThan(oversight);
    expect(actionScore({ id: "c", label: "c", count: 0, severity: "critical", href: "/x" })).toBe(0);
    const top = rankAttention([
      { id: "1", title: "t1", detail: "", href: "/1", score: 10, tone: "amber" }, { id: "2", title: "t2", detail: "", href: "/2", score: 90, tone: "red" },
      { id: "2", title: "dup", detail: "", href: "/2", score: 80, tone: "red" }, { id: "3", title: "t3", detail: "", href: "/3", score: 0, tone: "amber" },
    ], 3);
    expect(top.map((t) => t.id)).toEqual(["2", "1"]);
  });

  it("colours quality from the score against target, not from a hard-coded green", () => {
    expect(qualityTone(86, 85)).toBe("green");
    expect(qualityTone(80, 85)).toBe("amber");
    expect(qualityTone(54, 85)).toBe("red");
    expect(qualityTone(null, 85)).toBe("slate");
  });

  it("adds a quality-gap item only when the source is live and below target", () => {
    const below = buildCeoModel(baseData({ quality: { org_quality_score: 73.59, target_score: 85, risk_agents: 15 } as never }));
    expect(summaryAttention(below).some((a) => a.id === "quality-gap")).toBe(true);
    const dead = buildCeoModel(baseData({ quality: { org_quality_score: 0, target_score: 85, data_status: "UNAVAILABLE", note: "down" } as never }));
    expect(summaryAttention(dead).some((a) => a.id === "quality-gap")).toBe(false);
  });

  it("matches P&L revenue to branches by name, case-insensitively", () => {
    const map = revenueByBranch({ rows: [{ branchName: "NOIDA", recognizedRevenue: 10 }, { branchName: "noida", recognizedRevenue: 5 }, { branchName: "", recognizedRevenue: 9 }] });
    expect(map.get("noida")).toBe(15);
    expect(map.size).toBe(1);
  });
});
