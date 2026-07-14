import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PnlPeriodCloseData } from "@/hooks/usePnlReconciliation";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function IndirectAllocationPanel({
  rows,
}: {
  rows: PnlPeriodCloseData["allocationDrivers"];
}) {
  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-950">Indirect cost allocation</CardTitle>
        <p className="text-sm text-slate-600">Branch overhead is distributed here using the live process mix from the selected month.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            No branch allocation rows are available for this period.
          </div>
        )}
        {rows.map((row) => (
          <div key={row.branchName} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-950">{row.branchName}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                  {row.activeHc} active HC driving {row.sharePct.toFixed(1)}% of pooled overhead
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-950">{formatCurrency(row.indirectCost)}</p>
                <p className="mt-1 text-xs text-slate-500">Revenue {formatCurrency(row.revenue)}</p>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
