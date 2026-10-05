import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, LineChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  ShoppingCart, PhoneCall, Users, ShoppingBag, IndianRupee, Gauge, Filter,
  ArrowUp, ArrowDown, Layers, Wallet, TrendingUp, ClipboardList, Package, Eye, PhoneOutgoing, Target,
} from "lucide-react";
import {
  Spinner, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  currentMonthRange, formatINR, formatShortDate,
  KPI_TONES, type KpiTone, type ExportSlide,
} from "./DashboardKit";
import { GncDetailDrawer, type DrawerSeries } from "./GncAbandonCartDetailDrawer";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

/**
 * GNC's Abandon Cart Dashboard -- a dedicated cart-recovery view, separate
 * from the Overall Dashboard (which covers all 3 campaigns). Every number
 * here is live from GET /api/process-performance/gnc-abandon-cart-dashboard,
 * built on the same two real tables (db_masmis.gnc_allocation, gnc_sale
 * WHERE campaign = 'Abandon Cart') the Overall Dashboard's funnel uses.
 *
 * Several panels from the reference layout this was modeled on are
 * deliberately left out -- no real source anywhere in this app (see
 * gnc-abandon-cart-dashboard.service.ts for the full list): Target
 * Achievement / Target vs Revenue (now shown from the GNC Targets page, above), RTO orders, Workable/DND case counts,
 * NC Connect, and CPA.
 *
 * The funnel is a plain div bar-chart, not recharts' Funnel -- that
 * component's default proportional-height segments made the smallest real
 * stage (Sale, ~3% of Base) collapse to an unreadable sliver with a clipped
 * label. Equal-height rows with proportional WIDTH read correctly at any
 * value spread and match how a funnel is conventionally drawn.
 *
 * Every chart/KPI has a "View details" action that opens a drawer with that
 * metric's Week-wise and Date-wise breakdown -- built from the daily/weekly
 * rows this page already has in memory (no extra fetch), per this app's
 * Drill-Down Mandate. Top Products has no drill-down: this app has no
 * per-product daily breakdown source, only a whole-range total per product.
 */

interface AbandonCartData {
  from: string; to: string;
  headline: {
    baseCount: number; attempted: number; connected: number; connectedPct: number;
    saleCount: number; revenue: number; aov: number;
    conversionOnBase: number; conversionOnConnect: number; codCount: number; paidCount: number;
  };
  deltas: { baseCount: number | null; connected: number | null; saleCount: number | null; revenue: number | null; conversionOnConnect: number | null };
  snapshot: Array<{ metric: string; value: string }>;
  funnel: Array<{ stage: string; count: number; pctOfBase: number }>;
  dailyTrend: Array<{ date: string; base: number; attempted: number; connected: number; sameDayConnected: number; saleCount: number; revenue: number; codCount: number; paidCount: number }>;
  weeklyTrend: Array<{
    label: string; base: number; attempted: number; connected: number; sameDayConnected: number; saleCount: number; revenue: number; codCount: number; paidCount: number;
    conversionOnBase: number; conversionOnConnect: number;
  }>;
  conversionTrend: Array<{ date: string; conversionOnBase: number; conversionOnConnect: number }>;
  topProducts: Array<{ product: string; saleCount: number; revenue: number; aov: number }>;
  /** Abandon Cart revenue target for the range (Targets page) -- absent/unconfigured until one is set. */
  target?: { tableAvailable: boolean; configured: boolean; monthlyTarget: number | null; rangeTarget: number | null; perAgentMonthlyTarget: number | null; agentCount: number | null; uncoveredMonths: string[]; revenue: number; achPct: number | null };
}

interface AgentRow {
  empId: string; name: string;
  totalAllocation: number; connected: number; notConnected: number; connectedPct: number; sameDayConnected: number;
  saleCount: number; revenue: number; aov: number; codCount: number; paidCount: number; convOnConnectPct: number;
}
interface AgentWiseData { from: string; to: string; agents: AgentRow[] }

const FUNNEL_COLORS = ["#ec4899", "#a855f7", "#3b82f6", "#10b981", "#f59e0b"];
const ORDER_COLORS = ["#f59e0b", "#10b981"];
const TOOLTIP_STYLE = { fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" } as const;

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${up ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(value)}%
    </span>
  );
}

function ViewDetailsBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
    >
      <Eye className="h-3 w-3" /> View details
    </button>
  );
}

function StatTile({ icon: Icon, tone, label, value, sub, delta, onClick }: {
  icon: typeof PhoneCall; tone: KpiTone; label: string; value: string; sub?: string; delta?: number | null; onClick?: () => void;
}) {
  const t = KPI_TONES[tone];
  return (
    <button
      type="button" onClick={onClick} disabled={!onClick}
      className={`relative overflow-hidden rounded-lg border border-slate-100 bg-white p-2 text-left shadow-sm transition-shadow ${onClick ? "cursor-pointer hover:shadow-md" : "cursor-default"}`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${t.accent}`} />
      <div className="flex items-start justify-between pl-1">
        <span className={`flex h-6 w-6 items-center justify-center rounded-md ${t.badge}`}>
          <Icon className="h-3 w-3" />
        </span>
        <DeltaBadge value={delta ?? null} />
      </div>
      <p className={`mt-1 pl-1 text-base font-extrabold leading-tight tracking-tight ${t.value}`}>{value}</p>
      <p className="truncate pl-1 text-[10px] font-semibold leading-tight text-slate-600">{label}</p>
      {sub && <p className="truncate pl-1 text-[9px] leading-tight text-slate-400">vs previous period {sub}</p>}
    </button>
  );
}

/** Equal-height horizontal bars, width proportional to pctOfBase -- see the
 * file-level note for why this replaces recharts' Funnel. */
function CartFunnel({ stages, conversion }: { stages: Array<{ stage: string; count: number; pctOfBase: number }>; conversion?: Array<{ label: string; value: number; sub: string }> }) {
  return (
    <div className="space-y-1">
      {stages.map((s, i) => (
        <div key={s.stage} className="flex items-center gap-2">
          <div
            className="flex h-8 items-center justify-center rounded-md text-xs font-bold text-white shadow-sm"
            style={{ width: `${Math.max(10, s.pctOfBase)}%`, backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }}
          >
            {s.count.toLocaleString("en-IN")}
          </div>
          <div className="text-[10px] leading-tight text-slate-600">
            <span className="font-semibold">{s.stage}</span>
            <span className="ml-1 text-slate-400">({s.pctOfBase}%)</span>
          </div>
        </div>
      ))}
      {conversion && conversion.length > 0 && (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {conversion.map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-2 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-1.5">
              <span className="text-[11px] font-semibold text-violet-700">{c.label}<span className="ml-1 font-normal text-violet-400">{c.sub}</span></span>
              <span className="text-sm font-extrabold text-violet-700">{c.value}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GncAbandonCartDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<AbandonCartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<{ title: string; series: DrawerSeries[] } | null>(null);
  const [agentData, setAgentData] = useState<AgentWiseData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: AbandonCartData }>(
        `/api/process-performance/gnc-abandon-cart-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Abandon Cart dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    hrmsApi
      .get<{ success: boolean; data: AgentWiseData }>(`/api/process-performance/gnc-abandon-cart-dashboard/agent-wise?from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setAgentData(res.data); })
      .catch(() => { if (!cancelled) setAgentData(null); });
    return () => { cancelled = true; };
  }, [from, to]);

  // Excel-style sort + filter for the Agent Wise Performance table -- hooks must run every
  // render, so this is computed before the early returns further down that guard on `data`.
  const AGENT_FILTER_COLS: Array<FilterColumn<AgentRow>> = [
    { key: "name", get: (a) => a.name }, { key: "totalAllocation", get: (a) => a.totalAllocation },
    { key: "connected", get: (a) => a.connected }, { key: "notConnected", get: (a) => a.notConnected },
    { key: "connectedPct", get: (a) => a.connectedPct }, { key: "sameDayConnected", get: (a) => a.sameDayConnected },
    { key: "saleCount", get: (a) => a.saleCount }, { key: "revenue", get: (a) => a.revenue }, { key: "aov", get: (a) => a.aov },
    { key: "codCount", get: (a) => a.codCount }, { key: "paidCount", get: (a) => a.paidCount }, { key: "convOnConnectPct", get: (a) => a.convOnConnectPct },
  ];
  const agentColGetter = (a: AgentRow, key: string) => AGENT_FILTER_COLS.find((c) => c.key === key)?.get(a);
  const agentFilters = useColumnFilters(agentData?.agents ?? [], AGENT_FILTER_COLS);
  const { sorted: sortedAgents, sortKey: agentSortKey, sortDir: agentSortDir, toggleSort: toggleAgentSort } = useSortableRows(agentFilters.filtered, agentColGetter);

  // Excel-style sort + filter for the Top Products table -- hooks must run every render, so this is computed before
  // the early returns further down that guard on `data` being loaded.
  type TopProductRow = AbandonCartData["topProducts"][number];
  const TOP_PRODUCT_FILTER_COLS: Array<FilterColumn<TopProductRow>> = [
    { key: "product", get: (p) => p.product }, { key: "saleCount", get: (p) => p.saleCount },
    { key: "revenue", get: (p) => p.revenue }, { key: "aov", get: (p) => p.aov },
  ];
  const topProductColGetter = (p: TopProductRow, key: string) => TOP_PRODUCT_FILTER_COLS.find((c) => c.key === key)?.get(p);
  const topProductFilters = useColumnFilters(data?.topProducts ?? [], TOP_PRODUCT_FILTER_COLS);
  const { sorted: sortedTopProducts, sortKey: topProductSortKey, sortDir: topProductSortDir, toggleSort: toggleTopProductSort } = useSortableRows(topProductFilters.filtered, topProductColGetter);

  // One enriched daily/weekly dataset backs every "View details" drawer --
  // connectedPct/aov aren't in the raw API rows, so they're derived once
  // here instead of duplicated per-drawer.
  const dailyEnriched = useMemo(() => {
    if (!data) return [];
    const convByDate = new Map(data.conversionTrend.map((c) => [c.date, c]));
    return data.dailyTrend.map((d) => ({
      ...d,
      connectedPct: d.base > 0 ? Math.round((d.connected / d.base) * 1000) / 10 : 0,
      sameDayConnectedPct: d.base > 0 ? Math.round((d.sameDayConnected / d.base) * 1000) / 10 : 0,
      aov: d.saleCount > 0 ? Math.round((d.revenue / d.saleCount) * 100) / 100 : 0,
      conversionOnBase: convByDate.get(d.date)?.conversionOnBase ?? 0,
      conversionOnConnect: convByDate.get(d.date)?.conversionOnConnect ?? 0,
    }));
  }, [data]);
  const weeklyEnriched = useMemo(() => {
    if (!data) return [];
    return data.weeklyTrend.map((w) => ({
      ...w,
      connectedPct: w.base > 0 ? Math.round((w.connected / w.base) * 1000) / 10 : 0,
      sameDayConnectedPct: w.base > 0 ? Math.round((w.sameDayConnected / w.base) * 1000) / 10 : 0,
      aov: w.saleCount > 0 ? Math.round((w.revenue / w.saleCount) * 100) / 100 : 0,
    }));
  }, [data]);

  const openDrawer = (title: string, series: DrawerSeries[]) => setDrawer({ title, series });

  const ordersDonut = useMemo(() => {
    if (!data) return [];
    const { codCount, paidCount } = data.headline;
    const total = codCount + paidCount;
    if (total <= 0) return [];
    return [
      { name: `COD — ${Math.round((codCount / total) * 100)}%`, value: codCount },
      { name: `Prepaid — ${Math.round((paidCount / total) * 100)}%`, value: paidCount },
    ];
  }, [data]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    return [{
      title: "Abandon Cart",
      kpis: [
        { label: "Overall Base Count", value: data.headline.baseCount.toLocaleString("en-IN") },
        { label: "Attempted", value: data.headline.attempted.toLocaleString("en-IN") },
        { label: "Unique Connected", value: data.headline.connected.toLocaleString("en-IN") },
        { label: "Unique Connected %", value: `${data.headline.connectedPct}%` },
        { label: "Total Sales", value: data.headline.saleCount.toLocaleString("en-IN") },
        { label: "Revenue", value: formatINR(data.headline.revenue) },
        { label: "AOV", value: formatINR(data.headline.aov) },
        { label: "Conversion on Base %", value: `${data.headline.conversionOnBase}%` },
        { label: "Conversion on Unique Connect %", value: `${data.headline.conversionOnConnect}%` },
      ],
      tables: [
        { title: "Abandon Cart Snapshot", columns: ["Metric", "Value"], rows: data.snapshot.map((s) => [s.metric, s.value]) },
        { title: "Call Funnel", columns: ["Stage", "Count", "% of Base"], rows: data.funnel.map((f) => [f.stage, f.count, `${f.pctOfBase}%`]) },
        { title: "Daily Trend", columns: ["Date", "Base", "Attempted", "Connected", "Sale Count", "Revenue"], rows: data.dailyTrend.map((d) => [formatShortDate(d.date), d.base, d.attempted, d.connected, d.saleCount, formatINR(d.revenue)]) },
        { title: "Week Wise Comparison", columns: ["Week", "Sale Count", "Revenue"], rows: data.weeklyTrend.map((w) => [w.label, w.saleCount, formatINR(w.revenue)]) },
        { title: "Top Products", columns: ["Product", "Sale Count", "Revenue", "AOV"], rows: data.topProducts.map((p) => [p.product, p.saleCount, formatINR(p.revenue), formatINR(p.aov)]) },
        ...(agentData && agentData.agents.length > 0 ? [{
          title: "Agent Wise Performance",
          columns: ["Agent", "Emp ID", "Total Allocation", "Connected", "Not Connected", "Connected %", "Same Day Connected", "Sale Count", "Revenue", "AOV", "COD", "Prepaid", "Conv % (Connect)"],
          rows: agentData.agents.map((a) => [
            a.name, a.empId, a.totalAllocation, a.connected, a.notConnected, `${a.connectedPct}%`, a.sameDayConnected,
            a.saleCount, formatINR(a.revenue), formatINR(a.aov), a.codCount, a.paidCount, `${a.convOnConnectPct}%`,
          ]),
        }] : []),
      ],
    }];
  }, [data, agentData]);

  if (loading && !data) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const h = data.headline;

  return (
    <div className="space-y-3">
      <DashboardHero<"overview">
        icon={ShoppingCart} eyebrow="GNC · Process Performance" title="Abandon Cart Dashboard"
        tabs={[{ key: "overview", label: "Overview" }]} activeTab="overview" onTabChange={() => {}}
        gradient="from-pink-600 via-rose-600 to-pink-700"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle="GNC — Abandon Cart Dashboard"
          fileBaseName="GNC_Abandon_Cart"
          raw={{ dashboard: "gnc_abandon_cart", from, to }}
          subtitle={`${from} to ${to}`}
          slides={exportSlides}
          activeSlideTitle="Abandon Cart"
        />
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
        />
      </div>

      {/* Headline KPIs -- every card opens its own week/date drill-down */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile icon={ShoppingCart} tone="rose" label="Base Count" value={h.baseCount.toLocaleString("en-IN")} delta={data.deltas.baseCount}
          onClick={() => openDrawer("Overall Base Count", [{ key: "base", label: "Base", fmt: "int", color: "#ec4899" }])} />
        <StatTile icon={PhoneOutgoing} tone="amber" label="Attempted" value={h.attempted.toLocaleString("en-IN")}
          onClick={() => openDrawer("Attempted", [{ key: "attempted", label: "Attempted", fmt: "int", color: "#a855f7" }])} />
        <StatTile icon={PhoneCall} tone="indigo" label="Unique Connected" value={h.connected.toLocaleString("en-IN")} delta={data.deltas.connected}
          onClick={() => openDrawer("Unique Connected", [{ key: "connected", label: "Connected", fmt: "int", color: "#3b82f6" }])} />
        <StatTile icon={Users} tone="sky" label="Connected %" value={`${h.connectedPct}%`}
          onClick={() => openDrawer("Unique Connected %", [{ key: "connectedPct", label: "Connected %", fmt: "pct", color: "#0ea5e9" }])} />
        <StatTile icon={ShoppingBag} tone="emerald" label="Total Sales" value={h.saleCount.toLocaleString("en-IN")} delta={data.deltas.saleCount}
          onClick={() => openDrawer("Total Sales", [{ key: "saleCount", label: "Sale Count", fmt: "int", color: "#10b981" }])} />
        <StatTile icon={IndianRupee} tone="teal" label="Revenue" value={formatINR(h.revenue)} delta={data.deltas.revenue}
          onClick={() => openDrawer("Revenue", [{ key: "revenue", label: "Revenue", fmt: "currency", color: "#14b8a6" }])} />
        <StatTile icon={Wallet} tone="cyan" label="AOV" value={formatINR(h.aov)}
          onClick={() => openDrawer("AOV (Average Order Value)", [{ key: "aov", label: "AOV", fmt: "currency", color: "#06b6d4" }])} />
        <StatTile icon={Gauge} tone="violet" label="Conv. (Connect)" value={`${h.conversionOnConnect}%`} delta={data.deltas.conversionOnConnect}
          onClick={() => openDrawer("Conversion on Unique Connect", [{ key: "conversionOnConnect", label: "Conversion %", fmt: "pct", color: "#8b5cf6" }])} />
      </div>

      {data.target?.configured && data.target.rangeTarget !== null && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile icon={Target} tone="sky" label="Monthly Target" value={data.target.monthlyTarget !== null ? formatINR(data.target.monthlyTarget) : "—"} />
          <StatTile icon={Target} tone="indigo" label="Target (range)" value={formatINR(data.target.rangeTarget)} />
          <StatTile icon={Gauge} tone={(data.target.achPct ?? 0) >= 100 ? "emerald" : (data.target.achPct ?? 0) >= 60 ? "amber" : "rose"} label="Target Achi %" value={data.target.achPct === null ? "—" : `${data.target.achPct}%`} />
          <StatTile icon={IndianRupee} tone="rose" label="Gap to target" value={formatINR(Math.max(0, data.target.rangeTarget - data.target.revenue))} />
        </div>
      )}

      {/* Snapshot + Funnel */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard
          icon={ClipboardList} title="Abandon Cart Snapshot" tone="rose"
          action={<ViewDetailsBtn onClick={() => openDrawer("Abandon Cart Snapshot", [
            { key: "base", label: "Overall Base count", fmt: "int", color: "#ec4899" },
            { key: "attempted", label: "Overall Unique attempted", fmt: "int", color: "#a855f7" },
            { key: "connected", label: "Overall Unique connected", fmt: "int", color: "#3b82f6" },
            { key: "connectedPct", label: "Overall Unique connected %", fmt: "pct", color: "#0ea5e9" },
            { key: "sameDayAttempted", dataKey: "attempted", label: "Same Day Unique Attempt", fmt: "int", color: "#f472b6" },
            { key: "sameDayConnected", label: "Same Day Unique Connect", fmt: "int", color: "#10b981" },
            { key: "sameDayConnectedPct", label: "Same Day Unique Connect %", fmt: "pct", color: "#059669" },
          ])} />}
        >
          <table className="w-full text-xs">
            <tbody>
              {data.snapshot.map((s, i) => (
                <tr key={s.metric} className={`border-b border-slate-50 last:border-0 ${i % 2 === 1 ? "bg-rose-50/30" : "bg-white"}`}>
                  <td className="py-1.5 pl-2 pr-3 font-medium text-slate-600">{s.metric}</td>
                  <td className="py-1.5 pr-2 text-right font-bold text-slate-800">{s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
        <SectionCard
          icon={Filter} title="Call Funnel" tone="rose"
          footnote="Total Allocation → Attempted → Connected → Same Day Connected → Sale. Attempted/Connected are dialer row counts, not deduplicated by customer."
          action={<ViewDetailsBtn onClick={() => openDrawer("Call Funnel", [
            { key: "base", label: "Total Allocation", fmt: "int", color: "#ec4899" },
            { key: "attempted", label: "Attempted", fmt: "int", color: "#a855f7" },
            { key: "connected", label: "Connected", fmt: "int", color: "#3b82f6" },
            { key: "sameDayConnected", label: "Same Day Connected", fmt: "int", color: "#10b981" },
            { key: "saleCount", label: "Sale", fmt: "int", color: "#f59e0b" },
          ])} />}
        >
          <CartFunnel stages={data.funnel} conversion={[
            { label: "Conv. %", value: data.headline.conversionOnBase, sub: "Sale ÷ Total Allocation" },
            { label: "Conv. % (Connect)", value: data.headline.conversionOnConnect, sub: "Sale ÷ Connected" },
          ]} />
        </SectionCard>
      </div>

      {/* Daily Trend */}
      <SectionCard
        icon={TrendingUp} title="Daily Trend" tone="indigo"
        footnote="Base/Attempted/Connected from gnc_allocation; Sale Count and Revenue from gnc_sale (Abandon Cart only)."
        action={<ViewDetailsBtn onClick={() => openDrawer("Daily Trend", [
          { key: "base", label: "Base", fmt: "int", color: "#ec4899" },
          { key: "attempted", label: "Attempted", fmt: "int", color: "#a855f7" },
          { key: "connected", label: "Connected", fmt: "int", color: "#3b82f6" },
          { key: "saleCount", label: "Sale Count", fmt: "int", color: "#6366f1" },
          { key: "revenue", label: "Revenue", fmt: "currency", color: "#f59e0b" },
        ])} />}
      >
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data.dailyTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} />
            <Tooltip
              labelFormatter={(v: unknown) => formatShortDate(String(v))}
              formatter={(value: number, name: string) => (name === "Revenue" ? formatINR(value) : value)}
              contentStyle={TOOLTIP_STYLE}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar yAxisId="l" dataKey="base" name="Base" fill="#fbcfe8" radius={[3, 3, 0, 0]} />
            <Bar yAxisId="l" dataKey="attempted" name="Attempted" fill="#f9a8d4" radius={[3, 3, 0, 0]} />
            <Bar yAxisId="l" dataKey="connected" name="Connected" fill="#ec4899" radius={[3, 3, 0, 0]} />
            <Line yAxisId="l" type="monotone" dataKey="saleCount" name="Sale Count" stroke="#6366f1" strokeWidth={2} dot={false} />
            <Line yAxisId="r" type="monotone" dataKey="revenue" name="Revenue" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Sales + Conversion metrics */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard
          icon={ShoppingBag} title="Sales Metrics" tone="emerald"
          action={<ViewDetailsBtn onClick={() => openDrawer("Sales Metrics", [
            { key: "saleCount", label: "Sale Count", fmt: "int", color: "#10b981" },
            { key: "revenue", label: "Revenue", fmt: "currency", color: "#14b8a6" },
            { key: "aov", label: "AOV", fmt: "currency", color: "#06b6d4" },
            { key: "conversionOnBase", label: "Conv. % (Base)", fmt: "pct", color: "#8b5cf6" },
            { key: "conversionOnConnect", label: "Conv. % (Connect)", fmt: "pct", color: "#6366f1" },
          ])} />}
        >
          <div className="mb-2 grid grid-cols-2 gap-2">
            <StatTile icon={ShoppingBag} tone="emerald" label="Sale Count" value={h.saleCount.toLocaleString("en-IN")} delta={data.deltas.saleCount} />
            <StatTile icon={IndianRupee} tone="teal" label="Revenue" value={formatINR(h.revenue)} delta={data.deltas.revenue} />
            <StatTile icon={Gauge} tone="violet" label="Conv. % (Base)" value={`${h.conversionOnBase}%`} />
            <StatTile icon={Gauge} tone="indigo" label="Conv. % (Connect)" value={`${h.conversionOnConnect}%`} delta={data.deltas.conversionOnConnect} />
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={data.dailyTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} formatter={(value: number, name: string) => (name === "Revenue" ? formatINR(value) : value)} contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="r" dataKey="revenue" name="Revenue" fill="#a7f3d0" radius={[3, 3, 0, 0]} />
              <Line yAxisId="l" type="monotone" dataKey="saleCount" name="Sale Count" stroke="#047857" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard
          icon={Gauge} title="Conversion Metrics" tone="violet"
          action={<ViewDetailsBtn onClick={() => openDrawer("Conversion Metrics", [
            { key: "conversionOnBase", label: "Conv. on Base %", fmt: "pct", color: "#8b5cf6" },
            { key: "conversionOnConnect", label: "Conv. on Connect %", fmt: "pct", color: "#0ea5e9" },
          ])} />}
        >
          <div className="mb-2 grid grid-cols-2 gap-2">
            <StatTile icon={Gauge} tone="violet" label="Conv. on Base" value={`${h.conversionOnBase}%`} />
            <StatTile icon={Gauge} tone="indigo" label="Conv. on Connect" value={`${h.conversionOnConnect}%`} delta={data.deltas.conversionOnConnect} />
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={data.conversionTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} unit="%" />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} formatter={(value: number) => `${value}%`} contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="conversionOnBase" name="Conv. on Base %" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="conversionOnConnect" name="Conv. on Connect %" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      {/* Orders + Week comparison + Top products */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard
          icon={Wallet} title="Orders Breakdown" tone="amber"
          footnote="COD and Prepaid only -- gnc_sale has no RTO/delivery-outcome column."
          action={<ViewDetailsBtn onClick={() => openDrawer("Orders Breakdown", [
            { key: "codCount", label: "COD", fmt: "int", color: "#f59e0b" },
            { key: "paidCount", label: "Prepaid", fmt: "int", color: "#10b981" },
          ])} />}
        >
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={ordersDonut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={64} paddingAngle={2}>
                {ordersDonut.map((_, i) => <Cell key={i} fill={ORDER_COLORS[i % ORDER_COLORS.length]} stroke="white" strokeWidth={2} />)}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard
          icon={Layers} title="Week Wise Comparison" tone="teal"
          action={<ViewDetailsBtn onClick={() => openDrawer("Week Wise Comparison", [
            { key: "saleCount", label: "Sale Count", fmt: "int", color: "#0d9488" },
            { key: "revenue", label: "Revenue", fmt: "currency", color: "#5eead4" },
          ])} />}
        >
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={data.weeklyTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} />
              <Tooltip formatter={(value: number, name: string) => (name === "Revenue" ? formatINR(value) : value)} contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="r" dataKey="revenue" name="Revenue" fill="#5eead4" radius={[3, 3, 0, 0]} />
              <Line yAxisId="l" type="monotone" dataKey="saleCount" name="Sale Count" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard
          icon={Package} title="Top Products" tone="sky" footnote="Whole-range totals only -- no daily breakdown per product exists in this app, so this table has no View details drill-down."
          action={topProductFilters.activeCount > 0 ? (
            <button type="button" onClick={topProductFilters.clearAll} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20">
              Clear {topProductFilters.activeCount} filter{topProductFilters.activeCount > 1 ? "s" : ""}
            </button>
          ) : undefined}
        >
          <div className="max-h-44 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-sky-800 text-[10px] uppercase tracking-wide text-white">
                  <FilterSortTh label="Product" columnKey="product" sortKey={topProductSortKey} sortDir={topProductSortDir} onSort={toggleTopProductSort} filters={topProductFilters} className="py-1.5 px-2 text-left font-bold text-white" />
                  <FilterSortTh label="Sales" columnKey="saleCount" sortKey={topProductSortKey} sortDir={topProductSortDir} onSort={toggleTopProductSort} filters={topProductFilters} className="py-1.5 px-2 text-right font-bold text-white" />
                  <FilterSortTh label="Revenue" columnKey="revenue" sortKey={topProductSortKey} sortDir={topProductSortDir} onSort={toggleTopProductSort} filters={topProductFilters} className="py-1.5 px-2 text-right font-bold text-white" />
                </tr>
              </thead>
              <tbody>
                {sortedTopProducts.map((p, i) => (
                  <tr key={p.product} className={`border-b border-slate-50 last:border-0 ${i % 2 === 1 ? "bg-sky-50/30" : "bg-white"}`}>
                    <td className="max-w-[140px] truncate py-1.5 px-2 font-medium text-slate-700" title={p.product}>{p.product}</td>
                    <td className="py-1.5 px-2 text-right text-slate-600">{p.saleCount}</td>
                    <td className="py-1.5 px-2 text-right font-semibold text-slate-800">{formatINR(p.revenue)}</td>
                  </tr>
                ))}
                {sortedTopProducts.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-slate-400">{(data?.topProducts.length ?? 0) === 0 ? "No data for this period." : "No products match the current filters."}</td></tr>}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        icon={Users} title="Agent Wise Performance" tone="indigo"
        footnote="Total Allocation / Connected from gnc_allocation; Sale Count, Revenue and Orders from gnc_sale (Abandon Cart only), merged by agent."
        action={agentFilters.activeCount > 0 ? (
          <button type="button" onClick={agentFilters.clearAll} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20">
            Clear {agentFilters.activeCount} filter{agentFilters.activeCount > 1 ? "s" : ""}
          </button>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <FilterSortTh label="Agent" columnKey="name" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-left font-bold" />
                <FilterSortTh label="Allocation" columnKey="totalAllocation" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="Connected" columnKey="connected" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="Not Connected" columnKey="notConnected" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="Connected %" columnKey="connectedPct" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="Same Day Conn." columnKey="sameDayConnected" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="Sale Count" columnKey="saleCount" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="Revenue" columnKey="revenue" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="AOV" columnKey="aov" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="COD" columnKey="codCount" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="Prepaid" columnKey="paidCount" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-2 text-right font-bold" />
                <FilterSortTh label="Conv % (Connect)" columnKey="convOnConnectPct" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 px-0 text-right font-bold" />
              </tr>
            </thead>
            <tbody>
              {sortedAgents.map((a) => (
                <tr key={a.empId} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/40">
                  <td className="py-2 px-2"><div className="font-medium text-slate-700">{a.name}</div><div className="text-[10px] text-slate-400">{a.empId}</div></td>
                  <td className="py-2 px-2 text-right text-slate-600">{a.totalAllocation.toLocaleString("en-IN")}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{a.connected.toLocaleString("en-IN")}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{a.notConnected.toLocaleString("en-IN")}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{a.connectedPct}%</td>
                  <td className="py-2 px-2 text-right text-slate-600">{a.sameDayConnected.toLocaleString("en-IN")}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{a.saleCount.toLocaleString("en-IN")}</td>
                  <td className="py-2 px-2 text-right font-semibold text-slate-800">{formatINR(a.revenue)}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{formatINR(a.aov)}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{a.codCount}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{a.paidCount}</td>
                  <td className="py-2 px-0 text-right font-semibold text-indigo-700">{a.convOnConnectPct}%</td>
                </tr>
              ))}
              {sortedAgents.length === 0 && (
                <tr><td colSpan={12} className="py-6 text-center text-slate-400">{(agentData?.agents.length ?? 0) === 0 ? "No agent data for this period." : "No agents match the current filters."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {drawer && (
        <GncDetailDrawer
          title={drawer.title} eyebrow="GNC Abandon Cart · Week-wise & Date-wise" series={drawer.series}
          dailyRows={dailyEnriched} weeklyRows={weeklyEnriched}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
