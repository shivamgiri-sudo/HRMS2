import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LeaveRequest } from "@/hooks/useLeaves";
import { buildMonthlyDays, buildTypeTotals } from "./leaveData";
import { leaveTypeChartVar } from "./leaveTheme";

const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;
const TOOLTIP = {
  contentStyle: {
    background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12,
    color: "hsl(var(--popover-foreground))", fontSize: 12,
  },
  cursor: { fill: "hsl(var(--muted))" },
} as const;

/**
 * Approved days this year, by month and by leave type. Colours come from the theme's chart
 * palette (the same token a leave type uses on its card), axes/tooltips from theme variables.
 * A data table below each chart gives screen-reader and no-hover users the same numbers.
 */
export function LeaveCharts({ requests, year }: { requests: LeaveRequest[]; year: number }) {
  const monthly = buildMonthlyDays(requests, year);
  const byType = buildTypeTotals(requests, year);
  const total = monthly.reduce((n, m) => n + m.days, 0);

  if (total === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No approved leave in {year} yet. Your usage charts will appear here.
      </p>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <figure className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <figcaption className="mb-3 text-sm font-semibold text-foreground">Days taken by month, {year}</figcaption>
        <div className="h-56" role="img" aria-label={`Approved leave days by month in ${year}. Total ${total}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...TOOLTIP} formatter={(v: number) => [`${v} day${v === 1 ? "" : "s"}`, "Taken"]} />
              <Bar dataKey="days" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <figcaption className="mb-3 text-sm font-semibold text-foreground">Days taken by type, {year}</figcaption>
        <div className="h-56" role="img" aria-label={`Approved leave days by type in ${year}: ${byType.map((t) => `${t.type} ${t.days}`).join(", ")}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byType} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="type" tick={AXIS} tickLine={false} axisLine={false} width={96} />
              <Tooltip {...TOOLTIP} formatter={(v: number) => [`${v} day${v === 1 ? "" : "s"}`, "Taken"]} />
              <Bar dataKey="days" radius={[0, 6, 6, 0]} maxBarSize={22}>
                {byType.map((t) => <Cell key={t.type} fill={leaveTypeChartVar(t.type)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>Approved days by leave type</caption>
          <thead><tr><th>Type</th><th>Days</th></tr></thead>
          <tbody>{byType.map((t) => <tr key={t.type}><td>{t.type}</td><td>{t.days}</td></tr>)}</tbody>
        </table>
      </figure>
    </div>
  );
}
