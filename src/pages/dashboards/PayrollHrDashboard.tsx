import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Building2, FileSignature, Landmark, ShieldAlert, ShieldCheck, ShieldX, Sparkles, UserRoundCheck } from "lucide-react";
import { RoleDashboardShell, DashboardDrilldownDrawer, HealthScoreCard, WorkInboxPanel } from "@/components/dashboard";
import type { HealthBreakdownItem } from "@/components/dashboard";
import { AIInsightPanel } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";

const DASHBOARD_CODE = "PAYROLL_HR_DASHBOARD";

interface BlockerCounts { missingBank: number; missingPan: number; missingUan: number; statutoryIncomplete: number }
interface PayrollSummary {
  readinessScore?: number;
  blockers?: BlockerCounts;
  jclrPending?: number;
  nameMismatchBlocking?: string | number | null;
  onboardingValidationPending?: number;
  appointmentEsignPending?: number;
  breakdown?: HealthBreakdownItem[];
}
type DrilldownState = { open: boolean; metricCode: string; metricName: string };

function ActionTile({ icon: Icon, label, value, tone, helper, onClick }: {
  icon: React.ElementType; label: string; value: number | string | null | undefined; tone: string; helper?: string; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex h-full flex-col justify-between gap-6">
        <div className="flex items-start justify-between">
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}><Icon className="h-6 w-6" /></span>
          <span className="text-slate-300">›</span>
        </div>
        <div>
          <p className="text-sm font-black text-slate-800">{label}</p>
          <p className="mt-3 text-5xl font-black tracking-tight text-slate-950">{value ?? "—"}</p>
          {helper && <p className="mt-2 text-sm font-bold text-slate-500">{helper}</p>}
        </div>
      </div>
    </button>
  );
}

function BlockersTable({ blockers, onDrilldown }: { blockers?: BlockerCounts; onDrilldown: (code: string, name: string) => void }) {
  const rows = [
    { label: "Missing Bank Account", desc: "Employees without valid bank account details", count: blockers?.missingBank ?? 0, code: "missing_bank", icon: Building2 },
    { label: "Missing PAN", desc: "Employees without PAN information", count: blockers?.missingPan ?? 0, code: "missing_pan", icon: Landmark },
    { label: "Missing UAN", desc: "Employees without UAN information", count: blockers?.missingUan ?? 0, code: "missing_uan", icon: UserRoundCheck },
    { label: "Statutory Incomplete", desc: "Incomplete PF/ESI/PT statutory details", count: blockers?.statutoryIncomplete ?? 0, code: "statutory_incomplete", icon: ShieldAlert },
  ];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-lg font-black text-slate-950">Employee Blockers</h2></div>
      <div className="overflow-x-auto p-5">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="px-4 py-3 text-left">Blocker Type</th><th className="px-4 py-3 text-left">Description</th><th className="px-4 py-3 text-center">Employees Affected</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ label, desc, count, code, icon: Icon }) => (
              <tr key={code} className="hover:bg-slate-50">
                <td className="px-4 py-4"><div className="flex items-center gap-3"><Icon className="h-5 w-5 text-red-500" /><span className="font-bold text-slate-800">{label}</span></div></td>
                <td className="px-4 py-4 text-slate-600">{desc}</td>
                <td className="px-4 py-4 text-center text-xl font-black text-red-600">{count}</td>
                <td className="px-4 py-4 text-right"><Button size="sm" variant="outline" onClick={() => onDrilldown(code, label)}>View</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PayrollHrDashboard() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownState>({ open: false, metricCode: "", metricName: "" });
  const openDrilldown = useCallback((metricCode: string, metricName: string) => setDrilldown({ open: true, metricCode, metricName }), []);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    setFetchError(null);
    hrmsApi.get(`/api/dashboards/${DASHBOARD_CODE}/summary`)
      .then((json) => { if (!cancelled) setSummary(normalizeDashboardSummary<PayrollSummary>(DASHBOARD_CODE, json as any)); })
      .catch((err) => { if (!cancelled) setFetchError(err.message ?? "Failed to load dashboard summary."); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const nameMismatchCount = useMemo(() => {
    const raw = summary?.nameMismatchBlocking;
    if (raw == null || raw === "") return 0;
    return typeof raw === "number" ? raw : Number(raw) || 0;
  }, [summary?.nameMismatchBlocking]);

  if (!roleLoading) {
    const roleKeys = roleData?.roleKeys ?? [];
    const allowed = roleKeys.includes("super_admin") || roleKeys.includes("hr") || roleKeys.includes("payroll") || roleKeys.includes("finance");
    if (!allowed) {
      return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><div className="max-w-sm rounded-xl border bg-white p-8 text-center shadow-sm"><ShieldX className="mx-auto mb-4 h-12 w-12 text-red-400" /><h2 className="text-lg font-semibold">Access Restricted</h2><p className="mb-4 mt-1 text-sm text-slate-500">This dashboard is only accessible to HR, Payroll, and Finance roles.</p><Button asChild variant="outline"><Link to="/dashboard">Go to Dashboard</Link></Button></div></div>;
    }
  }

  return (
    <RoleDashboardShell title="Payroll & HR Dashboard" subtitle="Payroll readiness, blockers and validation queue" scopeLabel="Payroll HR View" loading={summaryLoading || roleLoading}>
      {fetchError && <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><AlertCircle className="h-4 w-4" />{fetchError}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><HealthScoreCard score={summary?.readinessScore ?? 0} label="Payroll Readiness Score" breakdown={summary?.breakdown} loading={summaryLoading} /></div>
        <ActionTile icon={FileSignature} label="JCLR Pending" value={summary?.jclrPending} tone="bg-orange-50 text-orange-600" helper="Needs Action" onClick={() => openDrilldown("jclr_pending", "JCLR Pending")} />
        <ActionTile icon={UserRoundCheck} label="Name Mismatch (Blocking)" value={nameMismatchCount} tone="bg-red-50 text-red-600" helper="Blocking Payroll" onClick={() => openDrilldown("name_mismatch_blocking", "Name Mismatch — Blocking Employee Code")} />
        <ActionTile icon={UserRoundCheck} label="Onboarding Validation Pending" value={summary?.onboardingValidationPending} tone="bg-violet-50 text-violet-600" helper="Pending Validation" onClick={() => openDrilldown("onboarding_validation_pending", "Onboarding — Submitted but Validation Pending")} />
        <ActionTile icon={FileSignature} label="Appointment e-Sign Pending" value={summary?.appointmentEsignPending} tone="bg-orange-50 text-orange-600" helper="Pending e-Sign" onClick={() => openDrilldown("appointment_esign_pending", "Appointment e-Sign Pending")} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-600" /><h2 className="text-lg font-black text-slate-950">Payroll AI Readiness Check</h2></div>
        <AIInsightPanel contextType="payroll_readiness" role="payroll_hr" title="" enabled={!summaryLoading && summary !== null} data={{ readiness_score: summary?.readinessScore, missing_bank: summary?.blockers?.missingBank, missing_pan: summary?.blockers?.missingPan, missing_uan: summary?.blockers?.missingUan, statutory_incomplete: summary?.blockers?.statutoryIncomplete, jclr_pending: summary?.jclrPending, name_mismatch_blocking: nameMismatchCount, onboarding_validation_pending: summary?.onboardingValidationPending, appointment_esign_pending: summary?.appointmentEsignPending }} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3"><BlockersTable blockers={summary?.blockers} onDrilldown={openDrilldown} /></div>
        <div className="xl:col-span-2"><WorkInboxPanel maxItems={8} /></div>
      </div>

      <DashboardDrilldownDrawer open={drilldown.open} onClose={() => setDrilldown((prev) => ({ ...prev, open: false }))} metricCode={drilldown.metricCode} metricName={drilldown.metricName} dashboardCode={DASHBOARD_CODE} />
    </RoleDashboardShell>
  );
}
