import { useQuery } from "@tanstack/react-query";
import { BookOpen, GraduationCap, ShieldCheck, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

export default function LMSIntegrationAdmin() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["native-lms-admin-dashboard"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/lms/native/admin");
      if (!res.success) throw new Error("Failed to fetch LMS admin dashboard");
      return res.data;
    },
  });

  const stats = {
    batches: Number(data?.batchStats?.total_batches ?? 0),
    activeBatches: Number(data?.batchStats?.active_batches ?? 0),
    trainees: Number(data?.traineeStats?.total_trainees ?? 0),
    activeTrainees: Number(data?.traineeStats?.active_trainees ?? 0),
    certified: Number(data?.traineeStats?.certified ?? 0),
    classrooms: Number(data?.contentStats?.classrooms ?? 0),
    modules: Number(data?.moduleStats?.modules ?? 0),
    contents: Number(data?.fileStats?.contents ?? 0),
  };
  const roleAccess = data?.roleAccess ?? [];
  const batches = data?.batches ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-xs font-black uppercase tracking-[.22em] text-purple-300">Native LMS</p>
          <h1 className="mt-2 text-3xl font-black">LMS Admin</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Embedded LMS administration synced directly with the independent MCN LMS database. No external portal link or separate login required.</p>
        </div>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">{(error as Error).message}</div>}
        {isLoading && <div className="rounded-2xl border bg-white p-6 text-slate-500">Loading LMS admin dashboard…</div>}

        {!isLoading && !error && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><BookOpen className="h-5 w-5 text-blue-600" /><p className="mt-3 text-xs font-bold uppercase text-slate-500">Batches</p><h2 className="text-3xl font-black text-slate-950">{stats.batches}</h2><p className="text-xs text-slate-500">{stats.activeBatches} active</p></div>
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><Users className="h-5 w-5 text-emerald-600" /><p className="mt-3 text-xs font-bold uppercase text-slate-500">Learners</p><h2 className="text-3xl font-black text-slate-950">{stats.trainees}</h2><p className="text-xs text-slate-500">{stats.activeTrainees} active</p></div>
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><GraduationCap className="h-5 w-5 text-purple-600" /><p className="mt-3 text-xs font-bold uppercase text-slate-500">Certified</p><h2 className="text-3xl font-black text-slate-950">{stats.certified}</h2><p className="text-xs text-slate-500">Certified trainees</p></div>
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><ShieldCheck className="h-5 w-5 text-amber-600" /><p className="mt-3 text-xs font-bold uppercase text-slate-500">Content</p><h2 className="text-3xl font-black text-slate-950">{stats.contents}</h2><p className="text-xs text-slate-500">{stats.classrooms} classrooms • {stats.modules} modules</p></div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-lg font-black text-slate-950">LMS Role Access Matrix</h2>
                <div className="max-h-[540px] overflow-y-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Login</th><th>Name</th><th>Role</th><th>Scope</th></tr></thead><tbody>{roleAccess.length === 0 ? <tr><td colSpan={4} className="p-5 text-center text-slate-500">No LMS role access rows found.</td></tr> : roleAccess.map((r: any) => <tr key={r.login_id} className="border-t"><td className="p-3 font-mono text-xs">{r.login_id}</td><td>{r.name ?? r.employee_code ?? "—"}</td><td>{r.role ?? r.portal_access}</td><td>{[r.branch, r.process].filter(Boolean).join(" / ") || "All"}</td></tr>)}</tbody></table></div>
              </div>

              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-lg font-black text-slate-950">Recent LMS Batches</h2>
                <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">{batches.length === 0 ? <p className="text-sm text-slate-500">No batches found.</p> : batches.map((b: any) => <div key={b.id ?? b.batch_no} className="rounded-2xl border bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-blue-600">{b.batch_type ?? "Batch"}</p><h3 className="font-bold text-slate-950">{b.batch_name ?? b.batch_no}</h3><p className="text-xs text-slate-500">{b.branch ?? "—"} • {b.process ?? "—"} • {b.batch_status ?? "—"}</p><p className="mt-2 text-xs text-slate-500">Expected: {b.expected_trainees ?? 0} • Total: {b.total_trainees ?? 0} • Certified: {b.certified ?? 0}</p></div>)}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
