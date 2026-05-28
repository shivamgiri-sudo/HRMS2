import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, Clock, Filter, RefreshCcw, Search, TrendingUp, UserCheck, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";


type Candidate = {
  id: string;
  candidate_code?: string;
  q_token?: string;
  full_name?: string;
  mobile?: string;
  email?: string;
  branch_name?: string;
  role_applied?: string;
  recruiter_name?: string;
  status?: string;
  walkin_end_stage?: string;
  source_system?: string;
  metadata?: any;
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
  id?: string;
  candidate_id?: string;
  candidate_code?: string;
  recruiter_name?: string;
  submitted_at?: string;
  walkin_end_stage?: string;
  final_decision?: string;
  interviewed_for_process?: string;
  round1_result?: string;
  skill_result?: string;
  round2_result?: string;
  round3_result?: string;
  offer_salary?: string;
  offer_doj?: string;
  previous_submitted_time?: string;
};

type Lifecycle = {
  candidate_id?: string;
  lifecycle_stage?: string;
  lifecycle_status?: string;
  employee_id?: string;
  metadata?: any;
  selected_at?: string;
  joined_at?: string;
};

type Row = Candidate & {
  assignment?: Assignment;
  submission?: Submission;
  lifecycle?: Lifecycle;
};

type RangeMode = "FTD" | "WTD" | "MTD" | "CUSTOM";

const fmt = (value?: string) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const monthStart = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};
const weekStart = () => {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return iso(d);
};
const inRange = (dateValue?: string, from?: string, to?: string) => {
  if (!dateValue) return false;
  const t = new Date(dateValue).getTime();
  const f = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const e = to ? new Date(`${to}T23:59:59`).getTime() : Infinity;
  return t >= f && t <= e;
};
const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0);

function Badge({ value }: { value?: string }) {
  const v = value || "Waiting";
  const key = v.toLowerCase();
  const cls = key.includes("selected") ? "bg-emerald-50 text-emerald-700 border-emerald-200" : key.includes("reject") || key.includes("no show") ? "bg-rose-50 text-rose-700 border-rose-200" : key.includes("pending") || key.includes("hold") ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200";
  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${cls}`}>{v}</span>;
}

function StatCard({ title, value, sub, icon, tone }: { title: string; value: string | number; sub?: string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-500">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function BarList({ rows, labelKey, valueKey, empty }: { rows: any[]; labelKey: string; valueKey: string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  if (!rows.length) return <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">{empty}</div>;
  return (
    <div className="space-y-3">
      {rows.slice(0, 8).map((r, i) => (
        <div key={`${r[labelKey]}-${i}`}>
          <div className="mb-1 flex items-center justify-between text-sm"><span className="font-bold text-slate-700">{r[labelKey] || "-"}</span><span className="font-black text-slate-950">{r[valueKey]}</span></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-slate-900" style={{ width: `${Math.max(6, (Number(r[valueKey]) / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function NativeATSDashboardV2() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<RangeMode>("MTD");
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const [branch, setBranch] = useState("All");
  const [process, setProcess] = useState("All");
  const [recruiter, setRecruiter] = useState("All");
  const [decision, setDecision] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [converting, setConverting] = useState("");

  useEffect(() => {
    void loadData();
  }, []);

  const applyMode = (m: RangeMode) => {
    setMode(m);
    if (m === "FTD") { setFromDate(today()); setToDate(today()); }
    if (m === "WTD") { setFromDate(weekStart()); setToDate(today()); }
    if (m === "MTD") { setFromDate(monthStart()); setToDate(today()); }
  };

  const loadData = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        "/api/ats/candidates?limit=1500&page=1"
      );
      const enriched = (res.data ?? []).map((c: any) => ({
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
        walkin_end_stage: c.current_stage ?? undefined,
        source_system: c.sourcing_channel ?? undefined,
        created_at: c.created_at,
        assignment: undefined,
        submission: undefined,
        lifecycle: undefined,
      }));
      setRows(enriched);
      setSelected((old: any) => old ? enriched.find((r: any) => r.id === old.id) || enriched[0] || null : enriched[0] || null);
    } catch (err: any) {
      setMessage(err?.message || "Unable to load ATS dashboard");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const finalDecision = r.submission?.final_decision || r.status || "Waiting";
      const branchName = r.branch_name || r.assignment?.branch_name || "Unmapped";
      const processName = r.submission?.interviewed_for_process || r.role_applied || "Unmapped";
      const recruiterName = r.submission?.recruiter_name || r.assignment?.recruiter_name || r.recruiter_name || "Unassigned";
      const text = [r.candidate_code, r.full_name, r.mobile, r.email, branchName, processName, recruiterName, finalDecision].join(" ").toLowerCase();
      return inRange(r.created_at, fromDate, toDate)
        && (branch === "All" || branchName === branch)
        && (process === "All" || processName === process)
        && (recruiter === "All" || recruiterName === recruiter)
        && (decision === "All" || finalDecision === decision)
        && (!q || text.includes(q));
    });
  }, [rows, fromDate, toDate, branch, process, recruiter, decision, query]);

  const options = useMemo(() => {
    const uniq = (arr: string[]) => ["All", ...Array.from(new Set(arr.filter(Boolean))).sort()];
    return {
      branches: uniq(rows.map((r) => r.branch_name || r.assignment?.branch_name || "Unmapped")),
      processes: uniq(rows.map((r) => r.submission?.interviewed_for_process || r.role_applied || "Unmapped")),
      recruiters: uniq(rows.map((r) => r.submission?.recruiter_name || r.assignment?.recruiter_name || r.recruiter_name || "Unassigned")),
      decisions: uniq(rows.map((r) => r.submission?.final_decision || r.status || "Waiting")),
    };
  }, [rows]);

  const metrics = useMemo(() => {
    const total = filtered.length;
    const selectedCount = filtered.filter((r) => (r.submission?.final_decision || r.status) === "Selected" || r.status === "Selected - Onboarding").length;
    const rejected = filtered.filter((r) => ["Rejected", "No Show"].includes(r.submission?.final_decision || r.status || "")).length;
    const clientPending = filtered.filter((r) => (r.submission?.final_decision || "") === "Client Round - Pending").length;
    const onboarding = filtered.filter((r) => !!r.lifecycle?.employee_id || r.status === "Selected - Onboarding").length;
    const submitted = filtered.filter((r) => !!r.submission?.submitted_at).length;
    const slaBreach = filtered.filter((r) => !r.submission?.submitted_at && Math.floor((Date.now() - new Date(r.created_at || 0).getTime()) / 60000) > 60).length;
    return { total, selectedCount, rejected, clientPending, onboarding, submitted, slaBreach, selectionRate: pct(selectedCount, submitted || total), closureRate: pct(submitted, total) };
  }, [filtered]);

  const grouped = useMemo(() => {
    const make = (keyFn: (r: Row) => string) => {
      const map = new Map<string, any>();
      filtered.forEach((r) => {
        const k = keyFn(r) || "Unmapped";
        const item = map.get(k) || { name: k, total: 0, selected: 0, rejected: 0, pending: 0 };
        const d = r.submission?.final_decision || r.status || "Waiting";
        item.total += 1;
        if (d === "Selected" || r.status === "Selected - Onboarding") item.selected += 1;
        if (["Rejected", "No Show"].includes(d)) item.rejected += 1;
        if (d === "Client Round - Pending") item.pending += 1;
        map.set(k, item);
      });
      return Array.from(map.values()).sort((a, b) => b.total - a.total);
    };
    return {
      branch: make((r) => r.branch_name || r.assignment?.branch_name || "Unmapped"),
      process: make((r) => r.submission?.interviewed_for_process || r.role_applied || "Unmapped"),
      recruiter: make((r) => r.submission?.recruiter_name || r.assignment?.recruiter_name || r.recruiter_name || "Unassigned"),
      source: make((r) => r.metadata?.source || r.source_system || "Native ATS"),
    };
  }, [filtered]);

  const convertCandidate = async (row: Row) => {
    setConverting(row.id);
    setMessage("");
    try {
      await hrmsApi.post("/api/ats/onboarding-bridge", {
        candidateId: row.id,
        bridgeDate: new Date().toISOString().slice(0, 10),
      });
      setMessage("Moved to HRMS onboarding. HR can now assign employee code.");
      await loadData();
    } catch (err: any) {
      setMessage(err?.message || "Unable to move candidate to HRMS onboarding");
    } finally {
      setConverting("");
    }
  };

  const selectedDecision = selected?.submission?.final_decision || selected?.status || "Waiting";
  const canConvert = selected && selectedDecision === "Selected" && !selected.lifecycle?.employee_id;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.22em] text-blue-600">ATS Command Center v2</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Recruitment Funnel, Productivity & Candidate Journey</h1>
            <p className="mt-2 max-w-5xl text-slate-600">FTD/WTD/MTD tracking with recruiter productivity, branch/process funnel, source foundation, SLA breaches, and selected-candidate HRMS handoff.</p>
          </div>
          <button onClick={loadData} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800"><RefreshCcw className="h-4 w-4" /> Refresh</button>
        </div>

        {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[auto_1fr_1fr_1fr_1fr_1fr_1.4fr]">
            <div className="flex gap-2">
              {(["FTD", "WTD", "MTD", "CUSTOM"] as RangeMode[]).map((m) => <button key={m} onClick={() => applyMode(m)} className={`rounded-2xl px-4 py-2 text-sm font-black ${mode === m ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>{m}</button>)}
            </div>
            <input type="date" value={fromDate} onChange={(e) => { setMode("CUSTOM"); setFromDate(e.target.value); }} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <input type="date" value={toDate} onChange={(e) => { setMode("CUSTOM"); setToDate(e.target.value); }} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400">{options.branches.map((o) => <option key={o}>{o}</option>)}</select>
            <select value={process} onChange={(e) => setProcess(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400">{options.processes.map((o) => <option key={o}>{o}</option>)}</select>
            <select value={recruiter} onChange={(e) => setRecruiter(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400">{options.recruiters.map((o) => <option key={o}>{o}</option>)}</select>
            <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search candidate / mobile / ID" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-3 text-sm outline-none focus:border-blue-400" /></label>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[260px_1fr]"><select value={decision} onChange={(e) => setDecision(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400">{options.decisions.map((o) => <option key={o}>{o}</option>)}</select><p className="flex items-center gap-2 text-sm font-semibold text-slate-500"><Filter className="h-4 w-4" /> Showing {filtered.length} candidate journeys from {fromDate} to {toDate}</p></div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Total Walk-ins" value={metrics.total} sub={`${metrics.closureRate}% recruiter updated`} icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
          <StatCard title="Selected" value={metrics.selectedCount} sub={`${metrics.selectionRate}% selection rate`} icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
          <StatCard title="Client Pending" value={metrics.clientPending} sub="needs follow-up/resubmission" icon={<Clock className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
          <StatCard title="SLA Breach" value={metrics.slaBreach} sub="not updated beyond 60 min" icon={<AlertTriangle className="h-5 w-5" />} tone="bg-rose-50 text-rose-700" />
        </div>

        <div className="grid gap-5 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-4 flex items-center gap-2 font-black text-slate-950"><BarChart3 className="h-5 w-5" /> Branch Funnel</h3><BarList rows={grouped.branch} labelKey="name" valueKey="total" empty="No branch data" /></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-4 flex items-center gap-2 font-black text-slate-950"><TrendingUp className="h-5 w-5" /> Process Funnel</h3><BarList rows={grouped.process} labelKey="name" valueKey="total" empty="No process data" /></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-4 flex items-center gap-2 font-black text-slate-950"><UserCheck className="h-5 w-5" /> Recruiter Productivity</h3><BarList rows={grouped.recruiter} labelKey="name" valueKey="total" empty="No recruiter data" /></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="mb-4 flex items-center gap-2 font-black text-slate-950"><CalendarDays className="h-5 w-5" /> Source Foundation</h3><BarList rows={grouped.source} labelKey="name" valueKey="total" empty="No source data" /></div>
        </div>

        <div className="grid gap-5 2xl:grid-cols-[1.35fr_0.75fr]">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-black text-slate-950">Candidate Journey Register</h2><p className="text-sm text-slate-500">Full candidate movement across registration, recruiter update, selection and HRMS handoff.</p></div>
            <div className="max-h-[680px] overflow-auto">
              {loading ? <div className="p-10 text-center text-slate-500">Loading ATS dashboard...</div> : !filtered.length ? <div className="p-10 text-center text-slate-500">No candidates found for selected filters.</div> : (
                <table className="w-full min-w-[1180px] text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Branch / Process</th><th className="px-4 py-3">Recruiter</th><th className="px-4 py-3">Decision</th><th className="px-4 py-3">SLA</th><th className="px-4 py-3">Lifecycle</th><th className="px-4 py-3">Action</th></tr></thead>
                  <tbody>{filtered.map((r) => {
                    const d = r.submission?.final_decision || r.status || "Waiting";
                    const age = Math.floor((Date.now() - new Date(r.created_at || 0).getTime()) / 60000);
                    const breach = !r.submission?.submitted_at && age > 60;
                    return <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-slate-50/70"><td className="px-4 py-4"><div className="font-black text-slate-900">{r.full_name || "-"}</div><div className="text-xs text-slate-500">{r.candidate_code || "-"}</div><div className="mt-1 text-xs text-slate-400">{fmt(r.created_at)}</div></td><td className="px-4 py-4 text-slate-600"><div>{r.mobile || "-"}</div><div className="text-xs">{r.email || "-"}</div></td><td className="px-4 py-4 text-slate-600"><div>{r.branch_name || r.assignment?.branch_name || "-"}</div><div className="text-xs">{r.submission?.interviewed_for_process || r.role_applied || "-"}</div></td><td className="px-4 py-4 text-slate-600">{r.submission?.recruiter_name || r.assignment?.recruiter_name || r.recruiter_name || "-"}</td><td className="px-4 py-4"><Badge value={d} /><div className="mt-2 text-xs text-slate-500">{r.submission?.walkin_end_stage || r.walkin_end_stage || "Arrival"}</div></td><td className="px-4 py-4">{breach ? <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">Breach {age}m</span> : <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">OK</span>}</td><td className="px-4 py-4 text-slate-600">{r.lifecycle?.employee_id ? <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700">HRMS {r.lifecycle?.metadata?.employee_code || "Created"}</span> : r.lifecycle?.lifecycle_stage || "Candidate Registered"}</td><td className="px-4 py-4"><button onClick={() => setSelected(r)} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white">Drilldown</button></td></tr>;
                  })}</tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            {!selected ? <div className="flex min-h-[520px] items-center justify-center text-center text-slate-500">Select a candidate for journey drilldown.</div> : (
              <div className="space-y-5">
                <div><p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Journey Drilldown</p><h2 className="mt-1 text-2xl font-black text-slate-950">{selected.full_name || "-"}</h2><p className="text-sm text-slate-500">{selected.candidate_code}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><div className="font-black text-slate-900">1. Registration</div><p className="mt-2 text-sm text-slate-600">{fmt(selected.created_at)}</p><p className="text-sm text-slate-600">Source: {selected.metadata?.source || selected.source_system || "Native ATS"}</p></div>
                <div className="rounded-2xl bg-blue-50 p-4"><div className="font-black text-blue-950">2. Recruiter Assignment</div><p className="mt-2 text-sm text-blue-800">{selected.assignment?.recruiter_name || selected.recruiter_name || "-"}</p><p className="text-sm text-blue-700">{selected.assignment?.recruiter_mobile || "-"} • {selected.assignment?.recruiter_email || "-"}</p></div>
                <div className="rounded-2xl bg-emerald-50 p-4"><div className="font-black text-emerald-950">3. Interview Update</div><p className="mt-2 text-sm text-emerald-800">Decision: {selectedDecision}</p><p className="text-sm text-emerald-700">Stage: {selected.submission?.walkin_end_stage || selected.walkin_end_stage || "Arrival"}</p><p className="text-sm text-emerald-700">Submitted: {fmt(selected.submission?.submitted_at)}</p></div>
                <div className="rounded-2xl bg-violet-50 p-4"><div className="font-black text-violet-950">4. HRMS Handoff</div><p className="mt-2 text-sm text-violet-800">{selected.lifecycle?.employee_id ? `Employee created: ${selected.lifecycle?.metadata?.employee_code || selected.lifecycle.employee_id}` : "Not moved to HRMS yet"}</p>{canConvert && <button disabled={converting === selected.id} onClick={() => convertCandidate(selected)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white disabled:bg-slate-300">{converting === selected.id ? "Moving..." : "Move to HRMS Onboarding"}<ArrowRight className="h-4 w-4" /></button>}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
