import { AlertTriangle, CheckCircle2, Info, Siren } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PnlPeriodCloseData } from "@/hooks/usePnlReconciliation";

const icons = {
  critical: Siren,
  warning: AlertTriangle,
  info: Info,
} as const;

const tones = {
  critical: "border-rose-200 bg-rose-50 text-rose-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
} as const;

export function RevenueReconciliationPanel({
  alertCounts,
  alerts,
}: {
  alertCounts: PnlPeriodCloseData["alertCounts"];
  alerts: PnlPeriodCloseData["topAlerts"];
}) {
  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base font-semibold text-slate-950">Reconciliation control room</CardTitle>
          <p className="mt-1 text-sm text-slate-600">The exceptions Finance must clear before the month can be locked.</p>
        </div>
        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
          Live watch
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-rose-700">Critical</p>
            <p className="mt-2 text-2xl font-black text-rose-950">{alertCounts.critical}</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-amber-700">Warnings</p>
            <p className="mt-2 text-2xl font-black text-amber-950">{alertCounts.warning}</p>
          </div>
          <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-sky-700">Info</p>
            <p className="mt-2 text-2xl font-black text-sky-950">{alertCounts.info}</p>
          </div>
        </div>

        <div className="space-y-3">
          {alerts.length === 0 && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
              No active reconciliation exceptions were returned for this period.
            </div>
          )}
          {alerts.map((alert, index) => {
            const Icon = icons[alert.type];
            return (
              <div key={`${alert.title}-${index}`} className={`rounded-2xl border px-4 py-3 ${tones[alert.type]}`}>
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{alert.title}</p>
                    <p className="mt-1 text-sm">{alert.detail}</p>
                    {alert.processName && (
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em]">
                        {alert.processName}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
