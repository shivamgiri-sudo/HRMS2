import type { ReactNode } from "react";
import { AttritionPulseCard } from "@/components/analytics/attrition/AttritionPulseCard";
import { Radar } from "lucide-react";
import { ActionCenter, DashHero, InsightGrid, LazySection, SectionTitle, SignalList, type HeroStat } from "../kit";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { metricDetail, metricUnavailableReason } from "../reference-dashboard-model";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { useReferenceDashboardShell } from "./ReferenceDashboardShell";
import {
  AttendanceBreakdownPanel, AttendanceExceptionPanel, DocumentCompliancePanel, ExitPipelinePanel, OnboardingFunnelPanel, PayrollBlockersPanel,
} from "./ReferenceSharedPanels";
import { SystemsGrid } from "./superadmin/SystemsGrid";
import { ErrorRates, IncidentFeed, IntegrationRegistry, JobHealth } from "./superadmin/PlatformPanels";
import { DataQuality, SecurityAccess } from "./superadmin/AccessPanels";
import { BlindSpots, ComplianceAlerts, OrgPulse, QuickActions, RecentActivity } from "./superadmin/OrgPulse";
import { countLights, toSystems, type PayrollGap } from "./superadmin/superAdminModel";

/**
 * Super Admin "mission control": system status board first (what is broken right now), then the
 * queues only an admin can clear, platform health detail, access and data quality, and finally the
 * organisation pulse that the old dashboard led with. Hero and org tiles paint from the summary;
 * everything fed by insights shows skeletons until it resolves.
 */
export function SuperAdminReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const { productHeaderControls } = useReferenceDashboardShell();
  const insights = data.insights;
  const loading = Boolean(data.insightsLoading) && !insights;
  const systems = toSystems(insights);
  const lights = countLights(systems);
  const m = data.metrics;
  const actions = insights?.actions ?? [];
  const openActions = actions.filter((a) => (a.count ?? 0) > 0);
  const critical = actions.filter((a) => a.severity === "critical" && (a.count ?? 0) > 0).length;

  // Payroll data gaps stay on the summary bundle (their grace-window logic lives in the metric service).
  const gap = (label: string, key: string, hint: string): PayrollGap => ({ label, count: metricDetail(m, "payroll", key), href: "/payroll", hint });
  const payrollGaps: PayrollGap[] = [
    gap("Employees missing a bank account", "missingBank", "Cannot be paid by NEFT"),
    gap("Employees missing a PAN", "missingPan", "TDS at the higher rate"),
    gap("Employees missing a UAN", "missingUan", "PF cannot be filed"),
  ];
  const unavailablePayroll = metricUnavailableReason(m, "payroll");

  const stats: HeroStat[] = [
    { label: "Down", value: loading ? "…" : lights.down, tone: lights.down ? "bad" : "good" },
    { label: "Degraded", value: loading ? "…" : lights.warn, tone: lights.warn ? "warn" : "good" },
    { label: "Needs action", value: loading ? "…" : openActions.length, tone: critical ? "bad" : "neutral" },
    { label: "Critical queues", value: loading ? "…" : critical, tone: critical ? "bad" : "good", href: "#actions" },
  ];

  return (
    <div className="reference-dashboard-page space-y-5">
      <DashHero
        accent="slate" icon={Radar} eyebrow="Platform mission control" title="Super Admin"
        subtitle="System health, access, data quality and the organisation at a glance"
        headline={{
          label: "Systems healthy",
          value: loading ? "…" : systems.length ? `${lights.ok}/${systems.length}` : "—",
          caption: insights?.healthBasis ?? (unavailablePayroll && !insights ? undefined : "Live probes run each time this page loads (cached for a minute)."),
        }}
        health={{ value: insights?.healthScore ?? null, label: "Platform health", basis: insights?.healthBasis }}
        stats={stats} right={filters ?? productHeaderControls}
      />
      <TodayCelebrationsWidget />

      <SystemsGrid systems={systems} loading={loading} error={data.insightsError} />

      <div id="actions" className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <ActionCenter actions={actions} loading={loading} error={data.insightsError} limit={14} title="Needs an admin" />
        <div className="space-y-4">
          <IncidentFeed insights={insights} loading={loading} />
          <SignalList signals={insights?.signals} loading={loading} title="Insights" />
        </div>
      </div>

      <SectionTitle hint="Error rates and what is running">Platform health</SectionTitle>
      <ErrorRates insights={insights} loading={loading} />
      <div className="grid gap-4 xl:grid-cols-2">
        <LazySection><IntegrationRegistry insights={insights} /></LazySection>
        <LazySection><JobHealth insights={insights} /></LazySection>
      </div>

      <SectionTitle hint="Sign-ins, roles, audit trail">Security and access</SectionTitle>
      <SecurityAccess insights={insights} loading={loading} />

      <SectionTitle hint="Records that block approvals, payroll or notifications">Data quality</SectionTitle>
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <LazySection><DataQuality insights={insights} payrollGaps={payrollGaps} loading={loading} /></LazySection>
        <LazySection><InsightGrid series={(insights?.series ?? []).filter((s) => s.key === "blockers_by_branch")} tables={(insights?.tables ?? []).filter((t) => t.key === "branch_risk")} loading={loading} /></LazySection>
      </div>

      <SectionTitle hint="Headcount, attendance, hiring, payroll">Organisation pulse</SectionTitle>
      <OrgPulse data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <LazySection><AttendanceBreakdownPanel data={data} /></LazySection>
        <LazySection><AttendanceExceptionPanel data={data} /></LazySection>
        <LazySection><PayrollBlockersPanel data={data} /></LazySection>
        <LazySection><DocumentCompliancePanel data={data} /></LazySection>
        <LazySection><OnboardingFunnelPanel data={data} /></LazySection>
        <LazySection><ExitPipelinePanel data={data} /></LazySection>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <LazySection><ComplianceAlerts data={data} /></LazySection>
        <LazySection><RecentActivity data={data} /></LazySection>
        <LazySection><BlindSpots data={data} /></LazySection>
      </div>
      <LazySection><QuickActions /></LazySection>
      <AttritionPulseCard />
    </div>
  );
}

