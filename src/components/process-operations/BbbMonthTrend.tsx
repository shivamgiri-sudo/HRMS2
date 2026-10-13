import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** One month with Overall Sales or Received Data (backend bbb-months.ts). */
export interface BbbMonth {
  month: string; label: string; from: string; to: string; orders: number; realTimeSales: number; revenue: number; hasReceived: boolean;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Blabli Blu monthly sales (BB-01): KPI cards for the selected month and a trend of every month with data
 * (Aug, Sep, Oct...). Months come from the stored sales date, so a newly imported month appears here on its own.
 * Clicking a month's bar selects it.
 */
export default function BbbMonthTrend({ months, selected, onSelect }: { months: BbbMonth[]; selected: string | null; onSelect: (m: BbbMonth) => void }) {
  if (!months.length) return null;
  const cur = months.find((m) => m.month === selected) ?? null;
  const prev = cur ? months[months.indexOf(cur) - 1] : undefined;
  const delta = cur && prev && prev.realTimeSales > 0 ? (cur.realTimeSales - prev.realTimeSales) / prev.realTimeSales : null;
  return (
    <section aria-labelledby="bbb-monthly" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h3 id="bbb-monthly" className="text-sm font-semibold text-slate-700">Monthly sales</h3>
        <p className="text-[11px] text-slate-400">By sales date. Monthly Sales = every accepted sales record dated in the month.</p>
      </div>
      {cur && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Sales records · {cur.label}</p><p className="text-xl font-bold text-slate-800">{fmt(cur.orders)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Real Time Sales · {cur.label}</p><p className="text-xl font-bold text-slate-800">{fmt(cur.realTimeSales)}</p>
            {delta !== null && <p className={`text-[11px] ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}% vs {prev!.label}</p>}</div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Revenue · {cur.label}</p><p className="text-xl font-bold text-slate-800">{inr(cur.revenue)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Months with data</p><p className="text-xl font-bold text-slate-800">{months.length}</p><p className="text-[11px] text-slate-400">{months[0].label} to {months[months.length - 1].label}</p></div>
        </div>
      )}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={months} onClick={(e) => { const i = e?.activeTooltipIndex; if (typeof i === "number" && months[i]) onSelect(months[i]); }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" fontSize={11} />
            <YAxis yAxisId="n" fontSize={11} />
            <YAxis yAxisId="r" orientation="right" fontSize={11} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number, name: string) => (name === "Revenue" ? inr(v) : fmt(v))} />
            <Legend />
            <Bar yAxisId="n" dataKey="orders" name="Sales records" fill="#cbd5e1" cursor="pointer" />
            <Bar yAxisId="n" dataKey="realTimeSales" name="Real Time Sales" fill="#D4AF37" cursor="pointer" />
            <Line yAxisId="r" dataKey="revenue" name="Revenue" stroke="#1A1A1A" dot />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
