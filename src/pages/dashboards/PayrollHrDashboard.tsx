import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DashboardDrilldownDrawer,
  DashboardActionStrip,
  DashboardCard,
  HealthScoreCard,
  RoleDashboardShell,
  WorkInboxPanel,
} from "@/components/dashboard";
import type { HealthBreakdownItem } from "@/components/dashboard";
import { AIInsightPanel } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";

const DASHBOARD_CODE = "PAYROLL_HR_DASHBOARD";
type DashboardPayload = Parameters<typeof normalizeDashboardSummary>[1];

interface BlockerCounts {
  missingBank: number;
  missingPan: number;
  missingUan: number;
  statutoryIncomplete: number;
}

interface PayrollSummary {
  readinessScore?: number;
  blockers?: BlockerCounts;
  jclrPending?: number | null;
  nameMismatchBlocking?: number | null;
  onboardingValidationPending?: number | null;
  appointmentEsignPending?: number | null;
  appointmentCandidatePending?: number | null;
  appointmentCompanyPending?: number | null;
  breakdown?: HealthBreakdownItem[];
}

interface DrilldownState {
  open: boolean;
  metricCode: string;
  metricName: string;
}

interface StatItem {
  label: string;
  value: number | string;
  status: "good" | "bad" | "neutral";
  metricCode: string;
  metricName: string;
}

function SummaryStatCard({
  item,
  loading,
  onDrilldown,
}: {
  item: StatItem;
  loading: boolean;
  onDrilldown: (code: string, name: string) => void;
}) {
  if (loading) return <Skeleton className="h-24 rounded-xl" />;

  const colors: Record<StatItem["status"], string> = {
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    bad: "border-red-200 bg-red-50 text-red-700",
    neutral: "border-slate-200 bg-white text-slate-900",
  };

  return (
    <button
      type="button"
      className={`rounded-xl border p-4 text-left shadow-sm transition hover:shadow-md ${colors[item.status]}`}
      onClick={() => onDrilldown(item.metricCode, item.metricName)}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</p>
      <p className="mt-2 text-2xl font-bold leading-none">{item.value}</p>
      <p className="mt-2 text-xs font-medium text-blue-600">View Details</p>
    </button>
  );
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
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const rows = [
    { label: "Missing Bank Account", count: blockers?.missingBank ?? 0, metricCode: "missing_bank" },
    { label: "Missing PAN", count: blockers?.missingPan ?? 0, metricCode: "missing_pan" },
    { label: "Missing UAN", count: blockers?.missingUan ?? 0, metricCode: "missing_uan" },
    { label: "Statutory Incomplete", count: blockers?.statutoryIncomplete ?? 0, metricCode: "statutory_incomplete" },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">Employee Payroll Blockers</h3>
      </div>
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Blocker Type
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
              Count
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.metricCode} className="border-b last:border-0 hover:bg-slate-50">
              <td className="px-4 py-2.5 text-slate-700">{row.label}</td>
              <td className="px-4 py-2.5 text-right">
                <span className={row.count > 0 ? "font-bold text-red-600" : "font-semibold text-emerald-600"}>
                  {row.count}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => onDrilldown(row.metricCode, row.label)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800"
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

function hasValue(value: unknown): value is number | string {
  return value !== null && value !== undefined;
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

    hrmsApi
      .get(`/api/dashboards/${DASHBOARD_CODE}/summary`)
      .then((json) => {
        if (!cancelled) setSummary(normalizeDashboardSummary<PayrollSummary>(DASHBOARD_CODE, json as DashboardPayload));
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.message ?? "Failed to load payroll dashboard summary.");
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
      roleKeys.includes("hr") ||
      roleKeys.includes("payroll") ||
      roleKeys.includes("payroll_hr") ||
      roleKeys.includes("payroll_branch") ||
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

  const statItems: StatItem[] = [
    {
      label: "JCLR Pending",
      value: summary?.jclrPending ?? null,
      status: summary?.jclrPending != null && summary.jclrPending > 0 ? "bad" : "good",
      metricCode: "jclr_pending",
      metricName: "JCLR Pending",
    },
    {
      label: "Name Mismatch (Blocking)",
      value: summary?.nameMismatchBlocking ?? null,
      status: summary?.nameMismatchBlocking != null && summary.nameMismatchBlocking > 0 ? "bad" : "good",
      metricCode: "name_mismatch_blocking",
      metricName: "Name Mismatch - Blocking Employee Code",
    },
    {
      label: "Onboarding Validation Pending",
      value: summary?.onboardingValidationPending ?? null,
      status:
        summary?.onboardingValidationPending != null && summary.onboardingValidationPending > 0 ? "bad" : "good",
      metricCode: "onboarding_validation_pending",
      metricName: "Onboarding - Submitted but Validation Pending",
    },
    {
      label: "Appointment e-Sign Pending",
      value: summary?.appointmentEsignPending ?? null,
      status: summary?.appointmentEsignPending != null && summary.appointmentEsignPending > 0 ? "neutral" : "good",
      metricCode: "appointment_esign_pending",
      metricName: "Appointment e-Sign Pending",
    },
  ].filter((item): item is StatItem => hasValue(item.value));

  const loading = summaryLoading || roleLoading;

  return (
    <RoleDashboardShell
      title="Finance / Payroll Dashboard"
      subtitle="Read-only payroll readiness, blockers and validation queue"
      scopeLabel="Payroll View"
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
          title="Payroll Readiness - Immediate Actions"
          items={[
            {
              label: "JCLR Pending",
              value: summary?.jclrPending,
              detail: "Joining confirmation validation",
              tone: "amber",
              onClick: () => openDrilldown("jclr_pending", "JCLR Pending"),
            },
            {
              label: "Name Mismatch",
              value: summary?.nameMismatchBlocking,
              detail: "Blocking employee code",
              tone: "red",
              onClick: () => openDrilldown("name_mismatch_blocking", "Name Mismatch - Blocking Employee Code"),
            },
            {
              label: "Validation Pending",
              value: summary?.onboardingValidationPending,
              detail: "Submitted but pending payroll validation",
              tone: "amber",
              onClick: () => openDrilldown("onboarding_validation_pending", "Onboarding Validation Pending"),
            },
            {
              label: "Appointment eSign",
              value: summary?.appointmentEsignPending,
              detail: "Candidate/company sign pending",
              tone: "blue",
              onClick: () => openDrilldown("appointment_esign_pending", "Appointment e-Sign Pending"),
            },
          ]}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <HealthScoreCard
              score={summary?.readinessScore ?? 0}
              label="Payroll Readiness Score"
              breakdown={summary?.breakdown}
              loading={summaryLoading}
            />
          </div>

          {statItems.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-3">
              {statItems.map((item) => (
                <SummaryStatCard
                  key={item.metricCode}
                  item={item}
                  loading={summaryLoading}
                  onDrilldown={openDrilldown}
                />
              ))}
            </div>
          )}
        </div>

        <DashboardCard title="Payroll AI Readiness Check">
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
              name_mismatch_blocking: summary?.nameMismatchBlocking,
              onboarding_validation_pending: summary?.onboardingValidationPending,
              appointment_esign_pending: summary?.appointmentEsignPending,
              appointment_candidate_pending: summary?.appointmentCandidatePending,
              appointment_company_pending: summary?.appointmentCompanyPending,
            }}
          />
        </DashboardCard>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <BlockersTable blockers={summary?.blockers} loading={summaryLoading} onDrilldown={openDrilldown} />
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
