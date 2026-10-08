import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNTED_ROUTE_PATHS } from "@/lib/mountedRoutePaths";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";

// Widgets that fetch on their own are covered elsewhere; this suite is about the layouts' composition.
vi.mock("@/components/dashboard/TodayCelebrationsWidget", () => ({ TodayCelebrationsWidget: () => null }));
vi.mock("@/components/dashboard/widgets/PayrollPrepWidget", () => ({ PayrollPrepWidget: () => null }));
vi.mock("@/components/dashboard/wfm/WfmAnalyticsPanel", () => ({ WfmAnalyticsPanel: () => null }));
vi.mock("../../ReferenceDashboardUI", async (orig) => ({
  ...(await orig<typeof import("../../ReferenceDashboardUI")>()),
  // ReferenceQuickLink consults auth + nav access; the link set itself is asserted below.
  ReferenceQuickLink: ({ title, href }: { title: string; href: string }) => <a href={href}>{title}</a>,
}));
vi.mock("../ReferenceOperationalPanels", () => ({ ReferenceWorkInbox: () => null, ReferenceAIBrief: ({ title }: { title: string }) => <section>{title}</section> }));

import { WfmReferenceLayout } from "../WfmReferenceLayout";
import { WfmAttendanceReferenceLayout } from "../WfmAttendanceReferenceLayout";

const metric = (value: number | null, detail: Record<string, number | null> = {}, extra: Record<string, unknown> = {}) => ({ value, detail, status: "healthy" as const, available: true, ...extra });
const action = (id: string, label: string, count: number | null, extra: Record<string, unknown> = {}) => ({ id, label, count, severity: "high", href: "/attendance-regularization", group: "Approvals", ...extra });
const kpi = (key: string, label: string, value: number | null, extra: Record<string, unknown> = {}) => ({ key, label, value, unit: "percent", tone: "amber", href: "/wfm/live-tracker", ...extra });

const insights = {
  dashboardCode: "WFM_DASHBOARD", generatedAt: "", scopeLevel: "ORG_ALL", healthScore: 54, healthBasis: "Attendance 72, roster 100, fill n/a", sectionErrors: {},
  actions: [
    action("reg_other", "Attendance regularisations pending", 13, { oldestDays: 16, overdue: 13 }),
    action("reg_wfh", "Work-from-home requests pending", 12, { oldestDays: 18, overdue: 12 }),
    action("roster_submissions", "Shift-change / roster submissions to approve", 3, { href: "/wfm/team-roster", oldestDays: 4, overdue: 1 }),
    action("roster_swaps", "Shift / week-off swap requests", 0, { href: "/wfm/roster-requests", severity: "info" }),
    action("integrity_blockers", "Attendance blockers open (payroll-blocking)", 9819, { href: "/wfm/attendance-integrity?tab=mismatches", severity: "critical", oldestDays: 68, overdue: 8467, group: "Data integrity" }),
    action("abscond_risk", "Abscond risk: 3+ consecutive days absent", 103, { href: "/wfm/attendance-integrity?tab=exceptions", severity: "critical" }),
  ],
  kpis: [
    kpi("floor_fill", "Floor fill (logged in / due)", 88), kpi("no_show_now", "No-shows right now", 4, { unit: "count", tone: "red" }),
    kpi("roster_vs_required", "Roster vs required HC", 36.4, { href: "/wfm/capacity-dashboard" }), kpi("roster_published", "Roster published (next 14d)", 100, { tone: "green" }),
    kpi("unplanned_shrinkage", "Unplanned shrinkage", 23.4), kpi("abscond_risk", "Abscond risk", 103, { unit: "count" }), kpi("absence_forecast", "Absence forecast: Sat 3 Oct", 97, { unit: "count" }),
    kpi("attendance_rate", "Attendance rate", 72.2, { spark: [60, 62, 70, 72] }), kpi("break_overuse", "Break overuse", null, { unavailable: "No break data recorded" }),
    kpi("cosec_sync_lag", "COSEC daily-feed lag", 0.1, { unit: "hours", tone: "green" }), kpi("punch_pipeline", "Punched today, not yet processed", 31, { unit: "count" }),
    kpi("missed_punch", "Missed punches", 5, { unit: "count" }), kpi("reg_median_age", "Median request age", 9, { unit: "days", tone: "red", href: "/attendance-regularization" }),
    kpi("payroll_lock", "Days to attendance cutoff", null, { unit: "days", tone: "slate", unavailable: "No attendance cutoff set in the payroll calendar" }),
    kpi("biometric_coverage", "Biometric coverage (7d)", 81.8), kpi("no_record", "No attendance record", 310, { unit: "count" }),
  ],
  series: [
    { key: "att_trend", title: "Attendance vs shrinkage trend", kind: "line", unit: "percent", keys: [{ key: "rate", label: "Attendance" }], points: [{ label: "09-29", rate: 70 }, { label: "09-30", rate: 72 }] },
    { key: "publish_by_day", title: "Roster publish health", kind: "stacked", unit: "count", keys: [{ key: "published", label: "Published" }, { key: "draft", label: "Draft" }], points: [{ label: "Fri 02", published: 353, draft: 0 }] },
    { key: "issue_types", title: "Open integrity issues by type", kind: "ranked", unit: "count", points: [{ label: "No attendance row built", value: 5227 }] },
  ],
  tables: [
    { key: "shift_floor", title: "Live shift floor", columns: [], rows: [
      { shift: "10:00-19:00", startAt: "10:00", rostered: 109, due: 109, inNow: 98, noShow: 4, fill: 89.9 }, { shift: "14:00-23:00", startAt: "14:00", rostered: 61, due: 0, inNow: 0, noShow: 0, fill: null },
    ] },
    { key: "absence_heat", title: "Absenteeism heatmap", columns: [{ key: "shift", label: "Shift" }, { key: "d0", label: "Mon 28 Sept", unit: "percent" }], rows: [{ shift: "10:00-19:00", d0: 26.7 }, { shift: "Night", d0: null }] },
    { key: "late_heat", title: "Late heatmap", columns: [{ key: "shift", label: "Shift" }, { key: "d0", label: "Mon 28 Sept", unit: "percent" }], rows: [{ shift: "10:00-19:00", d0: 8 }] },
  ],
  signals: [{ tone: "bad", title: "103 employees absent 5+ days running", detail: "Treat as abscond risk", href: "/wfm/attendance-integrity?tab=exceptions" }],
};

function fixture(over: Partial<ReferenceDashboardData> = {}, code = "WFM_DASHBOARD"): ReferenceDashboardData {
  return {
    variant: "wfm", dashboardCode: code, loading: false, refreshing: false, secondaryLoading: false,
    metrics: {
      hc: metric(1063, { active: 1063, required: 917, available: 340 }),
      att: metric(72, { attendanceRate: 72, present: 515, halfDay: 57, absent: 176, late: 285, missedPunch: 5, onLeave: 0, livePresent: 38, expectedToWork: 753 }, { asOf: "2026-10-01T00:00:00.000Z" }),
    },
    drilldownFor: (key: string) => ({ onDrilldown: key === "hc" ? () => undefined : undefined }),
    workforce: {}, ats: {}, system: {}, pnl: {}, payroll: {},
    biometric: { on_time_in_pct: 78.1, biometric_compliance_pct: 96, regularization_summary: { pending: 25, approved: 7532, rejected: 0, cancelled: 17, late_in: 3, early_out: 1, missed_punch: 4 }, variance_0_1: 90, variance_1_4: 40, variance_4_plus: 3, on_leave: 0, working_remotely: 2 },
    devices: { integrationStatus: { status: "ok", data_confidence: 98 } }, opsPulse: {}, managerLeaves: [], managerInsights: {}, managerAccountability: [], quality: {}, orgKpi: {},
    insights, insightsLoading: false,
    ...over,
  } as unknown as ReferenceDashboardData;
}

const wrap = (node: React.ReactNode) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
const wfm = (d: ReferenceDashboardData) => wrap(<WfmReferenceLayout data={d} filters={null} />);
const att = (d: ReferenceDashboardData) => wrap(<WfmAttendanceReferenceLayout data={d} />);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("WfmReferenceLayout (live shift floor)", () => {
  it("renders hero, floor board, action queues and linked tiles", () => {
    const out = wfm(fixture());
    expect(out).toContain("Live shift floor");
    expect(out).toContain("WFM control room");
    expect(out).toContain("72%");
    for (const t of ["Needs the WFM desk", "Attendance regularisations pending", "Shift-change / roster submissions to approve", "10:00-19:00", "Core numbers", "Shift pulse", "Absenteeism by shift and day"]) expect(out, t).toContain(t);
    expect((out.match(/kit-lift/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it("keeps every pre-redesign datapoint reachable", () => {
    const out = wfm(fixture());
    for (const t of ["Attendance Rate", "Active Headcount", "Required HC", "Available HC", "Roster Adherence", "Missing Punch", "Processed Attendance Breakdown", "Live vs Processed", "Biometric Sync Health", "Late-arrival severity", "Today&#x27;s Operations Alerts", "Automated Workforce Summary"]) expect(out, t).toContain(t);
  });

  it("every tile links somewhere that exists", () => {
    const links = hrefs(wfm(fixture())).filter((h) => h.startsWith("/"));
    const bad = links.filter((h) => !h.startsWith("/dashboards/drill/") && !MOUNTED_ROUTE_PATHS.has(h.split("?")[0]));
    expect(bad).toEqual([]);
    expect(links).toContain("/dashboards/drill/WFM_DASHBOARD/ATTENDANCE?status=absent");
  });

  it("renders an em dash and the reason, never a 0, for an unavailable value", () => {
    const out = wfm(fixture({ metrics: { hc: metric(1063, { active: 1063 }), att: { value: null, detail: {}, status: "unknown", available: true, errorCode: "NO_DATA_IN_SOURCE" } as never }, insights: undefined, insightsLoading: false }));
    expect(out).toContain("—");
    expect(out).toContain("Planning source unavailable");
    expect(out).toContain("No data recorded yet");
  });

  it("shows skeleton / placeholders while insights load, without crashing", () => {
    const out = wfm(fixture({ insights: undefined, insightsLoading: true }));
    expect(out).toContain("kit-shimmer");
    expect(out).toContain("…");
  });

  it("labels a shift that has not started as such instead of 0%", () => {
    expect(wfm(fixture())).toContain("not started");
  });
});

describe("WfmAttendanceReferenceLayout (data-integrity desk)", () => {
  const d = () => fixture({ variant: "wfm_attendance" } as never, "WFM_ATTENDANCE_DASHBOARD");

  it("renders the integrity hero, pipeline stepper and queues", () => {
    const out = att(d());
    for (const t of ["Attendance integrity", "Data-integrity desk", "9,819", "Payroll-blocking issues open", "Biometric feed", "Correction queue", "Payroll cutoff", "Corrections and approvals", "Integrity signals"]) expect(out, t).toContain(t);
    expect(out).toContain("Stage 5");
  });

  it("is visibly a different composition from the WFM dashboard", () => {
    const a = att(d()), w = wfm(fixture());
    expect(a).not.toContain("Live shift floor");
    expect(w).not.toContain("Attendance pipeline");
    expect(a).toContain("Attendance data pipeline");
  });

  it("keeps the old attendance panels, corrected", () => {
    const out = att(d());
    for (const t of ["Processed Attendance Status", "Late Arrivals Trend", "Regularization Requests Summary", "Biometric Device Status", "Shift Summary", "Roster Coverage", "Overtime Snapshot", "Attendance Compliance", "Quick Actions"]) expect(out, t).toContain(t);
    // placeholders removed: no copied compliance bars, no fabricated device list
    expect(out).not.toContain("Weekly Compliance");
    expect(out).toContain("no device registry");
    // WFH overlaps present, so it must not be a donut slice
    expect(out).not.toContain('"WFH"');
  });

  it("every link resolves to a mounted route or the drill page", () => {
    const links = hrefs(att(d())).filter((h) => h.startsWith("/"));
    const bad = links.filter((h) => !h.startsWith("/dashboards/drill/") && !MOUNTED_ROUTE_PATHS.has(h.split("?")[0]));
    expect(bad).toEqual([]);
  });

  it("an unavailable payroll cutoff renders an em dash with its reason", () => {
    const out = att(d());
    expect(out).toContain("No attendance cutoff set in the payroll calendar");
    expect(out).toContain("no cutoff set");
  });
});

describe("provider links", () => {
  it("every href the WFM providers emit is a mounted route", () => {
    const root = resolve(__dirname, "../../../../../backend/src/modules/dashboards/role-insights/providers");
    const files = ["wfm.ts", "wfmParts/floor.ts", "wfmParts/queues.ts", "wfmParts/trends.ts", "wfmAttendance.ts", "wfmAttendanceParts/integrity.ts", "wfmAttendanceParts/corrections.ts"];
    const found = new Set<string>();
    for (const f of files) for (const m of readFileSync(resolve(root, f), "utf8").matchAll(/href: [`"](\/[^`"$]*)[`"]/g)) found.add(m[1].split("?")[0]);
    expect([...found].length).toBeGreaterThan(10);
    expect([...found].filter((h) => !MOUNTED_ROUTE_PATHS.has(h) && !h.startsWith("/wfm/employee-roster/"))).toEqual([]);
  });
});

describe("source hygiene", () => {
  it("no sub-12px text in the redesigned WFM layouts", () => {
    const dir = resolve(__dirname, "..");
    for (const f of ["WfmReferenceLayout.tsx", "WfmAttendanceReferenceLayout.tsx", "wfm/FloorBoard.tsx", "wfm/ShiftHeatmap.tsx", "wfm/WfmDetailPanels.tsx", "wfm/insightBits.tsx", "wfmattendance/PipelineStrip.tsx", "wfmattendance/AttendanceDeskPanels.tsx"]) {
      expect(readFileSync(resolve(dir, f), "utf8"), f).not.toMatch(/text-\[(?:8|9|10|11)px\]/);
    }
  });
});
