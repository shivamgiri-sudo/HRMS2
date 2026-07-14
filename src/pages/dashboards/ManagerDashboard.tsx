import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, ShieldX, Medal, Star } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
  const [teamQuality, setTeamQuality] = useState<any | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<any[] | null>(null);
  const [kpiLeaderboard, setKpiLeaderboard] = useState<any[] | null>(null);
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

    // Non-critical enrichment
    hrmsApi.get("/api/manager/team-quality").then((r: any) => { if (!cancelled) setTeamQuality(r.data ?? r ?? null); }).catch(() => {});
    hrmsApi.get("/api/leave/requests?status=pending&limit=5").then((r: any) => { if (!cancelled) setLeaveRequests(r.data ?? r ?? null); }).catch(() => {});
    hrmsApi.get("/api/kpi/leaderboard?limit=5").then((r: any) => { if (!cancelled) setKpiLeaderboard(r.data ?? r ?? null); }).catch(() => {});

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
    <DashboardLayout>
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

        {/* TEAM QUALITY SUMMARY */}
        {teamQuality && (
          <DashboardCard title="Team Quality Performance">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="flex flex-col justify-center items-center rounded-xl border border-blue-100 bg-blue-50 p-6">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700 mb-2">Team Avg Quality</p>
                <p className={`text-4xl font-black ${(teamQuality.avg_quality_score ?? 0) >= 80 ? "text-emerald-700" : (teamQuality.avg_quality_score ?? 0) >= 65 ? "text-amber-600" : "text-red-600"}`}>
                  {teamQuality.avg_quality_score ?? "—"}%
                </p>
                <p className="text-xs text-blue-600 mt-2">{teamQuality.total_calls_audited ?? 0} calls audited</p>
              </div>
              <div className="lg:col-span-2 overflow-auto max-h-48">
                {teamQuality.agents && teamQuality.agents.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Agent</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Score</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Calls</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Band</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {teamQuality.agents.map((a: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-800">{a.agent_name}</td>
                          <td className="px-3 py-2 text-right font-bold">{a.quality_score}%</td>
                          <td className="px-3 py-2 text-right text-slate-500">{a.calls_audited}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              a.band === "excellent" ? "bg-emerald-100 text-emerald-700" :
                              a.band === "good" ? "bg-blue-100 text-blue-700" :
                              a.band === "average" ? "bg-amber-100 text-amber-700" :
                              "bg-red-100 text-red-700"
                            }`}>{a.band ?? "—"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-sm text-slate-400 py-6 text-center">No quality data for this period.</p>}
              </div>
            </div>
          </DashboardCard>
        )}

        {/* KPI LEADERBOARD */}
        {kpiLeaderboard && kpiLeaderboard.length > 0 && (
          <DashboardCard title="KPI Leaderboard — Top Performers">
            <div className="space-y-2">
              {kpiLeaderboard.slice(0, 5).map((emp: any, i: number) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5">
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${i === 0 ? "bg-yellow-400 text-yellow-900" : i === 1 ? "bg-slate-300 text-slate-700" : i === 2 ? "bg-amber-600/20 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{emp.employee_name ?? emp.name}</p>
                    <p className="text-xs text-slate-400">{emp.process_name ?? emp.process ?? ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-blue-700">{emp.kpi_score ?? emp.score}%</p>
                  </div>
                  {i === 0 && <Medal className="h-4 w-4 text-yellow-500 shrink-0" />}
                </div>
              ))}
              <Link to="/my-kpi" className="block mt-2 text-xs font-medium text-blue-600 hover:text-blue-800 text-center">
                View full leaderboard →
              </Link>
            </div>
          </DashboardCard>
        )}

        {/* PENDING LEAVE REQUESTS */}
        {leaveRequests && leaveRequests.length > 0 && (
          <DashboardCard title="Pending Leave Requests">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Employee</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Leave Type</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Dates</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leaveRequests.map((req: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">{req.employee_name ?? req.employeeName}</td>
                      <td className="px-3 py-2 text-slate-600">{req.leave_type ?? req.leaveType}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{req.from_date ?? req.startDate} → {req.to_date ?? req.endDate}</td>
                      <td className="px-3 py-2 text-center font-semibold">{req.days ?? req.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Link to="/leaves" className="block mt-3 text-xs font-medium text-blue-600 hover:text-blue-800">
                Manage all leave requests →
              </Link>
            </div>
          </DashboardCard>
        )}

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
