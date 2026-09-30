import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function AttendanceTrend({ data }: { data: Array<{ label: string; pct: number | null }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} unit="%" />
        <Tooltip formatter={(v: number) => [v === null ? "No data" : `${v}%`, "Attendance"]} labelFormatter={(l) => `Week of ${l}`} />
        <Line type="monotone" dataKey="pct" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
