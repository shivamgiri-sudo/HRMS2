import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock, RefreshCcw, Search, Target, TrendingUp, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type Row = Record<string, any>;

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const uniq = (v: string[]) => ["All", ...Array.from(new Set(v.filter(Boolean))).sort()];

function Stat({ title, value, sub, icon, tone }: { title: string; value: string | number; sub?: string; icon: React.ReactNode; tone: string }) {
  return <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p>{sub && <p className="mt-1 text-xs font-semibold text-slate-500">{sub}</p>}</div><div className={`rounded-2xl p-3 ${tone}`}>{icon}</div></div></div>;
}

function MiniBars({ rows, label, value }: { rows: Row[]; label: string; value: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value]) || 0));
  if (!rows.length) return <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">No data.</div>;
  return <div className="space-y-3">{rows.slice(0, 10).map((r, i) => <div key={i}><div className="mb-1 flex justify-between text-sm"><b>{r[label] || "-"}</b><b>{r[value]}</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-slate-950" style={{ width: `${Math.max(6, ((Number(r[value]) || 0) / max) * 100)}%` }} /></div></div>)}</div>;
}

export default function NativeOperationsDashboard() {
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("All");
  const [process, setProcess] = useState("All");
  const [team, setTeam] = useState("All");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const { data, error } = await db
        .from("operations_productivity_log")
        .select("*")
        .gte("performance_date", fromDate)
        .lte("performance_date", toDate)
        .order("performance_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      setRows(data || []);
    } catch (err: any) {
      setMessage(err.message || "Unable to load Operations Dashboard. Run Phase 8D SQL if tables are missing.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const branches = useMemo(() => uniq(rows.map((r) => r.branch_name || "Unmapped")), [rows]);
  const processes = useMemo(() => uniq(rows.map((r) => r.process_name || "Unmapped")), [rows]);
  const teams = useMemo(() => uniq(rows.map((r) => r.team_name || "Unmapped")), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const text = [r.employee_code, r.employee_name, r.branch_name, r.process_name, r.team_name, r.manager_name, r.client_name].join(" ").toLowerCase();
      return (!q || text.includes(q))
        && (branch === "All" || (r.branch_name || "Unmapped") === branch)
        && (process === "All" || (r.process_name || "Unmapped") === process)
        && (team === "All" || (r.team_name || "Unmapped") === team);
    });
  }, [rows, search, branch, process, team]);

  const metrics = useMemo(() => {
    const employees = new Set(filtered.map((r) => r.employee_code || r.employee_id).filter(Boolean)).size;
    const volume = filtered.reduce((a, r) => a + Number(r.handled_volume || 0), 0);
    const target = filtered.reduce((a, r) => a + Number(r.target_volume || 0), 0);
    const login = filtered.reduce((a, r) => a + Number(r.login_minutes || 0), 0);
    const productive = filtered.reduce((a, r) => a + Number(r.productive_minutes || 0), 0);
    const shrinkage = filtered.reduce((a, r) => a + Number(r.shrinkage_minutes || 0), 0);
    const slaMet = filtered.reduce((a, r) => a + Number(r.sla_met_count || 0), 0);
    const slaTotal = filtered.reduce((a, r) => a + Number(r.sla_total_count || 0), 0);
    const avgAht = filtered.length ? Math.round(filtered.reduce((a, r) => a + Number(r.aht_seconds || 0), 0) / filtered.length) : 0;
    const avgAccuracy = filtered.length ? Math.round((filtered.reduce((a, r) => a + Number(r.accuracy_percent || 0), 0) / filtered.length) * 10) / 10 : 0;
    const avgEfficiency = filtered.length ? Math.round((filtered.reduce((a, r) => a + Number(r.efficiency_percent || 0), 0) / filtered.length) * 10) / 10 : 0;
    return { employees, volume, target, achievement: pct(volume, target), login, productive, productivePct: pct(productive, login), shrinkage, shrinkagePct: pct(shrinkage, login), slaPct: pct(slaMet, slaTotal), avgAht, avgAccuracy, avgEfficiency };
  }, [filtered]);

  const group = (key: string, sortKey = "volume") => {
    const map = new Map<string, Row>();
    filtered.forEach((r) => {
      const k = r[key] || "Unmapped";
      const item = map.get(k) || { name: k, employees: new Set(), volume: 0, target: 0, login: 0, productive: 0, shrinkage: 0, slaMet: 0, slaTotal: 0 };
      item.employees.add(r.employee_code || r.employee_id || r.employee_name);
      item.volume += Number(r.handled_volume || 0);
      item.target += Number(r.target_volume || 0);
      item.login += Number(r.login_minutes || 0);
      item.productive += Number(r.productive_minutes || 0);
      item.shrinkage += Number(r.shrinkage_minutes || 0);
      item.slaMet += Number(r.sla_met_count || 0);
      item.slaTotal += Number(r.sla_total_count || 0);
      item.headcount = item.employees.size;
      item.achievement = pct(item.volume, item.target);
      item.productivePct = pct(item.productive, item.login);
      item.slaPct = pct(item.slaMet, item.slaTotal);
      map.set(k, item);
    });
    return Array.from(map.values()).sort((a, b) => Number(b[sortKey]) - Number(a[sortKey]));
  };

  const branchRows = group("branch_name");
  const processRows = group("process_name");
  const teamRows = group("team_name");
  const employeeRows = group("employee_name", "achievement");

  return <DashboardLayout><div className="space-y-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Operations Command Center</p><h1 className="mt-2 text-3xl font-black text-slate-950">Operations Dashboard</h1><p className="mt-2 max-w-5xl text-slate-600">Employee, branch, process and team performance trends with volume, target, AHT, SLA, accuracy, efficiency and shrinkage.</p></div><button disabled={loading} onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"><RefreshCcw className="h-4 w-4" /> Refresh</button></div>{message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}<div className="rounded-3xl border bg-white p-4 shadow-sm"><div className="grid gap-3 lg:grid-cols-[1.4fr_170px_170px_1fr_1fr_1fr]"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee, manager, process..." className="h-12 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none" /></label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3" /><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3" /><select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">{branches.map((x) => <option key={x}>{x}</option>)}</select><select value={process} onChange={(e) => setProcess(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">{processes.map((x) => <option key={x}>{x}</option>)}</select><select value={team} onChange={(e) => setTeam(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">{teams.map((x) => <option key={x}>{x}</option>)}</select></div></div><div className="grid gap-4 md:grid-cols-3 xl:grid-cols-8"><Stat title="Employees" value={metrics.employees} icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" /><Stat title="Volume" value={metrics.volume} sub={`Target ${metrics.target}`} icon={<Activity className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" /><Stat title="Achievement" value={`${metrics.achievement}%`} icon={<Target className="h-5 w-5" />} tone="bg-green-50 text-green-700" /><Stat title="Productive" value={`${metrics.productivePct}%`} sub={`${metrics.productive}/${metrics.login} min`} icon={<Clock className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" /><Stat title="AHT" value={`${metrics.avgAht}s`} icon={<Clock className="h-5 w-5" />} tone="bg-slate-100 text-slate-700" /><Stat title="SLA" value={`${metrics.slaPct}%`} icon={<TrendingUp className="h-5 w-5" />} tone="bg-cyan-50 text-cyan-700" /><Stat title="Accuracy" value={`${metrics.avgAccuracy}%`} icon={<Target className="h-5 w-5" />} tone="bg-orange-50 text-orange-700" /><Stat title="Shrinkage" value={`${metrics.shrinkagePct}%`} sub={`${metrics.shrinkage} min`} icon={<AlertTriangle className="h-5 w-5" />} tone="bg-rose-50 text-rose-700" /></div><div className="grid gap-5 xl:grid-cols-4"><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black">Branch Volume</h2><MiniBars rows={branchRows} label="name" value="volume" /></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black">Process Volume</h2><MiniBars rows={processRows} label="name" value="volume" /></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black">Team Volume</h2><MiniBars rows={teamRows} label="name" value="volume" /></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black">Top Achievement</h2><MiniBars rows={employeeRows} label="name" value="achievement" /></div></div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Operations Performance Register</h2><p className="text-sm text-slate-500">Daily employee-level productivity and performance rows.</p></div><div className="overflow-auto"><table className="w-full min-w-[1320px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-4">Date</th><th className="p-4">Employee</th><th className="p-4">Branch / Process / Team</th><th className="p-4">Volume</th><th className="p-4">Target</th><th className="p-4">Achievement</th><th className="p-4">AHT</th><th className="p-4">Accuracy</th><th className="p-4">Efficiency</th><th className="p-4">SLA</th><th className="p-4">Shrinkage</th></tr></thead><tbody>{filtered.map((r) => <tr key={r.id} className="border-t"><td className="p-4">{r.performance_date}</td><td className="p-4"><b>{r.employee_name || "-"}</b><p className="text-xs text-slate-500">{r.employee_code}</p></td><td className="p-4">{r.branch_name || "-"}<p className="text-xs text-slate-500">{r.process_name || "-"} · {r.team_name || "-"}</p></td><td className="p-4 font-bold">{r.handled_volume}</td><td className="p-4">{r.target_volume}</td><td className="p-4 font-black">{pct(Number(r.handled_volume || 0), Number(r.target_volume || 0))}%</td><td className="p-4">{r.aht_seconds}s</td><td className="p-4">{r.accuracy_percent}%</td><td className="p-4">{r.efficiency_percent}%</td><td className="p-4">{pct(Number(r.sla_met_count || 0), Number(r.sla_total_count || 0))}%</td><td className="p-4">{r.shrinkage_minutes} min</td></tr>)}</tbody></table></div></div></div></DashboardLayout>;
}
