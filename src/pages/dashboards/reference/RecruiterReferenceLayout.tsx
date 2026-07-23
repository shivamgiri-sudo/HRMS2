import {
  Briefcase,
  Calendar,
  CheckCircle2,
  FileUser,
  Filter,
  Mail,
  TrendingUp,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";

import {
  ReferenceHeader,
  ReferenceListRow,
  ReferenceMetricGrid,
  ReferencePanel,
  ReferenceQuickLink,
} from "../ReferenceDashboardUI";
import { buildRecruitmentFunnel } from "../dashboard-data-contracts";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  formatValue,
  metricValue,
} from "../reference-dashboard-model";

export function RecruiterReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const ats = data.ats;

  // /api/ats/stats returns: total_candidates, by_stage (Record<string,number>), by_source, conversion_rate,
  // open_positions (number), selected_candidates, previous_selected
  const a = ats as Record<string, unknown>;
  const byStage = (a.by_stage ?? {}) as Record<string, number>;

  const totalApplications = asNumber(a.total_candidates ?? a.total_applications ?? metricValue(m, "ats"));
  const walkins = asNumber(a.walkins_today ?? byStage["walk_in"] ?? byStage["Walk In"] ?? byStage["walkin"] ?? a.total_walkins);
  const offers = asNumber(byStage["offered"] ?? byStage["offer_extended"] ?? a.offers_extended ?? a.offers_today);
  const joined = asNumber(
    ((byStage["converted"] ?? 0) + (byStage["Onboarded"] ?? 0) + (byStage["onboarded"] ?? 0)) ||
    (a.joined ?? a.converted)
  );

  const funnelStages = buildRecruitmentFunnel(a);

  const openCount = asNumber(a.open_positions);
  const openPositions = arrayAt(ats, "open_requisitions")
    .concat(Array.isArray(a.open_positions) ? arrayAt(ats, "open_positions") : [])
    .slice(0, 6);

  const recentCandidates = arrayAt(ats, "recent_candidates").concat(arrayAt(ats, "pipeline")).slice(0, 6);

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader
        title="Recruitment Dashboard"
        subtitle="ATS pipeline, walk-ins, offers and joining funnel"
        badge="Recruiter View"
      />

      <ReferenceMetricGrid
        columns={4}
        loading={data.loading}
        metrics={[
          {
            label: "Total Applications",
            value: totalApplications,
            helper: "in active pipeline",
            icon: FileUser,
            tone: "blue",
            trend: m.ats?.variancePct,
          },
          {
            label: "Walk-ins Today",
            value: walkins,
            helper: "on-site candidates",
            icon: Users,
            tone: "violet",
          },
          {
            label: "Offers Extended",
            value: offers,
            helper: "pending acceptance",
            icon: Mail,
            tone: "amber",
          },
          {
            label: "Joined",
            value: joined,
            helper: "offer to onboarding converted",
            icon: CheckCircle2,
            tone: "green",
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <ReferencePanel title="Hiring Funnel" bodyClassName="p-4">
          {totalApplications !== null ? (
            <div className="space-y-3">
              {funnelStages.map((stage) => {
                const maxVal = Math.max(funnelStages[0]?.value ?? 0, 1);
                const pct = maxVal > 0 ? Math.round((stage.value / maxVal) * 100) : 0;
                return (
                  <div key={stage.label} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-right text-xs text-[#61708a]">{stage.label}</span>
                    <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9] h-3">
                      <div
                        className="h-3 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: stage.color }}
                      />
                    </div>
                    <span className="w-10 text-xs font-semibold text-[#0b1f44]">{formatValue(stage.value)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-[#a0aec0]">Recruitment funnel source unavailable</p>
          )}
        </ReferencePanel>

        <ReferencePanel
          title="Open Positions"
          action={<span className="text-xs text-[#61708a]">{formatValue(openCount ?? openPositions.length)} roles</span>}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {openPositions.length > 0 ? openPositions.map((row, i) => (
              <ReferenceListRow
                key={i}
                left={String(row.role ?? row.designation ?? row.position ?? "Role")}
                right={String(row.openings ?? row.count ?? row.vacancies ?? "")}
                sub={String(row.process ?? row.branch ?? row.department ?? "")}
                badge={row.urgency ? String(row.urgency) : undefined}
                badgeTone={String(row.urgency ?? "").toLowerCase() === "urgent" ? "red" : "amber"}
              />
            )) : (
              <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">
                {openCount === 0 ? "No open positions" : "Requisition details unavailable"}
              </p>
            )}
          </div>
        </ReferencePanel>
      </div>

      {recentCandidates.length > 0 && (
        <ReferencePanel
          title="Recent Pipeline Activity"
          action={<span className="text-xs text-[#61708a]">{formatValue(recentCandidates.length)} candidates</span>}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {recentCandidates.map((row, i) => (
              <ReferenceListRow
                key={i}
                left={String(row.candidate_name ?? row.name ?? "Candidate")}
                right={String(row.stage ?? row.status ?? "")}
                sub={String(row.role ?? row.process ?? row.applied_for ?? "")}
                badge={row.source ? String(row.source) : undefined}
                badgeTone="blue"
              />
            ))}
          </div>
        </ReferencePanel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReferenceQuickLink href="/ats/candidates" title="Candidate Pipeline" icon={Users} />
        <ReferenceQuickLink href="/ats/walk-in" title="Walk-in Registry" icon={Calendar} />
        <ReferenceQuickLink href="/ats/offer-approvals" title="Offer Approvals" icon={Briefcase} />
        <ReferenceQuickLink href="/ats/reports" title="ATS Reports" icon={TrendingUp} />
      </div>
    </div>
  );
}
