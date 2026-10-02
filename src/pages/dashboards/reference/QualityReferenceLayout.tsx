import { useState, type ReactNode } from "react";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { ActionCenter, InsightGrid, KpiTiles, LazySection, SectionTitle, SignalList, type InsightKpi } from "../kit";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { GapNotes } from "./gap/GapNotes";
import { CoverageMeter } from "./quality/CoverageMeter";
import { LeagueBoard } from "./quality/LeagueBoard";
import { QualityClassicPanels } from "./quality/QualityClassicPanels";
import { QualityHeroBlock } from "./quality/QualityHeroBlock";
import { QualitySummaryTiles } from "./quality/QualitySummaryTiles";
import { tableOf } from "./quality/qualityModel";

/**
 * Quality - audit control room.
 *
 * Insights read db_audit.call_quality_assessment (scored calls) against db_external.CallDetails (all analysed calls),
 * so coverage and pending audits are measured against real call volume. Fail rate by parameter divides by calls where
 * the parameter was EVALUATED. The summary tiles paint first (month-to-date, labelled); the rest is insight-fed and lazy.
 * The previous panels live on, whole, under "Classic panels".
 */
export function QualityReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const [classicOpen, setClassicOpen] = useState(false);
  const ins = data.insights;
  const loading = Boolean(data.insightsLoading && !ins);
  const sectionErrors = Object.keys(ins?.sectionErrors ?? {});
  const onDrill = (k: InsightKpi) => data.openDrill?.(k.drill!.metricCode, k.label, k.drill!.filters);
  const sourceLatest = data.quality.source_latest_record ? String(data.quality.source_latest_record).slice(0, 10) : null;

  return (
    <div className="space-y-5 pb-10">
      <QualityHeroBlock insights={ins} loading={loading} filters={filters} />
      <TodayCelebrationsWidget />

      {data.insightsError ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">Quality insights could not be loaded ({data.insightsError}). The summary tiles below are unaffected.</p> : null}
      {sectionErrors.length ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">Some sections failed to load and are hidden, not zero: {sectionErrors.join(", ")}.</p> : null}
      {sourceLatest ? <p className="text-[12px] text-slate-500">Latest audited call in the source: {sourceLatest} · db_audit.call_quality_assessment</p> : null}

      <SectionTitle hint="month to date, from the audit summary">Audit summary</SectionTitle>
      <QualitySummaryTiles data={data} />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <ActionCenter actions={ins?.actions} loading={loading} error={data.insightsError} title="Audit & coaching queues" limit={8} />
          <GapNotes actions={ins?.actions} />
        </div>
        <div className="space-y-4">
          <CoverageMeter insights={ins} loading={loading} />
          <SignalList signals={ins?.signals} loading={loading} title="What changed / what to watch" />
        </div>
      </div>

      <SectionTitle hint="rolling 30 days vs the previous 30">Quality vitals</SectionTitle>
      <KpiTiles kpis={ins?.kpis} loading={loading} cols={4} onDrill={onDrill} />

      <SectionTitle>Trend &amp; defects</SectionTitle>
      <LazySection><InsightGrid series={ins?.series} only={["q_trend", "q_volume"]} loading={loading} /></LazySection>
      <LazySection><InsightGrid series={ins?.series} only={["q_defects"]} loading={loading} /></LazySection>

      <SectionTitle>People &amp; processes</SectionTitle>
      <div className="grid gap-4 xl:grid-cols-2">
        <LazySection><LeagueBoard table={tableOf(ins, "q_league")} loading={loading} /></LazySection>
        <LazySection><InsightGrid tables={ins?.tables} only={["q_agents"]} loading={loading} /></LazySection>
      </div>
      <LazySection><InsightGrid tables={ins?.tables} only={["q_fatal", "q_auditors"]} loading={loading} /></LazySection>

      <details className="rounded-2xl border border-slate-200 bg-white/60 p-3" onToggle={(e) => setClassicOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer select-none px-2 py-1 text-[13px] font-extrabold uppercase tracking-[.14em] text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Classic panels (every previous datapoint)</summary>
        {classicOpen ? <div className="mt-3"><QualityClassicPanels data={data} /></div> : null}
      </details>
    </div>
  );
}
