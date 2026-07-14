import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export function ProcessCostLedger({
  title,
  rows,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
}) {
  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-950">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Process</th>
                  <th className="px-4 py-3">Metric</th>
                  <th className="px-4 py-3 text-right">Previous</th>
                  <th className="px-4 py-3 text-right">Adjustment</th>
                  <th className="px-4 py-3 text-right">Revised</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No ledger rows are available for this period.
                    </td>
                  </tr>
                )}
                {rows.map((row, index) => (
                  <tr key={`${String(row.id ?? index)}-${index}`} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 text-slate-700">{String(row.process_name ?? row.processName ?? "-")}</td>
                    <td className="px-4 py-3 text-slate-700">{String(row.metric_key ?? row.metricKey ?? "-")}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.previous_value ?? row.previousValue)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.adjustment_amount ?? row.adjustmentAmount)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-950">{formatCurrency(row.revised_value ?? row.revisedValue)}</td>
                    <td className="px-4 py-3 text-slate-700">{String(row.approval_status ?? row.status ?? "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
