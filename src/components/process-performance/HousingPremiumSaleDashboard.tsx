import { useMemo, useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  IndianRupee, ShoppingBag, TrendingUp, PhoneCall, Timer, Users, Target, Trophy, Search, ListFilter, Building2,
} from "lucide-react";
import { Spinner, KpiCard, SectionCard, DashboardHero, formatINR } from "./DashboardKit";

/**
 * Housing Premium's real "Sale Performance" dashboard -- live aggregates
 * over db_masmis.pre_sale, pre_agent_details and Pre_cdr, via GET
 * /api/process-performance/housing-premium-dashboard. See the backend
 * service's own header comment for exactly which columns back which KPI,
 * why there's no date-range picker (pre_sale's date columns are all NULL
 * on every current row), and why target/achievement are the roster file's
 * own reported figures rather than recomputed from live sale data.
 *
 * All three source tables are genuinely thin right now (3 sale rows, 4
 * agent-roster rows, 4 call rows, confirmed live 2026-09-17) -- the small
 * numbers below are real, not a bug.
 */

interface Headline {
  totalRevenue: number; totalSaleCount: number; aov: number;
  totalCalls: number; connectedCalls: number; connectedPct: number; avgTalkTimeSec: number;
  activeAgents: number; totalTarget: number; totalAchievement: number; achievementPct: number;
}
interface GroupRow {
  tlName: string; agentCount: number; target: number; achievement: number; achievementPct: number;
  revenue: number; saleCount: number; totalCalls: number; connectedCalls: number; connectedPct: number;
}
interface AgentRow {
  empId: string | null; name: string; tlName: string; center: string; doj: string | null;
  tenureDays: number | null; bucket: string | null; status: string;
  target: number; achievement: number; achievementPct: number;
  revenue: number; saleCount: number; totalCalls: number; connectedCalls: number; connectedPct: number; avgTalkTimeSec: number;
}
interface DashboardData {
  headline: Headline;
  byTl: GroupRow[];
  agents: AgentRow[];
  partnerBreakdown: { partnerName: string; revenue: number; saleCount: number }[];
}

const PARTNER_COLORS = ["#f59e0b", "#0ea5e9", "#8b5cf6", "#059669", "#e11d48"];
const secondsToMin = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
const formatDDMMYYYY = (raw: string | null) => {
  if (!raw) return "—";
  const m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return raw;
  return `${m[2].padStart(2, "0")}/${m[1].padStart(2, "0")}/20${m[3]}`;
};

type TabKey = "overall" | "tl" | "agents";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "tl", label: "TL-wise" },
  { key: "agents", label: "Agent-wise" },
];

export function HousingPremiumSaleDashboard() {
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
        "/api/process-performance/housing-premium-dashboard",
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Housing Premium dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agents ?? [];
    const q = agentSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.name.toLowerCase().includes(q) || a.tlName.toLowerCase().includes(q) || (a.empId ?? "").toLowerCase().includes(q));
  }, [data, agentSearch]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-5">
      <DashboardHero
        icon={Building2} eyebrow="Housing Premium · Process Performance" title="Sale Performance"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-amber-500 via-orange-500 to-amber-600"
      />

      {tab === "overall" && (
      <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(headline.totalRevenue)} tone="amber" />
        <KpiCard icon={ShoppingBag} label="Sale Count" value={String(headline.totalSaleCount)} tone="sky" />
        <KpiCard icon={TrendingUp} label="AOV" value={formatINR(headline.aov)} tone="violet" />
        <KpiCard icon={PhoneCall} label="Connected %" value={`${headline.connectedPct}%`} tone="teal" />
        <KpiCard icon={Timer} label="Avg Talk Time" value={secondsToMin(headline.avgTalkTimeSec)} tone="indigo" />
        <KpiCard icon={Users} label="Active Agents" value={String(headline.activeAgents)} tone="cyan" />
        <KpiCard icon={Target} label="Target" value={formatINR(headline.totalTarget)} tone="rose" />
        <KpiCard icon={Trophy} label="Achievement %" value={`${headline.achievementPct}%`} tone="emerald" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
        <SectionCard icon={Users} title="TL-wise Revenue vs Target" tone="amber">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.byTl} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="tlName" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => formatINR(v)} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Bar dataKey="revenue" name="Revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="target" name="Target" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
        </div>

        <SectionCard icon={Building2} title="Partner Breakdown" tone="violet">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.partnerBreakdown} dataKey="revenue" nameKey="partnerName" cx="50%" cy="50%" innerRadius={44} outerRadius={82} paddingAngle={2} label={(p: { partnerName?: string }) => p.partnerName ?? ""}>
                {data.partnerBreakdown.map((entry, i) => (
                  <Cell key={entry.partnerName} fill={PARTNER_COLORS[i % PARTNER_COLORS.length]} stroke="white" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => formatINR(v)} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
      </>
      )}

      {tab === "tl" && (
      <SectionCard
        icon={Users} title="TL-wise Summary" tone="amber"
        footnote="TL name is spelled differently across the uploaded Sale, Agent Details and CDR files for the same person (e.g. 'Arbaz' vs 'Arbaz Khan') — rows are kept separate per source rather than guessed-merged, since silently combining them risks misattributing revenue or calls to the wrong TL."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">TL Name</th>
                <th className="py-2 pr-3 text-right font-semibold">Agents</th>
                <th className="py-2 pr-3 text-right font-semibold">Target</th>
                <th className="py-2 pr-3 text-right font-semibold">Achievement</th>
                <th className="py-2 pr-3 text-right font-semibold">Ach %</th>
                <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                <th className="py-2 pr-3 text-right font-semibold">Calls</th>
                <th className="py-2 pr-0 text-right font-semibold">Connected %</th>
              </tr>
            </thead>
            <tbody>
              {data.byTl.map((r) => (
                <tr key={r.tlName} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-amber-50/40">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{r.tlName}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.agentCount}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(r.target)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(r.achievement)}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{r.achievementPct}%</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(r.revenue)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.saleCount}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{r.totalCalls}</td>
                  <td className="py-2.5 pr-0 text-right text-slate-600">{r.connectedPct}%</td>
                </tr>
              ))}
              {data.byTl.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-slate-400">No data uploaded yet.</td></tr>
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
            <input
              type="text"
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search agent name, ID or TL..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-amber-400 focus:outline-none"
            />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />
            {filteredAgents.length} of {data.agents.length} agents
          </span>
        </div>

        <SectionCard icon={Users} title="Agent-wise Performance" tone="amber">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">EMP Id</th>
                  <th className="py-2 pr-3 font-semibold">Agent Name</th>
                  <th className="py-2 pr-3 font-semibold">TL</th>
                  <th className="py-2 pr-3 font-semibold">DOJ</th>
                  <th className="py-2 pr-3 text-right font-semibold">Tenure</th>
                  <th className="py-2 pr-3 font-semibold">Bucket</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 text-right font-semibold">Target</th>
                  <th className="py-2 pr-3 text-right font-semibold">Ach %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                  <th className="py-2 pr-3 text-right font-semibold">Calls</th>
                  <th className="py-2 pr-0 text-right font-semibold">Connected %</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr key={`${a.empId ?? a.name}`} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-amber-50/40">
                    <td className="py-2.5 pr-3 text-slate-500">{a.empId ?? "—"}</td>
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{a.name}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{a.tlName}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{formatDDMMYYYY(a.doj)}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.tenureDays ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        a.bucket === "180 Above" ? "bg-emerald-100 text-emerald-700"
                        : a.bucket === "121-180" ? "bg-teal-100 text-teal-700"
                        : a.bucket === "0-30" ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                      }`}>{a.bucket ?? "Unknown"}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-500">{a.status}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(a.target)}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.achievementPct}%</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(a.revenue)}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.totalCalls}</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{a.connectedPct}%</td>
                  </tr>
                ))}
                {filteredAgents.length === 0 && (
                  <tr><td colSpan={12} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
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
