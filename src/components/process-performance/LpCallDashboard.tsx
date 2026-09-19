import { useMemo, useState, useEffect, useCallback, type ComponentType, type ReactNode } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, PieChart, Pie, Legend,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  PhoneCall, Users, Gauge, Timer, ListChecks, Search, ListFilter, Scale, Activity,
  Sparkles, Clock, Repeat, Trophy, CalendarDays, Hourglass, Coffee, PhoneOff, MousePointerClick, Inbox,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  currentMonthRange, type ExportSlide, type KpiTone,
} from "./DashboardKit";
import { LpCallDrawer, type DrawerTarget } from "./LpCallDrawer";
import {
  type DashboardData, type DetailKind, PALETTE, SERVICE_COLORS, STATUS_COLORS, TOOLTIP_PROPS,
  fmtDate, fmtN, fmtShortDay, heatStyle, hourLabel, secToHms, secToShort,
} from "./lpCallShared";

/**
 * Shared call-performance dashboard for LP Feedback and LP Onboarding --
 * their uploaded tables are column-for-column identical, same as the
 * backend's lp-call-dashboard.shared.ts this calls through
 * LpFeedbackDashboard.tsx / LpOnboardingDashboard.tsx. See that file's header
 * for the KPI-to-column mapping (notably Unique Leadset = rows with
 * unique_flag = '1', a per-lead-per-day counter). Every row in every table
 * opens a drill-down drawer backed by GET <apiPath>/detail.
 */

type TabKey = "overview" | "timing" | "outcomes" | "agents" | "productivity";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "timing", label: "Timing" },
  { key: "outcomes", label: "Outcomes" },
  { key: "agents", label: "Agents" },
  { key: "productivity", label: "Productivity" },
];

function ClickRow({ onOpen, label, children, tone = "hover:bg-blue-50/50" }: {
  onOpen: () => void; label: string; children: ReactNode; tone?: string;
}) {
  return (
    <tr
      role="button" tabIndex={0} aria-label={label} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={`cursor-pointer border-b border-slate-50 transition-colors last:border-0 focus:bg-blue-50/60 focus:outline-none ${tone}`}
    >
      {children}
    </tr>
  );
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="ml-auto flex w-28 items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }} />
      </div>
      <span className="w-11 text-right font-semibold text-slate-800">{pct}%</span>
    </div>
  );
}

function HintChip({ text = "Click any row for detail" }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
      <MousePointerClick className="h-3 w-3" /> {text}
    </span>
  );
}

interface Insight { icon: ComponentType<{ className?: string }>; tone: KpiTone; title: string; body: string }

/** Every sentence below is computed from the fetched data -- nothing here is
 * a fixed claim, and each rule has a volume guard so a tiny sample can't
 * crown a "best" hour, service or agent. */
function buildInsights(d: DashboardData): Insight[] {
  const out: Insight[] = [];
  const total = d.headline.overallCalls;
  if (total === 0) return out;

  const hours = d.byHour.filter((h) => h.calls >= total * 0.03);
  if (hours.length >= 2) {
    const best = hours.reduce((a, b) => (b.connectedPct > a.connectedPct ? b : a));
    const worst = hours.reduce((a, b) => (b.connectedPct < a.connectedPct ? b : a));
    out.push({
      icon: Clock, tone: "emerald", title: "Best time to call",
      body: `${hourLabel(best.hour)} connects ${best.connectedPct}% of calls (overall ${d.headline.overallConnectedPct}%). ${hourLabel(worst.hour)} is the weakest at ${worst.connectedPct}%.`,
    });
  }

  const first = d.byAttempt[0];
  const heavy = d.byAttempt.length ? d.byAttempt.reduce((a, b) => (b.calls > a.calls ? b : a)) : null;
  if (first && heavy && heavy.attempt !== first.attempt && heavy.calls >= total * 0.15 && heavy.connectedPct < first.connectedPct) {
    out.push({
      icon: Repeat, tone: "rose", title: "Where dialling is wasted",
      body: `Attempt ${first.attempt} connects ${first.connectedPct}%, but attempt ${heavy.attempt} carries ${Math.round((heavy.calls / total) * 100)}% of all calls and connects only ${heavy.connectedPct}%.`,
    });
  }

  const services = d.byService.filter((s) => s.calls >= total * 0.02);
  if (services.length >= 2) {
    const best = services.reduce((a, b) => (b.connectedPct > a.connectedPct ? b : a));
    out.push({
      icon: ListChecks, tone: "blue", title: "Strongest lead source",
      body: `${best.service} connects ${best.connectedPct}% across ${fmtN(best.calls)} calls, ahead of the ${d.headline.overallConnectedPct}% average.`,
    });
  }

  if (d.daily.length >= 3) {
    const peak = d.daily.reduce((a, b) => (b.calls > a.calls ? b : a));
    const bestDay = d.daily.reduce((a, b) => (b.connectedPct > a.connectedPct ? b : a));
    out.push({
      icon: CalendarDays, tone: "indigo", title: "Peak and best days",
      body: `Busiest day was ${fmtDate(peak.date)} with ${fmtN(peak.calls)} calls. Best connect rate was ${fmtDate(bestDay.date)} at ${bestDay.connectedPct}%.`,
    });
  }

  const avgCalls = d.agents.length ? total / d.agents.length : 0;
  const eligible = d.agents.filter((a) => a.totalCalls >= avgCalls * 0.5);
  if (eligible.length >= 2) {
    const top = eligible.reduce((a, b) => (b.connectedPct > a.connectedPct ? b : a));
    out.push({
      icon: Trophy, tone: "amber", title: "Top connector",
      body: `${top.agent} leads with ${top.connectedPct}% connected on ${fmtN(top.totalCalls)} calls.`,
    });
  }

  if (d.timeUse.loginSec > 0) {
    const idleShare = Math.round((d.timeUse.idleSec / d.timeUse.loginSec) * 100);
    out.push({
      icon: Hourglass, tone: "violet", title: "Idle time",
      body: `Agents were idle ${idleShare}% of logged-in time (${secToShort(d.timeUse.idleSec)} in total) — talk time was ${Math.round((d.timeUse.talkSec / d.timeUse.loginSec) * 100)}%.`,
    });
  }
  return out;
}

function InsightCard({ i }: { i: Insight }) {
  const Icon = i.icon;
  const badge: Record<KpiTone, string> = {
    sky: "bg-sky-100 text-sky-600", emerald: "bg-emerald-100 text-emerald-600", teal: "bg-teal-100 text-teal-600",
    amber: "bg-amber-100 text-amber-600", violet: "bg-violet-100 text-violet-600", indigo: "bg-indigo-100 text-indigo-600",
    rose: "bg-rose-100 text-rose-600", cyan: "bg-cyan-100 text-cyan-600", red: "bg-red-100 text-red-600", blue: "bg-blue-100 text-blue-600",
  };
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${badge[i.tone]}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-700">{i.title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{i.body}</p>
      </div>
    </div>
  );
}

function DonutCenter({ value, label }: { value: string; label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <span className="text-xl font-bold tracking-tight text-slate-800">{value}</span>
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
    </div>
  );
}

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
  const [tab, setTab] = useState<TabKey>("overview");
  const [agentSearch, setAgentSearch] = useState("");
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);

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

  const open = useCallback((kind: DetailKind, key: string) => setDrawer({ kind, key }), []);

  const filteredAgents = useMemo(() => {
    const rows = data?.agents ?? [];
    const q = agentSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q) || a.loginId.toLowerCase().includes(q));
  }, [data, agentSearch]);

  const insights = useMemo(() => (data ? buildInsights(data) : []), [data]);

  const topAgents = useMemo(() => {
    if (!data || data.agents.length === 0) return [];
    const avg = data.agents.reduce((s, a) => s + a.totalCalls, 0) / data.agents.length;
    return data.agents
      .filter((a) => a.totalCalls >= avg * 0.5)
      .sort((a, b) => b.connectedPct - a.connectedPct)
      .slice(0, 3);
  }, [data]);

  /** Export slides — one per tab, built from the same data already rendered
   * on screen, not re-fetched. Report/file names derive from this instance's
   * own `title` prop so each consumer's export reflects which one it is. */
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const h = data.headline;
    const overview: ExportSlide = {
      title: "Overview",
      kpis: [
        { label: "Login Count", value: String(h.loginCount) },
        { label: "Overall Calls", value: fmtN(h.overallCalls) },
        { label: "Unique Leadset", value: fmtN(h.uniqueLeadset) },
        { label: "Unique Connectivity %", value: `${h.uniqueConnectivityPct}%` },
        { label: "Overall Connected %", value: `${h.overallConnectedPct}%` },
        { label: "Shrinkage %", value: `${h.shrinkagePct}%` },
        { label: "Occupancy %", value: `${h.occupancyPct}%` },
        { label: "Avg Talk Time (per agent per day)", value: secToHms(h.avgTalkTimeSec) },
        { label: "Unique Connected", value: fmtN(h.uniqueConnectedCalls) },
        { label: "Overall Connected", value: fmtN(h.overallConnected) },
      ],
      tables: [
        {
          title: "Daily Performance",
          columns: ["Date", "Calls", "Unique Leads", "Connected", "Connected %", "Logins"],
          rows: data.daily.map((r) => [fmtDate(r.date), r.calls, r.uniqueLeads, r.connected, `${r.connectedPct}%`, r.loginCount]),
        },
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
    const timing: ExportSlide = {
      title: "Timing",
      tables: [{
        title: "Hour-wise Performance",
        columns: ["Hour", "Calls", "Connected", "Connected %"],
        rows: data.byHour.map((r) => [`${hourLabel(r.hour)}`, r.calls, r.connected, `${r.connectedPct}%`]),
      }],
    };
    const outcomes: ExportSlide = {
      title: "Outcomes",
      tables: [
        { title: "Call Status", columns: ["Status", "Calls", "Share"], rows: data.byStatus.map((s) => [s.status, s.calls, `${s.pct}%`]) },
        { title: "Dispositions", columns: ["Disposition", "Calls", "Share"], rows: data.byDisposition.map((s) => [s.disposition, s.calls, `${s.pct}%`]) },
        { title: "Attempt Analysis", columns: ["Attempt", "Calls", "Connected", "Connected %"], rows: data.byAttempt.map((a) => [a.attempt, a.calls, a.connected, `${a.connectedPct}%`]) },
      ],
    };
    const agentsSlide: ExportSlide = {
      title: "Agents",
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
    const productivity: ExportSlide = {
      title: "Productivity",
      tables: [{
        title: "Time Utilisation (average per agent per day)",
        columns: ["Bucket", "Avg time"],
        rows: (() => {
          const t = data.timeUse;
          const avg = (s: number) => secToHms(t.agentDays > 0 ? Math.round(s / t.agentDays) : 0);
          return [
            ["Login", avg(t.loginSec)], ["Talk", avg(t.talkSec)],
            ["Wrap-up", avg(t.wrapupSec)], ["Idle", avg(t.idleSec)],
            ["Break", avg(t.breakSec)], ["Tea", avg(t.breaks.tea)],
            ["Lunch", avg(t.breaks.lunch)], ["Meeting", avg(t.breaks.meeting)],
            ["Bio break", avg(t.breaks.bio)], ["Unsolicited", avg(t.breaks.unsolicited)],
          ];
        })(),
      }],
    };
    return [overview, timing, outcomes, agentsSlide, productivity];
  }, [data]);

  const exportFileBaseName = title.replace(/[^a-zA-Z0-9]+/g, "_");
  // Shared by both LP reports; the wrappers differ only by apiPath.
  const exportDashboardKey = apiPath.includes("lp-onboarding") ? "lp_onboarding" : "lp_feedback";
  const exportReportTitle = `${eyebrow.split(" · ")[0]} — ${title}`;
  const activeSlideTitle = TABS.find((t) => t.key === tab)?.label ?? "Overview";

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { headline } = data;
  const hasData = headline.overallCalls > 0 || headline.loginCount > 0;
  const maxHourPct = Math.max(0, ...data.byHour.map((h) => h.connectedPct));
  const bestHour = data.byHour.filter((h) => h.calls >= headline.overallCalls * 0.03).reduce<number | null>(
    (best, h) => (best === null || h.connectedPct > (data.byHour.find((x) => x.hour === best)?.connectedPct ?? -1) ? h.hour : best), null,
  );
  const tu = data.timeUse;
  /** Every timing figure on the Productivity tab is an average of one agent's
   * day (sum / agent-day rows), so it's comparable with a shift length. */
  const perDay = (sec: number): number => (tu.agentDays > 0 ? Math.round(sec / tu.agentDays) : 0);
  const timeSlices = [
    { name: "Talk", value: tu.talkSec, color: PALETTE.blue },
    { name: "Wrap-up", value: tu.wrapupSec, color: PALETTE.violet },
    { name: "Idle", value: tu.idleSec, color: PALETTE.amber },
    { name: "Break", value: tu.breakSec, color: PALETTE.rose },
    { name: "Unaccounted", value: tu.otherSec, color: "#cbd5e1" },
  ].filter((s) => s.value > 0);
  const breakRows = [
    { label: "Tea", sec: perDay(tu.breaks.tea), color: PALETTE.amber },
    { label: "Lunch", sec: perDay(tu.breaks.lunch), color: PALETTE.rose },
    { label: "Bio break", sec: perDay(tu.breaks.bio), color: PALETTE.violet },
    { label: "Meeting", sec: perDay(tu.breaks.meeting), color: PALETTE.sky },
    { label: "Unsolicited", sec: perDay(tu.breaks.unsolicited), color: PALETTE.slate },
  ];
  const maxBreak = Math.max(1, ...breakRows.map((b) => b.sec));
  const totalStatus = data.byStatus.reduce((s, r) => s + r.calls, 0);
  const hangupTotal = data.hangup.reduce((s, r) => s + r.calls, 0);

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
          raw={{ dashboard: exportDashboardKey, from, to }}
          subtitle={`${fmtDate(from)} to ${fmtDate(to)}`}
          slides={exportSlides}
          activeSlideTitle={activeSlideTitle}
        />
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          accentFocus="focus:border-blue-400"
        />
      </div>

      {!hasData && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <Inbox className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No call or productivity data in this date range</p>
          <p className="max-w-sm text-xs text-slate-400">Pick a wider range, or upload the CDR and APR files from the Uploader.</p>
        </div>
      )}

      {hasData && tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard icon={Users} label="Login Count" value={String(headline.loginCount)} tone="sky" />
            <KpiCard icon={PhoneCall} label="Overall Calls" value={fmtN(headline.overallCalls)} tone="blue" />
            <KpiCard icon={ListChecks} label="Unique Leadset" value={fmtN(headline.uniqueLeadset)} sub="first call per lead per day" tone="indigo" />
            <KpiCard icon={PhoneCall} label="Overall Connected" value={fmtN(headline.overallConnected)} tone="emerald" />
            <KpiCard icon={ListChecks} label="Unique Connected" value={fmtN(headline.uniqueConnectedCalls)} tone="teal" />
            <KpiCard icon={Activity} label="Overall Connected %" value={`${headline.overallConnectedPct}%`} tone="emerald" />
            <KpiCard icon={Gauge} label="Unique Connectivity %" value={`${headline.uniqueConnectivityPct}%`} sub="leads reached / unique leadset" tone="teal" />
            <KpiCard icon={Scale} label="Shrinkage %" value={`${headline.shrinkagePct}%`} tone="rose" />
            <KpiCard icon={Gauge} label="Occupancy %" value={`${headline.occupancyPct}%`} tone="violet" />
            <KpiCard icon={Timer} label="Avg Talk Time" value={secToHms(headline.avgTalkTimeSec)} sub="per agent per day" tone="cyan" />
          </div>

          {insights.length > 0 && (
            <SectionCard icon={Sparkles} title="What the data says" tone="amber" footnote="Generated from the numbers on this page for the selected date range; each needs a minimum call volume before it is shown.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {insights.map((i) => <InsightCard key={i.title} i={i} />)}
              </div>
            </SectionCard>
          )}

          <SectionCard icon={CalendarDays} title="Daily trend — calls, unique leads and connect rate" tone="blue" footnote="Click a bar to open that day.">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" />
                <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="calls" name="Calls" fill="#bfdbfe" radius={[4, 4, 0, 0]} cursor="pointer"
                  onClick={(e: { date?: string }) => { if (e?.date) open("day", e.date); }} />
                <Line yAxisId="l" type="monotone" dataKey="uniqueLeads" name="Unique leads" stroke={PALETTE.indigo} strokeWidth={2.5} dot={{ r: 3 }} />
                <Line yAxisId="r" type="monotone" dataKey="connectedPct" name="Connected %" stroke={PALETTE.emerald} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard icon={ListChecks} title="Calls by Lead-Source (Service)" tone="blue" footnote="Click a bar to open that lead source.">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.byService} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="service" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Bar dataKey="calls" name="Calls" radius={[4, 4, 0, 0]} cursor="pointer"
                    onClick={(e: { service?: string }) => { if (e?.service) open("service", e.service); }}>
                    {data.byService.map((entry, i) => (
                      <Cell key={entry.service} fill={SERVICE_COLORS[i % SERVICE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard icon={ListChecks} title="Lead-Source Detail" tone="indigo">
              <div className="mb-2"><HintChip /></div>
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
                      <ClickRow key={s.service} onOpen={() => open("service", s.service)} label={`Open ${s.service}`}>
                        <td className="py-2.5 pr-3 font-medium text-slate-700">{s.service}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(s.calls)}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(s.connected)}</td>
                        <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{s.connectedPct}%</td>
                        <td className="py-2.5 pr-0 text-right text-slate-600">{fmtN(s.uniqueLeads)}</td>
                      </ClickRow>
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
            <div className="mb-2"><HintChip /></div>
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
                    <ClickRow key={w.weekLabel} onOpen={() => open("week", w.weekLabel)} label={`Open ${w.weekLabel}`}>
                      <td className="py-2.5 pr-3 font-medium text-slate-700">{w.weekLabel}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{w.loginCount}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(w.overallCalls)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(w.uniqueLeadset)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(w.overallConnected)}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{w.overallConnectedPct}%</td>
                      <td className="py-2.5 pr-0 text-right text-slate-600">{secToHms(w.talkTimeSec)}</td>
                    </ClickRow>
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

      {hasData && tab === "timing" && (
        <>
          <SectionCard icon={Clock} title="Best time to call — connect rate by hour" tone="emerald"
            footnote="Darker = higher connect rate. Time of day is read from each call's start time.">
            {data.byHour.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">No call start times in this range.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-11">
                {data.byHour.map((h) => (
                  <div
                    key={h.hour} style={heatStyle(h.connectedPct, maxHourPct)}
                    className={`rounded-xl border p-2.5 text-center transition-transform hover:-translate-y-0.5 ${bestHour === h.hour ? "border-emerald-500 ring-2 ring-emerald-200" : "border-emerald-100"}`}
                    title={`${fmtN(h.calls)} calls, ${fmtN(h.connected)} connected`}
                  >
                    <p className="text-[11px] font-semibold text-slate-700">{hourLabel(h.hour)}</p>
                    <p className="text-base font-bold text-emerald-900">{h.connectedPct}%</p>
                    <p className="text-[10px] text-slate-600">{fmtN(h.calls)} calls</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard icon={Clock} title="Call volume vs connect rate by hour" tone="blue">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={data.byHour} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="hour" tickFormatter={(h) => hourLabel(Number(h))} tick={{ fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" />
                <Tooltip {...TOOLTIP_PROPS} labelFormatter={(h) => `${hourLabel(Number(h))} hr`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="calls" name="Calls" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="l" dataKey="connected" name="Connected" fill={PALETTE.emerald} radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="connectedPct" name="Connected %" stroke={PALETTE.rose} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard icon={CalendarDays} title="Day-wise Performance" tone="indigo">
            <div className="mb-2"><HintChip /></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Date</th>
                    <th className="py-2 pr-3 text-right font-semibold">Calls</th>
                    <th className="py-2 pr-3 text-right font-semibold">Unique Leads</th>
                    <th className="py-2 pr-3 text-right font-semibold">Connected</th>
                    <th className="py-2 pr-3 text-right font-semibold">Connected %</th>
                    <th className="py-2 pr-3 text-right font-semibold">Logins</th>
                    <th className="py-2 pr-0 text-right font-semibold">Talk Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((r) => (
                    <ClickRow key={r.date} onOpen={() => open("day", r.date)} label={`Open ${fmtDate(r.date)}`} tone="hover:bg-indigo-50/50">
                      <td className="py-2.5 pr-3 font-medium text-slate-700">{fmtDate(r.date)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(r.calls)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(r.uniqueLeads)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(r.connected)}</td>
                      <td className="py-2.5 pr-3"><MiniBar pct={r.connectedPct} color={PALETTE.emerald} /></td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{r.loginCount}</td>
                      <td className="py-2.5 pr-0 text-right text-slate-600">{r.talkTimeSec ? secToHms(r.talkTimeSec) : "—"}</td>
                    </ClickRow>
                  ))}
                  {data.daily.length === 0 && (
                    <tr><td colSpan={7} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}

      {hasData && tab === "outcomes" && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard icon={PhoneCall} title="Call status" tone="emerald">
              <div className="relative">
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={data.byStatus} dataKey="calls" nameKey="status" innerRadius={68} outerRadius={98} paddingAngle={2} stroke="none">
                      {data.byStatus.map((s) => <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? PALETTE.slate} />)}
                    </Pie>
                    <Tooltip {...TOOLTIP_PROPS} formatter={(v: number, n: string) => [`${fmtN(v)} (${totalStatus ? Math.round((v / totalStatus) * 1000) / 10 : 0}%)`, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <DonutCenter value={fmtN(totalStatus)} label="calls" />
              </div>
            </SectionCard>

            <SectionCard icon={Repeat} title="Connect rate by attempt number" tone="rose"
              footnote="Bars are call volume, the line is how often that attempt connected — a heavy bar with a low line is where dialling effort is being spent for little return.">
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={data.byAttempt} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="attempt" tick={{ fontSize: 10 }} label={{ value: "Attempt", position: "insideBottom", offset: -2, fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip {...TOOLTIP_PROPS} labelFormatter={(a) => `Attempt ${a}`} />
                  <Bar yAxisId="l" dataKey="calls" name="Calls" fill="#bae6fd" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="r" type="monotone" dataKey="connectedPct" name="Connected %" stroke={PALETTE.rose} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard icon={ListChecks} title="Top dispositions" tone="indigo">
              {data.byDisposition.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No data for this period.</p> : (
                <ul className="space-y-2.5">
                  {data.byDisposition.map((d) => (
                    <li key={d.disposition}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate text-slate-600" title={d.disposition}>{d.disposition}</span>
                        <span className="shrink-0 font-semibold text-slate-700">{fmtN(d.calls)} <span className="font-normal text-slate-400">({d.pct}%)</span></span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, d.pct)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <div className="space-y-4">
              <SectionCard icon={Timer} title="How long connected calls last" tone="cyan" footnote="Talk duration of connected calls only.">
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={data.talkBuckets} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip {...TOOLTIP_PROPS} />
                    <Bar dataKey="calls" name="Connected calls" fill={PALETTE.cyan} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </SectionCard>

              <SectionCard icon={PhoneOff} title="Who ends the call" tone="slate">
                {hangupTotal === 0 ? <p className="py-3 text-center text-xs text-slate-400">No data for this period.</p> : (
                  <div className="space-y-2">
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                      {data.hangup.map((r, i) => (
                        <div key={r.label} title={`${r.label}: ${fmtN(r.calls)}`}
                          style={{ width: `${(r.calls / hangupTotal) * 100}%`, backgroundColor: [PALETTE.indigo, PALETTE.amber, PALETTE.slate][i % 3] }} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      {data.hangup.map((r, i) => (
                        <span key={r.label} className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: [PALETTE.indigo, PALETTE.amber, PALETTE.slate][i % 3] }} />
                          {r.label} <b className="text-slate-700">{fmtN(r.calls)}</b> ({Math.round((r.calls / hangupTotal) * 1000) / 10}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>
            </div>
          </div>
        </>
      )}

      {hasData && tab === "agents" && (
        <div className="space-y-4">
          {topAgents.length > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              {topAgents.map((a, i) => (
                <button
                  key={a.agent} type="button" onClick={() => open("agent", a.agent)}
                  className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  <div className={`absolute inset-x-0 top-0 h-1 ${["bg-amber-400", "bg-slate-300", "bg-orange-300"][i]}`} />
                  <div className="flex items-center gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${["bg-amber-100 text-amber-700", "bg-slate-100 text-slate-600", "bg-orange-100 text-orange-700"][i]}`}>
                      #{i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">{a.agent}</p>
                      <p className="text-[11px] text-slate-400">{fmtN(a.totalCalls)} calls · {fmtN(a.uniqueLeads)} unique leads</p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-xl font-bold text-emerald-600">{a.connectedPct}%</p>
                      <p className="text-[10px] text-slate-400">connected</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)}
                placeholder="Search agent or login ID..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <HintChip />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
                <ListFilter className="h-3 w-3" />
                {filteredAgents.length} of {data.agents.length} agents
              </span>
            </div>
          </div>

          <SectionCard icon={Users} title="Agent-wise Performance" tone="indigo" footnote={tlFootnote}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Agent</th>
                    <th className="py-2 pr-3 text-right font-semibold">Days</th>
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
                    <ClickRow key={a.agent} onOpen={() => open("agent", a.agent)} label={`Open ${a.agent}`} tone="hover:bg-indigo-50/50">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-700">{a.agent}</div>
                        <div className="text-[11px] text-slate-400">{a.loginId}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.daysWorked}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(a.totalCalls)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(a.connectedCalls)}</td>
                      <td className="py-2.5 pr-3"><MiniBar pct={a.connectedPct} color={PALETTE.emerald} /></td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(a.uniqueLeads)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.talkTimeSec ? secToHms(a.talkTimeSec) : "—"}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.loginTimeSec ? secToHms(a.loginTimeSec) : "—"}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.loginTimeSec ? `${a.shrinkagePct}%` : "—"}</td>
                      <td className="py-2.5 pr-0 text-right text-slate-600">{a.loginTimeSec ? `${a.occupancyPct}%` : "—"}</td>
                    </ClickRow>
                  ))}
                  {filteredAgents.length === 0 && (
                    <tr><td colSpan={10} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}

      {hasData && tab === "productivity" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard icon={Timer} label="Avg Login Time" value={secToHms(perDay(tu.loginSec))} sub="per agent per day" tone="sky" />
            <KpiCard icon={PhoneCall} label="Avg Talk Time" value={secToHms(perDay(tu.talkSec))} sub={tu.loginSec ? `${Math.round((tu.talkSec / tu.loginSec) * 100)}% of login · per agent per day` : undefined} tone="blue" />
            <KpiCard icon={Hourglass} label="Avg Idle Time" value={secToHms(perDay(tu.idleSec))} sub={tu.loginSec ? `${Math.round((tu.idleSec / tu.loginSec) * 100)}% of login · per agent per day` : undefined} tone="amber" />
            <KpiCard icon={Coffee} label="Avg Break Time" value={secToHms(perDay(tu.breakSec))} sub={tu.agentDays ? `${(tu.breakCount / tu.agentDays).toFixed(1)} breaks · per agent per day` : undefined} tone="rose" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard icon={Timer} title="Where an average login day goes" tone="blue"
              footnote="Average of one agent's day, built from the APR file's own talk, wrap-up, idle and break figures; anything the file doesn't account for is shown as Unaccounted.">
              <div className="relative">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={timeSlices} dataKey="value" nameKey="name" innerRadius={72} outerRadius={104} paddingAngle={2} stroke="none">
                      {timeSlices.map((s) => <Cell key={s.name} fill={s.color} />)}
                    </Pie>
                    <Tooltip {...TOOLTIP_PROPS} formatter={(v: number, n: string) => [`${secToHms(perDay(v))} (${tu.loginSec ? Math.round((v / tu.loginSec) * 1000) / 10 : 0}%)`, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <DonutCenter value={secToHms(perDay(tu.loginSec))} label="avg login / day" />
              </div>
            </SectionCard>

            <SectionCard icon={Coffee} title="Break breakdown (avg per agent per day)" tone="rose">
              <ul className="space-y-3">
                {breakRows.map((b) => (
                  <li key={b.label} className="grid grid-cols-[84px_1fr_64px] items-center gap-3 text-xs">
                    <span className="text-slate-500">{b.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${(b.sec / maxBreak) * 100}%`, backgroundColor: b.color }} />
                    </div>
                    <span className="text-right font-medium text-slate-700">{secToHms(b.sec)}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          <SectionCard icon={Users} title="Agent utilisation (avg per day)" tone="indigo">
            <div className="mb-2"><HintChip /></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Agent</th>
                    <th className="py-2 pr-3 text-right font-semibold">Login</th>
                    <th className="py-2 pr-3 text-right font-semibold">Talk</th>
                    <th className="py-2 pr-3 text-right font-semibold">Idle</th>
                    <th className="py-2 pr-3 text-right font-semibold">Break</th>
                    <th className="py-2 pr-3 text-right font-semibold">Shrinkage</th>
                    <th className="py-2 pr-0 text-right font-semibold">Occupancy</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.filter((a) => a.loginTimeSec > 0).map((a) => (
                    <ClickRow key={a.agent} onOpen={() => open("agent", a.agent)} label={`Open ${a.agent}`} tone="hover:bg-indigo-50/50">
                      <td className="py-2.5 pr-3 font-medium text-slate-700">{a.agent}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{secToHms(Math.round(a.loginTimeSec / Math.max(1, a.aprDays)))}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{secToHms(Math.round(a.talkTimeSec / Math.max(1, a.aprDays)))}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{secToHms(Math.round(a.idleSec / Math.max(1, a.aprDays)))}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{secToHms(Math.round(a.breakSec / Math.max(1, a.aprDays)))}</td>
                      <td className="py-2.5 pr-3"><MiniBar pct={a.shrinkagePct} color={PALETTE.rose} /></td>
                      <td className="py-2.5 pr-0"><MiniBar pct={a.occupancyPct} color={PALETTE.violet} /></td>
                    </ClickRow>
                  ))}
                  {data.agents.every((a) => a.loginTimeSec === 0) && (
                    <tr><td colSpan={7} className="py-6 text-center text-slate-400">No productivity (APR) rows in this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}

      {drawer && (
        <LpCallDrawer apiPath={apiPath} target={drawer} from={from} to={to} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}
