import { useEffect, useState } from "react";
import {
  AlertTriangle, Briefcase, Calendar, ChevronDown,
  Clock, Loader, Plus, RefreshCcw, Users, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTTime } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

type JobType = "full_time" | "part_time" | "contract" | "internship";
type PostingStatus = "draft" | "active" | "paused" | "closed";
type WalkinStatus = "waiting" | "called" | "in_interview" | "completed" | "no_show";

interface JobPosting {
  id: string;
  posting_code: string;
  title: string;
  process_id: string | null;
  branch_id: string | null;
  department_id: string | null;
  designation_id: string | null;
  vacancies: number;
  job_type: JobType;
  experience_min: number;
  experience_max: number;
  description: string | null;
  requirements: string | null;
  salary_min: number | null;
  salary_max: number | null;
  posted_by: string | null;
  status: PostingStatus;
  closing_date: string | null;
  created_at: string;
  updated_at: string;
}

interface WalkinEntry {
  id: string;
  token_number: string;
  candidate_name: string;
  mobile: string;
  email: string | null;
  applied_role: string | null;
  branch_id: string | null;
  process_id: string | null;
  registered_at: string;
  called_at: string | null;
  status: WalkinStatus;
  notes: string | null;
  recruiter_id: string | null;
}

interface WalkinStats {
  registered: number;
  called: number;
  completed: number;
  no_show: number;
}

interface CreatePostingForm {
  title: string;
  process_id: string;
  branch_id: string;
  department_id: string;
  designation_id: string;
  vacancies: string;
  job_type: JobType;
  experience_min: string;
  experience_max: string;
  description: string;
  requirements: string;
  salary_min: string;
  salary_max: string;
  closing_date: string;
  status: PostingStatus;
}

interface RegisterWalkinForm {
  candidate_name: string;
  mobile: string;
  email: string;
  applied_role: string;
  branch_id: string;
  process_id: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const POSTING_STATUS_COLORS: Record<PostingStatus, string> = {
  draft:  "bg-slate-100 text-slate-700",
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  closed: "bg-red-50 text-red-700",
};

const WALKIN_STATUS_COLORS: Record<WalkinStatus, string> = {
  waiting:      "bg-blue-50 text-blue-700",
  called:       "bg-amber-50 text-amber-700",
  in_interview: "bg-violet-50 text-violet-700",
  completed:    "bg-emerald-50 text-emerald-700",
  no_show:      "bg-red-50 text-red-700",
};

const NEXT_POSTING_STATUS: Partial<Record<PostingStatus, PostingStatus>> = {
  draft:  "active",
  active: "paused",
  paused: "active",
};

const WALKIN_STATUSES: WalkinStatus[] = ["waiting", "called", "in_interview", "completed", "no_show"];

const BLANK_POSTING_FORM: CreatePostingForm = {
  title: "", process_id: "", branch_id: "", department_id: "",
  designation_id: "", vacancies: "1", job_type: "full_time",
  experience_min: "0", experience_max: "0", description: "",
  requirements: "", salary_min: "", salary_max: "", closing_date: "",
  status: "draft",
};

const BLANK_WALKIN_FORM: RegisterWalkinForm = {
  candidate_name: "", mobile: "", email: "",
  applied_role: "", branch_id: "", process_id: "",
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${colorClass}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

function StatCard({ title, value, icon, tone }: {
  title: string; value: number; icon: React.ReactNode; tone: string;
}) {
  return (
    <div className="glass-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
        active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Tab: Job Postings ─────────────────────────────────────────────────────────

function JobPostingsTab() {
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [form, setForm] = useState<CreatePostingForm>(BLANK_POSTING_FORM);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: JobPosting[] }>(
        `/api/jobs/postings${params}`
      );
      setPostings(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load postings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  const createPosting = async () => {
    if (!form.title.trim()) return setMessage("Title is required.");
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/jobs/postings", {
        title: form.title.trim(),
        process_id: form.process_id || undefined,
        branch_id: form.branch_id || undefined,
        department_id: form.department_id || undefined,
        designation_id: form.designation_id || undefined,
        vacancies: parseInt(form.vacancies, 10) || 1,
        job_type: form.job_type,
        experience_min: parseInt(form.experience_min, 10) || 0,
        experience_max: parseInt(form.experience_max, 10) || 0,
        description: form.description || undefined,
        requirements: form.requirements || undefined,
        salary_min: form.salary_min ? parseFloat(form.salary_min) : undefined,
        salary_max: form.salary_max ? parseFloat(form.salary_max) : undefined,
        closing_date: form.closing_date || undefined,
        status: form.status,
      });
      setShowModal(false);
      setForm(BLANK_POSTING_FORM);
      setMessage("Job posting created.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Creation failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (posting: JobPosting) => {
    const next = NEXT_POSTING_STATUS[posting.status];
    if (!next) return;
    setToggling(posting.id);
    try {
      await hrmsApi.patch(`/api/jobs/postings/${posting.id}`, { status: next });
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setToggling(null);
    }
  };

  const closePosting = async (id: string) => {
    setToggling(id);
    try {
      await hrmsApi.patch(`/api/jobs/postings/${id}`, { status: "closed" });
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setToggling(null);
    }
  };

  const STATUSES: Array<string> = ["all", "draft", "active", "paused", "closed"];

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                statusFilter === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Create Posting
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">Job Postings</h2>
          <p className="text-sm text-slate-500">{postings.length} records</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : postings.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Briefcase className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No job postings found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Code", "Title", "Type", "Vacancies", "Experience", "Closing Date", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {postings.map((p) => (
                  <tr key={p.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-xs text-slate-500">{p.posting_code}</td>
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{p.title}</div>
                      {p.description && (
                        <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400">{p.description}</div>
                      )}
                    </td>
                    <td className="p-4 capitalize text-slate-600">{p.job_type.replace(/_/g, " ")}</td>
                    <td className="p-4 text-center font-bold text-slate-950">{p.vacancies}</td>
                    <td className="p-4 text-slate-600">
                      {p.experience_min}–{p.experience_max === 0 ? "∞" : p.experience_max} mo
                    </td>
                    <td className="p-4 font-mono text-slate-600">{p.closing_date ?? "—"}</td>
                    <td className="p-4">
                      <Badge label={p.status} colorClass={POSTING_STATUS_COLORS[p.status]} />
                    </td>
                    <td className="p-4">
                      <div className="flex gap-1.5">
                        {NEXT_POSTING_STATUS[p.status] && (
                          <button
                            onClick={() => toggleStatus(p)}
                            disabled={toggling === p.id}
                            className="cursor-pointer rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700 transition-colors disabled:opacity-50 capitalize"
                          >
                            {NEXT_POSTING_STATUS[p.status]?.replace(/_/g, " ")}
                          </button>
                        )}
                        {p.status !== "closed" && (
                          <button
                            onClick={() => closePosting(p.id)}
                            disabled={toggling === p.id}
                            className="cursor-pointer rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            Close
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b p-6 sticky top-0 bg-white rounded-t-3xl">
              <h2 className="text-lg font-black text-slate-950">Create Job Posting</h2>
              <button onClick={() => setShowModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Title *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Senior Customer Support Agent"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Job Type</label>
                  <select value={form.job_type} onChange={(e) => setForm({ ...form, job_type: e.target.value as JobType })} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400">
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="contract">Contract</option>
                    <option value="internship">Internship</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PostingStatus })} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400">
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Vacancies</label>
                  <input
                    type="number"
                    min="1"
                    value={form.vacancies}
                    onChange={(e) => setForm({ ...form, vacancies: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Exp Min (months)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.experience_min}
                    onChange={(e) => setForm({ ...form, experience_min: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Exp Max (0=any)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.experience_max}
                    onChange={(e) => setForm({ ...form, experience_max: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Salary Min</label>
                  <input
                    type="number"
                    placeholder="e.g. 15000"
                    value={form.salary_min}
                    onChange={(e) => setForm({ ...form, salary_min: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Salary Max</label>
                  <input
                    type="number"
                    placeholder="e.g. 25000"
                    value={form.salary_max}
                    onChange={(e) => setForm({ ...form, salary_max: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Closing Date</label>
                <input
                  type="date"
                  value={form.closing_date}
                  onChange={(e) => setForm({ ...form, closing_date: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Role overview and responsibilities…"
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Requirements</label>
                <textarea
                  value={form.requirements}
                  onChange={(e) => setForm({ ...form, requirements: e.target.value })}
                  placeholder="Skills, qualifications, certifications…"
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6 sticky bottom-0 bg-white rounded-b-3xl">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createPosting}
                disabled={submitting}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create Posting"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Walk-in Queue ────────────────────────────────────────────────────────

function WalkinQueueTab() {
  const [entries, setEntries] = useState<WalkinEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>(new Date().toISOString().slice(0, 10));
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [form, setForm] = useState<RegisterWalkinForm>(BLANK_WALKIN_FORM);

  const todayStats: WalkinStats = {
    registered: entries.length,
    called:     entries.filter((e) => ["called", "in_interview", "completed"].includes(e.status)).length,
    completed:  entries.filter((e) => e.status === "completed").length,
    no_show:    entries.filter((e) => e.status === "no_show").length,
  };

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (dateFilter) params.set("date", dateFilter);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: WalkinEntry[] }>(
        `/api/jobs/walkin${query}`
      );
      setEntries(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [statusFilter, dateFilter]);

  const registerWalkin = async () => {
    if (!form.candidate_name.trim()) return setMessage("Candidate name is required.");
    if (!form.mobile.trim()) return setMessage("Mobile number is required.");
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/jobs/walkin", {
        candidate_name: form.candidate_name.trim(),
        mobile: form.mobile.trim(),
        email: form.email || undefined,
        applied_role: form.applied_role || undefined,
        branch_id: form.branch_id || undefined,
        process_id: form.process_id || undefined,
      });
      setShowModal(false);
      setForm(BLANK_WALKIN_FORM);
      setMessage("Walk-in candidate registered.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const callNext = async () => {
    const first = entries.find((e) => e.status === "waiting");
    if (!first) return setMessage("No waiting candidates.");
    setActing(first.id);
    try {
      await hrmsApi.patch(`/api/jobs/walkin/${first.id}/call`, {});
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActing(null);
    }
  };

  const updateStatus = async (id: string, status: WalkinStatus) => {
    setActing(id);
    try {
      await hrmsApi.patch(`/api/jobs/walkin/${id}/status`, { status });
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Registered Today" value={todayStats.registered} icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
        <StatCard title="Called" value={todayStats.called} icon={<ChevronDown className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
        <StatCard title="Completed" value={todayStats.completed} icon={<Briefcase className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
        <StatCard title="No Show" value={todayStats.no_show} icon={<Clock className="h-5 w-5" />} tone="bg-red-50 text-red-700" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setStatusFilter("all")}
            className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
              statusFilter === "all" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All
          </button>
          {WALKIN_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                statusFilter === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.replace(/_/g, " ")}
            </button>
          ))}
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-xl border px-3 py-1.5 text-xs font-semibold outline-none focus:border-blue-400 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={callNext}
            disabled={loading || !entries.some((e) => e.status === "waiting")}
            className="inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-700 transition-colors cursor-pointer disabled:opacity-40"
          >
            Call Next
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Register Walk-in
          </button>
        </div>
      </div>

      {/* Queue Table */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">Walk-in Queue</h2>
          <p className="text-sm text-slate-500">{entries.length} entries</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No walk-in entries found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Token", "Name", "Mobile", "Applied Role", "Registered At", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-slate-950">{e.token_number}</td>
                    <td className="p-4 font-bold text-slate-950">{e.candidate_name}</td>
                    <td className="p-4 font-mono text-slate-600">{e.mobile}</td>
                    <td className="p-4 text-slate-600">{e.applied_role ?? "—"}</td>
                    <td className="p-4 font-mono text-xs text-slate-500">
                      {formatISTTime(e.registered_at)}
                    </td>
                    <td className="p-4">
                      <Badge label={e.status} colorClass={WALKIN_STATUS_COLORS[e.status]} />
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {e.status === "waiting" && (
                          <button
                            onClick={() => updateStatus(e.id, "called")}
                            disabled={acting === e.id}
                            className="cursor-pointer rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                          >
                            Call
                          </button>
                        )}
                        {e.status === "called" && (
                          <button
                            onClick={() => updateStatus(e.id, "in_interview")}
                            disabled={acting === e.id}
                            className="cursor-pointer rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
                          >
                            Interview
                          </button>
                        )}
                        {e.status === "in_interview" && (
                          <button
                            onClick={() => updateStatus(e.id, "completed")}
                            disabled={acting === e.id}
                            className="cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            Done
                          </button>
                        )}
                        {["waiting", "called"].includes(e.status) && (
                          <button
                            onClick={() => updateStatus(e.id, "no_show")}
                            disabled={acting === e.id}
                            className="cursor-pointer rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            No Show
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Register Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Register Walk-in Candidate</h2>
              <button onClick={() => setShowModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Candidate Name *</label>
                <input
                  value={form.candidate_name}
                  onChange={(e) => setForm({ ...form, candidate_name: e.target.value })}
                  placeholder="Full name"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Mobile *</label>
                  <input
                    value={form.mobile}
                    onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                    placeholder="10-digit mobile"
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="optional"
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Applied Role</label>
                <input
                  value={form.applied_role}
                  onChange={(e) => setForm({ ...form, applied_role: e.target.value })}
                  placeholder="e.g. Customer Support Agent"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={registerWalkin}
                disabled={submitting}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {submitting ? "Registering…" : "Register"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Vacancy Analytics ────────────────────────────────────────────────────

function VacancyAnalyticsTab() {
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: JobPosting[] }>("/api/jobs/postings");
      setPostings(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const active = postings.filter((p) => p.status === "active");
  const totalVacancies = active.reduce((sum, p) => sum + p.vacancies, 0);
  const today = new Date();
  const sevenDaysAhead = new Date(today);
  sevenDaysAhead.setDate(today.getDate() + 7);
  const expiringSoon = active.filter((p) => {
    if (!p.closing_date) return false;
    const d = new Date(p.closing_date);
    return d >= today && d <= sevenDaysAhead;
  });

  // Group by process_id (simplified — show process_id as key)
  const byProcess = active.reduce<Record<string, { postings: number; vacancies: number }>>((acc, p) => {
    const key = p.process_id ?? "Unassigned";
    if (!acc[key]) acc[key] = { postings: 0, vacancies: 0 };
    acc[key].postings += 1;
    acc[key].vacancies += p.vacancies;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Active Postings" value={active.length} icon={<Briefcase className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
        <StatCard title="Total Vacancies" value={totalVacancies} icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
        <StatCard title="Expiring in 7 Days" value={expiringSoon.length} icon={<Calendar className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* By Process */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Active Postings by Process</h2>
          </div>
          {Object.keys(byProcess).length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">No active postings</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-4 font-semibold">Process ID</th>
                  <th className="p-4 font-semibold">Postings</th>
                  <th className="p-4 font-semibold">Vacancies</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byProcess).map(([key, val]) => (
                  <tr key={key} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-xs text-slate-600">{key}</td>
                    <td className="p-4 font-bold text-slate-950">{val.postings}</td>
                    <td className="p-4 font-bold text-slate-950">{val.vacancies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Expiring Soon */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Closing in Next 7 Days</h2>
          </div>
          {expiringSoon.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">No postings closing soon</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-4 font-semibold">Title</th>
                  <th className="p-4 font-semibold">Vacancies</th>
                  <th className="p-4 font-semibold">Closing Date</th>
                </tr>
              </thead>
              <tbody>
                {expiringSoon.sort((a, b) => (a.closing_date ?? "").localeCompare(b.closing_date ?? "")).map((p) => (
                  <tr key={p.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-bold text-slate-950">{p.title}</td>
                    <td className="p-4 text-slate-700">{p.vacancies}</td>
                    <td className="p-4 font-mono text-amber-600 font-semibold">{p.closing_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "postings" | "walkin" | "analytics";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "postings",   label: "Job Postings" },
  { key: "walkin",     label: "Walk-in Queue" },
  { key: "analytics",  label: "Vacancy Analytics" },
];

export default function NativeJobsPortal() {
  const [activeTab, setActiveTab] = useState<Tab>("postings");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Talent Acquisition</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Jobs Portal</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Manage job postings, walk-in candidate queue, and vacancy analytics in one place.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
          {TABS.map((t) => (
            <TabButton
              key={t.key}
              label={t.label}
              active={activeTab === t.key}
              onClick={() => setActiveTab(t.key)}
            />
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "postings"   && <JobPostingsTab />}
        {activeTab === "walkin"     && <WalkinQueueTab />}
        {activeTab === "analytics"  && <VacancyAnalyticsTab />}
      </div>
    </DashboardLayout>
  );
}
