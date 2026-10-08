import { useMemo } from "react";
import { AttritionPulseCard } from "@/components/analytics/attrition/AttritionPulseCard";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  ActionCenter, InsightGrid, LazySection, SectionTitle, SignalList,
  type InsightAction,
} from "../kit";
import { ReferenceWorkInbox } from "./ReferenceOperationalPanels";
import {
  AttendanceBreakdownPanel, AttendanceExceptionPanel, DocumentCompliancePanel, LiveVsProcessedPanel, OnboardingFunnelPanel, PayrollBlockersPanel,
} from "./ReferenceSharedPanels";
import { CeoBranchLeague } from "./ceo/CeoBranchLeague";
import { CeoHero, NeedsCeoBanner } from "./ceo/CeoHero";
import { CeoPillars } from "./ceo/CeoPillars";
import { CeoKpiPerformance, CeoQualityByProcess } from "./ceo/CeoQuality";
import { CeoTiles } from "./ceo/CeoTiles";
import { attentionFrom, buildCeoModel, drillTo, rankAttention, revenueByBranch, summaryAttention } from "./ceo/ceoModel";

/**
 * CEO cockpit. Composition: hero (headcount headline + live chips + health ring) → the top three things that
 * need the CEO → pending decisions beside the auto-computed signals → revenue / people / quality pillars →
 * an operations & compliance pulse where every tile drills → charts, branch league and quality by process
 * (lazy, below the fold) → the shared breakdown panels that carried the original datapoints.
 *
 * First paint needs only the summary feeds; everything fed by /insights shows skeletons until it lands and
 * degrades per section (a failed section is named, never rendered as a zero).
 *
 * Sources that hold no rows are NOT wired as tiles (a confident 0 is worse than a blank): TAT
 * (task_tat_instance 0 rows), name mismatch (candidate_name_match_summary), incentive (incentive_upload_batch),
 * revenue-at-risk (process_revenue_daily is empty — the tile shows the reason), grievances and escalations (0 rows).
 */
export function CeoReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters: React.ReactNode }) {
  const drill: NonNullable<ReferenceDashboardData["drilldownFor"]> = data.drilldownFor ?? (() => ({}));
  const drillFor = (key: string, f?: Record<string, string>) => drill(key, f).onDrilldown;
  const model = useMemo(() => buildCeoModel(data), [data]);
  const insights = data.insights;
  const loading = Boolean(data.insightsLoading);
  const revenueMap = useMemo(() => revenueByBranch(data.pnl), [data.pnl]);

  // Queues the summary feeds already know (shown before insights land), alongside the insight queues.
  const summaryQueues: InsightAction[] = [
    { id: "q-payroll-data", label: "Employees blocked from payroll (bank / PAN)", count: model.payrollBlocked, severity: model.payrollBlocked ? (model.payrollReadiness !== null && model.payrollReadiness < 75 ? "high" : "normal") : "info", href: drillTo("PAYROLL_READINESS"), group: "Oversight" },
    { id: "q-att-exceptions", label: "Attendance exceptions open", count: model.exceptionsOpen, severity: model.exceptionsOpen ? "normal" : "info", href: drillTo("ATTENDANCE_EXCEPTIONS"), group: "Oversight" },
    { id: "q-onboarding", label: "Joiners awaiting onboarding completion", count: model.onboarding, severity: model.onboarding ? "normal" : "info", href: drillTo("ONBOARDING", { bucket: "pending" }), group: "Oversight" },
    { id: "q-bgv", label: "Candidates awaiting background verification", count: model.bgv, severity: model.bgv ? "normal" : "info", href: drillTo("BGV"), group: "Oversight" },
  ];
  const actions = [...(insights?.actions ?? []), ...summaryQueues.filter((q) => q.count !== null)];
  const attention = rankAttention(attentionFrom(insights?.actions ?? [], insights?.signals ?? [], summaryAttention(model)), 3);
  const sectionErrors = Object.keys(insights?.sectionErrors ?? {});

  return (
    <div className="space-y-4 px-1 sm:px-0">
      <CeoHero model={model} insights={insights} filters={filters} loading={data.loading} />
      <NeedsCeoBanner items={attention} loading={loading || data.loading} />

      {data.insightsError || sectionErrors.length ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {data.insightsError ? `Insights unavailable: ${data.insightsError}.` : `Some insight sections could not load (${sectionErrors.join(", ")}) — the rest is live.`} Summary figures are unaffected.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7"><ActionCenter actions={actions} loading={loading && !actions.length} title="Waiting on the CEO" subtitle={undefined} limit={9} error={data.insightsError} /></div>
        <div className="xl:col-span-5"><SignalList signals={insights?.signals} loading={loading} title="Good / bad — computed" /></div>
      </div>

      <SectionTitle hint="revenue · people · quality">Pillars</SectionTitle>
      <CeoPillars data={data} model={model} insights={insights} loading={loading} />

      <SectionTitle hint="every tile opens its records">Operations &amp; compliance pulse</SectionTitle>
      <CeoTiles data={data} model={model} insights={insights} loading={loading} drillFor={drillFor} />

      <LazySection minHeight={420}>
        <div className="space-y-4">
          <SectionTitle hint="from processed attendance and the employee master">Trends</SectionTitle>
          <InsightGrid series={insights?.series} tables={insights?.tables} loading={loading} only={["attendance_30d", "flow_12m", "attrition_trend", "exit_stages", "exit_types", "understaffed"]} />
        </div>
      </LazySection>

      <LazySection minHeight={320}>
        <div className="space-y-4">
          <SectionTitle hint="branch drill opens that branch's roster">Branches</SectionTitle>
          <CeoBranchLeague table={insights?.tables.find((t) => t.key === "branch_league")} revenue={revenueMap} loading={loading} />
        </div>
      </LazySection>

      <LazySection minHeight={360}>
        <div className="space-y-4">
          <SectionTitle hint="audited calls, last 30 days">Quality &amp; KPI</SectionTitle>
          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]"><CeoQualityByProcess model={model} /><CeoKpiPerformance data={data} /></div>
        </div>
      </LazySection>

      <div id="ceo-compliance" className="scroll-mt-4">
        <LazySection minHeight={260}>
          <div className="space-y-4">
            <SectionTitle hint="statutory register · payroll run status">Compliance</SectionTitle>
            <InsightGrid tables={insights?.tables} loading={loading} only={["statutory_calendar"]} />
          </div>
        </LazySection>
      </div>

      <LazySection minHeight={300}>
        <div className="space-y-4">
          <SectionTitle hint="the breakdowns behind the tiles">Detail</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <AttendanceBreakdownPanel data={data} />
            <PayrollBlockersPanel data={data} />
            <OnboardingFunnelPanel data={data} />
            <LiveVsProcessedPanel data={data} />
            <AttendanceExceptionPanel data={data} />
            <DocumentCompliancePanel data={data} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2"><ReferenceWorkInbox maxItems={6} /><TodayCelebrationsWidget /></div>
        </div>
      </LazySection>
      <AttritionPulseCard />
    </div>
  );
}
