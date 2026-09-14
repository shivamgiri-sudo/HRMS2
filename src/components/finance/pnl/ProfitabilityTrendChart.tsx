import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatCurrencyCompact(value: number) {
  if (Math.abs(value) >= 10000000) return `Rs ${(value / 10000000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100000) return `Rs ${(value / 100000).toFixed(1)} L`;
  return `Rs ${Math.round(value).toLocaleString("en-IN")}`;
}

export function ProfitabilityTrendChart({
  trend,
}: {
  trend: Array<{
    month: string;
    revenue: number;
    directCost: number;
    indirectCost: number;
    operatingProfit: number;
  }>;
}) {
  const maxValue = Math.max(
    ...trend.flatMap((point) => [point.revenue, point.directCost + point.indirectCost, Math.abs(point.operatingProfit)]),
    1
  );

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-950">Revenue versus cost trend</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {trend.map((point) => (
          <div key={point.month} className="rounded-2xl border border-slate-100 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">{point.month}</span>
              <span className={`text-sm font-semibold ${point.operatingProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {formatCurrencyCompact(point.operatingProfit)}
              </span>
            </div>
            <div className="space-y-2">
              {[
                { label: "Revenue", value: point.revenue, tone: "bg-emerald-500" },
                { label: "Direct cost", value: point.directCost, tone: "bg-slate-700" },
                { label: "Indirect cost", value: point.indirectCost, tone: "bg-amber-500" },
              ].map((bar) => (
                <div key={bar.label} className="grid grid-cols-[110px_1fr_120px] items-center gap-3 text-sm">
                  <span className="text-slate-600">{bar.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${bar.tone}`} style={{ width: `${(bar.value / maxValue) * 100}%` }} />
                  </div>
                  <span className="text-right font-medium text-slate-900">{formatCurrencyCompact(bar.value)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
