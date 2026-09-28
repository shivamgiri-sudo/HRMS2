import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  MessageSquare, Gauge, Clock3, Repeat, Users, ShoppingCart, IndianRupee,
  Wallet, Layers, ClipboardList, Eye, Timer, Target,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  formatINR, formatShortDate, currentMonthRange, localDateStr, type ExportSlide,
} from "./DashboardKit";
import { ComboTrend, Donut, fmtNum, PALETTE } from "./NeemansCharts";
import { GncDetailDrawer, type DrawerSeries } from "./GncAbandonCartDetailDrawer";

const API = "/api/process-performance/gnc-chat-dashboard";

/**
 * GNC Chat dashboard -- live over db_masmis.gnc_chat + gnc_sale (campaign =
 * 'Chat'), reverse-engineered from the user's own reference workbook
 * (GNC_Chat_Dashboard_Sep'26.xlsb). See gnc-chat-dashboard.service.ts for the
 * full formula-by-formula validation writeup this dashboard is built on.
 */

interface Headline {
  totalChats: number; uniqueChats: number; repeatChats: number;
  frtInTatCount: number; frtOutTatCount: number; frtInTatPct: number; resolutionInTatPct: number;
  orders: number; conversionPct: number; grossRevenue: number; netRevenue: number; aov: number;
  avgCsat: number; csatResponses: number;
  codCount: number; paidCount: number; codGross: number; codNet: number; paidGross: number; paidNet: number;
}
interface TrendRow {
  date: string; totalChats: number; uniqueChats: number; repeatChats: number;
  frtInTatCount: number; frtOutTatCount: number; frtInTatPct: number; resolutionInTatPct: number;
  orders: number; revenue: number; netRevenue: number; aov: number; codCount: number; paidCount: number;
}
interface NamedCount { count: number; pct: number }
interface AgentRow {
  agent: string; totalChats: number; uniqueChats: number;
  frtInTatPct: number; resolutionInTatPct: number;
}
interface DashboardData {
  from: string; to: string;
  headline: Headline;
  dateWiseTrend: TrendRow[];
  qrcDailyTrend: Array<{ date: string; qrc: string; count: number }>;
  qrcBreakdown: Array<{ qrc: string } & NamedCount>;
  channelBreakdown: Array<{ channel: string } & NamedCount>;
  statusBreakdown: Array<{ status: string } & NamedCount>;
  csatBreakdown: Array<{ rating: number; count: number }>;
  tagBreakdown: Array<{ tag: string; count: number }>;
  agents: AgentRow[];
  /** Chat LOB revenue target for the range (Targets page) -- absent/unconfigured until one is set. */
  target?: { tableAvailable: boolean; configured: boolean; monthlyTarget: number | null; rangeTarget: number | null; perAgentMonthlyTarget: number | null; agentCount: number | null; uncoveredMonths: string[]; revenue: number; achPct: number | null };
  saleLinkage: {
    matched: Array<{ agent: string; saleCount: number; revenue: number; target?: number | null; achPct?: number | null }>;
    unmatchedSaleNames: Array<{ name: string; saleCount: number; revenue: number }>;
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

type TabKey = "overview" | "agents" | "sale_linkage";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agent-wise" },
  { key: "sale_linkage", label: "Sale Linkage" },
];

export function GncChatDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(`${API}?from=${from}&to=${to}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the GNC Chat dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const headline = data?.headline;
  const [drawer, setDrawer] = useState<{
    title: string; series: DrawerSeries[];
    dailyRows: Array<Record<string, string | number>>; weeklyRows: Array<Record<string, string | number>>;
  } | null>(null);

  /** conversionPct isn't in the raw daily rows -- derived once here so every
   * "View details" drawer and the Daily Detailed Metrics table read the same
   * value instead of each recomputing it. */
  const dailyEnriched = useMemo(() => {
    if (!data) return [];
    return data.dateWiseTrend.map((d) => ({
      ...d,
      conversionPct: d.uniqueChats > 0 ? Math.round((d.orders / d.uniqueChats) * 10000) / 100 : 0,
    }));
  }, [data]);

  /** Mon-Sun weeks -- counts sum directly; percentage fields are recomputed
   * from the week's own summed numerators/denominators, not averaged from
   * daily percentages (averaging percentages would silently misweight days
   * with very different chat volume). */
  const weeklyEnriched = useMemo(() => {
    if (!dailyEnriched.length) return [];
    const weeks = new Map<string, {
      label: string; totalChats: number; uniqueChats: number; repeatChats: number;
      frtInTatCount: number; frtOutTatCount: number; orders: number; revenue: number; netRevenue: number;
      codCount: number; paidCount: number;
    }>();
    for (const d of dailyEnriched) {
      const dt = new Date(`${d.date}T00:00:00`);
      const diffToMon = (dt.getDay() + 6) % 7;
      const monday = new Date(dt);
      monday.setDate(monday.getDate() - diffToMon);
      const key = localDateStr(monday);
      const w = weeks.get(key) ?? {
        label: key, totalChats: 0, uniqueChats: 0, repeatChats: 0,
        frtInTatCount: 0, frtOutTatCount: 0, orders: 0, revenue: 0, netRevenue: 0, codCount: 0, paidCount: 0,
      };
      w.totalChats += d.totalChats; w.uniqueChats += d.uniqueChats; w.repeatChats += d.repeatChats;
      w.frtInTatCount += d.frtInTatCount; w.frtOutTatCount += d.frtOutTatCount;
      w.orders += d.orders; w.revenue += d.revenue; w.netRevenue += d.netRevenue;
      w.codCount += d.codCount; w.paidCount += d.paidCount;
      weeks.set(key, w);
    }
    return [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, w], i) => ({
      ...w, label: `Week ${i + 1}`,
      frtInTatPct: w.totalChats > 0 ? Math.round((w.frtInTatCount / w.totalChats) * 1000) / 10 : 0,
      conversionPct: w.uniqueChats > 0 ? Math.round((w.orders / w.uniqueChats) * 10000) / 100 : 0,
      aov: w.orders > 0 ? Math.round((w.revenue / w.orders) * 100) / 100 : 0,
    }));
  }, [dailyEnriched]);

  /** Chat Type Trend needs one row per date with a column per qrc bucket --
   * pivoted client-side from the flat (date, qrc, count) rows the backend
   * returns, so the stacked bar chart can read each bucket as its own key. */
  const qrcTypes = useMemo(() => (data ? [...new Set(data.qrcDailyTrend.map((r) => r.qrc))] : []), [data]);
  const qrcTrendPivoted = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, Record<string, string | number>>();
    for (const r of data.qrcDailyTrend) {
      const row = byDate.get(r.date) ?? { date: r.date };
      row[r.qrc] = r.count;
      byDate.set(r.date, row);
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [data]);
  const qrcWeeklyPivoted = useMemo(() => {
    if (!data) return [];
    const weeks = new Map<string, Record<string, string | number>>();
    for (const r of data.qrcDailyTrend) {
      const dt = new Date(`${r.date}T00:00:00`);
      const diffToMon = (dt.getDay() + 6) % 7;
      const monday = new Date(dt);
      monday.setDate(monday.getDate() - diffToMon);
      const key = localDateStr(monday);
      const row = weeks.get(key) ?? { label: key };
      row[r.qrc] = (Number(row[r.qrc]) || 0) + r.count;
      weeks.set(key, row);
    }
    return [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, w], i) => ({ ...w, label: `Week ${i + 1}` }));
  }, [data]);

  const openDrawer = (title: string, series: DrawerSeries[]) => setDrawer({ title, series, dailyRows: dailyEnriched, weeklyRows: weeklyEnriched });
  const openQrcDrawer = (title: string) => setDrawer({
    title, series: qrcTypes.map((q, i) => ({ key: q, label: q, fmt: "int", color: PALETTE[i % PALETTE.length] })),
    dailyRows: qrcTrendPivoted, weeklyRows: qrcWeeklyPivoted,
  });

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const hl = data.headline;
    const overview: ExportSlide = {
      title: "Overview",
      kpis: [
        { label: "Total Chats", value: fmtNum(hl.totalChats) },
        { label: "Unique Chats", value: fmtNum(hl.uniqueChats) },
        { label: "Repeat Chats", value: fmtNum(hl.repeatChats) },
        { label: "FRT In-TAT % (60 sec)", value: `${hl.frtInTatPct}%` },
        { label: "Resolution In-TAT % (60 min)", value: `${hl.resolutionInTatPct}%` },
        { label: "Sale Count (Chat)", value: fmtNum(hl.orders) },
        { label: "Conversion % (sale count / unique)", value: `${hl.conversionPct}%` },
        { label: "Gross Revenue", value: formatINR(hl.grossRevenue) },
        { label: "Net Revenue", value: formatINR(hl.netRevenue) },
        { label: "Avg CSAT", value: `${hl.avgCsat} (${hl.csatResponses} responses)` },
      ],
      tables: [
        {
          title: "Date-wise Trend",
          columns: ["Date", "Total Chats", "Unique Chats", "FRT In-TAT %", "Resolution In-TAT %", "Sale Count", "Revenue"],
          rows: data.dateWiseTrend.map((r) => [r.date, r.totalChats, r.uniqueChats, `${r.frtInTatPct}%`, `${r.resolutionInTatPct}%`, r.orders, formatINR(r.revenue)]),
        },
        {
          title: "QRC Breakdown",
          columns: ["QRC", "Count", "Share"],
          rows: data.qrcBreakdown.map((r) => [r.qrc, r.count, `${r.pct}%`]),
        },
        {
          title: "Channel Breakdown",
          columns: ["Channel", "Count", "Share"],
          rows: data.channelBreakdown.map((r) => [r.channel, r.count, `${r.pct}%`]),
        },
        {
          title: "Ticket Status Breakdown",
          columns: ["Status", "Count", "Share"],
          rows: data.statusBreakdown.map((r) => [r.status, r.count, `${r.pct}%`]),
        },
        {
          title: "CSAT Breakdown",
          columns: ["Rating", "Count"],
          rows: data.csatBreakdown.map((r) => [r.rating, r.count]),
        },
      ],
    };
    const agentsSlide: ExportSlide = {
      title: "Agent-wise",
      tables: [{
        title: "Agent-wise Chat Performance",
        columns: ["Agent", "Total Chats", "Unique Chats", "FRT In-TAT %", "Resolution In-TAT %"],
        rows: data.agents.map((a) => [a.agent, a.totalChats, a.uniqueChats, `${a.frtInTatPct}%`, `${a.resolutionInTatPct}%`]),
      }],
    };
    const saleLinkage: ExportSlide = {
      title: "Sale Linkage",
      tables: [
        {
          title: "Matched to a chat agent",
          columns: ["Agent", "Sale Count", "Revenue", "Target", "Achi %"],
          rows: data.saleLinkage.matched.map((r) => [r.agent, r.saleCount, formatINR(r.revenue), r.target != null ? formatINR(r.target) : "—", r.achPct != null ? `${r.achPct}%` : "—"]),
        },
        {
          title: "Unmatched sale names (no corresponding chat agent name)",
          columns: ["Name (as in gnc_sale)", "Sale Count", "Revenue"],
          rows: data.saleLinkage.unmatchedSaleNames.map((r) => [r.name, r.saleCount, formatINR(r.revenue)]),
        },
      ],
    };
    return [overview, agentsSlide, saleLinkage];
  }, [data]);

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={MessageSquare} eyebrow="GNC · Process Performance" title="Chat Performance"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-emerald-600 via-teal-600 to-emerald-700"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {data ? (
          <DashboardExportMenu
            reportTitle="GNC — Chat Performance"
            fileBaseName="GNC_Chat"
            raw={{ dashboard: "gnc_chat", from, to }}
            subtitle={`${from} to ${to}`}
            slides={exportSlides}
            activeSlideTitle={tab === "agents" ? "Agent-wise" : tab === "sale_linkage" ? "Sale Linkage" : "Overview"}
          />
        ) : <span />}
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          resetLabel="This Month" accentFocus="focus:border-emerald-400"
        />
      </div>

      {loading && !data && <Spinner tone="emerald" />}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {data && headline && (
        <>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
            <strong>Validation findings vs the source workbook:</strong> the reference file mislabels the FRT KPI as
            "In TAT (Within 10 Sec)" in one tile while its own formula and column header elsewhere use a 60-second
            threshold — this dashboard uses 60 seconds (verified against the workbook's own live formula). The
            workbook also carries an older, unrelated "Chat Raw" sheet whose stale Total Chat Count (6,877) disagrees
            with the authoritative "Chat" sheet (6,017) it sits next to — this dashboard is built only on the
            authoritative sheet, matching the live <code>gnc_chat</code> table (no live counterpart exists for
            "Chat Raw").
          </div>

          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <KpiCard icon={MessageSquare} label="Over All Chat" value={fmtNum(headline.totalChats)} tone="emerald"
                  onClick={() => openDrawer("Over All Chat", [{ key: "totalChats", label: "Total Chats", fmt: "int", color: "#10b981" }])} />
                <KpiCard icon={Users} label="Unique Chat Count" value={fmtNum(headline.uniqueChats)} tone="sky"
                  onClick={() => openDrawer("Unique Chat Count", [{ key: "uniqueChats", label: "Unique Chats", fmt: "int", color: "#0ea5e9" }])} />
                <KpiCard icon={Repeat} label="Repeat Chat Count" value={fmtNum(headline.repeatChats)} tone="violet"
                  onClick={() => openDrawer("Repeat Chat Count", [{ key: "repeatChats", label: "Repeat Chats", fmt: "int", color: "#8b5cf6" }])} />
                <KpiCard icon={Timer} label="In TAT FRT" value={fmtNum(headline.frtInTatCount)} sub="within 60 sec" tone="teal"
                  onClick={() => openDrawer("In TAT FRT (within 60 sec)", [{ key: "frtInTatCount", label: "In TAT", fmt: "int", color: "#14b8a6" }])} />
                <KpiCard icon={Clock3} label="Out TAT FRT" value={fmtNum(headline.frtOutTatCount)} sub="after 60 sec" tone="rose"
                  onClick={() => openDrawer("Out TAT FRT (after 60 sec)", [{ key: "frtOutTatCount", label: "Out TAT", fmt: "int", color: "#f43f5e" }])} />
                <KpiCard icon={Gauge} label="In TAT FRT %" value={`${headline.frtInTatPct}%`} tone="indigo"
                  onClick={() => openDrawer("In TAT FRT %", [{ key: "frtInTatPct", label: "In TAT %", fmt: "pct", color: "#6366f1" }])} />
              </div>

              <p className="text-[10px] leading-relaxed text-slate-400">
                Live <code>gnc_chat</code>/<code>gnc_sale</code> data -- the reference layout's own Chat Type Distribution %s and Sale Done/COD/Prepaid counts don't match live data for the same range, so those aren't reproduced here.
              </p>

              <div className="grid gap-3 lg:grid-cols-3">
                <SectionCard
                  icon={MessageSquare} title="Chat Volume Trend" tone="emerald"
                  action={<ViewDetailsBtn onClick={() => openDrawer("Chat Volume Trend", [
                    { key: "totalChats", label: "Total Chat", fmt: "int", color: "#10b981" },
                    { key: "uniqueChats", label: "Unique Chat", fmt: "int", color: "#0ea5e9" },
                    { key: "repeatChats", label: "Repeat Chat", fmt: "int", color: "#8b5cf6" },
                  ])} />}
                >
                  <ComboTrend
                    data={dailyEnriched.map((r) => ({ date: r.date, totalChats: r.totalChats, uniqueChats: r.uniqueChats, repeatChats: r.repeatChats }))}
                    series={[
                      { key: "totalChats", name: "Total Chat", kind: "line", color: "#e11d48" },
                      { key: "uniqueChats", name: "Unique Chat", kind: "bar", color: "#0f172a" },
                      { key: "repeatChats", name: "Repeat Chat", kind: "line", color: "#94a3b8" },
                    ]}
                    height={170}
                  />
                </SectionCard>

                <SectionCard
                  icon={Gauge} title="TAT Performance" tone="indigo"
                  action={<ViewDetailsBtn onClick={() => openDrawer("TAT Performance", [
                    { key: "frtInTatCount", label: "In TAT", fmt: "int", color: "#e11d48" },
                    { key: "frtOutTatCount", label: "Out TAT", fmt: "int", color: "#0f172a" },
                    { key: "frtInTatPct", label: "In TAT %", fmt: "pct", color: "#6366f1" },
                  ])} />}
                >
                  <Donut
                    data={[
                      { name: `In TAT (${fmtNum(headline.frtInTatCount)})`, value: headline.frtInTatCount },
                      { name: `Out TAT (${fmtNum(headline.frtOutTatCount)})`, value: headline.frtOutTatCount },
                    ]}
                    height={150} centerLabel="In TAT FRT" centerValue={`${headline.frtInTatPct}%`}
                    colors={["#e11d48", "#0f172a"]}
                  />
                </SectionCard>

                <SectionCard
                  icon={Gauge} title="Chat Type Distribution" tone="violet"
                  footnote="qrc is the workbook's own Disposition-sheet lookup, already precomputed on the uploaded gnc_chat rows."
                  action={<ViewDetailsBtn onClick={() => openQrcDrawer("Chat Type Distribution (by day)")} />}
                >
                  <Donut data={data.qrcBreakdown.map((r) => ({ name: r.qrc, value: r.count }))} height={150} centerLabel="Total" centerValue={fmtNum(headline.totalChats)} />
                </SectionCard>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <SectionCard icon={ShoppingCart} title="Sales &amp; Conversion" tone="amber">
                  <div className="grid grid-cols-2 gap-2">
                    <KpiCard icon={ShoppingCart} label="Sale Done" value={fmtNum(headline.orders)} tone="amber"
                      onClick={() => openDrawer("Sale Done", [{ key: "orders", label: "Sale Count", fmt: "int", color: "#f59e0b" }])} />
                    <KpiCard icon={Gauge} label="Sale Conversion %" value={`${headline.conversionPct}%`} tone="rose"
                      onClick={() => openDrawer("Sale Conversion %", [{ key: "conversionPct", label: "Conversion %", fmt: "pct", color: "#e11d48" }])} />
                    <KpiCard icon={Wallet} label="COD" value={fmtNum(headline.codCount)} tone="amber"
                      onClick={() => openDrawer("COD vs Prepaid (Sale Count)", [
                        { key: "codCount", label: "COD", fmt: "int", color: "#f59e0b" },
                        { key: "paidCount", label: "Prepaid", fmt: "int", color: "#10b981" },
                      ])} />
                    <KpiCard icon={Wallet} label="Prepaid" value={fmtNum(headline.paidCount)} tone="emerald"
                      onClick={() => openDrawer("COD vs Prepaid (Sale Count)", [
                        { key: "codCount", label: "COD", fmt: "int", color: "#f59e0b" },
                        { key: "paidCount", label: "Prepaid", fmt: "int", color: "#10b981" },
                      ])} />
                  </div>
                </SectionCard>
                <SectionCard icon={IndianRupee} title="Revenue Metrics" tone="teal" footnote="Whole-range only -- COD/Prepaid amounts aren't tracked per day, so this panel has no drill-down.">
                  <div className="grid grid-cols-2 gap-2">
                    <KpiCard icon={Wallet} label="COD Amt Gross" value={formatINR(headline.codGross)} tone="amber" />
                    <KpiCard icon={Wallet} label="Prepaid Amt Gross" value={formatINR(headline.paidGross)} tone="emerald" />
                    <KpiCard icon={IndianRupee} label="Revenue Gross" value={formatINR(headline.grossRevenue)} tone="sky" />
                    <KpiCard icon={Wallet} label="COD Amt Net" value={formatINR(headline.codNet)} tone="amber" />
                    <KpiCard icon={Wallet} label="Prepaid Amt Net" value={formatINR(headline.paidNet)} tone="emerald" />
                    <KpiCard icon={IndianRupee} label="Revenue Net" value={formatINR(headline.netRevenue)} tone="cyan" />
                    {data.target?.configured && data.target.rangeTarget !== null && (
                      <>
                        <KpiCard icon={Target} label="Chat Target" value={formatINR(data.target.rangeTarget)} sub={data.target.monthlyTarget !== null ? `${formatINR(data.target.monthlyTarget)} / month` : undefined} tone="sky" />
                        <KpiCard icon={Gauge} label="Target Achi %" value={data.target.achPct === null ? "—" : `${data.target.achPct}%`} sub="gross revenue ÷ target" tone={(data.target.achPct ?? 0) >= 100 ? "emerald" : (data.target.achPct ?? 0) >= 60 ? "amber" : "rose"} />
                      </>
                    )}
                  </div>
                </SectionCard>
                <SectionCard
                  icon={Wallet} title="AOV (Average Order Value)" tone="cyan"
                  action={<ViewDetailsBtn onClick={() => openDrawer("AOV (Average Order Value)", [{ key: "aov", label: "AOV", fmt: "currency", color: "#0d9488" }])} />}
                >
                  <div className="flex h-full flex-col items-center justify-center gap-1 py-6">
                    <p className="text-3xl font-extrabold text-teal-700">{formatINR(headline.aov)}</p>
                    <p className="text-[11px] text-slate-400">gross revenue ÷ sale count</p>
                  </div>
                </SectionCard>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <SectionCard icon={Users} title="Agent Activity" tone="sky" footnote="Whole-range ratios -- no daily attendance/sales-per-day-per-agent source exists, so this panel has no drill-down.">
                  <div className="grid grid-cols-2 gap-2">
                    <KpiCard icon={Users} label="Agents Logged In" value={String(data.agents.length)} tone="sky" />
                    <KpiCard icon={MessageSquare} label="Chats per Agent" value={data.agents.length > 0 ? String(Math.round(headline.totalChats / data.agents.length)) : "0"} tone="emerald" />
                    <KpiCard icon={ShoppingCart} label="Sales per Agent" value={data.agents.length > 0 ? String(Math.round((headline.orders / data.agents.length) * 10) / 10) : "0"} tone="amber" />
                    <KpiCard icon={IndianRupee} label="Revenue per Agent" value={data.agents.length > 0 ? formatINR(Math.round(headline.netRevenue / data.agents.length)) : "₹0"} tone="teal" />
                  </div>
                </SectionCard>

                <SectionCard
                  icon={Layers} title="Chat Type Trend" tone="violet"
                  footnote="Chats per day, stacked by qrc bucket."
                  action={<ViewDetailsBtn onClick={() => openQrcDrawer("Chat Type Trend (by day)")} />}
                >
                  <ResponsiveContainer width="100%" height={170}>
                    <ComposedChart data={qrcTrendPivoted} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tickFormatter={(v: string) => formatShortDate(v)} tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" }} />
                      <Legend wrapperStyle={{ fontSize: 9 }} />
                      {qrcTypes.map((q, i) => (
                        <Bar key={q} dataKey={q} name={q} stackId="qrc" fill={PALETTE[i % PALETTE.length]} radius={i === qrcTypes.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </SectionCard>

                <SectionCard icon={ClipboardList} title="Top Chat Types" tone="violet">
                  <div className="max-h-44 overflow-y-auto overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-center text-xs">
                      <thead>
                        <tr className="sticky top-0 z-10 bg-violet-800 text-[10px] uppercase tracking-wide text-white">
                          <th className="py-1.5 px-2.5 text-left font-bold text-white">Chat Type</th>
                          <th className="py-1.5 px-2.5 font-bold text-white">Total Chat</th>
                          <th className="py-1.5 px-2.5 font-bold text-white">% Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.qrcBreakdown.map((r, i) => (
                          <tr key={r.qrc} className={`border-b border-slate-50 last:border-0 ${i % 2 === 1 ? "bg-violet-50/30" : "bg-white"}`}>
                            <td className="py-1.5 px-2.5 text-left font-medium text-slate-700">{r.qrc}</td>
                            <td className="py-1.5 px-2.5 text-slate-600">{fmtNum(r.count)}</td>
                            <td className="py-1.5 px-2.5 font-semibold text-violet-700">{r.pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              </div>

              <SectionCard icon={ClipboardList} title="Daily Detailed Metrics" tone="slate">
                <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-center text-[11px]">
                    <thead>
                      <tr className="sticky top-0 z-10 bg-slate-800 text-[10px] uppercase tracking-wide text-white">
                        <th className="py-1.5 px-2 text-left font-bold text-white">Date</th>
                        <th className="py-1.5 px-2 font-bold text-white">Over All Chat</th>
                        <th className="py-1.5 px-2 font-bold text-white">Unique Chat</th>
                        <th className="py-1.5 px-2 font-bold text-white">Repeat Chat</th>
                        <th className="py-1.5 px-2 font-bold text-white">In TAT (≤60s)</th>
                        <th className="py-1.5 px-2 font-bold text-white">Out TAT (&gt;60s)</th>
                        <th className="py-1.5 px-2 font-bold text-white">In TAT %</th>
                        <th className="py-1.5 px-2 font-bold text-white">Sale Done</th>
                        <th className="py-1.5 px-2 font-bold text-white">Sale Conv %</th>
                        <th className="py-1.5 px-2 font-bold text-white">COD</th>
                        <th className="py-1.5 px-2 font-bold text-white">Prepaid</th>
                        <th className="py-1.5 px-2 font-bold text-white">Revenue Gross</th>
                        <th className="py-1.5 px-2 font-bold text-white">Revenue Net</th>
                        <th className="py-1.5 px-2 font-bold text-white">AOV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...dailyEnriched].reverse().map((d, i) => (
                        <tr key={d.date} className={`border-b border-slate-50 last:border-0 ${i % 2 === 1 ? "bg-slate-50/40" : "bg-white"}`}>
                          <td className="py-1 px-2 text-left font-medium text-slate-700">{formatShortDate(d.date)}</td>
                          <td className="py-1 px-2 text-slate-600">{d.totalChats}</td>
                          <td className="py-1 px-2 text-slate-600">{d.uniqueChats}</td>
                          <td className="py-1 px-2 text-slate-600">{d.repeatChats}</td>
                          <td className="py-1 px-2 text-emerald-600">{d.frtInTatCount}</td>
                          <td className="py-1 px-2 text-rose-600">{d.frtOutTatCount}</td>
                          <td className="py-1 px-2 font-semibold text-indigo-600">{d.frtInTatPct}%</td>
                          <td className="py-1 px-2 text-slate-600">{d.orders}</td>
                          <td className="py-1 px-2 text-slate-600">{d.conversionPct}%</td>
                          <td className="py-1 px-2 text-amber-600">{d.codCount}</td>
                          <td className="py-1 px-2 text-emerald-600">{d.paidCount}</td>
                          <td className="py-1 px-2 text-slate-600">{formatINR(d.revenue)}</td>
                          <td className="py-1 px-2 font-semibold text-slate-800">{formatINR(d.netRevenue)}</td>
                          <td className="py-1 px-2 text-slate-600">{formatINR(d.aov)}</td>
                        </tr>
                      ))}
                      {dailyEnriched.length === 0 && <tr><td colSpan={14} className="py-6 text-center text-slate-400">No data for this period.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          )}

          {tab === "agents" && (
            <SectionCard
              icon={Users} title="Agent-wise Chat Performance" tone="emerald"
              footnote="Grouped by first_agent_name (never null), not agent_name (null on 189 still-queued tickets) -- matching the workbook's own Agent Wise Performance sheet, which groups the same way."
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="py-2 pr-3 font-semibold">Agent</th>
                      <th className="py-2 pr-3 text-right font-semibold">Total Chats</th>
                      <th className="py-2 pr-3 text-right font-semibold">Unique</th>
                      <th className="py-2 pr-3 text-right font-semibold">FRT In-TAT %</th>
                      <th className="py-2 pr-0 text-right font-semibold">Resolution In-TAT %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agents.map((a) => (
                      <tr key={a.agent} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-emerald-50/40">
                        <td className="py-2.5 pr-3 font-medium text-slate-700">{a.agent}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-600">{fmtNum(a.totalChats)}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-600">{fmtNum(a.uniqueChats)}</td>
                        <td className="py-2.5 pr-3 text-right font-semibold text-teal-600">{a.frtInTatPct}%</td>
                        <td className="py-2.5 pr-0 text-right font-semibold text-indigo-600">{a.resolutionInTatPct}%</td>
                      </tr>
                    ))}
                    {data.agents.length === 0 && (
                      <tr><td colSpan={5} className="py-6 text-center text-slate-400">No agents for this period.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {tab === "sale_linkage" && (
            <div className="space-y-4">
              <SectionCard
                icon={IndianRupee} title="Matched to a Chat Agent" tone="emerald"
                footnote="Linked by name only (gnc_chat has no employee-code column) -- case/spacing/trailing-dot normalized, but never forced across a different surname. Target = the Chat per-agent monthly target from the GNC Targets page (pro-rated for a part-month range); Achi % = gross revenue ÷ target."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-2 pr-3 font-semibold">Agent</th>
                        <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                        <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                        <th className="py-2 pr-3 text-right font-semibold">Target</th>
                        <th className="py-2 pr-0 text-right font-semibold">Achi %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.saleLinkage.matched.map((r) => (
                        <tr key={r.agent} className="border-b border-slate-50 last:border-0">
                          <td className="py-2.5 pr-3 font-medium text-slate-700">{r.agent}</td>
                          <td className="py-2.5 pr-3 text-right text-slate-600">{fmtNum(r.saleCount)}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold text-emerald-600">{formatINR(r.revenue)}</td>
                          <td className="py-2.5 pr-3 text-right text-slate-600">{r.target != null ? formatINR(r.target) : "—"}</td>
                          <td className={`py-2.5 pr-0 text-right font-bold ${r.achPct == null ? "text-slate-400" : r.achPct >= 100 ? "text-emerald-600" : r.achPct >= 60 ? "text-amber-600" : "text-rose-600"}`}>{r.achPct != null ? `${r.achPct}%` : "—"}</td>
                        </tr>
                      ))}
                      {data.saleLinkage.matched.length === 0 && (
                        <tr><td colSpan={5} className="py-6 text-center text-slate-400">No matches for this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <SectionCard
                icon={Repeat} title="Unmatched Sale Names" tone="amber"
                footnote="These names appear in gnc_sale (campaign = 'Chat') for this period but have no matching agent name in gnc_chat over the same range -- shown here rather than guessed or silently dropped."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-2 pr-3 font-semibold">Name (as in gnc_sale)</th>
                        <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                        <th className="py-2 pr-0 text-right font-semibold">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.saleLinkage.unmatchedSaleNames.map((r) => (
                        <tr key={r.name} className="border-b border-slate-50 last:border-0">
                          <td className="py-2.5 pr-3 font-medium text-slate-700">{r.name}</td>
                          <td className="py-2.5 pr-3 text-right text-slate-600">{fmtNum(r.saleCount)}</td>
                          <td className="py-2.5 pr-0 text-right font-semibold text-amber-600">{formatINR(r.revenue)}</td>
                        </tr>
                      ))}
                      {data.saleLinkage.unmatchedSaleNames.length === 0 && (
                        <tr><td colSpan={3} className="py-6 text-center text-slate-400">Every sale name matched an agent this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </div>
          )}
        </>
      )}

      {drawer && (
        <GncDetailDrawer
          title={drawer.title} eyebrow="GNC Chat · Week-wise & Date-wise" gradient="from-emerald-700 via-teal-700 to-emerald-800"
          series={drawer.series} dailyRows={drawer.dailyRows} weeklyRows={drawer.weeklyRows}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
