import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AreaChart, Area, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  PhoneIncoming, PhoneCall, PhoneOff, Gauge, Timer, Users, Search, ListFilter, Radio, Clock3,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  currentMonthRange, formatShortDate,
  type ExportSlide,
} from "./DashboardKit";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

/**
 * GNC's own beautified "Inbound" view — Overview / Agent-wise / Date-wise,
 * built specifically for GNC per explicit user request. Deliberately does
 * NOT touch NativeInboundDashboard.tsx / ProjectDetailView / inbound.service.ts
 * / inbound.routes.ts: those are shared by 7 other companies' Inbound tabs
 * (bellavita/clovia/neemans/dalmia/dubangladesh/viega/exicom) and stay
 * exactly as they were. This component calls the SAME already-live
 * `/api/inbound/project/gnc*` endpoints those other tabs use (live
 * dialer_db.cdr_in_4 data, GNC's 6 real campaigns) -- it's a new
 * presentation over existing, tested data, not a new data source.
 *
 * The one backend change made alongside this (inbound.service.ts's
 * getProjectAgentSummary now also returns `agentName`, not just `agentId`)
 * is additive and shared -- it benefits all 8 companies' agent-wise data
 * with zero change to any existing field.
 */

interface ProjectSummary {
  total: number; answered: number; abandoned: number;
  ans_pct: number; abandon_pct: number; sl_pct: number;
  avg_wait: number; avg_handle: number; login_count: number; unique_phones: number;
}
interface TrendRow {
  date: string; login_count: number; offered: number; answered: number; sl_num: number; acht: number; unique_phones: number;
}
interface AgentRow {
  agentId: string; agentName: string; offered: number; answered: number; sl_pct: number; acht: number; repeat_pct: number;
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);
const secondsToMin = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

/* --------------------------- table column defs (Excel-style sort/filter) --------------------------- */

interface AgentPerfCol {
  key: string; label: string; headerClassName: string; tdClassName: string;
  get: (r: AgentRow) => string | number | null;
  cell: (r: AgentRow) => ReactNode;
}
const INBOUND_AGENT_COLS: AgentPerfCol[] = [
  {
    key: "agent", label: "Agent", headerClassName: "py-2 pr-3 font-semibold", tdClassName: "py-2.5 pr-3", get: (a) => a.agentName,
    cell: (a) => <><div className="font-medium text-slate-700">{a.agentName}</div><div className="text-[11px] text-slate-400">{a.agentId}</div></>,
  },
  { key: "offered", label: "Offered", headerClassName: "py-2 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right text-slate-600", get: (a) => a.offered, cell: (a) => a.offered },
  { key: "answered", label: "Answered", headerClassName: "py-2 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right text-slate-600", get: (a) => a.answered, cell: (a) => a.answered },
  { key: "answerPct", label: "Answer %", headerClassName: "py-2 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right text-slate-600", get: (a) => pct(a.answered, a.offered), cell: (a) => `${pct(a.answered, a.offered)}%` },
  {
    key: "sl_pct", label: "Service Level", headerClassName: "py-2 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right font-semibold", get: (a) => a.sl_pct, cell: (a) => `${a.sl_pct}%`,
  },
  { key: "acht", label: "Avg Handle", headerClassName: "py-2 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right text-slate-600", get: (a) => a.acht, cell: (a) => (a.acht ? secondsToMin(a.acht) : "—") },
  { key: "repeat_pct", label: "Repeat %", headerClassName: "py-2 pr-0 text-right font-semibold", tdClassName: "py-2.5 pr-0 text-right text-slate-600", get: (a) => a.repeat_pct, cell: (a) => `${a.repeat_pct}%` },
];
const INBOUND_AGENT_FILTER_COLS: Array<FilterColumn<AgentRow>> = INBOUND_AGENT_COLS.map((c) => ({ key: c.key, get: c.get }));
const inboundAgentColGetter = (r: AgentRow, key: string) => INBOUND_AGENT_COLS.find((c) => c.key === key)?.get(r);

interface EnrichedDateRow extends TrendRow {
  offered: number; answered: number; abandoned: number; ansPct: number; abandonPct: number; slPct: number;
}
interface DateWiseCol {
  key: string; label: string; headerClassName: string; tdClassName: string;
  get: (r: EnrichedDateRow) => string | number | null;
  cell: (r: EnrichedDateRow) => ReactNode;
}
const INBOUND_DATEWISE_COLS: DateWiseCol[] = [
  { key: "date", label: "Date", headerClassName: "py-2.5 pl-3 pr-3 font-bold text-slate-500", tdClassName: "py-2.5 pl-3 pr-3 font-medium text-slate-700", get: (r) => r.date, cell: (r) => formatShortDate(r.date) },
  { key: "login_count", label: "Active Agents", headerClassName: "py-2.5 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right text-slate-600", get: (r) => r.login_count, cell: (r) => r.login_count },
  { key: "offered", label: "Offered", headerClassName: "py-2.5 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right text-slate-600", get: (r) => r.offered, cell: (r) => r.offered },
  {
    key: "answered", label: "Call Answered", headerClassName: "border-l border-slate-100 bg-emerald-50/60 py-2.5 pr-3 text-right font-bold text-emerald-700",
    tdClassName: "border-l border-slate-50 bg-emerald-50/20 py-2.5 pr-3 text-right font-bold text-emerald-700", get: (r) => r.answered, cell: (r) => r.answered,
  },
  { key: "ansPct", label: "Answer %", headerClassName: "py-2.5 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right text-slate-600", get: (r) => r.ansPct, cell: (r) => `${r.ansPct}%` },
  { key: "abandoned", label: "Abandoned", headerClassName: "py-2.5 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right text-slate-600", get: (r) => r.abandoned, cell: (r) => r.abandoned },
  {
    key: "abandonPct", label: "AL %", headerClassName: "border-l border-slate-100 bg-emerald-50/60 py-2.5 pr-3 text-right font-bold text-emerald-700",
    tdClassName: "border-l border-slate-50 bg-emerald-50/20 py-2.5 pr-3 text-right font-bold text-emerald-600", get: (r) => r.abandonPct, cell: (r) => `${r.abandonPct}%`,
  },
  {
    key: "slPct", label: "SL %", headerClassName: "border-l border-slate-100 bg-indigo-50/60 py-2.5 pr-3 text-right font-bold text-indigo-700",
    tdClassName: "border-l border-slate-50 bg-indigo-50/20 py-2.5 pr-3 text-right font-bold", get: (r) => r.slPct, cell: (r) => `${r.slPct}%`,
  },
  { key: "acht", label: "Avg Handle", headerClassName: "py-2.5 pr-3 text-right font-semibold", tdClassName: "py-2.5 pr-3 text-right text-slate-600", get: (r) => r.acht, cell: (r) => (r.acht ? secondsToMin(n(r.acht)) : "—") },
];
const INBOUND_DATEWISE_FILTER_COLS: Array<FilterColumn<EnrichedDateRow>> = INBOUND_DATEWISE_COLS.map((c) => ({ key: c.key, get: c.get }));
const inboundDatewiseColGetter = (r: EnrichedDateRow, key: string) => INBOUND_DATEWISE_COLS.find((c) => c.key === key)?.get(r);

type TabKey = "overview" | "agents" | "datewise";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agent-wise" },
  { key: "datewise", label: "Date-wise" },
];

export function GncInboundDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [tab, setTab] = useState<TabKey>("overview");
  const [agentSearch, setAgentSearch] = useState("");

  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = `startDate=${from}&endDate=${to}`;
      const [summaryRes, trendRes, agentsRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; _unavailable?: boolean; data: ProjectSummary | null }>(`/api/inbound/project/gnc?${qs}`),
        hrmsApi.get<{ success: boolean; _unavailable?: boolean; data: TrendRow[] }>(`/api/inbound/project/gnc/trend?${qs}`),
        hrmsApi.get<{ success: boolean; _unavailable?: boolean; data: AgentRow[] }>(`/api/inbound/project/gnc/agents?${qs}`),
      ]);
      setSummary(summaryRes.data);
      setTrend(trendRes.data ?? []);
      setAgents(agentsRes.data ?? []);
      setUnavailable(Boolean(summaryRes._unavailable || trendRes._unavailable));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the GNC inbound dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => a.agentName.toLowerCase().includes(q) || a.agentId.toLowerCase().includes(q));
  }, [agents, agentSearch]);

  const dateWiseRows = useMemo(() => trend.map((r) => {
    const offered = n(r.offered);
    const answered = n(r.answered);
    return {
      ...r,
      offered, answered,
      abandoned: offered - answered,
      ansPct: pct(answered, offered),
      // AL % = Answered / Offered (redefined 2026-09-23) -- identical to ansPct.
      abandonPct: pct(answered, offered),
      slPct: pct(n(r.sl_num), answered),
    };
  }).sort((a, b) => a.date.localeCompare(b.date)), [trend]);

  // Excel-style: every header sorts (click) and filters (funnel icon); filters AND together, then the sort applies.
  const inboundAgentFilters = useColumnFilters(filteredAgents, INBOUND_AGENT_FILTER_COLS);
  const inboundAgentSort = useSortableRows(inboundAgentFilters.filtered, inboundAgentColGetter);

  const inboundDateFilters = useColumnFilters(dateWiseRows, INBOUND_DATEWISE_FILTER_COLS);
  const inboundDateSort = useSortableRows(inboundDateFilters.filtered, inboundDatewiseColGetter);

  /** Export slides for "Download Snap"/"Download Excel" — one per tab. */
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!summary) return [];
    const overview: ExportSlide = {
      title: "Overview",
      kpis: [
        { label: "Total Calls", value: summary.total.toLocaleString("en-IN") },
        { label: "Answered", value: summary.answered.toLocaleString("en-IN") },
        { label: "Answer Rate", value: `${summary.ans_pct}%` },
        { label: "AL %", value: `${summary.abandon_pct}%` },
        { label: "Service Level (SL %)", value: `${summary.sl_pct}%` },
        { label: "Avg Handle Time", value: secondsToMin(summary.avg_handle) },
        { label: "Active Agents", value: String(summary.login_count) },
        { label: "Unique Callers", value: summary.unique_phones.toLocaleString("en-IN") },
      ],
    };
    const agentsSlide: ExportSlide = {
      title: "Agent-wise",
      tables: [{
        title: "Agent-wise Call Performance",
        columns: ["Agent", "Agent ID", "Offered", "Answered", "Answer %", "Service Level", "Avg Handle", "Repeat %"],
        rows: agents.map((a) => [
          a.agentName, a.agentId, a.offered, a.answered, `${pct(a.answered, a.offered)}%`,
          `${a.sl_pct}%`, a.acht ? secondsToMin(a.acht) : "—", `${a.repeat_pct}%`,
        ]),
      }],
    };
    const datewiseSlide: ExportSlide = {
      title: "Date-wise",
      tables: [{
        title: "Date-wise Call Performance",
        columns: ["Date", "Active Agents", "Offered", "Call Answered", "Answer %", "Abandoned", "AL %", "SL %", "Avg Handle"],
        rows: dateWiseRows.map((r) => [
          formatShortDate(r.date), r.login_count, r.offered, r.answered, `${r.ansPct}%`,
          r.abandoned, `${r.abandonPct}%`, `${r.slPct}%`, r.acht ? secondsToMin(n(r.acht)) : "—",
        ]),
      }],
    };
    return [overview, agentsSlide, datewiseSlide];
  }, [summary, agents, dateWiseRows]);

  if (loading && !summary) return <Spinner tone="blue" />;

  if (error) {
    return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={PhoneIncoming} eyebrow="GNC · Process Performance" title="Inbound Call Performance"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-blue-600 via-indigo-600 to-blue-700"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle="GNC — Inbound Call Performance"
          fileBaseName="GNC_Inbound"
          raw={{ dashboard: "gnc_inbound", from, to }}
          subtitle={`${from} to ${to}`}
          slides={exportSlides}
          activeSlideTitle={tab === "overview" ? "Overview" : tab === "agents" ? "Agent-wise" : "Date-wise"}
        />
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          resetLabel="This Month" accentFocus="focus:border-blue-400"
        />
      </div>

      {unavailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          The dialer data source didn't respond for part of this range — figures below may be incomplete. Try again shortly.
        </div>
      )}

      {tab === "overview" && summary && (
      <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard icon={PhoneCall} label="Total Calls" value={summary.total.toLocaleString("en-IN")} tone="blue" />
        <KpiCard icon={PhoneIncoming} label="Answered" value={summary.answered.toLocaleString("en-IN")} tone="emerald" />
        <KpiCard icon={Gauge} label="Answer Rate" value={`${summary.ans_pct}%`} tone="teal" />
        <KpiCard icon={PhoneOff} label="AL %" value={`${summary.abandon_pct}%`} sub="Answered / Offered" tone="emerald" />
        <KpiCard icon={Radio} label="Service Level" value={`${summary.sl_pct}%`} tone="indigo" />
        <KpiCard icon={Timer} label="Avg Handle Time" value={secondsToMin(summary.avg_handle)} tone="violet" />
        <KpiCard icon={Users} label="Active Agents" value={String(summary.login_count)} sub="logged in, range" tone="sky" />
        <KpiCard icon={Clock3} label="Unique Callers" value={summary.unique_phones.toLocaleString("en-IN")} tone="cyan" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
        <SectionCard icon={PhoneCall} title="Daily Call Volume" tone="blue">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={dateWiseRows} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="gncOfferedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="offered" name="Offered" stroke="#2563eb" strokeWidth={2.5} fill="url(#gncOfferedFill)" />
              <Line type="monotone" dataKey="answered" name="Answered" stroke="#059669" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>
        </div>

        <SectionCard icon={Gauge} title="Answered vs Abandoned" tone="indigo">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={[
                  { name: "Answered", value: summary.answered },
                  { name: "Abandoned", value: summary.abandoned },
                ]}
                dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={82} paddingAngle={2}
                label={(p: { name?: string }) => p.name ?? ""}
              >
                <Cell fill="#2563eb" stroke="white" strokeWidth={2} />
                <Cell fill="#f43f5e" stroke="white" strokeWidth={2} />
              </Pie>
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
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
              placeholder="Search agent name or ID..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-blue-400 focus:outline-none"
            />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />
            {filteredAgents.length} of {agents.length} agents
          </span>
        </div>

        <SectionCard icon={Users} title="Agent-wise Call Performance" tone="indigo">
          {inboundAgentFilters.activeCount > 0 && (
            <button type="button" onClick={inboundAgentFilters.clearAll} className="mb-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
              Clear {inboundAgentFilters.activeCount} filter{inboundAgentFilters.activeCount > 1 ? "s" : ""}
            </button>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  {INBOUND_AGENT_COLS.map((c) => (
                    <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={inboundAgentSort.sortKey} sortDir={inboundAgentSort.sortDir} onSort={inboundAgentSort.toggleSort} filters={inboundAgentFilters}
                      className={c.headerClassName} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {inboundAgentSort.sorted.map((a, i) => (
                  <tr key={a.agentId} className={`border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/40 ${i % 2 === 1 ? "bg-indigo-50/20" : "bg-white"}`}>
                    {INBOUND_AGENT_COLS.map((c) => (
                      <td key={c.key} className={`${c.tdClassName} ${c.key === "sl_pct" ? (a.sl_pct >= 70 ? "text-emerald-600" : a.sl_pct >= 40 ? "text-amber-600" : "text-red-600") : ""}`}>{c.cell(a)}</td>
                    ))}
                  </tr>
                ))}
                {filteredAgents.length > 0 && inboundAgentSort.sorted.length === 0 && (
                  <tr><td colSpan={INBOUND_AGENT_COLS.length} className="py-6 text-center text-slate-400">No agents match the filters.</td></tr>
                )}
                {filteredAgents.length === 0 && (
                  <tr><td colSpan={INBOUND_AGENT_COLS.length} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
      )}

      {tab === "datewise" && (
      <div className="space-y-4">
        <SectionCard icon={Gauge} title="Date-wise Call Answered, AL % & SL % Trend" tone="blue">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={dateWiseRows} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="gncAnsweredFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#059669" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
              <Tooltip
                labelFormatter={(v: unknown) => formatShortDate(String(v))}
                formatter={(value: number, name: string) => (name === "Call Answered" ? value : `${value}%`)}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area yAxisId="left" type="monotone" dataKey="answered" name="Call Answered" stroke="#059669" strokeWidth={2.5} fill="url(#gncAnsweredFill)" />
              <Line yAxisId="right" type="monotone" dataKey="slPct" name="SL %" stroke="#6366f1" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="abandonPct" name="AL %" stroke="#f43f5e" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard icon={PhoneCall} title="Date-wise Call Performance" tone="blue">
          {inboundDateFilters.activeCount > 0 && (
            <button type="button" onClick={inboundDateFilters.clearAll} className="mb-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
              Clear {inboundDateFilters.activeCount} filter{inboundDateFilters.activeCount > 1 ? "s" : ""}
            </button>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-400">
                  {INBOUND_DATEWISE_COLS.map((c) => (
                    <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={inboundDateSort.sortKey} sortDir={inboundDateSort.sortDir} onSort={inboundDateSort.toggleSort} filters={inboundDateFilters}
                      className={c.headerClassName} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {inboundDateSort.sorted.map((r, i) => (
                  <tr key={r.date} className={`border-b border-slate-50 transition-colors last:border-0 hover:bg-blue-50/40 ${i % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}>
                    {INBOUND_DATEWISE_COLS.map((c) => (
                      <td key={c.key} className={`${c.tdClassName} ${c.key === "slPct" ? (r.slPct >= 70 ? "text-emerald-600" : r.slPct >= 40 ? "text-amber-600" : "text-red-600") : ""}`}>{c.cell(r)}</td>
                    ))}
                  </tr>
                ))}
                {dateWiseRows.length > 0 && inboundDateSort.sorted.length === 0 && (
                  <tr><td colSpan={INBOUND_DATEWISE_COLS.length} className="py-6 text-center text-slate-400">No rows match the filters.</td></tr>
                )}
                {dateWiseRows.length === 0 && (
                  <tr><td colSpan={INBOUND_DATEWISE_COLS.length} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
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
