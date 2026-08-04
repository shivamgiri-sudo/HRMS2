import type { ReactNode } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface HeroTile {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}

export interface ChartPoint {
  name: string;
  value: number | null;
}

const TONE_TEXT: Record<NonNullable<HeroTile["tone"]>, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  neutral: "text-slate-900 dark:text-slate-100",
};

const MAX_BARS = 14;

/**
 * Hero KPI strip + a single-metric comparison bar chart for the current drill level.
 *
 * One hue throughout (sequential, per dataviz form rules — this is one series comparing
 * magnitude across categories, not identity, so color never varies by bar/rank). No legend:
 * a single series is named by the chart title, not a legend box. Skipped entirely below 2
 * points — a "chart" of one bar has no comparison to show and reads as a rendering bug.
 */
export function DashboardLevelSummary({
  title,
  subtitle,
  heroTiles,
  chartData,
  chartTitle,
  chartValueSuffix = "",
}: {
  title: string;
  subtitle?: ReactNode;
  heroTiles: HeroTile[];
  chartData: ChartPoint[];
  chartTitle: string;
  chartValueSuffix?: string;
}) {
  const plottable = chartData.filter((d) => d.value !== null) as Array<{ name: string; value: number }>;
  const truncated = plottable.length > MAX_BARS;
  const shown = truncated
    ? [...plottable].sort((a, b) => b.value - a.value).slice(0, MAX_BARS)
    : plottable;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {heroTiles.map((tile) => (
          <Card key={tile.label} className="rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {tile.label}
              </p>
              <p className={cn("mt-1 text-xl font-black sm:text-2xl", tile.tone ? TONE_TEXT[tile.tone] : TONE_TEXT.neutral)}>
                {tile.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {shown.length >= 2 && (
        <Card className="rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {chartTitle}
              {truncated && (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  top {MAX_BARS} of {plottable.length}
                </span>
              )}
            </p>
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={shown} margin={{ top: 4, right: 8, left: -12, bottom: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
                  <XAxis
                    dataKey="name"
                    fontSize={11}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={56}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    formatter={(value: number) => [`${value}${chartValueSuffix}`, chartTitle]}
                    contentStyle={{ borderRadius: 12, fontSize: 12 }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    {shown.map((d) => (
                      <Cell key={d.name} fill="hsl(var(--primary))" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
