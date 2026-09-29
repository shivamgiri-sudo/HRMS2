import { DollarSign, FileText, Calendar, AlertCircle, Clock, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePayrollAnalytics } from "@/hooks/usePayrollDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : new Intl.NumberFormat("en-IN").format(v);
}

function fmtCurr(v: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function PayrollAnalyticsPanel() {
  const { data, isLoading, error } = usePayrollAnalytics();

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-32 w-full rounded-2xl" /><Skeleton className="h-48 w-full rounded-2xl" /></div>;
  if (error) return <Card className="rounded-2xl border border-red-200 bg-red-50/50"><CardContent className="p-6"><p className="text-sm font-medium text-red-700">Unable to load payroll analytics.</p></CardContent></Card>;

  const disputes = data?.salary_disputes ?? { open: 0, in_review: 0, resolved: 0, avg_resolution_days: 0 };
  const reimbursement = data?.reimbursement_backlog ?? { total_pending: 0, under_7_days: 0, "7_to_15_days": 0, over_15_days: 0 };
  const readiness = data?.payroll_readiness ?? { attendance_finalized_pct: 0, cosec_synced_pct: 0, roster_locked_pct: 0, overall_readiness_pct: 0 };
  const tds = data?.tds_status ?? { last_filed_quarter: null, next_deadline: null, projections_ready: false };
  const gratuity = data?.gratuity_liability ?? { total_accrued: 0, employees_eligible_this_year: 0 };
  const ff = data?.ff_settlement ?? { pending_count: 0, avg_tat_days: 0, overdue_count: 0 };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">Disputes Open</CardTitle><div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-50"><AlertCircle className="h-4 w-4 text-red-600" /></div></div></CardHeader>
          <CardContent><div className="text-2xl font-black text-slate-900">{fmt(disputes.open)}</div><p className="text-xs font-medium text-slate-500 mt-1">{disputes.in_review} In Review</p></CardContent>
        </Card>
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">Reimbursements</CardTitle><div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50"><FileText className="h-4 w-4 text-amber-600" /></div></div></CardHeader>
          <CardContent><div className="text-2xl font-black text-slate-900">{fmt(reimbursement.total_pending)}</div><p className="text-xs font-medium text-slate-500 mt-1">{reimbursement.over_15_days} &gt; 15d</p></CardContent>
        </Card>
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">Readiness</CardTitle><div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50"><CheckCircle className="h-4 w-4 text-blue-600" /></div></div></CardHeader>
          <CardContent><div className="text-2xl font-black text-slate-900">{readiness.overall_readiness_pct}%</div><p className="text-xs font-medium text-slate-500 mt-1">Payroll Ready</p></CardContent>
        </Card>
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">F&F Pending</CardTitle><div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-50"><Clock className="h-4 w-4 text-purple-600" /></div></div></CardHeader>
          <CardContent><div className="text-2xl font-black text-slate-900">{fmt(ff.pending_count)}</div><p className="text-xs font-medium text-slate-500 mt-1">{ff.overdue_count} Overdue</p></CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-2xl"><CardTitle className="text-base font-bold">Payroll Readiness Breakdown</CardTitle></CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Attendance", pct: readiness.attendance_finalized_pct },
              { label: "COSEC Synced", pct: readiness.cosec_synced_pct },
              { label: "Roster Locked", pct: readiness.roster_locked_pct },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <div className={cn("text-3xl font-black", item.pct >= 90 ? "text-emerald-600" : item.pct >= 75 ? "text-amber-600" : "text-red-600")}>{item.pct}%</div>
                <p className="text-sm font-semibold text-slate-600 mt-1">{item.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-purple-600 to-violet-600 text-white rounded-t-2xl"><CardTitle className="text-base font-bold">Gratuity & Statutory</CardTitle></CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center"><div className="text-2xl font-black text-purple-700">{fmtCurr(gratuity.total_accrued)}</div><p className="text-sm font-semibold text-slate-600 mt-1">Gratuity Accrued</p></div>
            <div className="text-center"><div className="text-2xl font-black text-indigo-700">{fmt(gratuity.employees_eligible_this_year)}</div><p className="text-sm font-semibold text-slate-600 mt-1">Eligible Employees</p></div>
            <div className="text-center"><div className="text-xl font-black text-slate-900">{tds.last_filed_quarter ?? "N/A"}</div><p className="text-sm font-semibold text-slate-600 mt-1">TDS Last Filed</p></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
