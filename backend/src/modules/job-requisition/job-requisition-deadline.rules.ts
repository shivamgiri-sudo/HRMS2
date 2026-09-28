/** Pure decision rules for job requisition deadline automation. No I/O. */

export const APPROACHING_DAYS = [3, 1] as const;
export const LOW_FILL_STAGES = [50, 75, 90] as const;
export const LOW_FILL_GAP_POINTS = 20;
export const KEEP_OPEN_REVIEW_DAYS = 7;
export const MAX_EXTENSION_DAYS = 90;

export interface RequisitionSnapshot {
  requested: number;
  fulfilled: number;
  /** requisition_validity, YYYY-MM-DD */
  validity: string | null;
  /** training_start_date (batch start / enrolment close), YYYY-MM-DD */
  batchEnd: string | null;
  targetJoining: string | null;
  /** date the demand was raised, YYYY-MM-DD */
  startDate: string;
}

export type DecisionRow = {
  status: "pending" | "closed" | "extended" | "kept_open";
  cycleNo: number;
  reviewAfter: string | null;
} | null;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso);
}

export function addDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** End of the hiring window: batch start if a batch is planned, else validity, else target joining. */
export function windowEnd(s: RequisitionSnapshot): string | null {
  return s.batchEnd ?? s.validity ?? s.targetJoining;
}

export function percentFilled(s: RequisitionSnapshot): number {
  return s.requested > 0 ? (s.fulfilled / s.requested) * 100 : 100;
}

/** Percent of the hiring window already used, clamped to 0-100. Null when the window is not usable. */
export function percentTimeElapsed(
  s: RequisitionSnapshot,
  today: string,
): number | null {
  const end = windowEnd(s);
  if (!end) return null;
  const total = daysBetween(s.startDate, end);
  if (total <= 0) return null;
  const used = daysBetween(s.startDate, today);
  return Math.max(0, Math.min(100, (used / total) * 100));
}

export type ExpiryAction = "auto_close" | "needs_decision" | "none";

/** Past validity: zero fills close by themselves, anything partly filled waits for HR. */
export function expiryAction(
  s: RequisitionSnapshot,
  today: string,
  latest: DecisionRow,
): ExpiryAction {
  if (!s.validity || s.validity >= today) return "none";
  if (s.fulfilled <= 0) return "auto_close";
  if (!latest) return "needs_decision";
  if (latest.status === "pending") return "none";
  if (
    latest.status === "kept_open" &&
    latest.reviewAfter &&
    latest.reviewAfter > today
  )
    return "none";
  return "needs_decision";
}

export function nextCycleNo(latest: DecisionRow): number {
  return latest ? latest.cycleNo + 1 : 1;
}

/** Days-out reminder stage (3 or 1) when today is exactly that many days before the date. */
export function approachingStage(
  dateIso: string | null,
  today: string,
): number | null {
  if (!dateIso) return null;
  const left = daysBetween(today, dateIso);
  return (APPROACHING_DAYS as readonly number[]).includes(left) ? left : null;
}

/** Highest low-fill stage reached where the fill rate trails time used by more than the allowed gap. */
export function lowFillStage(
  s: RequisitionSnapshot,
  today: string,
): number | null {
  const elapsed = percentTimeElapsed(s, today);
  if (elapsed === null) return null;
  const reached = [...LOW_FILL_STAGES].filter((p) => elapsed >= p).pop();
  if (reached === undefined) return null;
  return percentFilled(s) < elapsed - LOW_FILL_GAP_POINTS ? reached : null;
}

export function isValidExtension(newValidity: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newValidity)) return false;
  const gap = daysBetween(today, newValidity);
  return gap >= 1 && gap <= MAX_EXTENSION_DAYS;
}
