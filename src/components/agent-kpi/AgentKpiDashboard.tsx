import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlarmClock, ArrowDownRight, ArrowUpRight, Award, CalendarDays, CheckCircle2, Clock, Frown, Headphones, Lightbulb,
  Loader, Meh, PhoneCall, PhoneIncoming, PhoneMissed, Play, RefreshCcw, ShieldCheck, Smile, Sparkles,
  Target, Timer, TrendingUp, Users, Zap,
} from "lucide-react";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { AgentKpiDrawer } from "./AgentKpiDrawer";
import {
  type CqScore, type DrawerSpec, type MyKpiData, type TrendMetric, type WeaknessData,
  COMPONENT_COLORS, QUALITY_COMPONENTS,
  changePct, fmtDate, fmtDuration, fmtHoursMinutes, fmtNum, fmtPct, getData, hourLabel, istToday, toneForCq, withAgent,
} from "./agent-kpi-model";

const C = {
  indigo: "#4f46e5", green: "#22c55e", sky: "#7dd3fc", red: "#ef4444", orange: "#f59e0b",
  violet: "#8b5cf6", teal: "#14b8a6", pink: "#ec4899", slate: "#94a3b8", blue: "#3b82f6",
};
const MIX_COLORS = [C.indigo, C.orange, C.green, C.red, C.violet, C.teal, C.pink, C.sky, C.blue, C.slate];
const BAND_STYLE: Record<string, string> = { TQ: "bg-emerald-50 text-emerald-700", MQ: "bg-amber-50 text-amber-700", BQ: "bg-rose-50 text-rose-700" };

type AuditedAgent = { masid: string; name: string | null; audits: number };

function initials(name: string | null | undefined) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function Card({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className="text-xs font-semibold text-indigo-600 hover:underline">{children}</button>;
}

function Trend({ value, betterWhenLower = false, suffix = "%" }: { value: number | null; betterWhenLower?: boolean; suffix?: string }) {
  if (value === null) return null;
  const good = betterWhenLower ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? "text-emerald-600" : "text-rose-600"}`}>
      <Icon size={13} />{Math.abs(value)}{suffix}
    </span>
  );
}

function Tile({ icon, tone, label, value, sub, onClick, spark }: {
  icon: ReactNode; tone: string; label: string; value: ReactNode; sub: ReactNode; onClick: () => void; spark?: number[];
}) {
  return (
    <button onClick={onClick} className="group flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-medium leading-tight text-slate-500">{label}</p>
          <p className="text-2xl font-extrabold leading-tight text-slate-900">{value}</p>
        </div>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0 text-xs leading-snug text-slate-500">{sub}</div>
        {spark && spark.some((v) => v > 0) && (
          <div className="h-6 w-16 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke={C.indigo} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </button>
  );
}

function Metric({ icon, label, value, sub, onClick }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40">
      <span className="mt-0.5 text-indigo-500">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] leading-tight text-slate-500">{label}</span>
        <span className={`block whitespace-nowrap font-extrabold leading-tight text-slate-900 ${typeof value === "string" && value.length > 6 ? "text-sm 2xl:text-base" : "text-base 2xl:text-lg"}`}>{value}</span>
        {sub && <span className="block text-[10px] leading-tight text-slate-400">{sub}</span>}
      </span>
    </button>
  );
}

export function AgentKpiDashboard() {
  const qc = useQueryClient();
  const [date, setDate] = useState(istToday());
  const [selectedAgent, setSelectedAgent] = useState("");
  const [metricTab, setMetricTab] = useState<"today" | "mtd">("today");
  const [recentTab, setRecentTab] = useState<"all" | "audited">("all");
  const [drawer, setDrawer] = useState<DrawerSpec[]>([]);
  const agentCode = selectedAgent || undefined;
  const open = (s: DrawerSpec) => setDrawer([s]);

  const agents = useQuery({
    queryKey: ["agent-kpi", "audited-agents"],
    queryFn: () => getData<AuditedAgent[]>("/api/agent/audited-agents"),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const canViewOthers = agents.isSuccess;

  const kpi = useQuery({
    queryKey: ["agent-kpi", "my-kpi", agentCode, date],
    queryFn: () => getData<MyKpiData>(withAgent(`/api/agent/my-kpi?date=${date}`, agentCode)),
    retry: false,
    staleTime: 60_000,
    refetchInterval: date === istToday() ? 120_000 : false,
  });
  const cq = useQuery({
    queryKey: ["agent-kpi", "cq", agentCode],
    queryFn: () => getData<CqScore>(withAgent("/api/agent/cq-score?daysBack=7", agentCode)),
    retry: false,
    staleTime: 60_000,
    enabled: kpi.isSuccess,
  });
  const weak = useQuery({
    queryKey: ["agent-kpi", "weak", agentCode],
    queryFn: () => getData<WeaknessData>(withAgent("/api/agent/weakness-detail", agentCode)),
    retry: false,
    staleTime: 60_000,
    enabled: kpi.isSuccess,
  });

  const notAgent = kpi.isError && (kpi.error as { status?: number } | null)?.status === 403;
  const d = kpi.data;

  const agentOptions: SearchableOption[] = (agents.data ?? []).map((a) => ({
    value: a.masid, label: `${a.name ?? "Unmapped"} (${a.masid})`, hint: `${a.audits} audits / 30 days`, keywords: `${a.name ?? ""} ${a.masid}`,
  }));

  const hourly = useMemo(() => {
    const byHour = new Map((d?.hourly ?? []).map((h) => [h.hour, h]));
    return Array.from({ length: 14 }, (_, i) => i + 8).map((h) => {
      const r = byHour.get(h);
      return { hour: h, label: hourLabel(h), handled: r?.handled ?? 0, within_20s: r?.within_20s ?? 0, sl: r?.sl_pct ?? null };
    });
  }, [d]);

  const dayFilter = d ? { from: d.date, to: d.date } : { from: date, to: date };
  const mtdFilter = d ? { from: d.month_start, to: d.date } : { from: date, to: date };
  /** Every KPI tile opens its date-wise view for the selected month; dates then drill into records. */
  const trend = (metric: TrendMetric) => open({ kind: "trend", metric, ...mtdFilter });

  // "My own dashboard" only makes sense once we know the viewer is themselves an agent.
  const selfIsAgent = !selectedAgent ? kpi.isSuccess : true;
  const picker = canViewOthers ? (
    <div className="w-72">
      <SearchableSelect
        options={selfIsAgent ? [{ value: "", label: "My own dashboard" }, ...agentOptions] : agentOptions}
        value={selectedAgent}
        onChange={(v) => { setSelectedAgent(v); setDrawer([]); }}
        placeholder="View an agent"
        searchPlaceholder="Search name or MASID"
        emptyText="No agent matches"
      />
    </div>
  ) : null;

  const dateInput = (
    <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
      <CalendarDays size={14} />
      <input type="date" value={date} max={istToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className="bg-transparent outline-none" aria-label="Report date" />
    </label>
  );

  if (kpi.isLoading) {
    return <div className="flex items-center justify-center rounded-2xl border bg-white py-16"><Loader className="animate-spin text-indigo-500" size={28} /></div>;
  }

  if (notAgent) {
    if (!canViewOthers) return null;
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-4">
        <div>
          <p className="font-semibold text-slate-900">Agent performance dashboard</p>
          <p className="text-sm text-slate-500">Your account is not linked to a call-centre MASID. Pick an agent to view their dashboard.</p>
        </div>
        <div className="flex items-center gap-2">{dateInput}{picker}</div>
      </section>
    );
  }

  if (kpi.isError || !d) {
    return (
      <section className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <span>Call performance data is unavailable right now.</span>
        <button onClick={() => kpi.refetch()} className="rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs font-semibold">Retry</button>
      </section>
    );
  }

  const t = d.today;
  const prev = d.previous;
  const isToday = d.date === istToday();
  const lastCall = d.recent_calls[0];
  const minutesSinceLast = lastCall && isToday
    ? (Date.now() + 5.5 * 3600_000 - new Date(`${lastCall.date}T${lastCall.time}Z`).getTime()) / 60_000
    : null;
  const activeNow = minutesSinceLast !== null && minutesSinceLast >= 0 && minutesSinceLast <= 30;
  const slDiff = t.sl_pct !== null && d.team_today.sl_pct !== null ? Math.round((t.sl_pct - d.team_today.sl_pct) * 10) / 10 : null;
  const ahtDiff = t.aht_s !== null && d.team_today.aht_s !== null ? t.aht_s - d.team_today.aht_s : null;
  const qScore = cq.data && cq.data.total_calls > 0 ? cq.data : null;
  const groups = (weak.data?.weakness_areas ?? []).filter((g) => g.score !== null)
    .sort((a, b) => QUALITY_COMPONENTS.indexOf(a.category as never) - QUALITY_COMPONENTS.indexOf(b.category as never));
  const weakest = [...(weak.data?.parameters ?? [])].filter((p) => p.score !== null && p.failed_calls > 0).sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
  const mixTotal = d.campaign_mix.reduce((a, m) => a + m.calls, 0);
  const m = metricTab === "today" ? t : d.mtd;
  const metricFilter = metricTab === "today" ? dayFilter : mtdFilter;

  const suggestions: Array<{ icon: ReactNode; text: string; onClick: () => void }> = [];
  if (slDiff !== null) {
    suggestions.push(slDiff >= 0
      ? { icon: <TrendingUp size={16} className="text-emerald-600" />, text: `Good job! Your SL is ${slDiff} pts above the team average today (${fmtPct(d.team_today.sl_pct)}).`, onClick: () => open({ kind: "calls", title: "Calls answered within 20 sec", filter: { ...dayFilter, sl: "in" } }) }
      : { icon: <AlarmClock size={16} className="text-rose-600" />, text: `Your SL is ${Math.abs(slDiff)} pts below the team average (${fmtPct(d.team_today.sl_pct)}). ${t.handled - t.within_20s} calls waited over 20 sec.`, onClick: () => open({ kind: "calls", title: "Calls answered after 20 sec", filter: { ...dayFilter, sl: "out" } }) });
  }
  if (ahtDiff !== null && Math.abs(ahtDiff) >= 15) {
    suggestions.push(ahtDiff > 0
      ? { icon: <Timer size={16} className="text-amber-600" />, text: `Your AHT is ${fmtDuration(ahtDiff)} above the team (${fmtDuration(d.team_today.aht_s)}). Review your longest calls.`, onClick: () => open({ kind: "calls", title: "Longest calls first", filter: { ...dayFilter, sort: "duration" } }) }
      : { icon: <Timer size={16} className="text-emerald-600" />, text: `Your AHT is ${fmtDuration(-ahtDiff)} faster than the team (${fmtDuration(d.team_today.aht_s)}).`, onClick: () => open({ kind: "calls", title: "Longest calls first", filter: { ...dayFilter, sort: "duration" } }) });
  }
  if (weakest && (weakest.score ?? 100) < 90) {
    suggestions.push({
      icon: <Lightbulb size={16} className="text-indigo-600" />,
      text: `Focus on "${weakest.label}" (${weakest.group}) — missed on ${weakest.failed_calls} of ${weakest.graded_calls} audited calls this week.${weakest.tip ? ` ${weakest.tip}` : ""}`,
      onClick: () => open({ kind: "quality" }),
    });
  }
  if (qScore && qScore.fatal_calls > 0) {
    suggestions.push({ icon: <ShieldCheck size={16} className="text-rose-600" />, text: `${qScore.fatal_calls} fatal call${qScore.fatal_calls === 1 ? "" : "s"} this week: escalation, address capture and information accuracy were all missed.`, onClick: () => open({ kind: "feedback" }) });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-600 text-lg font-bold text-white">{initials(d.header.name)}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-extrabold text-slate-900">{d.header.name ?? d.header.masid}</h1>
              {isToday && (activeNow
                ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">● Active · last call {lastCall?.time.slice(0, 5)}</span>
                : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{lastCall ? `Last call ${lastCall.time.slice(0, 5)}` : "No calls yet today"}</span>)}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              MAS ID : {d.header.masid} <span className="mx-1 text-slate-300">|</span> Process : {d.header.process ?? "—"}
              <span className="mx-1 text-slate-300">|</span> Team : {d.header.team ?? "—"}
              <span className="mx-1 text-slate-300">|</span> TL : {d.header.team_leader ?? "—"}
            </p>
          </div>
        </div>
        {slDiff !== null && (
          <div className={`flex items-center gap-3 rounded-xl px-4 py-2 ${slDiff >= 0 ? "bg-amber-50" : "bg-rose-50"}`}>
            <Sparkles className={slDiff >= 0 ? "text-amber-500" : "text-rose-500"} size={22} />
            <div>
              <p className="text-sm font-bold text-slate-900">{slDiff >= 0 ? "Keep up the good work!" : "Let's pick up the pace"}</p>
              <p className="text-xs text-slate-500">Your SL is {Math.abs(slDiff)} pts {slDiff >= 0 ? "above" : "below"} the team average today.</p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {isToday && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">● Live</span>}
          <span className="text-xs text-slate-500">Last updated : {fmtDate(d.generated_at.slice(0, 10), new Date(d.generated_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }))}</span>
          <button onClick={() => { qc.invalidateQueries({ queryKey: ["agent-kpi"] }); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Refresh"><RefreshCcw size={15} className={kpi.isFetching ? "animate-spin" : ""} /></button>
          {dateInput}
          {picker}
        </div>
      </section>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Tile icon={<PhoneIncoming size={20} className="text-blue-600" />} tone="bg-blue-50" label="Calls Offered" value={fmtNum(d.queue_today.total.offered)}
          sub={`Queue · ${d.queue_today.byCampaign.length} campaigns`} onClick={() => trend("offered")} />
        <Tile icon={<PhoneCall size={20} className="text-emerald-600" />} tone="bg-emerald-50" label="Calls Answered" value={fmtNum(t.handled)}
          sub={<span className="flex flex-wrap items-center gap-1"><Trend value={changePct(t.handled, prev?.handled)} /> {prev ? "vs last day" : "by you"}</span>}
          spark={hourly.map((h) => h.handled)} onClick={() => trend("answered")} />
        <Tile icon={<Zap size={20} className="text-violet-600" />} tone="bg-violet-50" label="Ans. within 20 Sec" value={fmtNum(t.within_20s)}
          sub={<span className="font-semibold text-emerald-600">{fmtPct(t.sl_pct)} SL</span>} onClick={() => trend("sl")} />
        <Tile icon={<PhoneMissed size={20} className="text-rose-600" />} tone="bg-rose-50" label="Total Abandoned" value={fmtNum(d.queue_today.total.abandoned)}
          sub={`Queue · ${fmtPct(d.queue_today.total.abandon_pct)}`} onClick={() => trend("abandoned")} />
        <Tile icon={<Clock size={20} className="text-amber-600" />} tone="bg-amber-50" label="AHT" value={fmtDuration(t.aht_s)}
          sub={<span className="flex flex-wrap items-center gap-1"><Trend value={changePct(t.aht_s, prev?.aht_s)} betterWhenLower /> team {fmtDuration(d.team_today.aht_s)}</span>}
          onClick={() => trend("aht")} />
        <Tile icon={<Users size={20} className="text-fuchsia-600" />} tone="bg-fuchsia-50" label="Login Hours" value={fmtHoursMinutes(t.login_s)}
          sub={t.first_login ? `First login ${t.first_login}` : "No login record"} onClick={() => trend("login")} />
        <Tile icon={<Target size={20} className="text-teal-600" />} tone="bg-teal-50" label="Quality Score"
          value={qScore ? fmtPct(qScore.cq_score_current) : cq.isLoading ? <Loader size={18} className="mt-1 animate-spin text-teal-500" /> : "—"}
          sub={qScore
            ? <span className="flex flex-wrap items-center gap-1"><Trend value={Math.round((qScore.cq_score_7day_avg - qScore.cq_score_30day_avg) * 10) / 10} suffix=" pts" /> vs 30 days</span>
            : cq.isLoading ? "Loading audits…" : cq.isError ? "Unavailable" : "No audits (7 days)"}
          onClick={() => trend("quality")} />
      </div>

      {/* Row: trend, quality breakdown, feedback */}
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1fr]">
        <Card title="Call Performance Trend" action={<span className="rounded-lg border px-2 py-0.5 text-xs text-slate-500">Hourly · {fmtDate(d.date)}</span>}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hourly} onClick={(e: { activeLabel?: string } | null) => {
                const h = e?.activeLabel ? Number(e.activeLabel.slice(0, 2)) : NaN;
                if (!Number.isNaN(h)) open({ kind: "calls", title: `Calls at ${hourLabel(h)}`, filter: { ...dayFilter, hour: h } });
              }} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: number, name: string) => (name === "SL %" ? fmtPct(v) : v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="handled" name="Answered" fill={C.indigo} radius={[3, 3, 0, 0]} cursor="pointer" />
                <Bar yAxisId="l" dataKey="within_20s" name="Answered (≤20s)" fill={C.green} radius={[3, 3, 0, 0]} cursor="pointer" />
                <Line yAxisId="r" dataKey="sl" name="SL %" stroke={C.orange} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Click a bar to see the calls in that hour.</p>
        </Card>

        <Card title="Quality Score Breakdown" action={qScore ? <LinkButton onClick={() => open({ kind: "quality" })}>All parameters</LinkButton> : undefined}>
          {!qScore ? <p className="py-10 text-center text-sm text-slate-400">{cq.isLoading ? "Loading…" : "No audited calls in the last 7 days."}</p> : (
            <button onClick={() => open({ kind: "quality" })} className="grid w-full grid-cols-[130px_1fr] items-center gap-3 text-left">
              <div className="relative h-32 w-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[{ v: qScore.cq_score_current }, { v: Math.max(0, 100 - qScore.cq_score_current) }]} dataKey="v" innerRadius={44} outerRadius={60} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                      <Cell fill={qScore.cq_score_current >= 90 ? C.green : qScore.cq_score_current >= 70 ? C.orange : C.red} />
                      <Cell fill="#eef2f7" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-extrabold text-slate-900">{fmtPct(qScore.cq_score_current)}</span>
                  <span className="text-[10px] text-slate-500">{qScore.total_calls} audits</span>
                </div>
              </div>
              <div className="space-y-2">
                {groups.length === 0 && <p className="text-xs text-slate-400">Parameter groups loading…</p>}
                {groups.map((g) => (
                  <div key={g.category} className="grid grid-cols-[92px_1fr_40px] items-center gap-2 text-xs">
                    <span className="truncate text-slate-600">{g.category}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, g.score ?? 0)}%`, background: COMPONENT_COLORS[g.category] ?? C.slate }} />
                    </span>
                    <span className={`text-right font-bold ${(g.score ?? 0) >= 90 ? "text-emerald-600" : (g.score ?? 0) >= 70 ? "text-amber-600" : "text-rose-600"}`}>{fmtPct(g.score, 0)}</span>
                  </div>
                ))}
                <p className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] text-slate-400">
                  {qScore.band && <span className={`rounded px-1.5 py-0.5 font-bold ${BAND_STYLE[qScore.band]}`}>{qScore.band}</span>}
                  Rank {qScore.rank.position || "—"} of {qScore.rank.total_agents} in process · {weak.data?.parameters.length ?? 19} parameters
                </p>
              </div>
            </button>
          )}
        </Card>

        <Card title="Latest Audit Feedback" action={
          <div className="flex items-center gap-2">
            {d.feedback_ack?.available && (d.feedback_ack.pending > 0
              ? <button onClick={() => open({ kind: "feedback" })} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800" title="Audited calls with feedback in the last 30 days not yet acknowledged">
                  {d.feedback_ack.pending} pending acknowledgement
                </button>
              : d.feedback_ack.with_feedback > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">All acknowledged</span>)}
            <LinkButton onClick={() => open({ kind: "feedback" })}>View All</LinkButton>
          </div>
        }>
          {d.recent_feedback.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No audited calls in the last 7 days.</p> : (
            <ul className="space-y-2">
              {d.recent_feedback.slice(0, 5).map((f) => {
                const tone = toneForCq(f.cq_pct);
                const Icon = tone === "positive" ? Smile : tone === "negative" ? Frown : Meh;
                const style = tone === "positive" ? "bg-emerald-50 text-emerald-700" : tone === "negative" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";
                return (
                  <li key={f.audit_id}>
                    <button onClick={() => open({ kind: "audit", auditId: f.audit_id })} className="flex w-full items-start gap-2 rounded-lg p-1.5 text-left hover:bg-slate-50">
                      <Icon size={20} className={tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-rose-500" : "text-amber-500"} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 text-xs text-slate-800">{f.feedback || `${f.scenario ?? "Call"} — no improvement points noted`}</span>
                        <span className="text-[10px] text-slate-400">{f.at.slice(11)} · {f.at.slice(8, 10)}/{f.at.slice(5, 7)} · {f.scenario ?? "—"}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${style}`}>{fmtPct(f.cq_pct, 0)}</span>
                        {d.feedback_ack?.available && (f.acknowledgement
                          ? <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600" title={`Acknowledged ${f.acknowledgement.acknowledged_at}`}><CheckCircle2 size={11} /> Ack</span>
                          : <span className="text-[10px] font-semibold text-amber-600">{d.feedback_ack.can_acknowledge ? "Acknowledge →" : "Pending"}</span>)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-slate-400">Feedback is the AI auditor's own comment; colour reflects the call's CQ score.{d.feedback_ack?.can_acknowledge ? " Open an item to acknowledge it." : ""}</p>
        </Card>
      </div>

      {/* Row: key metrics, call mix, suggestions */}
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1fr]">
        <Card title="Key Metrics (Today vs MTD)" action={
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
            {(["today", "mtd"] as const).map((k) => (
              <button key={k} onClick={() => setMetricTab(k)} className={`rounded-md px-3 py-1 ${metricTab === k ? "bg-indigo-600 text-white shadow" : "text-slate-600"}`}>{k === "today" ? "Today" : "MTD"}</button>
            ))}
          </div>
        }>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
            <Metric icon={<PhoneCall size={16} />} label="Total Calls" value={fmtNum(m.handled)} sub={metricTab === "today" ? `(MTD: ${fmtNum(d.mtd.handled)})` : `${d.mtd.days_worked} days worked`} onClick={() => trend("answered")} />
            <Metric icon={<Zap size={16} />} label="Ans ≤ 20 Sec" value={fmtNum(m.within_20s)} sub={metricTab === "today" ? `(MTD: ${fmtNum(d.mtd.within_20s)})` : undefined} onClick={() => trend("sl")} />
            <Metric icon={<Target size={16} />} label="SL %" value={fmtPct(m.sl_pct)} sub={metricTab === "today" ? `(MTD: ${fmtPct(d.mtd.sl_pct)})` : undefined} onClick={() => trend("sl")} />
            <Metric icon={<Headphones size={16} />} label="Total Talk Time" value={fmtDuration(m.talk_s, true)} sub={metricTab === "today" ? `(MTD: ${fmtDuration(d.mtd.talk_s, true)})` : undefined} onClick={() => trend("answered")} />
            <Metric icon={<Clock size={16} />} label="AHT" value={fmtDuration(m.aht_s)} sub={metricTab === "today" ? `(MTD: ${fmtDuration(d.mtd.aht_s)})` : undefined} onClick={() => trend("aht")} />
            <Metric icon={<Timer size={16} />} label="Avg Hold" value={fmtDuration(m.avg_hold_s)} sub={metricTab === "today" ? `(MTD: ${fmtDuration(d.mtd.avg_hold_s)})` : undefined} onClick={() => trend("aht")} />
            <Metric icon={<AlarmClock size={16} />} label="Avg After-Call Work" value={fmtDuration(m.avg_acw_s)} sub={metricTab === "today" ? `(MTD: ${fmtDuration(d.mtd.avg_acw_s)})` : undefined} onClick={() => trend("aht")} />
            <Metric icon={<Users size={16} />} label="Login Hours" value={fmtHoursMinutes(m.login_s)} sub={metricTab === "today" ? `(MTD: ${fmtHoursMinutes(d.mtd.login_s)})` : undefined} onClick={() => trend("login")} />
          </div>
        </Card>

        <Card title={`Call Mix by Campaign (${isToday ? "Today" : fmtDate(d.date)})`} action={<LinkButton onClick={() => open({ kind: "calls", title: "Calls you answered", filter: dayFilter })}>View Details</LinkButton>}>
          {d.campaign_mix.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No calls on this date.</p> : (
            <div className="grid grid-cols-[140px_1fr] items-center gap-3">
              <div className="relative h-36 w-36">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={d.campaign_mix} dataKey="calls" nameKey="campaign" innerRadius={42} outerRadius={66} paddingAngle={1} stroke="none" cursor="pointer"
                      onClick={(e: { campaign?: string }) => e?.campaign && open({ kind: "calls", title: `Your calls · ${e.campaign}`, filter: { ...dayFilter, campaign: e.campaign } })}>
                      {d.campaign_mix.map((c, i) => <Cell key={c.campaign} fill={MIX_COLORS[i % MIX_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-extrabold text-slate-900">{fmtNum(mixTotal)}</span>
                  <span className="text-[10px] text-slate-500">Total Calls</span>
                </div>
              </div>
              <ul className="space-y-1">
                {d.campaign_mix.slice(0, 7).map((c, i) => (
                  <li key={c.campaign}>
                    <button onClick={() => open({ kind: "calls", title: `Your calls · ${c.campaign}`, filter: { ...dayFilter, campaign: c.campaign } })}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />
                      <span className="min-w-0 flex-1 truncate text-slate-600" title={c.campaign}>{c.campaign}</span>
                      <span className="font-semibold text-slate-800">{c.calls}</span>
                      <span className="w-10 text-right text-slate-400">({Math.round((100 * c.calls) / Math.max(1, mixTotal))}%)</span>
                    </button>
                  </li>
                ))}
                {d.campaign_mix.length > 7 && <li className="px-1 text-[11px] text-slate-400">+{d.campaign_mix.length - 7} more campaigns</li>}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Suggestions for You" action={<span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">Auto</span>}>
          {suggestions.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">Not enough data for suggestions yet.</p> : (
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <li key={i}>
                  <button onClick={s.onClick} className="flex w-full items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-left text-xs text-slate-700 hover:border-indigo-200 hover:bg-indigo-50/40">
                    <span className="mt-0.5">{s.icon}</span><span>{s.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-slate-400">Generated from your call and audit data — not official QA feedback.</p>
        </Card>
      </div>

      {/* Row: recent calls, weekly */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Recent Calls" action={
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
              {(["all", "audited"] as const).map((k) => (
                <button key={k} onClick={() => setRecentTab(k)} className={`rounded-md px-3 py-1 ${recentTab === k ? "bg-indigo-600 text-white shadow" : "text-slate-600"}`}>
                  {k === "all" ? "All calls" : "Audited"}
                </button>
              ))}
            </div>
            <LinkButton onClick={() => (recentTab === "all" ? open({ kind: "calls", title: "Calls you answered", filter: dayFilter }) : open({ kind: "feedback" }))}>View All</LinkButton>
          </div>
        }>
          {recentTab === "audited" ? (
            d.recent_feedback.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No audited calls in the last 7 days.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr><th className="px-3 py-2">Audited call</th><th className="px-3 py-2">Scenario</th><th className="px-3 py-2">Quality Score</th><th className="px-3 py-2">Feedback</th><th className="px-3 py-2">Recording</th></tr>
                  </thead>
                  <tbody>
                    {d.recent_feedback.map((f) => (
                      <tr key={f.audit_id} onClick={() => open({ kind: "audit", auditId: f.audit_id })} className="cursor-pointer border-t hover:bg-indigo-50/40">
                        <td className="px-3 py-2 font-medium whitespace-nowrap">{fmtDate(f.at.slice(0, 10), f.at.slice(11))}</td>
                        <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5">{f.scenario ?? "—"}</span></td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-1.5 py-0.5 font-bold ${(f.cq_pct ?? 0) >= 90 ? "bg-emerald-50 text-emerald-700" : (f.cq_pct ?? 0) >= 70 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{fmtPct(f.cq_pct, 0)}</span>
                        </td>
                        <td className="max-w-[320px] truncate px-3 py-2 text-slate-600" title={f.feedback ?? ""}>{f.feedback ?? "No improvement points noted"}</td>
                        <td className="px-3 py-2"><span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-600"><Play size={12} /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : d.recent_calls.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No calls on this date.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Customer Number</th><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Talk Time</th><th className="px-3 py-2">Quality Score</th><th className="px-3 py-2">Feedback</th><th className="px-3 py-2">Recording</th></tr>
                </thead>
                <tbody>
                  {d.recent_calls.map((c) => (
                    <tr key={c.id} onClick={() => open({ kind: "call", id: c.id })} className="cursor-pointer border-t hover:bg-indigo-50/40">
                      <td className="px-3 py-2 font-medium">{c.time.slice(0, 5)}</td>
                      <td className="px-3 py-2">{c.phone_masked}</td>
                      <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5">{c.campaign}</span></td>
                      <td className="px-3 py-2">{c.talk_s === null ? <span className="text-amber-600">In call</span> : fmtDuration(c.talk_s)}</td>
                      <td className="px-3 py-2">{c.audit?.cq_pct !== undefined && c.audit?.cq_pct !== null
                        ? <span className={`rounded px-1.5 py-0.5 font-bold ${c.audit.cq_pct >= 90 ? "bg-emerald-50 text-emerald-700" : c.audit.cq_pct >= 70 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{fmtPct(c.audit.cq_pct, 0)}</span>
                        : <span className="text-slate-400">Not audited</span>}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-600" title={c.audit?.feedback ?? ""}>{c.audit?.feedback ?? "—"}</td>
                      <td className="px-3 py-2">{c.audit?.recording_url
                        ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-600"><Play size={12} /></span>
                        : <span className="text-slate-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Monthly Performance" action={<LinkButton onClick={() => open({ kind: "calls", title: "Calls this month", filter: mtdFilter })}>View All</LinkButton>}>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d.weekly.map((w) => ({ ...w, label: `Week ${w.week}` }))} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}
                onClick={(e: { activeTooltipIndex?: number } | null) => {
                  const w = e?.activeTooltipIndex !== undefined ? d.weekly[e.activeTooltipIndex] : undefined;
                  if (w && w.handled > 0) open({ kind: "calls", title: `Week ${w.week} calls`, filter: { from: w.from, to: w.to } });
                }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: number, name: string) => (name === "SL %" ? fmtPct(v) : v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="handled" name="Calls Answered" fill={C.indigo} radius={[3, 3, 0, 0]} cursor="pointer" />
                <Bar yAxisId="l" dataKey="within_20s" name="Answered (≤20s)" fill={C.green} radius={[3, 3, 0, 0]} cursor="pointer" />
                <Line yAxisId="r" dataKey="sl_pct" name="SL %" stroke={C.orange} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Weeks of {fmtDate(d.month_start).slice(3)} (W1 = days 1–7). Click a week to see its calls.</p>
        </Card>
      </div>

      <p className="flex items-center gap-1 text-[11px] text-slate-400">
        <Award size={12} /> Sources: dialer call records (calls, SL, AHT, queue), dialer productivity report (login), AI call audits (quality, feedback, recordings).
        Offered and abandoned are queue totals for the campaigns you worked — abandoned calls are never connected to an agent.
      </p>

      <AgentKpiDrawer stack={drawer} setStack={setDrawer} agentCode={agentCode} />
    </div>
  );
}
