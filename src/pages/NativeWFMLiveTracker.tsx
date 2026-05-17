import { useEffect, useMemo, useState } from "react";
import { Coffee, Database, Fingerprint, LogIn, LogOut, Plus, RefreshCcw, Search, ShieldAlert, UserCheck, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const db = supabase as any;

type AnyRow = Record<string, any>;
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

const fmtTime = (value?: string) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
};

const minutesSince = (value?: string) => {
  if (!value) return 0;
  const d = new Date(value).getTime();
  if (Number.isNaN(d)) return 0;
  return Math.max(0, Math.floor((Date.now() - d) / 60000));
};

function Stat({ title, value, sub, icon, tone }: { title: string; value: string | number; sub?: string; icon: React.ReactNode; tone: string }) {
  return <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p>{sub && <p className="mt-1 text-xs font-semibold text-slate-500">{sub}</p>}</div><div className={`rounded-2xl p-3 ${tone}`}>{icon}</div></div></div>;
}

function StatusBadge({ status }: { status?: string }) {
  const s = status || "Rostered";
  const cls = s === "On Break" ? "bg-amber-50 text-amber-700" : s === "On Shift" ? "bg-emerald-50 text-emerald-700" : s === "Completed" ? "bg-slate-100 text-slate-700" : "bg-blue-50 text-blue-700";
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${cls}`}>{s}</span>;
}

function uniq(values: string[]) {
  return ["All", ...Array.from(new Set(values.filter(Boolean))).sort()];
}

export default function NativeWFMLiveTracker() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [employees, setEmployees] = useState<AnyRow[]>([]);
  const [shifts, setShifts] = useState<AnyRow[]>([]);
  const [roster, setRoster] = useState<AnyRow[]>([]);
  const [sessions, setSessions] = useState<AnyRow[]>([]);
  const [breaks, setBreaks] = useState<AnyRow[]>([]);
  const [scopeRows, setScopeRows] = useState<AnyRow[]>([]);
  const [devices, setDevices] = useState<AnyRow[]>([]);
  const [stagedPunches, setStagedPunches] = useState<AnyRow[]>([]);
  const [externalSources, setExternalSources] = useState<AnyRow[]>([]);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("All");
  const [processFilter, setProcessFilter] = useState("All");
  const [teamFilter, setTeamFilter] = useState("All");
  const [form, setForm] = useState({ employee_id: "", shift_id: "", branch_name: "", process_name: "", team_name: "" });
  const [deviceForm, setDeviceForm] = useState({ device_code: "", device_name: "", branch_name: "", api_base_url: "", api_key_secret_name: "" });
  const [sourceForm, setSourceForm] = useState({ source_code: "", source_name: "", db_type: "SQL_SERVER", host_name: "", database_name: "", connection_secret_name: "" });
  const [punchForm, setPunchForm] = useState({ employee_code: "", punch_type: "AUTO", punch_time: "", device_code: "" });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [e, s, r, a, b, scopes, d, punches, sources] = await Promise.all([
        db.from("employees").select("id,employee_code,first_name,last_name,email,phone,status").in("status", ["active", "onboarding"]).order("first_name"),
        db.from("wfm_shift_master").select("*").eq("active_status", true).is("deleted_at", null).order("start_time"),
        db.from("wfm_roster_assignment").select("*,employees(employee_code,first_name,last_name),wfm_shift_master(shift_code,shift_name,start_time,end_time,branch_name,process_name,team_name)").eq("roster_date", date).order("created_at", { ascending: false }),
        db.from("wfm_attendance_session").select("*").eq("session_date", date),
        db.from("wfm_break_log").select("*").gte("break_start", `${date}T00:00:00`).lte("break_start", `${date}T23:59:59`).order("break_start", { ascending: false }),
        user?.id ? db.from("wfm_user_access_scope").select("*").eq("user_id", user.id).eq("active_status", true) : Promise.resolve({ data: [], error: null }),
        db.from("wfm_facial_device_master").select("*").order("created_at", { ascending: false }).limit(50),
        db.from("wfm_external_punch_staging").select("*").order("created_at", { ascending: false }).limit(100),
        db.from("wfm_external_db_source").select("*").order("created_at", { ascending: false }).limit(50),
      ]);
      [e, s, r, a, b, scopes, d, punches, sources].forEach((x) => { if (x.error) throw x.error; });
      setEmployees(e.data || []); setShifts(s.data || []); setRoster(r.data || []); setSessions(a.data || []); setBreaks(b.data || []);
      setScopeRows(scopes.data || []); setDevices(d.data || []); setStagedPunches(punches.data || []); setExternalSources(sources.data || []);
    } catch (err: any) {
      setMessage(err.message || "Unable to load WFM live tracker. Run Phase 8C SQL if tables are missing.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [date, user?.id]);

  const sessionFor = (assignment: AnyRow) => sessions.find((s) => s.roster_assignment_id === assignment.id || s.employee_id === assignment.employee_id);
  const activeBreakFor = (session?: AnyRow) => session ? breaks.find((b) => b.session_id === session.id && !b.break_end) : null;

  const liveRows = useMemo(() => roster.map((r) => {
    const session = sessionFor(r);
    const br = activeBreakFor(session);
    const totalBreak = breaks.filter((b) => b.session_id === session?.id).reduce((a, b) => a + Number(b.duration_minutes || (b.break_end ? 0 : minutesSince(b.break_start))), 0);
    const status = session?.current_status || r.roster_status || "Rostered";
    return {
      ...r,
      session,
      activeBreak: br,
      totalBreak,
      liveStatus: status,
      branchValue: r.branch_name || r.wfm_shift_master?.branch_name || "Unmapped",
      processValue: r.process_name || r.wfm_shift_master?.process_name || "Unmapped",
      teamValue: r.team_name || r.wfm_shift_master?.team_name || "Unmapped",
    };
  }), [roster, sessions, breaks]);

  const scopedRows = useMemo(() => {
    if (!scopeRows.length) return liveRows;
    const hasAll = scopeRows.some((s) => s.scope_type === "all");
    if (hasAll) return liveRows;
    return liveRows.filter((r) => scopeRows.some((s) => {
      const val = String(s.scope_value || "").toLowerCase();
      if (s.scope_type === "branch") return String(r.branchValue || "").toLowerCase() === val;
      if (s.scope_type === "process") return String(r.processValue || "").toLowerCase() === val;
      if (s.scope_type === "team") return String(r.teamValue || "").toLowerCase() === val;
      if (s.scope_type === "employee") return String(r.employee_id || "") === String(s.employee_id || "");
      return false;
    }));
  }, [liveRows, scopeRows]);

  const branchOptions = useMemo(() => uniq(scopedRows.map((r) => r.branchValue)), [scopedRows]);
  const processOptions = useMemo(() => uniq(scopedRows.map((r) => r.processValue)), [scopedRows]);
  const teamOptions = useMemo(() => uniq(scopedRows.map((r) => r.teamValue)), [scopedRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedRows.filter((r) => {
      const text = [r.employees?.employee_code, r.employees?.first_name, r.employees?.last_name, r.wfm_shift_master?.shift_name, r.liveStatus, r.branchValue, r.processValue, r.teamValue].join(" ").toLowerCase();
      return (!q || text.includes(q)) &&
        (branchFilter === "All" || r.branchValue === branchFilter) &&
        (processFilter === "All" || r.processValue === processFilter) &&
        (teamFilter === "All" || r.teamValue === teamFilter);
    });
  }, [scopedRows, search, branchFilter, processFilter, teamFilter]);

  const assignRoster = async () => {
    if (!form.employee_id || !form.shift_id) return setMessage("Employee and shift are required.");
    const shift = shifts.find((s) => s.id === form.shift_id) || {};
    setLoading(true);
    const { error } = await db.from("wfm_roster_assignment").insert({
      employee_id: form.employee_id,
      shift_id: form.shift_id,
      roster_date: date,
      roster_status: "Rostered",
      branch_name: form.branch_name || shift.branch_name || null,
      process_name: form.process_name || shift.process_name || null,
      team_name: form.team_name || shift.team_name || null,
    });
    setLoading(false);
    if (error) return setMessage(error.message);
    setForm({ employee_id: "", shift_id: "", branch_name: "", process_name: "", team_name: "" }); setMessage("Employee added to roster."); await load();
  };

  const checkIn = async (assignment: AnyRow) => {
    const existing = sessionFor(assignment);
    if (existing?.login_time) return setMessage("Already checked in.");
    setLoading(true);
    const { error } = await db.from("wfm_attendance_session").insert({ roster_assignment_id: assignment.id, employee_id: assignment.employee_id, session_date: date, login_time: nowIso(), current_status: "On Shift", punch_source: "MANUAL", branch_name: assignment.branchValue, process_name: assignment.processValue, team_name: assignment.teamValue });
    setLoading(false);
    if (error) return setMessage(error.message);
    setMessage("Manual login captured."); await load();
  };

  const breakIn = async (assignment: AnyRow) => {
    const session = sessionFor(assignment);
    if (!session?.id) return setMessage("Login required before break.");
    if (session.logout_time) return setMessage("Shift already completed.");
    if (activeBreakFor(session)) return setMessage("Break is already active.");
    setLoading(true);
    const { error } = await db.from("wfm_break_log").insert({ session_id: session.id, employee_id: assignment.employee_id, break_start: nowIso(), break_type: "Break", punch_source: "MANUAL" });
    if (!error) await db.from("wfm_attendance_session").update({ current_status: "On Break", updated_at: nowIso() }).eq("id", session.id);
    setLoading(false);
    if (error) return setMessage(error.message);
    setMessage("Break started."); await load();
  };

  const breakOut = async (assignment: AnyRow) => {
    const session = sessionFor(assignment);
    const br = activeBreakFor(session);
    if (!br) return setMessage("No active break found.");
    const duration = minutesSince(br.break_start);
    setLoading(true);
    const { error } = await db.from("wfm_break_log").update({ break_end: nowIso(), duration_minutes: duration }).eq("id", br.id);
    if (!error) await db.from("wfm_attendance_session").update({ current_status: "On Shift", updated_at: nowIso() }).eq("id", session.id);
    setLoading(false);
    if (error) return setMessage(error.message);
    setMessage("Break ended."); await load();
  };

  const checkOut = async (assignment: AnyRow) => {
    const session = sessionFor(assignment);
    if (!session?.id) return setMessage("Login required before logout.");
    if (activeBreakFor(session)) return setMessage("End active break before logout.");
    if (session.logout_time) return setMessage("Already logged out.");
    const total = minutesSince(session.login_time);
    setLoading(true);
    const { error } = await db.from("wfm_attendance_session").update({ logout_time: nowIso(), total_login_minutes: total, current_status: "Completed", updated_at: nowIso() }).eq("id", session.id);
    setLoading(false);
    if (error) return setMessage(error.message);
    setMessage("Logout captured."); await load();
  };

  const saveDevice = async () => {
    if (!deviceForm.device_code || !deviceForm.device_name) return setMessage("Device code and device name are required.");
    const { error } = await db.from("wfm_facial_device_master").insert(deviceForm);
    if (error) return setMessage(error.message);
    setDeviceForm({ device_code: "", device_name: "", branch_name: "", api_base_url: "", api_key_secret_name: "" });
    setMessage("Facial device config saved. Secret key must be stored in Supabase/Edge secret using api_key_secret_name.");
    await load();
  };

  const saveExternalSource = async () => {
    if (!sourceForm.source_code || !sourceForm.source_name) return setMessage("Source code and source name are required.");
    const { error } = await db.from("wfm_external_db_source").insert(sourceForm);
    if (error) return setMessage(error.message);
    setSourceForm({ source_code: "", source_name: "", db_type: "SQL_SERVER", host_name: "", database_name: "", connection_secret_name: "" });
    setMessage("External DB source registered. Credentials must stay in secure secret storage, not table text.");
    await load();
  };

  const stagePunch = async () => {
    if (!punchForm.employee_code || !punchForm.punch_time) return setMessage("Employee code and punch time are required.");
    const payload = {
      source_system: "MANUAL_API_TEST",
      external_punch_id: `MANUAL-${Date.now()}`,
      employee_code: punchForm.employee_code,
      punch_type: punchForm.punch_type,
      punch_time: new Date(punchForm.punch_time).toISOString(),
      device_code: punchForm.device_code,
    };
    const { data, error } = await db.rpc("native_wfm_stage_external_punch", { p_payload: payload });
    if (error || !data?.ok) return setMessage(error?.message || data?.message || "Unable to stage punch");
    setMessage("Punch staged. Click Apply Pending Punches to sync into live attendance.");
    setPunchForm({ employee_code: "", punch_type: "AUTO", punch_time: "", device_code: "" });
    await load();
  };

  const applyPunches = async () => {
    const { data, error } = await db.rpc("native_wfm_apply_pending_punches", { p_limit: 500 });
    if (error || !data?.ok) return setMessage(error?.message || data?.message || "Unable to apply punches");
    setMessage(`Punch sync complete. Applied: ${data.applied}, Errors: ${data.errors}`);
    await load();
  };

  const onShift = filtered.filter((r) => r.liveStatus === "On Shift").length;
  const onBreak = filtered.filter((r) => r.liveStatus === "On Break").length;
  const completed = filtered.filter((r) => r.liveStatus === "Completed").length;
  const absent = filtered.filter((r) => !r.session?.login_time).length;
  const breakBreach = filtered.filter((r) => r.totalBreak > 60).length;
  const pendingPunch = stagedPunches.filter((p) => p.apply_status === "Pending").length;
  const errorPunch = stagedPunches.filter((p) => p.apply_status === "Error").length;

  return <DashboardLayout><div className="space-y-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Native WFM</p><h1 className="mt-2 text-3xl font-black text-slate-950">Live Shift & Break Tracker</h1><p className="mt-2 max-w-5xl text-slate-600">Branch/process/team scoped view with manual actions, facial punch sync staging, and external DB migration readiness.</p></div><button disabled={loading} onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"><RefreshCcw className="h-4 w-4"/>Refresh</button></div>{message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}<div className="grid gap-4 md:grid-cols-7"><Stat title="On Shift" value={onShift} sub="scoped view" icon={<UserCheck className="h-5 w-5"/>} tone="bg-emerald-50 text-emerald-700"/><Stat title="On Break" value={onBreak} sub="active breaks" icon={<Coffee className="h-5 w-5"/>} tone="bg-amber-50 text-amber-700"/><Stat title="Absent" value={absent} sub="rostered not in" icon={<Users className="h-5 w-5"/>} tone="bg-rose-50 text-rose-700"/><Stat title="Completed" value={completed} sub="shift ended" icon={<LogOut className="h-5 w-5"/>} tone="bg-slate-100 text-slate-700"/><Stat title="Break Breach" value={breakBreach} sub="> 60 min" icon={<ShieldAlert className="h-5 w-5"/>} tone="bg-violet-50 text-violet-700"/><Stat title="Pending Punch" value={pendingPunch} sub="device staging" icon={<Fingerprint className="h-5 w-5"/>} tone="bg-blue-50 text-blue-700"/><Stat title="Punch Errors" value={errorPunch} sub="needs mapping" icon={<Database className="h-5 w-5"/>} tone="bg-orange-50 text-orange-700"/></div><div className="rounded-3xl border bg-white p-4 shadow-sm"><div className="grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr_1fr_180px]"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search employee, shift, status, branch, process, team..." className="h-12 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400"/></label><select value={branchFilter} onChange={(e)=>setBranchFilter(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3"><option>All</option>{branchOptions.filter(x=>x!=="All").map(x=><option key={x}>{x}</option>)}</select><select value={processFilter} onChange={(e)=>setProcessFilter(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3"><option>All</option>{processOptions.filter(x=>x!=="All").map(x=><option key={x}>{x}</option>)}</select><select value={teamFilter} onChange={(e)=>setTeamFilter(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3"><option>All</option>{teamOptions.filter(x=>x!=="All").map(x=><option key={x}>{x}</option>)}</select><input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3"/></div><p className="mt-3 text-xs font-semibold text-slate-500">Scope mode: {scopeRows.length ? scopeRows.map(s=>`${s.role_label}:${s.scope_type}=${s.scope_value || 'all'}`).join(' | ') : 'No user-specific WFM scope configured, showing all permitted data.'}</p></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Daily Roster Setup</h2><div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]"><select value={form.employee_id} onChange={(e)=>setForm({...form,employee_id:e.target.value})} className="rounded-2xl border px-4 py-3"><option value="">Select employee</option>{employees.map((e)=><option key={e.id} value={e.id}>{e.employee_code} · {e.first_name} {e.last_name}</option>)}</select><select value={form.shift_id} onChange={(e)=>setForm({...form,shift_id:e.target.value})} className="rounded-2xl border px-4 py-3"><option value="">Select shift</option>{shifts.map((s)=><option key={s.id} value={s.id}>{s.shift_code} · {s.shift_name} ({s.start_time}-{s.end_time})</option>)}</select><input value={form.branch_name} onChange={(e)=>setForm({...form,branch_name:e.target.value})} placeholder="Branch" className="rounded-2xl border px-4 py-3"/><input value={form.process_name} onChange={(e)=>setForm({...form,process_name:e.target.value})} placeholder="Process" className="rounded-2xl border px-4 py-3"/><input value={form.team_name} onChange={(e)=>setForm({...form,team_name:e.target.value})} placeholder="Team" className="rounded-2xl border px-4 py-3"/><button onClick={assignRoster} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white"><Plus className="h-4 w-4"/>Add</button></div></div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Live Roster Register</h2><p className="text-sm text-slate-500">Manual actions remain available. Facial punches can sync into the same attendance rows.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-4">Employee</th><th className="p-4">Branch / Process / Team</th><th className="p-4">Shift</th><th className="p-4">Status</th><th className="p-4">Login</th><th className="p-4">Break</th><th className="p-4">Logout</th><th className="p-4">Source</th><th className="p-4">Total Break</th><th className="p-4">Actions</th></tr></thead><tbody>{filtered.map((r)=>{const session=r.session; const activeBreak=r.activeBreak; return <tr key={r.id} className="border-t"><td className="p-4"><div className="font-bold">{r.employees?.first_name} {r.employees?.last_name}</div><div className="text-xs text-slate-500">{r.employees?.employee_code}</div></td><td className="p-4"><div>{r.branchValue}</div><div className="text-xs text-slate-500">{r.processValue} · {r.teamValue}</div></td><td className="p-4"><div>{r.wfm_shift_master?.shift_name || '-'}</div><div className="text-xs text-slate-500">{r.wfm_shift_master?.start_time} - {r.wfm_shift_master?.end_time}</div></td><td className="p-4"><StatusBadge status={r.liveStatus}/></td><td className="p-4">{fmtTime(session?.login_time)}</td><td className="p-4">{activeBreak ? `Active ${minutesSince(activeBreak.break_start)}m` : '-'}</td><td className="p-4">{fmtTime(session?.logout_time)}</td><td className="p-4"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{session?.punch_source || 'Roster'}</span></td><td className="p-4"><span className={r.totalBreak>60?'font-black text-rose-600':'font-bold text-slate-700'}>{r.totalBreak} min</span></td><td className="p-4"><div className="flex flex-wrap gap-2"><button onClick={()=>checkIn(r)} disabled={!!session?.login_time} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"><LogIn className="inline h-3 w-3"/> In</button><button onClick={()=> activeBreak ? breakOut(r) : breakIn(r)} disabled={!session?.login_time || !!session?.logout_time} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"><Coffee className="inline h-3 w-3"/> {activeBreak?'Break Out':'Break In'}</button><button onClick={()=>checkOut(r)} disabled={!session?.login_time || !!session?.logout_time || !!activeBreak} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"><LogOut className="inline h-3 w-3"/> Out</button></div></td></tr>})}</tbody></table></div></div><div className="grid gap-5 xl:grid-cols-3"><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Facial Device Config</h2><div className="mt-4 grid gap-3"><input value={deviceForm.device_code} onChange={e=>setDeviceForm({...deviceForm,device_code:e.target.value})} placeholder="Device Code" className="rounded-2xl border px-4 py-3"/><input value={deviceForm.device_name} onChange={e=>setDeviceForm({...deviceForm,device_name:e.target.value})} placeholder="Device Name" className="rounded-2xl border px-4 py-3"/><input value={deviceForm.branch_name} onChange={e=>setDeviceForm({...deviceForm,branch_name:e.target.value})} placeholder="Branch" className="rounded-2xl border px-4 py-3"/><input value={deviceForm.api_base_url} onChange={e=>setDeviceForm({...deviceForm,api_base_url:e.target.value})} placeholder="API Base URL" className="rounded-2xl border px-4 py-3"/><input value={deviceForm.api_key_secret_name} onChange={e=>setDeviceForm({...deviceForm,api_key_secret_name:e.target.value})} placeholder="Secret name for API key" className="rounded-2xl border px-4 py-3"/><button onClick={saveDevice} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white">Save Device</button></div><div className="mt-4 space-y-2">{devices.slice(0,5).map(d=><div key={d.id} className="rounded-2xl border p-3"><b>{d.device_code}</b><p className="text-xs text-slate-500">{d.device_name} · {d.branch_name || '-'}</p></div>)}</div></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Facial Punch Staging Test</h2><div className="mt-4 grid gap-3"><input value={punchForm.employee_code} onChange={e=>setPunchForm({...punchForm,employee_code:e.target.value})} placeholder="Employee Code" className="rounded-2xl border px-4 py-3"/><select value={punchForm.punch_type} onChange={e=>setPunchForm({...punchForm,punch_type:e.target.value})} className="rounded-2xl border px-4 py-3"><option>AUTO</option><option>IN</option><option>OUT</option><option>BREAK_IN</option><option>BREAK_OUT</option></select><input type="datetime-local" value={punchForm.punch_time} onChange={e=>setPunchForm({...punchForm,punch_time:e.target.value})} className="rounded-2xl border px-4 py-3"/><input value={punchForm.device_code} onChange={e=>setPunchForm({...punchForm,device_code:e.target.value})} placeholder="Device Code" className="rounded-2xl border px-4 py-3"/><div className="flex gap-2"><button onClick={stagePunch} className="rounded-2xl bg-blue-700 px-5 py-3 font-bold text-white">Stage Punch</button><button onClick={applyPunches} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white">Apply Pending</button></div></div><div className="mt-4 max-h-64 overflow-auto space-y-2">{stagedPunches.slice(0,8).map(p=><div key={p.id} className="rounded-2xl border p-3"><b>{p.employee_code}</b><p className="text-xs text-slate-500">{p.punch_type} · {p.apply_status} · {p.apply_error || ''}</p></div>)}</div></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">External DB Migration Source</h2><div className="mt-4 grid gap-3"><input value={sourceForm.source_code} onChange={e=>setSourceForm({...sourceForm,source_code:e.target.value})} placeholder="Source Code" className="rounded-2xl border px-4 py-3"/><input value={sourceForm.source_name} onChange={e=>setSourceForm({...sourceForm,source_name:e.target.value})} placeholder="Source Name" className="rounded-2xl border px-4 py-3"/><select value={sourceForm.db_type} onChange={e=>setSourceForm({...sourceForm,db_type:e.target.value})} className="rounded-2xl border px-4 py-3"><option>SQL_SERVER</option><option>MYSQL</option><option>POSTGRES</option><option>CSV_EXPORT</option></select><input value={sourceForm.host_name} onChange={e=>setSourceForm({...sourceForm,host_name:e.target.value})} placeholder="Host / server name" className="rounded-2xl border px-4 py-3"/><input value={sourceForm.database_name} onChange={e=>setSourceForm({...sourceForm,database_name:e.target.value})} placeholder="Database name" className="rounded-2xl border px-4 py-3"/><input value={sourceForm.connection_secret_name} onChange={e=>setSourceForm({...sourceForm,connection_secret_name:e.target.value})} placeholder="Connection secret name" className="rounded-2xl border px-4 py-3"/><button onClick={saveExternalSource} className="rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white">Register Source</button></div><div className="mt-4 space-y-2">{externalSources.slice(0,5).map(s=><div key={s.id} className="rounded-2xl border p-3"><b>{s.source_code}</b><p className="text-xs text-slate-500">{s.db_type} · {s.host_name || '-'} · Secret: {s.connection_secret_name || '-'}</p></div>)}</div></div></div></div></DashboardLayout>;
}
