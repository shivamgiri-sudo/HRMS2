import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  IndianRupee, ShoppingBag, PhoneCall, PhoneIncoming, Percent, Timer, Target, TrendingUp, TrendingDown,
  CalendarDays, Search, X, Users, Award, ClipboardList,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DashboardExportMenu, KPI_TONES, type KpiTone, type ExportSlide } from "./DashboardKit";
import { useSortableRows } from "./useSortableRows";
import { SortTh } from "./SortTh";

interface Headline {
  totalRevenue: number;
  totalSaleCount: number;
  aov: number;
  totalCalls: number;
  connectedCalls: number;
  notConnectedCalls: number;
  connectedPct: number;
  avgTalkTimeSec: number;
  activeAgents: number;
  totalTarget: number;
  totalMtdReported: number;
  achievementPct: number;
  revenuePerAgent: number;
}

interface GroupRow {
  name: string;
  totalCalls: number;
  connectedCalls: number;
  connectedPct: number;
  revenue: number;
  saleCount: number;
  target: number;
  achievementPct: number;
  aov: number;
  agentCount: number;
  rpa: number;
  tqCount: number;
  mqCount: number;
  bqCount: number;
}

interface AgentRow {
  empId: string | null;
  name: string;
  tlName: string;
  am: string;
  doj: string | null;
  bucket: string | null;
  status: string;
  target: number;
  mtdReported: number;
  totalCalls: number;
  connectedCalls: number;
  notConnectedCalls: number;
  connectedPct: number;
  avgTalkTimeSec: number;
  saleCount: number;
  revenue: number;
  achievementPct: number;
  stage: "TQ" | "MQ" | "BQ" | "NA";
}

interface FilterOptions {
  tls: string[];
  ams: string[];
  tlByAm: Record<string, string[]>;
}

interface DashboardData {
  filterOptions: FilterOptions;
  headline: Headline;
  byAm: GroupRow[];
  byTl: GroupRow[];
  agents: AgentRow[];
  topPerformers: AgentRow[];
  bottomPerformers: AgentRow[];
  packageTypeBreakdown: { packageType: string; count: number; revenue: number }[];
  dailyTrend: { date: string; revenue: number; saleCount: number; totalCalls: number; connectedCalls: number }[];
}

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
const formatSecs = (s: number) => {
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}h ${m}m ${sec}s`;
};
const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

/** Local YYYY-MM-DD, deliberately NOT via toISOString(): that converts
 * through UTC and rolls the date back a day for a viewer ahead of UTC
 * (e.g. IST, UTC+5:30) — midnight local time becomes the previous day's
 * evening in UTC. Same fix already applied to the Bellavita dashboard. */
function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 1st of the current month .. today — same default the backend falls
 * back to on its own, kept in sync so the pickers show what's actually
 * being queried on first load rather than an empty/different range. */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = localDateStr(now);
  return { from, to };
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-500" />
    </div>
  );
}

/** Same "day-of-month 1-7 -> W-1, 8-14 -> W-2, ..." convention this app's
 * other week-wise tables/exports already use (see satyaReportModel.weekOf).
 * Keyed by month too, so a range spanning more than one month never merges
 * two different months' "W-1" into one bucket. */
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

function KpiCard({
  icon: Icon, label, value, sub, tone,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone: KpiTone }) {
  const t = KPI_TONES[tone];
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-100 bg-white p-2.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className={`absolute inset-x-0 top-0 h-1 ${t.accent}`} />
      <div className={`mb-1.5 inline-flex rounded-lg p-1.5 ${t.badge}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className={`text-base font-bold leading-tight tracking-tight ${t.value}`}>{value}</p>
      <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500" title={label}>{label}</p>
      {sub && <p className="truncate text-[9px] text-slate-400" title={sub}>{sub}</p>}
    </div>
  );
}

function StageBadge({ stage }: { stage: AgentRow["stage"] }) {
  const styles: Record<AgentRow["stage"], string> = {
    TQ: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    MQ: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    BQ: "bg-red-50 text-red-700 ring-1 ring-red-200",
    NA: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${styles[stage]}`}>{stage}</span>;
}

/** Same TQ/MQ/BQ thresholds stageFor() uses server-side (>=80 / >=50 / below) —
 * a colored pill instead of a badge letter, for tables that show the raw %. */
function AchBadge({ pct, hasTarget }: { pct: number; hasTarget: boolean }) {
  if (!hasTarget) return <span className="text-slate-300">—</span>;
  const cls = pct >= 80 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    : pct >= 50 ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
    : "bg-red-50 text-red-700 ring-1 ring-red-200";
  return <span className={`inline-block min-w-[46px] rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{pct.toFixed(0)}%</span>;
}

function ConnBadge({ pct }: { pct: number }) {
  return <span className="inline-block min-w-[52px] rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200">{pct.toFixed(1)}%</span>;
}

/** Colored icon + title strip shared by every table card on this page, so
 * each block reads at a glance (AM=blue, TL=violet, Top=emerald, Bottom=red). */
function TableCardHeader({
  icon: Icon, title, tone,
}: { icon: React.ComponentType<{ className?: string }>; title: string; tone: KpiTone }) {
  const t = KPI_TONES[tone];
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${t.badge}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <p className="text-sm font-bold text-slate-800">{title}</p>
    </div>
  );
}

function GroupTable({
  title, rows, icon, tone, onRowClick,
}: { title: string; rows: GroupRow[]; icon: React.ComponentType<{ className?: string }>; tone: KpiTone; onRowClick: (name: string) => void }) {
  const sort = useSortableRows<GroupRow>(rows, (r, key) => {
    switch (key) {
      case "name": return r.name;
      case "totalCalls": return r.totalCalls;
      case "connectedPct": return r.connectedPct;
      case "saleCount": return r.saleCount;
      case "revenue": return r.revenue;
      case "aov": return r.aov;
      case "rpa": return r.rpa;
      case "target": return r.target;
      case "achievementPct": return r.achievementPct;
      case "tqCount": return r.tqCount;
      case "mqCount": return r.mqCount;
      case "bqCount": return r.bqCount;
      default: return null;
    }
  });
  const totals = rows.reduce((acc, r) => ({
    totalCalls: acc.totalCalls + r.totalCalls,
    connectedCalls: acc.connectedCalls + r.connectedCalls,
    saleCount: acc.saleCount + r.saleCount,
    revenue: acc.revenue + r.revenue,
    agentCount: acc.agentCount + r.agentCount,
    target: acc.target + r.target,
    tqCount: acc.tqCount + r.tqCount,
    mqCount: acc.mqCount + r.mqCount,
    bqCount: acc.bqCount + r.bqCount,
  }), { totalCalls: 0, connectedCalls: 0, saleCount: 0, revenue: 0, agentCount: 0, target: 0, tqCount: 0, mqCount: 0, bqCount: 0 });
  const totalConnectedPct = totals.totalCalls > 0 ? (totals.connectedCalls / totals.totalCalls) * 100 : 0;
  const totalAchievementPct = totals.target > 0 ? (totals.revenue / totals.target) * 100 : 0;
  const totalAov = totals.saleCount > 0 ? totals.revenue / totals.saleCount : 0;
  const totalRpa = totals.agentCount > 0 ? totals.revenue / totals.agentCount : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <TableCardHeader icon={icon} title={title} tone={tone} />
      <div className="overflow-x-auto">
        <table className="w-full text-center text-xs">
          <thead>
            <tr className="bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-white">
              <SortTh label="Name" sortKey="name" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="sticky left-0 z-20 rounded-l-lg border-r border-slate-700 bg-slate-800 py-2.5 px-2 font-bold shadow-[2px_0_6px_-2px_rgba(0,0,0,0.25)]" />
              <SortTh label="Calls" sortKey="totalCalls" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold" />
              <SortTh label="Connected%" sortKey="connectedPct" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold" />
              <SortTh label="Sale Count" sortKey="saleCount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold" />
              <SortTh label="Revenue" sortKey="revenue" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold" />
              <SortTh label="AOV" sortKey="aov" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold" />
              <SortTh label="RPA" sortKey="rpa" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold" />
              <SortTh label="Target" sortKey="target" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold" />
              <SortTh label="Ach%" sortKey="achievementPct" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold" />
              <SortTh label="TQ" sortKey="tqCount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold text-emerald-300" />
              <SortTh label="MQ" sortKey="mqCount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="py-2.5 px-2 font-bold text-amber-300" />
              <SortTh label="BQ" sortKey="bqCount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.toggleSort} className="rounded-r-lg py-2.5 px-2 font-bold text-red-300" />
            </tr>
          </thead>
          <tbody>
            {sort.sorted.map((r, i) => (
              <tr
                key={r.name} onClick={() => onRowClick(r.name)} role="button" tabIndex={0}
                className={`cursor-pointer transition-colors hover:bg-blue-50/60 ${i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}`}
              >
                <td className={`sticky left-0 z-10 border-r border-slate-100 py-2.5 px-2 font-semibold text-blue-700 underline-offset-2 hover:underline ${i % 2 === 1 ? "bg-slate-50" : "bg-white"}`}>{r.name}</td>
                <td className="py-2.5 px-2 text-slate-600">{r.totalCalls.toLocaleString("en-IN")}</td>
                <td className="py-2.5 px-2"><ConnBadge pct={r.connectedPct} /></td>
                <td className="py-2.5 px-2 text-slate-600">{r.saleCount}</td>
                <td className="py-2.5 px-2 font-bold text-emerald-700">{formatINR(r.revenue)}</td>
                <td className="py-2.5 px-2 text-slate-600">{formatINR(r.aov)}</td>
                <td className="py-2.5 px-2 text-slate-600">{formatINR(r.rpa)}</td>
                <td className="py-2.5 px-2 text-slate-500">{r.target > 0 ? formatINR(r.target) : "—"}</td>
                <td className="py-2.5 px-2"><AchBadge pct={r.achievementPct} hasTarget={r.target > 0} /></td>
                <td className="py-2.5 px-2 font-bold text-emerald-600">{r.tqCount}</td>
                <td className="py-2.5 px-2 font-bold text-amber-600">{r.mqCount}</td>
                <td className="py-2.5 px-2 font-bold text-red-600">{r.bqCount}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={12} className="py-6 text-center text-slate-400">No data.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-100 text-[13px] font-bold text-slate-800">
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-100 py-2.5 px-2">Total</td>
                <td className="py-2.5 px-2">{totals.totalCalls.toLocaleString("en-IN")}</td>
                <td className="py-2.5 px-2"><ConnBadge pct={totalConnectedPct} /></td>
                <td className="py-2.5 px-2">{totals.saleCount.toLocaleString("en-IN")}</td>
                <td className="py-2.5 px-2 text-emerald-700">{formatINR(totals.revenue)}</td>
                <td className="py-2.5 px-2 text-slate-600">{formatINR(totalAov)}</td>
                <td className="py-2.5 px-2 text-slate-600">{formatINR(totalRpa)}</td>
                <td className="py-2.5 px-2 text-slate-600">{totals.target > 0 ? formatINR(totals.target) : "—"}</td>
                <td className="py-2.5 px-2"><AchBadge pct={totalAchievementPct} hasTarget={totals.target > 0} /></td>
                <td className="py-2.5 px-2 text-emerald-700">{totals.tqCount}</td>
                <td className="py-2.5 px-2 text-amber-700">{totals.mqCount}</td>
                <td className="py-2.5 px-2 text-red-700">{totals.bqCount}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function PerformerTable({
  title, rows, icon, tone, onRowClick,
}: { title: string; rows: AgentRow[]; icon: React.ComponentType<{ className?: string }>; tone: KpiTone; onRowClick: (name: string) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <TableCardHeader icon={icon} title={title} tone={tone} />
      <div className="overflow-x-auto">
        <table className="w-full text-center text-xs">
          <thead>
            <tr className="bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-white">
              <th className="rounded-l-lg py-2.5 px-2 font-bold">Agent</th>
              <th className="py-2.5 px-2 font-bold">TL</th>
              <th className="py-2.5 px-2 font-bold">Revenue</th>
              <th className="rounded-r-lg py-2.5 px-2 font-bold">Ach%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.name} onClick={() => onRowClick(r.name)} role="button" tabIndex={0}
                className={`cursor-pointer transition-colors hover:bg-blue-50/60 ${i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}`}
              >
                <td className="py-2.5 px-2 font-semibold text-blue-700 underline-offset-2 hover:underline">{r.name}</td>
                <td className="py-2.5 px-2 text-slate-500">{r.tlName}</td>
                <td className="py-2.5 px-2 font-bold text-emerald-700">{formatINR(r.revenue)}</td>
                <td className="py-2.5 px-2"><AchBadge pct={r.achievementPct} hasTarget /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface EntityTrendRow {
  date: string; totalCalls: number; connectedCalls: number; connectedPct: number;
  saleCount: number; revenue: number; cumulativeRevenue: number; dayTarget: number; achievementPct: number;
}
interface EntityTrendData {
  entityType: "am" | "tl" | "agent"; entityName: string; from: string; to: string; target: number;
  headline: {
    totalCalls: number; connectedCalls: number; connectedPct: number;
    saleCount: number; revenue: number; achievementPct: number; avgTalkTimeSec: number;
  };
  dailyTrend: EntityTrendRow[];
}

/**
 * Drill-down drawer for any AM/TL/agent row across this dashboard's tables —
 * fetches its own day-wise breakdown from a dedicated endpoint (never reuses
 * the list payload), defaulting to the current month per the drill-down
 * mandate's "record detail" requirement.
 */
function EntityTrendDrawer({
  target, onClose,
}: { target: { type: "am" | "tl" | "agent"; name: string }; onClose: () => void }) {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<EntityTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"day" | "week">("day");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ type: target.type, name: target.name, from, to });
    hrmsApi.get<{ success: boolean; data: EntityTrendData }>(`/api/process-performance/housing-owner-dashboard/entity-trend?${qs.toString()}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load performance."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target.type, target.name, from, to]);

  const typeLabel = target.type === "am" ? "AM" : target.type === "tl" ? "TL" : "Agent";

  /** Week bucket sums straight off the already-fetched day rows -- no extra
   * fetch. Achievement % uses the same per-day fair-share target (dayTarget)
   * the day-wise chart uses, summed over the week, not revenue-to-date over
   * the full monthly target -- see dailyTrendWithAchievement's own comment
   * on why a cumulative ratio isn't a genuine per-period figure. */
  const weeklyTrend = useMemo(() => {
    const rows = data?.dailyTrend ?? [];
    const map = new Map<string, {
      label: string; totalCalls: number; connectedCalls: number; saleCount: number; revenue: number; weekTarget: number;
    }>();
    for (const d of rows) {
      const { key, label } = weekBucket(d.date);
      const cur = map.get(key) ?? { label, totalCalls: 0, connectedCalls: 0, saleCount: 0, revenue: 0, weekTarget: 0 };
      cur.totalCalls += d.totalCalls;
      cur.connectedCalls += d.connectedCalls;
      cur.saleCount += d.saleCount;
      cur.revenue += d.revenue;
      cur.weekTarget += d.dayTarget;
      map.set(key, cur);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({
      key,
      label: v.label,
      totalCalls: v.totalCalls,
      connectedPct: v.totalCalls > 0 ? Math.round((v.connectedCalls / v.totalCalls) * 1000) / 10 : 0,
      saleCount: v.saleCount,
      revenue: v.revenue,
      achievementPct: v.weekTarget > 0 ? Math.round((v.revenue / v.weekTarget) * 1000) / 10 : 0,
    }));
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-600">{typeLabel}</span>
            <h3 className="mt-1 text-base font-bold text-slate-800">{target.name}</h3>
            <p className="text-xs text-slate-400">Date-wise performance</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <CalendarDays className="h-4 w-4 text-slate-400" />
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm" />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" value={to} min={from} max={localDateStr(new Date())} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm" />
            <button
              type="button"
              onClick={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
            >
              This Month
            </button>
          </div>

          {loading && !data && <Spinner />}
          {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {data && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <KpiCard icon={ShoppingBag} label="Sale Count" value={data.headline.saleCount.toLocaleString("en-IN")} tone="sky" />
                <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(data.headline.revenue)} tone="emerald" />
                <KpiCard
                  icon={TrendingUp} label="Achievement %"
                  value={data.target > 0 ? `${data.headline.achievementPct.toFixed(1)}%` : "—"}
                  sub={data.target > 0 ? `vs ${formatINR(data.target)} target` : "no target set"}
                  tone="indigo"
                />
                <KpiCard icon={PhoneCall} label="Total Calls" value={data.headline.totalCalls.toLocaleString("en-IN")} tone="blue" />
                <KpiCard icon={Percent} label="Connected %" value={`${data.headline.connectedPct.toFixed(1)}%`} tone="cyan" />
                <KpiCard icon={Timer} label="Avg Talk Time" value={data.headline.avgTalkTimeSec > 0 ? formatSecs(data.headline.avgTalkTimeSec) : "—"} tone="amber" />
              </div>

              <div className="inline-flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button" onClick={() => setPeriod("day")}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${period === "day" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
                >
                  Day-wise
                </button>
                <button
                  type="button" onClick={() => setPeriod("week")}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${period === "week" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
                >
                  Week-wise
                </button>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <TableCardHeader icon={TrendingUp} title={period === "day" ? "Day-wise Revenue & Achievement %" : "Week-wise Revenue & Achievement %"} tone="indigo" />
                {(period === "day" ? data.dailyTrend.length : weeklyTrend.length) === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">No activity in this range.</div>
                ) : period === "day" ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data.dailyTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip
                        labelFormatter={(v: unknown) => formatShortDate(String(v))}
                        formatter={(value: number, name: string) => (name === "Achievement %" ? `${value}%` : formatINR(value))}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
                      <Line yAxisId="left" type="monotone" dataKey="dayTarget" name="Target" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="achievementPct" name="Achievement %" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={weeklyTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip
                        formatter={(value: number, name: string) => (name === "Achievement %" ? `${value}%` : formatINR(value))}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                      <Line yAxisId="right" type="monotone" dataKey="achievementPct" name="Achievement %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <TableCardHeader icon={ClipboardList} title={period === "day" ? "Day-wise Detail" : "Week-wise Detail"} tone="teal" />
                <div className="overflow-x-auto">
                  <table className="w-full text-center text-xs">
                    <thead>
                      <tr className="bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-white">
                        <th className="rounded-l-lg py-2.5 px-2 font-bold">{period === "day" ? "Date" : "Week"}</th>
                        <th className="py-2.5 px-2 font-bold">Calls</th>
                        <th className="py-2.5 px-2 font-bold">Connected%</th>
                        <th className="py-2.5 px-2 font-bold">Sale Count</th>
                        <th className="py-2.5 px-2 font-bold">Revenue</th>
                        <th className="rounded-r-lg py-2.5 px-2 font-bold">Achievement%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {period === "day" ? data.dailyTrend.map((d, i) => (
                        <tr key={d.date} className={i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}>
                          <td className="py-2 px-2 font-medium text-slate-700">{formatShortDate(d.date)}</td>
                          <td className="py-2 px-2 text-slate-600">{d.totalCalls.toLocaleString("en-IN")}</td>
                          <td className="py-2 px-2"><ConnBadge pct={d.connectedPct} /></td>
                          <td className="py-2 px-2 text-slate-600">{d.saleCount}</td>
                          <td className="py-2 px-2 font-bold text-emerald-700">{formatINR(d.revenue)}</td>
                          <td className="py-2 px-2"><AchBadge pct={d.achievementPct} hasTarget={data.target > 0} /></td>
                        </tr>
                      )) : weeklyTrend.map((w, i) => (
                        <tr key={w.key} className={i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}>
                          <td className="py-2 px-2 font-medium text-slate-700">{w.label}</td>
                          <td className="py-2 px-2 text-slate-600">{w.totalCalls.toLocaleString("en-IN")}</td>
                          <td className="py-2 px-2"><ConnBadge pct={w.connectedPct} /></td>
                          <td className="py-2 px-2 text-slate-600">{w.saleCount}</td>
                          <td className="py-2 px-2 font-bold text-emerald-700">{formatINR(w.revenue)}</td>
                          <td className="py-2 px-2"><AchBadge pct={w.achievementPct} hasTarget={data.target > 0} /></td>
                        </tr>
                      ))}
                      {(period === "day" ? data.dailyTrend.length : weeklyTrend.length) === 0 && (
                        <tr><td colSpan={6} className="py-6 text-center text-slate-400">No activity in this range.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Housing Owner dashboard, real data only — every figure is a live
 * aggregate over db_masmis.owner_sale, Owner_cdr and owner_agent_details
 * (via GET /api/process-performance/housing-owner-dashboard), joined
 * client-side by agent name since the three source tables use slightly
 * different name spellings for the same person. Layout mirrors the
 * reference "Dashboard" / "Agent Wise Performance" / "Top 5 Bottom 5"
 * sheets, but shows none of that file's own numbers -- only this app's
 * own uploaded data. owner_agent_details already carries real
 * monthly_target/mtd per agent, so Achievement% here is computed
 * genuinely (revenue / target), unlike Bellavita where no target
 * uploader exists.
 */
export function HousingOwnerDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tl, setTl] = useState("all");
  const [am, setAm] = useState("all");
  const [agentSearch, setAgentSearch] = useState("");
  const [drillTarget, setDrillTarget] = useState<{ type: "am" | "tl" | "agent"; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ from, to });
      if (tl !== "all") qs.set("tl", tl);
      if (am !== "all") qs.set("am", am);
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/housing-owner-dashboard?${qs.toString()}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Housing Owner dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to, tl, am]);

  useEffect(() => { void load(); }, [load]);

  const tlOptions = useMemo(() => {
    const opts = data?.filterOptions;
    if (!opts) return [];
    return am === "all" ? opts.tls : (opts.tlByAm[am] ?? []);
  }, [data, am]);

  /** AM is the parent of TL: picking an AM narrows the TL list and drops a TL that no longer belongs. */
  const changeAm = (next: string) => {
    setAm(next);
    if (next !== "all" && tl !== "all" && !(data?.filterOptions.tlByAm[next] ?? []).includes(tl)) setTl("all");
  };

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    const list = data?.agents ?? [];
    return q ? list.filter((a) => a.name.toLowerCase().includes(q) || (a.empId ?? "").toLowerCase().includes(q)) : list;
  }, [data, agentSearch]);

  const agentSort = useSortableRows<AgentRow>(filteredAgents, (a, key) => {
    switch (key) {
      case "name": return a.name;
      case "tlName": return a.tlName;
      case "am": return a.am;
      case "bucket": return a.bucket;
      case "status": return a.status;
      case "target": return a.target;
      case "totalCalls": return a.totalCalls;
      case "connectedPct": return a.connectedPct;
      case "avgTalkTimeSec": return a.avgTalkTimeSec;
      case "saleCount": return a.saleCount;
      case "revenue": return a.revenue;
      case "achievementPct": return a.achievementPct;
      case "stage": return a.stage;
      default: return null;
    }
  });

  /** Day-wise revenue plus that day's OWN achievement % -- this day's revenue
   * against this day's fair share of the monthly target (target / days in
   * that month). Deliberately not a cumulative running total: revenue-to-date
   * / target produces a smooth ramp climbing all month regardless of any
   * single day's actual performance, which looks like "achievement" but
   * isn't a per-day figure -- same fix applied to the entity-drawer chart's
   * backend computation (getHousingOwnerEntityTrend). */
  const dailyTrendWithAchievement = useMemo(() => {
    const target = data?.headline.totalTarget ?? 0;
    return (data?.dailyTrend ?? []).map((d) => {
      const [y, m] = d.date.slice(0, 7).split("-").map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const dayTarget = target > 0 ? Math.round(target / daysInMonth) : 0;
      return {
        ...d,
        dayTarget,
        achievementPct: dayTarget > 0 ? Math.round((d.revenue / dayTarget) * 1000) / 10 : 0,
      };
    });
  }, [data]);

  /** Single export slide for "Download Snap"/"Download Excel" — this
   * dashboard has no tabs, so the whole page's KPIs/tables become one
   * slide, built from the same data already rendered on screen. */
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const { headline } = data;
    const mtdPct = headline.totalTarget > 0 ? (headline.totalMtdReported / headline.totalTarget) * 100 : 0;
    const slide: ExportSlide = {
      title: "Housing Owner Performance",
      kpis: [
        { label: "Sale Count", value: headline.totalSaleCount.toLocaleString("en-IN") },
        { label: "Revenue", value: formatINR(headline.totalRevenue) },
        { label: "MTD Achievement %", value: `${mtdPct.toFixed(1)}%` },
        { label: "Overall Achievement %", value: `${headline.achievementPct.toFixed(1)}%` },
        { label: "Total Calls", value: headline.totalCalls.toLocaleString("en-IN") },
        { label: "Connected Calls", value: headline.connectedCalls.toLocaleString("en-IN") },
        { label: "Connected %", value: `${headline.connectedPct.toFixed(1)}%` },
        { label: "Avg Talk Time / Agent", value: formatSecs(headline.avgTalkTimeSec) },
        { label: "AOV", value: formatINR(headline.aov) },
        { label: "Revenue Per Agent (RPA)", value: formatINR(headline.revenuePerAgent) },
      ],
      tables: [
        {
          title: "AM-wise Performance",
          columns: ["Name", "Calls", "Connected %", "Sale Count", "Revenue", "AOV", "RPA", "Target", "Achievement %", "TQ", "MQ", "BQ"],
          rows: data.byAm.map((r) => [
            r.name, r.totalCalls.toLocaleString("en-IN"), `${r.connectedPct.toFixed(1)}%`, r.saleCount, formatINR(r.revenue), formatINR(r.aov), formatINR(r.rpa),
            r.target > 0 ? formatINR(r.target) : "—", r.target > 0 ? `${r.achievementPct.toFixed(0)}%` : "—", r.tqCount, r.mqCount, r.bqCount,
          ]),
        },
        {
          title: "TL-wise Performance",
          columns: ["Name", "Calls", "Connected %", "Sale Count", "Revenue", "AOV", "RPA", "Target", "Achievement %", "TQ", "MQ", "BQ"],
          rows: data.byTl.map((r) => [
            r.name, r.totalCalls.toLocaleString("en-IN"), `${r.connectedPct.toFixed(1)}%`, r.saleCount, formatINR(r.revenue), formatINR(r.aov), formatINR(r.rpa),
            r.target > 0 ? formatINR(r.target) : "—", r.target > 0 ? `${r.achievementPct.toFixed(0)}%` : "—", r.tqCount, r.mqCount, r.bqCount,
          ]),
        },
        {
          title: "Top 5 Performers (by Achievement %)",
          columns: ["Agent", "TL", "Revenue", "Achievement %"],
          rows: data.topPerformers.map((r) => [r.name, r.tlName, formatINR(r.revenue), `${r.achievementPct.toFixed(0)}%`]),
        },
        {
          title: "Bottom 5 Performers (by Achievement %)",
          columns: ["Agent", "TL", "Revenue", "Achievement %"],
          rows: data.bottomPerformers.map((r) => [r.name, r.tlName, formatINR(r.revenue), `${r.achievementPct.toFixed(0)}%`]),
        },
        {
          title: "Agent-wise Performance",
          columns: [
            "Agent", "Emp ID", "TL", "AM", "Bucket", "Status", "Target", "Total Calls", "Connected %",
            "Avg Daily Talk", "Sale Count", "Revenue", "Achievement %", "Stage",
          ],
          rows: data.agents.map((a) => [
            a.name, a.empId ?? "—", a.tlName, a.am, a.bucket ?? "—", a.status,
            a.target > 0 ? formatINR(a.target) : "—", a.totalCalls.toLocaleString("en-IN"), `${a.connectedPct.toFixed(1)}%`,
            a.avgTalkTimeSec > 0 ? formatSecs(a.avgTalkTimeSec) : "—", a.saleCount, formatINR(a.revenue),
            a.target > 0 ? `${a.achievementPct.toFixed(0)}%` : "—", a.stage,
          ]),
        },
      ],
    };
    return [slide];
  }, [data]);

  const dateFilter = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <CalendarDays className="h-4 w-4 text-slate-400" />
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => setFrom(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm"
      />
      <span className="text-xs text-slate-400">to</span>
      <input
        type="date"
        value={to}
        min={from}
        max={localDateStr(new Date())}
        onChange={(e) => setTo(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm"
      />
      <button
        type="button"
        onClick={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
      >
        This Month
      </button>
    </div>
  );

  if (loading && !data) {
    return (
      <div className="space-y-5">
        {dateFilter}
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-5">
        {dateFilter}
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }
  if (!data) return null;

  const { headline } = data;
  const mtdAchievementPct = headline.totalTarget > 0 ? (headline.totalMtdReported / headline.totalTarget) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle="Housing Owner — Performance"
          fileBaseName="Housing_Owner_Performance"
          raw={{ dashboard: "housing_owner", from, to }}
          subtitle={`${from} to ${to}`}
          slides={exportSlides}
          activeSlideTitle="Housing Owner Performance"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={am} onValueChange={changeAm}>
            <SelectTrigger className="h-8 w-[170px] bg-white text-xs" aria-label="Filter by AM"><SelectValue placeholder="All AMs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All AMs</SelectItem>
              {data.filterOptions.ams.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={tl} onValueChange={setTl}>
            <SelectTrigger className="h-8 w-[190px] bg-white text-xs" aria-label="Filter by TL"><SelectValue placeholder="All TLs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All TLs</SelectItem>
              {tlOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {dateFilter}
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        <KpiCard icon={ShoppingBag} label="Sale Count" value={headline.totalSaleCount.toLocaleString("en-IN")} tone="sky" />
        <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(headline.totalRevenue)} tone="emerald" />
        <KpiCard icon={Target} label="MTD Achievement %" value={`${mtdAchievementPct.toFixed(1)}%`} sub="reported vs target" tone="violet" />
        <KpiCard icon={TrendingUp} label="Overall Achievement %" value={`${headline.achievementPct.toFixed(1)}%`} sub={`vs ${formatINR(headline.totalTarget)}`} tone="indigo" />
        <KpiCard icon={PhoneCall} label="Total Calls" value={headline.totalCalls.toLocaleString("en-IN")} tone="blue" />
        <KpiCard icon={PhoneIncoming} label="Connected Calls" value={headline.connectedCalls.toLocaleString("en-IN")} tone="teal" />
        <KpiCard icon={Percent} label="Connected %" value={`${headline.connectedPct.toFixed(1)}%`} tone="cyan" />
        <KpiCard icon={Timer} label="Avg Talk / Agent" value={formatSecs(headline.avgTalkTimeSec)} tone="amber" />
        <KpiCard icon={IndianRupee} label="AOV" value={formatINR(headline.aov)} sub="revenue / sale count" tone="rose" />
        <KpiCard icon={Users} label="RPA" value={formatINR(headline.revenuePerAgent)} sub="revenue / active agents" tone="blue" />
      </div>

      {/* Daily trend */}
      <div className="grid gap-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <TableCardHeader icon={TrendingUp} title="Day-wise Revenue & Achievement %" tone="indigo" />
            <div className="flex items-center gap-2">
              <Select value={am} onValueChange={changeAm}>
                <SelectTrigger className="h-7 w-[130px] bg-white text-[11px]" aria-label="Filter chart by AM"><SelectValue placeholder="AM" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All AMs</SelectItem>
                  {(data.filterOptions.ams ?? []).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={tl} onValueChange={setTl}>
                <SelectTrigger className="h-7 w-[130px] bg-white text-[11px]" aria-label="Filter chart by TL"><SelectValue placeholder="TL" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All TLs</SelectItem>
                  {tlOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="mb-2 text-[11px] text-slate-400">
            Filtering here uses the same AM/TL filter as the rest of the page -- it narrows every section, not just this chart.
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dailyTrendWithAchievement} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                labelFormatter={(v: unknown) => formatShortDate(String(v))}
                formatter={(value: number, name: string) => (name === "Achievement %" ? `${value}%` : formatINR(value))}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="dayTarget" name="Target" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 3" dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="achievementPct" name="Achievement %" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AM-wise + TL-wise */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable title="AM-wise Performance" rows={data.byAm} icon={Users} tone="blue" onRowClick={(name) => setDrillTarget({ type: "am", name })} />
        <GroupTable title="TL-wise Performance" rows={data.byTl} icon={Users} tone="violet" onRowClick={(name) => setDrillTarget({ type: "tl", name })} />
      </div>

      {/* Top / Bottom performers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PerformerTable title="Top 5 Performers (by Achievement %)" rows={data.topPerformers} icon={Award} tone="emerald" onRowClick={(name) => setDrillTarget({ type: "agent", name })} />
        <PerformerTable title="Bottom 5 Performers (by Achievement %)" rows={data.bottomPerformers} icon={TrendingDown} tone="red" onRowClick={(name) => setDrillTarget({ type: "agent", name })} />
      </div>

      {/* Full agent-wise table */}
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <TableCardHeader
            icon={ClipboardList} tone="indigo"
            title={`Agent-wise Performance (${agentSearch.trim() ? `${filteredAgents.length} of ${data.agents.length}` : data.agents.length} agents)`}
          />
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search agent name or ID..." aria-label="Search agents by name"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-center text-xs">
            <thead>
              <tr className="bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-white">
                <SortTh label="Agent" sortKey="name" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="rounded-l-lg py-2.5 px-2 font-bold" />
                <SortTh label="TL" sortKey="tlName" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="AM" sortKey="am" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Bucket" sortKey="bucket" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Status" sortKey="status" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Target" sortKey="target" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Total Calls" sortKey="totalCalls" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Connected%" sortKey="connectedPct" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Avg Daily Talk" sortKey="avgTalkTimeSec" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Sale Count" sortKey="saleCount" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Revenue" sortKey="revenue" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Ach%" sortKey="achievementPct" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="py-2.5 px-2 font-bold" />
                <SortTh label="Stage" sortKey="stage" activeKey={agentSort.sortKey} dir={agentSort.sortDir} onSort={agentSort.toggleSort} className="rounded-r-lg py-2.5 px-2 font-bold" />
              </tr>
            </thead>
            <tbody>
              {agentSort.sorted.map((a, i) => (
                <tr
                  key={a.name} onClick={() => setDrillTarget({ type: "agent", name: a.name })} role="button" tabIndex={0}
                  className={`cursor-pointer transition-colors hover:bg-blue-50/60 ${i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}`}
                >
                  <td className="py-2.5 px-2">
                    <div className="font-semibold text-blue-700 underline-offset-2 hover:underline">{a.name}</div>
                    {a.empId && <div className="text-[11px] text-slate-400">{a.empId}</div>}
                  </td>
                  <td className="py-2.5 px-2 text-slate-500">{a.tlName}</td>
                  <td className="py-2.5 px-2 text-slate-500">{a.am}</td>
                  <td className="py-2.5 px-2 text-slate-500">{a.bucket ?? "—"}</td>
                  <td className="py-2.5 px-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${a.status === "Active" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : a.status === "Inactive" ? "bg-slate-100 text-slate-500 ring-slate-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-slate-500">{a.target > 0 ? formatINR(a.target) : "—"}</td>
                  <td className="py-2.5 px-2 text-slate-600">{a.totalCalls.toLocaleString("en-IN")}</td>
                  <td className="py-2.5 px-2"><ConnBadge pct={a.connectedPct} /></td>
                  <td className="py-2.5 px-2 text-slate-600">{a.avgTalkTimeSec > 0 ? formatSecs(a.avgTalkTimeSec) : "—"}</td>
                  <td className="py-2.5 px-2 font-semibold text-slate-800">{a.saleCount}</td>
                  <td className="py-2.5 px-2 font-bold text-emerald-700">{formatINR(a.revenue)}</td>
                  <td className="py-2.5 px-2"><AchBadge pct={a.achievementPct} hasTarget={a.target > 0} /></td>
                  <td className="py-2.5 px-2"><StageBadge stage={a.stage} /></td>
                </tr>
              ))}
              {filteredAgents.length === 0 && (
                <tr><td colSpan={13} className="py-6 text-center text-slate-400">{data.agents.length === 0 ? "No agent data." : "No agents match this search."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {drillTarget && <EntityTrendDrawer target={drillTarget} onClose={() => setDrillTarget(null)} />}
    </div>
  );
}
