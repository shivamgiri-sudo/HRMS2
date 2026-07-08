import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DashboardDrilldownDrawer,
  DashboardActionStrip,
  DashboardCard,
  KpiMetricGrid,
  RoleDashboardShell,
  WorkInboxPanel,
} from "@/components/dashboard";
import type { KpiMetric } from "@/components/dashboard";
import { AIInsightPanel } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";

const DASHBOARD_CODE = "MANAGEMENT_DASHBOARD";
type DashboardPayload = Parameters<typeof normalizeDashboardSummary>[1];

interface ManagerSummary {
  teamMembers?: number | null;
  attendanceRate?: number | null;
  presentToday?: number | null;
  absentToday?: number | null;
  lateToday?: number | null;
  missingPunch?: number | null;
  onboardingPending?: number | null;
  resignationPending?: number | null;
  dpdpWithdrawals?: number | null;
  workItems?: {
    pending_count?: number | string | null;
    overdue_count?: number | string | null;
  };
}

interface DrilldownState {
  open: boolean;
  metricCode: string;
  metricName: string;
}

function hasValue(value: unknown): value is number | string {
  return value !== null && value !== undefined;
}

export default function ManagerDashboard() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const [summary, setSummary] = useState<ManagerSummary | null>(null);
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

    hrmsApi
      .get(`/api/dashboards/${DASHBOARD_CODE}/summary`)
      .then((json) => {
        if (!cancelled) {
          setSummary(normalizeDashboardSummary<ManagerSummary>(DASHBOARD_CODE, json as DashboardPayload));
        }
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.message ?? "Failed to load manager dashboard summary.");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!roleLoading) {
    const roleKeys = roleData?.roleKeys ?? [];
    const allowed =
      roleKeys.includes("super_admin") ||
      roleKeys.includes("admin") ||
      roleKeys.includes("manager") ||
      roleKeys.includes("tl") ||
      roleKeys.includes("team_lead") ||
      roleKeys.includes("team_leader") ||
      roleKeys.includes("assistant_manager") ||
      roleKeys.includes("process_manager") ||
      roleKeys.includes("branch_head");

    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="max-w-sm w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <ShieldX className="mx-auto h-12 w-12 text-red-400 mb-4" />
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Access Restricted</h2>
            <p className="text-sm text-slate-500 mb-4">
              This dashboard is only accessible to manager and team leadership roles.
            </p>
            <Button asChild variant="outline">
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </div>
        </div>
      );
    }
  }

  const pendingWorkItems = summary?.workItems?.pending_count != null
    ? Number(summary.workItems.pending_count)
    : null;
  const overdueWorkItems = summary?.workItems?.overdue_count != null
    ? Number(summary.workItems.overdue_count)
    : null;

  const metrics: KpiMetric[] = [
    {
      id: "team_members",
      metric: "Team Members",
      value: summary?.teamMembers ?? null,
      unit: "",
      drilldownAvailable: true,
      onClick: () => openDrilldown("headcount_active", "Team Members"),
    },
    {
      id: "attendance_rate",
      metric: "Attendance Rate",
      value: summary?.attendanceRate ?? null,
      unit: "%",
      status:
        summary?.attendanceRate != null
          ? summary.attendanceRate >= 90
            ? "good"
            : summary.attendanceRate >= 75
              ? "neutral"
              : "bad"
          : undefined,
      higherIsBetter: true,
      drilldownAvailable: true,
      onClick: () => openDrilldown("attendance_rate", "Attendance Rate"),
    },
    {
      id: "present_today",
      metric: "Present Today",
      value: summary?.presentToday ?? null,
      unit: "",
      drilldownAvailable: true,
      onClick: () => openDrilldown("present_today", "Present Today"),
    },
    {
      id: "absent_today",
      metric: "Absent Today",
      value: summary?.absentToday ?? null,
      unit: "",
      status:
        summary?.absentToday != null
          ? summary.absentToday > 0
            ? "bad"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("absent_today", "Absent Today"),
    },
    {
      id: "late_today",
      metric: "Late Today",
      value: summary?.lateToday ?? null,
      unit: "",
      status:
        summary?.lateToday != null
          ? summary.lateToday > 0
            ? "neutral"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("late_today", "Late Today"),
    },
    {
      id: "pending_work",
      metric: "Pending Work Items",
      value: pendingWorkItems,
      unit: "",
      status:
        pendingWorkItems != null
          ? pendingWorkItems > 0
            ? "neutral"
            : "good"
          : undefined,
      higherIsBetter: false,
    },
    {
      id: "overdue_work",
      metric: "Overdue Work Items",
      value: overdueWorkItems,
      unit: "",
      status:
        overdueWorkItems != null
          ? overdueWorkItems > 0
            ? "bad"
            : "good"
          : undefined,
      higherIsBetter: false,
    },
    {
      id: "onboarding_pending",
      metric: "Onboarding Pending",
      value: summary?.onboardingPending ?? null,
      unit: "",
      status:
        summary?.onboardingPending != null
          ? summary.onboardingPending > 0
            ? "neutral"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("onboarding_pending", "Onboarding Pending"),
    },
    {
      id: "resignation_pending",
      metric: "Resignation Discussions",
      value: summary?.resignationPending ?? null,
      unit: "",
      status:
        summary?.resignationPending != null
          ? summary.resignationPending > 0
            ? "neutral"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("resignation_pending", "Resignation Discussions"),
    },
    {
      id: "dpdp_withdrawals",
      metric: "DPDP Withdrawals",
      value: summary?.dpdpWithdrawals ?? null,
      unit: "",
      status:
        summary?.dpdpWithdrawals != null
          ? summary.dpdpWithdrawals > 0
            ? "neutral"
            : "good"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("dpdp_withdrawal", "DPDP Withdrawals"),
    },
  ].filter((metric) => hasValue(metric.value));

  const loading = summaryLoading || roleLoading;

  return (
    <RoleDashboardShell
      title="Manager Dashboard"
      subtitle="Read-only team operations and approval overview"
      scopeLabel="Manager View"
      loading={loading}
    >
      {fetchError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {fetchError}
        </div>
      )}

      <div className="space-y-6">
        <DashboardActionStrip
          title="Manager - Immediate Actions"
          items={[
            {
              label: "Absent Today",
              value: summary?.absentToday,
              detail: "Team members absent",
              tone: summary?.absentToday != null && summary.absentToday > 0 ? "red" : "green",
              onClick: () => openDrilldown("absent_today", "Absent Today"),
            },
            {
              label: "Late Today",
              value: summary?.lateToday,
              detail: "Late arrivals need coaching",
              tone: summary?.lateToday != null && summary.lateToday > 0 ? "amber" : "green",
              onClick: () => openDrilldown("late_today", "Late Today"),
            },
            {
              label: "Overdue Work",
              value: overdueWorkItems,
              detail: "Manager action queue",
              tone: overdueWorkItems != null && overdueWorkItems > 0 ? "red" : "green",
            },
            {
              label: "Resignation",
              value: summary?.resignationPending,
              detail: "Discussions pending",
              tone: "amber",
              onClick: () => openDrilldown("resignation_pending", "Resignation Discussions"),
            },
          ]}
        />

        <KpiMetricGrid metrics={metrics} columns={4} loading={summaryLoading} />

        <DashboardCard title="Manager AI Brief">
          <AIInsightPanel
            contextType="manager_dashboard"
            role="manager"
            title="Manager AI Brief"
            enabled={!summaryLoading && summary !== null}
            data={{
              team_members: summary?.teamMembers,
              attendance_rate: summary?.attendanceRate,
              present_today: summary?.presentToday,
              absent_today: summary?.absentToday,
              late_today: summary?.lateToday,
              missing_punch: summary?.missingPunch,
              resignation_pending: summary?.resignationPending,
              dpdp_withdrawals: summary?.dpdpWithdrawals,
              pending_work_items: pendingWorkItems,
              overdue_work_items: overdueWorkItems,
            }}
          />
        </DashboardCard>

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
  );
}
