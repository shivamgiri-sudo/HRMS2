import { useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleAlert, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { BpoPnlRow, BpoPnlSummary } from "@/hooks/useBpoProcessPnl";

type AlertSeverity = BpoPnlSummary["alerts"][number]["type"];
type ProcessPnlAlert = BpoPnlSummary["alerts"][number];
type SeverityFilter = "all" | "critical" | "warning" | "info" | "blockers";
type GroupBy = "severity" | "process" | "client" | "branch";

const alertGroups: Array<{
  key: "critical" | "warning" | "blockers" | "info";
  severity?: AlertSeverity;
  title: string;
  emptyMessage: string;
}> = [
  { key: "critical", severity: "critical", title: "Critical alerts", emptyMessage: "No critical finance exceptions are open." },
  { key: "warning", severity: "warning", title: "Warnings", emptyMessage: "No warnings need follow-up." },
  { key: "blockers", title: "Reconciliation blockers", emptyMessage: "No reconciliation blockers are open." },
  { key: "info", severity: "info", title: "Data coverage gaps", emptyMessage: "No data coverage gaps are open." },
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

function isReconciliationBlocker(alert: ProcessPnlAlert) {
  const text = `${alert.code} ${alert.title} ${alert.detail}`.toLocaleLowerCase();
  return alert.type === "critical" && /block|reconcil|missing|fallback|delivery|coverage|unbilled/.test(text);
}

function groupLabel(alert: ProcessPnlAlert, rowsByProcessId: Map<string, BpoPnlRow>, groupBy: GroupBy) {
  if (groupBy === "severity") return alert.type === "info" ? "Data coverage" : alert.type;
  const row = alert.processId ? rowsByProcessId.get(alert.processId) : undefined;
  if (groupBy === "process") return alert.processName ?? row?.processName ?? "Portfolio";
  if (groupBy === "client") return row?.clientName ?? "Unmapped client";
  return row?.branchName ?? "Unassigned branch";
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
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("severity");
  const rowsByProcessId = useMemo(
    () => new Map(rows.map((row) => [row.processId, row])),
    [rows],
  );
  const watchlist = [
    { label: "Delivery missing", count: rows.filter((row) => row.revenueDataStatus === "configured_no_delivery").length },
    { label: "Accounting fallback", count: rows.filter((row) => row.revenueDataStatus === "accounting_fallback").length },
    { label: "Budget exceeded", count: rows.filter((row) => (row.budgetUtilizationPct ?? 0) > 100).length },
  ];
  const filteredAlerts = alerts.filter((alert) => {
    if (severityFilter === "all") return true;
    if (severityFilter === "blockers") return isReconciliationBlocker(alert);
    return alert.type === severityFilter;
  });
  const groupedAlerts = filteredAlerts.reduce<Record<string, ProcessPnlAlert[]>>((groups, alert) => {
    const label = groupLabel(alert, rowsByProcessId, groupBy);
    groups[label] = [...(groups[label] ?? []), alert];
    return groups;
  }, {});

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

      <section className="flex flex-wrap items-center gap-3 border border-slate-200 bg-white px-4 py-3" aria-label="Alert workspace controls">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          Severity
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warnings</option>
            <option value="blockers">Reconciliation blockers</option>
            <option value="info">Data coverage gaps</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          Group by
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as GroupBy)}
          >
            <option value="severity">Severity</option>
            <option value="process">Process</option>
            <option value="client">Client</option>
            <option value="branch">Branch</option>
          </select>
        </label>
        <span className="text-xs font-medium text-slate-500">{filteredAlerts.length} alerts after filter</span>
      </section>

      {groupBy !== "severity" && (
        <section className="border border-slate-200 bg-white" aria-labelledby="alert-grouping-title">
          <header className="border-b border-slate-200 px-4 py-3">
            <h2 id="alert-grouping-title" className="text-sm font-semibold text-slate-950">Grouped alert view</h2>
          </header>
          <div className="divide-y divide-slate-100">
            {Object.entries(groupedAlerts).length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-600">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                No alerts match this filter.
              </div>
            ) : (
              Object.entries(groupedAlerts).map(([label, groupAlerts]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-800">{label}</span>
                  <span className="text-xs font-semibold text-slate-500">{groupAlerts.length}</span>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-4">
        {alertGroups.map((group) => {
          const groupAlerts = filteredAlerts.filter((alert) =>
            group.key === "blockers"
              ? isReconciliationBlocker(alert)
              : group.key === "critical"
                ? alert.type === "critical" && !isReconciliationBlocker(alert)
                : alert.type === group.severity,
          );
          const iconSeverity = group.severity ?? "critical";

          return (
            <section key={group.key} className="border border-slate-200 bg-white" aria-labelledby={`${group.key}-alerts-title`}>
              <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <h2 id={`${group.key}-alerts-title`} className="text-sm font-semibold text-slate-950">{group.title}</h2>
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
                    <div key={`${group.key}-${alert.code}-${alert.processId ?? index}`} className={`px-4 py-3 ${getAlertTone(group.severity ?? alert.type)}`}>
                      <div className="flex items-start gap-2">
                        <AlertIcon severity={iconSeverity} />
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
