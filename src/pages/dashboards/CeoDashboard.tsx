import React, { useEffect, useState, useCallback } from "react";
import { AlertCircle, ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import {
  RoleDashboardShell,
  KpiMetricGrid,
  GoodBadInsightPanel,
  DashboardDrilldownDrawer,
  WorkInboxPanel,
  ScopedFilterBar,
} from "@/components/dashboard";
import type { KpiMetric } from "@/components/dashboard";
import type { InsightItem } from "@/components/dashboard";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";

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
}

interface InsightApiResponse {
  good: { count: number; items: InsightItem[] };
  bad: { count: number; items: InsightItem[] };
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

    fetch(`/api/dashboards/${DASHBOARD_CODE}/summary${qs}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Summary fetch failed: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setSummary(json?.data ?? json);
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.message ?? "Failed to load dashboard summary.");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    setInsightsLoading(true);
    fetch(`/api/dashboards/${DASHBOARD_CODE}/good-bad-insights${qs}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Insights fetch failed: ${res.status}`);
        return res.json();
      })
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

    return () => {
      cancelled = true;
    };
  }, [branchId, processId]);

  // Role check
  if (!roleLoading) {
    const roleKeys = roleData?.roleKeys ?? [];
    const allowed = roleKeys.includes("super_admin") || roleKeys.includes("ceo");
    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="max-w-sm w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <ShieldX className="mx-auto h-12 w-12 text-red-400 mb-4" />
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Access Restricted</h2>
            <p className="text-sm text-slate-500 mb-4">
              This dashboard is only accessible to CEO and Super Admin roles.
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
        {/* KPI Metrics */}
        <KpiMetricGrid metrics={metrics} columns={3} loading={summaryLoading} />

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
