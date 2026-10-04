import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { AlarmClock } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ChartTable, SectionCard, StatTile } from "./SectionCard";
import { DASH, attendanceSeries, fmtMonth, fmtNum, plural } from "./rejoinReviewFormat";
import type { AttendanceSection, SectionResult } from "./rejoinTypes";

const chartConfig = {
  lateMarks: { label: "Late marks", color: "hsl(var(--chart-4))" },
} satisfies ChartConfig;

/** The verdict's limit (dossierVerdict DEFAULT_THRESHOLDS.maxLateMarksPerMonth). */
const LATE_LIMIT = 5;

/** dossierVerdict DEFAULT_THRESHOLDS.goodLateMarksPerMonth. */
const LATE_GOOD = 2;

/** Late coming is derived from the attendance section, so it shares its SectionResult (and the window months). */
export function LateComingSectionCard({ result, windowMonths }: { result: SectionResult<AttendanceSection>; windowMonths?: string[] }) {
  return (
    <SectionCard
      id="late"
      title="Late coming"
      icon={AlarmClock}
      result={result}
      isEmpty={(d) => d.totals.workingDays === 0}
      emptyText="No attendance records, so no late marks to show."
    >
      {(d) => {
        const data = attendanceSeries(d.months, windowMonths).map((p) => ({ ...p, lateMarks: p.row ? p.row.lateMarks : null }));
        const avg = d.late.avgLateMarksPerMonth;
        return (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
              <StatTile label="Total late marks" value={d.late.totalLateMarks} />
              <StatTile
                label="Avg per month"
                value={fmtNum(avg)}
                tone={avg === null ? undefined : avg > LATE_LIMIT ? "bad" : avg <= LATE_GOOD ? "good" : "warn"}
                hint={`Limit ${LATE_LIMIT}`}
              />
              <StatTile label="Avg minutes late" value={d.late.avgLateMinutes === null ? DASH : `${fmtNum(d.late.avgLateMinutes)} min`} />
              <StatTile
                label="Worst month"
                value={d.late.worstMonth ? fmtMonth(d.late.worstMonth.month, true) : DASH}
                hint={d.late.worstMonth ? plural(d.late.worstMonth.lateMarks, "late mark") : undefined}
              />
            </div>
            {d.late.totalLateMarks === 0 ? (
              <p className="text-xs italic text-muted-foreground">No late marks in this window.</p>
            ) : (
              <figure className="min-w-0">
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto h-44 w-full"
                  role="img"
                  aria-label={`Late marks by month. ${d.late.totalLateMarks} in total, ${fmtNum(avg)} a month on average.`}
                >
                  <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tickMargin={6} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                    <ReferenceLine y={LATE_LIMIT} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="lateMarks" fill="var(--color-lateMarks)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
                <figcaption className="mt-1 text-[11px] text-muted-foreground">Dashed line: {LATE_LIMIT} late marks a month.</figcaption>
                <ChartTable
                  caption="Late marks by month"
                  columns={["Month", "Late marks", "Minutes late"]}
                  rows={data.map(({ month, row }) => (row ? [fmtMonth(month, true), row.lateMarks, row.lateMinutes] : [fmtMonth(month, true), DASH, DASH]))}
                />
              </figure>
            )}
          </>
        );
      }}
    </SectionCard>
  );
}
