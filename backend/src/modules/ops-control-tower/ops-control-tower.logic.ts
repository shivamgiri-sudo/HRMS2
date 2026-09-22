// Pure rules for the Ops Control Tower dashboard (no DB, no clock — `nowMs` is always passed in).
//
// Two date rules, both anchored on `employees.created_at` — when the employee code was created,
// not when the person physically started — per owner ruling 2026-09-22:
//   - Joining bucket: DATEDIFF(date_of_joining, created_at). 0 = "Same day", 1 = "-1", ... up to
//     5 = "-5", anything past that is ">5".
//   - Appointment letter: must be e-signed within 7 days of created_at (Day 7).

export const JOIN_BUCKETS = ['Same day', '-1', '-2', '-3', '-4', '-5', '>5'] as const;
export type JoinBucket = (typeof JOIN_BUCKETS)[number];

export const APPOINTMENT_LETTER_SLA_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Which of the 7 joining-lag buckets a "days after code creation" figure falls into. */
export function joinBucketFor(daysAfterCodeCreation: number): JoinBucket {
  if (daysAfterCodeCreation <= 0) return 'Same day';
  if (daysAfterCodeCreation >= 6) return '>5';
  return `-${daysAfterCodeCreation}` as JoinBucket;
}

/** Empty tally, one slot per bucket, in display order. */
export function emptyBucketTally(): Record<JoinBucket, number> {
  return Object.fromEntries(JOIN_BUCKETS.map((b) => [b, 0])) as Record<JoinBucket, number>;
}

export interface AppointmentLetterState {
  createdAtMs: number;
  signedAtMs: number | null;
  nowMs: number;
}

export type AppointmentLetterStatus = 'signed_on_time' | 'signed_late' | 'due' | 'overdue';

export interface AppointmentLetterResult {
  status: AppointmentLetterStatus;
  /** Counts toward the "Pending" column only for 'due' and 'overdue'. */
  pending: boolean;
  dueAtMs: number;
  /** Days past Day 7, only when overdue. */
  daysOverdue: number | null;
}

/** Where one employee's appointment letter stands against the Day-7 SLA. */
export function classifyAppointmentLetter(state: AppointmentLetterState): AppointmentLetterResult {
  const dueAtMs = state.createdAtMs + APPOINTMENT_LETTER_SLA_DAYS * DAY_MS;
  if (state.signedAtMs !== null) {
    return {
      status: state.signedAtMs <= dueAtMs ? 'signed_on_time' : 'signed_late',
      pending: false,
      dueAtMs,
      daysOverdue: null,
    };
  }
  if (state.nowMs <= dueAtMs) return { status: 'due', pending: false, dueAtMs, daysOverdue: null };
  const daysOverdue = Math.floor((state.nowMs - dueAtMs) / DAY_MS);
  return { status: 'overdue', pending: true, dueAtMs, daysOverdue };
}

/** Row-level severity used to colour a pending count: none/low/medium/high. */
export type Severity = 'none' | 'low' | 'medium' | 'high';

export function severityForCount(n: number, mediumAt: number, highAt: number): Severity {
  if (n <= 0) return 'none';
  if (n < mediumAt) return 'low';
  if (n < highAt) return 'medium';
  return 'high';
}
