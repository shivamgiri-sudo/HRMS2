import {
  Activity,
  Award,
  BadgeCheck,
  CircleAlert,
  Fingerprint,
  IndianRupee,
  ShieldAlert,
  Target,
  TriangleAlert,
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
  metricValue,
  numberAt,
  read,
} from "../reference-dashboard-model";
import { ReferenceAIBrief, ReferenceWorkInbox } from "./ReferenceOperationalPanels";

export function CeoReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters: React.ReactNode }) {
  const m = data.metrics;
  const active = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const attendance = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const shrinkage = numberAt(data.workforce, "summary", "shrinkage_pct");
  const revenue = numberAt(data.pnl, "kpis", "organisationRevenue");
  const revenueGap = numberAt(data.pnl, "kpis", "revenueAtRisk") ?? numberAt(data.pnl, "kpis", "revenueGapMtd");
  const certified = numberAt(data.workforce, "training", "certified_learners") ?? numberAt(data.workforce, "training", "certifiedLearners");
  const onboarding = metricDetail(m, "onb", "pending") ?? metricValue(m, "onb");
  const bgv = metricDetail(m, "bgv", "pending") ?? metricValue(m, "bgv");
  const mismatch = metricDetail(m, "nm", "blocking") ?? metricValue(m, "nm");
  const tat = metricDetail(m, "tat", "breached") ?? metricValue(m, "tat");
  const incentiveCount = metricDetail(m, "incentive", "pendingBatches") ?? metricValue(m, "incentive");
  const incentiveAmount = metricDetail(m, "incentive", "pendingAmount");
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
    <div className="reference-dashboard-page">
      <ReferenceHeader title="CEO Dashboard" subtitle="Organisation-wide summary" badge="CEO View" right={filters} />

      <ReferenceActionStrip title="Today's Operations — Immediate Actions" items={[
        { label: "TAT Breached", value: tat, detail: "Tickets waiting beyond SLA", tone: "red", href: "/work-inbox" },
        { label: "BGV Pending", value: bgv, detail: "Approvals pending", tone: "red", href: "/ats/bgv" },
        { label: "Name Mismatch (Blocking)", value: mismatch, detail: "Requires immediate review", tone: "red", href: "/ats/name-consistency" },
        { label: "Incentive Pending", value: incentiveCount, detail: incentiveAmount === null ? "Approvals pending" : `${formatCurrency(incentiveAmount)} pending`, tone: "amber", href: "/payroll/incentives" },
        { label: "Payroll Readiness", value: payrollReadiness === null ? null : `${payrollReadiness}%`, detail: "Complete pending items", tone: "amber", href: "/payroll/branch-readiness" },
      ]} />

      <ReferenceMetricGrid columns={4} loading={data.loading} metrics={[
        { label: "Login Adherence", value: attendance, valueSuffix: "%", helper: "vs yesterday", icon: Fingerprint, tone: "blue", trend: m.att?.variancePct },
        { label: "Avg Shrinkage", value: shrinkage, valueSuffix: "%", helper: "vs last 30 days", icon: Activity, tone: shrinkage !== null && shrinkage > 20 ? "red" : "green" },
        { label: "Revenue Gap MTD", value: formatCurrency(revenueGap), helper: revenue === null ? "Revenue risk" : `Revenue ${formatCurrency(revenue)}`, icon: IndianRupee, tone: "violet" },
        { label: "Certified Learners", value: certified, helper: "vs last 30 days", icon: BadgeCheck, tone: "amber" },
      ]} />

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="grid grid-cols-2 gap-0 overflow-hidden rounded-xl border border-[#e3e9f2] bg-white sm:grid-cols-4">
          {[
            ["Active Headcount", active, Users, "blue"],
            ["Onboarding Pending", onboarding, UserCheck, "green"],
            ["BGV Pending", bgv, ShieldAlert, "violet"],
            ["Name Mismatch (Blocking)", mismatch, CircleAlert, "red"],
            ["TAT Breached", tat, TriangleAlert, "red"],
            ["Incentive Pending", incentiveCount, Award, "amber"],
            ["Payroll Readiness", payrollReadiness === null ? null : `${payrollReadiness}%`, Target, "violet"],
            ["Resignation Risk", resignation, UserMinus, "red"],
          ].map(([label, value, Icon, tone], index) => {
            const IconComponent = Icon as typeof Users;
            return <div key={String(label)} className={`flex min-h-[100px] min-w-0 items-start gap-3 border-[#edf1f6] p-4 ${index % 4 !== 3 ? "sm:border-r" : ""} ${index < 4 ? "border-b" : ""}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone === "green" ? "bg-[#eaf8ef] text-[#16a34a]" : tone === "red" ? "bg-[#fff0f1] text-[#ef4444]" : tone === "amber" ? "bg-[#fff4e8] text-[#f97316]" : tone === "violet" ? "bg-[#f3efff] text-[#7c3aed]" : "bg-[#edf4ff] text-[#0b63e5]"}`}><IconComponent className="h-4 w-4" /></span><div className="min-w-0"><p className="text-[10px] font-semibold leading-4 text-[#1d2b45]">{label}</p><p className="mt-2 text-[21px] font-extrabold leading-none text-[#0b1f44]">{formatValue(value)}</p><p className="mt-2 text-[8px] text-[#71809a]">Live organisation value</p></div></div>;
          })}
        </div>
        <ReferenceWorkInbox maxItems={5} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.62fr_1.05fr]">
        <ReferenceAIBrief title="Executive AI Briefing" actionHref="/reports" items={[
          { label: "Login adherence", value: attendance === null ? null : `${attendance}%`, text: "Organisation-wide attendance and login adherence from finalized attendance records.", icon: Fingerprint, tone: attendance !== null && attendance >= 90 ? "green" : "amber" },
          { label: "Shrinkage", value: shrinkage === null ? null : `${shrinkage}%`, text: "Average shrinkage based on current workforce and availability.", icon: Activity, tone: shrinkage !== null && shrinkage > 20 ? "red" : "green" },
          { label: "Revenue gap", value: formatCurrency(revenueGap), text: "Month-to-date revenue at risk from the finance P&L summary.", icon: IndianRupee, tone: revenueGap && revenueGap > 0 ? "red" : "green" },
          { label: "Payroll readiness", value: payrollReadiness === null ? null : `${payrollReadiness}%`, text: "Employees with complete bank, PAN and UAN details.", icon: Target, tone: payrollReadiness !== null && payrollReadiness >= 90 ? "green" : "amber" },
        ]} />

        <ReferencePanel title="Good / Bad Insights">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border-r border-[#edf1f6] pr-4"><p className="text-[10px] font-bold text-[#16a34a]">Good Insights</p><div className="mt-3 space-y-2"><ReferenceListRow icon={UserCheck} title="Login adherence" subtitle="Organisation attendance performance" value={attendance === null ? null : `${attendance}%`} tone={attendance !== null && attendance >= 90 ? "green" : "amber"} /><ReferenceListRow icon={BadgeCheck} title="Certified learners" subtitle="Training readiness" value={certified} tone="green" /><ReferenceListRow icon={Target} title="Payroll readiness" subtitle="Employee data completeness" value={payrollReadiness === null ? null : `${payrollReadiness}%`} tone={payrollReadiness !== null && payrollReadiness >= 90 ? "green" : "amber"} /></div></div>
            <div><p className="text-[10px] font-bold text-[#ef4444]">Bad Insights</p><div className="mt-3 space-y-2"><ReferenceListRow icon={TriangleAlert} title="TAT breaches" subtitle="Items beyond SLA" value={tat} tone="red" /><ReferenceListRow icon={CircleAlert} title="Name mismatch" subtitle="Blocking records" value={mismatch} tone="red" /><ReferenceListRow icon={IndianRupee} title="Revenue gap" subtitle="MTD revenue at risk" value={formatCurrency(revenueGap)} tone="red" /></div></div>
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <ReferencePanel title="Quality Overview (Last 30 Days)">
          <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-[#e3e9f2] p-4"><p className="text-[9px] text-[#71809a]">Org Quality Score</p><p className="mt-2 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(qualityScore)}</p></div><div className="rounded-lg border border-[#e3e9f2] p-4"><p className="text-[9px] text-[#71809a]">Quality vs Target</p><p className="mt-2 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(qualityScore, "%")}</p><ReferenceProgress label={`Target ${formatValue(qualityTarget, "%")}`} value={qualityScore} max={qualityTarget || 100} tone={qualityScore !== null && qualityTarget !== null && qualityScore >= qualityTarget ? "green" : "red"} /></div><div className="rounded-lg border border-[#e3e9f2] p-4"><p className="text-[9px] text-[#71809a]">Risk Agents</p><p className="mt-2 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(riskAgents)}</p></div></div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-[#e3e9f2]"><table className="w-full min-w-[560px] text-left text-[9px]"><thead className="bg-[#f8fafc] text-[#61708a]"><tr><th className="px-3 py-2">Process</th><th>Avg Score</th><th>Agents</th><th>Calls</th><th>Status</th></tr></thead><tbody className="divide-y divide-[#edf1f6]">{processRows.length ? processRows.slice(0, 6).map((row, index) => <tr key={String(row.id ?? index)}><td className="px-3 py-2 font-medium text-[#1d2b45]">{String(row.process_name ?? row.process ?? `Process ${index + 1}`)}</td><td>{formatValue(row.avg_score ?? row.score)}</td><td>{formatValue(row.agents ?? row.agent_count)}</td><td>{formatValue(row.calls ?? row.audit_count)}</td><td className="font-semibold text-[#16a34a]">{String(row.status ?? "—")}</td></tr>) : <tr><td colSpan={5} className="px-3 py-8 text-center text-[#94a3b8]">Quality scorecard is unavailable</td></tr>}</tbody></table></div>
        </ReferencePanel>

        <ReferencePanel title="KPI Performance">
          <div className="grid grid-cols-3 gap-3"><div className="rounded-lg border border-[#e3e9f2] p-4"><p className="text-[9px] text-[#71809a]">Org Avg KPI Score</p><p className="mt-4 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(orgScore)}<span className="text-[10px] font-medium text-[#71809a]"> /100</span></p></div><div className="rounded-lg border border-[#d7f0df] bg-[#f2fbf5] p-4"><p className="text-[9px] text-[#71809a]">Best Process</p><p className="mt-4 text-[15px] font-bold text-[#16a34a]">{String(bestProcess?.name ?? bestProcess?.process_name ?? "—")}</p><p className="mt-3 text-[20px] font-extrabold text-[#0b1f44]">{formatValue(bestProcess?.score)}</p></div><div className="rounded-lg border border-[#fee3c5] bg-[#fff9f2] p-4"><p className="text-[9px] text-[#71809a]">Needs Attention</p><p className="mt-4 text-[15px] font-bold text-[#f97316]">{String(needsAttention?.name ?? needsAttention?.process_name ?? "—")}</p><p className="mt-3 text-[20px] font-extrabold text-[#0b1f44]">{formatValue(needsAttention?.score)}</p></div></div>
          <div className="mt-4"><ReferenceLineChart data={kpiTrend} height={135} /></div>
        </ReferencePanel>
      </div>
    </div>
  );
}
