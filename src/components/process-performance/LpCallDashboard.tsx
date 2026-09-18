import { useMemo, useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  PhoneCall, Users, Gauge, Timer, Target, ListChecks, Search, ListFilter, Scale, Activity,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  currentMonthRange, type ExportSlide,
} from "./DashboardKit";

/**
 * Shared call-performance dashboard for LP Feedback and LP Onboarding --
 * their uploaded tables are column-for-column identical (confirmed via
 * SHOW COLUMNS on both pairs), same as the backend's
 * lp-call-dashboard.shared.ts this component calls through
 * LpFeedbackDashboard.tsx / LpOnboardingDashboard.tsx. See that backend
 * file's header comment for the full KPI-to-column mapping, why
 * "Shrinkage" uses the standard login-time-lost formula rather than the
 * reference sheet's own unverifiable one, and why there's no TL-wise view
 * (neither source table has a TL column).
 */

interface Headline {
  loginCount: number; overallCalls: number; uniqueLeadset: number;
  uniqueConnectedCalls: number; uniqueConnectivityPct: number;
  overallConnected: number; overallConnectedPct: number;
  shrinkagePct: number; avgLeadPerAgent: number; perAgentDialCount: number;
  avgTalkTimeSec: number; occupancyPct: number;
}
interface ServiceRow { service: string; calls: number; connected: number; connectedPct: number; uniqueLeads: number }
interface WeekRow { weekLabel: string; loginCount: number; overallCalls: number; uniqueLeadset: number; overallConnected: number; overallConnectedPct: number; talkTimeSec: number }
interface AgentRow {
  agent: string; loginId: string; totalCalls: number; connectedCalls: number; connectedPct: number;
  uniqueLeads: number; talkTimeSec: number; loginTimeSec: number; netLoginTimeSec: number; shrinkagePct: number; occupancyPct: number;
}
interface DashboardData {
  headline: Headline; from: string; to: string;
  byService: ServiceRow[]; byWeek: WeekRow[]; agents: AgentRow[];
}

const SERVICE_COLORS = ["#2563eb", "#0ea5e9", "#6366f1", "#8b5cf6", "#0891b2"];
const secToHms = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

type TabKey = "overall" | "agents";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "agents", label: "Agent-wise" },
];

export function LpCallDashboard({
  apiPath, eyebrow, title, unavailableLabel, tlFootnote,
}: {
  apiPath: string; eyebrow: string; title: string; unavailableLabel: string; tlFootnote: string;
}) {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overall");
  const [agentSearch, setAgentSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `${apiPath}?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : unavailableLabel);
    } finally {
      setLoading(false);
    }
  }, [apiPath, from, to, unavailableLabel]);

  useEffect(() => { void load(); }, [load]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agents ?? [];
    const q = agentSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q) || a.loginId.toLowerCase().includes(q));
  }, [data, agentSearch]);

  /** Export slides for "Download Snap"/"Download Excel" — one per tab,
   * built from the same data already rendered on screen, not re-fetched.
   * Shared by both LpFeedbackDashboard and LpOnboardingDashboard; the
   * report/file names below derive from this instance's own `title` prop
   * so each consumer's export reflects which one it is. */
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const overall: ExportSlide = {
      title: "Overall",
      kpis: [
        { label: "Login Count", value: String(data.headline.loginCount) },
        { label: "Overall Calls", value: data.headline.overallCalls.toLocaleString("en-IN") },
        { label: "Unique Leadset", value: data.headline.uniqueLeadset.toLocaleString("en-IN") },
        { label: "Unique Connectivity %", value: `${data.headline.uniqueConnectivityPct}%` },
        { label: "Overall Connected %", value: `${data.headline.overallConnectedPct}%` },
        { label: "Shrinkage %", value: `${data.headline.shrinkagePct}%` },
        { label: "Occupancy %", value: `${data.headline.occupancyPct}%` },
        { label: "Avg Talk Time", value: secToHms(data.headline.avgTalkTimeSec) },
        { label: "Avg Lead / Agent", value: String(data.headline.avgLeadPerAgent) },
        { label: "Per Agent Dial Count", value: String(data.headline.perAgentDialCount) },
        { label: "Unique Connected Calls", value: data.headline.uniqueConnectedCalls.toLocaleString("en-IN") },
        { label: "Overall Connected", value: data.headline.overallConnected.toLocaleString("en-IN") },
      ],
      tables: [
        {
          title: "Lead-Source Detail",
          columns: ["Service", "Calls", "Connected", "Connected %", "Unique Leads"],
          rows: data.byService.map((s) => [s.service, s.calls, s.connected, `${s.connectedPct}%`, s.uniqueLeads]),
        },
        {
          title: "Week-wise Performance",
          columns: ["Week", "Login Count", "Overall Calls", "Unique Leadset", "Overall Connected", "Connected %", "Talk Time"],
          rows: data.byWeek.map((w) => [
            w.weekLabel, w.loginCount, w.overallCalls, w.uniqueLeadset, w.overallConnected,
            `${w.overallConnectedPct}%`, secToHms(w.talkTimeSec),
          ]),
        },
      ],
    };
    const agentsSlide: ExportSlide = {
      title: "Agent-wise",
      tables: [{
        title: "Agent-wise Performance",
        columns: ["Agent", "Login ID", "Calls", "Connected", "Connected %", "Unique Leads", "Talk Time", "Login Time", "Shrinkage %", "Occupancy %"],
        rows: data.agents.map((a) => [
          a.agent, a.loginId, a.totalCalls, a.connectedCalls, `${a.connectedPct}%`, a.uniqueLeads,
          a.talkTimeSec ? secToHms(a.talkTimeSec) : "—", a.loginTimeSec ? secToHms(a.loginTimeSec) : "—",
          a.loginTimeSec ? `${a.shrinkagePct}%` : "—", a.loginTimeSec ? `${a.occupancyPct}%` : "—",
        ]),
      }],
    };
    return [overall, agentsSlide];
  }, [data]);

  const exportFileBaseName = title.replace(/[^a-zA-Z0-9]+/g, "_");
  const exportReportTitle = `${eyebrow.split(" · ")[0]} — ${title}`;

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={Scale} eyebrow={eyebrow} title={title}
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-blue-700 via-indigo-700 to-blue-800"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle={exportReportTitle}
          fileBaseName={exportFileBaseName}
          subtitle={`${from} to ${to}`}
          slides={exportSlides}
          activeSlideTitle={tab === "overall" ? "Overall" : "Agent-wise"}
        />
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          accentFocus="focus:border-blue-400"
        />
      </div>

      {tab === "overall" && (
      <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard icon={Users} label="Login Count" value={String(headline.loginCount)} tone="sky" />
        <KpiCard icon={PhoneCall} label="Overall Calls" value={headline.overallCalls.toLocaleString("en-IN")} tone="blue" />
        <KpiCard icon={ListChecks} label="Unique Leadset" value={headline.uniqueLeadset.toLocaleString("en-IN")} tone="indigo" />
        <KpiCard icon={Gauge} label="Unique Connectivity %" value={`${headline.uniqueConnectivityPct}%`} tone="teal" />
        <KpiCard icon={Activity} label="Overall Connected %" value={`${headline.overallConnectedPct}%`} tone="emerald" />
        <KpiCard icon={Scale} label="Shrinkage %" value={`${headline.shrinkagePct}%`} tone="rose" />
        <KpiCard icon={Gauge} label="Occupancy %" value={`${headline.occupancyPct}%`} tone="violet" />
        <KpiCard icon={Timer} label="Avg Talk Time" value={secToHms(headline.avgTalkTimeSec)} sub="per agent, in range" tone="cyan" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Target} label="Avg Lead / Agent" value={String(headline.avgLeadPerAgent)} tone="sky" />
        <KpiCard icon={Target} label="Per Agent Dial Count" value={String(headline.perAgentDialCount)} tone="indigo" />
        <KpiCard icon={ListChecks} label="Unique Connected Calls" value={headline.uniqueConnectedCalls.toLocaleString("en-IN")} tone="teal" />
        <KpiCard icon={PhoneCall} label="Overall Connected" value={headline.overallConnected.toLocaleString("en-IN")} tone="emerald" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={ListChecks} title="Calls by Lead-Source (Service)" tone="blue">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.byService} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="service" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Bar dataKey="calls" name="Calls" radius={[4, 4, 0, 0]}>
                {data.byService.map((entry, i) => (
                  <Cell key={entry.service} fill={SERVICE_COLORS[i % SERVICE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard icon={ListChecks} title="Lead-Source Detail" tone="indigo">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Service</th>
                  <th className="py-2 pr-3 text-right font-semibold">Calls</th>
                  <th className="py-2 pr-3 text-right font-semibold">Connected</th>
                  <th className="py-2 pr-3 text-right font-semibold">Connected %</th>
                  <th className="py-2 pr-0 text-right font-semibold">Unique Leads</th>
                </tr>
              </thead>
              <tbody>
                {data.byService.map((s) => (
                  <tr key={s.service} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-blue-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{s.service}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{s.calls.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{s.connected.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{s.connectedPct}%</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{s.uniqueLeads.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
                {data.byService.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <SectionCard icon={Timer} title="Week-wise Performance" tone="blue">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Week</th>
                <th className="py-2 pr-3 text-right font-semibold">Login Count</th>
                <th className="py-2 pr-3 text-right font-semibold">Overall Calls</th>
                <th className="py-2 pr-3 text-right font-semibold">Unique Leadset</th>
                <th className="py-2 pr-3 text-right font-semibold">Overall Connected</th>
                <th className="py-2 pr-3 text-right font-semibold">Connected %</th>
                <th className="py-2 pr-0 text-right font-semibold">Talk Time</th>
              </tr>
            </thead>
            <tbody>
              {data.byWeek.map((w) => (
                <tr key={w.weekLabel} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-blue-50/40">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{w.weekLabel}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{w.loginCount}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{w.overallCalls.toLocaleString("en-IN")}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{w.uniqueLeadset.toLocaleString("en-IN")}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{w.overallConnected.toLocaleString("en-IN")}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{w.overallConnectedPct}%</td>
                  <td className="py-2.5 pr-0 text-right text-slate-600">{secToHms(w.talkTimeSec)}</td>
                </tr>
              ))}
              {data.byWeek.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
      </>
      )}

      {tab === "agents" && (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search agent or login ID..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-blue-400 focus:outline-none"
            />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />
            {filteredAgents.length} of {data.agents.length} agents
          </span>
        </div>

        <SectionCard icon={Users} title="Agent-wise Performance" tone="indigo" footnote={tlFootnote}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 text-right font-semibold">Calls</th>
                  <th className="py-2 pr-3 text-right font-semibold">Connected</th>
                  <th className="py-2 pr-3 text-right font-semibold">Connected %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Unique Leads</th>
                  <th className="py-2 pr-3 text-right font-semibold">Talk Time</th>
                  <th className="py-2 pr-3 text-right font-semibold">Login Time</th>
                  <th className="py-2 pr-3 text-right font-semibold">Shrinkage %</th>
                  <th className="py-2 pr-0 text-right font-semibold">Occupancy %</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr key={a.loginId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/40">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-700">{a.agent}</div>
                      <div className="text-[11px] text-slate-400">{a.loginId}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.totalCalls}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.connectedCalls}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.connectedPct}%</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.uniqueLeads}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.talkTimeSec ? secToHms(a.talkTimeSec) : "—"}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.loginTimeSec ? secToHms(a.loginTimeSec) : "—"}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.loginTimeSec ? `${a.shrinkagePct}%` : "—"}</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{a.loginTimeSec ? `${a.occupancyPct}%` : "—"}</td>
                  </tr>
                ))}
                {filteredAgents.length === 0 && (
                  <tr><td colSpan={9} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
      )}
    </div>
  );
}
