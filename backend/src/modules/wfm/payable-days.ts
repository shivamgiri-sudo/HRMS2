//
// Requirement 4's day classification (requirements.md, "Payable Days Built From The Resolved
// Source"), implemented as a pure function in the same shape as
// attendance-source-rule-resolver.ts and canonical-productivity.ts: no database import, no
// clock, no id generation. Every input arrives as an argument, so the whole of Requirement 4
// that can be decided from one employee-day is directly unit- and property-testable
// (design.md Testing Strategy).
//
// This module decides ONE employee-day: which minutes figure the resolved Attendance_Source
// contributes (criteria 4.1-4.3), what that day is classified as, what leave-without-pay value
// it carries, and the provenance of that decision. It deliberately does NOT decide Payable_Days
// for a Pay_Month (criterion 4.4 sums these daily results together with approved leave, holiday
// and week-off entitlements and reviewed adjustments) and does not touch
// salary_prep_line.attendance_data_source (criterion 4.5 forbids overloading that column, which
// means nothing here may write it).
//
// WHY THE ENGINE'S NUMBERS ARE DUPLICATED BELOW RATHER THAN IMPORTED
// attendance-engine.service.ts imports ../../db/mysql.js at module scope, so importing anything
// from it opens a database connection. The three thresholds the engine applies today are
// therefore restated here as named constants. They are documentation and test fixtures only:
// classifyMinutes() reads the resolved Day_Threshold_Rule values it is given (criterion 1.16),
// never these constants.
//
// BOUNDARY CONVENTION: AT OR ABOVE, NOT STRICTLY ABOVE
// Evidence, attendance-engine.service.ts:
//   classifyOperationsNetLogin(): `if (netLoginMinutes >= 480) return { status: 'present', ... }`
//                                 `if (netLoginMinutes >= halfDayFloor) return { status: 'half_day', ... }`
//   classifyCosecMinutes():       `if (biometricMinutes >= 540) return { status: 'present', ... }`
//                                 `if (biometricMinutes >= halfDayFloor) return { status: 'half_day', ... }`
// and resolveHalfDayFloorMinutes()'s own doc comment: "A floor qualifies: a day reaching exactly
// this many minutes earns the half day." So an employee on exactly full_day_minutes IS paid a
// full day, and one on exactly half_day_minutes IS paid a half day. This module matches that
// with `>=` at both boundaries. Requirement 4 does not restate the comparison, so the engine's
// convention stands.

/** Permitted Attendance_Source values (criterion 1.2). Mirrors the engine's AttendanceSource. */
export type AttendanceSource = 'dialler' | 'biometric';

/**
 * The classifications one employee-day can land on here. Every value is already a member of
 * attendance_daily_record.attendance_status / the engine's AttendanceStatus union; this module
 * restates the subset it can produce rather than importing the union (see the note above on why
 * attendance-engine.service.ts is not imported).
 *
 * - present / half_day / absent: a day classified from minutes the resolved source reported.
 * - unreconciled: criterion 4.6. The resolved source reported no minutes while the other feed
 *   did. design.md component 6 fixes this status explicitly ("sets attendance_status =
 *   'unreconciled' (the existing enum value already reserved for this kind of ambiguity),
 *   ... applies lwp_value = 0 rather than an absence penalty").
 * - missing_punch: no feed reported anything, or criterion 4.7's uncovered dialler day. Not
 *   named by Requirement 4; it is what attendance-engine.service.ts already writes for a day
 *   with no evidence (`status: 'missing_punch', lwpValue: 0.0, // LWP NOT applied until WFM
 *   resolves`), so it is mirrored rather than replaced.
 */
export type DayClassification =
  | 'present'
  | 'half_day'
  | 'absent'
  | 'unreconciled'
  | 'missing_punch';

/**
 * Why a day landed where it did. Recorded on the provenance so a reviewer sees the reason, not
 * just the outcome, and so a test can distinguish two paths that happen to agree on status.
 */
export type ClassificationReason =
  /** Minutes reached full_day_minutes (criterion 4.1). */
  | 'at_or_above_full_day'
  /** Minutes reached half_day_minutes but not full_day_minutes (criterion 4.1). */
  | 'at_or_above_half_day'
  /** Minutes fell below half_day_minutes with the resolved source reporting (criterion 4.1). */
  | 'below_half_day'
  /** Criterion 4.6: resolved source silent, other feed reported minutes. */
  | 'resolved_source_silent_other_feed_reported'
  /** Criterion 4.7: dialler resolved, no Dialler_Source record in the preceding window. */
  | 'dialler_resolved_no_recent_coverage'
  /** Neither feed reported anything for the date. Mirrors the engine's missing_punch path. */
  | 'no_evidence_from_either_feed';

/**
 * The resolved Day_Threshold_Rule values for this employee and date (criteria 1.14-1.16).
 * Structurally the return of day-threshold-rule.service.ts `resolveDayThresholds()`, so that
 * result can be passed straight in. graceMinutes is carried for provenance only: it drives the
 * late mark in the engine's calculateLateArrival(), and neither classifyCosecMinutes() nor
 * classifyOperationsNetLogin() reads it, so it does not move a day between present, half day
 * and absent. Requirement 4 does not ask it to.
 */
export interface ResolvedDayThresholds {
  fullDayMinutes: number;
  halfDayMinutes: number;
  graceMinutes: number;
  /** The Day_Threshold_Rule that decided these values. Retained for criterion 3.5's audit trail. */
  decidingRuleId?: string | null;
}

export interface PayableDayInput {
  /** The Attendance_Source the Attendance_Source_Resolver returned (criterion 4.1). */
  resolvedSource: AttendanceSource;
  /** The deciding Attendance_Source_Rule id, kept on the provenance (criteria 2.1, 3.5). */
  sourceRuleId?: string | null;
  thresholds: ResolvedDayThresholds;
  /**
   * Biometric_Minutes for the date, or null when the Biometric_Feed holds no punches at all.
   * Used to classify the day when biometric is resolved (criterion 4.2) and as the "other feed"
   * figure when dialler is resolved (criterion 4.6).
   */
  biometricMinutes: number | null;
  /**
   * Canonical_Productive_Minutes for the date as derived by Requirement 18 — the `minutes` field
   * of canonical-productivity.ts `deriveCanonical()`. null means absent for this employee-date
   * (criterion 18.10: absent is never a measured zero). Used to classify the day when dialler is
   * resolved (criterion 4.3) and as the "other feed" figure when biometric is resolved.
   */
  canonicalProductiveMinutes: number | null;
  /**
   * Criterion 4.7: has any registered Dialler_Source carried a record for this employee within
   * the 30 days preceding the date? Read only when the resolved source is dialler. Omitted means
   * "not known to be covered", which routes an otherwise-absent day to review rather than to an
   * absence — the direction criterion 4.7 mandates, so the default is the safe one.
   */
  diallerRecordInPrecedingWindow?: boolean;
}

export interface PayableDayProvenance {
  resolvedSource: AttendanceSource;
  sourceRuleId: string | null;
  /** The minutes the classification was actually taken from, or null if the source was silent. */
  classifiedFromMinutes: number | null;
  /** Both feeds' figures, recorded whatever the outcome (criterion 4.6's "record the minutes both feeds reported"). */
  biometricMinutes: number | null;
  canonicalProductiveMinutes: number | null;
  appliedFullDayMinutes: number;
  appliedHalfDayMinutes: number;
  appliedGraceMinutes: number;
  thresholdRuleId: string | null;
  /** Stated rather than implied, because it decides the pay of a day sitting exactly on a threshold. */
  thresholdComparison: 'at_or_above';
  reason: ClassificationReason;
}

export interface PayableDayResult {
  classification: DayClassification;
  /** attendance_daily_record.lwp_value. 0 for a full day and for every review state, 0.5 for a half day, 1 for a proven absence. */
  lwpValue: 0 | 0.5 | 1;
  /**
   * What this day contributes to Payable_Days (criterion 4.4). null means "not determined by this
   * day alone": the day is in review, and criterion 4.6 forbids applying a leave-without-pay
   * value until that review completes, so its contribution comes from the reviewed adjustment of
   * Requirement 8 rather than from here.
   */
  payableDayValue: number | null;
  requiresReview: boolean;
  provenance: PayableDayProvenance;
}

// ── The engine's current numbers, duplicated (see the module header for why) ───────────────────

/** attendance-engine.service.ts classifyCosecMinutes(): `biometricMinutes >= 540`. */
export const ENGINE_BIOMETRIC_FULL_DAY_MINUTES = 540;
/** attendance-engine.service.ts classifyOperationsNetLogin(): `netLoginMinutes >= 480`. */
export const ENGINE_DIALLER_FULL_DAY_MINUTES = 480;
/** attendance-engine.service.ts DEFAULT_HALF_DAY_FLOOR_MINUTES. */
export const ENGINE_DEFAULT_HALF_DAY_FLOOR_MINUTES = 240;

// ── Validation: programmer errors only ────────────────────────────────────────────────────────

function assertUsableThreshold(name: string, value: number): void {
  // A non-finite or negative threshold is a programmer/configuration error, not ordinary data:
  // design.md component 2 moves exactly this guard to write time ("a non-finite or non-positive
  // threshold is rejected at write time rather than defended at read time"). Reaching
  // classification with one would mean the write-time guard was bypassed, so it throws rather
  // than silently classifying. `minutes >= NaN` is false for every input, which is how a single
  // bad setting would otherwise dock a full day's pay from the whole workforce — the exact
  // failure resolveHalfDayFloorMinutes() was written to prevent.
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `payable-days: ${name} must be a finite, non-negative number of minutes, received ${String(value)}`,
    );
  }
}

function assertUsableMinutes(name: string, value: number | null): void {
  if (value === null) return;
  // Same reasoning in the other direction: NaN or negative minutes would fall through both
  // comparisons and be recorded as a proven absence with lwp 1.00. Upstream is responsible for
  // sanitizing (deriveCanonical() already clamps to [0, 1440]), so this is a programmer error.
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `payable-days: ${name} must be null or a finite, non-negative number of minutes, received ${String(value)}`,
    );
  }
}

// ── Classification ───────────────────────────────────────────────────────────────────────────

/**
 * Classify a minutes figure against resolved thresholds (criterion 4.1). This is the single
 * classifier design.md component 2 calls `classifyMinutes(rawMinutes, thresholds)` — the same
 * comparison chain classifyCosecMinutes() and classifyOperationsNetLogin() run today, with the
 * two hardcoded full-day values (540 biometric, 480 dialler) and the half-day floor replaced by
 * the resolved Day_Threshold_Rule values, so one function serves both sources.
 *
 * Full day is tested first, so a store holding half_day_minutes above full_day_minutes still
 * produces a defined result rather than an unreachable branch.
 */
export function classifyMinutes(
  minutes: number,
  thresholds: ResolvedDayThresholds,
): { classification: 'present' | 'half_day' | 'absent'; lwpValue: 0 | 0.5 | 1; reason: ClassificationReason } {
  assertUsableThreshold('fullDayMinutes', thresholds.fullDayMinutes);
  assertUsableThreshold('halfDayMinutes', thresholds.halfDayMinutes);
  assertUsableThreshold('graceMinutes', thresholds.graceMinutes);
  assertUsableMinutes('minutes', minutes);

  if (minutes >= thresholds.fullDayMinutes) {
    return { classification: 'present', lwpValue: 0, reason: 'at_or_above_full_day' };
  }
  if (minutes >= thresholds.halfDayMinutes) {
    return { classification: 'half_day', lwpValue: 0.5, reason: 'at_or_above_half_day' };
  }
  return { classification: 'absent', lwpValue: 1, reason: 'below_half_day' };
}

/**
 * Classify one employee-day and state its payable/LWP value with the provenance of the decision.
 *
 * Total by construction: every combination of the declared inputs returns a result. The only
 * throws are the two programmer-error guards above (non-finite or negative thresholds/minutes).
 */
export function classifyPayableDay(input: PayableDayInput): PayableDayResult {
  const { resolvedSource, thresholds } = input;

  assertUsableThreshold('fullDayMinutes', thresholds.fullDayMinutes);
  assertUsableThreshold('halfDayMinutes', thresholds.halfDayMinutes);
  assertUsableThreshold('graceMinutes', thresholds.graceMinutes);
  assertUsableMinutes('biometricMinutes', input.biometricMinutes);
  assertUsableMinutes('canonicalProductiveMinutes', input.canonicalProductiveMinutes);

  // Criteria 4.2 and 4.3: the resolved source decides which figure is classified, and the other
  // figure is retained as evidence only. This selection is the whole point of Requirement 4 —
  // it is what replaces the engine's `configuredAprEmployee || hasScopedDiallerRule` OR.
  const resolvedMinutes =
    resolvedSource === 'biometric' ? input.biometricMinutes : input.canonicalProductiveMinutes;
  const otherFeedMinutes =
    resolvedSource === 'biometric' ? input.canonicalProductiveMinutes : input.biometricMinutes;

  const provenanceBase = {
    resolvedSource,
    sourceRuleId: input.sourceRuleId ?? null,
    biometricMinutes: input.biometricMinutes,
    canonicalProductiveMinutes: input.canonicalProductiveMinutes,
    appliedFullDayMinutes: thresholds.fullDayMinutes,
    appliedHalfDayMinutes: thresholds.halfDayMinutes,
    appliedGraceMinutes: thresholds.graceMinutes,
    thresholdRuleId: thresholds.decidingRuleId ?? null,
    thresholdComparison: 'at_or_above' as const,
  };

  // "Reports no minutes" covers both null and zero. Defect E4 in requirements.md: a stored zero
  // is a filler, not a measured zero ("A stored dialler_minutes = 0 is a filler, not a measured
  // zero"), and attendance-engine.service.ts already makes exactly this test on the merged
  // figure: `if (rawMinutes === 0 && !(isAprEmployee && aprFeedCoversEmployee))`.
  const otherFeedReported = otherFeedMinutes !== null && otherFeedMinutes > 0;

  // Written as the condition itself rather than through a boolean so the compiler narrows
  // resolvedMinutes to a number after this block, with no cast needed at the classify call.
  if (resolvedMinutes === null || resolvedMinutes <= 0) {
    // Criterion 4.6, checked before 4.7 because it is the more informative of the two review
    // states and both end in review, so the order changes the recorded reason, never whether the
    // day is reviewed. Both feeds' minutes are on the provenance either way.
    if (otherFeedReported) {
      return {
        classification: 'unreconciled',
        lwpValue: 0,
        payableDayValue: null,
        requiresReview: true,
        provenance: {
          ...provenanceBase,
          classifiedFromMinutes: null,
          reason: 'resolved_source_silent_other_feed_reported',
        },
      };
    }

    // Criterion 4.7. Read only for a dialler-resolved day, and only here, where the day would
    // otherwise be recorded as an absence: an employee no registered Dialler_Source has carried
    // in the preceding 30 days is not enrolled, and requirements.md measured the cost of judging
    // that population on the dialler anyway (1,577.5 paid days removed, 461 people taken to zero
    // paid days in six days of one month).
    if (resolvedSource === 'dialler' && input.diallerRecordInPrecedingWindow !== true) {
      return {
        classification: 'missing_punch',
        lwpValue: 0,
        payableDayValue: null,
        requiresReview: true,
        provenance: {
          ...provenanceBase,
          classifiedFromMinutes: null,
          reason: 'dialler_resolved_no_recent_coverage',
        },
      };
    }

    // Nothing from either feed, and either biometric is resolved or the dialler feed does carry
    // this employee. Requirement 4 is silent here, so attendance-engine.service.ts decides:
    //   - dialler resolved and the feed covers the employee: the day falls through to the
    //     classifier and lands on absent with lwp 1.00, per the 2026-08-07 ruling recorded in
    //     that file ("a short or missing dialler login IS the attendance answer for that role").
    //   - otherwise: 'missing_punch' with `lwpValue: 0.0, // LWP NOT applied until WFM resolves`.
    if (resolvedSource === 'dialler') {
      const zeroMinuteClassification = classifyMinutes(0, thresholds);
      return {
        classification: zeroMinuteClassification.classification,
        lwpValue: zeroMinuteClassification.lwpValue,
        payableDayValue: 1 - zeroMinuteClassification.lwpValue,
        requiresReview: false,
        provenance: {
          ...provenanceBase,
          // Zero, not null: the feed covers this employee and reported nothing for the date,
          // which is a measured zero for them rather than an absence of evidence.
          classifiedFromMinutes: 0,
          reason: zeroMinuteClassification.reason,
        },
      };
    }

    return {
      classification: 'missing_punch',
      lwpValue: 0,
      payableDayValue: null,
      requiresReview: true,
      provenance: {
        ...provenanceBase,
        classifiedFromMinutes: null,
        reason: 'no_evidence_from_either_feed',
      },
    };
  }

  // Criterion 4.1: classify from the minutes the resolved source reported.
  const classified = classifyMinutes(resolvedMinutes, thresholds);
  return {
    classification: classified.classification,
    lwpValue: classified.lwpValue,
    // Criterion 4.8's per-day half of the bounds invariant: 1 - lwpValue over {0, 0.5, 1} is
    // {1, 0.5, 0}, so a day can never contribute more than one day or less than zero to
    // Payable_Days however the thresholds are configured.
    payableDayValue: 1 - classified.lwpValue,
    requiresReview: false,
    provenance: {
      ...provenanceBase,
      classifiedFromMinutes: resolvedMinutes,
      reason: classified.reason,
    },
  };
}

/**
 * Rank of a classification for the monotonicity property: more minutes must never produce a
 * strictly worse-paid day. absent < half_day < present. The review states are unranked (null)
 * because they are not reached by varying minutes with the rest of the input held fixed.
 */
export function classificationRank(classification: DayClassification): number | null {
  switch (classification) {
    case 'absent':
      return 0;
    case 'half_day':
      return 1;
    case 'present':
      return 2;
    case 'unreconciled':
    case 'missing_punch':
      return null;
  }
}
