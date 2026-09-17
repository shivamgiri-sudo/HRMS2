import { useMemo, useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  IndianRupee, ShoppingBag, TrendingUp, PhoneCall, Users, Search, ListFilter,
  Target, Trophy, MessageSquare, Gauge, Clock3, Layers, ClipboardList, Footprints,
} from "lucide-react";
import { Spinner, KpiCard, SectionCard, DashboardHero, formatINR, formatShortDate } from "./DashboardKit";

/**
 * Neemans' combined Sale/Allocation/Chat/Productivity dashboard -- one
 * view over all 4 of Neemans' raw uploaded tables, live from GET
 * /api/process-performance/neemans-performance-dashboard. See the backend
 * service's own header comment for the full column mapping, why Target/
 * Achievement comes from nms_Agent_Details.monthly_target rather than
 * neemans_sale_raw's own ambiguous per-row target field, and why there's
 * no date-range picker (neemans_allocation's date column mixes three
 * different formats across rows).
 *
 * Every number renders whatever is currently uploaded -- Chat shows 4
 * tickets today because that's all that exists live; it will grow on its
 * own as more is uploaded, with no code change needed.
 */

interface Overview {
  saleRevenue: number; saleCount: number; rtoPct: number;
  totalAllocation: number; allocationConnectedPct: number;
  totalChatTickets: number; chatResolvedPct: number; avgOccupancyPct: number;
}
interface SaleData {
  headline: { revenue: number; saleCount: number; aov: number; prepaidPct: number; codPct: number; rtoPct: number; activeAgents: number; target: number; achievementPct: number };
  dateWiseTrend: Array<{ date: string; saleCount: number; revenue: number; rtoCount: number }>;
  paymentBreakdown: Array<{ paymentStatus: string; count: number; revenue: number }>;
  byTl: Array<{ tlName: string; saleCount: number; revenue: number; rtoPct: number; target: number; achievementPct: number }>;
  agents: Array<{ empId: string; name: string; tlName: string; saleCount: number; revenue: number; rtoPct: number; prepaidPct: number; target: number; achievementPct: number }>;
}
interface AllocationData {
  headline: { totalAllocation: number; connected: number; connectedPct: number; notConnected: number; pending: number; uniquePhones: number; activeAgents: number };
  typeBreakdown: Array<{ type: string; count: number; connectedPct: number }>;
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
  agents: Array<{ agent: string; allocation: number; connected: number; connectedPct: number }>;
}
interface ChatData {
  headline: { totalTickets: number; resolvedPct: number; avgFrtHrs: number; avgResolutionHrs: number; avgCsat: number };
  byLob: Array<{ lob: string; tickets: number; resolvedPct: number }>;
  agents: Array<{ agent: string; empId: string; tickets: number; resolvedPct: number; avgCsat: number }>;
}
interface ProductivityData {
  headline: { totalCalls: number; activeAgents: number; avgOccupancyPct: number; attendanceDays: number };
  dateWiseTrend: Array<{ date: string; calls: number; avgOccupancyPct: number; loginAgents: number }>;
  agents: Array<{ empId: string; name: string; calls: number; loginTimeSec: number; talkTimeSec: number; occupancyPct: number; attendanceDays: number }>;
}
interface DashboardData {
  overview: Overview; sale: SaleData; allocation: AllocationData; chat: ChatData; productivity: ProductivityData;
}

const PAY_COLORS = ["#059669", "#f59e0b", "#0ea5e9", "#8b5cf6", "#e11d48", "#64748b"];
const TYPE_COLORS = ["#7c3aed", "#0ea5e9"];
const secondsToHms = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
};

type TabKey = "overview" | "sale" | "allocation" | "chat" | "productivity";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "sale", label: "Sale" },
  { key: "allocation", label: "Allocation" },
  { key: "chat", label: "Chat" },
  { key: "productivity", label: "Productivity" },
];

export function NeemansPerformanceDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [saleSearch, setSaleSearch] = useState("");
  const [allocSearch, setAllocSearch] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [prodSearch, setProdSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        "/api/process-performance/neemans-performance-dashboard",
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Neemans performance dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredSaleAgents = useMemo(() => {
    const rows = data?.sale.agents ?? [];
    const q = saleSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.name.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q) || a.tlName.toLowerCase().includes(q));
  }, [data, saleSearch]);

  const filteredAllocAgents = useMemo(() => {
    const rows = data?.allocation.agents ?? [];
    const q = allocSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q));
  }, [data, allocSearch]);

  const filteredChatAgents = useMemo(() => {
    const rows = data?.chat.agents ?? [];
    const q = chatSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q));
  }, [data, chatSearch]);

  const filteredProdAgents = useMemo(() => {
    const rows = data?.productivity.agents ?? [];
    const q = prodSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.name.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q));
  }, [data, prodSearch]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { overview, sale, allocation, chat, productivity } = data;

  return (
    <div className="space-y-5">
      <DashboardHero
        icon={Footprints} eyebrow="Neemans · Process Performance" title="Sale, Allocation, Chat & Productivity"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-violet-600 via-purple-600 to-violet-700"
      />

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <KpiCard icon={IndianRupee} label="Sale Revenue" value={formatINR(overview.saleRevenue)} tone="emerald" />
            <KpiCard icon={ShoppingBag} label="Sale Count" value={overview.saleCount.toLocaleString("en-IN")} tone="sky" />
            <KpiCard icon={TrendingUp} label="RTO %" value={`${overview.rtoPct}%`} tone="rose" />
            <KpiCard icon={ClipboardList} label="Total Allocation" value={overview.totalAllocation.toLocaleString("en-IN")} tone="violet" />
            <KpiCard icon={PhoneCall} label="Allocation Connected %" value={`${overview.allocationConnectedPct}%`} tone="teal" />
            <KpiCard icon={MessageSquare} label="Chat Tickets" value={String(overview.totalChatTickets)} tone="indigo" />
            <KpiCard icon={Gauge} label="Chat Resolved %" value={`${overview.chatResolvedPct}%`} tone="cyan" />
            <KpiCard icon={Clock3} label="Avg Occupancy %" value={`${overview.avgOccupancyPct}%`} tone="amber" />
          </div>
          <p className="text-[11px] text-slate-400">
            Each tile summarizes one uploaded data source (Sale/Allocation/Chat/Productivity) — open the tabs above for the full breakdown. Numbers reflect whatever is currently uploaded; no date-range filter here since neemans_allocation's date column mixes formats across rows.
          </p>
        </div>
      )}

      {tab === "sale" && (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(sale.headline.revenue)} tone="emerald" />
          <KpiCard icon={ShoppingBag} label="Sale Count" value={sale.headline.saleCount.toLocaleString("en-IN")} tone="sky" />
          <KpiCard icon={TrendingUp} label="AOV" value={formatINR(sale.headline.aov)} tone="violet" />
          <KpiCard icon={IndianRupee} label="Prepaid %" value={`${sale.headline.prepaidPct}%`} tone="teal" />
          <KpiCard icon={IndianRupee} label="COD %" value={`${sale.headline.codPct}%`} tone="amber" />
          <KpiCard icon={TrendingUp} label="RTO %" value={`${sale.headline.rtoPct}%`} tone="rose" />
          <KpiCard icon={Target} label="Target" value={formatINR(sale.headline.target)} tone="indigo" />
          <KpiCard icon={Trophy} label="Achievement %" value={`${sale.headline.achievementPct}%`} tone="cyan" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
          <SectionCard icon={TrendingUp} title="Date-wise Sale & RTO" tone="violet">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={sale.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="neemansRevFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} formatter={(value: number, name: string) => (name === "Revenue" ? formatINR(value) : value)} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="#7c3aed" strokeWidth={2.5} fill="url(#neemansRevFill)" />
                <Line yAxisId="left" type="monotone" dataKey="rtoCount" name="RTO Count" stroke="#e11d48" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>
          </div>
          <SectionCard icon={Layers} title="Payment Breakdown" tone="teal">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={sale.paymentBreakdown} dataKey="revenue" nameKey="paymentStatus" cx="50%" cy="50%" innerRadius={44} outerRadius={82} paddingAngle={2} label={(p: { paymentStatus?: string }) => p.paymentStatus ?? ""}>
                  {sale.paymentBreakdown.map((entry, i) => (
                    <Cell key={entry.paymentStatus} fill={PAY_COLORS[i % PAY_COLORS.length]} stroke="white" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatINR(v)} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              </PieChart>
            </ResponsiveContainer>
          </SectionCard>
        </div>

        <SectionCard icon={Users} title="TL-wise Summary" tone="violet">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">TL Name</th>
                  <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                  <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                  <th className="py-2 pr-3 text-right font-semibold">RTO %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Target</th>
                  <th className="py-2 pr-0 text-right font-semibold">Achievement %</th>
                </tr>
              </thead>
              <tbody>
                {sale.byTl.map((r) => (
                  <tr key={r.tlName} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{r.tlName}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.saleCount}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(r.revenue)}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.rtoPct}%</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(r.target)}</td>
                    <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{r.achievementPct}%</td>
                  </tr>
                ))}
                {sale.byTl.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-slate-400">No data uploaded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)} placeholder="Search agent name, ID or TL..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
              <ListFilter className="h-3 w-3" />{filteredSaleAgents.length} of {sale.agents.length} agents
            </span>
          </div>
          <SectionCard icon={Trophy} title="Agent-wise Sale Performance" tone="amber">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Agent</th>
                    <th className="py-2 pr-3 font-semibold">TL</th>
                    <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                    <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                    <th className="py-2 pr-3 text-right font-semibold">RTO %</th>
                    <th className="py-2 pr-3 text-right font-semibold">Prepaid %</th>
                    <th className="py-2 pr-3 text-right font-semibold">Target</th>
                    <th className="py-2 pr-0 text-right font-semibold">Achievement %</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSaleAgents.map((a) => (
                    <tr key={a.empId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-amber-50/40">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-700">{a.name}</div>
                        <div className="text-[11px] text-slate-400">{a.empId}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-500">{a.tlName}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.saleCount}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(a.revenue)}</td>
                      <td className={`py-2.5 pr-3 text-right ${a.rtoPct > 10 ? "text-red-600 font-semibold" : "text-slate-600"}`}>{a.rtoPct}%</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.prepaidPct}%</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(a.target)}</td>
                      <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{a.achievementPct}%</td>
                    </tr>
                  ))}
                  {filteredSaleAgents.length === 0 && (
                    <tr><td colSpan={8} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
      )}

      {tab === "allocation" && (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <KpiCard icon={ClipboardList} label="Total Allocation" value={allocation.headline.totalAllocation.toLocaleString("en-IN")} tone="violet" />
          <KpiCard icon={PhoneCall} label="Connected" value={allocation.headline.connected.toLocaleString("en-IN")} tone="emerald" />
          <KpiCard icon={Gauge} label="Connected %" value={`${allocation.headline.connectedPct}%`} tone="teal" />
          <KpiCard icon={PhoneCall} label="Not Connected" value={allocation.headline.notConnected.toLocaleString("en-IN")} tone="rose" />
          <KpiCard icon={Clock3} label="Pending" value={allocation.headline.pending.toLocaleString("en-IN")} tone="amber" />
          <KpiCard icon={Users} label="Unique Phones" value={allocation.headline.uniquePhones.toLocaleString("en-IN")} tone="sky" />
          <KpiCard icon={Users} label="Active Agents" value={String(allocation.headline.activeAgents)} tone="indigo" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard icon={Layers} title="Type-wise Allocation (Shopify vs GOKWICK)" tone="violet">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={allocation.typeBreakdown} dataKey="count" nameKey="type" cx="50%" cy="50%" innerRadius={44} outerRadius={82} paddingAngle={2} label={(p: { type?: string }) => p.type ?? ""}>
                  {allocation.typeBreakdown.map((entry, i) => (
                    <Cell key={entry.type} fill={TYPE_COLORS[i % TYPE_COLORS.length]} stroke="white" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              </PieChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard icon={ClipboardList} title="Calling Status Breakdown" tone="teal">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 text-right font-semibold">Count</th>
                    <th className="py-2 pr-0 text-right font-semibold">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {allocation.statusBreakdown.map((s) => (
                    <tr key={s.status} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-teal-50/40">
                      <td className="py-2.5 pr-3 font-medium text-slate-700">{s.status}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{s.count.toLocaleString("en-IN")}</td>
                      <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{s.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" value={allocSearch} onChange={(e) => setAllocSearch(e.target.value)} placeholder="Search agent..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
              <ListFilter className="h-3 w-3" />{filteredAllocAgents.length} of {allocation.agents.length} agents
            </span>
          </div>
          <SectionCard
            icon={Users} title="Agent-wise Allocation" tone="violet"
            footnote="No TL-wise view is shown — neemans_allocation has no team-lead column."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Agent</th>
                    <th className="py-2 pr-3 text-right font-semibold">Allocation</th>
                    <th className="py-2 pr-3 text-right font-semibold">Connected</th>
                    <th className="py-2 pr-0 text-right font-semibold">Connected %</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAllocAgents.map((a) => (
                    <tr key={a.agent} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                      <td className="py-2.5 pr-3 font-medium text-slate-700">{a.agent}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.allocation.toLocaleString("en-IN")}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.connected.toLocaleString("en-IN")}</td>
                      <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{a.connectedPct}%</td>
                    </tr>
                  ))}
                  {filteredAllocAgents.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
      )}

      {tab === "chat" && (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <KpiCard icon={MessageSquare} label="Total Tickets" value={String(chat.headline.totalTickets)} tone="indigo" />
          <KpiCard icon={Gauge} label="Resolved %" value={`${chat.headline.resolvedPct}%`} tone="emerald" />
          <KpiCard icon={Clock3} label="Avg FRT" value={`${chat.headline.avgFrtHrs}h`} tone="sky" />
          <KpiCard icon={Clock3} label="Avg Resolution" value={`${chat.headline.avgResolutionHrs}h`} tone="violet" />
          <KpiCard icon={Trophy} label="Avg CSAT" value={String(chat.headline.avgCsat)} tone="amber" />
        </div>
        {chat.headline.totalTickets < 20 && (
          <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
            Only {chat.headline.totalTickets} chat ticket(s) uploaded so far (db_masmis.neemans_chat) — these numbers are real but thin. They'll fill out automatically as more chat exports are uploaded, no page change needed.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard icon={Layers} title="LOB-wise Tickets" tone="indigo">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">LOB</th>
                    <th className="py-2 pr-3 text-right font-semibold">Tickets</th>
                    <th className="py-2 pr-0 text-right font-semibold">Resolved %</th>
                  </tr>
                </thead>
                <tbody>
                  {chat.byLob.map((r) => (
                    <tr key={r.lob} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/40">
                      <td className="py-2.5 pr-3 font-medium text-slate-700">{r.lob}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{r.tickets}</td>
                      <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{r.resolvedPct}%</td>
                    </tr>
                  ))}
                  {chat.byLob.length === 0 && (
                    <tr><td colSpan={3} className="py-6 text-center text-slate-400">No data uploaded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <div className="space-y-3">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} placeholder="Search agent..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none" />
            </div>
            <SectionCard icon={Users} title="Agent-wise Chat Performance" tone="violet">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="py-2 pr-3 font-semibold">Agent</th>
                      <th className="py-2 pr-3 text-right font-semibold">Tickets</th>
                      <th className="py-2 pr-3 text-right font-semibold">Resolved %</th>
                      <th className="py-2 pr-0 text-right font-semibold">Avg CSAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChatAgents.map((a) => (
                      <tr key={`${a.empId}-${a.agent}`} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-slate-700">{a.agent}</div>
                          <div className="text-[11px] text-slate-400">{a.empId}</div>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-slate-600">{a.tickets}</td>
                        <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.resolvedPct}%</td>
                        <td className="py-2.5 pr-0 text-right text-slate-600">{a.avgCsat || "—"}</td>
                      </tr>
                    ))}
                    {filteredChatAgents.length === 0 && (
                      <tr><td colSpan={4} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
      )}

      {tab === "productivity" && (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard icon={PhoneCall} label="Total Calls" value={productivity.headline.totalCalls.toLocaleString("en-IN")} tone="sky" />
          <KpiCard icon={Users} label="Active Agents" value={String(productivity.headline.activeAgents)} tone="indigo" />
          <KpiCard icon={Gauge} label="Avg Occupancy %" value={`${productivity.headline.avgOccupancyPct}%`} tone="violet" />
          <KpiCard icon={Clock3} label="Attendance Days" value={String(productivity.headline.attendanceDays)} tone="emerald" />
        </div>

        <SectionCard icon={TrendingUp} title="Date-wise Calls & Occupancy" tone="violet">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={productivity.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="calls" name="Calls" fill="#7c3aed" radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="avgOccupancyPct" name="Avg Occupancy %" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} placeholder="Search agent name or ID..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
              <ListFilter className="h-3 w-3" />{filteredProdAgents.length} of {productivity.agents.length} agents
            </span>
          </div>
          <SectionCard icon={Users} title="Agent-wise Productivity" tone="violet">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Agent</th>
                    <th className="py-2 pr-3 text-right font-semibold">Calls</th>
                    <th className="py-2 pr-3 text-right font-semibold">Login Time</th>
                    <th className="py-2 pr-3 text-right font-semibold">Talk Time</th>
                    <th className="py-2 pr-3 text-right font-semibold">Occupancy %</th>
                    <th className="py-2 pr-0 text-right font-semibold">Attendance Days</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProdAgents.map((a) => (
                    <tr key={a.empId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-700">{a.name}</div>
                        <div className="text-[11px] text-slate-400">{a.empId}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.calls}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{secondsToHms(a.loginTimeSec)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{secondsToHms(a.talkTimeSec)}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.occupancyPct}%</td>
                      <td className="py-2.5 pr-0 text-right text-slate-600">{a.attendanceDays}</td>
                    </tr>
                  ))}
                  {filteredProdAgents.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
      )}
    </div>
  );
}
