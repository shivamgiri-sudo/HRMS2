import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ManagerReferenceLayout } from "../reference/ManagerReferenceLayout";
import { OperationsReferenceLayout } from "../reference/OperationsReferenceLayout";
import { QualityReferenceLayout } from "../reference/QualityReferenceLayout";
import { coverageSegments } from "../reference/quality/qualityModel";
import { decisionQueues, teamSegments } from "../reference/manager/managerModel";
import { barWidth, processRag } from "../reference/operations/operationsModel";

vi.mock("@/components/dashboard/TodayCelebrationsWidget", () => ({ TodayCelebrationsWidget: () => null }));
vi.mock("@/contexts/AuthContext", async (orig) => ({ ...(await orig<object>()), useAuth: () => ({ user: null, roles: [], hasRole: () => false }) }));
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(), post: vi.fn() } }));

const html = (ui: JSX.Element) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const insights = (over: Record<string, unknown>) => ({ dashboardCode: "X", generatedAt: "", scopeLevel: "TEAM_ONLY", healthScore: 82, healthBasis: "b", actions: [], kpis: [], series: [], tables: [], signals: [], sectionErrors: {}, ...over });
const metric = (value: number | null, detail: Record<string, number | null> = {}, extra: Record<string, unknown> = {}) => ({ code: "M", label: "m", value, detail, available: true, drilldownUrl: "/x", ...extra });
const base = (over: Record<string, unknown>) => ({
  variant: "x", dashboardCode: "X", loading: false, metrics: {}, summary: {}, workforce: {}, ats: {}, biometric: {}, opsPulse: {}, quality: {}, orgKpi: {},
  managerLeaves: [], managerInsights: {}, managerAccountability: [], drilldownFor: () => ({}), ...over,
}) as never;

describe("manager layout", () => {
  const data = base({
    metrics: { hc: metric(27, { active: 27 }), att: metric(92, { present: 24, absent: 1, attendanceRate: 92, halfDay: 1, onLeave: 1, missedPunch: 0 }, { asOf: "2026-09-30T00:00:00.000Z" }) },
    insights: insights({
      actions: [
        { id: "leave", label: "Leave requests to approve", count: 4, severity: "high", oldestDays: 21, overdue: 1, href: "/leaves", group: "Approvals" },
        { id: "wfh", label: "Work-from-home requests", count: null, severity: "info", href: "/attendance-regularization", unavailable: "Could not load: boom" },
      ],
      kpis: [
        { key: "att_rate", label: "Team attendance", value: 92.2, unit: "percent", delta: 1.5, spark: [90, 91, 92], drill: { metricCode: "ATTENDANCE" } },
        { key: "kpi_quality", label: "Team quality score", value: null, unit: "percent", unavailable: "No quality actuals for this team", href: "/kpi/my-team" },
        { key: "live_in", label: "Logged in now", value: 20, unit: "count" }, { key: "on_leave_today", label: "On leave today", value: 2, unit: "count" }, { key: "not_punched", label: "Not punched yet", value: 5, unit: "count" },
      ],
      tables: [{ key: "risk_list", title: "r", columns: [], rows: [{ name: "Asha", score: 70, why: "Absent 4 of 10 scheduled days" }] }],
    }),
  });

  it("renders the hero, action links, summary tiles and em dash for null", () => {
    const out = html(<ManagerReferenceLayout data={data} managerName="Ravi Kumar" />);
    expect(out).toContain("Good day, Ravi");
    expect(out).toContain("Decisions waiting on you");
    expect(out).toContain('href="/leaves"');
    expect(out).toContain('href="/attendance-regularization"');
    expect(out).toContain("Could not load: boom");
    expect(out).toContain("Team members");
    expect(out).toContain("processed 2026-09-30");
    expect(out).toContain("No quality actuals for this team");
    expect(out).toContain("Absent 4 of 10 scheduled days");
    expect(out).toContain("Classic panels");
  });

  it("shows skeletons, not zeros, while insights load", () => {
    const out = html(<ManagerReferenceLayout data={base({ insightsLoading: true, metrics: {} })} managerName="Ravi" />);
    expect(out).toContain("Loading");
    expect(out).not.toContain("All clear");
  });

  it("decisionQueues ignores the inbox and null queues; teamSegments sums to the team", () => {
    expect(decisionQueues(undefined)).toEqual({ open: null, overdue: null, queues: 0 });
    const d = decisionQueues([
      { id: "leave", label: "l", count: 3, severity: "high", overdue: 1, href: "/leaves" },
      { id: "inbox", label: "i", count: 500, severity: "normal", href: "/work-inbox" },
      { id: "x", label: "x", count: null, severity: "info", href: "/x" },
    ]);
    expect(d).toEqual({ open: 3, overdue: 1, queues: 1 });
    const segs = teamSegments(10, 4, 3, 9)!;
    expect(segs.reduce((s, x) => s + x.value, 0)).toBe(10);
    expect(teamSegments(null, 4, 3, 2)).toBeNull();
  });
});

describe("operations layout", () => {
  it("renders hero, process cards linking into the unified page, and never a confident zero", () => {
    const data = base({
      opsPulse: { agents_logged_in: 120, total_calls: 0, login_adherence_pct: 91 },
      metrics: { hc: metric(300, { active: 300 }) },
      insights: insights({
        scopeLevel: "PROCESS_ALL",
        actions: [{ id: "ack_pending", label: "Roster shifts awaiting acknowledgement", count: 203, severity: "critical", href: "/operations-dashboard?tab=roster&by=process" }],
        kpis: [
          { key: "shrinkage_pct", label: "Shrinkage %", value: 16.3, unit: "percent", href: "/operations-dashboard?tab=shrinkage" },
          { key: "attendance_pct", label: "Attendance %", value: 83.7, unit: "percent", href: "/operations-dashboard?tab=attendance" },
          { key: "qa_score_pct", label: "Quality score", value: null, unit: "percent", unavailable: "No data in this window", href: "/operations-dashboard?tab=quality" },
        ],
        tables: [
          { key: "process_board", title: "p", href: "/operations-dashboard?by=process", columns: [], rows: [{ name: "Onfido", hc: 238, fill: 80, att: 57, shr: 40, href: "/operations-dashboard?by=manager&process=p1" }] },
          { key: "fte_gap", title: "g", columns: [], rows: [{ name: "Onfido", actual: 238, required: 300, gap: 62, href: "/operations-dashboard?tab=hiring&by=manager&process=p1" }] },
        ],
      }),
    });
    const out = html(<OperationsReferenceLayout data={data} />);
    expect(out).toContain("Operations Dashboard");
    expect(out).toContain("Floor shrinkage (30 days)");
    expect(out).toContain('href="/operations-dashboard?by=manager&amp;process=p1"');
    expect(out).toContain('href="/operations-dashboard?tab=roster&amp;by=process"');
    // 120 agents logged in but 0 calls: the feed is silent, so the tile says so rather than showing 0.
    expect(out).toContain("Not reported by the dialler feed");
    expect(out).toContain("No data in this window");
    expect(out).toContain("-62");
  });

  it("processRag never reports unknown inputs as green; bars clamp", () => {
    expect(processRag({})).toBe("slate");
    expect(processRag({ att: 95, shr: 10, fill: 99 })).toBe("green");
    expect(processRag({ att: 95, shr: 30 })).toBe("red");
    expect(barWidth(160, 120)).toBe(100);
    expect(barWidth(null)).toBe(0);
  });
});

describe("quality layout", () => {
  it("renders hero, coverage meter, queue links and the stated reason for unavailable queues", () => {
    const data = base({
      quality: { avg_score: 78, total_audits: 100, fail_rate: 12.5, pending_audits: 30 },
      metrics: { hc: metric(60, { active: 60 }), att: metric(88, { attendanceRate: 88 }) },
      insights: insights({
        scopeLevel: "ORG_ALL",
        actions: [
          { id: "audit_pending", label: "Calls awaiting a quality score", count: 7934, severity: "critical", href: "/quality-dashboard" },
          { id: "disputes", label: "Disputes / appeals pending", count: null, severity: "info", href: "/quality-dashboard", unavailable: "No dispute or appeal workflow is recorded in the system yet." },
        ],
        kpis: [
          { key: "q_score", label: "Avg quality score", value: 68.16, unit: "percent", delta: 2.7, href: "/quality-dashboard" },
          { key: "q_audited", label: "Calls audited", value: 11390, unit: "count", href: "/quality-dashboard" },
          { key: "q_pending", label: "Pending audits", value: 7934, unit: "count", href: "/quality-dashboard" },
          { key: "q_unscored", label: "Assessed, not scored", value: 6155, unit: "count", href: "/quality-dashboard" },
          { key: "q_coverage", label: "Audit coverage", value: 58.9, unit: "percent", href: "/quality-dashboard" },
        ],
        tables: [{ key: "q_league", title: "l", columns: [], rows: [{ name: "Back Office", avg: 82.5, fail: 10, fatal: 2, cov: 70, agents: 12, href: "/quality-dashboard" }] }],
      }),
    });
    const out = html(<QualityReferenceLayout data={data} />);
    expect(out).toContain("Quality Dashboard");
    expect(out).toContain("Avg quality score (30 days)");
    expect(out).toContain("Audit coverage");
    expect(out).toContain("58.9");
    expect(out).toContain('href="/quality-dashboard"');
    expect(out).toContain("Back Office");
    expect(out).toContain("Assessed, not scored (MTD)");
    expect(out).toContain("No dispute or appeal workflow is recorded in the system yet.");
  });

  it("coverageSegments splits analysed calls and never goes negative", () => {
    expect(coverageSegments(60, 40, 25)).toEqual({ total: 100, audited: 60, assessedUnscored: 25, notAssessed: 15, coveragePct: 60 });
    expect(coverageSegments(60, 40, 90)?.assessedUnscored).toBe(40);
    expect(coverageSegments(null, 40, 25)).toBeNull();
    expect(coverageSegments(0, 0, 0)).toBeNull();
  });
});
