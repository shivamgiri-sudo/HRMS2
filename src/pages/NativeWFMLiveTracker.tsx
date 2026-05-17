import { useEffect, useMemo, useState } from "react";
import { Coffee, LogIn, LogOut, Plus, RefreshCcw, Search, ShieldAlert, Timer, UserCheck, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

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

export default function NativeWFMLiveTracker() {
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [employees, setEmployees] = useState<AnyRow[]>([]);
  const [shifts, setShifts] = useState<AnyRow[]>([]);
  const [roster, setRoster] = useState<AnyRow[]>([]);
  const [sessions, setSessions] = useState<AnyRow[]>([]);
  const [breaks, setBreaks] = useState<AnyRow[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ employee_id: "", shift_id: "" });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [e, s, r, a, b] = await Promise.all([
        db.from("employees").select("id,employee_code,first_name,last_name,email,phone,status").in("status", ["active", "onboarding"]).order("first_name"),
        db.from("wfm_shift_master").select("*").order("start_time"),
        db.from("wfm_roster_assignment").select("*,employees(employee_code,first_name,last_name),wfm_shift_master(shift_code,shift_name,start_time,end_time)").eq("roster_date", date).order("created_at", { ascending: false }),
        db.from("wfm_attendance_session").select("*").eq("session_date", date),
        db.from("wfm_break_log").select("*").gte("break_start", `${date}T00:00:00`).lte("break_start", `${date}T23:59:59`).order("break_start", { ascending: false }),
      ]);
      [e, s, r, a, b].forEach((x) => { if (x.error) throw x.error; });
      setEmployees(e.data || []); setShifts(s.data || []); setRoster(r.data || []); setSessions(a.data || []); setBreaks(b.data || []);
    } catch (err: any) {
      setMessage(err.message || "Unable to load WFM live tracker. Run Phase 8B SQL if tables are missing.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [date]);

  const assignRoster = async () => {
    if (!form.employee_id || !form.shift_id) return setMessage("Employee and shift are required.");
    setLoading(true);
    const { error } = await db.from("wfm_roster_assignment").insert({ employee_id: form.employee_id, shift_id: form.shift_id, roster_date: date, roster_status: "Rostered" });
    setLoading(false);
    if (error) return setMessage(error.message);
    setForm({ employee_id: "", shift_id: "" }); setMessage("Employee added to roster."); await load();
  };

  const sessionFor = (assignment: AnyRow) => sessions.find((s) => s.roster_assignment_id === assignment.id || s.employee_id === assignment.employee_id);
  const activeBreakFor = (session?: AnyRow) => session ? breaks.find((b) => b.session_id === session.id && !b.break_end) : null;

  const checkIn = async (assignment: AnyRow) => {
    const existing = sessionFor(assignment);
    if (existing?.login_time) return setMessage("Already checked in.");
    setLoading(true);
    const { error } = await db.from("wfm_attendance_session").insert({ roster_assignment_id: assignment.id, employee_id: assignment.employee_id, session_date: date, login_time: nowIso(), current_status: "On Shift" });
    setLoading(false);
    if (error) return setMessage(error.message);
    setMessage("Login captured."); await load();
  };

  const breakIn = async (assignment: AnyRow) => {
    const session = sessionFor(assignment);
    if (!session?.id) return setMessage("Login required before break.");
    if (session.logout_time) return setMessage("Shift already completed.");
    if (activeBreakFor(session)) return setMessage("Break is already active.");
    setLoading(true);
    const { error } = await db.from("wfm_break_log").insert({ session_id: session.id, employee_id: assignment.employee_id, break_start: nowIso(), break_type: "Break" });
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

  const liveRows = useMemo(() => roster.map((r) => {
    const session = sessionFor(r);
    const br = activeBreakFor(session);
    const totalBreak = breaks.filter((b) => b.session_id === session?.id).reduce((a, b) => a + Number(b.duration_minutes || (b.break_end ? 0 : minutesSince(b.break_start))), 0);
    const status = session?.current_status || r.roster_status || "Rostered";
    return { ...r, session, activeBreak: br, totalBreak, liveStatus: status };
  }), [roster, sessions, breaks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return liveRows.filter((r) => !q || [r.employees?.employee_code, r.employees?.first_name, r.employees?.last_name, r.wfm_shift_master?.shift_name, r.liveStatus].join(" ").toLowerCase().includes(q));
  }, [liveRows, search]);

  const onShift = liveRows.filter((r) => r.liveStatus === "On Shift").length;
  const onBreak = liveRows.filter((r) => r.liveStatus === "On Break").length;
  const completed = liveRows.filter((r) => r.liveStatus === "Completed").length;
  const absent = liveRows.filter((r) => !r.session?.login_time).length;
  const breakBreach = liveRows.filter((r) => r.totalBreak > 60).length;

  return <DashboardLayout><div className="space-y-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Native WFM</p><h1 className="mt-2 text-3xl font-black text-slate-950">Live Shift & Break Tracker</h1><p className="mt-2 max-w-4xl text-slate-600">Guard-friendly live tracker for rostered employees, login/logout, break in/out, absent status and break-duration exceptions.</p></div><button disabled={loading} onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"><RefreshCcw className="h-4 w-4"/>Refresh</button></div>{message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}<div className="grid gap-4 md:grid-cols-5"><Stat title="On Shift" value={onShift} sub="currently working" icon={<UserCheck className="h-5 w-5"/>} tone="bg-emerald-50 text-emerald-700"/><Stat title="On Break" value={onBreak} sub="active breaks" icon={<Coffee className="h-5 w-5"/>} tone="bg-amber-50 text-amber-700"/><Stat title="Absent" value={absent} sub="rostered not logged in" icon={<Users className="h-5 w-5"/>} tone="bg-rose-50 text-rose-700"/><Stat title="Completed" value={completed} sub="shift ended" icon={<LogOut className="h-5 w-5"/>} tone="bg-slate-100 text-slate-700"/><Stat title="Break Breach" value={breakBreach} sub="> 60 min break" icon={<ShieldAlert className="h-5 w-5"/>} tone="bg-violet-50 text-violet-700"/></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-black text-slate-950">Daily Roster Setup</h2><div className="mt-4 grid gap-3 lg:grid-cols-[180px_1fr_1fr_auto]"><input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="rounded-2xl border px-4 py-3"/><select value={form.employee_id} onChange={(e)=>setForm({...form,employee_id:e.target.value})} className="rounded-2xl border px-4 py-3"><option value="">Select employee</option>{employees.map((e)=><option key={e.id} value={e.id}>{e.employee_code} · {e.first_name} {e.last_name}</option>)}</select><select value={form.shift_id} onChange={(e)=>setForm({...form,shift_id:e.target.value})} className="rounded-2xl border px-4 py-3"><option value="">Select shift</option>{shifts.map((s)=><option key={s.id} value={s.id}>{s.shift_code} · {s.shift_name} ({s.start_time}-{s.end_time})</option>)}</select><button onClick={assignRoster} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white"><Plus className="h-4 w-4"/>Add</button></div></div><div className="rounded-3xl border bg-white p-4 shadow-sm"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search employee, shift, status..." className="h-12 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400"/></label></div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Live Roster Register</h2><p className="text-sm text-slate-500">Each row has live action buttons. Break must be ended before logout.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-4">Employee</th><th className="p-4">Shift</th><th className="p-4">Status</th><th className="p-4">Login</th><th className="p-4">Break</th><th className="p-4">Logout</th><th className="p-4">Total Break</th><th className="p-4">Actions</th></tr></thead><tbody>{filtered.map((r)=>{const session=r.session; const activeBreak=r.activeBreak; return <tr key={r.id} className="border-t"><td className="p-4"><div className="font-bold">{r.employees?.first_name} {r.employees?.last_name}</div><div className="text-xs text-slate-500">{r.employees?.employee_code}</div></td><td className="p-4"><div>{r.wfm_shift_master?.shift_name || '-'}</div><div className="text-xs text-slate-500">{r.wfm_shift_master?.start_time} - {r.wfm_shift_master?.end_time}</div></td><td className="p-4"><StatusBadge status={r.liveStatus}/></td><td className="p-4">{fmtTime(session?.login_time)}</td><td className="p-4">{activeBreak ? `Active ${minutesSince(activeBreak.break_start)}m` : '-'}</td><td className="p-4">{fmtTime(session?.logout_time)}</td><td className="p-4"><span className={r.totalBreak>60?'font-black text-rose-600':'font-bold text-slate-700'}>{r.totalBreak} min</span></td><td className="p-4"><div className="flex flex-wrap gap-2"><button onClick={()=>checkIn(r)} disabled={!!session?.login_time} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"><LogIn className="inline h-3 w-3"/> In</button><button onClick={()=> activeBreak ? breakOut(r) : breakIn(r)} disabled={!session?.login_time || !!session?.logout_time} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"><Coffee className="inline h-3 w-3"/> {activeBreak?'Break Out':'Break In'}</button><button onClick={()=>checkOut(r)} disabled={!session?.login_time || !!session?.logout_time || !!activeBreak} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"><LogOut className="inline h-3 w-3"/> Out</button></div></td></tr>})}</tbody></table></div></div></div></DashboardLayout>;
}
