import { useQuery } from "@tanstack/react-query";
import { BookOpen, RefreshCw, Users, AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

export default function NativeLMSCoordinator() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["native-lms-coordinator-dashboard"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/lms/native/coordinator");
      if (!res.success) throw new Error("Failed to fetch LMS coordinator dashboard");
      return res.data;
    },
  });

  const batches = data?.batches ?? [];
  const trainees = data?.trainees ?? [];
  const attendance = data?.attendance ?? [];
  const scope = data?.scope ?? {};

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-xs font-black uppercase tracking-[.22em] text-emerald-300">Native LMS</p>
          <h1 className="mt-2 text-3xl font-black">LMS Coordinator</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Training coordination embedded inside HRMS and synced with the independent MCN LMS database.</p>
        </div>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 flex gap-3"><AlertTriangle className="h-5 w-5" />{(error as Error).message}</div>}
        {isLoading && <div className="rounded-2xl border bg-white p-6 text-slate-500">Loading coordinator dashboard…</div>}

        {!isLoading && !error && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Scope Branch</p><h2 className="mt-2 font-black text-slate-950">{scope.branch ?? "All"}</h2></div>
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Scope Process</p><h2 className="mt-2 font-black text-slate-950">{scope.process ?? "All"}</h2></div>
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Batches</p><h2 className="mt-2 font-black text-slate-950">{batches.length}</h2></div>
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Trainees</p><h2 className="mt-2 font-black text-slate-950">{trainees.length}</h2></div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-black text-slate-950"><BookOpen className="h-5 w-5" />Active Batches</h2><button onClick={() => refetch()} className="rounded-xl border px-3 py-2 text-xs font-bold"><RefreshCw className="inline h-3.5 w-3.5" /> Refresh</button></div>
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">{batches.length === 0 ? <p className="text-sm text-slate-500">No batches found for your LMS scope.</p> : batches.map((b: any) => <div key={b.id ?? b.batch_no} className="rounded-2xl border bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-blue-600">{b.batch_type ?? "Batch"}</p><h3 className="font-bold text-slate-950">{b.batch_name ?? b.batch_no}</h3><p className="text-xs text-slate-500">{b.branch ?? "—"} • {b.process ?? "—"} • {b.batch_status ?? "—"}</p><p className="mt-2 text-xs text-slate-500">Trainees: {b.total_trainees ?? 0} • Certified: {b.certified ?? 0}</p></div>)}</div>
              </div>

              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-950"><Users className="h-5 w-5" />Learners</h2>
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">{trainees.length === 0 ? <p className="text-sm text-slate-500">No learners found.</p> : trainees.map((t: any) => <div key={t.id ?? t.employee_id} className="rounded-2xl border p-4"><h3 className="font-bold text-slate-950">{t.trainee_name ?? t.employee_id}</h3><p className="text-xs text-slate-500">{t.employee_id} • {t.batch_no ?? "No batch"}</p><p className="mt-2 text-xs text-slate-500">Course: {Number(t.course_completion_pct ?? 0).toFixed(0)}% • Assessment Pass: {Number(t.assessment_pass_pct ?? 0).toFixed(0)}% • {t.risk_status ?? "HEALTHY"}</p></div>)}</div>
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-black text-slate-950">Recent Attendance Inference</h2>
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Batch</th><th>Employee</th><th>Date</th><th>Status</th></tr></thead><tbody>{attendance.length === 0 ? <tr><td colSpan={4} className="p-5 text-center text-slate-500">No attendance inference rows found.</td></tr> : attendance.slice(0, 50).map((a: any) => <tr key={a.id} className="border-t"><td className="p-3">{a.batch_no ?? "—"}</td><td>{a.employee_id ?? "—"}</td><td>{String(a.attendance_date ?? a.created_at ?? "").slice(0, 10)}</td><td>{a.status ?? a.inferred_status ?? "—"}</td></tr>)}</tbody></table></div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
