import { useMemo, useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  ShoppingCart, IndianRupee, TrendingUp, PhoneCall, Users, Search, ListFilter, Tag, Truck,
} from "lucide-react";
import { Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, formatINR, formatShortDate, last7DaysRange } from "./DashboardKit";

/**
 * Bellavita's real Cart (abandoned-cart recovery) dashboard -- live
 * aggregates over db_masmis.bb_cart (69,868 rows, confirmed live
 * 2026-09-17), via GET /api/process-performance/bellavita-cart-dashboard.
 * Also embeds an Allocation section over db_masmis.bvo_repeat_allocation
 * (Bellavita's existing "Repeat Allocation" upload type) -- 0 rows live
 * right now, so it renders as an honest empty state rather than a chart
 * full of zeros; it's wired to real data and will fill in the moment
 * someone uploads through that type, no code change needed.
 *
 * See the backend service's own header comment for why "Connected %" uses
 * `disposition` and not the far messier `same_day_connect` column (which
 * mixes several unrelated tagging schemes across upload batches), and why
 * `status` is shown as a Discount Code breakdown rather than a
 * connectivity status.
 */

interface Headline {
  totalCarts: number; cartValue: number; aov: number;
  connectedCount: number; connectedPct: number; uniqueCustomers: number; activeAgents: number;
}
interface TrendRow { date: string; cartCount: number; cartValue: number }
interface DispositionRow { disposition: string; count: number; pct: number }
interface DiscountRow { code: string; count: number }
interface AgentRow { agent: string; cartCount: number; cartValue: number; connectedPct: number }
interface AllocationHeadline { totalAllocation: number; totalValue: number; uniqueCustomers: number }
interface DashboardData {
  headline: Headline; from: string; to: string;
  dateWiseTrend: TrendRow[]; dispositionBreakdown: DispositionRow[]; discountBreakdown: DiscountRow[]; agents: AgentRow[];
  allocation: { headline: AllocationHeadline; hasData: boolean };
}

const DISPOSITION_COLORS = ["#059669", "#e11d48", "#f59e0b"];

type TabKey = "overview" | "agents";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agent-wise" },
];

export function BellavitaCartDashboard() {
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
        `/api/process-performance/bellavita-cart-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Bellavita Cart dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agents ?? [];
    const q = agentSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q));
  }, [data, agentSearch]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { headline, allocation } = data;

  return (
    <div className="space-y-5">
      <DashboardHero
        icon={ShoppingCart} eyebrow="Bellavita · Process Performance" title="Cart Recovery Performance"
        tabs={TABS} activeTab={tab} onTabChange={(key) => setTab(key as TabKey)}
        gradient="from-fuchsia-600 via-rose-500 to-fuchsia-700"
      />

      <DateRangeToolbar
        from={from} to={to} onFrom={setFrom} onTo={setTo}
        onReset={() => { const r = last7DaysRange(); setFrom(r.from); setTo(r.to); }}
        resetLabel="Last 7 Days" accentFocus="focus:border-fuchsia-400"
      />

      {tab === "overview" && (
      <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={ShoppingCart} label="Total Carts" value={headline.totalCarts.toLocaleString("en-IN")} tone="rose" />
        <KpiCard icon={IndianRupee} label="Cart Value" value={formatINR(headline.cartValue)} tone="emerald" />
        <KpiCard icon={TrendingUp} label="AOV" value={formatINR(headline.aov)} tone="violet" />
        <KpiCard icon={PhoneCall} label="Connected %" value={`${headline.connectedPct}%`} tone="teal" />
        <KpiCard icon={Users} label="Unique Customers" value={headline.uniqueCustomers.toLocaleString("en-IN")} tone="sky" />
        <KpiCard icon={Users} label="Active Agents" value={String(headline.activeAgents)} tone="indigo" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
        <SectionCard icon={ShoppingCart} title="Date-wise Cart Recovery" tone="rose">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="bbCartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c026d3" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#c026d3" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} formatter={(value: number, name: string) => (name === "Cart Value" ? formatINR(value) : value)} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="cartValue" name="Cart Value" stroke="#c026d3" strokeWidth={2.5} fill="url(#bbCartFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>
        </div>
        <SectionCard icon={PhoneCall} title="Disposition Breakdown" tone="teal">
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

      {data.discountBreakdown.length > 0 && (
        <SectionCard icon={Tag} title="Discount Code Breakdown" tone="amber">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Code</th>
                  <th className="py-2 pr-0 text-right font-semibold">Uses</th>
                </tr>
              </thead>
              <tbody>
                {data.discountBreakdown.map((d) => (
                  <tr key={d.code} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-amber-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{d.code}</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{d.count.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard
        icon={Truck} title="Repeat Allocation" tone="violet"
        footnote="Bellavita's Repeat Allocation upload type (db_masmis.bvo_repeat_allocation) exists and this section is wired to it, but no file has been uploaded through it yet — these figures will populate automatically the moment one is."
      >
        {allocation.hasData ? (
          <div className="grid grid-cols-3 gap-3">
            <KpiCard icon={ShoppingCart} label="Total Allocation" value={allocation.headline.totalAllocation.toLocaleString("en-IN")} tone="violet" />
            <KpiCard icon={IndianRupee} label="Total Value" value={formatINR(allocation.headline.totalValue)} tone="emerald" />
            <KpiCard icon={Users} label="Unique Customers" value={allocation.headline.uniqueCustomers.toLocaleString("en-IN")} tone="sky" />
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-sm text-slate-400">
            No Repeat Allocation data uploaded yet.
          </div>
        )}
      </SectionCard>
      </>
      )}

      {tab === "agents" && (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Search agent..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-fuchsia-400 focus:outline-none" />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />{filteredAgents.length} of {data.agents.length} agents
          </span>
        </div>
        <SectionCard icon={Users} title="Agent-wise Cart Recovery" tone="rose">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 text-right font-semibold">Cart Count</th>
                  <th className="py-2 pr-3 text-right font-semibold">Cart Value</th>
                  <th className="py-2 pr-0 text-right font-semibold">Connected %</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr key={a.agent} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-fuchsia-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{a.agent}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.cartCount.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(a.cartValue)}</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{a.connectedPct}%</td>
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
