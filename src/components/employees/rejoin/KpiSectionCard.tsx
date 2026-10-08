import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { Target } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ChartTable, SectionCard, StatTile } from "./SectionCard";
import { DASH, fmtMonth, fmtPct } from "./rejoinReviewFormat";
import type { KpiSection, SectionResult } from "./rejoinTypes";

const chartConfig = {
  pct: { label: "Achievement %", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

/** dossierVerdict DEFAULT_THRESHOLDS: minKpiAtTargetPct / goodKpiAtTargetPct. */
const MIN_AT_TARGET = 60;
const GOOD_AT_TARGET = 80;

export function KpiSectionCard({ result }: { result: SectionResult<KpiSection> }) {
  return (
    <SectionCard
      id="kpi"
      title="KPI"
      icon={Target}
      result={result}
      description="Average achievement across measured metrics each month (capped at 100%). At target = 100%."
      isEmpty={(d) => d.months.length === 0}
      emptyText="No KPI scores recorded in this window."
    >
      {(d) => {
        const data = d.months.map((m) => ({ month: fmtMonth(m.period), pct: m.avgAchievementPct, m }));
        const t = d.atTargetPct;
        return (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
              <StatTile
                label="Months at target"
                value={`${d.monthsAtTarget}/${d.monthsWithData}`}
                hint={`${fmtPct(t)} of measured months`}
                tone={t === null ? undefined : t >= GOOD_AT_TARGET ? "good" : t < MIN_AT_TARGET ? "bad" : "warn"}
              />
              <StatTile label="Months measured" value={d.monthsWithData} />
              <StatTile label="Best month" value={d.best ? fmtPct(d.best.avgAchievementPct) : DASH} hint={d.best ? fmtMonth(d.best.period, true) : undefined} />
              <StatTile label="Worst month" value={d.worst ? fmtPct(d.worst.avgAchievementPct) : DASH} hint={d.worst ? fmtMonth(d.worst.period, true) : undefined} />
            </div>
            {d.monthsWithData === 0 ? (
              <p className="text-xs italic text-muted-foreground">Scores exist but none had a target to measure against.</p>
            ) : (
              <figure className="min-w-0">
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto h-44 w-full"
                  role="img"
                  aria-label={`Monthly KPI achievement. At target in ${d.monthsAtTarget} of ${d.monthsWithData} measured months.`}
                >
                  <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} interval="preserveStartEnd" tickMargin={6} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
                    <ReferenceLine
                      y={100}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="4 4"
                      label={{ value: "Target", position: "insideTopRight", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    />
                    <ChartTooltip content={<ChartTooltipContent formatter={(v) => (v === null ? DASH : `${v}%`)} />} />
                    <Bar dataKey="pct" fill="var(--color-pct)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
                <figcaption className="mt-1 text-[11px] text-muted-foreground">Dashed line: Target (100%; achievement is capped there). Empty month: no metric with a target.</figcaption>
                <ChartTable
                  caption="KPI achievement by month"
                  columns={["Month", "Achievement %", "Metrics measured", "At target", "Rating"]}
                  rows={data.map(({ m }) => [
                    fmtMonth(m.period, true),
                    fmtPct(m.avgAchievementPct),
                    m.metricsMeasured,
                    m.atTarget === null ? DASH : m.atTarget ? "Yes" : "No",
                    m.rating ?? DASH,
                  ])}
                />
              </figure>
            )}
          </>
        );
      }}
    </SectionCard>
  );
}
