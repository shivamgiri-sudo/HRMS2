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
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-950">Indirect cost allocation</CardTitle>
        <p className="text-sm text-slate-600">Branch overhead is distributed here using the live process mix from the selected month.</p>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-4 text-sm text-slate-600">No branch allocation rows are available for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Branch</th>
                  <th className="px-4 py-2 text-right">Active HC</th>
                  <th className="px-4 py-2 text-right">Share of overhead</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                  <th className="px-4 py-2 text-right">Indirect cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.branchName} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-900">{row.branchName}</td>
                    <td className="px-4 py-2 text-right text-slate-700">{row.activeHc}</td>
                    <td className="px-4 py-2 text-right text-slate-700">{row.sharePct.toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-900">{formatCurrency(row.indirectCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
