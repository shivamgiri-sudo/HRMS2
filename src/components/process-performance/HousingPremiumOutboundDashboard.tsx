import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ComposedChart, Bar, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  PhoneCall, PhoneIncoming, PhoneMissed, Users, Percent, Target, IndianRupee, ShoppingCart, BarChart3, TrendingUp,
  Headphones, Star, Clock, RefreshCw, Filter, ArrowUp, ArrowDown, Lightbulb, Flag, ChevronRight, Info, MousePointerClick,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { Spinner, formatINR } from "./DashboardKit";
import { type HPOverviewData, type HPOverviewValues, HP_API, fmtN, fmtDate } from "./housingPremiumShared";
import {
  METRICS, METRIC_BY_KEY, fmtMetric, changePct, previousRange, type MetricKey, type MetricDef,
} from "./housingPremiumMetrics";
import { HousingPremiumDrilldownDrawer, type HpDrillTarget } from "./HousingPremiumDrilldownDrawer";

/**
 * Housing Premium "Outbound Performance Dashboard": the KPI tiles, trend
 * charts, distribution/target/productivity panels and the Overall / TL-wise /
 * Day-Week tables from the supplied mock-up, all live from the overview
 * endpoint (pre_sale + Pre_cdr + pre_agent_details -- see the backend service
 * header for every formula). Nothing here is typed in: the previous-period
 * arrows come from a second overview call for the equal-length window before
 * the selected range, and the Key Insights / Next Action lines are rules over
 * the same numbers. Every tile, chart point, donut slice, table row and TL
 * column opens the drill-down drawer.
 */

const TOOLTIP_PROPS = {
  contentStyle: { fontSize: 12, borderRadius: 10, border: "1px solid #334155", background: "#0f172a", boxShadow: "0 8px 24px rgba(15,23,42,0.4)", padding: "8px 12px" },
  labelStyle: { color: "#f1f5f9", fontWeight: 600, marginBottom: 4 },
} as const;

/** Literal class strings so Tailwind's static scan compiles every gradient. */
const TONES = {
  blue: "from-blue-500 to-indigo-600",
  green: "from-emerald-500 to-green-600",
  red: "from-rose-500 to-red-600",
  purple: "from-violet-500 to-purple-600",
  gold: "from-amber-400 to-yellow-600",
  orange: "from-orange-400 to-amber-600",
  indigo: "from-indigo-500 to-blue-700",
  navy: "from-slate-700 to-indigo-900",
} as const;
type Tone = keyof typeof TONES;

const VISUAL: Record<MetricKey, { icon: ComponentType<{ className?: string }>; tone: Tone }> = {
  totalCalls: { icon: PhoneCall, tone: "blue" },
  connected: { icon: PhoneIncoming, tone: "green" },
  notConnected: { icon: PhoneMissed, tone: "red" },
  uniqueConnected: { icon: Users, tone: "purple" },
  connectedPct: { icon: Percent, tone: "green" },
  target: { icon: Target, tone: "gold" },
  revenue: { icon: IndianRupee, tone: "green" },
  saleCount: { icon: ShoppingCart, tone: "orange" },
  achievedPct: { icon: BarChart3, tone: "indigo" },
  aov: { icon: TrendingUp, tone: "purple" },
  presentCount: { icon: Users, tone: "blue" },
  perAgentDialCount: { icon: Headphones, tone: "navy" },
  avgSalePerAgent: { icon: Star, tone: "gold" },
  avgTalkPerAgentSec: { icon: Clock, tone: "indigo" },
};

const ROW1: MetricKey[] = ["totalCalls", "connected", "notConnected", "uniqueConnected", "connectedPct", "target"];
const ROW2: MetricKey[] = ["revenue", "saleCount", "achievedPct", "aov", "presentCount", "perAgentDialCount", "avgSalePerAgent"];

type NavTab = "overview" | "tlTarget" | "daywise" | "agentwise";

/* --------------------------------- deltas --------------------------------- */

interface Delta { text: string; good: boolean; up: boolean }
/** Arrow vs the previous period -- a percentage-points move for rates, a % change for counts and amounts. */
function deltaFor(m: MetricDef, cur: HPOverviewValues | undefined, prev: HPOverviewValues | undefined): Delta | null {
  if (!cur || !prev || m.goodWhenUp === undefined) return null;
  const c = cur[m.key]; const p = prev[m.key];
  if (m.fmt === "pct") {
    if (prev.totalCalls <= 0) return null;
    const pts = Math.round((c - p) * 10) / 10;
    if (pts === 0) return null;
    return { text: `${Math.abs(pts)} pts`, up: pts > 0, good: pts > 0 === m.goodWhenUp };
  }
  const ch = changePct(c, p);
  if (ch === null || ch === 0) return null;
  return { text: `${Math.abs(ch)}%`, up: ch > 0, good: ch > 0 === m.goodWhenUp };
}
function DeltaText({ d }: { d: Delta | null }) {
  if (!d) return null;
  const Icon = d.up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${d.good ? "text-emerald-600" : "text-rose-600"}`}>
      <Icon className="h-3 w-3" />{d.text}
    </span>
  );
}

function MetricTile({ m, value, delta, showPrev, onClick }: { m: MetricDef; value: number | undefined; delta: Delta | null; showPrev: boolean; onClick: () => void }) {
  const { icon: Icon, tone } = VISUAL[m.key];
  return (
    <button
      type="button" onClick={onClick} title={`${m.label} — click for the day, week and TL breakdown`}
      className="group flex items-center gap-3 rounded-2xl border border-white/70 bg-white/85 p-3 text-left shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow ${TONES[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-slate-500">{m.label}</span>
        <span className="block truncate text-xl font-bold leading-tight tracking-tight text-slate-800">{fmtMetric(value, m.fmt)}</span>
        <span className="flex items-center gap-1 leading-none">
          <DeltaText d={delta} />
          {delta && showPrev && <span className="text-[9px] text-slate-400">vs previous period</span>}
        </span>
      </span>
    </button>
  );
}

function Panel({ title, action, children, className = "" }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}
function GranSelect({ value, onChange, disabled }: { value: "day" | "week"; onChange: (v: "day" | "week") => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as "day" | "week")} disabled={disabled}>
      <SelectTrigger className="h-7 w-[92px] bg-white text-[11px]" aria-label="Chart granularity"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="day">Daily</SelectItem>
        <SelectItem value="week">Weekly</SelectItem>
      </SelectContent>
    </Select>
  );
}

/* -------------------------------- insights --------------------------------- */

function buildInsights(v: HPOverviewValues, pv: HPOverviewValues | undefined, tlRows: Array<{ tlName: string; v: HPOverviewValues | undefined }>): { insights: string[]; actions: string[] } {
  const insights: string[] = []; const actions: string[] = [];
  const verb = (ch: number, up: string, down: string) => (ch >= 0 ? up : down);
  if (pv) {
    const calls = changePct(v.totalCalls, pv.totalCalls);
    if (calls !== null) insights.push(`Total calls ${verb(calls, "increased", "decreased")} by ${Math.abs(calls)}% compared to the previous period.`);
    const rev = changePct(v.revenue, pv.revenue);
    const aov = changePct(v.aov, pv.aov);
    if (rev !== null) insights.push(`Revenue ${verb(rev, "grew", "fell")} by ${Math.abs(rev)}%${aov !== null ? ` with AOV ${verb(aov, "up", "down")} ${Math.abs(aov)}%` : ""}.`);
    const sales = changePct(v.saleCount, pv.saleCount);
    if (sales !== null) insights.push(`Sale count ${verb(sales, "increased", "decreased")} by ${Math.abs(sales)}%.`);
  }
  if (v.totalCalls > 0) insights.push(`Connected % is ${Math.round(v.connectedPct * 10) / 10}%${pv && pv.totalCalls > 0 ? ` (${v.connectedPct >= pv.connectedPct ? "+" : "−"}${Math.abs(Math.round((v.connectedPct - pv.connectedPct) * 10) / 10)} pts vs previous period)` : ""}.`);
  if (v.target > 0) insights.push(`Revenue achieved is ${Math.round(v.achievedPct)}% of the ${formatINR(v.target)} target.`);

  if (v.target > 0 && v.achievedPct < 100 && v.aov > 0) {
    const gap = v.target - v.revenue;
    actions.push(`${formatINR(gap)} is still needed to reach target — about ${fmtN(Math.ceil(gap / v.aov))} more sales at the current AOV of ${formatINR(v.aov)}.`);
  }
  if (pv && pv.totalCalls > 0 && v.totalCalls > 0 && v.connectedPct < pv.connectedPct - 1) {
    actions.push(`Connected % fell ${Math.round((pv.connectedPct - v.connectedPct) * 10) / 10} pts vs the previous period — review calling patterns in the Day Wise and Agent Wise tabs.`);
  }
  const withTarget = tlRows.filter((t) => t.v && t.v.target > 0);
  if (withTarget.length > 1) {
    const worst = withTarget.reduce((a, b) => ((b.v as HPOverviewValues).achievedPct < (a.v as HPOverviewValues).achievedPct ? b : a));
    actions.push(`${worst.tlName} is at ${Math.round((worst.v as HPOverviewValues).achievedPct)}% of target, the lowest among TLs — open TL Target to see the agents behind the gap.`);
  }
  if (v.presentCount > 0 && v.saleCount === 0) actions.push("Agents are dialling but no sale is recorded in this window — check the uploaded Sale file covers the same dates.");
  return { insights: insights.slice(0, 4), actions: actions.slice(0, 4) };
}

/* ================================== MAIN =================================== */

export function HousingPremiumOutboundDashboard({
  from, to, agents, onOpenAgent, onNavigate, toolbarSlot,
}: {
  from: string; to: string; agents: string[]; onOpenAgent: (name: string) => void; onNavigate: (tab: NavTab) => void;
  /** When given, the TL / Agent / Week / Refresh controls render there (the page's date-range row) instead of in this dashboard's own header, which frees that whole block of vertical space. */
  toolbarSlot?: HTMLElement | null;
}) {
  const [data, setData] = useState<HPOverviewData | null>(null);
  const [prev, setPrev] = useState<HPOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [tl, setTl] = useState("all");
  const [agent, setAgent] = useState("all");
  // Filter local to the Achievement vs Target card (does not touch the rest of the page).
  const [targetTl, setTargetTl] = useState("all");
  const [targetFilterOpen, setTargetFilterOpen] = useState(false);
  const [week, setWeek] = useState("all");
  const [gran, setGran] = useState<"day" | "week">("day");
  const [tableGran, setTableGran] = useState<"day" | "week">("week");
  const [drill, setDrill] = useState<HpDrillTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const agentQs = agent !== "all" ? `&agent=${encodeURIComponent(agent)}` : "";
    const pr = previousRange(from, to);
    Promise.all([
      hrmsApi.get<{ success: boolean; data: HPOverviewData }>(`${HP_API}/overview?from=${from}&to=${to}${agentQs}`),
      hrmsApi.get<{ success: boolean; data: HPOverviewData }>(`${HP_API}/overview?from=${pr.from}&to=${pr.to}${agentQs}`).then((r) => r.data).catch(() => null),
    ]).then(([cur, p]) => { if (!cancelled) { setData(cur.data); setPrev(p); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the dashboard."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, agent, tick]);

  // The Week filter belongs to one date range -- drop it when the range changes.
  useEffect(() => { setWeek("all"); }, [from, to]);

  const scopeOf = (d: HPOverviewData | null): Record<string, HPOverviewValues> | null => {
    if (!d) return null;
    if (agent === "all" && tl !== "all") return d.byTl.find((t) => t.tlName === tl)?.values ?? d.overall;
    return d.overall;
  };
  const values = useMemo(() => scopeOf(data), [data, tl, agent]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevValues = useMemo(() => scopeOf(prev), [prev, tl, agent]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = data?.columns ?? [];
  const weekCols = columns.filter((c) => c.kind === "week");
  const dayCols = columns.filter((c) => c.kind === "day");
  const weekSel = week === "all" ? null : columns.find((c) => c.key === week) ?? null;
  const activeKey = weekSel ? weekSel.key : "mtd";
  const mtdCol = columns.find((c) => c.kind === "mtd");
  const activeLabel = weekSel ? weekSel.label : (mtdCol?.label ?? "MTD");
  const v = values?.[activeKey];
  const pv = weekSel ? undefined : prevValues?.mtd;
  const scopeLabel = agent !== "all" ? agent : tl !== "all" ? tl : "Overall";

  const effGran = dayCols.length === 0 ? "week" : gran;
  const series = useMemo(() => {
    if (!values) return [];
    const cols = effGran === "day" ? dayCols.filter((c) => !weekSel || (c.from >= weekSel.from && c.to <= weekSel.to)) : weekCols;
    return cols.map((c) => ({ key: c.key, label: c.label, ...values[c.key] }));
  }, [values, effGran, columns, weekSel]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartClick = (s: unknown) => {
    const k = (s as { activePayload?: Array<{ payload?: { key?: string } }> } | null)?.activePayload?.[0]?.payload?.key;
    if (k) setDrill({ kind: "period", colKey: k });
  };
  const openMetric = (key: MetricKey) => setDrill({ kind: "metric", key });
  const openGroup = (title: string, keys: MetricKey[]) => setDrill({ kind: "group", title, keys });

  const tlBlocks = data?.byTl ?? [];
  const { insights, actions } = useMemo(
    () => (v ? buildInsights(v, pv, tlBlocks.map((t) => ({ tlName: t.tlName, v: t.values[activeKey] }))) : { insights: [], actions: [] }),
    [v, pv, tlBlocks, activeKey],
  );

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data || !values || !v) return null;

  const tableCols = tableGran === "week" || dayCols.length === 0 ? weekCols : dayCols;
  const donut = [{ name: "Connected Calls", value: v.connected, color: "#22c55e", key: "connected" as MetricKey }, { name: "Not Connected Calls", value: v.notConnected, color: "#ef4444", key: "notConnected" as MetricKey }];
  const pctOfCalls = (n: number) => (v.totalCalls > 0 ? Math.round((n / v.totalCalls) * 1000) / 10 : 0);
  const revBar = v.target > 0 ? Math.min(100, (v.revenue / v.target) * 100) : 0;
  // MTD target = the monthly target prorated to the days in the selected range: the week columns partition the range and each carries its own prorated target. Not shown when a single week is picked (that week already IS the period).
  const mtdTarget = weekSel ? 0 : Math.round(weekCols.reduce((sum, c) => sum + (values[c.key]?.target ?? 0), 0));
  const mtdBar = v.target > 0 ? Math.min(100, (mtdTarget / v.target) * 100) : 0;
  const mtdAchPct = mtdTarget > 0 ? (v.revenue / mtdTarget) * 100 : 0;
  // Achievement vs Target card: optionally narrowed to one TL by its own filter icon (only when no page-level TL / agent filter is already applied).
  const cardLocked = agent !== "all" || tl !== "all";
  const cardTl = !cardLocked && targetTl !== "all" ? data.byTl.find((t) => t.tlName === targetTl) : undefined;
  const cardValues = cardTl ? cardTl.values : values;
  const cv = cardValues[activeKey] ?? v;
  const cMtdTarget = weekSel ? 0 : Math.round(weekCols.reduce((sum, c) => sum + (cardValues[c.key]?.target ?? 0), 0));
  const cRevBar = cv.target > 0 ? Math.min(100, (cv.revenue / cv.target) * 100) : 0;
  const cMtdBar = cv.target > 0 ? Math.min(100, (cMtdTarget / cv.target) * 100) : 0;
  const cMtdAch = cMtdTarget > 0 ? (cv.revenue / cMtdTarget) * 100 : 0;
  const empty = v.totalCalls === 0 && v.revenue === 0;

  const filtersEl = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">TL
        <Select value={tl} onValueChange={setTl} disabled={agent !== "all"}>
          <SelectTrigger className="h-8 w-[130px] bg-white text-xs" aria-label="Filter by TL"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {(data.byTl.length ? data.byTl : (prev?.byTl ?? [])).map((t) => <SelectItem key={t.tlName} value={t.tlName}>{t.tlName}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Agent
        <Select value={agent} onValueChange={(a) => { setAgent(a); if (a !== "all") setTl("all"); }}>
          <SelectTrigger className="h-8 w-[160px] bg-white text-xs" aria-label="Filter by agent"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">All</SelectItem>
            {agents.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Week
        <Select value={week} onValueChange={setWeek}>
          <SelectTrigger className="h-8 w-[120px] bg-white text-xs" aria-label="Filter by week"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {weekCols.map((w) => <SelectItem key={w.key} value={w.key}>{w.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <button
        type="button" onClick={() => setTick((t) => t + 1)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-amber-400 to-yellow-600 px-3 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
      </button>
    </div>
  );

  return (
    <div className={`space-y-4 rounded-3xl bg-gradient-to-br from-indigo-50/70 via-white to-amber-50/50 p-3 sm:p-4 ${loading ? "opacity-70" : ""}`}>
      {toolbarSlot && createPortal(filtersEl, toolbarSlot)}
      {/* Slim status line: scope on the left, the CDR completeness note (only when it applies) below. The page hero already names the dashboard. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex items-center gap-1 text-[11px] text-slate-400"><MousePointerClick className="h-3 w-3" /> Showing <b className="text-slate-600">{scopeLabel}</b> · {activeLabel} · every tile, chart point and table row is clickable.</p>
        {!toolbarSlot && filtersEl}
      </div>
      {data.cdrRowCount < data.saleRowCount && (
        <p className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-1.5 text-[11px] font-medium leading-snug text-sky-700">
          <Info className="h-3.5 w-3.5 shrink-0" /> Only {fmtN(data.cdrRowCount)} CDR call record(s) are uploaded against {fmtN(data.saleRowCount)} sale rows, so call metrics are incomplete until the full CDR file is uploaded. Sale, revenue and target figures are unaffected.
        </p>
      )}
      {empty && <p className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-400">No data for this selection in the chosen range.</p>}

      {/* KPI rows */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ROW1.map((k) => {
          const m = METRIC_BY_KEY.get(k)!;
          return <MetricTile key={k} m={m} value={v[k]} delta={deltaFor(m, v, pv)} showPrev={k === "totalCalls"} onClick={() => openMetric(k)} />;
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {ROW2.map((k) => {
          const m = METRIC_BY_KEY.get(k)!;
          return <MetricTile key={k} m={m} value={v[k]} delta={deltaFor(m, v, pv)} showPrev={k === "revenue"} onClick={() => openMetric(k)} />;
        })}
      </div>

      {/* trend charts */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Call Status Trend" action={<span className="inline-flex items-center gap-2"><ViewDetails onClick={() => openGroup("Call Status Trend", ["totalCalls", "connected", "notConnected", "uniqueConnected"])} /><GranSelect value={effGran} onChange={setGran} disabled={dayCols.length === 0} /></span>}>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={series} margin={{ top: 4, right: 4, left: -14, bottom: 0 }} onClick={chartClick} style={{ cursor: "pointer" }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip {...TOOLTIP_PROPS} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="circle" />
              <Bar dataKey="connected" name="Connected Calls" stackId="c" fill="#22c55e" />
              <Bar dataKey="notConnected" name="Not Connected Calls" stackId="c" fill="#ef4444" />
              <Line type="monotone" dataKey="totalCalls" name="Total Calls" stroke="#3730a3" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Sales & Revenue Trend" action={<span className="inline-flex items-center gap-2"><ViewDetails onClick={() => openGroup("Sales & Revenue Trend", ["saleCount", "revenue", "aov"])} /><GranSelect value={effGran} onChange={setGran} disabled={dayCols.length === 0} /></span>}>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={series} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} onClick={chartClick} style={{ cursor: "pointer" }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis yAxisId="l" tick={{ fontSize: 10 }} tickFormatter={(x: number) => (x >= 100000 ? `${Math.round(x / 10000) / 10}L` : String(x))} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(val: number, name: string) => (name.startsWith("Revenue") ? formatINR(Number(val)) : fmtN(Number(val)))} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="circle" />
              <Bar yAxisId="l" dataKey="revenue" name="Revenue (₹)" fill="#34a37d" radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sale Count" stroke="#3730a3" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Connection & Achievement" action={<span className="inline-flex items-center gap-2"><ViewDetails onClick={() => openGroup("Connection & Achievement", ["connectedPct", "achievedPct", "target", "revenue"])} /><GranSelect value={effGran} onChange={setGran} disabled={dayCols.length === 0} /></span>}>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={series.map((r) => ({ ...r, targetPct: 100 }))} margin={{ top: 4, right: 4, left: -14, bottom: 0 }} onClick={chartClick} style={{ cursor: "pointer" }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} domain={[0, (max: number) => Math.max(100, Math.ceil(max / 20) * 20)]} tickFormatter={(x: number) => `${x}%`} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(val: number) => `${Math.round(Number(val) * 10) / 10}%`} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="circle" />
              <Line type="monotone" dataKey="connectedPct" name="Connected %" stroke="#4338ca" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="achievedPct" name="Ach %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="targetPct" name="Target (100%)" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* distribution / target / productivity */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title={`Call Status Distribution (${activeLabel})`} action={<ViewDetails onClick={() => openGroup("Call Status Distribution", ["totalCalls", "connected", "notConnected", "uniqueConnected"])} />}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative h-[170px] w-[170px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="94%" paddingAngle={2} stroke="none" label={false}
                    onClick={(_d: unknown, i: number) => openMetric(donut[i].key)} style={{ cursor: "pointer" }}>
                    {donut.map((s) => <Cell key={s.name} fill={s.color} />)}
                  </Pie>
                  <Tooltip {...TOOLTIP_PROPS} formatter={(val: number) => fmtN(Number(val))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold leading-tight text-slate-800">{fmtN(v.totalCalls)}</span>
                <span className="text-[10px] font-semibold text-slate-400">Total Calls</span>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-2 text-xs">
              {[
                { name: "Connected Calls", n: v.connected, color: "#22c55e", key: "connected" as MetricKey },
                { name: "Not Connected Calls", n: v.notConnected, color: "#ef4444", key: "notConnected" as MetricKey },
                { name: "Unique Connected Calls", n: v.uniqueConnected, color: "#7c3aed", key: "uniqueConnected" as MetricKey },
              ].map((r) => (
                <li key={r.name}>
                  <button type="button" onClick={() => openMetric(r.key)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-indigo-50/70">
                    <span className="h-3 w-3 shrink-0 rounded" style={{ backgroundColor: r.color }} />
                    <span className="min-w-0"><span className="block truncate font-medium text-slate-600">{r.name}</span>
                      <span className="font-bold text-slate-800">{fmtN(r.n)} <span className="font-semibold text-slate-500">({pctOfCalls(r.n)}%)</span></span></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel
          title={<span>Achievement vs Target{cardTl ? <span className="ml-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">{cardTl.tlName}</span> : null}</span>}
          action={
            <span className="relative inline-flex items-center gap-2">
              <button
                type="button" onClick={() => setTargetFilterOpen((o) => !o)} disabled={cardLocked}
                aria-label="Filter this card by TL" aria-expanded={targetFilterOpen}
                title={cardLocked ? "A page-level TL / agent filter is already applied" : "Filter this card by TL"}
                className={`relative inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${targetTl !== "all" ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
              >
                <Filter className="h-3.5 w-3.5" />
                {targetTl !== "all" && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-indigo-500" />}
              </button>
              {targetFilterOpen && !cardLocked && (
                <div className="absolute right-0 top-8 z-20 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                  <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">TL</p>
                  {["all", ...tlBlocks.map((t) => t.tlName)].map((name) => (
                    <button
                      key={name} type="button" onClick={() => { setTargetTl(name); setTargetFilterOpen(false); }}
                      className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium ${targetTl === name ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}
                    >
                      {name === "all" ? "All TLs" : name}
                    </button>
                  ))}
                </div>
              )}
              <ViewDetails onClick={() => openGroup("Achievement vs Target", ["target", "revenue", "achievedPct"])} />
            </span>
          }
        >
          <button type="button" onClick={() => (cardTl ? setDrill({ kind: "tl", tlName: cardTl.tlName }) : openMetric("achievedPct"))} className="block w-full space-y-3 rounded-xl p-1 text-left transition-colors hover:bg-indigo-50/50">
            <TargetBar label={weekSel ? "Target" : "Target (month)"} pct={cv.target > 0 ? 100 : 0} text={formatINR(cv.target)} barClass="bg-amber-400 text-amber-950" />
            {cMtdTarget > 0 && <TargetBar label="MTD Target" pct={cMtdBar} text={formatINR(cMtdTarget)} barClass="bg-sky-500 text-white" />}
            <TargetBar label="Revenue Achieved" pct={cRevBar} text={formatINR(cv.revenue)} barClass="bg-indigo-500 text-white" />
            <div className="flex items-end justify-center gap-6 pt-1 text-center">
              <p className="text-3xl font-extrabold text-amber-500">{Math.round(cv.achievedPct)}%<span className="ml-1 block text-[11px] font-semibold text-slate-400">of {weekSel ? "target" : "month target"}</span></p>
              {cMtdTarget > 0 && <p className="text-3xl font-extrabold text-sky-600">{Math.round(cMtdAch)}%<span className="ml-1 block text-[11px] font-semibold text-slate-400">of MTD target</span></p>}
            </div>
          </button>
        </Panel>

        <Panel title="Productivity Snapshot" action={<ViewDetails onClick={() => openGroup("Productivity Snapshot", ["presentCount", "perAgentDialCount", "avgSalePerAgent", "avgTalkPerAgentSec"])} />}>
          <div className="grid grid-cols-2 gap-2">
            {(["presentCount", "perAgentDialCount", "avgSalePerAgent", "avgTalkPerAgentSec"] as MetricKey[]).map((k) => {
              const m = METRIC_BY_KEY.get(k)!; const { icon: Icon, tone } = VISUAL[k];
              return (
                <button key={k} type="button" onClick={() => openMetric(k)} className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-white p-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white ${TONES[tone]}`}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0"><span className="block truncate text-[10px] text-slate-500">{m.label}</span><span className="block text-base font-bold text-slate-800">{fmtMetric(v[k], m.fmt)}</span></span>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* tables */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel title={`Overall Performance (${activeLabel})`} action={<ViewDetails onClick={() => setDrill({ kind: "matrix", title: `Overall Performance (${activeLabel})` })} />}>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-center text-xs">
              <thead><tr className="bg-slate-700 text-[11px] font-bold text-white"><th className="px-3 py-2 text-left">Metric</th><th className="px-3 py-2">{activeLabel}</th></tr></thead>
              <tbody>
                {METRICS.map((m, i) => (
                  <tr key={m.key} onClick={() => openMetric(m.key)} className={`cursor-pointer transition-colors hover:bg-indigo-50/60 ${i % 2 ? "bg-slate-50/70" : "bg-white"}`}>
                    <td className="px-3 py-1.5 text-left font-medium text-slate-600">{m.label}</td>
                    <td className={`px-3 py-1.5 font-bold ${m.key === "achievedPct" ? "text-emerald-600" : "text-slate-800"}`}>{fmtMetric(v[m.key], m.fmt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={`TL Wise Performance (${activeLabel})`} action={<ViewDetails onClick={() => setDrill({ kind: "matrix", title: `TL Wise Performance (${activeLabel})`, tlName: tlBlocks[0]?.tlName })} />}>
          {tlBlocks.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{agent !== "all" ? "TL split isn't shown when a single agent is selected." : "None"}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-center text-xs">
                <thead>
                  <tr className="bg-slate-700 text-[11px] font-bold text-white">
                    <th className="px-3 py-2 text-left">Metric</th>
                    {tlBlocks.map((t) => (
                      <th key={t.tlName} className="px-3 py-2">
                        <button type="button" onClick={() => setDrill({ kind: "tl", tlName: t.tlName })} className="font-bold underline-offset-2 hover:underline" title={`${t.tlName} — weeks, days and agents`}>{t.tlName}</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((m, i) => (
                    <tr key={m.key} onClick={() => openMetric(m.key)} className={`cursor-pointer transition-colors hover:bg-indigo-50/60 ${i % 2 ? "bg-slate-50/70" : "bg-white"}`}>
                      <td className="px-3 py-1.5 text-left font-medium text-slate-600">{m.label}</td>
                      {tlBlocks.map((t) => <td key={t.tlName} className="px-3 py-1.5 font-semibold text-slate-800">{fmtMetric(t.values[activeKey]?.[m.key], m.fmt)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          title={`Day/Week Wise Metrics (${mtdCol?.label ?? "MTD"})`}
          action={<GranSelect value={tableGran} onChange={setTableGran} disabled={dayCols.length === 0} />}
        >
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-center text-[11px]">
              <thead>
                <tr className="bg-slate-700 font-bold text-white">
                  {[tableGran === "week" || dayCols.length === 0 ? "Week" : "Day", "Connected Calls", "Not Connected", "Unique Connected", "Total Calls", "Connected %", "Sale Count", "Revenue (₹)", "Ach%", "AOV"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {tableCols.map((c, i) => {
                  const x = values[c.key];
                  return (
                    <tr key={c.key} onClick={() => setDrill({ kind: "period", colKey: c.key })} className={`cursor-pointer transition-colors hover:bg-indigo-50/60 ${i % 2 ? "bg-slate-50/70" : "bg-white"}`}>
                      <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-700">{c.label}</td>
                      <td className="px-2 py-1.5">{fmtN(x?.connected ?? 0)}</td>
                      <td className="px-2 py-1.5">{fmtN(x?.notConnected ?? 0)}</td>
                      <td className="px-2 py-1.5">{fmtN(x?.uniqueConnected ?? 0)}</td>
                      <td className="px-2 py-1.5">{fmtN(x?.totalCalls ?? 0)}</td>
                      <td className="px-2 py-1.5">{Math.round((x?.connectedPct ?? 0) * 10) / 10}%</td>
                      <td className="px-2 py-1.5">{fmtN(x?.saleCount ?? 0)}</td>
                      <td className="px-2 py-1.5">{fmtN(Math.round(x?.revenue ?? 0))}</td>
                      <td className={`px-2 py-1.5 font-bold ${(x?.achievedPct ?? 0) >= 100 ? "text-emerald-600" : (x?.achievedPct ?? 0) >= 60 ? "text-amber-600" : "text-rose-600"}`}>{Math.round(x?.achievedPct ?? 0)}%</td>
                      <td className="px-2 py-1.5">{fmtN(x?.aov ?? 0)}</td>
                    </tr>
                  );
                })}
                {values.mtd && (
                  <tr onClick={() => openMetric("revenue")} className="cursor-pointer bg-amber-100 font-bold text-slate-900 hover:bg-amber-200/70">
                    <td className="px-2 py-2">{mtdCol?.label ?? "MTD"}</td>
                    <td className="px-2 py-2">{fmtN(values.mtd.connected)}</td>
                    <td className="px-2 py-2">{fmtN(values.mtd.notConnected)}</td>
                    <td className="px-2 py-2">{fmtN(values.mtd.uniqueConnected)}</td>
                    <td className="px-2 py-2">{fmtN(values.mtd.totalCalls)}</td>
                    <td className="px-2 py-2">{Math.round(values.mtd.connectedPct * 10) / 10}%</td>
                    <td className="px-2 py-2">{fmtN(values.mtd.saleCount)}</td>
                    <td className="px-2 py-2">{fmtN(Math.round(values.mtd.revenue))}</td>
                    <td className="px-2 py-2">{Math.round(values.mtd.achievedPct)}%</td>
                    <td className="px-2 py-2">{fmtN(values.mtd.aov)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel title={<span className="inline-flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-amber-500" /> Key Insights</span>}>
            {insights.length === 0 ? <p className="text-xs text-slate-400">Not enough data in this window to compare.</p> : (
              <ul className="space-y-1.5 text-xs text-slate-600">
                {insights.map((t) => <li key={t} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{t}</li>)}
              </ul>
            )}
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-1.5"><Flag className="h-4 w-4 text-rose-500" /> Next Action</span>}>
            {actions.length === 0 ? <p className="text-xs text-slate-400">Nothing flagged for this window.</p> : (
              <ul className="space-y-1.5 text-xs text-slate-600">
                {actions.map((t) => <li key={t} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />{t}</li>)}
              </ul>
            )}
            <p className="mt-2 text-[10px] text-slate-400">Auto-generated from the numbers above.</p>
          </Panel>
        </div>
      </div>

      {drill && (
        <HousingPremiumDrilldownDrawer
          target={drill} columns={columns} values={values} byTl={data.byTl} scopeLabel={scopeLabel}
          agentScope={agent !== "all" ? agent : null} from={from} to={to}
          onDrill={setDrill} onOpenAgent={onOpenAgent} onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

/** One labelled horizontal bar. The value text sits inside the bar when there is room and just past its end when the bar is short, so it is never clipped or unreadable. */
function TargetBar({ label, pct, text, barClass }: { label: string; pct: number; text: string; barClass: string }) {
  const w = Math.max(pct, 2);
  const inside = pct >= 34;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-24 shrink-0 text-right leading-tight text-slate-500">{label}</span>
      <div className="relative h-8 flex-1 rounded-md bg-slate-100">
        <div className={`flex h-full items-center justify-end rounded-md pr-2 text-[11px] font-bold ${barClass}`} style={{ width: `${w}%` }}>{inside ? text : null}</div>
        {!inside && <span className="absolute inset-y-0 flex items-center text-[11px] font-bold text-slate-700" style={{ left: `calc(${w}% + 6px)` }}>{text}</span>}
      </div>
    </div>
  );
}

function ViewDetails({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-indigo-600 hover:underline">
      View Details <ChevronRight className="h-3 w-3" />
    </button>
  );
}
