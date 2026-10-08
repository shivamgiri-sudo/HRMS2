import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HrReferenceLayout } from "../HrReferenceLayout";
import { MOUNTED_ROUTE_PATHS } from "@/lib/mountedRoutePaths";
import { bgvClearRate, groupTotals, onboardingSubmitRate, queueTotals } from "./hrModel";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";

const metric = (value: number | null, detail: Record<string, number | null> = {}) => ({ value, detail, status: "healthy" as const, available: true });
const action = (id: string, label: string, count: number | null, extra: Record<string, unknown> = {}) => ({ id, label, count, severity: "high", href: "/leaves", group: "Attendance & leave", ...extra });

const insights = {
  dashboardCode: "HR_DASHBOARD", generatedAt: "", scopeLevel: "ORG_ALL", healthScore: 37, healthBasis: "Retention 20 · Staffing 87", sectionErrors: {},
  actions: [
    action("leave-pending", "Leave requests awaiting approval", 4, { oldestDays: 21, overdue: 4 }),
    action("exit-review", "Resignations in review", 15, { href: "/exit/command-center", group: "Exits", oldestDays: 2, overdue: 0 }),
    action("bgv-decision", "BGV needs an HR decision", 331, { href: "/ats/bgv", group: "Hiring & onboarding", severity: "critical", overdue: 290 }),
  ],
  kpis: [
    { key: "joins30", label: "Joins (30d)", value: 207, delta: 0, href: "/employees" },
    { key: "exits30", label: "Exits (30d)", value: 129, delta: -144, higherIsBetter: false, href: "/exit/command-center" },
    { key: "net30", label: "Net movement (30d)", value: 78 },
    { key: "attrition30", label: "Attrition (30d)", value: 12.6, unit: "percent", higherIsBetter: false, href: "/exit/command-center" },
    { key: "early-exits", label: "Exits under 90 days' tenure", value: null, unit: "percent", unavailable: "No exits in the last 30 days" },
    { key: "att-rate", label: "Attendance", value: 53.4, unit: "percent", deltaLabel: "pp vs previous day · as of 2026-09-30", href: "/wfm-attendance" },
  ],
  series: [{ key: "movement", title: "Joins vs exits, 12 months", kind: "bar", unit: "count", points: [{ label: "Sep 26", joins: 229, exits: 130 }], keys: [{ key: "joins", label: "Joins" }, { key: "exits", label: "Exits" }] }],
  tables: [{ key: "attrition-branch", title: "Attrition by branch (30d)", columns: [{ key: "name", label: "Branch" }], rows: [{ name: "NOIDA-2" }] }],
  signals: [{ tone: "bad", title: "Attrition 12.6% in 30 days", detail: "129 exits", href: "/exit/command-center" }],
};

function fixture(over: Partial<ReferenceDashboardData> = {}): ReferenceDashboardData {
  return {
    variant: "hr", dashboardCode: "HR_DASHBOARD", loading: false, refreshing: false, secondaryLoading: false,
    metrics: {
      hc: metric(1063, { active: 1063 }), hiringAlert: metric(120, { shortage: 120, processesShort: 9 }), onb: metric(291, { pending: 288, submitted: 3, stuck: 0 }),
      bgv: metric(331, { pending: 331, cleared: 17, flagged: 0, breached: 0 }), appointmentEsign: metric(0, { pending: 0 }), joiningDocEsign: metric(2951, { pending: 2951 }),
      resign: metric(16, { pendingDiscussion: 15 }), docCompliance: metric(1100), training: metric(41), att: metric(53, { attendanceRate: 53 }),
    },
    drilldownFor: (key: string) => ({ onDrilldown: key === "hc" ? () => undefined : undefined }),
    workforce: { summary: { new_joiners_30d: 150, exits_30d: 131, attrition_rate_30d: 11.6 }, pending_leave_requests: 4, leave_summary: [{ status: "approved", count: 6320 }] },
    ats: {}, system: {}, pnl: {}, payroll: {}, biometric: {}, devices: {}, opsPulse: {}, managerLeaves: [], managerInsights: {}, managerAccountability: [], quality: {}, orgKpi: {},
    insights, insightsLoading: false,
    ...over,
  } as unknown as ReferenceDashboardData;
}

const html = (data: ReferenceDashboardData) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><HrReferenceLayout data={data} /></MemoryRouter></QueryClientProvider>);

describe("HrReferenceLayout", () => {
  it("renders the hero, open-action headline, queues and linked tiles", () => {
    const out = html(fixture());
    expect(out).toContain("HR command centre");
    expect(out).toContain("Open HR actions");
    expect(out).toContain("350");                                    // 4 + 15 + 331 open
    expect(out).toContain("Needs HR action");
    for (const label of ["Leave requests awaiting approval", "Resignations in review", "BGV needs an HR decision", "Joins (30d)", "Attrition (30d)", "Total employees", "Hiring shortage", "BGV pending", "Training complete"]) {
      expect(out, label).toContain(label);
    }
    for (const href of ["/leaves", "/exit/command-center", "/ats/bgv", "/ats/onboarding-requests", "/provisioning/appointment-letter"]) expect(out, href).toContain(`href="${href}"`);
    expect((out.match(/kit-lift/g) ?? []).length).toBeGreaterThanOrEqual(15);
  });

  it("shows an em dash, never a 0, for an unavailable value", () => {
    const out = html(fixture({ metrics: { hc: metric(1063) }, insights: undefined, insightsLoading: false }));
    expect(out).toContain("Needs HR action");
    expect(out).not.toMatch(/Attrition \(30d\)[^<]*<\/p>[^]{0,200}>0<span/);
    expect(out).toContain("—");
  });

  it("keeps the panels the old layout carried", () => {
    const out = html(fixture());
    for (const t of ["Pipeline health", "Processed attendance", "Leave summary", "Recent joiners", "Headcount by branch", "Pending approvals summary", "Reconciliation with the summary feed"]) {
      expect(out, t).toContain(t);
    }
  });

  it("skeletons the insight-fed tiles while insights load but still paints summary tiles", () => {
    const out = html(fixture({ insights: undefined, insightsLoading: true }));
    expect(out).toContain("Total employees");
    expect(out).toContain("1,063");
  });
});

describe("hrModel", () => {
  it("queueTotals sums open and overdue and null-safe on missing actions", () => {
    expect(queueTotals(undefined)).toMatchObject({ open: null, overdue: null });
    expect(queueTotals(insights.actions as never)).toMatchObject({ open: 350, overdue: 294, queues: 3, critical: 1 });
  });
  it("groupTotals orders by overdue", () => {
    expect(groupTotals(insights.actions as never)[0].group).toBe("Hiring & onboarding");
  });
  it("BGV clear rate uses candidates, and is null rather than 0 when an input is missing", () => {
    expect(bgvClearRate(17, 331, 0)).toBe(5);
    expect(bgvClearRate(null, 331, 0)).toBeNull();
    expect(onboardingSubmitRate(3, 288)).toBe(1);
    expect(onboardingSubmitRate(0, 0)).toBeNull();
  });
});

describe("HR dashboard links", () => {
  it("every href the provider and layout emit is a mounted route", () => {
    const dirs = [resolve(__dirname), resolve(__dirname, "../../../../../backend/src/modules/dashboards/role-insights/providers/hrParts")];
    const bad: string[] = [];
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !n.includes(".test."))) {
        const src = readFileSync(resolve(dir, f), "utf8");
        for (const m of src.matchAll(/(?:href(?:=|: ?)\{?"|to=")(\/[a-z0-9/_-]*)/gi)) if (!MOUNTED_ROUTE_PATHS.has(m[1])) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
