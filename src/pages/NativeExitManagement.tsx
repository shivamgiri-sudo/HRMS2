import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Clock,
  ClipboardList,
  FileText,
  Loader,
  MoreVertical,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

type ExitRequest = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  branch_name?: string | null;
  process_name?: string | null;
  department_name?: string | null;
  reporting_manager_name?: string | null;
  exit_type: string;
  exit_sub_type: string;
  exit_reason_category?: string | null;
  resignation_reason?: string | null;
  last_working_day_proposed?: string | null;
  last_working_day_confirmed?: string | null;
  notice_period_days?: number | null;
  status: string;
  initiated_by: string;
  created_at: string;
  clearance_total?: number;
  clearance_cleared?: number;
  risk_label?: string | null;
  regrettable_exit?: number | boolean | null;
  submitted_by?: string | null;
  submitted_at?: string | null;
  notification_sent?: number | null;
  notification_recipient?: string | null;
  pending_with?: string | null;
  escalation_status?: string | null;
};

type ClearanceTask = {
  id: string;
  clearance_area: string;
  task_title: string;
  owner_role: string;
  due_date?: string | null;
  status: string;
  remarks?: string | null;
  cleared_by?: string | null;
  cleared_at?: string | null;
};

type Stats = { total: number; pending: number; accepted: number; completed: number; active_notice?: number };

type EmpResult = {
  id: string;
  employee_code: string;
  name: string;
  branch_name?: string;
  process_name?: string;
  department_name?: string;
  reporting_manager_name?: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-blue-50 text-blue-700",
  manager_review: "bg-amber-50 text-amber-700",
  hr_review: "bg-violet-50 text-violet-700",
  admin_review: "bg-orange-50 text-orange-700",
  accepted: "bg-emerald-50 text-emerald-700",
  notice_serving: "bg-cyan-50 text-cyan-700",
  exited: "bg-green-100 text-green-800",
  exit_confirmed: "bg-green-100 text-green-800",
  revoked: "bg-rose-50 text-rose-700",
  rejected: "bg-red-50 text-red-700",
};

// Full BPO-complete reason list (matches 011_exit_management.sql documentation)
const REASON_CATEGORIES: Array<{ code: string; label: string }> = [
  { code: "better_opportunity",        label: "Better Opportunity" },
  { code: "career_growth",             label: "Career Growth" },
  { code: "compensation",              label: "Compensation Dissatisfaction" },
  { code: "relocation",                label: "Relocation" },
  { code: "health_personal",           label: "Health / Personal Reasons" },
  { code: "family_reasons",            label: "Family Reasons" },
  { code: "higher_education",          label: "Higher Education" },
  { code: "work_environment",          label: "Work Environment" },
  { code: "dissatisfaction_management","label": "Management Dissatisfaction" },
  { code: "entrepreneurship",          label: "Entrepreneurship" },
  { code: "performance_action",        label: "Performance Action (Involuntary)" },
  { code: "termination_misconduct",    label: "Termination — Misconduct" },
  { code: "absconding",                label: "Absconding" },
  { code: "contract_end",              label: "Contract End" },
  { code: "other",                     label: "Other" },
];

const INVOLUNTARY_NEEDS_ADMIN = ["termination", "absconding"];

function normalizeStatus(status: string) {
  return status === "exit_confirmed" ? "exited" : status;
}

function label(value?: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}

function reasonLabel(code?: string | null) {
  if (!code) return "—";
  return REASON_CATEGORIES.find((r) => r.code === code)?.label ?? label(code);
}

function Badge({ status }: { status: string }) {
  const normalized = normalizeStatus(status);
  const cls = STATUS_COLORS[normalized] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {label(normalized)}
    </span>
  );
}

function RiskBadge({ request }: { request: ExitRequest }) {
  const risk = String(request.risk_label ?? "").toLowerCase();
  const regrettable = request.regrettable_exit === 1 || request.regrettable_exit === true;
  if (!risk && !regrettable) return <span className="text-xs text-slate-400">—</span>;
  const tone =
    risk.includes("high") || regrettable
      ? "bg-red-50 text-red-700"
      : risk.includes("medium")
      ? "bg-amber-50 text-amber-700"
      : "bg-slate-100 text-slate-700";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${tone}`}>
      {regrettable ? "Regrettable" : label(risk)}
    </span>
  );
}

function StatCard({ title, value, icon, tone }: { title: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className="glass-card stat-card rounded-3xl p-5">
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

function ClearanceProgress({ request }: { request: ExitRequest }) {
  const total = Number(request.clearance_total ?? 0);
  const cleared = Number(request.clearance_cleared ?? 0);
  if (!total) return <span className="text-xs text-slate-400">Not generated</span>;
  const pct = Math.round((cleared / total) * 100);
  return (
    <div className="min-w-[130px]">
      <div className="mb-1 flex justify-between text-xs font-bold text-slate-600">
        <span>{cleared}/{total}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ageDays(date?: string) {
  if (!date) return 0;
  const start = new Date(date).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function NativeExitManagement() {
  useWorkforceAccess();
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, accepted: 0, completed: 0, active_notice: 0 });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  // — Employee picker —
  const [empQuery, setEmpQuery] = useState("");
  const [empResults, setEmpResults] = useState<EmpResult[]>([]);
  const [empSearching, setEmpSearching] = useState(false);
  const [empInactiveCount, setEmpInactiveCount] = useState(0);

  // — New exit form —
  const [form, setForm] = useState({
    employeeId: "",
    employeeLabel: "",
    employeeBranch: "",
    employeeProcess: "",
    employeeDept: "",
    employeeRm: "",
    exitType: "voluntary",
    exitSubType: "resignation",
    exitReasonCategory: "career_growth",
    resignationReason: "",
    lastWorkingDayProposed: "",
    abscondingSince: "",
  });

  // — Review modal (confirm LWD + notice period) —
  const [reviewModal, setReviewModal] = useState<{
    open: boolean;
    exitId: string;
    targetStatus: string;
    confirmedLwd: string;
    noticeDays: string;
    remarks: string;
  }>({ open: false, exitId: "", targetStatus: "", confirmedLwd: "", noticeDays: "30", remarks: "" });

  // — Clearance drawer —
  const [clearanceDrawer, setClearanceDrawer] = useState<{
    open: boolean;
    exitId: string;
    tasks: ClearanceTask[];
    loading: boolean;
  }>({ open: false, exitId: "", tasks: [], loading: false });
  const [clearanceUpdateLoading, setClearanceUpdateLoading] = useState<string | null>(null);

  // — Actions kebab —
  const [openKebab, setOpenKebab] = useState<string | null>(null);

  // — Exit interview modal —
  const [interviewModal, setInterviewModal] = useState<{
    open: boolean; exitId: string;
    primary_reason: string; secondary_reason: string;
    manager_score: string; process_score: string; salary_score: string; work_life_score: string;
    would_rejoin: boolean; rehire_eligible: boolean; comments: string;
    saving: boolean;
  }>({ open: false, exitId: "", primary_reason: "", secondary_reason: "", manager_score: "3", process_score: "3", salary_score: "3", work_life_score: "3", would_rejoin: false, rehire_eligible: false, comments: "", saving: false });

  // — Retention action modal —
  const [retentionModal, setRetentionModal] = useState<{
    open: boolean; exitId: string;
    action_type: string; action_summary: string; outcome: string;
    saving: boolean;
  }>({ open: false, exitId: "", action_type: "counter_offer", action_summary: "", outcome: "pending", saving: false });

  // — Health snapshot modal —
  const [healthModal, setHealthModal] = useState<{
    open: boolean; exitId: string;
    data: Record<string, unknown> | null; loading: boolean;
  }>({ open: false, exitId: "", data: null, loading: false });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ limit: "100", page: "1" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      const [listRes, statsRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: ExitRequest[]; total: number }>(`/api/exit?${params}`),
        hrmsApi.get<{ success: boolean; data: Stats }>("/api/exit/stats"),
      ]);
      setRequests(listRes.data ?? []);
      setStats(statsRes.data ?? { total: 0, pending: 0, accepted: 0, completed: 0, active_notice: 0 });
    } catch (err: unknown) {
      setMessage((err as Error)?.message || "Unable to load exit requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  // Employee search
  useEffect(() => {
    const q = empQuery.trim();
    if (q.length < 2) { setEmpResults([]); setEmpInactiveCount(0); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setEmpSearching(true);
      try {
        const [res, inactive] = await Promise.all([
          hrmsApi.get<{ data: Array<Record<string, unknown>> }>(
            `/api/employees?recordStatus=active&limit=10&search=${encodeURIComponent(q)}`,
          ),
          hrmsApi.get<{ total?: number }>(
            `/api/employees?recordStatus=inactive&limit=1&search=${encodeURIComponent(q)}`,
          ).catch(() => ({ total: 0 })),
        ]);
        if (cancelled) return;
        setEmpResults(
          (res?.data ?? []).map((e) => ({
            id: String(e.id ?? ""),
            employee_code: String(e.employee_code ?? ""),
            name: [e.first_name, e.last_name].filter(Boolean).join(" ") || String(e.full_name ?? ""),
            branch_name: String(e.branch_name ?? ""),
            process_name: String(e.process_name ?? ""),
            department_name: String(e.department_name ?? ""),
            reporting_manager_name: String(e.reporting_manager_name ?? ""),
          })).filter((e) => e.id),
        );
        setEmpInactiveCount(Number(inactive?.total ?? 0));
      } catch {
        if (!cancelled) { setEmpResults([]); setEmpInactiveCount(0); }
      } finally {
        if (!cancelled) setEmpSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [empQuery]);

  // Auto-fill proposed LWD when absconding since changes
  useEffect(() => {
    if (form.exitSubType === "absconding" && form.abscondingSince) {
      setForm((f) => ({ ...f, lastWorkingDayProposed: addDays(f.abscondingSince, 7) }));
    }
  }, [form.abscondingSince, form.exitSubType]);

  const submitRequest = async () => {
    if (!form.employeeId.trim()) return setMessage("Select an employee first.");
    if (!form.lastWorkingDayProposed) return setMessage("Proposed last working day is required.");
    if (form.exitSubType === "absconding" && !form.abscondingSince) return setMessage("Absconding Since date is required.");
    try {
      await hrmsApi.post("/api/exit", {
        employeeId: form.employeeId.trim(),
        exitType: form.exitType,
        exitSubType: form.exitSubType,
        exitReasonCategory: form.exitReasonCategory,
        resignationReason: form.resignationReason || null,
        lastWorkingDayProposed: form.lastWorkingDayProposed,
      });
      setShowModal(false);
      setEmpQuery(""); setEmpResults([]);
      setForm({ employeeId: "", employeeLabel: "", employeeBranch: "", employeeProcess: "", employeeDept: "", employeeRm: "", exitType: "voluntary", exitSubType: "resignation", exitReasonCategory: "career_growth", resignationReason: "", lastWorkingDayProposed: "", abscondingSince: "" });
      setMessage("Exit request submitted.");
      await load();
    } catch (err: unknown) { setMessage((err as Error)?.message || "Submission failed."); }
  };

  const updateStatus = async (id: string, status: string, extras?: { remarks?: string; confirmedLwd?: string; noticeDays?: string }) => {
    setUpdating(id);
    try {
      await hrmsApi.patch(`/api/exit/${id}/status`, {
        status,
        remarks: extras?.remarks ?? `Status changed to ${status}`,
        ...(extras?.confirmedLwd ? { lastWorkingDayConfirmed: extras.confirmedLwd } : {}),
        ...(extras?.noticeDays ? { noticePeriodDays: Number(extras.noticeDays) } : {}),
      });
      setMessage(`Updated to ${label(status)}.`);
      await load();
    } catch (err: unknown) { setMessage((err as Error)?.message || "Update failed."); }
    finally { setUpdating(null); }
  };

  const openReviewModal = (exitId: string, targetStatus: string, proposed?: string) => {
    setReviewModal({
      open: true, exitId, targetStatus,
      confirmedLwd: proposed ?? "",
      noticeDays: "30", remarks: "",
    });
  };

  const confirmReview = async () => {
    await updateStatus(reviewModal.exitId, reviewModal.targetStatus, {
      remarks: reviewModal.remarks || `Status changed to ${reviewModal.targetStatus}`,
      confirmedLwd: reviewModal.confirmedLwd || undefined,
      noticeDays: reviewModal.noticeDays || undefined,
    });
    setReviewModal((m) => ({ ...m, open: false }));
  };

  // — Clearance —
  const openClearanceDrawer = async (exitId: string) => {
    setClearanceDrawer({ open: true, exitId, tasks: [], loading: true });
    try {
      const res = await hrmsApi.get<{ data: ClearanceTask[] }>(`/api/exit/${exitId}/clearance`);
      setClearanceDrawer((d) => ({ ...d, tasks: res.data ?? [], loading: false }));
    } catch {
      setClearanceDrawer((d) => ({ ...d, loading: false }));
    }
  };

  const generateClearance = async () => {
    try {
      await hrmsApi.post(`/api/exit/${clearanceDrawer.exitId}/clearance/generate`, {});
      await openClearanceDrawer(clearanceDrawer.exitId);
    } catch (err: unknown) { setMessage((err as Error)?.message || "Failed to generate checklist."); }
  };

  const updateClearanceTask = async (taskId: string, status: string, remarks: string) => {
    setClearanceUpdateLoading(taskId);
    try {
      await hrmsApi.patch(`/api/exit/${clearanceDrawer.exitId}/clearance/${taskId}`, { status, remarks });
      await openClearanceDrawer(clearanceDrawer.exitId);
      await load();
    } catch (err: unknown) { setMessage((err as Error)?.message || "Failed to update task."); }
    finally { setClearanceUpdateLoading(null); }
  };

  // — Exit interview —
  const openInterviewModal = (exitId: string) => {
    setInterviewModal({ open: true, exitId, primary_reason: "", secondary_reason: "", manager_score: "3", process_score: "3", salary_score: "3", work_life_score: "3", would_rejoin: false, rehire_eligible: false, comments: "", saving: false });
    setOpenKebab(null);
  };
  const submitInterview = async () => {
    setInterviewModal((m) => ({ ...m, saving: true }));
    try {
      await hrmsApi.post(`/api/exit/${interviewModal.exitId}/interview`, {
        primaryReason: interviewModal.primary_reason,
        secondaryReason: interviewModal.secondary_reason,
        managerFeedbackScore: Number(interviewModal.manager_score),
        processFeedbackScore: Number(interviewModal.process_score),
        salaryFeedbackScore: Number(interviewModal.salary_score),
        workLifeScore: Number(interviewModal.work_life_score),
        wouldRejoin: interviewModal.would_rejoin,
        rehireEligible: interviewModal.rehire_eligible,
        comments: interviewModal.comments,
      });
      setInterviewModal((m) => ({ ...m, open: false, saving: false }));
      setMessage("Exit interview saved.");
    } catch (err: unknown) {
      setInterviewModal((m) => ({ ...m, saving: false }));
      setMessage((err as Error)?.message || "Failed to save interview.");
    }
  };

  // — Retention —
  const openRetentionModal = (exitId: string) => {
    setRetentionModal({ open: true, exitId, action_type: "counter_offer", action_summary: "", outcome: "pending", saving: false });
    setOpenKebab(null);
  };
  const submitRetention = async () => {
    setRetentionModal((m) => ({ ...m, saving: true }));
    try {
      await hrmsApi.post(`/api/exit/${retentionModal.exitId}/retention`, {
        actionType: retentionModal.action_type,
        actionSummary: retentionModal.action_summary,
        outcome: retentionModal.outcome,
      });
      setRetentionModal((m) => ({ ...m, open: false, saving: false }));
      setMessage("Retention action recorded.");
    } catch (err: unknown) {
      setRetentionModal((m) => ({ ...m, saving: false }));
      setMessage((err as Error)?.message || "Failed to record retention action.");
    }
  };

  // — Health snapshot —
  const openHealthModal = async (exitId: string) => {
    setHealthModal({ open: true, exitId, data: null, loading: true });
    setOpenKebab(null);
    try {
      const res = await hrmsApi.get<{ data: Record<string, unknown> }>(`/api/exit/${exitId}/health`);
      setHealthModal((m) => ({ ...m, data: res.data ?? null, loading: false }));
    } catch {
      setHealthModal((m) => ({ ...m, loading: false }));
    }
  };

  const STATUSES = ["all", "submitted", "manager_review", "hr_review", "admin_review", "accepted", "notice_serving", "exited", "revoked", "rejected"];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      const text = [r.employee_id, r.employee_name, r.employee_code, r.exit_type, r.exit_sub_type, r.status, r.exit_reason_category, r.branch_name, r.process_name].join(" ").toLowerCase();
      return !q || text.includes(q);
    });
  }, [requests, search]);

  const agedCount = filtered.filter((r) => !["exited", "rejected", "revoked"].includes(normalizeStatus(r.status)) && ageDays(r.created_at) > 7).length;
  const clearanceBlocked = filtered.filter((r) => normalizeStatus(r.status) === "notice_serving" && Number(r.clearance_total ?? 0) > Number(r.clearance_cleared ?? 0)).length;

  // Helper: does this exit need admin approval before acceptance?
  const needsAdminReview = (r: ExitRequest) =>
    r.exit_type === "involuntary" && INVOLUNTARY_NEEDS_ADMIN.includes(r.exit_sub_type);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Operations</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Exit Management</h1>
            <p className="mt-2 max-w-4xl text-slate-600">Manage resignations, retention review, notice serving, clearance and exit confirmation.</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
              <RefreshCcw className="h-4 w-4" />Refresh
            </button>
            <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
              <Plus className="h-4 w-4" />New Exit Request
            </button>
          </div>
        </div>

        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />{message}
            <button onClick={() => setMessage("")} className="ml-auto text-blue-400 hover:text-blue-700"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Total Exits" value={stats.total} icon={<UserMinus className="h-5 w-5" />} tone="bg-slate-100 text-slate-700" />
          <StatCard title="Pending Review" value={stats.pending} icon={<Clock className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
          <StatCard title="Clearance Blocked" value={clearanceBlocked} icon={<ShieldCheck className="h-5 w-5" />} tone="bg-red-50 text-red-700" />
          <StatCard title="Aged > 7 Days" value={agedCount} icon={<FileText className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
        </div>

        {/* Filters */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search employee, branch, process, reason…" className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400" />
            </div>
            <button onClick={() => load()} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white">Search</button>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize ${statusFilter === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {label(s)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Exit Requests</h2>
            <p className="text-sm text-slate-500">{filtered.length} records</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400"><UserMinus className="mx-auto mb-3 h-10 w-10 opacity-30" /><p className="font-semibold">No exit requests found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1600px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>{["Employee", "Submitted By", "Type", "Reason", "Proposed LWD", "Aging", "Pending With", "Clearance", "Escalation", "Risk", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const status = normalizeStatus(r.status);
                    const isInvoluntaryAdmin = needsAdminReview(r);
                    return (
                      <tr key={r.id} className="border-t hover:bg-slate-50/80">
                        {/* Employee cell — name, code, branch, process */}
                        <td className="p-4">
                          <div className="font-bold text-slate-950">{r.employee_name ?? r.employee_id}</div>
                          <div className="text-xs font-mono text-slate-500">{r.employee_code ?? r.employee_id.slice(0, 8)}</div>
                          {(r.branch_name || r.process_name) && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                              {r.branch_name && <span className="flex items-center gap-0.5"><Building2 className="h-3 w-3" />{r.branch_name}</span>}
                              {r.process_name && <span className="flex items-center gap-0.5"><Users className="h-3 w-3" />{r.process_name}</span>}
                            </div>
                          )}
                          {(r.department_name || r.reporting_manager_name) && (
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                              {r.department_name && <span>{r.department_name}</span>}
                              {r.reporting_manager_name && <span className="text-slate-300">·</span>}
                              {r.reporting_manager_name && <span>RM: {r.reporting_manager_name}</span>}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-xs text-slate-600">
                          <div>{r.submitted_by ?? r.initiated_by ?? "—"}</div>
                          {r.submitted_at && <div className="text-slate-400">{formatISTDate(r.submitted_at)}</div>}
                          {r.notification_sent ? (
                            <span className="mt-0.5 inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">Notified</span>
                          ) : (
                            <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">Not sent</span>
                          )}
                        </td>
                        <td className="p-4 capitalize text-slate-700">
                          <div>{label(r.exit_type)}</div>
                          <div className="text-xs text-slate-500">{label(r.exit_sub_type)}</div>
                          {isInvoluntaryAdmin && <span className="mt-1 inline-block rounded bg-orange-50 px-1.5 py-0.5 text-xs text-orange-700 font-semibold">Admin required</span>}
                        </td>
                        <td className="p-4 text-slate-600">
                          <div className="capitalize font-semibold">{reasonLabel(r.exit_reason_category)}</div>
                          <div className="max-w-[220px] truncate text-xs text-slate-500">{r.resignation_reason ?? "—"}</div>
                        </td>
                        <td className="p-4 font-mono text-slate-600">
                          <div>{r.last_working_day_proposed ?? "–"}</div>
                          {r.last_working_day_confirmed && (
                            <div className="text-xs text-emerald-700 font-semibold">✓ {r.last_working_day_confirmed}</div>
                          )}
                        </td>
                        <td className="p-4">
                          <span className={ageDays(r.created_at) > 7 && !["exited", "rejected", "revoked"].includes(status) ? "font-black text-red-700" : "font-bold text-slate-600"}>
                            {ageDays(r.created_at)}d
                          </span>
                        </td>
                        <td className="p-4 text-xs text-slate-600">
                          {r.pending_with ? (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 font-semibold border border-amber-200">{r.pending_with}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <ClearanceProgress request={r} />
                            <button
                              onClick={() => openClearanceDrawer(r.id)}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                              title="Manage clearance tasks"
                            >
                              <ClipboardList className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="p-4">
                          {r.escalation_status === "overdue" ? (
                            <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700 border border-red-200">Overdue</span>
                          ) : r.escalation_status === "closed" ? (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">Closed</span>
                          ) : (
                            <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">On Track</span>
                          )}
                        </td>
                        <td className="p-4"><RiskBadge request={r} /></td>
                        <td className="p-4"><Badge status={status} /></td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1 items-center">
                            {/* Governance-aware action buttons */}
                            {status === "submitted" && (
                              <button onClick={() => openReviewModal(r.id, "manager_review", r.last_working_day_proposed ?? "")} disabled={updating === r.id} className="rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">Review</button>
                            )}
                            {status === "manager_review" && (
                              <button onClick={() => updateStatus(r.id, "hr_review")} disabled={updating === r.id} className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50">HR Review</button>
                            )}
                            {status === "hr_review" && (
                              isInvoluntaryAdmin ? (
                                <button onClick={() => updateStatus(r.id, "admin_review", { remarks: "Sent for admin approval (involuntary exit)" })} disabled={updating === r.id} className="rounded-lg bg-orange-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-50">Admin Review</button>
                              ) : (
                                <button onClick={() => openReviewModal(r.id, "accepted", r.last_working_day_proposed ?? "")} disabled={updating === r.id} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">Accept</button>
                              )
                            )}
                            {status === "admin_review" && (
                              <button onClick={() => openReviewModal(r.id, "accepted", r.last_working_day_proposed ?? "")} disabled={updating === r.id} className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50">Approve</button>
                            )}
                            {status === "accepted" && (
                              <button onClick={() => updateStatus(r.id, "notice_serving")} disabled={updating === r.id} className="rounded-lg bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-cyan-700 disabled:opacity-50">Notice</button>
                            )}
                            {status === "notice_serving" && (
                              <button onClick={() => updateStatus(r.id, "exited")} disabled={updating === r.id || Number(r.clearance_total ?? 0) > Number(r.clearance_cleared ?? 0)} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-40">Confirm Exit</button>
                            )}
                            {!["exited", "revoked", "rejected"].includes(status) && (
                              <button onClick={() => updateStatus(r.id, "revoked")} disabled={updating === r.id} className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">Revoke</button>
                            )}

                            {/* Kebab menu */}
                            <div className="relative">
                              <button onClick={() => setOpenKebab(openKebab === r.id ? null : r.id)} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>
                              {openKebab === r.id && (
                                <div className="absolute right-0 top-8 z-30 w-48 rounded-2xl border bg-white shadow-xl">
                                  <button onClick={() => openInterviewModal(r.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-t-2xl">
                                    <FileText className="h-4 w-4 text-slate-400" />Exit Interview
                                  </button>
                                  <button onClick={() => openRetentionModal(r.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                                    <ShieldCheck className="h-4 w-4 text-slate-400" />Retention Action
                                  </button>
                                  <button onClick={() => openHealthModal(r.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-b-2xl">
                                    <CheckCircle2 className="h-4 w-4 text-slate-400" />Health Snapshot
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Click-away for kebab */}
      {openKebab && <div className="fixed inset-0 z-20" onClick={() => setOpenKebab(null)} />}

      {/* ── New Exit Request Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">New Exit Request</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              {/* Employee picker with context */}
              <div className="relative">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Employee</label>
                {form.employeeId ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{form.employeeLabel}</span>
                      <button type="button" onClick={() => setForm({ ...form, employeeId: "", employeeLabel: "", employeeBranch: "", employeeProcess: "", employeeDept: "", employeeRm: "" })} className="text-xs font-semibold text-blue-700 hover:underline">Change</button>
                    </div>
                    {(form.employeeBranch || form.employeeProcess || form.employeeDept || form.employeeRm) && (
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                        {form.employeeBranch && <span><span className="text-slate-400">Branch:</span> {form.employeeBranch}</span>}
                        {form.employeeProcess && <span><span className="text-slate-400">Process:</span> {form.employeeProcess}</span>}
                        {form.employeeDept && <span><span className="text-slate-400">Dept:</span> {form.employeeDept}</span>}
                        {form.employeeRm && <span><span className="text-slate-400">RM:</span> {form.employeeRm}</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <input value={empQuery} onChange={(e) => setEmpQuery(e.target.value)} placeholder="Search by name or employee code" className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400" autoComplete="off" />
                    {empQuery.trim().length >= 2 && (
                      <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-2xl border bg-white shadow-lg">
                        {empSearching && <div className="px-4 py-3 text-sm text-slate-500">Searching…</div>}
                        {!empSearching && empResults.length === 0 && (
                          <div className="px-4 py-3 text-sm text-slate-500">No active employee matches "{empQuery.trim()}".</div>
                        )}
                        {!empSearching && empInactiveCount > 0 && (
                          <div className="border-t bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900">
                            {empInactiveCount} inactive employee{empInactiveCount === 1 ? "" : "s"} also match "{empQuery.trim()}". Exits can only be raised for active employees.
                          </div>
                        )}
                        {empResults.map((emp) => (
                          <button key={emp.id} type="button" onClick={() => {
                            setForm({
                              ...form,
                              employeeId: emp.id,
                              employeeLabel: `${emp.employee_code} — ${emp.name}`,
                              employeeBranch: emp.branch_name ?? "",
                              employeeProcess: emp.process_name ?? "",
                              employeeDept: emp.department_name ?? "",
                              employeeRm: emp.reporting_manager_name ?? "",
                            });
                            setEmpResults([]);
                          }} className="flex w-full flex-col px-4 py-3 text-left hover:bg-slate-50 border-b last:border-b-0">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-900">{emp.name}</span>
                              <span className="font-mono text-xs text-slate-500">{emp.employee_code}</span>
                            </div>
                            <div className="mt-0.5 flex gap-3 text-xs text-slate-400">
                              {emp.branch_name && <span>{emp.branch_name}</span>}
                              {emp.process_name && <span>· {emp.process_name}</span>}
                              {emp.reporting_manager_name && <span>· RM: {emp.reporting_manager_name}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Exit type + subtype */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Exit Type</label>
                  <select value={form.exitType} onChange={(e) => setForm({ ...form, exitType: e.target.value, exitSubType: e.target.value === "voluntary" ? "resignation" : "termination" })} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400">
                    <option value="voluntary">Voluntary</option>
                    <option value="involuntary">Involuntary</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Sub-type</label>
                  <select value={form.exitSubType} onChange={(e) => setForm({ ...form, exitSubType: e.target.value })} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400">
                    {form.exitType === "voluntary" ? (
                      <>
                        <option value="resignation">Resignation</option>
                        <option value="retirement">Retirement</option>
                        <option value="mutual_separation">Mutual Separation</option>
                      </>
                    ) : (
                      <>
                        <option value="termination">Termination</option>
                        <option value="absconding">Absconding</option>
                        <option value="contract_end">Contract End</option>
                        <option value="abandonment">Abandonment</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* Admin-review notice for involuntary exits */}
              {form.exitType === "involuntary" && INVOLUNTARY_NEEDS_ADMIN.includes(form.exitSubType) && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-xs text-orange-800 font-semibold">
                  This exit type requires Admin approval before acceptance.
                </div>
              )}

              {/* Absconding since date */}
              {form.exitSubType === "absconding" && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Absconding Since <span className="text-red-500">*</span></label>
                  <input type="date" value={form.abscondingSince} onChange={(e) => setForm({ ...form, abscondingSince: e.target.value })} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400" />
                  {form.abscondingSince && (
                    <p className="mt-1 text-xs text-slate-500">Grace period ends: <strong>{addDays(form.abscondingSince, 7)}</strong> (7 calendar days)</p>
                  )}
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Reason Category</label>
                <select value={form.exitReasonCategory} onChange={(e) => setForm({ ...form, exitReasonCategory: e.target.value })} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400">
                  {REASON_CATEGORIES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Proposed Last Working Day</label>
                <input type="date" value={form.lastWorkingDayProposed} onChange={(e) => setForm({ ...form, lastWorkingDayProposed: e.target.value })} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Reason</label>
                <textarea value={form.resignationReason} onChange={(e) => setForm({ ...form, resignationReason: e.target.value })} placeholder="Brief reason for exit…" rows={3} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowModal(false)} className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={submitRequest} className="flex-1 rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800">Submit Request</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Review Modal (Confirmed LWD + Notice Period) ── */}
      {reviewModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Confirm &amp; Advance</h2>
              <button onClick={() => setReviewModal((m) => ({ ...m, open: false }))} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-sm text-slate-600">Status will move to <span className="font-bold capitalize">{label(reviewModal.targetStatus)}</span>.</p>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Confirm Last Working Day</label>
                <input type="date" value={reviewModal.confirmedLwd} onChange={(e) => setReviewModal((m) => ({ ...m, confirmedLwd: e.target.value }))} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Notice Period (days)</label>
                <input type="number" min={0} max={180} value={reviewModal.noticeDays} onChange={(e) => setReviewModal((m) => ({ ...m, noticeDays: e.target.value }))} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Remarks</label>
                <textarea value={reviewModal.remarks} onChange={(e) => setReviewModal((m) => ({ ...m, remarks: e.target.value }))} placeholder="Optional remarks…" rows={2} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setReviewModal((m) => ({ ...m, open: false }))} className="flex-1 rounded-2xl border py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={confirmReview} disabled={updating !== null} className="flex-1 rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {updating ? "Updating…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Clearance Task Drawer ── */}
      {clearanceDrawer.open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-slate-950/40" onClick={() => setClearanceDrawer((d) => ({ ...d, open: false }))} />
          <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b p-5">
              <h2 className="font-black text-slate-950">Clearance Tasks</h2>
              <button onClick={() => setClearanceDrawer((d) => ({ ...d, open: false }))} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {clearanceDrawer.loading ? (
                <div className="flex justify-center py-12"><Loader className="h-6 w-6 animate-spin text-slate-400" /></div>
              ) : clearanceDrawer.tasks.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <ClipboardList className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold mb-4">No clearance tasks yet.</p>
                  <button onClick={generateClearance} className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">Generate Default Checklist</button>
                </div>
              ) : (
                clearanceDrawer.tasks.map((task) => {
                  const isDone = ["cleared", "waived"].includes(task.status);
                  return (
                    <div key={task.id} className={`rounded-2xl border p-4 ${isDone ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900 text-sm">{task.task_title}</div>
                          <div className="mt-0.5 flex gap-2 text-xs text-slate-500">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5">{task.clearance_area}</span>
                            <span>{task.owner_role}</span>
                            {task.due_date && <span>Due: {task.due_date}</span>}
                          </div>
                          {task.remarks && <div className="mt-1 text-xs text-slate-500 italic">{task.remarks}</div>}
                        </div>
                        {!isDone ? (
                          <button
                            onClick={() => updateClearanceTask(task.id, "cleared", "")}
                            disabled={clearanceUpdateLoading === task.id}
                            className="shrink-0 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {clearanceUpdateLoading === task.id ? "…" : "Clear"}
                          </button>
                        ) : (
                          <span className="shrink-0 rounded-xl bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700">
                            {task.status === "waived" ? "Waived" : "Cleared"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {clearanceDrawer.tasks.length > 0 && (
              <div className="border-t p-4">
                <button onClick={generateClearance} className="w-full rounded-2xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Regenerate Default Tasks
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Exit Interview Modal ── */}
      {interviewModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Exit Interview</h2>
              <button onClick={() => setInterviewModal((m) => ({ ...m, open: false }))} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Primary Reason</label>
                  <select value={interviewModal.primary_reason} onChange={(e) => setInterviewModal((m) => ({ ...m, primary_reason: e.target.value }))} className="w-full rounded-2xl border bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400">
                    <option value="">Select…</option>
                    {REASON_CATEGORIES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Secondary Reason</label>
                  <select value={interviewModal.secondary_reason} onChange={(e) => setInterviewModal((m) => ({ ...m, secondary_reason: e.target.value }))} className="w-full rounded-2xl border bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400">
                    <option value="">None</option>
                    {REASON_CATEGORIES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              {(["manager_score", "process_score", "salary_score", "work_life_score"] as const).map((key) => {
                const labels: Record<string, string> = { manager_score: "Manager Feedback (1–5)", process_score: "Process Feedback (1–5)", salary_score: "Salary Satisfaction (1–5)", work_life_score: "Work-Life Balance (1–5)" };
                return (
                  <div key={key}>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">{labels[key]}</label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((v) => (
                        <button key={v} type="button" onClick={() => setInterviewModal((m) => ({ ...m, [key]: String(v) }))} className={`flex-1 rounded-xl border py-2 text-sm font-bold ${interviewModal[key] === String(v) ? "bg-slate-950 text-white border-slate-950" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{v}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={interviewModal.would_rejoin} onChange={(e) => setInterviewModal((m) => ({ ...m, would_rejoin: e.target.checked }))} className="rounded" />
                  Would Rejoin
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={interviewModal.rehire_eligible} onChange={(e) => setInterviewModal((m) => ({ ...m, rehire_eligible: e.target.checked }))} className="rounded" />
                  Rehire Eligible
                </label>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Comments</label>
                <textarea value={interviewModal.comments} onChange={(e) => setInterviewModal((m) => ({ ...m, comments: e.target.value }))} placeholder="Additional observations…" rows={3} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setInterviewModal((m) => ({ ...m, open: false }))} className="flex-1 rounded-2xl border py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={submitInterview} disabled={interviewModal.saving} className="flex-1 rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {interviewModal.saving ? "Saving…" : "Save Interview"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Retention Action Modal ── */}
      {retentionModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Retention Action</h2>
              <button onClick={() => setRetentionModal((m) => ({ ...m, open: false }))} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Action Type</label>
                <select value={retentionModal.action_type} onChange={(e) => setRetentionModal((m) => ({ ...m, action_type: e.target.value }))} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm outline-none focus:border-blue-400">
                  <option value="counter_offer">Counter Offer</option>
                  <option value="role_change">Role Change</option>
                  <option value="manager_change">Manager Change</option>
                  <option value="counselling">Counselling</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Action Summary</label>
                <textarea value={retentionModal.action_summary} onChange={(e) => setRetentionModal((m) => ({ ...m, action_summary: e.target.value }))} placeholder="Describe the retention action taken…" rows={3} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Outcome</label>
                <select value={retentionModal.outcome} onChange={(e) => setRetentionModal((m) => ({ ...m, outcome: e.target.value }))} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm outline-none focus:border-blue-400">
                  <option value="pending">Pending</option>
                  <option value="accepted">Accepted (Employee stays)</option>
                  <option value="declined">Declined (Exit proceeds)</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setRetentionModal((m) => ({ ...m, open: false }))} className="flex-1 rounded-2xl border py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={submitRetention} disabled={retentionModal.saving || !retentionModal.action_summary.trim()} className="flex-1 rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {retentionModal.saving ? "Saving…" : "Record Action"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Health Snapshot Modal ── */}
      {healthModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Employee Health Snapshot</h2>
              <button onClick={() => setHealthModal((m) => ({ ...m, open: false }))} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6">
              {healthModal.loading ? (
                <div className="flex justify-center py-8"><Loader className="h-6 w-6 animate-spin text-slate-400" /></div>
              ) : !healthModal.data ? (
                <div className="py-8 text-center text-slate-400">No health data recorded yet.</div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: "engagement_score", label: "Engagement Score" },
                    { key: "performance_score", label: "Performance Score" },
                    { key: "attendance_score", label: "Attendance Score" },
                    { key: "pulse_avg_90d", label: "Pulse (90d avg)" },
                    { key: "kudos_received_90d", label: "Kudos (90d)" },
                    { key: "risk_label", label: "Risk Level" },
                  ].map(({ key, label: lbl }) => (
                    <div key={key} className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs font-semibold text-slate-500">{lbl}</div>
                      <div className="mt-1 text-lg font-black text-slate-900">{String(healthModal.data![key] ?? "—")}</div>
                    </div>
                  ))}
                  <div className="col-span-2 rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-500">Regrettable Exit</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{healthModal.data!.regrettable_exit ? "Yes" : "No"}</div>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t p-5">
              <button onClick={() => setHealthModal((m) => ({ ...m, open: false }))} className="w-full rounded-2xl border py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}