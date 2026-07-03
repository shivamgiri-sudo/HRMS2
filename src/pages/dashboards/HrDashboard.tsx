import React, { useEffect, useState, useCallback } from "react";
import { AlertCircle, ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import {
  RoleDashboardShell,
  KpiMetricGrid,
  DashboardDrilldownDrawer,
  WorkInboxPanel,
} from "@/components/dashboard";
import type { KpiMetric } from "@/components/dashboard";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { AIInsightPanel } from "@/components/ai";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";

const DASHBOARD_CODE = "HR_DASHBOARD";

interface HrSummary {
  selectedCandidates?: number;
  onboarding?: {
    submitted?: number;
    pending?: number;
    stuck?: number;
  };
  bgvPending?: number;
  dpdpWithdrawals?: number;
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
        if (!cancelled) setSummary(normalizeDashboardSummary<HrSummary>(DASHBOARD_CODE, json as any));
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.message ?? "Failed to load HR dashboard summary.");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

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
      roleKeys.includes("admin") ||
      roleKeys.includes("recruiter");
    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="max-w-sm w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <ShieldX className="mx-auto h-12 w-12 text-red-400 mb-4" />
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Access Restricted</h2>
            <p className="text-sm text-slate-500 mb-4">
              This dashboard is only accessible to HR and Recruiter roles.
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
      id: "selected_candidates",
      metric: "Selected Candidates",
      value: summary?.selectedCandidates ?? null,
      unit: "",
      drilldownAvailable: true,
      onClick: () => openDrilldown("selected_candidates", "Selected Candidates"),
    },
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
      id: "dpdp_withdrawals",
      metric: "DPDP Withdrawal Requests",
      value: summary?.dpdpWithdrawals ?? null,
      unit: "",
      status:
        summary?.dpdpWithdrawals != null
          ? summary.dpdpWithdrawals > 0
            ? "bad"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("dpdp_withdrawals", "DPDP Withdrawal Requests"),
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
  ];

  const loading = summaryLoading || roleLoading;

  return (
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
        {/* KPI Metrics */}
        <KpiMetricGrid metrics={metrics} columns={3} loading={summaryLoading} />

        {/* AI HR Operations Briefing */}
        <AIInsightPanel
          contextType="hr_dashboard"
          role="hr"
          title="HR Operations AI Briefing"
          enabled={!summaryLoading && summary !== null}
          data={{
            selected_candidates: summary?.selectedCandidates,
            onboarding_submitted: summary?.onboarding?.submitted,
            onboarding_pending: summary?.onboarding?.pending,
            onboarding_stuck: summary?.onboarding?.stuck,
            bgv_pending: summary?.bgvPending,
            dpdp_withdrawals: summary?.dpdpWithdrawals,
            resignation_pending: summary?.resignationDiscussionPending,
          }}
        />

        {/* Work Inbox */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <WorkInboxPanel maxItems={10} />
          </div>
        </div>
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
