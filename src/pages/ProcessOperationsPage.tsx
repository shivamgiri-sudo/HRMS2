import { Fragment, useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Briefcase, CheckCircle2, ChevronRight, Clock,
  Database, Download, Filter, Headphones, Hourglass, Lightbulb, Loader2, Minus, Package, PenLine, Radio,
  ShieldAlert, Sparkles, Target, Truck, Upload, User, UserCheck, UserPlus, Users, Users2, X,
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
// C_RED (#EF4444 on white) is ~3.78:1 -- fine for a chart line/border/tint, but
// fails WCAG AA (4.5:1) for small text. The design system's own "value text"
// red tone (#DC2626, ~4.83:1) is what the hero KPI card's text actually uses.
const C_RED_TEXT = "#DC2626";

const TOOLTIP_STYLE = { background: "#FFFFFF", border: "1px solid #334155", borderRadius: 8, fontSize: 12 } as const;
const AXIS_TICK = { fill: "#64748B", fontSize: 11 } as const;
const GRID = { strokeDasharray: "3 3", stroke: "#E2E8F0" } as const;

interface ProcessRow {
  processId: string; processName: string; processCode: string | null; metrics: number;
  branchId: string | null; branchName: string | null; branchCode: string | null;
  headcount: number; latestDate: string | null; staleDays: number | null;
}
interface Reading {
  metricKey: string; label: string; unit: string | null; direction: string | null;
  value: number | null; staleDays: number | null; latestDate: string | null;
  provisional: boolean; priorValue: number | null; targetValue: number | null;
  trend: Array<{ date: string; value: number | null; numerator: number | null; denominator: number | null }>;
  numerator: number | null; denominator: number | null;
  /** 'manual' when the latest reading was hand-entered, 'connector' when a real pipeline wrote it. */
  source: string | null;
  /** When the latest reading was actually written -- pairs with `provisional`
   *  to say HOW stale a same-day connector figure is, not just that it's today's. */
  computedAt: string | null;
}
interface Section { key: string; title: string; blurb: string | null; metrics: Reading[] }
interface FeedRow {
  metricKey: string; metricName: string; processId: string; processName: string;
  latestDate: string | null; staleDays: number | null; recentReadings: number;
  state: "ok" | "slowing" | "stopped";
}
interface NeverReportedGroup {
  metricKey: string; metricName: string; sourceObject: string;
  processCount: number; processNames: string[]; processIds: string[];
  uploadTypeCode: string | null; uploadTypeName: string | null;
  existingSourceRows: number | null;
}
interface FeedHealth {
  checkedAt: string; warnAfterDays: number; stoppedAfterDays: number;
  counts: { ok: number; slowing: number; stopped: number }; feeds: FeedRow[];
  neverReported: NeverReportedGroup[];
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
    denominator: number | null; note: string | null; source: string | null;
  }>;
}

interface AnalystScore {
  employeeId: string; employeeCode: string; name: string; designation: string | null;
  value: number | null; manual: boolean;
  reportsTo: Array<{ employeeCode: string; name: string; designation: string | null; depth: number }>;
  teamLeader: { employeeCode: string; name: string } | null;
  assistantManager: { employeeCode: string; name: string } | null;
}
interface AnalystBreakdown {
  available: boolean; reason: string | null;
  metricName: string | null; unit: string | null; direction: string | null; targetValue: number | null;
  periodFrom: string | null; periodTo: string | null;
  analysts: AnalystScore[];
}

interface VocQuote { employeeCode: string; employeeName: string; callDate: string; quote: string }
interface ClapVoiceOfCustomer {
  available: boolean; reason: string | null;
  periodFrom: string | null; periodTo: string | null; totalAuditedCalls: number;
  clapBreakdown: Array<{ clap: "Customer" | "Logistic" | "Agent" | "Product"; count: number; pct: number }>;
  quotes: {
    agent: { positive: VocQuote[]; negative: VocQuote[] };
    logistic: { positive: VocQuote[]; negative: VocQuote[] };
    product: { positive: VocQuote[]; negative: VocQuote[] };
  };
}

interface ClapDailyHeatmap {
  available: boolean; reason: string | null;
  days: Array<{
    date: string; total: number;
    counts: { Customer: number; Logistic: number; Agent: number; Product: number };
  }>;
}

interface ClapScenarioBreakdown {
  available: boolean; reason: string | null;
  clap: "Customer" | "Logistic" | "Agent" | "Product"; total: number;
  scenarios: Array<{ scenario: string; count: number; pct: number }>;
}

interface ClapScenarioCall {
  available: boolean; reason: string | null;
  calls: Array<{
    employeeCode: string; employeeName: string; callDate: string;
    qualityPercentage: number | null; hasTranscript: boolean; hasRecording: boolean;
  }>;
}

interface FatalCallsResult {
  available: boolean; reason: string | null;
  calls: Array<{
    employeeCode: string; employeeName: string; callDate: string;
    scenario: string | null; hasTranscript: boolean; hasRecording: boolean;
  }>;
}

interface EmployeeRecentCalls {
  available: boolean; reason: string | null;
  calls: Array<{
    callDate: string; qualityPercentage: number | null; scenario: string | null;
    hasTranscript: boolean; hasRecording: boolean;
  }>;
}

interface CallDetail {
  available: boolean; reason: string | null;
  employeeCode: string; employeeName: string; callDate: string;
  qualityPercentage: number | null;
  scenario: string | null; scenario1: string | null;
  transcript: string | null; recordingUrl: string | null;
  parameters: Array<{ column: string; label: string; value: boolean | null }>;
}

interface ProcessBusinessHealth {
  available: boolean; reason: string | null;
  periodCode: string;
  finance: {
    available: boolean; reason: string | null;
    revenue: number | null; revenueStatus: string | null;
    grn: number | null; agentSalary: number | null;
    agentSalaryIsRealThisMonth: boolean;
    ebit: number | null; operatingProfitPct: number | null;
  };
  headcount: {
    available: boolean; reason: string | null;
    activeHc: number; mandatedHc: number | null; gap: number | null;
    availableCount: number | null; buffer: number | null; shortfall: number | null;
  };
  hiring: {
    available: boolean; reason: string | null;
    openRequisitions: number; openPositions: number; candidatesInPipeline: number;
    hiredCount: number; pendingHiringCount: number;
  };
}

interface WorkforceCorrelationPoint {
  date: string;
  agentClapPct: number | null;
  auditedCalls: number;
  activeHeadcount: number;
  rampCohortPct: number | null;
  presentHeadcount: number | null;
  plannedHeadcount: number | null;
}
interface WorkforceCorrelation {
  available: boolean; reason: string | null;
  periodFrom: string | null; periodTo: string | null;
  daily: WorkforceCorrelationPoint[];
  weeklyAttrition: Array<{ weekStart: string; exits: number }>;
  rosterCoverageDays: number;
}

const SECTION_STYLE: Record<string, { accent: string; tint: string; icon: typeof Target }> = {
  operations: { accent: "#06B6D4", tint: "linear-gradient(135deg,#ECFEFF 0%,#CFFAFE 100%)", icon: Headphones },
  conversion: { accent: C_BLUE, tint: "linear-gradient(135deg,#EFF6FF 0%,#DBEAFE 100%)", icon: Target },
  risk: { accent: C_RED, tint: "linear-gradient(135deg,#FEF2F2 0%,#FEE2E2 100%)", icon: ShieldAlert },
  conduct: { accent: C_PURPLE, tint: "linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 100%)", icon: Sparkles },
  quality: { accent: C_GREEN, tint: "linear-gradient(135deg,#ECFDF5 0%,#D1FAE5 100%)", icon: Activity },
  hygiene: { accent: C_AMBER, tint: "linear-gradient(135deg,#FFFBEB 0%,#FEF3C7 100%)", icon: Users2 },
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

/**
 * How stale a same-day connector figure actually is -- "today" alone doesn't
 * say whether this number reflects 6am or 11pm, and for an attendance-derived
 * metric those are very different pictures (people written absent become
 * present as punches arrive through the day). Null when there's nothing to
 * time -- no reading, or a manual entry, which has no meaningful "as of".
 */
function freshnessCaption(r: Reading): { short: string; full: string } | null {
  if (!r.provisional || !r.computedAt) return null;
  const computed = new Date(r.computedAt);
  const minutesAgo = Math.round((Date.now() - computed.getTime()) / 60000);
  const hh = String(computed.getHours()).padStart(2, "0");
  const mm = String(computed.getMinutes()).padStart(2, "0");
  const ago = minutesAgo < 60 ? `${minutesAgo}m ago`
    : minutesAgo < 1440 ? `${Math.round(minutesAgo / 60)}h ago`
    : `${Math.round(minutesAgo / 1440)}d ago`;
  return {
    short: ago,
    full: `Today's figure as computed at ${hh}:${mm} (${ago}) — may not reflect attendance changes since then. It will update next time the feed runs, not live on this page.`,
  };
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

function Sparkline({ trend, color, big }: { trend: Reading["trend"]; color: string; big?: boolean }) {
  // Only points carrying a number: a gap must read as a gap. connectNulls would
  // draw a straight line through a day nobody measured.
  const points = useMemo(() => trend.filter((p) => p.value !== null), [trend]);
  const gid = useMemo(() => `g${Math.random().toString(36).slice(2, 9)}`, []);
  const h = big ? "h-16" : "h-8";
  if (points.length < 2) {
    return <div className={`${h} flex items-end text-[9px] text-slate-400`}>not enough history</div>;
  }
  return (
    <div className={`${h} -mx-0.5`}>
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
 * Was the uniform gradient KPI tile every metric rendered as, regardless of
 * whether it was fine or failing. Replaced by HeroKpiCard (below) for the one
 * metric per section actually worth that much space, and MiniKpiChip for
 * everything else -- same click-through, same status colouring, no wall of
 * identically-sized tiles. Kept as a title for the shared delta-hover copy.
 */
const DELTA_TITLE: Record<ReportPeriod, string> = {
  trend: "Against the average of everything older than a week",
  today: "Against yesterday, same time of day",
  wtd: "Against the same weekdays last week",
  mtd: "Against the same days-of-month last month",
};

/**
 * The one metric in a section most worth a reader's attention first: the one
 * with a real configured target that is currently failing it, ranked by how
 * far off target it is (relative gap, direction-aware) rather than
 * whichever happened to come first in the API response. Returns null when
 * nothing in the section has a failing target -- a hero is never forced
 * onto a section that doesn't have one; it just renders as a flat strip.
 */
function heroOf(metrics: Reading[]): Reading | null {
  const failing = metrics.filter((m) => targetStatus(m) === "fail");
  if (!failing.length) return null;
  const gap = (r: Reading) => (r.value === null || !r.targetValue) ? 0 : Math.abs(r.value - r.targetValue) / Math.abs(r.targetValue);
  return failing.reduce((worst, m) => (gap(m) > gap(worst) ? m : worst));
}

/**
 * The section's one enlarged tile — same data KpiCard would show, same
 * click-through, just given the room a metric that's actually failing its
 * target deserves: a bigger number, a bigger trend, and a name for what's
 * wrong instead of making a reader spot it among a wall of equals.
 */
function HeroKpiCard({ r, staleAfter, period, onOpen }: {
  r: Reading; staleAfter: number; period: ReportPeriod; onOpen: () => void;
}) {
  const stale = r.staleDays !== null && r.staleDays > staleAfter;
  const d = deltaOf(r);
  const caption = targetCaption(r);
  return (
    <button type="button" onClick={onOpen} title="Open the full working behind this number"
      className="group relative text-left rounded-2xl overflow-hidden border cursor-pointer transition-all duration-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 h-full flex flex-col p-4"
      style={{ borderColor: `${C_RED}40`, background: `linear-gradient(160deg, ${C_RED}12, transparent 65%)` }}>
      <div className="flex items-start gap-1.5 mb-1">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: C_RED_TEXT }}>
          <AlertTriangle size={11} className="shrink-0" />Needs attention
        </span>
        <div className="ml-auto flex shrink-0 gap-1">
          {r.source === "manual" && (
            <span title="This reading was typed in by hand, not written by an automated feed"
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9.5px] font-bold bg-white/70 text-purple-700">
              <PenLine className="h-2 w-2" />manual
            </span>
          )}
          {r.provisional && (() => {
            const fresh = freshnessCaption(r);
            return (
              <span title={fresh?.full ?? "Today is still in progress — this will move as the day fills in"}
                className="rounded px-1 py-0.5 text-[9.5px] font-bold bg-white/70 text-blue-700">
                {fresh ? `today · ${fresh.short}` : "today"}
              </span>
            );
          })()}
          {stale && (
            <span title={`Last reading ${r.staleDays} days ago — history, not current`}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9.5px] font-bold bg-white/70 text-amber-700">
              <Clock className="h-2 w-2" />{r.staleDays}d
            </span>
          )}
        </div>
      </div>
      <p className="text-[11px] font-semibold text-slate-600 leading-tight mb-1.5">{r.label}</p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[34px] font-black leading-none tabular-nums" style={{ color: C_RED_TEXT }}>
          {formatValue(r.value, r.unit)}
        </span>
        {d && (
          <span title={DELTA_TITLE[period]}
            className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${
              d.good === null ? "text-slate-500" : d.good ? "text-emerald-600" : "text-red-600"}`}>
            {d.delta === 0 ? <Minus className="h-3 w-3" />
              : d.delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {d.delta === 0 ? "flat" : Math.abs(d.delta).toFixed(1)}
          </span>
        )}
      </div>
      {caption && <p className="text-[11px] font-semibold mt-0.5" style={{ color: C_RED_TEXT }}>{caption}</p>}
      <div className="mt-auto pt-2"><Sparkline trend={r.trend} color={C_RED} big /></div>
    </button>
  );
}

/**
 * A section metric that isn't the one thing currently wrong: a small,
 * dense, flowing chip rather than a full tile — the same click-through and
 * the same status colour, just sized for "everything else is fine, here's
 * the number" instead of competing for the same visual weight as the one
 * metric that actually needs a look.
 */
function MiniKpiChip({ r, accent, staleAfter, onOpen }: {
  r: Reading; accent: string; staleAfter: number; onOpen: () => void;
}) {
  const stale = r.staleDays !== null && r.staleDays > staleAfter;
  const status = targetStatus(r);
  const color = status === "fail" ? C_RED : status === "pass" ? C_GREEN : accent;
  const d = deltaOf(r);
  return (
    <button type="button" onClick={onOpen} title="Open the full working behind this number"
      className="shrink-0 text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1.5 min-w-[122px] max-w-[168px] cursor-pointer transition-all duration-200 hover:shadow-sm hover:border-slate-300 dark:hover:border-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
      <div className="flex items-center gap-1 min-h-[1.4em]">
        <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-wide leading-tight truncate">
          {r.label}
        </p>
        <div className="ml-auto flex shrink-0 gap-0.5">
          {r.source === "manual" && <PenLine className="h-2 w-2 text-purple-500" aria-label="Typed in by hand" />}
          {r.provisional && (
            <span title={freshnessCaption(r)?.full ?? "Today is still in progress — this will move as the day fills in"}
              className="text-[9px] font-bold text-blue-600 whitespace-nowrap">
              {freshnessCaption(r)?.short ?? "today"}
            </span>
          )}
          {stale && <Clock className="h-2 w-2 text-amber-600" aria-label={`Last reading ${r.staleDays} days ago`} />}
        </div>
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={`text-sm font-bold tabular-nums ${r.value === null ? "text-slate-400 text-xs font-normal italic" : ""}`}
          style={r.value === null ? undefined : { color }}>
          {formatValue(r.value, r.unit)}
        </span>
        {d && (
          <span className={`text-[9px] font-bold ${d.good === null ? "text-slate-400" : d.good ? "text-emerald-600" : "text-red-600"}`}>
            {d.delta === 0 ? "flat" : (d.delta > 0 ? "↑" : "↓") + Math.abs(d.delta).toFixed(1)}
          </span>
        )}
      </div>
      {/* The colour alone says pass/fail; this says against what -- dropped
          silently here once already, restored because a red chip with no
          target is a verdict with no evidence. */}
      {targetCaption(r) && (
        <p className="text-[9.5px] text-slate-400 mt-0.5 truncate">{targetCaption(r)}</p>
      )}
    </button>
  );
}

const CLAP_META: Record<ClapVoiceOfCustomer["clapBreakdown"][number]["clap"], { color: string; icon: typeof User }> = {
  Customer: { color: "#3B82F6", icon: User },
  Logistic: { color: "#F59E0B", icon: Truck },
  Agent:    { color: "#E11D48", icon: Headphones },
  Product:  { color: "#10B981", icon: Package },
};

/**
 * Real root-cause classification (CLAP: Customer/Logistic/Agent/Product) and
 * verbatim customer quotes for a process's audited calls -- not a metric
 * percentage, the actual reason behind it. The taxonomy and the underlying
 * data are the same ones already proven live in the sibling Mydashboards
 * project; this reads the same upstream db_audit source, never a copy of it.
 */
function VoiceOfCustomerPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "voice-of-customer", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ClapVoiceOfCustomer>>(
      `/api/process-operations/${processId}/voice-of-customer?period=${period}`),
  });
  const [category, setCategory] = useState<"agent" | "logistic" | "product">("agent");
  const voc = data?.data;

  if (isLoading || !voc) {
    return (
      <ChartCard title="Voice of the Customer" subtitle="Real root-cause split and verbatim quotes from audited calls">
        <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading what customers actually said…
        </div>
      </ChartCard>
    );
  }
  if (!voc.available || !voc.clapBreakdown.length) {
    return (
      <ChartCard title="Voice of the Customer" subtitle="Real root-cause split and verbatim quotes from audited calls">
        <p className="text-xs text-slate-400 italic px-3 py-4">
          {voc.reason ?? "Not available for this process."}
        </p>
      </ChartCard>
    );
  }

  const quotesForCategory = voc.quotes[category];
  return (
    <ChartCard title="Voice of the Customer"
      subtitle={`${voc.totalAuditedCalls.toLocaleString("en-IN")} audited call${voc.totalAuditedCalls === 1 ? "" : "s"} — what's actually behind them, not just a score`}>
      <div className="px-3">
        {/* CLAP breakdown -- real root cause, not agent quality alone. Segments
            for Agent/Logistic/Product double as the category selector below
            (the same setCategory() the buttons already call) -- Customer has
            no quotes bucket (see the category selector comment) so stays a
            plain, non-interactive segment rather than a dead click target. */}
        <div className="flex h-6 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800">
          {voc.clapBreakdown.map((c) => {
            const clickable = c.clap === "Agent" || c.clap === "Logistic" || c.clap === "Product";
            const segCategory = c.clap.toLowerCase() as "agent" | "logistic" | "product";
            return clickable ? (
              <button key={c.clap} type="button" onClick={() => setCategory(segCategory)}
                title={`${c.clap}: ${c.pct}% (${c.count} calls) — click to see quotes`}
                className="cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                style={{ width: `${c.pct}%`, background: CLAP_META[c.clap].color }} />
            ) : (
              <div key={c.clap} title={`${c.clap}: ${c.pct}% (${c.count} calls)`}
                style={{ width: `${c.pct}%`, background: CLAP_META[c.clap].color }} />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
          {voc.clapBreakdown.map((c) => {
            const Icon = CLAP_META[c.clap].icon;
            return (
              <span key={c.clap} className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                <Icon className="h-3 w-3 shrink-0" style={{ color: CLAP_META[c.clap].color }} />
                {c.clap} {c.pct}%
              </span>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">
          Every audited call classified by its real recorded scenario — Agent means the call turned on
          agent behaviour itself (needs improvement, hold procedure, fraud complaint), not just "someone
          called." Customer/Product/Logistic mean the root issue lay elsewhere.
        </p>

        <ClapHeatmapRow processId={processId} />

        {/* Category selector -- only Agent/Logistic/Product carry verbatim quotes */}
        <div className="flex gap-1.5 mt-3">
          {(["agent", "logistic", "product"] as const).map((cat) => {
            const meta = CLAP_META[(cat.charAt(0).toUpperCase() + cat.slice(1)) as ClapVoiceOfCustomer["clapBreakdown"][number]["clap"]];
            const Icon = meta.icon;
            const n = voc.quotes[cat].positive.length + voc.quotes[cat].negative.length;
            return (
              <button key={cat} type="button" onClick={() => setCategory(cat)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold border transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                  category === cat ? "text-white" : "text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                style={category === cat ? { background: meta.color, borderColor: meta.color } : undefined}>
                <Icon className="h-3 w-3 shrink-0" />
                {cat[0].toUpperCase() + cat.slice(1)} {n > 0 && <span className="opacity-80">({n})</span>}
              </button>
            );
          })}
        </div>

        <ScenarioBreakdownRow processId={processId} period={period} category={category} />

        <div className="grid sm:grid-cols-2 gap-3 mt-2.5 mb-1">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 mb-1.5">What went well</p>
            {quotesForCategory.positive.length ? (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {quotesForCategory.positive.map((q, i) => (
                  <div key={i} className="rounded-lg bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 px-2.5 py-1.5">
                    <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">"{q.quote}"</p>
                    <p className="text-[9.5px] text-slate-400 mt-1">{q.employeeName} ({q.employeeCode}) · {q.callDate}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-[11px] text-slate-400 italic">No positive quotes recorded for this category this period.</p>}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 mb-1.5">What went wrong</p>
            {quotesForCategory.negative.length ? (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {quotesForCategory.negative.map((q, i) => (
                  <div key={i} className="rounded-lg bg-red-50/70 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 px-2.5 py-1.5">
                    <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">"{q.quote}"</p>
                    <p className="text-[9.5px] text-slate-400 mt-1">{q.employeeName} ({q.employeeCode}) · {q.callDate}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-[11px] text-slate-400 italic">No negative quotes recorded for this category this period.</p>}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

/**
 * Day x CLAP-category heat-cell matrix (Mydashboards' pivot-table idiom) --
 * which days actually carried a spike of Agent/Logistic/Product/Customer-
 * attributed calls, not just the period-aggregated share the bar above
 * shows. Always the real last 14 days (see the backend function for why
 * this ignores the page's period selector). No charting library: a plain
 * grid of cells whose background alpha is value/max, same technique
 * Mydashboards' own heatBg() uses.
 */
function ClapHeatmapRow({ processId }: { processId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "clap-heatmap", processId],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ClapDailyHeatmap>>(
      `/api/process-operations/${processId}/voice-of-customer/heatmap`),
  });
  const hm = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-[9.5px] text-slate-400 mt-2">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />Loading the 14-day pattern…
      </div>
    );
  }
  if (!hm?.available || hm.days.length < 3) {
    return null; // Not enough days to call it a "pattern" -- quietly skip rather than show a near-empty grid.
  }

  const CATS: Array<ClapVoiceOfCustomer["clapBreakdown"][number]["clap"]> = ["Agent", "Product", "Logistic", "Customer"];
  const maxByCat: Record<string, number> = {};
  for (const cat of CATS) maxByCat[cat] = Math.max(1, ...hm.days.map((d) => d.counts[cat]));

  return (
    <div className="mt-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        Last 14 days by category — darker means more calls that day, not worse
      </p>
      <div className="overflow-x-auto">
        <table className="text-[9px] border-collapse">
          <thead>
            <tr>
              <th className="text-left pr-2 py-0.5 font-semibold text-slate-400"> </th>
              {hm.days.map((d) => (
                <th key={d.date} className="px-1 py-0.5 font-normal text-slate-400 whitespace-nowrap" title={d.date}>
                  {d.date.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATS.map((cat) => (
              <tr key={cat}>
                <td className="text-right pr-2 py-0.5 font-semibold text-slate-500 whitespace-nowrap">{cat}</td>
                {hm.days.map((d) => {
                  const n = d.counts[cat];
                  const alpha = n === 0 ? 0 : Math.min(0.9, 0.15 + (n / maxByCat[cat]) * 0.75);
                  return (
                    <td key={d.date} title={`${cat} · ${d.date}: ${n} call${n === 1 ? "" : "s"}`}
                      className="w-6 h-5 text-center tabular-nums"
                      style={{ background: alpha ? `${CLAP_META[cat].color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` : undefined }}>
                      {n > 0 ? n : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Fatal calls -- Mydashboards' own dedicated red-gradient section, missing
 * from this page until now. A fatal call is one where all six of the
 * severity-critical parameters scored 0 (see FATAL_PARAM_COLS on the
 * backend) -- the domain rule that a severe miss on any of these zeroes the
 * whole call, independent of how the other parameters scored. Each row
 * opens the same CallDetailDrawer the CLAP scenario drill already uses --
 * this is the second real consumer of that component, not a speculative one.
 */
function FatalCallsPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "fatal-calls", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<FatalCallsResult>>(
      `/api/process-operations/${processId}/fatal-calls?period=${period}`),
  });
  const fc = data?.data;
  const { openCall, drawer } = useCallDetailDrawer(processId);

  return (
    <ChartCard title="Fatal calls"
      subtitle="Every audited call where a severity-critical parameter failed outright, regardless of the rest of the score">
      <div className="px-3">
        {isLoading || !fc ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Checking for fatal calls…
          </div>
        ) : !fc.available ? (
          <p className="text-xs text-slate-400 italic py-1">{fc.reason}</p>
        ) : !fc.calls.length ? (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 py-2 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">{fc.reason}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-red-200 dark:border-red-900 overflow-hidden">
            <div className="px-2.5 py-1.5 bg-gradient-to-r from-red-700 to-red-600 text-white text-[10px] font-bold uppercase tracking-wide">
              {fc.calls.length} fatal call{fc.calls.length === 1 ? "" : "s"} this period
            </div>
            <div className="max-h-56 overflow-y-auto">
              {fc.calls.map((c, i) => (
                <button key={i} type="button"
                  onClick={() => c.hasTranscript && openCall({ employeeCode: c.employeeCode, callDate: c.callDate })}
                  disabled={!c.hasTranscript}
                  title={c.hasTranscript ? "Open this call's full audit detail" : "No transcript recorded for this call"}
                  className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 text-[10.5px] border-t border-red-100 dark:border-red-900/50 first:border-t-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-50/70 dark:hover:bg-red-950/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500">
                  <span className="text-slate-500 shrink-0 w-32">{c.callDate}</span>
                  <span className="text-slate-700 dark:text-slate-300 font-medium truncate w-28 shrink-0">{c.employeeName}</span>
                  <span className="text-slate-500 truncate flex-1">{c.scenario ?? "—"}</span>
                  {c.hasTranscript ? <ChevronRight size={11} className="text-slate-300 shrink-0" /> : <span className="w-2.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {drawer}
    </ChartCard>
  );
}

/**
 * Sub-scenario drill for the selected CLAP category (Phase B of the
 * Mydashboards port, 2026-09-10 plan) -- the category selector above answers
 * "how many quotes", this answers "which real scenarios make up that share",
 * a ranked inline-bar list matching the pattern already used elsewhere on
 * this page (see the "Biggest drivers" Pareto chart). A category with no
 * classified calls this period says so rather than show an empty chart.
 */
function ScenarioBreakdownRow({ processId, period, category }: {
  processId: string; period: ReportPeriod; category: "agent" | "logistic" | "product";
}) {
  const clap = (category.charAt(0).toUpperCase() + category.slice(1)) as ClapScenarioBreakdown["clap"];
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "clap-scenarios", processId, period, clap],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ClapScenarioBreakdown>>(
      `/api/process-operations/${processId}/voice-of-customer/scenarios?period=${period}&clap=${clap}`),
  });
  const sb = data?.data;
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);
  const { openCall, drawer } = useCallDetailDrawer(processId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-2">
        <Loader2 className="h-3 w-3 animate-spin" />Loading which scenarios make up this share…
      </div>
    );
  }
  if (!sb?.available || !sb.scenarios.length) {
    return (
      <p className="text-[10px] text-slate-400 italic mt-2">
        {sb?.reason ?? "No scenario breakdown available for this category."}
      </p>
    );
  }

  return (
    <div className="mt-2.5 rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-2 bg-slate-50/50 dark:bg-slate-800/30">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
        Which real scenarios make up {clap} — {sb.total} call{sb.total === 1 ? "" : "s"} — click one for the real calls
      </p>
      <div className="space-y-1">
        {sb.scenarios.slice(0, 6).map((s) => {
          const open = expandedScenario === s.scenario;
          return (
            <Fragment key={s.scenario}>
              <button type="button" onClick={() => setExpandedScenario(open ? null : s.scenario)}
                className="w-full flex items-center gap-2 cursor-pointer rounded hover:bg-white dark:hover:bg-slate-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 py-0.5">
                <ChevronRight size={10} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                <span className="text-[10px] text-slate-600 dark:text-slate-300 w-28 shrink-0 truncate text-left" title={s.scenario}>
                  {s.scenario}
                </span>
                <div className="flex-1 h-3.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${Math.max(2, s.pct)}%`, background: CLAP_META[clap].color }} />
                </div>
                <span className="text-[9.5px] tabular-nums text-slate-500 w-14 shrink-0 text-right">
                  {s.count} ({s.pct}%)
                </span>
              </button>
              {open && (
                <ScenarioCallsList processId={processId} period={period} clap={clap} scenario={s.scenario}
                  onSelectCall={openCall} />
              )}
            </Fragment>
          );
        })}
      </div>
      {drawer}
    </div>
  );
}

/** The real calls behind one clicked scenario -- click a row to open its full audit detail. */
function ScenarioCallsList({ processId, period, clap, scenario, onSelectCall }: {
  processId: string; period: ReportPeriod; clap: ClapScenarioBreakdown["clap"]; scenario: string;
  onSelectCall: (call: { employeeCode: string; callDate: string }) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "clap-scenario-calls", processId, period, clap, scenario],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ClapScenarioCall>>(
      `/api/process-operations/${processId}/voice-of-customer/scenario-calls?period=${period}&clap=${clap}&scenario=${encodeURIComponent(scenario)}`),
  });
  const sc = data?.data;

  if (isLoading) {
    return (
      <div className="pl-4 py-1 flex items-center gap-1.5 text-[9.5px] text-slate-400">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />Loading the real calls…
      </div>
    );
  }
  if (!sc?.available || !sc.calls.length) {
    return <p className="pl-4 py-1 text-[9.5px] text-slate-400 italic">{sc?.reason ?? "No calls to show."}</p>;
  }

  return (
    <div className="pl-4 pr-1 py-1 space-y-0.5 max-h-40 overflow-y-auto">
      {sc.calls.map((c, i) => (
        <button key={i} type="button"
          onClick={() => c.hasTranscript && onSelectCall({ employeeCode: c.employeeCode, callDate: c.callDate })}
          disabled={!c.hasTranscript}
          title={c.hasTranscript ? "Open this call's full audit detail" : "No transcript recorded for this call"}
          className="w-full flex items-center gap-2 text-left rounded px-1 py-0.5 text-[9.5px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-white dark:hover:bg-slate-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
          <span className="text-slate-500 shrink-0">{c.callDate}</span>
          <span className="text-slate-700 dark:text-slate-300 truncate">{c.employeeName}</span>
          <span className="ml-auto tabular-nums font-semibold shrink-0"
            style={{ color: c.qualityPercentage === null ? undefined : c.qualityPercentage >= 80 ? C_GREEN : C_RED_TEXT }}>
            {c.qualityPercentage === null ? "—" : `${c.qualityPercentage.toFixed(0)}%`}
          </span>
          {c.hasTranscript ? <ChevronRight size={10} className="text-slate-300 shrink-0" /> : <span className="w-2.5 shrink-0" />}
        </button>
      ))}
    </div>
  );
}

/**
 * The open/close state + drawer render that all three CallDetailDrawer
 * consumers (CLAP scenario drill, Fatal Calls, an analyst's own recent
 * calls) were each independently carrying -- the exact same four lines of
 * `useState` + conditional render, tripled. CallDetailDrawer itself was
 * already the one real shared component; this just stops re-deriving the
 * state that opens it. `openCall` is stable across renders (useCallback),
 * so passing it straight into a child's onSelectCall prop never causes an
 * extra re-render of that child.
 */
function useCallDetailDrawer(processId: string): {
  openCall: (call: { employeeCode: string; callDate: string }) => void;
  drawer: React.ReactNode;
} {
  const [selectedCall, setSelectedCall] = useState<{ employeeCode: string; callDate: string } | null>(null);
  const openCall = useCallback((call: { employeeCode: string; callDate: string }) => setSelectedCall(call), []);
  const drawer = selectedCall ? (
    <CallDetailDrawer processId={processId} employeeCode={selectedCall.employeeCode}
      callDate={selectedCall.callDate} onClose={() => setSelectedCall(null)} />
  ) : null;
  return { openCall, drawer };
}

/**
 * The call-detail drawer (Phase C of the Mydashboards port) -- transcript on
 * the left, this call's own scored parameters on the right, so the raw
 * evidence and the judgment sit in one view. Same right-side Sheet drawer
 * convention already used elsewhere on this page, sized to this page's
 * widest existing drawer since a two-pane view needs the room.
 */
function CallDetailDrawer({ processId, employeeCode, callDate, onClose }: {
  processId: string; employeeCode: string; callDate: string; onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "call-detail", processId, employeeCode, callDate],
    queryFn: () => hrmsApi.get<HrmsEnvelope<CallDetail>>(
      `/api/process-operations/${processId}/call-detail?employeeCode=${encodeURIComponent(employeeCode)}&callDate=${encodeURIComponent(callDate)}`),
  });
  const cd = data?.data;

  return (
    <Sheet open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[63rem] p-0 overflow-y-auto">
        <div className="px-5 py-4 bg-gradient-to-br from-slate-800 to-slate-900 text-white">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold">{cd?.employeeName ?? employeeCode}</p>
              <p className="text-[11px] text-white/60 mt-0.5">{callDate}
                {cd?.scenario && ` · ${cd.scenario}${cd.scenario1 ? ` — ${cd.scenario1}` : ""}`}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="ml-auto p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1">
              <X size={15} />
            </button>
          </div>
          {cd?.qualityPercentage !== null && cd?.qualityPercentage !== undefined && (
            <p className="text-[11px] mt-2">
              Quality score: <span className="font-bold tabular-nums">{cd.qualityPercentage.toFixed(1)}%</span>
            </p>
          )}
        </div>

        {isLoading || !cd ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 px-5 py-6">
            <Loader2 className="h-4 w-4 animate-spin" />Loading this call's transcript and scored parameters…
          </div>
        ) : !cd.available ? (
          <p className="text-sm text-slate-400 italic px-5 py-6">{cd.reason}</p>
        ) : (
          <div className="flex flex-col lg:flex-row">
            {/* Left: raw evidence -- the transcript, unformatted, plus the recording if one exists. */}
            <div className="flex-1 min-w-0 px-5 py-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Transcript</p>
              {cd.recordingUrl && (
                <audio controls preload="metadata" src={cd.recordingUrl} className="w-full h-9 mb-3" />
              )}
              {cd.transcript ? (
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 p-3 max-h-[28rem] overflow-y-auto">
                  <p className="text-[12px] font-mono whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">
                    {cd.transcript}
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 italic">No transcript recorded for this call.</p>
              )}
            </div>
            {/* Right: the judgment -- every scored parameter, pass/fail/blank. */}
            <div className="w-full lg:w-64 shrink-0 px-5 py-4 bg-slate-50/50 dark:bg-slate-800/30">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Scored parameters</p>
              <div className="space-y-1">
                {cd.parameters.map((p) => (
                  <div key={p.column} className="flex items-center gap-1.5 text-[10.5px] rounded px-1.5 py-1"
                    style={{ background: p.value === null ? undefined : p.value ? "#DCFCE7" : "#FEE2E2" }}>
                    <span className="shrink-0 w-3 font-bold"
                      style={{ color: p.value === null ? "#94A3B8" : p.value ? "#166534" : "#991B1B" }}>
                      {p.value === null ? "—" : p.value ? "✓" : "✗"}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">{p.label}</span>
                  </div>
                ))}
              </div>
              {cd.parameters.every((p) => p.value !== false) && (
                <p className="text-[9.5px] text-slate-400 italic mt-2">No parameters failed on this call.</p>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Root Cause vs. Workforce — the question the CLAP panel above can't answer
 * alone: is a rise in agent-attributed complaints a coaching problem, or is
 * it what a green floor or an understaffed shift looks like from the
 * customer's side? No correlation coefficient is computed here on purpose —
 * with a handful of noisy weekly counts per process that would be false
 * precision, not insight. This is a plain juxtaposition on a shared date
 * axis; the reader's own eye does the judging.
 */
function WorkforceCorrelationPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "workforce-correlation", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<WorkforceCorrelation>>(
      `/api/process-operations/${processId}/workforce-correlation?period=${period}`),
  });
  const wc = data?.data;

  if (isLoading || !wc) {
    return (
      <ChartCard title="Root Cause vs. Workforce" subtitle="Agent-attributed complaints against staffing and tenure, same dates">
        <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Lining up the two sides…
        </div>
      </ChartCard>
    );
  }
  if (!wc.available || wc.daily.length < 3) {
    return (
      <ChartCard title="Root Cause vs. Workforce" subtitle="Agent-attributed complaints against staffing and tenure, same dates">
        <p className="text-xs text-slate-400 italic px-3 py-4">
          {wc.reason ?? "Not enough history yet to line these up."}
        </p>
      </ChartCard>
    );
  }

  const rosterDays = wc.daily.length;
  const hasRoster = wc.rosterCoverageDays > 0;

  return (
    <ChartCard title="Root Cause vs. Workforce"
      subtitle="Agent-attributed complaint share against ramp-cohort tenure and staffing — same dates, side by side, not a claim of cause">
      <div className="px-3 space-y-4">
        {/* Row 1: agent-CLAP share vs. ramp-cohort tenure share -- both percentages, one axis */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
            Agent-attributed complaints vs. green-floor share
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={280}>
              <LineChart data={wc.daily} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => String(v).slice(5)} minTickGap={22} />
                <YAxis domain={[0, 100]} unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => [v === null ? "no data" : `${v.toFixed(1)}%`,
                    n === "agentClapPct" ? "Agent-attributed calls" : "≤30-day tenure share"]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                  formatter={(n: string) => n === "agentClapPct" ? "Agent-attributed calls" : "≤30-day tenure share"} />
                <Line type="monotone" dataKey="agentClapPct" stroke={CLAP_META.Agent.color} strokeWidth={2}
                  dot={false} isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="rampCohortPct" stroke={C_AMBER} strokeWidth={2}
                  strokeDasharray="4 2" dot={false} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row 2: planned vs. present headcount -- both headcounts, one axis. Roster is real
            but sparse; say so honestly instead of drawing a mostly-empty line as zero. */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
            Staffing: rostered vs. actually present
          </p>
          {hasRoster ? (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={280}>
                  <LineChart data={wc.daily} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
                      tickFormatter={(v) => String(v).slice(5)} minTickGap={22} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE}
                      formatter={(v: number, n: string) => [v === null ? "no roster data" : v,
                        n === "plannedHeadcount" ? "Rostered" : "Present"]} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                      formatter={(n: string) => n === "plannedHeadcount" ? "Rostered" : "Present"} />
                    <Line type="monotone" dataKey="plannedHeadcount" stroke={C_PURPLE} strokeWidth={2}
                      dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line type="monotone" dataKey="presentHeadcount" stroke={C_BLUE} strokeWidth={2}
                      strokeDasharray="4 2" dot={false} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[9.5px] text-slate-400 mt-1">
                Roster has real published data for {wc.rosterCoverageDays} of {rosterDays} days shown — gaps are
                where nothing was published, not zero staff.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-slate-400 italic py-2">
              This process has no published roster for this period, so staffing can't be shown against actual
              presence — that side stays blank rather than a guessed number.
            </p>
          )}
        </div>

        {/* Row 3: attrition, weekly -- its own count axis, its own chart */}
        {wc.weeklyAttrition.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Exits by week</p>
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={wc.weeklyAttrition} margin={{ top: 4, right: 16, bottom: 0, left: -14 }}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="weekStart" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => String(v).slice(5)} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={20} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, "Exits"]} />
                  <Bar dataKey="exits" fill={C_RED} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <p className="text-[9.5px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
          These lines are shown together, not correlated — with a handful of weekly events per process, a
          computed correlation would be more confident than the data actually is. Read it by eye: do agent
          complaints move with a green floor or a staffing gap, or don't they.
        </p>
      </div>
    </ChartCard>
  );
}

function currency(v: number | null): string {
  if (v === null) return "no data";
  const rounded = Math.round(v);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}₹${Math.abs(rounded).toLocaleString("en-IN")}`;
}

const REVENUE_STATUS_LABEL: Record<string, string> = {
  recognized: "Recognized",
  configured_no_delivery: "Configured (no delivery feed)",
  accounting_fallback: "Fallback — no revenue rule was in effect",
  missing_rule: "No revenue rule configured",
};

/** A single stat in the Business Health grid — value, its own honest-null state, a caption. */
function HealthStat({ label, value, caption, tone, icon: Icon, fillPct, fillGood }: {
  label: string; value: string; caption?: string; tone?: "good" | "bad" | "neutral"; icon?: typeof Users;
  /** 0-100 -- when set, draws a Mydashboards-style fill bar under the value
   *  (e.g. headcount/mandate). Clamped to a 4% minimum so a real-but-tiny
   *  fill never reads as visually empty, same as the reference component. */
  fillPct?: number; fillGood?: boolean;
}) {
  const color = tone === "good" ? C_GREEN : tone === "bad" ? C_RED_TEXT : C_SLATE;
  const noData = value === "no data";
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-2 min-w-[128px] transition-shadow hover:shadow-sm">
      {/* MetricCard idiom (Mydashboards): a solid-color top strip instead of a
          tinted border, so the accent stays crisp at this radius, plus the
          icon chip's background derived from the exact same hex the strip
          uses -- never a separately-chosen "-light" shade that can drift. */}
      {!noData && <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />}
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-wide truncate">{label}</p>
        {Icon && (
          <span className="shrink-0 rounded-md p-1" style={{ background: noData ? undefined : `${color}18` }}>
            <Icon className="h-3 w-3" style={{ color: noData ? "#94A3B8" : color }} />
          </span>
        )}
      </div>
      <p className={`text-sm font-bold tabular-nums mt-0.5 ${noData ? "text-slate-400 text-xs font-normal italic" : ""}`}
        style={noData ? undefined : { color }}>
        {value}
      </p>
      {caption && <p className="text-[9px] text-slate-400 mt-0.5 leading-tight">{caption}</p>}
      {fillPct !== undefined && (
        <div className="mt-1.5 h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(4, fillPct))}%`, background: fillGood ? C_GREEN : C_RED_TEXT }} />
        </div>
      )}
    </div>
  );
}

interface Insight {
  severity: "critical" | "warning";
  /** What the reader would spot first, one line. */
  what: string;
  /** Why -- the real number(s) this insight is derived from, not a guess. */
  why: string;
  /** Impact -- what's actually affected by this, scoped to what's provably
   *  true from data already on screen (never a fabricated cost/revenue
   *  estimate this page has no way to compute). */
  impact: string;
  /** Action -- the concrete next step, derived from real state (an open
   *  requisition existing or not, a section existing to drill into). */
  action: string;
  sectionKey: string;
}

/**
 * The "read this first" strip at the top of the Process Performance Card —
 * the same idea as Mydashboards' rule-based root-cause/insight panels, but
 * every card here is derived live from this page's own already-verified
 * numbers (targetStatus() against a metric's real configured target, the
 * same headcount/shortfall this page already computed), not static canned
 * copy keyed by metric name. An insight that can't point at a real target
 * miss or a real shortfall simply isn't generated -- an empty panel is the
 * honest "nothing worth flagging" case, not a placeholder. Structured as
 * What/Why/Impact/Action (Mydashboards' narrative-card idiom) rather than a
 * flat title+detail -- every field still traces to a real value, "Impact"
 * included: it describes what's affected in this system's own terms
 * (mandate, section, target), never an invented rupee/time cost.
 */
function deriveInsights(ops: Operations, health: ProcessBusinessHealth | undefined): Insight[] {
  const insights: Insight[] = [];

  if (health?.available && health.headcount.available && (health.headcount.shortfall ?? 0) > 0) {
    const sf = health.headcount.shortfall!;
    insights.push({
      severity: "critical",
      what: `Understaffed by ${sf} against mandate`,
      why: `${health.headcount.activeHc} active headcount against a sanctioned ${health.headcount.mandatedHc}.`,
      impact: `${sf} seat${sf === 1 ? "" : "s"} short of mandate -- every operations metric below is being produced by fewer people than this process is sanctioned for.`,
      action: health.hiring.openRequisitions > 0
        ? `${health.hiring.openRequisitions} requisition${health.hiring.openRequisitions === 1 ? "" : "s"} already open — chase fulfillment, not a new raise.`
        : "No requisition raised yet for this gap — that's the actionable next step.",
      sectionKey: "operations",
    });
  }

  const sectionOrder = ["operations", "conversion", "risk", "conduct", "quality", "hygiene"];
  for (const key of sectionOrder) {
    const section = ops.sections.find((s) => s.key === key);
    if (!section) continue;
    const fails = section.metrics
      .filter((m) => targetStatus(m) === "fail")
      // Worst-first: rank by how far the value sits from its own target, in
      // the metric's own unit -- a metric with no target never reaches here
      // (targetStatus() returns null), so this division is always real.
      .sort((a, b) => Math.abs(b.value! - b.targetValue!) - Math.abs(a.value! - a.targetValue!));
    if (!fails.length) continue;
    const worst = fails[0];
    insights.push({
      severity: key === "hygiene" ? "warning" : "critical",
      what: `${worst.label} missing target`,
      why: `${formatValue(worst.value, worst.unit)} against ${targetCaption(worst) ?? "its configured target"}.`,
      impact: fails.length > 1
        ? `${fails.length - 1} more metric${fails.length - 1 === 1 ? "" : "s"} in ${section.title} also missing target — not an isolated miss.`
        : `The only metric in ${section.title} missing target this period.`,
      action: `Open ${section.title} below for the full breakdown.`,
      sectionKey: key,
    });
  }

  return insights;
}

interface ParetoBar { label: string; gapPct: number; cumulativePct: number }

/**
 * CallMaster's Pareto pattern (bar = driver size, line = cumulative %) for
 * "which target misses matter most" -- every metric that's missing target,
 * ranked by relative gap (|value - target| / target, so a percentage metric
 * and a seconds metric are comparable on the same axis) rather than raw
 * units, worst first, cumulative % running to 100 by construction since it's
 * the same fails list divided by its own total.
 */
function deriveParetoData(ops: Operations): ParetoBar[] {
  const fails = [...ops.sections.flatMap((s) => s.metrics), ...ops.ungrouped]
    .filter((m) => targetStatus(m) === "fail" && m.targetValue !== 0)
    .map((m) => ({ label: m.label, gap: Math.abs((m.value! - m.targetValue!) / m.targetValue!) * 100 }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 8); // worst 8 -- a real Pareto reads as a curve, not a wall of bars
  const total = fails.reduce((s, f) => s + f.gap, 0);
  if (!total) return [];
  let running = 0;
  return fails.map((f) => {
    running += f.gap;
    return { label: f.label, gapPct: Math.round(f.gap * 10) / 10, cumulativePct: Math.round((running / total) * 1000) / 10 };
  });
}

/**
 * One insight, collapsed to just "What" by default (keeps the panel scannable
 * when there are several), expanding on click into the Why/Impact/Action
 * quadrants Mydashboards' own AI Insight cards use -- What is the card's own
 * header rather than a fourth quadrant, since repeating it inside the
 * expanded body would just restate the title.
 */
function InsightCard({ insight: ins }: { insight: Insight }) {
  const [open, setOpen] = useState(false);
  const color = ins.severity === "critical" ? C_RED_TEXT : C_AMBER;
  return (
    <button type="button" onClick={() => setOpen((v) => !v)}
      className="text-left rounded-lg border px-2.5 py-2 cursor-pointer transition-shadow hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={{ borderColor: `${color}40`, background: `${color}0c` }}>
      <div className="flex items-start gap-1.5">
        <p className="text-[11px] font-bold flex-1" style={{ color }}>{ins.what}</p>
        <ChevronRight size={12} className={`shrink-0 mt-0.5 transition-transform ${open ? "rotate-90" : ""}`} style={{ color }} />
      </div>
      {!open && <p className="text-[10.5px] text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">{ins.why}</p>}
      {open && (
        <div className="mt-1.5 grid grid-cols-1 gap-1.5">
          {([["Why", ins.why], ["Impact", ins.impact], ["Action", ins.action]] as const).map(([label, text]) => (
            <div key={label} className="rounded bg-white/70 dark:bg-slate-900/40 px-2 py-1">
              <p className="text-[8.5px] font-bold uppercase tracking-wide" style={{ color }}>{label}</p>
              <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-snug mt-0.5">{text}</p>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

function ProcessCardInsightsPanel({ processId, ops }: { processId: string; ops: Operations }) {
  // Shares the exact queryKey BusinessHealthPanel uses -- react-query dedupes
  // this against that component's own fetch, so this panel costs zero extra
  // network requests, not a second poll of the same endpoint.
  const { data } = useQuery({
    queryKey: ["process-operations", "business-health", processId],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessBusinessHealth>>(
      `/api/process-operations/${processId}/business-health`),
    staleTime: 60_000,
  });
  const health = data?.data;
  const insights = useMemo(() => deriveInsights(ops, health), [ops, health]);
  const pareto = useMemo(() => deriveParetoData(ops), [ops]);

  if (!insights.length) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
        <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
          Nothing missing target right now — headcount, quality and hygiene are all within their configured targets.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-2">
        <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Read this first — {insights.length} thing{insights.length === 1 ? "" : "s"} missing target
        </p>
      </div>
      <div className="grid gap-2 px-3.5 pb-3.5 sm:grid-cols-2">
        {insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
      </div>
      {pareto.length >= 2 && (
        <div className="px-3.5 pb-3.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
            Biggest drivers — relative gap vs. each metric's own target, ranked worst first
          </p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pareto} margin={{ top: 4, right: 24, bottom: 0, left: -14 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false}
                  interval={0} angle={-20} textAnchor="end" height={46} />
                <YAxis yAxisId="left" unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => [`${v.toFixed(1)}%`, n === "gapPct" ? "Gap vs. target" : "Cumulative"]} />
                <Bar yAxisId="left" dataKey="gapPct" radius={[3, 3, 0, 0]} name="gapPct">
                  {pareto.map((p, i) => <Cell key={p.label} fill={i === 0 ? C_RED_TEXT : C_AMBER} />)}
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="cumulativePct" name="cumulativePct"
                  stroke={C_SLATE} strokeWidth={1.5} dot={{ r: 2.5, fill: C_SLATE }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Revenue/GRN/expenses/Op%, headcount vs. mandate, and hiring pipeline — for
 * this one process, this month. Every figure here is read from real, already
 * working engines elsewhere in this repo (process-pnl, workforce-mandate,
 * job-requisition), not a new calculation — what's new is showing them
 * together and saying plainly where each one's own real gap applies to THIS
 * process (no mandate configured, no revenue rule in effect this month, no
 * open requisitions right now). Shrinkage is left out on purpose: the
 * dedicated shrinkage table has never been populated at process grain for
 * any process in this system yet.
 */
function BusinessHealthPanel({ processId }: { processId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "business-health", processId],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessBusinessHealth>>(
      `/api/process-operations/${processId}/business-health`),
    staleTime: 60_000,
  });
  const health = data?.data;

  if (isLoading || !health) {
    return (
      <ChartCard title="Business Health" subtitle="Revenue, headcount and hiring for this process, this month">
        <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Pulling P&L, mandate and hiring data…
        </div>
      </ChartCard>
    );
  }

  const { finance, headcount, hiring, periodCode } = health;
  return (
    <ChartCard title="Business Health" subtitle={`${periodCode} — revenue, headcount and hiring for this process`}>
      <div className="px-3 space-y-4">
        {/* Finance */}
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
            <span className="w-1 h-4 rounded-full shrink-0" style={{ background: C_BLUE }} />
            Revenue &amp; margin
          </p>
          {finance.available ? (
            <>
              <div className="flex flex-wrap gap-2">
                <HealthStat label="Revenue" value={currency(finance.revenue)}
                  caption={finance.revenueStatus ? REVENUE_STATUS_LABEL[finance.revenueStatus] ?? finance.revenueStatus : undefined}
                  tone={finance.revenue && finance.revenue > 0 ? "good" : "neutral"} />
                <HealthStat label="GRN (vendor cost)" value={currency(finance.grn)} />
                {finance.agentSalaryIsRealThisMonth ? (
                  <>
                    <HealthStat label="Agent salary" value={currency(finance.agentSalary)} />
                    <HealthStat label="EBIT" value={currency(finance.ebit)}
                      tone={finance.ebit === null ? "neutral" : finance.ebit >= 0 ? "good" : "bad"} />
                    <HealthStat label="Op %" value={finance.operatingProfitPct === null ? "no data" : `${finance.operatingProfitPct.toFixed(1)}%`}
                      tone={finance.operatingProfitPct === null ? "neutral" : finance.operatingProfitPct >= 0 ? "good" : "bad"} />
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-2.5 py-2 flex items-center max-w-[280px]">
                    <p className="text-[10.5px] text-slate-400 italic">
                      Agent salary, EBIT and Op % withheld — no payroll run processed for this month yet.
                    </p>
                  </div>
                )}
              </div>
              {finance.revenue === 0 && (
                <p className="text-[9.5px] text-slate-400 italic mt-1.5">
                  Revenue shows ₹0 because no revenue rule was in effect for this exact month — not because the
                  process earned nothing. GRN above is real regardless.
                </p>
              )}
              {!finance.agentSalaryIsRealThisMonth && finance.revenue !== null && finance.revenue > 0 && (
                <p className="text-[9.5px] text-amber-600 dark:text-amber-400 mt-1.5">
                  Revenue for the month is a recognized figure (the committed monthly rate, not pro-rated by day) —
                  it isn't directly comparable to a cost figure that hasn't been produced yet either.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-slate-400 italic py-1">{finance.reason}</p>
          )}
        </div>

        {/* Headcount vs mandate */}
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
            <span className="w-1 h-4 rounded-full shrink-0" style={{ background: C_PURPLE }} />
            Headcount vs. sanctioned mandate
          </p>
          <div className="flex flex-wrap gap-2">
            <HealthStat label="Headcount" value={String(headcount.activeHc)} icon={Users}
              caption={headcount.available && headcount.mandatedHc ? `of ${headcount.mandatedHc} mandate` : undefined}
              fillPct={headcount.available && headcount.mandatedHc ? (headcount.activeHc / headcount.mandatedHc) * 100 : undefined}
              fillGood={headcount.available && headcount.mandatedHc ? headcount.activeHc >= headcount.mandatedHc : undefined} />
            {headcount.available ? (
              <>
                <HealthStat label="Mandate" value={String(headcount.mandatedHc)} icon={Target}
                  caption={headcount.reason ? "see note below" : undefined} />
                <HealthStat label="Available count" value={String(headcount.availableCount)} icon={UserCheck}
                  caption="sanctioned seats still open" tone={headcount.availableCount === 0 ? "neutral" : "bad"} />
                <HealthStat label="Buffer" value={`+${headcount.buffer}`} icon={ArrowUpRight}
                  caption="staffed above mandate" tone={headcount.buffer! > 0 ? "good" : "neutral"} />
                <HealthStat label="Shortfall" value={`-${headcount.shortfall}`} icon={AlertTriangle}
                  caption="staffed below mandate" tone={headcount.shortfall! > 0 ? "bad" : "neutral"} />
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-2.5 py-2 flex items-center">
                <p className="text-[10.5px] text-slate-400 italic">{headcount.reason}</p>
              </div>
            )}
          </div>
          {headcount.available && headcount.reason && (
            <p className="text-[9.5px] text-amber-600 dark:text-amber-400 mt-1.5">{headcount.reason}</p>
          )}
        </div>

        {/* Hiring pipeline */}
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
            <span className="w-1 h-4 rounded-full shrink-0" style={{ background: C_AMBER }} />
            Hiring pipeline
          </p>
          <div className="flex flex-wrap gap-2">
            <HealthStat label="Requisition open" value={String(hiring.openRequisitions)} icon={Briefcase}
              tone={hiring.openRequisitions > 0 ? "neutral" : "good"} />
            <HealthStat label="Hired count" value={String(hiring.hiredCount)} icon={UserPlus}
              caption="filled via requisition, ever" tone="good" />
            <HealthStat label="Pending hiring count" value={String(hiring.pendingHiringCount)} icon={Hourglass}
              caption="requested minus fulfilled" tone={hiring.pendingHiringCount > 0 ? "bad" : "good"} />
            <HealthStat label="Candidates in pipeline" value={String(hiring.candidatesInPipeline)} icon={Users2}
              caption="matched by process name, not a hard link" />
          </div>
          {hiring.openRequisitions === 0 && hiring.candidatesInPipeline === 0 && (
            <p className="text-[9.5px] text-slate-400 italic mt-1.5">
              Nothing open right now — this is a genuinely empty pipeline, not a missing feature.
            </p>
          )}
        </div>

        <p className="text-[9.5px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
          Shrinkage isn't shown here: the dedicated shrinkage table has no process-level data for any
          process yet — the nightly job that fills it only runs at branch/org level today.
        </p>
      </div>
    </ChartCard>
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

const FUNNEL_STAGE_COLORS = [C_SLATE, C_BLUE, C_PURPLE, C_GREEN];

/**
 * The same four funnel metrics FunnelChart already plots over time, but as a
 * snapshot funnel of the latest reading only (Mydashboards' hand-rolled
 * FunnelBar/JourneyFunnel idiom) -- each stage's own width IS its %, so the
 * shape of the funnel narrowing is visible at a glance, with the stage-to-
 * stage drop-off called out underneath. No new data: every value here is
 * the same Reading.value FunnelChart already receives.
 */
function FunnelSnapshot({ metrics }: { metrics: Reading[] }) {
  const stages: Array<[string, string]> = [
    ["FUNNEL_SCORED_PCT", "Scored"], ["FUNNEL_OPENING_PCT", "Opening"],
    ["FUNNEL_OFFER_PCT", "Offer"], ["FUNNEL_SALE_PCT", "Sale"],
  ];
  const present = stages
    .map(([key, label]) => ({ key, label, value: metrics.find((m) => m.metricKey === key)?.value ?? null }))
    .filter((s): s is { key: string; label: string; value: number } => s.value !== null);
  if (present.length < 2) return null;

  return (
    <ChartCard title="Conversion funnel — latest reading"
      subtitle="Each bar's width is its own % of all scored calls; drop-off is stage-to-stage">
      <div className="px-3 space-y-2 py-1">
        {present.map((s, i) => {
          const prevValue = i > 0 ? present[i - 1].value : null;
          const dropoffPct = prevValue !== null && prevValue > 0 ? ((prevValue - s.value) / prevValue) * 100 : null;
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="font-semibold text-slate-600 dark:text-slate-300">{s.label}</span>
                <span className="tabular-nums font-bold text-slate-700 dark:text-slate-200">{s.value.toFixed(1)}%</span>
              </div>
              <div className="h-5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(4, s.value))}%`, background: FUNNEL_STAGE_COLORS[i] }} />
              </div>
              {dropoffPct !== null && dropoffPct > 0.05 && (
                <p className="text-[9px] mt-0.5" style={{ color: C_RED_TEXT }}>
                  ↓ {dropoffPct.toFixed(1)}% drop from {present[i - 1].label}
                </p>
              )}
            </div>
          );
        })}
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
              className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
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

/** One field, RFC-4180 quoted only when it actually needs to be. */
function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Client-side only — the rows are already on the page (this endpoint's own
 * response), so exporting them is a local file write, not a second request.
 * A BOM is prepended so Excel opens the file as UTF-8 instead of guessing.
 */
function downloadCsv(filename: string, columns: string[], rows: Array<Record<string, unknown>>) {
  const lines = [
    columns.map(csvField).join(","),
    ...rows.map((row) => columns.map((c) => csvField(row[c])).join(",")),
  ];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const sortedRows = useMemo(() => {
    if (!r || !sort) return r?.rows ?? [];
    const { col, dir } = sort;
    return [...r.rows].sort((a, b) => {
      const av = a[col]; const bv = b[col];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      // Numeric columns compare as numbers even though the value arrives as
      // an unknown (raw DB rows carry strings/numbers/dates all mixed) --
      // fall back to locale string compare for anything that isn't a clean
      // number on both sides, same "don't guess" rule as formatCellValue.
      const an = Number(av); const bn = Number(bv);
      const cmp = (!Number.isNaN(an) && !Number.isNaN(bn))
        ? an - bn
        : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [r, sort]);
  const toggleSort = (col: string) => setSort((s) =>
    s?.col === col ? (s.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" });
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
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[10px] text-slate-500">
                {r.sourceObject} · {r.totalRows?.toLocaleString()} row{r.totalRows === 1 ? "" : "s"}
                {r.truncated ? ` · showing first ${r.rows.length.toLocaleString()}` : ""}
              </p>
              <button type="button"
                onClick={() => downloadCsv(`${metricKey}_${date}.csv`, r.columns, sortedRows)}
                title="Download the rows shown here as a .csv file"
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded">
                <Download size={11} />CSV
              </button>
            </div>
            <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-800 max-h-56 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="bg-white dark:bg-slate-900 text-slate-400 sticky top-0">
                  <tr>{r.columns.map((c) => (
                    <th key={c} className="text-left px-2 py-1 font-semibold font-mono">
                      <button type="button" onClick={() => toggleSort(c)}
                        className="inline-flex items-center gap-0.5 cursor-pointer hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded">
                        {c}
                        {sort?.col === c && <span className="text-[8px]">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => (
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
 * The deepest level of the drill-down: not a row of raw data, a row per
 * PERSON — name, employee code, their own score on this exact metric, real
 * designation, and the real reporting chain (Team Leader / Assistant Manager
 * picked out of it when one genuinely exists, honestly absent when it
 * doesn't — see the backend's TL_PATTERN/AM_PATTERN comment). Only meaningful
 * for a metric attributed to individual employees; a whole-process metric
 * says so rather than render an empty table.
 */
interface EmployeeImportOutcome {
  row: number; employeeCode: string; scoreDate: string; value: number | null;
  ok: boolean; message?: string;
}

/**
 * The deepest-level manual path: hand-enter a score per analyst for a metric
 * that genuinely has no automated per-employee feed. Only ever shown when the
 * backend has already confirmed this metric IS 'employee'-kind but has zero
 * automated rows this period — never offered for a whole-process metric
 * (nothing to attribute to) or one that already has real per-employee data
 * (an upload here would just never be read; see getMetricAnalystBreakdown's
 * fallback ordering).
 */
function EmployeeUploadBox({ processId, metricKey, period, onSaved }: {
  processId: string; metricKey: string; period: ReportPeriod; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [preview, setPreview] = useState<EmployeeImportOutcome[] | null>(null);
  const [previewDryRun, setPreviewDryRun] = useState(true);

  const parseRows = (text: string) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const body = lines.length && /^employee[_ ]?code\s*,/i.test(lines[0]) ? lines.slice(1) : lines;
    return body.map((line) => {
      const [employeeCode, scoreDate, value, ...noteParts] = line.split(",").map((c) => c.trim());
      return { employeeCode, scoreDate, value, note: noteParts.join(",") || undefined };
    });
  };
  const run = (dryRun: boolean) =>
    hrmsApi.post<HrmsEnvelope<{ imported: number; errors: Array<{ row: number; message: string }>; outcomes: EmployeeImportOutcome[] }>>(
      `/api/process-data-source/${processId}/metric/${metricKey}/employee-import`,
      { rows: parseRows(pasted), dry_run: dryRun },
    );
  const check = useMutation({
    mutationFn: () => run(true),
    onSuccess: (res) => { setPreview(res.data.outcomes); setPreviewDryRun(true); },
    onError: (err: unknown) => toast({
      title: "Could not check rows", variant: "destructive",
      description: err instanceof Error ? err.message : "Request failed",
    }),
  });
  const doImport = useMutation({
    mutationFn: () => run(false),
    onSuccess: (res) => {
      setPreview(res.data.outcomes); setPreviewDryRun(false);
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

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded">
        <Upload size={11} />Add per-analyst values by hand
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/60 dark:bg-slate-800/30">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Paste rows: <code className="font-mono text-[10px] bg-white dark:bg-slate-900 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700">employee_code,date,value,note</code>
        </p>
        <button type="button" onClick={() => { setOpen(false); setPasted(""); setPreview(null); }}
          aria-label="Close" className="text-slate-400 hover:text-slate-600 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded"><X size={13} /></button>
      </div>
      <textarea value={pasted} onChange={(e) => { setPasted(e.target.value); setPreview(null); }}
        rows={4} placeholder={"MAS12345,2026-09-09,78.5\nMAS12346,2026-09-09,64.0,typed from the weekly QA sheet"}
        className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-[11px] font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
      <p className="text-[10px] text-slate-400 mt-1">
        Each row is one analyst's score for one day — never a whole-process average split across people.
        This is only used when no automated reading exists; a real feed starting later takes over automatically.
      </p>
      <div className="flex items-center gap-2 mt-2">
        <button type="button" disabled={!pasted.trim() || check.isPending}
          onClick={() => check.mutate()}
          className="rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold px-3 py-1.5 hover:bg-slate-300 dark:hover:bg-slate-600 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
          {check.isPending ? "Checking…" : "Check rows"}
        </button>
        <button type="button" disabled={!preview || !previewDryRun || readyCount === 0 || doImport.isPending}
          onClick={() => doImport.mutate()}
          className="rounded-lg bg-blue-600 text-white text-[11px] font-semibold px-3 py-1.5 hover:bg-blue-700 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
          {doImport.isPending ? "Saving…" : `Save ${readyCount || ""} row${readyCount === 1 ? "" : "s"}`}
        </button>
      </div>
      {preview && (
        <div className="mt-2 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-[10px]">
            <thead className="bg-white dark:bg-slate-900 text-slate-400">
              <tr>
                <th className="text-left px-2 py-1 font-semibold">Employee code</th>
                <th className="text-left px-2 py-1 font-semibold">Date</th>
                <th className="text-right px-2 py-1 font-semibold">Value</th>
                <th className="text-left px-2 py-1 font-semibold">{previewDryRun ? "Ready?" : "Saved?"}</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((o) => (
                <tr key={o.row} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1 font-mono">{o.employeeCode || "—"}</td>
                  <td className="px-2 py-1">{o.scoreDate || "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{o.value === null ? "no data" : o.value}</td>
                  <td className="px-2 py-1" style={{ color: o.ok ? C_GREEN : C_RED }}>
                    {o.ok ? (previewDryRun ? "ready" : "saved") : (o.message ?? "rejected")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Top/Bottom performer split (Mydashboards' side-by-side Top-10/Bottom-5
 * leaderboard idiom) -- the analyst table below is already sorted worst-
 * first, direction-aware, with nulls (no reading this period) sorted last;
 * this is the exact same list, just the two ends pulled forward as a quick
 * summary instead of making the reader scroll a long table to find them.
 * Only renders once there are enough scored analysts (6+) for "top" and
 * "bottom" to mean something different from "the whole list".
 */
function TopBottomPerformers({ analysts, unit, direction }: {
  analysts: AnalystScore[]; unit: string | null; direction: string | null;
}) {
  const scored = analysts.filter((a) => a.value !== null);
  if (scored.length < 6) return null;

  const bottom = scored.slice(0, 5); // already worst-first
  const top = [...scored].slice(-5).reverse(); // best-first

  const Card = ({ title, rows, good }: { title: string; rows: AnalystScore[]; good: boolean }) => (
    <div className={`rounded-lg border px-2.5 py-2 ${good
      ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/20"
      : "border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/20"}`}>
      <p className={`text-[9px] font-bold uppercase tracking-wide mb-1.5 ${good ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
        {title}
      </p>
      <div className="space-y-1">
        {rows.map((a) => (
          <div key={a.employeeId} className="flex items-center justify-between gap-2 text-[10.5px]">
            <span className="text-slate-700 dark:text-slate-300 truncate">{a.name}</span>
            <span className={`font-bold tabular-nums shrink-0 ${good ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
              {formatValue(a.value, unit)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-2 mb-2">
      <Card title={direction === "lower_is_better" ? "Best (lowest)" : "Top performers"} rows={top} good={true} />
      <Card title="Needs coaching" rows={bottom} good={false} />
    </div>
  );
}

function AnalystBreakdownPanel({ processId, metricKey, period }: {
  processId: string; metricKey: string; period: ReportPeriod;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "by-analyst", processId, metricKey, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<AnalystBreakdown>>(
      `/api/process-operations/${processId}/metric/${metricKey}/by-analyst?period=${period}`),
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { openCall, drawer } = useCallDetailDrawer(processId);
  const ab = data?.data;
  const invalidateBreakdown = () => qc.invalidateQueries({
    queryKey: ["process-operations", "by-analyst", processId, metricKey, period],
  });

  const passes = (v: number | null, target: number | null, direction: string | null) => {
    if (v === null || target === null || !direction) return null;
    return direction === "higher_is_better" ? v >= target : v <= target;
  };

  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 inline-flex items-center gap-1">
        <Users size={11} />Analyst-wise score — the deepest level of this drill-down
      </div>
      {isLoading || !ab ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading each analyst's own score…
        </div>
      ) : !ab.available ? (
        <p className="text-xs text-slate-400 italic py-1">{ab.reason ?? "Not available for this metric."}</p>
      ) : ab.analysts.length === 0 ? (
        <div>
          <p className="text-xs text-slate-400 italic py-1">
            No analyst has a reading for this metric in this period — not that everyone scored zero.
          </p>
          <EmployeeUploadBox processId={processId} metricKey={metricKey} period={period} onSaved={invalidateBreakdown} />
        </div>
      ) : (
        <div>
          <TopBottomPerformers analysts={ab.analysts} unit={ab.unit} direction={ab.direction} />
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 max-h-96 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold">Analyst</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Employee code</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Score</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Team Leader</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Assistant Manager</th>
                </tr>
              </thead>
              <tbody>
                {ab.analysts.map((a) => {
                  const pass = passes(a.value, ab.targetValue, ab.direction);
                  const open = expandedId === a.employeeId;
                  return (
                    <Fragment key={a.employeeId}>
                      <tr onClick={() => setExpandedId(open ? null : a.employeeId)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedId(open ? null : a.employeeId); } }}
                        role="button" tabIndex={0} aria-expanded={open}
                        title="Show this analyst's full reporting chain"
                        className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${open ? "bg-slate-50 dark:bg-slate-800/40" : ""}`}>
                        <td className="px-2 py-1.5 text-slate-700 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1">
                            <ChevronRight size={11} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                            <span className="font-medium">{a.name}</span>
                            {a.manual && (
                              <PenLine size={10} className="text-purple-500 shrink-0"
                                aria-label="Typed in by hand — no automated feed for this metric" />
                            )}
                          </span>
                          {a.designation && <span className="block text-[10px] text-slate-400 pl-4">{a.designation}</span>}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-slate-500">{a.employeeCode || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                          <span style={{ color: a.value === null ? undefined : pass === null ? undefined : pass ? C_GREEN : C_RED }}>
                            {a.value === null ? <span className="text-slate-400 italic font-normal">no data</span> : formatValue(a.value, ab.unit)}
                          </span>
                          {/* Tier badge (Mydashboards' TQ/MQ/BQ idiom): only two real
                              tiers here since this is one score against one target, not
                              a percentile band across analysts -- a fabricated "near
                              target" middle tier would need a threshold this system
                              doesn't define anywhere else. */}
                          {pass !== null && (
                            <span className="ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[8.5px] font-bold align-middle"
                              style={{ background: pass ? "#DCFCE7" : "#FEE2E2", color: pass ? "#166534" : "#991B1B" }}>
                              {pass ? "On target" : "Below"}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">
                          {a.teamLeader ? `${a.teamLeader.name} (${a.teamLeader.employeeCode})` : <span className="text-slate-400 italic">none on record</span>}
                        </td>
                        <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">
                          {a.assistantManager ? `${a.assistantManager.name} (${a.assistantManager.employeeCode})` : <span className="text-slate-400 italic">none on record</span>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30">
                          <td colSpan={5} className="px-2 py-2 space-y-2">
                            {a.reportsTo.length ? (
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                <span className="text-slate-400 shrink-0">Full reporting chain:</span>
                                {a.reportsTo.map((m, i) => (
                                  <span key={`${m.employeeCode}-${i}`} className="inline-flex items-center gap-1">
                                    {i > 0 && <span className="text-slate-300">→</span>}
                                    <span className="rounded-full px-2 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                                      {m.name} ({m.employeeCode}){m.designation ? ` · ${m.designation}` : ""}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-400 italic">
                                No one is recorded as this analyst's manager — the reporting chain stops here.
                              </p>
                            )}
                            {a.employeeCode && (
                              <EmployeeRecentCallsRow processId={processId} employeeCode={a.employeeCode} period={period}
                                onSelectCall={openCall} />
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Sorted worst first. Team Leader / Assistant Manager are pulled from each analyst's real
            reporting chain — "none on record" means that layer genuinely doesn't exist for them, not a loading gap.
            {ab.analysts.some((a) => a.manual) && (
              <> The <PenLine size={9} className="inline text-purple-500 mx-0.5" />
                mark means that score was typed in by hand — this metric has no automated per-employee feed yet.</>
            )}
          </p>
        </div>
      )}
      {drawer}
    </section>
  );
}

/**
 * Third real consumer of CallDetailDrawer -- this analyst's own recent
 * audited calls, regardless of which metric the breakdown table above is
 * showing (AnalystBreakdownPanel is generic over any metric). An employee
 * genuinely outside the quality-audit pass (this metric came from a manual
 * upload or a different source) gets an honest reason, not an empty list
 * indistinguishable from "audited, zero calls".
 */
function EmployeeRecentCallsRow({ processId, employeeCode, period, onSelectCall }: {
  processId: string; employeeCode: string; period: ReportPeriod;
  onSelectCall: (call: { employeeCode: string; callDate: string }) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "employee-calls", processId, employeeCode, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<EmployeeRecentCalls>>(
      `/api/process-operations/${processId}/employee-calls?employeeCode=${encodeURIComponent(employeeCode)}&period=${period}`),
  });
  const ec = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-[9.5px] text-slate-400">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />Checking this analyst's own audited calls…
      </div>
    );
  }
  if (!ec?.available || !ec.calls.length) {
    return <p className="text-[9.5px] text-slate-400 italic">{ec?.reason ?? "No audited calls to show."}</p>;
  }

  return (
    <div>
      <span className="text-[9.5px] text-slate-400 block mb-1">This analyst's own recent audited calls:</span>
      <div className="flex flex-wrap gap-1">
        {ec.calls.slice(0, 10).map((c, i) => (
          <button key={i} type="button"
            onClick={() => c.hasTranscript && onSelectCall({ employeeCode, callDate: c.callDate })}
            disabled={!c.hasTranscript}
            title={c.hasTranscript ? "Open this call's full audit detail" : "No transcript recorded for this call"}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
            <span className="text-slate-500">{c.callDate.slice(5, 16)}</span>
            <span className="font-semibold tabular-nums"
              style={{ color: c.qualityPercentage === null ? undefined : c.qualityPercentage >= 80 ? C_GREEN : C_RED_TEXT }}>
              {c.qualityPercentage === null ? "—" : `${c.qualityPercentage.toFixed(0)}%`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Honest, derived-only read of what the numbers say: never a canned verdict,
 * every line traces to a real value already on screen (the latest reading vs.
 * the one before it, the configured target, and — when this metric has one —
 * the per-analyst breakdown). A category with nothing to report says so
 * rather than show a filler line.
 */
function InsightsPanel({ d, processId, metricKey, period }: {
  d: Drilldown; processId: string; metricKey: string; period: ReportPeriod;
}) {
  // Same query key as AnalystBreakdownPanel -- react-query dedupes this into
  // the one request already in flight/cached for that panel, not a second
  // network round-trip, so the worst-performer/target-gap lines below stay
  // exactly consistent with the analyst table sitting right underneath them.
  const { data: abData } = useQuery({
    queryKey: ["process-operations", "by-analyst", processId, metricKey, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<AnalystBreakdown>>(
      `/api/process-operations/${processId}/metric/${metricKey}/by-analyst?period=${period}`),
  });
  const ab = abData?.data;
  const target = d.definition?.targetValue ?? null;
  const direction = d.direction;
  const passes = (v: number | null) => {
    if (v === null || target === null || !direction) return null;
    return direction === "higher_is_better" ? v >= target : v <= target;
  };
  const latest = d.readings[0] ?? null;
  const prev = d.readings.find((r) => r.value !== null && r.date !== latest?.date) ?? null;
  const latestPass = latest ? passes(latest.value) : null;
  const delta = latest?.value != null && prev?.value != null ? latest.value - prev.value : null;
  const improving = delta !== null ? (direction === "higher_is_better" ? delta > 0 : delta < 0) : null;

  const scored = (ab?.available ? ab.analysts : []).filter((a) => a.value !== null);
  const worst = scored[0] ?? null; // backend already sorts worst-first
  const best = scored.length ? scored[scored.length - 1] : null;
  const worstPass = worst ? passes(worst.value) : null;
  const bestPass = best ? passes(best.value) : null;
  const failingCount = target !== null && direction
    ? scored.filter((a) => !passes(a.value)).length : null;
  const passingCount = failingCount !== null ? scored.length - failingCount : null;

  const good: string[] = [];
  const alert: string[] = [];
  const actions: string[] = [];

  if (latest && latestPass === true) good.push(`Latest reading (${latest.date}) meets target at ${formatValue(latest.value, d.unit)}.`);
  if (latest && latestPass === false) alert.push(`Latest reading (${latest.date}) is missing target: ${formatValue(latest.value, d.unit)} vs ${formatValue(target, d.unit)}.`);
  if (improving === true) good.push(`Moving the right way vs. the previous reading (${prev?.date}).`);
  if (improving === false) alert.push(`Moving the wrong way vs. the previous reading (${prev?.date}).`);
  if (!latest) alert.push("No reading has ever been recorded for this metric on this process.");
  if (target === null) actions.push("No target is configured for this metric — set one so \"pass/fail\" is meaningful here.");

  if (passingCount !== null && passingCount > 0) good.push(`${passingCount} of ${scored.length} analysts are meeting target.`);
  if (best && bestPass === true) good.push(`${best.name} (${best.employeeCode}) is the strongest performer at ${formatValue(best.value, ab?.unit ?? d.unit)}.`);
  if (failingCount !== null && failingCount > 0) alert.push(`${failingCount} of ${scored.length} analysts are missing target.`);
  if (worst && worstPass === false) {
    alert.push(`${worst.name} (${worst.employeeCode}) is furthest from target at ${formatValue(worst.value, ab?.unit ?? d.unit)}.`);
    if (worst.teamLeader) {
      actions.push(`Loop in ${worst.teamLeader.name} (${worst.teamLeader.employeeCode}), ${worst.name}'s Team Leader, on the gap.`);
    } else {
      actions.push(`${worst.name} has no Team Leader on record to escalate through — worth checking the reporting chain.`);
    }
  }
  if (failingCount !== null && failingCount > 1) {
    actions.push(`Review the ${failingCount} analysts below target together — a shared root cause is more likely than ${failingCount} unrelated ones.`);
  }

  const Block = ({ title, icon: Icon, color, items, emptyText }: {
    title: string; icon: typeof CheckCircle2; color: string; items: string[]; emptyText: string;
  }) => (
    <div className="rounded-lg border pl-2.5" style={{ borderColor: `${color}30`, borderLeftWidth: 3, borderLeftColor: color }}>
      <div className="flex items-center gap-1.5 py-1.5 pr-2 text-[10px] font-bold uppercase tracking-wide" style={{ color }}>
        <Icon size={11} />{title}
      </div>
      <div className="pb-2 pr-2 space-y-1">
        {items.length ? items.map((t, i) => (
          <p key={i} className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">{t}</p>
        )) : <p className="text-[11px] text-slate-400 italic">{emptyText}</p>}
      </div>
    </div>
  );

  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">
        Insights — what the numbers actually say
      </div>
      <div className="space-y-2.5">
        <Block title="Good things" icon={CheckCircle2} color={C_GREEN} items={good}
          emptyText="Nothing currently qualifies as a good-news line for this metric." />
        <Block title="High alert" icon={AlertTriangle} color={C_RED} items={alert}
          emptyText="Nothing currently rises to a high-alert line for this metric." />
        <Block title="Actionable points" icon={Lightbulb} color={C_AMBER} items={actions}
          emptyText="No specific action is indicated beyond the usual monitoring." />
      </div>
    </section>
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
  // Keyed by BOTH processId and metricKey, not metricKey alone -- most
  // workforce metrics (SHRINKAGE_PCT, ATTENDANCE_ISSUES_OPEN...) share the
  // same key across nearly every process, so metricKey alone would carry an
  // expanded date over from one process's drilldown into a completely
  // different process's drilldown for the "same" metric.
  const [expandedFor, setExpandedFor] = useState<{ processId: string; metricKey: string | null; date: string } | null>(null);
  // Collapsed by default -- the formula/source/field breakdown is real,
  // required detail (Drill-Down Mandate: nothing is hidden), but it is SQL-
  // facing detail most readers open this drawer to get past, not to read
  // first. The chart and the actual readings are what a click on a KPI tile
  // is usually for; the working behind the number is one click away, not the
  // first thing in the way of it.
  const [showDetails, setShowDetails] = useState(false);
  const expandedDate = expandedFor?.processId === processId && expandedFor.metricKey === metricKey
    ? expandedFor.date : null;
  const toggleExpanded = (date: string) => setExpandedFor((prev) =>
    prev?.processId === processId && prev.metricKey === metricKey && prev.date === date
      ? null : { processId, metricKey, date });
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
      <SheetContent side="right" className="w-full sm:max-w-[63rem] p-0 overflow-y-auto">
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
          <button type="button" onClick={onClose} aria-label="Close"
            className="ml-auto p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1">
            <X size={15} />
          </button>
        </div>

        {isLoading || !d ? (
          <div className="p-6 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />Loading the working…
          </div>
        ) : (
          <div className="p-5 space-y-5">
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
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpanded(x.date); } }}
                            role="button" tabIndex={0} aria-expanded={expandedDate === x.date}
                            title="Show the individual records behind this day"
                            className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                              expandedDate === x.date ? "bg-slate-50 dark:bg-slate-800/40" : ""}`}>
                            <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300 flex items-center gap-1">
                              <ChevronRight size={11}
                                className={`shrink-0 text-slate-400 transition-transform ${expandedDate === x.date ? "rotate-90" : ""}`} />
                              {x.date}
                              {x.source === "manual" && (
                                <PenLine size={10} className="text-purple-500 shrink-0"
                                  aria-label="Typed in by hand" />
                              )}
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

            {metricKey && <AnalystBreakdownPanel processId={processId} metricKey={metricKey} period={period} />}

            {metricKey && <InsightsPanel d={d} processId={processId} metricKey={metricKey} period={period} />}

            <section className="rounded-xl border border-slate-200 dark:border-slate-800">
              <button type="button" onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <Filter size={11} />How this number is calculated
                </span>
                <ChevronRight size={13}
                  className={`shrink-0 text-slate-400 transition-transform ${showDetails ? "rotate-90" : ""}`} />
              </button>
              {showDetails && (
                <div className="px-3 pb-3 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <div>
                    <Label>Formula</Label>
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
                  </div>

                  <div>
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
                  </div>

                  <div>
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
                  </div>
                </div>
              )}
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
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportOutcome[] | null>(null);
  // A dry-run "ready" row and a post-import "saved" row reuse the same table,
  // but must not reuse the same word -- "saved" on a row that is only checked
  // and not yet written directly contradicts the "nothing is saved yet" line
  // right above the table.
  const [previewDryRun, setPreviewDryRun] = useState(true);

  // The drawer is one persistent component whose visibility toggles, not one
  // remounted per open -- without this, closing it half-filled and reopening
  // for a DIFFERENT process would silently carry the first process's typed
  // value or pasted rows into the second one's write, since the mutation
  // closes over whatever processId is current at click time. Reset on every
  // (re)open and on every process switch, whichever fires first.
  useEffect(() => {
    if (!open) return;
    setMode("single"); setMetricKey(""); setScoreDate(todayIso());
    setValue(""); setNote(""); setPasted(""); setFileName(null); setPreview(null);
  }, [open, processId]);

  /** Reads a .csv/.txt in the browser; nothing is sent anywhere until Check runs. */
  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPasted(String(reader.result ?? ""));
      setFileName(file.name);
      setPreview(null);
    };
    reader.readAsText(file);
  };
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
    onSuccess: (res) => { setPreview(res.data.outcomes); setPreviewDryRun(true); },
    onError: (err: unknown) => toast({
      title: "Could not check rows", variant: "destructive",
      description: err instanceof Error ? err.message : "Request failed",
    }),
  });
  const importBulk = useMutation({
    mutationFn: () => runBulkImport(false),
    onSuccess: (res) => {
      setPreview(res.data.outcomes);
      setPreviewDryRun(false);
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

  // Single entry has no dry-run step the way bulk paste does, so this is its
  // only warning before Save silently overwrites a real, already-measured
  // figure. Reuses the same read the bulk path's "replaces" hint is built
  // from, scoped to exactly the one day being typed into.
  const { data: existingData } = useQuery({
    queryKey: ["process-data-source", "values", processId, scoreDate],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Array<{ metricKey: string; value: number | null; source: string }>>>(
      `/api/process-data-source/${processId}/values?from=${scoreDate}&to=${scoreDate}`),
    enabled: mode === "single" && Boolean(processId && scoreDate),
    staleTime: 30 * 1000,
  });
  const existingForMetric = metricKey
    ? (existingData?.data ?? []).find((v) => v.metricKey === metricKey && v.value !== null)
    : undefined;

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
          <button type="button" onClick={onClose} aria-label="Close"
            className="ml-auto p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1">
            <X size={15} />
          </button>
        </div>

        <div role="tablist" aria-label="Entry mode" className="flex border-b border-slate-200 dark:border-slate-800 px-5 pt-2">
          {([["single", "Single entry"], ["bulk", "Paste multiple"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
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

            {existingForMetric && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>
                  {scoreDate} already has a {existingForMetric.source === "manual" ? "manually entered" : "measured"} value
                  of <strong className="tabular-nums">
                    {formatValue(existingForMetric.value, catalog.find((m) => m.metricCode === metricKey)?.unit ?? null)}
                  </strong> for this metric — saving will replace it.
                </span>
              </div>
            )}

            <button type="button" disabled={!canSave} onClick={() => save.mutate()}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Paste rows — one per line
                </label>
                <label className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer inline-flex items-center gap-1">
                  <Upload size={11} />
                  {fileName ?? "Upload .csv/.txt"}
                  <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0])} />
                </label>
              </div>
              <textarea value={pasted} rows={7}
                onChange={(e) => { setPasted(e.target.value); setPreview(null); setFileName(null); }}
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
                className="flex-1 rounded-lg py-2 text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
                {checkBulk.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Check rows
              </button>
              <button type="button" disabled={!preview || readyCount === 0 || importBulk.isPending}
                onClick={() => importBulk.mutate()}
                className="flex-1 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
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
                              ? (previewDryRun
                                  ? (o.replaces !== undefined
                                      ? (o.replaces === null ? "ready — new" : `ready — replaces ${o.replaces}`)
                                      : "ready")
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
  // Collapsed by default: this is a real, worth-knowing fact, but 100 dead
  // feeds rendered as a 9-tile grid was pushing the actual dashboard --
  // the numbers a reader came here for -- below the fold before it even
  // loaded. The headline count and the "how stale" line stay visible either
  // way; only the per-process breakdown is opt-in.
  const [expanded, setExpanded] = useState(false);
  const dead = health.feeds.filter((f) => f.state === "stopped");
  if (!dead.length) return null;
  const byProcess = new Map<string, FeedRow[]>();
  dead.forEach((f) => byProcess.set(f.processName, [...(byProcess.get(f.processName) ?? []), f]));
  return (
    <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/80 dark:bg-red-950/30 p-4 shadow-sm">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        className="w-full flex items-start gap-2 text-left cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
        <Radio className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-red-800 dark:text-red-300">
              {dead.length} measurement{dead.length === 1 ? "" : "s"} stopped updating
            </h2>
            <ChevronRight size={14}
              className={`shrink-0 text-red-500 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
          <p className="text-[11px] text-red-700/80 dark:text-red-400/80 mt-0.5">
            Nothing recorded for over {health.stoppedAfterDays} days. Their last value may still be
            on a tile below, looking current.{!expanded && " Click to see which."}
          </p>
        </div>
      </button>
      {expanded && (
        <>
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
        </>
      )}
    </div>
  );
}

/**
 * The gap StoppedFeeds cannot see: a metric with a real, active configuration
 * that has never once produced a row, ever — not a feed that went quiet, one
 * that never started. Grouped by (metric, source) rather than listed per
 * process, because the dominant case here is one dead table wearing dozens of
 * process names, not dozens of independent problems.
 */
/** metric_key,date,value,note — the same 4 columns the bulk-paste box already
 *  parses, so a filled-in template pastes straight in with zero translation. */
function downloadFillInTemplate(g: NeverReportedGroup, processName: string) {
  const days = 14;
  const rows: Array<Record<string, unknown>> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    rows.push({ metric_key: g.metricKey, date: d.toISOString().slice(0, 10), value: "", note: "" });
  }
  const safeProcess = processName.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  downloadCsv(`${g.metricKey}_${safeProcess}_template.csv`, ["metric_key", "date", "value", "note"], rows);
}

function NeverReportedBanner({ groups, currentProcessId, currentProcessName }: {
  groups: NeverReportedGroup[]; currentProcessId: string | null; currentProcessName: string | null;
}) {
  // Same reasoning as StoppedFeeds: collapsed by default so this doesn't
  // push the actual dashboard off the first screen. The headline count is
  // the part worth seeing unconditionally; the per-metric breakdown (with
  // its upload-path hints) is a click away.
  const [expanded, setExpanded] = useState(false);
  if (!groups.length) return null;
  const totalConfigs = groups.reduce((s, g) => s + g.processCount, 0);
  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 p-4 shadow-sm">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        className="w-full flex items-start gap-2 text-left cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-amber-800 dark:text-amber-300">
              {totalConfigs} configured measurement{totalConfigs === 1 ? "" : "s"} across {groups.length} metric{groups.length === 1 ? "" : "s"} {groups.length === 1 ? "has" : "have"} never reported
            </h2>
            <ChevronRight size={14}
              className={`shrink-0 text-amber-600 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
            A real configuration exists and a source table is named, but nothing has ever been written
            there — not a feed that stopped, one that never started.{!expanded && " Click to see which."}
          </p>
        </div>
      </button>
      {expanded && (
        <>
          <div className="mt-2.5 space-y-1.5">
            {groups.slice(0, 6).map((g) => (
              <div key={`${g.metricKey}|${g.sourceObject}`}
                className="rounded-lg bg-white/80 dark:bg-slate-900/60 border border-amber-100 dark:border-amber-900/60 px-2.5 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">{g.metricName}</span>
                  <span className="text-[11px] text-amber-700 dark:text-amber-400 tabular-nums shrink-0">
                    {g.processCount} process{g.processCount === 1 ? "" : "es"}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate" title={g.sourceObject}>
                  {g.sourceObject}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {g.processNames.slice(0, 4).join(", ")}{g.processCount > g.processNames.length ? `, +${g.processCount - g.processNames.length} more` : ""}
                </div>
                {g.uploadTypeName && g.existingSourceRows === 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                    <Upload className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">
                      Table is empty — Bulk Upload Hub → "{g.uploadTypeName}" would start this feed
                    </span>
                  </div>
                )}
                {g.uploadTypeName && g.existingSourceRows !== null && g.existingSourceRows > 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-orange-700 dark:text-orange-400">
                    <Database className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">
                      {g.existingSourceRows.toLocaleString("en-IN")} raw rows already exist — this metric was never computed from them, not missing data
                    </span>
                  </div>
                )}
                {g.uploadTypeName && g.existingSourceRows === null && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                    <Upload className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">
                      Manual upload available — Bulk Upload Hub → "{g.uploadTypeName}"
                    </span>
                  </div>
                )}
                {currentProcessId && currentProcessName && g.processIds.includes(currentProcessId) && (
                  <button type="button"
                    onClick={() => downloadFillInTemplate(g, currentProcessName)}
                    title={`A blank 14-day CSV for ${g.metricKey} — same 4 columns "Add a reading" → Bulk paste already reads, fill in real values and paste it back in for ${currentProcessName}`}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
                    <Download size={10} />Blank template for {currentProcessName}
                  </button>
                )}
              </div>
            ))}
          </div>
          {groups.length > 6 && (
            <p className="text-[11px] text-amber-700/70 mt-1.5">and {groups.length - 6} more metric groups</p>
          )}
        </>
      )}
    </div>
  );
}

export default function ProcessOperationsPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [drill, setDrill] = useState<string | null>(null);
  const [period, setPeriod] = useState<ReportPeriod>("trend");
  const [manualEntryOpen, setManualEntryOpen] = useState(false);

  const { data: listData, isLoading: listLoading, isError: listErrored, refetch: refetchList } = useQuery({
    queryKey: ["process-operations", "processes"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessRow[]>>("/api/process-operations/processes"),
  });
  const processes = listData?.data ?? [];

  // Real branches only -- built from the processes actually in view, not
  // imagined, per this codebase's own rule that dropdown options come from
  // the observed domain. A process with no branch assignment (some
  // corporate/shared processes genuinely have none) surfaces as its own
  // honest "Unassigned" option rather than disappearing from the filter.
  const branchOptions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    for (const p of processes) {
      const id = p.branchId ?? "__unassigned";
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          label: p.branchId ? `${p.branchName ?? "Unnamed branch"}${p.branchCode ? ` (${p.branchCode})` : ""}` : "Unassigned",
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [processes]);

  const branchScopedProcesses = useMemo(() => {
    if (branchFilter === "all") return processes;
    return processes.filter((p) => (p.branchId ?? "__unassigned") === branchFilter);
  }, [processes, branchFilter]);

  const processOptions: SearchableOption[] = useMemo(
    () => branchScopedProcesses.map((p) => ({
      value: p.processId,
      label: p.processName,
      hint: p.processCode ?? undefined,
    })),
    [branchScopedProcesses],
  );

  // Picking a branch that doesn't hold the currently active process must
  // clear that stale selection, not leave a process from a different branch
  // silently on screen -- same "clear the child when the parent changes"
  // rule this page's own manual-entry forms already follow.
  useEffect(() => {
    if (active && !branchScopedProcesses.some((p) => p.processId === active)) {
      setActive(null);
    }
  }, [branchFilter, branchScopedProcesses, active]);

  const current = active ?? branchScopedProcesses[0]?.processId ?? null;
  const currentProcess = processes.find((p) => p.processId === current) ?? null;

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
    conv ? <FunnelSnapshot key="fs" metrics={conv.metrics} /> : null,
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
            <button type="button" onClick={() => refetchList()}
              className="shrink-0 rounded-lg bg-red-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-red-700 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-800 focus-visible:ring-offset-1">
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
            {feedHealth && (
              <NeverReportedBanner groups={feedHealth.neverReported}
                currentProcessId={current} currentProcessName={currentProcess?.processName ?? null} />
            )}

            <div className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 shadow-sm p-3.5">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1 block">
                    Branch
                  </label>
                  <SearchableSelect
                    aria-label="Filter by branch"
                    options={[{ value: "all", label: "All branches", hint: `${processes.length}` }, ...branchOptions.map((b) => ({
                      value: b.id, label: b.label,
                      hint: `${processes.filter((p) => (p.branchId ?? "__unassigned") === b.id).length}`,
                    }))]}
                    value={branchFilter}
                    onChange={setBranchFilter}
                    placeholder="All branches"
                    searchPlaceholder="Search branches…"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1 block">
                    Process
                  </label>
                  <SearchableSelect
                    aria-label="Select a process"
                    options={processOptions}
                    value={current ?? ""}
                    onChange={(id) => setActive(id)}
                    placeholder={branchScopedProcesses.length ? "Search processes by name or code…" : "No process in this branch"}
                    searchPlaceholder="Type a process name or code…"
                    emptyText="No process matches that search."
                    disabled={!branchScopedProcesses.length}
                  />
                </div>
              </div>

              {currentProcess && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                    {currentProcess.processName}
                    {currentProcess.processCode && (
                      <span className="font-mono text-[10px] font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5">
                        {currentProcess.processCode}
                      </span>
                    )}
                  </span>
                  <span>{currentProcess.branchName ?? "Unassigned branch"}</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{currentProcess.headcount} active</span>
                  <span className="tabular-nums">{currentProcess.metrics} metrics tracked</span>
                  {branchScopedProcesses.length > 1 && (
                    <span className="text-slate-400">{branchScopedProcesses.length} processes in this branch</span>
                  )}
                </div>
              )}
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

                {/* Process Performance Card reading order: an insights strip
                    first (what actually needs a look, derived from this
                    page's own real target checks), then headcount &
                    operations (the staffing/dialler reality this period),
                    then quality, then hygiene last -- see the SECTIONS
                    comment in process-operations.service.ts. */}
                {current && ops && <ProcessCardInsightsPanel processId={current} ops={ops} />}
                {current && <BusinessHealthPanel processId={current} />}

                {charts.length > 0 && (
                  <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">{charts}</div>
                )}

                {current && <VoiceOfCustomerPanel processId={current} period={period} />}
                {current && <FatalCallsPanel processId={current} period={period} />}
                {current && <WorkforceCorrelationPanel processId={current} period={period} />}

                {[...ops.sections, ...(ops.ungrouped.length
                  ? [{ key: "other", title: "Other metrics", blurb: "Wired for this process but not yet placed in a section.", metrics: ops.ungrouped }]
                  : [])].map((s, idx) => {
                  const style = SECTION_STYLE[s.key] ?? SECTION_STYLE.other;
                  const Icon = style.icon;
                  // One hero when the section actually has something failing its
                  // target, everything else as a flowing strip -- not a uniform
                  // grid of equally-weighted tiles regardless of whether a metric
                  // is fine or in trouble. Alternating band tint (not per-tile
                  // borders) is what separates one section from the next.
                  const hero = heroOf(s.metrics);
                  const rest = hero ? s.metrics.filter((m) => m.metricKey !== hero.metricKey) : s.metrics;
                  return (
                    <section key={s.key}
                      className={`rounded-2xl p-3.5 md:p-4 -mx-1 ${idx % 2 === 1 ? "bg-white/70 dark:bg-slate-900/40" : ""}`}>
                      <div className="flex items-center gap-2 px-0.5 mb-3">
                        <span className="p-1 rounded-lg" style={{ background: `${style.accent}1A` }}>
                          <Icon className="h-3.5 w-3.5" style={{ color: style.accent }} />
                        </span>
                        <h2 className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{s.title}</h2>
                        <span className="text-[10px] text-slate-400 tabular-nums">{s.metrics.length}</span>
                        {s.blurb && (
                          <p className="text-[10px] text-slate-400 truncate hidden md:block ml-2">{s.blurb}</p>
                        )}
                      </div>
                      <div className={hero ? "grid gap-3 lg:grid-cols-[260px_1fr] items-stretch" : ""}>
                        {hero && (
                          <HeroKpiCard r={hero} staleAfter={ops.staleAfterDays} period={period}
                            onOpen={() => setDrill(hero.metricKey)} />
                        )}
                        <div className="flex flex-wrap content-start gap-2">
                          {rest.map((r) => (
                            <MiniKpiChip key={r.metricKey} r={r} accent={style.accent} staleAfter={ops.staleAfterDays}
                              onOpen={() => setDrill(r.metricKey)} />
                          ))}
                        </div>
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
            // A saved reading can belong to a metric whose drill-down is already
            // open (or gets reopened next) -- without this its cached readings/
            // trend chart would keep showing the pre-save figure until an
            // unrelated cache eviction happened to clear it.
            qc.invalidateQueries({ queryKey: ["process-operations", "drilldown"] });
            qc.invalidateQueries({ queryKey: ["process-operations", "raw-rows"] });
          }}
        />
      </div>
    </DashboardLayout>
  );
}
