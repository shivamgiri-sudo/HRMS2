import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, FileWarning, Hourglass, ShieldCheck, ShieldX, Sparkles, UserCheck, UserPlus, Users } from "lucide-react";
import { RoleDashboardShell, DashboardDrilldownDrawer, WorkInboxPanel } from "@/components/dashboard";
import { AIInsightPanel } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";

const DASHBOARD_CODE = "HR_DASHBOARD";

interface HrSummary {
  selectedCandidates?: number;
  onboarding?: { submitted?: number; pending?: number; stuck?: number };
  bgvPending?: number;
  dpdpWithdrawals?: number;
  resignationDiscussionPending?: number;
}

type DrilldownState = { open: boolean; metricCode: string; metricName: string };

type TileTone = "blue" | "green" | "amber" | "red" | "purple" | "orange";

const toneMap: Record<TileTone, string> = {
  blue: "border-blue-100 bg-blue-50/40 text-blue-700",
  green: "border-emerald-100 bg-emerald-50/40 text-emerald-700",
  amber: "border-amber-100 bg-amber-50/50 text-amber-700",
  red: "border-red-100 bg-red-50/50 text-red-700",
  purple: "border-violet-100 bg-violet-50/50 text-violet-700",
  orange: "border-orange-100 bg-orange-50/50 text-orange-700",
};

function MetricTile({
  icon: Icon,
  label,
  value,
  tone,
  helper,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number | null | undefined;
  tone: TileTone;
  helper?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneMap[tone]}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            <Icon className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-700">{label}</p>
            <p className="mt-1 text-4xl font-black tracking-tight text-slate-950">{value ?? "—"}</p>
          </div>
        </div>
        <span className="text-xl text-slate-400 transition group-hover:translate-x-1">›</span>
      </div>
      {helper && <p className="mt-4 text-xs font-semibold text-slate-500">{helper}</p>}
    </button>
  );
}

export default function HrDashboard() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const [summary, setSummary] = useState<HrSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownState>({ open: false, metricCode: "", metricName: "" });

  const openDrilldown = useCallback((metricCode: string, metricName: string) => {
    setDrilldown({ open: true, metricCode, metricName });
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
    return () => { cancelled = true; };
  }, []);

  if (!roleLoading) {
    const roleKeys = roleData?.roleKeys ?? [];
    const allowed = roleKeys.includes("super_admin") || roleKeys.includes("hr") || roleKeys.includes("admin");
    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="max-w-sm rounded-xl border bg-white p-8 text-center shadow-sm">
            <ShieldX className="mx-auto mb-4 h-12 w-12 text-red-400" />
            <h2 className="text-lg font-semibold text-slate-900">Access Restricted</h2>
            <p className="mb-4 mt-1 text-sm text-slate-500">This dashboard is only accessible to HR and Admin roles.</p>
            <Button asChild variant="outline"><Link to="/dashboard">Go to Dashboard</Link></Button>
          </div>
        </div>
      );
    }
  }

  return (
    <RoleDashboardShell
      title="HR Dashboard"
      subtitle="Recruitment, onboarding, BGV and exit management"
      scopeLabel="HR View"
      loading={summaryLoading || roleLoading}
    >
      {fetchError && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          <AlertCircle className="h-4 w-4" /> {fetchError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricTile icon={UserCheck} label="Selected Candidates" value={summary?.selectedCandidates} tone="blue" helper="ATS selected pipeline" onClick={() => openDrilldown("selected_candidates", "Selected Candidates")} />
        <MetricTile icon={ShieldCheck} label="Onboarding Submitted" value={summary?.onboarding?.submitted} tone="green" helper="Submitted records" onClick={() => openDrilldown("onboarding_submitted", "Onboarding Submitted")} />
        <MetricTile icon={Hourglass} label="Onboarding Pending" value={summary?.onboarding?.pending} tone="amber" helper="Pending HR review" onClick={() => openDrilldown("onboarding_pending", "Onboarding Pending")} />
        <MetricTile icon={FileWarning} label="Onboarding Stuck" value={summary?.onboarding?.stuck} tone="red" helper="Needs immediate action" onClick={() => openDrilldown("onboarding_stuck", "Onboarding Stuck")} />
        <MetricTile icon={ShieldCheck} label="BGV Pending" value={summary?.bgvPending} tone="red" helper="Verification queue" onClick={() => openDrilldown("bgv_pending", "BGV Pending")} />
        <MetricTile icon={FileWarning} label="DPDP Withdrawal Requests" value={summary?.dpdpWithdrawals} tone="purple" helper="Privacy requests" onClick={() => openDrilldown("dpdp_withdrawals", "DPDP Withdrawal Requests")} />
        <MetricTile icon={Users} label="Resignation Discussions Pending" value={summary?.resignationDiscussionPending} tone="orange" helper="Manager discussion queue" onClick={() => openDrilldown("resignation_pending", "Resignation Discussions Pending")} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-600" />
              <h2 className="text-lg font-black text-slate-950">HR Operations AI Briefing</h2>
            </div>
            <span className="rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">AI</span>
          </div>
          <AIInsightPanel
            contextType="hr_dashboard"
            role="hr"
            title=""
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
        </div>
        <div className="xl:col-span-2">
          <WorkInboxPanel maxItems={8} />
        </div>
      </div>

      <DashboardDrilldownDrawer
        open={drilldown.open}
        onClose={() => setDrilldown((prev) => ({ ...prev, open: false }))}
        metricCode={drilldown.metricCode}
        metricName={drilldown.metricName}
        dashboardCode={DASHBOARD_CODE}
      />
    </RoleDashboardShell>
  );
}
