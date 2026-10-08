/**
 * Leave request status rules for the Leave page. Pure, no React.
 *
 * The API stores nine status values (pending, pending_branch_head, approved,
 * branch_head_approved, rejected, branch_head_rejected, cancelled, lapsed, discarded). The page
 * only needs seven distinct meanings: the branch-head tier decisions are still "approved" or
 * "rejected" to the person who applied, and an unknown value is treated as still pending so a
 * new backend status can never make a request look finished.
 */
export type LeaveStatusKey = "pending" | "escalated" | "approved" | "rejected" | "cancelled" | "lapsed" | "discarded";

const ESCALATED_RAW = new Set(["pending_branch_head", "branch_head_approved", "branch_head_rejected"]);

export function normalizeLeaveStatus(raw: string): LeaveStatusKey {
  switch (raw) {
    case "pending_branch_head": return "escalated";
    case "approved":
    case "branch_head_approved": return "approved";
    case "rejected":
    case "branch_head_rejected": return "rejected";
    case "cancelled": return "cancelled";
    case "lapsed": return "lapsed";
    case "discarded": return "discarded";
    default: return "pending";
  }
}

/** True when the request went through (or is waiting on) the branch-head exception tier. */
export function isEscalatedRaw(raw: string): boolean {
  return ESCALATED_RAW.has(raw);
}

/** Still needs someone to act. */
export function isOpenStatus(status: LeaveStatusKey): boolean {
  return status === "pending" || status === "escalated";
}

const LABELS: Record<LeaveStatusKey, string> = {
  pending: "Pending",
  escalated: "Awaiting Branch Head",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  lapsed: "Lapsed",
  discarded: "Discarded",
};

export function statusLabel(status: LeaveStatusKey): string {
  return LABELS[status];
}

/**
 * Pill classes per status. Text/background pairs are the app's accessible StatusBadge palette
 * (AA contrast) so every status reads the same way across the product.
 */
export const STATUS_PILL: Record<LeaveStatusKey, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  escalated: "border-blue-200 bg-blue-50 text-blue-800",
  approved: "border-green-200 bg-green-50 text-green-800",
  rejected: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-600",
  lapsed: "border-slate-200 bg-slate-100 text-slate-600",
  discarded: "border-slate-200 bg-slate-100 text-slate-500",
};

export type TimelineKey = "submitted" | "review" | "branch_head" | "decision";
export type TimelineState = "done" | "current" | "upcoming" | "skipped" | "rejected";

export interface TimelineStep {
  key: TimelineKey;
  label: string;
  state: TimelineState;
  /** Who/when, shown under the label. */
  detail?: string;
  at?: string;
}

export interface TimelineInput {
  status: string;
  submittedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

/**
 * The steps a request goes through, for the My Leave list. An escalated request skips the
 * manager step (it is routed straight to the branch head); a cancelled/lapsed one ends with
 * that outcome and has no step left "current".
 */
export function buildTimeline(input: TimelineInput): TimelineStep[] {
  const key = normalizeLeaveStatus(input.status);
  const escalated = isEscalatedRaw(input.status);
  const open = isOpenStatus(key);
  const by = input.reviewedBy ? `by ${input.reviewedBy}` : undefined;

  const steps: TimelineStep[] = [
    { key: "submitted", label: "Submitted", state: "done", at: input.submittedAt },
  ];

  if (escalated) {
    steps.push({ key: "review", label: "Manager review", state: "skipped", detail: "Routed to Branch Head" });
    steps.push({
      key: "branch_head",
      label: "Branch Head review",
      state: key === "escalated" ? "current" : key === "cancelled" ? "skipped" : "done",
      detail: key === "escalated" ? undefined : by,
      at: key === "escalated" ? undefined : input.reviewedAt,
    });
  } else {
    steps.push({
      key: "review",
      label: "Manager review",
      state: open ? "current" : key === "cancelled" || key === "lapsed" || key === "discarded" ? "skipped" : "done",
      detail: open ? undefined : by,
      at: open ? undefined : input.reviewedAt,
    });
  }

  const decisionLabel = open ? "Decision" : statusLabel(key);
  steps.push({
    key: "decision",
    label: decisionLabel,
    state: open ? "upcoming" : key === "rejected" ? "rejected" : "done",
    detail: open ? undefined : by,
    at: open ? undefined : input.reviewedAt,
  });
  return steps;
}
