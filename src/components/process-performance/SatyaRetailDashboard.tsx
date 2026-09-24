import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, BarChart, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Store, Eye, Users, PhoneCall, PhoneForwarded, ShoppingBag, Gauge, Clock, Sun, Moon, IndianRupee, Filter, TrendingUp, ListChecks, Layers,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  currentMonthRange, formatINR, formatShortDate, localDateStr, type ExportSlide, type KpiTone,
} from "./DashboardKit";
import { SatyaAgentTab } from "./SatyaAgentTab";
import { SatyaDailyTracker } from "./SatyaDailyTracker";
import { SatyaDetailDrawer, type SatyaDetailTarget } from "./SatyaDetailDrawer";
import { GncDetailDrawer, type DrawerSeries } from "./GncAbandonCartDetailDrawer";
import {
  callsMade, filtersQuery, fmtInt, fmtRatio, outcomeLabel, ratio, subDispositionTotals, weekOf, type SatyaReportData,
} from "./satyaReportModel";

/**
 * Satya Retail dashboard -- the ops team's "Calling & Order Tracking" Excel
 * (Overall / Morning / Absentee allocation, Pending, Calls, Unique, Orders,
 * Conversion %, the Connect block and the outcome list) as a clickable live
 * dashboard over db_masmis.satya_allocation / satya_cdr, through GET
 * /api/process-performance/satya-retail-report. Definitions come from
 * satya-retail-report.service.ts (reconciled against that Excel): calls made
 * = allocation - pending; conversion % = orders / calls made; conversion %
 * at connect = orders from unique calls / connected.
 *
 * Every KPI card and chart's "View details" opens a Trend + Week-wise +
 * Date-wise drawer built from the per-day rows already loaded (weeks are the
 * Excel's day-of-month buckets, W-1 = 1st-7th ...). Agent rows open the
 * agent drill-down. The Daily Tracker tab is the Excel grid itself.
 */

type TabKey = "overview" | "agents" | "tracker";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agent-wise" },
  { key: "tracker", label: "Daily Tracker" },
];
const ALL = "all";
const TT = { fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" } as const;
const FUNNEL_COLORS = ["#f59e0b", "#f97316", "#10b981", "#7c3aed"];
const OUTCOME_COLORS = ["#7c3aed", "#f59e0b", "#10b981", "#0ea5e9", "#f43f5e", "#14b8a6", "#6366f1", "#ec4899"];

type Preset = "MTD" | "WTD" | "YTD";
function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const to = localDateStr(now);
  if (p === "MTD") return currentMonthRange();
  if (p === "YTD") return { from: localDateStr(new Date(now.getFullYear(), 0, 1)), to };
  const mon = new Date(now);
  mon.setDate(mon.getDate() - ((now.getDay() + 6) % 7));
  return { from: localDateStr(mon), to };
}

interface Bucket {
  allocation: number; morning: number; absentee: number; pending: number; calls: number; unique: number; repeat: number;
  connected: number; notConnected: number; dropped: number; orders: number; ordersUnique: number; revenue: number;
  morningCalls: number; absenteeCalls: number; morningConnected: number; absenteeConnected: number;
  morningOrders: number; absenteeOrders: number; morningPending: number; absenteePending: number;
}
const emptyBucket = (): Bucket => ({
  allocation: 0, morning: 0, absentee: 0, pending: 0, calls: 0, unique: 0, repeat: 0, connected: 0, notConnected: 0, dropped: 0,
  orders: 0, ordersUnique: 0, revenue: 0, morningCalls: 0, absenteeCalls: 0, morningConnected: 0, absenteeConnected: 0,
  morningOrders: 0, absenteeOrders: 0, morningPending: 0, absenteePending: 0,
});

/** Adds ratios so every drawer/table reads the same recomputed values (never averaged percentages). */
function withRatios(b: Bucket) {
  return {
    ...b,
    conversionOverall: ratio(b.orders, b.calls) ?? 0,
    conversionMorning: ratio(b.morningOrders, b.morningCalls) ?? 0,
    conversionAbsentee: ratio(b.absenteeOrders, b.absenteeCalls) ?? 0,
    connectPct: ratio(b.connected, b.connected + b.notConnected) ?? 0,
    conversionAtConnect: ratio(b.ordersUnique, b.connected) ?? 0,
    aov: b.orders > 0 ? Math.round(b.revenue / b.orders) : 0,
  };
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

function FunnelBars({ stages }: { stages: Array<{ stage: string; count: number }> }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <div className="space-y-1">
      {stages.map((s, i) => (
        <div key={s.stage} className="flex items-center gap-2">
          <div
            className="flex h-8 items-center justify-center rounded-md text-xs font-bold text-white shadow-sm"
            style={{ width: `${Math.max(12, (s.count / max) * 100)}%`, backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }}
          >
            {fmtInt(s.count)}
          </div>
          <div className="text-[10px] font-semibold leading-tight text-slate-600">{s.stage}</div>
        </div>
      ))}
    </div>
  );
}

export function SatyaRetailDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [warehouse, setWarehouse] = useState(ALL);
  const [roster, setRoster] = useState(ALL);
  const [tab, setTab] = useState<TabKey>("overview");
  const [data, setData] = useState<SatyaReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [agentDrawer, setAgentDrawer] = useState<SatyaDetailTarget | null>(null);
  const [metric, setMetric] = useState<{ title: string; series: DrawerSeries[]; outcomes?: boolean } | null>(null);

  const filters = useMemo(
    () => ({ from, to, warehouse: warehouse === ALL ? null : warehouse, roster: roster === ALL ? null : roster }),
    [from, to, warehouse, roster],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: SatyaReportData }>(`/api/process-performance/satya-retail-report?${filtersQuery(filters)}`, 90000);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Satya Retail dashboard.");
    } finally {
      setLoading(false);
    }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);

  /** One row per date, all rosters folded in, with Morning / Absentee kept separate. */
  const dailyEnriched = useMemo(() => {
    const byDate = new Map<string, Bucket>();
    for (const r of data?.daily ?? []) {
      const b = byDate.get(r.date) ?? emptyBucket();
      const c = r.counts;
      const calls = callsMade(c);
      b.allocation += c.allocation; b.pending += c.pending; b.calls += calls; b.unique += c.unique; b.repeat += c.repeat;
      b.connected += c.connected; b.notConnected += c.notConnected; b.dropped += c.dropped;
      b.orders += c.orders; b.ordersUnique += c.ordersUnique; b.revenue += c.revenue;
      if (r.roster === "Morning") {
        b.morning += c.allocation; b.morningCalls += calls; b.morningConnected += c.connected; b.morningOrders += c.orders; b.morningPending += c.pending;
      } else if (r.roster === "Absentee") {
        b.absentee += c.allocation; b.absenteeCalls += calls; b.absenteeConnected += c.connected; b.absenteeOrders += c.orders; b.absenteePending += c.pending;
      }
      byDate.set(r.date, b);
    }
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, b]) => ({ date, ...withRatios(b) }));
  }, [data]);

  /** Weeks are the Excel's day-of-month buckets (W-1 = 1st-7th ...). */
  const weeklyEnriched = useMemo(() => {
    const weeks = new Map<number, Bucket>();
    for (const d of dailyEnriched) {
      const w = weekOf(d.date);
      const b = weeks.get(w) ?? emptyBucket();
      (Object.keys(b) as Array<keyof Bucket>).forEach((k) => { b[k] += d[k]; });
      weeks.set(w, b);
    }
    return [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([w, b]) => ({ label: `W-${w}`, ...withRatios(b) }));
  }, [dailyEnriched]);

  const outcomeTotals = useMemo(() => (data ? subDispositionTotals(data, "Connected") : []), [data]);
  const outcomeNames = useMemo(() => outcomeTotals.map((o) => outcomeLabel(o.name)), [outcomeTotals]);

  const outcomeDaily = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number>>();
    for (const r of data?.subDispositionDaily ?? []) {
      if (r.disposition !== "Connected") continue;
      const row = byDate.get(r.date) ?? { date: r.date };
      const k = outcomeLabel(r.subDisposition);
      row[k] = (Number(row[k]) || 0) + r.count;
      byDate.set(r.date, row);
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [data]);
  const outcomeWeekly = useMemo(() => {
    const weeks = new Map<number, Record<string, string | number>>();
    for (const r of outcomeDaily) {
      const w = weekOf(String(r.date));
      const row = weeks.get(w) ?? { label: `W-${w}` };
      for (const k of Object.keys(r)) if (k !== "date") row[k] = (Number(row[k]) || 0) + Number(r[k]);
      weeks.set(w, row);
    }
    return [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
  }, [outcomeDaily]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const h = data.headline;
    const made = callsMade(h);
    return [{
      title: "Overview",
      kpis: [
        { label: "Overall Allocation", value: fmtInt(h.allocation) }, { label: "Pending", value: fmtInt(h.pending) },
        { label: "Call (calls made)", value: fmtInt(made) }, { label: "Unique", value: fmtInt(h.unique) },
        { label: "Order Placed", value: fmtInt(h.orders) }, { label: "Conversion % on Overall", value: fmtRatio(ratio(h.orders, made)) },
        { label: "Connect", value: fmtInt(h.connected) }, { label: "Conversion % at connect", value: fmtRatio(ratio(h.ordersUnique, h.connected)) },
        { label: "Order Revenue", value: formatINR(h.revenue) },
      ],
      tables: [
        {
          title: "Daily", columns: ["Date", "Allocation", "Morning", "Absentee", "Pending", "Calls", "Unique", "Connect", "Orders", "Conv %", "Revenue"],
          rows: dailyEnriched.map((d) => [d.date, d.allocation, d.morning, d.absentee, d.pending, d.calls, d.unique, d.connected, d.orders, `${d.conversionOverall}%`, formatINR(d.revenue)]),
        },
        { title: "Outcomes on connected calls", columns: ["Outcome", "Count"], rows: outcomeTotals.map((o) => [outcomeLabel(o.name), o.count]) },
      ],
    }, {
      title: "Agent-wise",
      tables: [{
        title: "Agent-wise", columns: ["Agent", "Allocation", "Calls", "Unique", "Connected", "Orders", "Revenue"],
        rows: data.agents.map((a) => [a.agentName, a.counts.allocation, callsMade(a.counts), a.counts.unique, a.counts.connected, a.counts.orders, formatINR(a.counts.revenue)]),
      }],
    }];
  }, [data, dailyEnriched, outcomeTotals]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const h = data.headline;
  const made = callsMade(h);
  const dialled = h.connected + h.notConnected;
  const sum = (k: keyof Bucket) => dailyEnriched.reduce((s, d) => s + d[k], 0);
  const morning = sum("morning"), absentee = sum("absentee");
  const mCalls = sum("morningCalls"), aCalls = sum("absenteeCalls");
  const mConn = sum("morningConnected"), aConn = sum("absenteeConnected");
  const mOrd = sum("morningOrders"), aOrd = sum("absenteeOrders");
  const mPend = sum("morningPending"), aPend = sum("absenteePending");

  const S = (key: string, label: string, fmt: DrawerSeries["fmt"], color: string): DrawerSeries => ({ key, label, fmt, color });
  const open = (title: string, series: DrawerSeries[]) => setMetric({ title, series });
  const kpi = (icon: typeof Store, label: string, value: string, tone: KpiTone, series: DrawerSeries[], sub?: string) => (
    <KpiCard icon={icon} label={label} value={value} sub={sub} tone={tone} onClick={() => open(label, series)} />
  );

  return (
    <div className="space-y-3">
      <DashboardHero<TabKey>
        icon={Store} eyebrow="Satya Retail · Process Performance" title="Satya Retail Dashboard"
        tabs={TABS} activeTab={tab} onTabChange={setTab} gradient="from-amber-600 via-orange-600 to-amber-700"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle="Satya Retail Dashboard" fileBaseName="Satya_Retail" raw={{ dashboard: "satya_retail", from, to }}
          subtitle={`${from} to ${to}`} slides={exportSlides} activeSlideTitle={tab === "agents" ? "Agent-wise" : "Overview"}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={warehouse} onValueChange={setWarehouse}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Warehouse" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All warehouses</SelectItem>
              {data.available.warehouses.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={roster} onValueChange={setRoster}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Roster" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All rosters</SelectItem>
              {["Morning", "Absentee", "Unmapped"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white text-[11px] font-bold">
            {(["MTD", "WTD", "YTD"] as Preset[]).map((p) => {
              const r = presetRange(p);
              return (
                <button
                  key={p} type="button" onClick={() => { setFrom(r.from); setTo(r.to); }}
                  className={`px-3 py-1.5 transition-colors ${r.from === from && r.to === to ? "bg-amber-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                >{p}</button>
              );
            })}
          </div>
          <DateRangeToolbar
            from={from} to={to} onFrom={setFrom} onTo={setTo}
            onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }} resetLabel="This Month"
          />
        </div>
      </div>

      {tab === "overview" && (
        <>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Allocation &amp; calls</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {kpi(Store, "Overall Allocation", fmtInt(h.allocation), "amber", [S("allocation", "Overall", "int", "#f59e0b"), S("morning", "Morning", "int", "#0ea5e9"), S("absentee", "Absentee", "int", "#8b5cf6")])}
            {kpi(Sun, "Morning", fmtInt(morning), "sky", [S("morning", "Morning Allocation", "int", "#0ea5e9")])}
            {kpi(Moon, "Absentee", fmtInt(absentee), "violet", [S("absentee", "Absentee Allocation", "int", "#8b5cf6")])}
            {kpi(Clock, "Pending", fmtInt(h.pending), "rose", [S("pending", "Overall", "int", "#f43f5e"), S("morningPending", "Morning", "int", "#0ea5e9"), S("absenteePending", "Absentee", "int", "#8b5cf6")])}
            {kpi(PhoneCall, "Call", fmtInt(made), "indigo", [S("calls", "Calls Made", "int", "#6366f1")], "allocation − pending")}
            {kpi(Users, "Unique", fmtInt(h.unique), "teal", [S("unique", "Unique Calls", "int", "#14b8a6"), S("repeat", "Repeat Calls", "int", "#94a3b8")])}
            {kpi(ShoppingBag, "Order Placed", fmtInt(h.orders), "emerald", [S("orders", "Overall", "int", "#10b981"), S("morningOrders", "Morning", "int", "#0ea5e9"), S("absenteeOrders", "Absentee", "int", "#8b5cf6")])}
            {kpi(Gauge, "Conversion % on Overall", fmtRatio(ratio(h.orders, made)), "amber", [S("conversionOverall", "Conversion %", "pct", "#f59e0b")], "orders ÷ calls made")}
            {kpi(Gauge, "Conversion % on Morning", fmtRatio(ratio(mOrd, mCalls)), "sky", [S("conversionMorning", "Conversion % Morning", "pct", "#0ea5e9")])}
            {kpi(Gauge, "Conversion % on Absentee", fmtRatio(ratio(aOrd, aCalls)), "violet", [S("conversionAbsentee", "Conversion % Absentee", "pct", "#8b5cf6")])}
          </div>

          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Connect</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {kpi(PhoneForwarded, "Connect", fmtInt(h.connected), "emerald", [S("connected", "Connected", "int", "#10b981"), S("morningConnected", "Morning", "int", "#0ea5e9"), S("absenteeConnected", "Absentee", "int", "#8b5cf6")])}
            {kpi(Sun, "Connect · Morning", fmtInt(mConn), "sky", [S("morningConnected", "Morning Connected", "int", "#0ea5e9")])}
            {kpi(Moon, "Connect · Absentee", fmtInt(aConn), "violet", [S("absenteeConnected", "Absentee Connected", "int", "#8b5cf6")])}
            {kpi(Gauge, "Connect %", fmtRatio(ratio(h.connected, dialled)), "teal", [S("connectPct", "Connect %", "pct", "#14b8a6")], "connected ÷ dialled")}
            {kpi(ShoppingBag, "Order Placed (at connect)", fmtInt(h.ordersUnique), "amber", [S("ordersUnique", "Orders from unique calls", "int", "#f59e0b")])}
            {kpi(Gauge, "Conversion % at connect", fmtRatio(ratio(h.ordersUnique, h.connected)), "rose", [S("conversionAtConnect", "Conversion % at connect", "pct", "#f43f5e")])}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Order placed</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {kpi(ShoppingBag, "Overall", fmtInt(h.orders), "emerald", [S("orders", "Order Placed", "int", "#10b981")])}
                {kpi(Sun, "Morning", fmtInt(mOrd), "sky", [S("morningOrders", "Morning Orders", "int", "#0ea5e9")])}
                {kpi(Moon, "Absentee", fmtInt(aOrd), "violet", [S("absenteeOrders", "Absentee Orders", "int", "#8b5cf6")])}
                {kpi(IndianRupee, "Revenue", formatINR(h.revenue), "teal", [S("revenue", "Order Revenue", "currency", "#14b8a6"), S("aov", "Avg Order", "currency", "#f59e0b")], h.orders ? `AOV ${formatINR(Math.round(h.revenue / h.orders))}` : undefined)}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Pending</p>
              <div className="grid grid-cols-3 gap-2">
                {kpi(Clock, "Overall", fmtInt(h.pending), "rose", [S("pending", "Pending", "int", "#f43f5e")])}
                {kpi(Sun, "Morning", fmtInt(mPend), "sky", [S("morningPending", "Morning Pending", "int", "#0ea5e9")])}
                {kpi(Moon, "Absentee", fmtInt(aPend), "violet", [S("absenteePending", "Absentee Pending", "int", "#8b5cf6")])}
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <SectionCard
              icon={TrendingUp} title="Daily Trend" tone="amber"
              action={<ViewDetailsBtn onClick={() => open("Daily Trend", [S("allocation", "Allocation", "int", "#f59e0b"), S("calls", "Calls Made", "int", "#6366f1"), S("orders", "Orders", "int", "#10b981"), S("conversionOverall", "Conversion %", "pct", "#f43f5e")])} />}
            >
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={dailyEnriched} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} unit="%" />
                  <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={TT} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar yAxisId="l" dataKey="allocation" name="Allocation" fill="#fde68a" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="l" dataKey="orders" name="Orders" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="r" type="monotone" dataKey="conversionOverall" name="Conversion %" stroke="#f43f5e" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard
              icon={Layers} title="Morning vs Absentee" tone="violet"
              action={<ViewDetailsBtn onClick={() => open("Morning vs Absentee", [S("morning", "Morning Allocation", "int", "#0ea5e9"), S("absentee", "Absentee Allocation", "int", "#8b5cf6"), S("morningOrders", "Morning Orders", "int", "#38bdf8"), S("absenteeOrders", "Absentee Orders", "int", "#a78bfa")])} />}
            >
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={[
                    { name: "Allocation", Morning: morning, Absentee: absentee },
                    { name: "Calls", Morning: mCalls, Absentee: aCalls },
                    { name: "Connected", Morning: mConn, Absentee: aConn },
                    { name: "Orders", Morning: mOrd, Absentee: aOrd },
                  ]}
                  margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={TT} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Morning" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Absentee" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard
              icon={Filter} title="Call Funnel" tone="amber"
              action={<ViewDetailsBtn onClick={() => open("Call Funnel", [S("allocation", "Allocation", "int", "#f59e0b"), S("calls", "Calls Made", "int", "#f97316"), S("connected", "Connected", "int", "#10b981"), S("orders", "Order Placed", "int", "#7c3aed")])} />}
            >
              <FunnelBars stages={[
                { stage: "Overall Allocation", count: h.allocation }, { stage: "Calls Made", count: made },
                { stage: "Connected", count: h.connected }, { stage: "Order Placed", count: h.orders },
              ]} />
            </SectionCard>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <SectionCard
              icon={ListChecks} title="Outcomes on connected calls" tone="violet"
              footnote="The Excel's outcome list (Stock Available, Not Interested, Order Placed, Call Back, ...) -- the sub-disposition of connected calls."
              action={<ViewDetailsBtn onClick={() => setMetric({ title: "Outcomes on connected calls", outcomes: true, series: outcomeNames.slice(0, 8).map((n, i) => ({ key: n, label: n, fmt: "int" as const, color: OUTCOME_COLORS[i % OUTCOME_COLORS.length] })) })} />}
            >
              <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-violet-800 text-[10px] uppercase tracking-wide text-white">
                      <th className="px-2 py-1.5 text-left font-bold text-white">Outcome</th>
                      <th className="px-2 py-1.5 font-bold text-white">Count</th>
                      <th className="px-2 py-1.5 font-bold text-white">% of connected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outcomeTotals.map((o, i) => (
                      <tr key={o.name} className={`border-b border-slate-50 last:border-0 ${i % 2 ? "bg-violet-50/30" : "bg-white"}`}>
                        <td className="px-2 py-1.5 font-medium text-slate-700">{outcomeLabel(o.name)}</td>
                        <td className="px-2 py-1.5 text-center text-slate-600">{fmtInt(o.count)}</td>
                        <td className="px-2 py-1.5 text-center font-semibold text-violet-700">{fmtRatio(ratio(o.count, h.connected))}</td>
                      </tr>
                    ))}
                    {outcomeTotals.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-slate-400">No data for this period.</td></tr>}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard icon={ListChecks} title="Top outcomes" tone="amber" footnote="Top 8 outcomes by count; the full list is in the table.">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={outcomeTotals.slice(0, 8).map((o) => ({ name: outcomeLabel(o.name), count: o.count }))} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={TT} />
                  <Bar dataKey="count" name="Connected calls" radius={[0, 4, 4, 0]}>
                    {outcomeTotals.slice(0, 8).map((o, i) => <Cell key={o.name} fill={OUTCOME_COLORS[i % OUTCOME_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard
              icon={PhoneCall} title="Call Disposition" tone="teal"
              action={<ViewDetailsBtn onClick={() => open("Call Disposition", [S("connected", "Connected", "int", "#10b981"), S("notConnected", "Not Connected", "int", "#f43f5e"), S("dropped", "Call Dropped", "int", "#f59e0b"), S("pending", "Pending", "int", "#94a3b8")])} />}
            >
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Connected", value: h.connected }, { name: "Not Connected", value: h.notConnected },
                      { name: "Call Dropped", value: h.dropped }, { name: "Pending", value: h.pending },
                    ].filter((d) => d.value > 0).map((d) => ({ ...d, name: `${d.name} — ${ratio(d.value, h.allocation)}%` }))}
                    dataKey="value" nameKey="name" cx="50%" cy="46%" innerRadius={40} outerRadius={70} paddingAngle={2}
                  >
                    {["#10b981", "#f43f5e", "#f59e0b", "#94a3b8"].map((c) => <Cell key={c} fill={c} stroke="white" strokeWidth={2} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Tooltip contentStyle={TT} />
                </PieChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>
        </>
      )}

      {tab === "agents" && <SatyaAgentTab data={data} onOpen={setAgentDrawer} />}
      {tab === "tracker" && <SatyaDailyTracker data={data} />}

      <SatyaDetailDrawer target={agentDrawer} filters={filters} onClose={() => setAgentDrawer(null)} />
      {metric && (
        <GncDetailDrawer
          title={metric.title} eyebrow="Satya Retail · Week-wise & Date-wise" gradient="from-amber-700 via-orange-700 to-amber-800"
          series={metric.series}
          dailyRows={metric.outcomes ? outcomeDaily : dailyEnriched}
          weeklyRows={metric.outcomes ? outcomeWeekly : weeklyEnriched}
          onClose={() => setMetric(null)}
        />
      )}
    </div>
  );
}
