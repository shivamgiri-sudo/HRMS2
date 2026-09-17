import { useMemo, useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  MessageSquare, Gauge, Clock3, Repeat, Users, Search, ListFilter, Layers,
} from "lucide-react";
import { Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, formatShortDate, last7DaysRange } from "./DashboardKit";

/**
 * Bellavita's real Chat performance dashboard -- live aggregates over
 * db_masmis.bb_chat (189,018 rows, confirmed live 2026-09-17), via GET
 * /api/process-performance/bellavita-chat-dashboard. See the backend
 * service's own header comment for why "Resolved" comes from ticket_status
 * rather than the misleadingly-named is_resolved column (which holds
 * decimal numbers, not a boolean, on live data), and why there's no CSAT
 * KPI (bb_chat has no csat_rating column at all -- confirmed via SHOW
 * COLUMNS, unlike its Neemans sibling table).
 */

interface Headline {
  totalTickets: number; resolvedPct: number; repeatPct: number;
  avgFrtMin: number; avgResolutionMin: number; avgWaitTimeMin: number;
  activeAgents: number; activeTls: number;
}
interface TrendRow { date: string; tickets: number; resolvedPct: number }
interface DispositionRow { disposition: string; count: number; pct: number }
interface TlRow { tlName: string; tickets: number; resolvedPct: number; repeatPct: number }
interface AgentRow { agent: string; empId: string; tickets: number; resolvedPct: number; avgWaitTimeMin: number }
interface DashboardData {
  headline: Headline; from: string; to: string;
  dateWiseTrend: TrendRow[]; dispositionBreakdown: DispositionRow[]; byTl: TlRow[]; agents: AgentRow[];
}

const DISPOSITION_COLORS = ["#e11d48", "#f59e0b", "#0ea5e9", "#8b5cf6", "#059669", "#64748b", "#ec4899"];

type TabKey = "overview" | "tl" | "agents";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "tl", label: "TL-wise" },
  { key: "agents", label: "Agent-wise" },
];

export function BellavitaChatDashboard() {
  const defaultRange = last7DaysRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [agentSearch, setAgentSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/bellavita-chat-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Bellavita Chat dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agents ?? [];
    const q = agentSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q));
  }, [data, agentSearch]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-5">
      <DashboardHero
        icon={MessageSquare} eyebrow="Bellavita · Process Performance" title="Chat Performance"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-rose-500 via-pink-500 to-rose-600"
      />

      <DateRangeToolbar
        from={from} to={to} onFrom={setFrom} onTo={setTo}
        onReset={() => { const r = last7DaysRange(); setFrom(r.from); setTo(r.to); }}
        resetLabel="Last 7 Days" accentFocus="focus:border-rose-400"
      />

      {tab === "overview" && (
      <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard icon={MessageSquare} label="Total Tickets" value={headline.totalTickets.toLocaleString("en-IN")} tone="rose" />
        <KpiCard icon={Gauge} label="Resolved %" value={`${headline.resolvedPct}%`} tone="emerald" />
        <KpiCard icon={Repeat} label="Repeat %" value={`${headline.repeatPct}%`} tone="violet" />
        <KpiCard icon={Clock3} label="Avg FRT" value={`${headline.avgFrtMin}m`} tone="sky" />
        <KpiCard icon={Clock3} label="Avg Resolution" value={`${headline.avgResolutionMin}m`} tone="indigo" />
        <KpiCard icon={Clock3} label="Avg Wait Time" value={`${headline.avgWaitTimeMin}m`} tone="amber" />
        <KpiCard icon={Users} label="Active Agents" value={String(headline.activeAgents)} tone="teal" />
        <KpiCard icon={Users} label="Active TLs" value={String(headline.activeTls)} tone="cyan" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
        <SectionCard icon={MessageSquare} title="Date-wise Tickets" tone="rose">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="bbChatFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e11d48" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#e11d48" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="tickets" name="Tickets" stroke="#e11d48" strokeWidth={2.5} fill="url(#bbChatFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>
        </div>
        <SectionCard icon={Layers} title="Disposition Breakdown" tone="violet">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.dispositionBreakdown} dataKey="count" nameKey="disposition" cx="50%" cy="50%" innerRadius={44} outerRadius={82} paddingAngle={2} label={(p: { disposition?: string }) => p.disposition ?? ""}>
                {data.dispositionBreakdown.map((entry, i) => (
                  <Cell key={entry.disposition} fill={DISPOSITION_COLORS[i % DISPOSITION_COLORS.length]} stroke="white" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
      </>
      )}

      {tab === "tl" && (
      <SectionCard icon={Users} title="TL-wise Summary" tone="rose">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">TL Name</th>
                <th className="py-2 pr-3 text-right font-semibold">Tickets</th>
                <th className="py-2 pr-3 text-right font-semibold">Resolved %</th>
                <th className="py-2 pr-0 text-right font-semibold">Repeat %</th>
              </tr>
            </thead>
            <tbody>
              {data.byTl.map((r) => (
                <tr key={r.tlName} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-rose-50/40">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{r.tlName}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.tickets.toLocaleString("en-IN")}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{r.resolvedPct}%</td>
                  <td className="py-2.5 pr-0 text-right text-slate-600">{r.repeatPct}%</td>
                </tr>
              ))}
              {data.byTl.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
      )}

      {tab === "agents" && (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Search agent name or ID..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-rose-400 focus:outline-none" />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />{filteredAgents.length} of {data.agents.length} agents
          </span>
        </div>
        <SectionCard
          icon={Users} title="Agent-wise Chat Performance" tone="rose"
          footnote="Some rows show 'Unassigned' — agent_name/emp_id is NULL on part of the uploaded data (visible on the most recent upload batches), which this dashboard reflects rather than guesses."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 text-right font-semibold">Tickets</th>
                  <th className="py-2 pr-3 text-right font-semibold">Resolved %</th>
                  <th className="py-2 pr-0 text-right font-semibold">Avg Wait Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr key={`${a.empId}-${a.agent}`} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-rose-50/40">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-700">{a.agent}</div>
                      <div className="text-[11px] text-slate-400">{a.empId || "—"}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.tickets.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.resolvedPct}%</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{a.avgWaitTimeMin ? `${a.avgWaitTimeMin}m` : "—"}</td>
                  </tr>
                ))}
                {filteredAgents.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
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
