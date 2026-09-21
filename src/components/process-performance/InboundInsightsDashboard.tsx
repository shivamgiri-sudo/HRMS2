import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, BarChart, Bar, AreaChart, Area, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  PhoneIncoming, PhoneCall, PhoneOff, Gauge, Timer, Users, Search, Radio, Clock3, Repeat,
  Hourglass, PauseCircle, ArrowRightLeft, Lightbulb, CalendarDays, Layers, UserX, TrendingUp,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  localDateStr, formatShortDate,
  type ExportSlide,
} from "./DashboardKit";

/**
 * Inbound view for the dialer-backed "pattern B" processes (DU Bangladesh,
 * Exicom, Viega). Everything on screen comes from ONE payload
 * (GET /api/inbound-insights/:key) so the tabs cannot disagree, and every
 * table/heat cell/chart segment opens a call-level drill-down drawer
 * (GET /api/inbound-insights/:key/calls). Caller numbers arrive masked; the
 * UI only ever holds an opaque key for them.
 *
 * Deliberately separate from NativeInboundDashboard, which other companies
 * still use unchanged.
 */

export type InboundInsightProject = "dubangladesh" | "exicom" | "viega" | "dalmia" | "neemans" | "gnc" | "bellavita" | "clovia";

interface Metrics {
  offered: number; answered: number; abandoned: number; answeredPct: number; abandonPct: number;
  slPct: number; slOfAnsweredPct: number; aht: number; avgTalk: number; avgHold: number; avgAcw: number;
  asa: number; avgAbandonWait: number; maxWait: number; transfers: number; afterHours: number;
}
interface Headline extends Metrics {
  slThresholdSec: number; uniqueCallers: number; repeatCallers: number; repeatCallerPct: number; repeatCallPct: number;
  unservedCallers: number; agentsActive: number; callsPerAgent: number; daysWithCalls: number; avgCallsPerDay: number;
  holdCallPct: number; shortAbandonPct: number;
  peakHour: { label: string; offered: number } | null; busiestDay: { date: string; offered: number } | null;
  fcrPct: number | null; sharedNumber: { masked: string; calls: number; sharePct: number } | null;
}
interface DailyRow extends Metrics { date: string; weekday: string; agents: number; uniqueCallers: number; fcrPct: number | null }
interface HourRow extends Metrics { hour: number; label: string; avgPerDay: number; sharePct: number }
interface QuarterRow extends Metrics { slot: string; sharePct: number }
interface WeekdayRow extends Metrics { weekday: string; days: number; avgPerDay: number }
interface HeatCell { date: string; hour: number; offered: number; abandoned: number; answeredInSl: number }
interface AgentRow {
  agentId: string; agentName: string; handled: number; sharePct: number; slWithinPct: number; aht: number;
  avgTalk: number; avgHold: number; avgAcw: number; asa: number; maxDuration: number; shortCalls: number;
  longCalls: number; transfers: number; daysActive: number; callsPerDay: number; firstCall: string; lastCall: string;
}
interface LobRow extends Metrics { campaign: string; sharePct: number; uniqueCallers: number; agents: number }
interface LobGroupRow extends Metrics { label: string; sharePct: number }
interface CallerRow { key: string; masked: string; calls: number; answered: number; abandoned: number; lastDate: string; campaigns: string[] }
interface Insights {
  project: { key: string; name: string; campaigns: string[] };
  filters: { startDate: string; endDate: string; campaign: string | null };
  definitions: Record<string, string>;
  truncated: boolean;
  headline: Headline;
  insights: Array<{ tone: "info" | "good" | "warn" | "bad"; text: string }>;
  daily: DailyRow[]; hourly: HourRow[]; quarterHourly: QuarterRow[]; weekdays: WeekdayRow[]; heatmap: HeatCell[];
  agents: AgentRow[]; agentDaily: Array<{ agentId: string; date: string; calls: number }>;
  agentHourly: Array<{ agentId: string; hour: number; calls: number }>;
  lobs: LobRow[]; lobGroups: { byBrand: LobGroupRow[]; byLanguage: LobGroupRow[] } | null; lobDaily: Array<{ campaign: string; date: string; offered: number }>;
  waitBuckets: Array<{ label: string; answered: number; abandoned: number }>;
  talkBuckets: Array<{ label: string; calls: number }>;
  dispositions: Array<{ label: string; count: number }>;
  disconnects: Array<{ label: string; count: number }>;
  abandonReasons: Array<{ label: string; count: number }>;
  repeatDist: Array<{ label: string; callers: number }>;
  topRepeatCallers: CallerRow[]; unservedCallers: CallerRow[];
}
interface CallDetail {
  id: number; date: string; time: string; hour: number; campaign: string; agentId: string | null; agentName: string | null;
  caller: string; callerKey: string | null; callsInPeriod: number; outcome: "Answered" | "Abandoned" | "After-hours";
  disposition: string; disconnBy: string; waitSec: number; talkSec: number; holdSec: number; acwSec: number;
  durationSec: number; withinSl: boolean; transferred: boolean;
}
interface CallsPage { total: number; page: number; pageSize: number; truncated: boolean; rows: CallDetail[] }
interface DrillSpec {
  title: string;
  params: Record<string, string | number>;
}

const PROJECT_LABEL: Record<InboundInsightProject, { name: string; gradient: string }> = {
  dubangladesh: { name: "DU Bangladesh", gradient: "from-amber-600 via-orange-600 to-amber-700" },
  exicom: { name: "Exicom", gradient: "from-blue-600 via-sky-600 to-blue-700" },
  viega: { name: "Viega", gradient: "from-rose-600 via-red-600 to-rose-700" },
  dalmia: { name: "Dalmia", gradient: "from-teal-600 via-emerald-600 to-teal-700" },
  neemans: { name: "Neemans", gradient: "from-violet-600 via-purple-600 to-violet-700" },
  gnc: { name: "GNC", gradient: "from-blue-600 via-indigo-600 to-blue-700" },
  bellavita: { name: "Bellavita", gradient: "from-orange-500 via-amber-600 to-orange-600" },
  clovia: { name: "Clovia", gradient: "from-purple-600 via-fuchsia-600 to-purple-700" },
};

type TabKey = "overview" | "hourly" | "datewise" | "agents" | "lobs" | "wait" | "callers";

const fmtSec = (s: number) => {
  if (!s) return "0s";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
};
const fmtNum = (v: number) => v.toLocaleString("en-IN");
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const slTone = (v: number) => (v >= 90 ? "text-emerald-600" : v >= 75 ? "text-amber-600" : "text-red-600");
const abTone = (v: number) => (v <= 5 ? "text-emerald-600" : v <= 10 ? "text-amber-600" : "text-red-600");

function last30DaysRange() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  return { from: localDateStr(from), to: localDateStr(now) };
}

const LOB_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#0ea5e9", "#f43f5e", "#a78bfa", "#14b8a6", "#ec4899",
  "#84cc16", "#64748b", "#f97316", "#06b6d4", "#8b5cf6", "#ef4444", "#22c55e", "#eab308",
];
const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" } as const;
const th = "py-2.5 pr-3 text-right font-semibold";
const td = "py-2.5 pr-3 text-right text-slate-600";

/** Column header cell that stays readable when the table scrolls sideways. */
function Head({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <th className={first ? "py-2.5 pl-3 pr-3 font-bold text-slate-500" : th}>{children}</th>;
}

function TableShell({ children, minWidth = 720 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full border-collapse text-left text-xs" style={{ minWidth }}>{children}</table>
    </div>
  );
}
const THEAD = "border-b border-slate-100 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-400";
const rowCls = (i: number) =>
  `cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-blue-50/50 ${i % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`;
const EMPTY = <div className="py-8 text-center text-xs text-slate-400">No calls in this period.</div>;

/** Colour-scaled cell used by the date x hour and agent x date/hour grids. */
function heatBg(value: number, max: number, rgb: string) {
  if (!value || !max) return undefined;
  const a = 0.12 + 0.78 * (value / max);
  return `rgba(${rgb}, ${a.toFixed(2)})`;
}

/** Week-wise / date-wise columns from GET /api/inbound-insights/:key/periods (same rows and definitions as the screen). */
interface PeriodsPayload {
  columns: Array<{ key: string; label: string }>;
  tables: Array<{ title: string; rowsLabel: string; rows: Array<{ label: string; fmt: string; value: number; cols: Record<string, number> }> }>;
}
const fmtPeriodCell = (v: number, fmt: string) => (fmt === "pct" ? `${Math.round(v * 10) / 10}%` : fmt === "sec" ? fmtSec(v) : fmt === "dec1" ? String(Math.round(v * 10) / 10) : fmtNum(v));

export function InboundInsightsDashboard({ projectKey, initialRange, onRangeChange }: {
  projectKey: InboundInsightProject;
  /** Optional: start on this range instead of the last 30 days (used when embedded in another dashboard). */
  initialRange?: { from: string; to: string };
  /** Optional: told whenever the user changes the range, so a host can keep its own views in step. */
  onRangeChange?: (from: string, to: string) => void;
}) {
  const meta = PROJECT_LABEL[projectKey];
  const initial = useMemo(() => initialRange ?? last30DaysRange(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  useEffect(() => { onRangeChange?.(from, to); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  // A host that owns the range can move it too: follow it.
  useEffect(() => {
    if (initialRange) { setFrom(initialRange.from); setTo(initialRange.to); }
  }, [initialRange?.from, initialRange?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const [periods, setPeriods] = useState<PeriodsPayload | null>(null);
  const [campaign, setCampaign] = useState("all");
  const [tab, setTab] = useState<TabKey>("overview");
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [agentSearch, setAgentSearch] = useState("");
  const [heatMetric, setHeatMetric] = useState<"offered" | "abandoned">("offered");
  const [agentGrid, setAgentGrid] = useState<"date" | "hour">("date");
  const [drill, setDrill] = useState<DrillSpec | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ startDate: from, endDate: to });
      if (campaign !== "all") qs.set("campaign", campaign);
      const res = await hrmsApi.get<{ success: boolean; _unavailable?: boolean; data: Insights | null; error?: string }>(
        `/api/inbound-insights/${projectKey}?${qs.toString()}`,
      );
      setUnavailable(Boolean(res._unavailable));
      if (res.data) setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to load the ${meta.name} inbound dashboard.`);
    } finally {
      setLoading(false);
    }
  }, [from, to, campaign, projectKey, meta.name]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ startDate: from, endDate: to });
    if (campaign !== "all") qs.set("campaign", campaign);
    hrmsApi.get<{ success: boolean; data: PeriodsPayload | null }>(`/api/inbound-insights/${projectKey}/periods?${qs.toString()}`)
      .then((r) => { if (!cancelled) setPeriods(r.data ?? null); })
      .catch(() => { if (!cancelled) setPeriods(null); });
    return () => { cancelled = true; };
  }, [from, to, campaign, projectKey]);

  // A different project has a different campaign list: never keep a stale selection.
  useEffect(() => { setCampaign("all"); setData(null); }, [projectKey]);

  const campaigns = data?.project.campaigns ?? [];
  const showLobs = campaigns.length > 1 && campaign === "all";
  const tabs = useMemo(() => {
    const all: Array<{ key: TabKey; label: string }> = [
      { key: "overview", label: "Overview" },
      { key: "hourly", label: "Hour-wise" },
      { key: "datewise", label: "Date-wise" },
      { key: "agents", label: "Agent-wise" },
      { key: "lobs", label: "LOB-wise" },
      { key: "wait", label: "Wait & Abandon" },
      { key: "callers", label: "Callers" },
    ];
    return showLobs ? all : all.filter((t) => t.key !== "lobs");
  }, [showLobs]);
  useEffect(() => { if (!tabs.some((t) => t.key === tab)) setTab("overview"); }, [tabs, tab]);

  const openDrill = useCallback((title: string, params: Record<string, string | number> = {}) => {
    setDrill({ title, params });
  }, []);

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    const list = data?.agents ?? [];
    return q ? list.filter((a) => a.agentName.toLowerCase().includes(q) || a.agentId.toLowerCase().includes(q)) : list;
  }, [data, agentSearch]);

  // date x hour grid
  const heat = useMemo(() => {
    const cells = new Map<string, HeatCell>();
    let max = 0;
    for (const c of data?.heatmap ?? []) {
      cells.set(`${c.date}|${c.hour}`, c);
      max = Math.max(max, c[heatMetric]);
    }
    const dates = (data?.daily ?? []).map((d) => d.date);
    const hours = (data?.hourly ?? []).map((h) => h.hour);
    return { cells, max, dates, hours };
  }, [data, heatMetric]);

  // agent x date / hour grid
  const agentGridData = useMemo(() => {
    const cells = new Map<string, number>();
    let max = 0;
    if (agentGrid === "date") for (const r of data?.agentDaily ?? []) { cells.set(`${r.agentId}|${r.date}`, r.calls); max = Math.max(max, r.calls); }
    else for (const r of data?.agentHourly ?? []) { cells.set(`${r.agentId}|${r.hour}`, r.calls); max = Math.max(max, r.calls); }
    const cols: Array<{ key: string; label: string }> = agentGrid === "date"
      ? (data?.daily ?? []).map((d) => ({ key: d.date, label: formatShortDate(d.date) }))
      : (data?.hourly ?? []).map((h) => ({ key: String(h.hour), label: h.label }));
    return { cells, max, cols };
  }, [data, agentGrid]);

  // per-campaign daily volume, pivoted for a stacked chart
  const lobDailyPivot = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const r of data?.lobDaily ?? []) {
      const row = byDate.get(r.date) ?? { date: r.date };
      row[r.campaign] = r.offered;
      byDate.set(r.date, row);
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [data]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const h = data.headline;
    const slides: ExportSlide[] = [
      {
        title: "Overview",
        kpis: [
          { label: "Offered Calls", value: fmtNum(h.offered) },
          { label: "Answered", value: fmtNum(h.answered) },
          { label: "Abandoned", value: fmtNum(h.abandoned) },
          { label: "Answer %", value: `${h.answeredPct}%` },
          { label: "Abandon % (AL)", value: `${h.abandonPct}%` },
          { label: `Service Level (${h.slThresholdSec}s, of offered)`, value: `${h.slPct}%` },
          { label: `Service Level (${h.slThresholdSec}s, of answered)`, value: `${h.slOfAnsweredPct}%` },
          { label: "AHT", value: fmtSec(h.aht) },
          { label: "Avg Talk", value: fmtSec(h.avgTalk) },
          { label: "Avg Hold", value: fmtSec(h.avgHold) },
          { label: "Avg After-call Work", value: fmtSec(h.avgAcw) },
          { label: "Avg Speed of Answer", value: fmtSec(h.asa) },
          { label: "Avg Abandon Wait", value: fmtSec(h.avgAbandonWait) },
          { label: "Longest Wait", value: fmtSec(h.maxWait) },
          { label: "Unique Callers", value: fmtNum(h.uniqueCallers) },
          { label: "Repeat Callers", value: `${fmtNum(h.repeatCallers)} (${h.repeatCallerPct}%)` },
          { label: "Callers Never Answered", value: fmtNum(h.unservedCallers) },
          ...(h.afterHours > 0 ? [{ label: "After-hours calls (counted as answered)", value: fmtNum(h.afterHours) }] : []),
          ...(h.fcrPct != null ? [{ label: "FCR %", value: `${h.fcrPct}%` }] : []),
          { label: "Active Agents", value: String(h.agentsActive) },
          { label: "Calls Handled / Agent", value: String(h.callsPerAgent) },
          { label: "Transferred Calls", value: fmtNum(h.transfers) },
        ],
        tables: [
          // Metric | Value | W-1 .. | 1-Sep .. : Value is the whole range, then one column per week block and per date.
          ...(periods ? periods.tables.map((t) => ({
            title: `${t.title} — week-wise and date-wise`,
            columns: [t.rowsLabel, "Value", ...periods.columns.map((c) => c.label)],
            rows: t.rows.map((r) => [r.label, fmtPeriodCell(r.value, r.fmt), ...periods.columns.map((c) => fmtPeriodCell(r.cols[c.key] ?? 0, r.fmt))]),
          })) : []),
          {
            title: "Key insights",
            columns: ["Insight"],
            rows: data.insights.map((i) => [i.text]),
          },
        ],
      },
      {
        title: "Hour-wise",
        tables: [{
          title: "Hour-wise Call Performance",
          columns: ["Hour", "Offered", "Avg / Day", "Answered", "Abandoned", "AL %", "SL %", "AHT", "ASA"],
          rows: data.hourly.map((r) => [r.label, r.offered, r.avgPerDay, r.answered, r.abandoned, `${r.abandonPct}%`, `${r.slPct}%`, fmtSec(r.aht), fmtSec(r.asa)]),
        }, {
          title: "15-minute Slot Performance",
          columns: ["Slot", "Offered", "Share %", "Answered", "Abandoned", "AL %", "SL %", "AHT", "ASA"],
          rows: data.quarterHourly.map((r) => [r.slot, r.offered, `${r.sharePct}%`, r.answered, r.abandoned, `${r.abandonPct}%`, `${r.slPct}%`, fmtSec(r.aht), fmtSec(r.asa)]),
        }],
      },
      {
        title: "Date-wise",
        tables: [{
          title: "Date-wise Call Performance",
          columns: ["Date", "Day", "Agents", "Offered", "Answered", "Abandoned", "Answer %", "AL %", "SL %", "AHT", "ASA", "Unique Callers", ...(h.fcrPct != null ? ["FCR %"] : [])],
          rows: data.daily.map((r) => [fmtDate(r.date), r.weekday, r.agents, r.offered, r.answered, r.abandoned, `${r.answeredPct}%`, `${r.abandonPct}%`, `${r.slPct}%`, fmtSec(r.aht), fmtSec(r.asa), r.uniqueCallers, ...(h.fcrPct != null ? [r.fcrPct != null ? `${r.fcrPct}%` : "—"] : [])]),
        }, {
          title: "Weekday Pattern",
          columns: ["Weekday", "Days", "Offered", "Avg / Day", "AL %", "SL %", "AHT"],
          rows: data.weekdays.map((r) => [r.weekday, r.days, r.offered, r.avgPerDay, `${r.abandonPct}%`, `${r.slPct}%`, fmtSec(r.aht)]),
        }],
      },
      {
        title: "Agent-wise",
        tables: [{
          title: "Agent-wise Call Performance",
          columns: ["Agent", "Agent ID", "Handled", "Share %", `SL ≤${h.slThresholdSec}s %`, "AHT", "Avg Hold", "Avg ACW", "Days", "Calls / Day", "Short (<10s)", "Long (10m+)", "Transfers"],
          rows: data.agents.map((a) => [a.agentName, a.agentId, a.handled, `${a.sharePct}%`, `${a.slWithinPct}%`, fmtSec(a.aht), fmtSec(a.avgHold), fmtSec(a.avgAcw), a.daysActive, a.callsPerDay, a.shortCalls, a.longCalls, a.transfers]),
        }],
      },
    ];
    if (showLobs) {
      slides.push({
        title: "LOB-wise",
        tables: [{
          title: "LOB / Campaign-wise Performance",
          columns: ["Campaign", "Offered", "Share %", "Answered", "Abandoned", "AL %", "SL %", "AHT", "Unique Callers", "Agents"],
          rows: data.lobs.map((l) => [l.campaign, l.offered, `${l.sharePct}%`, l.answered, l.abandoned, `${l.abandonPct}%`, `${l.slPct}%`, fmtSec(l.aht), l.uniqueCallers, l.agents]),
        }],
      });
    }
    if (data.lobGroups) {
      const lobSlide = slides.find((sl) => sl.title === "LOB-wise");
      if (lobSlide) {
        for (const [title, rows] of [["Brand", data.lobGroups.byBrand], ["Language", data.lobGroups.byLanguage]] as const) {
          lobSlide.tables = [...(lobSlide.tables ?? []), {
            title: `${title}-wise roll-up`,
            columns: [title, "Offered", "Share %", "AL %", "SL %", "AHT"],
            rows: rows.map((g) => [g.label, g.offered, `${g.sharePct}%`, `${g.abandonPct}%`, `${g.slPct}%`, fmtSec(g.aht)]),
          }];
        }
      }
    }
    slides.push(
      {
        title: "Wait & Abandon",
        tables: [
          { title: "Queue wait distribution", columns: ["Wait", "Answered", "Abandoned"], rows: data.waitBuckets.map((b) => [b.label, b.answered, b.abandoned]) },
          { title: "Answered call duration", columns: ["Duration", "Calls"], rows: data.talkBuckets.map((b) => [b.label, b.calls]) },
          { title: "Disposition", columns: ["Disposition", "Calls"], rows: data.dispositions.map((d) => [d.label, d.count]) },
          { title: "Abandon reason (disposition / disconnected by)", columns: ["Reason", "Calls"], rows: data.abandonReasons.map((d) => [d.label, d.count]) },
        ],
      },
      {
        title: "Callers",
        tables: [
          { title: "Repeat frequency", columns: ["Calls in period", "Callers"], rows: data.repeatDist.map((d) => [d.label, d.callers]) },
          { title: "Top repeat callers (numbers masked)", columns: ["Caller", "Calls", "Answered", "Abandoned", "Last call"], rows: data.topRepeatCallers.map((c) => [c.masked, c.calls, c.answered, c.abandoned, fmtDate(c.lastDate)]) },
          { title: "Callers who never reached an agent (numbers masked)", columns: ["Caller", "Calls", "Last call"], rows: data.unservedCallers.map((c) => [c.masked, c.calls, fmtDate(c.lastDate)]) },
        ],
      },
    );
    return slides;
  }, [data, showLobs, periods]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error && !data) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  const h = data?.headline;
  const activeSlide = tab === "overview" ? "Overview" : tab === "hourly" ? "Hour-wise" : tab === "datewise" ? "Date-wise"
    : tab === "agents" ? "Agent-wise" : tab === "lobs" ? "LOB-wise" : tab === "wait" ? "Wait & Abandon" : "Callers";

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={PhoneIncoming} eyebrow={`${meta.name} · Process Performance`} title="Inbound Call Performance"
        tabs={tabs} activeTab={tab} onTabChange={setTab} gradient={meta.gradient}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DashboardExportMenu
            reportTitle={`${meta.name} — Inbound Call Performance`}
            fileBaseName={`${meta.name}_Inbound`}
            raw={{ dashboard: `inbound_${projectKey}`, from, to }}
            subtitle={`${from} to ${to}${campaign !== "all" ? ` · ${campaign}` : ""}`}
            slides={exportSlides}
            activeSlideTitle={activeSlide}
          />
          {campaigns.length > 1 && (
            <Select value={campaign} onValueChange={setCampaign}>
              <SelectTrigger className="h-8 w-[220px] bg-white text-xs" aria-label="Filter by LOB / campaign">
                <SelectValue placeholder="All LOBs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All LOBs / campaigns</SelectItem>
                {campaigns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {data && data.insights.length > 0 && (
            <button
              type="button"
              onClick={() => setInsightsOpen(true)}
              title="Key insights"
              aria-label={`Key insights (${data.insights.length})`}
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 shadow-sm transition-colors hover:bg-amber-100"
            >
              <Lightbulb className="h-4 w-4" />
              <span
                className={`absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ${
                  data.insights.some((i) => i.tone === "bad") ? "bg-red-500" : data.insights.some((i) => i.tone === "warn") ? "bg-amber-500" : "bg-slate-400"
                }`}
              >
                {data.insights.length}
              </span>
            </button>
          )}
        </div>
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = last30DaysRange(); setFrom(r.from); setTo(r.to); }}
          resetLabel="Last 30 Days" accentFocus="focus:border-blue-400"
        />
      </div>

      {(unavailable || error) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          {error || "The dialer data source didn't respond — figures below may be stale or incomplete. Try again shortly."}
        </div>
      )}
      {data?.truncated && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          This range holds more calls than the dashboard can aggregate at once, so the earliest calls are shown. Narrow the date range for exact figures.
        </div>
      )}
      {loading && data && <div className="text-[11px] font-medium text-slate-400">Refreshing…</div>}

      {data && h && h.offered === 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          No inbound calls for {meta.name}{campaign !== "all" ? ` (${campaign})` : ""} between {fmtDate(from)} and {fmtDate(to)}.
        </div>
      )}

      {data && h && h.offered > 0 && (
        <>
          {/* ───────────────────────────── Overview ───────────────────────────── */}
          {tab === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <KpiCard icon={PhoneCall} label="Offered Calls" value={fmtNum(h.offered)} sub={`${h.avgCallsPerDay}/day over ${h.daysWithCalls} days`} tone="blue" />
                <KpiCard icon={PhoneIncoming} label="Answered" value={fmtNum(h.answered)} sub={`${h.answeredPct}% of offered`} tone="emerald" />
                <KpiCard icon={PhoneOff} label="Abandoned (AL %)" value={`${h.abandonPct}%`} sub={`${fmtNum(h.abandoned)} calls`} tone="rose" />
                <KpiCard icon={Radio} label={`SL % (${h.slThresholdSec}s)`} value={`${h.slPct}%`} sub={`${h.slOfAnsweredPct}% of answered`} tone="indigo" />
                <KpiCard icon={Timer} label="AHT" value={fmtSec(h.aht)} sub={`Talk ${fmtSec(h.avgTalk)}`} tone="violet" />
                <KpiCard icon={Hourglass} label="Avg Speed of Answer" value={fmtSec(h.asa)} sub={`Longest wait ${fmtSec(h.maxWait)}`} tone="amber" />
                <KpiCard icon={Clock3} label="Avg Abandon Wait" value={fmtSec(h.avgAbandonWait)} sub={`${h.shortAbandonPct}% drop ≤${h.slThresholdSec}s`} tone="red" />
                <KpiCard icon={PauseCircle} label="Avg Hold" value={fmtSec(h.avgHold)} sub={`${h.holdCallPct}% calls put on hold`} tone="cyan" />
                <KpiCard icon={Timer} label="Avg After-call Work" value={fmtSec(h.avgAcw)} tone="teal" />
                <KpiCard icon={Users} label="Active Agents" value={String(h.agentsActive)} sub={`${h.callsPerAgent} calls / agent`} tone="sky" />
                <KpiCard icon={Repeat} label="Repeat Callers" value={`${h.repeatCallerPct}%`} sub={`${fmtNum(h.repeatCallers)} of ${fmtNum(h.uniqueCallers)} callers`} tone="violet" />
                <KpiCard icon={UserX} label="Never Answered" value={fmtNum(h.unservedCallers)} sub="callers, whole range" tone="rose" />
                {h.afterHours > 0 && (
                  <KpiCard icon={Clock3} label="After-hours calls" value={fmtNum(h.afterHours)} sub="counted as answered by the client report" tone="amber" />
                )}
                {h.fcrPct != null && <KpiCard icon={Gauge} label="FCR %" value={`${h.fcrPct}%`} sub="first-contact resolution" tone="teal" />}
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <SectionCard icon={PhoneCall} title="Daily call volume" tone="blue">
                    <ResponsiveContainer width="100%" height={250}>
                      <ComposedChart data={data.daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                        <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="r" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} />
                        <Tooltip labelFormatter={(v: unknown) => fmtDate(String(v))} contentStyle={TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="l" dataKey="answered" name="Answered" stackId="c" fill="#10b981" radius={[0, 0, 0, 0]} />
                        <Bar yAxisId="l" dataKey="abandoned" name="Abandoned" stackId="c" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                        <Line yAxisId="r" type="monotone" dataKey="slPct" name="SL %" stroke="#6366f1" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </SectionCard>
                </div>
                <SectionCard icon={Gauge} title="Answered vs abandoned" tone="indigo">
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={[{ name: "Answered", value: h.answered }, { name: "Abandoned", value: h.abandoned }]}
                        dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={84} paddingAngle={2}
                        label={(p: { name?: string; percent?: number }) => `${p.name ?? ""} ${Math.round((p.percent ?? 0) * 100)}%`}
                      >
                        <Cell fill="#10b981" stroke="white" strokeWidth={2} />
                        <Cell fill="#f43f5e" stroke="white" strokeWidth={2} />
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                </SectionCard>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard icon={Clock3} title="Hourly volume & abandon %" tone="teal">
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={data.hourly} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                      <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="r" orientation="right" unit="%" tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="l" dataKey="offered" name="Offered" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="r" type="monotone" dataKey="abandonPct" name="AL %" stroke="#f43f5e" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </SectionCard>
                <SectionCard icon={CalendarDays} title="Weekday pattern" tone="violet" footnote="Average calls per day of that weekday within the selected range.">
                  <TableShell minWidth={420}>
                    <thead><tr className={THEAD}><Head first>Day</Head><Head>Days</Head><Head>Avg / day</Head><Head>AL %</Head><Head>SL %</Head><Head>AHT</Head></tr></thead>
                    <tbody>
                      {data.weekdays.map((w, i) => (
                        <tr key={w.weekday} className={rowCls(i)} onClick={() => openDrill(`All ${w.weekday}s in range`, { weekday: w.weekday })}>
                          <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{w.weekday}</td>
                          <td className={td}>{w.days}</td>
                          <td className={`${td} font-semibold`}>{w.avgPerDay}</td>
                          <td className={`${td} font-semibold ${abTone(w.abandonPct)}`}>{w.abandonPct}%</td>
                          <td className={`${td} font-semibold ${slTone(w.slPct)}`}>{w.slPct}%</td>
                          <td className={td}>{fmtSec(w.aht)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </SectionCard>
              </div>
            </div>
          )}

          {/* ───────────────────────────── Hour-wise ───────────────────────────── */}
          {tab === "hourly" && (
            <div className="space-y-4">
              <SectionCard icon={Clock3} title="Hour-wise offered, SL % and AL %" tone="teal" footnote="Hour is the call's dialer time slot. Peak-hour staffing should follow the tallest bars; SL/AL lines show where service breaks.">
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={data.hourly} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="r" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="l" dataKey="answered" name="Answered" stackId="c" fill="#10b981" />
                    <Bar yAxisId="l" dataKey="abandoned" name="Abandoned" stackId="c" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                    <Line yAxisId="r" type="monotone" dataKey="slPct" name="SL %" stroke="#6366f1" strokeWidth={2} dot={false} />
                    <Line yAxisId="r" type="monotone" dataKey="abandonPct" name="AL %" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </SectionCard>

              <SectionCard icon={Layers} title="Hour-wise call performance" tone="blue" footnote="Click a row to see the calls in that hour.">
                <TableShell minWidth={860}>
                  <thead><tr className={THEAD}>
                    <Head first>Hour</Head><Head>Offered</Head><Head>Share</Head><Head>Avg / day</Head><Head>Answered</Head><Head>Abandoned</Head>
                    <Head>AL %</Head><Head>SL %</Head><Head>AHT</Head><Head>ASA</Head><Head>Avg abandon wait</Head>
                  </tr></thead>
                  <tbody>
                    {data.hourly.map((r, i) => (
                      <tr key={r.hour} className={rowCls(i)} onClick={() => openDrill(`Calls at ${r.label}`, { hour: r.hour })}>
                        <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{r.label}</td>
                        <td className={`${td} font-semibold`}>{fmtNum(r.offered)}</td>
                        <td className={td}>{r.sharePct}%</td>
                        <td className={td}>{r.avgPerDay}</td>
                        <td className={`${td} text-emerald-700`}>{fmtNum(r.answered)}</td>
                        <td className={`${td} text-rose-600`}>{fmtNum(r.abandoned)}</td>
                        <td className={`${td} font-bold ${abTone(r.abandonPct)}`}>{r.abandonPct}%</td>
                        <td className={`${td} font-bold ${slTone(r.slPct)}`}>{r.slPct}%</td>
                        <td className={td}>{fmtSec(r.aht)}</td>
                        <td className={td}>{fmtSec(r.asa)}</td>
                        <td className={td}>{r.abandoned ? fmtSec(r.avgAbandonWait) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </SectionCard>

              <SectionCard icon={Layers} title="15-minute slot performance" tone="cyan" footnote="Offered/answered summed across the whole selected range, in 15-minute-of-day buckets. Click a row to see those calls.">
                <TableShell minWidth={860}>
                  <thead><tr className={THEAD}>
                    <Head first>Slot</Head><Head>Offered</Head><Head>Share</Head><Head>Answered</Head><Head>Abandoned</Head>
                    <Head>AL %</Head><Head>SL %</Head><Head>AHT</Head><Head>ASA</Head>
                  </tr></thead>
                  <tbody>
                    {data.quarterHourly.map((r, i) => (
                      <tr key={r.slot} className={rowCls(i)} onClick={() => openDrill(`Calls at ${r.slot}`, { quarter: r.slot })}>
                        <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{r.slot}</td>
                        <td className={`${td} font-semibold`}>{fmtNum(r.offered)}</td>
                        <td className={td}>{r.sharePct}%</td>
                        <td className={`${td} text-emerald-700`}>{fmtNum(r.answered)}</td>
                        <td className={`${td} text-rose-600`}>{fmtNum(r.abandoned)}</td>
                        <td className={`${td} font-bold ${abTone(r.abandonPct)}`}>{r.abandonPct}%</td>
                        <td className={`${td} font-bold ${slTone(r.slPct)}`}>{r.slPct}%</td>
                        <td className={td}>{fmtSec(r.aht)}</td>
                        <td className={td}>{fmtSec(r.asa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </SectionCard>

              <SectionCard icon={TrendingUp} title="Date × hour heatmap" tone="rose" footnote="Darker = more calls. Click any cell to open the calls behind it.">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Show</span>
                  <Select value={heatMetric} onValueChange={(v) => setHeatMetric(v as "offered" | "abandoned")}>
                    <SelectTrigger className="h-8 w-[170px] bg-white text-xs" aria-label="Heatmap metric"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="offered">Offered calls</SelectItem>
                      <SelectItem value="abandoned">Abandoned calls</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="border-collapse text-center text-[11px]">
                    <thead>
                      <tr className="bg-slate-50/80 text-slate-400">
                        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-bold text-slate-500">Date</th>
                        {heat.hours.map((hr) => <th key={hr} className="px-2 py-2 font-semibold">{String(hr).padStart(2, "0")}h</th>)}
                        <th className="px-3 py-2 font-bold text-slate-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heat.dates.map((d) => {
                        let rowTotal = 0;
                        return (
                          <tr key={d} className="border-t border-slate-50">
                            <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 text-left font-medium text-slate-600">{formatShortDate(d)}</td>
                            {heat.hours.map((hr) => {
                              const c = heat.cells.get(`${d}|${hr}`);
                              const v = c ? c[heatMetric] : 0;
                              rowTotal += v;
                              return (
                                <td
                                  key={hr}
                                  onClick={v ? () => openDrill(`${fmtDate(d)} · ${String(hr).padStart(2, "0")}:00`, { date: d, hour: hr, ...(heatMetric === "abandoned" ? { outcome: "abandoned" } : {}) }) : undefined}
                                  className={`h-8 min-w-[34px] px-1 font-medium ${v ? "cursor-pointer text-slate-800 hover:ring-2 hover:ring-inset hover:ring-blue-400" : "text-slate-300"}`}
                                  style={{ background: heatBg(v, heat.max, heatMetric === "offered" ? "14, 165, 233" : "244, 63, 94") }}
                                >
                                  {v || "·"}
                                </td>
                              );
                            })}
                            <td className="px-3 font-bold text-slate-700">{rowTotal}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ───────────────────────────── Date-wise ───────────────────────────── */}
          {tab === "datewise" && (
            <div className="space-y-4">
              <SectionCard icon={Gauge} title="Date-wise answered, AL % and SL %" tone="blue">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`ib-${projectKey}-ans`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                    <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="r" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} />
                    <Tooltip labelFormatter={(v: unknown) => fmtDate(String(v))} contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area yAxisId="l" type="monotone" dataKey="answered" name="Answered" stroke="#10b981" strokeWidth={2.5} fill={`url(#ib-${projectKey}-ans)`} />
                    <Line yAxisId="r" type="monotone" dataKey="slPct" name="SL %" stroke="#6366f1" strokeWidth={2} dot={false} />
                    <Line yAxisId="r" type="monotone" dataKey="abandonPct" name="AL %" stroke="#f43f5e" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </SectionCard>

              <SectionCard icon={PhoneCall} title="Date-wise call performance" tone="blue" footnote="Click a row to see that day's calls.">
                <TableShell minWidth={980}>
                  <thead><tr className={THEAD}>
                    <Head first>Date</Head><Head>Day</Head><Head>Agents</Head><Head>Offered</Head><Head>Answered</Head><Head>Abandoned</Head>
                    <Head>Answer %</Head><Head>AL %</Head><Head>SL %</Head><Head>AHT</Head><Head>ASA</Head><Head>Unique callers</Head>
                    {h.fcrPct != null && <Head>FCR %</Head>}
                  </tr></thead>
                  <tbody>
                    {[...data.daily].reverse().map((r, i) => (
                      <tr key={r.date} className={rowCls(i)} onClick={() => openDrill(`Calls on ${fmtDate(r.date)}`, { date: r.date })}>
                        <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{fmtDate(r.date)}</td>
                        <td className={`${td} text-left`}>{r.weekday}</td>
                        <td className={td}>{r.agents}</td>
                        <td className={`${td} font-semibold`}>{fmtNum(r.offered)}</td>
                        <td className={`${td} bg-emerald-50/30 font-bold text-emerald-700`}>{fmtNum(r.answered)}</td>
                        <td className={`${td} text-rose-600`}>{fmtNum(r.abandoned)}</td>
                        <td className={td}>{r.answeredPct}%</td>
                        <td className={`${td} bg-rose-50/30 font-bold ${abTone(r.abandonPct)}`}>{r.abandonPct}%</td>
                        <td className={`${td} bg-indigo-50/30 font-bold ${slTone(r.slPct)}`}>{r.slPct}%</td>
                        <td className={td}>{fmtSec(r.aht)}</td>
                        <td className={td}>{fmtSec(r.asa)}</td>
                        <td className={td}>{r.uniqueCallers}</td>
                        {h.fcrPct != null && <td className={td}>{r.fcrPct != null ? `${r.fcrPct}%` : "—"}</td>}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 bg-slate-100/70 font-bold text-slate-700">
                      <td className="py-2.5 pl-3 pr-3">Total</td><td /><td className={td}>{h.agentsActive}</td>
                      <td className={td}>{fmtNum(h.offered)}</td><td className={td}>{fmtNum(h.answered)}</td><td className={td}>{fmtNum(h.abandoned)}</td>
                      <td className={td}>{h.answeredPct}%</td><td className={td}>{h.abandonPct}%</td><td className={td}>{h.slPct}%</td>
                      <td className={td}>{fmtSec(h.aht)}</td><td className={td}>{fmtSec(h.asa)}</td><td className={td}>{fmtNum(h.uniqueCallers)}</td>
                      {h.fcrPct != null && <td className={td}>{h.fcrPct}%</td>}
                    </tr>
                  </tbody>
                </TableShell>
              </SectionCard>
            </div>
          )}

          {/* ───────────────────────────── Agent-wise ───────────────────────────── */}
          {tab === "agents" && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard icon={Users} title="Calls handled by agent" tone="indigo">
                  <ResponsiveContainer width="100%" height={Math.max(180, data.agents.length * 34)}>
                    <BarChart data={data.agents} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="agentName" width={110} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="handled" name="Handled" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </SectionCard>
                <SectionCard icon={Timer} title="AHT by agent (seconds)" tone="violet">
                  <ResponsiveContainer width="100%" height={Math.max(180, data.agents.length * 34)}>
                    <BarChart data={data.agents} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="agentName" width={110} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="aht" name="AHT (s)" fill="#a78bfa" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </SectionCard>
              </div>

              <SectionCard icon={Users} title="Agent-wise call performance" tone="indigo" footnote={`SL ≤${h.slThresholdSec}s = share of the agent's answered calls picked up within ${h.slThresholdSec}s of queueing. Short = under 10s, Long = 10 min or more. Click a row for the agent's calls.`}>
                <div className="relative mb-3 w-full max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)}
                    placeholder="Search agent name or ID..."
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm focus:border-blue-400 focus:outline-none"
                  />
                </div>
                <TableShell minWidth={1100}>
                  <thead><tr className={THEAD}>
                    <Head first>Agent</Head><Head>Handled</Head><Head>Share</Head><Head>SL ≤{h.slThresholdSec}s</Head><Head>AHT</Head><Head>Avg talk</Head>
                    <Head>Avg hold</Head><Head>Avg ACW</Head><Head>Days</Head><Head>Calls/day</Head><Head>Short</Head><Head>Long</Head>
                    <Head>Transfers</Head><Head>First → last call</Head>
                  </tr></thead>
                  <tbody>
                    {filteredAgents.map((a, i) => (
                      <tr key={a.agentId} className={rowCls(i)} onClick={() => openDrill(`${a.agentName} (${a.agentId})`, { agentId: a.agentId })}>
                        <td className="py-2.5 pl-3 pr-3">
                          <div className="font-medium text-slate-700">{a.agentName}</div>
                          <div className="text-[11px] text-slate-400">{a.agentId}</div>
                        </td>
                        <td className={`${td} font-bold text-slate-700`}>{fmtNum(a.handled)}</td>
                        <td className={td}>{a.sharePct}%</td>
                        <td className={`${td} font-bold ${slTone(a.slWithinPct)}`}>{a.slWithinPct}%</td>
                        <td className={td}>{fmtSec(a.aht)}</td>
                        <td className={td}>{fmtSec(a.avgTalk)}</td>
                        <td className={td}>{fmtSec(a.avgHold)}</td>
                        <td className={td}>{fmtSec(a.avgAcw)}</td>
                        <td className={td}>{a.daysActive}</td>
                        <td className={td}>{a.callsPerDay}</td>
                        <td className={td}>{a.shortCalls}</td>
                        <td className={td}>{a.longCalls}</td>
                        <td className={td}>{a.transfers}</td>
                        <td className={td}>{a.firstCall.slice(0, 5)} → {a.lastCall.slice(0, 5)}</td>
                      </tr>
                    ))}
                    {filteredAgents.length === 0 && <tr><td colSpan={14} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>}
                  </tbody>
                </TableShell>
              </SectionCard>

              <SectionCard icon={TrendingUp} title="Agent workload grid" tone="teal" footnote="Answered calls per agent. Darker = heavier load. Click a cell for those calls.">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Columns</span>
                  <Select value={agentGrid} onValueChange={(v) => setAgentGrid(v as "date" | "hour")}>
                    <SelectTrigger className="h-8 w-[150px] bg-white text-xs" aria-label="Grid columns"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date">By date</SelectItem>
                      <SelectItem value="hour">By hour</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="border-collapse text-center text-[11px]">
                    <thead>
                      <tr className="bg-slate-50/80 text-slate-400">
                        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-bold text-slate-500">Agent</th>
                        {agentGridData.cols.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-2 font-semibold">{c.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.agents.map((a) => (
                        <tr key={a.agentId} className="border-t border-slate-50">
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 text-left font-medium text-slate-600">{a.agentName}</td>
                          {agentGridData.cols.map((c) => {
                            const v = agentGridData.cells.get(`${a.agentId}|${c.key}`) ?? 0;
                            return (
                              <td
                                key={c.key}
                                onClick={v ? () => openDrill(`${a.agentName} · ${c.label}`, { agentId: a.agentId, ...(agentGrid === "date" ? { date: c.key } : { hour: c.key }) }) : undefined}
                                className={`h-8 min-w-[34px] px-1 font-medium ${v ? "cursor-pointer text-slate-800 hover:ring-2 hover:ring-inset hover:ring-blue-400" : "text-slate-300"}`}
                                style={{ background: heatBg(v, agentGridData.max, "99, 102, 241") }}
                              >
                                {v || "·"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ───────────────────────────── LOB-wise ───────────────────────────── */}
          {tab === "lobs" && showLobs && (
            <div className="space-y-4">
              <SectionCard icon={Layers} title="Daily volume by LOB / campaign" tone="violet">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={lobDailyPivot} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip labelFormatter={(v: unknown) => fmtDate(String(v))} contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.lobs.map((l, i) => (
                      <Bar key={l.campaign} dataKey={l.campaign} stackId="lob" fill={LOB_COLORS[i % LOB_COLORS.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </SectionCard>
              {data.lobGroups && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {([["Brand", data.lobGroups.byBrand], ["Language", data.lobGroups.byLanguage]] as const).map(([title, rows]) => (
                    <SectionCard key={title} icon={Layers} title={`${title}-wise roll-up`} tone="indigo" footnote="Grouped from the campaign names (H_ = Hindi, E_ = English; brand is the middle word).">
                      <TableShell minWidth={520}>
                        <thead><tr className={THEAD}><Head first>{title}</Head><Head>Offered</Head><Head>Share</Head><Head>AL %</Head><Head>SL %</Head><Head>AHT</Head></tr></thead>
                        <tbody>
                          {rows.map((g, i) => (
                            <tr key={g.label} className={`border-b border-slate-50 last:border-0 ${i % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}>
                              <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{g.label}</td>
                              <td className={`${td} font-semibold`}>{fmtNum(g.offered)}</td>
                              <td className={td}>{g.sharePct}%</td>
                              <td className={`${td} font-bold ${abTone(g.abandonPct)}`}>{g.abandonPct}%</td>
                              <td className={`${td} font-bold ${slTone(g.slPct)}`}>{g.slPct}%</td>
                              <td className={td}>{fmtSec(g.aht)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </TableShell>
                    </SectionCard>
                  ))}
                </div>
              )}
              <SectionCard icon={Layers} title="LOB / campaign-wise performance" tone="violet" footnote="Each campaign is a language / line of business. Click a row for its calls.">
                <TableShell minWidth={980}>
                  <thead><tr className={THEAD}>
                    <Head first>Campaign</Head><Head>Offered</Head><Head>Share</Head><Head>Answered</Head><Head>Abandoned</Head><Head>AL %</Head>
                    <Head>SL %</Head><Head>AHT</Head><Head>ASA</Head><Head>Unique callers</Head><Head>Agents</Head>
                  </tr></thead>
                  <tbody>
                    {data.lobs.map((l, i) => (
                      <tr key={l.campaign} className={rowCls(i)} onClick={() => { setCampaign(l.campaign); setTab("overview"); }}>
                        <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{l.campaign}</td>
                        <td className={`${td} font-semibold`}>{fmtNum(l.offered)}</td>
                        <td className={td}>{l.sharePct}%</td>
                        <td className={`${td} text-emerald-700`}>{fmtNum(l.answered)}</td>
                        <td className={`${td} text-rose-600`}>{fmtNum(l.abandoned)}</td>
                        <td className={`${td} font-bold ${abTone(l.abandonPct)}`}>{l.abandonPct}%</td>
                        <td className={`${td} font-bold ${slTone(l.slPct)}`}>{l.slPct}%</td>
                        <td className={td}>{fmtSec(l.aht)}</td>
                        <td className={td}>{fmtSec(l.asa)}</td>
                        <td className={td}>{fmtNum(l.uniqueCallers)}</td>
                        <td className={td}>{l.agents}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
                <p className="mt-2 text-[11px] text-slate-400">Clicking a campaign filters the whole dashboard to it (use the LOB dropdown to go back to all).</p>
              </SectionCard>
            </div>
          )}

          {/* ─────────────────────────── Wait & Abandon ─────────────────────────── */}
          {tab === "wait" && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard icon={Hourglass} title="Queue wait distribution" tone="amber" footnote="How long callers waited before an agent picked up (answered) or they hung up (abandoned). Click a bar's row below for calls.">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data.waitBuckets} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="answered" name="Answered" stackId="w" fill="#10b981" />
                      <Bar dataKey="abandoned" name="Abandoned" stackId="w" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </SectionCard>
                <SectionCard icon={Timer} title="Answered call duration" tone="violet">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data.talkBuckets} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="calls" name="Calls" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </SectionCard>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard icon={Hourglass} title="Wait bucket detail" tone="amber">
                  <TableShell minWidth={380}>
                    <thead><tr className={THEAD}><Head first>Wait</Head><Head>Answered</Head><Head>Abandoned</Head><Head>Abandon %</Head></tr></thead>
                    <tbody>
                      {data.waitBuckets.map((b, i) => (
                        <tr key={b.label} className={rowCls(i)} onClick={() => openDrill(`Queue wait ${b.label}`, { waitBucket: b.label })}>
                          <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{b.label}</td>
                          <td className={`${td} text-emerald-700`}>{fmtNum(b.answered)}</td>
                          <td className={`${td} text-rose-600`}>{fmtNum(b.abandoned)}</td>
                          <td className={td}>{b.answered + b.abandoned ? `${Math.round((b.abandoned / (b.answered + b.abandoned)) * 1000) / 10}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </SectionCard>
                <SectionCard icon={PhoneOff} title="Why calls were abandoned" tone="rose" footnote="Disposition / who disconnected, for calls that never reached an agent.">
                  {data.abandonReasons.length === 0 ? <div className="py-6 text-center text-xs text-slate-400">None</div> : (
                    <TableShell minWidth={340}>
                      <thead><tr className={THEAD}><Head first>Reason</Head><Head>Calls</Head><Head>Share</Head></tr></thead>
                      <tbody>
                        {data.abandonReasons.map((r, i) => {
                          const [disposition, disconnBy] = r.label.split(" / ");
                          return (
                            <tr key={r.label} className={rowCls(i)} onClick={() => openDrill(`Abandoned: ${r.label}`, { outcome: "abandoned", disposition, disconnBy })}>
                              <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{r.label}</td>
                              <td className={td}>{fmtNum(r.count)}</td>
                              <td className={td}>{Math.round((r.count / h.abandoned) * 1000) / 10}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </TableShell>
                  )}
                </SectionCard>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard icon={Layers} title="Disposition" tone="blue">
                  <TableShell minWidth={300}>
                    <thead><tr className={THEAD}><Head first>Disposition</Head><Head>Calls</Head><Head>Share</Head></tr></thead>
                    <tbody>
                      {data.dispositions.map((d, i) => (
                        <tr key={d.label} className={rowCls(i)} onClick={() => openDrill(`Disposition ${d.label}`, { disposition: d.label })}>
                          <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{d.label}</td>
                          <td className={td}>{fmtNum(d.count)}</td>
                          <td className={td}>{Math.round((d.count / h.offered) * 1000) / 10}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </SectionCard>
                <SectionCard icon={ArrowRightLeft} title="Who ended the call" tone="teal">
                  <TableShell minWidth={300}>
                    <thead><tr className={THEAD}><Head first>Disconnected by</Head><Head>Calls</Head><Head>Share</Head></tr></thead>
                    <tbody>
                      {data.disconnects.map((d, i) => (
                        <tr key={d.label} className={rowCls(i)} onClick={() => openDrill(`Disconnected by ${d.label}`, { disconnBy: d.label })}>
                          <td className="py-2.5 pl-3 pr-3 font-medium text-slate-700">{d.label}</td>
                          <td className={td}>{fmtNum(d.count)}</td>
                          <td className={td}>{Math.round((d.count / h.offered) * 1000) / 10}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </SectionCard>
              </div>
            </div>
          )}

          {/* ───────────────────────────── Callers ───────────────────────────── */}
          {tab === "callers" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard icon={Users} label="Unique callers" value={fmtNum(h.uniqueCallers)} tone="sky" />
                <KpiCard icon={Repeat} label="Repeat callers" value={fmtNum(h.repeatCallers)} sub={`${h.repeatCallerPct}% of callers`} tone="violet" />
                <KpiCard icon={PhoneCall} label="Calls from repeat callers" value={`${h.repeatCallPct}%`} sub="of all calls" tone="amber" />
                <KpiCard icon={UserX} label="Never reached an agent" value={fmtNum(h.unservedCallers)} sub="need a callback" tone="rose" />
              </div>

              {h.sharedNumber && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium leading-relaxed text-amber-800">
                  {h.sharedNumber.sharePct}% of calls ({fmtNum(h.sharedNumber.calls)}) come from a single number ({h.sharedNumber.masked}). That is a shared line, not a
                  customer, so it is left out of the caller, repeat and never-answered figures on this tab.
                </div>
              )}
              <SectionCard icon={Repeat} title="How often callers call" tone="violet" footnote="Callers grouped by number of calls in the selected range. Numbers are masked; rows open that caller's calls.">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.repeatDist} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="callers" name="Callers" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </SectionCard>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard icon={Repeat} title="Top repeat callers" tone="amber">
                  <CallerTable rows={data.topRepeatCallers} showLobs={showLobs} onOpen={(c) => openDrill(`Caller ${c.masked}`, { callerKey: c.key })} />
                </SectionCard>
                <SectionCard icon={UserX} title="Callers who never reached an agent" tone="rose" footnote="Every call from these numbers was abandoned in the selected range — priority callback list.">
                  <CallerTable rows={data.unservedCallers} showLobs={showLobs} onOpen={(c) => openDrill(`Caller ${c.masked}`, { callerKey: c.key })} />
                </SectionCard>
              </div>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-400">
            Offered = every call routed to the queue · Answered = handled by an agent{h.afterHours > 0 ? " (plus after-hours calls, as the client report counts them)" : ""} · Abandoned = never reached an agent · SL % = answered within {h.slThresholdSec}s as % of offered ·
            AHT = average duration of answered calls · ASA = average queue wait of answered calls. Occupancy and staffing-plan views are not shown because the dialer data has no login-time or roster source.
          </p>
        </>
      )}

      <Dialog open={insightsOpen} onOpenChange={setInsightsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" /> Key insights</DialogTitle>
            <DialogDescription>
              {meta.name} · {fmtDate(from)} – {fmtDate(to)}{campaign !== "all" ? ` · ${campaign}` : ""}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {(data?.insights ?? []).map((i, idx) => (
              <li
                key={idx}
                className={`rounded-xl border px-3 py-2 text-sm leading-relaxed ${
                  i.tone === "bad" ? "border-red-100 bg-red-50 text-red-700"
                    : i.tone === "warn" ? "border-amber-100 bg-amber-50 text-amber-800"
                      : i.tone === "good" ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                        : "border-slate-100 bg-slate-50 text-slate-600"
                }`}
              >
                {i.text}
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">Computed from the calls in the selected range — nothing here is estimated.</p>
        </DialogContent>
      </Dialog>

      <CallDrawer projectKey={projectKey} from={from} to={to} campaign={campaign} spec={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

function CallerTable({ rows, showLobs, onOpen }: { rows: CallerRow[]; showLobs: boolean; onOpen: (c: CallerRow) => void }) {
  if (rows.length === 0) return <div className="py-6 text-center text-xs text-slate-400">None</div>;
  return (
    <TableShell minWidth={showLobs ? 520 : 400}>
      <thead><tr className={THEAD}><Head first>Caller</Head><Head>Calls</Head><Head>Answered</Head><Head>Abandoned</Head><Head>Last call</Head></tr></thead>
      <tbody>
        {rows.map((c, i) => (
          <tr key={c.key} className={rowCls(i)} onClick={() => onOpen(c)}>
            <td className="py-2.5 pl-3 pr-3 font-mono text-[11px] font-medium text-slate-700">
              {c.masked}
              {showLobs && c.campaigns.length > 0 && <div className="font-sans text-[10px] font-normal text-slate-400">{c.campaigns.join(", ")}</div>}
            </td>
            <td className={`${td} font-bold`}>{c.calls}</td>
            <td className={`${td} text-emerald-700`}>{c.answered}</td>
            <td className={`${td} text-rose-600`}>{c.abandoned}</td>
            <td className={td}>{fmtDate(c.lastDate)}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/** Right-side slide-over listing the individual calls behind whatever was clicked. */
function CallDrawer({
  projectKey, from, to, campaign, spec, onClose,
}: {
  projectKey: InboundInsightProject; from: string; to: string; campaign: string; spec: DrillSpec | null; onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CallsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setPage(1); setResult(null); }, [spec]);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ startDate: from, endDate: to, page: String(page) });
    if (campaign !== "all") qs.set("campaign", campaign);
    for (const [k, v] of Object.entries(spec.params)) qs.set(k, String(v));
    hrmsApi
      .get<{ success: boolean; _unavailable?: boolean; data: CallsPage | null }>(`/api/inbound-insights/${projectKey}/calls?${qs.toString()}`)
      .then((res) => { if (!cancelled) { if (res.data) setResult(res.data); else setError("The dialer data source didn't respond."); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load calls."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [spec, page, projectKey, from, to, campaign]);

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <Sheet open={spec !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{spec?.title ?? "Calls"}</SheetTitle>
          <SheetDescription>
            {fmtDate(from)} – {fmtDate(to)}{campaign !== "all" ? ` · ${campaign}` : ""}{result ? ` · ${fmtNum(result.total)} call${result.total === 1 ? "" : "s"}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Calls</p>
          {loading && !result && <Spinner tone="blue" />}
          {error && <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
          {result && result.rows.length === 0 && <div className="py-6 text-center text-xs text-slate-400">None</div>}
          {result && result.rows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[640px] border-collapse text-left text-[11px]">
                  <thead>
                    <tr className={THEAD}>
                      <th className="px-2 py-2 font-semibold">When</th><th className="px-2 py-2 font-semibold">Caller</th>
                      <th className="px-2 py-2 font-semibold">Agent</th><th className="px-2 py-2 font-semibold">Outcome</th>
                      <th className="px-2 py-2 text-right font-semibold">Wait</th><th className="px-2 py-2 text-right font-semibold">Talk</th>
                      <th className="px-2 py-2 text-right font-semibold">Hold</th><th className="px-2 py-2 text-right font-semibold">ACW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r, i) => (
                      <tr key={r.id} className={`border-b border-slate-50 last:border-0 ${i % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-600">{fmtDate(r.date)} {r.time.slice(0, 5)}</td>
                        <td className="px-2 py-2 font-mono text-slate-700">
                          {r.caller}
                          {r.callsInPeriod > 1 && <div className="font-sans text-[10px] text-slate-400">{r.callsInPeriod} calls in range</div>}
                        </td>
                        <td className="px-2 py-2 text-slate-600">
                          {r.agentName ?? "—"}
                          {r.transferred && <div className="text-[10px] text-amber-600">transferred</div>}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.outcome === "Answered" ? "bg-emerald-100 text-emerald-700" : r.outcome === "After-hours" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{r.outcome}</span>
                          <div className="mt-0.5 text-[10px] text-slate-400">{r.disposition} · {r.disconnBy}{r.withinSl ? " · in SL" : ""}</div>
                          <div className="text-[10px] text-slate-400">{r.campaign}</div>
                        </td>
                        <td className="px-2 py-2 text-right text-slate-600">{fmtSec(r.waitSec)}</td>
                        <td className="px-2 py-2 text-right text-slate-600">{fmtSec(r.talkSec)}</td>
                        <td className="px-2 py-2 text-right text-slate-600">{fmtSec(r.holdSec)}</td>
                        <td className="px-2 py-2 text-right text-slate-600">{fmtSec(r.acwSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold disabled:opacity-40">Previous</button>
                  <span>Page {page} of {pages}</span>
                  <button type="button" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold disabled:opacity-40">Next</button>
                </div>
              )}
            </>
          )}
          <p className="pt-2 text-[10px] text-slate-400">Caller numbers are masked. The full numbers are in the raw data sheet of the Excel export.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
