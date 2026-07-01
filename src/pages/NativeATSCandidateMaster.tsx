import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ClipboardList, Eye, Filter, Mail, Phone, Search, UserCheck, Users } from "lucide-react";
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
  created_at?: string;
  updated_at?: string;
  resume_url?: string;
  selfie_url?: string;
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
  candidate_id?: string;
  candidate_code?: string;
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
  reporting_timing?: string;
  last_walkin_end_stage?: string;
  last_final_decision?: string;
  previous_submitted_time?: string;
};

type LogRow = {
  id: string;
  candidate_id: string;
  old_status?: string;
  new_status?: string;
  event_type?: string;
  event_note?: string;
  created_at?: string;
};

type EnrichedCandidate = Candidate & {
  assignment?: Assignment;
  submission?: Submission;
  logs?: LogRow[];
};

const fmt = (value?: string) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const statusClass = (status?: string) => {
  const s = (status || "").toLowerCase();
  if (s.includes("selected")) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (s.includes("reject") || s.includes("no show")) return "bg-rose-50 text-rose-700 ring-rose-200";
  if (s.includes("hold") || s.includes("pending")) return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-blue-50 text-blue-700 ring-blue-200";
};

const StatCard = ({ title, value, icon, tone }: { title: string; value: string | number; icon: React.ReactNode; tone: string }) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
      </div>
      <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
    </div>
  </div>
);

export default function NativeATSCandidateMaster() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EnrichedCandidate[]>([]);
  const [selected, setSelected] = useState<EnrichedCandidate | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [branch, setBranch] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any[]; total: number }>(
        "/api/ats/candidates?limit=500&page=1"
      );
      const candidates = res.data ?? [];

      // Fetch stage logs for all candidates in parallel (batched)
      // For performance, only fetch for visible candidates
      const logsByCandidate = new Map<string, LogRow[]>();

      const enriched = candidates.map((c: any): EnrichedCandidate => ({
        id: c.id,
        candidate_code: c.candidate_code,
        q_token: c.candidate_code, // use code as token in MySQL schema
        full_name: c.full_name,
        mobile: c.mobile,
        email: c.email ?? undefined,
        branch_name: c.applied_for_branch ?? undefined,
        role_applied: c.applied_for_process ?? undefined,
        recruiter_name: c.sourcing_channel ?? undefined,
        status: c.current_stage ?? "Applied",
        walkin_end_stage: c.current_stage ?? undefined,
        created_at: c.created_at,
        updated_at: c.updated_at,
        resume_url: undefined,
        selfie_url: undefined,
        assignment: undefined,
        latestSubmission: undefined,
        logs: [],
      }));

      setRows(enriched);
      setSelected(enriched[0] || null);
    } catch (err: any) {
      setError(err?.message || "Unable to load ATS candidate master");
    } finally {
      setLoading(false);
    }
  };

  const branches = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.branch_name || r.assignment?.branch_name).filter(Boolean)))], [rows]);
  const statuses = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.submission?.final_decision || r.status || "Waiting").filter(Boolean)))], [rows]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;

    return rows.filter((r) => {
      const finalStatus = r.submission?.final_decision || r.status || "Waiting";
      const branchName = r.branch_name || r.assignment?.branch_name || "";
      const created = new Date(r.created_at || 0).getTime();

      const matchText = !q || [r.candidate_code, r.full_name, r.mobile, r.email, r.role_applied, branchName, r.assignment?.recruiter_name].join(" ").toLowerCase().includes(q);
      const matchStatus = status === "All" || finalStatus === status;
      const matchBranch = branch === "All" || branchName === branch;
      const matchFrom = !from || created >= from;
      const matchTo = !to || created <= to;

      return matchText && matchStatus && matchBranch && matchFrom && matchTo;
    });
  }, [rows, query, status, branch, fromDate, toDate]);

  const selectedCount = filtered.filter((r) => (r.submission?.final_decision || r.status) === "Selected").length;
  const waitingCount = filtered.filter((r) => (r.status || "Waiting") === "Waiting" && !r.submission?.final_decision).length;
  const closedCount = filtered.filter((r) => ["Rejected", "No Show", "Hold", "Client Round - Pending"].includes(r.submission?.final_decision || "")).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Native ATS</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Candidate Master & Journey</h1>
            <p className="mt-2 max-w-3xl text-slate-600">Track every walk-in from public candidate registration, recruiter assignment, interview updates, selection discussion, onboarding handoff and employee conversion.</p>
          </div>
          <button onClick={loadData} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800">Refresh Data</button>
        </div>

        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Filtered Candidates" value={filtered.length} icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
          <StatCard title="Waiting Queue" value={waitingCount} icon={<ClipboardList className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
          <StatCard title="Selected" value={selectedCount} icon={<UserCheck className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
          <StatCard title="Closed / Hold" value={closedCount} icon={<Filter className="h-5 w-5" />} tone="bg-rose-50 text-rose-700" />
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, mobile, candidate ID, recruiter..." className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 focus:bg-white" />
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400 focus:bg-white">
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400 focus:bg-white">
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400 focus:bg-white" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400 focus:bg-white" />
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.25fr_0.85fr]">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-bold text-slate-950">Candidates</h2>
              <p className="text-sm text-slate-500">Click View to inspect full journey.</p>
            </div>
            <div className="max-h-[620px] overflow-auto">
              {loading ? (
                <div className="p-8 text-center text-slate-500">Loading candidates...</div>
              ) : !filtered.length ? (
                <div className="p-8 text-center text-slate-500">No candidates found.</div>
              ) : (
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Candidate</th>
                      <th className="px-4 py-3">Contact</th>
                      <th className="px-4 py-3">Branch / Role</th>
                      <th className="px-4 py-3">Recruiter</th>
                      <th className="px-4 py-3">Stage</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const finalStatus = r.submission?.final_decision || r.status || "Waiting";
                      return (
                        <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900">{r.full_name || "-"}</div>
                            <div className="text-xs text-slate-500">{r.candidate_code || "-"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>{r.mobile || "-"}</div>
                            <div className="text-xs">{r.email || "-"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>{r.branch_name || r.assignment?.branch_name || "-"}</div>
                            <div className="text-xs">{r.role_applied || "-"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{r.assignment?.recruiter_name || r.recruiter_name || "-"}</td>
                          <td className="px-4 py-3 text-slate-600">{r.submission?.walkin_end_stage || r.walkin_end_stage || "Arrival"}</td>
                          <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusClass(finalStatus)}`}>{finalStatus}</span></td>
                          <td className="px-4 py-3">
                            <button onClick={() => setSelected(r)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"><Eye className="h-4 w-4" /> View</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            {!selected ? (
              <div className="flex min-h-[420px] items-center justify-center text-center text-slate-500">Select a candidate to view journey.</div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Candidate Journey</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-950">{selected.full_name || "-"}</h2>
                  <p className="text-sm text-slate-500">{selected.candidate_code || "-"}</p>
                </div>

                <div className="grid gap-3 text-sm">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="font-bold text-slate-900">Registration</div>
                    <div className="mt-2 flex items-center gap-2 text-slate-600"><CalendarDays className="h-4 w-4" /> {fmt(selected.created_at)}</div>
                    <div className="mt-1 text-slate-600">Branch: {selected.branch_name || selected.assignment?.branch_name || "-"}</div>
                    <div className="mt-1 text-slate-600">Role: {selected.role_applied || "-"}</div>
                  </div>

                  <div className="rounded-2xl bg-blue-50 p-4">
                    <div className="font-bold text-blue-950">Recruiter Assignment</div>
                    <div className="mt-2 text-blue-800">{selected.assignment?.recruiter_name || selected.recruiter_name || "-"}</div>
                    <div className="mt-1 flex items-center gap-2 text-blue-700"><Phone className="h-4 w-4" /> {selected.assignment?.recruiter_mobile || "-"}</div>
                    <div className="mt-1 flex items-center gap-2 text-blue-700"><Mail className="h-4 w-4" /> {selected.assignment?.recruiter_email || "-"}</div>
                  </div>

                  <div className="rounded-2xl bg-emerald-50 p-4">
                    <div className="font-bold text-emerald-950">Latest Recruiter Update</div>
                    <div className="mt-2 text-emerald-800">Decision: {selected.submission?.final_decision || selected.status || "Waiting"}</div>
                    <div className="mt-1 text-emerald-700">Stage: {selected.submission?.walkin_end_stage || selected.walkin_end_stage || "Arrival"}</div>
                    <div className="mt-1 text-emerald-700">Process: {selected.submission?.interviewed_for_process || "-"}</div>
                    <div className="mt-1 text-emerald-700">Submitted: {fmt(selected.submission?.submitted_at)}</div>
                  </div>

                  {selected.submission?.final_decision === "Selected" && (
                    <div className="rounded-2xl bg-violet-50 p-4">
                      <div className="font-bold text-violet-950">Selection Discussion</div>
                      <div className="mt-2 text-violet-800">Offer Salary: {selected.submission?.offer_salary || "-"}</div>
                      <div className="mt-1 text-violet-700">Date of Joining: {selected.submission?.offer_doj || "-"}</div>
                      <div className="mt-1 text-violet-700">Reporting Timing: {selected.submission?.reporting_timing || "-"}</div>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="font-bold text-slate-950">Audit Timeline</h3>
                  <div className="mt-3 space-y-3">
                    {!selected.logs?.length ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No journey log found yet.</div>
                    ) : (
                      selected.logs.slice(0, 8).map((log) => (
                        <div key={log.id} className="rounded-2xl border border-slate-100 p-4">
                          <div className="text-sm font-bold text-slate-900">{log.event_type || "Journey Event"}</div>
                          <div className="mt-1 text-xs text-slate-500">{fmt(log.created_at)}</div>
                          <div className="mt-2 text-sm text-slate-600">{log.event_note || `${log.old_status || "-"} → ${log.new_status || "-"}`}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
