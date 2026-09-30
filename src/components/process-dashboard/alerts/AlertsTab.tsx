import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Bell, ChevronLeft } from "lucide-react";
import { fetchOverview } from "../api";
import { defaultState, parseUrlState } from "../urlState";
import type { ProcessConfigSummary } from "../types";
import { ErrorBox, FOCUS, Skeleton } from "../ui";
import { alertsKey, fetchAlertMetrics, fetchAlertSummary } from "./api";
import { DigestPanel } from "./DigestPanel";
import { EventsFeed } from "./EventsFeed";
import { RulesPanel } from "./RulesPanel";
import { errMsg } from "./alertUi";

type Sub = "events" | "rules" | "digest";
const tabCls = (on: boolean) => `inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 border-b-2 px-4 text-sm font-semibold ${FOCUS} ${on ? "border-blue-700 text-blue-800" : "border-transparent text-slate-700 hover:text-slate-900"}`;

/** The Alerts tab of a generic process dashboard: events feed with acknowledge, rule list + builder with backtest, digest settings. Shown with ?view=alerts. */
export function AlertsTab({ processId, config }: { processId: string; config: ProcessConfigSummary | null }) {
  const [sp] = useSearchParams();
  const [sub, setSub] = useState<Sub>("events");
  const back = new URLSearchParams(sp); back.delete("view");
  const summary = useQuery({ queryKey: alertsKey(processId, "summary"), queryFn: () => fetchAlertSummary(processId), refetchInterval: 60_000 });
  const metrics = useQuery({ queryKey: alertsKey(processId, "metrics"), queryFn: () => fetchAlertMetrics(processId), staleTime: 300_000 });
  // TL / LOB names for scope pickers and recipients: the same overview payload the dashboard shows.
  const ov = useQuery({ queryKey: alertsKey(processId, "scopes"), queryFn: () => fetchOverview(processId, parseUrlState(new URLSearchParams(), new Date()) ?? defaultState()), staleTime: 300_000 });
  const tls = Array.from(new Set((ov.data?.byTl ?? []).map((r) => r.tl).filter((x): x is string => !!x && x !== "Unassigned")));
  const lobs = Array.from(new Set((ov.data?.byLob ?? []).map((r) => r.lob).filter((x): x is string => !!x && x !== "Unassigned")));
  const canManage = summary.data?.canManage === true;
  const open = summary.data?.open ?? 0;
  return (
    <div className="space-y-4">
      <header className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-4 text-white shadow-sm sm:p-5">
        <Link to={`?${back.toString()}`} className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-blue-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Back to dashboard</Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold sm:text-2xl"><Bell className="h-5 w-5" aria-hidden="true" />Alerts &amp; digests<span className="text-base font-semibold text-blue-200">{config?.label ?? config?.processName ?? ""}</span></h1>
        <p className="mt-1 text-xs text-slate-200">{open > 0 ? `${open} open alert${open === 1 ? "" : "s"} waiting to be acknowledged.` : "No open alerts."}</p>
      </header>
      <div role="tablist" aria-label="Alerts sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {([["events", `Events${open > 0 ? ` (${open})` : ""}`], ["rules", "Rules"], ["digest", "Digests"]] as Array<[Sub, string]>).map(([k, l]) => (
          <button key={k} type="button" role="tab" id={`al-tab-${k}`} aria-selected={sub === k} aria-controls={`al-panel-${k}`} className={tabCls(sub === k)} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>
      {metrics.isError ? <ErrorBox message={errMsg(metrics.error, "Could not load the metric list.")} onRetry={() => void metrics.refetch()} /> : (
        <div role="tabpanel" id={`al-panel-${sub}`} aria-labelledby={`al-tab-${sub}`}>
          {sub === "events" && <EventsFeed processId={processId} />}
          {sub === "rules" && (metrics.isLoading ? <Skeleton className="h-40" /> : <RulesPanel processId={processId} metrics={metrics.data ?? []} tlOptions={tls} lobOptions={lobs} canManage={canManage} />)}
          {sub === "digest" && <DigestPanel processId={processId} tlOptions={tls} canManage={canManage} />}
        </div>
      )}
    </div>
  );
}
