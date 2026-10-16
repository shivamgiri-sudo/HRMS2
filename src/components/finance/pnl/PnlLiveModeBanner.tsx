import { AlertTriangle, CheckCircle2, Clock, TrendingUp, Banknote, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePnlPeriodStatus } from "@/hooks/usePnlCorrections";
import { cn } from "@/lib/utils";

type Props = {
  period: string;
  className?: string;
};

function formatPeriod(period: string) {
  const [year, month] = period.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function moneyL(rupees: number) {
  const lakhs = rupees / 100000;
  return `₹${Math.abs(lakhs).toFixed(2)}L${rupees < 0 ? " (deducted)" : ""}`;
}

export function PnlLiveModeBanner({ period, className }: Props) {
  const { data: status, isLoading } = usePnlPeriodStatus(period);

  if (isLoading || !status) return null;

  const isFinal = status.mode === "FINAL";
  const hasCorrections = Object.values(status.corrections).some((v) => v !== 0);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm",
        isFinal
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-800",
        className,
      )}
    >
      {/* Mode indicator */}
      <span className="flex items-center gap-1.5 font-semibold">
        {isFinal ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <Clock className="h-4 w-4 text-amber-600" />
        )}
        {formatPeriod(period)} — {isFinal ? "Finalised" : "Live (Month in progress)"}
      </span>

      {/* Salary basis */}
      <Badge
        variant="outline"
        className={cn(
          "gap-1",
          status.salaryBasis === "ACTUAL"
            ? "border-emerald-300 text-emerald-700"
            : "border-amber-300 text-amber-700",
        )}
      >
        <Banknote className="h-3 w-3" />
        Salary: {status.salaryBasis === "ACTUAL" ? "Payroll Final" : "Running Estimate"}
      </Badge>

      {/* GRN source */}
      <Badge variant="outline" className="gap-1 border-slate-300 text-slate-600">
        <Package className="h-3 w-3" />
        GRN: {status.grnSource === "hrms_only" ? "HRMS Only" : "HRMS + Historical"}
      </Badge>

      {/* Revenue mode */}
      {status.revenueMode.forecastCostCentres > 0 && (
        <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700">
          <TrendingUp className="h-3 w-3" />
          {status.revenueMode.forecastCostCentres} CC on Forecast
        </Badge>
      )}

      {/* Active corrections */}
      {hasCorrections && (
        <Badge variant="outline" className="gap-1 border-blue-300 text-blue-700">
          <AlertTriangle className="h-3 w-3" />
          Corrections applied:{" "}
          {Object.entries(status.corrections)
            .filter(([, v]) => v !== 0)
            .map(([k, v]) => `${k} ${moneyL(v)}`)
            .join(" · ")}
        </Badge>
      )}
    </div>
  );
}
