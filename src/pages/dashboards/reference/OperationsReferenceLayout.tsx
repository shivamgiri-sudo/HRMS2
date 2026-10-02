import { useState, type ReactNode } from "react";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { ActionCenter, InsightGrid, KpiTiles, LazySection, SectionTitle, SignalList, type InsightKpi } from "../kit";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { GapNotes } from "./gap/GapNotes";
import { FteVsRequired } from "./operations/FteVsRequired";
import { OperationsClassicPanels } from "./operations/OperationsClassicPanels";
import { OperationsHeroBlock } from "./operations/OperationsHeroBlock";
import { OperationsPulseTiles } from "./operations/OperationsPulseTiles";
import { ProcessBoard } from "./operations/ProcessBoard";
import { tableOf } from "./operations/operationsModel";

/**
 * Operations - process control tower.
 *
 * Every people / attendance / shrinkage number is computed by Operations Command (the engine behind
 * /operations-dashboard), so each tile and card links into the exact page that explains it, pre-filtered
 * (branch -> process -> team -> analyst). The summary/pulse tiles paint first; the rest is insight-fed and lazy.
 * The previous panels live on, whole, under "Classic panels".
 */
export function OperationsReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const [classicOpen, setClassicOpen] = useState(false);
  const ins = data.insights;
  const loading = Boolean(data.insightsLoading && !ins);
  const sectionErrors = Object.keys(ins?.sectionErrors ?? {});
  const onDrill = (k: InsightKpi) => data.openDrill?.(k.drill!.metricCode, k.label, k.drill!.filters);
  const tiles = (ins?.kpis ?? []).filter((k) => !k.key.startsWith("pnl_"));
  const pnl = (ins?.kpis ?? []).filter((k) => k.key.startsWith("pnl_"));

  return (
    <div className="space-y-5 pb-10">
      <OperationsHeroBlock insights={ins} loading={loading} filters={filters} />
      <TodayCelebrationsWidget />

      {data.insightsError ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">Operations insights could not be loaded ({data.insightsError}). The live tiles below are unaffected.</p> : null}
      {sectionErrors.length ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">Some sections failed to load and are hidden, not zero: {sectionErrors.join(", ")}.</p> : null}

      <SectionTitle hint="today, from the dialler / pulse feed">Live floor</SectionTitle>
      <OperationsPulseTiles data={data} />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <ActionCenter actions={ins?.actions} loading={loading} error={data.insightsError} title="Operations queues needing action" limit={10} />
          <GapNotes actions={ins?.actions} />
        </div>
        <SignalList signals={ins?.signals} loading={loading} title="What changed / what to watch" />
      </div>

      <SectionTitle hint="30 days to the latest complete processed day vs the prior 30">Vitals</SectionTitle>
      <KpiTiles kpis={tiles} loading={loading} cols={5} onDrill={onDrill} />

      <SectionTitle>Processes</SectionTitle>
      <LazySection minHeight={280}><ProcessBoard table={tableOf(ins, "process_board")} loading={loading} /></LazySection>
      <div className="grid gap-4 xl:grid-cols-2">
        <LazySection><FteVsRequired table={tableOf(ins, "fte_gap")} loading={loading} /></LazySection>
        <LazySection><InsightGrid series={ins?.series} only={["shrink_rank"]} loading={loading} /></LazySection>
      </div>
      <LazySection><InsightGrid series={ins?.series} only={["ops_trend", "att_league_top", "att_league_bottom"]} loading={loading} /></LazySection>

      <SectionTitle hint="SLA / AHT / occupancy come from the process KPI matrix and say how old they are">Service &amp; economics</SectionTitle>
      <LazySection><InsightGrid tables={ins?.tables} only={["service_board", "pnl_lite"]} loading={loading} /></LazySection>
      {pnl.length ? <KpiTiles kpis={pnl} cols={3} onDrill={onDrill} /> : null}
      <LazySection><InsightGrid tables={ins?.tables} only={["quality_interplay"]} loading={loading} /></LazySection>

      <details className="rounded-2xl border border-slate-200 bg-white/60 p-3" onToggle={(e) => setClassicOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer select-none px-2 py-1 text-[13px] font-extrabold uppercase tracking-[.14em] text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Classic panels (every previous datapoint)</summary>
        {classicOpen ? <div className="mt-3"><OperationsClassicPanels data={data} /></div> : null}
      </details>
    </div>
  );
}
