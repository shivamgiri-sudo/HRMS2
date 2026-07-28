import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleAlert, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { BpoPnlRow, BpoPnlSummary } from "@/hooks/useBpoProcessPnl";

type AlertSeverity = BpoPnlSummary["alerts"][number]["type"];

const alertGroups: Array<{
  severity: AlertSeverity;
  title: string;
  emptyMessage: string;
}> = [
  { severity: "critical", title: "Critical alerts", emptyMessage: "No critical finance exceptions are open." },
  { severity: "warning", title: "Warnings", emptyMessage: "No warnings need follow-up." },
  { severity: "info", title: "Data coverage gaps", emptyMessage: "No data coverage gaps are open." },
];

function getAlertTone(severity: AlertSeverity) {
  if (severity === "critical") return "border-rose-200 bg-rose-50 text-rose-950";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-sky-200 bg-sky-50 text-sky-950";
}

function AlertIcon({ severity }: { severity: AlertSeverity }) {
  if (severity === "critical") return <ShieldAlert className="h-4 w-4 text-rose-700" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-700" />;
  return <CircleAlert className="h-4 w-4 text-sky-700" />;
}

export function ProcessPnlAlertsWorkspace({
  alerts,
  period,
  rows,
}: {
  alerts: BpoPnlSummary["alerts"];
  period: string;
  rows: BpoPnlRow[];
}) {
  const watchlist = [
    { label: "Delivery missing", count: rows.filter((row) => row.revenueDataStatus === "configured_no_delivery").length },
    { label: "Accounting fallback", count: rows.filter((row) => row.revenueDataStatus === "accounting_fallback").length },
    { label: "Budget exceeded", count: rows.filter((row) => (row.budgetUtilizationPct ?? 0) > 100).length },
  ];

  return (
    <div className="space-y-5">
      <section className="border border-slate-200 bg-white" aria-labelledby="portfolio-watchlist-title">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id="portfolio-watchlist-title" className="text-sm font-semibold text-slate-950">Portfolio watchlist</h2>
            <p className="mt-0.5 text-xs text-slate-600">Processes that need reconciliation follow-up in {period}.</p>
          </div>
          <span className="text-xs font-medium text-slate-500">{rows.length} processes in scope</span>
        </div>
        <dl className="grid divide-y divide-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {watchlist.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-sm text-slate-700">{item.label}</dt>
              <dd className={item.count > 0 ? "text-lg font-semibold text-slate-950" : "text-lg font-semibold text-slate-500"}>{item.count}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {alertGroups.map((group) => {
          const groupAlerts = alerts.filter((alert) => alert.type === group.severity);

          return (
            <section key={group.severity} className="border border-slate-200 bg-white" aria-labelledby={`${group.severity}-alerts-title`}>
              <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <h2 id={`${group.severity}-alerts-title`} className="text-sm font-semibold text-slate-950">{group.title}</h2>
                <span className="text-xs font-semibold text-slate-500">{groupAlerts.length}</span>
              </header>
              <div className="divide-y divide-slate-100">
                {groupAlerts.length === 0 ? (
                  <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-600">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    {group.emptyMessage}
                  </div>
                ) : (
                  groupAlerts.map((alert, index) => (
                    <div key={`${alert.code}-${alert.processId ?? index}`} className={`px-4 py-3 ${getAlertTone(group.severity)}`}>
                      <div className="flex items-start gap-2">
                        <AlertIcon severity={group.severity} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{alert.title}</p>
                          <p className="mt-1 text-sm leading-5 opacity-90">{alert.detail}</p>
                          {alert.processId && (
                            <Link
                              to={`/finance/process-pnl/${alert.processId}?period=${period}`}
                              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
                            >
                              {alert.processName ?? "Open process"} <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
