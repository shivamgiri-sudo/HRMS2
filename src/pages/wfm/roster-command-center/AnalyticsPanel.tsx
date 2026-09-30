/**
 * Roster Analytics (tab=analytics): shrinkage, quality correlation, cost of non-adherence, forecast.
 * Thin shell — queries, insight strip, tabs and the shared drill-down drawer. Sections live in ./analytics/.
 * Backend: /api/roster-analytics/* (see roster-analytics.service.ts and roster-analytics.calc.ts for the formulas).
 */
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, ChevronLeft, ChevronRight, DollarSign, Info, LineChart, RefreshCw, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";
import { TabToolbar, ToolbarSelect } from "@/components/wfm/console/TabToolbar";
import { pickDay, pickOne, useTabParams } from "./useTabParams";
import { PanelHeader } from "@/components/wfm/console/PanelHeader";
import { FilterNote } from "@/components/wfm/console/FilterNote";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { scopeParams } from "./filterState";
import { HEAVY_QUERY_OPTIONS, HEAVY_QUERY_TIMEOUT_MS, UpdatedStamp, useRefreshFlags } from "./heavyQuery";
import { AnalyticsDrawer } from "./analytics/AnalyticsDrawer";
import ShrinkageSection from "./analytics/ShrinkageSection";
import QualitySection from "./analytics/QualitySection";
import CostSection from "./analytics/CostSection";
import ForecastSection from "./analytics/ForecastSection";
import { buildInsights, currentWeekStart, fmtDate, fmtPeriod, previousMonth, recentPeriods, shiftWeek, type Insight } from "./analytics/calc";
import type { CostImpact, DrawerTarget, Forecast, QualityCorrelation, ShrinkageIntelligence } from "./analytics/types";

const ALL = "__all__";
const TAB_KEYS = ["shrinkage", "quality", "cost", "forecast"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const SEV_TONE = { critical: "red", warning: "amber", info: "blue" } as const;
const SEV_LABEL = { critical: "Critical", warning: "Warning", info: "Info" } as const;

function InsightStrip({ items, onPick }: { items: Insight[]; onPick: (i: Insight) => void }) {
  if (!items.length) return null;
  const counts = (["critical", "warning", "info"] as const).map((s) => ({ s, n: items.filter((i) => i.severity === s).length })).filter((c) => c.n);
  return (
    <section aria-label="Insights" className="mb-3 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden />
        <h3 className="text-sm font-semibold text-slate-900">Needs attention</h3>
        {counts.map((c) => <StatusPill key={c.s} tone={SEV_TONE[c.s]}>{c.n} {SEV_LABEL[c.s]}</StatusPill>)}
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => onPick(i)} aria-label={`${SEV_LABEL[i.severity]}: ${i.text}. Open ${i.tab} tab`}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-left text-xs text-slate-800 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-[32px]">
              <StatusPill tone={SEV_TONE[i.severity]}>{SEV_LABEL[i.severity]}</StatusPill>
              <span>{i.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AnalyticsPanel() {
  const { filters } = useRosterConsoleFilters();
  const branchId = filters.branchId || ALL;
  const processId = filters.processId || ALL;
  const lobId = filters.lobId;
  const branchSelected = branchId !== ALL;

  const thisWeek = currentWeekStart();
  const periods = useMemo(() => recentPeriods(12), []);
  const [tp, setTp] = useTabParams({ sub: "shrinkage", week: "", period: "" });
  const weekStart = pickDay(tp.week, thisWeek);
  const setWeekStart = (w: string) => setTp({ week: w === thisWeek ? "" : w });
  const period = pickOne(tp.period, periods, previousMonth());
  const setPeriod = (p: string) => setTp({ period: p === previousMonth() ? "" : p });
  const tab = pickOne(tp.sub, TAB_KEYS, "shrinkage");
  const [visited, setVisited] = useState<Set<TabKey>>(() => new Set([tab]));
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);

  const scope = scopeParams({ branchId: filters.branchId, processId: filters.processId, lobId });
  const scopeQs = scope.toString() ? `&${scope.toString()}` : "";
  const branchScope = new URLSearchParams();
  if (filters.processId) branchScope.set("processId", filters.processId);
  if (lobId && lobId !== ALL) branchScope.set("lobId", lobId);
  const branchQs = branchScope.toString();

  const { mark, consume } = useRefreshFlags();
  const withRefresh = (p: URLSearchParams, key: string) => { if (consume(key)) p.set("refresh", "1"); return p; };

  // Cheap, branch-scoped queries always run in parallel; the two heavy scans start when their tab is first opened.
  const shrinkage = useQuery({
    queryKey: ["roster-analytics", "shrinkage", branchId, processId, lobId, weekStart],
    queryFn: ({ signal }) => hrmsApi.get<ShrinkageIntelligence>(`/api/roster-analytics/shrinkage-intelligence/${branchId}?weekStart=${weekStart}${branchQs ? `&${branchQs}` : ""}`, HEAVY_QUERY_TIMEOUT_MS, signal),
    enabled: branchSelected,
    staleTime: 60_000, placeholderData: keepPreviousData, retry: false, refetchOnWindowFocus: false,
  });
  const forecast = useQuery({
    queryKey: ["roster-analytics", "forecast", branchId, processId, lobId],
    queryFn: ({ signal }) => hrmsApi.get<Forecast>(`/api/roster-analytics/forecast/${branchId}${branchQs ? `?${branchQs}` : ""}`, HEAVY_QUERY_TIMEOUT_MS, signal),
    enabled: branchSelected,
    staleTime: 120_000, placeholderData: keepPreviousData, retry: false, refetchOnWindowFocus: false,
  });
  const quality = useQuery({
    queryKey: ["roster-analytics", "quality", branchId, processId, lobId, period],
    queryFn: ({ signal }) => hrmsApi.get<QualityCorrelation>(`/api/roster-analytics/quality-correlation?${withRefresh(scopeParams({ branchId: filters.branchId, processId: filters.processId, lobId }, { period }), "quality")}`, HEAVY_QUERY_TIMEOUT_MS, signal),
    enabled: visited.has("quality"),
    ...HEAVY_QUERY_OPTIONS,
  });
  const cost = useQuery({
    queryKey: ["roster-analytics", "cost", branchId, processId, lobId, period],
    queryFn: ({ signal }) => hrmsApi.get<CostImpact>(`/api/roster-analytics/cost-impact?${withRefresh(scopeParams({ branchId: filters.branchId, processId: filters.processId, lobId }, { period }), "cost")}`, HEAVY_QUERY_TIMEOUT_MS, signal),
    enabled: visited.has("cost"),
    ...HEAVY_QUERY_OPTIONS,
  });

  const insights = useMemo(() => buildInsights(shrinkage.data, quality.data, cost.data, forecast.data), [shrinkage.data, quality.data, cost.data, forecast.data]);
  const go = (t: TabKey) => { setTp({ sub: t }); setVisited((v) => (v.has(t) ? v : new Set(v).add(t))); };

  const refreshAll = () => {
    mark("quality", "cost");
    void shrinkage.refetch(); void forecast.refetch();
    if (visited.has("quality")) void quality.refetch();
    if (visited.has("cost")) void cost.refetch();
  };
  const updatedAt = Math.max(shrinkage.dataUpdatedAt, forecast.dataUpdatedAt, quality.dataUpdatedAt, cost.dataUpdatedAt);
  const fetching = shrinkage.isFetching || forecast.isFetching || quality.isFetching || cost.isFetching;

  const ctx = { branchId, processId, lobId: lobId || ALL, weekStart, period, scopeQs };
  const open = (t: DrawerTarget) => setDrawer(t);
  const correlationBody = quality.data ? (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">{quality.data.correlation.insight}</p>
      {[quality.data.segments.highAdherence, quality.data.segments.mediumAdherence, quality.data.segments.lowAdherence].map((s) => (
        <div key={s.adherenceRange} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
          <span>Adherence {s.adherenceRange}</span><span className="tabular-nums">{s.count} employees · avg quality {s.count ? s.avgQuality : "—"}</span>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div>
      <PanelHeader icon={BarChart3} title="Roster Analytics" description="Shrinkage patterns, quality correlation, cost impact and forecasting"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <UpdatedStamp updatedAt={updatedAt} fetching={fetching} />
            <Button variant="outline" size="sm" onClick={refreshAll} className="min-h-[44px] cursor-pointer sm:min-h-0" aria-label="Refresh analytics data">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Refresh
            </Button>
          </div>
        } />
      <InsightStrip items={insights} onPick={(i) => go(i.tab)} />

      <Tabs value={tab} onValueChange={(v) => go(v as TabKey)} className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="grid w-full grid-cols-4 lg:w-[560px]">
            <TabsTrigger value="shrinkage" className="min-h-[44px] cursor-pointer gap-1.5 sm:min-h-0"><BarChart3 className="h-4 w-4" aria-hidden />Shrinkage</TabsTrigger>
            <TabsTrigger value="quality" className="min-h-[44px] cursor-pointer gap-1.5 sm:min-h-0"><Target className="h-4 w-4" aria-hidden />Quality</TabsTrigger>
            <TabsTrigger value="cost" className="min-h-[44px] cursor-pointer gap-1.5 sm:min-h-0"><DollarSign className="h-4 w-4" aria-hidden />Cost</TabsTrigger>
            <TabsTrigger value="forecast" className="min-h-[44px] cursor-pointer gap-1.5 sm:min-h-0"><LineChart className="h-4 w-4" aria-hidden />Forecast</TabsTrigger>
          </TabsList>
        </div>

        {tab === "shrinkage" && (
          <TabToolbar label="Shrinkage filters">
            <div className="flex items-center gap-1" role="group" aria-label="Week">
              <Button variant="outline" size="icon" className="h-9 w-9 cursor-pointer" aria-label="Previous week" onClick={() => setWeekStart(shiftWeek(weekStart, -1))}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
              <span className="min-w-[132px] text-center text-xs font-medium tabular-nums text-slate-700">Week of {fmtDate(weekStart)}</span>
              <Button variant="outline" size="icon" className="h-9 w-9 cursor-pointer" aria-label="Next week" disabled={weekStart >= thisWeek} onClick={() => setWeekStart(shiftWeek(weekStart, 1))}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
              {weekStart !== thisWeek && <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setWeekStart(thisWeek)}>This week</Button>}
            </div>
          </TabToolbar>
        )}
        {(tab === "quality" || tab === "cost") && (
          <TabToolbar label="Period filters">
            <ToolbarSelect label="Month for quality and cost" value={period} onChange={setPeriod} options={periods.map((p) => ({ value: p, label: fmtPeriod(p) }))} />
          </TabToolbar>
        )}

        {lobId && <FilterNote />}
        {(tab === "quality" || tab === "cost") && !branchSelected && (
          <p className="flex items-center gap-1.5 text-xs text-slate-600"><Info className="h-3.5 w-3.5" aria-hidden />No branch selected: showing all branches{filters.processId ? " for the chosen process" : ""}.</p>
        )}

        <TabsContent value="shrinkage" className="mt-0">
          <ShrinkageSection branchSelected={branchSelected} data={shrinkage.data} loading={shrinkage.isPending && branchSelected} error={shrinkage.error} onRetry={() => void shrinkage.refetch()} open={open} />
        </TabsContent>
        <TabsContent value="quality" className="mt-0">
          <QualitySection data={quality.data} loading={quality.isPending} error={quality.error} onRetry={() => void quality.refetch()} open={open}
            onSegments={() => open({ type: "correlation", label: "Attendance and quality bands" })} />
        </TabsContent>
        <TabsContent value="cost" className="mt-0">
          <CostSection data={cost.data} loading={cost.isPending} error={cost.error} onRetry={() => void cost.refetch()} open={open} />
        </TabsContent>
        <TabsContent value="forecast" className="mt-0">
          <ForecastSection branchSelected={branchSelected} data={forecast.data} loading={forecast.isPending && branchSelected} error={forecast.error} onRetry={() => void forecast.refetch()} open={open} />
        </TabsContent>
      </Tabs>

      <AnalyticsDrawer target={drawer} onClose={() => setDrawer(null)} ctx={ctx} correlationBody={correlationBody}
        onOpenEmployee={(id, label) => setDrawer({ type: "employee", id, label })} />
    </div>
  );
}
