/** Recharts bundle for the Analytics panel — loaded lazily via named exports (see AnalyticsPanel). */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate, formatINR, fmtPeriod } from "./calc";

const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;
const grid = "hsl(var(--border))";
const C = (n: number) => `hsl(var(--chart-${n}))`;
const RISK = "hsl(var(--destructive))";

/** Shrinkage % per day vs budget; click a bar to drill into that day. */
export function DayBars({ data, budget, onDay }: { data: Array<{ day: string; date?: string; shrinkagePct: number; isHighRisk: boolean }>; budget: number; onDay: (d: { date?: string; day: string }) => void }) {
  const rows = data.map((d) => ({ ...d, label: d.day.slice(0, 3) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 20, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} />
        <YAxis unit="%" tick={axis} tickLine={false} axisLine={false} />
        <Tooltip formatter={(v: number) => [`${v}%`, "Shrinkage"]} labelFormatter={(_, p) => (p?.[0]?.payload?.date ? `${p[0].payload.day} ${fmtDate(p[0].payload.date)}` : "")} />
        <ReferenceLine y={budget} stroke={C(3)} strokeDasharray="4 4" label={{ value: `Budget ${budget}%`, fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "insideTopRight" }} />
        <Bar dataKey="shrinkagePct" name="Shrinkage" radius={[3, 3, 0, 0]} cursor="pointer" isAnimationActive={false}
          label={{ position: "top", fontSize: 10, formatter: (v: number) => `${v}%` }}
          onClick={(d: { date?: string; day: string }) => d && onDay(d)}>
          {rows.map((r) => <Cell key={r.day} fill={r.isHighRisk ? RISK : C(1)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal breakdown bars (category chart); click to drill into a category. */
export function HBars({ data, unit = "", onPick }: { data: Array<{ key: string; label: string; value: number; color?: number | "risk" }>; unit?: string; onPick: (key: string, label: string) => void }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
        <XAxis type="number" tick={axis} tickLine={false} unit={unit} />
        <YAxis type="category" dataKey="label" tick={axis} tickLine={false} width={120} />
        <Tooltip formatter={(v: number) => [unit === "₹" ? formatINR(v) : `${v}${unit}`, ""]} />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} cursor="pointer" isAnimationActive={false}
          label={{ position: "right", fontSize: 11, formatter: (v: number) => (unit === "₹" ? formatINR(v) : `${v}${unit}`) }}
          onClick={(d: { key: string; label: string }) => d && onPick(d.key, d.label)}>
          {data.map((d, i) => <Cell key={d.key} fill={d.color === "risk" ? RISK : C(d.color ?? (i % 8) + 1)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Avg quality by adherence band (columns), click to open the correlation drawer. */
export function SegmentBars({ data, onPick }: { data: Array<{ label: string; count: number; avgQuality: number }>; onPick: (label: string) => void }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} />
        <YAxis domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip formatter={(v: number, _n, p) => [`${v} (${p?.payload?.count ?? 0} employees)`, "Avg quality"]} />
        <Bar dataKey="avgQuality" fill={C(2)} radius={[3, 3, 0, 0]} cursor="pointer" isAnimationActive={false}
          label={{ position: "top", fontSize: 11 }} onClick={(d: { label: string }) => d && onPick(d.label)} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Predicted absence % per forecast day; click a bar to open that day's history. */
export function ForecastBars({ data, base, onDay }: { data: Array<{ date: string; day: string; predictedPct: number; risk: boolean }>; base: number; onDay: (date: string) => void }) {
  const rows = data.map((d) => ({ ...d, label: d.day.slice(0, 3) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} />
        <YAxis unit="%" tick={axis} tickLine={false} axisLine={false} />
        <Tooltip formatter={(v: number) => [`${v}%`, "Predicted"]} labelFormatter={(_, p) => (p?.[0]?.payload?.date ? fmtDate(p[0].payload.date) : "")} />
        <ReferenceLine y={base} stroke={C(3)} strokeDasharray="4 4" label={{ value: "Baseline", fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "insideTopRight" }} />
        <Bar dataKey="predictedPct" radius={[3, 3, 0, 0]} cursor="pointer" isAnimationActive={false}
          label={{ position: "top", fontSize: 10, formatter: (v: number) => `${v}%` }} onClick={(d: { date: string }) => d && onDay(d.date)}>
          {rows.map((r) => <Cell key={r.date} fill={r.risk ? RISK : C(1)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Generic entity trend (area or line) used inside drawers. `x` is formatted by kind. */
export function TrendChart({ data, xKey, yKey, name, unit = "", xKind = "text" }: { data: Array<Record<string, string | number>>; xKey: string; yKey: string; name: string; unit?: string; xKind?: "date" | "period" | "text" }) {
  const fx = (v: string) => (xKind === "date" ? fmtDate(v).slice(0, 5) : xKind === "period" ? fmtPeriod(v) : v);
  const Chart = data.length > 2 ? AreaChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Chart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey={xKey} tick={axis} tickLine={false} tickFormatter={fx} />
        <YAxis unit={unit} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip formatter={(v: number) => [unit === "₹" ? formatINR(v) : `${v}${unit}`, name]} labelFormatter={fx} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {data.length > 2
          ? <Area type="monotone" dataKey={yKey} name={name} stroke={C(1)} fill={C(1)} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
          : <Line type="monotone" dataKey={yKey} name={name} stroke={C(1)} strokeWidth={2} dot isAnimationActive={false} />}
      </Chart>
    </ResponsiveContainer>
  );
}
