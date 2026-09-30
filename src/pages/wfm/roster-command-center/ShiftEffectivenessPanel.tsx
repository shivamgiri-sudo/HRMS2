/**
 * Shift Effectiveness (Roster Command Center, tab=shifts).
 * Calculations: backend shift-effectiveness.calc.ts; insight/KPI roll-ups: ./shift-effectiveness/insights.ts.
 * Windows: last 30 completed days (ending yesterday) vs the 30 days before, shown in the header.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Calendar, Coffee, Info, Lightbulb, OctagonAlert, RefreshCw, Star, Target, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";
import { HEAVY_QUERY_OPTIONS, HEAVY_QUERY_TIMEOUT_MS, UpdatedStamp, useRefreshFlags } from "./heavyQuery";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { KpiTile, type KpiTone } from "@/components/wfm/console/KpiTile";
import { PanelHeader } from "@/components/wfm/console/PanelHeader";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { scopeParams } from "./filterState";
import { buildInsights, weightedAdherence, weightedQuality, type Insight, type Severity } from "./shift-effectiveness/insights";
import { AdherenceTrendChart, ShiftComparisonChart } from "./shift-effectiveness/lazyCharts";
import { BreaksTab, RecommendationsTab, ShiftsTable } from "./shift-effectiveness/Tabs";
import { EmployeeDrawer, ShiftDrawer } from "./shift-effectiveness/Drawers";
import { MetricDrawer, type MetricKey } from "./shift-effectiveness/MetricDrawer";
import { THRESH, fmtDate, fmtPct, toneFor, type BreakResponse, type Recommendation, type ShiftListResponse } from "./shift-effectiveness/types";

const API = "/api/roster-analytics";
type TabKey = "shifts" | "breaks" | "recommendations";

const SEV: Record<Severity, { icon: React.ElementType; word: string; cls: string }> = {
  critical: { icon: OctagonAlert, word: "Critical", cls: "border-red-300 bg-red-50 text-red-900" },
  warning: { icon: AlertTriangle, word: "Warning", cls: "border-amber-300 bg-amber-50 text-amber-900" },
  info: { icon: Info, word: "Info", cls: "border-blue-200 bg-blue-50 text-blue-900" },
};

function InsightStrip({ insights, loading, onPick }: { insights: Insight[]; loading: boolean; onPick: (i: Insight) => void }) {
  if (loading) return <div className="mb-3 h-11 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" role="status" aria-label="Loading insights" />;
  if (!insights.length) return null;
  const counts = (["critical", "warning", "info"] as Severity[]).map((s) => [s, insights.filter((i) => i.severity === s).length] as const).filter(([, c]) => c > 0);
  return (
    <section aria-label="Insights" className="mb-3 space-y-2">
      <p className="text-xs text-slate-700" aria-live="polite">{counts.map(([s, c]) => `${c} ${SEV[s].word.toLowerCase()}`).join(" · ")}</p>
      <ul className="flex flex-wrap gap-2">
        {insights.map((i) => {
          const S = SEV[i.severity];
          return (
            <li key={i.id}>
              <button type="button" onClick={() => onPick(i)} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:min-h-0 ${S.cls}`}>
                <S.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span><span className="font-bold">{S.word}:</span> {i.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function ShiftEffectivenessPanel() {
  const { filters } = useRosterConsoleFilters();
  const { branchId, processId, lobId } = filters;
  const [tab, setTab] = useState<TabKey>("shifts");
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey | null>(null);

  const { mark, consume } = useRefreshFlags();
  const url = (path: string, flag?: string) => {
    const p = scopeParams({ branchId, processId, lobId });
    if (flag && consume(flag)) p.set("refresh", "1");
    return `${API}/${path}?${p}`;
  };
  const scopeKey = [branchId || "all", processId || "all", lobId || "all"];

  // All three are independent and now cheap enough to run together (no waterfall).
  const shiftsQ = useQuery({
    queryKey: ["shift-effectiveness", "shifts", ...scopeKey],
    queryFn: ({ signal }) => hrmsApi.get<ShiftListResponse>(url("shift-effectiveness", "shifts"), HEAVY_QUERY_TIMEOUT_MS, signal),
    ...HEAVY_QUERY_OPTIONS,
  });
  const breaksQ = useQuery({
    queryKey: ["shift-effectiveness", "breaks", ...scopeKey],
    queryFn: ({ signal }) => hrmsApi.get<BreakResponse>(url("break-compliance", "breaks"), HEAVY_QUERY_TIMEOUT_MS, signal),
    ...HEAVY_QUERY_OPTIONS,
  });
  const recsQ = useQuery({
    queryKey: ["shift-effectiveness", "recommendations", ...scopeKey],
    queryFn: ({ signal }) => hrmsApi.get<{ recommendations: Recommendation[] }>(url("shift-recommendations", "recs"), HEAVY_QUERY_TIMEOUT_MS, signal),
    ...HEAVY_QUERY_OPTIONS,
  });

  const shiftData = shiftsQ.data;
  const breaks = breaksQ.data;
  const recs = useMemo(() => recsQ.data?.recommendations ?? [], [recsQ.data]);
  const shifts = useMemo(() => shiftData?.shifts ?? [], [shiftData]);
  const insights = useMemo(() => buildInsights(shifts, breaks, recs), [shifts, breaks, recs]);
  const avgAdherence = useMemo(() => weightedAdherence(shifts), [shifts]);
  const avgQuality = useMemo(() => weightedQuality(shifts), [shifts]);
  const adherenceSpark = useMemo(() => (shiftData?.daily ?? []).map((d) => d.adherencePct ?? 0), [shiftData]);
  const breakSpark = useMemo(() => (breaks?.daily ?? []).map((d) => d.compliancePct ?? 0), [breaks]);

  const refreshAll = () => {
    mark("shifts", "breaks", "recs");
    void Promise.all([shiftsQ.refetch(), breaksQ.refetch(), recsQ.refetch()]);
  };
  const fetching = shiftsQ.isFetching || breaksQ.isFetching || recsQ.isFetching;
  const openEmployee = (id: string) => { setMetric(null); setShiftId(null); setEmployeeId(id); };
  const openShift = (id: string) => { setMetric(null); setEmployeeId(null); setShiftId(id); };
  const pickInsight = (i: Insight) => (i.target.kind === "shift" ? openShift(i.target.shiftId) : setTab(i.target.tab));

  const bo = breaks?.overall;
  const noBreaks = !breaksQ.isPending && (bo?.sessions ?? 0) === 0;
  const tone = (v: number | null, t: { good: number; warn: number }): KpiTone => toneFor(v, t);
  const w = shiftData?.window.cur;

  return (
    <div>
      <PanelHeader
        icon={BarChart3}
        title="Shift Effectiveness"
        description={w ? `Last 30 completed days (${fmtDate(w.from)} to ${fmtDate(w.to)}) vs the 30 days before. Week-offs, leave, holidays and undecided days are excluded.` : "Shift performance, break compliance and shift-change recommendations"}
        actions={
          <>
            <UpdatedStamp updatedAt={shiftsQ.dataUpdatedAt} fetching={fetching} />
            <Button variant="outline" size="sm" onClick={refreshAll} className="min-h-[44px] cursor-pointer sm:min-h-0" aria-label="Refresh shift effectiveness data">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
            </Button>
          </>
        }
      />

      <InsightStrip insights={insights} loading={shiftsQ.isPending && breaksQ.isPending} onPick={pickInsight} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Shifts analysed" value={shiftsQ.isPending ? "—" : shifts.length} sub="With working days" icon={Calendar} tone="blue" onClick={() => setMetric("shifts")} />
        <KpiTile label="Adherence" value={fmtPct(avgAdherence)} sub="Present or half-day / working days" icon={Target} tone={tone(avgAdherence, THRESH.adherence)} delta={shiftData?.totals.adherenceDelta ?? undefined} deltaBad="down" spark={adherenceSpark} progress={avgAdherence ?? undefined} onClick={() => setMetric("adherence")} />
        <KpiTile label="Quality" value={fmtPct(avgQuality)} sub={avgQuality == null && !shiftsQ.isPending ? "No scored calls in scope" : "Weighted by scored days"} icon={Star} tone={tone(avgQuality, THRESH.quality)} progress={avgQuality ?? undefined} onClick={() => setMetric("quality")} />
        <KpiTile label="Break compliance" value={fmtPct(bo?.compliancePct)} sub={noBreaks ? "No kiosk break data" : `${bo?.avgBreakMinutes ?? "—"} of ${bo?.budgetMinutes ?? "—"} min avg`} icon={Coffee} tone={tone(bo?.compliancePct ?? null, THRESH.breaks)} delta={bo?.delta ?? undefined} deltaBad="down" spark={breakSpark} progress={bo?.compliancePct ?? undefined} onClick={() => setMetric("breaks")} />
        <KpiTile label="Over allowance" value={breaksQ.isPending ? "—" : (bo?.overBreakCount ?? 0)} sub="Employees, last 30 days" icon={Timer} tone={(bo?.overBreakCount ?? 0) > 10 ? "red" : (bo?.overBreakCount ?? 0) > 0 ? "amber" : "green"} onClick={() => setMetric("overBreak")} />
        <KpiTile label="Recommendations" value={recsQ.isPending ? "—" : recs.length} sub="Shift changes to review" icon={Lightbulb} tone="violet" onClick={() => setMetric("recs")} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <ChartCard className="lg:col-span-3" title="Daily adherence" subtitle="All shifts. Dashed lines mark 90% and 75%." height={260} loading={shiftsQ.isPending} error={shiftsQ.error} onRetry={() => void shiftsQ.refetch()} empty={!shiftData?.daily.length} emptyLabel="No working days in the last 30 days for this scope">
          <AdherenceTrendChart data={shiftData?.daily ?? []} />
        </ChartCard>
        <ChartCard className="lg:col-span-2" title="Shift comparison" subtitle="Click a bar to open the shift" height={260} loading={shiftsQ.isPending} error={shiftsQ.error} onRetry={() => void shiftsQ.refetch()} empty={!shifts.length} emptyLabel="No shift data for the selected filters">
          <ShiftComparisonChart shifts={shifts} onSelect={openShift} />
        </ChartCard>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
        <TabsList className="h-auto w-full justify-start sm:w-auto">
          <TabsTrigger value="shifts" className="min-h-[44px] sm:min-h-0">Shifts</TabsTrigger>
          <TabsTrigger value="breaks" className="min-h-[44px] sm:min-h-0">Breaks</TabsTrigger>
          <TabsTrigger value="recommendations" className="min-h-[44px] sm:min-h-0">Recommendations{recs.length ? ` (${recs.length})` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="shifts">
          {shiftsQ.isPending ? <div className="h-48 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" role="status" aria-label="Loading shifts" />
            : shiftsQ.isError ? <p className="rounded-lg border border-border bg-card p-4 text-sm text-red-800" role="alert">Could not load shift data. Use Refresh to retry.</p>
            : !shifts.length ? <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-slate-600">No working days in the last 30 days for the selected filters.</p>
            : <ShiftsTable shifts={shifts} onOpen={openShift} />}
        </TabsContent>
        <TabsContent value="breaks">
          <BreaksTab data={breaks} loading={breaksQ.isPending} error={breaksQ.error} onRetry={() => void breaksQ.refetch()} onOpenShift={openShift} onOpenEmployee={openEmployee} onOpenBreakSummary={() => setMetric("breaks")} />
        </TabsContent>
        <TabsContent value="recommendations">
          <RecommendationsTab recs={recs} loading={recsQ.isPending} onOpenEmployee={openEmployee} />
        </TabsContent>
      </Tabs>

      <MetricDrawer metric={metric} onClose={() => setMetric(null)} shifts={shiftData} breaks={breaks} recs={recs} onOpenShift={openShift} onOpenEmployee={openEmployee} />
      <ShiftDrawer shiftId={shiftId} onClose={() => setShiftId(null)} onOpenEmployee={openEmployee} />
      <EmployeeDrawer employeeId={employeeId} onClose={() => setEmployeeId(null)} />
    </div>
  );
}
