import { Fragment, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronRight, Clock, Database,
  Filter, Headphones, Loader2, Minus, PenLine, Radio, ShieldAlert, Sigma, Sparkles, Target,
  Users, Users2, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * Process Operations — everything a process is actually measured on.
 *
 * The Client Process KPI Dashboard scores a fixed registry of client-facing
 * targets. Metrics wired through KPI Studio are not on that list and so appear
 * nowhere, which left 57 metric codes holding real values and no page reading
 * them. This is that page.
 *
 * The chart and card language follows the Mydashboards house style this project
 * asked to adopt: navy chart headers, shared tooltip/axis/grid constants, circle
 * legends, axis lines off, and gradient KPI cards with a corner orb and a
 * coloured value. Two things are deliberately NOT copied. Their charts pair a
 * count axis with a percent axis on one plot; almost everything here is already a
 * percentage, so a second axis would add a scale nobody needs. And every tile
 * here is a button that opens the drill-down, which their cards are not.
 *
 * ── What this page refuses to do ─────────────────────────────────────────────
 *
 * A missing reading renders as "no data", never as zero. Most of the defects
 * found while wiring these metrics were confident zeroes standing in for
 * something nobody had measured.
 *
 * Every tile carries its age, because feeds stop silently and the last value goes
 * on looking current — the biometric sync stopped on 18 June and ran 82 days
 * before anyone noticed.
 *
 * A figure dated today is marked provisional: attendance rows are written absent
 * and become present as punches arrive, so shrinkage reads 100% at breakfast and
 * 0% by evening.
 */

// ── House style, lifted from the reference dashboards ────────────────────────
const NAVY = "#0D1445";
const C_BLUE = "#3B82F6";
const C_GREEN = "#10B981";
const C_PURPLE = "#8B5CF6";
const C_AMBER = "#F59E0B";
const C_RED = "#EF4444";
const C_SLATE = "#64748B";

const TOOLTIP_STYLE = { background: "#FFFFFF", border: "1px solid #334155", borderRadius: 8, fontSize: 12 } as const;
const AXIS_TICK = { fill: "#64748B", fontSize: 11 } as const;
const GRID = { strokeDasharray: "3 3", stroke: "#E2E8F0" } as const;

interface ProcessRow {
  processId: string; processName: string; metrics: number;
  headcount: number; latestDate: string | null; staleDays: number | null;
}
interface Reading {
  metricKey: string; label: string; unit: string | null; direction: string | null;
  value: number | null; staleDays: number | null; latestDate: string | null;
  provisional: boolean; priorValue: number | null; targetValue: number | null;
  trend: Array<{ date: string; value: number | null; numerator: number | null; denominator: number | null }>;
  numerator: number | null; denominator: number | null;
}
interface Section { key: string; title: string; blurb: string | null; metrics: Reading[] }
interface FeedRow {
  metricKey: string; metricName: string; processId: string; processName: string;
  latestDate: string | null; staleDays: number | null; recentReadings: number;
  state: "ok" | "slowing" | "stopped";
}
interface FeedHealth {
  checkedAt: string; warnAfterDays: number; stoppedAfterDays: number;
  counts: { ok: number; slowing: number; stopped: number }; feeds: FeedRow[];
}
interface CatalogMetric { metricCode: string; metricName: string; unit: string | null; direction: string | null }
interface ImportOutcome {
  row: number; metricKey: string; scoreDate: string; value: number | null;
  ok: boolean; message?: string; replaces?: number | null;
}
interface ImportResult { imported: number; errors: Array<{ row: number; message: string }>; outcomes: ImportOutcome[]; dryRun: boolean }
interface RawRows {
  date: string; available: boolean; reason: string | null;
  sourceCode: string | null; sourceObject: string | null;
  totalRows: number | null; truncated: boolean;
  columns: string[]; rows: Array<Record<string, unknown>>;
}
type ReportPeriod = "trend" | "today" | "wtd" | "mtd";
interface Operations {
  processId: string; processName: string; headcount: number;
  windowDays: number; staleAfterDays: number;
  period: ReportPeriod; periodFrom: string | null; periodTo: string | null;
  sections: Section[]; ungrouped: Reading[];
}

const PERIODS: Array<{ key: ReportPeriod; label: string; caption: string }> = [
  { key: "trend", label: "Trend", caption: "Latest reading, 30-day window" },
  { key: "today", label: "Today", caption: "Today so far, vs yesterday" },
  { key: "wtd", label: "WTD", caption: "Week to date (Mon–today), vs the same days last week" },
  { key: "mtd", label: "MTD", caption: "Month to date (1st–today), vs the same days last month" },
];

/** "MTD (1–8 Sep)" — a bare code means nothing; the actual calendar range does. */
function formatPeriodRange(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const day = (d: Date) => d.getDate();
  const mon = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  if (from === to) return `${day(f)} ${mon(f)}`;
  if (mon(f) === mon(t)) return `${day(f)}–${day(t)} ${mon(t)}`;
  return `${day(f)} ${mon(f)} – ${day(t)} ${mon(t)}`;
}
interface Drilldown {
  metricKey: string; metricName: string; unit: string | null; direction: string | null;
  processId: string; processName: string;
  period: ReportPeriod; periodFrom: string | null; periodTo: string | null;
  definition: {
    id: string | null; formula: string | null; grain: string | null;
    effectiveFrom: string | null; effectiveTo: string | null; targetValue: number | null;
    createdBy: string | null; createdAt: string | null; notes: string | null;
  } | null;
  source: {
    sourceCode: string; sourceName: string | null; sourceType: string | null;
    sourceObject: string | null; dateColumn: string | null; processKeyKind: string | null;
    processKeyColumn: string | null; processKeyValue: string | null;
  } | null;
  fields: Array<{
    fieldName: string; displayName: string | null; sourceColumn: string | null;
    aggregateFn: string | null; filter: string | null;
  }>;
  readings: Array<{
    date: string; value: number | null; numerator: number | null;
    denominator: number | null; note: string | null;
  }>;
}

const SECTION_STYLE: Record<string, { accent: string; tint: string; icon: typeof Target }> = {
  conversion: { accent: C_BLUE, tint: "linear-gradient(135deg,#EFF6FF 0%,#DBEAFE 100%)", icon: Target },
  risk: { accent: C_RED, tint: "linear-gradient(135deg,#FEF2F2 0%,#FEE2E2 100%)", icon: ShieldAlert },
  conduct: { accent: C_PURPLE, tint: "linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 100%)", icon: Sparkles },
  quality: { accent: C_GREEN, tint: "linear-gradient(135deg,#ECFDF5 0%,#D1FAE5 100%)", icon: Activity },
  telephony: { accent: "#06B6D4", tint: "linear-gradient(135deg,#ECFEFF 0%,#CFFAFE 100%)", icon: Headphones },
  workforce: { accent: C_AMBER, tint: "linear-gradient(135deg,#FFFBEB 0%,#FEF3C7 100%)", icon: Users2 },
  other: { accent: C_SLATE, tint: "linear-gradient(135deg,#F8FAFC 0%,#F1F5F9 100%)", icon: Activity },
};

function formatValue(value: number | null, unit: string | null): string {
  if (value === null || Number.isNaN(value)) return "no data";
  const u = (unit ?? "").toLowerCase();
  if (u === "percentage" || u === "percent" || u === "ratio") return `${value.toFixed(1)}%`;
  if (u === "seconds") {
    if (value < 90) return `${Math.round(value)}s`;
    return `${Math.floor(value / 60)}m ${String(Math.round(value % 60)).padStart(2, "0")}s`;
  }
  if (u === "currency") return `₹${Math.round(value).toLocaleString("en-IN")}`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Is a move good news? Only knowable when the metric declares a direction. */
function deltaOf(r: Reading): { delta: number; good: boolean | null } | null {
  if (r.value === null || r.priorValue === null) return null;
  const delta = r.value - r.priorValue;
  if (Math.abs(delta) < 0.05) return { delta: 0, good: null };
  if (!r.direction) return { delta, good: null };
  return { delta, good: r.direction === "higher_is_better" ? delta > 0 : delta < 0 };
}

/**
 * Pass/fail against the metric's real configured SLA, the way the reference
 * dashboards state theirs ("Target >= 95%", "Target <= 300s") and colour their
 * project table and comparison charts from it. Returns null -- not a guessed
 * pass -- when no target is configured, which most of this page's metrics do
 * not have yet; the tile then falls back to its section colour instead of
 * claiming a verdict nobody set.
 */
function targetStatus(r: Reading): "pass" | "fail" | null {
  if (r.value === null || r.targetValue === null || !r.direction) return null;
  return r.direction === "higher_is_better"
    ? (r.value >= r.targetValue ? "pass" : "fail")
    : (r.value <= r.targetValue ? "pass" : "fail");
}

/** "Target >= 95%" / "Target <= 300s" -- the comparison the target implies, in the metric's own unit. */
function targetCaption(r: Reading): string | null {
  if (r.targetValue === null || !r.direction) return null;
  const op = r.direction === "higher_is_better" ? "≥" : "≤";
  return `Target ${op} ${formatValue(r.targetValue, r.unit)}`;
}

/** A chart panel with the reference dashboards' navy header. */
function ChartCard({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="px-5 py-3" style={{ background: NAVY }}>
        <h3 className="text-sm font-bold text-white">{title}</h3>
        {subtitle && <p className="text-[10px] text-indigo-200 mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-2 pt-3 pb-4">{children}</div>
    </div>
  );
}

function Sparkline({ trend, color }: { trend: Reading["trend"]; color: string }) {
  // Only points carrying a number: a gap must read as a gap. connectNulls would
  // draw a straight line through a day nobody measured.
  const points = useMemo(() => trend.filter((p) => p.value !== null), [trend]);
  const gid = useMemo(() => `g${Math.random().toString(36).slice(2, 9)}`, []);
  if (points.length < 2) {
    return <div className="h-8 flex items-end text-[9px] text-slate-400">not enough history</div>;
  }
  return (
    <div className="h-8 -mx-0.5">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 1, bottom: 0, left: 1 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(1), ""]} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.75}
            fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * A KPI tile in the reference style — gradient ground, corner orb, icon chip,
 * value in the section's accent — and, unlike theirs, a button. Every figure on
 * this page opens its own root-cause drawer.
 */
const DELTA_TITLE: Record<ReportPeriod, string> = {
  trend: "Against the average of everything older than a week",
  today: "Against yesterday, same time of day",
  wtd: "Against the same weekdays last week",
  mtd: "Against the same days-of-month last month",
};

function KpiCard({ r, staleAfter, accent, tint, period, onOpen }: {
  r: Reading; staleAfter: number; accent: string; tint: string; period: ReportPeriod; onOpen: () => void;
}) {
  const stale = r.staleDays !== null && r.staleDays > staleAfter;
  const d = deltaOf(r);
  // Pass/fail against a REAL configured target, the way the reference
  // dashboards colour theirs -- red/green on the number itself, not just the
  // trend arrow. Falls back to the section's identity colour when no target is
  // set, which is most metrics here; a fabricated threshold would be worse
  // than none.
  const status = targetStatus(r);
  const statusPill = status === "pass"
    ? "bg-emerald-100 text-emerald-700"
    : status === "fail"
      ? "bg-red-100 text-red-700"
      : null;
  const caption = targetCaption(r);
  return (
    <button type="button" onClick={onOpen}
      title="Open the full working behind this number"
      className="group relative text-left rounded-xl overflow-hidden shadow-sm border border-white/40 dark:border-slate-800 cursor-pointer transition-all duration-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={{ background: tint }}>
      <div aria-hidden className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-10 -translate-y-5 translate-x-5"
        style={{ background: accent }} />
      <div className="relative p-3">
        <div className="flex items-start gap-1.5 mb-1.5 min-h-[2.2rem]">
          <div className="p-1 rounded-lg bg-white/60 backdrop-blur-sm shrink-0">
            <Sigma size={12} style={{ color: accent }} />
          </div>
          <p className="text-[9.5px] font-semibold text-slate-600 uppercase tracking-wide leading-tight">
            {r.label}
          </p>
          <div className="ml-auto flex shrink-0 gap-1">
            {r.provisional && (
              <span title="Today is still in progress — this will move as the day fills in"
                className="rounded px-1 py-0.5 text-[8.5px] font-bold bg-white/70 text-blue-700">today</span>
            )}
            {stale && (
              <span title={`Last reading ${r.staleDays} days ago — history, not current`}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[8.5px] font-bold bg-white/70 text-amber-700">
                <Clock className="h-2 w-2" />{r.staleDays}d
              </span>
            )}
          </div>
        </div>

        <div className="flex items-baseline gap-1.5 flex-wrap">
          {statusPill ? (
            <span className={`inline-block rounded-full px-2 py-0.5 text-base font-black leading-none tabular-nums ${statusPill}`}>
              {formatValue(r.value, r.unit)}
            </span>
          ) : (
            <span className={`text-lg font-black leading-none ${r.value === null ? "text-slate-400 text-sm font-normal italic" : ""}`}
              style={r.value === null ? undefined : { color: accent }}>
              {formatValue(r.value, r.unit)}
            </span>
          )}
          {d && (
            <span title={DELTA_TITLE[period]}
              className={`inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums ${
                d.good === null ? "text-slate-500" : d.good ? "text-emerald-600" : "text-red-600"}`}>
              {d.delta === 0 ? <Minus className="h-2.5 w-2.5" />
                : d.delta > 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
              {d.delta === 0 ? "flat" : Math.abs(d.delta).toFixed(1)}
            </span>
          )}
        </div>

        {caption ? (
          <p className="text-[9px] text-slate-600 font-semibold mt-0.5 truncate">{caption}</p>
        ) : r.numerator !== null && r.denominator !== null && r.denominator > 0 ? (
          <p className="text-[9px] text-slate-600 font-semibold mt-0.5 tabular-nums truncate">
            {Math.round(r.numerator).toLocaleString()} of {Math.round(r.denominator).toLocaleString()}
          </p>
        ) : <p className="text-[9px] mt-0.5">&nbsp;</p>}

        <Sparkline trend={r.trend} color={status === "fail" ? C_RED : status === "pass" ? C_GREEN : accent} />
      </div>
    </button>
  );
}

/** The funnel over time. Coverage is dashed: it qualifies the rest, not competes. */
function FunnelChart({ metrics }: { metrics: Reading[] }) {
  const lines: Array<[string, string, string, boolean]> = [
    ["FUNNEL_SCORED_PCT", "Scored", C_SLATE, true],
    ["FUNNEL_OPENING_PCT", "Opening", C_BLUE, false],
    ["FUNNEL_OFFER_PCT", "Offer", C_PURPLE, false],
    ["FUNNEL_SALE_PCT", "Sale", C_GREEN, false],
  ];
  const present = lines.filter(([k]) => metrics.some((m) => m.metricKey === k));
  if (present.length < 2) return null;
  const byDate = new Map<string, Record<string, number | string>>();
  present.forEach(([k]) => {
    const m = metrics.find((x) => x.metricKey === k);
    m?.trend.forEach((p) => {
      if (p.value === null) return;
      const row = byDate.get(p.date) ?? { date: p.date };
      row[k] = p.value;
      byDate.set(p.date, row);
    });
  });
  const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (data.length < 3) return null;
  return (
    <ChartCard title="Conversion funnel over time"
      subtitle="Dashed line is scoring coverage — the share of calls the rest are measured over">
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: -14 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
              tickFormatter={(v) => String(v).slice(5)} minTickGap={22} />
            <YAxis domain={[0, 100]} unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE}
              formatter={(v: number, n: string) => [`${v.toFixed(1)}%`, present.find((l) => l[0] === n)?.[1] ?? n]} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(n: string) => present.find((l) => l[0] === n)?.[1] ?? n} />
            {present.map(([key, , colour, dashed]) => (
              <Line key={key} type="monotone" dataKey={key} stroke={colour} strokeWidth={dashed ? 1.5 : 2}
                strokeDasharray={dashed ? "4 2" : undefined} dot={false} isAnimationActive={false}
                connectNulls={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Seven scored attributes on a fixed axis set — the case radar is actually for. */
function QualityRadar({ metrics }: { metrics: Reading[] }) {
  const data = metrics
    .filter((m) => m.value !== null && (m.unit ?? "").toLowerCase().startsWith("percent"))
    .map((m) => ({ axis: m.label.replace(/ %$/, "").replace(/^Call /, ""), value: Number(m.value) }));
  if (data.length < 3) return null;
  return (
    <ChartCard title="Quality shape" subtitle="Evenly strong, or lopsided? Each axis is a scored parameter">
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="70%">
            <PolarGrid stroke="#E2E8F0" />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: "#64748B" }} />
            <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#94A3B8" }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(1)}%`, ""]} />
            <Radar dataKey="value" stroke={C_GREEN} fill={C_GREEN} fillOpacity={0.3} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Customer risk flags side by side — a bar is the right read for "which is worst". */
function RiskBars({ metrics }: { metrics: Reading[] }) {
  const data = metrics
    .filter((m) => m.value !== null && m.metricKey.startsWith("RISK_"))
    .map((m) => ({ name: m.label.replace(/ %$/, ""), value: Number(m.value) }))
    .sort((a, b) => b.value - a.value);
  if (data.length < 2) return null;
  return (
    <ChartCard title="Customer risk flags" subtitle="Share of examined calls carrying each flag">
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 8 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={124}
              tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(2)}%`, ""]} />
            <Bar dataKey="value" fill={C_RED} radius={[0, 3, 3, 0]} barSize={13} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/**
 * The drawer's own trend chart — line or bar, the reader's choice, with the
 * metric's real configured target drawn as a reference line when one exists.
 * Only points that actually have a value are plotted; a gap in the middle of
 * the range stays a gap rather than being interpolated across, the same
 * honesty rule the top-level sparkline already follows.
 */
function DrilldownTrendChart({ readings, unit, targetValue, direction }: {
  readings: Drilldown["readings"]; unit: string | null; targetValue: number | null; direction: string | null;
}) {
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const data = useMemo(
    () => [...readings].filter((r) => r.value !== null).reverse()
      .map((r) => ({ date: r.date, value: r.value as number })),
    [readings],
  );
  if (data.length < 2) return null;

  const barColor = (v: number) => {
    if (targetValue === null || !direction) return C_BLUE;
    const pass = direction === "higher_is_better" ? v >= targetValue : v <= targetValue;
    return pass ? C_GREEN : C_RED;
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Trend</div>
        <div role="tablist" aria-label="Chart type" className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 p-0.5 shrink-0">
          {(["line", "bar"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={chartType === t} onClick={() => setChartType(t)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize cursor-pointer transition-colors ${
                chartType === t ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="h-40 rounded-lg border border-slate-200 dark:border-slate-800 p-2">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "line" ? (
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false}
                tickFormatter={(v) => String(v).slice(5)} minTickGap={18} />
              <YAxis tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false} width={38} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatValue(v, unit), "Value"]} />
              {targetValue !== null && (
                <ReferenceLine y={targetValue} stroke={C_AMBER} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: "Target", position: "insideTopRight", fontSize: 9, fill: C_AMBER }} />
              )}
              <Line type="monotone" dataKey="value" stroke={C_BLUE} strokeWidth={2}
                dot={{ r: 2.5, fill: C_BLUE }} isAnimationActive={false} />
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false}
                tickFormatter={(v) => String(v).slice(5)} minTickGap={18} />
              <YAxis tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false} width={38} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatValue(v, unit), "Value"]} />
              {targetValue !== null && (
                <ReferenceLine y={targetValue} stroke={C_AMBER} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: "Target", position: "insideTopRight", fontSize: 9, fill: C_AMBER }} />
              )}
              <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {data.map((pt) => <Cell key={pt.date} fill={barColor(pt.value)} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {targetValue !== null && chartType === "bar" && (
        <p className="text-[10px] text-slate-400 mt-1">Green meets target, red misses it — the same rule the tile above colours by.</p>
      )}
    </section>
  );
}

/** A raw column value, formatted for reading rather than left as whatever mysql2 handed back. */
function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

/**
 * The last drill-down level: the individual rows behind ONE day's number,
 * expanded inline under that day's row. Not a new query — the same source and
 * filters that computed the aggregate, just unaggregated, so a viewer sees
 * exactly what was summed rather than a plausible-looking lookalike.
 */
function RawRowsPanel({ processId, metricKey, date, columnCount }: {
  processId: string; metricKey: string; date: string; columnCount: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "raw-rows", processId, metricKey, date],
    queryFn: () => hrmsApi.get<HrmsEnvelope<RawRows>>(
      `/api/process-operations/${processId}/metric/${metricKey}/raw?date=${date}`),
  });
  const r = data?.data;
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30">
      <td colSpan={columnCount} className="px-2 py-2">
        {isLoading || !r ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 py-1">
            <Loader2 className="h-3 w-3 animate-spin" />Loading the individual records…
          </div>
        ) : !r.available ? (
          <p className="text-[11px] text-slate-400 italic py-1">{r.reason ?? "No underlying records to show."}</p>
        ) : r.rows.length === 0 ? (
          <p className="text-[11px] text-slate-400 italic py-1">
            The source was read for this day and returned zero rows — not that a number was zero.
          </p>
        ) : (
          <div>
            <p className="text-[10px] text-slate-500 mb-1.5">
              {r.sourceObject} · {r.totalRows?.toLocaleString()} row{r.totalRows === 1 ? "" : "s"}
              {r.truncated ? ` · showing first ${r.rows.length.toLocaleString()}` : ""}
            </p>
            <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-800 max-h-56 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="bg-white dark:bg-slate-900 text-slate-400 sticky top-0">
                  <tr>{r.columns.map((c) => (
                    <th key={c} className="text-left px-2 py-1 font-semibold font-mono">{c}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      {r.columns.map((c) => (
                        <td key={c} className="px-2 py-1 tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatCellValue(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * The drill-down drawer: the formula, the source it reads, the filter on every
 * field, and each daily reading with the parts it divided.
 */
function DrilldownDrawer({ processId, metricKey, period, onClose }: {
  processId: string; metricKey: string | null; period: ReportPeriod; onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "drilldown", processId, metricKey, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Drilldown>>(
      `/api/process-operations/${processId}/metric/${metricKey}?period=${period}`),
    enabled: Boolean(metricKey),
  });
  const d = data?.data;
  // Keyed by metricKey so switching metrics starts with nothing expanded —
  // without this, a stale expansion from the last metric viewed would linger
  // under a row of a completely different one.
  const [expandedFor, setExpandedFor] = useState<{ metricKey: string | null; date: string } | null>(null);
  const expandedDate = expandedFor?.metricKey === metricKey ? expandedFor.date : null;
  const toggleExpanded = (date: string) => setExpandedFor((prev) =>
    prev?.metricKey === metricKey && prev.date === date ? null : { metricKey, date });
  const Label = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{children}</div>
  );
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex gap-3 py-1 text-xs">
      <span className="text-slate-500 w-36 shrink-0">{k}</span>
      <span className="text-slate-800 dark:text-slate-200 font-medium break-all">{v ?? "None"}</span>
    </div>
  );
  return (
    <Sheet open={Boolean(metricKey)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 overflow-y-auto">
        <div className="sticky top-0 z-10 px-5 py-3 flex items-start gap-3" style={{ background: NAVY }}>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white truncate">{d?.metricName ?? metricKey}</h2>
            <p className="text-[10px] text-indigo-200 mt-0.5">
              {d?.processName ?? ""}{d?.unit ? ` · ${d.unit}` : ""}
              {d?.direction ? ` · ${d.direction.replace("_", " ")}` : ""}
              {d && d.period !== "trend" && formatPeriodRange(d.periodFrom, d.periodTo)
                ? ` · ${PERIODS.find((p) => p.key === d.period)?.label ?? d.period} (${formatPeriodRange(d.periodFrom, d.periodTo)})`
                : ""}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="ml-auto p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition cursor-pointer">
            <X size={15} />
          </button>
        </div>

        {isLoading || !d ? (
          <div className="p-6 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />Loading the working…
          </div>
        ) : (
          <div className="p-5 space-y-5">
            <section>
              <Label>How it is calculated</Label>
              {d.definition?.formula ? (
                <code className="block rounded-lg bg-slate-900 text-emerald-300 text-[11px] px-3 py-2 font-mono break-all">
                  {d.definition.formula}
                </code>
              ) : <p className="text-xs text-slate-400 italic">No formula recorded.</p>}
              <div className="mt-2">
                <Row k="Grain" v={d.definition?.grain} />
                <Row k="In force from" v={d.definition?.effectiveFrom} />
                <Row k="In force to" v={d.definition?.effectiveTo ?? "open"} />
                <Row k="Target" v={d.definition?.targetValue ?? "None"} />
                <Row k="Defined" v={d.definition?.createdAt ? new Date(d.definition.createdAt).toLocaleString("en-GB") : "None"} />
                {d.definition?.notes && <Row k="Notes" v={d.definition.notes} />}
              </div>
            </section>

            <section>
              <Label><span className="inline-flex items-center gap-1"><Database size={11} />Where the data comes from</span></Label>
              {d.source ? (
                <div>
                  <Row k="Source" v={`${d.source.sourceCode}${d.source.sourceName ? ` — ${d.source.sourceName}` : ""}`} />
                  <Row k="Table" v={d.source.sourceObject} />
                  <Row k="Date column" v={d.source.dateColumn} />
                  <Row k="Attributed by" v={d.source.processKeyKind === "column"
                    ? `${d.source.processKeyColumn} = ${d.source.processKeyValue}`
                    : d.source.processKeyKind} />
                </div>
              ) : <p className="text-xs text-slate-400 italic">None</p>}
            </section>

            <section>
              <Label><span className="inline-flex items-center gap-1"><Filter size={11} />The parts it counts</span></Label>
              {d.fields.length ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-semibold">Field</th>
                        <th className="text-left px-2 py-1.5 font-semibold">Agg</th>
                        <th className="text-left px-2 py-1.5 font-semibold">Column</th>
                        <th className="text-left px-2 py-1.5 font-semibold">Filter</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.fields.map((f) => (
                        <tr key={f.fieldName} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-2 py-1.5 font-mono text-slate-800 dark:text-slate-200">{f.fieldName}</td>
                          <td className="px-2 py-1.5 text-slate-500">{f.aggregateFn ?? "—"}</td>
                          <td className="px-2 py-1.5 text-slate-500">{f.sourceColumn ?? "—"}</td>
                          <td className="px-2 py-1.5 text-slate-500 max-w-[15rem] truncate" title={f.filter ?? ""}>
                            {f.filter ?? "no filter"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-xs text-slate-400 italic">None</p>}
            </section>

            <DrilldownTrendChart
              readings={d.readings} unit={d.unit}
              targetValue={d.definition?.targetValue ?? null} direction={d.direction} />

            <section>
              <Label>Every reading, newest first — click a day for the individual records behind it</Label>
              {d.readings.length ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 max-h-96 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-semibold">Date</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Value</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Numerator</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Denominator</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.readings.map((x) => (
                        <Fragment key={x.date}>
                          <tr onClick={() => toggleExpanded(x.date)}
                            aria-expanded={expandedDate === x.date}
                            title="Show the individual records behind this day"
                            className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                              expandedDate === x.date ? "bg-slate-50 dark:bg-slate-800/40" : ""}`}>
                            <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300 flex items-center gap-1">
                              <ChevronRight size={11}
                                className={`shrink-0 text-slate-400 transition-transform ${expandedDate === x.date ? "rotate-90" : ""}`} />
                              {x.date}
                            </td>
                            <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                              x.value === null ? "text-slate-400 italic font-normal" : "text-slate-900 dark:text-slate-100"}`}>
                              {x.value === null ? "no data" : formatValue(x.value, d.unit)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                              {x.numerator === null ? "—" : Math.round(x.numerator).toLocaleString()}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                              {x.denominator === null ? "—" : Math.round(x.denominator).toLocaleString()}
                            </td>
                          </tr>
                          {expandedDate === x.date && metricKey && (
                            <RawRowsPanel processId={processId} metricKey={metricKey} date={x.date} columnCount={4} />
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-xs text-slate-400 italic">None</p>}
              <p className="text-[10px] text-slate-400 mt-1.5">
                A “no data” row means the source was read and the calculation had nothing to say —
                not that the value was zero.
              </p>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Manual entry drawer — for a process a feed does not reach. Writes through
 * the SAME endpoint Process Data Sources uses (POST /api/process-data-source/
 * :processId/values), which lands in process_metric_actual with source
 * 'manual'; Process Operations reads that table already, so a saved reading
 * shows up here on its own next refetch with no other change needed.
 *
 * The metric dropdown is the closed set of active kpi_metric_master
 * definitions (the Form Input Rule: a free-text metric key forks an orphan
 * nobody reads), fetched once and reused across opens.
 */
function ManualEntryDrawer({ open, processId, processName, onClose, onSaved }: {
  open: boolean; processId: string | null; processName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [metricKey, setMetricKey] = useState("");
  const [scoreDate, setScoreDate] = useState(todayIso());
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  const { data: catalogData, isLoading: catalogLoading } = useQuery({
    queryKey: ["process-data-source", "metric-catalog"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<CatalogMetric[]>>("/api/process-data-source/metric-catalog"),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const catalog = catalogData?.data ?? [];
  // The code is what a bulk paste actually needs to type, so it is shown
  // alongside the name here too — this dropdown doubles as the lookup a
  // pasted row's metric_key column is checked against.
  const options: SearchableOption[] = catalog.map((m) => ({
    value: m.metricCode, label: m.metricName, hint: m.metricCode,
  }));

  // ── Bulk paste — the actual "upload" half of the mandate: many rows in one
  // go, not one value at a time. Same four columns the single-entry form
  // collects (metricKey,scoreDate,value[,note]), reusing the SAME import
  // endpoint (and therefore the same registry/date validation) Process Data
  // Sources already uses — a dry run cannot pass where the real write would
  // fail, because it is the same check, not a lookalike.
  const [pasted, setPasted] = useState("");
  const [preview, setPreview] = useState<ImportOutcome[] | null>(null);
  const parseBulkRows = (text: string) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const body = lines.length && /^metric[_ ]?key\s*,/i.test(lines[0]) ? lines.slice(1) : lines;
    return body.map((line) => {
      const [mk, scoreDate, val, ...noteParts] = line.split(",").map((c) => c.trim());
      return { metricKey: mk, scoreDate, value: val, note: noteParts.join(",") || undefined };
    });
  };
  const runBulkImport = (dryRun: boolean) =>
    hrmsApi.post<HrmsEnvelope<ImportResult>>(`/api/process-data-source/${processId}/import`, {
      rows: parseBulkRows(pasted), dry_run: dryRun,
    });
  const checkBulk = useMutation({
    mutationFn: () => runBulkImport(true),
    onSuccess: (res) => setPreview(res.data.outcomes),
    onError: (err: unknown) => toast({
      title: "Could not check rows", variant: "destructive",
      description: err instanceof Error ? err.message : "Request failed",
    }),
  });
  const importBulk = useMutation({
    mutationFn: () => runBulkImport(false),
    onSuccess: (res) => {
      setPreview(res.data.outcomes);
      const failed = res.data.errors.length;
      toast({
        title: `${res.data.imported} row${res.data.imported === 1 ? "" : "s"} saved`,
        description: failed ? `${failed} row${failed === 1 ? "" : "s"} rejected — see the list below.` : undefined,
        variant: failed ? "destructive" : undefined,
      });
      onSaved();
    },
    onError: (err: unknown) => toast({
      title: "Import failed", variant: "destructive",
      description: err instanceof Error ? err.message : "Request failed",
    }),
  });
  const readyCount = preview?.filter((o) => o.ok).length ?? 0;
  const blockedCount = preview?.filter((o) => !o.ok).length ?? 0;

  const save = useMutation({
    mutationFn: () => hrmsApi.post(`/api/process-data-source/${processId}/values`, {
      metricKey, scoreDate,
      value: value.trim() === "" ? null : Number(value),
      note: note.trim() || null,
    }),
    onSuccess: () => {
      toast({ title: "Reading saved", description: "It will appear on the tile above on next refresh." });
      setValue(""); setNote("");
      onSaved();
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not save", variant: "destructive",
        description: err instanceof Error ? err.message : "Request failed",
      });
    },
  });

  const canSave = Boolean(processId && metricKey && scoreDate && value.trim() !== "" && !save.isPending);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 overflow-y-auto">
        <div className="sticky top-0 z-10 px-5 py-3 flex items-start gap-3" style={{ background: NAVY }}>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
              <PenLine size={14} />Add a reading
            </h2>
            <p className="text-[10px] text-indigo-200 mt-0.5">
              {processName ? `For ${processName}. ` : ""}
              Saved values are marked "manual" everywhere they show.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="ml-auto p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition cursor-pointer">
            <X size={15} />
          </button>
        </div>

        <div role="tablist" aria-label="Entry mode" className="flex border-b border-slate-200 dark:border-slate-800 px-5 pt-2">
          {([["single", "Single entry"], ["bulk", "Paste multiple"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer border-b-2 -mb-px transition-colors ${
                mode === m ? "border-slate-800 text-slate-900 dark:border-slate-100 dark:text-slate-100"
                  : "border-transparent text-slate-400 hover:text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <div className="p-5 space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
                Metric
              </label>
              <SearchableSelect
                options={options}
                value={metricKey}
                onChange={setMetricKey}
                loading={catalogLoading}
                placeholder="Choose a metric…"
                searchPlaceholder="Search metrics…"
                emptyText="No matching metric"
                aria-label="Metric"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
                  Date
                </label>
                <input type="date" value={scoreDate} max={todayIso()}
                  onChange={(e) => setScoreDate(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
                  Value
                </label>
                <input type="number" inputMode="decimal" value={value} placeholder="e.g. 92.5"
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
                Note <span className="normal-case font-normal text-slate-400">(optional, but where's this figure from?)</span>
              </label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder="e.g. Manually counted from the client's own tracker, 8 Sep"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none" />
            </div>

            <button type="button" disabled={!canSave} onClick={() => save.mutate()}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
              style={{ background: NAVY }}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save reading
            </button>
            <p className="text-[10px] text-slate-400">
              Only enter a value you actually have — a guess stored here reads as real on every
              chart that uses it.
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
                Paste rows — one per line
              </label>
              <textarea value={pasted} rows={7}
                onChange={(e) => { setPasted(e.target.value); setPreview(null); }}
                placeholder={"metric_key,date,value,note\nACCURACY_RATE,2026-09-08,91.5,\nUTILIZATION,2026-09-08,84.3,from client tracker"}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none" />
              <p className="text-[10px] text-slate-400 mt-1">
                metric_key,date,value[,note] — the metric_key is the code shown next to each name in
                the Single entry tab's dropdown. A header row is fine, it's dropped automatically.
              </p>
            </div>

            <div className="flex gap-2">
              <button type="button" disabled={!pasted.trim() || checkBulk.isPending}
                onClick={() => checkBulk.mutate()}
                className="flex-1 rounded-lg py-2 text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5">
                {checkBulk.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Check rows
              </button>
              <button type="button" disabled={!preview || readyCount === 0 || importBulk.isPending}
                onClick={() => importBulk.mutate()}
                className="flex-1 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
                style={{ background: NAVY }}>
                {importBulk.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Import {readyCount ? `${readyCount} row${readyCount === 1 ? "" : "s"}` : ""}
              </button>
            </div>

            {preview && (
              <div>
                <p className="text-[10px] text-slate-500 mb-1.5">
                  {readyCount} ready{blockedCount ? `, ${blockedCount} blocked` : ""} — checked against
                  the same rules the write uses, nothing is saved yet.
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 max-h-56 overflow-y-auto">
                  <table className="w-full text-[10px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1 font-semibold">#</th>
                        <th className="text-left px-2 py-1 font-semibold">Metric</th>
                        <th className="text-left px-2 py-1 font-semibold">Date</th>
                        <th className="text-right px-2 py-1 font-semibold">Value</th>
                        <th className="text-left px-2 py-1 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((o) => (
                        <tr key={o.row} className={`border-t border-slate-100 dark:border-slate-800 ${o.ok ? "" : "bg-red-50/60 dark:bg-red-950/20"}`}>
                          <td className="px-2 py-1 text-slate-400">{o.row}</td>
                          <td className="px-2 py-1 font-mono text-slate-700 dark:text-slate-300">{o.metricKey}</td>
                          <td className="px-2 py-1 text-slate-500">{o.scoreDate}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {o.value === null ? "no data" : o.value}
                          </td>
                          <td className={`px-2 py-1 ${o.ok ? "text-emerald-600" : "text-red-600"}`}>
                            {o.ok
                              ? (o.replaces !== undefined
                                  ? (o.replaces === null ? "new" : `replaces ${o.replaces}`)
                                  : "saved")
                              : (o.message ?? "error")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Feeds that have stopped, above the numbers they stopped feeding. */
function StoppedFeeds({ health }: { health: FeedHealth }) {
  const dead = health.feeds.filter((f) => f.state === "stopped");
  if (!dead.length) return null;
  const byProcess = new Map<string, FeedRow[]>();
  dead.forEach((f) => byProcess.set(f.processName, [...(byProcess.get(f.processName) ?? []), f]));
  return (
    <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/80 dark:bg-red-950/30 p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <Radio className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-red-800 dark:text-red-300">
            {dead.length} measurement{dead.length === 1 ? "" : "s"} stopped updating
          </h2>
          <p className="text-[11px] text-red-700/80 dark:text-red-400/80 mt-0.5">
            Nothing recorded for over {health.stoppedAfterDays} days. Their last value may still be
            on a tile below, looking current.
          </p>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {[...byProcess.entries()].slice(0, 9).map(([proc, rows]) => (
              <div key={proc} className="rounded-lg bg-white/80 dark:bg-slate-900/60 border border-red-100 dark:border-red-900/60 px-2.5 py-1.5">
                <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">{proc}</div>
                <div className="text-[11px] text-red-700 dark:text-red-400 tabular-nums">
                  {rows.length} metric{rows.length === 1 ? "" : "s"} · quiet {Math.max(...rows.map((r) => r.staleDays ?? 0))} days
                </div>
              </div>
            ))}
          </div>
          {byProcess.size > 9 && (
            <p className="text-[11px] text-red-700/70 mt-1.5">and {byProcess.size - 9} more processes</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProcessOperationsPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [drill, setDrill] = useState<string | null>(null);
  const [period, setPeriod] = useState<ReportPeriod>("trend");
  const [manualEntryOpen, setManualEntryOpen] = useState(false);

  const { data: listData, isLoading: listLoading, isError: listErrored, refetch: refetchList } = useQuery({
    queryKey: ["process-operations", "processes"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessRow[]>>("/api/process-operations/processes"),
  });
  const processes = listData?.data ?? [];
  const current = active ?? processes[0]?.processId ?? null;

  const { data: feedData } = useQuery({
    queryKey: ["process-operations", "feeds"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<FeedHealth>>("/api/process-operations/feeds"),
  });
  const feedHealth = feedData?.data;

  const { data: opsData, isLoading: opsLoading } = useQuery({
    queryKey: ["process-operations", "detail", current, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Operations>>(
      `/api/process-operations/${current}?period=${period}`),
    enabled: Boolean(current),
  });
  const ops = opsData?.data;

  const allMetrics = useMemo(
    () => (ops ? [...ops.sections.flatMap((s) => s.metrics), ...ops.ungrouped] : []), [ops]);
  const staleCount = allMetrics.filter((m) => m.staleDays !== null && ops && m.staleDays > ops.staleAfterDays).length;
  const noDataCount = allMetrics.filter((m) => m.value === null).length;

  const conv = ops?.sections.find((s) => s.key === "conversion");
  const qual = ops?.sections.find((s) => s.key === "quality");
  const risk = ops?.sections.find((s) => s.key === "risk");
  const charts = [
    conv ? <FunnelChart key="f" metrics={conv.metrics} /> : null,
    qual ? <QualityRadar key="q" metrics={qual.metrics} /> : null,
    risk ? <RiskBars key="r" metrics={risk.metrics} /> : null,
  ].filter(Boolean);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4 bg-slate-50/70 dark:bg-transparent min-h-full">
        <header className="rounded-2xl text-white px-5 py-4 shadow-md relative overflow-hidden" style={{ background: NAVY }}>
          <div aria-hidden className="absolute inset-0 opacity-25"
            style={{ background: "radial-gradient(circle at 20% 15%, #6366F1, transparent 55%)" }} />
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg md:text-xl font-bold flex items-center gap-2">
                <Activity className="h-5 w-5" />Process Operations
              </h1>
              <p className="text-[12px] text-indigo-200 mt-1 max-w-3xl">
                Every metric a process is measured on, from whichever system supplies it.
                Click any tile for the formula, the source and every reading behind it.
              </p>
              {ops && (
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5 text-[12px] text-white/90">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Users className="h-3.5 w-3.5" />{ops.headcount} active
                  </span>
                  <span className="tabular-nums">
                    {allMetrics.length} metrics
                    {ops.period === "trend"
                      ? ` · ${ops.windowDays} day trend`
                      : formatPeriodRange(ops.periodFrom, ops.periodTo)
                        ? ` · ${formatPeriodRange(ops.periodFrom, ops.periodTo)}`
                        : ""}
                  </span>
                  {noDataCount > 0 && <span className="tabular-nums">{noDataCount} no data</span>}
                  {staleCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 tabular-nums text-amber-300">
                      <Clock className="h-3.5 w-3.5" />{staleCount} stale
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              {/* Period selector: latest-reading trend, or a real calendar aggregate
                  (SUM/SUM across the range) compared against the same range one
                  period back — Today vs yesterday, WTD vs last week, MTD vs last
                  month. Not a rolling window; a real calendar boundary. */}
              <div role="tablist" aria-label="Reporting period" className="inline-flex rounded-lg bg-white/10 p-0.5">
                {PERIODS.map((p) => (
                  <button key={p.key} type="button" role="tab" aria-selected={period === p.key}
                    title={p.caption} onClick={() => setPeriod(p.key)}
                    className={`cursor-pointer rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                      period === p.key ? "bg-white text-slate-900 shadow-sm" : "text-indigo-200 hover:text-white"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setManualEntryOpen(true)}
                title="Type in today's number for a metric no automated feed reaches"
                className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-white/20 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
                <PenLine size={12} />Add a reading
              </button>
            </div>
          </div>
        </header>

        {listLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />Loading processes…
          </div>
        ) : listErrored ? (
          // Distinct from "zero processes" on purpose. A failed request and a
          // genuinely empty result look identical to a reader unless the page
          // says which one happened -- the same distinction this page draws
          // everywhere else between "no data" and a fabricated zero.
          <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-6 text-sm text-red-700 dark:text-red-400 shadow-sm flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Could not reach the server. This is not "no processes" -- the request itself failed.
            </span>
            <button onClick={() => refetchList()}
              className="shrink-0 rounded-lg bg-red-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-red-700 transition cursor-pointer">
              Retry
            </button>
          </div>
        ) : processes.length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
            No process in your access is currently reporting a metric.
          </div>
        ) : (
          <>
            {feedHealth && <StoppedFeeds health={feedHealth} />}

            <div className="flex flex-wrap gap-1.5">
              {processes.map((p) => {
                const on = p.processId === current;
                return (
                  <button key={p.processId} onClick={() => setActive(p.processId)} aria-pressed={on}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${on
                      ? "text-white border-transparent shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-400 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"}`}
                    style={on ? { background: NAVY } : undefined}>
                    <span className="font-semibold">{p.processName}</span>
                    <span className={`ml-1.5 tabular-nums ${on ? "text-indigo-200" : "text-slate-400"}`}>{p.metrics}</span>
                  </button>
                );
              })}
            </div>

            {opsLoading || !ops ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />Loading metrics…
              </div>
            ) : (
              <div className="space-y-4">
                {ops.headcount === 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      This process has no active employees, so a headcount-based number below is
                      counting over nobody — a zero means “no people”, not “no problems”.
                    </span>
                  </div>
                )}

                {charts.length > 0 && (
                  <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">{charts}</div>
                )}

                {[...ops.sections, ...(ops.ungrouped.length
                  ? [{ key: "other", title: "Other metrics", blurb: "Wired for this process but not yet placed in a section.", metrics: ops.ungrouped }]
                  : [])].map((s) => {
                  const style = SECTION_STYLE[s.key] ?? SECTION_STYLE.other;
                  const Icon = style.icon;
                  return (
                    <section key={s.key} className="space-y-2">
                      <div className="flex items-center gap-2 px-0.5">
                        <span className="p-1 rounded-lg" style={{ background: `${style.accent}1A` }}>
                          <Icon className="h-3.5 w-3.5" style={{ color: style.accent }} />
                        </span>
                        <h2 className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{s.title}</h2>
                        <span className="text-[10px] text-slate-400 tabular-nums">{s.metrics.length}</span>
                        {s.blurb && (
                          <p className="text-[10px] text-slate-400 truncate hidden md:block ml-2">{s.blurb}</p>
                        )}
                      </div>
                      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                        {s.metrics.map((r) => (
                          <KpiCard key={r.metricKey} r={r} staleAfter={ops.staleAfterDays}
                            accent={style.accent} tint={style.tint} period={period}
                            onOpen={() => setDrill(r.metricKey)} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}

        {current && (
          <DrilldownDrawer processId={current} metricKey={drill} period={period} onClose={() => setDrill(null)} />
        )}
        <ManualEntryDrawer
          open={manualEntryOpen}
          processId={current}
          processName={ops?.processName ?? processes.find((p) => p.processId === current)?.processName ?? null}
          onClose={() => setManualEntryOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["process-operations", "detail", current] });
            qc.invalidateQueries({ queryKey: ["process-operations", "processes"] });
          }}
        />
      </div>
    </DashboardLayout>
  );
}
