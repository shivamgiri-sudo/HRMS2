import { Info, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSeatRevenueForecast } from "@/hooks/useSeatRevenueForecast";

/**
 * Where this month's seat revenue is heading.
 *
 * Sits beside the statement rather than inside it: the statement reports what happened, this is a
 * projection, and putting a forward-looking number in the same grid as recognised revenue is how
 * one gets read as the other. The card says on its face that it changes nothing.
 *
 * Coverage is shown as a proportion, not a footnote. The forecast can only speak for cost centres
 * billed per seat; the rest bill on outcome or volume, and a reader who does not know what share
 * that is will take the total for the whole business.
 */

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function PnlSeatForecastCard({ period, branchId }: { period: string; branchId?: string }) {
  const { data, isLoading, isError } = useSeatRevenueForecast(period, branchId);

  if (isLoading) return <Skeleton className="h-56 w-full rounded-2xl" />;
  if (isError || !data) return null;

  const noSeatBilling = data.coverage.seatBilledCostCentres === 0;
  const pctOfMonth = data.daysInMonth > 0
    ? Math.round((data.daysElapsed / data.daysInMonth) * 100)
    : 0;

  return (
    <Card className="rounded-2xl border border-white/60 bg-white/95 shadow-sm backdrop-blur-sm transition-shadow duration-200 hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base font-bold text-gray-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
              <TrendingUp className="h-4 w-4 text-blue-700" aria-hidden="true" />
            </span>
            Seat revenue forecast
          </CardTitle>
          <Badge variant="outline" className="border-slate-300 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            Projection · changes nothing
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {noSeatBilling ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
            None — no cost centre in scope has an approved per-seat rate, so there is nothing to
            project from.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">
                  Projected month-end
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
                  {money(data.projectedMonthEnd)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-600">
                  {data.billableSeats.toLocaleString("en-IN")} billable seats at their approved rate
                </p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                  Earned so far
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
                  {money(data.earnedToDate)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-600">
                  Day {data.daysElapsed} of {data.daysInMonth} · {pctOfMonth}% of the month
                </p>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                <span>Forecast covers {data.coverage.seatBilledCostCentres} of {data.coverage.activeCostCentresWithStaff} staffed cost centres</span>
                <span className="tabular-nums">{data.coverage.coveragePct}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-slate-100"
                role="img"
                aria-label={`Forecast covers ${data.coverage.coveragePct}% of staffed cost centres`}
              >
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${Math.min(100, data.coverage.coveragePct)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                The other {data.coverage.notSeatBilledCostCentres} bill on outcome or volume, not
                seats. No seat run-rate exists for them, so they are left out rather than estimated.
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Seats are staff classified as agents in the
                {" "}{data.classificationPeriod ?? "latest available"} classification snapshot.
                {data.unclassifiedHeadcount > 0 && (
                  <>
                    {" "}{data.unclassifiedHeadcount} active staff have no classification yet and are
                    excluded rather than assumed billable.
                  </>
                )}
                {" "}To record this as a forward-looking figure, raise it as a Projected Revenue
                adjustment — those stay separate from reported profit by design.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
