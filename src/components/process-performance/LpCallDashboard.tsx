import { useMemo, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line, PieChart, Pie,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  PhoneCall, Users, Gauge, Timer, Filter, Eye, Trophy, ListChecks, Activity, Layers, MousePointerClick,
  UserCheck, PhoneForwarded, Repeat, Target, Database,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  currentMonthRange, localDateStr, formatShortDate, type ExportSlide,
} from "./DashboardKit";
import { LpCallDrawer, type DrawerTarget } from "./LpCallDrawer";
import { GncDetailDrawer, type DrawerSeries } from "./GncAbandonCartDetailDrawer";
import {
  type DashboardData, type DetailKind, fmtDate, fmtN, hourLabel, secToHms,
} from "./lpCallShared";

/**
 * Lawyer Panel call-performance dashboard, shared by LP Onboarding and LP
 * Feedback (their APR/CDR tables are column-for-column identical -- see the
 * backend's lp-call-dashboard.shared.ts for the KPI-to-column mapping,
 * notably Unique Leadset = CDR rows with unique_flag = '1').
 *
 * Built from the reference layouts the user supplied, but ONLY with what
 * this app's LP data can back. Total Data Received is the distinct lead_id
 * count in the call file (the true lead-allocation figure would come from
 * mas_hrms.lp_leads_raw). Deliberately not shown, no data behind them: CR
 * Reports, Token Count/Revenue/AOV, LS Count/Amount/AOV, Agreement Closed,
 * Eligible & Non-Eligible Leads, and (on the Agent-wise tab) Language /
 * Target / Achievement % -- checked live 2026-09-24, the tables meant to
 * hold them (mas_hrms.lp_leads_raw, lp_cr_report_raw) are empty and the
 * uploaded CDR/APR carry no amount, target, report or language column.
 *
 * Every KPI card and chart's "View details" opens a Trend + Week-wise +
 * Date-wise drawer built from the daily rows already in memory; agent and
 * campaign rows open the per-record drawer (GET <apiPath>/detail).
 */

type TabKey = "overview" | "agents" | "campaigns";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agent-wise" },
  { key: "campaigns", label: "Campaign-wise" },
];

type Preset = "MTD" | "WTD" | "YTD";
function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const to = localDateStr(now);
  if (p === "MTD") return currentMonthRange();
  if (p === "YTD") return { from: localDateStr(new Date(now.getFullYear(), 0, 1)), to };
  const mon = new Date(now);
  mon.setDate(mon.getDate() - ((now.getDay() + 6) % 7));
  return { from: localDateStr(mon), to };
}

const TT = { fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" } as const;
const FUNNEL_COLORS = ["#2563eb", "#6366f1", "#14b8a6", "#f59e0b"];
const CAMPAIGN_COLORS = ["#2563eb", "#0ea5e9", "#6366f1", "#8b5cf6", "#14b8a6", "#f59e0b"];

function ViewDetailsBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
    >
      <Eye className="h-3 w-3" /> View details
    </button>
  );
}

function ClickRow({ onOpen, label, children }: { onOpen: () => void; label: string; children: ReactNode }) {
  return (
    <tr
      role="button" tabIndex={0} aria-label={label} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-blue-50/50 focus:bg-blue-50/60 focus:outline-none"
    >
      {children}
    </tr>
  );
}

function HintChip({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
      <MousePointerClick className="h-3 w-3" /> {text}
    </span>
  );
}

function Th({ children, left }: { children: ReactNode; left?: boolean }) {
  return <th className={`px-2 py-1.5 font-bold text-white ${left ? "text-left" : ""}`}>{children}</th>;
}

function CallFunnel({ stages }: { stages: Array<{ stage: string; count: number }> }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <div className="space-y-1">
      {stages.map((s, i) => (
        <div key={s.stage} className="flex items-center gap-2">
          <div
            className="flex h-8 items-center justify-center rounded-md text-xs font-bold text-white shadow-sm"
            style={{ width: `${Math.max(12, (s.count / max) * 100)}%`, backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }}
          >
            {fmtN(s.count)}
          </div>
          <div className="text-[10px] font-semibold leading-tight text-slate-600">{s.stage}</div>
        </div>
      ))}
    </div>
  );
}

const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export function LpCallDashboard({
  apiPath, eyebrow, title, unavailableLabel,
}: {
  apiPath: string; eyebrow: string; title: string; unavailableLabel: string;
}) {
  const isOnboarding = apiPath.includes("onboarding");
  const heroGradient = isOnboarding ? "from-indigo-700 via-blue-700 to-indigo-800" : "from-blue-700 via-sky-700 to-blue-800";
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [agentSearch, setAgentSearch] = useState("");
  const [record, setRecord] = useState<DrawerTarget | null>(null);
  const [metric, setMetric] = useState<{ title: string; series: DrawerSeries[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(`${apiPath}?from=${from}&to=${to}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : unavailableLabel);
    } finally {
      setLoading(false);
    }
  }, [apiPath, from, to, unavailableLabel]);
  useEffect(() => { void load(); }, [load]);

  const openRecord = useCallback((kind: DetailKind, key: string) => setRecord({ kind, key }), []);
  const openMetric = (t: string, series: DrawerSeries[]) => setMetric({ title: t, series });

  /** Per-day derived fields, computed once so KPI drawers, charts and tables agree. */
  const dailyEnriched = useMemo(() => (data?.daily ?? []).map((d) => ({
    ...d,
    present: d.loginCount,
    attempt: d.uniqueLeads > 0 ? Math.round((d.calls / d.uniqueLeads) * 100) / 100 : 0,
    uniqueConnectedPct: pct1(d.uniqueConnected, d.uniqueLeads),
    callsPerAgent: d.loginCount > 0 ? Math.round(d.calls / d.loginCount) : 0,
    avgTalkPerAgent: d.loginCount > 0 ? Math.round(d.talkTimeSec / d.loginCount) : 0,
  })), [data]);

  /** Mon-Sun weeks; ratios are recomputed from the week's own sums, never averaged from daily ratios. */
  const weeklyEnriched = useMemo(() => {
    const weeks = new Map<string, { calls: number; uniqueLeads: number; connected: number; uniqueConnected: number; present: number; talkTimeSec: number }>();
    for (const d of dailyEnriched) {
      const dt = new Date(`${d.date}T00:00:00`);
      const mon = new Date(dt);
      mon.setDate(mon.getDate() - ((dt.getDay() + 6) % 7));
      const key = localDateStr(mon);
      const w = weeks.get(key) ?? { calls: 0, uniqueLeads: 0, connected: 0, uniqueConnected: 0, present: 0, talkTimeSec: 0 };
      w.calls += d.calls; w.uniqueLeads += d.uniqueLeads; w.connected += d.connected;
      w.uniqueConnected += d.uniqueConnected; w.present += d.present; w.talkTimeSec += d.talkTimeSec;
      weeks.set(key, w);
    }
    return [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, w], i) => ({
      ...w, label: `Week ${i + 1}`,
      connectedPct: pct1(w.connected, w.calls),
      uniqueConnectedPct: pct1(w.uniqueConnected, w.uniqueLeads),
      attempt: w.uniqueLeads > 0 ? Math.round((w.calls / w.uniqueLeads) * 100) / 100 : 0,
      callsPerAgent: w.present > 0 ? Math.round(w.calls / w.present) : 0,
      avgTalkPerAgent: w.present > 0 ? Math.round(w.talkTimeSec / w.present) : 0,
    }));
  }, [dailyEnriched]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agents ?? [];
    const q = agentSearch.trim().toLowerCase();
    return q ? rows.filter((a) => a.agent.toLowerCase().includes(q) || a.loginId.toLowerCase().includes(q)) : rows;
  }, [data, agentSearch]);

  const topByCalls = useMemo(() => [...(data?.agents ?? [])].sort((a, b) => b.totalCalls - a.totalCalls).slice(0, 3), [data]);
  const topByConnect = useMemo(() => {
    const ag = data?.agents ?? [];
    if (!ag.length) return [];
    const avg = ag.reduce((s, a) => s + a.totalCalls, 0) / ag.length;
    return ag.filter((a) => a.totalCalls >= avg * 0.5).sort((a, b) => b.connectedPct - a.connectedPct).slice(0, 3);
  }, [data]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const h = data.headline;
    const present = data.timeUse.agentDays;
    return [
      {
        title: "Overview",
        kpis: [
          { label: "Total Present Count (agent-days)", value: fmtN(present) },
          { label: "Total Calls", value: fmtN(h.overallCalls) },
          { label: "Connected Calls", value: fmtN(h.overallConnected) },
          { label: "Connect %", value: `${h.overallConnectedPct}%` },
          { label: "Unique Dialed", value: fmtN(h.uniqueLeadset) },
          { label: "Unique Connect", value: fmtN(h.uniqueConnectedCalls) },
          { label: "Unique Connect %", value: `${h.uniqueConnectivityPct}%` },
          { label: "Attempt (calls per unique lead)", value: String(h.avgAttemptsPerLead) },
          { label: "Per Agent Calls (per agent-day)", value: present > 0 ? fmtN(Math.round(h.overallCalls / present)) : "0" },
          { label: "Avg Talk Time (per agent-day)", value: secToHms(h.avgTalkTimeSec) },
        ],
        tables: [
          { title: "Daily", columns: ["Date", "Present", "Calls", "Connected", "Connect %", "Unique Dialed", "Unique Connect"], rows: dailyEnriched.map((d) => [fmtDate(d.date), d.present, d.calls, d.connected, `${d.connectedPct}%`, d.uniqueLeads, d.uniqueConnected]) },
          { title: "Week-wise", columns: ["Week", "Present", "Calls", "Connected", "Connect %", "Unique Dialed", "Unique Connect"], rows: weeklyEnriched.map((w) => [w.label, w.present, w.calls, w.connected, `${w.connectedPct}%`, w.uniqueLeads, w.uniqueConnected]) },
          { title: "Dispositions", columns: ["Disposition", "Calls", "Share"], rows: data.byDisposition.map((s) => [s.disposition, s.calls, `${s.pct}%`]) },
        ],
      },
      {
        title: "Agent-wise",
        tables: [{
          title: "Agent-wise Performance",
          columns: ["Agent", "Login ID", "Leads", "Calls", "Connect", "Con %", "Login", "Net Login", "Talk", "Wrap", "Idle", "Break", "Occ %", "Shrink %"],
          rows: data.agents.map((a) => [a.agent, a.loginId, a.uniqueLeads, a.totalCalls, a.connectedCalls, `${a.connectedPct}%`,
            secToHms(a.loginTimeSec), secToHms(a.netLoginTimeSec), secToHms(a.talkTimeSec), secToHms(a.wrapupSec), secToHms(a.idleSec), secToHms(a.breakSec),
            a.loginTimeSec ? `${a.occupancyPct}%` : "—", a.loginTimeSec ? `${a.shrinkagePct}%` : "—"]),
        }],
      },
      {
        title: "Campaign-wise",
        tables: [{
          title: "Campaign-wise (lead source)",
          columns: ["Campaign", "Calls", "Connected", "Con %", "Unique Leads"],
          rows: data.byService.map((s) => [s.service, s.calls, s.connected, `${s.connectedPct}%`, s.uniqueLeads]),
        }],
      },
    ];
  }, [data, dailyEnriched, weeklyEnriched]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error && !data) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const h = data.headline;
  const present = data.timeUse.agentDays;
  const perAgentCalls = present > 0 ? Math.round(h.overallCalls / present) : 0;
  const tu = data.timeUse;
  const avgOf = (s: number) => (tu.agentDays > 0 ? Math.round(s / tu.agentDays) : 0);

  const S = {
    present: { key: "present", label: "Present", fmt: "int", color: "#2563eb" } as DrawerSeries,
    calls: { key: "calls", label: "Total Calls", fmt: "int", color: "#2563eb" } as DrawerSeries,
    connected: { key: "connected", label: "Connected Calls", fmt: "int", color: "#10b981" } as DrawerSeries,
    connectedPct: { key: "connectedPct", label: "Connect %", fmt: "pct", color: "#f59e0b" } as DrawerSeries,
    uniqueLeads: { key: "uniqueLeads", label: "Unique Dialed", fmt: "int", color: "#6366f1" } as DrawerSeries,
    uniqueConnected: { key: "uniqueConnected", label: "Unique Connect", fmt: "int", color: "#14b8a6" } as DrawerSeries,
    uniqueConnectedPct: { key: "uniqueConnectedPct", label: "Unique Connect %", fmt: "pct", color: "#f59e0b" } as DrawerSeries,
    attempt: { key: "attempt", label: "Attempt", fmt: "int", color: "#8b5cf6" } as DrawerSeries,
    callsPerAgent: { key: "callsPerAgent", label: "Calls per Agent-day", fmt: "int", color: "#0ea5e9" } as DrawerSeries,
    avgTalk: { key: "avgTalkPerAgent", label: "Avg Talk / Agent-day", fmt: "hms", color: "#ec4899" } as DrawerSeries,
  };

  const kpi = (icon: typeof PhoneCall, label: string, value: string, tone: Parameters<typeof KpiCard>[0]["tone"], s: DrawerSeries, sub?: string) => (
    <KpiCard icon={icon} label={label} value={value} sub={sub} tone={tone} onClick={() => openMetric(label, [s])} />
  );

  return (
    <div className="space-y-3">
      <DashboardHero<TabKey>
        icon={Users} eyebrow={eyebrow} title={title}
        tabs={TABS} activeTab={tab} onTabChange={setTab} gradient={heroGradient}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle={title} fileBaseName={title.replace(/[^A-Za-z]+/g, "_")}
          raw={{ dashboard: isOnboarding ? "lp_onboarding" : "lp_feedback", from, to }}
          subtitle={`${from} to ${to}`} slides={exportSlides}
          activeSlideTitle={tab === "agents" ? "Agent-wise" : tab === "campaigns" ? "Campaign-wise" : "Overview"}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white text-[11px] font-bold">
            {(["MTD", "WTD", "YTD"] as Preset[]).map((p) => {
              const r = presetRange(p);
              const active = r.from === from && r.to === to;
              return (
                <button
                  key={p} type="button" onClick={() => { setFrom(r.from); setTo(r.to); }}
                  className={`px-3 py-1.5 transition-colors ${active ? "bg-blue-700 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                >{p}</button>
              );
            })}
          </div>
          <DateRangeToolbar
            from={from} to={to} onFrom={setFrom} onTo={setTo}
            onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
            resetLabel="This Month"
          />
        </div>
      </div>

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {kpi(UserCheck, "Total Present Count", fmtN(present), "blue", S.present, "agent-days")}
            <KpiCard icon={Database} label="Total Data Received" value={fmtN(h.distinctLeads)} sub="distinct lead IDs in call file" tone="emerald" />
            {kpi(PhoneCall, "Total Calls", fmtN(h.overallCalls), "indigo", S.calls)}
            {kpi(PhoneForwarded, "Connected Calls", fmtN(h.overallConnected), "teal", S.connected)}
            {kpi(Gauge, "Connect %", `${h.overallConnectedPct}%`, "amber", S.connectedPct)}
            {kpi(Users, "Unique Dialed", fmtN(h.uniqueLeadset), "violet", S.uniqueLeads, "lead-days")}
            {kpi(Target, "Unique Connect", fmtN(h.uniqueConnectedCalls), "teal", S.uniqueConnected)}
            {kpi(Gauge, "Unique Connect %", `${h.uniqueConnectivityPct}%`, "amber", S.uniqueConnectedPct)}
            {kpi(Repeat, "Attempt", String(h.avgAttemptsPerLead), "sky", S.attempt, "calls per unique lead")}
            {kpi(Activity, "Per Agent Calls", fmtN(perAgentCalls), "cyan", S.callsPerAgent, "per agent-day")}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <SectionCard
              icon={Filter} title="Call Funnel" tone="blue"
              footnote={`Distinct leads throughout, so each stage nests in the last.${isOnboarding ? " \"Allocated to Advisor\" = leads with an \"Allocate to advisor ...\" disposition." : " Feedback has no advisor-allocation disposition, so it stops at Connected."}`}
            >
              <CallFunnel stages={[
                { stage: "Total Data Received", count: h.distinctLeads },
                { stage: "Leads Connected", count: h.connectedLeads },
                ...(isOnboarding ? [{ stage: "Allocated to Advisor", count: h.advisorAllocatedLeads }] : []),
              ]} />
            </SectionCard>

            <SectionCard
              icon={Activity} title="Call Performance Trend" tone="indigo"
              action={<ViewDetailsBtn onClick={() => openMetric("Call Performance Trend", [S.calls, S.connected, S.connectedPct])} />}
            >
              <ResponsiveContainer width="100%" height={170}>
                <ComposedChart data={dailyEnriched} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} unit="%" />
                  <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={TT} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line yAxisId="l" type="monotone" dataKey="calls" name="Total Calls" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line yAxisId="l" type="monotone" dataKey="connected" name="Connected Calls" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line yAxisId="r" type="monotone" dataKey="connectedPct" name="Connect %" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard
              icon={Target} title="Onboarding & Conversion" tone="teal"
              footnote="Present Count is agent-days; the rest are lead / lead-day counts, so read the bars as a snapshot, not a ladder."
              action={<ViewDetailsBtn onClick={() => openMetric("Onboarding & Conversion", [S.present, S.uniqueLeads, S.uniqueConnected])} />}
            >
              <ResponsiveContainer width="100%" height={170}>
                <BarChart
                  data={[
                    { name: "Present", value: present },
                    { name: "Data Received", value: h.distinctLeads },
                    { name: "Unique Dialed", value: h.uniqueLeadset },
                    { name: "Unique Connect", value: h.uniqueConnectedCalls },
                    ...(isOnboarding ? [{ name: "To Advisor", value: h.advisorAllocatedLeads }] : []),
                  ]}
                  margin={{ top: 16, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 8 }} interval={0} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={TT} />
                  <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
                    {[0, 1, 2, 3, 4].map((i) => <Cell key={i} fill={["#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"][i]} />)}
                    <LabelList dataKey="value" position="top" formatter={(v: number) => fmtN(v)} style={{ fontSize: 9, fontWeight: 700, fill: "#475569" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <SectionCard icon={ListChecks} title="Follow-ups & Dispositions" tone="amber" footnote={`Call back: ${fmtN(h.callBackCalls)} calls (${h.callBackPct}%). Whole-range only -- no daily split.`}>
              <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-amber-700 text-[10px] uppercase tracking-wide text-white">
                      <Th left>Disposition</Th><Th>Calls</Th><Th>Share</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDisposition.slice(0, 8).map((d, i) => (
                      <tr key={d.disposition} className={`border-b border-slate-50 last:border-0 ${i % 2 ? "bg-amber-50/30" : "bg-white"}`}>
                        <td className="max-w-[170px] truncate px-2 py-1.5 font-medium text-slate-700" title={d.disposition}>{d.disposition}</td>
                        <td className="px-2 py-1.5 text-center text-slate-600">{fmtN(d.calls)}</td>
                        <td className="px-2 py-1.5 text-center font-semibold text-amber-700">{d.pct}%</td>
                      </tr>
                    ))}
                    {data.byDisposition.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-slate-400">No data for this period.</td></tr>}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard icon={Trophy} title="Top Performers" tone="violet" footnote="Connect % ranks agents with at least half the average call volume.">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">By Calls</p>
                  {topByCalls.map((a, i) => (
                    <button key={a.agent} type="button" onClick={() => openRecord("agent", a.agent)} className="mb-1 flex w-full items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5 text-left hover:bg-violet-50">
                      <span className="truncate font-medium text-slate-700">{i + 1}. {a.agent}</span>
                      <span className="ml-2 font-bold text-slate-800">{fmtN(a.totalCalls)}</span>
                    </button>
                  ))}
                  {topByCalls.length === 0 && <p className="text-slate-400">None</p>}
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">By Connect %</p>
                  {topByConnect.map((a, i) => (
                    <button key={a.agent} type="button" onClick={() => openRecord("agent", a.agent)} className="mb-1 flex w-full items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5 text-left hover:bg-violet-50">
                      <span className="truncate font-medium text-slate-700">{i + 1}. {a.agent}</span>
                      <span className="ml-2 font-bold text-emerald-600">{a.connectedPct}%</span>
                    </button>
                  ))}
                  {topByConnect.length === 0 && <p className="text-slate-400">None</p>}
                </div>
              </div>
            </SectionCard>

            <SectionCard icon={Timer} title="Login & Productivity (Team Avg)" tone="sky" footnote="Per agent per day, from the APR file. Whole-range only.">
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["Net Login", secToHms(avgOf(tu.netLoginSec))], ["Talk Time", secToHms(avgOf(tu.talkSec))], ["Wrap Time", secToHms(avgOf(tu.wrapupSec))],
                  ["Idle Time", secToHms(avgOf(tu.idleSec))], ["Occupancy", `${h.occupancyPct}%`], ["Shrinkage", `${h.shrinkagePct}%`],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-xl border border-slate-100 bg-slate-50/60 px-2 py-2 text-center">
                    <p className="text-[10px] font-medium text-slate-500">{l}</p>
                    <p className="text-sm font-bold text-slate-800">{v}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <SectionCard
            icon={Layers} title="Week-wise Performance" tone="blue"
            action={<ViewDetailsBtn onClick={() => openMetric("Week-wise Performance", [S.present, S.calls, S.connected, S.connectedPct, S.uniqueLeads, S.uniqueConnected])} />}
          >
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-center text-xs">
                <thead>
                  <tr className="bg-blue-800 text-[10px] uppercase tracking-wide text-white">
                    <Th left>Week</Th><Th>Present</Th><Th>Total Calls</Th><Th>Connected</Th><Th>Connect %</Th><Th>Unique Dialed</Th><Th>Unique Connect</Th><Th>Unique Connect %</Th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyEnriched.map((w, i) => (
                    <tr key={w.label} className={`border-b border-slate-50 last:border-0 ${i % 2 ? "bg-blue-50/30" : "bg-white"}`}>
                      <td className="px-2 py-1.5 text-left font-medium text-slate-700">{w.label}</td>
                      <td className="px-2 py-1.5 text-slate-600">{w.present}</td>
                      <td className="px-2 py-1.5 text-slate-600">{fmtN(w.calls)}</td>
                      <td className="px-2 py-1.5 text-emerald-600">{fmtN(w.connected)}</td>
                      <td className="px-2 py-1.5 font-semibold text-amber-600">{w.connectedPct}%</td>
                      <td className="px-2 py-1.5 text-slate-600">{fmtN(w.uniqueLeads)}</td>
                      <td className="px-2 py-1.5 text-teal-600">{fmtN(w.uniqueConnected)}</td>
                      <td className="px-2 py-1.5 font-semibold text-amber-600">{w.uniqueConnectedPct}%</td>
                    </tr>
                  ))}
                  {weeklyEnriched.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-400">No data for this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard icon={Layers} title="Hourly Call Pattern" tone="teal" footnote="Hour of day has no week/date split, so this chart has no drill-down.">
            <ResponsiveContainer width="100%" height={170}>
              <ComposedChart data={data.byHour.map((r) => ({ ...r, label: hourLabel(r.hour) }))} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} unit="%" />
                <Tooltip contentStyle={TT} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar yAxisId="l" dataKey="calls" name="Calls" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="connectedPct" name="Connect %" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </SectionCard>
        </>
      )}

      {tab === "agents" && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard icon={Users} label="Agents" value={String(data.agents.length)} tone="blue" />
            <KpiCard icon={PhoneCall} label="Total Calls" value={fmtN(h.overallCalls)} tone="indigo" />
            <KpiCard icon={PhoneForwarded} label="Connected Calls" value={fmtN(h.overallConnected)} tone="emerald" />
            <KpiCard icon={Gauge} label="Connect %" value={`${h.overallConnectedPct}%`} tone="amber" />
            <KpiCard icon={Activity} label="Occupancy %" value={`${h.occupancyPct}%`} tone="cyan" />
            <KpiCard icon={Timer} label="Shrinkage %" value={`${h.shrinkagePct}%`} tone="rose" />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SectionCard icon={PhoneCall} title="Calls & Connected by Agent" tone="indigo" footnote="Click a bar's agent in the table below for their day-by-day detail.">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.agents.slice(0, 12)} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="agent" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={TT} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="totalCalls" name="Total Calls" fill="#2563eb" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="connectedCalls" name="Connected" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
            <SectionCard icon={Gauge} title="Connect % by Agent" tone="amber">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.agents.slice(0, 12)} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="agent" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis tick={{ fontSize: 9 }} unit="%" />
                  <Tooltip formatter={(v: number) => `${v}%`} contentStyle={TT} />
                  <Bar dataKey="connectedPct" name="Connect %" radius={[3, 3, 0, 0]}>
                    {data.agents.slice(0, 12).map((a, i) => <Cell key={a.agent} fill={CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          <SectionCard icon={Users} title="Agent-wise Performance" tone="blue" action={<HintChip text="Click any agent for detail" />}>
            <div className="mb-2">
              <input
                type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Search agent..."
                className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div className="max-h-96 overflow-auto rounded-xl border border-slate-100">
              <table className="w-full text-center text-[11px]">
                <thead>
                  <tr className="sticky top-0 z-10 bg-blue-800 text-[10px] uppercase tracking-wide text-white">
                    <Th left>Agent</Th><Th>Leads</Th><Th>Calls</Th><Th>Connect</Th><Th>Con %</Th><Th>Login Time</Th><Th>Net Login</Th>
                    <Th>Talk Time</Th><Th>Wrap Time</Th><Th>Idle Time</Th><Th>Total Break</Th><Th>Occ %</Th><Th>Shrink %</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((a) => (
                    <ClickRow key={a.agent} label={`Open ${a.agent}`} onOpen={() => openRecord("agent", a.agent)}>
                      <td className="px-2 py-1.5 text-left font-medium text-slate-700">{a.agent}</td>
                      <td className="px-2 py-1.5 text-slate-600">{fmtN(a.uniqueLeads)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{fmtN(a.totalCalls)}</td>
                      <td className="px-2 py-1.5 text-emerald-600">{fmtN(a.connectedCalls)}</td>
                      <td className="px-2 py-1.5 font-semibold text-amber-600">{a.connectedPct}%</td>
                      <td className="px-2 py-1.5 text-slate-600">{secToHms(a.loginTimeSec)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{secToHms(a.netLoginTimeSec)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{secToHms(a.talkTimeSec)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{secToHms(a.wrapupSec)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{secToHms(a.idleSec)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{secToHms(a.breakSec)}</td>
                      <td className="px-2 py-1.5 font-semibold text-indigo-600">{a.loginTimeSec ? `${a.occupancyPct}%` : "—"}</td>
                      <td className="px-2 py-1.5 text-slate-600">{a.loginTimeSec ? `${a.shrinkagePct}%` : "—"}</td>
                    </ClickRow>
                  ))}
                  {filteredAgents.length === 0 && <tr><td colSpan={13} className="py-6 text-center text-slate-400">No agents for this period.</td></tr>}
                </tbody>
                {filteredAgents.length > 0 && (
                  <tfoot>
                    <tr className="sticky bottom-0 bg-slate-800 text-white">
                      <td className="px-2 py-1.5 text-left font-bold text-white">Total</td>
                      <td className="px-2 py-1.5 font-bold text-white">{fmtN(filteredAgents.reduce((s, a) => s + a.uniqueLeads, 0))}</td>
                      <td className="px-2 py-1.5 font-bold text-white">{fmtN(filteredAgents.reduce((s, a) => s + a.totalCalls, 0))}</td>
                      <td className="px-2 py-1.5 font-bold text-white">{fmtN(filteredAgents.reduce((s, a) => s + a.connectedCalls, 0))}</td>
                      <td className="px-2 py-1.5 font-bold text-white">{pct1(filteredAgents.reduce((s, a) => s + a.connectedCalls, 0), filteredAgents.reduce((s, a) => s + a.totalCalls, 0))}%</td>
                      {(["loginTimeSec", "netLoginTimeSec", "talkTimeSec", "wrapupSec", "idleSec", "breakSec"] as const).map((k) => (
                        <td key={k} className="px-2 py-1.5 font-bold text-white">{secToHms(filteredAgents.reduce((s, a) => s + a[k], 0))}</td>
                      ))}
                      <td className="px-2 py-1.5 font-bold text-white">{h.occupancyPct}%</td>
                      <td className="px-2 py-1.5 font-bold text-white">{h.shrinkagePct}%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">Leads = unique lead-days each agent dialed. No Language / Token / LS / Target columns: none of them exists in the uploaded APR or CDR.</p>
          </SectionCard>

          <div className="grid gap-3 lg:grid-cols-2">
            <SectionCard icon={Trophy} title="Top Performers (By Calls)" tone="violet">
              {topByCalls.map((a, i) => (
                <button key={a.agent} type="button" onClick={() => openRecord("agent", a.agent)} className="mb-1 flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-left text-xs hover:bg-violet-50">
                  <span className="font-medium text-slate-700">{i + 1}. {a.agent}</span><span className="font-bold text-slate-800">{fmtN(a.totalCalls)}</span>
                </button>
              ))}
              {topByCalls.length === 0 && <p className="text-xs text-slate-400">None</p>}
            </SectionCard>
            <SectionCard icon={Trophy} title="Top Performers (By Connect %)" tone="emerald">
              {topByConnect.map((a, i) => (
                <button key={a.agent} type="button" onClick={() => openRecord("agent", a.agent)} className="mb-1 flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-left text-xs hover:bg-emerald-50">
                  <span className="font-medium text-slate-700">{i + 1}. {a.agent}</span><span className="font-bold text-emerald-600">{a.connectedPct}%</span>
                </button>
              ))}
              {topByConnect.length === 0 && <p className="text-xs text-slate-400">None</p>}
            </SectionCard>
          </div>
        </>
      )}

      {tab === "campaigns" && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KpiCard icon={Layers} label="Campaigns" value={String(data.byService.length)} tone="blue" />
            <KpiCard icon={PhoneCall} label="Total Calls" value={fmtN(h.overallCalls)} tone="indigo" />
            <KpiCard icon={PhoneForwarded} label="Connected Calls" value={fmtN(h.overallConnected)} tone="emerald" />
            <KpiCard icon={Gauge} label="Connect %" value={`${h.overallConnectedPct}%`} tone="amber" />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SectionCard icon={PhoneCall} title="Calls & Connected by Campaign" tone="indigo">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.byService} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="service" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={TT} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="calls" name="Calls" fill="#2563eb" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="connected" name="Connected" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
            <SectionCard icon={Layers} title="Share of Calls" tone="teal">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data.byService.map((s) => ({ name: `${s.service} — ${pct1(s.calls, h.overallCalls)}%`, value: s.calls }))}
                    dataKey="value" nameKey="name" cx="50%" cy="46%" innerRadius={40} outerRadius={70} paddingAngle={2}
                  >
                    {data.byService.map((s, i) => <Cell key={s.service} fill={CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length]} stroke="white" strokeWidth={2} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Tooltip contentStyle={TT} />
                </PieChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          <SectionCard icon={Layers} title="Campaign-wise Performance (lead source)" tone="blue" action={<HintChip text="Click any campaign for detail" />}>
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-center text-xs">
                <thead>
                  <tr className="bg-blue-800 text-[10px] uppercase tracking-wide text-white">
                    <Th left>Campaign</Th><Th>Calls</Th><Th>Share</Th><Th>Connected</Th><Th>Con %</Th><Th>Unique Leads</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.byService.map((s) => (
                    <ClickRow key={s.service} label={`Open ${s.service}`} onOpen={() => openRecord("service", s.service)}>
                      <td className="px-2 py-1.5 text-left font-medium text-slate-700">{s.service}</td>
                      <td className="px-2 py-1.5 text-slate-600">{fmtN(s.calls)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{pct1(s.calls, h.overallCalls)}%</td>
                      <td className="px-2 py-1.5 text-emerald-600">{fmtN(s.connected)}</td>
                      <td className="px-2 py-1.5 font-semibold text-amber-600">{s.connectedPct}%</td>
                      <td className="px-2 py-1.5 text-slate-600">{fmtN(s.uniqueLeads)}</td>
                    </ClickRow>
                  ))}
                  {data.byService.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">No campaigns for this period.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">Campaign = the CDR's service (lead-source) code.</p>
          </SectionCard>
        </>
      )}

      {record && <LpCallDrawer apiPath={apiPath} target={record} from={from} to={to} onClose={() => setRecord(null)} />}
      {metric && (
        <GncDetailDrawer
          title={metric.title} eyebrow={`${eyebrow} · Week-wise & Date-wise`} gradient={heroGradient}
          series={metric.series} dailyRows={dailyEnriched} weeklyRows={weeklyEnriched}
          onClose={() => setMetric(null)}
        />
      )}
    </div>
  );
}
