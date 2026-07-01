import React, { useEffect, useState, useCallback } from "react";
import { AlertCircle, ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import {
  RoleDashboardShell,
  HealthScoreCard,
  DashboardDrilldownDrawer,
  WorkInboxPanel,
} from "@/components/dashboard";
import type { HealthBreakdownItem } from "@/components/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { AIInsightPanel } from "@/components/ai";

const DASHBOARD_CODE = "PAYROLL_HR_DASHBOARD";

interface BlockerCounts {
  missingBank: number;
  missingPan: number;
  missingUan: number;
  statutoryIncomplete: number;
}

interface PayrollSummary {
  readinessScore?: number;
  blockers?: BlockerCounts;
  jclrPending?: number;
  nameMismatchBlocking?: string | null;
  onboardingValidationPending?: number;
  appointmentEsignPending?: number;
  breakdown?: HealthBreakdownItem[];
}

interface BlockerRow {
  label: string;
  count: number;
  status: "good" | "bad" | "neutral";
  metricCode: string;
}

interface DrilldownState {
  open: boolean;
  metricCode: string;
  metricName: string;
}

function BlockersTable({
  blockers,
  loading,
  onDrilldown,
}: {
  blockers: BlockerCounts | undefined;
  loading: boolean;
  onDrilldown: (code: string, name: string) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <Skeleton className="h-4 w-40" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  const rows: BlockerRow[] = [
    {
      label: "Missing Bank Account",
      count: blockers?.missingBank ?? 0,
      status: (blockers?.missingBank ?? 0) > 0 ? "bad" : "good",
      metricCode: "missing_bank",
    },
    {
      label: "Missing PAN",
      count: blockers?.missingPan ?? 0,
      status: (blockers?.missingPan ?? 0) > 0 ? "bad" : "good",
      metricCode: "missing_pan",
    },
    {
      label: "Missing UAN",
      count: blockers?.missingUan ?? 0,
      status: (blockers?.missingUan ?? 0) > 0 ? "bad" : "good",
      metricCode: "missing_uan",
    },
    {
      label: "Statutory Incomplete",
      count: blockers?.statutoryIncomplete ?? 0,
      status: (blockers?.statutoryIncomplete ?? 0) > 0 ? "bad" : "good",
      metricCode: "statutory_incomplete",
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800 text-sm">Employee Blockers</h3>
      </div>
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Blocker Type
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Count
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.metricCode}
              className="border-b last:border-0 hover:bg-slate-50 transition-colors"
            >
              <td className="px-4 py-2.5 text-slate-700">{row.label}</td>
              <td className="px-4 py-2.5 text-right">
                <span
                  className={
                    row.status === "bad"
                      ? "font-bold text-red-600"
                      : "font-semibold text-emerald-600"
                  }
                >
                  {row.count}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right">
                <button
                  onClick={() => onDrilldown(row.metricCode, row.label)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryStatCard({
  label,
  value,
  loading,
  status,
  onDrilldown,
  metricCode,
}: {
  label: string;
  value: number | string | null;
  loading: boolean;
  status?: "good" | "bad" | "neutral";
  onDrilldown?: () => void;
  metricCode?: string;
}) {
  if (loading) {
    return <Skeleton className="h-24 rounded-xl" />;
  }

  const colorMap: Record<string, string> = {
    good: "border-emerald-200 bg-emerald-50",
    bad: "border-red-200 bg-red-50",
    neutral: "border-slate-200 bg-white",
  };
  const textMap: Record<string, string> = {
    good: "text-emerald-700",
    bad: "text-red-700",
    neutral: "text-slate-900",
  };

  const containerClass = colorMap[status ?? "neutral"] ?? colorMap.neutral;
  const valueClass = textMap[status ?? "neutral"] ?? textMap.neutral;

  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${containerClass} ${onDrilldown ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
      onClick={onDrilldown}
    >
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold leading-none ${valueClass}`}>
        {value !== null && value !== undefined ? value : "—"}
      </p>
      {onDrilldown && metricCode && (
        <p className="text-xs text-blue-600 mt-2 font-medium">View Details</p>
      )}
    </div>
  );
}

export default function PayrollHrDashboard() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();

  const [summary, setSummary] = useState<PayrollSummary | null>(null);
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

    fetch(`/api/dashboards/${DASHBOARD_CODE}/summary`)
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
      roleKeys.includes("payroll") ||
      roleKeys.includes("finance");
    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="max-w-sm w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <ShieldX className="mx-auto h-12 w-12 text-red-400 mb-4" />
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Access Restricted</h2>
            <p className="text-sm text-slate-500 mb-4">
              This dashboard is only accessible to HR, Payroll, and Finance roles.
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
    <RoleDashboardShell
      title="Payroll & HR Dashboard"
      subtitle="Payroll readiness, blockers and validation queue"
      scopeLabel="Payroll HR View"
      loading={loading}
    >
      {fetchError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 mb-4">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {fetchError}
        </div>
      )}

      <div className="space-y-6">
        {/* Top row: Health Score + Summary Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Payroll Readiness Score */}
          <div className="lg:col-span-1">
            <HealthScoreCard
              score={summary?.readinessScore ?? 0}
              label="Payroll Readiness Score"
              breakdown={summary?.breakdown}
              loading={summaryLoading}
            />
          </div>

          {/* Summary stat cards */}
          <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryStatCard
              label="JCLR Pending"
              value={summary?.jclrPending ?? null}
              loading={summaryLoading}
              status={
                summary?.jclrPending != null
                  ? summary.jclrPending > 0
                    ? "bad"
                    : "good"
                  : "neutral"
              }
              onDrilldown={() => openDrilldown("jclr_pending", "JCLR Pending")}
              metricCode="jclr_pending"
            />
            <SummaryStatCard
              label="Name Mismatch (Blocking)"
              value={summary?.nameMismatchBlocking ?? null}
              loading={summaryLoading}
              status={
                summary?.nameMismatchBlocking
                  ? "bad"
                  : summary?.nameMismatchBlocking === null
                  ? "neutral"
                  : "good"
              }
              onDrilldown={() =>
                openDrilldown("name_mismatch_blocking", "Name Mismatch — Blocking Employee Code")
              }
              metricCode="name_mismatch_blocking"
            />
            <SummaryStatCard
              label="Onboarding Validation Pending"
              value={summary?.onboardingValidationPending ?? null}
              loading={summaryLoading}
              status={
                summary?.onboardingValidationPending != null
                  ? summary.onboardingValidationPending > 0
                    ? "bad"
                    : "good"
                  : "neutral"
              }
              onDrilldown={() =>
                openDrilldown("onboarding_validation_pending", "Onboarding — Submitted but Validation Pending")
              }
              metricCode="onboarding_validation_pending"
            />
            <SummaryStatCard
              label="Appointment e-Sign Pending"
              value={summary?.appointmentEsignPending ?? null}
              loading={summaryLoading}
              status={
                summary?.appointmentEsignPending != null
                  ? summary.appointmentEsignPending > 0
                    ? "neutral"
                    : "good"
                  : "neutral"
              }
              onDrilldown={() =>
                openDrilldown("appointment_esign_pending", "Appointment e-Sign Pending")
              }
              metricCode="appointment_esign_pending"
            />
          </div>
        </div>

        {/* AI Payroll Readiness Check */}
        <AIInsightPanel
          contextType="payroll_readiness"
          role="payroll_hr"
          title="Payroll AI Readiness Check"
          enabled={!summaryLoading && summary !== null}
          data={{
            readiness_score: summary?.readinessScore,
            missing_bank: summary?.blockers?.missingBank,
            missing_pan: summary?.blockers?.missingPan,
            missing_uan: summary?.blockers?.missingUan,
            statutory_incomplete: summary?.blockers?.statutoryIncomplete,
            jclr_pending: summary?.jclrPending,
            name_mismatch_blocking: summary?.nameMismatchBlocking ? 1 : 0,
            onboarding_validation_pending: summary?.onboardingValidationPending,
            appointment_esign_pending: summary?.appointmentEsignPending,
          }}
        />

        {/* Blockers table + Work Inbox */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <BlockersTable
              blockers={summary?.blockers}
              loading={summaryLoading}
              onDrilldown={openDrilldown}
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
