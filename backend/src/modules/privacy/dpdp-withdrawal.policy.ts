/**
 * Policy decisions for DPDP consent withdrawal, in one place so they can be reviewed and changed without
 * hunting through the workflow. These are working defaults chosen for this organisation; the DPO / counsel
 * should confirm them. Anything that is a number can be overridden in dpdp_config where noted.
 *
 * 1. WHAT AN APPROVAL RESTRICTS
 *    Withdrawal ends the optional uses of the principal's data. It does not end processing the employer must
 *    do for the employment itself or for the law (payroll, tax, PF / ESI, attendance for wages, statutory
 *    records). So:
 *      - an ACTIVE employee's record is not blocked as a whole; the chosen categories are restricted through
 *        the per-module tasks created on approval, and what must be kept is recorded with its legal basis;
 *      - a former employee or a candidate has no ongoing employment need, so the whole record is restricted
 *        (only what a statute still requires is retained - see RETENTION).
 *
 * 2. DEADLINE
 *    Acknowledged immediately; decision target 7 days (not 72 hours: 72 hours is the breach-notification
 *    window, which made every request look breached). Override with dpdp_config key
 *    `withdrawal_decision_sla_hours`; clamped to 24h - 30 days. Overdue requests are escalated to the DPO.
 *
 * 3. RETENTION OF RECORDS THE LAW REQUIRES
 *    Follows the existing data_retention_policy rows: employee master and payroll 8 years, leave and
 *    attendance 5 years.
 */

export const DEFAULT_DECISION_SLA_HOURS = 7 * 24;
export const MIN_DECISION_SLA_HOURS = 24;
export const MAX_DECISION_SLA_HOURS = 30 * 24;
export const SLA_CONFIG_KEY = "withdrawal_decision_sla_hours";

export const RETENTION = {
  payrollAndEmployeeRecordsYears: 8,
  leaveAndAttendanceYears: 5,
} as const;

/** Parses a config value into an allowed number of hours; anything unusable falls back to the default. */
export function clampSlaHours(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,5}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DECISION_SLA_HOURS;
  return Math.min(MAX_DECISION_SLA_HOURS, Math.max(MIN_DECISION_SLA_HOURS, Math.round(n)));
}

export function decisionDays(hours: number): number {
  return Math.max(1, Math.ceil(hours / 24));
}

export const RETENTION_SENTENCE =
  `payroll and employee records are kept for ${RETENTION.payrollAndEmployeeRecordsYears} years and ` +
  `leave and attendance records for ${RETENTION.leaveAndAttendanceYears} years, as our retention policy and the law require`;

export function acknowledgementText(ref: string, hours: number): string {
  const d = decisionDays(hours);
  return `We received your data withdrawal request ${ref}. We aim to decide within ${d} day${d === 1 ? "" : "s"} and will tell you here what we have restricted and what we must keep.`;
}

export const APPROVED_TEXT =
  `Your data withdrawal request was approved. We are stopping the optional uses of the data you chose. Information needed ` +
  `for your employment and for the law continues to be used and is kept only for the required period (${RETENTION_SENTENCE}).`;

export function rejectedText(reason: string): string {
  return `Your data withdrawal request was not accepted: ${reason.slice(0, 200)}. You may raise a grievance with the Grievance Officer.`;
}
