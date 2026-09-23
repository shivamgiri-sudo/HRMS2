import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  IndianRupee, ShoppingBag, CreditCard, RotateCcw, TrendingUp, Users, CalendarDays, Wallet, Target,
  MessageSquare, MessagesSquare, Percent, ShoppingCart, PhoneCall, Loader2, PhoneIncoming, PhoneMissed, Pencil,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { BellavitaAgentPerformance } from "./BellavitaAgentPerformance";
import { BellavitaSaleDateLobMatrix } from "./BellavitaSaleDateLobMatrix";
import { DashboardExportMenu, type ExportSlide } from "./DashboardKit";
import { useSortableRows } from "./useSortableRows";
import { SortTh } from "./SortTh";

interface DashboardData {
  headline: {
    turnover: number;
    saleCount: number;
    prepaidPct: number;
    rtoPct: number;
    /** Last date rtoPct's window actually covers (from through today - 7 days). */
    rtoPctThrough: string;
    aov: number;
    activeAgents: number;
    netTurnover: number;
    netSaleCount: number;
  };
  from: string;
  to: string;
  /** The calendar month (YYYY-MM) lobRevenue's target/achievementPct apply to. */
  targetMonth: string;
  /** Whether the signed-in user may set a monthly target (admin/management roles only). */
  canSetTarget: boolean;
  dateWiseTrend: Array<{ date: string; saleCount: number; turnover: number; paidCount: number; codCount: number; rtoCount: number }>;
  lobRevenue: Array<{
    lob: string; saleCount: number; turnover: number; target: number | null; achievementPct: number | null; targetNote?: string;
    /** "manual" = an admin set this month's target; "default" = the older hardcoded LOB_TARGETS fallback; "none" = no target at all. */
    targetSource: "manual" | "default" | "none";
    codCount: number; paidCount: number; codPct: number; paidPct: number; rtoAmount: number; rtoCount: number; rtoPct: number;
    aov: number; netSaleCount: number; netRevenue: number;
  }>;
  lobGrandTotal: {
    saleCount: number; turnover: number; codCount: number; paidCount: number; codPct: number; paidPct: number;
    rtoAmount: number; rtoCount: number; rtoPct: number; aov: number; netSaleCount: number; netRevenue: number;
    target: number; achievementPct: number;
  };
  stateRevenue: Array<{ state: string; saleCount: number; turnover: number; rtoCount: number }>;
  topPerformers: Array<{ empId: string; empName: string; saleCount: number; turnover: number; rtoPct: number; prepaidPct: number; lob: string }>;
  topRtoStates: Array<{ state: string; saleCount: number; rtoPct: number }>;
}

const LOB_COLORS = ["#e11d48", "#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6"];

/** "September 2026" from a "2026-09" month key, for the target editor's label. */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Local YYYY-MM-DD, deliberately NOT via toISOString(): that converts
 * through UTC and rolls the date back a day for a viewer ahead of UTC
 * (e.g. IST, UTC+5:30) — midnight local time becomes the previous day's
 * evening in UTC. */
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

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const daysInMonthOf = (iso: string): number => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate();

/** Same "day-of-month 1-7 -> W-1, 8-14 -> W-2, ..." convention this app's
 * other week-wise tables/exports already use (see HousingOwnerDashboard.tsx's
 * weekBucket). Keyed by month too, so a range spanning more than one month
 * never merges two different months' "W-1" into one bucket. */
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

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-rose-500" />
    </div>
  );
}

/** Every literal "bg-<color>-50 text-<color>-600" pair KpiCard is ever called
 * with in this file, mapped to a solid accent-bar class -- see KpiCard's own
 * comment for why this can't be derived by string-replacing "-50" at runtime. */
const ACCENT_BAR: Record<string, string> = {
  "bg-amber-50 text-amber-600": "bg-amber-500",
  "bg-blue-50 text-blue-600": "bg-blue-500",
  "bg-cyan-50 text-cyan-600": "bg-cyan-500",
  "bg-emerald-50 text-emerald-600": "bg-emerald-500",
  "bg-fuchsia-50 text-fuchsia-600": "bg-fuchsia-500",
  "bg-indigo-50 text-indigo-600": "bg-indigo-500",
  "bg-lime-50 text-lime-600": "bg-lime-500",
  "bg-pink-50 text-pink-600": "bg-pink-500",
  "bg-purple-50 text-purple-600": "bg-purple-500",
  "bg-red-50 text-red-600": "bg-red-500",
  "bg-rose-50 text-rose-600": "bg-rose-500",
  "bg-sky-50 text-sky-600": "bg-sky-500",
  "bg-teal-50 text-teal-600": "bg-teal-500",
  "bg-violet-50 text-violet-600": "bg-violet-500",
};

function KpiCard({
  icon: Icon, label, value, sub, tone,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone: string }) {
  // `tone` is always "bg-<color>-50 text-<color>-600" (or -500) at every call
  // site in this file -- both classes already appear verbatim as literal prop
  // strings, so Tailwind's static scan already compiles them. ACCENT_BAR maps
  // that same literal pair to a solid accent-bar class, also written out in
  // full so the build picks it up (a runtime "-50" -> "-500" string swap
  // would produce a class name Tailwind never sees in source and silently
  // drop the style).
  const [bgClass, textClass] = tone.split(" ");
  const accent = ACCENT_BAR[tone] ?? "bg-slate-400";
  return (
    <div className={`group relative overflow-hidden rounded-xl border border-slate-100 ${bgClass ?? "bg-white"} p-2.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md`}>
      <div className={`absolute inset-x-0 top-0 h-1 ${accent}`} />
      <div className={`mb-1.5 inline-flex rounded-lg bg-white/70 p-1.5 ${textClass ?? "text-slate-600"}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="text-base font-bold leading-tight text-slate-800">{value}</p>
      <p className="text-[11px] text-slate-600">{label}</p>
      {sub && <p className="mt-0.5 truncate text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}

/** Every literal KpiGroup `tone` value in this file, mapped to a matching
 * soft wash background + border -- same "must appear as literal source" rule
 * ACCENT_BAR follows, so Tailwind's static scan compiles these classes. */
const GROUP_WASH: Record<string, string> = {
  "text-rose-500": "bg-gradient-to-br from-rose-50/70 to-white border-rose-100",
  "text-fuchsia-500": "bg-gradient-to-br from-fuchsia-50/70 to-white border-fuchsia-100",
  "text-cyan-600": "bg-gradient-to-br from-cyan-50/70 to-white border-cyan-100",
  "text-emerald-600": "bg-gradient-to-br from-emerald-50/70 to-white border-emerald-100",
};

/** Boxes a related set of KpiCards under its own small heading, so Sale/Chat/
 * Cart/Inbound each read as one visually separate group instead of one flat
 * grid of differently-colored cards. `onEditTarget`, when given, adds a small
 * pencil button next to the heading that jumps straight to the shared Monthly
 * target editor below, pre-set to this group's own LOB. */
function KpiGroup({
  label, tone, cols, children, onEditTarget,
}: { label: string; tone: string; cols?: string; children: ReactNode; onEditTarget?: () => void }) {
  const wash = GROUP_WASH[tone] ?? "bg-white border-slate-100";
  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${wash}`}>
      <div className="mb-2 flex items-center justify-between">
        <p className={`text-[11px] font-bold uppercase tracking-wide ${tone}`}>{label}</p>
        {onEditTarget && (
          <button
            type="button" onClick={onEditTarget}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          >
            <Pencil className="h-3 w-3" /> Edit target
          </button>
        )}
      </div>
      <div className={`grid gap-2 ${cols ?? "grid-cols-2 sm:grid-cols-4"}`}>{children}</div>
    </div>
  );
}

/**
 * Slide 1: the Sale Performance dashboard itself. Split out from the
 * BellavitaSaleDashboard shell below so the shell can own the shared
 * slide-switcher + date range and hand the same [from, to] to whichever
 * slide (this one, or Agent Performance) is active.
 */
const SALE_API = "/api/process-performance/bellavita-sale-dashboard";

/** Real bb_sale.lob values this dashboard already knows about (the same set
 * LOB_TARGETS/the LOB-wise Performance table use) -- a closed set, so the
 * filter is a dropdown, never free text. "All" means no filter. */
const LOB_FILTER_OPTIONS = ["All", "Repeat", "Chat", "Abandon Cart", "Inbound"];

/** Just the 3 headline chat figures this slide shows -- reads the same
 * Overview snapshot the Chat Performance dashboard's own snapshot page uses
 * (GET .../bellavita-chat-dashboard/overview, userType=Overall so it's Chat
 * + Kenaz + Bevzilla combined, matching "Overall Chat"), so the numbers here
 * never drift from that page's own figures. */
interface ChatHeadline { overallChat: number; unique: number; convUniquePct: number | null }

/** Total Allocation / Total Workable Allocation / Total Conversion for the
 * headline row's Cart group -- reads the same Abandon Cart dashboard headline
 * the Cart tab itself uses (GET .../bellavita-cart-dashboard). "Workable" =
 * disposition IN ('Connect','Not Connect'), i.e. cases an agent actually
 * attempted, same definition that dashboard's own header comment documents.
 * Conversion is computed here, not fabricated: sale count / total carts. */
interface CartHeadline { totalCarts: number; workableCases: number; abandonCartSaleCount: number }

/** Call Offered / Answered / AL% / SL% for the headline row's Inbound group --
 * reads the same dialer-backed Overview headline the Inbound dashboard itself
 * uses (GET /api/inbound-insights/bellavita), so these figures never drift
 * from that page's own numbers. AL% = abandonPct (calls that never reached an
 * agent, as a share of offered); SL% = answered within the project's service
 * level threshold (20s for Bellavita, a pattern-A project). */
interface InboundHeadline { offered: number; answered: number; abandonPct: number; slPct: number }

type DrillEntity = { kind: "lob"; value: string } | { kind: "agent"; value: string; label: string };

/** One row of the week-wise table below -- summed from the same dateWiseTrend
 * rows the date-wise table already shows, not a separate fetch. codCount/
 * paidCount/rtoCount are kept as raw sums only to derive that week's %
 * columns; targetSum accumulates each day's pro-rated share of the LOB's
 * monthly target (null once any day in the week has no target), so
 * achievementPct is null rather than a misleadingly-partial % when the
 * entity has no target configured. */
interface WeekAgg {
  key: string; label: string; saleCount: number; turnover: number;
  codCount: number; paidCount: number; rtoCount: number; targetSum: number | null;
}

/**
 * Right-side drill-down for one LOB-wise Performance row OR one Top
 * Performers agent row: that entity's own summary + date-wise AND week-wise
 * Sale Count/Revenue/COD/Paid/RTO tables. Fetches its own independent copy
 * of the dashboard endpoint scoped to this one LOB or agent (never reuses
 * the calling table's already-loaded row), same convention this app already
 * uses elsewhere (see AppreciateWealthDrawer.tsx).
 */
function EntityDrillDrawer({ entity, from, to, onClose }: { entity: DrillEntity | null; from: string; to: string; onClose: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!entity) return;
    let cancelled = false;
    setData(null); setError(""); setLoading(true);
    const param = entity.kind === "lob" ? `lob=${encodeURIComponent(entity.value)}` : `empId=${encodeURIComponent(entity.value)}`;
    hrmsApi.get<{ success: boolean; data: DashboardData }>(`${SALE_API}?from=${from}&to=${to}&${param}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load this detail."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entity, from, to]);

  // Achievement % only makes sense for a LOB entity against that LOB's own
  // monthly target (bellavita_sale has no per-agent target anywhere in this
  // app) -- lobRevenue comes back lob-filtered to this one entry when
  // entity.kind is "lob" (the backend's lob=? filter), so [0] is this LOB's row.
  const monthTarget = entity?.kind === "lob" ? (data?.lobRevenue[0]?.target ?? null) : null;
  const dayTarget = useCallback(
    (date: string) => (monthTarget != null ? monthTarget / daysInMonthOf(date) : null),
    [monthTarget],
  );

  const weekly = useMemo<WeekAgg[]>(() => {
    if (!data) return [];
    const byWeek = new Map<string, WeekAgg>();
    for (const r of data.dateWiseTrend) {
      const wk = weekBucket(r.date);
      const cur = byWeek.get(wk.key) ?? { key: wk.key, label: wk.label, saleCount: 0, turnover: 0, codCount: 0, paidCount: 0, rtoCount: 0, targetSum: monthTarget != null ? 0 : null };
      cur.saleCount += r.saleCount;
      cur.turnover += r.turnover;
      cur.codCount += r.codCount;
      cur.paidCount += r.paidCount;
      cur.rtoCount += r.rtoCount;
      if (cur.targetSum != null) cur.targetSum += dayTarget(r.date) ?? 0;
      byWeek.set(wk.key, cur);
    }
    return [...byWeek.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [data, monthTarget, dayTarget]);

  const title = entity?.kind === "lob" ? entity.value : entity?.kind === "agent" ? entity.label : "";
  const badge = entity?.kind === "lob" ? "LOB" : "Agent";

  return (
    <Sheet open={!!entity} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">{badge}</span>
            <SheetTitle className="text-base font-bold text-slate-800">{title}</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] text-slate-400">
            {from} to {to} · Week-wise and date-wise performance{entity?.kind === "agent" ? " for this agent only" : " for this LOB only"}.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-5 py-4">
          {loading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {error && <p className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
          {data && (
            <>
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Summary</p>
                <div className="grid grid-cols-3 gap-2">
                  <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(data.headline.turnover)} tone="bg-rose-50 text-rose-600" />
                  <KpiCard icon={ShoppingBag} label="Sale Count" value={data.headline.saleCount.toLocaleString("en-IN")} tone="bg-sky-50 text-sky-600" />
                  <KpiCard icon={CreditCard} label="Prepaid %" value={`${data.headline.prepaidPct}%`} tone="bg-emerald-50 text-emerald-600" />
                  <KpiCard
                    icon={RotateCcw} label="RTO %" value={`${data.headline.rtoPct}%`}
                    sub={`till ${formatShortDate(data.headline.rtoPctThrough)}`} tone="bg-amber-50 text-amber-600"
                  />
                  <KpiCard icon={TrendingUp} label="AOV" value={formatINR(data.headline.aov)} tone="bg-violet-50 text-violet-600" />
                  <KpiCard icon={Wallet} label="Net Revenue" value={formatINR(data.headline.netTurnover)} tone="bg-teal-50 text-teal-600" />
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Week-wise</p>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full border-collapse text-center text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="border border-slate-200 px-2 py-1.5">Week</th>
                        <th className="border border-slate-200 px-2 py-1.5">Sale Count</th>
                        <th className="border border-slate-200 px-2 py-1.5">Revenue</th>
                        <th className="border border-slate-200 px-2 py-1.5">COD%</th>
                        <th className="border border-slate-200 px-2 py-1.5">Paid%</th>
                        <th className="border border-slate-200 px-2 py-1.5">RTO%</th>
                        <th className="border border-slate-200 px-2 py-1.5">Achi%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekly.map((w) => (
                        <tr key={w.key}>
                          <td className="border border-slate-200 px-2 py-1.5 text-left font-medium text-slate-700">{w.label}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{w.saleCount.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-800">{formatINR(w.turnover)}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{pct(w.codCount, w.saleCount)}%</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{pct(w.paidCount, w.saleCount)}%</td>
                          <td className={`border border-slate-200 px-2 py-1.5 font-semibold ${pct(w.rtoCount, w.saleCount) > 10 ? "text-red-600" : "text-slate-600"}`}>{pct(w.rtoCount, w.saleCount)}%</td>
                          <td className={`border border-slate-200 px-2 py-1.5 font-semibold ${w.targetSum ? (pct(w.turnover, w.targetSum) >= 100 ? "text-emerald-600" : "text-slate-600") : "text-slate-400"}`}>
                            {w.targetSum ? `${pct(w.turnover, w.targetSum)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                      {weekly.length === 0 && (
                        <tr><td colSpan={7} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Date-wise</p>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full border-collapse text-center text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="border border-slate-200 px-2 py-1.5">Date</th>
                        <th className="border border-slate-200 px-2 py-1.5">Sale Count</th>
                        <th className="border border-slate-200 px-2 py-1.5">Revenue</th>
                        <th className="border border-slate-200 px-2 py-1.5">COD%</th>
                        <th className="border border-slate-200 px-2 py-1.5">Paid%</th>
                        <th className="border border-slate-200 px-2 py-1.5">RTO%</th>
                        <th className="border border-slate-200 px-2 py-1.5">Achi%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dateWiseTrend.map((r) => {
                        const dt = dayTarget(r.date);
                        const achi = dt ? pct(r.turnover, dt) : null;
                        return (
                          <tr key={r.date}>
                            <td className="border border-slate-200 px-2 py-1.5 font-medium text-slate-700">{formatShortDate(r.date)}</td>
                            <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{r.saleCount.toLocaleString("en-IN")}</td>
                            <td className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-800">{formatINR(r.turnover)}</td>
                            <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{pct(r.codCount, r.saleCount)}%</td>
                            <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{pct(r.paidCount, r.saleCount)}%</td>
                            <td className={`border border-slate-200 px-2 py-1.5 font-semibold ${pct(r.rtoCount, r.saleCount) > 10 ? "text-red-600" : "text-slate-600"}`}>{pct(r.rtoCount, r.saleCount)}%</td>
                            <td className={`border border-slate-200 px-2 py-1.5 font-semibold ${achi != null ? (achi >= 100 ? "text-emerald-600" : "text-slate-600") : "text-slate-400"}`}>
                              {achi != null ? `${achi}%` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {data.dateWiseTrend.length === 0 && (
                        <tr><td colSpan={7} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>
                      )}
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

function SaleDashboardSlide({
  from, to, lobFilter, onExportNodeChange,
}: {
  from: string; to: string;
  /** Read-only here -- the LOB Select itself now lives in the parent shell's
   * merged toolbar row; this slide just fetches/filters by whatever it's set to. */
  lobFilter: string;
  /** Handed the ready-to-render Export button once this slide has data, so the
   * parent shell can place it in the same toolbar row as the tabs/date range/LOB
   * filter instead of its own separate row -- this component still owns the
   * export data (slides/raw), the parent just renders the node it's given. */
  onExportNodeChange: (node: ReactNode) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetLob, setTargetLob] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [targetBusy, setTargetBusy] = useState(false);
  const [targetMsg, setTargetMsg] = useState("");
  const [chatHeadline, setChatHeadline] = useState<ChatHeadline | null>(null);
  const [cartHeadline, setCartHeadline] = useState<CartHeadline | null>(null);
  const [inboundHeadline, setInboundHeadline] = useState<InboundHeadline | null>(null);
  /** LOB clicked in the LOB-wise Performance table, or agent clicked in Top
   * Performers -- opens the week-wise/date-wise drill-down drawer for just
   * that one LOB or agent (null = drawer closed). */
  const [drawerEntity, setDrawerEntity] = useState<DrillEntity | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const lobParam = lobFilter !== "All" ? `&lob=${encodeURIComponent(lobFilter)}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `${SALE_API}?from=${from}&to=${to}${lobParam}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Bellavita sale dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to, lobFilter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    hrmsApi
      .get<{ success: boolean; data: { values: Record<string, { overallChat: number; unique: number; convUniquePct: number | null }> } }>(
        `/api/process-performance/bellavita-chat-dashboard/overview?from=${from}&to=${to}&userType=Overall`,
      )
      .then((res) => {
        if (cancelled) return;
        const mtd = res.data.values.mtd;
        setChatHeadline(mtd ? { overallChat: mtd.overallChat, unique: mtd.unique, convUniquePct: mtd.convUniquePct } : null);
      })
      .catch(() => { if (!cancelled) setChatHeadline(null); });
    return () => { cancelled = true; };
  }, [from, to]);

  useEffect(() => {
    let cancelled = false;
    hrmsApi
      .get<{ success: boolean; data: { headline: { totalCarts: number; workableCases: number; abandonCartSaleCount: number } } }>(
        `/api/process-performance/bellavita-cart-dashboard?from=${from}&to=${to}`,
      )
      .then((res) => {
        if (cancelled) return;
        const h = res.data.headline;
        setCartHeadline({ totalCarts: h.totalCarts, workableCases: h.workableCases, abandonCartSaleCount: h.abandonCartSaleCount });
      })
      .catch(() => { if (!cancelled) setCartHeadline(null); });
    return () => { cancelled = true; };
  }, [from, to]);

  useEffect(() => {
    let cancelled = false;
    hrmsApi
      .get<{ success: boolean; data: { headline: { offered: number; answered: number; abandonPct: number; slPct: number } } }>(
        `/api/inbound-insights/bellavita?startDate=${from}&endDate=${to}`,
      )
      .then((res) => {
        if (cancelled) return;
        const h = res.data.headline;
        setInboundHeadline({ offered: h.offered, answered: h.answered, abandonPct: h.abandonPct, slPct: h.slPct });
      })
      .catch(() => { if (!cancelled) setInboundHeadline(null); });
    return () => { cancelled = true; };
  }, [from, to]);

  // Keep the target editor's month in step with whichever month the LOB
  // table is actually showing, and default the LOB picker to the first row
  // once data loads (or once the previously-selected LOB disappears).
  useEffect(() => {
    if (!data) return;
    setTargetMonth(data.targetMonth);
    setTargetLob((cur) => (data.lobRevenue.some((r) => r.lob === cur) ? cur : (data.lobRevenue[0]?.lob ?? "")));
  }, [data]);

  /** Jumps to the shared Monthly target editor below, pre-set to this LOB --
   * used by the "Edit target" button on the Chat/Abandon Cart/Inbound boxes. */
  function openTargetEditor(lob: string) {
    setTargetLob(lob);
    document.getElementById("bellavita-monthly-target-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveTarget() {
    setTargetBusy(true);
    setTargetMsg("");
    try {
      await hrmsApi.put(`${SALE_API}/monthly-target`, { lob: targetLob, month: targetMonth, target: Number(targetValue) });
      setTargetValue("");
      setTargetMsg(`Saved ${targetLob} target for ${monthLabel(targetMonth)}.`);
      await load();
    } catch (err) {
      setTargetMsg(err instanceof Error ? err.message : "Could not save the target.");
    } finally {
      setTargetBusy(false);
    }
  }

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    return [{
      title: "Overall Dashboard",
      kpis: [
        { label: "Revenue", value: formatINR(data.headline.turnover) },
        { label: "Net Sale Amount", value: formatINR(data.headline.netTurnover) },
        { label: "Sale Count", value: data.headline.saleCount.toLocaleString("en-IN") },
        { label: "Prepaid %", value: `${data.headline.prepaidPct}%` },
        { label: "RTO %", value: `${data.headline.rtoPct}%` },
        { label: "AOV", value: formatINR(data.headline.aov) },
        { label: "Active Agents", value: String(data.headline.activeAgents) },
      ],
      tables: [
        {
          title: "LOB-wise Performance",
          columns: ["LOB", "Sale Count", "COD", "Paid", "COD%", "Paid%", "RTO Amount", "Revenue", "AOV", "RTO%", "Net Sale Count", "Net Revenue", "Target", "Gross Ach%"],
          rows: data.lobRevenue.map((r) => [
            r.lob, r.saleCount, r.codCount, r.paidCount, `${r.codPct}%`, `${r.paidPct}%`,
            formatINR(r.rtoAmount), formatINR(r.turnover), formatINR(r.aov), `${r.rtoPct}%`,
            r.netSaleCount, formatINR(r.netRevenue), r.target != null ? formatINR(r.target) : "—",
            r.achievementPct != null ? `${r.achievementPct}%` : "—",
          ]),
        },
        {
          title: "Top 10 States by Revenue",
          columns: ["State", "Sale Count", "Revenue", "RTO Count"],
          rows: data.stateRevenue.map((s) => [s.state, s.saleCount, formatINR(s.turnover), s.rtoCount]),
        },
        {
          title: "Top Performers",
          columns: ["Agent", "Emp ID", "LOB", "Revenue", "RTO%", "Prepaid%"],
          rows: data.topPerformers.map((p) => [p.empName, p.empId, p.lob, formatINR(p.turnover), `${p.rtoPct}%`, `${p.prepaidPct}%`]),
        },
        {
          title: "Top 5 High RTO % States",
          columns: ["State", "Sale Count", "RTO%"],
          rows: data.topRtoStates.map((s) => [s.state, s.saleCount, `${s.rtoPct}%`]),
        },
      ],
    }];
  }, [data]);

  // Hands the parent shell a ready Export button so it can render it in the
  // merged toolbar row -- re-runs whenever what it would export changes, and
  // clears it (null) while there's no data yet so the button never appears
  // with an empty report attached.
  useEffect(() => {
    if (!data) { onExportNodeChange(null); return; }
    onExportNodeChange(
      <DashboardExportMenu
        reportTitle="Bellavita — Overall Dashboard"
        fileBaseName="Bellavita_Overall_Dashboard"
        raw={{ dashboard: "bellavita_sale", from, to, lob: lobFilter !== "All" ? lobFilter : undefined }}
        subtitle={`${from} to ${to}${lobFilter !== "All" ? ` · ${lobFilter}` : ""}`}
        slides={exportSlides}
        activeSlideTitle="Overall Dashboard"
      />,
    );
    return () => onExportNodeChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, exportSlides, from, to, lobFilter]);

  // Day-wise Prepaid/COD split as a share of that day's orders (not raw
  // counts) -- feeds the 100%-stacked "COD vs Prepaid Orders" chart below,
  // so both the bars and the axis read in %, matching the tooltip.
  const codVsPrepaidPctTrend = useMemo(() => {
    if (!data) return [];
    return data.dateWiseTrend.map((r) => {
      const total = r.paidCount + r.codCount;
      return {
        date: r.date,
        paidPct: total > 0 ? Math.round((r.paidCount / total) * 1000) / 10 : 0,
        codPct: total > 0 ? Math.round((r.codCount / total) * 1000) / 10 : 0,
      };
    });
  }, [data]);

  const lobSort = useSortableRows<DashboardData["lobRevenue"][number]>(data?.lobRevenue ?? [], (r, key) => {
    switch (key) {
      case "lob": return r.lob;
      case "saleCount": return r.saleCount;
      case "turnover": return r.turnover;
      case "target": return r.target;
      case "achievementPct": return r.achievementPct;
      case "codCount": return r.codCount;
      case "paidCount": return r.paidCount;
      case "codPct": return r.codPct;
      case "paidPct": return r.paidPct;
      case "rtoAmount": return r.rtoAmount;
      case "aov": return r.aov;
      case "rtoPct": return r.rtoPct;
      case "netSaleCount": return r.netSaleCount;
      case "netRevenue": return r.netRevenue;
      default: return null;
    }
  });

  if (loading && !data) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-3">
      {/* Headline KPIs -- one boxed group per source (Sale / Chat / Cart /
          Inbound) instead of one flat grid, so each reads as its own section.
          Chat/Cart/Inbound only show when the LOB filter is "All" or that
          group's own LOB -- picking "Repeat" hides all three, "Chat" hides
          Cart+Inbound, etc., same as the LOB-wise Performance table below
          only having a row for the LOB actually selected. */}
      <KpiGroup label="Sale Performance" tone="text-rose-500" cols="grid-cols-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard icon={IndianRupee} label="Gross Revenue" value={formatINR(headline.turnover)} tone="bg-rose-50 text-rose-600" />
        <KpiCard icon={ShoppingBag} label="Sale Count" value={headline.saleCount.toLocaleString("en-IN")} tone="bg-sky-50 text-sky-600" />
        <KpiCard icon={TrendingUp} label="AOV" value={formatINR(headline.aov)} tone="bg-violet-50 text-violet-600" />
        <KpiCard
          icon={Target} label="Achi %" value={`${data.lobGrandTotal.achievementPct}%`}
          sub={`vs ${formatINR(data.lobGrandTotal.target)} target`} tone="bg-blue-50 text-blue-600"
        />
        <KpiCard icon={CreditCard} label="Prepaid %" value={`${headline.prepaidPct}%`} tone="bg-emerald-50 text-emerald-600" />
        <KpiCard
          icon={RotateCcw} label="RTO %" value={`${headline.rtoPct}%`}
          sub={`till ${formatShortDate(headline.rtoPctThrough)}`} tone="bg-amber-50 text-amber-600"
        />
        <KpiCard icon={Wallet} label="Net Sale Amount" value={formatINR(headline.netTurnover)} sub={`${headline.netSaleCount.toLocaleString("en-IN")} orders, excl. RTO`} tone="bg-teal-50 text-teal-600" />
        <KpiCard icon={Users} label="Active Agents" value={String(headline.activeAgents)} sub="in selected range" tone="bg-indigo-50 text-indigo-600" />
      </KpiGroup>

      <div className="grid gap-3 lg:grid-cols-3">
        {chatHeadline && (lobFilter === "All" || lobFilter === "Chat") && (
          <KpiGroup
            label="Chat Performance" tone="text-fuchsia-500" cols="grid-cols-3"
            onEditTarget={data.canSetTarget ? () => openTargetEditor("Chat") : undefined}
          >
            <KpiCard icon={MessageSquare} label="Overall Chat" value={chatHeadline.overallChat.toLocaleString("en-IN")} tone="bg-fuchsia-50 text-fuchsia-600" />
            <KpiCard icon={MessagesSquare} label="Unique Chat" value={chatHeadline.unique.toLocaleString("en-IN")} tone="bg-purple-50 text-purple-600" />
            <KpiCard icon={Percent} label="Conversion %" value={chatHeadline.convUniquePct !== null ? `${chatHeadline.convUniquePct}%` : "—"} sub="sale made / unique chat" tone="bg-pink-50 text-pink-600" />
          </KpiGroup>
        )}

        {cartHeadline && (lobFilter === "All" || lobFilter === "Abandon Cart") && (
          <KpiGroup
            label="Abandon Cart" tone="text-cyan-600" cols="grid-cols-3"
            onEditTarget={data.canSetTarget ? () => openTargetEditor("Abandon Cart") : undefined}
          >
            <KpiCard icon={ShoppingCart} label="Total Allocation" value={cartHeadline.totalCarts.toLocaleString("en-IN")} tone="bg-cyan-50 text-cyan-600" />
            <KpiCard icon={PhoneCall} label="Workable Allocation" value={cartHeadline.workableCases.toLocaleString("en-IN")} tone="bg-teal-50 text-teal-600" />
            <KpiCard
              icon={Percent} label="Conversion %"
              value={cartHeadline.totalCarts > 0 ? `${Math.round((cartHeadline.abandonCartSaleCount / cartHeadline.totalCarts) * 1000) / 10}%` : "—"}
              sub="sale count / total allocation" tone="bg-lime-50 text-lime-600"
            />
          </KpiGroup>
        )}

        {inboundHeadline && (lobFilter === "All" || lobFilter === "Inbound") && (
          <KpiGroup
            label="Inbound" tone="text-emerald-600" cols="grid-cols-2"
            onEditTarget={data.canSetTarget ? () => openTargetEditor("Inbound") : undefined}
          >
            <KpiCard icon={PhoneIncoming} label="Call Offered" value={inboundHeadline.offered.toLocaleString("en-IN")} tone="bg-emerald-50 text-emerald-600" />
            <KpiCard icon={PhoneCall} label="Answered" value={inboundHeadline.answered.toLocaleString("en-IN")} tone="bg-teal-50 text-teal-600" />
            <KpiCard icon={PhoneMissed} label="AL %" value={`${inboundHeadline.abandonPct}%`} tone="bg-red-50 text-red-600" />
            <KpiCard icon={Percent} label="SL %" value={`${inboundHeadline.slPct}%`} tone="bg-sky-50 text-sky-600" />
          </KpiGroup>
        )}
      </div>

      {/* Date-wise trend + LOB revenue */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm lg:col-span-2">
          <p className="mb-3 text-sm font-semibold text-slate-700">Date-wise Sale &amp; Revenue</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v: unknown) => formatShortDate(String(v))}
                formatter={(value: number, name: string) => (name === "Revenue" ? formatINR(value) : value)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="saleCount" name="Sale Count" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="turnover" name="Revenue" stroke="#e11d48" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">LOB-wise Revenue</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.lobRevenue} dataKey="turnover" nameKey="lob" cx="50%" cy="50%" outerRadius={80} label={(p: { lob?: string }) => p.lob ?? ""}>
                {data.lobRevenue.map((entry, i) => (
                  <Cell key={entry.lob} fill={LOB_COLORS[i % LOB_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => formatINR(value)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* COD vs Prepaid + RTO trend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">COD vs Prepaid Orders</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={codVsPrepaidPctTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                labelFormatter={(v: unknown) => formatShortDate(String(v))}
                formatter={(value: number, name: string) => [`${value}%`, name]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="paidPct" name="Prepaid" stackId="pay" fill="#10b981" radius={[0, 0, 0, 0]} />
              <Bar dataKey="codPct" name="COD" stackId="pay" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">RTO % Trend</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={data.dateWiseTrend.map((d) => ({ date: d.date, rtoPct: d.saleCount > 0 ? Math.round((d.rtoCount / d.saleCount) * 10000) / 100 : 0 }))}
              margin={{ top: 4, right: 12, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} formatter={(value: number) => `${value}%`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="rtoPct" name="RTO %" stroke="#dc2626" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LOB-wise Performance */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">LOB-wise Performance</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-center text-xs">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <SortTh label="LOB" sortKey="lob" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="sticky left-0 z-20 border border-slate-200 bg-slate-50 px-3 py-2 font-semibold shadow-[2px_0_6px_-2px_rgba(0,0,0,0.15)]" />
                <SortTh label="Sale Count" sortKey="saleCount" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="Gross Amount" sortKey="turnover" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="Target" sortKey="target" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="Achi%" sortKey="achievementPct" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="COD" sortKey="codCount" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="Paid" sortKey="paidCount" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="COD%" sortKey="codPct" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="Paid%" sortKey="paidPct" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="RTO Amount" sortKey="rtoAmount" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="AOV" sortKey="aov" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="RTO%" sortKey="rtoPct" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="Net Sale Count" sortKey="netSaleCount" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
                <SortTh label="Net Revenue" sortKey="netRevenue" activeKey={lobSort.sortKey} dir={lobSort.sortDir} onSort={lobSort.toggleSort} className="border border-slate-200 bg-slate-50 px-3 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {lobSort.sorted.map((r) => (
                <tr key={r.lob} onClick={() => setDrawerEntity({ kind: "lob", value: r.lob })} className="group cursor-pointer hover:bg-rose-50/60">
                  <td className="sticky left-0 z-10 border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.1)] group-hover:bg-rose-50">{r.lob}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.saleCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-800">{formatINR(r.turnover)}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-500">
                    {r.target != null ? formatINR(r.target) : "—"}
                    {r.targetSource === "default" && <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">default</span>}
                  </td>
                  <td className={`border border-slate-200 px-3 py-2 font-semibold ${r.achievementPct != null ? (r.achievementPct >= 100 ? "text-emerald-600" : r.achievementPct >= 70 ? "text-amber-600" : "text-red-600") : "text-slate-400"}`}>
                    {r.achievementPct != null ? `${r.achievementPct}%` : "—"}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.codCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.paidCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.codPct}%</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.paidPct}%</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{formatINR(r.rtoAmount)}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{formatINR(r.aov)}</td>
                  <td className={`border border-slate-200 px-3 py-2 font-semibold ${r.rtoPct > 10 ? "text-red-600" : "text-slate-600"}`}>{r.rtoPct}%</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{r.netSaleCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-600">{formatINR(r.netRevenue)}</td>
                </tr>
              ))}
              {data.lobRevenue.length === 0 && (
                <tr><td colSpan={14} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
            {data.lobRevenue.length > 0 && (
              <tfoot>
                <tr className="font-semibold text-slate-800">
                  <td className="sticky left-0 z-10 border border-slate-200 bg-slate-50 px-3 py-2 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.15)]">Grand Total</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.saleCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.turnover)}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.target)}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.achievementPct}%</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.codCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.paidCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.codPct}%</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.paidPct}%</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.rtoAmount)}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.aov)}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.rtoPct}%</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{data.lobGrandTotal.netSaleCount.toLocaleString("en-IN")}</td>
                  <td className="border border-slate-200 bg-slate-50 px-3 py-2">{formatINR(data.lobGrandTotal.netRevenue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Monthly target editor -- sets the Target column above per LOB, per month.
          Also what the Chat/Abandon Cart/Inbound boxes' "Edit target" button
          scrolls to (id below), pre-selecting that box's own LOB. */}
      <div id="bellavita-monthly-target-editor" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <Target className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-semibold text-slate-700">Monthly target — {monthLabel(data.targetMonth)}</p>
        </div>
        <p className="mb-3 text-[11px] text-slate-400">
          A target applies to one LOB for one calendar month. It's a business commitment, so it's entered by an admin rather than derived from data.
          "Default" rows above are the older fixed figures used until an admin sets a real monthly value here.
        </p>
        {data.canSetTarget ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={targetLob} onValueChange={setTargetLob}>
              <SelectTrigger className="h-8 w-[180px] bg-white text-xs" aria-label="LOB"><SelectValue placeholder="LOB" /></SelectTrigger>
              <SelectContent>
                {data.lobRevenue.map((r) => <SelectItem key={r.lob} value={r.lob}>{r.lob}</SelectItem>)}
              </SelectContent>
            </Select>
            <input
              type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} aria-label="Target month"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-amber-400 focus:outline-none"
            />
            <input
              type="number" min={1} inputMode="numeric" value={targetValue} onChange={(e) => setTargetValue(e.target.value)}
              placeholder={(() => { const cur = data.lobRevenue.find((r) => r.lob === targetLob)?.target; return cur != null ? `Now ${formatINR(cur)}` : "Target amount (₹)"; })()}
              aria-label="Target amount for the LOB and month"
              className="w-48 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-amber-400 focus:outline-none"
            />
            <button
              type="button" onClick={() => void saveTarget()} disabled={targetBusy || !targetLob || !targetMonth || !(Number(targetValue) > 0)}
              className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {targetBusy ? "Saving…" : "Save"}
            </button>
            {targetMsg && <span className="text-[11px] text-slate-500">{targetMsg}</span>}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">Ask an admin to set monthly targets.</p>
        )}
      </div>

      <BellavitaSaleDateLobMatrix from={from} to={to} />

      {/* State-wise revenue */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">Top 10 States by Revenue</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.stateRevenue} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="state" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(value: number) => formatINR(value)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Bar dataKey="turnover" name="Revenue" fill="#e11d48" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top performers + top RTO states */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Top 5 Performers</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 font-semibold">LOB</th>
                  <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                  <th className="py-2 pr-3 text-right font-semibold">RTO%</th>
                  <th className="py-2 pr-0 text-right font-semibold">Prepaid%</th>
                </tr>
              </thead>
              <tbody>
                {data.topPerformers.map((p) => (
                  <tr
                    key={p.empId} onClick={() => setDrawerEntity({ kind: "agent", value: p.empId, label: p.empName })}
                    className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-rose-50/60"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-rose-700 underline-offset-2 hover:underline">{p.empName}</div>
                      <div className="text-[11px] text-slate-400">{p.empId}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-500">{p.lob}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(p.turnover)}</td>
                    <td className={`py-2.5 pr-3 text-right font-semibold ${p.rtoPct > 10 ? "text-red-600" : "text-slate-600"}`}>{p.rtoPct}%</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{p.prepaidPct}%</td>
                  </tr>
                ))}
                {data.topPerformers.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Top 5 High RTO % States</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">State</th>
                  <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                  <th className="py-2 pr-0 text-right font-semibold">RTO%</th>
                </tr>
              </thead>
              <tbody>
                {data.topRtoStates.map((s) => (
                  <tr key={s.state} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{s.state}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{s.saleCount}</td>
                    <td className="py-2.5 pr-0 text-right font-semibold text-red-600">{s.rtoPct}%</td>
                  </tr>
                ))}
                {data.topRtoStates.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <EntityDrillDrawer entity={drawerEntity} from={from} to={to} onClose={() => setDrawerEntity(null)} />
    </div>
  );
}

/**
 * Bellavita's real dashboard shell — two slides sharing one date range:
 * "Dashboard" (Sale Performance, above) and "Agent Performance" (per-agent
 * table joining bb_sale + bb_apr, see BellavitaAgentPerformance.tsx).
 * Every number on both slides is a live aggregate over db_masmis.bb_sale/
 * bb_apr, via /api/process-performance/bellavita-sale-dashboard and
 * .../bellavita-agent-performance. KPI/layout choice was inspired by the
 * reference material the user supplied, but none of that file's own
 * numbers are used — only this app's own uploaded data. The one exception
 * is LOB Target vs Achievement: those target figures were given directly
 * by the user (not computed), since no target uploader exists for
 * Bellavita — see LOB_TARGETS in the backend service.
 */
export function BellavitaSaleDashboard() {
  const [slide, setSlide] = useState<"dashboard" | "agents">("dashboard");
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [lobFilter, setLobFilter] = useState("All");
  // The Export button is built by SaleDashboardSlide (it owns the export data)
  // but rendered here, in the same toolbar row as the tabs/date range/LOB
  // filter, instead of that slide's own separate row below -- one merged row
  // instead of two, so more KPIs fit on screen at normal zoom.
  const [exportNode, setExportNode] = useState<ReactNode>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSlide("dashboard")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${slide === "dashboard" ? "bg-rose-500 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setSlide("agents")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${slide === "agents" ? "bg-rose-500 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            Agent Performance
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
          <Select value={lobFilter} onValueChange={setLobFilter}>
            <SelectTrigger className="h-8 w-[130px] bg-white text-xs" aria-label="Filter by LOB"><SelectValue placeholder="LOB" /></SelectTrigger>
            <SelectContent>
              {LOB_FILTER_OPTIONS.map((l) => <SelectItem key={l} value={l}>{l === "All" ? "All LOBs" : l}</SelectItem>)}
            </SelectContent>
          </Select>
          {slide === "dashboard" && exportNode}
        </div>
      </div>

      {slide === "dashboard"
        ? <SaleDashboardSlide from={from} to={to} lobFilter={lobFilter} onExportNodeChange={setExportNode} />
        : <BellavitaAgentPerformance from={from} to={to} lob={lobFilter} />}
    </div>
  );
}
