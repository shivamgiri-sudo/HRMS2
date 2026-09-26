import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  ComposedChart, Bar, Line, PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  ShoppingCart, PhoneCall, TrendingUp, ShoppingBag, IndianRupee, Percent, Trophy,
  PhoneOff, Ban, Loader2, Wallet, Package, ArrowUpRight, ArrowDownRight, ListFilter,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";
import { BellavitaCartTargetTable } from "./BellavitaCartTargetTable";
import { KpiCard, SectionCard, formatINR, type KpiTone, PeriodSection, type PeriodWeek, type PeriodRow } from "./DashboardKit";
import type { CartHeadline, CartTrendRow, CartTopProduct } from "./BellavitaCartDashboard";

/**
 * Bellavita Abandon Cart "Overview" -- every headline KPI the backend
 * computes (getBellavitaCartDashboard), laid out to match the reference
 * Power-BI-style mockup the user supplied 2026-09-23: a colourful KPI card
 * row, a funnel + snapshot table + daily trend row, sales/conversion/
 * revenue metric cards, and orders/week-comparison/top-products cards.
 *
 * Two things in the reference have no honest real-data source in this app
 * and are deliberately left out rather than faked:
 * - "All Campaigns" / "All LOB / Process" filters: bb_cart has no campaign
 *   or lob column at all (confirmed via SHOW COLUMNS). "Top Campaigns /
 *   Products" below is Products only, from bb_cart.variant_title.
 * - The decorative header photo: not a data element, and no real brand
 *   asset was supplied -- this page keeps the app's own DashboardHero
 *   gradient banner instead of inventing a stock image.
 *
 * A click on any KPI card opens that metric's own date-wise + week-wise
 * trend, read from the same dateWiseTrend rows the parent already fetched.
 * Each card also compares against the immediately preceding period of equal
 * length (a second, real fetch of this same endpoint) -- shown as "vs
 * previous period" rather than a hardcoded "vs previous week", since the
 * comparison window matches whatever range is actually selected.
 */

const DISPOSITION_COLORS = ["#e11d48", "#f59e0b", "#0ea5e9", "#8b5cf6", "#059669", "#64748b"];
const FUNNEL_COLORS = ["#e11d48", "#f43f5e", "#f59e0b", "#10b981", "#0ea5e9"];

function weekBucket(iso: string): { key: string; label: string } {
  const day = Number(iso.slice(8, 10));
  const monthKey = iso.slice(0, 7);
  const weekNum = Math.ceil(day / 7);
  const startDay = (weekNum - 1) * 7 + 1;
  const daysInMonth = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate();
  const endDay = Math.min(startDay + 6, daysInMonth);
  const monLabel = new Date(iso).toLocaleDateString("en-IN", { month: "short" });
  return { key: `${monthKey}-W${weekNum}`, label: `W-${weekNum} (${startDay}-${endDay} ${monLabel})` };
}
const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};
const round1 = (v: number) => Math.round(v * 10) / 10;

/** [from,to] shifted back by its own span, immediately preceding it --
 * "previous period" for the KPI cards' comparison chips. */
function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = new Date(from), t = new Date(to);
  const spanDays = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const prevTo = new Date(f); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (spanDays - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

type NumericTrendField = { [K in keyof CartTrendRow]: CartTrendRow[K] extends number ? K : never }[keyof CartTrendRow];
type Drill =
  | { kind: "sum"; field: NumericTrendField; fmt: "count" | "currency" }
  | { kind: "ratio"; num: NumericTrendField; den: NumericTrendField };

interface KpiDef {
  key: string; label: string; icon: ComponentType<{ className?: string }>; tone: KpiTone;
  value: string; sub?: string; drill?: Drill;
  prevValue?: number; currValue?: number; deltaFmt?: "pct" | "pp";
}

function fmtDrillValue(v: number, fmt: "count" | "currency" | "pct"): string {
  if (fmt === "currency") return formatINR(v);
  if (fmt === "pct") return `${round1(v)}%`;
  return v.toLocaleString("en-IN");
}
function drillValueForRows(drill: Drill, rows: CartTrendRow[]): { value: number; fmt: "count" | "currency" | "pct" } {
  if (drill.kind === "sum") return { value: rows.reduce((s, r) => s + (r[drill.field] as number), 0), fmt: drill.fmt };
  const num = rows.reduce((s, r) => s + (r[drill.num] as number), 0);
  const den = rows.reduce((s, r) => s + (r[drill.den] as number), 0);
  return { value: den > 0 ? round1((num / den) * 100) : 0, fmt: "pct" };
}

/** Small delta chip: real % change vs the previous period, or nothing while
 * that second fetch is still in flight / unavailable -- never a fabricated 0%. */
function DeltaChip({ curr, prev }: { curr?: number; prev?: number }) {
  if (curr === undefined || prev === undefined) return null;
  if (prev === 0) return null;
  const delta = round1(((curr - prev) / prev) * 100);
  if (delta === 0) return <span className="text-[9px] font-semibold text-slate-400">flat vs previous period</span>;
  const up = delta > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold ${up ? "text-emerald-600" : "text-red-500"}`}>
      <Icon className="h-2.5 w-2.5" />{Math.abs(delta)}% vs previous period
    </span>
  );
}

/** Groups the per-day trend rows into W-1.. week rows (each with its own day rows) for PeriodSection. */
function cartPeriodWeeks(rows: CartTrendRow[], metrics: ChartMetric[]): PeriodWeek[] {
  const toRow = (key: string, label: string, dayRows: CartTrendRow[]): PeriodRow => {
    const vals = metrics.map((m) => drillValueForRows(m.drill, dayRows));
    return { key, label, cells: vals.map((v) => fmtDrillValue(v.value, v.fmt)), raw: vals.map((v) => v.value) };
  };
  const byWeek = new Map<string, CartTrendRow[]>();
  for (const r of rows) {
    const k = weekBucket(r.date).key;
    byWeek.set(k, [...(byWeek.get(k) ?? []), r]);
  }
  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, dayRows]) => ({
    ...toRow(key, weekBucket(dayRows[0].date).label, dayRows),
    days: dayRows.map((r) => toRow(r.date, formatShortDate(r.date), [r])),
  }));
}

function KpiDrawer({
  kpi, rows, onClose,
}: { kpi: (KpiDef & { drill: Drill }) | null; rows: CartTrendRow[]; onClose: () => void }) {
  const periodWeeks = useMemo<PeriodWeek[]>(
    () => (kpi ? cartPeriodWeeks(rows, [{ key: "kpi", label: kpi.label, drill: kpi.drill }]) : []),
    [kpi, rows],
  );

  return (
    <Sheet open={!!kpi} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-xl overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fuchsia-700">KPI</span>
            <SheetTitle className="text-base font-bold text-slate-800">{kpi?.label}</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] text-slate-400">Week-wise and date-wise trend for this metric.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 py-4">
          {!kpi && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {kpi && (
            <PeriodSection
              metricLabels={[kpi.label]} weeks={periodWeeks} fileBase={`Bellavita_Cart_${kpi.label}`} accentClass="text-fuchsia-700"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface ChartMetric { key: string; label: string; drill: Drill }
interface ChartDetail {
  title: string; overall: Array<{ label: string; value: string }>; metrics: ChartMetric[];
  /** A larger render of the same chart shown on its card -- rendered at the
   * top of the drawer so the popup shows the chart itself, not just tables. */
  renderChart?: () => ReactNode;
}

/** Small right-aligned "View Details" trigger, placed as the first thing
 * inside a SectionCard's own children (SectionCard itself has no action
 * slot) -- opens that chart's own ChartDetailsDrawer. */
function ViewDetailsButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="mb-2 flex justify-end">
      <button
        type="button" onClick={onClick}
        className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-fuchsia-50 hover:text-fuchsia-700"
      >
        <ListFilter className="h-3 w-3" />View Details
      </button>
    </div>
  );
}

/** Right-side drill-down for one whole chart card: every metric that chart
 * shows, each broken down date-wise and week-wise (same dateWiseTrend rows
 * every other drawer on this page reads), plus that chart's own "Overall
 * KPIs" for the selected range as a whole. One shared drawer for every
 * chart on the page, driven purely by the ChartDetail config passed in. */
function ChartDetailsDrawer({
  chart, rows, onClose,
}: { chart: ChartDetail | null; rows: CartTrendRow[]; onClose: () => void }) {
  const periodWeeks = useMemo<PeriodWeek[]>(() => (chart ? cartPeriodWeeks(rows, chart.metrics) : []), [chart, rows]);

  return (
    <Sheet open={!!chart} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-4xl overflow-y-auto p-0 sm:max-w-4xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fuchsia-700">Chart</span>
            <SheetTitle className="text-base font-bold text-slate-800">{chart?.title}</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] text-slate-400">Enlarged chart, overall KPIs, week-wise and date-wise detail for every metric on this chart.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 py-4">
          {!chart && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {chart && (
            <>
              {chart.renderChart && (
                <div className="rounded-xl border border-slate-100 bg-white p-3">
                  {chart.renderChart()}
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Overall KPIs</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {chart.overall.map((o) => (
                    <div key={o.label} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                      <p className="text-sm font-bold text-slate-800">{o.value}</p>
                      <p className="text-[10px] text-slate-500">{o.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Week-wise / Date-wise</p>
                <PeriodSection
                  metricLabels={chart.metrics.map((m) => m.label)} weeks={periodWeeks}
                  fileBase={`Bellavita_Cart_${chart.title}`} accentClass="text-fuchsia-700"
                  leadSheets={[{ name: "Overall KPIs", columns: ["KPI", "Value"], rows: chart.overall.map((o) => [o.label, o.value]) }]}
                />
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface OverviewData {
  headline: CartHeadline; from: string; to: string;
  dateWiseTrend: CartTrendRow[];
  dispositionBreakdown: Array<{ disposition: string; count: number; pct: number }>;
  discountBreakdown: Array<{ code: string; count: number }>;
  topProducts: CartTopProduct[];
}

export function BellavitaCartOverview({ data }: { data: OverviewData }) {
  const [drawerKpi, setDrawerKpi] = useState<(KpiDef & { drill: Drill }) | null>(null);
  const [drawerChart, setDrawerChart] = useState<ChartDetail | null>(null);
  const [prevHeadline, setPrevHeadline] = useState<CartHeadline | null>(null);
  const h = data.headline;

  const loadPrevious = useCallback(async () => {
    setPrevHeadline(null);
    const { from, to } = previousPeriod(data.from, data.to);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { headline: CartHeadline } }>(
        `/api/process-performance/bellavita-cart-dashboard?from=${from}&to=${to}`,
      );
      setPrevHeadline(res.data.headline);
    } catch {
      setPrevHeadline(null);
    }
  }, [data.from, data.to]);
  useEffect(() => { void loadPrevious(); }, [loadPrevious]);

  const conversionOnBasePct = h.totalCarts > 0 ? round1((h.abandonCartSaleCount / h.totalCarts) * 100) : 0;
  const conversionOnUniqueConnectPct = h.uniqueCallConnectedCount > 0 ? round1((h.abandonCartSaleCount / h.uniqueCallConnectedCount) * 100) : 0;
  const prevConversionOnBasePct = prevHeadline && prevHeadline.totalCarts > 0 ? round1((prevHeadline.abandonCartSaleCount / prevHeadline.totalCarts) * 100) : undefined;
  const prevConversionOnUniqueConnectPct = prevHeadline && prevHeadline.uniqueCallConnectedCount > 0 ? round1((prevHeadline.abandonCartSaleCount / prevHeadline.uniqueCallConnectedCount) * 100) : undefined;

  const kpis: KpiDef[] = [
    { key: "totalCarts", label: "Overall Base Count", icon: ShoppingCart, tone: "rose", value: h.totalCarts.toLocaleString("en-IN"), drill: { kind: "sum", field: "cartCount", fmt: "count" }, currValue: h.totalCarts, prevValue: prevHeadline?.totalCarts },
    { key: "uniqueConnected", label: "Unique Connected", icon: PhoneCall, tone: "blue", value: h.uniqueCallConnectedCount.toLocaleString("en-IN"), drill: { kind: "sum", field: "uniqueCallConnectedCount", fmt: "count" }, currValue: h.uniqueCallConnectedCount, prevValue: prevHeadline?.uniqueCallConnectedCount },
    { key: "uniqueConnectedPct", label: "Unique Connected %", icon: TrendingUp, tone: "emerald", value: `${h.uniqueCallConnectedPct}%`, drill: { kind: "ratio", num: "uniqueCallConnectedCount", den: "uniqueCallCount" }, currValue: h.uniqueCallConnectedPct, prevValue: prevHeadline?.uniqueCallConnectedPct },
    { key: "totalSales", label: "Total Sales", icon: ShoppingBag, tone: "teal", value: h.abandonCartSaleCount.toLocaleString("en-IN"), drill: { kind: "sum", field: "abandonCartSaleCount", fmt: "count" }, currValue: h.abandonCartSaleCount, prevValue: prevHeadline?.abandonCartSaleCount },
    { key: "revenue", label: "Revenue", icon: IndianRupee, tone: "violet", value: formatINR(h.abandonCartRevenue), drill: { kind: "sum", field: "abandonCartRevenue", fmt: "currency" }, currValue: h.abandonCartRevenue, prevValue: prevHeadline?.abandonCartRevenue },
    { key: "conversionUniqueConnect", label: "Conversion (Unique Connect)", icon: Percent, tone: "cyan", value: `${conversionOnUniqueConnectPct}%`, drill: { kind: "ratio", num: "abandonCartSaleCount", den: "uniqueCallConnectedCount" }, currValue: conversionOnUniqueConnectPct, prevValue: prevConversionOnUniqueConnectPct },
    { key: "targetAchievement", label: "Target Achievement", icon: Trophy, tone: "amber", value: h.target !== null ? `${h.achievementPct}%` : "not set", sub: h.target !== null ? `of ${formatINR(h.target)} target` : "no target for these dates" },
  ];

  const funnelData = [
    { name: "Total Base Count", value: h.totalCarts },
    { name: "Unique Attempted", value: h.uniqueCallCount },
    { name: "Unique Connected", value: h.uniqueCallConnectedCount },
    { name: "Same Day Connect", value: h.sameDayUniqueConnect },
    { name: "Total Sales", value: h.abandonCartSaleCount },
  ].map((s, i, arr) => ({ ...s, pct: arr[0].value > 0 ? round1((s.value / arr[0].value) * 100) : 0, fill: FUNNEL_COLORS[i] }));

  const snapshotRows: Array<{ label: string; value: string }> = [
    { label: "Overall Base count", value: h.totalCarts.toLocaleString("en-IN") },
    { label: "Workable Cases", value: h.workableCases.toLocaleString("en-IN") },
    { label: "DND Cases", value: h.dndCases.toLocaleString("en-IN") },
    { label: "NC Connect (Not Connect)", value: h.ncConnectCount.toLocaleString("en-IN") },
    { label: "Overall Unique attempted", value: h.uniqueCallCount.toLocaleString("en-IN") },
    { label: "Overall Unique connected", value: h.uniqueCallConnectedCount.toLocaleString("en-IN") },
    { label: "Overall Unique connected %", value: `${h.uniqueCallConnectedPct}%` },
    { label: "Same Day Unique Attempt", value: h.sameDayUniqueAttempt.toLocaleString("en-IN") },
    { label: "Same Day Unique Connect", value: h.sameDayUniqueConnect.toLocaleString("en-IN") },
    { label: "Same Day Unique Connect %", value: `${h.sameDayUniqueConnectPct}%` },
  ];

  const conversionTrend = useMemo(
    () => data.dateWiseTrend.map((r) => ({
      date: r.date,
      onBase: r.cartCount > 0 ? round1((r.abandonCartSaleCount / r.cartCount) * 100) : 0,
      onUniqueConnect: r.uniqueCallConnectedCount > 0 ? round1((r.abandonCartSaleCount / r.uniqueCallConnectedCount) * 100) : 0,
    })),
    [data.dateWiseTrend],
  );

  const weekly = useMemo(() => {
    const byWeek = new Map<string, { key: string; label: string; revenue: number; saleCount: number }>();
    for (const r of data.dateWiseTrend) {
      const wk = weekBucket(r.date);
      const cur = byWeek.get(wk.key) ?? { key: wk.key, label: wk.label, revenue: 0, saleCount: 0 };
      cur.revenue += r.abandonCartRevenue;
      cur.saleCount += r.abandonCartSaleCount;
      byWeek.set(wk.key, cur);
    }
    return [...byWeek.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [data.dateWiseTrend]);

  const totalOrders = h.codOrderCount + h.paidOrderCount;
  const ordersDonut = totalOrders > 0 ? [
    { name: "Paid orders", value: h.paidOrderCount },
    { name: "COD orders", value: h.codOrderCount },
  ] : [];

  const achievementBarPct = h.target !== null ? Math.min(100, h.achievementPct ?? 0) : 0;

  // Each chart is rendered once here, parameterized by height, and reused
  // both on its own (small) card and (large) inside its View Details drawer
  // -- so the drawer's chart can never drift from the card's own.
  const renderFunnel = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <FunnelChart>
        <Tooltip formatter={(v: number) => v.toLocaleString("en-IN")} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
        <Funnel dataKey="value" data={funnelData} isAnimationActive>
          <LabelList position="right" dataKey="name" fill="#334155" stroke="none" fontSize={12} />
          <LabelList position="left" dataKey="pct" formatter={(v: number) => `${v}%`} fill="#334155" stroke="none" fontSize={12} />
          {funnelData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );

  const renderDailyTrend = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data.dateWiseTrend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 10 }} />
        <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={(v) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="l" dataKey="cartCount" name="Base" fill="#e11d48" radius={[3, 3, 0, 0]} />
        <Bar yAxisId="l" dataKey="uniqueCallCount" name="Unique Attempted" fill="#4f46e5" radius={[3, 3, 0, 0]} />
        <Bar yAxisId="l" dataKey="uniqueCallConnectedCount" name="Unique Connected" fill="#0284c7" radius={[3, 3, 0, 0]} />
        <Bar yAxisId="l" dataKey="abandonCartSaleCount" name="Sales" fill="#059669" radius={[3, 3, 0, 0]} />
        <Line yAxisId="r" type="monotone" dataKey="abandonCartRevenue" name="Revenue" stroke="#d97706" strokeWidth={2.5} dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );

  const renderSalesTrend = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data.dateWiseTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 10 }} />
        <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={(v) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="l" dataKey="abandonCartSaleCount" name="Sale Count" fill="#0d9488" radius={[3, 3, 0, 0]} />
        <Line yAxisId="r" type="monotone" dataKey="abandonCartRevenue" name="Revenue" stroke="#d97706" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );

  const renderConversionTrend = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={conversionTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} unit="%" />
        <Tooltip labelFormatter={(v) => formatShortDate(String(v))} formatter={(v: number) => `${v}%`} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="onBase" name="on Base" stroke="#0891b2" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="onUniqueConnect" name="on Unique Connect" stroke="#0ea5e9" strokeWidth={2} dot={false} strokeDasharray="4 3" />
      </ComposedChart>
    </ResponsiveContainer>
  );

  const renderOrdersDonut = (height: number) => ordersDonut.length === 0 ? (
    <p className="py-6 text-center text-xs text-slate-400">No deduped orders for this period.</p>
  ) : (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Pie data={ordersDonut} dataKey="value" nameKey="name" cx="50%" cy="46%" innerRadius={height * 0.22} outerRadius={height * 0.36} paddingAngle={2}>
          {ordersDonut.map((entry, i) => <Cell key={entry.name} fill={DISPOSITION_COLORS[i % DISPOSITION_COLORS.length]} stroke="white" strokeWidth={2} />)}
        </Pie>
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} formatter={(v: number) => v.toLocaleString("en-IN")} />
        <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} formatter={(value: string, entry: { payload?: { value?: number } }) => `${value}: ${totalOrders > 0 ? Math.round(((entry.payload?.value ?? 0) / totalOrders) * 100) : 0}%`} />
      </PieChart>
    </ResponsiveContainer>
  );

  const renderWeekComparison = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={weekly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="l" dataKey="saleCount" name="Sale Count" fill="#059669" radius={[3, 3, 0, 0]} />
        <Line yAxisId="r" type="monotone" dataKey="revenue" name="Revenue" stroke="#d97706" strokeWidth={2.5} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );

  const snapshotChart: ChartDetail = {
    title: "Abandon Cart Snapshot", overall: snapshotRows,
    metrics: [
      { key: "totalCarts", label: "Base count", drill: { kind: "sum", field: "cartCount", fmt: "count" } },
      { key: "workableCases", label: "Workable Cases", drill: { kind: "sum", field: "workableCases", fmt: "count" } },
      { key: "dndCases", label: "DND Cases", drill: { kind: "sum", field: "dndCases", fmt: "count" } },
      { key: "ncConnectCount", label: "NC Connect", drill: { kind: "sum", field: "ncConnectCount", fmt: "count" } },
      { key: "uniqueCallCount", label: "Unique Attempted", drill: { kind: "sum", field: "uniqueCallCount", fmt: "count" } },
      { key: "uniqueCallConnectedCount", label: "Unique Connected", drill: { kind: "sum", field: "uniqueCallConnectedCount", fmt: "count" } },
      { key: "uniqueCallConnectedPct", label: "Unique Connected %", drill: { kind: "ratio", num: "uniqueCallConnectedCount", den: "uniqueCallCount" } },
      { key: "sameDayUniqueAttempt", label: "Same Day Attempt", drill: { kind: "sum", field: "sameDayUniqueAttempt", fmt: "count" } },
      { key: "sameDayUniqueConnect", label: "Same Day Connect", drill: { kind: "sum", field: "sameDayUniqueConnect", fmt: "count" } },
    ],
  };

  const funnelChart: ChartDetail = {
    title: "Call Funnel",
    overall: funnelData.map((s) => ({ label: s.name, value: `${s.value.toLocaleString("en-IN")} (${s.pct}%)` })),
    renderChart: () => renderFunnel(420),
    metrics: [
      { key: "cartCount", label: "Base Count", drill: { kind: "sum", field: "cartCount", fmt: "count" } },
      { key: "uniqueCallCount", label: "Unique Attempted", drill: { kind: "sum", field: "uniqueCallCount", fmt: "count" } },
      { key: "uniqueCallConnectedCount", label: "Unique Connected", drill: { kind: "sum", field: "uniqueCallConnectedCount", fmt: "count" } },
      { key: "sameDayUniqueConnect", label: "Same Day Connect", drill: { kind: "sum", field: "sameDayUniqueConnect", fmt: "count" } },
      { key: "abandonCartSaleCount", label: "Total Sales", drill: { kind: "sum", field: "abandonCartSaleCount", fmt: "count" } },
    ],
  };

  const dailyTrendChart: ChartDetail = {
    title: "Daily Trend",
    overall: [
      { label: "Base", value: h.totalCarts.toLocaleString("en-IN") },
      { label: "Unique Attempted", value: h.uniqueCallCount.toLocaleString("en-IN") },
      { label: "Unique Connected", value: h.uniqueCallConnectedCount.toLocaleString("en-IN") },
      { label: "Sales", value: h.abandonCartSaleCount.toLocaleString("en-IN") },
      { label: "Revenue", value: formatINR(h.abandonCartRevenue) },
    ],
    renderChart: () => renderDailyTrend(420),
    metrics: [
      { key: "cartCount", label: "Base", drill: { kind: "sum", field: "cartCount", fmt: "count" } },
      { key: "uniqueCallCount", label: "Unique Attempted", drill: { kind: "sum", field: "uniqueCallCount", fmt: "count" } },
      { key: "uniqueCallConnectedCount", label: "Unique Connected", drill: { kind: "sum", field: "uniqueCallConnectedCount", fmt: "count" } },
      { key: "abandonCartSaleCount", label: "Sales", drill: { kind: "sum", field: "abandonCartSaleCount", fmt: "count" } },
      { key: "abandonCartRevenue", label: "Revenue", drill: { kind: "sum", field: "abandonCartRevenue", fmt: "currency" } },
    ],
  };

  const salesMetricsChart: ChartDetail = {
    title: "Sales Metrics",
    overall: [
      { label: "Sale Count", value: h.abandonCartSaleCount.toLocaleString("en-IN") },
      { label: "Revenue", value: formatINR(h.abandonCartRevenue) },
    ],
    renderChart: () => renderSalesTrend(400),
    metrics: [
      { key: "abandonCartSaleCount", label: "Sale Count", drill: { kind: "sum", field: "abandonCartSaleCount", fmt: "count" } },
      { key: "abandonCartRevenue", label: "Revenue", drill: { kind: "sum", field: "abandonCartRevenue", fmt: "currency" } },
    ],
  };

  const conversionMetricsChart: ChartDetail = {
    title: "Conversion Metrics",
    overall: [
      { label: "Conv. on Base", value: `${conversionOnBasePct}%` },
      { label: "Conv. on Unique Connect", value: `${conversionOnUniqueConnectPct}%` },
    ],
    renderChart: () => renderConversionTrend(400),
    metrics: [
      { key: "onBase", label: "Conv. on Base", drill: { kind: "ratio", num: "abandonCartSaleCount", den: "cartCount" } },
      { key: "onUniqueConnect", label: "Conv. on Unique Connect", drill: { kind: "ratio", num: "abandonCartSaleCount", den: "uniqueCallConnectedCount" } },
    ],
  };

  const revenueMetricsChart: ChartDetail = {
    title: "Revenue Metrics",
    overall: [
      { label: "Target", value: h.target !== null ? formatINR(h.target) : "not set" },
      { label: "Overall Revenue", value: formatINR(h.abandonCartRevenue) },
      { label: "Achievement %", value: h.target !== null ? `${h.achievementPct}%` : "—" },
      { label: "AOV", value: formatINR(h.abandonCartAov) },
    ],
    metrics: [
      { key: "abandonCartRevenue", label: "Revenue", drill: { kind: "sum", field: "abandonCartRevenue", fmt: "currency" } },
      { key: "abandonCartSaleCount", label: "Sale Count", drill: { kind: "sum", field: "abandonCartSaleCount", fmt: "count" } },
      { key: "revenueTarget", label: "Target", drill: { kind: "sum", field: "revenueTarget", fmt: "currency" } },
      { key: "achiPct", label: "Achi %", drill: { kind: "ratio", num: "abandonCartRevenue", den: "revenueTarget" } },
    ],
  };

  const ordersChart: ChartDetail = {
    title: "Orders and Data Checks",
    overall: [
      { label: "COD orders", value: h.codOrderCount.toLocaleString("en-IN") },
      { label: "Paid orders", value: h.paidOrderCount.toLocaleString("en-IN") },
      { label: "RTO orders", value: h.rtoOrderCount.toLocaleString("en-IN") },
    ],
    renderChart: () => renderOrdersDonut(360),
    metrics: [
      { key: "codOrderCount", label: "COD orders", drill: { kind: "sum", field: "codOrderCount", fmt: "count" } },
      { key: "paidOrderCount", label: "Paid orders", drill: { kind: "sum", field: "paidOrderCount", fmt: "count" } },
      { key: "rtoOrderCount", label: "RTO orders", drill: { kind: "sum", field: "rtoOrderCount", fmt: "count" } },
    ],
  };

  const weekComparisonChart: ChartDetail = {
    title: "Week Wise Comparison",
    overall: [
      { label: "Sale Count", value: h.abandonCartSaleCount.toLocaleString("en-IN") },
      { label: "Revenue", value: formatINR(h.abandonCartRevenue) },
    ],
    renderChart: () => renderWeekComparison(400),
    metrics: [
      { key: "abandonCartSaleCount", label: "Sale Count", drill: { kind: "sum", field: "abandonCartSaleCount", fmt: "count" } },
      { key: "abandonCartRevenue", label: "Revenue", drill: { kind: "sum", field: "abandonCartRevenue", fmt: "currency" } },
    ],
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Click any KPI card for its date-wise and week-wise trend. Percentages compare against the immediately preceding period of equal length.</p>

      {/* Row 1: headline KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {kpis.map((k) => {
          const clickable = !!k.drill;
          const card = (
            <div className="relative">
              <KpiCard icon={k.icon} label={k.label} value={k.value} sub={k.sub} tone={k.tone} />
              {(k.currValue !== undefined) && (
                <div className="pointer-events-none absolute bottom-1.5 right-2.5">
                  <DeltaChip curr={k.currValue} prev={k.prevValue} />
                </div>
              )}
            </div>
          );
          return clickable ? (
            <button key={k.key} type="button" onClick={() => setDrawerKpi(k as KpiDef & { drill: Drill })}
              className="rounded-2xl text-left transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-fuchsia-300">
              {card}
            </button>
          ) : <div key={k.key}>{card}</div>;
        })}
      </div>

      {/* Row 2: snapshot table, funnel, daily trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard icon={ShoppingCart} title="Abandon Cart Snapshot" tone="rose">
          <ViewDetailsButton onClick={() => setDrawerChart(snapshotChart)} />
          <div className="overflow-hidden rounded-xl border border-slate-100">
            <table className="w-full border-collapse text-xs">
              <thead><tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <th className="border border-slate-200 px-2 py-1.5 text-left">Metric</th><th className="border border-slate-200 px-2 py-1.5 text-right">Value</th>
              </tr></thead>
              <tbody>
                {snapshotRows.map((r) => (
                  <tr key={r.label}>
                    <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{r.label}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right font-semibold text-slate-800">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard icon={Percent} title="Call Funnel" tone="amber" footnote="% is of Total Base Count.">
          <ViewDetailsButton onClick={() => setDrawerChart(funnelChart)} />
          {renderFunnel(260)}
        </SectionCard>

        <SectionCard icon={TrendingUp} title="Daily Trend" tone="sky" footnote="Bars are counts (left axis); the amber line is revenue (right axis, ₹).">
          <ViewDetailsButton onClick={() => setDrawerChart(dailyTrendChart)} />
          {renderDailyTrend(260)}
        </SectionCard>
      </div>

      {/* Row 3: sales / conversion / revenue metrics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard icon={ShoppingBag} title="Sales Metrics" tone="teal">
          <ViewDetailsButton onClick={() => setDrawerChart(salesMetricsChart)} />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <KpiCard icon={ShoppingBag} label="Sale Count" value={h.abandonCartSaleCount.toLocaleString("en-IN")} tone="teal" />
            <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(h.abandonCartRevenue)} tone="amber" />
          </div>
          {renderSalesTrend(180)}
        </SectionCard>

        <SectionCard icon={Percent} title="Conversion Metrics" tone="cyan">
          <ViewDetailsButton onClick={() => setDrawerChart(conversionMetricsChart)} />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <KpiCard icon={Percent} label="Conv. on Base" value={`${conversionOnBasePct}%`} tone="cyan" sub={prevConversionOnBasePct !== undefined ? undefined : undefined} />
            <KpiCard icon={Percent} label="Conv. on Unique Connect" value={`${conversionOnUniqueConnectPct}%`} tone="sky" />
          </div>
          {renderConversionTrend(180)}
        </SectionCard>

        <SectionCard icon={Wallet} title="Revenue Metrics" tone="violet">
          <ViewDetailsButton onClick={() => setDrawerChart(revenueMetricsChart)} />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <KpiCard icon={Wallet} label="Target" value={h.target !== null ? formatINR(h.target) : "not set"} tone="violet" />
            <KpiCard icon={IndianRupee} label="Overall Revenue" value={formatINR(h.abandonCartRevenue)} tone="amber" />
            <KpiCard icon={Trophy} label="Achievement %" value={h.target !== null ? `${h.achievementPct}%` : "—"} tone="amber" />
            <KpiCard icon={TrendingUp} label="AOV" value={formatINR(h.abandonCartAov)} tone="indigo" sub="revenue / sale" />
          </div>
          {h.target !== null && (
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-slate-500">
                <span>Target vs Revenue</span><span>{h.achievementPct}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${achievementBarPct}%` }} />
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Row 4: orders, week comparison, top products */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard icon={Package} title="Orders and Data Checks" tone="indigo" footnote="Donut is Paid vs COD (the two real, mutually-exclusive payment methods -- always 100% of orders). RTO is a separate status that can apply to either, so it's shown as its own count rather than forced into the donut.">
          <ViewDetailsButton onClick={() => setDrawerChart(ordersChart)} />
          <div className="mb-3 grid grid-cols-3 gap-2">
            <KpiCard icon={Package} label="COD orders" value={h.codOrderCount.toLocaleString("en-IN")} tone="sky" />
            <KpiCard icon={Package} label="Paid orders" value={h.paidOrderCount.toLocaleString("en-IN")} tone="emerald" />
            <KpiCard icon={Ban} label="RTO orders" value={h.rtoOrderCount.toLocaleString("en-IN")} tone="red" />
          </div>
          {renderOrdersDonut(200)}
        </SectionCard>

        <SectionCard icon={PhoneOff} title="Week Wise Comparison" tone="rose" footnote="Bars are sale count (left axis); the line is revenue (right axis, ₹).">
          <ViewDetailsButton onClick={() => setDrawerChart(weekComparisonChart)} />
          {renderWeekComparison(240)}
        </SectionCard>

        <SectionCard icon={ShoppingBag} title="Top Products" tone="amber" footnote="From bb_cart.variant_title -- bb_cart has no campaign/LOB column, so this is products only. Sales/Revenue/AOV are matched to bb_sale.line_item_name by exact text; an unmatched product shows '—', never a fabricated 0.">
          <div className="max-h-[280px] overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[11px]">
              <thead><tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-2 font-semibold">#</th>
                <th className="py-1.5 pr-2 font-semibold">Product</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Base</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Connect%</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Sales</th>
                <th className="py-1.5 pr-0 text-right font-semibold">Revenue</th>
              </tr></thead>
              <tbody>
                {data.topProducts.map((p, i) => (
                  <tr key={p.product} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 pr-2 text-slate-400">{i + 1}</td>
                    <td className="py-1.5 pr-2 text-slate-700" title={p.product}>{p.product.length > 34 ? `${p.product.slice(0, 34)}…` : p.product}</td>
                    <td className="py-1.5 pr-2 text-right text-slate-600">{p.baseCount.toLocaleString("en-IN")}</td>
                    <td className="py-1.5 pr-2 text-right font-semibold text-emerald-600">{p.connectedPct}%</td>
                    <td className="py-1.5 pr-2 text-right text-slate-600">{p.saleCount !== null ? p.saleCount.toLocaleString("en-IN") : "—"}</td>
                    <td className="py-1.5 pr-0 text-right font-semibold text-amber-700">{p.revenue !== null ? formatINR(p.revenue) : "—"}</td>
                  </tr>
                ))}
                {data.topProducts.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">No products for this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <BellavitaCartTargetTable from={data.from} to={data.to} />

      <KpiDrawer kpi={drawerKpi} rows={data.dateWiseTrend} onClose={() => setDrawerKpi(null)} />
      <ChartDetailsDrawer chart={drawerChart} rows={data.dateWiseTrend} onClose={() => setDrawerChart(null)} />
    </div>
  );
}
