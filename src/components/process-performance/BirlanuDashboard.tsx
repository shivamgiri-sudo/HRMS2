import { useCallback, useEffect, useMemo, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { RefreshCw, Inbox, Users } from "lucide-react";
import { DashboardExportMenu, Spinner, type ExportSlide } from "./DashboardKit";
import { BirlanuDrawer, BirlanuHeader, BCard, Empty, int, inr, lacs, pct1, pct2, type DrawerSpec, type FilterDef } from "./BirlanuKit";
import type { BirlanuMis } from "./birlanuTypes";
import { BirlanuSlidePerformance } from "./BirlanuSlidePerformance";
import { BirlanuSlideBusiness } from "./BirlanuSlideBusiness";
import { BirlanuSlideDisposition } from "./BirlanuSlideDisposition";
import { BirlanuSlideLeadTat } from "./BirlanuSlideLeadTat";
import { BirlanuSlideEnquiry } from "./BirlanuSlideEnquiry";
import { BirlanuSlideProductWise } from "./BirlanuSlideProductWise";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

/**
 * Birlanu MIS -- six slides built from the reference workbook "Birlanu_MR ...xlsb":
 *   Performance (Performance Dashboard) · Business (Business Dashboard) · Channel Disposition (Channel Wise Disposition)
 *   · Lead TAT · Enquiry (Enquiry Count - Channels) · Product & Source (Product Wise&Source -Revenue).
 * All six read one endpoint, GET /api/process-performance/birlanu-mis, which aggregates db_masmis.birlanu_sale (the workbook's
 * "Data" sheet, uploaded via Uploader -> Sale) with logic verified against the workbook's own cached numbers
 * (backend/scripts/verify-birlanu-mis.ts). Nothing on these slides is estimated.
 */

type SlideKey = "performance" | "business" | "disposition" | "leadTat" | "enquiry" | "productWise" | "agentWise";
const SLIDES: Array<{ key: SlideKey; label: string; accent: string; title: string; subtitle: string }> = [
  { key: "performance", label: "Performance", accent: "Business", title: "Performance Dashboard", subtitle: "Enquiries → Leads → Conversions | Channel Performance | Volume & Value" },
  { key: "business", label: "Business", accent: "Business", title: "Dashboard", subtitle: "Enquiries → Leads → Conversions | Digital Performance Overview" },
  { key: "disposition", label: "Channel Disposition", accent: "Channel Wise", title: "Disposition Dashboard", subtitle: "Enquiries → Leads → Dispositions | Channel Performance Overview" },
  { key: "leadTat", label: "Lead TAT", accent: "Lead", title: "TAT Dashboard", subtitle: "Source Wise Lead Turn Around Time (TAT) Analysis" },
  { key: "enquiry", label: "Enquiry", accent: "Enquiry Count by", title: "Channels", subtitle: "Track and analyse enquiries across all marketing channels" },
  { key: "productWise", label: "Product & Source", accent: "Product Wise &", title: "Source Wise", subtitle: "Overall performance and lead-closer-month view by product" },
  { key: "agentWise", label: "Agent Wise", accent: "Agent Wise", title: "Performance", subtitle: "Leads, connect/conversion rate and sale value by agent -- from birlanu_sale (agent_name)" },
];

interface BirlanuAgentRow { label: string; leads: number; connected: number; connectedPct: number; converted: number; conversionPct: number; saleValue: number }
interface BirlanuAgentWiseData { byAgent: BirlanuAgentRow[]; productivity: { agentsInRoster: number; agentsWithMetrics: number; note: string } }

type Filters = Record<string, string>;

export function BirlanuDashboard() {
  const [slide, setSlide] = useState<SlideKey>("performance");
  const [filtersBySlide, setFiltersBySlide] = useState<Record<SlideKey, Filters>>({
    performance: {}, business: {}, disposition: {}, leadTat: {}, enquiry: {}, productWise: {}, agentWise: {},
  });
  const [data, setData] = useState<BirlanuMis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<DrawerSpec | null>(null);
  const [agentWiseData, setAgentWiseData] = useState<BirlanuAgentWiseData | null>(null);
  const filters = filtersBySlide[slide];

  useEffect(() => {
    let cancelled = false;
    hrmsApi
      .get<{ success: boolean; data: BirlanuAgentWiseData }>(`/api/process-performance/birlanu-dashboard`)
      .then((res) => { if (!cancelled) setAgentWiseData(res.data); })
      .catch(() => { if (!cancelled) setAgentWiseData(null); });
    return () => { cancelled = true; };
  }, []);

  // Excel-style sort + filter for the Agent Wise table -- hooks must run every render.
  const AGENT_FILTER_COLS: Array<FilterColumn<BirlanuAgentRow>> = [
    { key: "label", get: (a) => a.label }, { key: "leads", get: (a) => a.leads }, { key: "connected", get: (a) => a.connected },
    { key: "connectedPct", get: (a) => a.connectedPct }, { key: "converted", get: (a) => a.converted },
    { key: "conversionPct", get: (a) => a.conversionPct }, { key: "saleValue", get: (a) => a.saleValue },
  ];
  const agentColGetter = (a: BirlanuAgentRow, key: string) => AGENT_FILTER_COLS.find((c) => c.key === key)?.get(a);
  const agentFilters = useColumnFilters(agentWiseData?.byAgent ?? [], AGENT_FILTER_COLS);
  const { sorted: sortedAgents, sortKey: agentSortKey, sortDir: agentSortDir, toggleSort: toggleAgentSort } = useSortableRows(agentFilters.filtered, agentColGetter);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
      const res = await hrmsApi.get<{ success: boolean; data: BirlanuMis }>(`/api/process-performance/birlanu-mis?${qs.toString()}`);
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the Birlanu dashboard.");
    } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);

  const setFilter = (key: string) => (value: string) => setFiltersBySlide((s) => ({ ...s, [slide]: { ...s[slide], [key]: value } }));
  const open = useCallback((spec: DrawerSpec) => setDrawer(spec), []);

  const meta = SLIDES.find((s) => s.key === slide)!;
  const o = data?.options;
  const f = (key: string, label: string, options: string[], allLabel?: string): FilterDef => ({ key, label, options, value: filters[key] ?? "", onChange: setFilter(key), allLabel });
  const filterDefs = useMemo<FilterDef[]>(() => {
    if (!o) return [];
    const m = (allLabel = "All") => f("month", "Month", o.months, allLabel);
    switch (slide) {
      case "performance": return [m(), f("status", "Status", o.statuses), f("channel", "Channel", o.channels), f("closureMonth", "Closure Month", o.closureMonths)];
      case "business": return [m(), f("bau1", "Select BAU 1", o.brands, "Overall"), f("bau2", "Select BAU 2", o.brands, "Overall"), f("status", "Status", o.statuses), f("closureMonth", "Closure Month", o.closureMonths)];
      case "disposition": return [m(), f("status", "Calling Status", o.statuses), f("brand", "Business Unit / Product", o.brands)];
      case "leadTat": return [m("Latest month"), f("week", "Week", data?.leadTat.weeks ?? []), f("channel", "Source", o.channels)];
      case "enquiry": return [m(), f("brand", "Business Unit / Product", o.brands), f("channel", "Channel", o.channels)];
      default: return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, slide, filters, data]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const p = data.performance; const b = data.business; const d = data.disposition; const t = data.leadTat; const e = data.enquiry; const w = data.productWise;
    return [
      {
        title: "Performance", kpis: [
          { label: "Enquiries Received", value: int(p.total.enquiries) }, { label: "Connect %", value: pct1(p.total.connectPct) }, { label: "Leads Validated", value: int(p.total.validated) },
          { label: "Leads Qualified", value: int(p.total.qualified) }, { label: "Leads Converted", value: int(p.total.converted) }, { label: "ELCO %", value: pct2(p.total.elcoPct) },
          { label: "Volume (MT)", value: int(p.total.volMt) }, { label: "Value (₹ Lacs)", value: lacs(p.total.valueLacs) },
        ],
        tables: [{
          title: "Monthly Performance Snapshot", columns: ["Month", "Enquiries", "Connected", "Connect %", "Validated", "ELCV %", "Qualified", "ELCQ %", "Converted", "ELCO %", "Vol (MT)", "Value (Lacs)", "LC (closer)", "Value (closer)"],
          rows: [...p.months, p.total].map((m) => [m.month, m.enquiries, m.connected, pct1(m.connectPct), m.validated, pct2(m.elvaPct), m.qualified, pct2(m.elqPct), m.converted, pct2(m.elcoPct), int(m.volMt), lacs(m.valueLacs), m.lcCloser, lacs(m.valueLacsCloser)]),
        }],
      },
      {
        title: "Business", kpis: [
          { label: "Validated Queries (YTD)", value: int(b.ytd.validated) }, { label: "Organic Queries", value: int(b.ytd.organicV) }, { label: "Total Conversions", value: int(b.ytd.conv) },
          { label: "Conversion %", value: pct1(b.ytd.convPct) }, { label: "Digital Revenue (L)", value: lacs(b.ytd.revenue) }, { label: "Organic Revenue (L)", value: lacs(b.ytd.revenueOrganic) },
        ],
        tables: [
          { title: "Monthly Business Metrics", columns: ["Month", "Validated", "Organic", "Organic %", "Conversions", "Organic conv", "Paid conv", "Conv %", "Digital revenue (L)", "Organic revenue (L)", "First billing (L)"], rows: b.perMonth.map((m) => [m.month, m.validated, m.organicV, pct1(m.organicSharePct), m.conv, m.convOrganic, m.convPaid, pct1(m.convPct), lacs(m.revenue), lacs(m.revenueOrganic), lacs(m.firstBilling)]) },
          { title: "Closure Breakup (YTD)", columns: ["Status", "Count", "% of total"], rows: b.closureBreakup.map((c) => [c.status, c.count, pct1(c.pct)]) },
        ],
      },
      {
        title: "Channel Disposition", kpis: [{ label: "Grand Total", value: int(d.grand) }, { label: "Connect Rate", value: pct1(d.connectRatePct) }],
        tables: [{ title: "Channel Wise Disposition Detail", columns: ["Status", ...d.sources, "Grand Total"], rows: [...d.connect, ...d.notConnect].map((r) => [r.status, ...d.sources.map((s) => r.by[s] ?? 0), r.total]) }],
      },
      {
        title: "Lead TAT", kpis: [{ label: "Total Leads", value: int(t.totals.total) }, { label: "Within TAT", value: int(t.totals.within) }, { label: "Out of TAT", value: int(t.totals.out) }, { label: "Within TAT %", value: pct1(t.totals.withinPct) }],
        tables: [{ title: `TAT Distribution by Source (${t.month})`, columns: ["Source", ...t.buckets, "Within TAT", "Out of TAT", "Total"], rows: t.bySource.map((r) => [r.source, ...r.counts, r.within, r.out, r.total]) }],
      },
      {
        title: "Enquiry", kpis: [{ label: "Total Enquiries", value: int(e.grand) }],
        tables: [{ title: "Month Wise Enquiry Count by Channel", columns: ["Month", ...e.sources, "Grand Total"], rows: e.months.map((m) => [m.month, ...e.sources.map((s) => m.by[s] ?? 0), m.total]) }],
      },
      {
        title: "Product & Source", kpis: [{ label: "Total Enquiries", value: int(w.byRegister.total.overall.enquiries) }, { label: "Conversions", value: int(w.byRegister.total.overall.conversions) }, { label: "Revenue", value: inr(w.byRegister.total.overall.revenue) }],
        tables: [
          { title: "Product Wise (by Lead Register Month)", columns: ["Product", "Enquiries", "Leads (LAS)", "Conversions", "Conv %", "Revenue"], rows: w.byRegister.rows.map((r) => [r.brand, r.overall.enquiries, r.overall.leads, r.overall.conversions, pct1(r.overall.convPct), inr(r.overall.revenue)]) },
          { title: "Product Wise (by Lead Closer Month)", columns: ["Product", "Enquiries", "Leads (LAS)", "Conversions", "Conv %", "Revenue"], rows: w.byCloser.rows.map((r) => [r.brand, r.overall.enquiries, r.overall.leads, r.overall.conversions, pct1(r.overall.convPct), inr(r.overall.revenue)]) },
        ],
      },
      ...(agentWiseData && agentWiseData.byAgent.length > 0 ? [{
        title: "Agent Wise Performance",
        kpis: [
          { label: "Agents in roster", value: int(agentWiseData.productivity.agentsInRoster) },
          { label: "Agents with call/login metrics", value: int(agentWiseData.productivity.agentsWithMetrics) },
        ],
        tables: [{
          title: "Agent Wise Performance",
          columns: ["Agent", "Leads", "Connected", "Connected %", "Converted", "Conversion %", "Sale Value"],
          rows: agentWiseData.byAgent.map((a) => [a.label, a.leads, a.connected, pct1(a.connectedPct), a.converted, pct1(a.conversionPct), inr(a.saleValue)]),
        }],
      }] : []),
    ];
  }, [data, agentWiseData]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
          {SLIDES.map((s) => (
            <button key={s.key} type="button" onClick={() => setSlide(s.key)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${slide === s.key ? "bg-[#0b2a5b] text-white shadow-sm" : "text-slate-600 hover:text-slate-800"}`}>{s.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <DashboardExportMenu reportTitle="Birlanu — MIS" fileBaseName="Birlanu_MIS" raw={{ dashboard: "birlanu" }} subtitle={meta.label} slides={exportSlides} activeSlideTitle={meta.label} />
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {loading && !data && <Spinner tone="blue" />}

      {data && (
        <>
          <BirlanuHeader accent={meta.accent} title={meta.title} subtitle={meta.subtitle} filters={filterDefs} asOf={data.asOf} />
          {data.totalRows < 500 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">
              <Inbox className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Only {int(data.totalRows)} lead rows are in the database (the reference workbook's Data sheet has about 44,600). Every figure here is a straight count of those rows and will fill in as the full Data sheet is uploaded through Uploader → Sale.</span>
            </div>
          )}
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {slide === "performance" && <BirlanuSlidePerformance data={data} open={open} />}
            {slide === "business" && <BirlanuSlideBusiness data={data} open={open} />}
            {slide === "disposition" && <BirlanuSlideDisposition data={data} open={open} />}
            {slide === "leadTat" && <BirlanuSlideLeadTat data={data} open={open} />}
            {slide === "enquiry" && <BirlanuSlideEnquiry data={data} open={open} />}
            {slide === "productWise" && <BirlanuSlideProductWise data={data} open={open} />}
            {slide === "agentWise" && (
              <BCard
                title="Agent Wise Performance" icon={Users}
                footnote={agentWiseData?.productivity.note}
                action={agentFilters.activeCount > 0 ? (
                  <button type="button" onClick={agentFilters.clearAll} className="rounded-md bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-100">
                    Clear {agentFilters.activeCount} filter{agentFilters.activeCount > 1 ? "s" : ""}
                  </button>
                ) : undefined}
              >
                {!agentWiseData || agentWiseData.byAgent.length === 0 ? <Empty text="No agent-attributed leads in birlanu_sale yet." /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <FilterSortTh label="Agent" columnKey="label" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-left text-[10px] font-bold text-white" />
                          <FilterSortTh label="Leads" columnKey="leads" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-center text-[10px] font-bold text-white" />
                          <FilterSortTh label="Connected" columnKey="connected" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-center text-[10px] font-bold text-white" />
                          <FilterSortTh label="Connected %" columnKey="connectedPct" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-center text-[10px] font-bold text-white" />
                          <FilterSortTh label="Converted" columnKey="converted" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-center text-[10px] font-bold text-white" />
                          <FilterSortTh label="Conversion %" columnKey="conversionPct" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-center text-[10px] font-bold text-white" />
                          <FilterSortTh label="Sale Value" columnKey="saleValue" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-center text-[10px] font-bold text-white" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAgents.map((a) => (
                          <tr key={a.label} className="border-b border-slate-50 last:border-0 even:bg-slate-50/50">
                            <td className="px-2 py-1.5 text-left text-[11px] font-semibold text-slate-700">{a.label}</td>
                            <td className="px-2 py-1.5 text-center text-[11px] text-slate-600">{int(a.leads)}</td>
                            <td className="px-2 py-1.5 text-center text-[11px] text-slate-600">{int(a.connected)}</td>
                            <td className="px-2 py-1.5 text-center text-[11px] text-slate-600">{pct1(a.connectedPct)}</td>
                            <td className="px-2 py-1.5 text-center text-[11px] text-slate-600">{int(a.converted)}</td>
                            <td className="px-2 py-1.5 text-center text-[11px] font-semibold text-emerald-700">{pct1(a.conversionPct)}</td>
                            <td className="px-2 py-1.5 text-center text-[11px] font-semibold text-slate-800">{inr(a.saleValue)}</td>
                          </tr>
                        ))}
                        {sortedAgents.length === 0 && (
                          <tr><td colSpan={7} className="py-6 text-center text-xs text-slate-400">No agents match the current filters.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </BCard>
            )}
          </div>
        </>
      )}
      {drawer && <BirlanuDrawer spec={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
