import { useMemo, useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  PhoneCall, Store, Warehouse, IndianRupee, Users, Search, ListFilter, ClipboardList, Target,
} from "lucide-react";
import { Spinner, KpiCard, SectionCard, DashboardHero, formatINR } from "./DashboardKit";

/**
 * Satya Retail's real dashboard -- live aggregates over
 * db_masmis.satya_allocation (beat/shop calling allocation) and
 * db_masmis.satya_cdr (call detail/case log), via GET
 * /api/process-performance/satya-retail-dashboard. See the backend
 * service's own header comment for the full column mapping and the
 * source-file naming quirks it works around (agent_name vs agent_name_2,
 * satya_cdr.agent_name actually holding an employee code).
 *
 * No date-range picker and no TL-wise view: both are genuinely thin right
 * now (9 allocation rows, 8 CDR rows, all one day, no TL column in either
 * table) -- Warehouse-wise stands in for the org-level breakdown.
 */

interface Headline {
  totalAllocation: number; allocationConnected: number; allocationConnectedPct: number;
  uniqueShops: number; orderValue: number; totalCdrCalls: number; cdrConnected: number;
  cdrConnectedPct: number; activeAgents: number; avgAttempts: number;
}
interface WarehouseRow { warehouse: string; allocation: number; connected: number; connectedPct: number; uniqueShops: number; orderValue: number }
interface AgentRow {
  agentId: string; agentName: string; allocation: number; allocConnected: number; allocConnectedPct: number;
  cdrCalls: number; cdrConnected: number; cdrConnectedPct: number; orderValue: number; avgAttempts: number;
}
interface DashboardData {
  headline: Headline;
  byWarehouse: WarehouseRow[];
  agents: AgentRow[];
  dispositionBreakdown: { disposition: string; count: number }[];
}

const DISPOSITION_COLORS = ["#eab308", "#0ea5e9", "#8b5cf6", "#059669", "#e11d48", "#f97316"];

type TabKey = "overall" | "warehouse" | "agents";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "warehouse", label: "Warehouse-wise" },
  { key: "agents", label: "Agent-wise" },
];

export function SatyaRetailDashboard() {
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
        "/api/process-performance/satya-retail-dashboard",
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Satya Retail dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agents ?? [];
    const q = agentSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agentName.toLowerCase().includes(q) || a.agentId.toLowerCase().includes(q));
  }, [data, agentSearch]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-5">
      <DashboardHero
        icon={Store} eyebrow="Satya Retail · Process Performance" title="Beat & Call Performance"
        tabs={TABS} activeTab={tab} onTabChange={(key) => setTab(key as TabKey)}
        gradient="from-yellow-500 via-amber-500 to-yellow-600"
      />

      {tab === "overall" && (
      <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard icon={ClipboardList} label="Total Allocation" value={String(headline.totalAllocation)} tone="amber" />
        <KpiCard icon={PhoneCall} label="Allocation Connected %" value={`${headline.allocationConnectedPct}%`} tone="emerald" />
        <KpiCard icon={Store} label="Unique Shops" value={String(headline.uniqueShops)} tone="sky" />
        <KpiCard icon={IndianRupee} label="Order Value" value={formatINR(headline.orderValue)} tone="violet" />
        <KpiCard icon={PhoneCall} label="Total CDR Calls" value={String(headline.totalCdrCalls)} tone="blue" />
        <KpiCard icon={PhoneCall} label="CDR Connected %" value={`${headline.cdrConnectedPct}%`} tone="teal" />
        <KpiCard icon={Users} label="Active Agents" value={String(headline.activeAgents)} tone="indigo" />
        <KpiCard icon={Target} label="Avg Attempts" value={String(headline.avgAttempts)} tone="rose" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Warehouse} title="Warehouse-wise Allocation" tone="amber">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.byWarehouse} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="warehouse" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Bar dataKey="allocation" name="Allocation" fill="#eab308" radius={[4, 4, 0, 0]} />
              <Bar dataKey="connected" name="Connected" fill="#059669" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard icon={ClipboardList} title="Disposition Breakdown" tone="violet">
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

      {tab === "warehouse" && (
      <SectionCard icon={Warehouse} title="Warehouse-wise Summary" tone="amber">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Warehouse</th>
                <th className="py-2 pr-3 text-right font-semibold">Allocation</th>
                <th className="py-2 pr-3 text-right font-semibold">Connected</th>
                <th className="py-2 pr-3 text-right font-semibold">Connected %</th>
                <th className="py-2 pr-3 text-right font-semibold">Unique Shops</th>
                <th className="py-2 pr-0 text-right font-semibold">Order Value</th>
              </tr>
            </thead>
            <tbody>
              {data.byWarehouse.map((w) => (
                <tr key={w.warehouse} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-amber-50/40">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{w.warehouse}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{w.allocation}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{w.connected}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{w.connectedPct}%</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{w.uniqueShops}</td>
                  <td className="py-2.5 pr-0 text-right text-slate-600">{formatINR(w.orderValue)}</td>
                </tr>
              ))}
              {data.byWarehouse.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-slate-400">No data uploaded yet.</td></tr>
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
              placeholder="Search agent name or ID..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-amber-400 focus:outline-none"
            />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />
            {filteredAgents.length} of {data.agents.length} agents
          </span>
        </div>

        <SectionCard
          icon={Users} title="Agent-wise Performance" tone="amber"
          footnote="No TL-wise view is shown — neither the allocation nor CDR file for Satya Retail has a team-lead column; Warehouse-wise stands in for the org-level breakdown."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 text-right font-semibold">Allocation</th>
                  <th className="py-2 pr-3 text-right font-semibold">Alloc Connected %</th>
                  <th className="py-2 pr-3 text-right font-semibold">CDR Calls</th>
                  <th className="py-2 pr-3 text-right font-semibold">CDR Connected %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Avg Attempts</th>
                  <th className="py-2 pr-0 text-right font-semibold">Order Value</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr key={a.agentId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-amber-50/40">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-700">{a.agentName}</div>
                      <div className="text-[11px] text-slate-400">{a.agentId}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.allocation}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.allocConnectedPct}%</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.cdrCalls}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.cdrConnectedPct}%</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.avgAttempts || "—"}</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{formatINR(a.orderValue)}</td>
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
    </div>
  );
}
