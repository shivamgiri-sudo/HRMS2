import {
  BadgeCheck,
  FileCheck2,
  FileX2,
  Hourglass,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  UsersRound,
} from "lucide-react";

import { AIInsightPanel } from "@/components/ai";
import { WorkInboxPanel } from "@/components/dashboard";
import {
  ReferenceHeader,
  ReferenceMetricGrid,
  ReferencePanel,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { asNumber, metricDetail, metricValue } from "../reference-dashboard-model";

export function HrReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const selected = asNumber(data.ats.selected_candidates ?? data.ats.selectedCandidates ?? data.ats.total_selected ?? data.ats.total);
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

      <ReferenceMetricGrid
        columns={5}
        loading={data.loading}
        metrics={[
          { label: "Selected Candidates", value: selected, helper: "Vs Last 30 Days", icon: UserCheck, tone: "blue", trend: variance(selected, previousSelected), href: "/ats" },
          { label: "Onboarding Submitted", value: submitted, helper: "Vs Last 30 Days", icon: FileCheck2, tone: "green", trend: variance(submitted, previousSubmitted), href: "/onboarding" },
          { label: "Onboarding Pending", value: pending, helper: "Awaiting completion or review", icon: Hourglass, tone: "amber", href: "/onboarding" },
          { label: "Onboarding Stuck", value: stuck, helper: "Requires intervention", icon: TriangleAlert, tone: "red", href: "/onboarding" },
          { label: "BGV Pending", value: bgv, helper: "Verification cases open", icon: ShieldCheck, tone: "red", href: "/ats/bgv-verification" },
        ]}
      />

      <div className="grid max-w-[760px] gap-3 sm:grid-cols-2">
        <ReferenceMetricGrid
          columns={2}
          loading={data.loading}
          metrics={[
            { label: "DPDP Withdrawal Requests", value: dpdp, helper: "Privacy requests pending", icon: FileX2, tone: "violet", href: "/compliance/dpdp-withdrawal-admin" },
            { label: "Resignation Discussions Pending", value: resignation, helper: "Manager discussions pending", icon: UsersRound, tone: "amber", href: "/exit/command-center" },
          ]}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <ReferencePanel title="HR Operations AI Briefing" bodyClassName="p-0">
          <AIInsightPanel
            contextType="hr_operations"
            role="hr"
            title="HR Operations AI Briefing"
            enabled={!data.loading}
            data={{ selected_candidates: selected, onboarding_submitted: submitted, onboarding_pending: pending, onboarding_stuck: stuck, bgv_pending: bgv, dpdp_pending: dpdp, resignation_discussion_pending: resignation }}
          />
        </ReferencePanel>

        <WorkInboxPanel maxItems={6} />
      </div>
    </div>
  );
}
