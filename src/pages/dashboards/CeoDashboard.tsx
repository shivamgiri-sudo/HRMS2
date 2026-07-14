import React, { useEffect, useState, useCallback } from "react";
import { AlertCircle, ShieldX, TrendingDown, Activity, Users, DollarSign, TrendingUp, AlertTriangle, Target, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { MovementChart } from "@/components/dashboard/widgets/MovementChart";
import {
  RoleDashboardShell,
  GoodBadInsightPanel,
  DashboardDrilldownDrawer,
  WorkInboxPanel,
  ScopedFilterBar,
  DashboardActionStrip,
  DashboardCard,
} from "@/components/dashboard";
import { InterventionPanel } from "@/components/dashboard/InterventionPanel";
import { MetricTileEnhanced } from "@/components/dashboard/MetricTileEnhanced";
import type { InsightItem } from "@/components/dashboard";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { useExecutiveQualitySummary } from "../../hooks/useExecutiveQuality";
import { useOrgKpiSummary } from "../../hooks/useOrgKpiSummary";
import { AIInsightPanel } from "@/components/ai";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

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
  const [rootCauses, setRootCauses] = useState<any | null>(null);
  const [ownerAccountability, setOwnerAccountability] = useState<any[] | null>(null);

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

  // Load BI + insight data (non-critical, fail silently)
  useEffect(() => {
    let cancelled = false;
    hrmsApi.get("/api/bi/daily-operations-pulse").then((r: any) => { if (!cancelled) setOpsPulse(r.data ?? null); }).catch(() => {});
    hrmsApi.get("/api/bi/revenue-at-risk").then((r: any) => { if (!cancelled) setRevenueRisk(r.data ?? null); }).catch(() => {});
    hrmsApi.get("/api/bi/training-readiness-pulse").then((r: any) => { if (!cancelled) setTrainingPulse(r.data ?? null); }).catch(() => {});
    hrmsApi.get(`/api/dashboards/${DASHBOARD_CODE}/root-causes`).then((r: any) => { if (!cancelled) setRootCauses(r.data ?? null); }).catch(() => {});
    hrmsApi.get(`/api/dashboards/${DASHBOARD_CODE}/owner-accountability`).then((r: any) => { if (!cancelled) setOwnerAccountability(r.data?.accountability ?? null); }).catch(() => {});
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


  const loading = summaryLoading || roleLoading;

  return (
    <DashboardLayout>
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
        {/* IMMEDIATE ACTIONS BAR - Red alert for critical compliance items */}
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

        {/* ROW 1: FINANCIAL HEALTH - CEO's primary concern */}
        <div>
          <h2 className="text-sm font-semibold text-slate-600 mb-3 uppercase tracking-wider">Financial Health</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricTileEnhanced
              label="Revenue (MTD)"
              value={pnlSummary?.kpis?.organisationRevenue ? (pnlSummary.kpis.organisationRevenue / 1000000).toFixed(1) : null}
              unit="M"
              status={pnlSummary?.kpis?.organisationRevenue ? "ok" : "unknown"}
              trend={null}
              icon={<DollarSign className="h-4 w-4 text-emerald-600" />}
              higherIsBetter
            />
            <MetricTileEnhanced
              label="Operating Margin"
              value={pnlSummary?.kpis?.operatingMarginPct ?? null}
              unit="%"
              status={
                pnlSummary?.kpis?.operatingMarginPct >= 15 ? "ok" :
                pnlSummary?.kpis?.operatingMarginPct >= 10 ? "warn" : "critical"
              }
              trend={null}
              icon={<TrendingUp className="h-4 w-4 text-blue-600" />}
              higherIsBetter
            />
            <MetricTileEnhanced
              label="Revenue at Risk"
              value={revenueRisk?.revenue_at_risk_inr ? (revenueRisk.revenue_at_risk_inr / 1000000).toFixed(1) : null}
              unit="M"
              status={revenueRisk?.revenue_at_risk_inr > 5000000 ? "critical" : revenueRisk?.revenue_at_risk_inr > 2000000 ? "warn" : "ok"}
              icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
              higherIsBetter={false}
            />
            <MetricTileEnhanced
              label="Projected Profit"
              value={pnlSummary?.kpis?.monthEndProjectedProfit ? (pnlSummary.kpis.monthEndProjectedProfit / 1000000).toFixed(1) : null}
              unit="M"
              status={pnlSummary?.kpis?.monthEndProjectedProfit && pnlSummary.kpis.monthEndProjectedProfit > 0 ? "ok" : "critical"}
              icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
              higherIsBetter
            />
          </div>
        </div>

        {/* ROW 2: OPERATIONAL EFFICIENCY - Day-to-day performance indicators */}
        <div>
          <h2 className="text-sm font-semibold text-slate-600 mb-3 uppercase tracking-wider">Operational Efficiency</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricTileEnhanced
              label="Login Adherence"
              value={opsPulse?.login_adherence_pct ?? null}
              unit="%"
              status={opsPulse?.login_adherence_pct >= 90 ? "ok" : opsPulse?.login_adherence_pct >= 80 ? "warn" : "critical"}
              trend={opsPulse?.login_adherence_pct >= 90 ? "up" : "down"}
              icon={<Users className="h-4 w-4 text-blue-600" />}
              higherIsBetter
            />
            <MetricTileEnhanced
              label="Avg Shrinkage"
              value={opsPulse?.avg_shrinkage_pct ?? null}
              unit="%"
              status={opsPulse?.avg_shrinkage_pct <= 18 ? "ok" : opsPulse?.avg_shrinkage_pct <= 25 ? "warn" : "critical"}
              trend={opsPulse?.avg_shrinkage_pct <= 18 ? "down" : "up"}
              icon={<Activity className="h-4 w-4 text-orange-600" />}
              higherIsBetter={false}
            />
            <MetricTileEnhanced
              label="Quality Score"
              value={execQuality?.metrics?.overall_quality_score ?? null}
              unit="%"
              status={
                execQuality?.metrics?.status === "On Track" ? "ok" :
                execQuality?.metrics?.status === "At Risk" ? "warn" : "critical"
              }
              trend={execQuality?.metrics?.trend_7day?.direction === "up" ? "up" : "down"}
              icon={<Target className="h-4 w-4 text-emerald-600" />}
              higherIsBetter
            />
            <MetricTileEnhanced
              label="Active Headcount"
              value={summary?.headcount?.active ?? null}
              unit=""
              status="ok"
              trend="stable"
              icon={<Users className="h-4 w-4 text-slate-600" />}
              higherIsBetter
            />
          </div>
        </div>

        {/* PROCESS P&L SNAPSHOT - Financial deep-dive */}
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

        {/* ROOT CAUSES — What specifically is blocking, not just counts */}
        {rootCauses && (rootCauses.rootCauses?.length > 0) && (
          <DashboardCard title="Root Cause Analysis — Top Blockers">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* TAT breaches */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-red-600 mb-2">TAT Breached</p>
                {rootCauses.rootCauses.filter((r: any) => r.domain === "TAT").length === 0
                  ? <p className="text-xs text-slate-400">No breaches</p>
                  : rootCauses.rootCauses.filter((r: any) => r.domain === "TAT").map((r: any, i: number) => (
                    <div key={i} className="flex items-start justify-between py-1.5 border-b border-slate-100 last:border-0">
                      <span className="text-xs text-slate-700 flex-1">{r.label}</span>
                      <div className="text-right ml-2">
                        <span className="text-xs font-bold text-red-600">{r.count}</span>
                        {r.detail?.maxAgeHours != null && <p className="text-[10px] text-slate-400">{r.detail.maxAgeHours}h max age</p>}
                      </div>
                    </div>
                  ))}
              </div>
              {/* Name mismatches */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-amber-600 mb-2">Name Mismatch (Blocking)</p>
                {rootCauses.rootCauses.filter((r: any) => r.domain === "NAME_MISMATCH").length === 0
                  ? <p className="text-xs text-slate-400">None blocking</p>
                  : rootCauses.rootCauses.filter((r: any) => r.domain === "NAME_MISMATCH").map((r: any, i: number) => (
                    <div key={i} className="py-1.5 border-b border-slate-100 last:border-0">
                      <p className="text-xs font-medium text-slate-700">{r.label}</p>
                      {r.detail && <p className="text-[10px] text-slate-400">Fields: {r.detail}</p>}
                    </div>
                  ))}
              </div>
              {/* Stuck onboarding */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-blue-600 mb-2">Stuck Onboarding</p>
                {rootCauses.rootCauses.filter((r: any) => r.domain === "ONBOARDING").length === 0
                  ? <p className="text-xs text-slate-400">None stuck</p>
                  : rootCauses.rootCauses.filter((r: any) => r.domain === "ONBOARDING").map((r: any, i: number) => (
                    <div key={i} className="py-1.5 border-b border-slate-100 last:border-0">
                      <p className="text-xs font-medium text-slate-700">{r.label}</p>
                      <p className="text-[10px] text-slate-400 capitalize">{r.detail}</p>
                    </div>
                  ))}
              </div>
            </div>
          </DashboardCard>
        )}

        {/* OWNER ACCOUNTABILITY — Which teams are bottlenecks */}
        {ownerAccountability && ownerAccountability.length > 0 && (
          <DashboardCard title="Team Accountability — Work Item Status">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Role / Team</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Pending</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Overdue</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Completed</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Completion %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ownerAccountability.map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800 capitalize">{(row.role ?? "").replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.pending}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={row.overdue > 0 ? "font-bold text-red-600" : "text-slate-400"}>{row.overdue}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-600 font-semibold">{row.completed}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`font-bold ${row.completionRate >= 80 ? "text-emerald-600" : row.completionRate >= 50 ? "text-amber-600" : "text-red-600"}`}>
                          {row.completionRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DashboardCard>
        )}

        {/* WORKFORCE MOVEMENT — Joins vs exits trend */}
        <MovementChart />

        {/* INSIGHTS & WORK INBOX - Side-by-side contextual information */}
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

        {/* SECONDARY SECTIONS - Collapsed by default, expandable for detail */}
        <details className="group">
          <summary className="cursor-pointer select-none text-base font-semibold text-gray-700 py-3 px-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-2">
            <span className="inline-block transition-transform group-open:rotate-180">▶</span>
            Quality Overview & Process Performance (Last 30 Days)
          </summary>
          <div className="mt-4 pt-4 border-t border-gray-200">
            {execQuality && execQuality.process_performance && execQuality.process_performance.length > 0 && (
              <div className="space-y-4">
                {/* Summary cards */}
                {execQuality.metrics && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
          </div>
        </details>

        <details className="group">
          <summary className="cursor-pointer select-none text-base font-semibold text-gray-700 py-3 px-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-2">
            <span className="inline-block transition-transform group-open:rotate-180">▶</span>
            KPI Performance — {orgKpi?.periodLabel || "Current Period"}
          </summary>
          <div className="mt-4 pt-4 border-t border-gray-200">
            {orgKpi && (
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
            )}
          </div>
        </details>
      </div>

      <DashboardDrilldownDrawer
        open={drilldown.open}
        onClose={closeDrilldown}
        metricCode={drilldown.metricCode}
        metricName={drilldown.metricName}
        dashboardCode={DASHBOARD_CODE}
      />
    </RoleDashboardShell>
    </DashboardLayout>
  );
}
