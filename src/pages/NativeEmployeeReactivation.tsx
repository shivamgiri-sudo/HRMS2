import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  RefreshCcw, UserCheck, Clock, CheckCircle2,
  AlertTriangle, Eye, ChevronRight, Plus, Search,
  Users, Calendar, Building2, ShieldAlert,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { ReactivationInsights } from "@/components/employees/ReactivationInsights";
import { RaiseRejoinDialog } from "@/components/employees/rejoin/RaiseRejoinDialog";
import { canDecideRejoin, canRaiseRejoin, reviewLinkFor } from "@/components/employees/rejoin/rejoinActions";
import { isAwaitingBranchHead } from "@/components/employees/rejoin/rejoinDecisionRules";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReactivationRequest = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  old_employment_status: string;
  proposed_joining_date: string;
  reinstatement_reason: string;
  gap_days: number;
  same_cost_centre: number;
  ff_already_paid: number;
  status: "pending" | "branch_head_approved" | "approved" | "rejected" | "cancelled";
  branch_name?: string;
  cost_centre_name?: string;
  branch_head_remarks?: string;
  branch_head_actioned_at?: string;
  hr_final_remarks?: string;
  hr_final_actioned_at?: string;
  initiated_by_name?: string;
  branch_head_name?: string;
  hr_final_name?: string;
  created_at: string;
  exit_request_id?: string;
};

type AllList = { data: ReactivationRequest[]; total: number; page: number; limit: number };

// ── Status Configuration ──────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending: {
    label: "Pending branch head",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-400",
  },
  // Old two-step rows only: the HR final step was removed, nothing creates this status any more. These
  // are still open: the branch head makes the final decision.
  branch_head_approved: {
    label: "Awaiting final decision (old process)",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    dot: "bg-blue-500",
  },
  approved: {
    label: "Reactivated",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  rejected: {
    label: "Rejected",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-400",
  },
  cancelled: {
    label: "Cancelled",
    bg: "bg-slate-100",
    text: "text-slate-500",
    border: "border-slate-200",
    dot: "bg-slate-400",
  },
} as const;

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? {
    label: status, bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-200", dot: "bg-slate-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtDate(d: string | undefined | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

// ── Aging / SLA logic ─────────────────────────────────────────────────────────

const SLA_DAYS = 3;
const LONG_GAP_DAYS = 90;
const DAY_MS = 86_400_000;

function daysSince(iso?: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

/** Days an open request has been waiting for the branch head (the only approver). */
function waitingDays(r: ReactivationRequest): number {
  return isOpen(r) ? daysSince(r.created_at) : 0;
}

/** Open = waiting for the branch head: 'pending', or a legacy 'branch_head_approved' left by the old flow. */
function isOpen(r: ReactivationRequest): boolean {
  return isAwaitingBranchHead(r.status);
}
const isOverdue = (r: ReactivationRequest) => isOpen(r) && waitingDays(r) >= SLA_DAYS;

function riskFlags(r: ReactivationRequest): { label: string; tone: string }[] {
  const flags: { label: string; tone: string }[] = [];
  if (r.ff_already_paid === 1) flags.push({ label: "F&F already paid", tone: "border-amber-200 bg-amber-50 text-amber-700" });
  if (r.same_cost_centre === 0) flags.push({ label: "Different cost centre", tone: "border-violet-200 bg-violet-50 text-violet-700" });
  if (r.gap_days >= LONG_GAP_DAYS) flags.push({ label: `${r.gap_days}d gap`, tone: "border-rose-200 bg-rose-50 text-rose-700" });
  return flags;
}

// ── Request Card ──────────────────────────────────────────────────────────────

function RequestCard({ request, roleKeys }: { request: ReactivationRequest; roleKeys: readonly string[] }) {
  // Review (branch head, open request) or View (hr / admin / super_admin, or a decided request): both open the
  // dossier page. Roles that cannot open it (payroll_head, manager) get no link.
  const link = reviewLinkFor(request, roleKeys);
  const open = isOpen(request);
  const waited = waitingDays(request);
  const overdue = isOverdue(request);
  const flags = riskFlags(request);
  const stage = open ? 0 : request.status === "approved" ? 2 : -1;

  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-sm transition-all hover:shadow-md ${
        overdue ? "border-rose-200" : "border-slate-200"
      }`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#073f78] text-sm font-black text-white">
            {request.employee_name?.split(" ").map(n => n[0]).slice(0, 2).join("") ?? "?"}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-900">{request.employee_name}</p>
              <span className="font-mono text-xs text-slate-400">{request.employee_code}</span>
              <StatusBadge status={request.status} />
              {open && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    overdue ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                >
                  <Clock className="h-2.5 w-2.5" />
                  {waited === 0 ? "Today" : `${waited}d waiting`}
                  {overdue && " · overdue"}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              {request.branch_name && (
                <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{request.branch_name}</span>
              )}
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Rejoin {fmtDate(request.proposed_joining_date)}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{request.gap_days}d since exit</span>
              <span>Raised {fmtDate(request.created_at)}</span>
            </div>

            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {flags.map(f => (
                  <span key={f.label} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${f.tone}`}>
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {f.label}
                  </span>
                ))}
              </div>
            )}

            <p className="line-clamp-1 text-xs italic text-slate-400">"{request.reinstatement_reason}"</p>
          </div>
        </div>

        {/* 2-step progress: the branch head's approval activates the employee */}
        {stage >= 0 && (
          <div className="flex items-center gap-1.5 lg:w-28" aria-label="Approval progress">
            {["Branch", "Active"].map((label, i) => (
              <div key={label} className="flex-1">
                <div className={`h-1.5 rounded-full ${stage > i ? "bg-emerald-500" : stage === i ? "bg-amber-400" : "bg-slate-200"}`} />
                <p className="mt-1 text-center text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2">
          {link && (
            <Link
              to={link.href}
              className={
                link.label === "Review"
                  ? "flex items-center gap-1.5 rounded-xl bg-[#1B6AB5] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#155a9c]"
                  : "flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
              }
            >
              {link.label === "Review" ? <ChevronRight className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {link.label}
              <span className="sr-only"> rejoin request for {request.employee_name}</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type QueueFilter = "all" | "mine" | "overdue" | "risk";

export default function NativeEmployeeReactivation() {
  // Role keys from /api/access/me (useWorkforceAccess), the same source ProtectedRoute uses.
  const { roleKeys } = useWorkforceAccess();
  const isHR = ["hr", "admin", "super_admin"].some(r => roleKeys.includes(r));
  // Only a branch head decides now (POST /branch-action is branch_head only); HR follows read-only.
  const isBranchHead = canDecideRejoin(roleKeys);
  const isPayrollHead = roleKeys.includes("payroll_head");
  const canSeeAll = isHR || isPayrollHead;
  const canRaise = canRaiseRejoin(roleKeys);

  // A manager can only raise: /pending returns nothing and /all is 403 for them, so they land on the
  // (empty) open queue instead of an error.
  const [tab, setTab] = useState<"pending" | "all">(isHR || isBranchHead || !canSeeAll ? "pending" : "all");
  const [pending, setPending] = useState<ReactivationRequest[]>([]);
  const [all, setAll] = useState<AllList | null>(null);
  const [snapshot, setSnapshot] = useState<ReactivationRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showInitiate, setShowInitiate] = useState(false);
  const [allPage, setAllPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");

  async function fetchPending() {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ReactivationRequest[] }>("/api/employees/reactivation/pending");
      setPending(res.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load pending requests");
    } finally {
      setLoading(false);
    }
  }

  async function fetchAll(page = 1) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter) params.set("status", statusFilter);
      const res: any = await hrmsApi.get(`/api/employees/reactivation/all?${params}`);
      setAll({ data: res.data ?? [], total: res.total ?? 0, page: res.page ?? 1, limit: res.limit ?? 20 });
    } catch (err: any) {
      setError(err?.message ?? "Failed to load reactivations");
    } finally {
      setLoading(false);
    }
  }

  // Unfiltered recent history that feeds the KPIs, independent of the tab/page/filter the list shows.
  async function fetchSnapshot() {
    if (!canSeeAll) return;
    try {
      const res: any = await hrmsApi.get("/api/employees/reactivation/all?page=1&limit=100");
      setSnapshot(res.data ?? []);
    } catch {
      /* KPIs degrade to queue-only numbers; the list surfaces its own error */
    }
  }

  useEffect(() => {
    if (tab === "pending") fetchPending();
    else fetchAll(allPage);
  }, [tab, allPage, statusFilter]);

  useEffect(() => {
    void fetchSnapshot();
  }, [canSeeAll]);

  function refreshAll() {
    if (tab === "pending") fetchPending(); else fetchAll(allPage);
    void fetchSnapshot();
  }

  function handleSuccess() {
    setShowInitiate(false);
    fetchPending();
    if (tab === "all") fetchAll(allPage);
    void fetchSnapshot();
  }

  const needsMyAction = (r: ReactivationRequest) => isOpen(r) && isBranchHead;

  const queue = pending.filter(isOpen);
  const stage1 = queue.length;
  const overdueCount = queue.filter(isOverdue).length;
  const myActionCount = queue.filter(needsMyAction).length;
  const riskCount = queue.filter(r => riskFlags(r).length > 0).length;

  const monthAgo = Date.now() - 30 * DAY_MS;
  // Decided at: the branch head's action now; old two-step rows were finalised by HR.
  const decidedAt = (r: ReactivationRequest) => r.hr_final_actioned_at ?? r.branch_head_actioned_at ?? null;
  const approvedRecent = snapshot.filter(r => r.status === "approved" && new Date(decidedAt(r) ?? r.created_at).getTime() >= monthAgo);
  const rejectedRecent = snapshot.filter(r => r.status === "rejected" && new Date(r.created_at).getTime() >= monthAgo);
  const turnarounds = snapshot
    .filter(r => r.status === "approved" && decidedAt(r))
    .map(r => (new Date(decidedAt(r) as string).getTime() - new Date(r.created_at).getTime()) / DAY_MS)
    .filter(n => Number.isFinite(n) && n >= 0);
  const avgTurnaround = turnarounds.length ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length : null;
  const decided = approvedRecent.length + rejectedRecent.length;
  const approvalRate = decided > 0 ? Math.round((approvedRecent.length / decided) * 100) : null;

  const kpis = [
    { label: "Need your action", value: myActionCount, hint: "Assigned to your role", tone: "text-[#1B6AB5]", ring: myActionCount > 0 ? "ring-2 ring-[#1B6AB5]/30" : "" },
    { label: "Overdue (>" + SLA_DAYS + "d)", value: overdueCount, hint: "Past approval SLA", tone: overdueCount > 0 ? "text-rose-600" : "text-slate-900", ring: overdueCount > 0 ? "ring-2 ring-rose-300" : "" },
    ...(canSeeAll
      ? [
          { label: "Reactivated · 30d", value: approvedRecent.length, hint: approvalRate != null ? `${approvalRate}% approval rate` : "No decisions yet", tone: "text-emerald-600", ring: "" },
          { label: "Avg turnaround", value: avgTurnaround != null ? `${avgTurnaround.toFixed(1)}d` : "—", hint: "Raised → approved", tone: "text-slate-900", ring: "" },
        ]
      : [
          { label: "Open requests", value: queue.length, hint: "Waiting for the branch head", tone: "text-blue-600", ring: "" },
          { label: "Flagged risk", value: riskCount, hint: "F&F / cost centre / long gap", tone: "text-amber-600", ring: "" },
        ]),
  ];

  const term = search.trim().toLowerCase();
  const matchesSearch = (r: ReactivationRequest) =>
    !term || (r.employee_name ?? "").toLowerCase().includes(term) || (r.employee_code ?? "").toLowerCase().includes(term);

  const visibleQueue = queue
    .filter(matchesSearch)
    .filter(r =>
      queueFilter === "mine" ? needsMyAction(r)
      : queueFilter === "overdue" ? isOverdue(r)
      : queueFilter === "risk" ? riskFlags(r).length > 0
      : true)
    // longest-waiting first: that is the order a reviewer should work in
    .sort((a, b) => waitingDays(b) - waitingDays(a));

  const visibleAll = (all?.data ?? []).filter(matchesSearch);

  const queueFilters: { key: QueueFilter; label: string; count: number }[] = [
    { key: "all", label: "All open", count: queue.length },
    { key: "mine", label: "Needs my action", count: myActionCount },
    { key: "overdue", label: "Overdue", count: overdueCount },
    { key: "risk", label: "Flagged", count: riskCount },
  ];

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-6xl space-y-5 pb-12">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-3xl bg-[#073f78] text-white shadow-lg">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#1B6AB5]/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/4 h-48 w-48 rounded-full bg-[#3BAD49]/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 p-6 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-green-200">
                  <UserCheck className="h-3.5 w-3.5" />
                  Employee Lifecycle
                </p>
                <h1 className="mt-2 text-2xl font-black tracking-tight">Employee Reactivation</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  HR or the reporting manager raises a rejoin; the branch head reviews the full record and their approval makes the employee active again. Oldest requests surface first and risky ones are flagged.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={refreshAll}
                  aria-label="Refresh"
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
                {canRaise && (
                  <button
                    onClick={() => setShowInitiate(true)}
                    className="flex cursor-pointer items-center gap-2 rounded-xl bg-[#3BAD49] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#329a3f]"
                  >
                    <Plus className="h-4 w-4" />
                    Initiate Request
                  </button>
                )}
              </div>
            </div>

            {/* Pipeline */}
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { label: "Branch Head review", value: stage1, tone: "text-amber-300" },
                { label: "Reactivated · 30d", value: canSeeAll ? approvedRecent.length : "—", tone: "text-emerald-300" },
              ].map((s, i) => (
                <div key={s.label} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.08] px-4 py-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[11px] font-black">{i + 1}</span>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{s.label}</p>
                    <p className={`text-xl font-black ${s.tone}`}>{s.value}</p>
                  </div>
                  {i < 1 && <ChevronRight className="ml-auto hidden h-4 w-4 text-white/30 sm:block" />}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Action banner */}
        {(isHR || isBranchHead) && (myActionCount > 0 || overdueCount > 0) && (
          <div
            className={`flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-3 text-sm ${
              overdueCount > 0 ? "border-rose-200 bg-rose-50 text-rose-800" : "border-blue-200 bg-blue-50 text-blue-800"
            }`}
          >
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className="font-semibold">
              {myActionCount > 0 ? `${myActionCount} request${myActionCount === 1 ? "" : "s"} waiting on you` : "Requests past SLA"}
              {overdueCount > 0 && ` · ${overdueCount} overdue by more than ${SLA_DAYS} days`}
            </span>
            <button
              onClick={() => { setTab("pending"); setQueueFilter(overdueCount > 0 ? "overdue" : "mine"); }}
              className="ml-auto cursor-pointer text-xs font-bold underline"
            >
              {overdueCount > 0 ? "Show overdue" : "Show mine"}
            </button>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map(k => (
            <div key={k.label} className={`rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm ${k.ring}`}>
              <p className="text-xs font-semibold text-slate-500">{k.label}</p>
              <p className={`mt-1 text-2xl font-black ${k.tone}`}>{k.value}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{k.hint}</p>
            </div>
          ))}
        </div>

        {/* Insights */}
        <ReactivationInsights history={snapshot} queue={queue} />

        {/* Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-fit items-center gap-1 rounded-xl bg-slate-100 p-1">
            {(isHR || isBranchHead) && (
              <button
                onClick={() => setTab("pending")}
                className={`relative cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                  tab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Open queue
                {queue.length > 0 && (
                  <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-white">{queue.length}</span>
                )}
              </button>
            )}
            {canSeeAll && (
              <button
                onClick={() => setTab("all")}
                className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                  tab === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                History
              </button>
            )}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or employee code"
              aria-label="Search requests"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B6AB5]"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
            <button onClick={refreshAll} className="ml-auto cursor-pointer text-xs font-semibold underline">Retry</button>
          </div>
        )}

        {/* A reporting manager only raises: the queue and history are not theirs to see. */}
        {!isHR && !isBranchHead && !canSeeAll && (
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
            <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1B6AB5]" />
            <span>
              Use <strong>Initiate Request</strong> to ask for someone who reported to you to rejoin. The branch head of their
              branch reviews the request and decides.
            </span>
          </div>
        )}

        {/* Open queue */}
        {tab === "pending" && (isHR || isBranchHead) && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {queueFilters.map(f => (
                <button
                  key={f.key}
                  onClick={() => setQueueFilter(f.key)}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    queueFilter === f.key
                      ? "border-[#073f78] bg-[#073f78] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {f.label} <span className="opacity-70">{f.count}</span>
                </button>
              ))}
            </div>

            {loading && [1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200/60" />)}

            {!loading && visibleQueue.length === 0 && (
              <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-8 py-14 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <p className="text-base font-bold text-slate-700">
                  {queue.length === 0 ? "All clear" : "Nothing matches this filter"}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {queue.length === 0 ? "No reactivation requests are waiting on anyone." : "Try another filter or clear the search."}
                </p>
              </div>
            )}

            {!loading && visibleQueue.map(r => (
              <RequestCard
                key={r.id}
                request={r}
                roleKeys={roleKeys}
              />
            ))}
          </div>
        )}

        {/* History */}
        {tab === "all" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B6AB5]"
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setAllPage(1); }}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                <option value="pending">Pending Branch Head</option>
                <option value="branch_head_approved">Awaiting final decision (old process)</option>
                <option value="approved">Reactivated</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </select>
              {all && <p className="text-xs text-slate-400">{all.total} total request{all.total !== 1 ? "s" : ""}</p>}
            </div>

            {loading && [1, 2].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200/60" />)}

            {!loading && visibleAll.length === 0 && (
              <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-8 py-14 text-center">
                <Users className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                <p className="text-sm font-semibold text-slate-500">No requests found</p>
                <p className="mt-1 text-xs text-slate-400">Try changing the status filter or search.</p>
              </div>
            )}

            {!loading && visibleAll.map(r => (
              <RequestCard
                key={r.id}
                request={r}
                roleKeys={roleKeys}
              />
            ))}

            {all && all.total > all.limit && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setAllPage(p => Math.max(1, p - 1))}
                  disabled={all.page <= 1}
                  className="cursor-pointer rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-sm font-medium text-slate-500">
                  Page {all.page} of {Math.ceil(all.total / all.limit)}
                </span>
                <button
                  onClick={() => setAllPage(p => p + 1)}
                  disabled={all.page * all.limit >= all.total}
                  className="cursor-pointer rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Overlays */}
      <RaiseRejoinDialog open={showInitiate} onOpenChange={setShowInitiate} onRaised={handleSuccess} />
    </DashboardLayout>
  );
}
