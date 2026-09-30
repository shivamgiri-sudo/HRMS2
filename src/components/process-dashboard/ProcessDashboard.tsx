import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Settings2 } from "lucide-react";
import { AgentsTable, resolveColumns } from "./AgentsTable";
import { AgentDrawer, DayDrawer } from "./DetailDrawers";
import { DashboardHeader } from "./DashboardHeader";
import { FiltersBar } from "./FiltersBar";
import { AnomaliesPanel, BreakdownPanel, QualityStrip, TopBottomPanel } from "./InsightPanels";
import { KpiTiles } from "./KpiTiles";
import { TrendPanel } from "./TrendPanel";
import { downloadCsv } from "./api";
import { formatValue } from "./format";
import { Empty, ErrorBox, Skeleton } from "./ui";
import { parseUrlState, serializeUrlState, type DashUrlState } from "./urlState";
import { useDashboardData } from "./useDashboardData";
import type { BreakdownRow } from "./types";

export const ADMIN_PATH = "/performance/process-dashboard-admin";

function NotConfigured({ processId, reason }: { processId: string; reason: "missing" | "disabled" }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <Settings2 className="mx-auto h-8 w-8 text-slate-500" aria-hidden="true" />
      <h2 className="mt-2 text-base font-bold text-slate-900">{reason === "disabled" ? "Dashboard is disabled" : "Not configured yet"}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-700">
        {reason === "disabled" ? "An admin has switched this dashboard off." : "Ask an admin to map the APR table for this process. Once its columns are mapped, this dashboard appears automatically."}
      </p>
      <Link to={`${ADMIN_PATH}?process=${encodeURIComponent(processId)}`} className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Open Dashboard Setup</Link>
    </div>
  );
}

/** Config-driven process dashboard. Everything shown (tiles, columns, labels) comes from the API's category profile. */
export function ProcessDashboard({ processId, embedded = false }: { processId: string; embedded?: boolean }) {
  const [sp, setSp] = useSearchParams();
  const state = useMemo(() => parseUrlState(sp), [sp]);
  const d = useDashboardData(processId, state);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const update = useCallback((patch: Partial<DashUrlState>, push = false) => {
    setSp((cur) => serializeUrlState({ ...parseUrlState(cur), ...patch }, cur), { replace: !push });
  }, [setSp]);

  // Keep every TL/LOB ever seen so narrowing to one TL does not empty the dropdown.
  const tlSeen = useRef(new Map<string, BreakdownRow>()), lobSeen = useRef(new Map<string, BreakdownRow>());
  const ov = d.overview.data;
  ov?.byTl?.forEach((r) => r.tl && tlSeen.current.set(r.tl, r));
  ov?.byLob?.forEach((r) => r.lob && lobSeen.current.set(r.lob, r));

  const onTile = (key: string) => update({ metric: key, sort: key, dir: "desc", page: 1 });
  const onExport = async (view: "agents" | "daily") => {
    setExporting(true); setExportError(null);
    try { await downloadCsv(processId, d.config?.processCode ?? processId, view, state); }
    catch (e) { setExportError(e instanceof Error ? e.message : "Export failed."); }
    finally { setExporting(false); }
  };

  if (d.configs.isLoading) return <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (d.configs.isError) return <ErrorBox message="Could not load dashboard configuration." onRetry={() => void d.configs.refetch()} />;
  if (!d.config || !d.config.configured) return <NotConfigured processId={processId} reason="missing" />;
  if (!d.config.enabled) return <NotConfigured processId={processId} reason="disabled" />;

  const cols = resolveColumns(ov);
  const agentsRes = d.agents.data;
  const rows = agentsRes?.rows ?? [];
  const live = d.live?.kpis ?? [];
  return (
    <div className="space-y-4">
      <DashboardHeader config={d.config} freshness={ov?.freshness ?? d.live?.freshness} now={d.now} lastCheckedAt={d.lastCheckedAt} poll={d.poll}
        onRefresh={() => void d.refreshAll()} onExport={(v) => void onExport(v)} exporting={exporting} embedded={embedded} fetching={d.overview.isFetching} />
      {exportError && <ErrorBox message={exportError} />}
      <FiltersBar state={state} tls={[...tlSeen.current.values()]} lobs={[...lobSeen.current.values()]} onChange={(p) => update(p)} />
      {d.overview.isError && !ov ? <ErrorBox message={d.overview.error instanceof Error ? d.overview.error.message : "Could not load the dashboard."} onRetry={() => void d.refreshAll()} /> : (
        <>
          {live.length > 0 && (
            <section aria-label="Today so far versus same weekday baseline" className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-950">
              <span className="font-bold">Today so far</span>
              {live.slice(0, 6).map((k) => <span key={k.key} className="ml-4 inline-block">{k.label ?? k.key} <b className="tabular-nums">{formatValue(k.value, k.unit)}</b>{k.deltaPct != null && <span> ({k.deltaPct > 0 ? "+" : ""}{k.deltaPct.toFixed(1)}% vs usual)</span>}</span>)}
            </section>
          )}
          <KpiTiles kpis={ov?.kpis} activeKey={state.metric} onSelect={onTile} loading={d.overview.isLoading} />
          {!d.overview.isLoading && !ov?.kpis?.length && !rows.length && <Empty>No data for {state.from} to {state.to}. Try a wider date range.</Empty>}
          <TrendPanel overview={ov} focusKey={state.metric} onFocusKey={(k) => update({ metric: k })} onDay={(day) => update({ day }, true)} />
          <div className="grid gap-4 lg:grid-cols-2">
            <AnomaliesPanel anomalies={ov?.anomalies} onAgent={(agent) => update({ agent }, true)} />
            <TopBottomPanel data={ov?.topBottom} onAgent={(agent) => update({ agent }, true)} />
            <BreakdownPanel title="By team leader" labelKey="tl" rows={ov?.byTl} kpis={ov?.kpis} active={state.tl} onPick={(tl) => update({ tl, page: 1 })} />
            <BreakdownPanel title="By LOB" labelKey="lob" rows={ov?.byLob} kpis={ov?.kpis} active={state.lob} onPick={(lob) => update({ lob, page: 1 })} />
          </div>
          <QualityStrip quality={ov?.quality} />
          {d.agents.isError && !agentsRes ? <ErrorBox message="Could not load agents." onRetry={() => void d.refreshAll()} /> : (
            <AgentsTable rows={rows} total={agentsRes?.total ?? rows.length} loading={d.agents.isFetching || d.agents.isLoading} cols={cols} state={state}
              onChange={(p) => update(p)} onAgent={(agent) => update({ agent }, true)} storageKey={`pd-cols-${processId}`} />
          )}
        </>
      )}
      {state.agent && <AgentDrawer code={state.agent} query={d.agent} kpis={ov?.kpis ?? []} focusKey={state.metric} onClose={() => update({ agent: "" })} onDay={(day) => update({ day, agent: "" }, true)} />}
      {state.day && !state.agent && <DayDrawer day={state.day} query={d.day} kpis={ov?.kpis ?? []} onClose={() => update({ day: "" })} onAgent={(agent) => update({ agent, day: "" }, true)} />}
    </div>
  );
}

export default ProcessDashboard;
