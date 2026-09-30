/** Recharts-backed charts for Live Monitoring. Default export is lazy-loaded by the panel. */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendPoint { date: string; shrinkagePct: number; planned: number; present: number }

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function ShrinkageTrendChart({ data, target }: { data: TrendPoint[]; target?: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tickFormatter={ddmm} tick={{ fontSize: 11 }} />
        <YAxis unit="%" tick={{ fontSize: 11 }} domain={[0, (max: number) => Math.max(20, Math.ceil(max / 10) * 10)]} />
        <Tooltip
          labelFormatter={(l) => `${String(l).slice(8, 10)}/${String(l).slice(5, 7)}/${String(l).slice(0, 4)}`}
          formatter={(v: number, _n, p) => [`${v}% (${p.payload.present}/${p.payload.planned} present)`, "Shrinkage"]}
        />
        {target !== undefined && <ReferenceLine y={target} stroke="hsl(var(--chart-4))" strokeDasharray="4 4" label={{ value: `Target ${target}%`, fontSize: 10, position: "insideTopRight" }} />}
        <Area type="monotone" dataKey="shrinkagePct" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.18} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface MixSlice { key: string; name: string; value: number; color: string }

/** Donut of today's attendance mix; slices are clickable (drill to the matching list). */
export function AttendanceMixDonut({ data, onSelect }: { data: MixSlice[]; onSelect?: (key: string) => void }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={2} onClick={(d: any) => onSelect?.(d.key)} className="cursor-pointer">
          {data.map((s) => <Cell key={s.key} fill={s.color} />)}
        </Pie>
        <Tooltip formatter={(v: number, n: string) => [v, n]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export interface BranchBar { name: string; shrinkagePct: number; planned: number }

export function ShrinkageByBranchBar({ data, target }: { data: BranchBar[]; target: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" unit="%" tick={{ fontSize: 11 }} domain={[0, (m: number) => Math.max(20, Math.ceil(m / 10) * 10)]} />
        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number, _n, p) => [`${v}% of ${p.payload.planned} planned`, "Shrinkage"]} />
        <ReferenceLine x={target} stroke="hsl(var(--chart-4))" strokeDasharray="4 4" />
        <Bar dataKey="shrinkagePct" radius={[0, 4, 4, 0]}>
          {data.map((b) => <Cell key={b.name} fill={b.shrinkagePct > target * 2 ? "hsl(var(--chart-8))" : b.shrinkagePct > target ? "hsl(var(--chart-4))" : "hsl(var(--chart-2))"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default { ShrinkageTrendChart, AttendanceMixDonut, ShrinkageByBranchBar };
