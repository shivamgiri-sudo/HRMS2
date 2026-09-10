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
              : "border-border bg-card text-muted-foreground";

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

  // Flat bordered-cell strip modelled on the Process P&L redesign reference: a single
  // grid of uppercase micro-labels over large tabular-nums figures, the "good"/primary
  // tile carrying the primary (MAS Blue) accent as a top rule rather than a rounded, shadowed card.
  return (
    <div className="grid grid-cols-2 border border-border bg-card sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {items.map((item) => {
        const toneColor =
          item.tone === "good"
            ? "text-foreground"
            : item.tone === "warning"
            ? "text-amber-700"
            : item.tone === "danger"
            ? "text-rose-700"
            : "text-foreground";

        const renderedValue =
          item.kind === "currency"
            ? formatCurrency(item.value ?? 0)
            : item.kind === "percent"
            ? `${(item.value ?? 0).toFixed(1)}%`
            : formatNumber(item.value ?? 0);

        return (
          <div
            key={item.label}
            className={`border-b border-r border-border px-4 py-3 last:border-r-0 ${
              item.tone === "good" ? "border-t-[3px] border-t-primary" : ""
            }`}
          >
            <p className="whitespace-nowrap text-[10px] font-extrabold uppercase tracking-[0.11em] text-muted-foreground">
              {item.label}
            </p>
            <p className={`mt-1 whitespace-nowrap text-[22px] font-extrabold leading-none tracking-tight tabular-nums ${toneColor}`}>
              {renderedValue}
            </p>
          </div>
        );
      })}
    </div>
  );
}
