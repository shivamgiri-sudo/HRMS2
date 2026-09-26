/**
 * Salary start date - the pure rules: who may do what, which dates are real, which are locked.
 * No database access here; salary-start-date.service.ts applies them and re-exports everything.
 */
import { canBackdateDates } from "../../utils/dateUtils.js";

/**
 * Ownership tier. "payroll_head" (Payroll Head and super_admin only - admin is not an approver) may change a date AFTER Payroll Head has approved the salary; "standard"
 * (Payroll HR, HR, Joining Control Room) may not.
 */
export type SalaryDateAuthority = "payroll_head" | "standard";

export const SALARY_DATE_REVIEWER_ROLES: readonly string[] = [
  "payroll_head",
  "super_admin",
];

export interface ActorAuthority {
  authority: SalaryDateAuthority;
  /**
   * May set a date before joining / before today (with a reason). The same rule as the rest of
   * the date lock - canBackdateDates: payroll_head and super_admin, NOT admin.
   */
  allowBackdate: boolean;
}

/** Derives both tiers from the session's roles - never from the request body. */
export function actorAuthority(
  roles: readonly string[] | null | undefined,
): ActorAuthority {
  const list = roles ?? [];
  return {
    authority: list.some((r) => SALARY_DATE_REVIEWER_ROLES.includes(r))
      ? "payroll_head"
      : "standard",
    allowBackdate: canBackdateDates(list),
  };
}

export type SalaryDateSource =
  | "payroll_head_assign_package"
  | "payroll_head_create_and_assign_package"
  | "payroll_head_approve_offered"
  | "payroll_head_change_start_date"
  | "payroll_head_change_assignment_date"
  | "revision_request_approved"
  | "joining_control_room"
  | "payroll_hr_validation"
  | "employee_edit"
  | "employee_creation"
  | "repair";

export const MIN_REASON_LENGTH = 5;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function httpError(message: string, statusCode: number, code: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

/** First 10 characters of a DB/JS date value, or "" when empty. Never builds a JS Date (timezone shifts). */
export function dayOf(value: unknown): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/** Throws 400 unless `value` is a real calendar date written YYYY-MM-DD. Returns it unchanged. */
export function normaliseSalaryDate(
  value: unknown,
  label = "Salary start date",
): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!ISO_DATE.test(v)) {
    throw httpError(
      `${label} must be a valid YYYY-MM-DD date.`,
      400,
      "INVALID_DATE",
    );
  }
  const [y, m, d] = v.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw httpError(
      `${label} (${v}) is not a real calendar date.`,
      400,
      "INVALID_DATE",
    );
  }
  return v;
}

export interface SalaryDateAssessment {
  /** New date is before the date of joining. */
  preJoining: boolean;
  /** New date is before today (IST). */
  beforeToday: boolean;
  /** New date equals a date the record already carries - a re-save, not a move. */
  unchanged: boolean;
}

/**
 * Pure date-lock decision. Throws when the lock refuses; otherwise says which locks were relaxed.
 *
 * `unchangedFrom`: dates the employee already carries (employee record, HR validation row, live
 * assignment). Re-using one is always allowed, so an already-past pending review can still be
 * approved as it stands - only SETTING or MOVING a date into the past is gated.
 */
export function assessSalaryStartDate(input: {
  newDate: string;
  dateOfJoining: string | null;
  today: string;
  unchangedFrom: ReadonlyArray<unknown>;
  /** May go before joining / before today, with a reason. */
  allowBackdate: boolean;
  reason?: string | null;
  label?: string;
}): SalaryDateAssessment {
  const label = input.label ?? "Salary start date";
  const newDate = input.newDate;
  const doj = dayOf(input.dateOfJoining);
  const unchanged = input.unchangedFrom.some((d) => dayOf(d) === newDate);
  const preJoining = !!doj && newDate < doj;
  const beforeToday = newDate < input.today;

  // A pre-joining date is only ever storable on employees with the approval flag, which only
  // allowBackdate actors may set - so even a "re-save" of one is refused for anyone else.
  if (unchanged && !(preJoining && !input.allowBackdate)) {
    return { preJoining, beforeToday, unchanged: true };
  }
  if (!preJoining && !beforeToday)
    return { preJoining, beforeToday, unchanged: false };

  if (!input.allowBackdate) {
    if (preJoining) {
      throw httpError(
        `${label} (${newDate}) cannot be before date of joining (${doj}).`,
        400,
        "SALARY_START_BEFORE_JOINING",
      );
    }
    throw httpError(
      `${label} (${newDate}) cannot be set before today (${input.today}).`,
      400,
      "DATE_BEFORE_TODAY",
    );
  }

  const reason = (input.reason ?? "").trim();
  if (reason.length < MIN_REASON_LENGTH) {
    const what = preJoining
      ? `before the date of joining (${doj})`
      : `before today (${input.today})`;
    throw httpError(
      `${label} (${newDate}) is ${what}. A reason of at least ${MIN_REASON_LENGTH} characters is required.`,
      400,
      "REASON_REQUIRED",
    );
  }
  return { preJoining, beforeToday, unchanged: false };
}

/**
 * YYYY-MM for every month from the earliest to the latest of the given dates, inclusive - but only
 * when at least one of them differs from `target`. If every stored copy already carries the target
 * date nothing changes for payroll, so no month is affected.
 */
export function affectedPayrollMonths(
  dates: ReadonlyArray<string | null | undefined>,
  target: string,
): string[] {
  const days = [...dates.map(dayOf), target].filter(Boolean).sort();
  if (days.every((d) => d === target)) return [];
  const first = days[0].slice(0, 7);
  const last = days[days.length - 1].slice(0, 7);
  const months: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}
