import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function WorkforceCostBridge({
  metrics,
}: {
  metrics: {
    requiredProductiveHc?: number | null;
    requiredRosterHc?: number | null;
    activeHc?: number | null;
    deployedHc?: number | null;
    billableHc?: number | null;
    plannedBufferPct?: number | null;
    actualBufferPct?: number | null;
    salaryMtd?: number | null;
    loadedCostPerBillableSeat?: number | null;
  };
}) {
  const items = [
    { label: "Required productive HC", value: formatNumber(metrics.requiredProductiveHc) },
    { label: "Required roster HC", value: formatNumber(metrics.requiredRosterHc) },
    { label: "Active HC", value: formatNumber(metrics.activeHc) },
    { label: "Deployed HC", value: formatNumber(metrics.deployedHc) },
    { label: "Billable HC", value: formatNumber(metrics.billableHc) },
    { label: "Planned buffer", value: `${formatNumber(metrics.plannedBufferPct, 1)}%` },
    { label: "Actual buffer", value: `${formatNumber(metrics.actualBufferPct, 1)}%` },
    { label: "Salary MTD", value: formatCurrency(metrics.salaryMtd) },
    { label: "Loaded cost / billable seat", value: formatCurrency(metrics.loadedCostPerBillableSeat) },
  ];

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-950">Workforce to cost bridge</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{item.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
