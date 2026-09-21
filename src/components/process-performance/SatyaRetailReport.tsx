import { useCallback, useEffect, useMemo, useState } from "react";
import { Store } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Spinner, DashboardHero, DateRangeToolbar, DashboardExportMenu, currentMonthRange, formatINR, localDateStr,
  type ExportSlide,
} from "./DashboardKit";
import { SatyaOverviewTab } from "./SatyaOverviewTab";
import { SatyaDailyTracker } from "./SatyaDailyTracker";
import { SatyaAgentTab } from "./SatyaAgentTab";
import { SatyaBeatTab } from "./SatyaBeatTab";
import { SatyaCallsTab } from "./SatyaCallsTab";
import { SatyaChecksTab } from "./SatyaChecksTab";
import { SatyaDetailDrawer, type SatyaDetailTarget } from "./SatyaDetailDrawer";
import {
  buildGridBlocks, buildGridColumns, callsMade, filtersQuery, fmtDMY, fmtInt, fmtRatio, ratio,
  subDispositionTotals, type GridRow, type SatyaReportData,
} from "./satyaReportModel";

type TabKey = "overview" | "tracker" | "agents" | "beats" | "calls" | "checks";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "tracker", label: "Daily tracker" },
  { key: "agents", label: "Agent-wise" },
  { key: "beats", label: "Beat & warehouse" },
  { key: "calls", label: "Call attempts" },
  { key: "checks", label: "Data checks" },
];
const SLIDE_TITLE: Record<TabKey, string> = {
  overview: "Overview", tracker: "Daily tracker", agents: "Agent-wise", beats: "Beat & warehouse", calls: "Call attempts", checks: "Data checks",
};
const ROSTER_OPTIONS = ["Morning", "Absentee", "Unmapped"] as const;

const ALL = "all";

const cellText = (row: GridRow, v: number | null): string | number => {
  if (v === null) return "—";
  if (row.kind === "pct") return fmtRatio(v);
  if (row.kind === "money") return formatINR(v);
  return v;
};

/**
 * Satya Retail -- "Calling & Order Tracking Report": the ops team's Excel
 * report rebuilt as a live dashboard over the uploaded allocation and call-log
 * tables. Six pages (Overview, Daily tracker, Agent-wise, Beat & warehouse,
 * Call attempts, Data checks), one set of filters, and a drill-down drawer on
 * every agent / beat / warehouse row. See satya-retail-report.service.ts for
 * the definitions and for how each figure was reconciled with the Excel sheet.
 */
export function SatyaRetailReport() {
  const [tab, setTab] = useState<TabKey>("overview");
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [warehouse, setWarehouse] = useState(ALL);
  const [roster, setRoster] = useState(ALL);

  const [data, setData] = useState<SatyaReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<SatyaDetailTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = filtersQuery({ from, to, warehouse: warehouse === ALL ? null : warehouse, roster: roster === ALL ? null : roster });
      const res = await hrmsApi.get<{ success: boolean; data: SatyaReportData }>(`/api/process-performance/satya-retail-report?${query}`, 90000);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Satya Retail report.");
    } finally {
      setLoading(false);
    }
  }, [from, to, warehouse, roster]);

  useEffect(() => { void load(); }, [load]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const h = data.headline;
    const made = callsMade(h);
    const dialled = h.connected + h.notConnected;
    const connectedOutcomes = subDispositionTotals(data, "Connected");
    const connectedTotal = connectedOutcomes.reduce((s, r) => s + r.count, 0);

    const overview: ExportSlide = {
      title: SLIDE_TITLE.overview,
      kpis: [
        { label: "Total allocation", value: fmtInt(h.allocation) },
        { label: "Pending (not yet called)", value: fmtInt(h.pending) },
        { label: "Total calls made", value: fmtInt(made) },
        { label: "Unique calls", value: fmtInt(h.unique) },
        { label: "Repeat calls", value: fmtInt(h.repeat) },
        { label: "Connected", value: fmtInt(h.connected) },
        { label: "Not connected", value: fmtInt(h.notConnected) },
        { label: "Connect % (of dialled)", value: fmtRatio(ratio(h.connected, dialled)) },
        { label: "Total orders placed", value: fmtInt(h.orders) },
        { label: "Conversion % (orders ÷ calls made)", value: fmtRatio(ratio(h.orders, made)) },
        { label: "Order revenue", value: formatINR(h.revenue) },
      ],
      tables: [
        {
          title: "Disposition wise",
          columns: ["Disposition", "Count", "% of dialled"],
          rows: [
            ["Connected", h.connected, fmtRatio(ratio(h.connected, dialled))],
            ["Not connected", h.notConnected, fmtRatio(ratio(h.notConnected, dialled))],
            ["Total dialled", dialled, "100%"],
            ["Call dropped", h.dropped, ""],
            ["Pending (not called)", h.pending, ""],
          ],
        },
        {
          title: "Call status — connected (sub-disposition)",
          columns: ["Call status", "Count", "% of connected"],
          rows: [...connectedOutcomes.map((r) => [r.name, r.count, fmtRatio(ratio(r.count, connectedTotal))]), ["Total", connectedTotal, "100%"]],
        },
        {
          title: "Morning roster / Absentee beat",
          columns: ["Roster", "Allocation", "Connected", "Not connected", "Orders placed"],
          rows: data.byRoster.map((r) => [r.roster, r.counts.allocation, r.counts.connected, r.counts.notConnected, r.counts.orders]),
        },
        {
          title: "Agent-wise calling details",
          columns: ["Agent", "Unique calls", "Repeat calls", "Total calls", "Connected", "Not connected"],
          rows: data.agents.map((a) => [`${a.agentName} (${a.agentId})`, a.counts.unique, a.counts.repeat, callsMade(a.counts), a.counts.connected, a.counts.notConnected]),
        },
        { title: "Warehouse-wise orders", columns: ["Warehouse", "Orders placed"], rows: data.warehouses.map((w) => [w.warehouse, w.counts.orders]) },
        { title: "Agent-wise orders", columns: ["Agent", "Orders placed"], rows: data.agents.filter((a) => a.counts.orders > 0).map((a) => [`${a.agentName} (${a.agentId})`, a.counts.orders]) },
        { title: "Orders — beat wise", columns: ["Beat", "Orders placed"], rows: data.beats.filter((b) => b.counts.orders > 0).sort((a, b) => b.counts.orders - a.counts.orders).map((b) => [b.beat, b.counts.orders]) },
      ],
    };

    const columns = buildGridColumns(data);
    const tracker: ExportSlide = {
      title: SLIDE_TITLE.tracker,
      tables: [{
        title: "MTD, weekly and day-wise",
        columns: ["Data", ...columns.map((c) => c.label)],
        rows: buildGridBlocks(columns).flatMap((block) => [
          [block.title.toUpperCase(), ...columns.map(() => "")] as Array<string | number>,
          ...block.rows.map((row) => [row.label, ...columns.map((c) => cellText(row, row.get(c.data)))] as Array<string | number>),
        ]),
      }],
    };

    const agents: ExportSlide = {
      title: SLIDE_TITLE.agents,
      tables: [{
        title: "Agent-wise performance",
        columns: ["Agent ID", "Agent", "Allocation", "Orders", "Calls made", "Unique", "Repeat", "Morning", "Absentee", "Connected", "Not connected", "Connect %", "Conversion %", "Revenue", "Days"],
        rows: data.agents.map((a) => [
          a.agentId, a.agentName, a.counts.allocation, a.counts.orders, callsMade(a.counts), a.counts.unique, a.counts.repeat, a.counts.morning, a.counts.absentee,
          a.counts.connected, a.counts.notConnected, fmtRatio(ratio(a.counts.connected, a.counts.connected + a.counts.notConnected)),
          fmtRatio(ratio(a.counts.orders, callsMade(a.counts))), formatINR(a.counts.revenue), a.daysWorked,
        ]),
      }],
    };

    const beats: ExportSlide = {
      title: SLIDE_TITLE.beats,
      tables: [
        {
          title: "Warehouse-wise",
          columns: ["Warehouse", "Beats", "Allocation", "Connected", "Orders", "Conversion %", "Revenue"],
          rows: data.warehouses.map((w) => [w.warehouse, w.beats, w.counts.allocation, w.counts.connected, w.counts.orders, fmtRatio(ratio(w.counts.orders, callsMade(w.counts))), formatINR(w.counts.revenue)]),
        },
        {
          title: "Beat-wise",
          columns: ["Beat", "Warehouse", "Shops", "Allocation", "Connected", "Orders", "Conversion %", "Revenue"],
          rows: data.beats.map((b) => [b.beat, b.warehouse, b.shops, b.counts.allocation, b.counts.connected, b.counts.orders, fmtRatio(ratio(b.counts.orders, callsMade(b.counts))), formatINR(b.counts.revenue)]),
        },
      ],
    };

    const c = data.calls;
    const calls: ExportSlide = {
      title: SLIDE_TITLE.calls,
      kpis: [
        { label: "Dial attempts", value: fmtInt(c.headline.attempts) },
        { label: "Connected", value: `${fmtInt(c.headline.connected)} (${c.headline.connectedPct}%)` },
        { label: "Call dropped", value: fmtInt(c.headline.dropped) },
        { label: "Order-placing calls", value: fmtInt(c.headline.orderCalls) },
        { label: "Shops dialled", value: fmtInt(c.headline.shops) },
        { label: "Avg attempt no.", value: String(c.headline.avgAttempt) },
      ],
      tables: [
        { title: "By day", columns: ["Date", "Attempts", "Connected", "Order-placing calls"], rows: c.daily.map((d) => [fmtDMY(d.date), d.attempts, d.connected, d.orderCalls]) },
        { title: "By attempt number", columns: ["Attempt", "Attempts", "Connected", "Connect %"], rows: c.byAttempt.map((r) => [r.bucket, r.attempts, r.connected, fmtRatio(ratio(r.connected, r.attempts))]) },
        { title: "By hour of day", columns: ["Hour", "Attempts", "Connected", "Connect %"], rows: c.hourly.map((r) => [`${r.hour}:00`, r.attempts, r.connected, fmtRatio(ratio(r.connected, r.attempts))]) },
        { title: "Agent-wise dial attempts", columns: ["Agent", "Attempts", "Connected", "Order-placing calls", "Avg attempt no."], rows: c.agents.map((a) => [a.agentId, a.attempts, a.connected, a.orderCalls, a.avgAttempt]) },
      ],
    };

    const checks: ExportSlide = {
      title: SLIDE_TITLE.checks,
      tables: [{ title: "Data checks", columns: ["Finding", "Count", "Detail"], rows: data.checks.map((k) => [k.title, k.count, k.detail]) }],
    };

    return [overview, tracker, agents, beats, calls, checks];
  }, [data]);

  if (loading && !data) return <Spinner />;
  if (error && !data) {
    return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!data) return null;

  const resetRange = () => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); };
  const today = localDateStr(new Date());

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={Store} eyebrow="Satya Retail · Process Performance" title="Calling & Order Tracking Report"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-amber-500 via-orange-500 to-amber-600"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle="Satya Retail — Calling & Order Tracking Report"
          fileBaseName="Satya_Retail_Calling_Order_Tracking"
          subtitle={`${from} to ${to}${warehouse !== ALL ? ` · ${warehouse}` : ""}${roster !== ALL ? ` · ${roster}` : ""}`}
          slides={exportSlides}
          activeSlideTitle={SLIDE_TITLE[tab]}
          raw={{
            dashboard: "satya_retail_report", from, to,
            lob: warehouse !== ALL && warehouse !== "Unmapped" ? warehouse : undefined,
          }}
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select value={warehouse} onValueChange={setWarehouse}>
            <SelectTrigger className="h-8 w-[150px] rounded-lg border-slate-200 bg-white text-xs shadow-sm" aria-label="Warehouse">
              <SelectValue placeholder="Warehouse" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All warehouses</SelectItem>
              {data.available.warehouses.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={roster} onValueChange={setRoster}>
            <SelectTrigger className="h-8 w-[140px] rounded-lg border-slate-200 bg-white text-xs shadow-sm" aria-label="Roster">
              <SelectValue placeholder="Roster" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All rosters</SelectItem>
              {ROSTER_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <DateRangeToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} onReset={resetRange} accentFocus="focus:border-amber-400" />
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-400">
        <span>Showing {fmtDMY(from)} to {fmtDMY(to)}</span>
        <span>· Data available {fmtDMY(data.available.minDate)} – {fmtDMY(data.available.maxDate)}</span>
        <span>· Report generated {fmtDMY(today)}</span>
        {loading && <span className="font-semibold text-amber-600">· Refreshing…</span>}
      </p>
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>
        {tab === "overview" && <SatyaOverviewTab data={data} onOpen={setDrawer} />}
        {tab === "tracker" && <SatyaDailyTracker data={data} />}
        {tab === "agents" && <SatyaAgentTab data={data} onOpen={setDrawer} />}
        {tab === "beats" && <SatyaBeatTab data={data} onOpen={setDrawer} />}
        {tab === "calls" && <SatyaCallsTab data={data} onOpen={setDrawer} />}
        {tab === "checks" && <SatyaChecksTab checks={data.checks} />}
      </div>

      <SatyaDetailDrawer target={drawer} filters={data.filters} onClose={() => setDrawer(null)} />
    </div>
  );
}
