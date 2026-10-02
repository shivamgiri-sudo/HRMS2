import { LazySection, SectionTitle, SignalList } from "../kit";
import { AttritionPulseCard } from "@/components/analytics/attrition/AttritionPulseCard";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { ExitAnalyticsPanel } from "@/components/dashboard/hr/ExitAnalyticsPanel";
import { ReferenceWorkInbox } from "./ReferenceOperationalPanels";
/*
 * DocumentCompliancePanel and TrainingProgressPanel were dropped from this layout by 81075104 ("remove all
 * dummy data") as collateral, restored later: HR is the role that acts on both (1,043 of 1,117 onboarding
 * requirements hold no document). Each reads `data.metrics` and renders an explicit "unavailable" reason
 * rather than a zero.
 */
import { DocumentCompliancePanel, TrainingProgressPanel } from "./ReferenceSharedPanels";
import { HrActionBoard } from "./hr/HrActionBoard";
import { HrHero } from "./hr/HrHero";
import { HrOnboardingAttendanceSection, HrPeopleSection, HrWorkforceSection } from "./hr/HrInsightSections";
import { HrApprovalStages, HrAtsStagePanel, HrAttendanceTodayPanel, HrBranchMixPanel, HrLeavePanel, HrRatesPanel, HrRecentJoinersPanel } from "./hr/HrLegacyPanels";
import { HrMovementTiles, HrPipelineTiles } from "./hr/HrTiles";

/**
 * HR dashboard: people-ops command centre. Hero + live action queues first (summary and insights are
 * separate queries, so the hero and pipeline tiles paint before the insights arrive); everything below the
 * fold is lazy. Every tile opens a drill-down drawer or the page that owns the work.
 */
export function HrReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: React.ReactNode }) {
  // Typed fallback: `(() => ({}))` infers `{}`, which widens the union and breaks `drill(...).onDrilldown`.
  const drill: NonNullable<ReferenceDashboardData["drilldownFor"]> = data.drilldownFor ?? (() => ({}));
  const insightsLoading = data.insightsLoading === true && !data.insights;
  const headcountDrill = drill("hc").onDrilldown;

  return (
    <div className="space-y-5">
      <HrHero data={data} filters={filters} onHeadcountDrill={headcountDrill} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <HrActionBoard insights={data.insights} loading={insightsLoading} error={data.insightsError} />
        <SignalList signals={data.insights?.signals} loading={insightsLoading} title="What the numbers say" />
      </div>

      <SectionTitle hint="30-day movement, corrected">People pulse</SectionTitle>
      <HrMovementTiles data={data} />

      <SectionTitle hint="from the summary; click any tile">Pipeline and compliance</SectionTitle>
      <HrPipelineTiles data={data} />

      <LazySection minHeight={420}><HrWorkforceSection data={data} /></LazySection>
      <LazySection minHeight={420}><HrOnboardingAttendanceSection data={data} extra={<HrAtsStagePanel data={data} />} /></LazySection>
      <LazySection minHeight={420}><HrPeopleSection data={data} /></LazySection>

      <SectionTitle hint="existing HR panels, kept">Workforce detail</SectionTitle>
      <LazySection minHeight={260}>
        <div className="grid gap-4 lg:grid-cols-3">
          <HrRatesPanel data={data} />
          <HrAttendanceTodayPanel data={data} />
          <HrLeavePanel data={data} />
        </div>
      </LazySection>
      <LazySection minHeight={260}>
        <div className="grid gap-4 lg:grid-cols-2">
          <HrRecentJoinersPanel data={data} />
          <HrBranchMixPanel data={data} />
        </div>
      </LazySection>
      <LazySection minHeight={300}>
        <div className="grid gap-4 lg:grid-cols-2">
          <DocumentCompliancePanel data={data} />
          <TrainingProgressPanel data={data} />
        </div>
      </LazySection>
      <LazySection minHeight={200}><HrApprovalStages data={data} /></LazySection>
      <LazySection minHeight={260}><ReferenceWorkInbox maxItems={5} /></LazySection>
      <LazySection minHeight={320}><ExitAnalyticsPanel /></LazySection>
      <div className="mb-4 empty:hidden"><AttritionPulseCard /></div>
    </div>
  );
}
