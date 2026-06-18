import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Shield, TrendingUp, Users, AlertTriangle, Target,
  BarChart2, RefreshCcw, CheckCircle2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

const scoreBadge = (s: number) => {
  if (s >= 80) return "bg-emerald-100 text-emerald-700";
  if (s >= 70) return "bg-yellow-100 text-yellow-700";
  if (s >= 60) return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
};

const shrinkageColor = (p: number) =>
  p < 15 ? "text-emerald-600 font-bold" : p <= 25 ? "text-yellow-600 font-bold" : "text-red-600 font-bold";

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />
    </div>
  );
}

function ErrBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {msg}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary { total_calls: number; audited_calls: number; avg_quality_score: number; calls_above_80: number; calls_below_50: number; unique_agents: number; unique_clients: number; fraud_flags: number; fail_rate_call_open: number; fail_rate_professionalism: number; fail_rate_active_listening: number; fail_rate_call_closure: number; fail_rate_accuracy: number; scope_label?: string; }
interface TrendPoint { date: string; total_calls: number; avg_score: number; above_80: number; below_50: number; }
interface AgentRow { agent_name: string; total_calls: number; avg_score: number; calls_above_80: number; calls_below_50: number; band: string; }
interface ClientRow { client_id: string; total_calls: number; avg_score: number; agent_count: number; }
interface AprRow { process: string; agents: number; avg_calls: number; avg_aht: number; avg_shrinkage_pct: number; avg_bio_mins: number; avg_lunch_mins: number; avg_qa_mins: number; avg_training_mins: number; }
interface SalesSummary { total_calls: number; sales_done: number; competitor_mentions: number; objection_calls: number; }
interface Competitor { CompetitorName: string; mentions: number; }
interface FraudSignals { data_theft: number; financial_fraud: number; collusion: number; escalation_failure: number; unprofessional: number; system_manipulation: number; }
interface SalesFunnel { total_calls: number; opening_done: number; offer_made: number; objection_handled: number; sale_done: number; }
interface RejectionFunnel { total_calls: number; not_interested: number; objection_raised: number; rejected_after_offer: number; offering_rejected: number; opening_rejected: number; }
interface RejectionReason { reason: string; count: number; }

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NativeQualityDashboard() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [clientId, setClientId] = useState("");
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [refresh, setRefresh] = useState(0);

  const qs = `from=${from}&to=${to}&client_id=${clientId}`;
  const key = [from, to, clientId, granularity, refresh];

  const summaryQ  = useQuery({ queryKey: ["qd-summary",  ...key], queryFn: () => hrmsApi.get<{ summary: Summary }>(`/api/quality-dashboard/summary?${qs}`).then(r => r.summary) });
  const trendQ    = useQuery({ queryKey: ["qd-trend",    ...key], queryFn: () => hrmsApi.get<{ trend: TrendPoint[] }>(`/api/quality-dashboard/trend?from=${from}&to=${to}&granularity=${granularity}`).then(r => r.trend) });
  const agentsQ   = useQuery({ queryKey: ["qd-agents",   ...key], queryFn: () => hrmsApi.get<{ agents: AgentRow[] }>(`/api/quality-dashboard/agents?${qs}&limit=20`).then(r => r.agents) });
  const clientsQ  = useQuery({ queryKey: ["qd-clients",  ...key], queryFn: () => hrmsApi.get<{ clients: ClientRow[] }>(`/api/quality-dashboard/clients?from=${from}&to=${to}`).then(r => r.clients) });
  const aprQ      = useQuery({ queryKey: ["qd-apr",      ...key], queryFn: () => hrmsApi.get<{ processes: AprRow[] }>(`/api/quality-dashboard/apr-summary?from=${from}&to=${to}`).then(r => r.processes) });
  const salesQ    = useQuery({ queryKey: ["qd-sales",    ...key], queryFn: () => hrmsApi.get<{ summary: SalesSummary; top_competitors: Competitor[] }>(`/api/quality-dashboard/sales-intelligence?${qs}`).then(r => r) });
  const fraudQ    = useQuery({ queryKey: ["qd-fraud",    ...key], queryFn: () => hrmsApi.get<{ fraud_signals: FraudSignals }>(`/api/quality-dashboard/fraud-signals?from=${from}&to=${to}`).then(r => r.fraud_signals) });
  const funnelQ   = useQuery({ queryKey: ["qd-funnel",   ...key], queryFn: () => hrmsApi.get<{ sales_funnel: SalesFunnel; rejection_funnel: RejectionFunnel; top_rejection_reasons: RejectionReason[] }>(`/api/quality-dashboard/sales-funnel?${qs}`).then(r => r) });

  const s = summaryQ.data;
  const scoreColor = !s ? "text-slate-800" : s.avg_quality_score >= 80 ? "text-emerald-600" : s.avg_quality_score >= 70 ? "text-yellow-600" : "text-red-600";
  const pct = (n: number) => s && s.total_calls > 0 ? `${((n / s.total_calls) * 100).toFixed(1)}%` : "–";

  // ─── Filter Bar ─────────────────────────────────────────────────────────────

  const FilterBar = (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">From</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">To</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">Client</label>
        <select value={clientId} onChange={e => setClientId(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
          <option value="">All Clients</option>
          {(clientsQ.data ?? []).map(c => <option key={c.client_id} value={c.client_id}>{c.client_id}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">Granularity</label>
        <div className="flex gap-1">
          {(["day", "week"] as const).map(g => (
            <button key={g} onClick={() => setGranularity(g)} className={`cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold capitalize transition-colors ${granularity === g ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{g}</button>
          ))}
        </div>
      </div>
      <button onClick={() => setRefresh(r => r + 1)} className="ml-auto inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer">
        <RefreshCcw className="h-4 w-4" /> Refresh
      </button>
    </div>
  );

  // ─── Summary Cards ───────────────────────────────────────────────────────────

  const SummaryCards = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {[
        { label: "Total Calls", value: s?.total_calls ?? "–", sub: undefined, tone: "bg-blue-50 text-blue-600", icon: <BarChart2 className="h-5 w-5" /> },
        { label: "Avg Quality Score", value: s ? `${s.avg_quality_score}%` : "–", sub: undefined, tone: "bg-slate-50 text-slate-700", icon: <Target className="h-5 w-5" />, extraCls: scoreColor },
        { label: "Above 80%", value: s?.calls_above_80 ?? "–", sub: s ? pct(s.calls_above_80) : undefined, tone: "bg-emerald-50 text-emerald-600", icon: <TrendingUp className="h-5 w-5" /> },
        { label: "Below 50%", value: s?.calls_below_50 ?? "–", sub: s ? pct(s.calls_below_50) : undefined, tone: "bg-red-50 text-red-600", icon: <AlertTriangle className="h-5 w-5" /> },
        { label: "Agents Monitored", value: s?.unique_agents ?? "–", sub: undefined, tone: "bg-purple-50 text-purple-600", icon: <Users className="h-5 w-5" /> },
        { label: "Fraud Flags", value: s?.fraud_flags ?? "–", sub: undefined, tone: s && s.fraud_flags > 0 ? "bg-orange-50 text-orange-600" : "bg-slate-50 text-slate-500", icon: <Shield className="h-5 w-5" /> },
      ].map(({ label, value, sub, tone, icon, extraCls }) => (
        <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className={`mt-1.5 text-2xl font-black tracking-tight ${extraCls ?? "text-slate-900"}`}>{value}</p>
              {sub && <p className="mt-0.5 text-xs text-slate-400">{sub} of total</p>}
            </div>
            <div className={`rounded-xl p-2.5 ${tone}`}>{icon}</div>
          </div>
        </div>
      ))}
    </div>
  );

  // ─── Fail Rates ───────────────────────────────────────────────────────────────

  const failRates = s ? [
    { label: "Call Opening",    val: s.fail_rate_call_open },
    { label: "Professionalism", val: s.fail_rate_professionalism },
    { label: "Active Listening",val: s.fail_rate_active_listening },
    { label: "Call Closure",    val: s.fail_rate_call_closure },
    { label: "Accuracy",        val: s.fail_rate_accuracy },
  ] : [];

  const FailRates = (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="mb-4 font-black text-slate-900">Parameter Fail Rates</h2>
      {summaryQ.isLoading ? <Spinner /> : summaryQ.isError ? <ErrBanner msg="Failed to load fail rates" /> : (
        <div className="space-y-3">
          {failRates.map(({ label, val }) => (
            <div key={label}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-semibold text-slate-700">{label}</span>
                <span className="font-bold text-red-600">{val}% fail rate</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-100">
                <div className="h-2.5 rounded-full bg-red-400 transition-all" style={{ width: `${Math.min(val, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ─── Fraud Panel ──────────────────────────────────────────────────────────────

  const fraudLabels: [keyof FraudSignals, string][] = [
    ["data_theft", "Data Theft"], ["financial_fraud", "Financial Fraud"],
    ["collusion", "Collusion"], ["escalation_failure", "Escalation Failure"],
    ["unprofessional", "Unprofessional"], ["system_manipulation", "System Manipulation"],
  ];

  const FraudPanel = (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="mb-4 font-black text-slate-900">Fraud Risk Signals</h2>
      {fraudQ.isLoading ? <Spinner /> : fraudQ.isError ? <ErrBanner msg="Failed to load fraud signals" /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {fraudLabels.map(([key, label]) => {
            const count = fraudQ.data?.[key] ?? 0;
            return (
              <div key={key} className={`flex items-center gap-3 rounded-xl p-3 ${count > 0 ? "bg-red-50 border border-red-200" : "bg-emerald-50 border border-emerald-200"}`}>
                {count > 0
                  ? <AlertTriangle className="h-5 w-5 flex-shrink-0 text-red-500" />
                  : <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-500" />}
                <div>
                  <p className={`text-xl font-black ${count > 0 ? "text-red-700" : "text-emerald-700"}`}>{count}</p>
                  <p className="text-xs font-semibold text-slate-600">{label}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Call Audit Intelligence</p>
            <h1 className="mt-1 text-3xl font-black text-slate-950">Quality Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Real-time call quality metrics, agent performance, and fraud risk signals.</p>
          </div>
          {summaryQ.data?.scope_label && summaryQ.data.scope_label !== "All" && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <Users className="h-4 w-4 text-amber-600" />
              <span className="text-xs font-bold text-amber-700">Scoped view: {summaryQ.data.scope_label}</span>
            </div>
          )}
        </div>

        {FilterBar}

        {summaryQ.isError && <ErrBanner msg={String(summaryQ.error)} />}

        {/* Summary Cards */}
        {summaryQ.isLoading ? <Spinner /> : SummaryCards}

        {/* Trend Chart */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-black text-slate-900">Quality Score Trend</h2>
          {trendQ.isLoading ? <Spinner /> : trendQ.isError ? <ErrBanner msg="Failed to load trend" /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendQ.data ?? []} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => [`${v}%`, "Avg Score"]} />
                <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="6 3" label={{ value: "80%", position: "right", fontSize: 11, fill: "#22c55e" }} />
                <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="6 3" label={{ value: "50%", position: "right", fontSize: 11, fill: "#ef4444" }} />
                <Area type="monotone" dataKey="avg_score" stroke="#3b82f6" strokeWidth={2} fill="url(#scoreGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Agents + Clients row */}
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Top Agents */}
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="font-black text-slate-900">Top Agents</h2>
              <p className="text-xs text-slate-500">Ranked by avg quality score</p>
            </div>
            {agentsQ.isLoading ? <Spinner /> : agentsQ.isError ? <div className="p-4"><ErrBanner msg="Failed to load agents" /></div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>{["#", "Agent", "Calls", "Avg Score", "Band"].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(agentsQ.data ?? []).map((a, i) => (
                      <tr key={a.agent_name} className="border-t hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3 text-slate-400 font-bold">{i + 1}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{a.agent_name}</td>
                        <td className="px-4 py-3 text-slate-600">{a.total_calls}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${scoreBadge(a.avg_score)}`}>{a.avg_score}%</span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{a.band}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Client Performance */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-black text-slate-900">Client Performance</h2>
            {clientsQ.isLoading ? <Spinner /> : clientsQ.isError ? <ErrBanner msg="Failed to load clients" /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={clientsQ.data ?? []} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="client_id" type="category" tick={{ fontSize: 11 }} tickLine={false} width={90} />
                  <Tooltip formatter={(v: number) => [`${v}%`, "Avg Score"]} />
                  <Bar dataKey="avg_score" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Fail Rates */}
        {FailRates}

        {/* APR / Shrinkage */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-black text-slate-900">APR / Shrinkage Decomposition</h2>
            <p className="text-xs text-slate-500">Average handling time and shrinkage breakdown per process</p>
          </div>
          {aprQ.isLoading ? <Spinner /> : aprQ.isError ? <div className="p-4"><ErrBanner msg="Failed to load APR data" /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>{["Process", "Agents", "Avg Calls", "Avg AHT", "Shrinkage %", "Bio", "Lunch", "QA", "Training"].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(aprQ.data ?? []).map(row => (
                    <tr key={row.process} className="border-t hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-800">{row.process}</td>
                      <td className="px-4 py-3 text-slate-600">{row.agents}</td>
                      <td className="px-4 py-3 text-slate-600">{row.avg_calls}</td>
                      <td className="px-4 py-3 text-slate-600">{row.avg_aht}</td>
                      <td className={`px-4 py-3 ${shrinkageColor(row.avg_shrinkage_pct)}`}>{row.avg_shrinkage_pct}%</td>
                      <td className="px-4 py-3 text-slate-500">{row.avg_bio_mins}m</td>
                      <td className="px-4 py-3 text-slate-500">{row.avg_lunch_mins}m</td>
                      <td className="px-4 py-3 text-slate-500">{row.avg_qa_mins}m</td>
                      <td className="px-4 py-3 text-slate-500">{row.avg_training_mins}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sales Intelligence */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-black text-slate-900">Sales Intelligence</h2>
            {salesQ.isLoading ? <Spinner /> : salesQ.isError ? <ErrBanner msg="Failed to load sales data" /> : (() => {
              const ss = salesQ.data?.summary;
              const convPct = ss && ss.total_calls > 0 ? ((ss.sales_done / ss.total_calls) * 100).toFixed(1) : "0";
              return (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Total Calls", value: ss?.total_calls ?? 0, tone: "bg-blue-50" },
                    { label: "Sales Done", value: ss?.sales_done ?? 0, sub: `${convPct}% conversion`, tone: "bg-emerald-50" },
                    { label: "Competitor Mentions", value: ss?.competitor_mentions ?? 0, tone: "bg-orange-50" },
                    { label: "Objection Calls", value: ss?.objection_calls ?? 0, tone: "bg-yellow-50" },
                  ].map(({ label, value, sub, tone }) => (
                    <div key={label} className={`rounded-xl p-3 ${tone}`}>
                      <p className="text-xs font-semibold text-slate-500">{label}</p>
                      <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
                      {sub && <p className="text-xs text-slate-500">{sub}</p>}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-black text-slate-900">Top Competitors</h2>
            {salesQ.isLoading ? <Spinner /> : salesQ.isError ? <ErrBanner msg="Failed to load competitors" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={salesQ.data?.top_competitors ?? []} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="CompetitorName" type="category" tick={{ fontSize: 11 }} tickLine={false} width={100} />
                  <Tooltip />
                  <Bar dataKey="mentions" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Conversion & Rejection Funnels */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-black text-slate-900">Conversion &amp; Rejection Funnels</h2>
          <p className="mb-5 text-xs text-slate-500">Customer journey from first contact to sale or rejection</p>
          {funnelQ.isLoading ? <Spinner /> : funnelQ.isError ? <ErrBanner msg="Failed to load funnel data" /> : (() => {
            const sf = funnelQ.data?.sales_funnel;
            const rf = funnelQ.data?.rejection_funnel;
            const reasons = funnelQ.data?.top_rejection_reasons ?? [];
            const sfTotal = sf?.total_calls || 1;
            const rfTotal = rf?.total_calls || 1;

            const salesStages = sf ? [
              { label: "Total Calls",        count: sf.total_calls,        pct: 100,                                       color: "bg-indigo-500" },
              { label: "Opening Done",       count: sf.opening_done,       pct: (sf.opening_done / sfTotal) * 100,         color: "bg-blue-500" },
              { label: "Offer Made",         count: sf.offer_made,         pct: (sf.offer_made / sfTotal) * 100,           color: "bg-cyan-500" },
              { label: "Objection Handled",  count: sf.objection_handled,  pct: (sf.objection_handled / sfTotal) * 100,    color: "bg-teal-500" },
              { label: "Sale Done",          count: sf.sale_done,          pct: (sf.sale_done / sfTotal) * 100,            color: "bg-emerald-500" },
            ] : [];

            const rejectStages = rf ? [
              { label: "Total Calls",         count: rf.total_calls,          pct: 100,                                              color: "bg-slate-400" },
              { label: "Not Interested",      count: rf.not_interested,       pct: (rf.not_interested / rfTotal) * 100,              color: "bg-orange-400" },
              { label: "Objection Raised",    count: rf.objection_raised,     pct: (rf.objection_raised / rfTotal) * 100,            color: "bg-amber-500" },
              { label: "Offering Rejected",   count: rf.offering_rejected,    pct: (rf.offering_rejected / rfTotal) * 100,           color: "bg-red-400" },
              { label: "Opening Rejected",    count: rf.opening_rejected,     pct: (rf.opening_rejected / rfTotal) * 100,            color: "bg-red-600" },
            ] : [];

            return (
              <div className="space-y-6">
                <div className="grid gap-8 lg:grid-cols-2">
                  {/* Sales Funnel */}
                  <div>
                    <h3 className="mb-4 text-sm font-black text-emerald-700 uppercase tracking-wide">Sales Transition Funnel</h3>
                    <div className="space-y-2">
                      {salesStages.map((stage, i) => (
                        <div key={stage.label}>
                          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                            <span>{stage.label}</span>
                            <span className="text-slate-400">{stage.count.toLocaleString()} &middot; {stage.pct.toFixed(1)}%</span>
                          </div>
                          <div className="flex h-8 items-center justify-center">
                            <div className={`h-full rounded-md ${stage.color} transition-all`} style={{ width: `${Math.max(stage.pct, 2)}%`, minWidth: "2%" }} />
                          </div>
                          {i < salesStages.length - 1 && (
                            <div className="flex justify-center py-0.5 text-xs text-slate-300">▼</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Rejection Funnel */}
                  <div>
                    <h3 className="mb-4 text-sm font-black text-red-700 uppercase tracking-wide">Rejection Transition Funnel</h3>
                    <div className="space-y-2">
                      {rejectStages.map((stage, i) => (
                        <div key={stage.label}>
                          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                            <span>{stage.label}</span>
                            <span className="text-slate-400">{stage.count.toLocaleString()} &middot; {stage.pct.toFixed(1)}%</span>
                          </div>
                          <div className="flex h-8 items-center justify-center">
                            <div className={`h-full rounded-md ${stage.color} transition-all`} style={{ width: `${Math.max(stage.pct, 2)}%`, minWidth: "2%" }} />
                          </div>
                          {i < rejectStages.length - 1 && (
                            <div className="flex justify-center py-0.5 text-xs text-slate-300">▼</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Top Rejection Reasons */}
                {reasons.length > 0 && (
                  <div>
                    <h3 className="mb-3 text-sm font-black text-slate-700 uppercase tracking-wide">Top Rejection Reasons</h3>
                    <ResponsiveContainer width="100%" height={Math.max(reasons.length * 36, 120)}>
                      <BarChart data={reasons} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis dataKey="reason" type="category" tick={{ fontSize: 11 }} tickLine={false} width={160} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Fraud Panel */}
        {FraudPanel}
      </div>
    </DashboardLayout>
  );
}
