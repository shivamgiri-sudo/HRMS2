import { useId } from "react";
import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, LabelList,
} from "recharts";
import { formatShortDate } from "./DashboardKit";

/**
 * Chart primitives shared by the Neemans dashboard's Overview and per-source
 * tabs, so every chart there shares one palette, gradient treatment, tooltip
 * style and empty state instead of each tab hand-rolling its own recharts
 * block.
 */

export const PALETTE = ["#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#14b8a6", "#6366f1", "#ec4899", "#84cc16", "#f97316"];

export const fmtNum = (v: number) => Number(v).toLocaleString("en-IN");
export const fmtPct = (v: number) => `${v}%`;
const compact = (v: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v);

const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 8px 24px rgba(15,23,42,0.08)" } as const;

export function EmptyChart({ height = 200, message = "No data for this period" }: { height?: number; message?: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 text-xs text-slate-400"
      style={{ height }}
    >
      {message}
    </div>
  );
}

export interface TrendSeries {
  key: string;
  name: string;
  kind: "area" | "bar" | "line";
  color: string;
  axis?: "left" | "right";
  format?: (v: number) => string;
}

/** Date-axis combo chart: any mix of gradient areas, gradient bars and lines,
 * each on the left or right axis. */
export function ComboTrend({
  data, series, xKey = "date", height = 240,
}: {
  data: Array<Record<string, string | number>>;
  series: TrendSeries[];
  xKey?: string;
  height?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (data.length === 0) return <EmptyChart height={height} />;

  const hasRight = series.some((s) => s.axis === "right");
  const byName = new Map(series.map((s) => [s.name, s]));
  const axisTick = { fontSize: 10, fill: "#94a3b8" };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 4 : 12, left: -12, bottom: 0 }}>
        <defs>
          {series.filter((s) => s.kind !== "line").map((s) => (
            <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={s.kind === "bar" ? 0.95 : 0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={s.kind === "bar" ? 0.5 : 0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={(v: string) => formatShortDate(String(v))} tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left" tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} />
        {hasRight && <YAxis yAxisId="right" orientation="right" tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} />}
        <Tooltip
          labelFormatter={(v: unknown) => formatShortDate(String(v))}
          formatter={(value: number, name: string) => {
            const fmt = byName.get(name)?.format;
            return fmt ? fmt(Number(value)) : fmtNum(Number(value));
          }}
          contentStyle={TOOLTIP_STYLE}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
        {series.map((s) => {
          const yAxisId = s.axis ?? "left";
          if (s.kind === "bar") {
            return <Bar key={s.key} yAxisId={yAxisId} dataKey={s.key} name={s.name} fill={`url(#${uid}-${s.key})`} radius={[6, 6, 0, 0]} maxBarSize={28} />;
          }
          if (s.kind === "area") {
            return <Area key={s.key} yAxisId={yAxisId} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.5} fill={`url(#${uid}-${s.key})`} />;
          }
          return <Line key={s.key} yAxisId={yAxisId} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.5} dot={{ r: 2.5, strokeWidth: 0, fill: s.color }} activeDot={{ r: 4 }} />;
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Donut with a centre total and a colour-keyed legend (name, value, share). */
export function Donut({
  data, height = 190, centerLabel, centerValue, valueFormat = fmtNum, colors = PALETTE,
}: {
  data: Array<{ name: string; value: number }>;
  height?: number;
  centerLabel?: string;
  centerValue?: string;
  valueFormat?: (v: number) => string;
  colors?: string[];
}) {
  const rows = data.filter((d) => d.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return <EmptyChart height={height} />;

  return (
    <div>
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={3} cornerRadius={6} stroke="none">
              {rows.map((r, i) => <Cell key={r.name} fill={colors[i % colors.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => valueFormat(Number(v))} contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        {centerValue && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold leading-tight text-slate-800">{centerValue}</span>
            {centerLabel && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {rows.slice(0, 8).map((r, i) => (
          <li key={r.name} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
              <span className="truncate font-medium text-slate-600">{r.name}</span>
            </span>
            <span className="shrink-0 text-slate-500">
              {valueFormat(r.value)} <span className="font-semibold text-slate-700">· {Math.round((r.value / total) * 1000) / 10}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal ranked bars, one colour per row, value label at the bar end. */
export function RankBars({
  data, valueFormat = fmtNum, colors = PALETTE, maxRows = 8,
}: {
  data: Array<{ name: string; value: number }>;
  valueFormat?: (v: number) => string;
  colors?: string[];
  maxRows?: number;
}) {
  const rows = data.filter((d) => d.value > 0).slice(0, maxRows);
  if (rows.length === 0) return <EmptyChart height={160} />;
  const height = Math.max(150, rows.length * 32 + 12);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 64, left: 4, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category" dataKey="name" width={112} axisLine={false} tickLine={false}
          tick={{ fontSize: 10, fill: "#64748b" }}
          tickFormatter={(v: string) => (v.length > 17 ? `${v.slice(0, 16)}…` : v)}
        />
        <Tooltip formatter={(v: number) => valueFormat(Number(v))} cursor={{ fill: "rgba(148,163,184,0.08)" }} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={16}>
          {rows.map((r, i) => <Cell key={r.name} fill={colors[i % colors.length]} />)}
          <LabelList dataKey="value" position="right" formatter={(v: unknown) => valueFormat(Number(v))} style={{ fontSize: 10, fill: "#475569", fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Circular progress ring for a 0-100 metric; `null` renders an empty ring. */
export function RingGauge({
  value, label, color, sub,
}: { value: number | null; label: string; color: string; sub?: string }) {
  const size = 96;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-base font-bold" style={{ color }}>
          {value === null ? "—" : `${value}%`}
        </div>
      </div>
      <p className="text-center text-[11px] font-semibold leading-tight text-slate-600">{label}</p>
      {sub && <p className="text-center text-[10px] leading-tight text-slate-400">{sub}</p>}
    </div>
  );
}
