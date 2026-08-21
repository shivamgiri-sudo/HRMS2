import {
  Activity,
  Award,
  BadgeCheck,
  Fingerprint,
  IndianRupee,
  ShieldAlert,
  Target,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react";

import {
  ReferenceActionStrip,
  ReferenceHeader,
  ReferenceLineChart,
  ReferenceListRow,
  ReferenceMetricGrid,
  ReferencePanel,
  ReferenceProgress,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  formatCurrency,
  formatValue,
  metricDetail,
  metricUnavailableReason,
  metricValue,
  numberAt,
  read,
} from "../reference-dashboard-model";
import { ReferenceAIBrief, ReferenceWorkInbox } from "./ReferenceOperationalPanels";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { RosterPublishHealthWidget } from "@/components/dashboard/widgets/RosterPublishHealthWidget";
import {
  AttendanceBreakdownPanel,
  LiveVsProcessedPanel,
  OnboardingFunnelPanel,
  PayrollBlockersPanel,
  AttendanceExceptionPanel,
  DocumentCompliancePanel,
} from "./ReferenceSharedPanels";

export function CeoReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters: React.ReactNode }) {
  const m = data.metrics;
  const drill = data.drilldownFor ?? (() => ({}));
  const active = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const attendance = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const shrinkage = numberAt(data.workforce, "summary", "shrinkage_pct");
  // `organisationRevenue` is not a key the P&L service returns (see
  // bpo-pnl.service.ts) — it was always undefined, so the Revenue Gap helper line
  // permanently read "Revenue risk" instead of the actual revenue figure.
  const revenue = numberAt(data.pnl, "kpis", "recognizedRevenue") ?? numberAt(data.pnl, "kpis", "organisationRevenue");
  const revenueGap = numberAt(data.pnl, "kpis", "revenueAtRisk") ?? numberAt(data.pnl, "kpis", "revenueGapMtd");
  // The page-level "Data as of" control (ReferenceDashboardUI's UpdatedControl)
  // reflects /api/dashboards/{code}/summary's generatedAt, not the P&L cache's
  // own — the two can legitimately differ (30s vs 60s TTL, different fetch
  // times), so a CEO could see a fresher-looking page timestamp than the
  // revenue figure actually is. pnl/summary's own generatedAt is stamped once
  // when the allocation summary is computed and reused as-is on every cache
  // hit (see getCachedAllocationSummary in canonical-pnl.service.ts), so it
  // correctly reflects when this specific number was last computed.
  const pnlGeneratedAt = read(data.pnl, "generatedAt");
  const pnlAsOf = typeof pnlGeneratedAt === "string" && pnlGeneratedAt
    ? new Date(pnlGeneratedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;
  const certified = numberAt(data.workforce, "training", "certified_learners") ?? numberAt(data.workforce, "training", "certifiedLearners");
  const onboarding = metricDetail(m, "onb", "pending") ?? metricValue(m, "onb");
  const bgv = metricDetail(m, "bgv", "pending") ?? metricValue(m, "bgv");
  // docCompliance is already in the CEO bundle and drives the Document Coverage
  // panel below; surfacing it as a tile fills one of the slots vacated by the
  // three removed metrics rather than leaving the grid short.
  const docCoverage = metricDetail(m, "docCompliance", "coveragePct");
  const ready = metricDetail(m, "payroll", "readyCount") ?? metricValue(m, "payroll");
  const blocked = metricDetail(m, "payroll", "blockerCount");
  const totalPayroll = ready !== null && blocked !== null ? ready + blocked : null;
  const payrollReadiness = totalPayroll && ready !== null ? Math.round((ready / totalPayroll) * 1000) / 10 : metricDetail(m, "payroll", "readinessPct");
  const resignation = metricDetail(m, "resign", "pendingDiscussion") ?? metricValue(m, "resign");
  const qualityScore = asNumber(data.quality.org_quality_score ?? data.quality.average_score ?? data.quality.score);
  const qualityTarget = asNumber(data.quality.target ?? data.quality.target_score);
  const riskAgents = asNumber(data.quality.risk_agents ?? data.quality.at_risk_agents);
  const processRows = arrayAt(data.quality, "processes").length ? arrayAt(data.quality, "processes") : arrayAt(data.quality, "scorecard");
  const orgScore = asNumber(data.orgKpi.org_average_score ?? data.orgKpi.average_score ?? data.orgKpi.score);
  const bestProcess = read(data.orgKpi, "best_process") as Record<string, unknown> | undefined;
  const needsAttention = read(data.orgKpi, "needs_attention") as Record<string, unknown> | undefined;
  const kpiTrend = arrayAt(data.orgKpi, "trend").slice(-10).map((row) => ({
    label: String(row.label ?? row.period ?? ""),
    value: Number(row.value ?? row.avg_score ?? row.score ?? 0),
  }));

  return (
    <div className="reference-dashboard-page px-1 sm:px-0">
      <ReferenceHeader title="CEO Dashboard" subtitle="Organisation-wide summary" badge="CEO View" right={filters} />
      <TodayCelebrationsWidget />

      {/*
        TAT Breached, Name Mismatch and Incentive Pending were removed 31-Jul-2026.

        All three read metric keys the CEO bundle never requested, so they rendered a
        permanent em-dash (CEO UAT). Wiring them was the obvious fix and is wrong:
        their source tables are empty in production — task_tat_instance 0 rows,
        candidate_name_match_summary 0, incentive_upload_batch 0 — so the tiles would
        have reported a confident "0 TAT breached" and "0 name mismatches" for
        pipelines that are not running at all. A false zero on an executive dashboard
        is worse than a blank one.

        BGV is kept: candidate_bgv_check holds 203 live rows, and `bgv` is now in the
        CEO bundle (dashboard-definition.service.ts), so the tile shows a real figure.

        This removal missed two more tiles reading the same dead keys, in the
        "Bad Insights" panel below (TAT breaches / Name mismatch ReferenceListRows) —
        removed those too. Restore all of them, here and in the bundle, once their
        pipelines feed data.
      */}
      <ReferenceActionStrip title="Today's Operations — Immediate Actions" items={[
        { label: "BGV Pending", value: bgv, detail: "Approvals pending", tone: "red", href: "/ats/bgv", ...drill("bgv") },
        { label: "Onboarding Pending", value: onboarding, detail: "Joiners awaiting completion", tone: "amber", href: "/ats/onboarding-requests", ...drill("onb") },
        { label: "Payroll Readiness", value: payrollReadiness === null ? null : `${payrollReadiness}%`, detail: "Complete pending items", tone: "amber", href: "/payroll/branch-readiness" },
      ]} />

      <ReferenceMetricGrid columns={4} loading={data.loading} metrics={[
        { label: "Attendance Rate", value: attendance, valueSuffix: "%", helper: m.att?.previousValue === null ? "Processed attendance" : "vs previous period", icon: Fingerprint, tone: "blue", trend: m.att?.changePct, unavailableReason: metricUnavailableReason(m, "att"), ...drill("att") },
        { label: "Avg Shrinkage", value: shrinkage, valueSuffix: "%", helper: "vs last 30 days", icon: Activity, tone: shrinkage !== null && shrinkage > 20 ? "red" : "green" },
        { label: "Revenue Gap MTD", value: formatCurrency(revenueGap), helper: (revenue === null ? "Revenue risk" : `Revenue ${formatCurrency(revenue)}`) + (pnlAsOf ? ` · P&L as of ${pnlAsOf}` : ""), icon: IndianRupee, tone: "violet" },
        { label: "Certified Learners", value: certified, helper: "vs last 30 days", icon: BadgeCheck, tone: "amber" },
      ]} />

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-[1.45fr_0.55fr]">
        <div className="grid grid-cols-2 gap-0 overflow-hidden rounded-xl border border-[#e3e9f2] bg-white sm:grid-cols-4">
          {([
            // Name Mismatch, TAT Breached and Incentive Pending removed — see the
            // note above the action strip. Their source tables hold no rows, so the
            // tiles could only ever assert a false zero.
            ["Active Headcount", active, Users, "blue"],
            ["Onboarding Pending", onboarding, UserCheck, "green"],
            ["BGV Pending", bgv, ShieldAlert, "violet"],
            ["Payroll Readiness", payrollReadiness === null ? null : `${payrollReadiness}%`, Target, "violet"],
            ["Resignation Risk", resignation, UserMinus, "red"],
            ["Document Coverage", docCoverage === null ? null : `${docCoverage}%`, BadgeCheck, "green"],
          // as const: without it these heterogeneous tuples widen to one union per slot, so
          // the first element carried the icon component type too and could not be rendered.
          ] as const).map(([label, value, Icon, tone], index) => {
            const IconComponent = Icon as typeof Users;
            return <div key={String(label)} className={`flex min-h-[100px] min-w-0 items-start gap-3 border-[#edf1f6] p-4 ${index % 4 !== 3 ? "sm:border-r" : ""} ${index < 4 ? "border-b" : ""}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone === "green" ? "bg-[#eaf8ef] text-[#16a34a]" : tone === "red" ? "bg-[#fff0f1] text-[#ef4444]" : tone === "violet" ? "bg-[#f3efff] text-[#7c3aed]" : "bg-[#edf4ff] text-[#0b63e5]"}`}><IconComponent className="h-4 w-4" /></span><div className="min-w-0"><p className="text-xs font-semibold leading-4 text-[#1d2b45]">{label}</p><p className="mt-2 text-[21px] font-extrabold leading-none text-[#0b1f44]">{formatValue(value)}</p><p className="mt-2 text-xs text-[#71809a]">Live organisation value</p></div></div>;
          })}
        </div>
        <div className="grid gap-3">
          <ReferenceWorkInbox maxItems={5} />
          <RosterPublishHealthWidget compact />
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-[0.62fr_1.05fr]">
        <ReferenceAIBrief title="Automated Executive Summary" actionHref="/reports" items={[
          { label: "Attendance rate", value: attendance === null ? null : `${attendance}%`, text: "Organisation-wide processed attendance rate.", icon: Fingerprint, tone: "blue" },
          { label: "Shrinkage", value: shrinkage === null ? null : `${shrinkage}%`, text: "Average shrinkage based on current workforce and availability.", icon: Activity, tone: shrinkage !== null && shrinkage > 20 ? "red" : "green" },
          { label: "Revenue gap", value: formatCurrency(revenueGap), text: "Month-to-date revenue at risk from the finance P&L summary.", icon: IndianRupee, tone: revenueGap && revenueGap > 0 ? "red" : "green" },
          { label: "Payroll readiness", value: payrollReadiness === null ? null : `${payrollReadiness}%`, text: "Employees with complete bank, PAN and UAN details.", icon: Target, tone: payrollReadiness !== null && payrollReadiness >= 90 ? "green" : "amber" },
        ]} />

        <ReferencePanel title="Good / Bad Insights">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border-r border-[#edf1f6] pr-4"><p className="text-xs font-bold text-[#16a34a]">Good Insights</p><div className="mt-3 space-y-2"><ReferenceListRow icon={UserCheck} title="Attendance rate" subtitle="Processed attendance performance" value={attendance === null ? null : `${attendance}%`} tone="blue" /><ReferenceListRow icon={BadgeCheck} title="Certified learners" subtitle="Training readiness" value={certified} tone="green" /><ReferenceListRow icon={Target} title="Payroll readiness" subtitle="Employee data completeness" value={payrollReadiness === null ? null : `${payrollReadiness}%`} tone={payrollReadiness !== null && payrollReadiness >= 90 ? "green" : "amber"} /></div></div>
            <div><p className="text-xs font-bold text-[#ef4444]">Bad Insights</p><div className="mt-3 space-y-2"><ReferenceListRow icon={IndianRupee} title="Revenue gap" subtitle="MTD revenue at risk" value={formatCurrency(revenueGap)} tone="red" /></div></div>
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1.25fr_0.75fr]">
        <ReferencePanel title="Quality Overview (Last 30 Days)">
          <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-[#e3e9f2] p-4"><p className="text-xs text-[#71809a]">Org Quality Score</p><p className="mt-2 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(qualityScore)}</p></div><div className="rounded-lg border border-[#e3e9f2] p-4"><p className="text-xs text-[#71809a]">Quality vs Target</p><p className="mt-2 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(qualityScore, "%")}</p><ReferenceProgress label={`Target ${formatValue(qualityTarget, "%")}`} value={qualityScore} max={qualityTarget || 100} tone={qualityScore !== null && qualityTarget !== null && qualityScore >= qualityTarget ? "green" : "red"} /></div><div className="rounded-lg border border-[#e3e9f2] p-4"><p className="text-xs text-[#71809a]">Risk Agents</p><p className="mt-2 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(riskAgents)}</p></div></div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-[#e3e9f2]"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-[#f8fafc] text-[#61708a]"><tr><th className="px-3 py-2">Process</th><th>Avg Score</th><th>Agents</th><th>Calls</th><th>Status</th></tr></thead><tbody className="divide-y divide-[#edf1f6]">{processRows.length ? processRows.slice(0, 6).map((row, index) => <tr key={String(row.id ?? index)}><td className="px-3 py-2 font-medium text-[#1d2b45]">{String(row.process_name ?? row.process ?? `Process ${index + 1}`)}</td><td>{formatValue(row.avg_score ?? row.score)}</td><td>{formatValue(row.agents ?? row.agent_count)}</td><td>{formatValue(row.calls ?? row.audit_count)}</td><td className="font-semibold text-[#16a34a]">{String(row.status ?? "—")}</td></tr>) : <tr><td colSpan={5} className="px-3 py-8 text-center text-[#94a3b8]">Quality scorecard is unavailable</td></tr>}</tbody></table></div>
        </ReferencePanel>

        <ReferencePanel title="KPI Performance">
          <div className="grid grid-cols-3 gap-3"><div className="rounded-lg border border-[#e3e9f2] p-4"><p className="text-xs text-[#71809a]">Org Avg KPI Score</p><p className="mt-4 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(orgScore)}<span className="text-xs font-medium text-[#71809a]"> /100</span></p></div><div className="rounded-lg border border-[#d7f0df] bg-[#f2fbf5] p-4"><p className="text-xs text-[#71809a]">Best Process</p><p className="mt-4 text-[15px] font-bold text-[#16a34a]">{String(bestProcess?.name ?? bestProcess?.process_name ?? "—")}</p><p className="mt-3 text-[20px] font-extrabold text-[#0b1f44]">{formatValue(bestProcess?.score)}</p></div><div className="rounded-lg border border-[#fee3c5] bg-[#fff9f2] p-4"><p className="text-xs text-[#71809a]">Needs Attention</p><p className="mt-4 text-[15px] font-bold text-[#f97316]">{String(needsAttention?.name ?? needsAttention?.process_name ?? "—")}</p><p className="mt-3 text-[20px] font-extrabold text-[#0b1f44]">{formatValue(needsAttention?.score)}</p></div></div>
          <div className="mt-4"><ReferenceLineChart data={kpiTrend} height={135} /></div>
        </ReferencePanel>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2">
        <AttendanceBreakdownPanel data={data} />
        <PayrollBlockersPanel data={data} />
        <OnboardingFunnelPanel data={data} />
        <LiveVsProcessedPanel data={data} />
        <AttendanceExceptionPanel data={data} />
        <DocumentCompliancePanel data={data} />
      </div>
    </div>
  );
}
