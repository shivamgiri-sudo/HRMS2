import { useQuery } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, FileText, PlayCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

export default function NativeLMSMyLearning() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["native-lms-employee-dashboard"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/lms/native/employee");
      if (!res.success) throw new Error("Failed to fetch LMS dashboard");
      return res.data;
    },
  });

  const trainee = data?.trainee;
  const modules = data?.modules ?? [];
  const contents = data?.contents ?? [];
  const progress = data?.progress ?? [];
  const completionPct = Number(trainee?.course_completion_pct ?? 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-xs font-black uppercase tracking-[.22em] text-blue-300">Native LMS</p>
          <h1 className="mt-2 text-3xl font-black">My Learning</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Integrated employee LMS view synced with the MCN LMS database.</p>
        </div>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">{(error as Error).message}</div>}
        {isLoading && <div className="rounded-2xl border bg-white p-6 text-slate-500">Loading LMS content…</div>}
        {!isLoading && !error && !trainee && <div className="rounded-2xl border bg-white p-6 text-slate-600">No LMS learner mapping was found for your HRMS employee code.</div>}

        {trainee && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Learner</p><h2 className="mt-2 font-black text-slate-950">{trainee.trainee_name ?? trainee.employee_id}</h2><p className="text-xs text-slate-500">{trainee.employee_id}</p></div>
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Batch</p><h2 className="mt-2 font-black text-slate-950">{trainee.batch_no ?? "—"}</h2><p className="text-xs text-slate-500">{trainee.classroom_name ?? "No classroom"}</p></div>
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Completion</p><h2 className="mt-2 font-black text-slate-950">{completionPct.toFixed(0)}%</h2><div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, completionPct)}%` }} /></div></div>
              <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Certification</p><h2 className="mt-2 font-black text-slate-950">{trainee.certification_status ?? "Not Certified"}</h2><p className="text-xs text-slate-500">Risk: {trainee.risk_status ?? "—"}</p></div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-950"><BookOpen className="h-5 w-5" />Modules</h2>
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {modules.length === 0 ? <p className="text-sm text-slate-500">No modules assigned.</p> : modules.map((m: any) => <div key={m.id ?? m.module_id} className="rounded-2xl border bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-blue-600">Day {m.day_no ?? "—"}</p><h3 className="mt-1 font-bold text-slate-950">{m.module_title}</h3><p className="text-xs text-slate-500">{m.classroom_name ?? m.classroom_id}</p></div>)}
                </div>
              </div>

              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-950"><FileText className="h-5 w-5" />Learning Content</h2>
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {contents.length === 0 ? <p className="text-sm text-slate-500">No content published.</p> : contents.map((c: any) => {
                    const done = progress.some((p: any) => p.content_id === c.content_id || p.contentId === c.content_id);
                    return <div key={c.id ?? c.content_id} className="rounded-2xl border p-4 hover:bg-slate-50"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase text-slate-500">{c.content_type} • {c.module_title}</p><h3 className="mt-1 font-bold text-slate-950">{c.content_title}</h3><p className="mt-1 text-xs text-slate-500">Completion rule: {c.completion_rule_pct ?? 80}% • {c.estimated_mins ?? 0} mins</p></div>{done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <PlayCircle className="h-5 w-5 text-blue-600" />}</div><div className="mt-3 rounded-xl bg-slate-100 px-4 py-2 text-xs text-slate-600">Embedded content action pending controlled HRMS player route</div></div>;
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
