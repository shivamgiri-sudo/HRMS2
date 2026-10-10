import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Home, PhoneCall, PhoneOutgoing, PhoneOff, Percent, ShoppingBag, IndianRupee, Wallet, Target, TrendingUp,
  Timer, Users, Lightbulb, Eye, RefreshCw, X, Layers, ArrowUp, ArrowDown, Search, ClipboardList, Award, PieChart as PieIcon, Filter, Check,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Spinner, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu, TableExcelIconButton,
  currentMonthRange, formatINR, formatShortDate,
  KPI_TONES, type KpiTone, type ExportSlide,
} from "./DashboardKit";
import { GncDetailDrawer, type DrawerSeries } from "./GncAbandonCartDetailDrawer";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

/**
 * Housing Owner -- Outbound Performance Dashboard (Calls / Sales / Revenue /
 * Team Performance).
 *
 * Every figure is live from GET /api/process-performance/housing-owner-dashboard/outbound,
 * which returns the de-duplicated, roster-resolved rows of db_masmis.Owner_cdr,
 * owner_sale and owner_agent_details for the requested range plus the previous
 * period, month-to-date and last-month-to-date. The AM / TL / Vintage / Agent
 * filters, KPI deltas, matrices, charts and drawers are all computed here from
 * those same rows, so they can never disagree with each other.
 *
 * "Vintage" is the agent's tenure bucket (owner_agent_details.bucket: 0-30 ...
 * 180 Above). Targets are the Active roster agents' monthly_target. There is no
 * source for a Connected % target, so that KPI shows no target line.
 */

interface CdrFact { date: string; agent: string; tl: string; am: string; vintage: string; calls: number; connected: number; notConnected: number; talkSec: number }
interface SaleFact { date: string; agent: string; tl: string; am: string; vintage: string; revenue: number; saleCount: number }
interface RosterFact { name: string; empId: string | null; tl: string; am: string; vintage: string; status: string; monthlyTarget: number }
interface OutboundData {
  from: string; to: string; windowFrom: string; cdrThrough: string | null; saleThrough: string | null;
  cdr: CdrFact[]; sales: SaleFact[]; roster: RosterFact[];
}

type Win = { from: string; to: string };
type HeroTab = "outbound" | "comparison";
type CompareView = "overall" | "am" | "tl" | "vintage" | "agent";
type Who = { agent: string; tl: string; am: string; vintage: string };
type Pred = (f: Who) => boolean;
interface Ctx { cdr: CdrFact[]; sales: SaleFact[]; roster: RosterFact[]; dataTo: string }

/* ------------------------------ date helpers ------------------------------ */

const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const fromUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
const toUtc = (iso: string) => { const [y, m, d] = parts(iso); return Date.UTC(y, m - 1, d); };
const shiftDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * 86400000);
const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
const dim = (iso: string) => { const [y, m] = parts(iso); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
/** Yesterday's date (local calendar) as YYYY-MM-DD. */
const yesterdayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Share of a month elapsed between two dates (each day = 1 / days-in-its-month). */
function monthFraction(from: string, to: string): number {
  if (to < from) return 0;
  let f = 0;
  for (let d = from; d <= to; d = shiftDays(d, 1)) f += 1 / dim(d);
  return f;
}

/** Same day-of-month buckets (1-7 -> W-1, 8-14 -> W-2 ...) this app's other week-wise tables use. */
function weekBucket(iso: string): { key: string; label: string } {
  const day = Number(iso.slice(8, 10));
  const weekNum = Math.ceil(day / 7);
  const startDay = (weekNum - 1) * 7 + 1;
  const endDay = Math.min(startDay + 6, dim(iso));
  const mon = new Date(iso).toLocaleDateString("en-IN", { month: "short" });
  return { key: `${iso.slice(0, 7)}-W${weekNum}`, label: `W-${weekNum} (${startDay}-${endDay} ${mon})` };
}

const fmtHms = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const int = (n: number) => Math.round(n).toLocaleString("en-IN");
const r1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------- aggregation ------------------------------ */

interface Agg {
  calls: number; connected: number; notConnected: number; revenue: number; saleCount: number;
  agentDays: number; cdrDays: number; talkSum: number; talkRows: number; target: number;
}
const emptyAgg = (): Agg => ({ calls: 0, connected: 0, notConnected: 0, revenue: 0, saleCount: 0, agentDays: 0, cdrDays: 0, talkSum: 0, talkRows: 0, target: 0 });
function addAgg(t: Agg, a: Agg) {
  t.calls += a.calls; t.connected += a.connected; t.notConnected += a.notConnected; t.revenue += a.revenue;
  t.saleCount += a.saleCount; t.agentDays += a.agentDays; t.cdrDays += a.cdrDays; t.talkSum += a.talkSum;
  t.talkRows += a.talkRows; t.target += a.target;
}

/** Ratios always recomputed from summed numerators / denominators, never averaged. */
function derive(a: Agg) {
  return {
    calls: a.calls, connected: a.connected, notConnected: a.notConnected,
    connectedPct: a.calls > 0 ? r1((a.connected / a.calls) * 100) : 0,
    saleCount: a.saleCount, revenue: a.revenue,
    aov: a.saleCount > 0 ? Math.round(a.revenue / a.saleCount) : 0,
    target: Math.round(a.target),
    achPct: a.target > 0 ? r1((a.revenue / a.target) * 100) : 0,
    present: a.cdrDays > 0 ? r1(a.agentDays / a.cdrDays) : 0,
    dialPerAgent: a.agentDays > 0 ? Math.round(a.calls / a.agentDays) : 0,
    avgTalkSec: a.talkRows > 0 ? Math.round(a.talkSum / a.talkRows) : 0,
  };
}

const monthlyTargetOf = (ctx: Ctx, pred: Pred) =>
  ctx.roster.reduce((s, r) => (r.status === "Active" && pred({ agent: r.name, tl: r.tl, am: r.am, vintage: r.vintage }) ? s + r.monthlyTarget : s), 0);

function collect(ctx: Ctx, pred: Pred, w: Win) {
  const days = new Map<string, Agg>();
  const agents = new Set<string>();
  const day = (d: string) => { let a = days.get(d); if (!a) { a = emptyAgg(); days.set(d, a); } return a; };
  for (const r of ctx.cdr) {
    if (r.date < w.from || r.date > w.to || !pred(r)) continue;
    const a = day(r.date);
    a.calls += r.calls; a.connected += r.connected; a.notConnected += r.notConnected;
    if (r.calls > 0) { a.agentDays += 1; agents.add(r.agent); }
    if (r.talkSec > 0) { a.talkSum += r.talkSec; a.talkRows += 1; }
  }
  for (const r of ctx.sales) {
    if (r.date < w.from || r.date > w.to || !pred(r)) continue;
    const a = day(r.date);
    a.revenue += r.revenue; a.saleCount += r.saleCount;
  }
  const monthly = monthlyTargetOf(ctx, pred);
  for (const [d, a] of days) { a.cdrDays = a.agentDays > 0 ? 1 : 0; a.target = monthly > 0 ? monthly / dim(d) : 0; }
  return { days, agents, monthly };
}

function calc(ctx: Ctx, pred: Pred, w: Win) {
  const { days, agents, monthly } = collect(ctx, pred, w);
  const t = emptyAgg();
  for (const a of days.values()) addAgg(t, a);
  const d = derive(t);
  const mFrom = monthStart(w.to);
  const mTo = w.to < ctx.dataTo ? w.to : ctx.dataTo;
  let mtdRevenue = 0;
  for (const s of ctx.sales) if (s.date >= mFrom && s.date <= w.to && pred(s)) mtdRevenue += s.revenue;
  const mtdTarget = monthly * monthFraction(mFrom, mTo);
  // MTD up to yesterday (local calendar), independent of the selected range: target prorated to yesterday, revenue to yesterday.
  const ydIso = yesterdayIso();
  const ydFrom = monthStart(ydIso);
  let ydRevenue = 0;
  for (const s of ctx.sales) if (s.date >= ydFrom && s.date <= ydIso && pred(s)) ydRevenue += s.revenue;
  const ydTarget = monthly * monthFraction(ydFrom, ydIso);
  return {
    ydTarget,
    ydRevenue,
    ydPct: ydTarget > 0 ? r1((ydRevenue / ydTarget) * 100) : 0,
    ...d,
    hasData: t.calls > 0 || t.saleCount > 0,
    monthlyTarget: monthly,
    achPct: monthly > 0 ? r1((t.revenue / monthly) * 100) : 0,
    mtdTarget,
    mtdRevenue,
    mtdPct: mtdTarget > 0 ? r1((mtdRevenue / mtdTarget) * 100) : 0,
    salePerAgent: agents.size > 0 ? r1(t.saleCount / agents.size) : 0,
  };
}
type M = ReturnType<typeof calc>;

interface RowSet { dailyRows: Array<Record<string, string | number>>; weeklyRows: Array<Record<string, string | number>>; monthly: number }
function buildRows(ctx: Ctx, pred: Pred, w: Win): RowSet {
  const { days, monthly } = collect(ctx, pred, w);
  const dates = [...days.keys()].sort();
  const dailyRows = dates.map((date) => ({ date, ...derive(days.get(date)!) }));
  const weeks = new Map<string, { label: string; agg: Agg }>();
  for (const date of dates) {
    const { key, label } = weekBucket(date);
    const cur = weeks.get(key) ?? { label, agg: emptyAgg() };
    addAgg(cur.agg, days.get(date)!);
    weeks.set(key, cur);
  }
  const weeklyRows = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => ({ label: v.label, ...derive(v.agg) }));
  return { dailyRows, weeklyRows, monthly };
}

/* ------------------------------- presentation ----------------------------- */

const COLORS = {
  calls: "#f97316", connected: "#0ea5e9", notConnected: "#f43f5e", pct: "#6366f1", sale: "#10b981",
  revenue: "#f59e0b", aov: "#06b6d4", ach: "#8b5cf6", talk: "#ec4899", present: "#14b8a6", dial: "#a855f7",
};
const S: Record<string, DrawerSeries> = {
  calls: { key: "calls", label: "Total Calls", fmt: "int", color: COLORS.calls },
  connected: { key: "connected", label: "Connected Calls", fmt: "int", color: COLORS.connected },
  notConnected: { key: "notConnected", label: "Not Connected Calls", fmt: "int", color: COLORS.notConnected },
  connectedPct: { key: "connectedPct", label: "Connected %", fmt: "pct", color: COLORS.pct },
  saleCount: { key: "saleCount", label: "Sale Count", fmt: "int", color: COLORS.sale },
  revenue: { key: "revenue", label: "Revenue", fmt: "currency", color: COLORS.revenue },
  aov: { key: "aov", label: "AOV", fmt: "currency", color: COLORS.aov },
  achPct: { key: "achPct", label: "Ach %", fmt: "pct", color: COLORS.ach },
  target: { key: "target", label: "Target (fair share)", fmt: "currency", color: "#64748b" },
  avgTalkSec: { key: "avgTalkSec", label: "Avg Talk / Agent-day", fmt: "hms", color: COLORS.talk },
  present: { key: "present", label: "Present Count (avg/day)", fmt: "int", color: COLORS.present },
  dialPerAgent: { key: "dialPerAgent", label: "Per Agent Dial Count", fmt: "int", color: COLORS.dial },
};
// Sale Count, Revenue and Ach % lead so the week-wise / date-wise tables show Ach % without scrolling the drawer sideways.
const ENTITY_SERIES = [S.saleCount, S.revenue, S.achPct, S.calls, S.connected, S.notConnected, S.connectedPct, S.aov, S.avgTalkSec];
const TOOLTIP_STYLE = { fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0", background: "#ffffff", boxShadow: "0 8px 24px rgba(15,23,42,0.12)", padding: "8px 12px" } as const;
// Recharts colours each tooltip row with its series colour, which is close to invisible for pale series (e.g. the peach "Total Calls" bars) -- force readable dark text; the legend still carries the series colours.
const TOOLTIP_PROPS = {
  contentStyle: TOOLTIP_STYLE,
  itemStyle: { color: "#0f172a", fontWeight: 600 },
  labelStyle: { color: "#334155", fontWeight: 700, marginBottom: 4 },
} as const;
const VINTAGE_ORDER = ["0-30", "31-60", "61-90", "91-120", "121-160", "161-180", "180 Above", "Unmapped"];
const byVintage = (a: string, b: string) => {
  const ia = VINTAGE_ORDER.indexOf(a), ib = VINTAGE_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

function DeltaBadge({ value, unit = "%" }: { value: number | null; unit?: "%" | "pp" }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${up ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(value)}{unit}
    </span>
  );
}

function StatTile({ icon: Icon, tone, label, value, sub, delta, deltaUnit, onClick }: {
  icon: typeof PhoneCall; tone: KpiTone; label: string; value: string; sub?: string;
  delta?: number | null; deltaUnit?: "%" | "pp"; onClick?: () => void;
}) {
  const t = KPI_TONES[tone];
  return (
    <button
      type="button" onClick={onClick} disabled={!onClick} title="Click for week-wise & date-wise details"
      className={`relative overflow-hidden rounded-lg border border-slate-100 bg-white p-2 text-left shadow-sm transition-shadow ${onClick ? "cursor-pointer hover:shadow-md" : "cursor-default"}`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${t.accent}`} />
      <div className="flex items-start justify-between pl-1">
        <span className={`flex h-6 w-6 items-center justify-center rounded-md ${t.badge}`}>
          <Icon className="h-3 w-3" />
        </span>
        <DeltaBadge value={delta ?? null} unit={deltaUnit} />
      </div>
      <p className={`mt-1 pl-1 text-base font-extrabold leading-tight tracking-tight ${t.value}`}>{value}</p>
      <p className="truncate pl-1 text-[10px] font-semibold leading-tight text-slate-600">{label}</p>
      {sub && <p className="truncate pl-1 text-[9px] leading-tight text-slate-400" title={sub}>{sub}</p>}
    </button>
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

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ key: NoInfer<T>; label: string }> }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.key} type="button" onClick={() => onChange(o.key)}
          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${value === o.key ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small filter-icon button that narrows ONE chart to a single AM (the page-level AM filter, when set, wins and this is disabled). */
function AmFilterButton({ value, options, onChange, disabled }: { value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const active = value !== "all";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button" disabled={disabled} aria-label="Filter this chart by AM"
          title={disabled ? "The page-level AM filter is active" : "Filter this chart by AM"}
          className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
        >
          <Filter className="h-3 w-3" />{active && <span className="max-w-[80px] truncate">{value}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">AM</p>
        {["all", ...options].map((o) => (
          <button
            key={o} type="button" onClick={() => { onChange(o); setOpen(false); }}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${value === o ? "bg-amber-50 font-bold text-amber-700" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {o === "all" ? "All AMs" : o}{value === o && <Check className="h-3 w-3" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function MiniSelect<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ key: NoInfer<T>; label: string }>; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="h-7 w-[128px] bg-white text-[11px]" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/* --------------------------------- matrix --------------------------------- */

const pctTone = (v: number, has: boolean) => (!has ? "text-slate-300" : v >= 80 ? "text-emerald-600" : v >= 50 ? "text-amber-600" : "text-red-600");
/** TQ >= 80% of target, MQ 50-79%, BQ < 50%, NA when the agent has no target -- same thresholds pctTone colors by. */
const stageOf = (achPct: number, hasTarget: boolean): "TQ" | "MQ" | "BQ" | "NA" => (!hasTarget ? "NA" : achPct >= 80 ? "TQ" : achPct >= 50 ? "MQ" : "BQ");
const STAGE_RANK: Record<string, number> = { TQ: 3, MQ: 2, BQ: 1, NA: 0 };
const STAGE_BADGE: Record<string, string> = {
  TQ: "bg-emerald-100 text-emerald-700", MQ: "bg-amber-100 text-amber-700", BQ: "bg-red-100 text-red-700", NA: "bg-slate-100 text-slate-400",
};

const MATRIX_ROWS: Array<{ label: string; hint?: string; cell: (m: M) => { text: string; cls?: string } }> = [
  { label: "Connected Calls", cell: (m) => ({ text: int(m.connected) }) },
  { label: "Not Connected Calls", cell: (m) => ({ text: int(m.notConnected) }) },
  { label: "Total Calls", cell: (m) => ({ text: int(m.calls), cls: "font-bold text-slate-800" }) },
  { label: "Connected %", cell: (m) => ({ text: `${m.connectedPct}%`, cls: "font-semibold text-sky-700" }) },
  { label: "Revenue Achieved", cell: (m) => ({ text: formatINR(m.revenue), cls: "font-bold text-emerald-700" }) },
  { label: "Sale Count", cell: (m) => ({ text: int(m.saleCount) }) },
  { label: "Monthly Target", hint: "Sum of Active roster agents' monthly target", cell: (m) => ({ text: m.monthlyTarget > 0 ? formatINR(m.monthlyTarget) : "—", cls: "text-slate-500" }) },
  { label: "Ach %", hint: "Revenue in the window / monthly target", cell: (m) => ({ text: m.monthlyTarget > 0 ? `${m.achPct}%` : "—", cls: `font-bold ${pctTone(m.achPct, m.monthlyTarget > 0)}` }) },
  { label: "MTD Target", hint: "Monthly target x share of the month elapsed (up to the latest uploaded day)", cell: (m) => ({ text: m.mtdTarget > 0 ? formatINR(m.mtdTarget) : "—", cls: "text-slate-500" }) },
  { label: "MTD %", hint: "Month-to-date revenue / MTD target", cell: (m) => ({ text: m.mtdTarget > 0 ? `${m.mtdPct}%` : "—", cls: `font-bold ${pctTone(m.mtdPct, m.mtdTarget > 0)}` }) },
  { label: "AOV", hint: "Revenue / sale count", cell: (m) => ({ text: m.saleCount > 0 ? formatINR(m.aov) : "—" }) },
  { label: "Present Count", hint: "Average agents with calls per calling day", cell: (m) => ({ text: m.present > 0 ? String(m.present) : "—" }) },
  { label: "Per Agent Dial Count", hint: "Total calls / agent-days present", cell: (m) => ({ text: m.dialPerAgent > 0 ? int(m.dialPerAgent) : "—" }) },
  { label: "Avg. Sale Count per Agent", hint: "Sale count / agents who dialled in the window", cell: (m) => ({ text: m.salePerAgent > 0 ? String(m.salePerAgent) : "—" }) },
  { label: "Talk Time", hint: "Average talk time per agent-day (dialer report)", cell: (m) => ({ text: m.avgTalkSec > 0 ? fmtHms(m.avgTalkSec) : "—" }) },
];

/* Totals across a set of agent rows, using the same formulas as calc(): ratios are recomputed from the summed
   counts (never averaged), and talk time is left blank because per-agent averages cannot be combined exactly. */
function sumTotals(ms: M[]) {
  const calls = ms.reduce((s, m) => s + m.calls, 0);
  const connected = ms.reduce((s, m) => s + m.connected, 0);
  const saleCount = ms.reduce((s, m) => s + m.saleCount, 0);
  const revenue = ms.reduce((s, m) => s + m.revenue, 0);
  const monthlyTarget = ms.reduce((s, m) => s + m.monthlyTarget, 0);
  return {
    calls,
    connectedPct: calls > 0 ? r1((connected / calls) * 100) : 0,
    saleCount,
    revenue,
    monthlyTarget,
    achPct: monthlyTarget > 0 ? r1((revenue / monthlyTarget) * 100) : 0,
  };
}

interface MatrixCol { key: string; label: string; m: M; onClick: () => void }

function MetricMatrix({ columns, total, firstColLabel = "Metric" }: { columns: MatrixCol[]; total?: MatrixCol; firstColLabel?: string }) {
  const all = total ? [...columns, total] : columns;
  if (columns.length === 0) return <p className="py-6 text-center text-xs text-slate-400">No data for the current selection.</p>;
  const sheet = () => [{ name: firstColLabel, columns: [firstColLabel, ...all.map((c) => c.label)], rows: MATRIX_ROWS.map((row) => [row.label, ...all.map((c) => row.cell(c.m).text)]) }];
  return (
    <div className="overflow-x-auto">
      <div className="mb-1.5 flex justify-end"><TableExcelIconButton fileBase={`Housing_Owner_${firstColLabel}_wise`} getSheets={sheet} /></div>
      <table className="w-full min-w-max text-center text-xs">
        <thead>
          <tr className="sticky top-0 z-10 bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-white">
            <th className="sticky left-0 z-20 rounded-l-lg bg-slate-800 px-3 py-2 text-left font-bold text-white">{firstColLabel}</th>
            {all.map((c, i) => (
              <th key={c.key} className={`px-3 py-2 font-bold text-white ${i === all.length - 1 ? "rounded-r-lg" : ""} ${total && c.key === total.key ? "bg-slate-700" : ""}`}>
                <button type="button" onClick={c.onClick} className="font-bold uppercase tracking-wide text-white underline-offset-2 hover:underline" title="View week-wise & date-wise details">
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATRIX_ROWS.map((row, ri) => (
            <tr key={row.label} className={ri % 2 === 1 ? "bg-slate-50/70" : "bg-white"}>
              <td title={row.hint} className={`sticky left-0 z-10 whitespace-nowrap border-r border-slate-100 px-3 py-1.5 text-left font-semibold text-slate-600 ${ri % 2 === 1 ? "bg-slate-50" : "bg-white"}`}>{row.label}</td>
              {all.map((c) => {
                const { text, cls } = row.cell(c.m);
                return (
                  <td
                    key={c.key} onClick={c.onClick} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") c.onClick(); }}
                    className={`cursor-pointer whitespace-nowrap px-3 py-1.5 text-slate-600 transition-colors hover:bg-orange-50 ${total && c.key === total.key ? "bg-slate-100/70 font-semibold" : ""} ${cls ?? ""}`}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

type DrawerState = { title: string; series: DrawerSeries[]; dailyRows: RowSet["dailyRows"]; weeklyRows: RowSet["weeklyRows"] };
type EntityKind = "am" | "vintage" | "tl";

export function HousingOwnerDashboard() {
  const initial = currentMonthRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<OutboundData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [am, setAm] = useState("all");
  const [tl, setTl] = useState("all");
  const [agent, setAgent] = useState("all");
  const [vintage, setVintage] = useState("all");
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [dailyBar, setDailyBar] = useState<"calls" | "connected" | "notConnected">("calls");
  const [trendView, setTrendView] = useState<"calls" | "target">("calls");
  const [pieView, setPieView] = useState<"calls" | "target">("calls");
  const [activeOpen, setActiveOpen] = useState(false);
  const [trendAm, setTrendAm] = useState("all");
  const [revMode, setRevMode] = useState<"daily" | "weekly">("daily");
  const [talkMode, setTalkMode] = useState<"daily" | "weekly">("daily");
  const [amMode, setAmMode] = useState<"period" | "mtd">("period");
  const [vintageMode, setVintageMode] = useState<"period" | "mtd">("period");
  const [tlMode, setTlMode] = useState<"period" | "mtd">("period");
  const [agentView, setAgentView] = useState<"chart" | "table">("chart");
  const [agentSort, setAgentSort] = useState<"saleCount" | "calls" | "revenue">("saleCount");
  const [agentSearch, setAgentSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ from, to });
      const res = await hrmsApi.get<{ success: boolean; data: OutboundData }>(`/api/process-performance/housing-owner-dashboard/outbound?${qs.toString()}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Housing Owner dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  const ctx = useMemo<Ctx | null>(() => {
    if (!data) return null;
    const last = [data.cdrThrough, data.saleThrough].filter((x): x is string => !!x).sort().pop();
    // Current month: a call or sale takes its TL and AM from the current agent roster (matched by
    // agent name), and a row for an agent no longer on the roster is dropped -- it does not show
    // under a stale TL/AM. Earlier months are untouched: they keep the TL and AM they had, and an
    // agent who has since left the roster still appears in that history.
    const now = new Date();
    const curMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const rosterByName = new Map(data.roster.map((r) => [r.name.trim().toLowerCase(), r] as const));
    const fromRoster = <T extends CdrFact | SaleFact>(rows: T[]): T[] => rows.flatMap((r) => {
      if (r.date < curMonthStart) return [r];
      const ro = rosterByName.get(String(r.agent ?? "").trim().toLowerCase());
      return ro ? [{ ...r, tl: ro.tl, am: ro.am }] : [];
    });
    return { cdr: fromRoster(data.cdr), sales: fromRoster(data.sales), roster: data.roster, dataTo: last ?? data.to };
  }, [data]);

  /* Filter options: AM -> TL -> Agent narrow each other; Vintage is independent. */
  // The AM / TL / Agent / Vintage filters always reflect the current month's active roster, the
  // same source the call log's TL and AM are resolved from -- not whatever date range is selected.
  const people = useMemo(() => (ctx?.roster ?? [])
    .filter((r) => r.status === "Active")
    .map((r): Who => ({ agent: r.name, tl: r.tl, am: r.am, vintage: r.vintage })),
  [ctx]);
  // Placeholder/roster-noise values -- never real AMs or TLs a user would filter by.
  const isRealFilterValue = (v: string) => !["-", "unassigned", "ojt"].includes(v.trim().toLowerCase());
  const amOptions = useMemo(() => [...new Set(people.map((p) => p.am))].filter(isRealFilterValue).sort(), [people]);
  const tlOptions = useMemo(() => [...new Set(people.filter((p) => am === "all" || p.am === am).map((p) => p.tl))].filter(isRealFilterValue).sort(), [people, am]);
  const vintageOptions = useMemo(() => [...new Set(people.map((p) => p.vintage))].sort(byVintage), [people]);
  const agentOptions = useMemo(
    () => people.filter((p) => (am === "all" || p.am === am) && (tl === "all" || p.tl === tl) && (vintage === "all" || p.vintage === vintage))
      .map((p) => p.agent).sort(),
    [people, am, tl, vintage],
  );
  useEffect(() => { if (tl !== "all" && !tlOptions.includes(tl)) setTl("all"); }, [tl, tlOptions]);
  useEffect(() => { if (agent !== "all" && !agentOptions.includes(agent)) setAgent("all"); }, [agent, agentOptions]);

  const filtersActive = am !== "all" || tl !== "all" || agent !== "all" || vintage !== "all";
  const basePred = useCallback<Pred>((f) =>
    (am === "all" || f.am === am) && (tl === "all" || f.tl === tl) && (agent === "all" || f.agent === agent) && (vintage === "all" || f.vintage === vintage),
  [am, tl, agent, vintage]);

  const range = useMemo<Win>(() => ({ from: data?.from ?? from, to: data?.to ?? to }), [data, from, to]);
  const prevRange = useMemo<Win>(() => {
    const span = daysBetween(range.from, range.to) + 1;
    return { from: shiftDays(range.from, -span), to: shiftDays(range.from, -1) };
  }, [range]);
  const mtdRange = useMemo<Win>(() => ({ from: monthStart(range.to), to: range.to }), [range]);
  const lmtdRange = useMemo<Win>(() => {
    const [y, m, d] = parts(range.to);
    const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1;
    const lFrom = `${ly}-${String(lm).padStart(2, "0")}-01`;
    const lTo = `${ly}-${String(lm).padStart(2, "0")}-${String(Math.min(d, dim(lFrom))).padStart(2, "0")}`;
    return { from: lFrom, to: lTo };
  }, [range]);

  const cur = useMemo(() => (ctx ? calc(ctx, basePred, range) : null), [ctx, basePred, range]);
  const prev = useMemo(() => (ctx ? calc(ctx, basePred, prevRange) : null), [ctx, basePred, prevRange]);
  const [heroTab, setHeroTab] = useState<HeroTab>("outbound");
  const lastMonthCalc = useMemo(() => (ctx ? calc(ctx, basePred, lmtdRange) : null), [ctx, basePred, lmtdRange]);
  const thisMonthCalc = useMemo(() => (ctx ? calc(ctx, basePred, mtdRange) : null), [ctx, basePred, mtdRange]);
  // Last month vs current month, till the same date: every KPI, with the change.
  const compareRows = useMemo<string[][]>(() => {
    if (!lastMonthCalc || !thisMonthCalc) return [];
    const l = lastMonthCalc;
    const t = thisMonthCalc;
    const pc = (c: number, p: number) => (p > 0 ? `${r1(((c - p) / p) * 100)}%` : "—");
    const pp = (c: number, p: number) => `${r1(c - p)} pp`;
    const bothTarget = l.monthlyTarget > 0 && t.monthlyTarget > 0;
    const bothMtd = l.mtdTarget > 0 && t.mtdTarget > 0;
    return [
      ["Total Calls", int(l.calls), int(t.calls), pc(t.calls, l.calls)],
      ["Connected Calls", int(l.connected), int(t.connected), pc(t.connected, l.connected)],
      ["Not Connected Calls", int(l.notConnected), int(t.notConnected), pc(t.notConnected, l.notConnected)],
      ["Connected %", `${l.connectedPct}%`, `${t.connectedPct}%`, pp(t.connectedPct, l.connectedPct)],
      ["Sale Count", int(l.saleCount), int(t.saleCount), pc(t.saleCount, l.saleCount)],
      ["Revenue", formatINR(l.revenue), formatINR(t.revenue), pc(t.revenue, l.revenue)],
      ["AOV", formatINR(l.aov), formatINR(t.aov), pc(t.aov, l.aov)],
      ["Target", l.monthlyTarget > 0 ? formatINR(l.monthlyTarget) : "—", t.monthlyTarget > 0 ? formatINR(t.monthlyTarget) : "—", bothTarget ? pc(t.monthlyTarget, l.monthlyTarget) : "—"],
      ["Ach %", l.monthlyTarget > 0 ? `${l.achPct}%` : "—", t.monthlyTarget > 0 ? `${t.achPct}%` : "—", bothTarget ? pp(t.achPct, l.achPct) : "—"],
      ["MTD Target", l.mtdTarget > 0 ? formatINR(l.mtdTarget) : "—", t.mtdTarget > 0 ? formatINR(t.mtdTarget) : "—", bothMtd ? pc(t.mtdTarget, l.mtdTarget) : "—"],
      ["MTD Ach %", l.mtdTarget > 0 ? `${l.mtdPct}%` : "—", t.mtdTarget > 0 ? `${t.mtdPct}%` : "—", bothMtd ? pp(t.mtdPct, l.mtdPct) : "—"],
    ];
  }, [lastMonthCalc, thisMonthCalc]);

  // Comparison views beyond Overall: each group (AM, TL, vintage or agent) last month vs this month till date.
  const [compareView, setCompareView] = useState<CompareView>("overall");
  const compareGroups = useMemo(() => {
    if (!ctx || compareView === "overall") return [];
    const keyOf = (w: Who): string => (compareView === "am" ? w.am : compareView === "tl" ? w.tl : compareView === "vintage" ? w.vintage : w.agent);
    const names = [...new Set(people.map(keyOf))].filter(isRealFilterValue);
    if (compareView === "vintage") names.sort(byVintage);
    else names.sort((a, b) => a.localeCompare(b));
    return names.map((name) => {
      const pred: Pred = (f) => basePred(f) && keyOf(f) === name;
      return { name, l: calc(ctx, pred, lmtdRange), t: calc(ctx, pred, mtdRange) };
    });
  }, [ctx, compareView, people, basePred, lmtdRange, mtdRange]);
  const rows = useMemo(() => (ctx ? buildRows(ctx, basePred, range) : null), [ctx, basePred, range]);

  const pctDelta = (c: number, p: number | undefined) => (prev?.hasData && p && p > 0 ? r1(((c - p) / p) * 100) : null);
  const ppDelta = (c: number, p: number | undefined) => (prev?.hasData && p !== undefined ? r1(c - p) : null);

  const openRows = (title: string, series: DrawerSeries[], set: RowSet) =>
    setDrawer({ title, series, dailyRows: set.dailyRows, weeklyRows: set.weeklyRows });
  const openOverall = (title: string, series: DrawerSeries[]) => { if (rows) openRows(title, series, rows); };
  const openEntity = (title: string, pred: Pred, w: Win = range) => {
    if (!ctx) return;
    const set = buildRows(ctx, pred, w);
    openRows(title, set.monthly > 0 ? ENTITY_SERIES : ENTITY_SERIES.filter((s) => s.key !== "achPct"), set);
  };

  /* Matrix column sets */
  const entityCols = useCallback((kind: EntityKind, mode: "period" | "mtd"): { cols: MatrixCol[]; total: MatrixCol | undefined } => {
    if (!ctx) return { cols: [], total: undefined };
    const w = mode === "mtd" ? mtdRange : range;
    const field = (f: Who) => f[kind];
    const names = [...new Set(people.filter(basePred).map(field))];
    const cols = names.map((name) => {
      const pred: Pred = (f) => basePred(f) && field(f) === name;
      return { key: name, label: name, m: calc(ctx, pred, w), onClick: () => openEntity(`${name} · ${kind === "am" ? "AM" : kind === "tl" ? "TL" : "Vintage"}`, pred, w) };
    }).filter((c) => c.m.hasData)
      .sort((a, b) => (kind === "vintage" ? byVintage(a.label, b.label) : b.m.revenue - a.m.revenue));
    const total: MatrixCol = { key: "__total", label: "Total", m: calc(ctx, basePred, w), onClick: () => openEntity("Total", basePred, w) };
    return { cols, total };
    // openEntity closes over ctx/range only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, people, basePred, range, mtdRange]);

  const amCols = useMemo(() => entityCols("am", amMode), [entityCols, amMode]);
  const vintageCols = useMemo(() => entityCols("vintage", vintageMode), [entityCols, vintageMode]);
  const tlCols = useMemo(() => entityCols("tl", tlMode), [entityCols, tlMode]);

  const overallCols = useMemo<MatrixCol[]>(() => {
    if (!ctx) return [];
    const lastDay = (() => {
      const ds = new Set<string>();
      for (const r of ctx.cdr) if (r.date >= range.from && r.date <= range.to && basePred(r)) ds.add(r.date);
      for (const r of ctx.sales) if (r.date >= range.from && r.date <= range.to && basePred(r)) ds.add(r.date);
      return [...ds].sort().pop() ?? null;
    })();
    const wins: Array<{ key: string; label: string; w: Win | null }> = [
      { key: "lmtd", label: "LMTD", w: lmtdRange },
      { key: "day", label: lastDay ? `Last Day (${formatShortDate(lastDay)})` : "Last Day", w: lastDay ? { from: lastDay, to: lastDay } : null },
      { key: "period", label: "Selected Period", w: range },
      { key: "mtd", label: "MTD", w: mtdRange },
    ];
    return wins.flatMap((x) => {
      if (!x.w) return [];
      const w = x.w;
      const m = calc(ctx, basePred, w);
      if (x.key === "lmtd" && !m.hasData) return [];
      return [{ key: x.key, label: x.label, m, onClick: () => openEntity(`Overall · ${x.label}`, basePred, w) }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, basePred, range, mtdRange, lmtdRange]);
  const lmtdMissing = ctx ? !overallCols.some((c) => c.key === "lmtd") : false;

  /* Agent productivity */
  const agentRows = useMemo(() => {
    if (!ctx) return [];
    const list = new Map<string, Who>();
    for (const p of people) if (basePred(p)) list.set(p.agent, p);
    return [...list.values()].map((p) => {
      const pred: Pred = (f) => f.agent === p.agent;
      const m = calc(ctx, pred, range);
      return { ...p, m, pred };
    }).filter((r) => r.m.hasData);
  }, [ctx, people, basePred, range]);

  /** Active roster agents matching the current filters, each with their own window metrics -- the Active Agents tile's drawer. */
  const activeAgents = useMemo(() => {
    if (!ctx) return [];
    return ctx.roster
      .filter((r) => r.status === "Active" && basePred({ agent: r.name, tl: r.tl, am: r.am, vintage: r.vintage }))
      .map((r) => { const pred: Pred = (f) => f.agent === r.name; return { agent: r.name, tl: r.tl, am: r.am, vintage: r.vintage, m: calc(ctx, pred, range), pred }; })
      .sort((a, b) => b.m.revenue - a.m.revenue || a.agent.localeCompare(b.agent));
  }, [ctx, basePred, range]);

  // Excel-style sort + filter for the "Active Agents" dialog table.
  const ACTIVE_AGENT_FILTER_COLS: Array<FilterColumn<typeof activeAgents[number]>> = [
    { key: "agent", get: (a) => a.agent },
    { key: "tl", get: (a) => a.tl },
    { key: "am", get: (a) => a.am },
    { key: "vintage", get: (a) => a.vintage },
    { key: "calls", get: (a) => a.m.calls },
    { key: "connectedPct", get: (a) => (a.m.calls > 0 ? a.m.connectedPct : null) },
    { key: "saleCount", get: (a) => a.m.saleCount },
    { key: "revenue", get: (a) => a.m.revenue },
    { key: "target", get: (a) => (a.m.monthlyTarget > 0 ? a.m.monthlyTarget : null) },
    { key: "achPct", get: (a) => (a.m.monthlyTarget > 0 ? a.m.achPct : null) },
  ];
  const activeAgentFilters = useColumnFilters(activeAgents, ACTIVE_AGENT_FILTER_COLS);
  const activeAgentColGetter = (a: typeof activeAgents[number], key: string) => ACTIVE_AGENT_FILTER_COLS.find((c) => c.key === key)?.get(a);
  const activeAgentSort = useSortableRows(activeAgentFilters.filtered, activeAgentColGetter);

  const topAgents = useMemo(
    () => [...agentRows].sort((a, b) => {
      const va = agentSort === "saleCount" ? a.m.saleCount : agentSort === "calls" ? a.m.calls : a.m.revenue;
      const vb = agentSort === "saleCount" ? b.m.saleCount : agentSort === "calls" ? b.m.calls : b.m.revenue;
      return vb - va;
    }).slice(0, 10),
    [agentRows, agentSort],
  );

  const tableRows = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    return q ? agentRows.filter((r) => r.agent.toLowerCase().includes(q)) : agentRows;
  }, [agentRows, agentSearch]);
  // Excel-style: every header sorts (click) and filters (funnel icon); "stage" filters/sorts by its
  // TQ/MQ/BQ/NA label (not STAGE_RANK) so the filter checklist offers meaningful values.
  const AGENT_FILTER_COLS: Array<FilterColumn<typeof tableRows[number]>> = [
    { key: "agent", get: (r) => r.agent },
    { key: "tl", get: (r) => r.tl },
    { key: "am", get: (r) => r.am },
    { key: "vintage", get: (r) => r.vintage },
    { key: "calls", get: (r) => r.m.calls },
    { key: "connectedPct", get: (r) => r.m.connectedPct },
    { key: "saleCount", get: (r) => r.m.saleCount },
    { key: "revenue", get: (r) => r.m.revenue },
    { key: "target", get: (r) => (r.m.monthlyTarget > 0 ? r.m.monthlyTarget : null) },
    { key: "achPct", get: (r) => (r.m.monthlyTarget > 0 ? r.m.achPct : null) },
    { key: "stage", get: (r) => stageOf(r.m.achPct, r.m.monthlyTarget > 0) },
    { key: "talk", get: (r) => r.m.avgTalkSec },
  ];
  const agentTableFilters = useColumnFilters(tableRows, AGENT_FILTER_COLS);
  const agentTableColGetter = (r: typeof tableRows[number], key: string) => AGENT_FILTER_COLS.find((c) => c.key === key)?.get(r);
  const tableSort = useSortableRows(agentTableFilters.filtered, agentTableColGetter);

  /* Chart series */
  const dailyChart = useMemo<Array<Record<string, string | number>>>(() => (rows?.dailyRows ?? []).map((r) => ({ ...r, x: formatShortDate(String(r.date)) })), [rows]);
  const weeklyChart = useMemo<Array<Record<string, string | number>>>(() => (rows?.weeklyRows ?? []).map((r) => ({ ...r, x: String(r.label).replace(/\s*\(.*\)/, "") })), [rows]);
  // Daily Performance Trend has its own AM filter; the page-level AM filter, when set, already narrows everything, so it wins.
  const trendAmActive = am === "all" ? trendAm : "all";
  const trendRows = useMemo(() => {
    if (!ctx) return null;
    if (trendAmActive === "all") return rows;
    const pred: Pred = (f) => basePred(f) && f.am === trendAmActive;
    return buildRows(ctx, pred, range);
  }, [ctx, rows, basePred, range, trendAmActive]);
  const trendChart = useMemo<Array<Record<string, string | number>>>(() => (trendRows?.dailyRows ?? []).map((r) => ({ ...r, x: formatShortDate(String(r.date)) })), [trendRows]);
  const talkChart = useMemo(() => (talkMode === "daily" ? dailyChart : weeklyChart).map((r) => ({ ...r, talkMin: r1(Number(r.avgTalkSec) / 60) })), [talkMode, dailyChart, weeklyChart]);

  const insights = useMemo(() => {
    if (!ctx || !cur || !cur.hasData) return [];
    const out: Array<{ tone: string; text: string }> = [];
    const total = amCols.total?.m.revenue ?? 0;
    const topAm = amCols.cols[0];
    if (topAm && topAm.m.revenue > 0 && amCols.cols.length > 1) {
      out.push({ tone: "bg-emerald-500", text: `${topAm.label} leads revenue with ${formatINR(topAm.m.revenue)} (${total > 0 ? Math.round((topAm.m.revenue / total) * 100) : 0}% of total).` });
    }
    const tlByConn = [...tlCols.cols].filter((c) => c.m.calls >= 500).sort((a, b) => b.m.connectedPct - a.m.connectedPct);
    if (tlByConn.length > 1) out.push({ tone: "bg-sky-500", text: `${tlByConn[0].label} has the best connected % at ${tlByConn[0].m.connectedPct}%; ${tlByConn[tlByConn.length - 1].label} is lowest at ${tlByConn[tlByConn.length - 1].m.connectedPct}%.` });
    const best = [...(rows?.dailyRows ?? [])].sort((a, b) => Number(b.revenue) - Number(a.revenue))[0];
    if (best && Number(best.revenue) > 0) out.push({ tone: "bg-amber-500", text: `Best revenue day was ${formatShortDate(String(best.date))}: ${formatINR(Number(best.revenue))} from ${best.saleCount} sales.` });
    const vAov = [...vintageCols.cols].filter((c) => c.m.saleCount >= 5).sort((a, b) => b.m.aov - a.m.aov)[0];
    if (vAov) out.push({ tone: "bg-cyan-500", text: `Vintage ${vAov.label} has the highest AOV at ${formatINR(vAov.m.aov)}.` });
    const targeted = agentRows.filter((r) => r.m.monthlyTarget > 0);
    if (targeted.length > 0) {
      const tq = targeted.filter((r) => r.m.achPct >= 80).length;
      const bq = targeted.filter((r) => r.m.achPct < 50).length;
      out.push({ tone: "bg-violet-500", text: `${tq} of ${targeted.length} agents with a target are at 80%+ of it; ${bq} are below 50%.` });
    }
    const dRev = pctDelta(cur.revenue, prev?.revenue);
    if (dRev !== null) out.push({ tone: dRev >= 0 ? "bg-emerald-500" : "bg-rose-500", text: `Revenue is ${dRev >= 0 ? "up" : "down"} ${Math.abs(dRev)}% vs the previous period.` });
    if (cur.avgTalkSec > 0) out.push({ tone: "bg-pink-500", text: `Average talk time is ${fmtHms(cur.avgTalkSec)} per agent-day at ${cur.dialPerAgent.toLocaleString("en-IN")} dials per agent-day.` });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, cur, prev, amCols, tlCols, vintageCols, rows, agentRows]);

  /* Export */
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!cur) return [];
    // Comparison slide: the same days last month vs the current month to date.
    const lastMonth = ctx ? calc(ctx, basePred, lmtdRange) : null;
    const thisMonth = ctx ? calc(ctx, basePred, mtdRange) : null;
    const pctChange = (c: number, p: number) => (p > 0 ? `${r1(((c - p) / p) * 100)}%` : "—");
    const ppChange = (c: number, p: number) => `${r1(c - p)} pp`;
    const compareRows: string[][] = lastMonth && thisMonth && (lastMonth.hasData || thisMonth.hasData) ? [
      ["Total Calls", int(lastMonth.calls), int(thisMonth.calls), pctChange(thisMonth.calls, lastMonth.calls)],
      ["Connected Calls", int(lastMonth.connected), int(thisMonth.connected), pctChange(thisMonth.connected, lastMonth.connected)],
      ["Connected %", `${lastMonth.connectedPct}%`, `${thisMonth.connectedPct}%`, ppChange(thisMonth.connectedPct, lastMonth.connectedPct)],
      ["Sale Count", int(lastMonth.saleCount), int(thisMonth.saleCount), pctChange(thisMonth.saleCount, lastMonth.saleCount)],
      ["Revenue", formatINR(lastMonth.revenue), formatINR(thisMonth.revenue), pctChange(thisMonth.revenue, lastMonth.revenue)],
      ["AOV", formatINR(lastMonth.aov), formatINR(thisMonth.aov), pctChange(thisMonth.aov, lastMonth.aov)],
      ["Ach %", lastMonth.monthlyTarget > 0 ? `${lastMonth.achPct}%` : "—", thisMonth.monthlyTarget > 0 ? `${thisMonth.achPct}%` : "—",
        lastMonth.monthlyTarget > 0 && thisMonth.monthlyTarget > 0 ? ppChange(thisMonth.achPct, lastMonth.achPct) : "—"],
    ] : [];
    const compareSlide: ExportSlide = {
      title: "Last Month vs Current Month (till date)",
      kpis: [
        { label: `Revenue (last month, till ${lmtdRange.to})`, value: lastMonth ? formatINR(lastMonth.revenue) : "—" },
        { label: `Revenue (current month, till ${mtdRange.to})`, value: thisMonth ? formatINR(thisMonth.revenue) : "—" },
      ],
      tables: [{
        title: "Till-date comparison",
        columns: ["Metric", `Last month (${lmtdRange.from} to ${lmtdRange.to})`, `Current month (${mtdRange.from} to ${mtdRange.to})`, "Change"],
        rows: compareRows,
      }],
    };
    const matrixTable = (title: string, set: { cols: MatrixCol[]; total: MatrixCol | undefined }) => {
      const all = set.total ? [...set.cols, set.total] : set.cols;
      return { title, columns: ["Metric", ...all.map((c) => c.label)], rows: MATRIX_ROWS.map((r) => [r.label, ...all.map((c) => r.cell(c.m).text)]) };
    };
    return [{
      title: "Housing Owner Outbound Performance",
      kpis: [
        { label: "Total Calls", value: int(cur.calls) },
        { label: "Connected Calls", value: int(cur.connected) },
        { label: "Not Connected Calls", value: int(cur.notConnected) },
        { label: "Connected %", value: `${cur.connectedPct}%` },
        { label: "Sale Count", value: int(cur.saleCount) },
        { label: "Revenue Achieved", value: formatINR(cur.revenue) },
        { label: "AOV", value: formatINR(cur.aov) },
        { label: "Ach %", value: cur.monthlyTarget > 0 ? `${cur.achPct}%` : "—" },
        { label: "MTD Ach %", value: cur.mtdTarget > 0 ? `${cur.mtdPct}%` : "—" },
      ],
      tables: [
        matrixTable("AM Wise Performance Metrics", amCols),
        matrixTable("Vintage Wise Performance Metrics", vintageCols),
        matrixTable("TL Wise Performance Metrics", tlCols),
        {
          title: "Agent Wise Performance",
          columns: ["Agent", "TL", "AM", "Vintage", "Calls", "Connected", "Conn %", "Sales", "Revenue", "Target", "Ach %", "Stage (TQ/MQ/BQ)", "MTD Target", "MTD %", "Avg Talk"],
          rows: agentRows.map((r) => [
            r.agent, r.tl, r.am, r.vintage, int(r.m.calls), r.m.connected, `${r.m.connectedPct}%`, r.m.saleCount, formatINR(r.m.revenue),
            r.m.monthlyTarget > 0 ? formatINR(r.m.monthlyTarget) : "—", r.m.monthlyTarget > 0 ? `${r.m.achPct}%` : "—",
            stageOf(r.m.achPct, r.m.monthlyTarget > 0), r.m.mtdTarget > 0 ? formatINR(r.m.mtdTarget) : "—", r.m.mtdTarget > 0 ? `${r.m.mtdPct}%` : "—",
            r.m.avgTalkSec > 0 ? fmtHms(r.m.avgTalkSec) : "—",
          ]),
        },
        {
          title: "TQ MQ BQ Summary",
          columns: ["Stage", "Agent Count", "Total Revenue", "Avg Ach %"],
          rows: (["TQ", "MQ", "BQ", "NA"] as const).map((stage) => {
            const inStage = agentRows.filter((r) => stageOf(r.m.achPct, r.m.monthlyTarget > 0) === stage);
            const totalRevenue = inStage.reduce((s, r) => s + r.m.revenue, 0);
            const targeted = inStage.filter((r) => r.m.monthlyTarget > 0);
            const avgAch = targeted.length > 0 ? Math.round(targeted.reduce((s, r) => s + r.m.achPct, 0) / targeted.length) : 0;
            return [stage === "NA" ? "No Target" : stage, inStage.length, formatINR(totalRevenue), targeted.length > 0 ? `${avgAch}%` : "—"];
          }),
        },
      ],
    }, compareSlide];
  }, [cur, ctx, basePred, lmtdRange, mtdRange, amCols, vintageCols, tlCols, agentRows]);

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <DashboardExportMenu
        reportTitle="Housing Owner — Outbound Performance"
        fileBaseName="Housing_Owner_Outbound"
        raw={{ dashboard: "housing_owner", from, to }}
        subtitle={`${from} to ${to}`}
        slides={exportSlides}
        activeSlideTitle="Housing Owner Outbound Performance"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          accentFocus="focus:border-orange-400"
        />
      </div>
    </div>
  );

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white p-2 shadow-sm">
      <span className="px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Filters</span>
      <Select value={am} onValueChange={setAm}>
        <SelectTrigger className="h-8 w-[140px] bg-white text-xs" aria-label="Filter by AM"><SelectValue placeholder="All AMs" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All AMs</SelectItem>
          {amOptions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={tl} onValueChange={setTl}>
        <SelectTrigger className="h-8 w-[170px] bg-white text-xs" aria-label="Filter by TL"><SelectValue placeholder="All TLs" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All TLs</SelectItem>
          {tlOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="w-[210px]">
        <SearchableSelect
          value={agent} onChange={setAgent} placeholder="All Agents" searchPlaceholder="Search agent..."
          options={[{ value: "all", label: "All Agents" }, ...agentOptions.map((a) => ({ value: a, label: a }))]}
        />
      </div>
      <Select value={vintage} onValueChange={setVintage}>
        <SelectTrigger className="h-8 w-[150px] bg-white text-xs" aria-label="Filter by Vintage (agent tenure)"><SelectValue placeholder="All Vintage" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Vintage</SelectItem>
          {vintageOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
        </SelectContent>
      </Select>
      {filtersActive && (
        <button
          type="button" onClick={() => { setAm("all"); setTl("all"); setAgent("all"); setVintage("all"); }}
          className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
        >
          Clear
        </button>
      )}
      <button
        type="button" onClick={() => void load()} disabled={loading}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
      </button>
    </div>
  );

  if (loading && !data) return <div className="space-y-3">{toolbar}<Spinner /></div>;
  if (error && !data) return <div className="space-y-3">{toolbar}<div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div></div>;
  if (!data || !ctx || !cur || !rows) return null;

  const donut = [
    { name: "Connected", value: cur.connected, color: COLORS.connected },
    { name: "Not Connected", value: cur.notConnected, color: COLORS.calls },
  ];
  const donutTotal = cur.connected + cur.notConnected;
  const targetDonut = [
    { name: "Achieved", value: Math.min(cur.revenue, cur.monthlyTarget), color: "#10b981" },
    { name: cur.revenue >= cur.monthlyTarget ? "Above target" : "Remaining", value: cur.revenue >= cur.monthlyTarget ? cur.revenue - cur.monthlyTarget : cur.monthlyTarget - cur.revenue, color: cur.revenue >= cur.monthlyTarget ? "#0ea5e9" : "#e2e8f0" },
  ];
  const dataNote = `Call data through ${data.cdrThrough ? formatShortDate(data.cdrThrough) : "—"} · Sale data through ${data.saleThrough ? formatShortDate(data.saleThrough) : "—"}`;
  const targetSub = cur.monthlyTarget > 0 ? `Target ${formatINR(cur.monthlyTarget)}` : "No target set";

  const heroTabs: Array<{ key: HeroTab; label: string }> = [{ key: "outbound", label: "Outbound" }, { key: "comparison", label: "Comparison" }];

  if (heroTab === "comparison") return (
    <div className="space-y-3">
      <DashboardHero<HeroTab>
        icon={Home} eyebrow="Housing Owner · Calls • Sales • Revenue • Team Performance" title="Outbound Performance Dashboard"
        tabs={heroTabs} activeTab={heroTab} onTabChange={setHeroTab}
        gradient="from-orange-600 via-amber-600 to-orange-700"
      />
      <SectionCard icon={Home} title="Last month vs current month (till date)" tone="amber"
        footnote={`Last month: ${lmtdRange.from} to ${lmtdRange.to} · Current month: ${mtdRange.from} to ${mtdRange.to}. Change is a percentage, or percentage points for ratios.`}
      >
        <div className="mb-3 inline-flex flex-wrap rounded-full bg-slate-100 p-1">
          {([["overall", "Overall"], ["am", "AM-wise"], ["tl", "TL-wise"], ["vintage", "Vintage-wise"], ["agent", "Agent-wise"]] as Array<[CompareView, string]>).map(([k, label]) => (
            <button
              key={k} type="button" onClick={() => setCompareView(k)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${compareView === k ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {compareView === "overall" ? (
          compareRows.length === 0 ? <p className="py-16 text-center text-xs text-slate-400">No data for this comparison.</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="bg-slate-800 text-[11px] uppercase tracking-wide text-white">
                    <th className="px-3 py-2">KPI</th>
                    <th className="px-3 py-2 text-right">Last month (till date)</th>
                    <th className="px-3 py-2 text-right">Current month (till date)</th>
                    <th className="px-3 py-2 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((r, i) => (
                    <tr key={r[0]} className={`border-t border-slate-100 ${i % 2 ? "bg-white" : "bg-slate-50"}`}>
                      <td className="px-3 py-2 font-semibold text-slate-800">{r[0]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r[1]}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{r[2]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          compareGroups.length === 0 ? <p className="py-16 text-center text-xs text-slate-400">No data for this view.</p> : (
            <div className="max-h-[560px] overflow-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="sticky top-0 bg-slate-800 text-[11px] uppercase tracking-wide text-white">
                  <tr>
                    <th className="px-2 py-2">{compareView === "am" ? "AM" : compareView === "tl" ? "TL" : compareView === "vintage" ? "Vintage" : "Agent"}</th>
                    <th className="px-2 py-2 text-right">Calls (last)</th>
                    <th className="px-2 py-2 text-right">Calls (current)</th>
                    <th className="px-2 py-2 text-right">Sales (last)</th>
                    <th className="px-2 py-2 text-right">Sales (current)</th>
                    <th className="px-2 py-2 text-right">Revenue (last)</th>
                    <th className="px-2 py-2 text-right">Revenue (current)</th>
                    <th className="px-2 py-2 text-right">Revenue change</th>
                    <th className="px-2 py-2 text-right">Ach % (last)</th>
                    <th className="px-2 py-2 text-right">Ach % (current)</th>
                  </tr>
                </thead>
                <tbody>
                  {compareGroups.map((g, i) => {
                    const chg = g.l.revenue > 0 ? `${r1(((g.t.revenue - g.l.revenue) / g.l.revenue) * 100)}%` : "—";
                    return (
                      <tr key={g.name} className={`border-t border-slate-100 ${i % 2 ? "bg-white" : "bg-slate-50"}`}>
                        <td className="px-2 py-1.5 font-semibold text-slate-800">{g.name}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{int(g.l.calls)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{int(g.t.calls)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{int(g.l.saleCount)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{int(g.t.saleCount)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatINR(g.l.revenue)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatINR(g.t.revenue)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{chg}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{g.l.monthlyTarget > 0 ? `${g.l.achPct}%` : "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{g.t.monthlyTarget > 0 ? `${g.t.achPct}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </SectionCard>
    </div>
  );

  return (
    <div className="space-y-3">
      <DashboardHero<HeroTab>
        icon={Home} eyebrow="Housing Owner · Calls • Sales • Revenue • Team Performance" title="Outbound Performance Dashboard"
        tabs={heroTabs} activeTab={heroTab} onTabChange={setHeroTab}
        gradient="from-orange-600 via-amber-600 to-orange-700"
      />
      {toolbar}
      {filterBar}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {/* KPI row -- every card opens its own week/date drill-down */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-10">
        <StatTile icon={PhoneCall} tone="amber" label="Total Calls" value={int(cur.calls)} sub={prev?.hasData ? `vs previous ${int(prev.calls)}` : undefined} delta={pctDelta(cur.calls, prev?.calls)} onClick={() => openOverall("Total Calls", [S.calls])} />
        <StatTile icon={PhoneOutgoing} tone="sky" label="Connected Calls" value={int(cur.connected)} sub={prev?.hasData ? `vs previous ${int(prev.connected)}` : undefined} delta={pctDelta(cur.connected, prev?.connected)} onClick={() => openOverall("Connected Calls", [S.connected])} />
        <StatTile icon={PhoneOff} tone="rose" label="Not Connected Calls" value={int(cur.notConnected)} sub={prev?.hasData ? `vs previous ${int(prev.notConnected)}` : undefined} delta={pctDelta(cur.notConnected, prev?.notConnected)} onClick={() => openOverall("Not Connected Calls", [S.notConnected])} />
        <StatTile icon={Percent} tone="indigo" label="Connected %" value={`${cur.connectedPct}%`} sub={prev?.hasData ? `vs previous ${prev.connectedPct}%` : undefined} delta={ppDelta(cur.connectedPct, prev?.connectedPct)} deltaUnit="pp" onClick={() => openOverall("Connected %", [S.connectedPct, S.calls, S.connected])} />
        <StatTile icon={ShoppingBag} tone="emerald" label="Sale Count" value={int(cur.saleCount)} sub={prev?.hasData ? `vs previous ${int(prev.saleCount)}` : undefined} delta={pctDelta(cur.saleCount, prev?.saleCount)} onClick={() => openOverall("Sale Count", [S.saleCount])} />
        <StatTile icon={IndianRupee} tone="teal" label="Revenue Achieved" value={formatINR(cur.revenue)} sub={prev?.hasData ? `vs previous ${formatINR(prev.revenue)}` : undefined} delta={pctDelta(cur.revenue, prev?.revenue)} onClick={() => openOverall("Revenue Achieved", [S.revenue])} />
        <StatTile icon={Wallet} tone="cyan" label="AOV" value={cur.saleCount > 0 ? formatINR(cur.aov) : "—"} sub={prev?.hasData && prev.saleCount > 0 ? `vs previous ${formatINR(prev.aov)}` : undefined} delta={pctDelta(cur.aov, prev?.aov)} onClick={() => openOverall("AOV (Average Order Value)", [S.aov, S.saleCount, S.revenue])} />
        <StatTile icon={Target} tone="violet" label="Ach %" value={cur.monthlyTarget > 0 ? `${cur.achPct}%` : "—"} sub={targetSub} delta={cur.monthlyTarget > 0 ? ppDelta(cur.achPct, prev?.achPct) : null} deltaUnit="pp" onClick={() => openOverall("Ach % (vs daily share of monthly target)", [S.achPct, S.revenue])} />
        <StatTile icon={Target} tone="blue" label="MTD Ach %" value={cur.mtdTarget > 0 ? `${cur.mtdPct}%` : "—"} sub={cur.mtdTarget > 0 ? `MTD target ${formatINR(cur.mtdTarget)}` : "No target set"} delta={cur.mtdTarget > 0 ? ppDelta(cur.mtdPct, prev?.mtdPct) : null} deltaUnit="pp" onClick={() => openOverall("MTD Ach % (month-to-date revenue / target prorated to date)", [S.revenue, S.achPct])} />
        <StatTile icon={Users} tone="indigo" label="Active Agents" value={String(activeAgents.length)} sub={`${activeAgents.filter((a) => a.m.calls > 0).length} dialled in range`} onClick={() => setActiveOpen(true)} />
      </div>

      {/* Call status + Daily performance */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard
          icon={PieIcon} title={pieView === "calls" ? "Call Status Distribution" : "Target vs Achievement"} tone="amber"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Seg value={pieView} onChange={(v) => setPieView(v)} options={[{ key: "calls", label: "Calls" }, { key: "target", label: "Target vs Ach %" }]} />
              <ViewDetailsBtn onClick={() => (pieView === "calls" ? openOverall("Call Status Distribution", [S.connected, S.notConnected, S.connectedPct]) : openOverall("Target vs Ach %", [S.revenue, S.achPct]))} />
            </div>
          }
        >
          {pieView === "calls" ? (
            <>
              <div className="relative">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={donut} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2} stroke="none">
                      {donut.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip {...TOOLTIP_PROPS} formatter={(v: number, n: string) => [`${int(v)} (${donutTotal > 0 ? r1((v / donutTotal) * 100) : 0}%)`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-lg font-extrabold leading-tight text-slate-800">{int(donutTotal)}</p>
                  <p className="text-[10px] font-medium text-slate-400">Total Calls</p>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                {donut.map((d) => (
                  <span key={d.name} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                    {d.name} <span className="font-semibold text-slate-800">{donutTotal > 0 ? r1((d.value / donutTotal) * 100) : 0}%</span>
                  </span>
                ))}
              </div>
            </>
          ) : cur.monthlyTarget > 0 ? (
            <>
              <div className="relative">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={targetDonut} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2} stroke="none" startAngle={90} endAngle={-270}>
                      {targetDonut.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip {...TOOLTIP_PROPS} formatter={(v: number, n: string) => [formatINR(v), n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-lg font-extrabold leading-tight text-slate-800">{cur.achPct}%</p>
                  <p className="text-[10px] font-medium text-slate-400">of monthly target</p>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                {targetDonut.map((d) => (
                  <span key={d.name} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                    {d.name} <span className="font-semibold text-slate-800">{formatINR(d.value)}</span>
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {([
                  ["Monthly target", cur.monthlyTarget, cur.revenue, cur.achPct],
                  ...(cur.mtdTarget > 0 ? [["MTD target", cur.mtdTarget, cur.mtdRevenue, cur.mtdPct] as const] : []),
                ] as Array<readonly [string, number, number, number]>).map(([label, tgt, ach, p]) => {
                  const tone = p >= 100 ? { bar: "bg-emerald-500", text: "text-emerald-600" } : p >= 60 ? { bar: "bg-amber-500", text: "text-amber-600" } : { bar: "bg-rose-500", text: "text-rose-600" };
                  return (
                    <div key={label}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-slate-600">{label} <span className="font-bold text-slate-800">{formatINR(tgt)}</span></span>
                        <span className={`text-sm font-extrabold ${tone.text}`}>{p}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, Math.max(0, p))}%` }} /></div>
                      <p className="mt-0.5 text-[10px] text-slate-400">Achieved {formatINR(ach)}</p>
                    </div>
                  );
                })}
              </div>
            </>
          ) : <p className="rounded-lg bg-slate-50 px-3 py-10 text-center text-[11px] text-slate-400">No target set for this selection</p>}
        </SectionCard>

        <div className="lg:col-span-2">
          <SectionCard
            icon={TrendingUp} title={`Daily Performance Trend${trendAmActive !== "all" ? ` · ${trendAmActive}` : ""}`} tone="amber"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Seg value={trendView} onChange={(v) => setTrendView(v)} options={[{ key: "calls", label: "Calls & Sales" }, { key: "target", label: "Target vs Ach %" }]} />
                {trendView === "calls" && (
                  <MiniSelect
                    label="Bar metric" value={dailyBar} onChange={(v) => setDailyBar(v)}
                    options={[{ key: "calls", label: "Total Calls" }, { key: "connected", label: "Connected Calls" }, { key: "notConnected", label: "Not Connected" }]}
                  />
                )}
                <AmFilterButton value={trendAmActive} options={amOptions} onChange={setTrendAm} disabled={am !== "all"} />
                <ViewDetailsBtn
                  onClick={() => trendRows && openRows(
                    `Daily Performance Trend${trendAmActive !== "all" ? ` · ${trendAmActive}` : ""}`,
                    trendView === "calls" ? [S.calls, S.connected, S.notConnected, S.saleCount] : [S.revenue, S.target, S.achPct],
                    trendRows,
                  )}
                />
              </div>
            }
          >
            {trendChart.length === 0 ? <p className="py-16 text-center text-xs text-slate-400">No activity in this range.</p>
              : trendView === "target" ? (
                (trendRows?.monthly ?? 0) > 0 ? (
                  <ResponsiveContainer width="100%" height={210}>
                    <ComposedChart data={trendChart} margin={{ top: 4, right: 8, left: -4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="x" tick={{ fontSize: 9 }} />
                      <YAxis yAxisId="l" tick={{ fontSize: 9 }} tickFormatter={(x: number) => (x >= 100000 ? `${r1(x / 100000)}L` : x >= 1000 ? `${r1(x / 1000)}k` : String(x))} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} tickFormatter={(x: number) => `${x}%`} />
                      <Tooltip {...TOOLTIP_PROPS} formatter={(v: number, n: string) => (n === "Ach %" ? `${v}%` : formatINR(Number(v)))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="l" dataKey="revenue" name="Revenue Achieved" fill={COLORS.revenue} radius={[3, 3, 0, 0]} maxBarSize={22} />
                      <Line yAxisId="l" type="monotone" dataKey="target" name="Daily Target" stroke="#64748b" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                      <Line yAxisId="r" type="monotone" dataKey="achPct" name="Ach %" stroke={COLORS.ach} strokeWidth={2} dot={{ r: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-16 text-center text-xs text-slate-400">No monthly target is set for this selection, so Target and Ach % can't be shown.</p>
                )
              ) : (
              <ResponsiveContainer width="100%" height={210}>
                <ComposedChart data={trendChart} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="x" tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey={dailyBar} name={S[dailyBar].label} fill={S[dailyBar].color} radius={[3, 3, 0, 0]} maxBarSize={22} />
                  {dailyBar !== "connected" && <Line yAxisId="l" type="monotone" dataKey="connected" name="Connected Calls" stroke={COLORS.connected} strokeWidth={2} dot={{ r: 2 }} />}
                  <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sale Count" stroke={COLORS.sale} strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Revenue & Sales + Talk Time */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard
          icon={IndianRupee} title="Revenue & Sales Trend" tone="emerald"
          action={
            <div className="flex items-center gap-2">
              <MiniSelect label="Period" value={revMode} onChange={(v) => setRevMode(v)} options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }]} />
              <ViewDetailsBtn onClick={() => openOverall("Revenue & Sales Trend", [S.revenue, S.saleCount, S.aov])} />
            </div>
          }
        >
          {dailyChart.length === 0 ? <p className="py-16 text-center text-xs text-slate-400">No activity in this range.</p> : (
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={revMode === "daily" ? dailyChart : weeklyChart} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="x" tick={{ fontSize: 9 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 9 }} tickFormatter={(v: number) => (v >= 100000 ? `${r1(v / 100000)}L` : v >= 1000 ? `${r1(v / 1000)}K` : String(v))} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} />
                <Tooltip {...TOOLTIP_PROPS} formatter={(v: number, n: string) => (n === "Revenue" ? formatINR(v) : int(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="revenue" name="Revenue" fill={COLORS.revenue} radius={[3, 3, 0, 0]} maxBarSize={26} />
                <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sale Count" stroke={COLORS.sale} strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard
          icon={Timer} title="Talk Time Analysis" tone="rose"
          footnote="Talk time is the dialer's per-agent daily in-call duration; the line is the average per agent-day."
          action={
            <div className="flex items-center gap-2">
              <MiniSelect label="Period" value={talkMode} onChange={(v) => setTalkMode(v)} options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }]} />
              <ViewDetailsBtn onClick={() => openOverall("Talk Time Analysis", [S.avgTalkSec, S.calls, S.dialPerAgent, S.present])} />
            </div>
          }
        >
          {talkChart.length === 0 ? <p className="py-16 text-center text-xs text-slate-400">No activity in this range.</p> : (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={talkChart} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="x" tick={{ fontSize: 9 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}m`} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} />
                <Tooltip {...TOOLTIP_PROPS} formatter={(v: number, n: string, item) => (n === "Avg Talk Time" ? fmtHms(Number((item?.payload as { avgTalkSec?: number })?.avgTalkSec ?? v * 60)) : int(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="r" dataKey="calls" name="Total Calls" fill="#fed7aa" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line yAxisId="l" type="monotone" dataKey="talkMin" name="Avg Talk Time" stroke={COLORS.talk} strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* AM wise */}
      <SectionCard
        icon={Users} title="AM Wise Performance Metrics" tone="blue"
        footnote="Click any column or cell for that AM's week-wise and date-wise breakdown. AM / TL / Vintage come from the agent roster (owner_agent_details); agents not on it fall back to the AM / TL on their own upload rows."
        action={<Seg value={amMode} onChange={(v) => setAmMode(v)} options={[{ key: "period", label: "Selected Period" }, { key: "mtd", label: "MTD" }]} />}
      >
        <MetricMatrix columns={amCols.cols} total={amCols.total} firstColLabel="AM" />
      </SectionCard>

      {/* Vintage wise */}
      <SectionCard
        icon={Layers} title="Vintage Wise Performance Metrics" tone="violet"
        footnote="Vintage = the agent's tenure bucket from the roster (days since joining). Agents missing from the roster are grouped as Unmapped."
        action={<Seg value={vintageMode} onChange={(v) => setVintageMode(v)} options={[{ key: "period", label: "Overall" }, { key: "mtd", label: "MTD" }]} />}
      >
        <MetricMatrix columns={vintageCols.cols} total={vintageCols.total} firstColLabel="Vintage" />
      </SectionCard>

      {/* Overall */}
      <SectionCard
        icon={ClipboardList} title="Overall Performance Metrics" tone="teal"
        footnote={`${lmtdMissing ? "LMTD is not shown: no calls or sales were uploaded for the same days of the previous month. " : ""}${dataNote}.`}
      >
        <MetricMatrix columns={overallCols} firstColLabel="Metric" />
      </SectionCard>

      {/* TL wise */}
      <SectionCard
        icon={Users} title="TL Wise Performance Metrics" tone="indigo"
        action={<Seg value={tlMode} onChange={(v) => setTlMode(v)} options={[{ key: "period", label: "Selected Period" }, { key: "mtd", label: "TL MTD" }]} />}
      >
        <MetricMatrix columns={tlCols.cols} total={tlCols.total} firstColLabel="TL" />
      </SectionCard>

      {/* Agent productivity + insights */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard
            icon={Award} title={agentView === "chart" ? "Agent Productivity (Top 10)" : `Agent-wise Performance (${agentTableFilters.filtered.length}${agentSearch.trim() || agentTableFilters.activeCount > 0 ? ` of ${agentRows.length}` : ""} agents)`} tone="emerald"
            action={
              <div className="flex items-center gap-2">
                {agentView === "chart" && (
                  <MiniSelect
                    label="Rank by" value={agentSort} onChange={(v) => setAgentSort(v)}
                    options={[{ key: "saleCount", label: "Sale Count" }, { key: "calls", label: "Total Calls" }, { key: "revenue", label: "Revenue" }]}
                  />
                )}
                {agentView === "table" && (
                  <TableExcelIconButton
                    fileBase="Housing_Owner_agent_wise"
                    getSheets={() => [{
                      name: "Agent-wise",
                      columns: ["Agent", "TL", "AM", "Vintage", "Calls", "Connected", "Conn %", "Sales", "Revenue", "Target", "Ach %", "Stage", "MTD Target", "MTD %", "Avg Talk"],
                      rows: tableSort.sorted.map((r) => [r.agent, r.tl, r.am, r.vintage, r.m.calls, r.m.connected, `${r.m.connectedPct}%`, r.m.saleCount, Math.round(r.m.revenue), Math.round(r.m.monthlyTarget), r.m.monthlyTarget > 0 ? `${r.m.achPct}%` : "—", stageOf(r.m.achPct, r.m.monthlyTarget > 0), Math.round(r.m.mtdTarget), r.m.mtdTarget > 0 ? `${r.m.mtdPct}%` : "—", r.m.avgTalkSec > 0 ? fmtHms(r.m.avgTalkSec) : "—"]),
                    }]}
                  />
                )}
                <Seg value={agentView} onChange={(v) => setAgentView(v)} options={[{ key: "chart", label: "Top 10" }, { key: "table", label: "All agents" }]} />
              </div>
            }
            footnote={agentView === "chart" ? "Click a row for that agent's week-wise and date-wise breakdown, or switch to All agents for the full table." : undefined}
          >
            {agentView === "chart" ? (
              topAgents.length === 0 ? <p className="py-16 text-center text-xs text-slate-400">No agent activity in this range.</p> : (
                <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-100">
                  <table className="w-full min-w-[1200px] text-left text-xs">
                    <thead className="sticky top-0 bg-slate-800 text-[11px] uppercase tracking-wide text-white">
                      <tr>
                        <th className="px-2 py-2">#</th>
                        <th className="px-2 py-2">Agent</th>
                        <th className="px-2 py-2">TL</th>
                        <th className="px-2 py-2">AM</th>
                        <th className="px-2 py-2">Vintage</th>
                        <th className="px-2 py-2 text-right">Calls</th>
                        <th className="px-2 py-2 text-right">Connected</th>
                        <th className="px-2 py-2 text-right">Conn %</th>
                        <th className="px-2 py-2 text-right">Sales</th>
                        <th className="px-2 py-2 text-right">Revenue</th>
                        <th className="px-2 py-2 text-right">Target</th>
                        <th className="px-2 py-2 text-right">Ach %</th>
                        <th className="px-2 py-2">Stage</th>
                        <th className="px-2 py-2 text-right">MTD Target</th>
                        <th className="px-2 py-2 text-right">MTD %</th>
                        <th className="px-2 py-2 text-right">Avg Talk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topAgents.map((r, i) => (
                        <tr
                          key={r.agent}
                          onClick={() => openEntity(r.agent, r.pred)}
                          className={`cursor-pointer border-t border-slate-100 hover:bg-amber-50 ${i % 2 ? "bg-white" : "bg-slate-50"}`}
                        >
                          <td className="px-2 py-1.5 font-bold text-slate-500">{i + 1}</td>
                          <td className="px-2 py-1.5 font-semibold text-slate-800">{r.agent}</td>
                          <td className="px-2 py-1.5">{r.tl}</td>
                          <td className="px-2 py-1.5">{r.am}</td>
                          <td className="px-2 py-1.5">{r.vintage}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{int(r.m.calls)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{int(r.m.connected)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.m.connectedPct}%</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{int(r.m.saleCount)}</td>
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatINR(r.m.revenue)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.m.monthlyTarget > 0 ? formatINR(r.m.monthlyTarget) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.m.monthlyTarget > 0 ? `${r.m.achPct}%` : "—"}</td>
                          <td className="px-2 py-1.5">{stageOf(r.m.achPct, r.m.monthlyTarget > 0)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.m.mtdTarget > 0 ? formatINR(r.m.mtdTarget) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.m.mtdTarget > 0 ? `${r.m.mtdPct}%` : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.m.avgTalkSec > 0 ? fmtHms(r.m.avgTalkSec) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="relative w-full max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Search agent..." aria-label="Search agents"
                      className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 shadow-sm focus:border-orange-400 focus:outline-none"
                    />
                  </div>
                  {agentTableFilters.activeCount > 0 && (
                    <button type="button" onClick={agentTableFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
                      Clear {agentTableFilters.activeCount} filter{agentTableFilters.activeCount > 1 ? "s" : ""}
                    </button>
                  )}
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-center text-xs">
                    <thead>
                      <tr className="sticky top-0 z-10 bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-white">
                        <FilterSortTh label="Agent" columnKey="agent" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="rounded-l-lg px-2 py-2 text-left font-bold text-white" />
                        <FilterSortTh label="TL" columnKey="tl" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="AM" columnKey="am" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="Vintage" columnKey="vintage" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="Calls" columnKey="calls" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="Conn %" columnKey="connectedPct" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="Sales" columnKey="saleCount" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="Revenue" columnKey="revenue" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="Target" columnKey="target" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="Ach %" columnKey="achPct" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="Stage" columnKey="stage" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="px-2 py-2 font-bold text-white" />
                        <FilterSortTh label="Avg Talk" columnKey="talk" sortKey={tableSort.sortKey} sortDir={tableSort.sortDir} onSort={tableSort.toggleSort} filters={agentTableFilters} className="rounded-r-lg px-2 py-2 font-bold text-white" />
                      </tr>
                    </thead>
                    <tbody>
                      {tableSort.sorted.map((r, i) => (
                        <tr
                          key={r.agent} role="button" tabIndex={0}
                          onClick={() => openEntity(r.agent, r.pred)} onKeyDown={(e) => { if (e.key === "Enter") openEntity(r.agent, r.pred); }}
                          className={`cursor-pointer transition-colors hover:bg-orange-50 ${i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}`}
                        >
                          <td className="px-2 py-1.5 text-left font-semibold text-orange-700">{r.agent}</td>
                          <td className="px-2 py-1.5 text-slate-500">{r.tl}</td>
                          <td className="px-2 py-1.5 text-slate-500">{r.am}</td>
                          <td className="px-2 py-1.5 text-slate-500">{r.vintage}</td>
                          <td className="px-2 py-1.5 text-slate-600">{int(r.m.calls)}</td>
                          <td className="px-2 py-1.5 font-semibold text-sky-700">{r.m.connectedPct}%</td>
                          <td className="px-2 py-1.5 text-slate-700">{int(r.m.saleCount)}</td>
                          <td className="px-2 py-1.5 font-bold text-emerald-700">{formatINR(r.m.revenue)}</td>
                          <td className="px-2 py-1.5 text-slate-600">{r.m.monthlyTarget > 0 ? formatINR(r.m.monthlyTarget) : "—"}</td>
                          <td className={`px-2 py-1.5 font-bold ${pctTone(r.m.achPct, r.m.monthlyTarget > 0)}`}>{r.m.monthlyTarget > 0 ? `${r.m.achPct}%` : "—"}</td>
                          <td className="px-2 py-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STAGE_BADGE[stageOf(r.m.achPct, r.m.monthlyTarget > 0)]}`}>{stageOf(r.m.achPct, r.m.monthlyTarget > 0)}</span>
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">{r.m.avgTalkSec > 0 ? fmtHms(r.m.avgTalkSec) : "—"}</td>
                        </tr>
                      ))}
                      {tableSort.sorted.length === 0 && <tr><td colSpan={12} className="py-6 text-center text-slate-400">No agents match.</td></tr>}
                    </tbody>
                    {tableSort.sorted.length > 0 && (() => {
                      const t = sumTotals(tableSort.sorted.map((r) => r.m));
                      return (
                        <tfoot>
                          <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-slate-800">
                            <td className="px-2 py-2 text-left">Total ({tableSort.sorted.length} agents)</td>
                            <td className="px-2 py-2" />
                            <td className="px-2 py-2" />
                            <td className="px-2 py-2" />
                            <td className="px-2 py-2">{int(t.calls)}</td>
                            <td className="px-2 py-2 text-sky-700">{t.connectedPct}%</td>
                            <td className="px-2 py-2">{int(t.saleCount)}</td>
                            <td className="px-2 py-2 text-emerald-700">{formatINR(t.revenue)}</td>
                            <td className="px-2 py-2">{t.monthlyTarget > 0 ? formatINR(t.monthlyTarget) : "—"}</td>
                            <td className={`px-2 py-2 ${pctTone(t.achPct, t.monthlyTarget > 0)}`}>{t.monthlyTarget > 0 ? `${t.achPct}%` : "—"}</td>
                            <td className="px-2 py-2" />
                            <td className="px-2 py-2 text-slate-400">—</td>
                          </tr>
                        </tfoot>
                      );
                    })()}
                  </table>
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        <SectionCard icon={Lightbulb} title="Key Insights" tone="amber" footnote={dataNote}>
          {insights.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">Not enough data in this selection.</p> : (
            <ul className="space-y-2.5">
              {insights.map((i) => (
                <li key={i.text} className="flex items-start gap-2 text-xs leading-snug text-slate-600">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i.tone}`} />
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {activeOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Active agents">
          <button type="button" aria-label="Close" onClick={() => setActiveOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" />
          <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-orange-600 via-amber-600 to-orange-700 px-5 py-4 text-white">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">Housing Owner · Active agents</p>
                <h3 className="text-lg font-bold">{activeAgentFilters.filtered.length}{activeAgentFilters.activeCount > 0 ? ` of ${activeAgents.length}` : ""} active agents</h3>
                <p className="mt-0.5 text-[11px] text-white/80">{formatShortDate(range.from)} to {formatShortDate(range.to)} · click an agent for their week-wise and date-wise details</p>
              </div>
              <div className="flex items-center gap-2">
                {activeAgentFilters.activeCount > 0 && (
                  <button type="button" onClick={activeAgentFilters.clearAll} className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-white/25">
                    Clear {activeAgentFilters.activeCount} filter{activeAgentFilters.activeCount > 1 ? "s" : ""}
                  </button>
                )}
                <TableExcelIconButton
                  fileBase="Housing_Owner_active_agents"
                  getSheets={() => [{
                    name: "Active agents",
                    columns: ["Agent", "TL", "AM", "Vintage", "Calls", "Connected", "Conn %", "Sales", "Revenue", "Target", "Ach %", "Avg Talk"],
                    rows: [
                      ...activeAgents.map((a) => [a.agent, a.tl, a.am, a.vintage, a.m.calls, a.m.connected, `${a.m.connectedPct}%`, a.m.saleCount, Math.round(a.m.revenue), Math.round(a.m.monthlyTarget), a.m.monthlyTarget > 0 ? `${a.m.achPct}%` : "—", a.m.avgTalkSec > 0 ? fmtHms(a.m.avgTalkSec) : "—"]),
                      ...(activeAgents.length > 0 ? (() => {
                        const t = sumTotals(activeAgents.map((a) => a.m));
                        const connected = activeAgents.reduce((s, a) => s + a.m.connected, 0);
                        return [["Total", "", "", "", t.calls, connected, `${t.connectedPct}%`, t.saleCount, Math.round(t.revenue), Math.round(t.monthlyTarget), t.monthlyTarget > 0 ? `${t.achPct}%` : "—", "—"]];
                      })() : []),
                    ],
                  }]}
                />
                <button type="button" onClick={() => setActiveOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-white/85 hover:bg-white/15"><X className="h-5 w-5" /></button>
              </div>
            </header>
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-center text-xs">
                <thead>
                  <tr className="sticky top-0 z-10 bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-white">
                    {["Agent", "TL", "AM", "Vintage", "Calls", "Conn %", "Sales", "Revenue", "Target", "Ach %"].map((h, i) => <th key={h} className={`whitespace-nowrap px-2 py-2 font-bold text-white ${i === 0 ? "rounded-l-lg text-left" : ""} ${i === 9 ? "rounded-r-lg" : ""}`}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {activeAgents.map((a, i) => (
                    <tr key={a.agent} role="button" tabIndex={0} onClick={() => { setActiveOpen(false); openEntity(a.agent, a.pred); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { setActiveOpen(false); openEntity(a.agent, a.pred); } }}
                      className={`cursor-pointer transition-colors hover:bg-orange-50 ${i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}`}>
                      <td className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-orange-700">{a.agent}</td>
                      <td className="px-2 py-1.5 text-slate-500">{a.tl}</td>
                      <td className="px-2 py-1.5 text-slate-500">{a.am}</td>
                      <td className="px-2 py-1.5 text-slate-500">{a.vintage}</td>
                      <td className="px-2 py-1.5 text-slate-600">{int(a.m.calls)}</td>
                      <td className="px-2 py-1.5 font-semibold text-sky-700">{a.m.calls > 0 ? `${a.m.connectedPct}%` : "—"}</td>
                      <td className="px-2 py-1.5 text-slate-700">{int(a.m.saleCount)}</td>
                      <td className="px-2 py-1.5 font-bold text-emerald-700">{formatINR(a.m.revenue)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{a.m.monthlyTarget > 0 ? formatINR(a.m.monthlyTarget) : "—"}</td>
                      <td className={`px-2 py-1.5 font-bold ${pctTone(a.m.achPct, a.m.monthlyTarget > 0)}`}>{a.m.monthlyTarget > 0 ? `${a.m.achPct}%` : "—"}</td>
                    </tr>
                  ))}
                  {activeAgents.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-slate-400">None</td></tr>}
                </tbody>
                {activeAgents.length > 0 && (() => {
                  const t = sumTotals(activeAgents.map((a) => a.m));
                  return (
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-slate-800">
                        <td className="whitespace-nowrap px-2 py-2 text-left">Total ({activeAgents.length} agents)</td>
                        <td className="px-2 py-2" />
                        <td className="px-2 py-2" />
                        <td className="px-2 py-2" />
                        <td className="px-2 py-2">{int(t.calls)}</td>
                        <td className="px-2 py-2 text-sky-700">{t.connectedPct}%</td>
                        <td className="px-2 py-2">{int(t.saleCount)}</td>
                        <td className="px-2 py-2 text-emerald-700">{formatINR(t.revenue)}</td>
                        <td className="px-2 py-2">{t.monthlyTarget > 0 ? formatINR(t.monthlyTarget) : "—"}</td>
                        <td className={`px-2 py-2 ${pctTone(t.achPct, t.monthlyTarget > 0)}`}>{t.monthlyTarget > 0 ? `${t.achPct}%` : "—"}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </aside>
        </div>
      )}

      {drawer && (
        <GncDetailDrawer
          title={drawer.title} eyebrow="Housing Owner · Week-wise & Date-wise"
          gradient="from-orange-600 via-amber-600 to-orange-700"
          series={drawer.series} dailyRows={drawer.dailyRows} weeklyRows={drawer.weeklyRows}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
