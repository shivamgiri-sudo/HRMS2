import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  PhoneIncoming, PhoneCall, PhoneOff, Gauge, Timer, Users, Search, ListFilter, Radio, Clock3,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar,
  last7DaysRange, formatShortDate,
} from "./DashboardKit";

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

type TabKey = "overview" | "agents" | "datewise";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agent-wise" },
  { key: "datewise", label: "Date-wise" },
];

export function GncInboundDashboard() {
  const defaultRange = last7DaysRange();
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
      abandonPct: pct(offered - answered, offered),
      slPct: pct(n(r.sl_num), answered),
    };
  }).sort((a, b) => a.date.localeCompare(b.date)), [trend]);

  if (loading && !summary) return <Spinner tone="blue" />;

  if (error) {
    return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-5">
      <DashboardHero
        icon={PhoneIncoming} eyebrow="GNC · Process Performance" title="Inbound Call Performance"
        tabs={TABS} activeTab={tab} onTabChange={(key) => setTab(key as TabKey)}
        gradient="from-blue-600 via-indigo-600 to-blue-700"
      />

      <DateRangeToolbar
        from={from} to={to} onFrom={setFrom} onTo={setTo}
        onReset={() => { const r = last7DaysRange(); setFrom(r.from); setTo(r.to); }}
        resetLabel="Last 7 Days" accentFocus="focus:border-blue-400"
      />

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
        <KpiCard icon={PhoneOff} label="Abandon Rate" value={`${summary.abandon_pct}%`} tone="rose" />
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 text-right font-semibold">Offered</th>
                  <th className="py-2 pr-3 text-right font-semibold">Answered</th>
                  <th className="py-2 pr-3 text-right font-semibold">Answer %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Service Level</th>
                  <th className="py-2 pr-3 text-right font-semibold">Avg Handle</th>
                  <th className="py-2 pr-0 text-right font-semibold">Repeat %</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr key={a.agentId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/40">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-700">{a.agentName}</div>
                      <div className="text-[11px] text-slate-400">{a.agentId}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.offered}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.answered}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{pct(a.answered, a.offered)}%</td>
                    <td className={`py-2.5 pr-3 text-right font-semibold ${a.sl_pct >= 70 ? "text-emerald-600" : a.sl_pct >= 40 ? "text-amber-600" : "text-red-600"}`}>{a.sl_pct}%</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.acht ? secondsToMin(a.acht) : "—"}</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{a.repeat_pct}%</td>
                  </tr>
                ))}
                {filteredAgents.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
      )}

      {tab === "datewise" && (
      <SectionCard icon={PhoneCall} title="Date-wise Call Performance" tone="blue">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 pr-3 text-right font-semibold">Active Agents</th>
                <th className="py-2 pr-3 text-right font-semibold">Offered</th>
                <th className="py-2 pr-3 text-right font-semibold">Answered</th>
                <th className="py-2 pr-3 text-right font-semibold">Answer %</th>
                <th className="py-2 pr-3 text-right font-semibold">Abandoned</th>
                <th className="py-2 pr-3 text-right font-semibold">Abandon %</th>
                <th className="py-2 pr-3 text-right font-semibold">Service Level</th>
                <th className="py-2 pr-0 text-right font-semibold">Avg Handle</th>
              </tr>
            </thead>
            <tbody>
              {dateWiseRows.map((r) => (
                <tr key={r.date} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-blue-50/40">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{formatShortDate(r.date)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.login_count}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.offered}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.answered}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.ansPct}%</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.abandoned}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.abandonPct}%</td>
                  <td className={`py-2.5 pr-3 text-right font-semibold ${r.slPct >= 70 ? "text-emerald-600" : r.slPct >= 40 ? "text-amber-600" : "text-red-600"}`}>{r.slPct}%</td>
                  <td className="py-2.5 pr-0 text-right text-slate-600">{r.acht ? secondsToMin(n(r.acht)) : "—"}</td>
                </tr>
              ))}
              {dateWiseRows.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
      )}
    </div>
  );
}
