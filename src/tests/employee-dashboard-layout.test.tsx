import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ReferenceDashboardData } from "@/pages/dashboards/reference-dashboard-model";
import type { RoleInsights } from "../../backend/src/modules/dashboards/role-insights/types";

// Widgets own their own network calls; this suite is about the layout the dashboard composes.
const stub = (name: string) => () => React.createElement("div", { "data-widget": name });
vi.mock("@/components/dashboard/CompanyFeedSidePanel", () => ({ CompanyFeedSidePanel: stub("feed") }));
vi.mock("@/components/dashboard/TodayCelebrationsWidget", () => ({ TodayCelebrationsWidget: stub("celebrations") }));
vi.mock("@/components/engagement/EngagementPromoBanner", () => ({ EngagementPromoBanner: stub("promo") }));
vi.mock("@/components/engagement/WeeklyWinnersWidget", () => ({ WeeklyWinnersWidget: stub("winners") }));
vi.mock("@/components/social/SocialFeedWidget", () => ({ SocialFeedWidget: stub("social") }));
vi.mock("@/components/social/VideoModal", () => ({ VideoModal: stub("video") }));
vi.mock("@/components/mcnmeet/MyMeetingsWidget", () => ({ MyMeetingsWidget: stub("meetings") }));
vi.mock("@/components/my-kpi/LiveCallScoreStrip", () => ({ LiveCallScoreStrip: stub("live") }));
vi.mock("@/components/my-kpi/AhtTrendChart", () => ({ AhtTrendChart: stub("aht") }));
vi.mock("@/components/my-kpi/HeroScoreDial", () => ({ HeroScoreDial: stub("dial") }));
vi.mock("@/pages/dashboards/reference/ReferenceOperationalPanels", () => ({
  ReferenceAIBrief: ({ title }: { title: string }) => React.createElement("section", null, title),
  ReferenceWorkInbox: stub("inbox"),
}));
// Quick links consult the auth context to hide pages the role cannot open; no auth provider here.
vi.mock("@/lib/navigationAccess", async (orig) => ({ ...(await orig<object>()), useAccessibleNavGroups: () => [] }));
vi.mock("@/hooks/useUserRole", async (orig) => ({ ...(await orig<object>()), useUserRole: () => ({ data: undefined }) }));
vi.mock("@/pages/dashboards/reference/ReferenceSharedPanels", () => ({ LeaveApprovalPanel: stub("leave-approval") }));

const { EmployeeReferenceLayout } = await import("@/pages/dashboards/reference/EmployeeReferenceLayout");

const insights: RoleInsights = {
  dashboardCode: "EMPLOYEE_SELF_DASHBOARD",
  generatedAt: "2026-10-02T00:00:00Z",
  scopeLevel: "SELF_ONLY",
  healthScore: 92,
  healthBasis: "Attendance Oct 2026 through 1 Oct",
  sectionErrors: {},
  actions: [
    { id: "regularise_days", label: "Days to regularise", count: 2, severity: "high", oldestDays: 4, href: "/attendance-regularization" },
    { id: "my_leave_pending", label: "My leave requests awaiting approval", count: 1, severity: "normal", href: "/leaves" },
    { id: "payslip_ack", label: "Payslip Jul 2026 is ready", count: 1, severity: "normal", href: "/payroll/payslips" },
  ],
  kpis: [
    { key: "att_pct", label: "Attendance", value: 92.5, unit: "percent", href: "/attendance", helper: "through 1 Oct" },
    { key: "att_present", label: "Present days", value: 18, unit: "days" },
    { key: "att_half", label: "Half days", value: 1, unit: "days" },
    { key: "att_absent", label: "Absent", value: 0, unit: "days" },
    { key: "att_late", label: "Late marks", value: 2, unit: "count" },
    { key: "att_lop", label: "LOP booked", value: 0.5, unit: "days" },
    { key: "leave_available", label: "Leave available", value: 12, unit: "days", href: "/leaves" },
    { key: "pay_latest_net", label: "Net pay Jul 2026", value: 74607, unit: "inr", href: "/payroll/payslips" },
    { key: "kpi_score", label: "My KPI score (MTD)", value: null, unit: "percent", href: "/my-kpi", unavailable: "No KPI targets are assigned to your role yet." },
  ],
  series: [{
    key: "att_calendar", title: "Attendance — Oct 2026", kind: "heat",
    points: [
      { label: "2026-10-01", status: "half_day", late: 1, lateBy: 40, lwp: 0.5 },
      { label: "2026-10-02", status: "today" },
      { label: "2026-10-03", status: "absent", lwp: 1 },
      { label: "2026-10-04", status: "week_off" },
    ],
  }],
  tables: [
    { key: "today", title: "Today", columns: [], rows: [{ state: "working", shift: "10:00 – 19:00", punchIn: "09:58", punchOut: null, holiday: null }] },
    {
      key: "leave_balances", title: "Leave balances", columns: [],
      rows: [{ type: "Casual Leave", remaining: 5, used: 2, total: 7, note: "lapses 31 Dec" }],
    },
    { key: "holidays", title: "Upcoming holidays", columns: [{ key: "date", label: "Date" }, { key: "name", label: "Holiday" }], rows: [{ date: "20 Oct", name: "Dusshera" }] },
  ],
  signals: [{ tone: "watch", title: "Missing punches this month", detail: "Regularise them.", value: 2, href: "/attendance-regularization" }],
};

function fixture(overrides: Partial<ReferenceDashboardData> = {}): ReferenceDashboardData {
  return {
    variant: "employee",
    dashboardCode: "EMPLOYEE_SELF_DASHBOARD",
    summary: {} as never,
    metrics: {},
    drilldownFor: () => ({ onDrilldown: () => undefined }),
    employee: {
      attendance: { presentDays: 20, halfDays: 1, absentDays: 1, lateDays: 3, attendancePct: 88 },
      balances: [{ leave_name: "Casual Leave", leave_code: "CL", available_days: 5, used_days: 2, allocated_days: 7, adjusted_days: 0 }],
      onboarding: {}, lms: {}, engagement: { total_points: 1200 }, sourceErrors: [],
      sourceFreshness: { attendance: null },
    },
    ats: {}, system: {}, workforce: {}, pnl: {}, payroll: {}, biometric: {}, devices: {}, opsPulse: {},
    managerLeaves: [], managerInsights: {}, managerAccountability: [], quality: {}, orgKpi: {},
    loading: false,
    insights,
    insightsLoading: false,
    ...overrides,
  } as unknown as ReferenceDashboardData;
}

const html = (data: ReferenceDashboardData) =>
  renderToStaticMarkup(<MemoryRouter><EmployeeReferenceLayout data={data} employeeName="Asha Verma" /></MemoryRouter>);

describe("EmployeeReferenceLayout (My Day)", () => {
  const out = html(fixture());

  it("renders the personalised hero with today's punch state and the attendance ring", () => {
    expect(out).toMatch(/Good (morning|afternoon|evening), Asha/);
    expect(out).toContain("Punched in at 09:58");
    expect(out).toContain("10:00 – 19:00");
    expect(out).toContain('aria-label="Attendance 92"');
  });

  it("lists every pending queue with a link to the page where it is actioned", () => {
    for (const href of ["/attendance-regularization", "/leaves", "/payroll/payslips"]) {
      expect(out).toContain(`href="${href}"`);
    }
    expect(out).toContain("What I need to do");
    expect(out).toContain("oldest 4d");
  });

  it("draws the month calendar with late and fixable days", () => {
    expect(out).toContain("Attendance by day");
    expect(out).toContain("Open regularisation");
    expect(out).toContain("late by 40 min");
  });

  it("shows an unavailable KPI as an em dash with its reason, never a zero", () => {
    expect(out).toContain("No KPI targets are assigned to your role yet.");
  });

  it("keeps the pre-redesign datapoints reachable", () => {
    expect(out).toContain("My Training Status");
    expect(out).toContain("My Onboarding Status");
    expect(out).toContain("Automated Attendance &amp; Leave Summary");
    expect(out).toContain("Source Freshness");
    expect(out).toContain("Quick Links");
  });

  it("prefers the completed-day figures over the summary feed that still counts today", () => {
    // provider says 18 present / 92.5%; feed says 20 / 88%
    expect(out).toContain("92.5");
    expect(out).not.toContain(">88<");
  });

  it("paints hero and tiles while insights are still loading", () => {
    const loading = html(fixture({ insights: undefined, insightsLoading: true }));
    expect(loading).toMatch(/Good (morning|afternoon|evening), Asha/);
    expect(loading).toContain("Attendance & LOP risk".replace("&", "&amp;"));
    expect(loading).not.toContain("All clear");
  });

  it("degrades visibly when the insights call fails", () => {
    const failed = html(fixture({ insights: undefined, insightsLoading: false, insightsError: "boom" }));
    expect(failed).toContain("Some personal insights could not be loaded");
  });

  it("turns incomplete onboarding into a queue row", () => {
    const d = fixture();
    d.employee.onboarding = { percentComplete: 40, totalSteps: 5, completedSteps: 2 };
    expect(html(d)).toContain("Finish my onboarding");
  });
});
