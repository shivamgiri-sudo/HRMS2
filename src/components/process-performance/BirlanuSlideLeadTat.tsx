import { ComposedChart, Bar, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Users, CheckCircle2, Clock, Target, Timer, BarChart3, PieChart as PieIcon, Table2, LineChart as LineIcon, Layers } from "lucide-react";
import type { BirlanuMis } from "./birlanuTypes";
import { BCard, DetailsBtn, Empty, Kpi, LegendList, Th, TOOLTIP_STYLE, delta, int, pct1, ppDelta, type DrawerSpec } from "./BirlanuKit";

/**
 * Slide 4 -- Lead TAT. Logic = the workbook's "Lead TAT" sheet: Outbound leads (Call Type "Outbound") of one LeadRegisterMonth
 * counted by first-response bucket (Data!BY) and Enquiry Source.
 *   Within TAT = buckets "0-30 Min" + "30 Min-2hrs" (the sheet's P = SUM(B:C)); Out of TAT = the twelve buckets from 2hr-4hrs onwards (Q = SUM(D:O)).
 * Median / Average TAT are computed from each lead's first-response time (FRT); the average uses only leads answered within 24 hours,
 * because a few leads with FRT in the thousands of hours would otherwise dominate it.
 */

const fmtHrs = (h: number | null) => (h === null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : `${(Math.round(h * 10) / 10).toFixed(1)} Hrs`);
const short = (b: string) => b.replace("hrs", "h").replace("Hrs", "h").replace(" Min", "m");

export function BirlanuSlideLeadTat({ data, open }: { data: BirlanuMis; open: (s: DrawerSpec) => void }) {
  const t = data.leadTat;
  if (t.totals.total === 0 && t.monthly.every((m) => m.total === 0)) return <Empty text="No Outbound leads with a first-response bucket for the current selection." />;
  const idx = t.monthly.findIndex((m) => m.month === t.month);
  const cur = idx >= 0 ? t.monthly[idx] : undefined;
  const prev = idx > 0 ? t.monthly[idx - 1] : undefined;
  const bucketRows = t.buckets.map((b, i) => ({ bucket: b, count: t.totals.counts[i] ?? 0, share: t.totals.total ? ((t.totals.counts[i] ?? 0) / t.totals.total) * 100 : 0 }));
  const monthlyDrill = (title: string) => open({
    title, subtitle: "Month-wise (Outbound leads by register month)", xKey: "month",
    columns: [{ key: "month", label: "Month", fmt: "text" }, { key: "total", label: "Total leads" }, { key: "within", label: "Within TAT" }, { key: "out", label: "Out of TAT" }, { key: "withinPct", label: "Within TAT %", fmt: "pct1" }],
    rows: t.monthly as unknown as DrawerSpec["rows"],
    chart: [{ key: "within", label: "Within TAT", color: "#16a34a", type: "bar" }, { key: "out", label: "Out of TAT", color: "#f59e0b", type: "bar" }, { key: "withinPct", label: "Within TAT %", color: "#0b2a5b", type: "line", axis: "right" }],
  });
  const bucketDrill = () => open({
    title: `TAT Bucket Distribution — ${t.month}`, subtitle: t.week ? `Week ${t.week}` : "Whole month", xKey: "bucket",
    columns: [{ key: "bucket", label: "Bucket", fmt: "text" }, { key: "count", label: "Leads" }, { key: "share", label: "Share", fmt: "pct1" }], rows: bucketRows as unknown as DrawerSpec["rows"],
    chart: [{ key: "count", label: "Leads", color: "#2563eb", type: "bar" }],
  });
  const sourceDrill = (source: string) => {
    const sp = t.sourcePerformance.find((x) => x.source === source);
    const bs = t.bySource.find((x) => x.source === source);
    open({
      title: `${source} — Lead TAT`, subtitle: t.month, xKey: "month",
      columns: [{ key: "month", label: "Month", fmt: "text" }, { key: "enquiry", label: "Enquiry" }, { key: "connected", label: "Connected" }, { key: "las", label: "LAS" }, { key: "contPct", label: "Cont %", fmt: "pct1" }, { key: "lasPct", label: "LAS %", fmt: "pct1" }],
      rows: (sp?.months ?? []) as unknown as DrawerSpec["rows"], chart: [{ key: "enquiry", label: "Enquiry", color: "#0b2a5b", type: "bar" }, { key: "connected", label: "Connected", color: "#3b82f6", type: "bar" }, { key: "las", label: "LAS", color: "#f59e0b", type: "bar" }],
      note: bs ? `${t.month}: ${int(bs.total)} leads, ${int(bs.within)} within TAT (${pct1(bs.withinPct)}).` : undefined,
    });
  };

  const donut = [{ label: "Within TAT", value: t.totals.within, color: "#16a34a", pct: t.totals.withinPct }, { label: "Out of TAT", value: t.totals.out, color: "#f59e0b", pct: t.totals.total ? 100 - t.totals.withinPct : 0 }];
  const maxCell = Math.max(1, ...t.bySource.flatMap((r) => r.counts));
  const shade = (v: number) => (v > 0 ? { backgroundColor: `rgba(22, 163, 74, ${Math.min(0.6, (v / maxCell) * 0.9 + 0.05)})` } : undefined);
  const months = t.sourcePerformance[0]?.months.map((m) => m.month) ?? [];
  const spTotal = (mi: number) => {
    const rs = t.sourcePerformance.map((r) => r.months[mi]);
    const enquiry = rs.reduce((a, r) => a + r.enquiry, 0), connected = rs.reduce((a, r) => a + r.connected, 0), las = rs.reduce((a, r) => a + r.las, 0);
    return { enquiry, connected, las, contPct: enquiry ? (connected / enquiry) * 100 : 0, lasPct: connected ? (las / connected) * 100 : 0 };
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={Users} label="Total Leads" value={int(t.totals.total)} delta={delta(cur?.total ?? 0, prev?.total)} sub="vs previous month" onClick={() => monthlyDrill("Total Leads")} />
        <Kpi icon={CheckCircle2} tone="#16a34a" label="Within TAT" value={int(t.totals.within)} sub={pct1(t.totals.withinPct)} onClick={() => monthlyDrill("Within TAT")} />
        <Kpi icon={Clock} tone="#ea580c" label="Out of TAT" value={int(t.totals.out)} sub={pct1(t.totals.total ? 100 - t.totals.withinPct : 0)} onClick={() => monthlyDrill("Out of TAT")} />
        <Kpi icon={Target} tone="#2563eb" label="Within TAT %" value={pct1(t.totals.withinPct)} delta={ppDelta(cur?.withinPct ?? 0, prev?.withinPct)} unit="pp" sub="vs previous month" onClick={() => monthlyDrill("Within TAT %")} />
        <Kpi icon={Timer} tone="#f59e0b" label="Median TAT" value={fmtHrs(t.medianHours)} onClick={bucketDrill} />
        <Kpi icon={BarChart3} tone="#7c3aed" label="Avg. TAT (≤ 24 h leads)" value={fmtHrs(t.avgHoursUnder24)} onClick={bucketDrill} />
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-5" icon={BarChart3} title={`TAT Bucket Distribution (${t.week ? `${t.month} · ${t.week}` : `Whole Month · ${t.month}`})`} action={<DetailsBtn onClick={bucketDrill} />}>
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={bucketRows.map((b) => ({ ...b, label: short(b.bucket) }))} margin={{ top: 14, right: 4, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="label" tick={{ fontSize: 8 }} interval={0} angle={-35} textAnchor="end" height={50} /><YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(_, p) => String((p?.[0]?.payload as { bucket?: string })?.bucket ?? "")} />
              <Bar dataKey="count" name="Leads" fill="#2563eb" radius={[3, 3, 0, 0]} maxBarSize={22} label={{ position: "top", fontSize: 8, fill: "#475569" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>

        <BCard className="lg:col-span-3" icon={PieIcon} title="Within TAT vs Out of TAT" action={<DetailsBtn onClick={() => monthlyDrill("Within TAT vs Out of TAT")} />}>
          <div className="relative mx-auto h-[150px] w-[150px]">
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={donut} dataKey="value" nameKey="label" innerRadius={46} outerRadius={70} paddingAngle={2} stroke="none">{donut.map((c) => <Cell key={c.label} fill={c.color} />)}</Pie><Tooltip contentStyle={TOOLTIP_STYLE} /></PieChart></ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-sm font-extrabold text-slate-800">{int(t.totals.total)}</p><p className="text-[9px] text-slate-400">Total Leads</p></div>
          </div>
          <LegendList items={donut} />
        </BCard>

        <BCard className="lg:col-span-4" icon={Layers} title="Source Wise TAT Compliance" action={<DetailsBtn onClick={() => open({ title: "Source Wise TAT Compliance", subtitle: t.month, xKey: "source", columns: [{ key: "source", label: "Source", fmt: "text" }, { key: "total", label: "Leads" }, { key: "within", label: "Within TAT" }, { key: "out", label: "Out of TAT" }, { key: "withinPct", label: "Within TAT %", fmt: "pct1" }], rows: t.bySource as unknown as DrawerSpec["rows"], chart: [{ key: "within", label: "Within TAT", color: "#16a34a", type: "bar" }, { key: "out", label: "Out of TAT", color: "#f59e0b", type: "bar" }] })} />}>
          <ul className="max-h-[210px] space-y-1 overflow-auto pr-1">
            {t.bySource.map((r) => (
              <li key={r.source} role="button" tabIndex={0} onClick={() => sourceDrill(r.source)} className="flex cursor-pointer items-center gap-2 text-[10px] hover:opacity-80">
                <span className="w-24 shrink-0 truncate text-right text-slate-600">{r.source}</span>
                <span className="flex h-4 flex-1 overflow-hidden rounded bg-slate-100">
                  <span className="flex items-center justify-center bg-emerald-600 text-[8px] font-bold text-white" style={{ width: `${r.total ? r.withinPct : 0}%` }}>{r.total && r.withinPct >= 18 ? `${Math.round(r.withinPct)}%` : ""}</span>
                  <span className="flex items-center justify-center bg-amber-500 text-[8px] font-bold text-white" style={{ width: `${r.total ? 100 - r.withinPct : 0}%` }}>{r.total && 100 - r.withinPct >= 18 ? `${Math.round(100 - r.withinPct)}%` : ""}</span>
                </span>
                <span className="w-8 shrink-0 text-right font-bold text-slate-700">{int(r.total)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex justify-center gap-3 text-[10px] text-slate-500"><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-600" />Within TAT</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-500" />Out of TAT</span></div>
        </BCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-5" icon={LineIcon} title="Monthly Trend – Leads & TAT Compliance" action={<DetailsBtn onClick={() => monthlyDrill("Monthly Trend – Leads & TAT Compliance")} />}>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={t.monthly} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 9 }} /><YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="left" dataKey="total" name="Total Leads" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar yAxisId="left" dataKey="within" name="Within TAT" fill="#16a34a" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar yAxisId="left" dataKey="out" name="Out of TAT" fill="#f59e0b" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Line yAxisId="right" type="monotone" dataKey="withinPct" name="Within TAT %" stroke="#0b2a5b" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>

        <BCard className="lg:col-span-7" icon={Table2} title={`TAT Distribution by Source (${t.week ? `${t.month} · ${t.week}` : "Whole Month"})`} footnote="Only Outbound leads that have a first-response bucket are counted. Click a source for its monthly funnel." action={<DetailsBtn onClick={bucketDrill} />}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-center text-[10px]">
              <thead><tr><Th className="rounded-l-md text-left">Source</Th>{t.buckets.map((b) => <Th key={b}>{short(b)}</Th>)}<Th className="bg-emerald-700">Within TAT</Th><Th className="rounded-r-md bg-orange-600">Out of TAT</Th><Th>Total</Th></tr></thead>
              <tbody>
                {t.bySource.map((r, i) => (
                  <tr key={r.source} role="button" tabIndex={0} onClick={() => sourceDrill(r.source)} className={`cursor-pointer hover:bg-amber-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                    <td className="px-2 py-1 text-left font-semibold text-[#0b2a5b]">{r.source}</td>
                    {r.counts.map((c, ci) => <td key={ci} style={shade(c)} className="px-1.5 py-1">{int(c)}</td>)}
                    <td className="bg-emerald-50 px-1.5 py-1 font-bold text-emerald-800">{int(r.within)}</td><td className="bg-orange-50 px-1.5 py-1 font-bold text-orange-700">{int(r.out)}</td><td className="px-1.5 py-1 font-bold">{int(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-[#0b2a5b] font-bold text-white"><td className="px-2 py-1.5 text-left">Total</td>{t.totals.counts.map((c, ci) => <td key={ci} className="px-1.5 py-1.5">{int(c)}</td>)}<td className="px-1.5 py-1.5">{int(t.totals.within)}</td><td className="px-1.5 py-1.5">{int(t.totals.out)}</td><td className="px-1.5 py-1.5">{int(t.totals.total)}</td></tr></tfoot>
            </table>
          </div>
        </BCard>
      </div>

      <BCard icon={Table2} title="Monthly Source Performance" footnote="Enquiry = rows by LeadRegisterMonth; Connected = Calling Status Connect; LAS = connected leads assigned to the sales team; Cont % = Connected / Enquiry; LAS % = LAS / Connected.">
        <div className="overflow-x-auto">
          <table className="w-full text-center text-[10px]" style={{ minWidth: 200 + months.length * 250 }}>
            <thead>
              <tr><Th className="rounded-tl-md text-left" >Source</Th>{months.map((m) => <th key={m} colSpan={5} className="border-l border-white/20 bg-[#0b2a5b] px-2 py-1 text-[11px] font-bold text-white">{m}</th>)}</tr>
              <tr><Th className="rounded-bl-md">{" "}</Th>{months.map((m) => ["Enquiry", "Connected", "LAS", "Cont%", "LAS%"].map((h) => <th key={`${m}-${h}`} className="bg-[#123a7a] px-1.5 py-1 text-[9px] font-semibold text-white">{h}</th>))}</tr>
            </thead>
            <tbody>
              {t.sourcePerformance.map((r, i) => (
                <tr key={r.source} role="button" tabIndex={0} onClick={() => sourceDrill(r.source)} className={`cursor-pointer hover:bg-amber-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                  <td className="whitespace-nowrap px-2 py-1 text-left font-semibold text-[#0b2a5b]">{r.source}</td>
                  {r.months.map((m) => [int(m.enquiry), int(m.connected), int(m.las), m.enquiry ? pct1(m.contPct) : "—", m.connected ? pct1(m.lasPct) : "—"].map((v, k) => <td key={`${m.month}-${k}`} className="px-1.5 py-1">{v}</td>))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-emerald-700 font-bold text-white"><td className="px-2 py-1.5 text-left">Total</td>{months.map((m, mi) => { const x = spTotal(mi); return [int(x.enquiry), int(x.connected), int(x.las), x.enquiry ? pct1(x.contPct) : "—", x.connected ? pct1(x.lasPct) : "—"].map((v, k) => <td key={`${m}-${k}`} className="px-1.5 py-1.5">{v}</td>); })}</tr>
            </tfoot>
          </table>
        </div>
      </BCard>
    </div>
  );
}
