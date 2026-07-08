import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CalendarClock, Clock, ShieldX, Sparkles, Target, UserRoundCheck, Users } from "lucide-react";
import { RoleDashboardShell, AgingBucketCard, DashboardDrilldownDrawer, WorkInboxPanel, ScopedFilterBar } from "@/components/dashboard";
import type { AgingBucket, KpiMetric } from "@/components/dashboard";
import { InterventionPanel } from "@/components/dashboard/InterventionPanel";
import type { InterventionFlag } from "@/components/dashboard/InterventionPanel";
import { AIInsightPanel } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeDashboardSummary } from "@/lib/dashboardCompat";

const DASHBOARD_CODE = "WFM_DASHBOARD";

interface WfmSummary {
  requiredHc?: number;
  availableHc?: number;
  rosterAdherence?: number;
  missingPunch?: number;
  attendanceVarianceBuckets?: Array<{ label: string; count: number; color?: string }>;
}

type DrilldownState = { open: boolean; metricCode: string; metricName: string };

const DEFAULT_VARIANCE_BUCKETS: AgingBucket[] = [
  { label: "0–1 hr", count: 0, color: "#16a34a" },
  { label: "1–4 hr", count: 0, color: "#d97706" },
  { label: "4+ hr", count: 0, color: "#dc2626" },
];

function WfmTile({ icon: Icon, label, value, unit, tone, onClick }: { icon: React.ElementType; label: string; value: number | null | undefined; unit?: string; tone: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-4">
        <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${tone}`}><Icon className="h-7 w-7" /></span>
        <div className="h-12 w-24 rounded-lg bg-gradient-to-r from-slate-100 to-slate-50" />
      </div>
      <p className="mt-4 text-sm font-black text-slate-700">{label}</p>
      <p className="mt-1 text-4xl font-black tracking-tight text-slate-950">{value ?? "—"}{unit && <span className="text-xl">{unit}</span>}</p>
    </button>
  );
}

export default function WfmDashboard() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const [summary, setSummary] = useState<WfmSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [opsPulseFlags, setOpsPulseFlags] = useState<InterventionFlag[]>([]);
  const [drilldown, setDrilldown] = useState<DrilldownState>({ open: false, metricCode: "", metricName: "" });
  const [branchId, setBranchId] = useState<string>("");
  const [processId, setProcessId] = useState<string>("");
  const openDrilldown = useCallback((metricCode: string, metricName: string) => setDrilldown({ open: true, metricCode, metricName }), []);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    setFetchError(null);
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (processId) params.set("processId", processId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    hrmsApi.get(`/api/dashboards/${DASHBOARD_CODE}/summary${qs}`)
      .then((json) => { if (!cancelled) setSummary(normalizeDashboardSummary<WfmSummary>(DASHBOARD_CODE, json as any)); })
      .catch((err) => { if (!cancelled) setFetchError(err.message ?? "Failed to load WFM dashboard summary."); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, processId]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (processId) params.set("processId", processId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    hrmsApi.get<{ success: boolean; data: { intervention_flags?: InterventionFlag[] } }>(`/api/bi/daily-operations-pulse${qs}`)
      .then((res) => setOpsPulseFlags((res as any)?.data?.intervention_flags ?? []))
      .catch(() => setOpsPulseFlags([]));
  }, [branchId, processId]);

  if (!roleLoading) {
    const roleKeys = roleData?.roleKeys ?? [];
    const allowed = roleKeys.includes("super_admin") || roleKeys.includes("wfm") || roleKeys.includes("admin") || roleKeys.includes("branch_head") || roleKeys.includes("process_manager");
    if (!allowed) {
      return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><div className="max-w-sm rounded-xl border bg-white p-8 text-center shadow-sm"><ShieldX className="mx-auto mb-4 h-12 w-12 text-red-400" /><h2 className="text-lg font-semibold">Access Restricted</h2><p className="mb-4 mt-1 text-sm text-slate-500">This dashboard is only accessible to WFM, Branch Head, and Process Manager roles.</p><Button asChild variant="outline"><Link to="/dashboard">Go to Dashboard</Link></Button></div></div>;
    }
  }

  const hcGap = summary?.requiredHc != null && summary?.availableHc != null ? summary.requiredHc - summary.availableHc : null;
  const varianceBuckets: AgingBucket[] = summary?.attendanceVarianceBuckets && summary.attendanceVarianceBuckets.length > 0 ? summary.attendanceVarianceBuckets : DEFAULT_VARIANCE_BUCKETS;

  const metrics: KpiMetric[] = [
    { id: "required_hc", metric: "Required HC", value: summary?.requiredHc ?? null, unit: "" },
    { id: "available_hc", metric: "Available HC", value: summary?.availableHc ?? null, unit: "" },
    { id: "roster_adherence", metric: "Roster Adherence", value: summary?.rosterAdherence ?? null, unit: "%" },
    { id: "missing_punch", metric: "Missing Punch", value: summary?.missingPunch ?? null, unit: "" },
  ];

  return (
    <RoleDashboardShell
      title="WFM Dashboard"
      subtitle="Workforce management — headcount, roster and attendance"
      scopeLabel="WFM View"
      loading={summaryLoading || roleLoading}
      headerActions={<ScopedFilterBar onBranchChange={setBranchId} onProcessChange={setProcessId} onDateRangeChange={() => {}} showDateRange={false} className="border-0 shadow-none px-0 py-0" />}
    >
      {fetchError && <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><AlertCircle className="h-4 w-4" />{fetchError}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <WfmTile icon={Users} label="Required HC" value={summary?.requiredHc} tone="bg-blue-50 text-blue-600" onClick={() => openDrilldown("required_hc", "Required Headcount")} />
        <WfmTile icon={UserRoundCheck} label="Available HC" value={summary?.availableHc} tone="bg-emerald-50 text-emerald-600" onClick={() => openDrilldown("available_hc", "Available Headcount")} />
        <WfmTile icon={Target} label="Roster Adherence" value={summary?.rosterAdherence} unit="%" tone="bg-violet-50 text-violet-600" onClick={() => openDrilldown("roster_adherence", "Roster Adherence")} />
        <WfmTile icon={Clock} label="Missing Punch" value={summary?.missingPunch} tone="bg-red-50 text-red-600" onClick={() => openDrilldown("missing_punch", "Missing Punch")} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-red-100 bg-red-50/40 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><AlertCircle className="h-5 w-5 text-red-600" /><h2 className="text-lg font-black text-slate-950">Today's Operations Alerts</h2></div><span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-black text-white">{opsPulseFlags.length}</span></div>
          {opsPulseFlags.length > 0 ? <InterventionPanel flags={opsPulseFlags} title="" collapsible /> : <p className="rounded-xl bg-white p-5 text-sm font-semibold text-slate-500">No critical WFM intervention flags are currently returned by the operations pulse API.</p>}
        </div>
        <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-600" /><h2 className="text-lg font-black text-slate-950">Workforce AI Analysis</h2></div>
          <AIInsightPanel contextType="wfm_roster" role="wfm" title="" enabled={!summaryLoading && summary !== null} data={{ required_hc: summary?.requiredHc, available_hc: summary?.availableHc, hc_gap: hcGap, roster_adherence_pct: summary?.rosterAdherence, missing_punch: summary?.missingPunch, attendance_variance_buckets: summary?.attendanceVarianceBuckets }} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <AgingBucketCard title="Attendance Variance Buckets (vs Scheduled Hours)" buckets={varianceBuckets} loading={summaryLoading} />
        <WorkInboxPanel maxItems={8} />
      </div>

      <DashboardDrilldownDrawer open={drilldown.open} onClose={() => setDrilldown((prev) => ({ ...prev, open: false }))} metricCode={drilldown.metricCode} metricName={drilldown.metricName} dashboardCode={DASHBOARD_CODE} />
    </RoleDashboardShell>
  );
}
