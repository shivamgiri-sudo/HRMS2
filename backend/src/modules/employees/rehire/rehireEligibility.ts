/**
 * Rehire eligibility, as a pure function of facts. No DB access here on purpose: it runs at
 * raise time and again at approval time, and both must reach the same answer from the same facts.
 *
 * blocked   cannot rejoin through this flow (only the disciplinary flag can be lifted, and only
 *           by a super_admin through a separate audited action — see blockLifted)
 * review    may rejoin; the branch head sees the reasons in red on the dossier
 * eligible  clean
 *
 * Unknown never means allowed: a leaver with no usable exit signal is `review`.
 */

export type RehireStatus = "blocked" | "review" | "eligible";

export interface RehireFacts {
  hasExitRecord: boolean;
  exitType: string | null;
  exitSubType: string | null;
  exitReasonCategory: string | null;
  /** employees.employment_status text; used only when there is no exit record. */
  legacyStatusText: string | null;
  disciplinaryFlag: boolean;
  /** A super_admin has lifted the disciplinary block. Never lifts termination or misconduct. */
  blockLifted: boolean;
  gapDays: number;
  priorRejoinCount: number;
  /** Count of this employee's exits with sub-type absconding/abandonment, including the current one. */
  totalAbscondingExits: number;
  openClearanceCase: boolean;
  assetsUnreturned: boolean;
  ffAlreadyPaid: boolean;
}

export interface RehireReason {
  code: string;
  severity: "blocked" | "review";
  message: string;
}

export interface RehireVerdict {
  status: RehireStatus;
  reasons: RehireReason[];
  requiresFreshOnboarding: boolean;
  requiresAbscondingAck: boolean;
}

export const MAX_REJOIN_GAP_DAYS = 30;

const norm = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();

export function evaluateRehire(f: RehireFacts): RehireVerdict {
  const reasons: RehireReason[] = [];
  const add = (severity: RehireReason["severity"], code: string, message: string) =>
    reasons.push({ code, severity, message });

  const sub = norm(f.exitSubType);
  const reason = norm(f.exitReasonCategory);
  const isAbsconding = sub === "absconding" || sub === "abandonment" || reason === "absconding";

  // ── Blocked ──
  if (sub === "termination") {
    add("blocked", "TERMINATED", "Left through termination; rejoining is not allowed.");
  }
  if (reason === "termination_misconduct") {
    add("blocked", "MISCONDUCT", "Exit reason is misconduct; rejoining is not allowed.");
  }
  if (reason === "performance_action") {
    add("blocked", "PERFORMANCE_ACTION", "Company-initiated performance exit; rejoining is not allowed.");
  }
  if (f.disciplinaryFlag && !f.blockLifted) {
    add("blocked", "DISCIPLINARY_FLAG", "HR has recorded a disciplinary flag on this employee.");
  }
  if (!f.hasExitRecord && /terminat|misconduct/.test(norm(f.legacyStatusText))) {
    add("blocked", "LEGACY_TERMINATED", "Legacy status shows a termination or misconduct exit.");
  }
  if (isAbsconding && f.totalAbscondingExits >= 2) {
    add("blocked", "REPEAT_ABSCONDING", "Absconded more than once; rejoining is not allowed.");
  }
  if (f.gapDays < 0) {
    add("blocked", "REJOIN_BEFORE_EXIT", "Proposed rejoin date is before the exit date.");
  }
  const requiresFreshOnboarding = f.gapDays > MAX_REJOIN_GAP_DAYS;
  if (requiresFreshOnboarding) {
    add("blocked", "GAP_EXCEEDS_30", "Gap exceeds 30 days; fresh ATS onboarding with new documents and background verification is required.");
  }

  // ── Review ──
  const requiresAbscondingAck = isAbsconding;
  if (isAbsconding) {
    add("review", "ABSCONDING", "Left by absconding; the branch head must acknowledge and give remarks.");
  }
  if (!f.hasExitRecord && !/terminat|misconduct/.test(norm(f.legacyStatusText))) {
    add("review", "NO_EXIT_SIGNAL", "No exit record on file; the reason for leaving cannot be verified.");
  }
  if (f.openClearanceCase) add("review", "OPEN_CLEARANCE", "Exit clearance is still open.");
  if (f.assetsUnreturned) add("review", "ASSETS_UNRETURNED", "Company assets were not returned.");
  if (f.ffAlreadyPaid) add("review", "FF_ALREADY_PAID", "Full and final settlement was already paid; payroll will be told to review recovery.");
  if (f.priorRejoinCount > 0) add("review", "PREVIOUS_REJOIN", "Employee has rejoined before.");

  const status: RehireStatus = reasons.some((r) => r.severity === "blocked")
    ? "blocked"
    : reasons.length > 0
      ? "review"
      : "eligible";

  return { status, reasons, requiresFreshOnboarding, requiresAbscondingAck };
}
