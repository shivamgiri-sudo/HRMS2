import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  cellStatus, formatValue, isPercentUnit, statusOf,
  type DayHealth, type DeckReading, type Status,
} from "./kpi-deck-model";

export const STATUS_COLOR: Record<Status | "missing", string> = {
  pass: "#059669", fail: "#e11d48", none: "#94a3b8", nodata: "#cbd5e1", missing: "#e2e8f0",
};

/** Small trend line with the target drawn as a dashed reference; last point dotted in status colour. */
export function Sparkline({ r, width = 132, height = 34, points = 30 }: { r: DeckReading; width?: number; height?: number; points?: number }) {
  const vals = r.trend.filter((t) => t.value !== null).slice(-points).map((t) => t.value as number);
  if (vals.length < 2) {
    return <span className="text-[11px] text-slate-400" style={{ width }}>{vals.length === 1 ? "1 day of history" : "no history"}</span>;
  }
  const t = r.targetValue;
  const lo = Math.min(...vals, ...(t !== null ? [t] : []));
  const hi = Math.max(...vals, ...(t !== null ? [t] : []));
  const span = hi - lo || 1;
  const pad = 3;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (vals.length - 1);
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - 2 * pad);
  const color = STATUS_COLOR[statusOf(r)];
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(vals.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
  return (
    <svg width={width} height={height} role="img" aria-label={`${r.label} trend, last ${vals.length} readings`}>
      <path d={area} fill={color} opacity={0.08} />
      {t !== null && <line x1={0} x2={width} y1={y(t)} y2={y(t)} stroke="#64748b" strokeWidth={1} strokeDasharray="3 3" />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={3} fill={color} />
    </svg>
  );
}

/** Value-vs-target bar; the black tick is the target. Percentages scale to 100, everything else to 125% of the larger. */
export function Bullet({ r, width = 170 }: { r: DeckReading; width?: number }) {
  if (r.value === null) return <div className="h-1.5 rounded-full bg-slate-100" style={{ width }} />;
  const scale = isPercentUnit(r.unit) ? 100 : Math.max(r.value, r.targetValue ?? 0, 1) * 1.25;
  const fill = Math.max(2, Math.min(100, (r.value / scale) * 100));
  const tick = r.targetValue !== null ? Math.max(0, Math.min(100, (r.targetValue / scale) * 100)) : null;
  return (
    <div className="relative h-2 rounded-full bg-slate-200/80 dark:bg-slate-700" style={{ width }}
      role="img" aria-label={`${r.label} ${formatValue(r.value, r.unit)}${r.targetValue !== null ? `, target ${formatValue(r.targetValue, r.unit)}` : ""}`}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fill}%`, background: STATUS_COLOR[statusOf(r)] }} />
      {tick !== null && <div className="absolute -top-1 h-4 w-0.5 rounded bg-slate-900 dark:bg-slate-100" style={{ left: `calc(${tick}% - 1px)` }} />}
    </div>
  );
}

/** Conic-free SVG ring so it stays crisp and prints. */
export function HealthRing({ pct, size = 104, label }: { pct: number | null; size?: number; label: string }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const v = pct ?? 0;
  const color = pct === null ? "#94a3b8" : pct >= 80 ? "#059669" : pct >= 50 ? "#d97706" : "#e11d48";
  return (
    <svg width={size} height={size} role="img" aria-label={label}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={9} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
        strokeDasharray={`${(c * v) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y={size >= 80 ? "47%" : "52%"} textAnchor="middle" dominantBaseline="middle" fontSize={size >= 80 ? size * 0.27 : size * 0.32} fontWeight={800} fill="currentColor">
        {pct === null ? "—" : pct}
      </text>
      {size >= 80 && <text x="50%" y="70%" textAnchor="middle" fontSize={9.5} fill="#64748b" fontWeight={600}>{pct === null ? "NO TARGETS" : "ON TARGET"}</text>}
    </svg>
  );
}

/** One square per day vs target: how LONG a metric has been off target, which one number cannot say. */
export function HeatStrip({ r, dates }: { r: DeckReading; dates: string[] }) {
  return (
    <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(10px, 1fr))` }}>
      {dates.map((d) => {
        const s = cellStatus(r, d);
        const t = r.trend.find((x) => x.date === d);
        return (
          <div key={d} title={`${d}: ${t?.value != null ? formatValue(t.value, r.unit) : "no reading"}`}
            className="h-6 rounded-[4px]"
            style={s === "missing"
              ? { border: "1px dashed #cbd5e1", background: "transparent" }
              : { background: STATUS_COLOR[s], opacity: s === "none" ? 0.45 : 0.92 }} />
        );
      })}
    </div>
  );
}

/** Share of targeted metrics on target, per day. */
export function HealthTimeline({ data }: { data: DayHealth[] }) {
  if (data.filter((d) => d.pct !== null).length < 2) {
    return <p className="py-6 text-center text-xs text-slate-400">Needs two or more days of targeted readings to draw a timeline.</p>;
  }
  return (
    <div className="h-36 w-full" role="img" aria-label="Share of targeted metrics on target, per day">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id="deckHealthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#059669" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(8)} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} ticks={[0, 50, 80, 100]} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <ReferenceLine y={80} stroke="#64748b" strokeDasharray="4 4" />
          <Tooltip formatter={(v: number, _n: string, p: { payload?: DayHealth }) => [`${v}% (${p.payload?.pass ?? 0} on / ${p.payload?.fail ?? 0} below)`, "On target"]}
            labelFormatter={(l: string) => l} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
          <Area type="monotone" dataKey="pct" stroke="#059669" strokeWidth={2.2} fill="url(#deckHealthFill)" connectNulls dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Large trend for the "needs attention" cards: filled area, dashed target line, labelled last point. */
export function AttentionChart({ r }: { r: DeckReading }) {
  const data = r.trend.filter((t) => t.value !== null).slice(-30).map((t) => ({ date: t.date, value: t.value as number }));
  if (data.length < 2) return <p className="py-8 text-center text-xs text-slate-400">Only {data.length} reading{data.length === 1 ? "" : "s"} so far, no trend yet.</p>;
  const color = STATUS_COLOR[statusOf(r)];
  const gid = `att-${r.metricKey}`;
  // The axis must include the target, otherwise the reference line is clipped off-chart exactly when it matters most.
  const vs = data.map((d) => d.value).concat(r.targetValue !== null ? [r.targetValue] : []);
  const lo = Math.min(...vs), hi = Math.max(...vs), padY = (hi - lo || 1) * 0.12;
  return (
    <div className="h-28 w-full" role="img" aria-label={`${r.label} trend against target`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide /><YAxis hide domain={[lo - padY, hi + padY]} />
          {r.targetValue !== null && <ReferenceLine y={r.targetValue} stroke="#475569" strokeDasharray="4 4" label={{ value: "target", position: "insideTopRight", fontSize: 10, fill: "#475569" }} />}
          <Tooltip formatter={(v: number) => [formatValue(v, r.unit), r.label]} labelFormatter={(l: string) => l} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.2} fill={`url(#${gid})`} dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
