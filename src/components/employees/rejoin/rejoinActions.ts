/**
 * Pure helpers behind the rejoin page's mutations and the raise dialog: what to send, how to read a
 * refusal, who may do what. Kept free of React so they are unit-tested without a DOM; the server
 * enforces the same rules (employee-reactivation.routes.ts), this only stops a doomed submit and
 * explains what is missing.
 */
import type { RehireVerdict } from "./rejoinTypes";
import { isAwaitingBranchHead } from "./rejoinDecisionRules";

export type BranchAction = "approved" | "rejected";

export interface BranchActionBody {
  action: BranchAction;
  remarks: string;
  absconding_acknowledged: boolean;
}

/** Body for POST /api/employees/reactivation/:id/branch-action. */
export function buildBranchActionBody(
  action: BranchAction,
  remarks: string,
  ack: { needsAck: boolean; acknowledged: boolean },
): BranchActionBody {
  return {
    action,
    remarks: remarks.trim(),
    // Only an approval of an absconding case is acknowledged; anything else would record a false claim.
    absconding_acknowledged: action === "approved" && ack.needsAck && ack.acknowledged,
  };
}

// ── Errors ───────────────────────────────────────────────────────────────────

const GENERIC = "Something went wrong. Please try again.";

function isVerdict(v: unknown): v is RehireVerdict {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (o.status === "eligible" || o.status === "review" || o.status === "blocked") && Array.isArray(o.reasons);
}

function errorStatus(err: unknown): number | null {
  const s = err && typeof err === "object" ? (err as { status?: unknown }).status : undefined;
  return typeof s === "number" ? s : null;
}

function errorPayload(err: unknown): Record<string, unknown> | null {
  const p = err && typeof err === "object" ? (err as { payload?: unknown }).payload : undefined;
  return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
}

export interface ApiErrorView {
  status: number | null;
  /** The backend `message`, verbatim (plus the first validation error when it is zod's "Invalid input"). */
  message: string;
  /** Fresh eligibility the server returned with a refusal, if any. */
  eligibility: RehireVerdict | null;
  requiresFreshOnboarding: boolean;
  /** The page's dossier is stale: reload it so the verdict strip / status show what the server saw. */
  refetchDossier: boolean;
}

/** Reads an error thrown by hrmsApi (HrmsApiError carries `status` and the parsed body as `payload`). */
export function interpretApiError(err: unknown): ApiErrorView {
  const status = errorStatus(err);
  const payload = errorPayload(err);
  const own = err instanceof Error && err.message ? err.message : null;
  let message = typeof payload?.message === "string" && payload.message ? payload.message : own ?? GENERIC;

  const errors = payload?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { path?: unknown; message?: unknown };
    if (typeof first?.message === "string") {
      const path = Array.isArray(first.path) && first.path.length ? `${first.path.join(".")}: ` : "";
      message = `${message}: ${path}${first.message}`;
    }
  }

  const eligibility = isVerdict(payload?.eligibility) ? payload!.eligibility as RehireVerdict : null;
  const requiresFreshOnboarding = payload?.reason === "REQUIRES_FRESH_ONBOARDING" || eligibility?.requiresFreshOnboarding === true;
  const notPending = status === 400 && /not pending/i.test(message);

  return { status, message, eligibility, requiresFreshOnboarding, refetchDossier: eligibility !== null || notPending };
}

export interface DossierErrorView {
  kind: "forbidden" | "not_found" | "other";
  title: string;
  message: string;
  retry: boolean;
}

/** What the review page shows when the dossier query fails. */
export function dossierErrorView(err: unknown): DossierErrorView {
  const { status, message } = interpretApiError(err);
  if (status === 403) {
    return {
      kind: "forbidden",
      title: "This request is not in your scope",
      message: "The employee is outside your branch or assigned scope, so you cannot review this request.",
      retry: false,
    };
  }
  if (status === 404) {
    return {
      kind: "not_found",
      title: "Request not found",
      message: "This rejoin request does not exist. It may have been removed, or the link is wrong.",
      retry: false,
    };
  }
  return { kind: "other", title: "Could not load the review", message, retry: true };
}

// ── Follow-ups after an approval ─────────────────────────────────────────────

const FOLLOW_UP_LABEL: Record<string, string> = {
  auth: "Login account",
  lms: "LMS enrolment",
  it_provisioning: "IT provisioning",
};

export interface FollowUpFailure {
  step: string;
  label: string;
  detail: string | null;
}

/** Failed post-approval steps (`followUps` with `ok:false`). The approval itself already stands. */
export function followUpFailures(followUps: unknown): FollowUpFailure[] {
  if (!Array.isArray(followUps)) return [];
  return followUps
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && (f as { ok?: unknown }).ok === false)
    .map((f) => {
      const step = typeof f.step === "string" && f.step ? f.step : "unknown";
      return {
        step,
        label: FOLLOW_UP_LABEL[step] ?? (step === "unknown" ? "Unknown step" : step),
        detail: typeof f.detail === "string" && f.detail ? f.detail : null,
      };
    });
}

export function followUpWarning(followUps: unknown): string | null {
  const failed = followUpFailures(followUps);
  if (!failed.length) return null;
  const list = failed.map((f) => (f.detail ? `${f.label} (${f.detail})` : f.label)).join("; ");
  return `Approved, but some follow-up steps need attention: ${list}.`;
}

// ── Roles ────────────────────────────────────────────────────────────────────

/** POST /branch-action is requireRole("branch_head"). */
export const DECIDE_ROLES = ["branch_head"] as const;
/** POST /initiate is requireRole("hr","admin","super_admin","manager"). */
export const RAISE_ROLES = ["hr", "admin", "super_admin", "manager"] as const;
/** GET /:id/dossier is requireRole("branch_head","hr","admin","super_admin"); the route mirrors it. */
export const REVIEW_ROLES = ["branch_head", "hr", "admin", "super_admin"] as const;

const hasAny = (roleKeys: readonly string[], roles: readonly string[]) => roles.some((r) => roleKeys.includes(r));

export const canDecideRejoin = (roleKeys: readonly string[]) => hasAny(roleKeys, DECIDE_ROLES);
export const canRaiseRejoin = (roleKeys: readonly string[]) => hasAny(roleKeys, RAISE_ROLES);
export const canOpenRejoinReview = (roleKeys: readonly string[]) => hasAny(roleKeys, REVIEW_ROLES);

export const rejoinReviewPath = (id: string) => `/employees/reactivation/${encodeURIComponent(id)}/review`;

/** "Review" for a branch head on a request awaiting their decision, "View" for anyone else who may open the page. */
export function reviewLinkFor(request: { id: string; status: string }, roleKeys: readonly string[]): { href: string; label: "Review" | "View" } | null {
  if (!canOpenRejoinReview(roleKeys)) return null;
  const label = canDecideRejoin(roleKeys) && isAwaitingBranchHead(request.status) ? "Review" : "View";
  return { href: rejoinReviewPath(request.id), label };
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const rejoinDossierKey = (id: string) => ["rejoin-dossier", id] as const;
/** Prefix for every reactivation list/detail query. */
export const REACTIVATION_QUERY_KEY = ["reactivation"] as const;

// ── Raise dialog ─────────────────────────────────────────────────────────────

/** GET /api/employees/:id/rehire-eligibility → data. */
export interface RehireEligibilityCheck {
  employeeId: string;
  proposedJoiningDate: string;
  gapDays: number;
  previousEndDate: string | null;
  eligibility: RehireVerdict;
}

export type EligibilityCheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ok"; data: RehireEligibilityCheck };

export const MIN_RAISE_REASON = 10;

export interface RaiseSubmitState {
  /** `fresh_onboarding` replaces the submit with the "needs fresh ATS onboarding" message. */
  mode: "submit" | "fresh_onboarding";
  canSubmit: boolean;
  why: string | null;
}

export function raiseSubmitState(input: {
  employeeId: string | null;
  joiningDate: string;
  reason: string;
  check: EligibilityCheckState;
}): RaiseSubmitState {
  const no = (why: string, mode: RaiseSubmitState["mode"] = "submit"): RaiseSubmitState => ({ mode, canSubmit: false, why });

  if (!input.employeeId) return no("Pick the employee first.");
  if (!input.joiningDate) return no("Pick the proposed joining date.");

  const { check } = input;
  if (check.status === "idle" || check.status === "loading") return no("Checking eligibility…");
  if (check.status === "ok") {
    const v = check.data.eligibility;
    if (v.requiresFreshOnboarding) {
      return no(`The gap is ${check.data.gapDays} days (more than 30): this person needs fresh ATS onboarding.`, "fresh_onboarding");
    }
    if (v.status === "blocked") {
      const first = v.reasons.find((r) => r.severity === "blocked");
      return no(`Blocked: ${first?.message ?? "rejoin is not allowed."}`);
    }
  }
  // check.status === "error": the lookup failed, not the rules. /initiate re-checks, so do not block on it.

  const len = input.reason.trim().length;
  if (len < MIN_RAISE_REASON) return no(`The reason needs at least ${MIN_RAISE_REASON} characters (${len}/${MIN_RAISE_REASON}).`);

  return { mode: "submit", canSubmit: true, why: null };
}

// ── Review page ──────────────────────────────────────────────────────────────

const STATUS_BANNER: Record<string, string> = {
  approved: "This request was approved and the employee is active again. Nothing is left to decide.",
  rejected: "This request was rejected. Nothing is left to decide.",
  cancelled: "This request was cancelled. Nothing is left to decide.",
};

/** Legacy status from the old two-step flow: still open, so a neutral note rather than a "closed" banner. */
const LEGACY_AWAITING_NOTE = "Approved earlier by the branch head under the old process; waiting for the final decision.";

/** Banner text when the request is closed (or a legacy open one); null for a plain pending request. */
export function statusBannerFor(status: string): string | null {
  if (status === "pending") return null;
  if (status === "branch_head_approved") return LEGACY_AWAITING_NOTE;
  return STATUS_BANNER[status] ?? `This request is ${status || "in an unknown state"}, so it cannot be actioned.`;
}

/** `YYYY-MM-DD` plus `days`, in UTC so no timezone shifts the date. Returns "" for a bad input. */
export function addDaysIso(date: string | null | undefined, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ""));
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
