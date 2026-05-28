import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, RefreshCcw, Search, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";


type Candidate = {
  id: string;
  candidate_code?: string;
  full_name?: string;
  mobile?: string;
  email?: string;
  branch_name?: string;
  role_applied?: string;
  recruiter_name?: string;
  status?: string;
  walkin_end_stage?: string;
  created_at?: string;
};

type Assignment = {
  candidate_id: string;
  recruiter_name?: string;
  recruiter_mobile?: string;
  recruiter_email?: string;
  branch_name?: string;
  assignment_status?: string;
  assigned_at?: string;
};

type Submission = {
  candidate_code?: string;
  final_decision?: string;
  submitted_at?: string;
};

type WaitingRow = Candidate & {
  assignment?: Assignment;
  submitted?: boolean;
  pendingMinutes: number;
};

const fmt = (value?: string) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const inDateRange = (value?: string, from?: string, to?: string) => {
  if (!value) return false;
  const t = new Date(value).getTime();
  const f = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const e = to ? new Date(`${to}T23:59:59`).getTime() : Infinity;
  return t >= f && t <= e;
};

const Stat = ({ title, value, sub, tone, icon }: { title: string; value: number; sub: string; tone: string; icon: React.ReactNode }) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-slate-500">{title}</p>
        <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">{sub}</p>
      </div>
      <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
    </div>
  </div>
);

export default function NativeATSWaitingQueue() {
  const [rows, setRows] = useState<WaitingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const [branch, setBranch] = useState("All");
  const [recruiter, setRecruiter] = useState("All");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        "/api/ats/candidates?limit=500&page=1&stage=Applied"
      );

      const waiting = (res.data ?? []).map((c: any) => ({
        id: c.id,
        candidate_code: c.candidate_code,
        q_token: c.candidate_code,
        full_name: c.full_name,
        mobile: c.mobile,
        email: c.email ?? undefined,
        branch_name: c.applied_for_branch ?? undefined,
        role_applied: c.applied_for_process ?? undefined,
        recruiter_name: c.sourcing_channel ?? undefined,
        status: c.current_stage ?? "Applied",
        created_at: c.created_at,
        assignment: undefined,
        submitted: false,
        pendingMinutes: Math.max(0, Math.floor((Date.now() - new Date(c.created_at || 0).getTime()) / 60000)),
      }));

      setRows(waiting);
    } catch (err: any) {
      setMessage(err?.message || "Unable to load waiting queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const branches = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.branch_name || r.assignment?.branch_name || "Unmapped"))).sort()], [rows]);
  const recruiters = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.assignment?.recruiter_name || r.recruiter_name || "Unassigned"))).sort()], [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const branchName = r.branch_name || r.assignment?.branch_name || "Unmapped";
      const recruiterName = r.assignment?.recruiter_name || r.recruiter_name || "Unassigned";
      const text = [r.candidate_code, r.full_name, r.mobile, r.email, branchName, recruiterName, r.role_applied].join(" ").toLowerCase();
      return inDateRange(r.created_at, fromDate, toDate)
        && (branch === "All" || branchName === branch)
        && (recruiter === "All" || recruiterName === recruiter)
        && (!q || text.includes(q));
    });
  }, [rows, search, fromDate, toDate, branch, recruiter]);

  const slaBreach = filtered.filter((r) => r.pendingMinutes > 60).length;
  const unassigned = filtered.filter((r) => !(r.assignment?.recruiter_name || r.recruiter_name)).length;
  const oldest = filtered.length ? Math.max(...filtered.map((r) => r.pendingMinutes)) : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">ATS Waiting Queue</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Registered Candidates Awaiting Recruiter Action</h1>
            <p className="mt-2 max-w-5xl text-slate-600">Every candidate registered from the public interview form appears here until the assigned recruiter submits a final decision.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/ats/dashboard" className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700">Command Center</a>
            <button onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white"><RefreshCcw className="h-4 w-4" /> Refresh</button>
          </div>
        </div>

        {message && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{message}</div>}

        <div className="grid gap-4 md:grid-cols-4">
          <Stat title="Waiting Candidates" value={filtered.length} sub="not yet submitted by recruiter" tone="bg-blue-50 text-blue-700" icon={<Users className="h-5 w-5" />} />
          <Stat title="SLA Breach" value={slaBreach} sub="pending more than 60 minutes" tone="bg-rose-50 text-rose-700" icon={<AlertTriangle className="h-5 w-5" />} />
          <Stat title="Unassigned" value={unassigned} sub="needs recruiter mapping" tone="bg-amber-50 text-amber-700" icon={<Clock className="h-5 w-5" />} />
          <Stat title="Oldest Pending" value={oldest} sub="minutes" tone="bg-violet-50 text-violet-700" icon={<Clock className="h-5 w-5" />} />
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
            <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, mobile, candidate ID, recruiter..." className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-blue-400" /></label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400" />
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400">{branches.map((b) => <option key={b}>{b}</option>)}</select>
            <select value={recruiter} onChange={(e) => setRecruiter(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400">{recruiters.map((r) => <option key={r}>{r}</option>)}</select>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-black text-slate-950">Waiting Queue Register</h2><p className="text-sm text-slate-500">Candidate leaves this queue when recruiter submits update in Recruiter Workspace.</p></div>
          <div className="max-h-[680px] overflow-auto">
            {loading ? <div className="p-10 text-center text-slate-500">Loading waiting queue...</div> : !filtered.length ? <div className="p-10 text-center text-slate-500">No waiting candidates found.</div> : (
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Branch / Role</th><th className="px-4 py-3">Assigned Recruiter</th><th className="px-4 py-3">Pending Time</th><th className="px-4 py-3">SLA</th></tr></thead>
                <tbody>{filtered.map((r) => {
                  const breach = r.pendingMinutes > 60;
                  return <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50"><td className="px-4 py-4"><div className="font-black text-slate-900">{r.full_name || "-"}</div><div className="text-xs text-slate-500">{r.candidate_code || "-"}</div><div className="mt-1 text-xs text-slate-400">Registered: {fmt(r.created_at)}</div></td><td className="px-4 py-4 text-slate-600"><div>{r.mobile || "-"}</div><div className="text-xs">{r.email || "-"}</div></td><td className="px-4 py-4 text-slate-600"><div>{r.branch_name || r.assignment?.branch_name || "-"}</div><div className="text-xs">{r.role_applied || "-"}</div></td><td className="px-4 py-4 text-slate-600"><div className="font-bold">{r.assignment?.recruiter_name || r.recruiter_name || "Unassigned"}</div><div className="text-xs">{r.assignment?.recruiter_mobile || ""}</div></td><td className="px-4 py-4 font-black text-slate-900">{r.pendingMinutes} min</td><td className="px-4 py-4">{breach ? <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">Breach</span> : <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Within SLA</span>}</td></tr>;
                })}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
