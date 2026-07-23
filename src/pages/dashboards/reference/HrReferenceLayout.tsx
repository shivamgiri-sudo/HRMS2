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
import { asNumber, metricDetail, metricValue } from "../reference-dashboard-model";
import { ReferenceAIBrief, ReferenceWorkInbox } from "./ReferenceOperationalPanels";

export function HrReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const selected = asNumber(data.ats.selected_candidates ?? data.ats.selectedCandidates ?? data.ats.total_selected);
  const submitted = metricDetail(m, "onb", "submitted");
  const pending = metricDetail(m, "onb", "pending") ?? metricValue(m, "onb");
  const stuck = metricDetail(m, "onb", "stuck");
  const bgv = metricDetail(m, "bgv", "pending") ?? metricValue(m, "bgv");
  const dpdp = metricDetail(m, "dpdp", "pending") ?? metricValue(m, "dpdp");
  const resignation = metricDetail(m, "resign", "pendingDiscussion") ?? metricValue(m, "resign");
  const previousSelected = asNumber(data.ats.previous_selected ?? data.ats.last_30_selected);
  const previousSubmitted = asNumber(data.ats.previous_submitted ?? data.ats.last_30_submitted);

  const variance = (current: number | null, previous: number | null) => {
    if (current === null || previous === null || previous === 0) return null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader title="HR Dashboard" subtitle="Recruitment, onboarding, BGV and exit management" badge="HR View" />

      <ReferenceMetricGrid columns={5} loading={data.loading} metrics={[
        { label: "Selected Candidates", value: selected, helper: previousSelected === null ? "Current reporting window" : "Vs Last 30 Days", icon: UserCheck, tone: "blue", trend: variance(selected, previousSelected), href: "/ats/dashboard" },
        { label: "Onboarding Submitted", value: submitted, helper: previousSubmitted === null ? "Current reporting window" : "Vs Last 30 Days", icon: FileCheck2, tone: "green", trend: variance(submitted, previousSubmitted), href: "/onboarding" },
        { label: "Onboarding Pending", value: pending, helper: "Awaiting completion or review", icon: Hourglass, tone: "amber", href: "/onboarding" },
        { label: "Onboarding Stuck", value: stuck, helper: "Requires intervention", icon: TriangleAlert, tone: "red", href: "/onboarding" },
        { label: "BGV Pending", value: bgv, helper: "Verification cases open", icon: ShieldCheck, tone: "red", href: "/ats/bgv" },
      ]} />

      <div className="grid max-w-[760px] gap-3 sm:grid-cols-2">
        <ReferenceMetricGrid columns={2} loading={data.loading} metrics={[
          { label: "DPDP Withdrawal Requests", value: dpdp, helper: "Privacy requests pending", icon: FileX2, tone: "violet", href: "/compliance/dpdp-withdrawal-admin" },
          { label: "Resignation Discussions Pending", value: resignation, helper: "Manager discussions pending", icon: UsersRound, tone: "amber", href: "/exit/command-center" },
        ]} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
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
    </div>
  );
}
