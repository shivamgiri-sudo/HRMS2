/**
 * Pure helpers for the Roster Audit Trail endpoints (roster-audit.routes.ts).
 * No DB / express imports so they are unit-testable.
 */

/** Every value of roster_decision_audit.decision_type (migrations 223/229/236) plus two legacy labels. */
const DECISION_LABELS: Record<string, string> = {
  shift_assigned: 'Shift Assigned',
  weekoff_assigned: 'Week-off Assigned',
  weekoff_denied: 'Week-off Denied',
  weekoff_waitlisted: 'Week-off Waitlisted',
  shift_frozen: 'Shift Frozen',
  holiday_applied: 'Holiday Applied',
  preference_accepted: 'Preference Accepted',
  alternate_assigned: 'Alternate Assigned',
  no_preference_auto_assigned: 'Auto-assigned (No Preference)',
  manual_override: 'Manual Override',
  manager_realigned: 'Manager Realigned',
  force_approved: 'Force Approved',
  hr_override: 'HR Override',
  bulk_upload: 'Bulk Upload',
  escalated_to_hr: 'Escalated to HR',
  manager_rejected_request: 'Request Rejected by Manager',
  // Never valid enum members, kept so any historic label mapping keeps resolving.
  rejected_request: 'Request Rejected',
  manager_override: 'Manager Override',
  // Synthetic: engine failure rows are logged as 'shift_assigned' with rule_applied 'error:...'.
  engine_error: 'Engine Error',
};

/** Real enum members, in display order, for filter dropdowns. */
export const DECISION_TYPE_CODES = [
  'shift_assigned', 'weekoff_assigned', 'weekoff_denied', 'weekoff_waitlisted', 'shift_frozen',
  'holiday_applied', 'preference_accepted', 'alternate_assigned', 'no_preference_auto_assigned',
  'manual_override', 'manager_realigned', 'force_approved', 'hr_override', 'bulk_upload',
  'escalated_to_hr', 'manager_rejected_request',
] as const;

export const ENGINE_ERROR_CODE = 'engine_error';

export function humanizeCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatDecisionType(type: string | null | undefined): string {
  if (!type) return 'Unknown';
  return DECISION_LABELS[type] ?? humanizeCode(type);
}

/** The engine writes a fake 'shift_assigned' row (rule_applied 'error:...') when an employee fails. */
export function isEngineErrorRule(rule: string | null | undefined): boolean {
  return typeof rule === 'string' && rule.startsWith('error:');
}

/** Effective decision code: engine failure rows are reported as engine_error, not as shift assignments. */
export function effectiveDecisionCode(type: string, rule: string | null | undefined): string {
  return isEngineErrorRule(rule) ? ENGINE_ERROR_CODE : type;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today's date in IST (the DB session timezone) — NOT UTC, which is a day behind 00:00-05:30 IST. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export interface Period { from: string; to: string }

/** Validates dateFrom/dateTo; defaults to the last 30 days ending today (IST). Returns an error string on bad input. */
export function resolvePeriod(from: unknown, to: unknown, now: Date = new Date()): Period | { error: string } {
  if ((from !== undefined && from !== '' && !isIsoDate(from)) || (to !== undefined && to !== '' && !isIsoDate(to))) {
    return { error: 'dateFrom/dateTo must be YYYY-MM-DD' };
  }
  if (from && to) {
    if (String(from) > String(to)) return { error: 'dateFrom must not be after dateTo' };
    return { from: String(from), to: String(to) };
  }
  const end = to ? String(to) : istToday(now);
  const start = from ? String(from) : addDaysIso(end, -29);
  return { from: start, to: end };
}

/** The immediately preceding window of identical length (for delta-vs-previous-period). */
export function previousPeriod(p: Period): Period {
  const len = daysBetweenInclusive(p.from, p.to);
  const to = addDaysIso(p.from, -1);
  return { from: addDaysIso(to, -(len - 1)), to };
}

/** Percentage with one decimal; 0 when the denominator is 0 (never NaN/Infinity). */
export function pct(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Percent change vs previous; null when there is no baseline to compare against. */
export function deltaPct(current: number, previous: number): number | null {
  if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Clamp a user-supplied page size / offset into safe integers (safe to interpolate into LIMIT/OFFSET). */
export function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

export const AMENDABLE_CYCLE_STATUSES = ['published', 'acknowledged', 'active', 'variance_review'] as const;
export const AMENDMENT_ASSIGNMENT_TYPES = ['SHIFT', 'WEEK_OFF', 'TRAINING', 'UNSCHEDULED'] as const;
export type AmendmentAssignmentType = (typeof AMENDMENT_ASSIGNMENT_TYPES)[number];

export interface AmendmentInput {
  employeeId?: unknown;
  date?: unknown;
  newShiftId?: unknown;
  newAssignmentType?: unknown;
  reason?: unknown;
}

/** Validates an amendment body against the cycle window. Returns an error string or null. */
export function validateAmendmentInput(
  input: AmendmentInput,
  cycle: { week_start_date: string; week_end_date: string },
): string | null {
  if (!input.employeeId || !input.date || !input.newAssignmentType || !input.reason) {
    return 'employeeId, date, newAssignmentType, reason are required';
  }
  if (!isIsoDate(input.date)) return 'date must be YYYY-MM-DD';
  if (!AMENDMENT_ASSIGNMENT_TYPES.includes(input.newAssignmentType as AmendmentAssignmentType)) {
    return `newAssignmentType must be one of ${AMENDMENT_ASSIGNMENT_TYPES.join(', ')}`;
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length < 5) {
    return 'reason must be at least 5 characters';
  }
  if (input.reason.length > 500) return 'reason must be 500 characters or fewer';
  if (input.newAssignmentType === 'SHIFT' && !input.newShiftId) return 'newShiftId is required when newAssignmentType is SHIFT';
  const start = String(cycle.week_start_date).slice(0, 10);
  const end = String(cycle.week_end_date).slice(0, 10);
  if (input.date < start || input.date > end) return `date must be within the cycle week (${start} to ${end})`;
  return null;
}
