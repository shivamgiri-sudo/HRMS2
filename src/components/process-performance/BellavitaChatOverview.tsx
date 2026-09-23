import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ComposedChart, Bar, Line, BarChart, PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  MessageSquare, Gauge, Clock3, ShoppingBag, IndianRupee, Percent, Repeat, Info, Inbox,
  Undo2, CreditCard, Users, TrendingUp, Layers, CalendarCheck, Sun, Moon,
  Trophy, ArrowUpRight, ArrowDownRight, Lightbulb, Target, ListFilter, Loader2,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Spinner, KpiCard, SectionCard, DashboardExportMenu, formatINR, type ExportSlide, type KpiTone,
} from "./DashboardKit";
import { TOOLTIP_PROPS, fmtDate, fmtN, fmtShortDay } from "./lpCallShared";

/**
 * Bellavita Chat "Overview" -- rebuilt 2026-09-23 (explicit "remove
 * everything, create exact like the attached photos" request) as two
 * distinct card-based layouts sharing one data fetch:
 * - Overall tab: the "Chat Performance Dashboard" reference layout.
 * - Chat/Kenaz/Bevzilla tabs: the "Chat Dashboard (Including PTP)" reference
 *   layout, with the PTP Performance row added earlier the same day.
 * Both end with a QRC chart + table. The old MTD/Weekly/Date-wise matrix
 * table and its column-click drawer are gone -- every figure below is for
 * the selected range as a whole, matching both reference photos (neither
 * shows a per-week/per-day matrix).
 *
 * Every field not covered by a real column is either derived honestly or
 * left out -- never invented. See each backend query's own comment in
 * bellavita-chat-overview.service.ts for the exact source. Summary of the
 * gaps versus the reference photos:
 * - Sale Made/Revenue/AOV/RTO/Prepaid/Conversion% are bb_sale's combined
 *   'Chat'-campaign figures on every tab (no Kenaz/Bevzilla split exists);
 *   Kenaz/Bevzilla/Overall show a note saying so.
 * - Day vs Night Performance shows only Unique Chat Volume and FRT % --
 *   bb_sale has no timestamp/shift column, so Sale Made/Revenue/AOV/
 *   Conversion% cannot honestly be split by shift.
 * - Fraud Monitoring shows the real count (0 today -- new_bb_chat.fraud is
 *   NULL on every uploaded row) with no invented "Fraud Cases by Day" chart
 *   (would be an all-zero chart).
 * - FRT Performance's target line only appears once an admin sets a real
 *   FRT% target (same pattern as Planned Capacity) -- never a hardcoded 95%.
 * - Top Agents shows FRT % (not "FRT (Sec)" -- no such column was found).
 */

type UserType = "Overall" | "Chat" | "Kenaz" | "Bevzilla";
const USER_TYPES: Array<{ key: UserType; label: string; hint: string }> = [
  { key: "Overall", label: "Overall", hint: "Chat + Kenaz + Bevzilla" },
  { key: "Chat", label: "Chat", hint: "user_type = Chat" },
  { key: "Kenaz", label: "Kenaz", hint: "user_type = Kenaz" },
  { key: "Bevzilla", label: "Bevzilla", hint: "user_type = Bevzilla" },
];
const CAPACITY_TYPES = ["Chat", "Kenaz", "Bevzilla"] as const;

interface Column { key: string; label: string; kind: "mtd" | "week" | "day"; from: string; to: string }
interface Values {
  plannedCapacity: number | null; overallChat: number; capacityUtilizationPct: number | null; frtPct: number;
  repeat24: number; repeat48: number; repeat72: number; repeatMore72: number; unique: number; withoutAgentFrt: number;
  saleMade: number | null; revenue: number | null; aov: number | null;
  convOverallPct: number | null; convUniquePct: number | null;
  duplicateOrderRows: number | null; duplicateRevenue: number | null;
  rtoCount: number | null; prepaidCount: number | null; rtoPct: number | null;
}
interface Integrity {
  saleRows: number; uniqueOrders: number; duplicateRows: number;
  grossRevenue: number; revenue: number; duplicateRevenue: number; blankOrderIdRows: number;
}
interface QrcColumn { counts: Record<string, number>; total: number; untagged: number; dataDays: number; coveredDays: number }
interface QrcData { categories: string[]; values: Record<string, QrcColumn | null>; uncoveredDates: string[]; note: string | null }
interface DailyRow {
  date: string; overall: number; unique: number; repeatChat: number; frtPct: number; inTat: number; withoutAgentFrt: number;
  repeat24: number; repeat48: number; repeat72: number; repeatMore72: number;
  saleMade: number | null; revenue: number | null; plannedCapacity: number | null;
  rtoCount: number | null; prepaidCount: number | null;
}
interface DayNightSplit { overall: number; unique: number; frtPct: number }
interface RosterSummary { roster: number; present: number; ul: number; ulPct: number }
interface TopAgentRow {
  agent: string; empId: string; overall: number; unique: number;
  saleCount: number | null; revenue: number | null; conversionPct: number | null; frtPct: number;
}
interface OverviewData {
  from: string; to: string; userType: UserType; columns: Column[]; values: Record<string, Values>; qrc: QrcData;
  daily: DailyRow[];
  salesAvailable: boolean; salesNote: string | null; integrity: Integrity | null;
  capacity: { month: string; byType: Record<(typeof CAPACITY_TYPES)[number], number | null> };
  latestChatDate: string | null; dailyColumnsOmitted: boolean; canSetCapacity: boolean;
  avgResolutionMin: number | null;
  dayNight: { day: DayNightSplit; night: DayNightSplit } | null;
  roster: RosterSummary | null;
  fraudCount: number;
  topAgents: TopAgentRow[];
  frtTarget: number | null;
}

const REPEAT_COLORS = ["#059669", "#0ea5e9", "#6366f1", "#f59e0b", "#e11d48"];
const ORDER_COLORS = ["#059669", "#e11d48"];
const FUNNEL_COLORS = ["#e11d48", "#0ea5e9", "#059669"];

function format(v: number | null | undefined, fmt: "count" | "pct0" | "pct1" | "inr" | "min"): string {
  if (v === null || v === undefined) return "—";
  switch (fmt) {
    case "count": return fmtN(v);
    case "pct0": return `${Math.round(v)}%`;
    case "pct1": return `${Math.round(v * 10) / 10}%`;
    case "inr": return formatINR(v);
    case "min": return `${Math.round(v * 10) / 10} Min`;
  }
}
const round1 = (v: number) => Math.round(v * 10) / 10;

/** [from,to] shifted back by its own span, immediately preceding it -- for
 * the "vs previous period" delta chips and Key Insights, same convention
 * already used on the Bellavita Cart Overview page. */
function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = new Date(from), t = new Date(to);
  const spanDays = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const prevTo = new Date(f); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (spanDays - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

/** Real % change vs the previous period, or nothing while unavailable -- never a fabricated 0%. */
function DeltaChip({ curr, prev }: { curr?: number | null; prev?: number | null }) {
  if (curr === undefined || curr === null || prev === undefined || prev === null || prev === 0) return null;
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

/** Thin KpiCard wrapper that also renders a DeltaChip under it. */
function KpiWithDelta({
  icon, label, value, sub, tone, curr, prev, onClick,
}: { icon: typeof MessageSquare; label: string; value: string; sub?: string; tone: KpiTone; curr?: number | null; prev?: number | null; onClick?: () => void }) {
  return (
    <div className="relative">
      <KpiCard icon={icon} label={label} value={value} sub={sub} tone={tone} onClick={onClick} />
      <div className="pointer-events-none absolute bottom-1.5 right-2.5"><DeltaChip curr={curr} prev={prev} /></div>
    </div>
  );
}

/** Same "day 1-7 -> W-1, ..." convention every other week-wise drill-down in
 * this app uses (see BellavitaCartOverview.tsx's own weekBucket). */
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

type NumericDailyField = { [K in keyof DailyRow]: NonNullable<DailyRow[K]> extends number ? K : never }[keyof DailyRow];
type Drill =
  | { kind: "sum"; field: NumericDailyField; fmt: "count" | "currency" }
  | { kind: "ratio"; num: NumericDailyField; den: NumericDailyField }
  /** num / den as a plain rupee amount (e.g. AOV = revenue / sale made), not a percentage. */
  | { kind: "quotient"; num: NumericDailyField; den: NumericDailyField };

function fmtDrillValue(v: number, fmt: "count" | "currency" | "pct"): string {
  if (fmt === "currency") return formatINR(v);
  if (fmt === "pct") return `${round1(v)}%`;
  return v.toLocaleString("en-IN");
}
function drillValueForRows(drill: Drill, rows: DailyRow[]): { value: number; fmt: "count" | "currency" | "pct" } {
  const val = (r: DailyRow, f: NumericDailyField): number => (r[f] as number | null) ?? 0;
  if (drill.kind === "sum") return { value: rows.reduce((s, r) => s + val(r, drill.field), 0), fmt: drill.fmt };
  const num = rows.reduce((s, r) => s + val(r, drill.num), 0);
  const den = rows.reduce((s, r) => s + val(r, drill.den), 0);
  if (drill.kind === "quotient") return { value: den > 0 ? Math.round(num / den) : 0, fmt: "currency" };
  return { value: den > 0 ? round1((num / den) * 100) : 0, fmt: "pct" };
}

interface ChartMetric { key: string; label: string; drill: Drill }
interface ChartDetail {
  title: string; overall: Array<{ label: string; value: string }>; metrics: ChartMetric[];
  /** A larger render of the same chart shown on its card -- the drawer shows
   * this above the Overall KPIs and the week-wise/date-wise tables. */
  renderChart?: () => ReactNode;
  /** Own day rows for this drawer (e.g. one agent) instead of the page-wide data.daily. */
  rows?: DailyRow[];
}

/** Small right-aligned "View Details" trigger -- place as the first thing
 * inside a SectionCard's own children (SectionCard has no action slot). */
function ViewDetailsButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="mb-2 flex justify-end">
      <button
        type="button" onClick={onClick}
        className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-700"
      >
        <ListFilter className="h-3 w-3" />View Details
      </button>
    </div>
  );
}

/** Right-side drill-down for one whole chart card: the chart itself at
 * roughly double size, its "Overall KPIs" for the selected range, and every
 * metric on it broken down week-wise and date-wise from data.daily -- one
 * shared drawer for every chart, driven by the ChartDetail config passed in. */
function ChartDetailsDrawer({
  chart, rows: pageRows, onClose,
}: { chart: ChartDetail | null; rows: DailyRow[]; onClose: () => void }) {
  const rows = chart?.rows ?? pageRows;
  const weekly = useMemo(() => {
    if (!chart) return [];
    const byWeek = new Map<string, DailyRow[]>();
    for (const r of rows) {
      const wk = weekBucket(r.date);
      const cur = byWeek.get(wk.key) ?? [];
      cur.push(r);
      byWeek.set(wk.key, cur);
    }
    return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([key, dayRows]) => ({
        key, label: weekBucket(dayRows[0].date).label,
        values: chart.metrics.map((m) => drillValueForRows(m.drill, dayRows)),
      }));
  }, [chart, rows]);
  const daily = useMemo(() => {
    if (!chart) return [];
    return rows.map((r) => ({ date: r.date, values: chart.metrics.map((m) => drillValueForRows(m.drill, [r])) }));
  }, [chart, rows]);

  return (
    <Sheet open={!!chart} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-4xl overflow-y-auto p-0 sm:max-w-4xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">Chart</span>
            <SheetTitle className="text-base font-bold text-slate-800">{chart?.title}</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] text-slate-400">Enlarged chart, overall KPIs, week-wise and date-wise detail for every metric on this chart.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 py-4">
          {!chart && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {chart && (
            <>
              {chart.renderChart && <div className="rounded-xl border border-slate-100 bg-white p-3">{chart.renderChart()}</div>}

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
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Week-wise</p>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full min-w-[480px] border-collapse text-center text-[11px]">
                    <thead><tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="border border-slate-200 px-2 py-1.5 text-left">Week</th>
                      {chart.metrics.map((m) => <th key={m.key} className="border border-slate-200 px-2 py-1.5">{m.label}</th>)}
                    </tr></thead>
                    <tbody>
                      {weekly.map((w) => (
                        <tr key={w.key}>
                          <td className="border border-slate-200 px-2 py-1.5 text-left font-medium text-slate-700">{w.label}</td>
                          {w.values.map((v, i) => (
                            <td key={chart.metrics[i].key} className="border border-slate-200 px-2 py-1.5 font-semibold text-rose-700">{fmtDrillValue(v.value, v.fmt)}</td>
                          ))}
                        </tr>
                      ))}
                      {weekly.length === 0 && <tr><td colSpan={chart.metrics.length + 1} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Date-wise</p>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full min-w-[480px] border-collapse text-center text-[11px]">
                    <thead><tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="border border-slate-200 px-2 py-1.5 text-left">Date</th>
                      {chart.metrics.map((m) => <th key={m.key} className="border border-slate-200 px-2 py-1.5">{m.label}</th>)}
                    </tr></thead>
                    <tbody>
                      {daily.map((r) => (
                        <tr key={r.date}>
                          <td className="border border-slate-200 px-2 py-1.5 font-medium text-slate-700">{fmtShortDay(r.date)}</td>
                          {r.values.map((v, i) => (
                            <td key={chart.metrics[i].key} className="border border-slate-200 px-2 py-1.5 font-semibold text-rose-700">{fmtDrillValue(v.value, v.fmt)}</td>
                          ))}
                        </tr>
                      ))}
                      {daily.length === 0 && <tr><td colSpan={chart.metrics.length + 1} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** QRC's own View Details drawer -- unlike every other chart, QRC already
 * has real week-wise/date-wise columns computed server-side (data.columns +
 * data.qrc.values), so this reads those directly instead of the generic
 * data.daily-based drill above. */
function QrcDetailsDrawer({
  data, open, onClose,
}: { data: OverviewData; open: boolean; onClose: () => void }) {
  const weekCols = data.columns.filter((c) => c.kind === "week");
  const dayCols = data.columns.filter((c) => c.kind === "day");
  const cell = (key: string, cat: string): string => {
    const v = data.qrc.values[key];
    if (!v) return "—";
    return `${fmtN(v.counts[cat] ?? 0)}${v.coveredDays < v.dataDays ? "*" : ""}`;
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-4xl overflow-y-auto p-0 sm:max-w-4xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">Chart</span>
            <SheetTitle className="text-base font-bold text-slate-800">QRC Wise — {data.userType}</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] text-slate-400">Week-wise and date-wise unique chats by disposition. * = only some days in that column have a disposition.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Week-wise</p>
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[480px] border-collapse text-center text-[11px]">
                <thead><tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="border border-slate-200 px-2 py-1.5 text-left">Category</th>
                  {weekCols.map((c) => <th key={c.key} className="border border-slate-200 px-2 py-1.5">{c.label}</th>)}
                </tr></thead>
                <tbody>
                  {data.qrc.categories.map((cat) => (
                    <tr key={cat}>
                      <td className="border border-slate-200 px-2 py-1.5 text-left font-medium text-slate-700">{cat}</td>
                      {weekCols.map((c) => <td key={c.key} className="border border-slate-200 px-2 py-1.5 font-semibold text-indigo-700">{cell(c.key, cat)}</td>)}
                    </tr>
                  ))}
                  {weekCols.length === 0 && <tr><td colSpan={data.qrc.categories.length + 1} className="border border-slate-200 py-6 text-center text-slate-400">No week columns for this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Date-wise</p>
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[480px] border-collapse text-center text-[11px]">
                <thead><tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="border border-slate-200 px-2 py-1.5 text-left">Category</th>
                  {dayCols.map((c) => <th key={c.key} className="border border-slate-200 px-2 py-1.5">{c.label}</th>)}
                </tr></thead>
                <tbody>
                  {data.qrc.categories.map((cat) => (
                    <tr key={cat}>
                      <td className="border border-slate-200 px-2 py-1.5 text-left font-medium text-slate-700">{cat}</td>
                      {dayCols.map((c) => <td key={c.key} className="border border-slate-200 px-2 py-1.5 font-semibold text-indigo-700">{cell(c.key, cat)}</td>)}
                    </tr>
                  ))}
                  {dayCols.length === 0 && <tr><td colSpan={data.qrc.categories.length + 1} className="border border-slate-200 py-6 text-center text-slate-400">Daily columns are hidden for ranges longer than 62 days.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const monthLabel = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
};

/** QRC bar chart + the existing detailed table, shared by every tab -- "add
 * below QRC" / "create chart for QRC" applies to all four (2026-09-23). */
function QrcSection({ data, onOpenDetails }: { data: OverviewData; onOpenDetails: () => void }) {
  const chartData = useMemo(() => {
    const mtdQrc = data.qrc.values.mtd;
    if (!mtdQrc) return [];
    return data.qrc.categories.map((cat) => ({ category: cat, count: mtdQrc.counts[cat] ?? 0 }));
  }, [data]);

  return (
    <SectionCard
      icon={Layers} title={`QRC Wise — ${data.userType}`} tone="indigo"
      footnote={`Unique chats by disposition for ${fmtDate(data.from)} to ${fmtDate(data.to)}.`}
    >
      <ViewDetailsButton onClick={onOpenDetails} />
      {data.qrc.note && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.qrc.note}
        </p>
      )}
      {chartData.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-400">No disposition data for this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={54} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip {...TOOLTIP_PROPS} />
            <Bar dataKey="count" name="Unique chats" fill="#4f46e5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </SectionCard>
  );
}

/** Top Agents by Performance -- shared table, both layouts. */
function TopAgentsTable({ data, onAgentClick }: { data: OverviewData; onAgentClick: (a: TopAgentRow) => void }) {
  return (
    <SectionCard icon={Users} title="Top Agents by Performance" tone="rose" footnote="Sales/Revenue/Conversion% are bb_sale's combined 'Chat'-campaign figures joined by emp_id -- real per agent, same caveat as PTP Performance above.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[11px]">
          <thead><tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
            <th className="py-1.5 pr-2 font-semibold">#</th>
            <th className="py-1.5 pr-2 font-semibold">Agent</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Chat Volume</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Unique</th>
            {data.salesAvailable && <th className="py-1.5 pr-2 text-right font-semibold">Sales</th>}
            {data.salesAvailable && <th className="py-1.5 pr-2 text-right font-semibold">Revenue</th>}
            {data.salesAvailable && <th className="py-1.5 pr-2 text-right font-semibold">Conv%</th>}
            <th className="py-1.5 pr-0 text-right font-semibold">FRT%</th>
          </tr></thead>
          <tbody>
            {data.topAgents.map((a, i) => (
              <tr key={`${a.empId}-${a.agent}`} onClick={() => onAgentClick(a)} role="button" tabIndex={0} className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-rose-50/50">
                <td className="py-1.5 pr-2 text-slate-400">{i + 1}</td>
                <td className="py-1.5 pr-2 font-medium text-rose-700 underline-offset-2 hover:underline">{a.agent}</td>
                <td className="py-1.5 pr-2 text-right text-slate-600">{fmtN(a.overall)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-600">{fmtN(a.unique)}</td>
                {data.salesAvailable && <td className="py-1.5 pr-2 text-right text-slate-600">{a.saleCount !== null ? fmtN(a.saleCount) : "—"}</td>}
                {data.salesAvailable && <td className="py-1.5 pr-2 text-right font-semibold text-amber-700">{a.revenue !== null ? formatINR(a.revenue) : "—"}</td>}
                {data.salesAvailable && <td className="py-1.5 pr-2 text-right font-semibold text-emerald-600">{a.conversionPct !== null ? `${a.conversionPct}%` : "—"}</td>}
                <td className="py-1.5 pr-0 text-right text-slate-600">{a.frtPct}%</td>
              </tr>
            ))}
            {data.topAgents.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-400">No agents for this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/** Chat Funnel -- Overall Chat Volume -> Unique Chat Volume -> Sale Made,
 * shared by both layouts. Sale Made only appears when sales are relevant
 * (always true now -- see salesAvailableFor in the backend). */
function ChatFunnelCard({ data, onOpenDetails }: { data: OverviewData; onOpenDetails: (chart: ChartDetail) => void }) {
  const mtd = data.values.mtd;
  const funnelData = [
    { name: "Overall Chat Volume", value: mtd.overallChat },
    { name: "Unique Chat Volume", value: mtd.unique },
    { name: "Sale Made", value: mtd.saleMade ?? 0 },
  ].map((s, i, arr) => ({ ...s, pct: arr[0].value > 0 ? round1((s.value / arr[0].value) * 100) : 0, fill: FUNNEL_COLORS[i] }));
  const renderFunnel = () => (
    <ResponsiveContainer width="100%" height={260}>
      <FunnelChart>
        <Tooltip {...TOOLTIP_PROPS} itemStyle={{ color: "#f1f5f9" }} formatter={(v: number) => v.toLocaleString("en-IN")} />
        <Funnel dataKey="value" data={funnelData} isAnimationActive>
          <LabelList position="right" dataKey="name" fill="#334155" stroke="none" fontSize={12} />
          <LabelList position="left" dataKey="pct" formatter={(v: number) => `${v}%`} fill="#334155" stroke="none" fontSize={12} />
          {funnelData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
  const chart: ChartDetail = {
    title: "Chat Funnel",
    overall: funnelData.map((s) => ({ label: s.name, value: `${s.value.toLocaleString("en-IN")} (${s.pct}%)` })),
    renderChart: renderFunnel,
    metrics: [
      { key: "overall", label: "Overall Chat Volume", drill: { kind: "sum", field: "overall", fmt: "count" } },
      { key: "unique", label: "Unique Chat Volume", drill: { kind: "sum", field: "unique", fmt: "count" } },
      { key: "saleMade", label: "Sale Made", drill: { kind: "sum", field: "saleMade", fmt: "count" } },
      { key: "uniquePct", label: "Unique % of Overall", drill: { kind: "ratio", num: "unique", den: "overall" } },
      { key: "convOverall", label: "Conv % (Overall)", drill: { kind: "ratio", num: "saleMade", den: "overall" } },
      { key: "convUnique", label: "Conv % (Unique)", drill: { kind: "ratio", num: "saleMade", den: "unique" } },
    ],
  };
  return (
    <SectionCard icon={Percent} title="Chat Funnel" tone="amber" footnote="% is of Overall Chat Volume.">
      <ViewDetailsButton onClick={() => onOpenDetails(chart)} />
      {renderFunnel()}
      <div className="flex items-center justify-center gap-6 border-t border-slate-100 pt-2 text-center text-xs">
        <div><b className="block text-sm text-slate-800">{fmtN(mtd.saleMade ?? 0)}</b><span className="text-slate-500">Sale Count</span></div>
        <div><b className="block text-sm text-slate-800">{format(mtd.convOverallPct, "pct1")}</b><span className="text-slate-500">Conv % (Overall)</span></div>
      </div>
    </SectionCard>
  );
}

/** Repeat Chat Analysis donut -- Unique + the 4 real repeat buckets, shared
 * by both layouts. */
function RepeatChatDonut({ data, onOpenDetails }: { data: OverviewData; onOpenDetails: (chart: ChartDetail) => void }) {
  const mtd = data.values.mtd;
  const slices = [
    { name: "Unique Chat", value: mtd.unique },
    { name: "Repeat 24hrs", value: mtd.repeat24 },
    { name: "Repeat 48hrs", value: mtd.repeat48 },
    { name: "Repeat 72hrs", value: mtd.repeat72 },
    { name: "Repeat > 72hrs", value: mtd.repeatMore72 },
  ].filter((s) => s.value > 0);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const repeatTotal = total - mtd.unique;
  const renderDonut = () => (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="46%" innerRadius={62} outerRadius={95} paddingAngle={2}>
          {slices.map((entry, i) => <Cell key={entry.name} fill={REPEAT_COLORS[i % REPEAT_COLORS.length]} stroke="white" strokeWidth={2} />)}
        </Pie>
        <Tooltip {...TOOLTIP_PROPS} itemStyle={{ color: "#f1f5f9" }} formatter={(v: number) => v.toLocaleString("en-IN")} />
        <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} formatter={(value: string, entry: { payload?: { value?: number } }) => `${value}: ${fmtN(entry.payload?.value ?? 0)} (${total > 0 ? round1(((entry.payload?.value ?? 0) / total) * 100) : 0}%)`} />
      </PieChart>
    </ResponsiveContainer>
  );
  const chart: ChartDetail = {
    title: "Repeat Chat Analysis",
    overall: slices.map((s) => ({ label: s.name, value: `${fmtN(s.value)} (${total > 0 ? round1((s.value / total) * 100) : 0}%)` })),
    renderChart: renderDonut,
    metrics: [
      { key: "unique", label: "Unique Chat", drill: { kind: "sum", field: "unique", fmt: "count" } },
      { key: "repeat24", label: "Repeat 24hrs", drill: { kind: "sum", field: "repeat24", fmt: "count" } },
      { key: "repeat48", label: "Repeat 48hrs", drill: { kind: "sum", field: "repeat48", fmt: "count" } },
      { key: "repeat72", label: "Repeat 72hrs", drill: { kind: "sum", field: "repeat72", fmt: "count" } },
      { key: "repeatMore72", label: "Repeat > 72hrs", drill: { kind: "sum", field: "repeatMore72", fmt: "count" } },
    ],
  };
  return (
    <SectionCard icon={Repeat} title="Repeat Chat Analysis" tone="sky">
      <ViewDetailsButton onClick={() => onOpenDetails(chart)} />
      {slices.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-400">No chat data for this period.</p>
      ) : renderDonut()}
      <p className="mt-1 text-center text-[11px] text-slate-500">{fmtN(repeatTotal)} repeat chats ({total > 0 ? round1((repeatTotal / total) * 100) : 0}% of {fmtN(total)})</p>
    </SectionCard>
  );
}

/** Chat Volume Trend -- bars for Overall/Unique, line for Repeat Chat. */
function ChatVolumeTrendCard({ data, onOpenDetails }: { data: OverviewData; onOpenDetails: (chart: ChartDetail) => void }) {
  const renderTrend = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="overall" name="Overall Chat Volume" fill="#e11d48" radius={[3, 3, 0, 0]} />
        <Bar dataKey="unique" name="Unique Chat Volume" fill="#0284c7" radius={[3, 3, 0, 0]} />
        <Line type="monotone" dataKey="repeatChat" name="Repeat Chat" stroke="#d97706" strokeWidth={2.5} dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
  const mtd = data.values.mtd;
  const chart: ChartDetail = {
    title: "Chat Volume Trend",
    overall: [
      { label: "Overall Chat Volume", value: fmtN(mtd.overallChat) },
      { label: "Unique Chat Volume", value: fmtN(mtd.unique) },
      { label: "Repeat Chat", value: fmtN(mtd.overallChat - mtd.unique) },
    ],
    renderChart: () => renderTrend(420),
    metrics: [
      { key: "overall", label: "Overall Chat Volume", drill: { kind: "sum", field: "overall", fmt: "count" } },
      { key: "unique", label: "Unique Chat Volume", drill: { kind: "sum", field: "unique", fmt: "count" } },
      { key: "repeatChat", label: "Repeat Chat", drill: { kind: "sum", field: "repeatChat", fmt: "count" } },
    ],
  };
  return (
    <SectionCard icon={MessageSquare} title="Chat Volume Trend" tone="rose">
      <ViewDetailsButton onClick={() => onOpenDetails(chart)} />
      {renderTrend(260)}
    </SectionCard>
  );
}

/* ------- chart + detail builders shared by the Overall and LOB layouts ------- */

const renderCapacityChart = (data: OverviewData, height: number) => (
  <ResponsiveContainer width="100%" height={height}>
    <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
      <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
      <YAxis tick={{ fontSize: 10 }} />
      <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="plannedCapacity" name="Planned Capacity" fill="#c4b5fd" radius={[3, 3, 0, 0]} />
      <Bar dataKey="overall" name="Actual Chat Volume" fill="#7c3aed" radius={[3, 3, 0, 0]} />
    </ComposedChart>
  </ResponsiveContainer>
);
const capacityDetail = (data: OverviewData, title: string): ChartDetail => {
  const mtd = data.values.mtd;
  return {
    title,
    overall: [
      { label: "Planned Capacity", value: format(mtd.plannedCapacity, "count") },
      { label: "Actual Chat Volume", value: fmtN(mtd.overallChat) },
      { label: "Overall Capacity Utilization", value: format(mtd.capacityUtilizationPct, "pct0") },
      { label: "Unique Capacity Utilization", value: mtd.plannedCapacity ? format(pct2(mtd.unique, mtd.plannedCapacity), "pct0") : "—" },
    ],
    renderChart: () => renderCapacityChart(data, 400),
    metrics: [
      { key: "plannedCapacity", label: "Planned Capacity", drill: { kind: "sum", field: "plannedCapacity", fmt: "count" } },
      { key: "overall", label: "Actual Chat Volume", drill: { kind: "sum", field: "overall", fmt: "count" } },
    ],
  };
};

const renderSalesRevenueChart = (data: OverviewData, height: number) => (
  <ResponsiveContainer width="100%" height={height}>
    <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
      <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
      <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
      <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} formatter={(v, name) => (String(name).startsWith("Revenue") ? formatINR(Number(v)) : v)} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Bar yAxisId="l" dataKey="saleMade" name="Sale Made" fill="#0d9488" radius={[3, 3, 0, 0]} />
      <Line yAxisId="r" type="monotone" dataKey="revenue" name="Revenue (₹)" stroke="#d97706" strokeWidth={2.5} dot={{ r: 2 }} />
    </ComposedChart>
  </ResponsiveContainer>
);
const salesRevenueDetail = (data: OverviewData, title: string): ChartDetail => {
  const mtd = data.values.mtd;
  return {
    title,
    overall: [
      { label: "Sale Made", value: format(mtd.saleMade, "count") },
      { label: "Revenue", value: format(mtd.revenue, "inr") },
      { label: "AOV", value: format(mtd.aov, "inr") },
      { label: "Conversion % (Overall)", value: format(mtd.convOverallPct, "pct1") },
    ],
    renderChart: () => renderSalesRevenueChart(data, 400),
    metrics: [
      { key: "saleMade", label: "Sale Made", drill: { kind: "sum", field: "saleMade", fmt: "count" } },
      { key: "revenue", label: "Revenue", drill: { kind: "sum", field: "revenue", fmt: "currency" } },
      { key: "aov", label: "AOV", drill: { kind: "quotient", num: "revenue", den: "saleMade" } },
      { key: "overall", label: "Overall Chat Volume", drill: { kind: "sum", field: "overall", fmt: "count" } },
      { key: "convOverall", label: "Conversion % (Overall)", drill: { kind: "ratio", num: "saleMade", den: "overall" } },
    ],
  };
};

const renderFrtLine = (data: OverviewData, height: number) => (
  <ResponsiveContainer width="100%" height={height}>
    <ComposedChart data={data.daily.map((d) => ({ ...d, frtPct: d.overall > 0 ? d.frtPct : null }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
      <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
      <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
      <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} formatter={(v: number) => `${v}%`} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Line type="monotone" dataKey="frtPct" name="FRT %" stroke="#059669" strokeWidth={2.5} dot={{ r: 2 }} />
      {data.frtTarget !== null && <Line type="monotone" dataKey={() => data.frtTarget} name="Target" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />}
    </ComposedChart>
  </ResponsiveContainer>
);
const frtDetail = (data: OverviewData): ChartDetail => {
  const mtd = data.values.mtd;
  return {
    title: "FRT Performance",
    overall: [
      { label: "FRT %", value: `${Math.round(mtd.frtPct)}%` },
      { label: "FRT % Target", value: data.frtTarget !== null ? `${data.frtTarget}%` : "not set" },
      { label: "With Out Agent FRT Chat Volume", value: fmtN(mtd.withoutAgentFrt) },
    ],
    renderChart: () => renderFrtLine(data, 400),
    metrics: [
      { key: "inTat", label: "Chats IN TAT", drill: { kind: "sum", field: "inTat", fmt: "count" } },
      { key: "overall", label: "Overall Chats", drill: { kind: "sum", field: "overall", fmt: "count" } },
      { key: "frtPct", label: "FRT %", drill: { kind: "ratio", num: "inTat", den: "overall" } },
    ],
  };
};

/* ------- per-KPI click-through: overall figures + week-wise + date-wise ------- */

type KpiKey =
  | "plannedCapacity" | "overallChat" | "unique" | "capacityUtil" | "frt"
  | "repeat24" | "repeat48" | "repeat72" | "repeatMore72" | "withoutAgentFrt"
  | "saleMade" | "revenue" | "aov" | "rto" | "prepaid" | "convOverall" | "convUnique";

/** ChartDetail for one KPI card, driven by the same per-day rows the charts use so
 * the week-wise/date-wise figures always add back up to the card's own value. */
function kpiDetail(data: OverviewData, key: KpiKey): ChartDetail {
  const m = data.values.mtd;
  const cnt = (k: string, label: string, field: NumericDailyField): ChartMetric => ({ key: k, label, drill: { kind: "sum", field, fmt: "count" } });
  const rat = (k: string, label: string, num: NumericDailyField, den: NumericDailyField): ChartMetric => ({ key: k, label, drill: { kind: "ratio", num, den } });
  const OVERALL = cnt("overall", "Overall Chat Volume", "overall");
  const UNIQUE = cnt("unique", "Unique Chat Volume", "unique");
  const SALE = cnt("saleMade", "Sale Made", "saleMade");
  const share = (n: number, d: number): string => (d > 0 ? `${round1((n / d) * 100)}%` : "—");
  const repeatKpi = (title: string, field: "repeat24" | "repeat48" | "repeat72" | "repeatMore72", value: number): ChartDetail => ({
    title,
    overall: [{ label: title, value: fmtN(value) }, { label: "Overall Chat Volume", value: fmtN(m.overallChat) }, { label: "% of Overall Chat", value: share(value, m.overallChat) }],
    metrics: [cnt(field, title, field), OVERALL, rat("share", "% of Overall Chat", field, "overall")],
  });
  switch (key) {
    case "plannedCapacity":
      return {
        title: "Planned Capacity",
        overall: [{ label: "Planned Capacity", value: format(m.plannedCapacity, "count") }, { label: "Actual Chat Volume", value: fmtN(m.overallChat) }, { label: "Capacity Utilization", value: format(m.capacityUtilizationPct, "pct0") }],
        metrics: [cnt("plannedCapacity", "Planned Capacity", "plannedCapacity"), OVERALL],
      };
    case "overallChat":
      return {
        title: "Overall Chat Volume",
        overall: [{ label: "Overall Chat Volume", value: fmtN(m.overallChat) }, { label: "Unique Chat Volume", value: fmtN(m.unique) }, { label: "Repeat Chat", value: fmtN(Math.max(0, m.overallChat - m.unique)) }],
        metrics: [OVERALL, UNIQUE, cnt("repeatChat", "Repeat Chat", "repeatChat")],
      };
    case "unique":
      return {
        title: "Unique Chat Volume",
        overall: [{ label: "Unique Chat Volume", value: fmtN(m.unique) }, { label: "Overall Chat Volume", value: fmtN(m.overallChat) }, { label: "Unique % of Overall", value: share(m.unique, m.overallChat) }],
        metrics: [UNIQUE, OVERALL, rat("uniquePct", "Unique %", "unique", "overall")],
      };
    case "capacityUtil":
      return {
        title: "Capacity Utilization",
        overall: [{ label: "Capacity Utilization", value: format(m.capacityUtilizationPct, "pct0") }, { label: "Planned Capacity", value: format(m.plannedCapacity, "count") }, { label: "Actual Chat Volume", value: fmtN(m.overallChat) }],
        metrics: [cnt("plannedCapacity", "Planned Capacity", "plannedCapacity"), OVERALL, rat("util", "Utilization %", "overall", "plannedCapacity")],
      };
    case "frt":
      return { ...frtDetail(data), title: "FRT %" };
    case "repeat24": return repeatKpi("Repeat 24hrs", "repeat24", m.repeat24);
    case "repeat48": return repeatKpi("Repeat 48hrs", "repeat48", m.repeat48);
    case "repeat72": return repeatKpi("Repeat 72hrs", "repeat72", m.repeat72);
    case "repeatMore72": return repeatKpi("Repeat > 72hrs", "repeatMore72", m.repeatMore72);
    case "withoutAgentFrt":
      return {
        title: "With Out Agent FRT",
        overall: [{ label: "With Out Agent FRT", value: fmtN(m.withoutAgentFrt) }, { label: "Overall Chat Volume", value: fmtN(m.overallChat) }, { label: "% of Overall Chat", value: share(m.withoutAgentFrt, m.overallChat) }],
        metrics: [cnt("withoutAgentFrt", "With Out Agent FRT", "withoutAgentFrt"), OVERALL, rat("share", "% of Overall Chat", "withoutAgentFrt", "overall")],
      };
    case "saleMade":
      return {
        title: "Sale Made",
        overall: [{ label: "Sale Made", value: format(m.saleMade, "count") }, { label: "Revenue", value: format(m.revenue, "inr") }, { label: "Conversion % (Overall)", value: format(m.convOverallPct, "pct1") }],
        metrics: [SALE, cnt("overall", "Overall Chat Volume", "overall"), rat("conv", "Conversion %", "saleMade", "overall")],
      };
    case "revenue":
    case "aov":
      return {
        title: key === "revenue" ? "Revenue" : "AOV",
        overall: [{ label: "Revenue", value: format(m.revenue, "inr") }, { label: "Sale Made", value: format(m.saleMade, "count") }, { label: "AOV", value: format(m.aov, "inr") }],
        metrics: [
          { key: "revenue", label: "Revenue", drill: { kind: "sum", field: "revenue", fmt: "currency" } },
          SALE,
          { key: "aov", label: "AOV", drill: { kind: "quotient", num: "revenue", den: "saleMade" } },
        ],
      };
    case "rto":
      return {
        title: "RTO",
        overall: [{ label: "RTO Orders", value: format(m.rtoCount, "count") }, { label: "RTO %", value: m.rtoPct !== null ? `${m.rtoPct}%` : "—" }, { label: "Sale Made", value: format(m.saleMade, "count") }],
        metrics: [cnt("rtoCount", "RTO Orders", "rtoCount"), SALE, rat("rtoPct", "RTO %", "rtoCount", "saleMade")],
      };
    case "prepaid":
      return {
        title: "Prepaid",
        overall: [{ label: "Prepaid Orders", value: format(m.prepaidCount, "count") }, { label: "% of Sales", value: m.rtoPct !== null ? `${round1(100 - m.rtoPct)}%` : "—" }, { label: "Sale Made", value: format(m.saleMade, "count") }],
        metrics: [cnt("prepaidCount", "Prepaid Orders", "prepaidCount"), SALE, rat("prepaidPct", "% of Sales", "prepaidCount", "saleMade")],
      };
    case "convOverall":
      return {
        title: "Conversion % On Overall",
        overall: [{ label: "Conversion % On Overall", value: format(m.convOverallPct, "pct1") }, { label: "Sale Made", value: format(m.saleMade, "count") }, { label: "Overall Chat Volume", value: fmtN(m.overallChat) }],
        metrics: [SALE, cnt("overall", "Overall Chat Volume", "overall"), rat("conv", "Conversion %", "saleMade", "overall")],
      };
    case "convUnique":
      return {
        title: "Conversion % On Unique",
        overall: [{ label: "Conversion % On Unique", value: format(m.convUniquePct, "pct1") }, { label: "Sale Made", value: format(m.saleMade, "count") }, { label: "Unique Chat Volume", value: fmtN(m.unique) }],
        metrics: [SALE, UNIQUE, rat("conv", "Conversion %", "saleMade", "unique")],
      };
  }
}

/* ============================== Overall layout ============================= */

function OverallDashboard({ data, prevMtd, onOpenDetails, onAgentClick }: { data: OverviewData; prevMtd: Values | null; onOpenDetails: (chart: ChartDetail) => void; onAgentClick: (a: TopAgentRow) => void }) {
  const mtd = data.values.mtd;
  const dayShare = data.dayNight;
  const open = (k: KpiKey) => () => onOpenDetails(kpiDetail(data, k));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiWithDelta icon={CalendarCheck} label="Planned Capacity" value={format(mtd.plannedCapacity, "count")} tone="violet" onClick={open("plannedCapacity")} />
        <KpiWithDelta icon={MessageSquare} label="Overall Chat Volume" value={fmtN(mtd.overallChat)} tone="rose" curr={mtd.overallChat} prev={prevMtd?.overallChat} onClick={open("overallChat")} />
        <KpiWithDelta icon={Repeat} label="Unique Chat Volume" value={fmtN(mtd.unique)} sub={`${mtd.overallChat ? round1((mtd.unique / mtd.overallChat) * 100) : 0}% of total`} tone="sky" curr={mtd.unique} prev={prevMtd?.unique} onClick={open("unique")} />
        <KpiWithDelta icon={Clock3} label="Overall Chat FRT %" value={`${Math.round(mtd.frtPct)}%`} sub={data.frtTarget !== null ? `Target: ${data.frtTarget}%` : undefined} tone="emerald" curr={mtd.frtPct} prev={prevMtd?.frtPct} onClick={open("frt")} />
        <KpiWithDelta icon={Clock3} label="Avg Resolution Time" value={format(data.avgResolutionMin, "min")} tone="indigo" />
        <KpiWithDelta icon={ShoppingBag} label="Sale Made" value={format(mtd.saleMade, "count")} tone="teal" curr={mtd.saleMade} prev={prevMtd?.saleMade} onClick={open("saleMade")} />
        <KpiWithDelta icon={IndianRupee} label="Revenue" value={format(mtd.revenue, "inr")} tone="amber" curr={mtd.revenue} prev={prevMtd?.revenue} onClick={open("revenue")} />
        <KpiWithDelta icon={TrendingUp} label="AOV" value={format(mtd.aov, "inr")} tone="cyan" curr={mtd.aov} prev={prevMtd?.aov} onClick={open("aov")} />
      </div>

      {data.salesNote && (
        <p className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.salesNote}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChatVolumeTrendCard data={data} onOpenDetails={onOpenDetails} />

        <SectionCard icon={Clock3} title="FRT Performance" tone="emerald" footnote={data.frtTarget !== null ? `Target: ${data.frtTarget}%. Set by an admin, same as Planned Capacity below.` : "No FRT% target has been set yet -- an admin can set one below."}>
          <ViewDetailsButton onClick={() => onOpenDetails(frtDetail(data))} />
          <div className="flex flex-col items-center py-4">
            <div className="relative flex h-40 w-40 items-center justify-center rounded-full" style={{ background: `conic-gradient(#059669 ${mtd.frtPct * 3.6}deg, #e2e8f0 0deg)` }}>
              <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-white">
                <span className="text-2xl font-bold text-slate-800">{Math.round(mtd.frtPct)}%</span>
                {data.frtTarget !== null && <span className="text-[10px] text-slate-400">Target: {data.frtTarget}%</span>}
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><b className="text-slate-800">{fmtN(mtd.withoutAgentFrt)}</b><p className="text-slate-500">With Out Agent FRT Chat Volume</p></div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><b className="text-slate-800">{fmtN(mtd.overallChat - mtd.withoutAgentFrt)}</b><p className="text-slate-500">With Agent FRT Chat Volume</p></div>
          </div>
        </SectionCard>

        <RepeatChatDonut data={data} onOpenDetails={onOpenDetails} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard icon={CalendarCheck} title="Capacity & Workforce" tone="violet" footnote="Roster/Present from db_masmis.bb_apr (lob = 'BVO Chat') -- same shared Chat-roster figure on every tab, no Kenaz/Bevzilla split. UL is roster minus present (derived), not a real leave-type flag.">
          <ViewDetailsButton onClick={() => onOpenDetails(capacityDetail(data, "Capacity & Workforce"))} />
          {data.roster ? (
            <>
              <div className="mb-3 grid grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-2 text-center"><b className="block text-sm text-slate-800">{data.roster.roster}</b>Roster</div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-2 text-center"><b className="block text-sm text-slate-800">{data.roster.present}</b>Present</div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-2 text-center"><b className="block text-sm text-slate-800">{data.roster.ul}</b>UL</div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-2 text-center"><b className="block text-sm text-slate-800">{data.roster.ulPct}%</b>UL %</div>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <ComposedChart data={data.daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
                  <Bar dataKey="plannedCapacity" name="Planned Capacity" fill="#c4b5fd" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="overall" name="Actual Chat Volume" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
                <div><b className="block text-slate-800">{format(mtd.capacityUtilizationPct, "pct0")}</b>Overall Capacity Utilization</div>
                <div><b className="block text-slate-800">{mtd.plannedCapacity ? format(pct2(mtd.unique, mtd.plannedCapacity), "pct0") : "—"}</b>Unique Capacity Utilization</div>
                <div><b className="block text-slate-800">{data.roster.present > 0 ? round1(mtd.unique / data.roster.present) : "—"}</b>Unique Chat Per Agent</div>
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-xs text-slate-400">No roster data (db_masmis.bb_apr, lob = 'BVO Chat') for this period.</p>
          )}
        </SectionCard>

        <SectionCard icon={ShoppingBag} title="Sales & Revenue Performance" tone="teal">
          <ViewDetailsButton onClick={() => onOpenDetails(salesRevenueDetail(data, "Sales & Revenue Performance"))} />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <KpiCard icon={ShoppingBag} label="Sale Made" value={format(mtd.saleMade, "count")} tone="teal" onClick={open("saleMade")} />
            <KpiCard icon={IndianRupee} label="Revenue" value={format(mtd.revenue, "inr")} tone="amber" onClick={open("revenue")} />
            <KpiCard icon={TrendingUp} label="AOV" value={format(mtd.aov, "inr")} tone="indigo" onClick={open("aov")} />
            <KpiCard icon={Percent} label="Conversion % (Overall)" value={format(mtd.convOverallPct, "pct1")} tone="cyan" />
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={data.daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} />
              <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} formatter={(v, name) => (name === "Revenue" ? formatINR(Number(v)) : v)} />
              <Bar yAxisId="l" dataKey="saleMade" name="Sale Made" fill="#0d9488" radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="revenue" name="Revenue" stroke="#d97706" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard icon={Sun} title="Day vs Night Performance" tone="amber" footnote="Only Unique Chat Volume and FRT % are shown -- bb_sale carries no timestamp/shift column, so Sale Made/Revenue/AOV/Conversion% cannot honestly be attributed to a shift.">
          {dayShare ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700"><Sun className="h-3.5 w-3.5" />10 AM – 7 PM</div>
                  <p className="text-lg font-bold text-slate-800">{fmtN(dayShare.day.unique)}</p>
                  <p className="text-[10px] text-slate-500">Unique Chat Volume</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-600">FRT % {dayShare.day.frtPct}%</p>
                </div>
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700"><Moon className="h-3.5 w-3.5" />8 PM – 9 AM</div>
                  <p className="text-lg font-bold text-slate-800">{fmtN(dayShare.night.unique)}</p>
                  <p className="text-[10px] text-slate-500">Unique Chat Volume</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-600">FRT % {dayShare.night.frtPct}%</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={90}>
                <BarChart data={[{ name: "Overall", day: dayShare.day.overall, night: dayShare.night.overall }]} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" hide />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="day" name="Day Shift" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="night" name="Night Shift" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-xs text-slate-400">No day_shift_night_shift data for this period.</p>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChatFunnelCard data={data} onOpenDetails={onOpenDetails} />
        <div className="lg:col-span-2"><TopAgentsTable data={data} onAgentClick={onAgentClick} /></div>
      </div>
    </div>
  );
}

/** part/whole as a percent, tolerant of a null whole (Capacity & Workforce's
 * "Unique Capacity Utilization" -- plannedCapacity can be null). */
function pct2(part: number, whole: number | null): number {
  return whole && whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/* =============================== LOB layout ================================ */

function LobDashboard({ data, prevMtd, onOpenDetails, onAgentClick }: { data: OverviewData; prevMtd: Values | null; onOpenDetails: (chart: ChartDetail) => void; onAgentClick: (a: TopAgentRow) => void }) {
  const mtd = data.values.mtd;
  const open = (k: KpiKey) => () => onOpenDetails(kpiDetail(data, k));
  /** Kenaz/Bevzilla have no sale figures (bb_sale has no such split) -- every
   * sale-related KPI/chart/insight is hidden for them. */
  const hasSales = data.salesAvailable;

  const conversionTrend = useMemo(
    () => data.daily.map((d) => ({
      date: d.date,
      onOverall: d.overall > 0 && d.saleMade !== null ? round1((d.saleMade / d.overall) * 100) : 0,
      onUnique: d.unique > 0 && d.saleMade !== null ? round1((d.saleMade / d.unique) * 100) : 0,
    })),
    [data.daily],
  );

  const orderTypeDonut = mtd.saleMade && mtd.saleMade > 0 && mtd.prepaidCount !== null && mtd.rtoCount !== null
    ? [{ name: "Prepaid", value: mtd.prepaidCount }, { name: "RTO", value: mtd.rtoCount }]
    : [];

  const renderOrderDonut = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Pie data={orderTypeDonut} dataKey="value" nameKey="name" cx="50%" cy="46%" innerRadius={height * 0.23} outerRadius={height * 0.37} paddingAngle={2}>
          {orderTypeDonut.map((entry, i) => <Cell key={entry.name} fill={ORDER_COLORS[i % ORDER_COLORS.length]} stroke="white" strokeWidth={2} />)}
        </Pie>
        <Tooltip {...TOOLTIP_PROPS} itemStyle={{ color: "#f1f5f9" }} formatter={(v: number) => v.toLocaleString("en-IN")} />
        <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} formatter={(value: string, entry: { payload?: { value?: number } }) => `${value}: ${fmtN(entry.payload?.value ?? 0)} (${mtd.saleMade ? round1(((entry.payload?.value ?? 0) / mtd.saleMade) * 100) : 0}%)`} />
      </PieChart>
    </ResponsiveContainer>
  );
  const orderTypeDetail: ChartDetail = {
    title: "Order Type Analysis (PTP)",
    overall: [
      { label: "Total Sales", value: format(mtd.saleMade, "count") },
      { label: "Prepaid", value: format(mtd.prepaidCount, "count") },
      { label: "RTO", value: format(mtd.rtoCount, "count") },
      { label: "RTO %", value: format(mtd.rtoPct, "pct1") },
    ],
    renderChart: orderTypeDonut.length > 0 ? () => renderOrderDonut(380) : undefined,
    metrics: [
      { key: "prepaidCount", label: "Prepaid", drill: { kind: "sum", field: "prepaidCount", fmt: "count" } },
      { key: "rtoCount", label: "RTO", drill: { kind: "sum", field: "rtoCount", fmt: "count" } },
      { key: "saleMade", label: "Total Sales", drill: { kind: "sum", field: "saleMade", fmt: "count" } },
    ],
  };

  const renderConversionChart = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={conversionTrend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} unit="%" />
        <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} formatter={(v: number) => `${v}%`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="onOverall" name="Conversion % (Overall)" fill="#0891b2" radius={[3, 3, 0, 0]} />
        <Bar dataKey="onUnique" name="Conversion % (Unique)" fill="#059669" radius={[3, 3, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
  const conversionDetail: ChartDetail = {
    title: "Conversion Performance",
    overall: [
      { label: "Conversion % (Overall)", value: format(mtd.convOverallPct, "pct1") },
      { label: "Conversion % (Unique)", value: format(mtd.convUniquePct, "pct1") },
      { label: "Sale Made", value: format(mtd.saleMade, "count") },
    ],
    renderChart: () => renderConversionChart(400),
    metrics: [
      { key: "onOverall", label: "Conversion % (Overall)", drill: { kind: "ratio", num: "saleMade", den: "overall" } },
      { key: "onUnique", label: "Conversion % (Unique)", drill: { kind: "ratio", num: "saleMade", den: "unique" } },
    ],
  };

  const insights = useMemo(() => {
    const out: Array<{ text: string; tone: "up" | "down" | "info" | "warn" }> = [];
    if (prevMtd && prevMtd.overallChat > 0) {
      const d = round1(((mtd.overallChat - prevMtd.overallChat) / prevMtd.overallChat) * 100);
      out.push({ text: `Chat volume ${d >= 0 ? "increased" : "decreased"} by ${Math.abs(d)}% compared to the previous period.`, tone: d >= 0 ? "up" : "down" });
    }
    if (hasSales && prevMtd && prevMtd.revenue) {
      const dRev = round1((((mtd.revenue ?? 0) - prevMtd.revenue) / prevMtd.revenue) * 100);
      const dAov = prevMtd.aov ? round1((((mtd.aov ?? 0) - prevMtd.aov) / prevMtd.aov) * 100) : null;
      out.push({ text: `Revenue ${dRev >= 0 ? "grew" : "fell"} by ${Math.abs(dRev)}%${dAov !== null ? ` with AOV ${dAov >= 0 ? "up" : "down"} ${Math.abs(dAov)}%` : ""}.`, tone: dRev >= 0 ? "up" : "down" });
    }
    if (mtd.overallChat > 0) {
      out.push({ text: `Unique chat contribution is ${round1((mtd.unique / mtd.overallChat) * 100)}% of total volume.`, tone: "info" });
    }
    out.push({ text: `FRT % is ${Math.round(mtd.frtPct)}%${data.frtTarget !== null ? `, ${mtd.frtPct >= data.frtTarget ? "at or above" : "below"} the ${data.frtTarget}% target.` : "."}`, tone: mtd.frtPct >= 90 ? "up" : "warn" });
    if (hasSales && mtd.saleMade) {
      out.push({ text: `Prepaid orders are ${mtd.rtoPct !== null ? round1(100 - mtd.rtoPct) : "—"}% of total sales.`, tone: "info" });
      if (mtd.rtoPct !== null && mtd.rtoCount) out.push({ text: `RTO is ${mtd.rtoPct}% (${fmtN(mtd.rtoCount)} orders). Focus on address confirmation.`, tone: "warn" });
    }
    return out;
  }, [mtd, prevMtd, data.frtTarget, hasSales]);

  return (
    <div className="space-y-4">
      {hasSales && (
      <SectionCard
        icon={ShoppingBag} title="PTP Performance" tone="rose"
        footnote={`Sale & Revenue Metrics (PTP). ${fmtDate(data.from)} to ${fmtDate(data.to)}. RTO = final_status 'RTO' within the same deduped Sale Made orders as Sale Made/Revenue; Prepaid is the rest.`}
      >
        {data.salesNote && (
          <p className="mb-3 flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.salesNote}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <KpiWithDelta icon={ShoppingBag} label="Sale Count" value={format(mtd.saleMade, "count")} tone="teal" curr={mtd.saleMade} prev={prevMtd?.saleMade} onClick={open("saleMade")} />
          <KpiWithDelta icon={IndianRupee} label="Revenue" value={format(mtd.revenue, "inr")} tone="amber" curr={mtd.revenue} prev={prevMtd?.revenue} onClick={open("revenue")} />
          <KpiWithDelta icon={TrendingUp} label="AOV" value={format(mtd.aov, "inr")} tone="indigo" curr={mtd.aov} prev={prevMtd?.aov} onClick={open("aov")} />
          <KpiCard icon={Undo2} label="RTO" value={format(mtd.rtoCount, "count")} sub={mtd.rtoPct !== null ? `${mtd.rtoPct}%` : undefined} tone="red" onClick={open("rto")} />
          <KpiCard icon={CreditCard} label="Prepaid" value={format(mtd.prepaidCount, "count")} sub={mtd.rtoPct !== null ? `${round1(100 - mtd.rtoPct)}% of sales` : undefined} tone="emerald" onClick={open("prepaid")} />
          <KpiCard icon={Percent} label="Conversion % On Overall" value={format(mtd.convOverallPct, "pct1")} tone="cyan" onClick={open("convOverall")} />
          <KpiCard icon={Users} label="Conversion % On Unique" value={format(mtd.convUniquePct, "pct1")} tone="violet" onClick={open("convUnique")} />
        </div>
      </SectionCard>
      )}

      <SectionCard icon={MessageSquare} title={`Chat Dashboard BVO — ${data.userType}`} tone="rose" footnote={`Chat Operations & Performance (BVO). ${fmtDate(data.from)} to ${fmtDate(data.to)}.`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <KpiWithDelta icon={CalendarCheck} label="Planned Capacity" value={format(mtd.plannedCapacity, "count")} tone="violet" onClick={open("plannedCapacity")} />
          <KpiWithDelta icon={MessageSquare} label="Overall Chat Volume" value={fmtN(mtd.overallChat)} tone="rose" curr={mtd.overallChat} prev={prevMtd?.overallChat} onClick={open("overallChat")} />
          <KpiWithDelta icon={Repeat} label="Unique Chat Volume" value={fmtN(mtd.unique)} tone="sky" curr={mtd.unique} prev={prevMtd?.unique} onClick={open("unique")} />
          <KpiCard icon={Gauge} label="Capacity Utilization" value={format(mtd.capacityUtilizationPct, "pct0")} tone="indigo" onClick={open("capacityUtil")} />
          <KpiWithDelta icon={Clock3} label="FRT %" value={`${Math.round(mtd.frtPct)}%`} sub={data.frtTarget !== null ? `Target: ${data.frtTarget}%` : undefined} tone="emerald" curr={mtd.frtPct} prev={prevMtd?.frtPct} onClick={open("frt")} />
          <KpiCard icon={Repeat} label="Repeat 24hrs" value={fmtN(mtd.repeat24)} tone="cyan" onClick={open("repeat24")} />
          <KpiCard icon={Repeat} label="Repeat 48hrs" value={fmtN(mtd.repeat48)} tone="cyan" onClick={open("repeat48")} />
          <KpiCard icon={Repeat} label="Repeat 72hrs" value={fmtN(mtd.repeat72)} tone="cyan" onClick={open("repeat72")} />
          <KpiCard icon={Repeat} label="Repeat > 72hrs" value={fmtN(mtd.repeatMore72)} tone="cyan" onClick={open("repeatMore72")} />
          <KpiCard icon={Users} label="With Out Agent FRT" value={fmtN(mtd.withoutAgentFrt)} tone="red" onClick={open("withoutAgentFrt")} />
          {hasSales && (
            <>
              <KpiCard icon={ShoppingBag} label="Sale Made" value={format(mtd.saleMade, "count")} tone="teal" onClick={open("saleMade")} />
              <KpiCard icon={IndianRupee} label="Revenue" value={format(mtd.revenue, "inr")} tone="amber" onClick={open("revenue")} />
              <KpiCard icon={TrendingUp} label="AOV" value={format(mtd.aov, "inr")} tone="indigo" onClick={open("aov")} />
              <KpiCard icon={Percent} label="Conv % Overall" value={format(mtd.convOverallPct, "pct1")} tone="cyan" onClick={open("convOverall")} />
              <KpiCard icon={Users} label="Conv % Unique" value={format(mtd.convUniquePct, "pct1")} tone="violet" onClick={open("convUnique")} />
            </>
          )}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChatVolumeTrendCard data={data} onOpenDetails={onOpenDetails} />
        <RepeatChatDonut data={data} onOpenDetails={onOpenDetails} />
        <SectionCard icon={Clock3} title="FRT Performance" tone="emerald" footnote={data.frtTarget !== null ? `Dashed line is the ${data.frtTarget}% admin-set target.` : "No FRT% target has been set yet -- an admin can set one below."}>
          <ViewDetailsButton onClick={() => onOpenDetails(frtDetail(data))} />
          {renderFrtLine(data, 260)}
        </SectionCard>
      </div>

      {hasSales && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SectionCard icon={ShoppingBag} title="Sales & Revenue Trend (Chat)" tone="teal">
            <ViewDetailsButton onClick={() => onOpenDetails(salesRevenueDetail(data, "Sales & Revenue Trend (Chat)"))} />
            {renderSalesRevenueChart(data, 240)}
          </SectionCard>

          <SectionCard icon={CreditCard} title="Order Type Analysis (PTP)" tone="indigo">
            <ViewDetailsButton onClick={() => onOpenDetails(orderTypeDetail)} />
            {orderTypeDonut.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-400">No deduped Sale Made orders for this period.</p>
            ) : renderOrderDonut(240)}
            <p className="mt-1 text-center text-[11px] text-slate-500">{format(mtd.saleMade, "count")} Total Sales</p>
          </SectionCard>

          <SectionCard icon={Percent} title="Conversion Performance" tone="cyan">
            <ViewDetailsButton onClick={() => onOpenDetails(conversionDetail)} />
            {renderConversionChart(240)}
          </SectionCard>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard icon={Gauge} title="Capacity vs Actual Chat Volume" tone="violet">
          <ViewDetailsButton onClick={() => onOpenDetails(capacityDetail(data, "Capacity vs Actual Chat Volume"))} />
          {renderCapacityChart(data, 260)}
        </SectionCard>

        <div className="lg:col-span-2"><TopAgentsTable data={data} onAgentClick={onAgentClick} /></div>
      </div>

      <SectionCard icon={Lightbulb} title="Key Insights" tone="amber" footnote="Generated from this range's real figures vs. the immediately preceding period of equal length -- never invented commentary.">
        <ul className="space-y-2">
          {insights.map((ins, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                ins.tone === "up" ? "bg-emerald-100 text-emerald-600" : ins.tone === "down" ? "bg-red-100 text-red-600" : ins.tone === "warn" ? "bg-amber-100 text-amber-600" : "bg-sky-100 text-sky-600"
              }`}>
                {ins.tone === "up" ? <ArrowUpRight className="h-3 w-3" /> : ins.tone === "down" ? <ArrowDownRight className="h-3 w-3" /> : ins.tone === "warn" ? <Info className="h-3 w-3" /> : <Lightbulb className="h-3 w-3" />}
              </span>
              {ins.text}
            </li>
          ))}
          {insights.length === 0 && <li className="text-xs text-slate-400">Not enough data yet to generate insights for this period.</li>}
        </ul>
      </SectionCard>
    </div>
  );
}

/* ================================= shell ==================================== */

export function BellavitaChatOverview({
  apiPath, from, to, onRangeChange,
}: { apiPath: string; from: string; to: string; onRangeChange: (from: string, to: string) => void }) {
  const [userType, setUserType] = useState<UserType>("Overall");
  const [data, setData] = useState<OverviewData | null>(null);
  const [prevMtd, setPrevMtd] = useState<Values | null>(null);
  const [drawerChart, setDrawerChart] = useState<ChartDetail | null>(null);
  const [qrcOpen, setQrcOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [capType, setCapType] = useState<(typeof CAPACITY_TYPES)[number]>("Chat");
  const [capValue, setCapValue] = useState("");
  const [capBusy, setCapBusy] = useState(false);
  const [capMsg, setCapMsg] = useState("");
  const [frtValue, setFrtValue] = useState("");
  const [frtBusy, setFrtBusy] = useState(false);
  const [frtMsg, setFrtMsg] = useState("");

  /** Per-(range, tab) cache + in-flight de-dupe: switching to a tab already
   * visited (or prefetched after the first load) renders instantly instead of
   * re-running the backend's heavy queries. Cleared whenever a target/capacity
   * is saved, since those change the figures. */
  const cacheRef = useRef(new Map<string, OverviewData>());
  const inflightRef = useRef(new Map<string, Promise<OverviewData>>());
  const currentKeyRef = useRef("");
  const fetchOverview = useCallback((f: string, t: string, type: UserType): Promise<OverviewData> => {
    const key = `${f}|${t}|${type}`;
    const cached = cacheRef.current.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = inflightRef.current.get(key);
    if (pending) return pending;
    const p = hrmsApi
      .get<{ success: boolean; data: OverviewData }>(`${apiPath}/overview?from=${f}&to=${t}&userType=${type}`)
      .then((res) => { cacheRef.current.set(key, res.data); return res.data; })
      .finally(() => { inflightRef.current.delete(key); });
    inflightRef.current.set(key, p);
    return p;
  }, [apiPath]);

  const load = useCallback(async (force = false) => {
    if (force) cacheRef.current.clear();
    const key = `${from}|${to}|${userType}`;
    currentKeyRef.current = key;
    const cached = cacheRef.current.get(key);
    if (cached) { setData(cached); setError(""); setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const fresh = await fetchOverview(from, to, userType);
      if (currentKeyRef.current !== key) return; // a newer tab/range was picked while this loaded
      setData(fresh);
      // Warm the other tabs one at a time in the background so switching to them is instant.
      void (async () => {
        for (const t of USER_TYPES.map((u) => u.key)) {
          if (t === userType) continue;
          try { await fetchOverview(from, to, t); } catch { /* prefetch is best-effort */ }
        }
      })();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Bellavita Chat overview.");
    } finally {
      setLoading(false);
    }
  }, [from, to, userType, fetchOverview]);
  useEffect(() => { void load(); }, [load]);

  const loadPrevious = useCallback(async () => {
    setPrevMtd(null);
    const prev = previousPeriod(from, to);
    try {
      const res = await fetchOverview(prev.from, prev.to, userType);
      setPrevMtd(res.values.mtd);
    } catch {
      setPrevMtd(null);
    }
  }, [from, to, userType, fetchOverview]);
  useEffect(() => { void loadPrevious(); }, [loadPrevious]);

  async function saveCapacity() {
    if (!data) return;
    setCapBusy(true);
    setCapMsg("");
    try {
      await hrmsApi.put(`${apiPath}/planned-capacity`, { userType: capType, month: data.capacity.month, capacity: Number(capValue) });
      setCapValue("");
      setCapMsg(`Saved planned capacity for ${capType}, ${monthLabel(data.capacity.month)}.`);
      await load(true);
    } catch (err) {
      setCapMsg(err instanceof Error ? err.message : "Could not save the planned capacity.");
    } finally {
      setCapBusy(false);
    }
  }

  async function saveFrtTarget() {
    if (!data) return;
    setFrtBusy(true);
    setFrtMsg("");
    try {
      await hrmsApi.put(`${apiPath}/frt-target`, { month: data.capacity.month, target: Number(frtValue) });
      setFrtValue("");
      setFrtMsg(`Saved FRT% target for ${monthLabel(data.capacity.month)}.`);
      await load(true);
    } catch (err) {
      setFrtMsg(err instanceof Error ? err.message : "Could not save the FRT target.");
    } finally {
      setFrtBusy(false);
    }
  }

  /** Top Agents row click: opens the same View Details drawer with that
   * agent's own week-wise/date-wise figures (fetched fresh from
   * /overview/agent-trend, never derived from the page-wide daily rows). */
  async function openAgent(a: TopAgentRow) {
    if (!data) return;
    const title = `Agent — ${a.agent}`;
    setDrawerChart({
      title, overall: [], metrics: [], rows: [],
      renderChart: () => <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>,
    });
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Array<{ date: string; overall: number; unique: number; inTat: number; saleMade: number | null; revenue: number | null }> }>(
        `${apiPath}/overview/agent-trend?from=${data.from}&to=${data.to}&userType=${userType}&agent=${encodeURIComponent(a.agent)}&empId=${encodeURIComponent(a.empId)}`,
      );
      const rows: DailyRow[] = res.data.map((r) => ({
        date: r.date, overall: r.overall, unique: r.unique, repeatChat: Math.max(0, r.overall - r.unique),
        frtPct: r.overall > 0 ? round1((r.inTat / r.overall) * 100) : 0, inTat: r.inTat,
        withoutAgentFrt: 0, repeat24: 0, repeat48: 0, repeat72: 0, repeatMore72: 0,
        saleMade: r.saleMade, revenue: r.revenue, plannedCapacity: null, rtoCount: null, prepaidCount: null,
      }));
      const withSales = rows.some((r) => r.saleMade !== null);
      setDrawerChart({
        title, rows,
        overall: [
          { label: "Chat Volume", value: fmtN(a.overall) },
          { label: "Unique Chats", value: fmtN(a.unique) },
          { label: "FRT %", value: `${a.frtPct}%` },
          ...(withSales ? [
            { label: "Sales", value: format(a.saleCount, "count") },
            { label: "Revenue", value: format(a.revenue, "inr") },
            { label: "Conversion %", value: a.conversionPct !== null ? `${a.conversionPct}%` : "—" },
          ] : []),
        ],
        renderChart: () => (
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="overall" name="Chat Volume" fill="#e11d48" radius={[3, 3, 0, 0]} />
              <Bar dataKey="unique" name="Unique Chats" fill="#0284c7" radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        ),
        metrics: [
          { key: "overall", label: "Chat Volume", drill: { kind: "sum", field: "overall", fmt: "count" } },
          { key: "unique", label: "Unique Chats", drill: { kind: "sum", field: "unique", fmt: "count" } },
          { key: "frtPct", label: "FRT %", drill: { kind: "ratio", num: "inTat", den: "overall" } },
          ...(withSales ? [
            { key: "saleMade", label: "Sales", drill: { kind: "sum" as const, field: "saleMade" as const, fmt: "count" as const } },
            { key: "revenue", label: "Revenue", drill: { kind: "sum" as const, field: "revenue" as const, fmt: "currency" as const } },
            { key: "conv", label: "Conv %", drill: { kind: "ratio" as const, num: "saleMade" as const, den: "overall" as const } },
          ] : []),
        ],
      });
    } catch (err) {
      setDrawerChart({
        title, rows: [], metrics: [],
        overall: [{ label: "Could not load", value: err instanceof Error ? err.message : "Unable to load this agent." }],
      });
    }
  }

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const mtd = data.values.mtd;
    const rows: Array<[string, string]> = [
      ["Planned Capacity", format(mtd.plannedCapacity, "count")],
      ["Overall Chat Volume", fmtN(mtd.overallChat)],
      ["Unique Chat Volume", fmtN(mtd.unique)],
      ["Capacity Utilization", format(mtd.capacityUtilizationPct, "pct0")],
      ["FRT %", format(mtd.frtPct, "pct0")],
      ["Avg Resolution Time (min)", format(data.avgResolutionMin, "min")],
      ["Repeat 24hrs", fmtN(mtd.repeat24)], ["Repeat 48hrs", fmtN(mtd.repeat48)],
      ["Repeat 72hrs", fmtN(mtd.repeat72)], ["Repeat > 72hrs", fmtN(mtd.repeatMore72)],
      ["With Out Agent FRT", fmtN(mtd.withoutAgentFrt)],
      ["Sale Made", format(mtd.saleMade, "count")], ["Revenue", format(mtd.revenue, "inr")], ["AOV", format(mtd.aov, "inr")],
      ["RTO", format(mtd.rtoCount, "count")], ["Prepaid", format(mtd.prepaidCount, "count")],
      ["Conversion % Overall", format(mtd.convOverallPct, "pct1")], ["Conversion % Unique", format(mtd.convUniquePct, "pct1")],
      ["Fraud Cases", fmtN(data.fraudCount)],
    ];
    return [{
      title: "Overview",
      tables: [
        { title: `Chat Dashboard — ${data.userType}`, columns: ["Metric", "Value"], rows },
        {
          title: `QRC — ${data.userType}`,
          columns: ["Disposition", "Unique chats"],
          rows: data.qrc.categories.map((cat) => [cat, fmtN(data.qrc.values.mtd?.counts[cat] ?? 0)]),
        },
        {
          title: "Top Agents",
          columns: ["Agent", "Chat Volume", "Unique", "Sales", "Revenue", "Conv%", "FRT%"],
          rows: data.topAgents.map((a) => [a.agent, a.overall, a.unique, a.saleCount ?? "—", a.revenue !== null ? formatINR(a.revenue) : "—", a.conversionPct !== null ? `${a.conversionPct}%` : "—", `${a.frtPct}%`]),
        },
      ],
    }];
  }, [data]);

  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  // A tab click renders the new tab's own spinner at once, never the previous
  // tab's figures laid out under the new tab's layout.
  if (!data || data.userType !== userType) {
    return (
      <div className="space-y-5">
        <div role="tablist" aria-label="User type" className="flex justify-end">
          <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
            {USER_TYPES.map((t) => (
              <button
                key={t.key} type="button" role="tab" aria-selected={userType === t.key} title={t.hint}
                onClick={() => setUserType(t.key)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  userType === t.key ? "bg-white text-rose-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {loading || !data ? <Spinner tone="blue" /> : null}
      </div>
    );
  }

  const mtd = data.values.mtd;
  const empty = mtd.overallChat === 0;
  const capMissing = data.capacity.byType[capType] === null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardExportMenu
          reportTitle={`Bellavita — Chat Dashboard (${data.userType})`}
          fileBaseName={`Bellavita_Chat_${data.userType}`}
          raw={{ dashboard: "bellavita_chat_overview", from: data.from, to: data.to }}
          subtitle={`${fmtDate(data.from)} to ${fmtDate(data.to)}`}
          slides={exportSlides}
          activeSlideTitle="Overview"
        />
        <div role="tablist" aria-label="User type" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
          {USER_TYPES.map((t) => (
            <button
              key={t.key} type="button" role="tab" aria-selected={userType === t.key} title={t.hint}
              onClick={() => setUserType(t.key)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                userType === t.key ? "bg-white text-rose-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {empty && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          <span className="inline-flex items-center gap-2"><Inbox className="h-4 w-4" />
            No chats between {fmtDate(data.from)} and {fmtDate(data.to)}
            {data.latestChatDate ? <> — the newest uploaded chat is from <strong>{fmtDate(data.latestChatDate)}</strong>.</> : "."}
          </span>
          {data.latestChatDate && (
            <button
              type="button"
              onClick={() => onRangeChange(`${data.latestChatDate!.slice(0, 7)}-01`, data.latestChatDate!)}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-amber-700"
            >
              Show that month
            </button>
          )}
        </div>
      )}

      {userType === "Overall"
        ? <OverallDashboard data={data} prevMtd={prevMtd} onOpenDetails={setDrawerChart} onAgentClick={openAgent} />
        : <LobDashboard data={data} prevMtd={prevMtd} onOpenDetails={setDrawerChart} onAgentClick={openAgent} />}

      <QrcSection data={data} onOpenDetails={() => setQrcOpen(true)} />

      <ChartDetailsDrawer chart={drawerChart} rows={data.daily} onClose={() => setDrawerChart(null)} />
      <QrcDetailsDrawer data={data} open={qrcOpen} onClose={() => setQrcOpen(false)} />

      {(data.canSetCapacity || CAPACITY_TYPES.some((t) => data.capacity.byType[t] === null) || data.frtTarget === null) && (
        <SectionCard icon={Target} title={`Targets — ${monthLabel(data.capacity.month)}`} tone="violet"
          footnote="Both are business commitments, so they're entered by an admin rather than derived from data. Planned Capacity is per user type; FRT% target applies to every tab.">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
            {CAPACITY_TYPES.map((t) => (
              <span key={t}>{t} capacity: <b className="text-slate-800">{data.capacity.byType[t] === null ? "not set" : fmtN(data.capacity.byType[t] as number)}</b></span>
            ))}
            <span>FRT% target: <b className="text-slate-800">{data.frtTarget === null ? "not set" : `${data.frtTarget}%`}</b></span>
          </div>
          {data.canSetCapacity ? (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={capType} onChange={(e) => setCapType(e.target.value as (typeof CAPACITY_TYPES)[number])} aria-label="User type"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none"
                >
                  {CAPACITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  type="number" min={1} inputMode="numeric" value={capValue} onChange={(e) => setCapValue(e.target.value)}
                  placeholder={capMissing ? "Chats for the month" : `Now ${fmtN(data.capacity.byType[capType] as number)}`}
                  aria-label="Planned capacity for the month"
                  className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none"
                />
                <button
                  type="button" onClick={() => void saveCapacity()} disabled={capBusy || !(Number(capValue) > 0)}
                  className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {capBusy ? "Saving…" : "Save capacity"}
                </button>
                {capMsg && <span className="text-[11px] text-slate-500">{capMsg}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number" min={1} max={100} inputMode="numeric" value={frtValue} onChange={(e) => setFrtValue(e.target.value)}
                  placeholder={data.frtTarget === null ? "FRT% target" : `Now ${data.frtTarget}%`}
                  aria-label="FRT% target for the month"
                  className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none"
                />
                <button
                  type="button" onClick={() => void saveFrtTarget()} disabled={frtBusy || !(Number(frtValue) > 0)}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {frtBusy ? "Saving…" : "Save FRT target"}
                </button>
                {frtMsg && <span className="text-[11px] text-slate-500">{frtMsg}</span>}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-400">Ask an admin to set Planned Capacity or the FRT% target.</p>
          )}
        </SectionCard>
      )}
    </div>
  );
}
