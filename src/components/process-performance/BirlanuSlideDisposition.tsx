import { ComposedChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ReactNode } from "react";
import { BarChart3, PhoneCall, PhoneOff, Link2, XCircle, RefreshCw, Lightbulb, CheckCircle2, PieChart as PieIcon, Table2, Layers } from "lucide-react";
import type { BirlanuMis } from "./birlanuTypes";
import { BCard, DetailsBtn, Empty, Insights, Kpi, LegendList, Th, TOOLTIP_STYLE, PALETTE, int, pct1, type DrawerSpec } from "./BirlanuKit";

/**
 * Slide 3 -- Channel Wise Disposition. Logic = the workbook's "Channel Wise Disposition" sheet:
 * rows registered on/after 1 April of the financial year, counted by Lead Closer Status x Enquiry Source.
 *   Connect group    = closed_with_order, closed_with_dealership, closed_without_order, closed_without_dealership, closed_with_solution,
 *                      underprocess, followup, pending, no_response_from_sales_team, no_response_from_customer, invalid_close, dropped
 *   Not Connect group = no_response, attempted_4 .. attempted_1
 *   Connected % (Connect Rate) = Total Connect / Grand Total; every % in the detail table is a share of Grand Total.
 */

const pretty = (s: string) => s.replace(/_/g, " ");
const CONNECT_COLORS = ["#1e3a8a", "#2563eb", "#0ea5e9", "#f59e0b", "#a855f7", "#ef4444", "#10b981", "#84cc16", "#14b8a6", "#f97316", "#64748b", "#94a3b8"];

export function BirlanuSlideDisposition({ data, open }: { data: BirlanuMis; open: (s: DrawerSpec) => void }) {
  const d = data.disposition;
  if (d.grand === 0) return <Empty />;
  const src = d.sources;
  const cTotal = d.connectTotals.total;
  const nTotal = d.notConnectTotals.total;
  const row = (status: string) => d.connect.find((r) => r.status === status)?.total ?? 0;
  const monthCols = [{ key: "month", label: "Month", fmt: "text" as const }, { key: "total", label: "Grand total" }, { key: "connected", label: "Connected" }, { key: "notConnected", label: "Not connected" }];
  const monthlyDrill = (title: string) => open({
    title, subtitle: "Month-wise (financial year to date)", xKey: "month", columns: monthCols, rows: d.monthly as unknown as DrawerSpec["rows"],
    chart: [{ key: "total", label: "Grand total", color: "#0b2a5b", type: "bar" }, { key: "connected", label: "Connected", color: "#3b82f6", type: "bar" }, { key: "notConnected", label: "Not connected", color: "#f59e0b", type: "bar" }],
  });
  const sourceDrill = (s: string) => open({
    title: `${s} — month-wise`, subtitle: "Leads with a disposition, by register month", xKey: "month",
    columns: [{ key: "month", label: "Month", fmt: "text" }, { key: "count", label: "Leads" }], rows: d.monthly.map((m) => ({ month: m.month, count: m.by[s] ?? 0 })),
    chart: [{ key: "count", label: "Leads", color: "#1d4ed8", type: "bar" }],
  });
  const statusDrill = (status: string, group: "Connect" | "Not Connect") => {
    const r = [...d.connect, ...d.notConnect].find((x) => x.status === status);
    if (!r) return;
    open({
      title: pretty(status), subtitle: `${group} · by channel`, xKey: "source", columns: [{ key: "source", label: "Channel", fmt: "text" }, { key: "count", label: "Leads" }, { key: "share", label: "Share of this status", fmt: "pct1" }],
      rows: src.map((s) => ({ source: s, count: r.by[s] ?? 0, share: r.total ? ((r.by[s] ?? 0) / r.total) * 100 : 0 })), chart: [{ key: "count", label: "Leads", color: "#0b2a5b", type: "bar" }],
    });
  };

  const channelRank = src.map((s) => ({ source: s, count: d.bySourceTotal[s] ?? 0 })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  const maxChannel = channelRank[0]?.count ?? 1;
  const connectDonut = d.connect.filter((r) => r.total > 0).sort((a, b) => b.total - a.total).map((r, i) => ({ label: pretty(r.status), value: r.total, color: CONNECT_COLORS[i % CONNECT_COLORS.length], pct: cTotal ? (r.total / cTotal) * 100 : 0 }));
  const notDonut = d.notConnect.filter((r) => r.total > 0).sort((a, b) => b.total - a.total).map((r, i) => ({ label: pretty(r.status), value: r.total, color: ["#1e3a8a", "#f59e0b", "#2563eb", "#10b981", "#a855f7"][i % 5], pct: nTotal ? (r.total / nTotal) * 100 : 0 }));
  const topSource = channelRank[0];
  const peak = [...d.monthly].sort((a, b) => b.total - a.total)[0];
  const insights = [
    `Total enquiries are ${int(d.grand)} and the connect rate is ${pct1(d.connectRatePct)} (${int(cTotal)} connected).`,
    `Invalid close is ${int(row("invalid_close"))} (${pct1(cTotal ? (row("invalid_close") / cTotal) * 100 : 0)} of connected) and Closed with Solution ${int(row("closed_with_solution"))} (${pct1(cTotal ? (row("closed_with_solution") / cTotal) * 100 : 0)}).`,
    `Follow up is ${int(row("followup"))} (${pct1(cTotal ? (row("followup") / cTotal) * 100 : 0)} of connected).`,
    topSource ? `${topSource.source} contributes ${pct1((topSource.count / d.grand) * 100)} of total volume${channelRank[1] ? `, followed by ${channelRank[1].source} at ${pct1((channelRank[1].count / d.grand) * 100)}` : ""}.` : "",
    notDonut[0] ? `Not connected volume is ${int(nTotal)}, led by ${notDonut[0].label} at ${pct1(notDonut[0].pct)}.` : "",
    peak ? `The highest month is ${peak.month} with ${int(peak.total)} enquiries.` : "",
  ].filter(Boolean);

  // Heat shading per column of the detail table.
  const maxCell = Math.max(1, ...[...d.connect, ...d.notConnect].flatMap((r) => src.map((s) => r.by[s] ?? 0)));
  const shade = (v: number) => (v > 0 ? { backgroundColor: `rgba(37, 99, 235, ${Math.min(0.55, (v / maxCell) * 0.9 + 0.04)})` } : undefined);
  const renderRows = (rows: typeof d.connect, group: "Connect" | "Not Connect", groupCell: ReactNode) => rows.map((r, i) => (
    <tr key={r.status} role="button" tabIndex={0} onClick={() => statusDrill(r.status, group)} onKeyDown={(e) => { if (e.key === "Enter") statusDrill(r.status, group); }} className={`cursor-pointer hover:bg-amber-50 ${i % 2 ? "bg-slate-50/60" : "bg-white"}`}>
      {i === 0 && groupCell}
      <td className="whitespace-nowrap px-2 py-1 text-left text-slate-700">{r.status}</td>
      {src.map((s) => <td key={s} style={shade(r.by[s] ?? 0)} className="px-2 py-1">{int(r.by[s] ?? 0)}</td>)}
      <td className="bg-blue-50 px-2 py-1 font-bold text-slate-800">{int(r.total)}</td>
      <td className="px-2 py-1 font-semibold text-blue-700">{pct1(d.grand ? (r.total / d.grand) * 100 : 0)}</td>
    </tr>
  ));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi icon={BarChart3} label="Grand Total" value={int(d.grand)} onClick={() => monthlyDrill("Grand Total")} />
        <Kpi icon={PhoneCall} tone="#16a34a" label="Connected" value={int(cTotal)} sub={pct1(d.connectRatePct)} onClick={() => monthlyDrill("Connected")} />
        <Kpi icon={PhoneOff} tone="#dc2626" label="Not Connected" value={int(nTotal)} sub={pct1(100 - d.connectRatePct)} onClick={() => monthlyDrill("Not Connected")} />
        <Kpi icon={Link2} tone="#0ea5e9" label="Connect Rate" value={pct1(d.connectRatePct)} onClick={() => monthlyDrill("Connect Rate")} />
        <Kpi icon={XCircle} tone="#ef4444" label="Invalid Close" value={int(row("invalid_close"))} sub={`${pct1(cTotal ? (row("invalid_close") / cTotal) * 100 : 0)} of Connected`} onClick={() => statusDrill("invalid_close", "Connect")} />
        <Kpi icon={RefreshCw} tone="#2563eb" label="Follow Up" value={int(row("followup"))} sub={`${pct1(cTotal ? (row("followup") / cTotal) * 100 : 0)} of Connected`} onClick={() => statusDrill("followup", "Connect")} />
        <Kpi icon={Lightbulb} tone="#f59e0b" label="Closed with Solution" value={int(row("closed_with_solution"))} sub={`${pct1(cTotal ? (row("closed_with_solution") / cTotal) * 100 : 0)} of Connected`} onClick={() => statusDrill("closed_with_solution", "Connect")} />
        <Kpi icon={CheckCircle2} tone="#16a34a" label="Closed with Order" value={int(row("closed_with_order"))} sub={`${pct1(cTotal ? (row("closed_with_order") / cTotal) * 100 : 0)} of Connected`} onClick={() => statusDrill("closed_with_order", "Connect")} />
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-4" icon={BarChart3} title="Monthly Volume Trend" action={<DetailsBtn onClick={() => monthlyDrill("Monthly Volume Trend")} />}>
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={d.monthly} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="total" name="Grand Total" fill="#0b2a5b" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar dataKey="connected" name="Connected" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar dataKey="notConnected" name="Not Connected" fill="#f59e0b" radius={[2, 2, 0, 0]} maxBarSize={14} />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>

        <BCard className="lg:col-span-4" icon={PieIcon} title="Channel Contribution (Overall)" action={<DetailsBtn onClick={() => open({ title: "Channel Contribution", subtitle: "Leads with a disposition, by channel", xKey: "source", columns: [{ key: "source", label: "Channel", fmt: "text" }, { key: "count", label: "Leads" }, { key: "share", label: "Share", fmt: "pct1" }], rows: channelRank.map((c) => ({ source: c.source, count: c.count, share: (c.count / d.grand) * 100 })), chart: [{ key: "count", label: "Leads", color: "#0b2a5b", type: "bar" }] })} />}>
          <ul className="max-h-[230px] space-y-1 overflow-auto pr-1">
            {channelRank.map((c, i) => (
              <li key={c.source} role="button" tabIndex={0} onClick={() => sourceDrill(c.source)} className="flex cursor-pointer items-center gap-2 text-[11px] hover:opacity-80">
                <span className="w-24 shrink-0 truncate text-right text-slate-600">{c.source}</span>
                <span className="h-3.5 flex-1 rounded bg-slate-100"><span className="block h-3.5 rounded" style={{ width: `${Math.max(2, (c.count / maxChannel) * 100)}%`, backgroundColor: PALETTE[i % PALETTE.length] }} /></span>
                <span className="w-24 shrink-0 font-bold text-slate-800">{int(c.count)} <span className="font-medium text-slate-400">({pct1((c.count / d.grand) * 100)})</span></span>
              </li>
            ))}
          </ul>
        </BCard>

        <BCard className="lg:col-span-4" icon={PieIcon} title="Connected Disposition (Overall)" action={<DetailsBtn onClick={() => open({ title: "Connected Disposition", subtitle: "Share of connected leads", xKey: "label", columns: [{ key: "label", label: "Status", fmt: "text" }, { key: "value", label: "Leads" }, { key: "pct", label: "% of connected", fmt: "pct1" }], rows: connectDonut as unknown as DrawerSpec["rows"], chart: [{ key: "value", label: "Leads", color: "#0b2a5b", type: "bar" }] })} />}>
          <div className="flex items-center gap-2">
            <div className="relative h-[150px] w-[150px] shrink-0">
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={connectDonut} dataKey="value" nameKey="label" innerRadius={46} outerRadius={70} stroke="none">{connectDonut.map((c) => <Cell key={c.label} fill={c.color} />)}</Pie><Tooltip contentStyle={TOOLTIP_STYLE} /></PieChart></ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-sm font-extrabold text-slate-800">{int(cTotal)}</p><p className="text-[9px] text-slate-400">Connected</p></div>
            </div>
            <div className="min-w-0 flex-1"><LegendList items={connectDonut.slice(0, 7)} /></div>
          </div>
        </BCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <BCard className="lg:col-span-3" icon={PieIcon} title="Not Connected Disposition (Overall)" action={<DetailsBtn onClick={() => open({ title: "Not Connected Disposition", subtitle: "Share of not-connected leads", xKey: "label", columns: [{ key: "label", label: "Status", fmt: "text" }, { key: "value", label: "Leads" }, { key: "pct", label: "% of not connected", fmt: "pct1" }], rows: notDonut as unknown as DrawerSpec["rows"], chart: [{ key: "value", label: "Leads", color: "#f59e0b", type: "bar" }] })} />}>
          <div className="relative mx-auto h-[140px] w-[140px]">
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={notDonut} dataKey="value" nameKey="label" innerRadius={42} outerRadius={64} stroke="none">{notDonut.map((c) => <Cell key={c.label} fill={c.color} />)}</Pie><Tooltip contentStyle={TOOLTIP_STYLE} /></PieChart></ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-sm font-extrabold text-slate-800">{int(nTotal)}</p><p className="text-[9px] text-slate-400">Not Connected</p></div>
          </div>
          <LegendList items={notDonut} />
        </BCard>

        <BCard className="lg:col-span-6" icon={Table2} title="Monthly Channel Mix (Grand Total)" action={<DetailsBtn onClick={() => monthlyDrill("Monthly Channel Mix")} />}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-center text-xs">
              <thead><tr><Th className="rounded-l-md text-left">Month</Th>{src.map((s) => <Th key={s}>{s}</Th>)}<Th className="rounded-r-md">Grand Total</Th></tr></thead>
              <tbody>
                {d.monthly.map((m, i) => (
                  <tr key={m.month} role="button" tabIndex={0} onClick={() => open({ title: m.month, subtitle: "Channel mix", xKey: "source", columns: [{ key: "source", label: "Channel", fmt: "text" }, { key: "count", label: "Leads" }, { key: "share", label: "Share", fmt: "pct1" }], rows: src.map((s) => ({ source: s, count: m.by[s] ?? 0, share: m.total ? ((m.by[s] ?? 0) / m.total) * 100 : 0 })), chart: [{ key: "count", label: "Leads", color: "#0b2a5b", type: "bar" }] })} className={`cursor-pointer hover:bg-amber-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                    <td className="px-2 py-1 text-left font-semibold text-[#0b2a5b]">{m.month}</td>{src.map((s) => <td key={s} className="px-2 py-1">{int(m.by[s] ?? 0)}</td>)}<td className="bg-blue-50 px-2 py-1 font-bold">{int(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BCard>

        <BCard className="lg:col-span-3" icon={Lightbulb} title="Top Disposition Insights"><Insights items={insights} /></BCard>
      </div>

      <BCard icon={Layers} title="Channel Wise Disposition Detail (Overall)" footnote={`Rows registered on or after ${d.fyStart} (the sheet's financial-year start). Click a status row for its channel split.`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-center text-xs">
            <thead>
              <tr><Th className="rounded-l-md">Group</Th><Th className="text-left">Status</Th>{src.map((s) => <Th key={s}>{s}</Th>)}<Th>Grand Total</Th><Th className="rounded-r-md">Contribution %</Th></tr>
            </thead>
            <tbody>
              {renderRows(d.connect, "Connect", <td rowSpan={d.connect.length + 1} className="bg-emerald-100 px-2 text-center text-[11px] font-extrabold text-emerald-800">Connect<br />({int(cTotal)})</td>)}
              <tr className="bg-amber-100 font-bold"><td className="px-2 py-1 text-left">Total Connect</td>{src.map((s) => <td key={s} className="px-2 py-1">{int(d.connectTotals.by[s] ?? 0)}</td>)}<td className="px-2 py-1">{int(cTotal)}</td><td className="px-2 py-1">{pct1(d.connectRatePct)}</td></tr>
              {renderRows(d.notConnect, "Not Connect", <td rowSpan={d.notConnect.length + 1} className="bg-rose-100 px-2 text-center text-[11px] font-extrabold text-rose-800">Not Connect<br />({int(nTotal)})</td>)}
              <tr className="bg-amber-100 font-bold"><td className="px-2 py-1 text-left">Total Not Connect</td>{src.map((s) => <td key={s} className="px-2 py-1">{int(d.notConnectTotals.by[s] ?? 0)}</td>)}<td className="px-2 py-1">{int(nTotal)}</td><td className="px-2 py-1">{pct1(100 - d.connectRatePct)}</td></tr>
              <tr className="bg-[#0b2a5b] font-bold text-white"><td className="px-2 py-1.5" /><td className="px-2 py-1.5 text-left">Grand Total</td>{src.map((s) => <td key={s} className="px-2 py-1.5">{int(d.bySourceTotal[s] ?? 0)}</td>)}<td className="px-2 py-1.5">{int(d.grand)}</td><td className="px-2 py-1.5">100.0%</td></tr>
            </tbody>
          </table>
        </div>
      </BCard>
    </div>
  );
}

