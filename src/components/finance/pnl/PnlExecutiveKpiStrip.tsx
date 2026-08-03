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
        // Every tile shares the same flat white surface — only the left accent stripe and icon
        // carry the tone, so a row of good/warning/danger/neutral tiles reads as one consistent
        // set rather than a row of differently-colored cards.
        const accent =
          item.tone === "good"
            ? "border-l-emerald-400"
            : item.tone === "warning"
            ? "border-l-amber-400"
            : item.tone === "danger"
            ? "border-l-rose-400"
            : "border-l-slate-300";

        const icon =
          item.tone === "good" ? (
            <ArrowUpRight className="h-4 w-4 text-emerald-600" />
          ) : item.tone === "danger" ? (
            <ArrowDownRight className="h-4 w-4 text-rose-600" />
          ) : (
            <Minus className="h-4 w-4 text-slate-400" />
          );

        const renderedValue =
          item.kind === "currency"
            ? formatCurrency(item.value ?? 0)
            : item.kind === "percent"
            ? `${(item.value ?? 0).toFixed(1)}%`
            : formatNumber(item.value ?? 0);

        return (
          <Card key={item.label} className={`overflow-hidden border border-slate-200 border-l-4 ${accent} shadow-sm`}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {item.label}
                </p>
                {icon}
              </div>
              <div className="text-2xl font-bold tracking-tight text-slate-950">{renderedValue}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
