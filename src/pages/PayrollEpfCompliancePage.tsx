import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, RotateCcw } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

type ReadinessRow = { branch_name: string | null; process_name: string | null; total_employees: number; pf_ready: number; pf_pending: number; pf_not_applicable: number; pf_error: number };

type Row = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  status: string;
  compliance_stage: string;
  consent_status: string;
  correction_status: string;
  joining_date: string | null;
  gross_monthly_wage: number | null;
  uan_masked: string | null;
  branch_name: string | null;
  process_name: string | null;
  ecr_status: string | null;
  missing_fields: string | null;
  error_count: number;
};

function statusText(value?: string | null) {
  return String(value || "pending").replace(/_/g, " ");
}

export default function PayrollEpfCompliancePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remarksByEmployee, setRemarksByEmployee] = useState<Record<string, string>>({});
  const [busyEmployeeId, setBusyEmployeeId] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessRow[]>([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, readinessRes] = await Promise.all([
        hrmsApi.get<{ data: Row[] }>("/api/payroll/epf-compliance"),
        hrmsApi.get<{ data: ReadinessRow[] }>("/api/payroll/pf/reports/readiness").catch(() => ({ data: [] })),
      ]);
      setRows(response.data || []);
      setReadiness(readinessRes.data || []);
    } catch (err: any) {
      setError(err?.message || "Unable to load payroll EPF compliance queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const review = async (employeeId: string, decision: "approved" | "pushback") => {
    setBusyEmployeeId(employeeId);
    try {
      await hrmsApi.post(`/api/payroll/epf-compliance/${employeeId}/review`, {
        decision,
        remarks: remarksByEmployee[employeeId] || "",
      });
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to save the payroll review.");
    } finally {
      setBusyEmployeeId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Payroll EPF Compliance</p>
                <h1 className="mt-2 text-2xl font-black text-slate-900">Review queue and ECR readiness</h1>
                <p className="mt-1 text-sm text-slate-500">Payroll can see which packs are ready, which still need correction, and which are blocked for ECR.</p>
              </div>
              <div className="flex gap-2 self-start">
                <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={() => void load()}>
                  <RefreshCw className="h-4 w-4" /> Refresh queue
                </Button>
                <Button asChild type="button" className="min-h-[44px] gap-2 bg-blue-600 text-white hover:bg-blue-700">
                  <Link to="/payroll/pf-creation-queue">PF Creation Queue</Link>
                </Button>
              </div>
            </div>
          </div>

          {/* PF Readiness Summary */}
          {readiness.length > 0 && (() => {
            const t = readiness.reduce((a, r) => ({ total: a.total + r.total_employees, ready: a.ready + r.pf_ready, pending: a.pending + r.pf_pending, na: a.na + r.pf_not_applicable, error: a.error + r.pf_error }), { total: 0, ready: 0, pending: 0, na: 0, error: 0 });
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="rounded-2xl border bg-white p-3 text-center"><p className="text-xl font-black text-slate-900">{t.total}</p><p className="text-[10px] uppercase text-slate-500">Total</p></div>
                <div className="rounded-2xl border bg-emerald-50 p-3 text-center"><p className="text-xl font-black text-emerald-700">{t.ready}</p><p className="text-[10px] uppercase text-emerald-600">PF Ready</p></div>
                <div className="rounded-2xl border bg-amber-50 p-3 text-center"><p className="text-xl font-black text-amber-700">{t.pending}</p><p className="text-[10px] uppercase text-amber-600">Pending</p></div>
                <div className="rounded-2xl border bg-slate-50 p-3 text-center"><p className="text-xl font-black text-slate-600">{t.na}</p><p className="text-[10px] uppercase text-slate-500">N/A</p></div>
                <div className="rounded-2xl border bg-red-50 p-3 text-center"><p className="text-xl font-black text-red-700">{t.error}</p><p className="text-[10px] uppercase text-red-600">Errors</p></div>
              </div>
            );
          })()}

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="font-semibold">{error}</p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-[28px] border bg-white">
              <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="grid gap-4">
              {rows.map((row) => (
                <div key={row.employee_id} className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-black text-slate-900">{row.employee_name}</h2>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">{row.employee_code}</span>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${row.error_count > 0 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{row.error_count} blocking issue{row.error_count === 1 ? "" : "s"}</span>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                        <p><span className="text-slate-400">Branch:</span> {row.branch_name || "—"}</p>
                        <p><span className="text-slate-400">Process:</span> {row.process_name || "—"}</p>
                        <p><span className="text-slate-400">Pack:</span> {statusText(row.status)}</p>
                        <p><span className="text-slate-400">Stage:</span> {statusText(row.compliance_stage)}</p>
                        <p><span className="text-slate-400">Consent:</span> {statusText(row.consent_status)}</p>
                        <p><span className="text-slate-400">Correction:</span> {statusText(row.correction_status)}</p>
                        <p><span className="text-slate-400">ECR:</span> {statusText(row.ecr_status)}</p>
                        <p><span className="text-slate-400">UAN:</span> {row.uan_masked || "—"}</p>
                      </div>
                      {row.missing_fields && (
                        <p className="mt-3 text-xs text-amber-700">Missing fields: {row.missing_fields}</p>
                      )}
                    </div>

                    <div className="w-full space-y-3 xl:max-w-md">
                      <textarea
                        value={remarksByEmployee[row.employee_id] || ""}
                        onChange={(event) => setRemarksByEmployee((current) => ({ ...current, [row.employee_id]: event.target.value }))}
                        placeholder="Payroll remarks or correction notes..."
                        className="min-h-[84px] w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                      />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Button asChild type="button" variant="outline" className="min-h-[44px] gap-2">
                          <Link to={`/employees/${row.employee_id}/epf-compliance`}>
                            <ExternalLink className="h-4 w-4" /> Open pack
                          </Link>
                        </Button>
                        <Button type="button" variant="outline" className="min-h-[44px] border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => void review(row.employee_id, "pushback")} disabled={busyEmployeeId === row.employee_id}>
                          {busyEmployeeId === row.employee_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Push back
                        </Button>
                        <Button type="button" className="min-h-[44px] bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void review(row.employee_id, "approved")} disabled={busyEmployeeId === row.employee_id}>
                          {busyEmployeeId === row.employee_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
