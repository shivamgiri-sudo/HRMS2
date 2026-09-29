import type { ReactNode } from "react";
import { ComposedChart, Bar, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Users, PhoneCall, UserCheck, Filter, BadgeCheck, Handshake, Target, TrendingUp, Truck, IndianRupee, LineChart, Table2, PieChart as PieIcon, Lightbulb, Trophy } from "lucide-react";
import type { BirlanuMis, PerfMonth } from "./birlanuTypes";
import {
  BCard, DetailsBtn, Empty, Funnel, Insights, Kpi, LegendList, Th, TOOLTIP_STYLE, delta, int, lacs, pct1, pct2, ppDelta,
  type DrawerCol, type DrawerSeries, type DrawerSpec,
} from "./BirlanuKit";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

/**
 * Slide 1 -- Business Performance. Logic = the workbook's "Performance Dashboard" sheet:
 *   Enquiries = rows by LeadRegisterMonth; Connect = Calling Status "Connect";
 *   Leads Validated = Interested Status "Interested"; Leads Qualified = Sub Sub Calling Status
 *   "Lead assign to Sales team"; Leads Converted = Lead Closer Status closed_with_order + closed_with_dealership;
 *   ELCV / ELCQ / ELCO % = each divided by Enquiries; Vol (MT) and Value (Rs) = Sale MT / Sale INR of the converted rows;
 *   "as per closer month" columns group the same conversions by Lead Closer Month instead.
 * The mock-up's "Investment made" column and "Active vs Inactive" donut have no source in the workbook, so they are not shown.
 */

const COLS_ALL: DrawerCol[] = [
  { key: "month", label: "Month", fmt: "text" }, { key: "enquiries", label: "Enquiries" }, { key: "connected", label: "Connected" }, { key: "connectPct", label: "Connect %", fmt: "pct1" },
  { key: "validated", label: "Validated" }, { key: "elvaPct", label: "ELCV %", fmt: "pct2" }, { key: "qualified", label: "Qualified" }, { key: "elqPct", label: "ELCQ %", fmt: "pct2" },
  { key: "converted", label: "Converted" }, { key: "elcoPct", label: "ELCO %", fmt: "pct2" }, { key: "volMt", label: "Vol (MT)" }, { key: "valueLacs", label: "Value (Lacs)", fmt: "lacs" },
];
const s = (key: string, label: string, color: string, type: "bar" | "line" = "bar", axis: "left" | "right" = "left"): DrawerSeries => ({ key, label, color, type, axis });

/* ------------------------------ table columns ------------------------------ */
interface SnapCol { key: string; label: string; get: (m: PerfMonth) => string | number | null; cell: (m: PerfMonth) => ReactNode; td: string; th: string }
const SNAP_TH_BASE = "whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-center text-[10px] font-bold text-white";
const CLOSER_KEYS = new Set(["lcCloser", "elcoCloserPct", "volMtCloser", "valueLacsCloser"]);
const snapTh = (key: string, first: boolean) => `${SNAP_TH_BASE} ${first ? "rounded-l-md text-left" : ""} ${CLOSER_KEYS.has(key) ? "bg-[#123a7a]" : ""} ${key === "valueLacsCloser" ? "rounded-r-md" : ""}`.replace(/\s+/g, " ").trim();
const SNAP_COLS: SnapCol[] = [
  { key: "month", label: "Month", get: (m) => m.month, cell: (m) => m.month, td: "px-2 py-1.5 text-left font-semibold text-[#0b2a5b]", th: snapTh("month", true) },
  { key: "status", label: "Status", get: () => "Active", cell: () => <span className="inline-flex items-center gap-1 text-[10px] text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active</span>, td: "px-2 py-1.5", th: snapTh("status", false) },
  { key: "enquiries", label: "Enquiries Received", get: (m) => m.enquiries, cell: (m) => int(m.enquiries), td: "px-2 py-1.5", th: snapTh("enquiries", false) },
  { key: "connected", label: "Leads Connected", get: (m) => m.connected, cell: (m) => int(m.connected), td: "px-2 py-1.5", th: snapTh("connected", false) },
  { key: "connectPct", label: "Connect %", get: (m) => m.connectPct, cell: (m) => pct1(m.connectPct), td: "px-2 py-1.5", th: snapTh("connectPct", false) },
  { key: "validated", label: "Leads Validated", get: (m) => m.validated, cell: (m) => int(m.validated), td: "px-2 py-1.5", th: snapTh("validated", false) },
  { key: "elvaPct", label: "ELCV %", get: (m) => m.elvaPct, cell: (m) => pct1(m.elvaPct), td: "px-2 py-1.5", th: snapTh("elvaPct", false) },
  { key: "qualified", label: "Leads Qualified", get: (m) => m.qualified, cell: (m) => int(m.qualified), td: "px-2 py-1.5", th: snapTh("qualified", false) },
  { key: "elqPct", label: "ELCQ %", get: (m) => m.elqPct, cell: (m) => pct1(m.elqPct), td: "px-2 py-1.5", th: snapTh("elqPct", false) },
  { key: "converted", label: "Leads Converted", get: (m) => m.converted, cell: (m) => int(m.converted), td: "px-2 py-1.5 font-semibold", th: snapTh("converted", false) },
  { key: "elcoPct", label: "ELCO %", get: (m) => m.elcoPct, cell: (m) => pct2(m.elcoPct), td: "px-2 py-1.5", th: snapTh("elcoPct", false) },
  { key: "volMt", label: "Vol (MT)", get: (m) => m.volMt, cell: (m) => int(m.volMt), td: "px-2 py-1.5", th: snapTh("volMt", false) },
  { key: "valueLacs", label: "Value (₹ Lacs)", get: (m) => m.valueLacs, cell: (m) => lacs(m.valueLacs), td: "px-2 py-1.5 font-semibold text-emerald-700", th: snapTh("valueLacs", false) },
  { key: "lcCloser", label: "LC (Closer Date)", get: (m) => m.lcCloser, cell: (m) => int(m.lcCloser), td: "px-2 py-1.5", th: snapTh("lcCloser", false) },
  { key: "elcoCloserPct", label: "ELCO % (Closer)", get: (m) => m.elcoCloserPct, cell: (m) => pct2(m.elcoCloserPct), td: "px-2 py-1.5", th: snapTh("elcoCloserPct", false) },
  { key: "volMtCloser", label: "Vol (MT) (Closer)", get: (m) => m.volMtCloser, cell: (m) => int(m.volMtCloser), td: "px-2 py-1.5", th: snapTh("volMtCloser", false) },
  { key: "valueLacsCloser", label: "Value (Lacs) (Closer)", get: (m) => m.valueLacsCloser, cell: (m) => lacs(m.valueLacsCloser), td: "px-2 py-1.5", th: snapTh("valueLacsCloser", false) },
];
const SNAP_FILTER_COLS: Array<FilterColumn<PerfMonth>> = SNAP_COLS.map((c) => ({ key: c.key, get: c.get }));
const snapGetter = (m: PerfMonth, key: string) => SNAP_COLS.find((c) => c.key === key)?.get(m);

interface CloserRow { closer: string; lc: number; volMt: number; valueLacs: number }
const CLOSER_COLS: Array<{ key: string; label: string; get: (c: CloserRow) => string | number; cell: (c: CloserRow) => ReactNode; td: string }> = [
  { key: "closer", label: "Closer", get: (c) => c.closer, cell: (c) => c.closer, td: "px-2 py-1.5 text-left font-semibold text-[#0b2a5b]" },
  { key: "lc", label: "LC (Closer Date)", get: (c) => c.lc, cell: (c) => int(c.lc), td: "px-2 py-1.5" },
  { key: "volMt", label: "Vol (MT)", get: (c) => c.volMt, cell: (c) => int(c.volMt), td: "px-2 py-1.5" },
  { key: "valueLacs", label: "Value (₹ Lacs)", get: (c) => c.valueLacs, cell: (c) => lacs(c.valueLacs), td: "px-2 py-1.5" },
];
const CLOSER_FILTER_COLS: Array<FilterColumn<CloserRow>> = CLOSER_COLS.map((c) => ({ key: c.key, get: c.get }));
const closerGetter = (c: CloserRow, key: string) => CLOSER_COLS.find((x) => x.key === key)?.get(c);

export function BirlanuSlidePerformance({ data, open }: { data: BirlanuMis; open: (s: DrawerSpec) => void }) {
  const { months, total, callingSplit, closers, closerMonth } = data.performance;
  if (months.length === 0) return <Empty />;
  const latest = months[months.length - 1];
  const prev: PerfMonth | undefined = months.length > 1 ? months[months.length - 2] : undefined;
  const drill = (title: string, cols: string[], chart: DrawerSeries[]) =>
    open({ title, subtitle: "Month-wise (financial year to date)", rows: months as unknown as DrawerSpec["rows"], columns: COLS_ALL.filter((c) => c.key === "month" || cols.includes(c.key)), chart });
  const monthDetail = (m: PerfMonth) => open({
    title: `${m.month} — full record`, subtitle: "Every Performance Dashboard column for this month", columns: [{ key: "metric", label: "Metric", fmt: "text" }, { key: "value", label: "Value", fmt: "text" }],
    rows: [
      ["Enquiries received", int(m.enquiries)], ["Connected", int(m.connected)], ["Connect %", pct1(m.connectPct)], ["Leads validated (Interested)", int(m.validated)], ["Enquiry → Leads Validated %", pct2(m.elvaPct)],
      ["Leads qualified (Lead assign to Sales team)", int(m.qualified)], ["Enquiry → Leads Qualified %", pct2(m.elqPct)], ["Leads converted (by register month)", int(m.converted)],
      ["Enquiry → Leads Converted %", pct2(m.elcoPct)], ["Vol (MT)", int(m.volMt)], ["Value (₹ Lacs)", lacs(m.valueLacs)], ["LC as per closer date", int(m.lcCloser)],
      ["Enquiry → LC % (closer month)", pct2(m.elcoCloserPct)], ["Vol (MT) as per closer month", int(m.volMtCloser)], ["Value (₹ Lacs) as per closer month", lacs(m.valueLacsCloser)],
    ].map(([metric, value]) => ({ metric, value })),
  });

  const insights: string[] = [];
  insights.push(`Connect % is ${pct1(total.connectPct)}${prev ? `, ${latest.connectPct >= prev.connectPct ? "up" : "down"} ${Math.abs(ppDelta(latest.connectPct, prev.connectPct) ?? 0)} pp in ${latest.month} vs ${prev.month} (${pct1(prev.connectPct)})` : ""}.`);
  insights.push(`Leads Validated are ${int(total.validated)} (${pct1(total.elvaPct)} of enquiries).`);
  insights.push(`Leads Qualified are ${int(total.qualified)} (${pct1(total.elqPct)} of enquiries).`);
  insights.push(`Leads Converted are ${int(total.converted)} (${pct2(total.elcoPct)}) worth ${lacs(total.valueLacs)} Lacs.`);
  const bestMonth = [...months].sort((a, b) => b.enquiries - a.enquiries)[0];
  insights.push(`${bestMonth.month} had the most enquiries: ${int(bestMonth.enquiries)}.`);
  if (total.lcCloser > 0) insights.push(`By lead-closer month, ${int(total.lcCloser)} leads closed (${pct2(total.elcoCloserPct)}) for ${lacs(total.valueLacsCloser)} Lacs.`);

  const donut = [
    { label: "Connected", value: callingSplit.connected, color: "#1d4ed8" },
    { label: "Not Connected", value: callingSplit.notConnected, color: "#f59e0b" },
  ];
  const donutTotal = donut[0].value + donut[1].value;
  const closerTotal = closers.reduce((a, c) => a + c.lc, 0);

  const snapFilters = useColumnFilters(months, SNAP_FILTER_COLS);
  const { sorted: snapRows, sortKey: snapSortKey, sortDir: snapSortDir, toggleSort: snapToggleSort } = useSortableRows(snapFilters.filtered, snapGetter);
  const closerFilters = useColumnFilters(closers, CLOSER_FILTER_COLS);
  const { sorted: closerRows, sortKey: closerSortKey, sortDir: closerSortDir, toggleSort: closerToggleSort } = useSortableRows(closerFilters.filtered, closerGetter);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
        <Kpi icon={Users} label="Enquiries Received" value={int(total.enquiries)} delta={delta(latest.enquiries, prev?.enquiries)} sub="latest vs prev month" onClick={() => drill("Enquiries Received", ["enquiries"], [s("enquiries", "Enquiries", "#1d4ed8")])} />
        <Kpi icon={PhoneCall} tone="#0ea5e9" label="Connect %" value={pct1(total.connectPct)} delta={ppDelta(latest.connectPct, prev?.connectPct)} unit="pp" sub={prev ? `Prev month: ${pct1(prev.connectPct)}` : undefined} onClick={() => drill("Connect %", ["enquiries", "connected", "connectPct"], [s("connected", "Connected", "#0ea5e9"), s("connectPct", "Connect %", "#f59e0b", "line", "right")])} />
        <Kpi icon={UserCheck} tone="#10b981" label="Leads Validated" value={int(total.validated)} delta={delta(latest.validated, prev?.validated)} onClick={() => drill("Leads Validated", ["validated", "elvaPct"], [s("validated", "Validated", "#10b981"), s("elvaPct", "ELCV %", "#f59e0b", "line", "right")])} />
        <Kpi icon={Filter} tone="#f59e0b" label="ELCV %" value={pct1(total.elvaPct)} sub="Enquiry to Leads Validated" onClick={() => drill("ELCV % (Enquiry → Leads Validated)", ["enquiries", "validated", "elvaPct"], [s("elvaPct", "ELCV %", "#f59e0b", "line")])} />
        <Kpi icon={BadgeCheck} tone="#0b2a5b" label="Leads Qualified" value={int(total.qualified)} delta={delta(latest.qualified, prev?.qualified)} onClick={() => drill("Leads Qualified", ["qualified", "elqPct"], [s("qualified", "Qualified", "#0b2a5b"), s("elqPct", "ELCQ %", "#f59e0b", "line", "right")])} />
        <Kpi icon={Target} tone="#0f766e" label="ELCQ %" value={pct1(total.elqPct)} sub="Enquiry to Leads Qualified" onClick={() => drill("ELCQ % (Enquiry → Leads Qualified)", ["enquiries", "qualified", "elqPct"], [s("elqPct", "ELCQ %", "#0f766e", "line")])} />
        <Kpi icon={Handshake} tone="#16a34a" label="Leads Converted" value={int(total.converted)} delta={delta(latest.converted, prev?.converted)} onClick={() => drill("Leads Converted", ["converted", "elcoPct"], [s("converted", "Converted", "#16a34a"), s("elcoPct", "ELCO %", "#f59e0b", "line", "right")])} />
        <Kpi icon={TrendingUp} tone="#ea580c" label="ELCO %" value={pct2(total.elcoPct)} sub="Enquiry to Leads Converted" onClick={() => drill("ELCO % (Enquiry → Leads Converted)", ["enquiries", "converted", "elcoPct"], [s("elcoPct", "ELCO %", "#ea580c", "line")])} />
        <Kpi icon={Truck} tone="#475569" label="Volume (MT)" value={int(total.volMt)} delta={delta(latest.volMt, prev?.volMt)} onClick={() => drill("Volume (MT)", ["volMt"], [s("volMt", "Vol (MT)", "#475569")])} />
        <Kpi icon={IndianRupee} tone="#ca8a04" label="Value (₹ Lacs)" value={lacs(total.valueLacs)} delta={delta(latest.valueLacs, prev?.valueLacs)} onClick={() => drill("Value (₹ Lacs)", ["valueLacs"], [s("valueLacs", "Value (Lacs)", "#ca8a04")])} />
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-5" icon={LineChart} title="Month Wise Performance Trend" action={<DetailsBtn onClick={() => drill("Month Wise Performance Trend", COLS_ALL.map((c) => c.key), [s("enquiries", "Enquiries", "#3b82f6"), s("validated", "Validated", "#f59e0b"), s("qualified", "Qualified", "#0b2a5b"), s("converted", "Converted", "#16a34a"), s("connectPct", "Connect %", "#ef4444", "line", "right")])} />}>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={months} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="left" dataKey="enquiries" name="Enquiries Received" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar yAxisId="left" dataKey="validated" name="Leads Validated" fill="#f59e0b" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar yAxisId="left" dataKey="qualified" name="Leads Qualified" fill="#0b2a5b" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar yAxisId="left" dataKey="converted" name="Leads Converted" fill="#16a34a" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Line yAxisId="right" type="monotone" dataKey="connectPct" name="Connect %" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>

        <BCard className="lg:col-span-3" icon={Filter} title="Conversion Funnel" action={<DetailsBtn onClick={() => drill("Conversion Funnel", ["enquiries", "validated", "elvaPct", "qualified", "elqPct", "converted", "elcoPct"], [s("enquiries", "Enquiries", "#3b82f6"), s("validated", "Validated", "#f59e0b"), s("qualified", "Qualified", "#0b2a5b"), s("converted", "Converted", "#16a34a")])} />}>
          <Funnel stages={[
            { label: "Enquiries Received", value: total.enquiries, sub: "100%", color: "#1d4ed8" },
            { label: "Leads Validated", value: total.validated, sub: `${pct1(total.elvaPct)} ELCV`, color: "#d99a00" },
            { label: "Leads Qualified", value: total.qualified, sub: `${pct1(total.elqPct)} ELCQ`, color: "#0b2a5b" },
            { label: "Leads Converted", value: total.converted, sub: `${pct2(total.elcoPct)} ELCO`, color: "#16a34a" },
          ]} />
        </BCard>

        <BCard className="lg:col-span-4" icon={TrendingUp} title="Volume & Value Trend" action={<DetailsBtn onClick={() => drill("Volume & Value Trend", ["volMt", "valueLacs"], [s("volMt", "Volume (MT)", "#0b2a5b"), s("valueLacs", "Value (Lacs)", "#f59e0b", "line", "right")])} />}>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={months} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n: string) => (n.startsWith("Value") ? lacs(v) : int(v))} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="left" dataKey="volMt" name="Volume (MT)" fill="#0b2a5b" radius={[3, 3, 0, 0]} maxBarSize={24} />
              <Line yAxisId="right" type="monotone" dataKey="valueLacs" name="Value (₹ Lacs)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>
      </div>

      <BCard icon={Table2} title="Monthly Performance Snapshot" footnote="Click a month for its full record. 'As per closer month' groups the same conversions by Lead Closer Month; the other columns group by LeadRegisterMonth. There is no investment figure in the data, so no ROI column is shown."
        action={<DetailsBtn onClick={() => drill("Monthly Performance Snapshot", COLS_ALL.map((c) => c.key), [s("enquiries", "Enquiries", "#3b82f6"), s("converted", "Converted", "#16a34a")])} />}>
        {snapFilters.activeCount > 0 && (
          <button type="button" onClick={snapFilters.clearAll} className="mb-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
            Clear {snapFilters.activeCount} filter{snapFilters.activeCount > 1 ? "s" : ""}
          </button>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-center text-xs">
            <thead>
              <tr>
                {SNAP_COLS.map((c) => (
                  <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={snapSortKey} sortDir={snapSortDir} onSort={snapToggleSort} filters={snapFilters} className={c.th} />
                ))}
              </tr>
            </thead>
            <tbody>
              {snapRows.map((m, i) => (
                <tr key={m.month} role="button" tabIndex={0} onClick={() => monthDetail(m)} onKeyDown={(e) => { if (e.key === "Enter") monthDetail(m); }} className={`cursor-pointer hover:bg-amber-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                  {SNAP_COLS.map((c) => <td key={c.key} className={c.td}>{c.cell(m)}</td>)}
                </tr>
              ))}
              {snapRows.length === 0 && <tr><td colSpan={SNAP_COLS.length} className="py-6 text-center text-slate-400">No months match the filters.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="bg-amber-100 font-bold text-slate-800">
                <td className="px-2 py-1.5 text-left">Grand Total</td><td className="px-2 py-1.5">—</td><td className="px-2 py-1.5">{int(total.enquiries)}</td><td className="px-2 py-1.5">{int(total.connected)}</td><td className="px-2 py-1.5">{pct1(total.connectPct)}</td>
                <td className="px-2 py-1.5">{int(total.validated)}</td><td className="px-2 py-1.5">{pct1(total.elvaPct)}</td><td className="px-2 py-1.5">{int(total.qualified)}</td><td className="px-2 py-1.5">{pct1(total.elqPct)}</td>
                <td className="px-2 py-1.5">{int(total.converted)}</td><td className="px-2 py-1.5">{pct2(total.elcoPct)}</td><td className="px-2 py-1.5">{int(total.volMt)}</td><td className="px-2 py-1.5">{lacs(total.valueLacs)}</td>
                <td className="px-2 py-1.5">{int(total.lcCloser)}</td><td className="px-2 py-1.5">{pct2(total.elcoCloserPct)}</td><td className="px-2 py-1.5">{int(total.volMtCloser)}</td><td className="px-2 py-1.5">{lacs(total.valueLacsCloser)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </BCard>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-5" icon={Trophy} title={`Lead Closer Performance (${closerMonth || "—"})`} footnote="Closer = the seller who closed the lead (Seller Email in the data); counts are conversions by Lead Closer Month."
          action={<DetailsBtn onClick={() => open({ title: "Lead Closer Performance", subtitle: closerMonth, xKey: "closer", columns: [{ key: "closer", label: "Closer", fmt: "text" }, { key: "lc", label: "LC (closer date)" }, { key: "volMt", label: "Vol (MT)" }, { key: "valueLacs", label: "Value (Lacs)", fmt: "lacs" }], rows: closers as unknown as DrawerSpec["rows"], chart: [s("lc", "LC", "#0b2a5b"), s("valueLacs", "Value (Lacs)", "#f59e0b", "line", "right")] })} />}>
          {closers.length === 0 ? <Empty text="No conversions in the latest closer month." /> : (
            <>
              {closerFilters.activeCount > 0 && (
                <button type="button" onClick={closerFilters.clearAll} className="mb-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
                  Clear {closerFilters.activeCount} filter{closerFilters.activeCount > 1 ? "s" : ""}
                </button>
              )}
              <div className="max-h-[260px] overflow-auto">
                <table className="w-full text-center text-xs">
                  <thead>
                    <tr className="sticky top-0">
                      {CLOSER_COLS.map((c, i) => (
                        <FilterSortTh
                          key={c.key} label={c.label} columnKey={c.key} sortKey={closerSortKey} sortDir={closerSortDir} onSort={closerToggleSort} filters={closerFilters}
                          className={`whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-center text-[10px] font-bold text-white ${i === 0 ? "rounded-l-md text-left" : ""} ${i === CLOSER_COLS.length - 1 ? "rounded-r-md" : ""}`}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {closerRows.map((c, i) => (
                      <tr key={c.closer} role="button" tabIndex={0} onClick={() => open({ title: c.closer, subtitle: `Closer · ${closerMonth}`, columns: [{ key: "metric", label: "Metric", fmt: "text" }, { key: "value", label: "Value", fmt: "text" }], rows: [{ metric: "Leads closed (LC)", value: int(c.lc) }, { metric: "Share of all closed leads", value: pct1((c.lc / Math.max(1, closerTotal)) * 100) }, { metric: "Vol (MT)", value: int(c.volMt) }, { metric: "Value (₹ Lacs)", value: lacs(c.valueLacs) }] })} className={`cursor-pointer hover:bg-amber-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                        {CLOSER_COLS.map((c2) => <td key={c2.key} className={c2.td}>{c2.cell(c)}</td>)}
                      </tr>
                    ))}
                    {closerRows.length === 0 && <tr><td colSpan={CLOSER_COLS.length} className="py-6 text-center text-slate-400">No closers match the filters.</td></tr>}
                  </tbody>
                  <tfoot><tr className="bg-amber-100 font-bold"><td className="px-2 py-1.5 text-left">Total</td><td className="px-2 py-1.5">{int(closerTotal)}</td><td className="px-2 py-1.5">{int(closers.reduce((a, c) => a + c.volMt, 0))}</td><td className="px-2 py-1.5">{lacs(closers.reduce((a, c) => a + c.valueLacs, 0))}</td></tr></tfoot>
                </table>
              </div>
            </>
          )}
        </BCard>

        <BCard className="lg:col-span-3" icon={PieIcon} title="Connected vs Not Connected" action={<DetailsBtn onClick={() => drill("Connected vs Not Connected", ["enquiries", "connected", "connectPct"], [s("connected", "Connected", "#1d4ed8"), s("enquiries", "Enquiries", "#f59e0b")])} />}>
          <div className="relative">
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="label" innerRadius={44} outerRadius={64} paddingAngle={2} stroke="none">{donut.map((d) => <Cell key={d.label} fill={d.color} />)}</Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => int(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-sm font-extrabold text-slate-800">{int(donutTotal)}</p><p className="text-[9px] text-slate-400">Total Enquiries</p></div>
          </div>
          <LegendList items={donut.map((d) => ({ ...d, pct: donutTotal ? (d.value / donutTotal) * 100 : 0 }))} />
        </BCard>

        <BCard className="lg:col-span-4" icon={Lightbulb} title="Key Insights"><Insights items={insights} /></BCard>
      </div>
    </div>
  );
}
