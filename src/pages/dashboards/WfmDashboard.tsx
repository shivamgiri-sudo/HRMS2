import React, { useEffect, useState, useCallback } from "react";
import { AlertCircle, ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import {
  RoleDashboardShell,
  KpiMetricGrid,
  AgingBucketCard,
  DashboardDrilldownDrawer,
  WorkInboxPanel,
  ScopedFilterBar,
} from "@/components/dashboard";
import type { KpiMetric } from "@/components/dashboard";
import type { AgingBucket } from "@/components/dashboard";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";

const DASHBOARD_CODE = "WFM_DASHBOARD";

interface WfmSummary {
  requiredHc?: number;
  availableHc?: number;
  rosterAdherence?: number;
  missingPunch?: number;
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

const DEFAULT_VARIANCE_BUCKETS: AgingBucket[] = [
  { label: "0–1 hr", count: 0, color: "#16a34a" },
  { label: "1–4 hr", count: 0, color: "#d97706" },
  { label: "4+ hr", count: 0, color: "#dc2626" },
];

export default function WfmDashboard() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();

  const [summary, setSummary] = useState<WfmSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [drilldown, setDrilldown] = useState<DrilldownState>({
    open: false,
    metricCode: "",
    metricName: "",
  });

  const [, setBranchId] = useState<string>("");
  const [, setProcessId] = useState<string>("");

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

    fetch(`/api/dashboards/${DASHBOARD_CODE}/summary`)
      .then((res) => {
        if (!res.ok) throw new Error(`Summary fetch failed: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setSummary(json?.data ?? json);
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.message ?? "Failed to load WFM dashboard summary.");
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
      roleKeys.includes("wfm") ||
      roleKeys.includes("admin") ||
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
      id: "roster_adherence",
      metric: "Roster Adherence",
      value: summary?.rosterAdherence ?? null,
      unit: "%",
      status:
        summary?.rosterAdherence != null
          ? summary.rosterAdherence >= 90
            ? "good"
            : summary.rosterAdherence >= 75
            ? "neutral"
            : "bad"
          : undefined,
      higherIsBetter: true,
      drilldownAvailable: true,
      onClick: () => openDrilldown("roster_adherence", "Roster Adherence"),
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
  ];

  const varianceBuckets: AgingBucket[] =
    summary?.attendanceVarianceBuckets && summary.attendanceVarianceBuckets.length > 0
      ? summary.attendanceVarianceBuckets
      : DEFAULT_VARIANCE_BUCKETS;

  const loading = summaryLoading || roleLoading;

  return (
    <RoleDashboardShell
      title="WFM Dashboard"
      subtitle="Workforce management — headcount, roster and attendance"
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
        {/* KPI Metrics */}
        <KpiMetricGrid metrics={metrics} columns={4} loading={summaryLoading} />

        {/* Attendance Variance + Work Inbox */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <AgingBucketCard
              title="Attendance Variance Buckets"
              buckets={varianceBuckets}
              loading={summaryLoading}
            />
          </div>
          <div className="lg:col-span-1">
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
