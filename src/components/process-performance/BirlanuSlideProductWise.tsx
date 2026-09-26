import { ComposedChart, Bar, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Users, UserCheck, Filter, Percent, IndianRupee, Home, BarChart3, LineChart as LineIcon, PieChart as PieIcon } from "lucide-react";
import type { BirlanuMis, ProdCell, ProdTable } from "./birlanuTypes";
import { BCard, DetailsBtn, Empty, Kpi, LegendList, TOOLTIP_STYLE, PALETTE, crore, delta, inr, int, pct1, ppDelta, type DrawerCol, type DrawerSpec } from "./BirlanuKit";

/**
 * Slide 6 -- Product wise & Source wise. Logic = the workbook's "Product Wise&Source -Revenue" sheet, by Brand (Data!AD):
 *   Enquiries = rows by LeadRegisterMonth; Leads (LAS) = Sub Calling Status "Valid" AND Sub Sub Calling Status "Lead assign to Sales team";
 *   Conversions = closed_with_order + closed_with_dealership; Conv % = Conversions / Leads (LAS); Revenue = Sale INR of the conversions.
 *   Table 1 groups conversions and revenue by LeadRegisterMonth, table 2 ("As per Lead Closer Month") by LeadCloserMonth; enquiries and leads are by register month in both.
 */

const MONTH_TINTS = ["bg-blue-100", "bg-orange-100", "bg-sky-100", "bg-yellow-100", "bg-green-100", "bg-violet-100", "bg-pink-100", "bg-teal-100", "bg-rose-100", "bg-lime-100", "bg-indigo-100", "bg-amber-100"];
const CELL_COLS: DrawerCol[] = [
  { key: "enquiries", label: "Enquiries" }, { key: "leads", label: "Leads (LAS)" }, { key: "conversions", label: "Conversions" }, { key: "convPct", label: "Conv %", fmt: "pct1" }, { key: "revenue", label: "Revenue", fmt: "inr" },
];

function ProductTable({ table, months, title, onRow }: { table: ProdTable; months: string[]; title: string; onRow: (brand: string, cells: ProdCell[], overall: ProdCell) => void }) {
  const order = months.map((_, i) => months.length - 1 - i); // newest month first, like the reference layout
  const cells = (c: ProdCell, bold = false) => [int(c.enquiries), int(c.leads), int(c.conversions), pct1(c.convPct), inr(c.revenue)].map((v, k) => (
    <td key={k} className={`whitespace-nowrap px-1.5 py-1 ${bold ? "font-bold" : ""} ${k === 4 ? "text-emerald-800" : ""}`}>{v}</td>
  ));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-center text-[10px]" style={{ minWidth: 240 + (months.length + 1) * 330 }}>
        <thead>
          <tr>
            <th rowSpan={2} className="rounded-tl-md bg-[#0b2a5b] px-2 py-1.5 text-left text-[10px] font-bold text-white">Product</th>
            <th colSpan={5} className="bg-orange-200 px-2 py-1 text-[11px] font-extrabold text-slate-800">Overall</th>
            {order.map((mi) => <th key={mi} colSpan={5} className={`border-l border-white px-2 py-1 text-[11px] font-extrabold text-slate-800 ${MONTH_TINTS[mi % MONTH_TINTS.length]}`}>{months[mi]}</th>)}
          </tr>
          <tr>
            {["Enquiries", "Leads (LAS)", "Conversions", "Conv %", "Revenue (₹)"].map((h) => <th key={`o-${h}`} className="bg-orange-50 px-1.5 py-1 text-[9px] font-semibold text-slate-700">{h}</th>)}
            {order.map((mi) => ["Enq", "Leads", "Conv", "Conv %", "Revenue (₹)"].map((h) => <th key={`${mi}-${h}`} className={`px-1.5 py-1 text-[9px] font-semibold text-slate-700 ${MONTH_TINTS[mi % MONTH_TINTS.length]} bg-opacity-50`}>{h}</th>))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={r.brand} role="button" tabIndex={0} onClick={() => onRow(r.brand, r.months, r.overall)} onKeyDown={(e) => { if (e.key === "Enter") onRow(r.brand, r.months, r.overall); }} className={`cursor-pointer hover:bg-amber-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
              <td className="whitespace-nowrap px-2 py-1 text-left font-semibold text-[#0b2a5b]"><span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />{r.brand}</td>
              {cells(r.overall, true)}
              {order.map((mi) => cells(r.months[mi]))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#0b2a5b] text-white">
            <td className="px-2 py-1.5 text-left font-bold">Grand Total</td>
            {[table.total.overall, ...order.map((mi) => table.total.months[mi])].map((c, ci) => [int(c.enquiries), int(c.leads), int(c.conversions), pct1(c.convPct), inr(c.revenue)].map((v, k) => <td key={`${ci}-${k}`} className="whitespace-nowrap px-1.5 py-1.5 font-bold">{v}</td>))}
          </tr>
        </tfoot>
      </table>
      <p className="mt-1 text-[10px] text-slate-400">{title}</p>
    </div>
  );
}

export function BirlanuSlideProductWise({ data, open }: { data: BirlanuMis; open: (s: DrawerSpec) => void }) {
  const p = data.productWise;
  const reg = p.byRegister;
  if (p.months.length === 0 || reg.total.overall.enquiries === 0) return <Empty />;
  const li = p.months.length - 1;
  const cur = reg.total.months[li];
  const prev = li > 0 ? reg.total.months[li - 1] : undefined;
  const t = reg.total.overall;
  const monthRows = p.months.map((m, i) => ({ month: m, ...reg.total.months[i] }));
  const monthlyDrill = (title: string) => open({
    title, subtitle: "Month-wise, all products (by LeadRegisterMonth)", columns: [{ key: "month", label: "Month", fmt: "text" }, ...CELL_COLS], rows: monthRows as unknown as DrawerSpec["rows"],
    chart: [{ key: "enquiries", label: "Enquiries", color: "#3b82f6", type: "bar" }, { key: "conversions", label: "Conversions", color: "#f59e0b", type: "bar" }, { key: "convPct", label: "Conv %", color: "#16a34a", type: "line", axis: "right" }],
  });
  const rowDrill = (brand: string, cells: ProdCell[], overall: ProdCell, basis: string) => open({
    title: brand, subtitle: `Month-wise · ${basis}`, columns: [{ key: "month", label: "Month", fmt: "text" }, ...CELL_COLS],
    rows: [...p.months.map((m, i) => ({ month: m, ...cells[i] })), { month: "Overall", ...overall }] as unknown as DrawerSpec["rows"],
    chart: [{ key: "enquiries", label: "Enquiries", color: "#3b82f6", type: "bar" }, { key: "conversions", label: "Conversions", color: "#f59e0b", type: "bar" }, { key: "convPct", label: "Conv %", color: "#16a34a", type: "line", axis: "right" }],
  });
  const shareRows = (key: "enquiries" | "revenue") => {
    const total = reg.rows.reduce((a, r) => a + r.overall[key], 0);
    return reg.rows.map((r, i) => ({ label: r.brand, value: r.overall[key], color: PALETTE[i % PALETTE.length], pct: total ? (r.overall[key] / total) * 100 : 0 })).filter((r) => r.value > 0);
  };
  const enqShare = shareRows("enquiries");
  const revShare = shareRows("revenue");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Kpi icon={Users} label="Total Enquiries" value={int(t.enquiries)} delta={delta(cur.enquiries, prev?.enquiries)} sub="latest vs prev month" onClick={() => monthlyDrill("Total Enquiries")} />
        <Kpi icon={UserCheck} tone="#16a34a" label="Total Leads (LAS)" value={int(t.leads)} delta={delta(cur.leads, prev?.leads)} sub="latest vs prev month" onClick={() => monthlyDrill("Total Leads (LAS)")} />
        <Kpi icon={Filter} tone="#dc2626" label="Conversions" value={int(t.conversions)} delta={delta(cur.conversions, prev?.conversions)} sub="latest vs prev month" onClick={() => monthlyDrill("Conversions")} />
        <Kpi icon={Percent} tone="#0ea5e9" label="Conversion %" value={pct1(t.convPct)} delta={ppDelta(cur.convPct, prev?.convPct)} unit="pp" sub="conversions / LAS" onClick={() => monthlyDrill("Conversion %")} />
        <Kpi icon={IndianRupee} tone="#f97316" label="Revenue" value={crore(t.revenue)} delta={delta(cur.revenue, prev?.revenue)} sub="latest vs prev month" onClick={() => monthlyDrill("Revenue")} />
      </div>

      <BCard icon={Home} title="Overall Performance – Product Wise (Whole Period)" footnote="As per Lead Register Month: conversions and revenue are counted in the month the lead was registered. Click a product for its month-wise record."
        action={<DetailsBtn onClick={() => monthlyDrill("Overall Performance – Product Wise")} />}>
        <ProductTable table={reg} months={p.months} title="" onRow={(b, c, o) => rowDrill(b, c, o, "as per lead register month")} />
      </BCard>

      <BCard icon={Home} title="As Per Lead Closer Month – Product Wise" footnote="Conversions and revenue are counted in the month the lead was closed; enquiries and leads stay in the register month, as in the source sheet."
        action={<DetailsBtn onClick={() => open({ title: "As Per Lead Closer Month", subtitle: "Month-wise, all products (by LeadCloserMonth)", columns: [{ key: "month", label: "Month", fmt: "text" }, ...CELL_COLS], rows: p.months.map((m, i) => ({ month: m, ...p.byCloser.total.months[i] })) as unknown as DrawerSpec["rows"], chart: [{ key: "conversions", label: "Conversions", color: "#f59e0b", type: "bar" }, { key: "convPct", label: "Conv %", color: "#16a34a", type: "line", axis: "right" }] })} />}>
        <ProductTable table={p.byCloser} months={p.months} title="" onRow={(b, c, o) => rowDrill(b, c, o, "as per lead closer month")} />
      </BCard>

      <div className="grid gap-3 lg:grid-cols-4">
        <BCard icon={BarChart3} title="Total Enquiries Trend (All Products)" action={<DetailsBtn onClick={() => monthlyDrill("Total Enquiries Trend")} />}>
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={monthRows} margin={{ top: 14, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="enquiries" name="Enquiries" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={28} label={{ position: "top", fontSize: 9, fill: "#475569" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>

        <BCard icon={LineIcon} title="Conversions & Conversion % Trend" action={<DetailsBtn onClick={() => monthlyDrill("Conversions & Conversion % Trend")} />}>
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={monthRows} margin={{ top: 14, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 9 }} /><YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="left" dataKey="conversions" name="Conversions" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={24} />
              <Line yAxisId="right" type="monotone" dataKey="convPct" name="Conversion %" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </BCard>

        {([["Enquiry Share by Product (Overall)", enqShare, int(t.enquiries), "Total Enquiries", "enquiries"], ["Revenue Share by Product (Overall)", revShare, crore(t.revenue), "Total Revenue", "revenue"]] as const).map(([title, items, centre, centreLabel, key]) => (
          <BCard key={title} icon={PieIcon} title={title} action={<DetailsBtn onClick={() => open({ title, subtitle: "By product", xKey: "label", columns: [{ key: "label", label: "Product", fmt: "text" }, { key: "value", label: key === "revenue" ? "Revenue" : "Enquiries", fmt: key === "revenue" ? "inr" : "int" }, { key: "pct", label: "Share", fmt: "pct1" }], rows: items as unknown as DrawerSpec["rows"], chart: [{ key: "value", label: key === "revenue" ? "Revenue" : "Enquiries", color: "#0b2a5b", type: "bar" }] })} />}>
            <div className="relative mx-auto h-[130px] w-[130px]">
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={items as unknown as object[]} dataKey="value" nameKey="label" innerRadius={40} outerRadius={60} stroke="none">{items.map((c) => <Cell key={c.label} fill={c.color} />)}</Pie><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => (key === "revenue" ? inr(v) : int(v))} /></PieChart></ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2 text-center"><p className="text-[11px] font-extrabold leading-tight text-slate-800">{centre}</p><p className="text-[8px] text-slate-400">{centreLabel}</p></div>
            </div>
            <div className="mt-1 max-h-[80px] overflow-auto"><LegendList items={items.map((i) => ({ ...i, value: key === "revenue" ? Math.round(i.value / 1e5) : i.value }))} /></div>
            {key === "revenue" && <p className="mt-0.5 text-[9px] text-slate-400">Legend values in ₹ lakh.</p>}
          </BCard>
        ))}
      </div>
    </div>
  );
}
