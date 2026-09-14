export type RunStatus = "draft" | "calculating" | "calculated" | "under_review" | "processing" | "finalized" | "approved" | "locked" | "disbursed" | "cancelled";

const ALLOWED_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  draft:        ["calculating", "cancelled"],
  calculating:  ["calculated", "draft"],
  calculated:   ["under_review", "draft"],
  under_review: ["approved", "calculated", "draft"],
  // 'processing' is what the MAINLINE calculator writes when a run finishes computing
  // (payrollCalculate.service.ts sets it on success, resets to 'draft' on failure), and
  // it is what payroll-signoff.routes.ts filters its pending-sign-off queue on. The
  // calculating/calculated/under_review chain above is a parallel vocabulary that this
  // engine does not write, so without an entry here the real forward path out of the
  // calculator was blocked: validateTransition("processing", "approved") found no key and
  // rejected. One forward target only.
  //
  // No 'draft' target on purpose. The calculator's own failure reset UPDATEs status to
  // 'draft' directly in SQL, guarded by CLOSED_RUN_STATUSES, and never passes through this
  // map — so it needs nothing here, and adding it would create a new API route back into
  // an editable state for an already-computed run. Nothing lists 'processing' as a target
  // either: only the calculator may produce that state.
  processing:   ["approved"],
  // 'finalized' is the status payroll actually finishes runs in — 51 of 66 live
  // salary_prep_run rows hold it, stored uppercase as 'FINALIZED'. It had no entry
  // here at all, so ALLOWED_TRANSITIONS[from] came back undefined and validateTransition
  // rejected unconditionally: every finalized run was structurally unable to reach
  // 'locked' or 'disbursed'. One forward path only — locked — and deliberately no path
  // back to an editable state, matching run-status.ts's CLOSED_RUN_STATUSES, which
  // already treats finalized as closed to recomputation.
  finalized:    ["locked"],
  approved:     ["locked", "under_review"],
  locked:       ["disbursed"],
  disbursed:    [],
  cancelled:    ["draft"],
};

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["disbursed"]);

// salary_prep_run.status is varchar(50), not an enum, and the casing it holds is not
// uniform: 'FINALIZED' is stored uppercase while 'approved'/'draft' are lowercase.
// Comparing raw is what made the finalized rows unreachable, so every comparison in
// this module goes through here — the same case-insensitive treatment run-status.ts's
// isRunClosed() already applies.
function normalize(status: string): RunStatus {
  return String(status).toLowerCase() as RunStatus;
}

export function validateTransition(from: RunStatus, to: RunStatus): { valid: boolean; reason?: string } {
  const f = normalize(from);
  const t = normalize(to);
  if (f === t) return { valid: false, reason: `Run is already ${f}` };
  if (TERMINAL_STATUSES.has(f)) return { valid: false, reason: `Cannot transition from terminal status "${f}"` };
  const allowed = ALLOWED_TRANSITIONS[f];
  if (!allowed || !allowed.includes(t)) {
    return { valid: false, reason: `Transition ${f} → ${t} is not allowed. Valid targets: ${(allowed ?? []).join(", ") || "none"}` };
  }
  return { valid: true };
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(normalize(status));
}

export function canEdit(status: RunStatus): boolean {
  const s = normalize(status);
  return s === "draft" || s === "calculating";
}

export function getAllowedTransitions(from: RunStatus): RunStatus[] {
  return ALLOWED_TRANSITIONS[normalize(from)] ?? [];
}
