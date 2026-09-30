import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUserRole } from "@/hooks/useUserRole";
import { OpsDrillTable } from "@/components/operations/OpsDrillTable";
import { OpsEmployeeSheet } from "@/components/operations/OpsEmployeeSheet";
import { OpsCohorts } from "@/components/operations/OpsCohorts";
import { OpsForecast } from "@/components/operations/OpsForecast";
import { OpsFreshness } from "@/components/operations/OpsFreshness";
import { OpsInsights } from "@/components/operations/OpsInsights";
import { OpsFilterBar } from "@/components/operations/OpsFilterBar";
import { OpsHeatmap } from "@/components/operations/OpsHeatmap";
import { OpsKpiStrip } from "@/components/operations/OpsKpiStrip";
import { OpsRankChart } from "@/components/operations/OpsRankChart";
import { OpsSavedViews } from "@/components/operations/OpsSavedViews";
import { OpsScopeBar } from "@/components/operations/OpsScopeBar";
import { OpsPerformanceTab } from "@/components/operations/OpsPerformanceTab";
import { OpsRecordsSheet } from "@/components/operations/OpsRecordsSheet";
import { SelfOperationsScorecard } from "@/components/operations/OpsSelfScorecard";
import { OpsTrendChart } from "@/components/operations/OpsTrendChart";
import { DIMENSIONS, NEXT_DIM, OPS_TABS, type OpsTabId } from "@/components/operations/opsTabs";
import type { OpsDimension, OpsMetricDef, OpsQuery, OpsRecordDomain, OpsRow } from "@/components/operations/opsTypes";
import {
  downloadOpsCsv, useOpsCohorts, useOpsDefinitions, useOpsFilters, useOpsForecast, useOpsFreshness, useOpsHeatmap, useOpsInsights,
  useOpsPerformance, useOpsPrevious, useOpsSummary, useOpsTrend,
  type HeatmapResponse, type Insight, type RecordsRequest,
} from "@/components/operations/useOpsCommand";
import { fmtDate } from "@/components/operations/opsTypes";

const SELF_ONLY_ROLES = new Set(["employee", "agent", "trainee"]);
const DIM_TO_FILTER: Partial<Record<OpsDimension, keyof OpsQuery>> = {
  branch: "branchId", process: "processId", lob: "lobId", manager: "managerId",
};
const DIM_SET = new Set<OpsDimension>(["branch", "process", "lob", "manager", "employee"]);

/** Everything a viewer can change lives in the URL, so a filtered view can be shared as a link. */
function useOpsUrlState() {
  const [sp, setSp] = useSearchParams();
  const tab = (OPS_TABS.some((t) => t.id === sp.get("tab")) ? sp.get("tab") : "overview") as OpsTabId;
  const by = sp.get("by") as OpsDimension | null;
  const query: OpsQuery = {
    from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined,
    branchId: sp.get("branch") ?? undefined, processId: sp.get("process") ?? undefined,
    lobId: sp.get("lob") ?? undefined, managerId: sp.get("manager") ?? undefined,
  };
  const groupBy: OpsDimension = by && DIM_SET.has(by) ? by : query.branchId ? (query.processId ? "manager" : "process") : "branch";

  const patch = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    setSp(p, { replace: true });
  };
  const setQuery = (q: OpsQuery) =>
    patch({ from: q.from, to: q.to, branch: q.branchId, process: q.processId, lob: q.lobId, manager: q.managerId });
  const applySearch = (search: string) => setSp(new URLSearchParams(search), { replace: true });
  return { tab, groupBy, query, patch, setQuery, search: sp.toString(), applySearch };
}

export default function OperationsDashboard() {
  const { data: roleData } = useUserRole();
  const isSelfOnly = !!roleData?.primaryRole && SELF_ONLY_ROLES.has(roleData.primaryRole);

  return (
    <DashboardLayout
      subheader={
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <p className="font-semibold">Operations Command</p>
        </div>
      }
    >
      <div className="p-4 sm:p-6">
        {isSelfOnly && roleData?.employeeId ? <SelfOperationsScorecard employeeId={roleData.employeeId} /> : <OperationsCommand />}
      </div>
    </DashboardLayout>
  );
}

/** True once `loading` has been continuously true for `ms` — used to explain a slow cold start instead of showing a bare spinner. */
function useSlow(loading: boolean, ms: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [loading, ms]);
  return slow;
}

export function OperationsCommand() {
  const { tab, groupBy, query, patch, setQuery, search, applySearch } = useOpsUrlState();
  const [sort, setSort] = useState("hc_closing");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [records, setRecords] = useState<{ req: Omit<RecordsRequest, "offset">; label: string } | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [perfSource, setPerfSource] = useState<"process" | "agent" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [heatMetric, setHeatMetric] = useState<HeatmapResponse["metric"]>("shrinkage");

  const cfg = OPS_TABS.find((t) => t.id === tab)!;
  const isPerf = tab === "performance";
  const isLive = tab === "live";

  const defsQ = useOpsDefinitions();
  const defs = useMemo(() => new Map<string, OpsMetricDef>((defsQ.data?.metrics ?? []).map((m) => [m.id, m])), [defsQ.data]);
  const filters = useOpsFilters(query);
  const summary = useOpsSummary(query, groupBy, sort, dir);
  const previous = useOpsPrevious(query);
  const trend = useOpsTrend(query, true);
  const source = perfSource ?? (groupBy === "all" || groupBy === "branch" || groupBy === "process" ? "process" : "agent");
  const perf = useOpsPerformance(query, groupBy, source, isPerf);
  const insights = useOpsInsights(query, tab === "overview");
  const cohorts = useOpsCohorts(query, tab === "attrition");
  const forecast = useOpsForecast(query, tab === "roster");
  const freshness = useOpsFreshness();
  const heat = useOpsHeatmap(query, groupBy === "employee" ? "manager" : groupBy, heatMetric, tab === "attendance" || tab === "shrinkage");

  const slowLoad = useSlow(summary.isLoading && !summary.data, 4000);
  const period = summary.data?.period ?? filters.data?.period;
  const nameOf = (list: { id: string; name: string }[] | undefined, id?: string) => (id ? list?.find((x) => x.id === id)?.name ?? "selected" : undefined);
  const scopeLabel = [nameOf(filters.data?.branches, query.branchId), nameOf(filters.data?.processes, query.processId), nameOf(filters.data?.lobs, query.lobId), nameOf(filters.data?.managers, query.managerId)].filter(Boolean).join(" › ") || "All in scope";

  const drillInto = (dim: OpsDimension, row: { id: string }) => {
    if (dim === "employee") return setEmployeeId(row.id);
    const key = DIM_TO_FILTER[dim];
    if (!key) return;
    patch({
      [key === "branchId" ? "branch" : key === "processId" ? "process" : key === "lobId" ? "lob" : "manager"]: row.id,
      by: NEXT_DIM[dim],
    });
  };

  const openRecords = (domain: OpsRecordDomain, groupId?: string, dim?: OpsDimension, date?: string, name?: string) =>
    setRecords({
      req: { domain, groupBy: groupId ? dim : undefined, groupId, date },
      label: [scopeLabel, name, date ? fmtDate(date) : null].filter(Boolean).join(" · "),
    });

  const openInsight = (i: Insight) => {
    if (!i.action) return;
    const f = i.action.filter;
    patch({
      tab: i.action.tab === "overview" ? undefined : i.action.tab,
      by: i.action.groupBy,
      ...(f ? { [f.key]: f.id } : {}),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const exportCsv = async () => {
    setExporting(true);
    try { await downloadOpsCsv(query, groupBy, cfg.columns, sort, dir); } finally { setExporting(false); }
  };

  const onSort = (id: string) => {
    if (sort === id) setDir(dir === "desc" ? "asc" : "desc");
    else { setSort(id); setDir("desc"); }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-5">
        <OpsFilterBar query={query} options={filters.data} period={period} onChange={setQuery} />
        <OpsFreshness feeds={freshness.data?.feeds} />

        {summary.data && !summary.data.externalQualityAvailable && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> The external call-quality feed is not responding, so call-quality columns show "—" (not zero). Everything else is live.
          </div>
        )}
        {slowLoad && (
          <div role="status" className="flex items-center gap-3 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm">
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-sky-500 border-t-transparent motion-reduce:animate-none" aria-hidden />
            First look of the session reads several large tables (attendance, roster, exits). It can take up to a minute once, then results are cached and refresh in the background.
          </div>
        )}
        {summary.isError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            Could not load Operations data{(summary.error as { message?: string })?.message ? `: ${(summary.error as { message?: string }).message}` : ""}.
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => patch({ tab: v === "overview" ? undefined : v })} className="sticky top-0 z-30 -mx-1 bg-background/85 px-1 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="overflow-x-auto">
            <TabsList className="h-auto w-max min-w-full flex-nowrap justify-start gap-1">
              {OPS_TABS.map((t) => <TabsTrigger key={t.id} value={t.id} className="shrink-0">{t.label}</TabsTrigger>)}
            </TabsList>
          </div>
        </Tabs>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <OpsScopeBar query={query} options={filters.data} onChange={setQuery} />
            <OpsSavedViews currentSearch={search} onApply={applySearch} />
          </div>
          <p className="text-sm text-muted-foreground">{cfg.blurb}</p>
        </div>

        {tab === "overview" && <OpsInsights insights={insights.data?.insights} loading={insights.isLoading} onOpen={openInsight} />}

        {!isPerf && (
          <OpsKpiStrip
            ids={cfg.kpis} defs={defs} current={summary.data?.totals.current} previous={isLive ? undefined : previous.data?.totals}
            trend={isLive ? undefined : trend.data?.points} loading={summary.isLoading} onOpenRecords={(d) => openRecords(d)}
          />
        )}

        {tab === "roster" && <OpsForecast days={forecast.data?.days} shrinkagePct={forecast.data?.shrinkagePct} mandate={forecast.data?.mandate} />}
        {tab === "attrition" && <OpsCohorts cohorts={cohorts.data?.cohorts} loading={cohorts.isLoading} />}

        {cfg.trend && <OpsTrendChart points={trend.data?.points} series={cfg.trend} />}

        {(tab === "attendance" || tab === "shrinkage") && (
          <OpsHeatmap
            data={heat.data} loading={heat.isLoading} metric={heatMetric} groupBy={groupBy === "employee" ? "manager" : groupBy}
            onMetric={setHeatMetric} onGroupBy={(d) => patch({ by: d })}
            onCell={(date, id, name) => openRecords(heatMetric === "late" ? "late" : "absent", id, groupBy === "employee" ? "manager" : groupBy, date, name)}
          />
        )}

        {isPerf ? (
          <OpsPerformanceTab
            data={perf.data} loading={perf.isLoading} groupBy={groupBy} onGroupBy={(d) => patch({ by: d })}
            onRowClick={(r) => (groupBy === "employee" ? setEmployeeId(r.id) : drillInto(groupBy, r))}
            source={source} onSource={setPerfSource}
          />
        ) : (
          <>
          <OpsRankChart rows={summary.data?.rows ?? []} def={defs.get(sort)} orgValue={summary.data?.totals.current[sort]} noun={DIMENSIONS.find((d) => d.id === groupBy)?.label ?? "group"} onPick={(r) => drillInto(groupBy, r)} />
          <OpsDrillTable
            rows={summary.data?.rows ?? []} totals={summary.data?.totals.current} totalRows={summary.data?.totalRows ?? 0}
            columns={cfg.columns} defs={defs} groupBy={groupBy} sort={sort} dir={dir} loading={summary.isLoading}
            onGroupBy={(d) => patch({ by: d })} onSort={onSort}
            onRowClick={(row: OpsRow) => drillInto(groupBy, row)}
            onCellClick={(domain, row) => openRecords(domain, row.id, groupBy, undefined, row.name)}
            onExport={exportCsv} exporting={exporting}
          />
          </>
        )}
      </div>

      <OpsRecordsSheet query={query} request={records?.req ?? null} scopeLabel={records?.label ?? null} onClose={() => setRecords(null)} onOpenEmployee={setEmployeeId} />
      <OpsEmployeeSheet query={query} employeeId={employeeId} onClose={() => setEmployeeId(null)} />
    </TooltipProvider>
  );
}
