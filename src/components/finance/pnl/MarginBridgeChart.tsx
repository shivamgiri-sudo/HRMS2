import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function MarginBridgeChart({
  record,
}: {
  record: {
    revenueMtd: number;
    directPeopleCost: number;
    directNonPeopleCost: number;
    indirectCost: number;
    revenueAtRisk: number;
    operatingProfit: number;
  };
}) {
  const bridgeItems = [
    { label: "Recognized revenue", value: record.revenueMtd, tone: "text-emerald-700" },
    { label: "People cost", value: -record.directPeopleCost, tone: "text-slate-800" },
    { label: "Non-people cost", value: -record.directNonPeopleCost, tone: "text-slate-800" },
    { label: "Indirect allocation", value: -record.indirectCost, tone: "text-amber-700" },
    { label: "Revenue at risk", value: -record.revenueAtRisk, tone: "text-rose-700" },
    { label: "Operating profit", value: record.operatingProfit, tone: record.operatingProfit >= 0 ? "text-sky-700" : "text-rose-700" },
  ];

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-950">Margin bridge</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {bridgeItems.map((item) => (
          <div key={item.label} className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3">
            <span className="text-sm text-slate-600">{item.label}</span>
            <span className={`text-sm font-semibold ${item.tone}`}>
              {item.value >= 0 ? "+" : "-"}
              {formatCurrency(Math.abs(item.value))}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
