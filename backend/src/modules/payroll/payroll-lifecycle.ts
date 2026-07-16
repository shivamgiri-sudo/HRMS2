export type RunStatus = "draft" | "calculating" | "calculated" | "under_review" | "approved" | "locked" | "disbursed" | "cancelled";

const ALLOWED_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  draft:        ["calculating", "cancelled"],
  calculating:  ["calculated", "draft"],
  calculated:   ["under_review", "draft"],
  under_review: ["approved", "calculated", "draft"],
  approved:     ["locked", "under_review"],
  locked:       ["disbursed"],
  disbursed:    [],
  cancelled:    ["draft"],
};

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["disbursed"]);

export function validateTransition(from: RunStatus, to: RunStatus): { valid: boolean; reason?: string } {
  if (from === to) return { valid: false, reason: `Run is already ${from}` };
  if (TERMINAL_STATUSES.has(from)) return { valid: false, reason: `Cannot transition from terminal status "${from}"` };
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return { valid: false, reason: `Transition ${from} → ${to} is not allowed. Valid targets: ${(allowed ?? []).join(", ") || "none"}` };
  }
  return { valid: true };
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canEdit(status: RunStatus): boolean {
  return status === "draft" || status === "calculating";
}

export function getAllowedTransitions(from: RunStatus): RunStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}
