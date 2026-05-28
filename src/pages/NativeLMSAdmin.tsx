import { useEffect, useMemo, useState } from "react";
import { BookOpen, ClipboardList, FileQuestion, Layers, Plus, RefreshCcw, Send, ShieldCheck } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";


type AnyRow = Record<string, any>;

const emptyContent = {
  content_title: "",
  content_type: "Video",
  content_url: "",
  required_completion_percent: 100,
};

function Stat({ title, value, icon }: { title: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

export default function NativeLMSAdmin() {
  const [tab, setTab] = useState("curriculum");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [classrooms, setClassrooms] = useState<AnyRow[]>([]);
  const [modules, setModules] = useState<AnyRow[]>([]);
  const [contents, setContents] = useState<AnyRow[]>([]);
  const [assignments, setAssignments] = useState<AnyRow[]>([]);
  const [rules, setRules] = useState<AnyRow[]>([]);
  const [classroomName, setClassroomName] = useState("");
  const [moduleForm, setModuleForm] = useState({ classroom_id: "", module_name: "", day_no: 1 });
  const [contentForm, setContentForm] = useState({ ...emptyContent, module_id: "" });
  const [assignForm, setAssignForm] = useState({ assignment_scope: "all", scope_value: "", module_id: "" });
  const [ruleForm, setRuleForm] = useState({ process_name: "", certification_mode: "Internal", min_score: 80, active_status: true });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [c1, c2, c3, c4, c5] = await Promise.all([
        db.from("lms_classroom_master").select("*").order("created_at", { ascending: false }),
        db.from("lms_module_master").select("*,lms_classroom_master(classroom_name)").order("day_no", { ascending: true }),
        db.from("lms_content_master").select("*,lms_module_master(module_name,day_no)").order("display_order", { ascending: true }),
        db.from("lms_module_assignment").select("*,lms_module_master(module_name)").order("created_at", { ascending: false }).limit(100),
        db.from("lms_certification_rule_master").select("*").order("created_at", { ascending: false }).limit(100),
      ]);
      [c1, c2, c3, c4, c5].forEach((r) => { if (r.error) throw r.error; });
      setClassrooms(c1.data || []);
      setModules(c2.data || []);
      setContents(c3.data || []);
      setAssignments(c4.data || []);
      setRules(c5.data || []);
    } catch (err: any) {
      setMessage(err.message || "Unable to load LMS Admin data. Run LMS foundation SQL if tables are missing.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const createClassroom = async () => {
    if (!classroomName.trim()) return setMessage("Classroom name required.");
    setLoading(true);
    const code = `CLS-${Date.now()}`;
    const { error } = await db.from("lms_classroom_master").insert({ classroom_code: code, classroom_name: classroomName.trim(), active_status: true });
    setLoading(false);
    if (error) return setMessage(error.message);
    setClassroomName("");
    setMessage(`Classroom created: ${code}`);
    await load();
  };

  const createModule = async () => {
    if (!moduleForm.classroom_id || !moduleForm.module_name.trim()) return setMessage("Classroom and module name required.");
    setLoading(true);
    const { error } = await db.from("lms_module_master").insert({ classroom_id: moduleForm.classroom_id, module_name: moduleForm.module_name.trim(), day_no: Number(moduleForm.day_no || 1), active_status: true });
    setLoading(false);
    if (error) return setMessage(error.message);
    setModuleForm({ classroom_id: "", module_name: "", day_no: 1 });
    setMessage("Module created.");
    await load();
  };

  const createContent = async () => {
    if (!contentForm.module_id || !contentForm.content_title.trim()) return setMessage("Module and content title required.");
    setLoading(true);
    const { error } = await db.from("lms_content_master").insert({ ...contentForm, active_status: true, display_order: contents.length + 1 });
    setLoading(false);
    if (error) return setMessage(error.message);
    setContentForm({ ...emptyContent, module_id: "" });
    setMessage("Content created.");
    await load();
  };

  const createAssignment = async () => {
    if (!assignForm.module_id) return setMessage("Module required for assignment.");
    setLoading(true);
    const { error } = await db.from("lms_module_assignment").insert({ ...assignForm, active_status: true, notification_status: "Pending" });
    setLoading(false);
    if (error) return setMessage(error.message);
    setAssignForm({ assignment_scope: "all", scope_value: "", module_id: "" });
    setMessage("Module assignment created.");
    await load();
  };

  const createRule = async () => {
    if (!ruleForm.process_name.trim()) return setMessage("Process name required for certification rule.");
    setLoading(true);
    const { error } = await db.from("lms_certification_rule_master").insert(ruleForm);
    setLoading(false);
    if (error) return setMessage(error.message);
    setRuleForm({ process_name: "", certification_mode: "Internal", min_score: 80, active_status: true });
    setMessage("Certification rule created.");
    await load();
  };

  const moduleOptions = useMemo(() => modules.map((m) => ({ id: m.id, name: `${m.module_name} · Day ${m.day_no || 1}` })), [modules]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Native LMS</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">LMS Admin Control Center</h1>
            <p className="mt-2 max-w-4xl text-slate-600">Create classrooms, modules, content, assignments and certification rules from inside HRMS.</p>
          </div>
          <button disabled={loading} onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"><RefreshCcw className="h-4 w-4" /> Refresh</button>
        </div>

        {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

        <div className="grid gap-4 md:grid-cols-5">
          <Stat title="Classrooms" value={classrooms.length} icon={<BookOpen className="h-5 w-5" />} />
          <Stat title="Modules" value={modules.length} icon={<Layers className="h-5 w-5" />} />
          <Stat title="Content" value={contents.length} icon={<ClipboardList className="h-5 w-5" />} />
          <Stat title="Assignments" value={assignments.length} icon={<Send className="h-5 w-5" />} />
          <Stat title="Rules" value={rules.length} icon={<ShieldCheck className="h-5 w-5" />} />
        </div>

        <div className="flex flex-wrap gap-2 rounded-3xl border bg-white p-3 shadow-sm">
          {[['curriculum','Curriculum Builder'],['content','Content Repository'],['assignment','Direct Assignment'],['rules','Certification Rules'],['question','Question Bank']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-2xl px-4 py-2 text-sm font-black ${tab === k ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700'}`}>{l}</button>
          ))}
        </div>

        {tab === "curriculum" && <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Create Classroom</h2><div className="mt-4 flex gap-3"><input value={classroomName} onChange={(e) => setClassroomName(e.target.value)} placeholder="Classroom name" className="flex-1 rounded-2xl border px-4 py-3" /><button onClick={createClassroom} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white"><Plus className="h-4 w-4" /></button></div><div className="mt-5 max-h-80 space-y-2 overflow-auto">{classrooms.map((c) => <div key={c.id} className="rounded-2xl border p-3"><b>{c.classroom_name}</b><p className="text-xs text-slate-500">{c.classroom_code}</p></div>)}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Create Module</h2><div className="mt-4 grid gap-3"><select value={moduleForm.classroom_id} onChange={(e) => setModuleForm({ ...moduleForm, classroom_id: e.target.value })} className="rounded-2xl border px-4 py-3"><option value="">Select classroom</option>{classrooms.map((c) => <option key={c.id} value={c.id}>{c.classroom_name}</option>)}</select><input value={moduleForm.module_name} onChange={(e) => setModuleForm({ ...moduleForm, module_name: e.target.value })} placeholder="Module name" className="rounded-2xl border px-4 py-3" /><input type="number" value={moduleForm.day_no} onChange={(e) => setModuleForm({ ...moduleForm, day_no: Number(e.target.value) })} placeholder="Day no" className="rounded-2xl border px-4 py-3" /><button onClick={createModule} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white">Create Module</button></div><div className="mt-5 max-h-80 space-y-2 overflow-auto">{modules.map((m) => <div key={m.id} className="rounded-2xl border p-3"><b>{m.module_name}</b><p className="text-xs text-slate-500">Day {m.day_no} · {m.lms_classroom_master?.classroom_name || 'Classroom'}</p></div>)}</div></div>
        </div>}

        {tab === "content" && <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Content Repository</h2><div className="mt-4 grid gap-3 lg:grid-cols-5"><select value={contentForm.module_id} onChange={(e) => setContentForm({ ...contentForm, module_id: e.target.value })} className="rounded-2xl border px-4 py-3"><option value="">Select module</option>{moduleOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><input value={contentForm.content_title} onChange={(e) => setContentForm({ ...contentForm, content_title: e.target.value })} placeholder="Content title" className="rounded-2xl border px-4 py-3" /><select value={contentForm.content_type} onChange={(e) => setContentForm({ ...contentForm, content_type: e.target.value })} className="rounded-2xl border px-4 py-3"><option>Video</option><option>PDF</option><option>Link</option><option>Quiz</option></select><input value={contentForm.content_url} onChange={(e) => setContentForm({ ...contentForm, content_url: e.target.value })} placeholder="Drive / content URL" className="rounded-2xl border px-4 py-3" /><button onClick={createContent} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white">Add</button></div><div className="mt-5 overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Content</th><th className="p-3">Type</th><th className="p-3">Module</th><th className="p-3">Required %</th><th className="p-3">URL</th></tr></thead><tbody>{contents.map((c) => <tr key={c.id} className="border-t"><td className="p-3 font-bold">{c.content_title}</td><td className="p-3">{c.content_type}</td><td className="p-3">{c.lms_module_master?.module_name}</td><td className="p-3">{c.required_completion_percent || 100}</td><td className="p-3 truncate">{c.content_url || '-'}</td></tr>)}</tbody></table></div></div>}

        {tab === "assignment" && <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Direct Module Assignment</h2><div className="mt-4 grid gap-3 lg:grid-cols-4"><select value={assignForm.module_id} onChange={(e) => setAssignForm({ ...assignForm, module_id: e.target.value })} className="rounded-2xl border px-4 py-3"><option value="">Select module</option>{moduleOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><select value={assignForm.assignment_scope} onChange={(e) => setAssignForm({ ...assignForm, assignment_scope: e.target.value })} className="rounded-2xl border px-4 py-3"><option value="all">All Users</option><option value="branch">Branch</option><option value="process">Process</option><option value="batch">Batch</option><option value="employee">Employee</option></select><input value={assignForm.scope_value} onChange={(e) => setAssignForm({ ...assignForm, scope_value: e.target.value })} placeholder="Scope value, blank for all" className="rounded-2xl border px-4 py-3" /><button onClick={createAssignment} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white">Assign</button></div><div className="mt-5 space-y-2">{assignments.map((a) => <div key={a.id} className="rounded-2xl border p-3"><b>{a.lms_module_master?.module_name || 'Module'}</b><p className="text-xs text-slate-500">{a.assignment_scope}: {a.scope_value || 'All'} · {a.notification_status}</p></div>)}</div></div>}

        {tab === "rules" && <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Certification Rules</h2><div className="mt-4 grid gap-3 lg:grid-cols-4"><input value={ruleForm.process_name} onChange={(e) => setRuleForm({ ...ruleForm, process_name: e.target.value })} placeholder="Process name" className="rounded-2xl border px-4 py-3" /><select value={ruleForm.certification_mode} onChange={(e) => setRuleForm({ ...ruleForm, certification_mode: e.target.value })} className="rounded-2xl border px-4 py-3"><option>Internal</option><option>External</option><option>Internal + External</option></select><input type="number" value={ruleForm.min_score} onChange={(e) => setRuleForm({ ...ruleForm, min_score: Number(e.target.value) })} placeholder="Min score" className="rounded-2xl border px-4 py-3" /><button onClick={createRule} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white">Save Rule</button></div><div className="mt-5 space-y-2">{rules.map((r) => <div key={r.id} className="rounded-2xl border p-3"><b>{r.process_name}</b><p className="text-xs text-slate-500">{r.certification_mode} · Min {r.min_score}%</p></div>)}</div></div>}

        {tab === "question" && <div className="rounded-3xl border bg-white p-8 text-center shadow-sm"><FileQuestion className="mx-auto h-10 w-10 text-slate-400" /><h2 className="mt-3 font-black text-slate-950">Question Bank</h2><p className="mt-2 text-slate-600">Question bank upload/import will use the same bulk upload pattern after LMS core tables pass.</p></div>}
      </div>
    </DashboardLayout>
  );
}
