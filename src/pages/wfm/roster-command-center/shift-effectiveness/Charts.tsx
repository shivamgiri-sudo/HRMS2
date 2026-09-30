/** Recharts bundle for the Shift Effectiveness panel. Import lazily (see lazyCharts.tsx) so recharts stays off the initial load. */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { THRESH, fmtDate, fmtPct, type ShiftRow } from "./types";

const C1 = "hsl(var(--chart-1))";
const C2 = "hsl(var(--chart-2))";
const C4 = "hsl(var(--chart-4))";
const C8 = "hsl(var(--chart-8))";
const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const tipStyle = { borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 };
const shortDate = (d: string) => fmtDate(d).slice(0, 5);

export interface TrendPoint { date: string; adherencePct: number | null; onTimePct?: number | null }

export function AdherenceTrendChart({ data, showOnTime = false }: { data: TrendPoint[]; showOnTime?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="adhFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C1} stopOpacity={0.3} />
            <stop offset="100%" stopColor={C1} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} minTickGap={24} />
        <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={44} />
        <Tooltip contentStyle={tipStyle} labelFormatter={(d) => fmtDate(String(d))} formatter={(v: number, n) => [fmtPct(v), n]} />
        <ReferenceLine y={THRESH.adherence.good} stroke={C2} strokeDasharray="4 4" />
        <ReferenceLine y={THRESH.adherence.warn} stroke={C8} strokeDasharray="4 4" />
        <Area type="monotone" dataKey="adherencePct" name="Adherence" stroke={C1} strokeWidth={2} fill="url(#adhFill)" connectNulls={false} isAnimationActive={false} />
        {showOnTime && <Line type="monotone" dataKey="onTimePct" name="On-time" stroke={C4} strokeWidth={2} dot={false} isAnimationActive={false} />}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ShiftComparisonChart({ shifts, onSelect }: { shifts: ShiftRow[]; onSelect: (shiftId: string) => void }) {
  const data = shifts.map((s) => ({
    shiftId: s.shiftId,
    name: s.shiftName.length > 14 ? `${s.shiftName.slice(0, 13)}…` : s.shiftName,
    Adherence: s.metrics.adherencePct,
    "On-time": s.metrics.onTimePct,
    "Break compliance": s.metrics.breakCompliancePct,
  }));
  const pick = (d: { shiftId?: string } | undefined) => d?.shiftId && onSelect(d.shiftId);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} interval={0} />
        <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={44} />
        <Tooltip contentStyle={tipStyle} formatter={(v: number | null, n) => [fmtPct(v), n]} cursor={{ fill: "hsl(var(--muted))" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Adherence" fill={C1} radius={[3, 3, 0, 0]} className="cursor-pointer" isAnimationActive={false} onClick={pick} />
        <Bar dataKey="On-time" fill={C4} radius={[3, 3, 0, 0]} className="cursor-pointer" isAnimationActive={false} onClick={pick} />
        <Bar dataKey="Break compliance" fill={C2} radius={[3, 3, 0, 0]} className="cursor-pointer" isAnimationActive={false} onClick={pick} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BreakBarChart({ rows, onSelect }: { rows: Array<{ id: string; name: string; compliancePct: number | null }>; onSelect?: (id: string) => void }) {
  const data = rows.map((r) => ({ ...r, label: r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name, Compliance: r.compliancePct }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} interval={0} />
        <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={44} />
        <Tooltip contentStyle={tipStyle} formatter={(v: number | null) => [fmtPct(v), "Break compliance"]} cursor={{ fill: "hsl(var(--muted))" }} />
        <ReferenceLine y={THRESH.breaks.good} stroke={C2} strokeDasharray="4 4" />
        <Bar dataKey="Compliance" fill={C2} radius={[3, 3, 0, 0]} className={onSelect ? "cursor-pointer" : undefined} isAnimationActive={false} onClick={(d: { id?: string }) => d?.id && onSelect?.(d.id)} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BreakTrendChart({ data }: { data: Array<{ date: string; compliancePct: number | null }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} minTickGap={24} />
        <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={44} />
        <Tooltip contentStyle={tipStyle} labelFormatter={(d) => fmtDate(String(d))} formatter={(v: number | null) => [fmtPct(v), "Break compliance"]} />
        <ReferenceLine y={THRESH.breaks.good} stroke={C2} strokeDasharray="4 4" />
        <Line type="monotone" dataKey="compliancePct" stroke={C2} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DailyBreakChart({ days }: { days: Array<{ date: string; totalBreakMinutes: number; budgetMinutes: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={days} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} minTickGap={16} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} unit="m" />
        <Tooltip contentStyle={tipStyle} labelFormatter={(d) => fmtDate(String(d))} formatter={(v: number, n) => [`${v} min`, n]} />
        <Bar dataKey="totalBreakMinutes" name="Break minutes" fill={C1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Line type="stepAfter" dataKey="budgetMinutes" name="Allowance" stroke={C8} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
