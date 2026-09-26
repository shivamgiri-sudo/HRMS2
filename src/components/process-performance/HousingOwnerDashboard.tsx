import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Home, PhoneCall, PhoneOutgoing, PhoneOff, Percent, ShoppingBag, IndianRupee, Wallet, Target, TrendingUp,
  Timer, Users, Lightbulb, Eye, RefreshCw, Layers, ArrowUp, ArrowDown, Search, ClipboardList, Award, PieChart as PieIcon, Filter, Check,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Spinner, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  currentMonthRange, formatINR, formatShortDate,
  KPI_TONES, type KpiTone, type ExportSlide,
} from "./DashboardKit";
import { GncDetailDrawer, type DrawerSeries } from "./GncAbandonCartDetailDrawer";
import { useSortableRows } from "./useSortableRows";
import { SortTh } from "./SortTh";

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
  return {
    ...d,
    hasData: t.calls > 0 || t.saleCount > 0,
    monthlyTarget: monthly,
    achPct: monthly > 0 ? r1((t.revenue / monthly) * 100) : 0,
    mtdTarget,
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

interface MatrixCol { key: string; label: string; m: M; onClick: () => void }

function MetricMatrix({ columns, total, firstColLabel = "Metric" }: { columns: MatrixCol[]; total?: MatrixCol; firstColLabel?: string }) {
  const all = total ? [...columns, total] : columns;
  if (columns.length === 0) return <p className="py-6 text-center text-xs text-slate-400">No data for the current selection.</p>;
  return (
    <div className="overflow-x-auto">
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
    return { cdr: data.cdr, sales: data.sales, roster: data.roster, dataTo: last ?? data.to };
  }, [data]);

  /* Filter options: AM -> TL -> Agent narrow each other; Vintage is independent. */
  const people = useMemo(() => {
    const m = new Map<string, Who>();
    for (const r of ctx?.roster ?? []) m.set(r.name, { agent: r.name, tl: r.tl, am: r.am, vintage: r.vintage });
    for (const r of ctx?.cdr ?? []) if (!m.has(r.agent)) m.set(r.agent, r);
    for (const r of ctx?.sales ?? []) if (!m.has(r.agent)) m.set(r.agent, r);
    return [...m.values()];
  }, [ctx]);
  const amOptions = useMemo(() => [...new Set(people.map((p) => p.am))].sort(), [people]);
  const tlOptions = useMemo(() => [...new Set(people.filter((p) => am === "all" || p.am === am).map((p) => p.tl))].sort(), [people, am]);
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

  const topAgents = useMemo(
    () => [...agentRows].sort((a, b) => {
      const va = agentSort === "saleCount" ? a.m.saleCount : agentSort === "calls" ? a.m.calls : a.m.revenue;
      const vb = agentSort === "saleCount" ? b.m.saleCount : agentSort === "calls" ? b.m.calls : b.m.revenue;
      return vb - va;
    }).slice(0, 10).map((r) => ({ name: r.agent.replace(/\s+MCN$/i, ""), full: r.agent, calls: r.m.calls, connected: r.m.connected, saleCount: r.m.saleCount, revenue: r.m.revenue, pred: r.pred })),
    [agentRows, agentSort],
  );

  const tableRows = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    return q ? agentRows.filter((r) => r.agent.toLowerCase().includes(q)) : agentRows;
  }, [agentRows, agentSearch]);
  const tableSort = useSortableRows(tableRows, (r, key) => {
    switch (key) {
      case "agent": return r.agent;
      case "tl": return r.tl;
      case "am": return r.am;
      case "vintage": return r.vintage;
      case "calls": return r.m.calls;
      case "connectedPct": return r.m.connectedPct;
      case "saleCount": return r.m.saleCount;
      case "revenue": return r.m.revenue;
      case "achPct": return r.m.monthlyTarget > 0 ? r.m.achPct : null;
      case "talk": return r.m.avgTalkSec;
      default: return null;
    }
  });

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
          title: "Agent Productivity",
          columns: ["Agent", "TL", "AM", "Vintage", "Calls", "Connected %", "Sale Count", "Revenue", "Ach %", "Avg Talk"],
          rows: agentRows.map((r) => [r.agent, r.tl, r.am, r.vintage, int(r.m.calls), `${r.m.connectedPct}%`, r.m.saleCount, formatINR(r.m.revenue), r.m.monthlyTarget > 0 ? `${r.m.achPct}%` : "—", r.m.avgTalkSec > 0 ? fmtHms(r.m.avgTalkSec) : "—"]),
        },
      ],
    }];
  }, [cur, amCols, vintageCols, tlCols, agentRows]);

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
  const dataNote = `Call data through ${data.cdrThrough ? formatShortDate(data.cdrThrough) : "—"} · Sale data through ${data.saleThrough ? formatShortDate(data.saleThrough) : "—"}`;
  const targetSub = cur.monthlyTarget > 0 ? `Target ${formatINR(cur.monthlyTarget)}` : "No target set";

  return (
    <div className="space-y-3">
      <DashboardHero<"outbound">
        icon={Home} eyebrow="Housing Owner · Calls • Sales • Revenue • Team Performance" title="Outbound Performance Dashboard"
        tabs={[{ key: "outbound", label: "Outbound" }]} activeTab="outbound" onTabChange={() => {}}
        gradient="from-orange-600 via-amber-600 to-orange-700"
      />
      {toolbar}
      {filterBar}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {/* KPI row -- every card opens its own week/date drill-down */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-9">
        <StatTile icon={PhoneCall} tone="amber" label="Total Calls" value={int(cur.calls)} sub={prev?.hasData ? `vs previous ${int(prev.calls)}` : undefined} delta={pctDelta(cur.calls, prev?.calls)} onClick={() => openOverall("Total Calls", [S.calls])} />
        <StatTile icon={PhoneOutgoing} tone="sky" label="Connected Calls" value={int(cur.connected)} sub={prev?.hasData ? `vs previous ${int(prev.connected)}` : undefined} delta={pctDelta(cur.connected, prev?.connected)} onClick={() => openOverall("Connected Calls", [S.connected])} />
        <StatTile icon={PhoneOff} tone="rose" label="Not Connected Calls" value={int(cur.notConnected)} sub={prev?.hasData ? `vs previous ${int(prev.notConnected)}` : undefined} delta={pctDelta(cur.notConnected, prev?.notConnected)} onClick={() => openOverall("Not Connected Calls", [S.notConnected])} />
        <StatTile icon={Percent} tone="indigo" label="Connected %" value={`${cur.connectedPct}%`} sub={prev?.hasData ? `vs previous ${prev.connectedPct}%` : undefined} delta={ppDelta(cur.connectedPct, prev?.connectedPct)} deltaUnit="pp" onClick={() => openOverall("Connected %", [S.connectedPct, S.calls, S.connected])} />
        <StatTile icon={ShoppingBag} tone="emerald" label="Sale Count" value={int(cur.saleCount)} sub={prev?.hasData ? `vs previous ${int(prev.saleCount)}` : undefined} delta={pctDelta(cur.saleCount, prev?.saleCount)} onClick={() => openOverall("Sale Count", [S.saleCount])} />
        <StatTile icon={IndianRupee} tone="teal" label="Revenue Achieved" value={formatINR(cur.revenue)} sub={prev?.hasData ? `vs previous ${formatINR(prev.revenue)}` : undefined} delta={pctDelta(cur.revenue, prev?.revenue)} onClick={() => openOverall("Revenue Achieved", [S.revenue])} />
        <StatTile icon={Wallet} tone="cyan" label="AOV" value={cur.saleCount > 0 ? formatINR(cur.aov) : "—"} sub={prev?.hasData && prev.saleCount > 0 ? `vs previous ${formatINR(prev.aov)}` : undefined} delta={pctDelta(cur.aov, prev?.aov)} onClick={() => openOverall("AOV (Average Order Value)", [S.aov, S.saleCount, S.revenue])} />
        <StatTile icon={Target} tone="violet" label="Ach %" value={cur.monthlyTarget > 0 ? `${cur.achPct}%` : "—"} sub={targetSub} delta={cur.monthlyTarget > 0 ? ppDelta(cur.achPct, prev?.achPct) : null} deltaUnit="pp" onClick={() => openOverall("Ach % (vs daily share of monthly target)", [S.achPct, S.revenue])} />
        <StatTile icon={Target} tone="blue" label="MTD Ach %" value={cur.mtdTarget > 0 ? `${cur.mtdPct}%` : "—"} sub={cur.mtdTarget > 0 ? `MTD target ${formatINR(cur.mtdTarget)}` : "No target set"} delta={cur.mtdTarget > 0 ? ppDelta(cur.mtdPct, prev?.mtdPct) : null} deltaUnit="pp" onClick={() => openOverall("MTD Ach % (month-to-date revenue / target prorated to date)", [S.revenue, S.achPct])} />
      </div>

      {/* Call status + Daily performance */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard
          icon={PieIcon} title="Call Status Distribution" tone="amber"
          action={<ViewDetailsBtn onClick={() => openOverall("Call Status Distribution", [S.connected, S.notConnected, S.connectedPct])} />}
        >
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
            icon={Award} title={agentView === "chart" ? "Agent Productivity (Top 10)" : `Agent-wise Performance (${tableRows.length}${agentSearch.trim() ? ` of ${agentRows.length}` : ""} agents)`} tone="emerald"
            action={
              <div className="flex items-center gap-2">
                {agentView === "chart" && (
                  <MiniSelect
                    label="Rank by" value={agentSort} onChange={(v) => setAgentSort(v)}
                    options={[{ key: "saleCount", label: "Sale Count" }, { key: "calls", label: "Total Calls" }, { key: "revenue", label: "Revenue" }]}
                  />
                )}
                <Seg value={agentView} onChange={(v) => setAgentView(v)} options={[{ key: "chart", label: "Top 10" }, { key: "table", label: "All agents" }]} />
              </div>
            }
            footnote={agentView === "chart" ? "Click a bar for that agent's week-wise and date-wise breakdown, or switch to All agents for the full table." : undefined}
          >
            {agentView === "chart" ? (
              topAgents.length === 0 ? <p className="py-16 text-center text-xs text-slate-400">No agent activity in this range.</p> : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={topAgents} margin={{ top: 4, right: 8, left: -8, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-28} textAnchor="end" height={54} />
                    <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} />
                    <Tooltip {...TOOLTIP_PROPS} labelFormatter={(_, p) => String((p?.[0]?.payload as { full?: string })?.full ?? "")} formatter={(v: number, n: string) => (n === "Revenue" ? formatINR(v) : int(v))} />
                    <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="l" dataKey="calls" name="Total Calls" fill={COLORS.calls} radius={[3, 3, 0, 0]} maxBarSize={20} cursor="pointer"
                      onClick={(d: { payload?: { full: string; pred: Pred } }) => { if (d?.payload) openEntity(d.payload.full, d.payload.pred); }} />
                    <Bar yAxisId="l" dataKey="connected" name="Connected Calls" fill={COLORS.connected} radius={[3, 3, 0, 0]} maxBarSize={20} cursor="pointer"
                      onClick={(d: { payload?: { full: string; pred: Pred } }) => { if (d?.payload) openEntity(d.payload.full, d.payload.pred); }} />
                    <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sale Count" stroke={COLORS.sale} strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )
            ) : (
              <div>
                <div className="relative mb-2 w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Search agent..." aria-label="Search agents"
                    className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 shadow-sm focus:border-orange-400 focus:outline-none"
                  />
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-center text-xs">
                    <thead>
                      <tr className="sticky top-0 z-10 bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-white">
                        <SortTh label="Agent" sortKey="agent" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="rounded-l-lg px-2 py-2 text-left font-bold text-white" />
                        <SortTh label="TL" sortKey="tl" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="px-2 py-2 font-bold text-white" />
                        <SortTh label="AM" sortKey="am" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="px-2 py-2 font-bold text-white" />
                        <SortTh label="Vintage" sortKey="vintage" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="px-2 py-2 font-bold text-white" />
                        <SortTh label="Calls" sortKey="calls" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="px-2 py-2 font-bold text-white" />
                        <SortTh label="Conn %" sortKey="connectedPct" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="px-2 py-2 font-bold text-white" />
                        <SortTh label="Sales" sortKey="saleCount" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="px-2 py-2 font-bold text-white" />
                        <SortTh label="Revenue" sortKey="revenue" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="px-2 py-2 font-bold text-white" />
                        <SortTh label="Ach %" sortKey="achPct" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="px-2 py-2 font-bold text-white" />
                        <SortTh label="Avg Talk" sortKey="talk" activeKey={tableSort.sortKey} dir={tableSort.sortDir} onSort={tableSort.toggleSort} className="rounded-r-lg px-2 py-2 font-bold text-white" />
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
                          <td className={`px-2 py-1.5 font-bold ${pctTone(r.m.achPct, r.m.monthlyTarget > 0)}`}>{r.m.monthlyTarget > 0 ? `${r.m.achPct}%` : "—"}</td>
                          <td className="px-2 py-1.5 text-slate-600">{r.m.avgTalkSec > 0 ? fmtHms(r.m.avgTalkSec) : "—"}</td>
                        </tr>
                      ))}
                      {tableRows.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-slate-400">No agents match.</td></tr>}
                    </tbody>
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
