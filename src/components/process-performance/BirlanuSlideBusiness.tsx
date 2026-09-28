import { ComposedChart, Bar, Line, LineChart, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { FileText, Leaf, Filter, Users, Megaphone, Percent, IndianRupee, Wallet, Target, LineChart as LineIcon, TrendingUp, PieChart as PieIcon, Table2, Lightbulb, Layers } from "lucide-react";
import type { BirlanuMis } from "./birlanuTypes";
import {
  BCard, DetailsBtn, Empty, Funnel, Insights, Kpi, LegendList, Th, TOOLTIP_STYLE, PALETTE, delta, int, lacs, pct1, ppDelta,
  type DrawerCol, type DrawerSeries, type DrawerSpec,
} from "./BirlanuKit";

/**
 * Slide 2 -- Business Dashboard. Logic = the workbook's "Business Dashboard" sheet, filtered to
 * Sub Sub Calling Status = "Lead assign to Sales team":
 *   Validated queries = rows by LeadRegisterMonth; Organic = Organic/Paid column "Organic";
 *   Conversions = closed_with_order + closed_with_dealership by LeadCloserMonth (Closed = "Sold");
 *   % conversion = conversions / validated queries (a closer-month count over a register-month base, as the sheet does);
 *   paid % = paid conversions / (validated - organic validated);
 *   Digital revenue = Sale INR of closed_with_order; Revenue Generated (first billing value) = closed_with_dealership.
 * Cost, cost per validated lead and ROI are "To be filled by Birlanu" in the workbook itself, so they are shown as such.
 */

const COLS: DrawerCol[] = [
  { key: "month", label: "Month", fmt: "text" }, { key: "validated", label: "Validated queries" }, { key: "organicV", label: "Organic queries" }, { key: "organicSharePct", label: "Organic share", fmt: "pct1" },
  { key: "conv", label: "Total conversions" }, { key: "convOrganic", label: "Organic conv." }, { key: "convPaid", label: "Paid conv." },
  { key: "convPct", label: "Conv %", fmt: "pct1" }, { key: "convOrganicPct", label: "Organic conv %", fmt: "pct1" }, { key: "convPaidPct", label: "Paid conv %", fmt: "pct1" },
  { key: "revenue", label: "Digital revenue (L)", fmt: "lacs" }, { key: "revenueOrganic", label: "Organic revenue (L)", fmt: "lacs" }, { key: "revenueOrganicPct", label: "Organic rev. share", fmt: "pct1" }, { key: "firstBilling", label: "First billing (L)", fmt: "lacs" },
];
const s = (key: string, label: string, color: string, type: "bar" | "line" = "bar", axis: "left" | "right" = "left"): DrawerSeries => ({ key, label, color, type, axis });
const STATUS_COLORS: Record<string, string> = { followup: "#2563eb", underprocess: "#10b981", closed_with_order: "#f59e0b", dropped: "#ef4444" };

export function BirlanuSlideBusiness({ data, open }: { data: BirlanuMis; open: (s: DrawerSpec) => void }) {
  const { perMonth, ytd, closureBreakup, closureTotal, groups } = data.business;
  if (perMonth.length === 0) return <Empty />;
  const latest = perMonth[perMonth.length - 1];
  const prev = perMonth.length > 1 ? perMonth[perMonth.length - 2] : undefined;
  const drill = (title: string, keys: string[], chart: DrawerSeries[]) =>
    open({ title, subtitle: "Month-wise (financial year to date)", rows: perMonth as unknown as DrawerSpec["rows"], columns: COLS.filter((c) => c.key === "month" || keys.includes(c.key)), chart });
  const organicRev = ytd.revenueOrganic;
  const otherRev = Math.max(0, ytd.revenue - organicRev);
  const mix = [{ label: "Organic Revenue", value: organicRev, color: "#f59e0b" }, { label: "Other Revenue", value: otherRev, color: "#0b2a5b" }];
  const closureRows = closureBreakup.map((c) => ({ ...c, color: STATUS_COLORS[c.status] ?? PALETTE[(closureBreakup.indexOf(c) + 4) % PALETTE.length] }));
  const groupRows = [
    { label: "Closed (a to e)", value: groups.closed, color: "#f59e0b" },
    { label: "Follow Up (f to h)", value: groups.followUp, color: "#3b82f6" },
    { label: "Dropped (m)", value: groups.dropped, color: "#8b5cf6" },
  ];
  const groupTotal = groupRows.reduce((a, g) => a + g.value, 0);
  const peak = [...perMonth].sort((a, b) => b.convPct - a.convPct)[0];

  const insights = [
    `YTD validated queries are ${int(ytd.validated)} with an organic share of ${pct1(ytd.organicSharePct)} (${int(ytd.organicV)} queries).`,
    `Total conversions are ${int(ytd.conv)} (${pct1(ytd.convPct)} conversion rate).`,
    `Organic conversions are ${int(ytd.convOrganic)} (${pct1(ytd.conv ? (ytd.convOrganic / ytd.conv) * 100 : 0)}) and paid marketing conversions ${int(ytd.convPaid)} (${pct1(ytd.conv ? (ytd.convPaid / ytd.conv) * 100 : 0)}).`,
    `${peak.month} recorded the highest total conversion rate at ${pct1(peak.convPct)}.`,
    `Digital revenue is ${lacs(ytd.revenue)} Lakhs; organic revenue contributes ${pct1(ytd.revenueOrganicPct)} of it.`,
    `${latest.month} digital revenue is ${lacs(latest.revenue)} Lakhs and organic revenue ${lacs(latest.revenueOrganic)} Lakhs.`,
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-9">
        <Kpi icon={FileText} label="Validated Queries Total (YTD)" value={int(ytd.validated)} delta={delta(latest.validated, prev?.validated)} sub="latest vs prev month" onClick={() => drill("Validated Queries", ["validated", "organicV", "organicSharePct"], [s("validated", "Validated", "#3b82f6"), s("organicV", "Organic", "#f59e0b")])} />
        <Kpi icon={Leaf} tone="#16a34a" label="Organic Validated Queries (YTD)" value={int(ytd.organicV)} sub={`Organic share ${pct1(ytd.organicSharePct)}`} onClick={() => drill("Organic Validated Queries", ["organicV", "organicSharePct"], [s("organicV", "Organic", "#16a34a"), s("organicSharePct", "Organic share %", "#f59e0b", "line", "right")])} />
        <Kpi icon={Filter} tone="#7c3aed" label="Total Conversions (YTD)" value={int(ytd.conv)} delta={delta(latest.conv, prev?.conv)} onClick={() => drill("Total Conversions", ["conv", "convOrganic", "convPaid", "convPct"], [s("conv", "Conversions", "#0b2a5b"), s("convPct", "Conv %", "#ef4444", "line", "right")])} />
        <Kpi icon={Users} tone="#0d9488" label="Organic Conversions (YTD)" value={int(ytd.convOrganic)} sub={`${pct1(ytd.conv ? (ytd.convOrganic / ytd.conv) * 100 : 0)} of total`} onClick={() => drill("Organic Conversions", ["convOrganic", "convOrganicPct"], [s("convOrganic", "Organic conv.", "#0d9488"), s("convOrganicPct", "Organic conv %", "#f59e0b", "line", "right")])} />
        <Kpi icon={Megaphone} tone="#2563eb" label="Paid Marketing Conversions (YTD)" value={int(ytd.convPaid)} sub={`${pct1(ytd.conv ? (ytd.convPaid / ytd.conv) * 100 : 0)} of total`} onClick={() => drill("Paid Marketing Conversions", ["convPaid", "convPaidPct"], [s("convPaid", "Paid conv.", "#2563eb"), s("convPaidPct", "Paid conv %", "#f59e0b", "line", "right")])} />
        <Kpi icon={Percent} tone="#0ea5e9" label="Total Conversion % (YTD)" value={pct1(ytd.convPct)} delta={ppDelta(latest.convPct, prev?.convPct)} unit="pp" onClick={() => drill("Total Conversion %", ["validated", "conv", "convPct"], [s("convPct", "Conv %", "#0ea5e9", "line")])} />
        <Kpi icon={IndianRupee} tone="#16a34a" label="Digital Revenue Generated (YTD)" value={`${lacs(ytd.revenue)} L`} delta={delta(latest.revenue, prev?.revenue)} onClick={() => drill("Digital Revenue", ["revenue", "revenueOrganic", "revenueOrganicPct"], [s("revenue", "Digital revenue (L)", "#0b2a5b"), s("revenueOrganic", "Organic revenue (L)", "#f59e0b")])} />
        <Kpi icon={Wallet} tone="#ca8a04" label="Organic Revenue (YTD)" value={`${lacs(ytd.revenueOrganic)} L`} sub={`Organic share ${pct1(ytd.revenueOrganicPct)}`} onClick={() => drill("Organic Revenue", ["revenueOrganic", "revenueOrganicPct"], [s("revenueOrganic", "Organic revenue (L)", "#ca8a04"), s("revenueOrganicPct", "Organic share %", "#0b2a5b", "line", "right")])} />
        <Kpi icon={Target} tone="#dc2626" label="Revenue Generated (First Billing Value) (YTD)" value={`${lacs(ytd.firstBilling)} L`} onClick={() => drill("First Billing Value (dealership)", ["firstBilling"], [s("firstBilling", "First billing (L)", "#dc2626")])} />
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-5" icon={LineIcon} title="Monthly Performance Trend" action={<DetailsBtn onClick={() => drill("Monthly Performance Trend", ["validated", "organicV", "conv", "convPct"], [s("validated", "Validated", "#3b82f6"), s("organicV", "Organic", "#f59e0b"), s("conv", "Conversions", "#16a34a"), s("convPct", "Conv %", "#ef4444", "line", "right")])} />}>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={perMonth} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 9 }} /><YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="left" dataKey="validated" name="Validated Queries" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar yAxisId="left" dataKey="organicV" name="Organic Queries" fill="#f59e0b" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar yAxisId="left" dataKey="conv" name="Total Conversions" fill="#16a34a" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Line yAxisId="right" type="monotone" dataKey="convPct" name="Conversion %" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>

        <BCard className="lg:col-span-3" icon={Filter} title="Conversion Funnel (YTD)" action={<DetailsBtn onClick={() => drill("Conversion Funnel", ["validated", "conv", "convOrganic", "convPaid", "convPct"], [s("validated", "Validated", "#1d4ed8"), s("conv", "Conversions", "#f59e0b")])} />}>
          <Funnel stages={[
            { label: "Validated Queries", value: ytd.validated, sub: "100%", color: "#1d4ed8" },
            { label: "Total Conversions", value: ytd.conv, sub: pct1(ytd.convPct), color: "#d99a00" },
          ]} />
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <div className="rounded-md bg-emerald-600 py-1.5 text-center text-white"><p className="text-sm font-extrabold">{int(ytd.convOrganic)}</p><p className="text-[9px]">Organic Conversions</p><p className="text-[10px] font-bold">{pct1(ytd.conv ? (ytd.convOrganic / ytd.conv) * 100 : 0)}</p></div>
            <div className="rounded-md bg-[#0b2a5b] py-1.5 text-center text-white"><p className="text-sm font-extrabold">{int(ytd.convPaid)}</p><p className="text-[9px]">Paid Marketing Conv.</p><p className="text-[10px] font-bold">{pct1(ytd.conv ? (ytd.convPaid / ytd.conv) * 100 : 0)}</p></div>
          </div>
        </BCard>

        <BCard className="lg:col-span-4" icon={TrendingUp} title="Revenue Trend" action={<DetailsBtn onClick={() => drill("Revenue Trend", ["revenue", "revenueOrganic", "firstBilling"], [s("revenue", "Digital revenue (L)", "#0b2a5b"), s("revenueOrganic", "Organic revenue (L)", "#f59e0b")])} />}>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={perMonth} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${lacs(v)} L`} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="revenue" name="Digital Revenue (₹ Lakhs)" fill="#0b2a5b" radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Bar dataKey="revenueOrganic" name="Organic Revenue (₹ Lakhs)" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={22} />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-4" icon={Percent} title="Conversion % Trend" action={<DetailsBtn onClick={() => drill("Conversion % Trend", ["convPct", "convOrganicPct", "convPaidPct"], [s("convPct", "Total", "#ef4444", "line"), s("convOrganicPct", "Organic", "#16a34a", "line"), s("convPaidPct", "Paid", "#3b82f6", "line")])} />}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={perMonth} margin={{ top: 4, right: 6, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${v}%`} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="convPct" name="Total Conversion %" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="convOrganicPct" name="Organic Conversion %" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="convPaidPct" name="Paid Conversion %" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </BCard>

        <BCard className="lg:col-span-4" icon={PieIcon} title="Revenue Mix (YTD)" action={<DetailsBtn onClick={() => drill("Revenue Mix", ["revenue", "revenueOrganic", "revenueOrganicPct"], [s("revenue", "Digital revenue (L)", "#0b2a5b"), s("revenueOrganic", "Organic revenue (L)", "#f59e0b")])} />}>
          <div className="flex items-center gap-3">
            <div className="relative h-[160px] w-[160px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={mix} dataKey="value" nameKey="label" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">{mix.map((m) => <Cell key={m.label} fill={m.color} />)}</Pie><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${lacs(v)} L`} /></PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-xs font-extrabold text-slate-800">{lacs(ytd.revenue)} L</p><p className="text-[9px] text-slate-400">Digital Revenue</p></div>
            </div>
            <ul className="flex-1 space-y-2 text-[11px]">
              {mix.map((m) => (
                <li key={m.label}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} /><span className="text-slate-500">{m.label}</span><p className="pl-4 text-sm font-extrabold text-slate-800">{lacs(m.value)} L <span className="text-[10px] font-medium text-slate-400">({pct1(ytd.revenue ? (m.value / ytd.revenue) * 100 : 0)})</span></p></li>
              ))}
            </ul>
          </div>
        </BCard>

        <BCard className="lg:col-span-4" icon={Table2} title="Cost & ROI (YTD)" footnote="These four rows are 'To be filled by Birlanu' in the source workbook; no cost or ROI figure exists in the data.">
          <table className="w-full text-xs">
            <thead><tr><Th className="rounded-l-md text-left">Parameters</Th><Th className="rounded-r-md">Value</Th></tr></thead>
            <tbody>
              {["Cost (in Lakhs)", "Cost per validated lead (paid marketing)", "Cost per validated lead (organic)", "ROI"].map((p, i) => (
                <tr key={p} className={i % 2 ? "bg-slate-50" : "bg-white"}><td className="px-2 py-1.5 text-left text-slate-700">{p}</td><td className="px-2 py-1.5 text-center font-semibold text-amber-700">To be filled by Birlanu</td></tr>
              ))}
            </tbody>
          </table>
        </BCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-4" icon={PieIcon} title="Closure / Lead Status (YTD)" action={<DetailsBtn onClick={() => open({ title: "Closure / Lead Status", subtitle: "Validated queries by lead closer status (financial year to date)", xKey: "status", columns: [{ key: "status", label: "Closure status", fmt: "text" }, { key: "count", label: "Count" }, { key: "pct", label: "% of total", fmt: "pct1" }], rows: closureBreakup as unknown as DrawerSpec["rows"], chart: [s("count", "Count", "#0b2a5b")] })} />}>
          <div className="flex items-center gap-2">
            <div className="relative h-[150px] w-[150px] shrink-0">
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={closureRows} dataKey="count" nameKey="status" innerRadius={44} outerRadius={68} stroke="none">{closureRows.map((c) => <Cell key={c.status} fill={c.color} />)}</Pie><Tooltip contentStyle={TOOLTIP_STYLE} /></PieChart></ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-sm font-extrabold text-slate-800">{int(closureTotal)}</p><p className="text-[9px] text-slate-400">Total Leads</p></div>
            </div>
            <div className="min-w-0 flex-1"><LegendList items={closureRows.slice(0, 6).map((c) => ({ label: c.status, value: c.count, color: c.color, pct: c.pct }))} /></div>
          </div>
        </BCard>

        <BCard className="lg:col-span-3" icon={Table2} title="Closure Breakup (YTD)" footnote="a and b are counted by closer month, c to r by register month — the sheet's own mix, so the total can differ from validated queries.">
          <div className="max-h-[210px] overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="sticky top-0"><Th className="rounded-l-md text-left">Closure Status</Th><Th>Count</Th><Th className="rounded-r-md">% of Total</Th></tr></thead>
              <tbody>
                {closureBreakup.map((c, i) => (
                  <tr key={c.status} role="button" tabIndex={0} onClick={() => open({ title: c.status, subtitle: "Closure status", columns: [{ key: "metric", label: "Metric", fmt: "text" }, { key: "value", label: "Value", fmt: "text" }], rows: [{ metric: "Count", value: int(c.count) }, { metric: "% of total", value: pct1(c.pct) }, { metric: "Total leads", value: int(closureTotal) }] })} className={`cursor-pointer hover:bg-amber-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                    <td className="px-2 py-1 text-left text-slate-700">{c.status}</td><td className="px-2 py-1 text-center">{int(c.count)}</td><td className="px-2 py-1 text-center">{pct1(c.pct)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-amber-100 font-bold"><td className="px-2 py-1 text-left">Grand Total</td><td className="px-2 py-1 text-center">{int(closureTotal)}</td><td className="px-2 py-1 text-center">100.0%</td></tr></tfoot>
            </table>
          </div>
        </BCard>

        <BCard className="lg:col-span-2" icon={Layers} title="Status Grouping (YTD)">
          <div className="space-y-2.5">
            {groupRows.map((g) => (
              <div key={g.label}>
                <div className="flex justify-between text-[11px]"><span className="text-slate-600">{g.label}</span><span className="font-bold text-slate-800">{int(g.value)} <span className="font-medium text-slate-400">({pct1(groupTotal ? (g.value / groupTotal) * 100 : 0)})</span></span></div>
                <div className="mt-0.5 h-3 rounded bg-slate-100"><div className="h-3 rounded" style={{ width: `${groupTotal ? (g.value / groupTotal) * 100 : 0}%`, backgroundColor: g.color }} /></div>
              </div>
            ))}
          </div>
        </BCard>

        <BCard className="lg:col-span-3" icon={Lightbulb} title="Key Insights"><Insights items={insights} /></BCard>
      </div>
    </div>
  );
}
