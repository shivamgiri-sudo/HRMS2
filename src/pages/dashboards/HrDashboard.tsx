import React, { useEffect, useState, useCallback } from "react";
import { AlertCircle, ShieldX, TrendingDown, UserMinus, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Link } from "react-router-dom";
import { AtsPipelineChart } from "@/components/dashboard/widgets/AtsPipelineChart";
import { MetricTileEnhanced } from "@/components/dashboard/MetricTileEnhanced";
import {
  RoleDashboardShell,
  KpiMetricGrid,
  DashboardDrilldownDrawer,
  WorkInboxPanel,
  DashboardActionStrip,
  DashboardCard,
} from "@/components/dashboard";
import type { KpiMetric } from "@/components/dashboard";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { AIInsightPanel } from "@/components/ai";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";

const DASHBOARD_CODE = "HR_DASHBOARD";
type DashboardPayload = Parameters<typeof normalizeDashboardSummary>[1];

interface HrSummary {
  selectedCandidates?: number;
  onboarding?: {
    submitted?: number;
    pending?: number;
    stuck?: number;
  };
  bgvPending?: number;
  dpdpWithdrawals?: number;
  dpdpOverdue?: number | null;
  appointmentEsignPending?: number | null;
  joiningDocEsignPending?: number | null;
  joiningDocEsignOverdue?: number | null;
  resignationDiscussionPending?: number;
}

interface DrilldownState {
  open: boolean;
  metricCode: string;
  metricName: string;
}

export default function HrDashboard() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();

  const [summary, setSummary] = useState<HrSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [attritionRisk, setAttritionRisk] = useState<any | null>(null);
  const [exitStats, setExitStats] = useState<any | null>(null);

  const [drilldown, setDrilldown] = useState<DrilldownState>({
    open: false,
    metricCode: "",
    metricName: "",
  });

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

    hrmsApi.get(`/api/dashboards/${DASHBOARD_CODE}/summary`)
      .then((json) => {
        if (!cancelled) setSummary(normalizeDashboardSummary<HrSummary>(DASHBOARD_CODE, json as DashboardPayload));
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.message ?? "Failed to load HR dashboard summary.");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    // Non-critical enrichment data
    hrmsApi.get("/api/bi/attrition-risk-signal").then((r: any) => { if (!cancelled) setAttritionRisk(r.data ?? null); }).catch(() => {});
    hrmsApi.get("/api/exit/stats").then((r: any) => { if (!cancelled) setExitStats(r.data ?? r ?? null); }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // Role check
  if (!roleLoading) {
    const roleKeys = roleData?.roleKeys ?? [];
    const allowed =
      roleKeys.includes("super_admin") ||
      roleKeys.includes("hr") ||
      roleKeys.includes("admin");
    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="max-w-sm w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <ShieldX className="mx-auto h-12 w-12 text-red-400 mb-4" />
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Access Restricted</h2>
            <p className="text-sm text-slate-500 mb-4">
              This dashboard is only accessible to HR and Admin roles.
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
      id: "onboarding_submitted",
      metric: "Onboarding Submitted",
      value: summary?.onboarding?.submitted ?? null,
      unit: "",
      drilldownAvailable: true,
      onClick: () => openDrilldown("onboarding_submitted", "Onboarding Submitted"),
    },
    {
      id: "onboarding_pending",
      metric: "Onboarding Pending",
      value: summary?.onboarding?.pending ?? null,
      unit: "",
      status:
        summary?.onboarding?.pending != null
          ? summary.onboarding.pending > 5
            ? "bad"
            : summary.onboarding.pending > 0
            ? "neutral"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("onboarding_pending", "Onboarding Pending"),
    },
    {
      id: "onboarding_stuck",
      metric: "Onboarding Stuck",
      value: summary?.onboarding?.stuck ?? null,
      unit: "",
      status:
        summary?.onboarding?.stuck != null
          ? summary.onboarding.stuck > 0
            ? "bad"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("onboarding_stuck", "Onboarding Stuck"),
    },
    {
      id: "bgv_pending",
      metric: "BGV Pending",
      value: summary?.bgvPending ?? null,
      unit: "",
      status:
        summary?.bgvPending != null
          ? summary.bgvPending > 5
            ? "bad"
            : summary.bgvPending > 0
            ? "neutral"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("bgv_pending", "BGV Pending"),
    },
    {
      id: "resignation_pending",
      metric: "Resignation Discussions Pending",
      value: summary?.resignationDiscussionPending ?? null,
      unit: "",
      status:
        summary?.resignationDiscussionPending != null
          ? summary.resignationDiscussionPending > 0
            ? "bad"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () =>
        openDrilldown("resignation_pending", "Resignation Discussions Pending"),
    },
    {
      id: "dpdp_withdrawals",
      metric: "DPDP Withdrawal Requests",
      value: summary?.dpdpWithdrawals ?? null,
      unit: "",
      status:
        summary?.dpdpOverdue != null && summary.dpdpOverdue > 0
          ? "bad"
          : summary?.dpdpWithdrawals != null && summary.dpdpWithdrawals > 0
            ? "neutral"
            : "good",
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("dpdp_withdrawal", "DPDP Withdrawal Requests"),
    },
    {
      id: "appointment_esign_pending",
      metric: "Appointment e-Sign Pending",
      value: summary?.appointmentEsignPending ?? null,
      unit: "",
      status:
        summary?.appointmentEsignPending != null
          ? summary.appointmentEsignPending > 0
            ? "neutral"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("appointment_esign_pending", "Appointment e-Sign Pending"),
    },
  ].filter((metric) => metric.value !== null && metric.value !== undefined);

  const loading = summaryLoading || roleLoading;

  return (
    <DashboardLayout>
    <RoleDashboardShell
      title="HR Dashboard"
      subtitle="Recruitment, onboarding, BGV and exit management"
      scopeLabel="HR View"
      loading={loading}
    >
      {fetchError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 mb-4">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {fetchError}
        </div>
      )}

      <div className="space-y-6">
        <DashboardActionStrip
          title="HR Operations - Immediate Actions"
          items={[
            {
              label: "Onboarding Stuck",
              value: summary?.onboarding?.stuck,
              detail: "Candidate journeys need HR action",
              tone: "red",
              onClick: () => openDrilldown("onboarding_stuck", "Onboarding Stuck"),
            },
            {
              label: "BGV Pending",
              value: summary?.bgvPending,
              detail: "Verification approvals pending",
              tone: "amber",
              onClick: () => openDrilldown("bgv_pending", "BGV Pending"),
            },
            {
              label: "DPDP Requests",
              value: summary?.dpdpWithdrawals,
              detail: "Privacy withdrawals pending",
              tone: summary?.dpdpOverdue ? "red" : "blue",
              onClick: () => openDrilldown("dpdp_withdrawal", "DPDP Withdrawal Requests"),
            },
            {
              label: "Resignation",
              value: summary?.resignationDiscussionPending,
              detail: "Discussions pending",
              tone: "amber",
              onClick: () => openDrilldown("resignation_pending", "Resignation Discussions Pending"),
            },
            {
              label: "Appointment eSign",
              value: summary?.appointmentEsignPending,
              detail: "Letters pending signature",
              tone: "blue",
              onClick: () => openDrilldown("appointment_esign_pending", "Appointment e-Sign Pending"),
            },
            {
              label: "Joining Doc eSign",
              value: summary?.joiningDocEsignPending,
              detail: summary?.joiningDocEsignOverdue ? `${summary.joiningDocEsignOverdue} overdue` : "Documents pending eSign",
              tone: summary?.joiningDocEsignOverdue ? "red" : "amber",
              onClick: () => openDrilldown("joining_doc_esign", "Joining Document eSign Pending"),
            },
          ]}
        />

        <KpiMetricGrid metrics={metrics} columns={3} loading={summaryLoading} />

        <DashboardCard title="HR Operations AI Briefing">
          <AIInsightPanel
            contextType="hr_dashboard"
            role="hr"
            title="HR Operations AI Briefing"
            enabled={!summaryLoading && summary !== null}
            data={{
              onboarding_submitted: summary?.onboarding?.submitted,
              onboarding_pending: summary?.onboarding?.pending,
              onboarding_stuck: summary?.onboarding?.stuck,
              bgv_pending: summary?.bgvPending,
              resignation_pending: summary?.resignationDiscussionPending,
              dpdp_withdrawals: summary?.dpdpWithdrawals,
              dpdp_overdue: summary?.dpdpOverdue,
              appointment_esign_pending: summary?.appointmentEsignPending,
              joining_doc_esign_pending: summary?.joiningDocEsignPending,
              joining_doc_esign_overdue: summary?.joiningDocEsignOverdue,
            }}
          />
        </DashboardCard>

        {/* ATS RECRUITMENT PIPELINE */}
        <AtsPipelineChart />

        {/* ATTRITION RISK SIGNAL */}
        {attritionRisk && (
          <DashboardCard title="Attrition Risk Signal">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <MetricTileEnhanced
                label="High Risk Employees"
                value={attritionRisk.high_risk_count ?? null}
                status={attritionRisk.high_risk_count > 0 ? "critical" : "ok"}
                icon={<UserMinus className="h-4 w-4 text-red-600" />}
                higherIsBetter={false}
              />
              <MetricTileEnhanced
                label="At Risk Employees"
                value={attritionRisk.at_risk_count ?? null}
                status={attritionRisk.at_risk_count > 5 ? "warn" : "ok"}
                icon={<TrendingDown className="h-4 w-4 text-amber-600" />}
                higherIsBetter={false}
              />
              <MetricTileEnhanced
                label="Total Monitored"
                value={attritionRisk.total_monitored ?? null}
                status="unknown"
                icon={<Users className="h-4 w-4 text-slate-500" />}
              />
            </div>
            {attritionRisk.by_process && attritionRisk.by_process.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Process</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">High Risk</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">At Risk</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Signal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {attritionRisk.by_process.map((p: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{p.process_name ?? p.process}</td>
                        <td className="px-3 py-2 text-right font-bold text-red-600">{p.high_risk ?? 0}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-600">{p.at_risk ?? 0}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-xs font-bold ${p.trend === "up" ? "text-red-600" : p.trend === "down" ? "text-emerald-600" : "text-slate-500"}`}>
                            {p.trend === "up" ? "▲ Rising" : p.trend === "down" ? "▼ Falling" : "Stable"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DashboardCard>
        )}

        {/* EXIT STATS */}
        {exitStats && (
          <DashboardCard title="Exit & Resignation Overview">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Active Exits</p>
                <p className="mt-2 text-2xl font-black text-red-950">{exitStats.active_exits ?? exitStats.total_active ?? "—"}</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Pending Discussion</p>
                <p className="mt-2 text-2xl font-black text-amber-950">{exitStats.pending_discussion ?? "—"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Avg Notice Period</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{exitStats.avg_notice_days != null ? `${exitStats.avg_notice_days}d` : "—"}</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">FnF Pending</p>
                <p className="mt-2 text-2xl font-black text-blue-950">{exitStats.fnf_pending ?? "—"}</p>
              </div>
            </div>
          </DashboardCard>
        )}

        {/* Work Inbox */}
        <WorkInboxPanel maxItems={10} />
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
