import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value ?? 0);
}

type Kpi = {
  label: string;
  value: number | null;
  kind?: "currency" | "number" | "percent";
  tone?: "neutral" | "good" | "warning" | "danger";
};

export function PnlExecutiveKpiStrip({ items, compact = false }: { items: Kpi[]; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex gap-2">
        {items.map((item) => {
          const renderedValue =
            item.kind === "currency"
              ? formatCurrency(item.value ?? 0)
              : item.kind === "percent"
              ? `${(item.value ?? 0).toFixed(1)}%`
              : formatNumber(item.value ?? 0);

          const chipColor =
            item.tone === "good"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : item.tone === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : item.tone === "danger"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-slate-200 bg-white text-slate-700";

          return (
            <div key={item.label} className={`shrink-0 rounded-xl border px-3 py-1.5 ${chipColor}`}>
              <p className="text-[9px] font-semibold uppercase tracking-wider opacity-70 whitespace-nowrap">{item.label}</p>
              <p className="text-sm font-black tracking-tight whitespace-nowrap">{renderedValue}</p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const tone =
          item.tone === "good"
            ? "border-emerald-200 bg-emerald-50/80"
            : item.tone === "warning"
            ? "border-amber-200 bg-amber-50/80"
            : item.tone === "danger"
            ? "border-rose-200 bg-rose-50/80"
            : "border-slate-200 bg-white/90";

        const icon =
          item.tone === "good" ? (
            <ArrowUpRight className="h-4 w-4 text-emerald-600" />
          ) : item.tone === "danger" ? (
            <ArrowDownRight className="h-4 w-4 text-rose-600" />
          ) : (
            <Minus className="h-4 w-4 text-slate-500" />
          );

        const renderedValue =
          item.kind === "currency"
            ? formatCurrency(item.value ?? 0)
            : item.kind === "percent"
            ? `${(item.value ?? 0).toFixed(1)}%`
            : formatNumber(item.value ?? 0);

        return (
          <Card key={item.label} className={`overflow-hidden border ${tone} shadow-sm`}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {item.label}
                </p>
                {icon}
              </div>
              <div className="text-2xl font-black tracking-tight text-slate-950">{renderedValue}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
