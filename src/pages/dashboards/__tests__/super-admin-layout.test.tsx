import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/dashboard/TodayCelebrationsWidget", () => ({ TodayCelebrationsWidget: () => null }));
vi.mock("../reference/ReferenceDashboardShell", () => ({ useReferenceDashboardShell: () => ({ productHeaderControls: null }) }));
vi.mock("../ReferenceDashboardUI", async (orig) => {
  const real = await orig<typeof import("../ReferenceDashboardUI")>();
  return { ...real, ReferenceQuickLink: ({ title, href }: { title: string; href: string }) => <a href={href}>{title}</a> };
});

import { SuperAdminReferenceLayout } from "../reference/SuperAdminReferenceLayout";
import type { ReferenceDashboardData } from "../reference-dashboard-model";

const metric = (value: number | null, detail: Record<string, number> = {}) => ({ value, detail, available: true });

function fixture(over: Partial<ReferenceDashboardData> = {}): ReferenceDashboardData {
  return {
    dashboardCode: "SUPER_ADMIN_DASHBOARD",
    metrics: { hc: metric(1063, { active: 1063 }), att: metric(88, { present: 900, livePresent: 120, absent: 40, onLeave: 20, attendanceRate: 88 }), payroll: metric(90, { readyCount: 950, total: 1063, missingBank: 5 }) },
    drilldownFor: () => ({ onDrilldown: () => undefined }),
    summary: {}, system: { metrics: { activeEmployees: 1063, totalBranches: 5, usersWithout2fa: null, uptime: "3d 4h" } }, workforce: {}, ats: {}, employee: {} as never,
    pnl: {}, payroll: {}, biometric: {}, devices: {}, opsPulse: {}, managerLeaves: [], managerInsights: {}, managerAccountability: [], quality: {}, orgKpi: {},
    loading: false, refreshing: false, insightsLoading: false, ...over,
  } as unknown as ReferenceDashboardData;
}

const insights = {
  dashboardCode: "SUPER_ADMIN_DASHBOARD", generatedAt: "", scopeLevel: "ORG_ALL", healthScore: 70, healthBasis: "6 of 10 healthy",
  actions: [{ id: "a", label: "Attendance blockers stopping payroll", count: 4740, severity: "critical", oldestDays: 30, href: "/wfm/attendance-exceptions" }],
  kpis: [], series: [], signals: [{ tone: "bad", title: "Email delivery is failing", detail: "d" }], sectionErrors: {},
  tables: [{ key: "systems", title: "Systems", columns: [], rows: [
    { id: "db", name: "Database", group: "core", status: "ok", headline: "57 ms", detail: "ok", href: "/security-center" },
    { id: "email", name: "Email delivery", group: "comms", status: "down", headline: "39% failed", detail: "421 throttling", href: "/wfm/notification-hub" },
  ] }],
} as never;

function html(data: ReferenceDashboardData): string {
  const qc = new QueryClient();
  return renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter><SuperAdminReferenceLayout data={data} /></MemoryRouter></QueryClientProvider>);
}

describe("SuperAdminReferenceLayout", () => {
  it("renders the hero, status lights, action queue and linked tiles from insights", () => {
    const out = html(fixture({ insights }));
    expect(out).toContain("Super Admin");
    expect(out).toContain("1/2");
    expect(out).toMatch(/href="\/wfm\/notification-hub"[^>]*>[\s\S]*?Email delivery/);
    expect(out).toContain("Failing");
    expect(out).toMatch(/href="\/wfm\/attendance-exceptions"[\s\S]*?Attendance blockers stopping payroll|Attendance blockers stopping payroll[\s\S]*?4,740/);
    expect(out).toContain("Email delivery is failing");
  });

  it("renders at least ten linked org tiles from the summary while insights load", () => {
    const out = html(fixture({ insightsLoading: true }));
    for (const label of ["Total employees", "Logged in now", "Present", "On leave", "Absent", "Hiring shortage", "Open positions", "Payroll ready", "Branches", "API process uptime"]) expect(out).toContain(label);
    expect(out).toContain('aria-label="System status"');
    expect(out).not.toContain("Failing");
  });

  it("shows an em dash, not a confident zero, for unavailable sources", () => {
    const out = html(fixture({ metrics: {} as never, system: {} }));
    expect(out).toContain("—");
    expect(out).toContain("Users without 2FA");
    expect(out).not.toMatch(/Hiring shortage<\/p>[\s\S]{0,400}?>0</);
  });

  it("labels attendance with its processed day and uptime as process uptime", () => {
    const out = html(fixture({ insights }));
    expect(out).toContain("Since the last server restart, not availability");
    expect(out).toContain("Live attendance sessions today");
  });
});
