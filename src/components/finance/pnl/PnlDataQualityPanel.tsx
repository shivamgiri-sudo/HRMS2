import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PnlDataQualityPanel({
  alerts,
}: {
  alerts: Array<{
    type: "critical" | "warning" | "info";
    title: string;
    detail: string;
    processName?: string;
  }>;
}) {
  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-950">Data quality and alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            No financial control alerts are open for the selected view.
          </div>
        )}

        {alerts.map((alert, index) => {
          const tone =
            alert.type === "critical"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : alert.type === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-sky-200 bg-sky-50 text-sky-800";

          const icon =
            alert.type === "critical" ? (
              <ShieldAlert className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            );

          return (
            <div key={`${alert.title}-${index}`} className={`rounded-2xl border px-4 py-3 ${tone}`}>
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                {icon}
                <span>{alert.title}</span>
              </div>
              <p className="text-sm opacity-90">{alert.detail}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
