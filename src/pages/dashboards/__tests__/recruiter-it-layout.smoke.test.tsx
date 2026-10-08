import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecruiterReferenceLayout } from "../reference/RecruiterReferenceLayout";
import { ItManagerReferenceLayout } from "../reference/ItManagerReferenceLayout";

vi.mock("@/components/dashboard/TodayCelebrationsWidget", () => ({ TodayCelebrationsWidget: () => null }));
vi.mock("@/contexts/AuthContext", async (orig) => ({ ...(await orig<object>()), useAuth: () => ({ user: null, roles: [], hasRole: () => false }) }));
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(), post: vi.fn() } }));

const kpi = (key: string, label: string, value: number | null, href = "/ats/candidate-master") => ({ key, label, value, unit: "count" as const, href });
const base = (kpis: ReturnType<typeof kpi>[], actions: unknown[] = [], series: unknown[] = []) => ({
  variant: "x", dashboardCode: "X", metrics: {}, loading: false, ats: {}, itProvisioning: {}, itDashboard: {}, itProvisioningAvailable: true,
  insights: { dashboardCode: "X", generatedAt: "", scopeLevel: "ORG_ALL", healthScore: 80, healthBasis: "b", actions, kpis, series, tables: [], signals: [], sectionErrors: {} },
}) as never;
const html = (ui: JSX.Element) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

describe("recruiter layout", () => {
  it("renders hero, funnel, action links and em dash for null", () => {
    const data = base(
      [kpi("active_pipeline", "Active pipeline", 632), kpi("walkins_today", "Walk-ins today", null, "/ats/walkin-queue"), kpi("offers_today", "Offers approved today", 3), kpi("no_show_rate", "No-show", 17.7)],
      [{ id: "a", label: "Docs pending", count: 5, severity: "high", href: "/ats/onboarding-requests" }],
      [{ key: "funnel_30d", title: "f", kind: "funnel", points: [{ label: "Registered", value: 100, fromPrevPct: null, fromTopPct: 100, prevFromTopPct: 100 }, { label: "HR screening", value: 50, fromPrevPct: 50, fromTopPct: 50, prevFromTopPct: 40 }] }],
    );
    const out = html(<RecruiterReferenceLayout data={data} />);
    expect(out).toContain("Recruitment Command");
    expect(out).toContain("Hiring funnel");
    expect(out).toContain("HR screening");
    expect(out).toContain('href="/ats/onboarding-requests"');
    expect(out).toContain('href="/ats/walkin-queue"');
    expect(out).toContain("—");
  });
});

describe("IT layout", () => {
  it("renders the SLA board lanes as links and never a confident zero for null", () => {
    const data = base(
      [kpi("sla_overdue", "SLA breached", null, "/provisioning/it"), kpi("pending_joiner_tasks", "Joiner tasks", 4, "/provisioning/it")],
      [{ id: "q", label: "Joiner setup", count: 4, severity: "critical", overdue: 2, href: "/provisioning/it", group: "Provisioning" }],
    );
    const out = html(<ItManagerReferenceLayout data={data} />);
    expect(out).toContain("IT Operations Board");
    expect(out).toContain('aria-label="SLA board"');
    expect(out).toContain('href="/provisioning/it"');
    expect(out).toContain("Joiner setup");
    expect(out).toContain("Provisioning source unavailable");
  });
});
