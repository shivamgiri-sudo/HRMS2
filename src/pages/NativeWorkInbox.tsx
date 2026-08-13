import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, Bell, BellOff, CheckCheck, CheckCircle2,
  Clock, Loader, RefreshCcw, X, ChevronRight, BarChart2,
  Zap, Shield,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatIST } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * "breached" means a real TAT deadline was missed. "aged" means the item carries no
 * deadline and is simply old. The CEO UAT saw 23 items all reading "TAT breached"
 * when none of them had a TAT at all — see calcRisk in inbox.service.ts.
 */
type Risk = "breached" | "aged" | "due_soon" | "on_track";

interface PendingTask {
  id: string;
  source: "tat" | "inbox" | "work_item";
  module: string;
  title: string;
  description?: string;
  entity_type?: string;
  entity_id?: string;
  action_url?: string;
  priority: string;
  tat_deadline?: string;
  created_at: string;
  aging_hours: number;
  risk: Risk;
  employee_name?: string;
  branch_name?: string;
  requested_by_name?: string;
  requested_by_code?: string;
}

interface PendingSummary {
  total: number;
  breached: number;
  aged: number;
  due_soon: number;
  on_track: number;
  by_module: Record<string, number>;
  /** True when a source query hit its row cap — there is more than what's shown. */
  truncated?: boolean;
}

interface TimelineEvent {
  id: string;
  event_time: string;
  actor: string;
  action: string;
  details?: string;
  source_table: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Display names for work-item types.
 *
 * Any key missing here falls through to the raw database value, which is how the
 * CEO UAT saw "attendance_missing_punch" rendered as a user-facing Module label.
 * The map covered thirteen types that barely occur while omitting the ones that
 * dominate the table — of 65k live rows, `alerts` (43,964) and
 * `attendance_missing_punch` (13,635) alone are 88%, and neither had a label.
 *
 * Keys below are the actual `work_inbox_item.type` values present in mas_hrms,
 * verified 31-Jul-2026, rather than a guess at what the schema might emit.
 */
const MODULE_LABELS: Record<string, string> = {
  // Highest-volume types, all previously unlabelled.
  alerts: "Alerts",
  attendance_missing_punch: "Attendance",
  attendance_validation: "Attendance",
  attendance_regularization: "Attendance",
  payroll_attendance_conflict: "Payroll",
  sla_breach_uncalled: "Recruitment SLA",
  walkin_submission_sla: "Walk-in SLA",
  walkin_feedback_pending: "Walk-in",
  interview_submission_overdue: "Interviews",
  candidate_no_show: "Candidates",
  requisition_approved: "Requisitions",
  visitor_approval_needed: "Visitors",
  announcements: "Announcements",
  leave_request: "Leave",
  // Pre-existing entries, retained.
  leave_approval: "Leave",
  regularization: "Attendance",
  exit_clearance: "Exit",
  it_provisioning: "IT",
  it_access: "IT Access",
  onboarding: "Onboarding",
  offboarding: "Offboarding",
  bgv: "BGV",
  asset_return: "Assets",
  incentive: "Incentive",
  resignation: "Resignation",
  pip_checkpoint: "PIP",
  workflow_request: "Workflow",
};

/**
 * Last-resort label for a type with no entry above. Turns `some_raw_key` into
 * "Some Raw Key" so a missing mapping degrades to something readable instead of
 * exposing a database identifier to the user.
 */
export function humaniseModuleKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const RISK_STYLES: Record<Risk, { badge: string; ring: string; bar: string }> = {
  breached:  { badge: "bg-red-100 text-red-700 border-red-200",    ring: "ring-2 ring-red-300",    bar: "bg-red-500" },
  due_soon:  { badge: "bg-amber-100 text-amber-700 border-amber-200", ring: "ring-2 ring-amber-300", bar: "bg-amber-500" },
  // Slate, not red: an old item with no promised deadline is not an SLA failure.
  aged:      { badge: "bg-slate-100 text-slate-600 border-slate-200", ring: "", bar: "bg-slate-400" },
  on_track:  { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", ring: "", bar: "bg-emerald-500" },
};

const PRIORITY_STYLES: Record<string, string> = {
  urgent: "bg-red-50 text-red-600",
  high:   "bg-orange-50 text-orange-600",
  normal: "bg-blue-50 text-blue-600",
  low:    "bg-slate-100 text-slate-500",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDeadline(d?: string): string | null {
  if (!d) return null;
  const dt = new Date(d);
  return dt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ── KPI strip ─────────────────────────────────────────────────────────────────

function KpiStrip({ summary, loading }: { summary: PendingSummary | null; loading: boolean }) {
  const tiles = [
    { label: "Total Pending", value: summary?.total ?? 0,    icon: Bell,        gradient: "from-blue-600 to-indigo-700" },
    { label: "Breached TAT",  value: summary?.breached ?? 0, icon: AlertTriangle, gradient: "from-red-500 to-rose-600" },
    { label: "Due Soon",      value: summary?.due_soon ?? 0, icon: Clock,        gradient: "from-amber-500 to-orange-600" },
    { label: "Ageing",        value: summary?.aged ?? 0,     icon: Clock,        gradient: "from-slate-500 to-slate-600" },
    { label: "On Track",      value: summary?.on_track ?? 0, icon: CheckCircle2, gradient: "from-emerald-500 to-teal-600" },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${t.gradient} p-5 text-white shadow-lg`}>
          <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
          <t.icon className="mb-2 h-5 w-5 opacity-80" />
          <p className="text-3xl font-black">{loading ? "—" : t.value}</p>
          <p className="mt-0.5 text-xs font-semibold opacity-80">{t.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function Timeline({ events, loading }: { events: TimelineEvent[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-8"><Loader className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (!events.length) return <p className="py-6 text-center text-sm text-slate-400">No timeline events found.</p>;
  return (
    <ol className="relative ml-3 border-l border-slate-200">
      {events.map((e) => (
        <li key={e.id} className="mb-4 ml-4">
          <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-400" />
          <p className="text-[11px] text-slate-400">{formatIST(e.event_time)}</p>
          <p className="text-sm font-semibold text-slate-800">{e.action}</p>
          {e.actor && <p className="text-xs text-slate-500">by {e.actor}</p>}
          {e.details && <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{e.details}</p>}
        </li>
      ))}
    </ol>
  );
}

// ── Action Sheet ──────────────────────────────────────────────────────────────

function ActionSheet({
  task,
  onClose,
  onComplete,
}: {
  task: PendingTask | null;
  onClose: () => void;
  onComplete: (id: string, remarks: string) => Promise<void>;
}) {
  const [remarks, setRemarks] = useState("");
  const [acting, setActing] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [tlLoading, setTlLoading] = useState(false);

  useEffect(() => {
    if (!task?.entity_type || !task?.entity_id) return;
    setTlLoading(true);
    // work_item-sourced tasks (Mira complaints, registry-driven approvals, ...) mostly don't
    // self-reference — entity_id is the business entity (employee/candidate/...), not the
    // work_item's own id — so a completion/escalation/reassignment recorded against this
    // item is otherwise unreachable from entity_type/entity_id alone. task.id IS the
    // work_item's own id (see getMyPending's workItemRows), passed through so the backend's
    // generic workItemId branch can find it. See getTimeline (inbox.service.ts) for the
    // dedup that keeps this from double-showing rows the mira_feedback/incentive-specific
    // lookups already cover.
    const workItemParam = task.source === "work_item" ? `?workItemId=${encodeURIComponent(task.id)}` : "";
    hrmsApi
      .get<{ success: boolean; events: TimelineEvent[] }>(
        `/api/inbox/timeline/${task.entity_type}/${task.entity_id}${workItemParam}`,
      )
      .then((r) => setTimeline(r.events ?? []))
      .catch(() => setTimeline([]))
      .finally(() => setTlLoading(false));
  }, [task?.entity_type, task?.entity_id, task?.source, task?.id]);

  const handleAct = async () => {
    if (!task) return;
    setActing(true);
    try {
      await onComplete(task.id, remarks);
      setRemarks("");
      onClose();
    } finally {
      setActing(false);
    }
  };

  if (!task) return null;
  const rs = RISK_STYLES[task.risk];

  return (
    <Sheet open={!!task} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-lg overflow-y-auto p-0">
        <SheetHeader className="sticky top-0 z-10 border-b bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base font-black leading-tight">{task.title}</SheetTitle>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${rs.badge}`}>
                  {task.risk.replace("_", " ")}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize ${PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.normal}`}>
                  {task.priority}
                </span>
                <span className="text-[10px] text-slate-400">{MODULE_LABELS[task.module] ?? humaniseModuleKey(task.module)}</span>
              </div>
            </div>
            <SheetClose asChild>
              <button className="rounded-lg p-1.5 hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </SheetClose>
          </div>
        </SheetHeader>

        <div className="space-y-5 px-6 py-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {task.requested_by_name && (
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">Raised by</p>
                <p className="mt-0.5 font-semibold text-slate-900">
                  {task.requested_by_name}
                  {task.requested_by_code && (
                    <span className="ml-1 font-normal text-slate-400">({task.requested_by_code})</span>
                  )}
                </p>
              </div>
            )}
            {task.employee_name && (
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">Employee</p>
                <p className="mt-0.5 font-semibold text-slate-900">{task.employee_name}</p>
              </div>
            )}
            {task.branch_name && (
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">Branch</p>
                <p className="mt-0.5 font-semibold text-slate-900">{task.branch_name}</p>
              </div>
            )}
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-400">Raised at</p>
              <p className="mt-0.5 font-semibold text-slate-900">{formatIST(task.created_at) || "—"}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-400">Aging</p>
              <p className="mt-0.5 font-semibold text-slate-900">{task.aging_hours}h</p>
            </div>
            {task.tat_deadline && (
              <div className={`rounded-xl p-3 ${task.risk === "breached" ? "bg-red-50" : "bg-slate-50"}`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Deadline</p>
                <p className={`mt-0.5 font-semibold ${task.risk === "breached" ? "text-red-700" : "text-slate-900"}`}>
                  {fmtDeadline(task.tat_deadline)}
                </p>
              </div>
            )}
          </div>

          {task.description && (
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{task.description}</div>
          )}

          {/* Timeline */}
          {(task.entity_type && task.entity_id) && (
            <div>
              <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Timeline</p>
              <Timeline events={timeline} loading={tlLoading} />
            </div>
          )}

          {/* Remarks + action */}
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">Remarks (optional)</p>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="Add a note before completing…"
              className="resize-none text-sm"
            />
          </div>

          <div className="flex gap-3">
            {task.action_url && (
              <Button variant="outline" size="sm" asChild className="flex-1 gap-1.5">
                <a href={task.action_url} target="_blank" rel="noopener noreferrer">
                  <ChevronRight className="h-4 w-4" /> Open
                </a>
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleAct}
              disabled={acting}
              className="flex-1 gap-1.5 bg-slate-950 hover:bg-slate-800 text-white"
            >
              {acting ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Act & Close
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, onOpen }: { task: PendingTask; onOpen: () => void }) {
  const rs = RISK_STYLES[task.risk];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group w-full rounded-2xl border-0 bg-white p-4 text-left shadow-md transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 ${rs.ring}`}
    >
      {/* Risk bar */}
      <div className={`mb-3 h-0.5 w-full rounded-full ${rs.bar} opacity-60`} />

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${rs.badge}`}>
          {task.risk.replace("_", " ")}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.normal}`}>
          {task.priority}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
          {MODULE_LABELS[task.module] ?? humaniseModuleKey(task.module)}
        </span>
      </div>

      <p className="font-bold text-slate-950 leading-snug line-clamp-2">{task.title}</p>

      {(task.employee_name || task.requested_by_name) && (
        <p className="mt-1 text-xs text-slate-500 truncate">
          {task.employee_name ?? `Raised by ${task.requested_by_name}`}
          {task.branch_name ? ` · ${task.branch_name}` : ""}
        </p>
      )}

      <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400">
        <span>{timeAgo(task.created_at)}</span>
        {task.aging_hours > 0 && <span>{task.aging_hours}h old</span>}
        {task.tat_deadline && (
          <span className={task.risk === "breached" ? "text-red-500 font-bold" : ""}>
            due {fmtDeadline(task.tat_deadline)}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type RiskFilter = "all" | Risk;

export default function NativeWorkInbox() {
  const [items, setItems]         = useState<PendingTask[]>([]);
  const [summary, setSummary]     = useState<PendingSummary | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [activeModule, setActiveModule] = useState<string>("all");
  const [riskFilter, setRiskFilter]     = useState<RiskFilter>("all");
  const [search, setSearch]       = useState("");
  const [selected, setSelected]   = useState<PendingTask | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; items: PendingTask[]; summary: PendingSummary }>(
        "/api/inbox/my-pending",
      );
      setItems(res.items ?? []);
      setSummary(res.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Derive module tabs from live data
  const moduleCounts = summary?.by_module ?? {};
  const moduleList = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]);

  // Search runs over whatever /my-pending already fetched (up to ~700 rows across the three
  // sources' caps), not a server-side full-text query against the underlying tables — those
  // hold tens of thousands of rows per source and a real search would need its own scoped
  // endpoint. This finds anything currently on screen; it can't find an item that got cut by
  // the LIMIT before it ever reached the browser — that's what the truncation banner is for.
  const searchTerm = search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (activeModule !== "all" && item.module !== activeModule) return false;
    if (riskFilter !== "all" && item.risk !== riskFilter) return false;
    if (searchTerm) {
      const haystack = [item.title, item.description, item.employee_name, item.requested_by_name, item.requested_by_code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }
    return true;
  });

  const completeTask = async (id: string, remarks: string) => {
    const task = items.find((i) => i.id === id);
    if (!task) return;
    if (task.source === "tat") {
      await hrmsApi.post(`/api/governance/tat/tasks/${id}/complete`, { remarks: remarks || undefined });
    } else if (task.source === "work_item") {
      // work_item rows (role-assigned approvals, Mira complaints, etc.) live in a
      // different table than work_inbox_item — PATCH /api/inbox/:id/actioned updates
      // work_inbox_item and silently affects 0 rows for these, so the item reappeared on
      // every reload with no error anywhere. Found live 2026-08-13: 6 pending work_item
      // rows, the oldest 15 days stale, none completable through this button until now.
      await hrmsApi.post(`/api/work-inbox/${id}/complete`, { remarks: remarks || undefined });
    } else {
      await hrmsApi.patch(`/api/inbox/${id}/actioned`, {});
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSummary((prev) =>
      prev
        ? {
            ...prev,
            total: Math.max(0, prev.total - 1),
            // No cast: Risk is exactly the four numeric keys of PendingSummary, so this
            // indexes directly. The blanket Record<string, number> was also untrue - by_module
            // is an object, not a number.
            [task.risk]: Math.max(0, prev[task.risk] - 1),
            by_module: {
              ...prev.by_module,
              [task.module]: Math.max(0, (prev.by_module[task.module] ?? 1) - 1),
            },
          }
        : prev,
    );
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        {/* Header */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 p-8 text-white shadow-2xl">
          <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                <Zap className="h-3 w-3" /> All Modules
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-4xl font-black tracking-tight">Work Inbox</h1>
                {(summary?.total ?? 0) > 0 && (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-sm font-black text-white shadow-lg animate-pulse">
                    {summary!.total}
                  </span>
                )}
              </div>
              <p className="mt-1 text-blue-200 text-sm">Your pending tasks across all platform modules</p>
            </div>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2.5 text-sm font-bold text-white backdrop-blur-sm hover:bg-white/20 transition-all disabled:opacity-50"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <KpiStrip summary={summary} loading={loading} />

        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {summary?.truncated && (
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-slate-400" />
            Showing the first batch of results — one or more categories has more pending items
            than fit here. Use the module or risk filters to narrow down; the oldest/lowest
            priority items in an over-full category may not be listed above.
          </div>
        )}

        {/* Filters */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          {/* Search */}
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Search</p>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, description, employee or requester…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
            />
          </div>
          {/* Module tabs */}
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Module</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveModule("all")}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${activeModule === "all" ? "bg-slate-950 text-white shadow" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                All <span className="ml-1 opacity-60">{summary?.total ?? 0}</span>
              </button>
              {moduleList.map(([mod, count]) => (
                <button
                  key={mod}
                  onClick={() => setActiveModule(mod)}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${activeModule === mod ? "bg-blue-600 text-white shadow" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {MODULE_LABELS[mod] ?? humaniseModuleKey(mod)} <span className="ml-1 opacity-60">{count}</span>
                </button>
              ))}
            </div>
          </div>
          {/* Risk filter */}
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Risk</p>
            <div className="flex flex-wrap gap-2">
              {(["all", "breached", "due_soon", "aged", "on_track"] as const).map((r) => {
                const active = riskFilter === r;
                const styles: Record<string, string> = {
                  all:      active ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600",
                  breached: active ? "bg-red-600 text-white" : "bg-red-50 text-red-700",
                  due_soon: active ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700",
                  aged:     active ? "bg-slate-600 text-white" : "bg-slate-100 text-slate-600",
                  on_track: active ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700",
                };
                return (
                  <button
                    key={r}
                    onClick={() => setRiskFilter(r)}
                    className={`rounded-xl px-3.5 py-1.5 text-xs font-bold capitalize transition-all hover:opacity-90 ${styles[r]}`}
                  >
                    {r.replace("_", " ")}
                    {r !== "all" && summary && (
                      <span className="ml-1 opacity-70">
                        {(summary as unknown as Record<string, number>)[r] ?? 0}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Task grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <div className="col-span-full flex items-center justify-center py-20">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-slate-400">
              <BellOff className="mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">
                {items.length === 0 ? "No pending tasks" : "No matches"}
              </p>
              <p className="mt-1 text-sm">
                {items.length === 0
                  ? "Great work! Everything is actioned."
                  : "Nothing matches the current search and filters."}
              </p>
            </div>
          ) : (
            filtered.map((task) => (
              <TaskCard key={`${task.source}-${task.id}`} task={task} onOpen={() => setSelected(task)} />
            ))
          )}
        </div>
      </main>

      <ActionSheet
        task={selected}
        onClose={() => setSelected(null)}
        onComplete={completeTask}
      />
    </DashboardLayout>
  );
}
