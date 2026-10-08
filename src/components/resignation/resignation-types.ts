// Shared types and helpers for the My Resignation page (src/pages/NativeMyResignation.tsx).

export type ExitRequest = {
  id: string;
  employee_id: string;
  status: string;
  exit_reason_category?: string | null;
  resignation_reason?: string | null;
  last_working_day_proposed?: string | null;
  last_working_day_confirmed?: string | null;
  notice_period_days?: number | null;
  notice_start_date?: string | null;
  submitted_at?: string | null;
  manager_actioned_at?: string | null;
  exit_confirmed_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  /** Added by GET /api/exit/resignation/my — computed by MySQL. */
  effective_lwd?: string | null;
  within_lwd?: number | boolean | null;
};

export type RetentionOffer = {
  id: string;
  offer_type: string;
  offer_details: unknown;
  offered_by_name?: string | null;
  offer_date?: string | null;
  created_at?: string | null;
  status?: string | null;
  employee_response: string | null;
  response_remarks: string | null;
};

export type AuditEntry = {
  id: string;
  action: string;
  stage?: string | null;
  performed_by?: string | null;
  performed_by_name?: string | null;
  performed_at: string;
  remarks?: string | null;
};

export type TimelineEvent = {
  id: string;
  type: "joining" | "confirmation" | "promotion" | "transfer" | "increment" | "anniversary" | "milestone";
  date: string;
  title: string;
  detail: string | null;
};

export type AchievementItem = { id: string; title: string; detail: string | null; date: string | null };
export type AchievementSection = { count: number; recent: AchievementItem[] };

export type JourneySummary = {
  profile: {
    employee_id: string;
    employee_code: string | null;
    name: string;
    first_name: string | null;
    designation: string | null;
    branch: string | null;
    department: string | null;
    process: string | null;
    photo_url: string | null;
    date_of_joining: string | null;
  };
  tenure: { years: number; months: number; total_months: number; label: string };
  notice_period_days: number;
  timeline: TimelineEvent[];
  achievements: {
    kudos: AchievementSection & { points: number };
    badges: AchievementSection;
    milestones: AchievementSection;
    recognitions: AchievementSection;
  };
};

export type ApiList<T> = { success: boolean; data: T[] };
export type ApiOne<T> = { success: boolean; data: T; message?: string };

/**
 * The reasons an employee can give for their own resignation — the voluntary subset of the
 * exitReasonCategory enum in backend/src/modules/exit/exit.validation.ts, with the labels of
 * NativeExitManagement's REASON_CATEGORIES. The backend refuses anything else from a self-resignation
 * (SELF_RESIGNATION_REASON_CATEGORIES in resignation.routes.ts).
 */
export const RESIGNATION_REASONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "better_opportunity", label: "Better Opportunity" },
  { code: "career_growth", label: "Career Growth" },
  { code: "compensation", label: "Compensation Dissatisfaction" },
  { code: "relocation", label: "Relocation" },
  { code: "health_personal", label: "Health / Personal Reasons" },
  { code: "family_reasons", label: "Family Reasons" },
  { code: "higher_education", label: "Higher Education" },
  { code: "work_environment", label: "Work Environment" },
  { code: "dissatisfaction_management", label: "Management Dissatisfaction" },
  { code: "entrepreneurship", label: "Entrepreneurship" },
  { code: "other", label: "Other" },
];

export function reasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return RESIGNATION_REASONS.find((r) => r.code === code)?.label ?? code.replace(/_/g, " ");
}

export function normalizeStatus(status: string | null | undefined): string {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "exit_confirmed" ? "exited" : s;
}

/** Mirrors SELF_WITHDRAW_BLOCKED_STATUSES in backend/src/modules/exit/resignation-self.service.ts. */
export const SELF_WITHDRAW_BLOCKED = new Set([
  "clearance_pending",
  "fnf_pending",
  "exited",
  "closed",
  "terminated",
  "absconding",
  "withdrawn",
  "revoked",
  "rejected",
  "cancelled",
]);

/** The resignation was taken back — the employee has no open resignation. */
export const REVERSAL_STATUSES = new Set(["withdrawn", "revoked", "rejected", "cancelled"]);

export function canSelfWithdraw(request: ExitRequest): boolean {
  // Shown for every open resignation; only once the exit is processed (clearance / exited) or
  // already over is it HR's to undo. The server applies the same rule.
  return !SELF_WITHDRAW_BLOCKED.has(normalizeStatus(request.status));
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  returned: "Returned to you",
  manager_review: "With your manager",
  hr_review: "With HR",
  admin_review: "Under review",
  accepted: "Accepted",
  notice_serving: "Serving notice",
  notice_active: "Serving notice",
  clearance_pending: "Clearance in progress",
  fnf_pending: "Final settlement",
  exited: "Exited",
  closed: "Closed",
  terminated: "Closed",
  withdrawn: "Withdrawn",
  revoked: "Revoked",
  rejected: "Closed",
};

export function statusLabel(status: string): string {
  const s = normalizeStatus(status);
  return STATUS_LABELS[s] ?? s.replace(/_/g, " ");
}

/** Index into the six tracker steps: Submitted, Manager review, Accepted, Notice, Clearance, Exited. */
export function stepIndexFor(status: string): number {
  switch (normalizeStatus(status)) {
    case "manager_review":
    case "hr_review":
    case "admin_review":
      return 1;
    case "accepted":
      return 2;
    case "notice_serving":
    case "notice_active":
      return 3;
    case "clearance_pending":
    case "fnf_pending":
      return 4;
    case "exited":
    case "closed":
    case "terminated":
      return 5;
    default:
      return 0;
  }
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD in the browser's local calendar (not UTC — toISOString shifts IST dates). */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localIsoDate(new Date(y, m - 1, d + days));
}

/** Formats a DATE ("2026-10-31") or DATETIME ("2026-10-01 10:15:00") without timezone drift. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return String(value);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value));
  if (!m) return formatDate(value);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
