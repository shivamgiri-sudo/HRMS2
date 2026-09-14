import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function PnlWaterfallChart({
  revenue,
  directCost,
  indirectCost,
  profit,
}: {
  revenue: number;
  directCost: number;
  indirectCost: number;
  profit: number;
}) {
  const base = Math.max(revenue, directCost, indirectCost, Math.abs(profit), 1);
  const steps = [
    { label: "Revenue", value: revenue, tone: "bg-emerald-500" },
    { label: "Direct cost", value: directCost, tone: "bg-slate-800" },
    { label: "Indirect", value: indirectCost, tone: "bg-amber-500" },
    { label: "Profit", value: Math.abs(profit), tone: profit >= 0 ? "bg-sky-600" : "bg-rose-600" },
  ];

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-950">Profitability waterfall</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map((step) => (
          <div key={step.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-600">{step.label}</span>
              <span className="font-semibold text-slate-950">{formatCurrency(step.value)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${step.tone}`}
                style={{ width: `${Math.max(8, (step.value / base) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
