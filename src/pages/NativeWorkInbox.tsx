import { useEffect, useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Bell, BellOff, CheckCheck, CheckCircle2,
  Clock, Loader, RefreshCcw, X, ChevronRight,
  Zap, Wand2, ShieldAlert, History, ChevronDown,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatIST } from "@/lib/utils";
import { useHasRole } from "@/hooks/useUserRole";

// ── Types ─────────────────────────────────────────────────────────────────────

type Risk = "breached" | "aged" | "due_soon" | "on_track";

interface PendingTask {
  id: string;
  source: "tat" | "inbox" | "work_item" | "derived";
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
  truncated?: boolean;
}

export interface GroupedItem {
  kind: "group";
  groupKey: string;
  module: string;
  source: "inbox" | "tat" | "work_item";
  branch_name: string | null;
  items: PendingTask[];
  worstRisk: Risk;
  highestPriority: string;
}

/**
 * Collapse repeated same-module/source/branch items into GroupedItems.
 *
 * An item is eligible for grouping when:
 *   - At least 2 other items share the same module + source + branch_name
 *   - source is not "derived" (derived items require real workflow navigation)
 *   - No item in the candidate group has priority "urgent"
 *
 * Items that don't reach a group of 3+ stay as individual PendingTask rows.
 * The returned array preserves the original sort order — groups appear at the
 * position of their first member.
 */
export function groupItems(items: PendingTask[]): (PendingTask | GroupedItem)[] {
  const RISK_ORDER: Record<Risk, number> = { breached: 0, due_soon: 1, aged: 2, on_track: 3 };
  const PRIO_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const buckets = new Map<string, PendingTask[]>();

  for (const item of items) {
    if (item.source === "derived") continue;
    if (item.priority === "urgent") continue;
    const key = `${item.module}::${item.source}::${item.branch_name ?? "__none__"}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  const groupKeys = new Set<string>();
  buckets.forEach((members, key) => {
    if (members.length >= 3) groupKeys.add(key);
  });

  if (!groupKeys.size) return items;

  const absorbed = new Set<string>();
  const groupByKey = new Map<string, GroupedItem>();

  buckets.forEach((members, key) => {
    if (!groupKeys.has(key)) return;
    const worstRisk = members.reduce<Risk>((worst, m) =>
      RISK_ORDER[m.risk] < RISK_ORDER[worst] ? m.risk : worst, "on_track");
    const highestPriority = members.reduce<string>((best, m) =>
      (PRIO_ORDER[m.priority] ?? 9) < (PRIO_ORDER[best] ?? 9) ? m.priority : best, "low");
    const first = members[0];
    groupByKey.set(key, {
      kind: "group",
      groupKey: key,
      module: first.module,
      source: first.source as "inbox" | "tat" | "work_item",
      branch_name: first.branch_name ?? null,
      items: members,
      worstRisk,
      highestPriority,
    });
    members.forEach((m) => absorbed.add(`${m.source}-${m.id}`));
  });

  const result: (PendingTask | GroupedItem)[] = [];
  const groupEmitted = new Set<string>();

  for (const item of items) {
    const itemKey = `${item.source}-${item.id}`;
    if (!absorbed.has(itemKey)) {
      result.push(item);
      continue;
    }
    const key = `${item.module}::${item.source}::${item.branch_name ?? "__none__"}`;
    if (!groupEmitted.has(key)) {
      result.push(groupByKey.get(key)!);
      groupEmitted.add(key);
    }
  }

  return result;
}

interface TimelineEvent {
  id: string;
  event_time: string;
  actor: string;
  action: string;
  details?: string;
  source_table: string;
}

interface FixDraft {
  id: string;
  workItemId: string;
  status: "drafted" | "rejected" | "deploying" | "deployed" | "failed";
  targetFiles: string[];
  diffText: string;
  model: string | null;
  safetyFlags: string[] | null;
  rejectedReason: string | null;
  createdAt: string;
}

type FixDraftGenerationOutcome =
  | { status: "no_diagnosis" }
  | { status: "not_eligible"; reason: string }
  | { status: "ai_unavailable" }
  | { status: "model_declined"; reason: string }
  | { status: "ai_error"; message: string }
  | { status: "drafted"; draft: FixDraft };

// ── Helpers ───────────────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
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

const MODULE_REMARKS: Record<string, readonly string[]> = {
  leave_approval:            ["Approved — coverage confirmed", "Declined — insufficient balance", "Approved with conditions"],
  leave_request:             ["Approved — coverage confirmed", "Declined — insufficient balance"],
  attendance_missing_punch:  ["Regularized — supervisor verified", "Declined — records correct"],
  attendance_regularization: ["Regularized — supervisor verified", "Declined — records correct"],
  regularization:            ["Regularized — verified", "Declined — records correct"],
  bgv:                       ["Clear — proceeding", "Document resubmission requested", "Escalated to HR Head"],
  exit_clearance:            ["Cleared", "Pending — asset return outstanding", "Escalated"],
  resignation:               ["Acknowledged — notice period begins", "Escalated to Branch Head"],
  onboarding:                ["Completed — employee notified", "Pending documents — follow-up sent"],
  offboarding:               ["Clearance complete", "Pending — IT access outstanding"],
  it_provisioning:           ["Provisioned", "Deferred — pending approval"],
  asset_return:              ["Assets received and logged", "Partial return — follow-up required"],
  pip_checkpoint:            ["Checkpoint noted — plan on track", "Checkpoint missed — escalating"],
  walkin_feedback_pending:   ["Feedback submitted", "No-show — candidate not reachable"],
  visitor_approval_needed:   ["Approved — visitor registered", "Declined — not authorised"],
};

export function humaniseModuleKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const RISK_STYLES: Record<Risk, { badge: string; ring: string; bar: string; row: string }> = {
  breached:  { badge: "bg-red-100 text-red-700 border-red-200",    ring: "ring-2 ring-red-300",    bar: "bg-red-500",     row: "border-l-2 border-l-red-400" },
  due_soon:  { badge: "bg-amber-100 text-amber-700 border-amber-200", ring: "ring-2 ring-amber-300", bar: "bg-amber-500",  row: "border-l-2 border-l-amber-400" },
  aged:      { badge: "bg-slate-100 text-slate-600 border-slate-200", ring: "", bar: "bg-slate-400",   row: "border-l-2 border-l-slate-300" },
  on_track:  { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", ring: "", bar: "bg-emerald-500", row: "border-l-2 border-l-emerald-400" },
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
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${t.gradient} px-4 py-3 text-white shadow`}>
          <div className="absolute -right-3 -top-3 h-14 w-14 rounded-full bg-white/10" />
          <t.icon className="mb-1 h-4 w-4 opacity-80" />
          <p className="text-2xl font-black">{loading ? "—" : t.value}</p>
          <p className="text-[11px] font-semibold opacity-80">{t.label}</p>
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

// ── AI Fix Draft ──────────────────────────────────────────────────────────────

const DRAFT_STATUS_STYLES: Record<FixDraft["status"], string> = {
  drafted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  deploying: "bg-amber-50 text-amber-700 border-amber-200",
  deployed: "bg-blue-50 text-blue-700 border-blue-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

function outcomeMessage(outcome: FixDraftGenerationOutcome): { text: string; tone: "info" | "warn" | "error" } {
  switch (outcome.status) {
    case "no_diagnosis":
      return { text: "No AI diagnosis exists yet for this item — nothing to draft a fix from.", tone: "warn" };
    case "not_eligible":
      return { text: `Not eligible for an automatic fix draft (${outcome.reason}).`, tone: "warn" };
    case "ai_unavailable":
      return { text: "No AI provider is currently configured.", tone: "error" };
    case "model_declined":
      return { text: `The AI declined to propose a fix: ${outcome.reason}`, tone: "warn" };
    case "ai_error":
      return { text: `Draft generation failed: ${outcome.message}`, tone: "error" };
    case "drafted":
      return outcome.draft.status === "rejected"
        ? { text: `A diff was generated but rejected: ${outcome.draft.rejectedReason ?? "see details below"}`, tone: "warn" }
        : { text: "A new fix draft is ready for review below.", tone: "info" };
  }
}

function FixDraftPanel({ workItemId }: { workItemId: string }) {
  const [drafts, setDrafts] = useState<FixDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<FixDraftGenerationOutcome | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadDrafts = useCallback(() => {
    setLoading(true);
    hrmsApi
      .get<{ success: boolean; drafts: FixDraft[] }>(`/api/inbox/mira-fix-draft/${workItemId}`)
      .then((r) => setDrafts(r.drafts ?? []))
      .catch(() => setDrafts([]))
      .finally(() => setLoading(false));
  }, [workItemId]);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  const handleGenerate = async () => {
    setGenerating(true);
    setLastOutcome(null);
    try {
      const res = await hrmsApi.post<{ success: boolean; outcome: FixDraftGenerationOutcome }>(
        `/api/inbox/mira-fix-draft/${workItemId}/generate`,
        {},
      );
      setLastOutcome(res.outcome);
      loadDrafts();
    } catch {
      setLastOutcome({ status: "ai_error", message: "Request failed — check your connection and try again." });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-widest text-slate-400">AI Fix Draft</p>
        <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating} className="gap-1.5 text-xs">
          {generating ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Draft a fix
        </Button>
      </div>

      {lastOutcome && (() => {
        const { text, tone } = outcomeMessage(lastOutcome);
        const toneClass = tone === "error" ? "bg-red-50 text-red-700" : tone === "warn" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700";
        return <div className={`mb-3 rounded-xl p-3 text-xs ${toneClass}`}>{text}</div>;
      })()}

      {loading ? (
        <div className="flex justify-center py-6"><Loader className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : !drafts.length ? (
        <p className="py-4 text-center text-xs text-slate-400">No fix drafts yet.</p>
      ) : (
        <div className="space-y-2">
          {drafts.map((d) => {
            const isOpen = expandedId === d.id;
            return (
              <div key={d.id} className="rounded-xl border border-slate-200 p-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : d.id)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${DRAFT_STATUS_STYLES[d.status]}`}>
                      {d.status}
                    </span>
                    <span className="text-xs text-slate-500">{formatIST(d.createdAt)}</span>
                    {d.model && <span className="text-[10px] text-slate-400">via {d.model}</span>}
                  </div>
                  <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>

                {d.status === "rejected" && d.rejectedReason && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-[11px] text-red-700">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{d.rejectedReason}</span>
                  </div>
                )}

                {isOpen && (
                  <>
                    {d.targetFiles.length > 0 && (
                      <p className="mt-2 text-[11px] text-slate-500">Files: {d.targetFiles.join(", ")}</p>
                    )}
                    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
                      {d.diffText}
                    </pre>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Remarks Chips ─────────────────────────────────────────────────────────────

function RemarksChips({ module, onSelect }: { module: string; onSelect: (text: string) => void }) {
  const chips = MODULE_REMARKS[module];
  if (!chips?.length) return null;
  return (
    <div className="mb-2">
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Quick remarks</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onSelect(chip)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Action Sheet ──────────────────────────────────────────────────────────────

// Full-record keys that are internal plumbing (encrypted blobs, blind-index hashes, raw
// provider payloads) — never useful to a reviewer and, for the encrypted/hash columns,
// actively wrong to print. Everything else in the record is shown; this is a denylist,
// not a curated allowlist, so a new column on the underlying table shows up automatically
// instead of silently staying invisible the way the old "Details" summary did.
const DETAIL_FIELD_DENYLIST = /(_hash|_encrypted|blind_index|result_json|risk_flags_json|password)$/i;

function humaniseFieldKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  const s = String(value);
  // ISO-ish datetime — render in IST like the rest of this page.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return formatIST(s) || s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}

function FullRecordDetail({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k]) => !DETAIL_FIELD_DENYLIST.test(k));
  if (!entries.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <p className="font-bold uppercase tracking-wide text-slate-400">{humaniseFieldKey(k)}</p>
          <p className="mt-0.5 break-words font-medium text-slate-800">{formatFieldValue(v)}</p>
        </div>
      ))}
    </div>
  );
}

function ActionSheet({
  task,
  onClose,
  onComplete,
  onDecide,
}: {
  task: PendingTask | null;
  onClose: () => void;
  onComplete: (id: string, remarks: string) => Promise<void>;
  onDecide: (task: PendingTask, decision: "approve" | "reject", remarks: string) => Promise<void>;
}) {
  const [remarks, setRemarks] = useState("");
  const [acting, setActing] = useState(false);
  const [decidingAs, setDecidingAs] = useState<"approve" | "reject" | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [tlLoading, setTlLoading] = useState(false);
  const [fullRecord, setFullRecord] = useState<Record<string, unknown> | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState("");
  const canReviewFixDrafts = useHasRole("super_admin");

  useEffect(() => {
    setRemarks("");
    setFullRecord(null);
    setRecordError("");
    if (!task?.entity_type || !task?.entity_id) return;
    setTlLoading(true);
    const workItemParam = task.source === "work_item" ? `?workItemId=${encodeURIComponent(task.id)}` : "";
    hrmsApi
      .get<{ success: boolean; events: TimelineEvent[] }>(
        `/api/inbox/timeline/${task.entity_type}/${task.entity_id}${workItemParam}`,
      )
      .then((r) => setTimeline(r.events ?? []))
      .catch(() => setTimeline([]))
      .finally(() => setTlLoading(false));

    // The real "Review" drill-down: the underlying leave_request / exit_clearance_task /
    // candidate_bgv_check row itself, not just the summary tiles above. Only these three
    // derived types have a dedicated detail endpoint today — see inbox-derived.service.ts.
    if (task.source === "derived") {
      setRecordLoading(true);
      hrmsApi
        .get<{ success: boolean; data: Record<string, unknown> }>(
          `/api/inbox/derived/${task.entity_type}/${task.entity_id}`,
        )
        .then((r) => setFullRecord(r.data ?? null))
        .catch((err) => setRecordError(err instanceof Error ? err.message : "Failed to load full record"))
        .finally(() => setRecordLoading(false));
    }
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

  const handleDecide = async (decision: "approve" | "reject") => {
    if (!task) return;
    if (decision === "reject" && !remarks.trim()) return; // button is disabled for this case too
    setDecidingAs(decision);
    try {
      await onDecide(task, decision, remarks);
      setRemarks("");
      onClose();
    } catch (err) {
      import("sonner").then(({ toast }) => {
        toast.error(err instanceof Error ? err.message : "Action failed.");
      });
    } finally {
      setDecidingAs(null);
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

          {task.source === "derived" && (
            <div>
              <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Full Record</p>
              {recordLoading && <p className="text-xs text-slate-400">Loading full record…</p>}
              {recordError && <p className="text-xs font-semibold text-red-600">{recordError}</p>}
              {fullRecord && <FullRecordDetail data={fullRecord} />}
            </div>
          )}

          {(task.entity_type && task.entity_id) && (
            <div>
              <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Timeline</p>
              <Timeline events={timeline} loading={tlLoading} />
            </div>
          )}

          {task.entity_type === "mira_feedback" && task.entity_id && canReviewFixDrafts && (
            <FixDraftPanel workItemId={task.entity_id} />
          )}

          <div>
            {task.source !== "derived" && <RemarksChips module={task.module} onSelect={(text) => setRemarks(text)} />}
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              {task.source === "derived" ? "Remarks (required to reject)" : "Remarks (optional)"}
            </p>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder={task.source === "derived" ? "Reason for this decision…" : "Add a note before completing…"}
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
            {task.source === "derived" ? (
              <>
                <Button
                  size="sm"
                  onClick={() => void handleDecide("reject")}
                  disabled={decidingAs !== null || !remarks.trim()}
                  variant="outline"
                  className="flex-1 gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                >
                  {decidingAs === "reject" ? <Loader className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleDecide("approve")}
                  disabled={decidingAs !== null}
                  className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {decidingAs === "approve" ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={handleAct}
                disabled={acting}
                className="flex-1 gap-1.5 bg-slate-950 hover:bg-slate-800 text-white"
              >
                {acting ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Act & Close
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Task Row (compact table row) ──────────────────────────────────────────────

function TaskRow({
  task,
  onOpen,
  onQuickAct,
  acting,
  focused = false,
  showReassign = false,
}: {
  task: PendingTask;
  onOpen: () => void;
  onQuickAct: () => void;
  acting: boolean;
  focused?: boolean;
  showReassign?: boolean;
}) {
  const rs = RISK_STYLES[task.risk];
  const riskLabel =
    task.risk === "due_soon" ? "Due Soon"
    : task.risk === "on_track" ? "On Track"
    : task.risk.charAt(0).toUpperCase() + task.risk.slice(1);

  return (
    <tr className={`group border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition-colors ${rs.row} ${focused ? "ring-2 ring-inset ring-blue-500 bg-blue-50/30" : ""}`}>
      {/* Risk */}
      <td className="py-2.5 pl-3 pr-2 whitespace-nowrap w-24">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${rs.badge}`}>
          {riskLabel}
        </span>
      </td>
      {/* Module */}
      <td className="py-2.5 px-2 whitespace-nowrap w-28 hidden sm:table-cell">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
          {MODULE_LABELS[task.module] ?? humaniseModuleKey(task.module)}
        </span>
      </td>
      {/* Title + person */}
      <td className="py-2.5 px-2 min-w-0 max-w-xs">
        <p className="text-sm font-semibold text-slate-900 leading-snug truncate">{task.title}</p>
        {(task.employee_name || task.requested_by_name) && (
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            {task.employee_name ?? `by ${task.requested_by_name}`}
            {task.branch_name ? ` · ${task.branch_name}` : ""}
          </p>
        )}
      </td>
      {/* Priority */}
      <td className="py-2.5 px-2 whitespace-nowrap w-20 hidden md:table-cell">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.normal}`}>
          {task.priority}
        </span>
      </td>
      {/* Age / Deadline */}
      <td className="py-2.5 px-2 whitespace-nowrap w-32 hidden lg:table-cell">
        <p className="text-xs text-slate-500">{timeAgo(task.created_at)}</p>
        {task.tat_deadline && (
          <p className={`text-xs ${task.risk === "breached" ? "text-red-500 font-semibold" : "text-slate-400"}`}>
            due {fmtDeadline(task.tat_deadline)}
          </p>
        )}
      </td>
      {/* Actions */}
      <td className="py-2.5 pl-2 pr-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5 justify-end">
          {task.action_url && (
            <a
              href={task.action_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Open
            </a>
          )}
          <button
            onClick={onOpen}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Review
          </button>
          {task.source !== "derived" && (
            <button
              onClick={(e) => { e.stopPropagation(); onQuickAct(); }}
              disabled={acting}
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              {acting ? <Loader className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
              Act
            </button>
          )}
          {showReassign && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                import("sonner").then(({ toast }) => toast.info("Reassignment coming in the next update."));
              }}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-50 transition-colors"
            >
              Reassign
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Acted row (recently acted this session) ───────────────────────────────────

function ActedRow({ task, actedAt }: { task: PendingTask; actedAt: string }) {
  return (
    <tr className="border-b border-slate-100 last:border-0 opacity-60">
      <td className="py-2 pl-3 pr-2 whitespace-nowrap w-24">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
          <CheckCheck className="h-3 w-3" /> Acted
        </span>
      </td>
      <td className="py-2 px-2 whitespace-nowrap w-28 hidden sm:table-cell">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
          {MODULE_LABELS[task.module] ?? humaniseModuleKey(task.module)}
        </span>
      </td>
      <td className="py-2 px-2 min-w-0 max-w-xs">
        <p className="text-sm font-medium text-slate-500 leading-snug truncate line-through">{task.title}</p>
        {(task.employee_name || task.requested_by_name) && (
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            {task.employee_name ?? `by ${task.requested_by_name}`}
            {task.branch_name ? ` · ${task.branch_name}` : ""}
          </p>
        )}
      </td>
      <td className="py-2 px-2 whitespace-nowrap w-20 hidden md:table-cell">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.normal}`}>
          {task.priority}
        </span>
      </td>
      <td className="py-2 px-2 whitespace-nowrap w-32 hidden lg:table-cell">
        <p className="text-xs text-slate-400">{timeAgo(actedAt)}</p>
      </td>
      <td className="py-2 pl-2 pr-3 whitespace-nowrap">
        {task.action_url && (
          <a
            href={task.action_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
          >
            Open
          </a>
        )}
      </td>
    </tr>
  );
}

// ── Group Row ─────────────────────────────────────────────────────────────────

function GroupRow({
  group,
  onExpand,
  expanded,
  onBulkAct,
  acting,
  onOpenItem,
  onActItem,
}: {
  group: GroupedItem;
  onExpand: () => void;
  expanded: boolean;
  onBulkAct: () => void;
  acting: boolean;
  onOpenItem: (task: PendingTask) => void;
  onActItem: (task: PendingTask) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const rs = RISK_STYLES[group.worstRisk];
  const label = MODULE_LABELS[group.module] ?? humaniseModuleKey(group.module);

  const handleBulkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
  };

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
    onBulkAct();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
  };

  return (
    <>
      <tr className={`border-b border-slate-100 bg-slate-50/60 hover:bg-slate-100/80 transition-colors ${rs.row}`}>
        {/* Count badge + risk */}
        <td className="py-2.5 pl-3 pr-2 whitespace-nowrap w-24">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center rounded-full bg-slate-800 text-white text-[10px] font-black px-2 py-0.5 min-w-[1.5rem]">
              {group.items.length}
            </span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${rs.badge}`}>
              {group.worstRisk === "due_soon" ? "Due Soon"
                : group.worstRisk === "on_track" ? "On Track"
                : group.worstRisk.charAt(0).toUpperCase() + group.worstRisk.slice(1)}
            </span>
          </div>
        </td>
        {/* Module */}
        <td className="py-2.5 px-2 whitespace-nowrap w-28 hidden sm:table-cell">
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
            {label}
          </span>
        </td>
        {/* Description */}
        <td className="py-2.5 px-2 min-w-0 max-w-xs">
          <p className="text-sm font-semibold text-slate-700 leading-snug">
            {label}
            {group.branch_name && (
              <span className="ml-1.5 font-normal text-slate-400">· {group.branch_name}</span>
            )}
          </p>
          {confirming && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-xs text-amber-700 font-medium">
                Close all {group.items.length} items?
              </span>
              <button
                onClick={handleConfirm}
                className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-bold text-white hover:bg-slate-700"
              >
                Yes, close all
              </button>
              <button
                onClick={handleCancel}
                className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          )}
        </td>
        {/* Priority */}
        <td className="py-2.5 px-2 whitespace-nowrap w-20 hidden md:table-cell">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${PRIORITY_STYLES[group.highestPriority] ?? PRIORITY_STYLES.normal}`}>
            {group.highestPriority}
          </span>
        </td>
        {/* Age placeholder */}
        <td className="py-2.5 px-2 whitespace-nowrap w-32 hidden lg:table-cell">
          <p className="text-xs text-slate-400">{group.items.length} items</p>
        </td>
        {/* Actions */}
        <td className="py-2.5 pl-2 pr-3 whitespace-nowrap">
          <div className="flex items-center gap-1.5 justify-end">
            <button
              onClick={onExpand}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Collapse" : "Expand"}
            </button>
            {!confirming && (
              <button
                onClick={handleBulkClick}
                disabled={acting}
                className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                {acting ? <Loader className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                Close All ({group.items.length})
              </button>
            )}
          </div>
        </td>
      </tr>
      {/* Expanded individual rows */}
      {expanded && group.items.map((task) => (
        <TaskRow
          key={`${task.source}-${task.id}`}
          task={task}
          onOpen={() => onOpenItem(task)}
          onQuickAct={() => onActItem(task)}
          acting={false}
        />
      ))}
    </>
  );
}

// ── Table chrome ─────────────────────────────────────────────────────────────

function TableHead() {
  return (
    <thead>
      <tr className="border-b border-slate-200 bg-slate-50">
        <th className="py-2 pl-3 pr-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-24">Risk</th>
        <th className="py-2 px-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-28 hidden sm:table-cell">Module</th>
        <th className="py-2 px-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Task</th>
        <th className="py-2 px-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-20 hidden md:table-cell">Priority</th>
        <th className="py-2 px-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-32 hidden lg:table-cell">Age</th>
        <th className="py-2 pl-2 pr-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">Actions</th>
      </tr>
    </thead>
  );
}

// ── Section Classifier ────────────────────────────────────────────────────────

const EXCLUSIVE_MODULES = new Set([
  "exit_clearance", "resignation", "bgv", "payroll_attendance_conflict", "pip_checkpoint",
]);

function classifyItem(item: PendingTask | GroupedItem): "needs_you" | "team_can_handle" {
  if ("kind" in item && item.kind === "group") {
    if (item.worstRisk === "breached" || item.worstRisk === "due_soon") return "needs_you";
    return "team_can_handle";
  }
  const task = item as PendingTask;
  if (task.risk === "breached" || task.risk === "due_soon") return "needs_you";
  if (task.priority === "urgent" || task.priority === "high") return "needs_you";
  if (task.source === "derived") return "needs_you";
  if (EXCLUSIVE_MODULES.has(task.module)) return "needs_you";
  return "team_can_handle";
}

function SectionDivider({
  label,
  count,
  actionLabel,
  onAction,
}: {
  label: string;
  count: number;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <tr>
      <td colSpan={6} className="px-3 pt-4 pb-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{count}</span>
          </div>
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Keyboard Navigation ───────────────────────────────────────────────────────

function useKeyboardNav(opts: {
  itemCount: number;
  focusedIndex: number;
  setFocusedIndex: (n: number) => void;
  onAct: (index: number) => void;
  onOpen: (index: number) => void;
  onOpenUrl: (index: number) => void;
  onToggleLegend: () => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const { itemCount, focusedIndex, setFocusedIndex, onAct, onOpen, onOpenUrl, onToggleLegend } = optsRef.current;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex(focusedIndex < itemCount - 1 ? focusedIndex + 1 : 0);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex(focusedIndex > 0 ? focusedIndex - 1 : itemCount - 1);
          break;
        case "a":
          if (focusedIndex >= 0) { e.preventDefault(); onAct(focusedIndex); }
          break;
        case "o":
          if (focusedIndex >= 0) { e.preventDefault(); onOpenUrl(focusedIndex); }
          break;
        case "d":
          if (focusedIndex >= 0) { e.preventDefault(); onOpen(focusedIndex); }
          break;
        case "?":
          e.preventDefault();
          onToggleLegend();
          break;
        case "Escape":
          setFocusedIndex(-1);
          break;
        case "s":
          if (focusedIndex >= 0) {
            e.preventDefault();
            import("sonner").then(({ toast }) => toast.info("Snooze coming in the next update."));
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
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

  // Track items acted this session (for the "Recently Acted" section)
  const [actedItems, setActedItems] = useState<(PendingTask & { acted_at: string })[]>([]);
  const [showActed, setShowActed] = useState(false);
  // Per-row acting spinner state
  const [actingIds, setActingIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [showKeyLegend, setShowKeyLegend] = useState(false);
  const [bulkActingKeys, setBulkActingKeys] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();
  const canRunTriage = useHasRole("super_admin");
  const [triageRunning, setTriageRunning] = useState(false);
  const [triageMsg, setTriageMsg]         = useState<string | null>(null);

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

  const runTriage = useCallback(async () => {
    setTriageRunning(true);
    setTriageMsg(null);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { processed: number; outcomes: Record<string, number> } }>(
        "/api/ai/triage/run",
      );
      const { processed, outcomes } = res.data ?? res as unknown as { processed: number; outcomes: Record<string, number> };
      if (processed === 0) {
        setTriageMsg("No untriaged complaints found.");
      } else {
        const parts = Object.entries(outcomes).map(([k, v]) => `${v} ${k}`).join(", ");
        setTriageMsg(`Triaged ${processed} complaint(s): ${parts}.`);
      }
      void load();
    } catch (err) {
      setTriageMsg(err instanceof Error ? err.message : "Triage run failed.");
    } finally {
      setTriageRunning(false);
    }
  }, [load]);

  useEffect(() => { void load(); }, [load]);

  const moduleCounts = summary?.by_module ?? {};
  const moduleList = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]);

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

  const groupedFiltered = groupItems(filtered);
  const needsYou = groupedFiltered.filter((r) => classifyItem(r) === "needs_you");
  const teamCanHandle = groupedFiltered.filter((r) => classifyItem(r) === "team_can_handle");

  // Shared bookkeeping for both completeTask (tat/work_item/inbox) and decideDerivedTask
  // (leave/exit-clearance/BGV) — the API calls differ, but "remove it from the pending
  // list, record it as acted this session, decrement the summary counters, refresh the
  // notification bell" is identical either way.
  const recordActed = (task: PendingTask, label?: string) => {
    setItems((prev) => prev.filter((i) => i.id !== task.id));
    setActedItems((prev) => [{ ...task, ...(label ? { title: label } : {}), acted_at: new Date().toISOString() }, ...prev]);
    setSummary((prev) =>
      prev
        ? {
            ...prev,
            total: Math.max(0, prev.total - 1),
            [task.risk]: Math.max(0, prev[task.risk] - 1),
            by_module: {
              ...prev.by_module,
              [task.module]: Math.max(0, (prev.by_module[task.module] ?? 1) - 1),
            },
          }
        : prev,
    );
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
  };

  const completeTask = async (id: string, remarks: string) => {
    const task = items.find((i) => i.id === id);
    if (!task) return;

    setActingIds((prev) => new Set(prev).add(id));
    try {
      if (task.source === "tat") {
        await hrmsApi.post(`/api/governance/tat/tasks/${id}/complete`, { remarks: remarks || undefined });
      } else if (task.source === "work_item") {
        await hrmsApi.post(`/api/work-inbox/${id}/complete`, { remarks: remarks || undefined });
      } else if (task.source === "derived") {
        throw new Error("This item has no generic completion action — use Approve/Reject instead.");
      } else {
        await hrmsApi.patch(`/api/inbox/${id}/actioned`, {});
      }
      recordActed(task);
    } finally {
      setActingIds((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
    }
  };

  // The real Approve/Reject for a "derived" item (leave_request / exit_clearance_task /
  // candidate_bgv_check) — dispatches to backend/src/modules/inbox/inbox-derived.service.ts,
  // which writes the item's OWN status column via the same service/scope functions its real
  // page uses. This is what "Act & Close" was never able to be for these three types: the
  // frontend used to throw before calling anything at all.
  const decideDerivedTask = async (task: PendingTask, decision: "approve" | "reject", remarks: string) => {
    if (!task.entity_type || !task.entity_id) throw new Error("This item is missing entity information and cannot be actioned.");
    setActingIds((prev) => new Set(prev).add(task.id));
    try {
      await hrmsApi.post(`/api/inbox/derived/${task.entity_type}/${task.entity_id}/decide`, { decision, remarks: remarks || undefined });
      recordActed(task, `${task.title} — ${decision === "approve" ? "Approved" : "Rejected"}`);
    } finally {
      setActingIds((prev) => {
        const s = new Set(prev);
        s.delete(task.id);
        return s;
      });
    }
  };

  const bulkActGroup = async (group: GroupedItem) => {
    setBulkActingKeys((prev) => new Set(prev).add(group.groupKey));
    try {
      const ids = group.items.map((i) => i.id);
      const res = await hrmsApi.post<{
        success: boolean;
        actioned: number;
        failed: { id: string; reason: string }[];
      }>("/api/inbox/bulk-actioned", {
        ids,
        source: group.source,
        remarks: "Bulk acknowledged",
      });

      const failedIds = new Set((res.failed ?? []).map((f) => f.id));
      const succeededIds = ids.filter((id) => !failedIds.has(id));

      setItems((prev) => prev.filter((i) => !succeededIds.includes(i.id)));

      if (succeededIds.length) {
        const firstItem = group.items[0];
        setActedItems((prev) => [
          {
            ...firstItem,
            title: `Batch (${succeededIds.length} items) — ${MODULE_LABELS[group.module] ?? humaniseModuleKey(group.module)}${group.branch_name ? ` · ${group.branch_name}` : ""}`,
            acted_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }

      setSummary((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, by_module: { ...prev.by_module } };
        for (const item of group.items) {
          if (failedIds.has(item.id)) continue;
          updated.total = Math.max(0, updated.total - 1);
          updated[item.risk] = Math.max(0, (updated[item.risk] as number ?? 1) - 1);
          updated.by_module[item.module] = Math.max(0, (updated.by_module[item.module] ?? 1) - 1);
        }
        return updated;
      });

      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });

      if (res.failed?.length) {
        import("sonner").then(({ toast }) => {
          toast.warning(`${succeededIds.length} of ${ids.length} items closed. ${res.failed.length} were already actioned or not found.`);
        });
      }
    } catch {
      import("sonner").then(({ toast }) => {
        toast.error("Bulk action failed. Please try again.");
      });
    } finally {
      setBulkActingKeys((prev) => {
        const s = new Set(prev);
        s.delete(group.groupKey);
        return s;
      });
    }
  };

  useKeyboardNav({
    itemCount: filtered.length,
    focusedIndex,
    setFocusedIndex,
    onAct: (index) => {
      const item = filtered[index];
      if (!item || "kind" in item) return;
      const task = item as PendingTask;
      if (task.source !== "derived") void completeTask(task.id, "");
    },
    onOpen: (index) => {
      const item = filtered[index];
      if (!item || "kind" in item) return;
      setSelected(item as PendingTask);
    },
    onOpenUrl: (index) => {
      const item = filtered[index];
      if (!item || "kind" in item) return;
      const url = (item as PendingTask).action_url;
      if (url) window.open(url, "_blank");
    },
    onToggleLegend: () => setShowKeyLegend((v) => !v),
  });

  return (
    <DashboardLayout>
      <main className="space-y-5 p-5 lg:p-7">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 px-7 py-6 text-white shadow-xl">
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/5 blur-3xl" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-1.5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                <Zap className="h-3 w-3" /> All Modules
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-black tracking-tight">Work Inbox</h1>
                {(summary?.total ?? 0) > 0 && (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-xs font-black text-white shadow-lg animate-pulse">
                    {summary!.total}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-blue-200 text-sm">Your pending tasks across all platform modules</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                {canRunTriage && (
                  <button
                    onClick={() => void runTriage()}
                    disabled={triageRunning}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600/80 px-3.5 py-2 text-xs font-bold text-white backdrop-blur-sm hover:bg-indigo-600 transition-all disabled:opacity-50"
                  >
                    <Wand2 className={`h-3.5 w-3.5 ${triageRunning ? "animate-spin" : ""}`} />
                    {triageRunning ? "Triaging…" : "Run Triage"}
                  </button>
                )}
                <button
                  onClick={() => void load()}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold text-white backdrop-blur-sm hover:bg-white/20 transition-all disabled:opacity-50"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  onClick={() => setShowKeyLegend((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold text-white backdrop-blur-sm hover:bg-white/20 transition-all"
                  title="Keyboard shortcuts (?)"
                >
                  <span className="font-mono">?</span>
                </button>
              </div>
              {triageMsg && (
                <p className="text-xs text-indigo-200 max-w-xs text-right">{triageMsg}</p>
              )}
            </div>
          </div>
        </div>

        {/* KPI Strip */}
        <KpiStrip summary={summary} loading={loading} />

        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm font-bold text-amber-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {summary?.truncated && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm font-semibold text-slate-600">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-slate-400" />
            Showing the first batch of results — use filters to narrow down further.
          </div>
        )}

        {/* Filters */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description, employee or requester…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
          />
          <div className="flex flex-wrap gap-4">
            {/* Module */}
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Module</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setActiveModule("all")}
                  className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${activeModule === "all" ? "bg-slate-950 text-white shadow" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  All <span className="ml-1 opacity-60">{summary?.total ?? 0}</span>
                </button>
                {moduleList.map(([mod, count]) => (
                  <button
                    key={mod}
                    onClick={() => setActiveModule(mod)}
                    className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${activeModule === mod ? "bg-blue-600 text-white shadow" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    {MODULE_LABELS[mod] ?? humaniseModuleKey(mod)} <span className="ml-1 opacity-60">{count}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* Risk */}
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Risk</p>
              <div className="flex flex-wrap gap-1.5">
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
                      className={`rounded-lg px-3 py-1 text-xs font-bold capitalize transition-all hover:opacity-90 ${styles[r]}`}
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
        </div>

        {/* Pending tasks table */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-7 w-7 animate-spin text-slate-400" />
            </div>
          ) : groupedFiltered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <BellOff className="mb-3 h-9 w-9 opacity-30" />
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse">
                <TableHead />
                <tbody>
                  {needsYou.length > 0 && (
                    <SectionDivider label="Needs You" count={needsYou.length} />
                  )}
                  {needsYou.map((row) => {
                    if ("kind" in row && row.kind === "group") {
                      return (
                        <GroupRow
                          key={row.groupKey}
                          group={row}
                          expanded={expandedGroups.has(row.groupKey)}
                          onExpand={() =>
                            setExpandedGroups((prev) => {
                              const s = new Set(prev);
                              s.has(row.groupKey) ? s.delete(row.groupKey) : s.add(row.groupKey);
                              return s;
                            })
                          }
                          onBulkAct={() => void bulkActGroup(row)}
                          acting={bulkActingKeys.has(row.groupKey)}
                          onOpenItem={(task) => setSelected(task)}
                          onActItem={(task) => void completeTask(task.id, "")}
                        />
                      );
                    }
                    const task = row as PendingTask;
                    const rowIndex = groupedFiltered.indexOf(row);
                    return (
                      <TaskRow
                        key={`${task.source}-${task.id}`}
                        task={task}
                        onOpen={() => setSelected(task)}
                        onQuickAct={() => void completeTask(task.id, "")}
                        acting={actingIds.has(task.id)}
                        focused={rowIndex === focusedIndex}
                      />
                    );
                  })}

                  {teamCanHandle.length > 0 && (
                    <SectionDivider
                      label="Your Team Can Handle"
                      count={teamCanHandle.length}
                    />
                  )}
                  {teamCanHandle.map((row) => {
                    if ("kind" in row && row.kind === "group") {
                      return (
                        <GroupRow
                          key={row.groupKey}
                          group={row}
                          expanded={expandedGroups.has(row.groupKey)}
                          onExpand={() =>
                            setExpandedGroups((prev) => {
                              const s = new Set(prev);
                              s.has(row.groupKey) ? s.delete(row.groupKey) : s.add(row.groupKey);
                              return s;
                            })
                          }
                          onBulkAct={() => void bulkActGroup(row)}
                          acting={bulkActingKeys.has(row.groupKey)}
                          onOpenItem={(task) => setSelected(task)}
                          onActItem={(task) => void completeTask(task.id, "")}
                        />
                      );
                    }
                    const task = row as PendingTask;
                    const rowIndex = groupedFiltered.indexOf(row);
                    return (
                      <TaskRow
                        key={`${task.source}-${task.id}`}
                        task={task}
                        onOpen={() => setSelected(task)}
                        onQuickAct={() => void completeTask(task.id, "")}
                        acting={actingIds.has(task.id)}
                        focused={rowIndex === focusedIndex}
                        showReassign
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recently Acted (this session) */}
        {actedItems.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <button
              onClick={() => setShowActed((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-bold text-slate-700">
                  Recently Acted
                </span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  {actedItems.length} this session
                </span>
              </div>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${showActed ? "rotate-180" : ""}`} />
            </button>
            {showActed && (
              <div className="border-t border-slate-100 overflow-x-auto">
                <table className="w-full min-w-[600px] border-collapse">
                  <TableHead />
                  <tbody>
                    {actedItems.map((item) => (
                      <ActedRow
                        key={`acted-${item.source}-${item.id}`}
                        task={item}
                        actedAt={item.acted_at}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      <ActionSheet
        task={selected}
        onClose={() => setSelected(null)}
        onComplete={completeTask}
        onDecide={decideDerivedTask}
      />

      {showKeyLegend && (
        <div className="fixed bottom-4 right-4 z-50 rounded-2xl border border-slate-200 bg-white shadow-2xl p-4 w-56">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Keyboard shortcuts</p>
            <button onClick={() => setShowKeyLegend(false)} className="p-1 rounded hover:bg-slate-100">
              <X className="h-3.5 w-3.5 text-slate-400" />
            </button>
          </div>
          <div className="space-y-1.5 text-xs text-slate-600">
            {([
              ["J / K", "Navigate rows"],
              ["A", "Act on row"],
              ["D", "Review sheet"],
              ["O", "Open link"],
              ["S", "Snooze (soon)"],
              ["?", "Toggle this panel"],
              ["Esc", "Clear focus"],
            ] as [string, string][]).map(([key, desc]) => (
              <div key={key} className="flex justify-between">
                <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{key}</kbd>
                <span className="text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
