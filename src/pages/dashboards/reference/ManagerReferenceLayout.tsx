import { useState, type ReactNode } from "react";
import { AttritionPulseCard } from "@/components/analytics/attrition/AttritionPulseCard";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { ActionCenter, InsightGrid, KpiTiles, LazySection, SectionTitle, SignalList, type InsightKpi } from "../kit";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { GapNotes } from "./gap/GapNotes";
import { ManagerHeroBlock } from "./manager/ManagerHeroBlock";
import { ManagerSummaryTiles } from "./manager/ManagerSummaryTiles";
import { ManagerClassicPanels } from "./manager/ManagerClassicPanels";
import { PeopleCards } from "./manager/PeopleCards";
import { TeamTodayStrip } from "./manager/TeamTodayStrip";
import { WeekOutStrip } from "./manager/WeekOutStrip";
import { kpiOf, seriesOf, tableOf } from "./manager/managerModel";
import { metricDetail, metricValue } from "../reference-dashboard-model";

/**
 * Manager / Branch Head - "my team today".
 *
 * Summary tiles come from the summary query and paint first; everything under them is fed by
 * GET /api/dashboards/MANAGEMENT_DASHBOARD/insights and sits in lazy sections. Scope is whatever the
 * backend resolved (team = direct + indirect reports, branch head = branch) - this layout never widens it.
 * The previous panels live on, whole, under "Classic panels" so no datapoint was lost.
 */
export function ManagerReferenceLayout({ data, managerName, filters }: { data: ReferenceDashboardData; managerName: string; filters?: ReactNode }) {
  const [classicOpen, setClassicOpen] = useState(false);
  const ins = data.insights;
  const loading = Boolean(data.insightsLoading && !ins);
  const team = metricDetail(data.metrics, "hc", "active") ?? metricValue(data.metrics, "hc");
  const sectionErrors = Object.keys(ins?.sectionErrors ?? {});
  const onDrill = (k: InsightKpi) => data.openDrill?.(k.drill!.metricCode, k.label, k.drill!.filters);
  const tiles = (ins?.kpis ?? []).filter((k) => !["on_leave_today", "live_in", "not_punched"].includes(k.key));

  return (
    <div className="space-y-5 pb-10">
      <ManagerHeroBlock data={data} managerName={managerName} insights={ins} filters={filters} />
      <TodayCelebrationsWidget />

      {data.insightsError ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">Team insights could not be loaded ({data.insightsError}). Headline tiles below are unaffected.</p> : null}
      {sectionErrors.length ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">Some sections failed to load and are hidden, not zero: {sectionErrors.join(", ")}.</p> : null}

      <ManagerSummaryTiles data={data} insights={ins} />

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-3">
          <ActionCenter actions={ins?.actions} loading={loading} error={data.insightsError} title="Needs your action" limit={9} />
          <GapNotes actions={ins?.actions} />
        </div>
        <div className="space-y-4">
          <TeamTodayStrip team={team} loggedIn={kpiOf(ins, "live_in")?.value ?? null} onLeave={kpiOf(ins, "on_leave_today")?.value ?? null} notPunched={kpiOf(ins, "not_punched")?.value ?? null} loading={loading} />
          <SignalList signals={ins?.signals} loading={loading} title="What changed / what to watch" />
        </div>
      </div>

      <SectionTitle hint="vs previous period, with the formula on hover">Team pulse</SectionTitle>
      <KpiTiles kpis={tiles} loading={loading} cols={4} onDrill={onDrill} />

      <SectionTitle>Attendance &amp; availability</SectionTitle>
      <LazySection>
        <InsightGrid series={ins?.series} only={["att_trend", "att_mix"]} loading={loading} />
      </LazySection>
      <LazySection><WeekOutStrip series={seriesOf(ins, "out_week")} list={tableOf(ins, "out_list")} /></LazySection>

      <SectionTitle>Performance &amp; people</SectionTitle>
      <LazySection>
        <InsightGrid tables={ins?.tables} only={["team_kpi", "bottom"]} loading={loading} />
      </LazySection>
      <LazySection><PeopleCards table={tableOf(ins, "risk_list")} loading={loading} /></LazySection>
      <LazySection>
        <InsightGrid tables={ins?.tables} only={["coach_next", "celebrations", "train_due"]} loading={loading} />
      </LazySection>

      <details className="group rounded-2xl border border-slate-200 bg-white/60 p-3" onToggle={(e) => setClassicOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer select-none px-2 py-1 text-[13px] font-extrabold uppercase tracking-[.14em] text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Classic panels (every previous datapoint)</summary>
        {/* Mounted only once opened so its own queries (analytics panel) do not compete with first paint. */}
        {classicOpen ? <div className="mt-3"><ManagerClassicPanels data={data} /></div> : null}
      </details>
      <AttritionPulseCard />
    </div>
  );
}
