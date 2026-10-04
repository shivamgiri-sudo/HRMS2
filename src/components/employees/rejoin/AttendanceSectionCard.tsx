import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { CalendarCheck } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ChartTable, SectionCard, StatTile } from "./SectionCard";
import { DASH, attendanceSeries, fmtMonth, fmtNum, fmtPct } from "./rejoinReviewFormat";
import type { AttendanceSection, SectionResult } from "./rejoinTypes";

const chartConfig = {
  pct: { label: "Attendance %", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

/** dossierVerdict DEFAULT_THRESHOLDS: below minAttendancePct is a concern, goodAttendancePct and up is strong. */
const MIN_ATTENDANCE = 90;
const GOOD_ATTENDANCE = 95;

/**
 * `windowMonths` (dossier.window.months) makes the chart show every month of the window; the backend
 * only returns months with records, so without it a month with nothing on file silently disappears.
 */
export function AttendanceSectionCard({ result, windowMonths }: { result: SectionResult<AttendanceSection>; windowMonths?: string[] }) {
  return (
    <SectionCard
      id="attendance"
      title="Attendance"
      icon={CalendarCheck}
      result={result}
      description="Last 12 months of the previous stint. Attendance % = (present + half of half-days + leave) / working days."
      isEmpty={(d) => d.totals.workingDays === 0 && d.regularizations.total === 0}
      emptyText="No attendance records in this window."
    >
      {(d) => {
        const data = attendanceSeries(d.months, windowMonths);
        const withData = data.filter((r) => r.pct !== null);
        const r = d.regularizations;
        return (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
              <StatTile
                label="Attendance"
                value={fmtPct(d.attendancePct)}
                tone={d.attendancePct === null ? undefined : d.attendancePct >= GOOD_ATTENDANCE ? "good" : d.attendancePct < MIN_ATTENDANCE ? "bad" : "warn"}
                hint={`${fmtNum(d.totals.present, 1)} of ${fmtNum(d.totals.workingDays, 1)} days present`}
              />
              <StatTile label="Absent days" value={fmtNum(d.totals.absent, 1)} />
              <StatTile label="LOP days" value={fmtNum(d.totals.lopDays, 1)} />
              <StatTile
                label="Regularizations"
                value={r.total}
                hint={`${r.approved} approved · ${r.rejected} rejected · ${r.pending} pending`}
              />
            </div>
            {withData.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No month had working days on record, so there is no trend to chart.</p>
            ) : (
              <figure className="min-w-0">
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto h-48 w-full"
                  role="img"
                  aria-label={`Monthly attendance percentage, ${withData.length} of ${data.length} months with working days. Overall ${fmtPct(d.attendancePct)}.`}
                >
                  <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tickMargin={6} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
                    <ReferenceLine y={MIN_ATTENDANCE} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                    <ChartTooltip content={<ChartTooltipContent formatter={(v) => (v === null ? DASH : `${v}%`)} />} />
                    <Bar dataKey="pct" fill="var(--color-pct)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
                <figcaption className="mt-1 text-[11px] text-muted-foreground">Dashed line: {MIN_ATTENDANCE}% threshold. Empty month: no working days recorded.</figcaption>
                <ChartTable
                  caption="Attendance by month"
                  columns={["Month", "Working days", "Present", "Half days", "Leave", "Absent", "LOP", "Attendance %"]}
                  rows={data.map(({ month, row, pct }) =>
                    row
                      ? [fmtMonth(month, true), row.workingDays, row.present, row.halfDay, row.leave, row.absent, row.lopDays, fmtPct(pct)]
                      : [fmtMonth(month, true), DASH, DASH, DASH, DASH, DASH, DASH, DASH],
                  )}
                />
              </figure>
            )}
          </>
        );
      }}
    </SectionCard>
  );
}
