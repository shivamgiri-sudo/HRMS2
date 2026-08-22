import {
  FileCheck2,
  FileX2,
  Hourglass,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  UsersRound,
} from "lucide-react";

import {
  ReferenceHeader,
  ReferenceMetricGrid,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { asNumber, metricDetail, metricUnavailableReason, metricValue } from "../reference-dashboard-model";
import { ReferenceAIBrief, ReferenceWorkInbox } from "./ReferenceOperationalPanels";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import {
  AttendanceBreakdownPanel,
  EsignVerificationPanel,
  ExitPipelinePanel,
  OnboardingFunnelPanel,
  DocumentCompliancePanel,
  TrainingProgressPanel,
  LeaveApprovalPanel,
} from "./ReferenceSharedPanels";

export function HrReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: React.ReactNode }) {
  const m = data.metrics;
  const drill = data.drilldownFor ?? (() => ({}));
  const selected = asNumber(data.ats.selected_candidates ?? data.ats.selectedCandidates ?? data.ats.total_selected);
  const submitted = metricDetail(m, "onb", "submitted");
  const pending = metricDetail(m, "onb", "pending") ?? metricValue(m, "onb");
  const stuck = metricDetail(m, "onb", "stuck");
  const bgv = metricDetail(m, "bgv", "pending") ?? metricValue(m, "bgv");
  const dpdp = metricDetail(m, "dpdp", "pending") ?? metricValue(m, "dpdp");
  const resignation = metricDetail(m, "resign", "pendingDiscussion") ?? metricValue(m, "resign");
  // Several HR sources (DPDP withdrawals, name-match, TAT) hold no rows in production.
  // Those tiles must say so rather than rendering a confident "0".
  const onbReason = metricUnavailableReason(m, "onb");

  // These four were already fetched on every HR dashboard load and then discarded, so
  // the request was paid for and the panel stayed thin. All are backed by rows in
  // production: appointment letters, joining-document checklists, headcount, attendance.
  const headcount = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const attendanceRate = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const appointmentEsign = metricDetail(m, "appointmentEsign", "pending") ?? metricValue(m, "appointmentEsign");
  const joiningDocs = metricDetail(m, "joiningDocEsign", "pending") ?? metricValue(m, "joiningDocEsign");
  const joiningDocsOverdue = metricDetail(m, "joiningDocEsign", "overdue");
  const nameMismatch = metricDetail(m, "nm", "blocking") ?? metricValue(m, "nm");
  const tatOpen = metricDetail(m, "tat", "open") ?? metricValue(m, "tat");
  const tatOverdue = metricDetail(m, "tat", "overdue");
  const previousSelected = asNumber(data.ats.previous_selected ?? data.ats.last_30_selected);
  const previousSubmitted = asNumber(data.ats.previous_submitted ?? data.ats.last_30_submitted);

  const variance = (current: number | null, previous: number | null) => {
    if (current === null || previous === null || previous === 0) return null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader title="HR Dashboard" subtitle="Recruitment, onboarding, BGV and exit management" badge="HR View" right={filters} />
      <TodayCelebrationsWidget />

      <ReferenceMetricGrid columns={5} loading={data.loading} metrics={[
        { label: "Selected Candidates", value: selected, helper: previousSelected === null ? "Current reporting window" : "Vs Last 30 Days", icon: UserCheck, tone: "blue", trend: variance(selected, previousSelected), href: "/ats/dashboard" },
        { label: "Onboarding Submitted", value: submitted, helper: previousSubmitted === null ? "Current reporting window" : "Vs Last 30 Days", icon: FileCheck2, tone: "green", trend: variance(submitted, previousSubmitted), href: "/onboarding" },
        // Both tiles keyed the same drilldown ("onb") with no filter, so either one opened
        // an identical, everything-included status breakdown instead of scoping to what
        // the clicked tile actually claims. The bucket filter narrows the drawer's own
        // query to just that tile's status set — see drillOnboarding.
        { label: "Onboarding Pending", value: pending, helper: "Awaiting completion or review", icon: Hourglass, tone: "amber", href: "/onboarding", unavailableReason: onbReason, ...drill("onb", { bucket: "pending" }) },
        { label: "Onboarding Stuck", value: stuck, helper: "Requires intervention", icon: TriangleAlert, tone: "red", href: "/onboarding", unavailableReason: onbReason, ...drill("onb", { bucket: "stuck" }) },
        { label: "BGV Pending", value: bgv, helper: "Verification cases open", icon: ShieldCheck, tone: "red", href: "/ats/bgv", unavailableReason: metricUnavailableReason(m, "bgv"), ...drill("bgv") },
      ]} />

      <ReferenceMetricGrid columns={5} loading={data.loading} metrics={[
        { label: "Active Headcount", value: headcount, helper: "Employees currently active", icon: UsersRound, tone: "blue", href: "/employees", unavailableReason: metricUnavailableReason(m, "hc"), ...drill("hc") },
        { label: "Attendance Rate", value: attendanceRate, valueSuffix: "%", helper: "Latest processed attendance day", icon: UserCheck, tone: attendanceRate !== null && attendanceRate >= 85 ? "green" : "amber", unavailableReason: metricUnavailableReason(m, "att"), ...drill("att") },
        { label: "Appointment eSign Pending", value: appointmentEsign, helper: "Awaiting candidate or company signature", icon: FileCheck2, tone: "amber", unavailableReason: metricUnavailableReason(m, "appointmentEsign"), ...drill("appointmentEsign") },
        { label: "Joining Docs Pending", value: joiningDocs, helper: joiningDocsOverdue ? `${joiningDocsOverdue} overdue` : "Checklist items outstanding", icon: FileCheck2, tone: joiningDocsOverdue ? "red" : "amber", href: "/ats/joining-documents-tracker", unavailableReason: metricUnavailableReason(m, "joiningDocEsign"), ...drill("joiningDocEsign") },
        { label: "Resignation Discussions", value: resignation, helper: "Manager discussions pending", icon: UsersRound, tone: "amber", href: "/exit/command-center", unavailableReason: metricUnavailableReason(m, "resign"), ...drill("resign") },
      ]} />

      <div className="grid max-w-[1140px] gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
        <ReferenceMetricGrid columns={3} loading={data.loading} metrics={[
          { label: "DPDP Withdrawal Requests", value: dpdp, helper: "Privacy requests pending", icon: FileX2, tone: "violet", href: "/compliance/dpdp-withdrawal-admin", unavailableReason: metricUnavailableReason(m, "dpdp") },
          { label: "Name Mismatches Blocking", value: nameMismatch, helper: "Blocking employee-code generation", icon: TriangleAlert, tone: "red", href: "/ats/name-consistency", unavailableReason: metricUnavailableReason(m, "nm") },
          { label: "Open TAT Items", value: tatOpen, helper: tatOverdue ? `${tatOverdue} overdue` : "Governance tasks open", icon: Hourglass, tone: tatOverdue ? "red" : "amber", unavailableReason: metricUnavailableReason(m, "tat") },
        ]} />
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1.08fr_0.92fr]">
        <ReferenceAIBrief
          title="Automated HR Operations Summary"
          intro="Here's a summary of recruitment and onboarding operations based on live data."
          actionHref="/reports"
          actionLabel="View Detailed HR Report"
          items={[
            { label: "Selected Candidates", value: selected, text: "Candidates selected in the current reporting window.", icon: UserCheck, tone: "blue" },
            { label: "Onboarding Submitted", value: submitted, text: "Onboarding records submitted and available for review.", icon: FileCheck2, tone: "green" },
            { label: "Onboarding Stuck", value: stuck, text: "Cases pending beyond the configured ageing threshold.", icon: Hourglass, tone: stuck && stuck > 0 ? "red" : "amber" },
            { label: "BGV Pending", value: bgv, text: "Background-verification cases awaiting completion.", icon: ShieldCheck, tone: "red" },
            { label: "DPDP Withdrawals", value: dpdp, text: "Privacy withdrawal requests requiring review.", icon: FileX2, tone: "violet" },
            { label: "Resignation Discussions", value: resignation, text: "Exit requests pending manager discussion.", icon: UsersRound, tone: "amber" },
          ]}
        />
        <ReferenceWorkInbox maxItems={5} />
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2">
        <OnboardingFunnelPanel data={data} />
        <AttendanceBreakdownPanel data={data} />
        <ExitPipelinePanel data={data} />
        <EsignVerificationPanel data={data} />
        <DocumentCompliancePanel data={data} />
        <TrainingProgressPanel data={data} />
        <LeaveApprovalPanel data={data} />
      </div>
    </div>
  );
}
