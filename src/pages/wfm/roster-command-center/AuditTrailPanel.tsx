/**
 * Roster Audit Trail (Command Center tab=audit): who changed which roster, when and why, plus roster
 * generation runs. Backend: /roster-audit/{summary,trails,generation-runs,...}; amendments POST /roster-gov.
 * Sub-components live in ./audit-trail/.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, GitBranch, History, Info, PenLine, RefreshCw, ShieldAlert, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { ConsoleCard } from "@/components/wfm/console/ConsoleCard";
import { FilterNote } from "@/components/wfm/console/FilterNote";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { TabToolbar, ToolbarSearch, ToolbarSelect } from "@/components/wfm/console/TabToolbar";
import { pickOne, useTabParams } from "./useTabParams";
import { PanelHeader } from "@/components/wfm/console/PanelHeader";
import { hrmsApi as api } from "@/lib/hrmsApi";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { formatUpdatedAt } from "./heavyQuery";
import { scopeParams } from "./filterState";
import { AmendmentDialog } from "./audit-trail/AmendmentDialog";
import { RunDrawer, SegmentDrawer, TrailDrawer, type SegmentSpec } from "./audit-trail/AuditDrawers";
import { RunsTable, TrailsTable } from "./audit-trail/AuditTables";
import { Pager, TableSkeleton } from "./audit-trail/tableParts";
import {
  CHANGE_TYPE_OPTIONS, RUN_STATUS_OPTIONS, buildAlerts, fmtDate, fmtNum,
  type AuditAlert, type AuditSummary, type RunsResponse, type TrailsResponse,
} from "./audit-trail/auditModel";

const DailyChangesChart = lazy(() => import("./audit-trail/AuditCharts").then((m) => ({ default: m.DailyChangesChart })));
const TypeBarChart = lazy(() => import("./audit-trail/AuditCharts").then((m) => ({ default: m.TypeBarChart })));
const chartFallback = <div className="h-full animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none" role="status" aria-label="Loading chart" />;

const PAGE = 50;
const ALL = "all";
const QUERY_OPTS = { staleTime: 60_000, gcTime: 10 * 60_000, placeholderData: keepPreviousData, retry: false, refetchOnWindowFocus: false } as const;

const SEV_STYLE = {
  critical: { cls: "border-red-200 bg-red-50 text-red-900", Icon: ShieldAlert, label: "Critical" },
  warning: { cls: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle, label: "Warning" },
  info: { cls: "border-blue-200 bg-blue-50 text-blue-900", Icon: Info, label: "Info" },
} as const;

/** Debounce a fast-changing value (search box) so we don't fire a query per keystroke. */
function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function AuditTrailPanel() {
  const { filters } = useRosterConsoleFilters();
  const { from: dateFrom, to: dateTo, branchId, processId, lobId } = filters;
  const qc = useQueryClient();

  const [tp, setTp] = useTabParams({ sub: "trails", change: ALL, source: ALL, q: "", runStatus: ALL });
  const tab = pickOne(tp.sub, ["trails", "runs"] as const, "trails");
  const setTab = (t: "trails" | "runs") => setTp({ sub: t });
  const changeType = tp.change;
  const setChangeType = (v: string) => setTp({ change: v });
  const overridesOnly = tp.source === "manual";
  const setOverridesOnly = (v: boolean) => setTp({ source: v ? "manual" : ALL });
  const search = tp.q;
  const setSearch = (q: string) => setTp({ q });
  const debouncedSearch = useDebounced(search.trim());
  const runStatus = tp.runStatus;
  const setRunStatus = (v: string) => setTp({ runStatus: v });
  const [trailOffset, setTrailOffset] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const [trailId, setTrailId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [segment, setSegment] = useState<SegmentSpec | null>(null);
  const [amendOpen, setAmendOpen] = useState(false);

  const scope = useMemo(() => scopeParams({ branchId, processId, lobId }), [branchId, processId, lobId]);
  const scopeKey = scope.toString();

  // Any filter change returns to the first page.
  useEffect(() => { setTrailOffset(0); setRunOffset(0); }, [scopeKey, dateFrom, dateTo, changeType, overridesOnly, debouncedSearch, runStatus]);

  const dateParams = useCallback((p: URLSearchParams) => { if (dateFrom) p.set("dateFrom", dateFrom); if (dateTo) p.set("dateTo", dateTo); return p; }, [dateFrom, dateTo]);

  // Summary and the first trails page load in parallel (independent queries, no waterfall).
  const summary = useQuery({
    queryKey: ["roster-audit-summary", dateFrom, dateTo, scopeKey],
    queryFn: async () => (await api.get(`/api/roster-audit/summary?${dateParams(new URLSearchParams(scope))}`)) as AuditSummary,
    ...QUERY_OPTS,
  });

  const trails = useQuery({
    queryKey: ["roster-audit-trails", dateFrom, dateTo, scopeKey, changeType, overridesOnly, debouncedSearch, trailOffset],
    queryFn: async () => {
      const p = dateParams(new URLSearchParams(scope));
      if (changeType !== ALL) p.set("changeType", changeType);
      if (overridesOnly) p.set("overridesOnly", "1");
      if (debouncedSearch) p.set("q", debouncedSearch);
      p.set("limit", String(PAGE)); p.set("offset", String(trailOffset));
      return (await api.get(`/api/roster-audit/trails?${p}`)) as TrailsResponse;
    },
    ...QUERY_OPTS,
  });

  // Runs carry branch/process (no LOB) and are windowed by start time; only fetched once the tab is opened.
  const runs = useQuery({
    queryKey: ["roster-audit-runs", dateFrom, dateTo, branchId, processId, runStatus, runOffset],
    queryFn: async () => {
      const p = dateParams(new URLSearchParams());
      if (branchId) p.set("branchId", branchId);
      if (processId) p.set("processId", processId);
      if (runStatus !== ALL) p.set("status", runStatus);
      p.set("limit", String(PAGE)); p.set("offset", String(runOffset));
      return (await api.get(`/api/roster-audit/generation-runs?${p}`)) as RunsResponse;
    },
    enabled: tab === "runs",
    ...QUERY_OPTS,
  });

  const s = summary.data;
  const alerts = useMemo(() => buildAlerts(s), [s]);
  const dailyTotals = useMemo(() => (s?.daily ?? []).map((d) => d.total), [s]);
  const dailyOverrides = useMemo(() => (s?.daily ?? []).map((d) => d.overrides), [s]);
  const hasScopeFilters = !!(branchId || processId || lobId);

  const applyAlert = (a: AuditAlert) => {
    if (a.action.tab === "trails") setTp({ sub: "trails", change: a.action.changeType ?? ALL, source: a.action.overridesOnly ? "manual" : ALL, q: "" });
    else setTp({ sub: "runs", runStatus: a.action.runStatus ?? ALL });
  };
  const openSegment = (title: string, params: Record<string, string>) => setSegment({ title, params: { ...params, ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) } });
  const showAllForSegment = () => {
    if (!segment) return;
    const p = segment.params;
    setTp({ sub: "trails", change: p.changeType ?? ALL, source: p.overridesOnly === "1" ? "manual" : ALL, q: "" });
    setSegment(null);
  };

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["roster-audit-summary"] }); void qc.invalidateQueries({ queryKey: ["roster-audit-trails"] }); if (tab === "runs") void qc.invalidateQueries({ queryKey: ["roster-audit-runs"] }); };
  const updated = formatUpdatedAt(summary.dataUpdatedAt);
  const filtersActive = changeType !== ALL || overridesOnly || !!search;
  const clearFilters = () => setTp({ change: ALL, source: ALL, q: "" });

  return (
    <div className="space-y-4">
      <PanelHeader
        icon={History}
        title="Roster Audit Trail"
        description="Every roster decision and manual change, with who made it, when and why"
        updatedLabel={updated ? `Updated ${updated}` : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" className="min-h-[44px] cursor-pointer sm:min-h-8" onClick={refresh} aria-label="Refresh audit data" disabled={summary.isFetching || trails.isFetching}>
              <RefreshCw className={`mr-1 h-4 w-4 ${summary.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />Refresh
            </Button>
            <Button size="sm" className="min-h-[44px] cursor-pointer sm:min-h-8" onClick={() => setAmendOpen(true)}>
              <PenLine className="mr-1 h-4 w-4" aria-hidden />Record amendment
            </Button>
          </>
        }
      />

      {/* Insight strip: most severe first, each click filters the tables below. */}
      {summary.isError ? (
        <ConsoleCard accent="amber" className="flex items-center justify-between gap-2 p-3 text-sm text-slate-800" role="alert">
          <span>Could not load the audit summary.</span>
          <Button variant="outline" size="sm" className="min-h-[44px] cursor-pointer sm:min-h-8" onClick={() => summary.refetch()}>Retry</Button>
        </ConsoleCard>
      ) : alerts.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Audit alerts">
          {alerts.map((a) => {
            const st = SEV_STYLE[a.severity];
            return (
              <li key={a.key}>
                <button type="button" onClick={() => applyAlert(a)} className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-sm sm:min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${st.cls}`}>
                  <st.Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="text-[11px] font-bold uppercase">{st.label}</span>
                  <span><strong className="tabular-nums">{fmtNum(a.count)}</strong> {a.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : s ? (
        <p className="inline-flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden />No failed runs, engine errors or conflicts in this period.</p>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {!s ? (summary.isError ? null : Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[116px] animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" role="status" aria-label="Loading KPI" />)) : (
          <>
            <KpiTile icon={FileText} tone="blue" label="Total changes" value={fmtNum(s.totalChanges)} sub={`${fmtDate(s.period.from)} - ${fmtDate(s.period.to)}`} spark={dailyTotals}
              delta={s.deltas.totalChanges ?? undefined} onClick={() => openSegment("All audit entries", {})} />
            <KpiTile icon={User} tone="violet" label="Manual overrides" value={fmtNum(s.manualOverrides)} sub={s.topActors[0] ? `Top: ${s.topActors[0].name} (${fmtNum(s.topActors[0].count)})` : "No overrides"} spark={dailyOverrides}
              delta={s.deltas.manualOverrides ?? undefined} deltaBad="up" onClick={() => openSegment("Manual overrides", { overridesOnly: "1" })} />
            <KpiTile icon={GitBranch} tone={s.overrideRate >= 10 ? "amber" : "neutral"} label="Override rate" value={`${s.overrideRate}%`} progress={Math.min(100, s.overrideRate)}
              sub={`Previous period ${s.previous.overrideRate}%`} onClick={() => openSegment("Manual overrides", { overridesOnly: "1" })} />
            <KpiTile icon={CheckCircle2} tone="green" label="Generation runs" value={fmtNum(s.generationRuns.total)} sub={`${fmtNum(s.generationRuns.auto)} auto · ${fmtNum(s.generationRuns.manual)} manual`}
              delta={s.deltas.runs ?? undefined} onClick={() => { setRunStatus(ALL); setTab("runs"); }} />
            <KpiTile icon={AlertTriangle} tone={s.generationRuns.totalConflicts > 0 ? "red" : "neutral"} label="Conflicts" value={fmtNum(s.generationRuns.totalConflicts)} sub={`${fmtNum(s.generationRuns.failed)} failed run${s.generationRuns.failed === 1 ? "" : "s"}`}
              delta={s.deltas.conflicts ?? undefined} deltaBad="up" onClick={() => { setRunStatus(ALL); setTab("runs"); }} />
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2" title="Changes per roster day" subtitle="All changes vs manual overrides. Select a day to see its entries." loading={summary.isLoading} error={summary.isError} onRetry={() => summary.refetch()} empty={!s?.daily.length} emptyLabel="No audit entries in this period" height={240}>
          <Suspense fallback={chartFallback}><DailyChangesChart data={s?.daily ?? []} onSelectDay={(d) => setSegment({ title: `Changes on ${fmtDate(d)}`, params: { dateFrom: d, dateTo: d } })} /></Suspense>
        </ChartCard>
        <ChartCard title="Changes by type" subtitle="Select a bar to see its entries" loading={summary.isLoading} error={summary.isError} onRetry={() => summary.refetch()} empty={!s?.byTypeDetail.length} emptyLabel="No audit entries in this period" height={240}>
          <Suspense fallback={chartFallback}><TypeBarChart data={(s?.byTypeDetail ?? []).slice(0, 8)} onSelect={(code) => openSegment(CHANGE_TYPE_OPTIONS.find((o) => o.value === code)?.label ?? code, { changeType: code })} /></Suspense>
        </ChartCard>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "trails" | "runs")}>
        <TabsList>
          <TabsTrigger value="trails" className="min-h-[44px] cursor-pointer sm:min-h-8"><History className="mr-2 h-4 w-4" aria-hidden />Audit trail{trails.data ? ` (${fmtNum(trails.data.total)})` : ""}</TabsTrigger>
          <TabsTrigger value="runs" className="min-h-[44px] cursor-pointer sm:min-h-8"><GitBranch className="mr-2 h-4 w-4" aria-hidden />Generation runs{runs.data ? ` (${fmtNum(runs.data.total)})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="trails" className="mt-3">
          <ConsoleCard>
            <TabToolbar variant="embedded" label="Audit trail filters" onClear={filtersActive ? clearFilters : undefined}>
              <ToolbarSearch value={search} onChange={setSearch} placeholder="Search employee name or code" />
              <ToolbarSelect label="Filter by change type" value={changeType} onChange={setChangeType} options={[{ value: ALL, label: "All change types" }, ...CHANGE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]} />
              <ToolbarSelect label="Filter by source" value={overridesOnly ? "manual" : ALL} onChange={(v) => setOverridesOnly(v === "manual")} options={[{ value: ALL, label: "Engine and manual" }, { value: "manual", label: "Manual overrides only" }]} />
            </TabToolbar>
            {trails.isLoading ? <TableSkeleton label="Loading audit trail" /> : trails.isError ? (
              <div className="flex items-center justify-between gap-2 p-4 text-sm text-slate-700" role="alert"><span>Could not load the audit trail.</span><Button variant="outline" size="sm" className="min-h-[44px] cursor-pointer sm:min-h-8" onClick={() => trails.refetch()}>Retry</Button></div>
            ) : !trails.data?.trails.length ? (
              <div className="px-4 py-16 text-center text-sm text-slate-600">No audit records match the selected period and filters.</div>
            ) : (
              <>
                <TrailsTable rows={trails.data.trails} onOpen={setTrailId} />
                <Pager offset={trails.data.offset} count={trails.data.count} total={trails.data.total} pageSize={PAGE} onPage={setTrailOffset} busy={trails.isFetching} />
              </>
            )}
          </ConsoleCard>
        </TabsContent>

        <TabsContent value="runs" className="mt-3">
          <ConsoleCard>
            <TabToolbar variant="embedded" label="Generation run filters" onClear={runStatus !== ALL ? () => setRunStatus(ALL) : undefined}>
              <ToolbarSelect label="Filter by run status" value={runStatus} onChange={setRunStatus} options={[{ value: ALL, label: "All statuses" }, ...RUN_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]} />
              <FilterNote>Runs are filtered by start time{hasScopeFilters ? "; LOB is not applied to runs" : ""}</FilterNote>
            </TabToolbar>
            {runs.isLoading ? <TableSkeleton label="Loading generation runs" /> : runs.isError ? (
              <div className="flex items-center justify-between gap-2 p-4 text-sm text-slate-700" role="alert"><span>Could not load generation runs.</span><Button variant="outline" size="sm" className="min-h-[44px] cursor-pointer sm:min-h-8" onClick={() => runs.refetch()}>Retry</Button></div>
            ) : !runs.data?.runs.length ? (
              <div className="px-4 py-16 text-center text-sm text-slate-600">No generation runs in the selected period and scope.</div>
            ) : (
              <>
                <RunsTable rows={runs.data.runs} onOpen={setRunId} />
                <Pager offset={runs.data.offset} count={runs.data.runs.length} total={runs.data.total} pageSize={PAGE} onPage={setRunOffset} busy={runs.isFetching} />
              </>
            )}
          </ConsoleCard>
        </TabsContent>
      </Tabs>

      <TrailDrawer id={trailId} onClose={() => setTrailId(null)} onOpenRun={(id) => { setTrailId(null); setRunId(id); }} />
      <RunDrawer id={runId} onClose={() => setRunId(null)} onOpenTrail={(id) => { setRunId(null); setTrailId(id); }} />
      <SegmentDrawer spec={segment} scope={scope} onClose={() => setSegment(null)} onOpenTrail={(id) => { setSegment(null); setTrailId(id); }} onViewAll={segment && segment.params.dateFrom === dateFrom && segment.params.dateTo === dateTo ? showAllForSegment : undefined} />
      <AmendmentDialog open={amendOpen} onOpenChange={setAmendOpen} scope={scope} />
    </div>
  );
}
