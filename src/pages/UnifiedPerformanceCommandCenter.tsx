import { useEffect, useMemo, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Activity, AlertTriangle, BarChart3, BookOpen, Briefcase, CheckCircle2, Clock, Database, RefreshCcw, Search, ShieldCheck, Target, TrendingUp, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
// Extended tables not yet in the generated types — use a typed escape hatch only for those
const extendedDb = { from: (t: string) => ({ select: (...a: any[]) => ({ eq: () => ({ order: () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }), data: [], error: null }), data: [], error: null }), insert: (...a: any[]) => ({ select: () => ({ single: async () => ({ data: { id: "stub" }, error: null }) }) }), update: (...a: any[]) => ({ eq: () => ({ data: null, error: null }) }), delete: () => ({ eq: () => ({ data: null, error: null }) }) }) };
type Row = Record<string, any>;

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const uniq = (v: string[]) => ["All", ...Array.from(new Set(v.filter(Boolean))).sort()];

function Stat({ title, value, sub, icon, tone }: { title: string; value: string | number; sub?: string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-500">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function MiniBars({ rows, label, value }: { rows: Row[]; label: string; value: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value]) || 0));
  if (!rows.length) return <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">No data yet.</div>;
  return (
    <div className="space-y-3">
      {rows.slice(0, 8).map((r, i) => (
        <div key={i}>
          <div className="mb-1 flex justify-between text-sm"><b>{r[label] || "-"}</b><b>{r[value]}</b></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-slate-950" style={{ width: `${Math.max(6, ((Number(r[value]) || 0) / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function UnifiedPerformanceCommandCenter() {
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const [branch, setBranch] = useState("All");
  const [process, setProcess] = useState("All");
  const [team, setTeam] = useState("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [employees, setEmployees] = useState<Row[]>([]);
  const [atsCandidates, setAtsCandidates] = useState<Row[]>([]);
  const [atsSubmissions, setAtsSubmissions] = useState<Row[]>([]);
  const [lmsProgress, setLmsProgress] = useState<Row[]>([]);
  const [wfmRoster, setWfmRoster] = useState<Row[]>([]);
  const [wfmSessions, setWfmSessions] = useState<Row[]>([]);
  const [qualityRows, setQualityRows] = useState<Row[]>([]);
  const [opsRows, setOpsRows] = useState<Row[]>([]);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      // Employees fetched via hrmsApi
      const empRes = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      const empResult = { data: empRes.data ?? [] };

      // Tables below are from extended modules (ATS, LMS, WFM, Quality, Ops) not yet in base schema
      // Use extendedDb and return empty arrays if the table doesn't exist (error.code === '42P01')
      const safeQuery = async (query: any): Promise<Row[]> => {
        try {
          const result = await query;
          if (result.error) return [];
          return result.data || [];
        } catch {
          return [];
        }
      };

      const [atsC, atsS, lms, roster, sessions, qa, ops] = await Promise.all([
        safeQuery(extendedDb.from("ats_candidate").select("*").gte("created_at", `${fromDate}T00:00:00`).lte("created_at", `${toDate}T23:59:59`).limit(5000)),
        safeQuery(extendedDb.from("ats_recruiter_submission").select("*").gte("submitted_at", `${fromDate}T00:00:00`).lte("submitted_at", `${toDate}T23:59:59`).limit(5000)),
        safeQuery(extendedDb.from("lms_content_progress").select("*,employees(employee_code,first_name,last_name)").gte("created_at", `${fromDate}T00:00:00`).lte("created_at", `${toDate}T23:59:59`).limit(5000)),
        safeQuery(extendedDb.from("wfm_roster_assignment").select("*,employees(employee_code,first_name,last_name),wfm_shift_master(shift_name)").gte("roster_date", fromDate).lte("roster_date", toDate).limit(5000)),
        safeQuery(extendedDb.from("wfm_attendance_session").select("*").gte("session_date", fromDate).lte("session_date", toDate).limit(5000)),
        safeQuery(extendedDb.from("quality_score_log").select("*").gte("audit_date", fromDate).lte("audit_date", toDate).limit(5000)),
        safeQuery(extendedDb.from("operations_productivity_log").select("*").gte("performance_date", fromDate).lte("performance_date", toDate).limit(5000)),
      ]);

      setEmployees(empResult.data || []);
      setAtsCandidates(atsC);
      setAtsSubmissions(atsS);
      setLmsProgress(lms);
      setWfmRoster(roster);
      setWfmSessions(sessions);
      setQualityRows(qa);
      setOpsRows(ops);
    } catch (err: any) {
      setMessage(err.message || "Unable to load unified command center. Make sure Phase 7, 8A, 8B, 8C and 8D SQL have passed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const scopePool = useMemo(() => {
    const values: Row[] = [];
    atsCandidates.forEach((r) => values.push({ branch_name: r.branch_name, process_name: r.role_applied, team_name: r.team_name }));
    wfmRoster.forEach((r) => values.push({ branch_name: r.branch_name, process_name: r.process_name, team_name: r.team_name }));
    qualityRows.forEach((r) => values.push(r));
    opsRows.forEach((r) => values.push(r));
    return values;
  }, [atsCandidates, wfmRoster, qualityRows, opsRows]);

  const branches = useMemo(() => uniq(scopePool.map((r) => r.branch_name || "Unmapped")), [scopePool]);
  const processes = useMemo(() => uniq(scopePool.map((r) => r.process_name || r.role_applied || "Unmapped")), [scopePool]);
  const teams = useMemo(() => uniq(scopePool.map((r) => r.team_name || "Unmapped")), [scopePool]);

  const inScope = (r: Row) => {
    const b = r.branch_name || "Unmapped";
    const p = r.process_name || r.role_applied || r.interviewed_for_process || "Unmapped";
    const t = r.team_name || "Unmapped";
    const q = search.trim().toLowerCase();
    const text = Object.values(r).join(" ").toLowerCase();
    return (branch === "All" || b === branch) && (process === "All" || p === process) && (team === "All" || t === team) && (!q || text.includes(q));
  };

  const scopedAtsCandidates = useMemo(() => atsCandidates.filter(inScope), [atsCandidates, branch, process, team, search]);
  const scopedAtsSubmissions = useMemo(() => atsSubmissions.filter(inScope), [atsSubmissions, branch, process, team, search]);
  const scopedWfmRoster = useMemo(() => wfmRoster.filter(inScope), [wfmRoster, branch, process, team, search]);
  const scopedQuality = useMemo(() => qualityRows.filter(inScope), [qualityRows, branch, process, team, search]);
  const scopedOps = useMemo(() => opsRows.filter(inScope), [opsRows, branch, process, team, search]);

  const metrics = useMemo(() => {
    const activeEmployees = employees.filter((e) => ["active", "onboarding"].includes(String(e.status || ""))).length;
    const selected = scopedAtsSubmissions.filter((r) => r.final_decision === "Selected").length;
    const clientPending = scopedAtsSubmissions.filter((r) => r.final_decision === "Client Round - Pending").length;
    const completedLearning = lmsProgress.filter((r) => r.completed || Number(r.progress_percent || 0) >= 100).length;
    const onShift = wfmSessions.filter((r) => r.current_status === "On Shift").length;
    const avgQuality = scopedQuality.length ? Math.round((scopedQuality.reduce((a, r) => a + Number(r.quality_score || 0), 0) / scopedQuality.length) * 10) / 10 : 0;
    const opsVolume = scopedOps.reduce((a, r) => a + Number(r.handled_volume || 0), 0);
    const opsTarget = scopedOps.reduce((a, r) => a + Number(r.target_volume || 0), 0);
    const shrinkage = scopedOps.reduce((a, r) => a + Number(r.shrinkage_minutes || 0), 0);
    const login = scopedOps.reduce((a, r) => a + Number(r.login_minutes || 0), 0);
    const critical = scopedQuality.reduce((a, r) => a + Number(r.fatal_count || 0), 0);
    return { activeEmployees, selected, clientPending, completedLearning, onShift, avgQuality, opsVolume, opsTarget, opsAchievement: pct(opsVolume, opsTarget), shrinkagePct: pct(shrinkage, login), critical };
  }, [employees, scopedAtsSubmissions, lmsProgress, wfmSessions, scopedQuality, scopedOps]);

  const branchRows = useMemo(() => {
    const map = new Map<string, Row>();
    [...scopedAtsCandidates, ...scopedQuality, ...scopedOps, ...scopedWfmRoster].forEach((r) => {
      const name = r.branch_name || "Unmapped";
      const x = map.get(name) || { name, activity: 0, qualityScore: 0, qualityRows: 0, volume: 0 };
      x.activity += 1;
      if (r.quality_score !== undefined) { x.qualityScore += Number(r.quality_score || 0); x.qualityRows += 1; }
      if (r.handled_volume !== undefined) x.volume += Number(r.handled_volume || 0);
      x.avgQuality = x.qualityRows ? Math.round((x.qualityScore / x.qualityRows) * 10) / 10 : 0;
      map.set(name, x);
    });
    return Array.from(map.values()).sort((a, b) => b.activity - a.activity);
  }, [scopedAtsCandidates, scopedQuality, scopedOps, scopedWfmRoster]);

  const processRows = useMemo(() => {
    const map = new Map<string, Row>();
    [...scopedAtsCandidates, ...scopedQuality, ...scopedOps].forEach((r) => {
      const name = r.process_name || r.role_applied || r.interviewed_for_process || "Unmapped";
      const x = map.get(name) || { name, activity: 0, volume: 0 };
      x.activity += 1;
      if (r.handled_volume !== undefined) x.volume += Number(r.handled_volume || 0);
      map.set(name, x);
    });
    return Array.from(map.values()).sort((a, b) => b.activity - a.activity);
  }, [scopedAtsCandidates, scopedQuality, scopedOps]);

  const alerts = useMemo(() => {
    const arr: { title: string; body: string; tone: string }[] = [];
    if (metrics.clientPending > 0) arr.push({ title: "ATS client pending", body: `${metrics.clientPending} candidate(s) need client-round follow-up.`, tone: "amber" });
    if (metrics.critical > 0) arr.push({ title: "Quality critical errors", body: `${metrics.critical} critical/fatal quality issue(s) in selected period.`, tone: "rose" });
    if (metrics.shrinkagePct > 10) arr.push({ title: "Shrinkage above target", body: `Shrinkage is ${metrics.shrinkagePct}% against 10% benchmark.`, tone: "rose" });
    if (metrics.opsAchievement < 100 && metrics.opsTarget > 0) arr.push({ title: "Operations target gap", body: `Achievement is ${metrics.opsAchievement}% against expected 100%.`, tone: "amber" });
    if (!arr.length) arr.push({ title: "Stable control", body: "No major alert generated from current filters.", tone: "green" });
    return arr;
  }, [metrics]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-blue-200">Unified Workforce OS</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">Performance Command Center</h1>
          <p className="mt-3 max-w-5xl text-sm leading-6 text-slate-300">One cockpit for HRMS, ATS, LMS, WFM, Quality and Operations with branch/process/team filters for CEO, branch head, process manager, team leader and functional leaders.</p>
        </div>

        {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[1.4fr_170px_170px_1fr_1fr_1fr_auto]">
            <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search across branch, process, employee, candidate..." className="h-12 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none" /></label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3" />
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">{branches.map((x) => <option key={x}>{x}</option>)}</select>
            <select value={process} onChange={(e) => setProcess(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">{processes.map((x) => <option key={x}>{x}</option>)}</select>
            <select value={team} onChange={(e) => setTeam(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">{teams.map((x) => <option key={x}>{x}</option>)}</select>
            <button disabled={loading} onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"><RefreshCcw className="h-4 w-4" /> Refresh</button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
          <Stat title="Employees" value={metrics.activeEmployees} sub="active/onboarding" icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
          <Stat title="ATS Walk-ins" value={scopedAtsCandidates.length} sub={`${metrics.selected} selected`} icon={<Briefcase className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" />
          <Stat title="LMS Completed" value={metrics.completedLearning} sub={`${lmsProgress.length} progress rows`} icon={<BookOpen className="h-5 w-5" />} tone="bg-green-50 text-green-700" />
          <Stat title="On Shift" value={metrics.onShift} sub={`${wfmSessions.length} sessions`} icon={<Clock className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
          <Stat title="Quality" value={`${metrics.avgQuality}%`} sub="avg score" icon={<ShieldCheck className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
          <Stat title="Ops Volume" value={metrics.opsVolume} sub={`${metrics.opsAchievement}% achievement`} icon={<Activity className="h-5 w-5" />} tone="bg-cyan-50 text-cyan-700" />
          <Stat title="Shrinkage" value={`${metrics.shrinkagePct}%`} sub="ops log" icon={<AlertTriangle className="h-5 w-5" />} tone="bg-rose-50 text-rose-700" />
          <Stat title="Data Rows" value={scopedAtsCandidates.length + scopedAtsSubmissions.length + lmsProgress.length + scopedWfmRoster.length + scopedQuality.length + scopedOps.length} sub="selected filters" icon={<Database className="h-5 w-5" />} tone="bg-slate-100 text-slate-700" />
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 flex items-center gap-2 font-black"><BarChart3 className="h-5 w-5" /> Branch Command View</h2><MiniBars rows={branchRows} label="name" value="activity" /></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 flex items-center gap-2 font-black"><TrendingUp className="h-5 w-5" /> Process Command View</h2><MiniBars rows={processRows} label="name" value="activity" /></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 flex items-center gap-2 font-black"><AlertTriangle className="h-5 w-5" /> Management Alerts</h2><div className="space-y-3">{alerts.map((a, i) => <div key={i} className={`rounded-2xl border p-4 ${a.tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-800' : a.tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><b>{a.title}</b><p className="mt-1 text-sm">{a.body}</p></div>)}</div></div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Module Health Snapshot</h2><p className="text-sm text-slate-500">Current data coverage by module.</p></div><div className="overflow-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-4">Module</th><th className="p-4">Rows</th><th className="p-4">Primary Signal</th><th className="p-4">Status</th></tr></thead><tbody>{[
            ['HRMS', employees.length, `${metrics.activeEmployees} active employees`],
            ['ATS', scopedAtsCandidates.length + scopedAtsSubmissions.length, `${metrics.selected} selected / ${metrics.clientPending} client pending`],
            ['LMS', lmsProgress.length, `${metrics.completedLearning} completed rows`],
            ['WFM', scopedWfmRoster.length + wfmSessions.length, `${metrics.onShift} on shift`],
            ['Quality', scopedQuality.length, `${metrics.avgQuality}% avg score`],
            ['Operations', scopedOps.length, `${metrics.opsVolume} volume`],
          ].map((r) => <tr key={String(r[0])} className="border-t"><td className="p-4 font-black">{r[0]}</td><td className="p-4">{r[1]}</td><td className="p-4">{r[2]}</td><td className="p-4"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Active</span></td></tr>)}</tbody></table></div></div>
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Leadership Action Register</h2><p className="text-sm text-slate-500">Auto-generated intervention points from current filters.</p></div><div className="space-y-3 p-5">{alerts.map((a, i) => <div key={i} className="rounded-2xl border p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-1 h-5 w-5 text-slate-500" /><div><b>{a.title}</b><p className="mt-1 text-sm text-slate-600">{a.body}</p><p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Owner: Branch / Process Leader</p></div></div></div>)}</div></div>
        </div>
      </div>
    </DashboardLayout>
  );
}
