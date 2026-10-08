//
// Requirement 10's Floor_Absence_Pattern detector (requirements.md criteria 10.1-10.11),
// implemented as a PURE function in the same shape as attendance-source-rule-resolver.ts,
// canonical-productivity.ts and attendance-rule-migration-proposal.ts.
//
// PURITY
// No database import, no clock, no identifier minting. Everything arrives as an argument:
// the employee's days, the resolved Floor_Absence_Pattern_Ceiling, the resolved
// full_day_minutes per date, and the prior-month history the rolling window needs. Calendar
// arithmetic is done on civil dates converted to day numbers rather than through Date, so the
// process time zone cannot move a window boundary by a day. Nothing here writes anywhere:
// persisting occurrences into attendance_floor_absence_occurrence, raising the Variance_Record
// rows of criterion 10.6, and dispatching the notifications of criterion 10.7 are the caller's
// (later phase's) work. This function returns the intent, deterministically.
//
// WHAT THE PATTERN IS: A COUNT, NOT A RUN
// Nothing in Requirement 10 describes consecutive days. Criterion 10.1 records an occurrence
// per employee-date, independently of the neighbouring dates. The only aggregation in the
// requirement is criterion 10.7 - "the count of Floor_Absence_Pattern occurrences for one
// employee within a rolling window reaches the configured repeat threshold" - with criterion
// 10.8 defaulting that to three occurrences within 30 days. So there is no run to interrupt:
// a week off, a holiday or an approved leave day sitting between two occurrences neither
// breaks anything nor is skipped over, because the count is over dates carrying occurrences
// inside a calendar window, not over adjacency.
//
// That reading matters for what those day types DO mean here. Criterion 6.7 forbids raising a
// Variance_Record for a date classified as approved leave, holiday or week off, and criterion
// 10.6 requires a Variance_Record for every Floor_Absence_Pattern occurrence. An occurrence on
// such a date would therefore be self-contradictory, so those classifications are excluded
// from detection outright (suppression reason 'non_working_classification'). They are not
// counted as occurrences and they do not affect any other date's eligibility.
//
// UNDER-FLAG, NEVER OVER-FLAG
// A false positive here asserts that someone punched in and did not work. Where the criteria
// leave a choice, the narrower reading is taken, and each such choice is named at its site:
//   - evidence must be genuinely positive, not merely non-null (criteria 10.3, 10.11)
//   - "fall below the ceiling" is strict (<), so exactly at the ceiling is not an occurrence
//   - a rolling window of N days is N days inclusive of the triggering date, not N + 1
//   - conflicting duplicate rows for one date suppress that date instead of picking one
//   - an unparseable date is suppressed, never guessed
//
// WHAT THIS MODULE CANNOT COVER
//   - 10.6 (raise a Variance_Record) and criterion 6.8's always-queue disposition are returned
//     as requests, not written. The queue-state pass is deliberately separate (design.md
//     component 7, "Always-queue").
//   - 10.7's notification delivery: the roles to notify are returned; inbox delivery is a side
//     effect and lives with the caller.
//   - 10.9 (retain every occurrence after review) is a storage guarantee of
//     attendance_floor_absence_occurrence and the Requirement 7 review workflow. A pure
//     function holds no state to retain, so it cannot be implemented or tested here.
//   - 10.2's negative half - that attendance_daily_record.dialler_minutes is never read - is
//     satisfied structurally: this module accepts only Requirement 18 Contributions and has no
//     access to that column. Proving no caller reads it is a contract test on the callers.

import { deriveCanonical, type CanonicalResult, type Contribution } from './canonical-productivity.js';

// criterion 10.4: applied when no Floor_Absence_Pattern_Ceiling is configured for the employee
// and date. Must stay equal to DEFAULT_THRESHOLD_MINUTES.floor_absence_ceiling in
// attendance-threshold-config.service.ts; duplicated rather than imported because that module
// opens a database connection and this one must not.
export const DEFAULT_FLOOR_ABSENCE_CEILING_MINUTES = 60;

// criterion 10.8: applied when no repeat threshold or rolling window is configured.
export const DEFAULT_REPEAT_THRESHOLD_COUNT = 3;
export const DEFAULT_ROLLING_WINDOW_DAYS = 30;

// criterion 10.10: the look-back over which at least one registered Dialler_Source must have
// carried a record for the employee before a date can produce an occurrence.
export const DIALLER_ACTIVITY_LOOKBACK_DAYS = 30;

// The vocabulary of attendance_daily_record.attendance_status (mirrors AttendanceStatus in
// attendance-engine.service.ts). Declared locally, not imported, because that module is
// DB-backed; the three values criterion 6.7 names are the only ones this detector branches on.
export type FloorAbsenceDayClassification =
  | 'present'
  | 'half_day'
  | 'absent'
  | 'leave_approved'
  | 'holiday'
  | 'week_off'
  | 'week_off_worked'
  | 'unreconciled'
  | 'missing_punch';

// criterion 6.7: no Variance_Record on these dates, therefore (with 10.6) no occurrence.
const NON_WORKING_CLASSIFICATIONS: ReadonlySet<FloorAbsenceDayClassification> = new Set([
  'leave_approved',
  'holiday',
  'week_off',
]);

export interface FloorAbsenceDayInput {
  /** Calendar date, 'YYYY-MM-DD'. */
  date: string;
  classification: FloorAbsenceDayClassification;
  /** Biometric_Minutes for the date; null when no biometric record exists. */
  biometricMinutes: number | null;
  /** The resolved day_threshold_rule.full_day_minutes for this employee and date (1.14-1.16). */
  fullDayMinutes: number;
  /**
   * The per-Dialler_Source contributions of the Requirement 18 aggregation for this date
   * (criterion 10.2). An empty array means no registered source carried a record - which is
   * absent evidence, never a measured zero (criterion 18.10).
   */
  contributions: Contribution[];
  /** Count of biometric punches recorded for the date; null when unknown (criterion 10.5). */
  punchCount?: number | null;
  /** First/last punch as minutes from 00:00 on the date; null when unknown (criterion 10.5). */
  firstPunchMinute?: number | null;
  lastPunchMinute?: number | null;
}

export interface FloorAbsenceDetectionInput {
  employeeId: string;
  /** 'YYYY-MM'. Carried onto the result for reporting; never used to filter the days. */
  payMonth: string;
  days: FloorAbsenceDayInput[];
  /**
   * The resolved Floor_Absence_Pattern_Ceiling in minutes. null or a non-finite / non-positive
   * value applies the 60-minute default of criterion 10.4.
   */
  floorAbsenceCeilingMinutes?: number | null;
  /**
   * Dates before (or outside) the supplied days on which any registered Dialler_Source carried
   * a record, so criterion 10.10's 30-day look-back can be satisfied for the first dates of a
   * Pay_Month. Without them, early dates in the month legitimately produce no occurrence.
   */
  priorDiallerActivityDates?: string[];
  /**
   * Floor_Absence_Pattern occurrence dates already recorded for this employee outside the
   * supplied days, so criterion 10.7's rolling window spans the Pay_Month boundary.
   */
  priorOccurrenceDates?: string[];
  /** criterion 10.7 / 10.8: defaults to 3 occurrences within 30 days when null. */
  repeatThresholdCount?: number | null;
  rollingWindowDays?: number | null;
}

export type FloorAbsenceReason =
  /** criterion 10.1: full biometric day, evidence present, canonical minutes below the ceiling. */
  | 'productive_minutes_below_ceiling'
  /** criterion 10.5: exactly two punches a full day apart, every reporting source below the ceiling. */
  | 'two_punch_full_span';

export interface FloorAbsenceSourceContribution {
  diallerSourceId: string;
  /** The source's own productive minutes under the Requirement 18 rules, applied alone. */
  minutes: number;
}

export interface FloorAbsenceOccurrence {
  employeeId: string;
  date: string;
  reason: FloorAbsenceReason;
  biometricMinutes: number | null;
  /** lastPunchMinute - firstPunchMinute when both are known, else null. */
  punchSpanMinutes: number | null;
  canonicalProductiveMinutes: number;
  canonicalRule: CanonicalResult['rule'];
  /** Sorted by diallerSourceId, so two runs over the same day are byte-identical. */
  contributingSources: FloorAbsenceSourceContribution[];
  appliedCeilingMinutes: number;
  appliedFullDayMinutes: number;
}

export type FloorAbsenceSuppressionReason =
  /** criterion 6.7 with 10.6: approved leave, holiday or week off. */
  | 'non_working_classification'
  /** criteria 10.3, 10.11: no productive evidence, or none that is genuinely positive. */
  | 'no_productivity_evidence'
  /** criterion 10.1: Biometric_Minutes do not reach the full-day threshold, and 10.5 does not apply. */
  | 'biometric_below_full_day'
  /** criteria 10.1, 10.5: productive minutes are at or above the ceiling. */
  | 'productive_minutes_at_or_above_ceiling'
  /** criterion 10.10: no registered Dialler_Source carried a record in the preceding 30 days. */
  | 'no_dialler_activity_in_lookback'
  /** Two or more rows for one date disagree - the date is ambiguous, not an occurrence. */
  | 'conflicting_duplicate_date'
  /** The date is not a parseable 'YYYY-MM-DD' calendar date. */
  | 'invalid_date';

export interface FloorAbsenceSuppression {
  date: string;
  reason: FloorAbsenceSuppressionReason;
}

export type DuplicateDateResolution = 'collapsed_identical' | 'suppressed_conflicting';

export interface DuplicateDateReport {
  date: string;
  entryCount: number;
  resolution: DuplicateDateResolution;
}

/**
 * criterion 10.6, with criterion 6.8's always-queue disposition. Returned as intent: this
 * module raises nothing. `isFloorAbsence` maps onto variance_record.is_floor_absence, which is
 * what the separate assignQueueState() pass reads to queue the record irrespective of the
 * Dual_Review_Ceiling.
 */
export interface FloorAbsenceVarianceRequest {
  employeeId: string;
  date: string;
  reason: FloorAbsenceReason;
  isFloorAbsence: true;
  dispositionHint: 'queued_for_dual_review';
}

export type FloorAbsenceNotifyRole = 'branch_head' | 'wfm_head';

export interface RepeatOccurrenceAssessment {
  /** criterion 10.7: the count reached the repeat threshold inside the rolling window. */
  isRepeatSubject: boolean;
  appliedThresholdCount: number;
  appliedRollingWindowDays: number;
  /** The earliest window that reached the threshold, or null. Inclusive of both bounds. */
  triggeringWindow: { startDate: string; endDate: string; occurrenceDates: string[] } | null;
  /** criterion 10.7's recipients. Empty unless isRepeatSubject. Dispatch is the caller's. */
  notifyRoles: FloorAbsenceNotifyRole[];
}

export interface FloorAbsenceDetectionResult {
  employeeId: string;
  payMonth: string;
  appliedCeilingMinutes: number;
  /** Ascending by date. */
  occurrences: FloorAbsenceOccurrence[];
  /** Ascending by date, then by reason. Every evaluated date that produced no occurrence. */
  suppressions: FloorAbsenceSuppression[];
  duplicateDates: DuplicateDateReport[];
  varianceRequests: FloorAbsenceVarianceRequest[];
  repeat: RepeatOccurrenceAssessment;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Civil date -> days since 1970-01-01, and back. Howard Hinnant's days_from_civil. Used instead
 * of Date so no host time zone can shift a window edge, and so the function stays clock-free.
 * Returns null for anything that is not a real calendar date ('2026-02-30' included).
 */
function toDayNumber(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const shiftedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  const dayNumber = era * 146097 + dayOfEra - 719468;

  // Round-trip guard: rejects 2026-02-30 / 2025-02-29, which the arithmetic above would
  // otherwise silently absorb into the next month.
  return fromDayNumber(dayNumber) === date ? dayNumber : null;
}

function fromDayNumber(dayNumber: number): string {
  const shifted = dayNumber + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function sortedContributions(contributions: Contribution[]): Contribution[] {
  return [...contributions].sort((a, b) => {
    if (a.diallerSourceId !== b.diallerSourceId) {
      return a.diallerSourceId < b.diallerSourceId ? -1 : 1;
    }
    const aStart = a.interval?.startMinute ?? -1;
    const bStart = b.interval?.startMinute ?? -1;
    if (aStart !== bStart) return aStart - bStart;
    const aEnd = a.interval?.endMinute ?? -1;
    const bEnd = b.interval?.endMinute ?? -1;
    if (aEnd !== bEnd) return aEnd - bEnd;
    return a.magnitudeMinutes - b.magnitudeMinutes;
  });
}

/**
 * A order-independent fingerprint of a day row. Two rows for the same date that differ only in
 * the order of their contributions are the same reading, not a conflict.
 */
function dayFingerprint(day: FloorAbsenceDayInput): string {
  return JSON.stringify([
    day.classification,
    day.biometricMinutes ?? null,
    day.fullDayMinutes,
    day.punchCount ?? null,
    day.firstPunchMinute ?? null,
    day.lastPunchMinute ?? null,
    sortedContributions(day.contributions).map((c) => [
      c.diallerSourceId,
      c.interval === null ? null : [c.interval.startMinute, c.interval.endMinute],
      c.magnitudeMinutes,
    ]),
  ]);
}

function positiveIntOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Per-source productive minutes: the Requirement 18 rules applied to that source alone. */
function sourceMinutes(contribution: Contribution): number {
  return deriveCanonical([contribution]).minutes ?? 0;
}

/**
 * Detects Floor_Absence_Pattern occurrences for one employee across one Pay_Month.
 *
 * Total: never throws for ordinary data. An empty month, a month with gaps, duplicated dates,
 * unparseable dates, missing biometric minutes and missing punch data all produce a result.
 * Deterministic and order-independent: the days are sorted here, so the same set in any order
 * returns a deeply equal result. The input arrays are never mutated.
 */
export function detectFloorAbsencePattern(
  input: FloorAbsenceDetectionInput,
): FloorAbsenceDetectionResult {
  // criterion 10.4.
  const appliedCeilingMinutes = positiveIntOr(
    input.floorAbsenceCeilingMinutes,
    DEFAULT_FLOOR_ABSENCE_CEILING_MINUTES,
  );
  // criterion 10.8.
  const appliedThresholdCount = positiveIntOr(input.repeatThresholdCount, DEFAULT_REPEAT_THRESHOLD_COUNT);
  const appliedRollingWindowDays = positiveIntOr(input.rollingWindowDays, DEFAULT_ROLLING_WINDOW_DAYS);

  const suppressions: FloorAbsenceSuppression[] = [];
  const duplicateDates: DuplicateDateReport[] = [];

  // Duplicate dates are resolved explicitly, never double-counted: identical readings collapse
  // to one, disagreeing readings suppress the date. Silently taking the first or the last would
  // make the result depend on input order, and taking both would let one date count twice
  // toward criterion 10.7's repeat threshold.
  const byDate = new Map<string, FloorAbsenceDayInput[]>();
  for (const day of input.days) {
    const existing = byDate.get(day.date);
    if (existing) existing.push(day);
    else byDate.set(day.date, [day]);
  }

  const evaluable: { date: string; dayNumber: number; day: FloorAbsenceDayInput }[] = [];
  for (const [date, entries] of byDate) {
    if (entries.length > 1) {
      const fingerprints = new Set(entries.map(dayFingerprint));
      const resolution: DuplicateDateResolution =
        fingerprints.size === 1 ? 'collapsed_identical' : 'suppressed_conflicting';
      duplicateDates.push({ date, entryCount: entries.length, resolution });
      if (resolution === 'suppressed_conflicting') {
        suppressions.push({ date, reason: 'conflicting_duplicate_date' });
        continue;
      }
    }

    const dayNumber = toDayNumber(date);
    if (dayNumber === null) {
      suppressions.push({ date, reason: 'invalid_date' });
      continue;
    }
    evaluable.push({ date, dayNumber, day: entries[0] });
  }

  evaluable.sort((a, b) => a.dayNumber - b.dayNumber);
  duplicateDates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // criterion 10.10: the dates on which any registered Dialler_Source carried a record. Dates
  // inside the month contribute, as do the caller-supplied prior dates.
  const diallerActivityDays = new Set<number>();
  for (const { dayNumber, day } of evaluable) {
    if (day.contributions.length > 0) diallerActivityDays.add(dayNumber);
  }
  for (const date of input.priorDiallerActivityDates ?? []) {
    const dayNumber = toDayNumber(date);
    if (dayNumber !== null) diallerActivityDays.add(dayNumber);
  }

  const occurrences: FloorAbsenceOccurrence[] = [];

  for (const { date, dayNumber, day } of evaluable) {
    // criterion 6.7 with 10.6: an occurrence here could not carry the Variance_Record that
    // criterion 10.6 demands, so it is not recorded.
    if (NON_WORKING_CLASSIFICATIONS.has(day.classification)) {
      suppressions.push({ date, reason: 'non_working_classification' });
      continue;
    }

    const canonical = deriveCanonical(day.contributions);
    // criteria 10.3 and 10.11 (no-evidence-no-finding). Evidence must be present AND genuinely
    // positive: criterion 10.3 rules that a zero productivity figure is filler, not a
    // measurement, and cites the 40 genuine July 2026 employee-days as the ones pairing a full
    // biometric day with "genuinely positive" low productivity. A zero therefore suppresses
    // rather than flags - the under-flagging reading, and the only one that keeps the 3,056
    // filler-zero days out of the finding set.
    if (canonical.minutes === null || canonical.minutes <= 0) {
      suppressions.push({ date, reason: 'no_productivity_evidence' });
      continue;
    }

    // criterion 10.10: no track record in the preceding 30 days means no finding for this date.
    // The look-back is strictly before the date - the date's own evidence is what is being
    // judged, so it cannot also be its own corroborating history.
    let hasLookbackActivity = false;
    for (let offset = 1; offset <= DIALLER_ACTIVITY_LOOKBACK_DAYS; offset++) {
      if (diallerActivityDays.has(dayNumber - offset)) {
        hasLookbackActivity = true;
        break;
      }
    }
    if (!hasLookbackActivity) {
      suppressions.push({ date, reason: 'no_dialler_activity_in_lookback' });
      continue;
    }

    const fullDayMinutes = day.fullDayMinutes;
    const punchSpanMinutes =
      typeof day.firstPunchMinute === 'number' &&
      typeof day.lastPunchMinute === 'number' &&
      Number.isFinite(day.firstPunchMinute) &&
      Number.isFinite(day.lastPunchMinute)
        ? day.lastPunchMinute - day.firstPunchMinute
        : null;

    // criterion 10.5: exactly two punches separated by at least the full-day threshold, and
    // every registered Dialler_Source holding a record for the date below the ceiling. Checked
    // before 10.1 because when both hold, 10.5 dictates the stated reason.
    const twoPunchShape =
      day.punchCount === 2 &&
      punchSpanMinutes !== null &&
      Number.isFinite(fullDayMinutes) &&
      punchSpanMinutes >= fullDayMinutes;
    const everySourceBelowCeiling =
      day.contributions.length > 0 &&
      day.contributions.every((c) => sourceMinutes(c) < appliedCeilingMinutes);

    // criterion 10.1: Biometric_Minutes reach the full-day threshold and Canonical_Productive_
    // Minutes fall below the ceiling. "Fall below" is strict: exactly at the ceiling is not an
    // occurrence.
    const biometricReachesFullDay =
      typeof day.biometricMinutes === 'number' &&
      Number.isFinite(day.biometricMinutes) &&
      Number.isFinite(fullDayMinutes) &&
      day.biometricMinutes >= fullDayMinutes;
    const canonicalBelowCeiling = canonical.minutes < appliedCeilingMinutes;

    let reason: FloorAbsenceReason | null = null;
    if (twoPunchShape && everySourceBelowCeiling) {
      reason = 'two_punch_full_span';
    } else if (biometricReachesFullDay && canonicalBelowCeiling) {
      reason = 'productive_minutes_below_ceiling';
    }

    if (reason === null) {
      // Report the nearer miss: a full biometric day whose productivity is not low enough is a
      // different fact from a day that never reached the full-day threshold at all.
      suppressions.push({
        date,
        reason: biometricReachesFullDay
          ? 'productive_minutes_at_or_above_ceiling'
          : 'biometric_below_full_day',
      });
      continue;
    }

    occurrences.push({
      employeeId: input.employeeId,
      date,
      reason,
      biometricMinutes: day.biometricMinutes ?? null,
      punchSpanMinutes,
      canonicalProductiveMinutes: canonical.minutes,
      canonicalRule: canonical.rule,
      contributingSources: sortedContributions(day.contributions).map((c) => ({
        diallerSourceId: c.diallerSourceId,
        minutes: sourceMinutes(c),
      })),
      appliedCeilingMinutes,
      appliedFullDayMinutes: fullDayMinutes,
    });
  }

  suppressions.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
  });

  // criterion 10.6 with criterion 6.8: one Variance_Record request per occurrence, flagged
  // is_floor_absence so the queue pass queues it irrespective of the Dual_Review_Ceiling.
  const varianceRequests: FloorAbsenceVarianceRequest[] = occurrences.map((o) => ({
    employeeId: o.employeeId,
    date: o.date,
    reason: o.reason,
    isFloorAbsence: true,
    dispositionHint: 'queued_for_dual_review',
  }));

  return {
    employeeId: input.employeeId,
    payMonth: input.payMonth,
    appliedCeilingMinutes,
    occurrences,
    suppressions,
    duplicateDates,
    varianceRequests,
    repeat: assessRepeat(
      occurrences.map((o) => o.date),
      input.priorOccurrenceDates ?? [],
      appliedThresholdCount,
      appliedRollingWindowDays,
    ),
  };
}

/**
 * criteria 10.7 and 10.8: a count over a rolling window, not a run of consecutive days. The
 * window is appliedRollingWindowDays days INCLUSIVE of the date that closes it - 30 days means
 * [d - 29, d], not [d - 30, d]. The inclusive reading spans one day less and so cannot flag a
 * pair of occurrences 30 days apart as a repeat, which is the under-flagging choice.
 *
 * Occurrences recorded outside the supplied days (priorOccurrenceDates) count toward the
 * window, because criterion 10.7's window is the employee's, not the Pay_Month's. The
 * triggering window returned is the earliest one to reach the threshold, so the result does not
 * depend on which end of the month is scanned first.
 */
function assessRepeat(
  occurrenceDates: string[],
  priorOccurrenceDates: string[],
  appliedThresholdCount: number,
  appliedRollingWindowDays: number,
): RepeatOccurrenceAssessment {
  const notRepeat: RepeatOccurrenceAssessment = {
    isRepeatSubject: false,
    appliedThresholdCount,
    appliedRollingWindowDays,
    triggeringWindow: null,
    notifyRoles: [],
  };

  const dayNumbers = new Set<number>();
  for (const date of [...occurrenceDates, ...priorOccurrenceDates]) {
    const dayNumber = toDayNumber(date);
    if (dayNumber !== null) dayNumbers.add(dayNumber);
  }
  const sorted = [...dayNumbers].sort((a, b) => a - b);
  if (sorted.length < appliedThresholdCount) return notRepeat;

  for (let end = appliedThresholdCount - 1; end < sorted.length; end++) {
    const windowEnd = sorted[end];
    const windowStart = windowEnd - (appliedRollingWindowDays - 1);
    const inWindow = sorted.filter((d) => d >= windowStart && d <= windowEnd);
    if (inWindow.length >= appliedThresholdCount) {
      return {
        isRepeatSubject: true,
        appliedThresholdCount,
        appliedRollingWindowDays,
        triggeringWindow: {
          startDate: fromDayNumber(windowStart),
          endDate: fromDayNumber(windowEnd),
          occurrenceDates: inWindow.map(fromDayNumber),
        },
        // criterion 10.7: the employee's branch head and the WFM head. Delivery is the
        // caller's - this module dispatches nothing.
        notifyRoles: ['branch_head', 'wfm_head'],
      };
    }
  }

  return notRepeat;
}
