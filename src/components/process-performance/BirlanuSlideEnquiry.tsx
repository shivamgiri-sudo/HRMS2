import { ComposedChart, Bar, Line, LineChart, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Users, Megaphone, ShoppingBag, PhoneIncoming, MessageSquare, Globe, BarChart3, PieChart as PieIcon, TrendingUp, Layers, Award, Table2, Lightbulb } from "lucide-react";
import type { BirlanuMis } from "./birlanuTypes";
import { BCard, DetailsBtn, Empty, Insights, Kpi, LegendList, Th, TOOLTIP_STYLE, PALETTE, delta, int, pct1, type DrawerSpec } from "./BirlanuKit";

/**
 * Slide 5 -- Enquiry Count by Channels. Logic = the workbook's "Enquiry Count - Channels" sheet: every row of the Data sheet is one enquiry,
 * counted by LeadRegisterMonth and Enquiry Source (Data!L; "IndiaMart"/"IndiaMART" are one source). Business Unit / Product = Brand (Data!AD).
 * MoM growth % = (this month - previous month) / previous month.
 */

const ICONS = [Megaphone, ShoppingBag, PhoneIncoming, MessageSquare, Globe];
const TONES = ["#0d9488", "#f59e0b", "#2563eb", "#ec4899", "#7c3aed"];

export function BirlanuSlideEnquiry({ data, open }: { data: BirlanuMis; open: (s: DrawerSpec) => void }) {
  const e = data.enquiry;
  if (e.grand === 0) return <Empty />;
  const latest = e.months[e.months.length - 1];
  const prev = e.months.length > 1 ? e.months[e.months.length - 2] : undefined;
  const top5 = e.sourceTotals.slice(0, 5);
  const others = e.sourceTotals.slice(5).reduce((a, s) => a + s.count, 0);
  const monthCols = [{ key: "month", label: "Month", fmt: "text" as const }, { key: "total", label: "Total enquiries" }, { key: "momPct", label: "MoM growth", fmt: "pct1" as const }];
  const monthlyDrill = (title: string) => open({
    title, subtitle: "Month-wise (financial year to date)", columns: monthCols, rows: e.months as unknown as DrawerSpec["rows"],
    chart: [{ key: "total", label: "Total enquiries", color: "#3b82f6", type: "bar" }, { key: "momPct", label: "MoM growth %", color: "#16a34a", type: "line", axis: "right" }],
  });
  const sourceDrill = (source: string) => open({
    title: `${source} — enquiries`, subtitle: "Month-wise", columns: [{ key: "month", label: "Month", fmt: "text" }, { key: "count", label: "Enquiries" }, { key: "share", label: "Share of month", fmt: "pct1" }],
    rows: e.months.map((m) => ({ month: m.month, count: m.by[source] ?? 0, share: m.total ? ((m.by[source] ?? 0) / m.total) * 100 : 0 })),
    chart: [{ key: "count", label: "Enquiries", color: "#2563eb", type: "bar" }, { key: "share", label: "Share %", color: "#f59e0b", type: "line", axis: "right" }],
  });
  const donut = [...top5.map((s, i) => ({ label: s.source, value: s.count, color: PALETTE[i % PALETTE.length], pct: s.pct })), ...(others > 0 ? [{ label: "Others", value: others, color: "#94a3b8", pct: (others / e.grand) * 100 }] : [])];
  const maxBrand = e.brands[0]?.count ?? 1;
  const barData = top5.map((s) => ({ source: s.source, count: s.count }));
  const trendData = e.months.map((m) => ({ month: m.month, ...Object.fromEntries(top5.map((s) => [s.source, m.by[s.source] ?? 0])) }));
  const peak = [...e.months].sort((a, b) => b.total - a.total)[0];
  const low = e.months.length > 1 ? [...e.months].sort((a, b) => (a.momPct ?? 0) - (b.momPct ?? 0))[0] : undefined;
  const insights = [
    `Total enquiries are ${int(e.grand)}${prev && latest.momPct !== null ? `; ${latest.month} is ${latest.momPct >= 0 ? "up" : "down"} ${Math.abs(latest.momPct)}% vs ${prev.month}` : ""}.`,
    top5[0] ? `${top5[0].source} drives the highest share (${pct1(top5[0].pct)})${top5[1] ? `, followed by ${top5[1].source} (${pct1(top5[1].pct)})` : ""}.` : "",
    top5[2] ? `${top5[2].source} contributes ${pct1(top5[2].pct)} of total enquiries.` : "",
    peak ? `${peak.month} recorded the highest enquiries (${int(peak.total)})${peak.momPct !== null ? ` with ${peak.momPct}% MoM growth` : ""}.` : "",
    low && low.momPct !== null && low.momPct < 0 ? `${low.month} saw the sharpest drop (${Math.abs(low.momPct)}%) vs the previous month.` : "",
    e.brands[0] ? `${e.brands[0].brand} is the largest business unit at ${pct1(e.brands[0].pct)} of enquiries.` : "",
  ].filter(Boolean);
  const srcShare = (m: (typeof e.months)[number], s: string) => (m.total ? ((m.by[s] ?? 0) / m.total) * 100 : 0);
  const grandBy = (s: string) => e.sourceTotals.find((x) => x.source === s)?.count ?? 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={Users} label="Total Enquiries" value={int(e.grand)} delta={delta(latest.total, prev?.total)} sub="latest vs prev month" onClick={() => monthlyDrill("Total Enquiries")} />
        {top5.map((s, i) => { const Icon = ICONS[i % ICONS.length]; return <Kpi key={s.source} icon={Icon} tone={TONES[i % TONES.length]} label={s.source} value={int(s.count)} sub={`${pct1(s.pct)} Share of Total`} onClick={() => sourceDrill(s.source)} />; })}
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-5" icon={BarChart3} title="Monthly Enquiry Trend (All Channels)" action={<DetailsBtn onClick={() => monthlyDrill("Monthly Enquiry Trend")} />}>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={e.months} margin={{ top: 14, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 9 }} /><YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="left" dataKey="total" name="Total Enquiries" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={30} label={{ position: "top", fontSize: 9, fill: "#475569" }} />
              <Line yAxisId="right" type="monotone" dataKey="momPct" name="MoM Growth %" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>

        <BCard className="lg:col-span-3" icon={PieIcon} title="Channel Wise Enquiry Share (Overall)" action={<DetailsBtn onClick={() => open({ title: "Channel Wise Enquiry Share", xKey: "source", columns: [{ key: "source", label: "Channel", fmt: "text" }, { key: "count", label: "Enquiries" }, { key: "pct", label: "Share", fmt: "pct1" }], rows: e.sourceTotals as unknown as DrawerSpec["rows"], chart: [{ key: "count", label: "Enquiries", color: "#2563eb", type: "bar" }] })} />}>
          <div className="relative mx-auto h-[150px] w-[150px]">
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={donut} dataKey="value" nameKey="label" innerRadius={46} outerRadius={70} paddingAngle={1} stroke="none">{donut.map((c) => <Cell key={c.label} fill={c.color} />)}</Pie><Tooltip contentStyle={TOOLTIP_STYLE} /></PieChart></ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-sm font-extrabold text-slate-800">{int(e.grand)}</p><p className="text-[9px] text-slate-400">Total Enquiries</p></div>
          </div>
          <LegendList items={donut} />
        </BCard>

        <BCard className="lg:col-span-4" icon={TrendingUp} title="Channel Wise Enquiry Trend" action={<DetailsBtn onClick={() => open({ title: "Channel Wise Enquiry Trend", subtitle: "Top five channels", columns: [{ key: "month", label: "Month", fmt: "text" }, ...top5.map((s) => ({ key: s.source, label: s.source }))], rows: trendData, chart: top5.map((s, i) => ({ key: s.source, label: s.source, color: PALETTE[i % PALETTE.length], type: "line" as const })) })} />}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 4, right: 6, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: 10 }} />
              {top5.map((s, i) => <Line key={s.source} type="monotone" dataKey={s.source} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 2 }} />)}
            </LineChart>
          </ResponsiveContainer>
        </BCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-4" icon={Layers} title="Enquiries by Business Unit / Product" action={<DetailsBtn onClick={() => open({ title: "Enquiries by Business Unit / Product", xKey: "brand", columns: [{ key: "brand", label: "Business unit", fmt: "text" }, { key: "count", label: "Enquiries" }, { key: "pct", label: "Share", fmt: "pct1" }], rows: e.brands as unknown as DrawerSpec["rows"], chart: [{ key: "count", label: "Enquiries", color: "#2563eb", type: "bar" }] })} />}>
          <ul className="space-y-1.5">
            {e.brands.slice(0, 8).map((b) => (
              <li key={b.brand} role="button" tabIndex={0} onClick={() => open({ title: b.brand, subtitle: "Business unit", columns: [{ key: "metric", label: "Metric", fmt: "text" }, { key: "value", label: "Value", fmt: "text" }], rows: [{ metric: "Enquiries", value: int(b.count) }, { metric: "Share of all enquiries", value: pct1(b.pct) }] })} className="flex cursor-pointer items-center gap-2 text-[11px] hover:opacity-80">
                <span className="w-44 shrink-0 truncate text-right text-slate-600" title={b.brand}>{b.brand}</span>
                <span className="h-3.5 flex-1 rounded bg-slate-100"><span className="block h-3.5 rounded bg-blue-500" style={{ width: `${Math.max(2, (b.count / maxBrand) * 100)}%` }} /></span>
                <span className="w-24 shrink-0 font-bold text-slate-800">{int(b.count)} <span className="font-medium text-slate-400">({pct1(b.pct)})</span></span>
              </li>
            ))}
          </ul>
        </BCard>

        <BCard className="lg:col-span-4" icon={Award} title="Top 5 Performing Channels (By Enquiries)" action={<DetailsBtn onClick={() => open({ title: "Top 5 Performing Channels", xKey: "source", columns: [{ key: "source", label: "Channel", fmt: "text" }, { key: "count", label: "Enquiries" }, { key: "pct", label: "Share", fmt: "pct1" }], rows: top5 as unknown as DrawerSpec["rows"], chart: [{ key: "count", label: "Enquiries", color: "#2563eb", type: "bar" }] })} />}>
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={barData} margin={{ top: 14, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="source" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" name="Enquiries" radius={[3, 3, 0, 0]} maxBarSize={36} label={{ position: "top", fontSize: 9, fill: "#475569" }}>{barData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>

        <BCard className="lg:col-span-4" icon={Lightbulb} title="Key Insights"><Insights items={insights} /></BCard>
      </div>

      <BCard icon={Table2} title="Month Wise Enquiry Count by Channel" footnote="Click a month for its channel split, or a channel column header for its monthly trend.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-center text-xs">
            <thead>
              <tr>
                <Th className="rounded-l-md text-left">Month</Th>
                {e.sources.map((s) => <Th key={s}><button type="button" onClick={() => sourceDrill(s)} className="font-bold text-white underline-offset-2 hover:underline">{s}</button></Th>)}
                <Th className="bg-[#123a7a]">Grand Total</Th>
                {top5.map((s) => <Th key={s.source} className="bg-[#123a7a]">{s.source} %</Th>)}
              </tr>
            </thead>
            <tbody>
              {e.months.map((m, i) => (
                <tr key={m.month} role="button" tabIndex={0} onClick={() => open({ title: m.month, subtitle: "Channel split", columns: [{ key: "source", label: "Channel", fmt: "text" }, { key: "count", label: "Enquiries" }, { key: "share", label: "Share", fmt: "pct1" }], rows: e.sources.map((s) => ({ source: s, count: m.by[s] ?? 0, share: srcShare(m, s) })), chart: [{ key: "count", label: "Enquiries", color: "#2563eb", type: "bar" }] })} className={`cursor-pointer hover:bg-amber-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                  <td className="px-2 py-1.5 text-left font-semibold text-[#0b2a5b]">{m.month}</td>
                  {e.sources.map((s) => <td key={s} className="px-2 py-1.5">{int(m.by[s] ?? 0)}</td>)}
                  <td className="bg-blue-50 px-2 py-1.5 font-bold">{int(m.total)}</td>
                  {top5.map((s) => <td key={s.source} className="px-2 py-1.5">{pct1(srcShare(m, s.source))}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#0b2a5b] font-bold text-white">
                <td className="px-2 py-1.5 text-left">Grand Total</td>{e.sources.map((s) => <td key={s} className="px-2 py-1.5">{int(grandBy(s))}</td>)}<td className="px-2 py-1.5">{int(e.grand)}</td>
                {top5.map((s) => <td key={s.source} className="px-2 py-1.5">{pct1(s.pct)}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      </BCard>
    </div>
  );
}
