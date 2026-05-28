import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCcw, Search, ShieldCheck, Target, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type Row = Record<string, any>;

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const rate = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
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
  if (!rows.length) return <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">No data.</div>;
  return (
    <div className="space-y-3">
      {rows.slice(0, 10).map((r, i) => (
        <div key={i}>
          <div className="mb-1 flex justify-between text-sm"><b>{r[label] || "-"}</b><b>{r[value]}</b></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-slate-950" style={{ width: `${Math.max(6, ((Number(r[value]) || 0) / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function NativeQualityDashboard() {
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
        .from("quality_score_log")
        .select("*")
        .gte("audit_date", fromDate)
        .lte("audit_date", toDate)
        .order("audit_date", { ascending: false })
        .limit(3000);
      if (error) throw error;
      setRows(data || []);
    } catch (err: any) {
      setMessage(err.message || "Unable to load Quality Dashboard. Run Phase 8D SQL if tables are missing.");
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
      const text = [r.employee_code, r.employee_name, r.branch_name, r.process_name, r.team_name, r.auditor_name, r.defect_category, r.defect_sub_category].join(" ").toLowerCase();
      return (!q || text.includes(q))
        && (branch === "All" || (r.branch_name || "Unmapped") === branch)
        && (process === "All" || (r.process_name || "Unmapped") === process)
        && (team === "All" || (r.team_name || "Unmapped") === team);
    });
  }, [rows, search, branch, process, team]);

  const metrics = useMemo(() => {
    const audits = filtered.length;
    const avg = audits ? Math.round((filtered.reduce((a, r) => a + Number(r.quality_score || 0), 0) / audits) * 10) / 10 : 0;
    const critical = filtered.reduce((a, r) => a + Number(r.fatal_count || 0), 0);
    const defects = filtered.reduce((a, r) => a + Number(r.error_count || 0), 0);
    const coaching = filtered.filter((r) => r.coaching_required).length;
    const excellent = filtered.filter((r) => Number(r.quality_score || 0) >= 95).length;
    const low = filtered.filter((r) => Number(r.quality_score || 0) < 85).length;
    return { audits, avg, critical, defects, coaching, excellent, low, excellentRate: rate(excellent, audits) };
  }, [filtered]);

  const group = (key: string, valueKey = "audits") => {
    const map = new Map<string, Row>();
    filtered.forEach((r) => {
      const k = r[key] || "Unmapped";
      const item = map.get(k) || { name: k, audits: 0, defects: 0, critical: 0, scoreTotal: 0, avgScore: 0 };
      item.audits += 1;
      item.defects += Number(r.error_count || 0);
      item.critical += Number(r.fatal_count || 0);
      item.scoreTotal += Number(r.quality_score || 0);
      item.avgScore = Math.round((item.scoreTotal / item.audits) * 10) / 10;
      map.set(k, item);
    });
    return Array.from(map.values()).sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  };

  const branchRows = group("branch_name");
  const processRows = group("process_name");
  const analystRows = group("employee_name");
  const defectRows = group("defect_category", "defects");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Quality Command Center</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Quality Dashboard</h1>
            <p className="mt-2 max-w-5xl text-slate-600">Analyst, branch, process and team quality trends with score, defect and coaching visibility.</p>
          </div>
          <button disabled={loading} onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"><RefreshCcw className="h-4 w-4" /> Refresh</button>
        </div>

        {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_170px_170px_1fr_1fr_1fr]">
            <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search analyst, auditor, defect..." className="h-12 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none" /></label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3" />
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">{branches.map((x) => <option key={x}>{x}</option>)}</select>
            <select value={process} onChange={(e) => setProcess(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">{processes.map((x) => <option key={x}>{x}</option>)}</select>
            <select value={team} onChange={(e) => setTeam(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">{teams.map((x) => <option key={x}>{x}</option>)}</select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
          <Stat title="Audits" value={metrics.audits} icon={<ShieldCheck className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
          <Stat title="Avg Quality" value={`${metrics.avg}%`} sub="target 95%" icon={<Target className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
          <Stat title="Critical" value={metrics.critical} icon={<AlertTriangle className="h-5 w-5" />} tone="bg-rose-50 text-rose-700" />
          <Stat title="Defects" value={metrics.defects} icon={<AlertTriangle className="h-5 w-5" />} tone="bg-orange-50 text-orange-700" />
          <Stat title="Coaching" value={metrics.coaching} sub="required" icon={<Users className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" />
          <Stat title="Excellent" value={metrics.excellent} sub={`${metrics.excellentRate}%`} icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-green-50 text-green-700" />
          <Stat title="Low Score" value={metrics.low} sub="below 85%" icon={<AlertTriangle className="h-5 w-5" />} tone="bg-red-50 text-red-700" />
        </div>

        <div className="grid gap-5 xl:grid-cols-4">
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black">Branch Quality</h2><MiniBars rows={branchRows} label="name" value="audits" /></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black">Process Quality</h2><MiniBars rows={processRows} label="name" value="audits" /></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black">Analyst Quality</h2><MiniBars rows={analystRows} label="name" value="audits" /></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-black">Defect Categories</h2><MiniBars rows={defectRows} label="name" value="defects" /></div>
        </div>

        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5"><h2 className="font-black text-slate-950">Quality Audit Register</h2><p className="text-sm text-slate-500">Latest audit rows for drilldown and coaching action.</p></div>
          <div className="overflow-auto"><table className="w-full min-w-[1200px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-4">Date</th><th className="p-4">Analyst</th><th className="p-4">Branch / Process / Team</th><th className="p-4">Score</th><th className="p-4">Critical</th><th className="p-4">Defects</th><th className="p-4">Category</th><th className="p-4">Coaching</th><th className="p-4">Remarks</th></tr></thead><tbody>{filtered.map((r) => <tr key={r.id} className="border-t"><td className="p-4">{r.audit_date}</td><td className="p-4"><b>{r.employee_name || "-"}</b><p className="text-xs text-slate-500">{r.employee_code}</p></td><td className="p-4">{r.branch_name || "-"}<p className="text-xs text-slate-500">{r.process_name || "-"} · {r.team_name || "-"}</p></td><td className="p-4 font-black">{r.quality_score}%</td><td className="p-4">{r.fatal_count}</td><td className="p-4">{r.error_count}</td><td className="p-4">{r.defect_category || "-"}<p className="text-xs text-slate-500">{r.defect_sub_category || ""}</p></td><td className="p-4">{r.coaching_required ? "Required" : "No"}</td><td className="p-4">{r.remarks || "-"}</td></tr>)}</tbody></table></div>
        </div>
      </div>
    </DashboardLayout>
  );
}
