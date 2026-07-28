import { AlertTriangle, ArrowUpRight, CheckCircle2, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";

type ProcessPnlAlert = {
  type: "critical" | "warning" | "info";
  title: string;
  detail: string;
  processId?: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number | null) {
  return value == null ? "-" : `${value.toFixed(1)}%`;
}

function isProcessPnlAlert(alert: unknown): alert is ProcessPnlAlert {
  return typeof alert === "object" && alert !== null && "title" in alert && "detail" in alert;
}

export function ProcessPnlRowDrawer({
  period,
  row,
  alerts,
  onOpenChange,
}: {
  period: string;
  row: BpoPnlRow;
  alerts: unknown[];
  onOpenChange: (open: boolean) => void;
}) {
  const processAlerts = alerts.filter(isProcessPnlAlert).filter((alert) => alert.processId === row.processId);

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b border-slate-200 pb-4 pr-8">
          <SheetTitle>{row.processName}</SheetTitle>
          <SheetDescription>
            {row.clientName ?? "Unmapped client"} | {row.branchName ?? "Unassigned branch"} | {period}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          <section>
            <h3 className="text-sm font-semibold text-slate-950">Core KPI snapshot</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              {[
                ["Recognized revenue", formatCurrency(row.recognizedRevenue)],
                ["EBITDA", formatCurrency(row.ebitda)],
                ["EBITDA margin", formatPercent(row.ebitdaMarginPct)],
                ["Revenue at risk", formatCurrency(row.revenueAtRisk)],
                ["Budget utilization", formatPercent(row.budgetUtilizationPct)],
                ["Active HC", row.activeHc.toLocaleString("en-IN")],
              ].map(([label, value]) => (
                <div key={label} className="border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-950">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-950">Process alerts</h3>
            <div className="mt-3 space-y-3">
              {processAlerts.length === 0 ? (
                <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  No process-specific alerts are open.
                </div>
              ) : (
                processAlerts.map((alert, index) => {
                  const isCritical = alert.type === "critical";
                  const isWarning = alert.type === "warning";
                  const Icon = isCritical ? ShieldAlert : AlertTriangle;
                  const tone = isCritical
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : isWarning
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-sky-200 bg-sky-50 text-sky-800";

                  return (
                    <div key={`${alert.title}-${index}`} className={`border px-3 py-3 ${tone}`}>
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Icon className="h-4 w-4 shrink-0" />
                        {alert.title}
                      </div>
                      <p className="mt-1 text-sm opacity-90">{alert.detail}</p>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          <Button asChild>
            <Link to={`/finance/process-pnl/${row.processId}?period=${period}`}>
              Process P&amp;L <ArrowUpRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/finance/branch-budget?period=${period}`}>
              Branch budget <ArrowUpRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
