// Pure rules for the Ops Control Tower dashboard (no DB, no clock — `nowMs` is always passed in).
//
// Three date rules, all anchored on `employees.created_at` — when the employee code was created,
// not when the person physically started (owner ruling 2026-09-22, confirmed 2026-09-22):
//   - Joining bucket: DATEDIFF(date_of_joining, created_at). 0 = "Same day", 1 = "-1", ... up to
//     5 = "-5", anything past that is ">5".
//   - Joining-kit eSign: must be signed within 3 days of created_at (Day 3). Corroborated by
//     appointmentLetterEligibility.service.ts's own `idCreationSlaBreached: daysSinceIdCreated
//     > 3` — same clock, same threshold, independently confirmed rather than assumed.
//   - Appointment letter: must be e-signed within 7 days of created_at (Day 7).

export const JOIN_BUCKETS = ['Same day', '-1', '-2', '-3', '-4', '-5', '>5'] as const;
export type JoinBucket = (typeof JOIN_BUCKETS)[number];

export const JOINING_DOCUMENT_SLA_DAYS = 3;
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

export interface IdCreationSlaState {
  createdAtMs: number;
  /** When the thing (eSign / letter) was actually completed, or null if it never has been. */
  doneAtMs: number | null;
  nowMs: number;
}

export type IdCreationSlaStatus = 'done_on_time' | 'done_late' | 'due' | 'overdue';

export interface IdCreationSlaResult {
  status: IdCreationSlaStatus;
  /** Counts toward the "Pending" column only for 'overdue' — 'due' still has time left. */
  pending: boolean;
  dueAtMs: number;
  /** Days past the deadline, only when overdue. */
  daysOverdue: number | null;
}

/**
 * Where one employee stands against an N-day SLA measured from employees.created_at. Shared by
 * the eSign (Day 3) and Appointment letter (Day 7) blocks — same shape, different deadline and
 * different "done" source.
 */
export function classifyIdCreationSla(state: IdCreationSlaState, slaDays: number): IdCreationSlaResult {
  const dueAtMs = state.createdAtMs + slaDays * DAY_MS;
  if (state.doneAtMs !== null) {
    return { status: state.doneAtMs <= dueAtMs ? 'done_on_time' : 'done_late', pending: false, dueAtMs, daysOverdue: null };
  }
  if (state.nowMs <= dueAtMs) return { status: 'due', pending: false, dueAtMs, daysOverdue: null };
  return { status: 'overdue', pending: true, dueAtMs, daysOverdue: Math.floor((state.nowMs - dueAtMs) / DAY_MS) };
}

/** Row-level severity used to colour a pending count: none/low/medium/high. */
export type Severity = 'none' | 'low' | 'medium' | 'high';

export function severityForCount(n: number, mediumAt: number, highAt: number): Severity {
  if (n <= 0) return 'none';
  if (n < mediumAt) return 'low';
  if (n < highAt) return 'medium';
  return 'high';
}
