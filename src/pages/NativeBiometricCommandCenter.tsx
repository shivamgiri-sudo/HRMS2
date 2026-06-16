import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Clock, RefreshCcw, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

interface ApiResponse<T> { success: boolean; data: T; meta?: Record<string, unknown>; }
interface Summary { mandate_agent_days?: number; present_days?: number; half_days?: number; absent_days?: number; late_days?: number; adherence_pct?: number; late_pct?: number; shrinkage_pct?: number; }
interface AgentRow { employee_code: string; employee_name: string; working_days: number; present_days: number; half_days: number; absent_days: number; late_days: number; adherence_pct: number; late_pct: number; total_biometric_hours: number; }
interface ReconRow { record_date: string; employee_code: string; employee_name: string; attendance_status: string; biometric_minutes: number; imported_biometric_minutes?: number; first_punch?: string | null; last_punch?: string | null; mismatch_type?: string | null; }

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};

function queryString(filters: { from: string; to: string }) {
  return new URLSearchParams(filters).toString();
}

function MetricCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <div className="rounded-xl bg-indigo-50 p-2 text-indigo-700">{icon}</div>
      </div>
      <p className="mt-3 text-2xl font-black text-slate-950">{value ?? "–"}</p>
    </div>
  );
}

export default function NativeBiometricCommandCenter() {
  const [filters, setFilters] = useState({ from: monthStart(), to: today() });
  const qs = useMemo(() => queryString(filters), [filters]);

  const summary = useQuery({
    queryKey: ["biometric-summary", qs],
    queryFn: async () => (await hrmsApi.get<ApiResponse<Summary>>(`/api/wfm/biometric-summary/adherence-summary?${qs}`)).data,
  });
  const agents = useQuery({
    queryKey: ["biometric-agent-view", qs],
    queryFn: async () => (await hrmsApi.get<ApiResponse<AgentRow[]>>(`/api/wfm/biometric-summary/agent-view?${qs}&limit=200`)).data,
  });
  const recon = useQuery({
    queryKey: ["biometric-reconciliation", qs],
    queryFn: async () => (await hrmsApi.get<ApiResponse<ReconRow[]>>(`/api/wfm/biometric-summary/reconciliation?${qs}&limit=200`)).data,
  });

  const s = summary.data ?? {};
  const mismatchRows = (recon.data ?? []).filter((row) => row.mismatch_type);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 md:p-6">
        <div className="mb-6 flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-indigo-950 to-slate-900 p-5 text-white shadow-xl md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-200">WFM · Biometric Intelligence</p>
            <h1 className="mt-2 text-2xl font-black md:text-3xl">Adherence Command Center</h1>
            <p className="mt-1 max-w-3xl text-sm text-indigo-100">COSEC punch migration, attendance reconciliation, adherence KPIs, and agent-level biometric performance in one place.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-indigo-100">From<br /><input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="mt-1 rounded-xl border-0 px-3 py-2 text-slate-900" /></label>
            <label className="text-xs font-bold text-indigo-100">To<br /><input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="mt-1 rounded-xl border-0 px-3 py-2 text-slate-900" /></label>
            <Button onClick={() => { summary.refetch(); agents.refetch(); recon.refetch(); }} className="rounded-xl bg-white text-indigo-950 hover:bg-indigo-50"><RefreshCcw className="mr-2 h-4 w-4" />Refresh</Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Mandate Days" value={s.mandate_agent_days ?? 0} icon={<Users className="h-5 w-5" />} />
          <MetricCard label="Adherence %" value={`${s.adherence_pct ?? 0}%`} icon={<Activity className="h-5 w-5" />} />
          <MetricCard label="Late %" value={`${s.late_pct ?? 0}%`} icon={<Clock className="h-5 w-5" />} />
          <MetricCard label="Mismatches" value={mismatchRows.length} icon={<AlertTriangle className="h-5 w-5" />} />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-extrabold text-slate-950">Agent Attendance View</h2>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Employee</th><th className="p-2">Work</th><th className="p-2">Present</th><th className="p-2">Late</th><th className="p-2">Adh%</th><th className="p-2">Bio Hours</th></tr></thead>
                <tbody>
                  {(agents.data ?? []).map((row) => <tr key={row.employee_code} className="border-t"><td className="p-2 font-bold">{row.employee_name}<br /><span className="text-xs font-normal text-slate-500">{row.employee_code}</span></td><td className="p-2">{row.working_days}</td><td className="p-2">{row.present_days}</td><td className="p-2">{row.late_days}</td><td className="p-2">{row.adherence_pct}%</td><td className="p-2">{row.total_biometric_hours}</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-extrabold text-slate-950">Reconciliation Exceptions</h2>
            <div className="mt-4 space-y-2">
              {mismatchRows.slice(0, 30).map((row, idx) => (
                <div key={`${row.employee_code}-${row.record_date}-${idx}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-amber-950">{row.employee_name} · {row.employee_code}</p><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-amber-800">{row.mismatch_type}</span></div>
                  <p className="mt-1 text-xs text-amber-900">{row.record_date} · Status: {row.attendance_status} · Imported minutes: {row.imported_biometric_minutes ?? row.biometric_minutes ?? 0}</p>
                </div>
              ))}
              {mismatchRows.length === 0 && <p className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">No reconciliation exceptions found for this range.</p>}
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
