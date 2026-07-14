import React, { useEffect, useState, useCallback } from "react";
import { AlertCircle, ShieldX, TrendingDown, Activity, Users } from "lucide-react";
import { Link } from "react-router-dom";
import {
  RoleDashboardShell,
  KpiMetricGrid,
  GoodBadInsightPanel,
  DashboardDrilldownDrawer,
  WorkInboxPanel,
  ScopedFilterBar,
  DashboardActionStrip,
  DashboardCard,
} from "@/components/dashboard";
import { InterventionPanel } from "@/components/dashboard/InterventionPanel";
import { MetricTileEnhanced } from "@/components/dashboard/MetricTileEnhanced";
import type { KpiMetric } from "@/components/dashboard";
import type { InsightItem } from "@/components/dashboard";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { useExecutiveQualitySummary } from "../../hooks/useExecutiveQuality";
import { useOrgKpiSummary } from "../../hooks/useOrgKpiSummary";
import { AIInsightPanel } from "@/components/ai";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";

const DASHBOARD_CODE = "CEO_DASHBOARD";

interface CeoSummary {
  headcount?: { active?: number };
  onboarding?: { pending?: number };
  bgv?: { pending?: number };
  nameMismatch?: { blocking?: number };
  tat?: { breached?: number };
  incentive?: { pendingAmount?: number };
  payroll?: { readyPct?: number };
  resignation?: { pendingDiscussion?: number };
  dpdp?: { pending?: number; overdue?: number; holdsActive?: number };
  appointmentEsign?: { pending?: number; candidatePending?: number; companyPending?: number };
}

interface InsightApiResponse {
  good: { count: number; items: InsightItem[] };
  bad: { count: number; items: InsightItem[] };
}

interface PnlSummaryResponse {
  kpis?: {
    organisationRevenue?: number;
    totalDirectCost?: number;
    totalIndirectCost?: number;
    operatingProfit?: number;
    operatingMarginPct?: number | null;
    mostProfitableProcess?: { processId: string; processName: string; value: number } | null;
    lossMakingProcesses?: number;
    revenueAtRisk?: number;
    monthEndProjectedProfit?: number;
  };
}

interface DrilldownState {
  open: boolean;
  metricCode: string;
  metricName: string;
}

function formatInr(amount: number | undefined): string {
  if (amount === undefined || amount === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function CeoDashboard() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();

  const { data: execQuality } = useExecutiveQualitySummary(30);
  const { data: orgKpi } = useOrgKpiSummary();

  const [summary, setSummary] = useState<CeoSummary | null>(null);
  const [insights, setInsights] = useState<InsightApiResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [drilldown, setDrilldown] = useState<DrilldownState>({
    open: false,
    metricCode: "",
    metricName: "",
  });

  const [branchId, setBranchId] = useState<string>("");
  const [processId, setProcessId] = useState<string>("");

  // BI data
  const [opsPulse, setOpsPulse] = useState<any | null>(null);
  const [revenueRisk, setRevenueRisk] = useState<any | null>(null);
  const [trainingPulse, setTrainingPulse] = useState<any | null>(null);
  const [pnlSummary, setPnlSummary] = useState<PnlSummaryResponse | null>(null);

  const openDrilldown = useCallback((metricCode: string, metricName: string) => {
    setDrilldown({ open: true, metricCode, metricName });
  }, []);

  const closeDrilldown = useCallback(() => {
    setDrilldown((prev) => ({ ...prev, open: false }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    setSummaryLoading(true);
    setFetchError(null);

    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (processId) params.set("processId", processId);
    const qs = params.toString() ? `?${params.toString()}` : "";

    hrmsApi.get(`/api/dashboards/${DASHBOARD_CODE}/summary${qs}`)
      .then((json) => {
        if (!cancelled) setSummary(normalizeDashboardSummary<CeoSummary>(DASHBOARD_CODE, json as any));
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.message ?? "Failed to load dashboard summary.");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    setInsightsLoading(true);
    hrmsApi.get(`/api/dashboards/${DASHBOARD_CODE}/good-bad-insights${qs}`)
      .then((json) => {
        if (!cancelled) setInsights(json?.data ?? json);
      })
      .catch(() => {
        // insights are non-critical, fail silently
        if (!cancelled) setInsights(null);
      })
      .finally(() => {
        if (!cancelled) setInsightsLoading(false);
      });

    hrmsApi.get(`/api/finance/pnl/summary${qs}`)
      .then((json: any) => {
        if (!cancelled) setPnlSummary(json?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setPnlSummary(null);
      });

    return () => {
      cancelled = true;
    };
  }, [branchId, processId]);

  // Load BI data (non-critical, fail silently)
  useEffect(() => {
    let cancelled = false;
    hrmsApi.get("/api/bi/daily-operations-pulse").then((r: any) => { if (!cancelled) setOpsPulse(r.data ?? null); }).catch(() => {});
    hrmsApi.get("/api/bi/revenue-at-risk").then((r: any) => { if (!cancelled) setRevenueRisk(r.data ?? null); }).catch(() => {});
    hrmsApi.get("/api/bi/training-readiness-pulse").then((r: any) => { if (!cancelled) setTrainingPulse(r.data ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Role check
  if (!roleLoading) {
    const allowed = roleData?.roleKeys?.some((r: string) =>
      ["super_admin", "ceo", "coo"].includes(r)
    ) ?? false;
    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="max-w-sm w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <ShieldX className="mx-auto h-12 w-12 text-red-400 mb-4" />
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Access Restricted</h2>
            <p className="text-sm text-slate-500 mb-4">
              This dashboard is only accessible to CEO, COO and Super Admin roles.
            </p>
            <Button asChild variant="outline">
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </div>
        </div>
      );
    }
  }

  const metrics: KpiMetric[] = [
    {
      id: "headcount_active",
      metric: "Active Headcount",
      value: summary?.headcount?.active ?? null,
      unit: "",
      drilldownAvailable: true,
      onClick: () => openDrilldown("headcount_active", "Active Headcount"),
    },
    {
      id: "onboarding_pending",
      metric: "Onboarding Pending",
      value: summary?.onboarding?.pending ?? null,
      unit: "",
      status:
        summary?.onboarding?.pending != null
          ? summary.onboarding.pending > 10
            ? "bad"
            : "neutral"
          : undefined,
      drilldownAvailable: true,
      onClick: () => openDrilldown("onboarding_pending", "Onboarding Pending"),
    },
    {
      id: "bgv_pending",
      metric: "BGV Pending",
      value: summary?.bgv?.pending ?? null,
      unit: "",
      status:
        summary?.bgv?.pending != null
          ? summary.bgv.pending > 5
            ? "bad"
            : "neutral"
          : undefined,
      drilldownAvailable: true,
      onClick: () => openDrilldown("bgv_pending", "BGV Pending"),
    },
    {
      id: "name_mismatch_blocking",
      metric: "Name Mismatch (Blocking)",
      value: summary?.nameMismatch?.blocking ?? null,
      unit: "",
      status:
        summary?.nameMismatch?.blocking != null
          ? summary.nameMismatch.blocking > 0
            ? "bad"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("name_mismatch_blocking", "Name Mismatch — Blocking"),
    },
    {
      id: "tat_breached",
      metric: "TAT Breached",
      value: summary?.tat?.breached ?? null,
      unit: "",
      status:
        summary?.tat?.breached != null
          ? summary.tat.breached > 0
            ? "bad"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("tat_breached", "TAT Breached"),
    },
    {
      id: "incentive_pending",
      metric: "Incentive Pending",
      value:
        summary?.incentive?.pendingAmount != null
          ? formatInr(summary.incentive.pendingAmount)
          : null,
      unit: "",
      drilldownAvailable: true,
      onClick: () => openDrilldown("incentive_pending", "Incentive Pending"),
    },
    {
      id: "payroll_readiness",
      metric: "Payroll Readiness",
      value: summary?.payroll?.readyPct ?? null,
      unit: "%",
      status:
        summary?.payroll?.readyPct != null
          ? summary.payroll.readyPct >= 90
            ? "good"
            : summary.payroll.readyPct >= 70
            ? "neutral"
            : "bad"
          : undefined,
      higherIsBetter: true,
      drilldownAvailable: true,
      onClick: () => openDrilldown("payroll_readiness", "Payroll Readiness"),
    },
    {
      id: "resignation_risk",
      metric: "Resignation Risk (Pending Discussion)",
      value: summary?.resignation?.pendingDiscussion ?? null,
      unit: "",
      status:
        summary?.resignation?.pendingDiscussion != null
          ? summary.resignation.pendingDiscussion > 0
            ? "bad"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("resignation_risk", "Resignation Risk — Pending Discussion"),
    },
  ];

  const loading = summaryLoading || roleLoading;

  return (
    <RoleDashboardShell
      title="CEO Dashboard"
      subtitle="Organisation-wide summary"
      scopeLabel="CEO View"
      loading={loading}
      headerActions={
        <ScopedFilterBar
          onBranchChange={setBranchId}
          onProcessChange={setProcessId}
          onDateRangeChange={() => {}}
          showDateRange={false}
          className="border-0 shadow-none px-0 py-0"
        />
      }
    >
      {fetchError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 mb-4">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {fetchError}
        </div>
      )}

      <div className="space-y-6">
        <DashboardActionStrip
          items={[
            {
              label: "TAT Breached",
              value: summary?.tat?.breached,
              detail: "Tickets waiting beyond SLA",
              tone: "red",
              onClick: () => openDrilldown("tat_breached", "TAT Breached"),
            },
            {
              label: "BGV Pending",
              value: summary?.bgv?.pending,
              detail: "Approvals pending",
              tone: "red",
              onClick: () => openDrilldown("bgv_pending", "BGV Pending"),
            },
            {
              label: "Name Mismatch",
              value: summary?.nameMismatch?.blocking,
              detail: "Requires immediate review",
              tone: "red",
              onClick: () => openDrilldown("name_mismatch_blocking", "Name Mismatch"),
            },
            {
              label: "DPDP Pending",
              value: summary?.dpdp?.pending,
              detail: "Withdrawal requests",
              tone: summary?.dpdp?.overdue ? "red" : "amber",
              onClick: () => openDrilldown("dpdp_withdrawal", "DPDP Withdrawal"),
            },
            {
              label: "Appointment eSign",
              value: summary?.appointmentEsign?.pending,
              detail: "Letters pending sign",
              tone: "amber",
              onClick: () => openDrilldown("appointment_esign_pending", "Appointment eSign"),
            },
          ]}
        />

        {/* Today's Operations Intervention Panel */}
        {opsPulse?.intervention_flags?.length > 0 && (
          <InterventionPanel flags={opsPulse.intervention_flags} title="Today's Operations — Immediate Actions" />
        )}

        {/* BI cross-metric tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricTileEnhanced
            label="Login Adherence"
            value={opsPulse?.login_adherence_pct ?? null}
            unit="%"
            status={opsPulse?.login_adherence_pct >= 90 ? "ok" : opsPulse?.login_adherence_pct >= 80 ? "warn" : "critical"}
            trend={opsPulse ? (opsPulse.login_adherence_pct >= 90 ? "up" : "down") : null}
            icon={<Users className="h-4 w-4 text-blue-600" />}
            higherIsBetter
          />
          <MetricTileEnhanced
            label="Avg Shrinkage"
            value={opsPulse?.avg_shrinkage_pct ?? null}
            unit="%"
            status={opsPulse?.avg_shrinkage_pct <= 18 ? "ok" : opsPulse?.avg_shrinkage_pct <= 25 ? "warn" : "critical"}
            trend={opsPulse ? (opsPulse.avg_shrinkage_pct <= 18 ? "down" : "up") : null}
            icon={<Activity className="h-4 w-4 text-orange-600" />}
            higherIsBetter={false}
          />
          <MetricTileEnhanced
            label="Revenue Gap MTD"
            value={revenueRisk?.gap_pct ?? null}
            unit="%"
            status={revenueRisk?.gap_pct >= 0 ? "ok" : revenueRisk?.gap_pct >= -10 ? "warn" : "critical"}
            trend={revenueRisk ? (revenueRisk.gap_pct >= 0 ? "up" : "down") : null}
            icon={<TrendingDown className="h-4 w-4 text-red-600" />}
            higherIsBetter
          />
          <MetricTileEnhanced
            label="Certified Learners"
            value={trainingPulse?.summary?.certified_pct ?? null}
            unit="%"
            status={trainingPulse?.summary?.certified_pct >= 80 ? "ok" : trainingPulse?.summary?.certified_pct >= 60 ? "warn" : "critical"}
            trend={trainingPulse ? (trainingPulse.summary?.certified_pct >= 80 ? "up" : "down") : null}
            icon={<Users className="h-4 w-4 text-emerald-600" />}
            higherIsBetter
          />
        </div>

        {/* KPI Metrics */}
        <KpiMetricGrid metrics={metrics} columns={3} loading={summaryLoading} />

        {pnlSummary?.kpis && (
          <DashboardCard title="Process P&L Snapshot">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_0.75fr]">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Revenue</p>
                  <p className="mt-2 text-xl font-bold text-emerald-950">{formatInr(pnlSummary.kpis.organisationRevenue)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Direct cost</p>
                  <p className="mt-2 text-xl font-bold text-slate-950">{formatInr(pnlSummary.kpis.totalDirectCost)}</p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Revenue at risk</p>
                  <p className="mt-2 text-xl font-bold text-amber-950">{formatInr(pnlSummary.kpis.revenueAtRisk)}</p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Projected profit</p>
                  <p className="mt-2 text-xl font-bold text-blue-950">{formatInr(pnlSummary.kpis.monthEndProjectedProfit)}</p>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Most profitable process</p>
                  <p className="mt-2 text-lg font-bold text-slate-950">
                    {pnlSummary.kpis.mostProfitableProcess?.processName ?? "No process financial data"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Operating profit {formatInr(pnlSummary.kpis.mostProfitableProcess?.value)}
                  </p>
                  <p className="mt-3 text-sm text-slate-600">
                    Loss-making processes: <span className="font-semibold">{pnlSummary.kpis.lossMakingProcesses ?? 0}</span>
                    {" · "}
                    Margin: <span className="font-semibold">{pnlSummary.kpis.operatingMarginPct?.toFixed(1) ?? "0.0"}%</span>
                  </p>
                </div>
                <div className="mt-4">
                  <Button asChild variant="outline">
                    <Link to="/finance/process-pnl">Open full Process P&L Command Centre</Link>
                  </Button>
                </div>
              </div>
            </div>
          </DashboardCard>
        )}

        <DashboardCard title="Executive AI Briefing">
          <AIInsightPanel
            contextType="ceo_dashboard"
            role="ceo"
            title="Executive AI Briefing"
            enabled={!summaryLoading && summary !== null}
            data={{
              headcount: summary?.headcount?.active,
              onboarding_pending: summary?.onboarding?.pending,
              bgv_pending: summary?.bgv?.pending,
              name_mismatch_blocking: summary?.nameMismatch?.blocking,
              tat_breached: summary?.tat?.breached,
              payroll_readiness_pct: summary?.payroll?.readyPct,
              resignation_pending: summary?.resignation?.pendingDiscussion,
              dpdp_pending: summary?.dpdp?.pending,
              appointment_esign_pending: summary?.appointmentEsign?.pending,
              quality_score: execQuality?.metrics?.overall_quality_score,
              quality_status: execQuality?.metrics?.status,
              org_avg_kpi: orgKpi?.orgAvgScore,
            }}
          />
        </DashboardCard>

        {/* Good / Bad Insights + Work Inbox side by side on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <GoodBadInsightPanel
              good={insights?.good ?? { count: 0, items: [] }}
              bad={insights?.bad ?? { count: 0, items: [] }}
              loading={insightsLoading}
            />
          </div>
          <div className="lg:col-span-1">
            <WorkInboxPanel maxItems={8} />
          </div>
        </div>

        {/* Quality Overview Panel */}
        {execQuality && execQuality.process_performance && execQuality.process_performance.length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-gray-700 mb-3">Quality Overview (Last 30 Days)</h2>

            {/* Summary cards */}
            {execQuality.metrics && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-white rounded-xl p-4 shadow-sm border">
                  <p className="text-xs text-gray-500">Org Quality Score</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {execQuality.metrics.overall_quality_score ?? "—"}%
                  </p>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm border">
                  <p className="text-xs text-gray-500">Quality vs Target</p>
                  <p className={`text-2xl font-bold ${execQuality.metrics.gap_pct >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {execQuality.metrics.gap_pct >= 0 ? "+" : ""}{execQuality.metrics.gap_pct ?? "—"}%
                  </p>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm border">
                  <p className="text-xs text-gray-500">Risk Agents</p>
                  <p className="text-2xl font-bold text-amber-500">
                    {execQuality.risk_summary
                      ? (execQuality.risk_summary.critical_agents_count ?? 0) + (execQuality.risk_summary.at_risk_agents_count ?? 0)
                      : "—"}
                  </p>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm border">
                  <p className="text-xs text-gray-500">Overall Status</p>
                  <p className={`text-lg font-bold ${
                    execQuality.metrics.status === "On Track" ? "text-green-600" :
                    execQuality.metrics.status === "At Risk"  ? "text-amber-500" :
                                                                "text-red-600"
                  }`}>
                    {execQuality.metrics.status ?? "—"}
                  </p>
                </div>
              </div>
            )}

            {/* Process Scorecard Table */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="px-4 py-3 border-b">
                <p className="text-sm font-semibold text-gray-700">Process Quality Scorecard</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Process</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Avg Score</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Agents</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Calls</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {execQuality.process_performance.map((p, i) => (
                      <tr key={p.process || i} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-800">{p.process || "—"}</td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-800">{p.avg_quality}%</td>
                        <td className="px-4 py-2 text-right text-gray-600">{p.agent_count}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{p.calls_handled?.toLocaleString()}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            p.status === "On Track" ? "bg-green-100 text-green-700" :
                            p.status === "At Risk"  ? "bg-amber-100 text-amber-700" :
                                                      "bg-red-100 text-red-700"
                          }`}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* KPI Overview Panel */}
        {orgKpi && (
          <div>
            <h2 className="text-base font-semibold text-gray-700 mb-3">
              KPI Performance — {orgKpi.periodLabel}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl p-4 shadow-sm border">
                <p className="text-xs text-gray-500">Org Avg KPI Score</p>
                <p className="text-2xl font-bold text-blue-600">{orgKpi.orgAvgScore}%</p>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border">
                <p className="text-xs text-gray-500">Best Process</p>
                <p className="text-lg font-bold text-green-600">{orgKpi.topProcess?.processName ?? "—"}</p>
                <p className="text-sm text-gray-500">{orgKpi.topProcess?.avgScore ?? ""}%</p>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border">
                <p className="text-xs text-gray-500">Needs Attention</p>
                <p className="text-lg font-bold text-red-500">{orgKpi.bottomProcess?.processName ?? "—"}</p>
                <p className="text-sm text-gray-500">{orgKpi.bottomProcess?.avgScore ?? ""}%</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <DashboardDrilldownDrawer
        open={drilldown.open}
        onClose={closeDrilldown}
        metricCode={drilldown.metricCode}
        metricName={drilldown.metricName}
        dashboardCode={DASHBOARD_CODE}
      />
    </RoleDashboardShell>
  );
}
