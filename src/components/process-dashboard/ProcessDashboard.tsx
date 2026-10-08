import { Suspense, lazy, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Bell, PhoneIncoming, PhoneOutgoing, SearchX, Settings2, ShoppingCart } from "lucide-react";
import { AgentsTable, resolveColumns } from "./AgentsTable";
import { AgentDrawer, DayDrawer } from "./DetailDrawers";
import { DashboardHeader } from "./DashboardHeader";
import { FiltersBar } from "./FiltersBar";
import { AnomaliesPanel, BreakdownPanel, QualityStrip, TopBottomPanel } from "./InsightPanels";
import { KpiTiles } from "./KpiTiles";
import { TrendPanel } from "./TrendPanel";
import { downloadCsv, fetchConfigs, fetchInboundTab, probeProcess } from "./api";
import { fetchTab } from "./sales/extApi";
import { formatValue } from "./format";
import { Empty, ErrorBox, FOCUS, Skeleton } from "./ui";
import { useBreadcrumbLabel } from "@/lib/breadcrumbLabel";
import { parseUrlState, serializeUrlState, type DashUrlState } from "./urlState";
import { useDashboardData } from "./useDashboardData";
import { AlertsChip } from "./alerts/AlertsChip";
import { AlertsTab } from "./alerts/AlertsTab";
import type { BreakdownRow } from "./types";
import { WhyDrawer } from "./rootcause/WhyDrawer";
import { WHY_PARAMS, openWhyState, parseWhy, writeWhy, type WhyState } from "./rootcause/whyState";

const PacingPanel = lazy(() => import("./forecast/PacingPanel"));
// The inbound dashboard pulls in the charting bundle; load it only when the Live inbound tab is opened.
const InboundInsightsDashboard = lazy(() => import("@/components/process-performance/InboundInsightsDashboard").then((m) => ({ default: m.InboundInsightsDashboard })));

// Sales / Outbound tabs (data-driven category templates, sql/1961) pull in the charting bundle too: lazy as well.
const SalesDashboard = lazy(() => import("./sales/SalesDashboard").then((m) => ({ default: m.SalesDashboard })));
const OutboundDashboard = lazy(() => import("./outbound/OutboundDashboard").then((m) => ({ default: m.OutboundDashboard })));

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

export function NotFoundOrForbidden() {
  return (
    <div role="alert" className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <SearchX className="mx-auto h-8 w-8 text-slate-500" aria-hidden="true" />
      <h2 className="mt-2 text-base font-bold text-slate-900">Process not found</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-700">This process was not found or you do not have access.</p>
    </div>
  );
}

type View = "apr" | "inbound" | "sales" | "outbound" | "alerts";
/** ?view= drives the outer tab strip: any tab that exists, else the overview (or the first extra tab when there is no APR dashboard). */
export function resolveView(want: string | null, extra: Array<Exclude<View, "apr" | "alerts">>, aprReady: boolean): View {
  if (want === "apr" || (want === "alerts" && aprReady) || (extra as string[]).includes(want ?? "")) return want as View;
  return aprReady ? "apr" : extra[0];
}
/** Tabs share from/to/tl/lob/q, but drill-down state (agent/day/sort/page/metric/why) means different things per tab, so it is dropped on a tab switch. */
export function switchViewParams(cur: URLSearchParams): URLSearchParams {
  const n = new URLSearchParams(cur);
  for (const k of ["agent", "day", "sort", "dir", "page", "metric", ...WHY_PARAMS]) n.delete(k);
  return n;
}
/** Arrow/Home/End move between the tabs of a tablist and activate the one reached (WAI-ARIA tabs, automatic activation). */
export function tabArrowKeys(e: React.KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0 || !tabs.length) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus(); tabs[next].click();
}
const tabCls = (on: boolean) => `inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 border-b-2 px-4 text-sm font-semibold ${FOCUS} ${on ? "border-blue-700 text-blue-800" : "border-transparent text-slate-700 hover:text-slate-900"}`;

/**
 * Entry point. Decides what this reader may see for the process: the APR-driven dashboard, the Live inbound tab (a support process with a
 * saved dialer source), both as tabs, "Not configured yet", or "not found / no access". Unknown/out-of-scope ids are told apart from
 * real-but-unconfigured ones by /configs membership plus the /:processId/config probe (403 vs 404).
 */
export function ProcessDashboard({ processId, embedded = false }: { processId: string; embedded?: boolean }) {
  const [sp, setSp] = useSearchParams();
  const configs = useQuery({ queryKey: ["process-dashboard", "configs"], queryFn: fetchConfigs, staleTime: 60_000 });
  const config = configs.data?.find((c) => c.processId === processId) ?? null;
  const loaded = configs.isSuccess;
  const probe = useQuery({ queryKey: ["process-dashboard", processId, "probe"], queryFn: () => probeProcess(processId), enabled: loaded && !config, retry: false, staleTime: 60_000 });
  // Each extra tab is driven by its own saved source config, not by the APR category: a process can have an APR mapping AND sales/outbound/inbound sources.
  const mayHaveInbound = loaded && (config ? true : probe.isSuccess && probe.data !== "forbidden");
  const inbound = useQuery({ queryKey: ["process-dashboard", processId, "inbound"], queryFn: () => fetchInboundTab(processId), enabled: mayHaveInbound, retry: false, staleTime: 30_000 });
  const probeOk = probe.isSuccess && probe.data !== "forbidden";
  const maySales = loaded && (config ? true : probeOk);
  const mayOutbound = loaded && (config ? true : probeOk);
  const sales = useQuery({ queryKey: ["process-dashboard", processId, "sales"], queryFn: () => fetchTab(processId, "sales"), enabled: maySales, retry: false, staleTime: 30_000 });
  const outbound = useQuery({ queryKey: ["process-dashboard", processId, "outbound"], queryFn: () => fetchTab(processId, "outbound"), enabled: mayOutbound, retry: false, staleTime: 30_000 });

  // The TopBar breadcrumb would otherwise end in the raw process id (standalone page only; the embedded tile has no such crumb).
  useBreadcrumbLabel(`/performance/process-dashboard/${processId}`, embedded ? null : config ? config.label || config.processName : inbound.data?.name ?? sales.data?.name ?? outbound.data?.name ?? null);

  if (configs.isLoading) return <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (configs.isError) return <ErrorBox message="Could not load dashboard configuration." onRetry={() => void configs.refetch()} />;
  if (!config) {
    if (probe.isLoading) return <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;
    if (probe.data === "forbidden") return <NotFoundOrForbidden />;
  }
  if ((mayHaveInbound && inbound.isLoading) || (maySales && sales.isLoading) || (mayOutbound && outbound.isLoading)) return <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;
  const tab = inbound.data ?? null;
  const extra = ([tab && "inbound", sales.data && "sales", outbound.data && "outbound"].filter(Boolean)) as Array<Exclude<View, "apr" | "alerts">>;
  if (!extra.length) {
    if (!config && probe.data === "missing") return <NotConfigured processId={processId} reason="missing" />;
    return <AprDashboard processId={processId} embedded={embedded} />;
  }
  const aprReady = !!config?.configured && config.enabled;
  const want = sp.get("view");
  const view = resolveView(want, extra, aprReady);
  const setView = (v: View) => setSp((cur) => { const n = switchViewParams(cur); if (v !== "apr") n.set("view", v); else n.delete("view"); return n; }, { replace: true });
  const fallback = <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Dashboard views" className="flex flex-wrap gap-1 border-b border-slate-200" onKeyDown={tabArrowKeys}>
        <button type="button" role="tab" id="pd-tab-apr" aria-selected={view === "apr"} aria-controls="pd-panel-apr" className={tabCls(view === "apr")} onClick={() => setView("apr")}>Process overview</button>
        {tab && <button type="button" role="tab" id="pd-tab-inbound" aria-selected={view === "inbound"} aria-controls="pd-panel-inbound" className={tabCls(view === "inbound")} onClick={() => setView("inbound")}><PhoneIncoming className="h-4 w-4" aria-hidden="true" />Live inbound</button>}
        {sales.data && <button type="button" role="tab" id="pd-tab-sales" aria-selected={view === "sales"} aria-controls="pd-panel-sales" className={tabCls(view === "sales")} onClick={() => setView("sales")}><ShoppingCart className="h-4 w-4" aria-hidden="true" />Sales</button>}
        {outbound.data && <button type="button" role="tab" id="pd-tab-outbound" aria-selected={view === "outbound"} aria-controls="pd-panel-outbound" className={tabCls(view === "outbound")} onClick={() => setView("outbound")}><PhoneOutgoing className="h-4 w-4" aria-hidden="true" />Outbound</button>}
        {aprReady && <button type="button" role="tab" id="pd-tab-alerts" aria-selected={view === "alerts"} aria-controls="pd-panel-alerts" className={tabCls(view === "alerts")} onClick={() => setView("alerts")}><Bell className="h-4 w-4" aria-hidden="true" />Alerts</button>}
      </div>
      {view === "inbound" && tab ? (
        <div role="tabpanel" id="pd-panel-inbound" aria-labelledby="pd-tab-inbound">
          <Suspense fallback={fallback}>
            <InboundInsightsDashboard key={tab.projectKey} projectKey={tab.projectKey} projectName={tab.name} />
          </Suspense>
        </div>
      ) : view === "sales" && sales.data ? (
        <div role="tabpanel" id="pd-panel-sales" aria-labelledby="pd-tab-sales"><Suspense fallback={fallback}><SalesDashboard key={processId} processId={processId} name={sales.data.name} refreshSeconds={sales.data.refreshSeconds} /></Suspense></div>
      ) : view === "outbound" && outbound.data ? (
        <div role="tabpanel" id="pd-panel-outbound" aria-labelledby="pd-tab-outbound"><Suspense fallback={fallback}><OutboundDashboard key={processId} processId={processId} name={outbound.data.name} refreshSeconds={outbound.data.refreshSeconds} /></Suspense></div>
      ) : view === "alerts" ? (
        <div role="tabpanel" id="pd-panel-alerts" aria-labelledby="pd-tab-alerts"><AlertsTab processId={processId} config={config} /></div>
      ) : (
        <div role="tabpanel" id="pd-panel-apr" aria-labelledby="pd-tab-apr"><AprDashboard processId={processId} embedded={embedded} /></div>
      )}
    </div>
  );
}

/** The APR-driven dashboard. Everything shown (tiles, columns, labels) comes from the API's category profile. */
function AprDashboard({ processId, embedded = false }: { processId: string; embedded?: boolean }) {
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

  const why = useMemo(() => parseWhy(sp, state), [sp, state]);
  const setWhy = useCallback((w: WhyState | null, push = false) => setSp((cur) => writeWhy(w, cur), { replace: !push }), [setSp]);
  const mappedFields = (ov?.categoryProfile?.mappedFields as string[] | undefined) ?? [];
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

  if (sp.get("view") === "alerts") return <AlertsTab processId={processId} config={d.config} />;
  const cols = resolveColumns(ov);
  const agentsRes = d.agents.data;
  const rows = agentsRes?.rows ?? [];
  const live = d.live?.kpis ?? [];
  return (
    <div className="space-y-4">
      <AlertsChip processId={processId} />
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
          <KpiTiles kpis={ov?.kpis} activeKey={state.metric} onSelect={onTile} loading={d.overview.isLoading} onWhy={(key) => setWhy(openWhyState(key, state.from, state.to), true)} />
          <Suspense fallback={<Skeleton className="h-16" />}><PacingPanel processId={processId} state={state} onChange={update} /></Suspense>
          {!d.overview.isLoading && !ov?.kpis?.length && !rows.length && <Empty>No data for {state.from} to {state.to}. Try a wider date range.</Empty>}
          <TrendPanel overview={ov} focusKey={state.metric} onFocusKey={(k) => update({ metric: k })} onDay={(day) => update({ day }, true)}
            selectedDay={state.day} onWhy={(metric, from, to) => setWhy(openWhyState(metric, from, to), true)} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
      {why && <WhyDrawer processId={processId} state={why} scope={{ tl: state.tl, lob: state.lob }} metricLabel={ov?.kpis?.find((k) => k.key === why.metric)?.label}
        dims={{ tl: mappedFields.includes("tl_name"), lob: mappedFields.includes("lob"), hour: mappedFields.includes("hour") }}
        onChange={(patch) => setWhy({ ...why, ...patch })} onClose={() => setWhy(null)}
        onPick={(seg, dim) => {
          setSp((cur) => { const n = writeWhy(null, cur); const cs = parseUrlState(n); return serializeUrlState({ ...cs, ...(dim === "agent" ? { agent: seg.key } : dim === "tl" ? { tl: seg.key, page: 1 } : { lob: seg.key, page: 1 }) }, n); }, { replace: false });
        }} />}
      {state.agent && !why && <AgentDrawer code={state.agent} query={d.agent} kpis={ov?.kpis ?? []} focusKey={state.metric} onClose={() => update({ agent: "" })} onDay={(day) => update({ day, agent: "" }, true)} />}
      {state.day && !state.agent && !why && <DayDrawer day={state.day} query={d.day} kpis={ov?.kpis ?? []} onClose={() => update({ day: "" })} onAgent={(agent) => update({ agent, day: "" }, true)}
        onWhy={(metric) => setSp((cur) => { const n = writeWhy(openWhyState(metric, state.day, state.day), serializeUrlState({ ...parseUrlState(cur), day: "" }, cur)); return n; }, { replace: false })} />}
    </div>
  );
}

export default ProcessDashboard;
