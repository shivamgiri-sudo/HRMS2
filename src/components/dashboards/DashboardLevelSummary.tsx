import type { ReactNode } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface HeroTile {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "neutral";
  icon?: ReactNode;
}

export interface ChartPoint {
  name: string;
  value: number | null;
}

const TONE_TEXT: Record<NonNullable<HeroTile["tone"]>, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  neutral: "text-foreground",
};

const MAX_BARS = 14;

/**
 * Hero KPI strip + a single-metric comparison bar chart for the current drill level.
 *
 * One hue throughout (sequential, per dataviz form rules — this is one series comparing
 * magnitude across categories, not identity, so color never varies by bar/rank). No legend:
 * a single series is named by the chart title, not a legend box. Skipped entirely below 2
 * points — a "chart" of one bar has no comparison to show and reads as a rendering bug.
 *
 * The glass/blur treatment needs something behind it to actually read as glass — the page
 * wrapping this component supplies a soft primary-tinted gradient backdrop for that reason.
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
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          <span className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">{title}</span>
        </h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {heroTiles.map((tile) => (
          <Card
            key={tile.label}
            className={cn(
              "relative overflow-hidden rounded-3xl border border-primary/15 backdrop-blur-xl",
              "bg-gradient-to-br from-card/80 via-card/60 to-primary/5",
              "shadow-[0_1px_1px_rgba(0,0,0,0.03),0_18px_36px_-24px_hsl(var(--primary)/0.45)]",
              "transition-transform duration-200 hover:-translate-y-0.5",
            )}
          >
            <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/10 blur-2xl" />
            <CardContent className="relative p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {tile.label}
                </p>
                {tile.icon && <span className="text-primary/70">{tile.icon}</span>}
              </div>
              <p className={cn("mt-1.5 font-serif text-2xl font-semibold sm:text-[28px]", tile.tone ? TONE_TEXT[tile.tone] : TONE_TEXT.neutral)}>
                {tile.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {shown.length >= 2 && (
        <Card className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-card/90 to-primary/[0.03] shadow-sm">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <CardContent className="p-4 sm:p-5">
            <p className="text-sm font-bold">
              {chartTitle}
              {truncated && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
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
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={40}>
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
