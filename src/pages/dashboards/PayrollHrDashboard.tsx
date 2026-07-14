import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, ShieldX, TrendingUp, TrendingDown, Banknote, Users, Clock, FileCheck, AlertTriangle, CheckCircle2, Building2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/useUserRole";
import { useQuery } from "@tanstack/react-query";
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

interface OperationalData {
  currentMonth: string;
  currentRun: {
    id: string;
    month: string;
    status: string;
    label: string;
    attendanceLocked: boolean;
    tdsMode: string;
    createdAt: string;
    closedAt: string | null;
  } | null;
  salaryBill: {
    employeeCount: number;
    totalGross: number;
    totalNet: number;
    totalDeductions: number;
  } | null;
  salaryHoldCount: number;
  pendingQueues: {
    optOuts: number;
    bankChanges: number;
    chequeValidation: number;
    advances: number;
    total: number;
  };
  fnfPending: number;
  disbursement: Record<string, number>;
  branchReadiness: Array<{
    branch_id: string;
    branch_name: string;
    readiness_score: number;
    readiness_status: string;
    employee_count: number;
    branch_head_signoff: number;
  }>;
  momTrend: Array<{
    run_month: string;
    headcount: number;
    total_gross: number;
    total_net: number;
  }>;
  statutoryFiling: Array<{
    filing_type: string;
    due_date: string;
    status: string;
    filed_date: string | null;
  }>;
  varianceAlerts: Array<{
    employee_code: string;
    employee_name: string;
    current_gross: number;
    previous_gross: number;
    variance_pct: number;
  }>;
}

const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const fmtLakh = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return fmtINR(n);
};

// ─── Run Status Banner ────────────────────────────────────────────────────────

function RunStatusBanner({ run, month }: { run: OperationalData["currentRun"]; month: string }) {
  if (!run) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-amber-900">No Payroll Run Started</p>
            <p className="text-xs text-amber-700">Month: {month} — No salary prep run has been initiated yet</p>
          </div>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700 border-slate-200",
    open: "bg-blue-100 text-blue-700 border-blue-200",
    frozen: "bg-indigo-100 text-indigo-700 border-indigo-200",
    validated: "bg-emerald-100 text-emerald-700 border-emerald-200",
    disbursed: "bg-green-100 text-green-700 border-green-200",
    closed: "bg-gray-100 text-gray-600 border-gray-200",
  };

  const color = statusColors[run.status] ?? statusColors.draft;

  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Banknote className="h-5 w-5" />
          <div>
            <p className="text-sm font-semibold">Payroll Run: {run.label || run.month}</p>
            <p className="text-xs opacity-80">
              Attendance: {run.attendanceLocked ? "Locked ✓" : "Not Locked"} · TDS Mode: {run.tdsMode || "auto"}
            </p>
          </div>
        </div>
        <Badge variant="outline" className="capitalize font-semibold">{run.status}</Badge>
      </div>
    </div>
  );
}

// ─── Key Metrics Row ──────────────────────────────────────────────────────────

function MetricCard({ label, value, subtitle, icon: Icon, variant = "default", href }: {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  variant?: "default" | "danger" | "warning" | "success";
  href?: string;
}) {
  const variants = {
    default: "border-slate-200 bg-white",
    danger: "border-red-200 bg-red-50",
    warning: "border-amber-200 bg-amber-50",
    success: "border-emerald-200 bg-emerald-50",
  };
  const iconColors = {
    default: "text-slate-600",
    danger: "text-red-600",
    warning: "text-amber-600",
    success: "text-emerald-600",
  };

  const content = (
    <div className={`rounded-xl border p-4 shadow-sm transition hover:shadow-md ${variants[variant]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <Icon className={`h-5 w-5 ${iconColors[variant]}`} />
      </div>
    </div>
  );

  if (href) return <Link to={href}>{content}</Link>;
  return content;
}

// ─── Disbursement Tracker ─────────────────────────────────────────────────────

function DisbursementTracker({ data }: { data: Record<string, number> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const stages = [
    { key: "initiated", label: "Initiated", color: "bg-blue-500" },
    { key: "in_progress", label: "In Progress", color: "bg-amber-500" },
    { key: "completed", label: "Completed", color: "bg-emerald-500" },
    { key: "failed", label: "Failed", color: "bg-red-500" },
  ];

  return (
    <DashboardCard title="Salary Disbursement">
      <div className="space-y-3">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
          {stages.map((s) => {
            const pct = total > 0 ? (data[s.key] ?? 0) / total * 100 : 0;
            if (pct === 0) return null;
            return <div key={s.key} className={`${s.color}`} style={{ width: `${pct}%` }} />;
          })}
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {stages.map((s) => (
            <div key={s.key}>
              <p className="text-lg font-bold">{data[s.key] ?? 0}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </DashboardCard>
  );
}

// ─── MoM Trend (simple bar chart) ────────────────────────────────────────────

function MoMTrendChart({ data }: { data: OperationalData["momTrend"] }) {
  if (!data || data.length === 0) {
    return (
      <DashboardCard title="Payroll Cost Trend (6 months)">
        <p className="text-sm text-muted-foreground py-8 text-center">No historical payroll data available yet</p>
      </DashboardCard>
    );
  }

  const maxGross = Math.max(...data.map((d) => Number(d.total_gross)));

  return (
    <DashboardCard title="Payroll Cost Trend (6 months)">
      <div className="space-y-2">
        {data.map((row) => {
          const pct = maxGross > 0 ? (Number(row.total_gross) / maxGross) * 100 : 0;
          return (
            <div key={row.run_month} className="flex items-center gap-3">
              <span className="w-16 text-xs text-slate-500 font-mono">{row.run_month}</span>
              <div className="flex-1 h-6 rounded bg-slate-100 relative overflow-hidden">
                <div className="h-full bg-blue-500 rounded" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-20 text-xs font-semibold text-right">{fmtLakh(Number(row.total_gross))}</span>
              <span className="w-12 text-xs text-slate-400 text-right">{row.headcount}emp</span>
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
}

// ─── Branch Readiness Mini ────────────────────────────────────────────────────

function BranchReadinessMini({ branches }: { branches: OperationalData["branchReadiness"] }) {
  if (!branches || branches.length === 0) return null;

  return (
    <DashboardCard title="Branch Readiness">
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {branches.map((b) => {
          const scoreColor = b.readiness_score >= 80 ? "text-emerald-600" : b.readiness_score >= 60 ? "text-amber-600" : "text-red-600";
          return (
            <div key={b.branch_id} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <div className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-sm">{b.branch_name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${scoreColor}`}>{Math.round(b.readiness_score)}%</span>
                {b.branch_head_signoff ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <Link to="/payroll/branch-readiness" className="block mt-3 text-xs font-medium text-blue-600 hover:text-blue-800">
        View Full Readiness →
      </Link>
    </DashboardCard>
  );
}

// ─── Compliance Health ────────────────────────────────────────────────────────

function ComplianceHealth({ filings }: { filings: OperationalData["statutoryFiling"] }) {
  if (!filings || filings.length === 0) {
    return (
      <DashboardCard title="Statutory Compliance">
        <p className="text-sm text-muted-foreground py-4 text-center">No upcoming filing deadlines</p>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Statutory Compliance">
      <div className="space-y-2">
        {filings.slice(0, 6).map((f, i) => {
          const isOverdue = new Date(f.due_date) < new Date() && f.status !== "filed";
          const statusColor = f.status === "filed" ? "text-emerald-600 bg-emerald-50" :
            isOverdue ? "text-red-600 bg-red-50" : "text-amber-600 bg-amber-50";
          return (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <div>
                <p className="text-sm font-medium">{f.filing_type}</p>
                <p className="text-xs text-slate-500">Due: {f.due_date}</p>
              </div>
              <Badge variant="outline" className={`text-xs capitalize ${statusColor}`}>
                {f.status === "filed" ? "Filed" : isOverdue ? "Overdue" : "Pending"}
              </Badge>
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
}

// ─── Variance Alerts ──────────────────────────────────────────────────────────

function VarianceAlerts({ alerts }: { alerts: OperationalData["varianceAlerts"] }) {
  if (!alerts || alerts.length === 0) return null;

  return (
    <DashboardCard title="Salary Variance Alerts (>10% change)">
      <div className="overflow-auto max-h-48">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-500">Employee</th>
              <th className="px-2 py-1.5 text-right text-xs font-semibold text-slate-500">Previous</th>
              <th className="px-2 py-1.5 text-right text-xs font-semibold text-slate-500">Current</th>
              <th className="px-2 py-1.5 text-right text-xs font-semibold text-slate-500">Change</th>
            </tr>
          </thead>
          <tbody>
            {alerts.slice(0, 10).map((a, i) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1.5">
                  <span className="font-mono text-xs text-slate-400">{a.employee_code}</span>{" "}
                  <span className="text-xs">{a.employee_name}</span>
                </td>
                <td className="px-2 py-1.5 text-right text-xs">{fmtINR(Number(a.previous_gross))}</td>
                <td className="px-2 py-1.5 text-right text-xs">{fmtINR(Number(a.current_gross))}</td>
                <td className="px-2 py-1.5 text-right">
                  <span className={`text-xs font-bold ${Number(a.variance_pct) > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {Number(a.variance_pct) > 0 ? "+" : ""}{Number(a.variance_pct).toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}

// ─── Blockers Table ───────────────────────────────────────────────────────────

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
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Blocker Type</th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Count</th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
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
                <button type="button" onClick={() => onDrilldown(row.metricCode, row.label)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
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

// ─── Main Dashboard ───────────────────────────────────────────────────────────

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

  // Fetch existing readiness summary
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

    return () => { cancelled = true; };
  }, []);

  // Fetch operational data
  const { data: ops } = useQuery<OperationalData>({
    queryKey: ["payroll-operational-summary"],
    queryFn: () => hrmsApi.get(`/api/dashboards/PAYROLL_HR_DASHBOARD/operational-summary`).then((r: any) => r.data),
    staleTime: 60_000,
  });

  if (!roleLoading) {
    const roleKeys = roleData?.roleKeys ?? [];
    const allowed =
      roleKeys.includes("super_admin") ||
      roleKeys.includes("admin") ||
      roleKeys.includes("hr") ||
      roleKeys.includes("payroll") ||
      roleKeys.includes("payroll_hr") ||
      roleKeys.includes("payroll_branch") ||
      roleKeys.includes("finance") ||
      roleKeys.includes("payroll_head");

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
      title="Payroll Command Centre"
      subtitle="Live payroll operations, disbursement, compliance and readiness"
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
        {/* Current Run Status */}
        <RunStatusBanner run={ops?.currentRun ?? null} month={ops?.currentMonth ?? ""} />

        {/* Key Metrics Row */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <MetricCard
            label="Salary Bill"
            value={ops?.salaryBill ? fmtLakh(ops.salaryBill.totalGross) : "—"}
            subtitle={ops?.salaryBill ? `${ops.salaryBill.employeeCount} employees` : undefined}
            icon={Banknote}
            variant="default"
          />
          <MetricCard
            label="Salary Hold"
            value={ops?.salaryHoldCount ?? 0}
            subtitle="Employees on hold"
            icon={AlertTriangle}
            variant={ops?.salaryHoldCount && ops.salaryHoldCount > 0 ? "danger" : "default"}
          />
          <MetricCard
            label="HO Queue Pending"
            value={ops?.pendingQueues?.total ?? 0}
            subtitle="Opt-outs, bank, cheque, advances"
            icon={Clock}
            variant={ops?.pendingQueues?.total && ops.pendingQueues.total > 0 ? "warning" : "success"}
            href="/payroll/ho-queues"
          />
          <MetricCard
            label="F&F Pending"
            value={ops?.fnfPending ?? 0}
            subtitle="Full & final settlements"
            icon={FileCheck}
            variant={ops?.fnfPending && ops.fnfPending > 0 ? "warning" : "default"}
            href="/payroll/full-final"
          />
          <MetricCard
            label="Readiness Score"
            value={summary?.readinessScore != null ? `${summary.readinessScore}%` : "—"}
            subtitle="Overall payroll readiness"
            icon={CheckCircle2}
            variant={summary?.readinessScore != null && summary.readinessScore >= 80 ? "success" : "warning"}
            href="/payroll/branch-readiness"
          />
        </div>

        {/* Disbursement + MoM Trend */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DisbursementTracker data={ops?.disbursement ?? {}} />
          <MoMTrendChart data={ops?.momTrend ?? []} />
        </div>

        {/* Branch Readiness + Compliance */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <BranchReadinessMini branches={ops?.branchReadiness ?? []} />
          <ComplianceHealth filings={ops?.statutoryFiling ?? []} />
        </div>

        {/* Variance Alerts */}
        <VarianceAlerts alerts={ops?.varianceAlerts ?? []} />

        {/* Pre-payroll Readiness Actions (existing) */}
        <DashboardActionStrip
          title="Pre-Payroll Readiness — Immediate Actions"
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

        {/* Blockers + Work Inbox */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <BlockersTable blockers={summary?.blockers} loading={summaryLoading} onDrilldown={openDrilldown} />
          </div>
          <div className="lg:col-span-1">
            <WorkInboxPanel maxItems={8} />
          </div>
        </div>

        {/* AI Insight */}
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
              salary_hold: ops?.salaryHoldCount,
              pending_ho_queue: ops?.pendingQueues?.total,
              fnf_pending: ops?.fnfPending,
            }}
          />
        </DashboardCard>
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
