/** Recharts-backed charts for the Audit Trail panel. Lazy-loaded by the panel so recharts stays out of the main chunk. */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate } from "./auditModel";

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export interface DailyPoint { date: string; total: number; overrides: number }

/** Changes per roster day, with the manual-override share overlaid. Clicking a day drills into that day. */
export function DailyChangesChart({ data, onSelectDay }: { data: DailyPoint[]; onSelectDay?: (date: string) => void }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
        onClick={(e: any) => { const d = e?.activeLabel; if (d && onSelectDay) onSelectDay(String(d)); }}
        style={{ cursor: onSelectDay ? "pointer" : undefined }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tickFormatter={ddmm} tick={{ fontSize: 11 }} minTickGap={16} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip labelFormatter={(l) => fmtDate(String(l))} />
        <Area type="monotone" name="All changes" dataKey="total" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.16} strokeWidth={2} isAnimationActive={false} />
        <Area type="monotone" name="Manual overrides" dataKey="overrides" stroke="hsl(var(--chart-4))" fill="hsl(var(--chart-4))" fillOpacity={0.28} strokeWidth={2} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface TypeBar { code: string; label: string; count: number }

const TYPE_COLOURS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6", "--chart-7", "--chart-8"];

/** Changes by decision type (horizontal bars). Clicking a bar drills into that type. */
export function TypeBarChart({ data, onSelect }: { data: TypeBar[]; onSelect?: (code: string) => void }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} interval={0} />
        <Tooltip formatter={(v: number) => [v.toLocaleString("en-IN"), "Changes"]} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} className={onSelect ? "cursor-pointer" : undefined} onClick={(d: any) => onSelect?.(d.code)} isAnimationActive={false}>
          {data.map((b, i) => <Cell key={b.code} fill={`hsl(var(${TYPE_COLOURS[i % TYPE_COLOURS.length]}))`} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
