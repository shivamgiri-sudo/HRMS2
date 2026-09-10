import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePnlSeatBillability, type PnlSeatBillabilityFilters } from "@/hooks/usePnlSeatBillability";

/**
 * Per-cost-centre mandated seats vs live headcount vs billability%.
 * Cost centres with no mandated_seats configured show "Not configured", never a fabricated 0%.
 */

function money(value: number) {
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function billabilityTone(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 95) return "text-emerald-700";
  if (pct >= 80) return "text-amber-700";
  return "text-primary";
}

export function PnlSeatBillabilityPanel({ filters }: { filters?: PnlSeatBillabilityFilters }) {
  const { data, isLoading, isError, refetch } = usePnlSeatBillability(filters);

  if (isLoading) return <Skeleton className="h-72 w-full rounded-none" />;
  if (isError || !data) {
    return (
      <p className="rounded-none border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600">
        Could not load seat billability.{" "}
        <button type="button" className="underline" onClick={() => void refetch()}>Retry</button>
      </p>
    );
  }

  return (
    <Card className="rounded-none border border-border shadow-none">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-extrabold uppercase tracking-wide text-foreground">
            Seat count &amp; billability by cost centre
          </CardTitle>
          <Badge variant="outline" className="border-foreground/30 text-[10px] font-bold uppercase tracking-wide text-foreground">
            {data.coverage.configuredCount}/{data.coverage.totalActiveCostCentres} configured
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Billability% = live active headcount ÷ mandated_seats. {data.coverage.notConfiguredCount} active cost
          centre{data.coverage.notConfiguredCount === 1 ? "" : "s"} carry no mandated seat count and are flagged
          "Not configured" rather than shown at 0%.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="border-b-2 border-border bg-muted text-left text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Cost centre</th>
              <th className="px-3 py-2">Process</th>
              <th className="px-3 py-2 text-right">Mandated seats</th>
              <th className="px-3 py-2 text-right">Actual headcount</th>
              <th className="px-3 py-2 text-right">Billability</th>
              <th className="px-3 py-2 text-right">Approved seat rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.costCentres.map((row) => (
              <tr key={row.costCentreId}>
                <td className="px-3 py-2 font-semibold text-foreground">{row.costCentreName}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.processName ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.mandatedSeats ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.actualHeadcount}</td>
                <td className={`px-3 py-2 text-right font-bold tabular-nums ${billabilityTone(row.billabilityPct)}`}>
                  {row.seatConfigStatus === "not_configured" ? (
                    <Badge variant="outline" className="border-input text-[10px] font-bold uppercase text-muted-foreground">
                      Not configured
                    </Badge>
                  ) : (
                    `${row.billabilityPct!.toFixed(1)}%`
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.approvedSeatRateMonthly != null ? money(row.approvedSeatRateMonthly) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
