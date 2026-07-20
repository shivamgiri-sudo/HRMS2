import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Phone, TrendingUp, TrendingDown, Users, AlertTriangle, Shield,
  Award, Download, RefreshCcw, ChevronDown, ChevronUp, Activity,
  Target, Zap, BarChart2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { InterventionPanel } from "@/components/dashboard/InterventionPanel";
import type { InterventionFlag } from "@/components/dashboard/InterventionPanel";

// ── Types ─────────────────────────────────────────────────────────────────────
interface KPIData {
  inbound?: { total: number; avg_quality: number; fatal_score: number; avg_cx: number; avg_compliance: number };
  outbound?: { total: number; conversion: number; ob_quality: number };
  active_agents?: number;
}
interface TrendPoint { period: string; quality: number; calls: number; fatal: number }
interface AgentRow { agent: string; calls: number; quality: number; compliance: number; fatal_rate: number }
interface ClientRow { client: string; calls: number; avg_quality?: number; conversion?: number }
interface FunnelData { total: number; offered: number; objection: number; upsell: number; sold: number }
interface OBSummary { total: number; sales: number; conversion: number; avg_quality: number; avg_duration: number }
interface OIExec { total: number; opening_good: number; opening_score: number; context_set: number; context_score: number; sales: number }
interface CIExec { total: number; positive: number; negative: number; satisfaction_pct: number; conv_pct: number; trust_score: number }
interface AIInsight { type: string; title: string; what: string; why: string; impact: string; action: string }

const n = (v: unknown) => Number(v) || 0;
const pct = (v: unknown) => `${n(v).toFixed(1)}%`;

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

type Tab = "overview" | "opening" | "customer" | "outbound" | "export";

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
    </div>
  );
}

function StatCard({
  label, value, sub, icon: Icon, color = "blue", trend,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color?: string; trend?: "up" | "down";
}) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600", green: "bg-emerald-50 text-emerald-600",
    red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-600",
    purple: "bg-purple-50 text-purple-600",
  };
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className={`rounded-xl p-2 ${colors[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        {trend && (
          <span className={`text-xs font-semibold ${trend === "up" ? "text-emerald-600" : "text-red-500"}`}>
            {trend === "up" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function NativeCallMasterDashboard() {
  const { hasAnyRole } = useWorkforceAccess();
  const canAccess = hasAnyRole("super_admin","admin","ceo","manager","process_manager","operations_manager","qa","quality_analyst");

  const [tab, setTab] = useState<Tab>("overview");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [lob, setLob] = useState<"All" | "Inbound" | "Outbound">("All");
  const [refresh, setRefresh] = useState(0);

  const [kpis, setKpis]           = useState<KPIData | null>(null);
  const [trend, setTrend]         = useState<TrendPoint[]>([]);
  const [topAgents, setTopAgents] = useState<AgentRow[]>([]);
  const [clients, setClients]     = useState<ClientRow[]>([]);
  const [funnel, setFunnel]       = useState<FunnelData | null>(null);
  const [obSummary, setObSummary] = useState<OBSummary | null>(null);
  const [oiExec, setOiExec]       = useState<OIExec | null>(null);
  const [ciExec, setCiExec]       = useState<CIExec | null>(null);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading]     = useState(true);
  const [flags, setFlags]         = useState<InterventionFlag[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);

  const qs = `startDate=${from}&endDate=${to}&lob=${lob}`;

  const load = useCallback(async () => {
    setLoading(true);
    setSourceUnavailable(false);
    try {
      const [kpiRes, trendRes, agentsRes, clientRes] = await Promise.all([
        hrmsApi.get<{ data: KPIData; _unavailable?: boolean }>(`/api/call-master/kpis?${qs}`),
        hrmsApi.get<{ data: TrendPoint[]; _unavailable?: boolean }>(`/api/call-master/quality-trend?${qs}&granularity=daily`),
        hrmsApi.get<{ data: AgentRow[] }>(`/api/call-master/top-agents?${qs}&limit=10`),
        hrmsApi.get<{ data: ClientRow[] }>(`/api/call-master/calls-by-client?${qs}`),
      ]);
      if ((kpiRes as any)._unavailable) setSourceUnavailable(true);
      setKpis(kpiRes.data);
      setTrend(trendRes.data ?? []);
      setTopAgents(agentsRes.data ?? []);
      setClients(clientRes.data ?? []);

      // Secondary loads
      const [funnelRes, obRes, oiRes, ciRes, insightsRes] = await Promise.all([
        hrmsApi.get<{ data: FunnelData }>(`/api/call-master/sales-funnel?${qs}`),
        hrmsApi.get<{ data: OBSummary }>(`/api/call-master/outbound/summary?${qs}`),
        hrmsApi.get<{ data: OIExec }>(`/api/call-master/opening-intelligence/executive-summary?${qs}`),
        hrmsApi.get<{ data: CIExec }>(`/api/call-master/customer-intelligence/executive-summary?${qs}`),
        hrmsApi.get<{ data: AIInsight[] }>(`/api/call-master/opening-intelligence/ai-insights?${qs}`),
      ]);
      setFunnel(funnelRes.data);
      setObSummary(obRes.data);
      setOiExec(oiRes.data);
      setCiExec(ciRes.data);
      setAiInsights(insightsRes.data ?? []);

      // Build intervention flags
      const newFlags: InterventionFlag[] = [];
      const k = kpiRes.data;
      if (k?.inbound?.fatal_score != null && n(k.inbound.fatal_score) > 10) {
        newFlags.push({ id: "fatal-ib", severity: "critical", title: "High Fatal Rate — Inbound", message: `${pct(k.inbound.fatal_score)} of inbound calls are fatal. Immediate QA action required.`, area: "Quality" });
      }
      if (k?.outbound?.conversion != null && n(k.outbound.conversion) < 5) {
        newFlags.push({ id: "conv-ob", severity: "warning", title: "Low Outbound Conversion", message: `${pct(k.outbound.conversion)} conversion — below 5% threshold.`, area: "Sales" });
      }
      setFlags(newFlags);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [qs, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <div className="rounded-2xl border border-red-100 bg-red-50 px-8 py-6 text-center">
            <Shield className="mx-auto mb-3 h-10 w-10 text-red-400" />
            <p className="font-semibold text-red-700">Access Restricted</p>
            <p className="mt-1 text-sm text-red-500">You don't have permission to view Call Master analytics.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview",  label: "Overview" },
    { id: "opening",   label: "Opening Intelligence" },
    { id: "customer",  label: "Customer Intelligence" },
    { id: "outbound",  label: "Outbound Sales" },
    { id: "export",    label: "Export" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Call Master Dashboard</h1>
            <p className="text-sm text-slate-500">Quality, sales and customer intelligence — all LOBs</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm" />
            <span className="text-slate-400 text-sm">—</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm" />
            <select value={lob} onChange={e => setLob(e.target.value as typeof lob)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm">
              <option value="All">All LOBs</option>
              <option value="Inbound">Inbound</option>
              <option value="Outbound">Outbound</option>
            </select>
            <button onClick={() => setRefresh(r => r + 1)}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
              <RefreshCcw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>

        {/* Source unavailable banner */}
        {sourceUnavailable && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
            <span>Call Master data source is not connected — the audit and external call databases are unreachable. All metrics will show 0 until the source DB is configured. Contact your system administrator.</span>
          </div>
        )}

        {/* Intervention flags */}
        {flags.length > 0 && (
          <InterventionPanel flags={flags} title="Call Master: Immediate Attention Required" collapsible />
        )}

        {/* Tab bar */}
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${tab === t.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading && <Spinner />}

        {/* ── OVERVIEW TAB ────────────────────────────────────────────────── */}
        {!loading && tab === "overview" && (
          <div className="space-y-5">
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Inbound Audits" value={kpis?.inbound?.total?.toLocaleString() ?? "—"} icon={Phone} color="blue" />
              <StatCard label="Avg IB Quality" value={kpis?.inbound ? pct(kpis.inbound.avg_quality) : "—"} icon={Shield} color="green" />
              <StatCard label="Fatal Rate" value={kpis?.inbound ? pct(kpis.inbound.fatal_score) : "—"} icon={AlertTriangle} color="red" />
              <StatCard label="Active Agents" value={kpis?.active_agents ?? "—"} icon={Users} color="purple" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Outbound Calls" value={kpis?.outbound?.total?.toLocaleString() ?? "—"} icon={Activity} color="amber" />
              <StatCard label="OB Conversion" value={kpis?.outbound ? pct(kpis.outbound.conversion) : "—"} icon={Target} color="green" />
              <StatCard label="OB Quality Avg" value={kpis?.outbound ? pct(kpis.outbound.ob_quality) : "—"} icon={BarChart2} color="blue" />
              <StatCard label="CX Score (IB)" value={kpis?.inbound ? pct(kpis.inbound.avg_cx) : "—"} icon={Zap} color="purple" />
            </div>

            {/* Quality trend */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-slate-700">Inbound Quality Trend</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Line type="monotone" dataKey="quality" name="Quality %" stroke="#3B82F6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="fatal" name="Fatal %" stroke="#EF4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Top agents + Clients */}
            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <p className="mb-3 text-sm font-semibold text-slate-700">Top 10 Agents by Quality</p>
                <div className="space-y-2">
                  {topAgents.slice(0, 8).map((a, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{i + 1}</span>
                        <span className="text-sm font-medium text-slate-700">{a.agent}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-semibold ${n(a.quality) >= 80 ? "text-emerald-600" : n(a.quality) >= 60 ? "text-amber-600" : "text-red-500"}`}>{n(a.quality).toFixed(1)}%</span>
                        <span className="text-xs text-slate-400">{a.calls} calls</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <p className="mb-3 text-sm font-semibold text-slate-700">Calls by Client</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={clients.slice(0, 8)} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="client" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="calls" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Sales funnel */}
            {funnel && (
              <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <p className="mb-4 text-sm font-semibold text-slate-700">Outbound Sales Funnel</p>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { label: "Total Calls", value: n(funnel.total), color: "bg-blue-500" },
                    { label: "Opening Done", value: n(funnel.offered), color: "bg-indigo-500" },
                    { label: "Objection Handled", value: n(funnel.objection), color: "bg-amber-500" },
                    { label: "Upsell Attempted", value: n(funnel.upsell), color: "bg-orange-500" },
                    { label: "Sales Closed", value: n(funnel.sold), color: "bg-emerald-500" },
                  ].map((s, i) => (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div className={`flex h-12 items-center justify-center rounded-xl px-4 text-white font-bold text-sm ${s.color}`}
                        style={{ minWidth: `${Math.max(60, (s.value / (n(funnel.total) || 1)) * 180)}px` }}>
                        {s.value.toLocaleString()}
                      </div>
                      <span className="text-xs text-slate-500">{s.label}</span>
                      {i < 4 && <span className="text-slate-300">▼</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── OPENING INTELLIGENCE TAB ────────────────────────────────── */}
        {!loading && tab === "opening" && (
          <OpeningIntelligenceTab qs={qs} oiExec={oiExec} />
        )}

        {/* ── CUSTOMER INTELLIGENCE TAB ──────────────────────────────── */}
        {!loading && tab === "customer" && (
          <CustomerIntelligenceTab qs={qs} ciExec={ciExec} />
        )}

        {/* ── OUTBOUND SALES TAB ─────────────────────────────────────── */}
        {!loading && tab === "outbound" && (
          <OutboundSalesTab qs={qs} obSummary={obSummary} />
        )}

        {/* ── AI INSIGHTS / EXPORT TAB ───────────────────────────────── */}
        {!loading && tab === "export" && (
          <ExportTab qs={qs} aiInsights={aiInsights} />
        )}
      </div>
    </DashboardLayout>
  );
}

// ── Sub-tab components ─────────────────────────────────────────────────────────

function OpeningIntelligenceTab({ qs, oiExec }: { qs: string; oiExec: OIExec | null }) {
  const [cats, setCats] = useState<{ category: string; calls: number; conv_pct: number }[]>([]);
  const [trend, setTrend] = useState<{ period: string; opening_good_pct: number; opening_score: number }[]>([]);

  useEffect(() => {
    void hrmsApi.get<{ data: typeof cats }>(`/api/call-master/opening-intelligence/opening-categories?${qs}`)
      .then(r => setCats((r.data ?? []).map((c: any) => ({ ...c, calls: n(c.calls), conv_pct: n(c.conv_pct) }))));
    void hrmsApi.get<{ data: typeof trend }>(`/api/call-master/opening-intelligence/opening-trend?${qs}`)
      .then(r => setTrend((r.data ?? []).map((t: any) => ({ ...t, opening_good_pct: n(t.opening_good_pct), opening_score: n(t.opening_score) }))));
  }, [qs]);

  return (
    <div className="space-y-5">
      {oiExec && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total OB Calls" value={n(oiExec.total).toLocaleString()} icon={Phone} color="blue" />
          <StatCard label="Good Opening %" value={`${(n(oiExec.opening_good) / (n(oiExec.total) || 1) * 100).toFixed(1)}%`} icon={Award} color="green" />
          <StatCard label="Opening Score" value={`${n(oiExec.opening_score)}/100`} icon={Target} color="amber" />
          <StatCard label="Context Set %" value={pct(oiExec.context_score)} icon={Zap} color="purple" />
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Opening Category vs Conversion</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cats} margin={{ top: 4, right: 8, left: -16, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="category" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="calls" name="Calls" fill="#3B82F6" radius={[3,3,0,0]} />
              <Bar dataKey="conv_pct" name="Conv %" fill="#10B981" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Opening Score Trend</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="period" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="opening_score" name="Opening Score" stroke="#8B5CF6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="opening_good_pct" name="Good Opening %" stroke="#10B981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function CustomerIntelligenceTab({ qs, ciExec }: { qs: string; ciExec: CIExec | null }) {
  const [sentiment, setSentiment] = useState<{ period: string; positive_pct: number; negative_pct: number }[]>([]);
  const [fbCats, setFbCats] = useState<{ category: string; count: number; positive: number; negative: number }[]>([]);

  useEffect(() => {
    void hrmsApi.get<{ data: typeof sentiment }>(`/api/call-master/customer-intelligence/sentiment-trend?${qs}`)
      .then(r => setSentiment((r.data ?? []).map((s: any) => ({ ...s, positive_pct: n(s.positive_pct), negative_pct: n(s.negative_pct) }))));
    void hrmsApi.get<{ data: typeof fbCats }>(`/api/call-master/customer-intelligence/feedback-categories?${qs}`)
      .then(r => setFbCats((r.data ?? []).map((c: any) => ({ ...c, count: n(c.count), positive: n(c.positive), negative: n(c.negative) }))));
  }, [qs]);

  return (
    <div className="space-y-5">
      {ciExec && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Satisfaction" value={pct(ciExec.satisfaction_pct)} icon={Award} color="green" />
          <StatCard label="Negative Feedback" value={`${(n(ciExec.negative) / (n(ciExec.total) || 1) * 100).toFixed(1)}%`} icon={AlertTriangle} color="red" />
          <StatCard label="Trust Score" value={`${n(ciExec.trust_score)}/100`} icon={Shield} color="blue" />
          <StatCard label="Conversion" value={pct(ciExec.conv_pct)} icon={Target} color="amber" />
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Sentiment Trend</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={sentiment} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="period" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="positive_pct" name="Positive %" stroke="#10B981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="negative_pct" name="Negative %" stroke="#EF4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Feedback Categories</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={fbCats.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 8, left: 60, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis dataKey="category" type="category" tick={{ fontSize: 9 }} width={60} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="positive" name="Positive" fill="#10B981" stackId="a" />
              <Bar dataKey="negative" name="Negative" fill="#EF4444" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function OutboundSalesTab({ qs, obSummary }: { qs: string; obSummary: OBSummary | null }) {
  const [dailyTrend, setDailyTrend] = useState<{ date: string; calls: number; sales: number; conversion: number }[]>([]);
  const [agents, setAgents] = useState<{ agent: string; calls: number; sales: number; conversion: number }[]>([]);

  useEffect(() => {
    void hrmsApi.get<{ data: typeof dailyTrend }>(`/api/call-master/outbound/daily-trend?${qs}`)
      .then(r => setDailyTrend((r.data ?? []).map((d: any) => ({ ...d, calls: n(d.calls), sales: n(d.sales), conversion: n(d.conversion) }))));
    void hrmsApi.get<{ data: typeof agents }>(`/api/call-master/outbound/agents?${qs}`)
      .then(r => setAgents((r.data ?? []).map((a: any) => ({ ...a, calls: n(a.calls), sales: n(a.sales), conversion: n(a.conversion) }))));
  }, [qs]);

  return (
    <div className="space-y-5">
      {obSummary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total Calls" value={n(obSummary.total).toLocaleString()} icon={Phone} color="blue" />
          <StatCard label="Sales" value={n(obSummary.sales).toLocaleString()} icon={Award} color="green" />
          <StatCard label="Conversion" value={pct(obSummary.conversion)} icon={Target} color="amber" />
          <StatCard label="Avg Call Duration" value={`${n(obSummary.avg_duration)}m`} icon={Activity} color="purple" />
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Daily Sales vs Calls</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailyTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="calls" name="Calls" stroke="#94A3B8" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="sales" name="Sales" stroke="#10B981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="conversion" name="Conv %" stroke="#F59E0B" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Agent Leaderboard</p>
          <div className="max-h-52 overflow-y-auto space-y-1.5">
            {agents.slice(0, 10).map((a, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg px-3 py-1.5 hover:bg-slate-50">
                <span className="text-sm font-medium text-slate-700">{i + 1}. {a.agent}</span>
                <div className="flex gap-3">
                  <span className="text-xs font-bold text-emerald-600">{n(a.sales)} sales</span>
                  <span className="text-xs text-slate-400">{n(a.conversion).toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportTab({ qs, aiInsights }: { qs: string; aiInsights: AIInsight[] }) {
  const [lob, setLob] = useState<"Inbound" | "Outbound">("Inbound");
  const [exporting, setExporting] = useState(false);
  const [showInsight, setShowInsight] = useState<number | null>(null);

  async function handleExport() {
    setExporting(true);
    try {
      // Strip lob from parent qs (parent may have lob=All) then add export-specific lob
      const baseQs = qs.split("&").filter(p => !p.startsWith("lob=")).join("&");
      const res = await hrmsApi.get<{ data: Record<string, unknown>[] }>(
        `/api/call-master/export?${baseQs}&lob=${lob}&limit=5000`
      );
      const rows = res.data ?? [];
      if (rows.length === 0) { alert("No data in selected range"); return; }
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(","), ...rows.map(r =>
        headers.map(h => JSON.stringify(r[h] ?? "")).join(",")
      )].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `call-master-${lob.toLowerCase()}-${qs.split("&")[0].replace("startDate=","")}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  const typeColors: Record<string, string> = {
    alert: "border-l-red-500 bg-red-50",
    success: "border-l-emerald-500 bg-emerald-50",
    opportunity: "border-l-blue-500 bg-blue-50",
  };

  return (
    <div className="space-y-5">
      {/* AI Insights */}
      {aiInsights.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" /> AI Insights — Opening & Customer Intelligence
          </p>
          {aiInsights.map((ins, i) => (
            <div key={i}
              className={`rounded-xl border-l-4 p-4 cursor-pointer ${typeColors[ins.type] ?? "border-l-slate-300 bg-slate-50"}`}
              onClick={() => setShowInsight(showInsight === i ? null : i)}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm text-slate-800">{ins.title}</p>
                {showInsight === i ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </div>
              <p className="mt-1 text-xs text-slate-600">{ins.what}</p>
              {showInsight === i && (
                <div className="mt-3 space-y-1.5 text-xs text-slate-600 border-t border-slate-200 pt-2">
                  <p><span className="font-semibold">Why:</span> {ins.why}</p>
                  <p><span className="font-semibold">Impact:</span> {ins.impact}</p>
                  <p><span className="font-semibold text-blue-700">Action:</span> {ins.action}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Export section */}
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="mb-4 text-sm font-semibold text-slate-700">Export Raw Call Data</p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={lob} onChange={e => setLob(e.target.value as typeof lob)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
            <option value="Inbound">Inbound</option>
            <option value="Outbound">Outbound</option>
          </select>
          <button onClick={handleExport} disabled={exporting}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            <Download className="h-4 w-4" />
            {exporting ? "Exporting…" : "Export CSV (up to 5000 rows)"}
          </button>
        </div>
      </div>
    </div>
  );
}
