import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DashboardDrilldownDrawer,
  KpiMetricGrid,
  RoleDashboardShell,
  ScopedFilterBar,
  WorkInboxPanel,
  DashboardActionStrip,
  DashboardCard,
} from "@/components/dashboard";
import type { KpiMetric } from "@/components/dashboard";
import { InterventionPanel } from "@/components/dashboard/InterventionPanel";
import type { InterventionFlag } from "@/components/dashboard/InterventionPanel";
import { AIInsightPanel } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";

const DASHBOARD_CODE = "WFM_DASHBOARD";
type DashboardPayload = Parameters<typeof normalizeDashboardSummary>[1];

interface WfmSummary {
  requiredHc?: number | null;
  availableHc?: number | null;
  attendanceRate?: number | null;
  missingPunch?: number | null;
  attendanceVarianceBuckets?: Array<{
    label: string;
    count: number;
    color?: string;
  }>;
}

interface DrilldownState {
  open: boolean;
  metricCode: string;
  metricName: string;
}

function hasValue(value: unknown): value is number | string {
  return value !== null && value !== undefined;
}

export default function WfmDashboard() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();

  const [summary, setSummary] = useState<WfmSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [opsPulseFlags, setOpsPulseFlags] = useState<InterventionFlag[]>([]);
  const [branchId, setBranchId] = useState("");
  const [processId, setProcessId] = useState("");
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

    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (processId) params.set("processId", processId);
    const qs = params.toString() ? `?${params.toString()}` : "";

    hrmsApi
      .get(`/api/dashboards/${DASHBOARD_CODE}/summary${qs}`)
      .then((json) => {
        if (!cancelled) setSummary(normalizeDashboardSummary<WfmSummary>(DASHBOARD_CODE, json as DashboardPayload));
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.message ?? "Failed to load WFM dashboard summary.");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    hrmsApi
      .get<{ success: boolean; data: { intervention_flags?: InterventionFlag[] } }>(
        `/api/bi/daily-operations-pulse${qs}`,
      )
      .then((res) => {
        if (!cancelled) setOpsPulseFlags(res?.data?.intervention_flags ?? []);
      })
      .catch(() => {
        if (!cancelled) setOpsPulseFlags([]);
      });

    return () => {
      cancelled = true;
    };
  }, [branchId, processId]);

  if (!roleLoading) {
    const roleKeys = roleData?.roleKeys ?? [];
    const allowed =
      roleKeys.includes("super_admin") ||
      roleKeys.includes("admin") ||
      roleKeys.includes("wfm") ||
      roleKeys.includes("branch_head") ||
      roleKeys.includes("process_manager");

    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="max-w-sm w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <ShieldX className="mx-auto h-12 w-12 text-red-400 mb-4" />
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Access Restricted</h2>
            <p className="text-sm text-slate-500 mb-4">
              This dashboard is only accessible to WFM, Branch Head, and Process Manager roles.
            </p>
            <Button asChild variant="outline">
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </div>
        </div>
      );
    }
  }

  const hcGap =
    summary?.requiredHc != null && summary?.availableHc != null
      ? summary.requiredHc - summary.availableHc
      : null;

  const metrics: KpiMetric[] = [
    {
      id: "required_hc",
      metric: "Required HC",
      value: summary?.requiredHc ?? null,
      unit: "",
      drilldownAvailable: true,
      onClick: () => openDrilldown("required_hc", "Required Headcount"),
    },
    {
      id: "available_hc",
      metric: "Available HC",
      value: summary?.availableHc ?? null,
      unit: "",
      status:
        hcGap != null
          ? hcGap <= 0
            ? "good"
            : hcGap <= 5
              ? "neutral"
              : "bad"
          : undefined,
      drilldownAvailable: true,
      onClick: () => openDrilldown("available_hc", "Available Headcount"),
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
      id: "missing_punch",
      metric: "Missing Punch",
      value: summary?.missingPunch ?? null,
      unit: "",
      status:
        summary?.missingPunch != null
          ? summary.missingPunch === 0
            ? "good"
            : summary.missingPunch <= 5
              ? "neutral"
              : "bad"
          : undefined,
      higherIsBetter: false,
      drilldownAvailable: true,
      onClick: () => openDrilldown("missing_punch", "Missing Punch"),
    },
  ].filter((metric) => hasValue(metric.value));

  const varianceBuckets = summary?.attendanceVarianceBuckets ?? [];
  const loading = summaryLoading || roleLoading;

  return (
    <RoleDashboardShell
      title="WFM / Attendance Dashboard"
      subtitle="Read-only workforce attendance summary"
      scopeLabel="WFM View"
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
          title="WFM / Attendance - Immediate Actions"
          items={[
            {
              label: "HC Gap",
              value: hcGap,
              detail: "Required vs available headcount",
              tone: hcGap != null && hcGap > 5 ? "red" : "amber",
              onClick: () => openDrilldown("available_hc", "Available Headcount"),
            },
            {
              label: "Attendance",
              value: summary?.attendanceRate != null ? `${summary.attendanceRate}%` : null,
              detail: "Live attendance adherence",
              tone: summary?.attendanceRate != null && summary.attendanceRate < 75 ? "red" : "green",
              onClick: () => openDrilldown("attendance_rate", "Attendance Rate"),
            },
            {
              label: "Missing Punch",
              value: summary?.missingPunch,
              detail: "Manual punch exceptions",
              tone: summary?.missingPunch != null && summary.missingPunch > 5 ? "red" : "amber",
              onClick: () => openDrilldown("missing_punch", "Missing Punch"),
            },
          ]}
        />

        <KpiMetricGrid metrics={metrics} columns={4} loading={summaryLoading} />

        {opsPulseFlags.length > 0 && (
          <InterventionPanel flags={opsPulseFlags} title="Today's Operations Alerts" collapsible />
        )}

        <DashboardCard title="Workforce AI Analysis">
          <AIInsightPanel
            contextType="wfm_roster"
            role="wfm"
            title="Workforce AI Analysis"
            enabled={!summaryLoading && summary !== null}
            data={{
              required_hc: summary?.requiredHc,
              available_hc: summary?.availableHc,
              hc_gap: hcGap,
              attendance_rate_pct: summary?.attendanceRate,
              missing_punch: summary?.missingPunch,
              attendance_variance_buckets: varianceBuckets,
            }}
          />
        </DashboardCard>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {varianceBuckets.length > 0 && (
            <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Attendance Variance Buckets</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {varianceBuckets.map((bucket) => (
                  <div key={bucket.label} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs font-medium text-slate-500">{bucket.label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{bucket.count}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={varianceBuckets.length > 0 ? "lg:col-span-1" : "lg:col-span-3"}>
            <WorkInboxPanel maxItems={8} />
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
