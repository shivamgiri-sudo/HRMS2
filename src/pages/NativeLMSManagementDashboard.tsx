import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, CheckCircle2, Clock, RefreshCcw, ShieldCheck, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";


type AnyRow = Record<string, any>;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function Stat({ title, value, sub, icon }: { title: string; value: string | number; sub?: string; icon: React.ReactNode }) {
  return <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p>{sub && <p className="mt-1 text-xs font-semibold text-slate-500">{sub}</p>}</div><div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div></div></div>;
}

function BarList({ rows, label, value }: { rows: AnyRow[]; label: string; value: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value]) || 0));
  return <div className="space-y-3">{rows.length ? rows.slice(0, 10).map((r, i) => <div key={i}><div className="mb-1 flex justify-between text-sm"><b>{r[label] || "-"}</b><b>{r[value]}</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-slate-950" style={{ width: `${Math.max(6, ((Number(r[value]) || 0) / max) * 100)}%` }} /></div></div>) : <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">No data yet.</div>}</div>;
}

export default function NativeLMSManagementDashboard() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [classrooms, setClassrooms] = useState<AnyRow[]>([]);
  const [modules, setModules] = useState<AnyRow[]>([]);
  const [contents, setContents] = useState<AnyRow[]>([]);
  const [progress, setProgress] = useState<AnyRow[]>([]);
  const [assignments, setAssignments] = useState<AnyRow[]>([]);
  const [rules, setRules] = useState<AnyRow[]>([]);
  const [attempts, setAttempts] = useState<AnyRow[]>([]);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [c1,c2,c3,c4,c5,c6,c7] = await Promise.all([
        db.from("lms_classroom_master").select("*"),
        db.from("lms_module_master").select("*,lms_classroom_master(classroom_name)"),
        db.from("lms_content_master").select("*,lms_module_master(module_name,day_no,classroom_id)"),
        db.from("lms_content_progress").select("*,employees(employee_code,first_name,last_name,department_id)"),
        db.from("lms_module_assignment").select("*,lms_module_master(module_name)"),
        db.from("lms_certification_rule_master").select("*"),
        db.from("lms_assessment_attempt").select("*,lms_module_master(module_name),employees(employee_code,first_name,last_name)")
      ]);
      [c1,c2,c3,c4,c5,c6,c7].forEach((r) => { if (r.error) throw r.error; });
      setClassrooms(c1.data || []); setModules(c2.data || []); setContents(c3.data || []); setProgress(c4.data || []); setAssignments(c5.data || []); setRules(c6.data || []); setAttempts(c7.data || []);
    } catch (err: any) {
      setMessage(err.message || "Unable to load LMS dashboard. Run Phase 8A SQL if tables are missing.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const metrics = useMemo(() => {
    const totalProgress = progress.length;
    const completed = progress.filter((p) => p.completed || Number(p.progress_percent || 0) >= 100).length;
    const avgProgress = totalProgress ? Math.round(progress.reduce((a, p) => a + Number(p.progress_percent || 0), 0) / totalProgress) : 0;
    const passed = attempts.filter((a) => a.passed).length;
    return { totalProgress, completed, avgProgress, passed, passRate: pct(passed, attempts.length) };
  }, [progress, attempts]);

  const modulePerformance = useMemo(() => {
    const map = new Map<string, AnyRow>();
    contents.forEach((c) => {
      const moduleName = c.lms_module_master?.module_name || "Unmapped";
      const row = map.get(moduleName) || { name: moduleName, content: 0, completed: 0, progressRows: 0 };
      row.content += 1;
      progress.filter((p) => p.content_id === c.id).forEach((p) => { row.progressRows += 1; if (p.completed || Number(p.progress_percent || 0) >= 100) row.completed += 1; });
      map.set(moduleName, row);
    });
    return Array.from(map.values()).sort((a,b)=>b.progressRows-a.progressRows);
  }, [contents, progress]);

  const assignmentRows = useMemo(() => assignments.reduce((arr: AnyRow[], a) => { arr.push({ name: `${a.assignment_scope}: ${a.scope_value || 'All'}`, count: 1 }); return arr; }, []), [assignments]);

  return <DashboardLayout><div className="space-y-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Native LMS</p><h1 className="mt-2 text-3xl font-black text-slate-950">LMS Management Dashboard</h1><p className="mt-2 max-w-4xl text-slate-600">Management view for classrooms, content coverage, assignments, learner completion and assessment pass rate.</p></div><button disabled={loading} onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"><RefreshCcw className="h-4 w-4"/>Refresh</button></div>{message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}<div className="grid gap-4 md:grid-cols-4 xl:grid-cols-7"><Stat title="Classrooms" value={classrooms.length} icon={<BookOpen className="h-5 w-5"/>}/><Stat title="Modules" value={modules.length} icon={<BarChart3 className="h-5 w-5"/>}/><Stat title="Contents" value={contents.length} icon={<BookOpen className="h-5 w-5"/>}/><Stat title="Assignments" value={assignments.length} icon={<Users className="h-5 w-5"/>}/><Stat title="Completion" value={`${metrics.completed}/${metrics.totalProgress}`} sub={`${metrics.avgProgress}% avg`} icon={<CheckCircle2 className="h-5 w-5"/>}/><Stat title="Assessment Pass" value={`${metrics.passRate}%`} sub={`${metrics.passed}/${attempts.length}`} icon={<ShieldCheck className="h-5 w-5"/>}/><Stat title="Rules" value={rules.length} icon={<Clock className="h-5 w-5"/>}/></div><div className="grid gap-5 xl:grid-cols-3"><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black text-slate-950">Module Completion Coverage</h2><BarList rows={modulePerformance.map((r)=>({...r, count:r.completed}))} label="name" value="count"/></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black text-slate-950">Assignment Distribution</h2><BarList rows={assignmentRows} label="name" value="count"/></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black text-slate-950">Certification Rules</h2><div className="space-y-2">{rules.length ? rules.map((r)=><div key={r.id} className="rounded-2xl border p-3"><b>{r.process_name}</b><p className="text-xs text-slate-500">{r.certification_mode} · Min {r.min_score}%</p></div>) : <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">No certification rules configured.</div>}</div></div></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Learner Progress Register</h2><div className="mt-4 overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Employee</th><th className="p-3">Content</th><th className="p-3">Progress</th><th className="p-3">Completed</th><th className="p-3">Watch Sec</th><th className="p-3">Last Access</th></tr></thead><tbody>{progress.map((p)=><tr key={p.id} className="border-t"><td className="p-3">{p.employees?.employee_code || '-'}</td><td className="p-3">{p.content_id}</td><td className="p-3">{p.progress_percent}%</td><td className="p-3">{p.completed ? 'Yes':'No'}</td><td className="p-3">{p.watch_seconds}</td><td className="p-3">{p.last_accessed_at}</td></tr>)}</tbody></table></div></div></div></DashboardLayout>;
}
