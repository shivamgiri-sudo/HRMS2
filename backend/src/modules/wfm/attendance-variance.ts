//
// Requirement 5 (Productivity Corroboration Without Blocking) and Requirement 6 (Variance
// Detection) of requirements.md, implemented as pure functions over ONE employee-day's already
// resolved inputs: the resolved Attendance_Source, the minutes that source reported, the
// corroborating Canonical_Productive_Minutes (Requirement 18, canonical-productivity.ts) and the
// already resolved threshold values. No database, no clock, no randomness — the same shape as
// attendance-source-rule-resolver.ts, canonical-productivity.ts and
// attendance-rule-migration-proposal.ts, so every branch here is directly property-testable
// (design.md Testing Strategy).
//
// TWO STRUCTURAL GUARANTEES, both enforced by the compiler rather than by comment:
//
//  1. Requirement 5's title — corroboration WITHOUT BLOCKING. `CorroborationResult` carries no
//     attendance classification, no lwp value, no payable-day figure and no blocking flag, so
//     there is no field on it a classifier could read even if a later caller wanted to. And
//     selectClassificationMinutes() — the function that decides which minutes classify the day
//     (criteria 4.2, 4.3, 5.6) — does not take a CorroborationResult or a VarianceEvaluation as
//     a parameter at all, and reads `evidence` only on the `dialler` branch. On a
//     biometric-resolved day there is therefore no code path by which any corroboration or
//     variance outcome can reach the classification.
//
//  2. Absent productivity evidence is never a zero (criteria 5.2, 5.3, 18.10).
//     `ProductivityEvidence` is a discriminated union, not `number | null`, and the only
//     constructor exported here is productivityEvidenceFromCanonical(), which maps
//     CanonicalResult's `minutes: null` to `{ state: 'absent' }`. A caller cannot reach a number
//     without first destructuring the discriminant. "No productivity feed at all" — the common
//     case, on 26,215 of 29,271 July 2026 biometric-source days (evidence E7) — is therefore a
//     distinct, defined outcome and never collapses into "the feed reported zero minutes", which
//     is a real measurement and is treated as one.
//
// Deliberately NOT modelled here, because a pure function over one employee-day cannot decide it
// without the live database, a month of history or the Requirement 7 review workflow:
// criteria 6.5 (idempotence — a DB upsert on the existing conflict_key), 6.8 through 6.14 (queue
// state, ranking and the Dual_Review_Ceiling are one idempotent pass over a whole branch and
// Pay_Month, per design.md "Always-queue"), and the identity half of 6.3 (employee id, date,
// deciding Attendance_Source_Rule id and the per-Dialler_Source contribution breakdown are
// inputs the writer already holds, not inputs to this decision).

import type { CanonicalResult, ProducingRule } from './canonical-productivity.js';

// requirements.md decision A9: the existing enum('dialler','biometric') is adopted unchanged and
// no third value exists anywhere in the schema. Stated inline exactly as
// attendance-source-rule.service.ts states it, rather than imported from
// attendance-engine.service.ts, so this module keeps no edge to a db-importing module.
export type ResolvedAttendanceSource = 'dialler' | 'biometric';

// attendance_daily_record.attendance_status (evidence E6), in full, so this module is total over
// every classification the engine can actually produce.
export type DayClassification =
  | 'present'
  | 'half_day'
  | 'absent'
  | 'leave_approved'
  | 'holiday'
  | 'week_off'
  | 'unreconciled'
  | 'missing_punch'
  | 'week_off_worked';

/**
 * criteria 5.3, 18.10. Productivity evidence for one employee-date is present with a value, or
 * absent — never a nullable number. See guarantee 2 in the file header.
 */
export type ProductivityEvidence =
  | { readonly state: 'present'; readonly minutes: number; readonly rule: ProducingRule }
  | { readonly state: 'absent' };

export const PRODUCTIVITY_EVIDENCE_ABSENT: ProductivityEvidence = Object.freeze({
  state: 'absent',
});

// criteria 5.5 (480) and 6.2 (60). These mirror DEFAULT_THRESHOLD_MINUTES in
// attendance-threshold-config.service.ts, which is the db-backed resolver for the same two
// values; that module cannot be imported here because it imports `db` and this module is pure.
export const DEFAULT_APR_CORROBORATION_THRESHOLD_MINUTES = 480;
export const DEFAULT_VARIANCE_TOLERANCE_MINUTES = 60;

// criterion 6.7. `week_off_worked` is deliberately absent from this list: it is a worked day, and
// the requirement names only approved leave, holiday and week off. Extending suppression to it
// would be inventing policy the requirement does not state.
const VARIANCE_SUPPRESSING_CLASSIFICATIONS: readonly DayClassification[] = Object.freeze([
  'leave_approved',
  'holiday',
  'week_off',
]);

export type CorroborationState =
  // The resolved Attendance_Source is `dialler`. Requirement 5 governs biometric-resolved days
  // only (criteria 5.1, 5.6, 5.7); on a dialler-resolved day the productivity figure classifies
  // the day (criterion 4.3) and is not a corroborating second opinion. No corroboration verdict
  // is invented for that case.
  | 'not_applicable'
  // criterion 5.7: no registered Dialler_Source holds a record for the date. The expected case,
  // not an exception.
  | 'evidence_absent'
  // Canonical_Productive_Minutes reach the applied APR_Corroboration_Threshold.
  | 'corroborated'
  // Evidence is present — including a genuine zero — and falls short of the threshold. This is
  // an annotation only: by criterion 5.6 it feeds nothing but the raising of a Variance_Record.
  | 'shortfall';

/**
 * criteria 5.6, 5.7, 5.9. Note what this interface does NOT carry: no attendance classification,
 * no lwp value, no payable-day figure, no blocking flag. That absence is Requirement 5's
 * non-blocking guarantee expressed in the type system (guarantee 1 in the file header).
 *
 * It also carries no Dialler_Source identity, which is criterion 5.9's source-neutrality made
 * structural: the decision cannot depend on which feed supplied the evidence because the identity
 * of that feed is not reachable from the inputs.
 */
export interface CorroborationResult {
  readonly state: CorroborationState;
  // null exactly when evidence is absent (criterion 5.3) — never 0 standing in for absence.
  readonly productiveMinutes: number | null;
  readonly producingRule: ProducingRule | null;
  readonly appliedThresholdMinutes: number;
  // criterion 5.8: the rejected configured value, retained so the administrator-visible warning
  // can name it.
  readonly rejectedThresholdValue: number | null;
  readonly configurationWarnings: readonly string[];
}

export type VarianceDecision =
  // criterion 6.1: biometric-resolved, evidence present, below the corroboration threshold, and
  // biometric exceeds productive by at least the tolerance.
  | 'raised_biometric_shortfall'
  // criterion 6.4: dialler-resolved, biometric exceeds productive by at least the tolerance, and
  // the day is classified absent or half day.
  | 'raised_dialler_underclassified'
  // criterion 6.7.
  | 'not_raised_suppressed_day'
  // criteria 6.1 and 6.4 both compare two present figures (design.md section 6). With no
  // productivity evidence there is nothing to compare, and criterion 5.7 requires the biometric
  // classification to stand. The "resolved source reported nothing while the other feed did"
  // case is criterion 4.6's `unreconciled` path, which is Requirement 4's, not this module's.
  | 'not_raised_evidence_absent'
  | 'not_raised_biometric_absent'
  // criterion 6.6, the no-false-positive property.
  | 'not_raised_within_tolerance'
  // criterion 6.1's threshold conjunct is unmet: productivity corroborates the day.
  | 'not_raised_corroborated'
  // criterion 6.4's classification conjunct is unmet: the day is not an absence or half day.
  | 'not_raised_classification_not_shortfall';

export interface VarianceEvaluation {
  readonly decision: VarianceDecision;
  readonly raised: boolean;
  // A raised Variance_Record is exactly the set of days a reviewer must look at. Note this is
  // NOT the same as `exceedsTolerance`: the tolerance test can pass on a day that raises nothing
  // (a corroborated biometric day under criterion 6.1, or a dialler day classified `present`
  // under criterion 6.4), which is why the two are reported separately rather than conflated.
  readonly needsReview: boolean;
  // The tolerance test of criteria 6.1 / 6.4 / 6.6 in isolation: Biometric_Minutes exceed
  // Canonical_Productive_Minutes by at least the applied Variance_Tolerance. false whenever
  // either figure is absent, because an absent figure is not a comparison.
  readonly exceedsTolerance: boolean;
  // design.md: Variance_Risk_Score = Biometric_Minutes - Canonical_Productive_Minutes. null when
  // either figure is absent, so an absent feed cannot manufacture a risk score.
  readonly varianceRiskScore: number | null;
  // The evidence snapshot half of criterion 6.3 that this decision actually computes.
  readonly biometricMinutes: number | null;
  readonly canonicalProductiveMinutes: number | null;
  readonly resolvedAttendanceSource: ResolvedAttendanceSource;
  readonly appliedCorroborationThresholdMinutes: number;
  readonly appliedVarianceToleranceMinutes: number;
  readonly configurationWarnings: readonly string[];
}

export interface ClassificationInput {
  readonly basis: 'biometric_minutes' | 'canonical_productive_minutes';
  // null means the resolved source reported nothing for the date, which is criterion 4.6/4.7's
  // requires-review input — never a zero-minute (and therefore absent) day.
  readonly minutes: number | null;
}

export interface CorroborationEvaluationInput {
  readonly resolvedSource: ResolvedAttendanceSource;
  readonly evidence: ProductivityEvidence;
  // The APR_Corroboration_Threshold already resolved for this employee and date by
  // attendance-threshold-config.service.ts. null or undefined means nothing is configured, which
  // criterion 5.5 answers with 480 — distinct from a configured-but-invalid value, which is
  // criterion 5.8 and is recorded and warned about.
  readonly configuredCorroborationThresholdMinutes?: number | null;
}

export interface VarianceEvaluationInput extends CorroborationEvaluationInput {
  // Minutes reported by the biometric feed for the date. null means no biometric evidence.
  readonly biometricMinutes: number | null;
  readonly dayClassification: DayClassification;
  readonly configuredVarianceToleranceMinutes?: number | null;
}

/**
 * A minutes figure is usable only when it is a finite, non-negative number. Anything else — NaN
 * from an unparsed cell, a negative from a mis-signed subtraction — becomes absent, never zero,
 * so junk can never present itself as a measured zero-minute day. Total by construction: no
 * throw for any input.
 */
function usableMinutes(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * criteria 5.3, 18.10. The only supported way to obtain a ProductivityEvidence: CanonicalResult's
 * `minutes: null` (no attributed contribution at all) becomes `{ state: 'absent' }`, while a
 * derived 0 stays present with minutes 0, because the aggregation genuinely measured zero
 * productive minutes across contributions that did exist.
 *
 * There is deliberately no converter from `attendance_daily_record.dialler_minutes` here:
 * criterion 5.1 forbids reading that column for corroboration, and offering the conversion would
 * be offering the forbidden path.
 */
export function productivityEvidenceFromCanonical(result: CanonicalResult): ProductivityEvidence {
  const minutes = usableMinutes(result.minutes);
  if (minutes === null || result.rule === null) return PRODUCTIVITY_EVIDENCE_ABSENT;
  return { state: 'present', minutes, rule: result.rule };
}

interface NormalizedEvidence {
  readonly minutes: number | null;
  readonly rule: ProducingRule | null;
  readonly warning: string | null;
}

/**
 * Defends the absent-versus-zero distinction against a hand-built ProductivityEvidence whose
 * `minutes` is not a usable number. Such a value degrades to absent — never to 0 — and is
 * warned about, because the failure mode this whole module exists to prevent is an absent feed
 * becoming a zero-minute day.
 */
function normalizeEvidence(evidence: ProductivityEvidence): NormalizedEvidence {
  if (evidence.state === 'absent') return { minutes: null, rule: null, warning: null };
  const minutes = usableMinutes(evidence.minutes);
  if (minutes === null) {
    return {
      minutes: null,
      rule: null,
      warning:
        `Productivity evidence was marked present with an unusable minutes value ` +
        `(${String(evidence.minutes)}); treated as absent rather than as zero minutes.`,
    };
  }
  return { minutes, rule: evidence.rule, warning: null };
}

interface AppliedThreshold {
  readonly minutes: number;
  readonly rejectedValue: number | null;
  readonly warning: string | null;
}

/**
 * criteria 5.5, 5.8 and 6.2. Nothing configured applies the stated default silently. A configured
 * value that is not a finite number greater than zero applies the default, retains the rejected
 * value and raises an administrator-visible warning.
 *
 * The "greater than zero" test — rather than "at least zero" — matches the read-time guard
 * resolveThreshold() already applies in attendance-threshold-config.service.ts. Criterion 6.2 is
 * silent on whether a configured tolerance of 0 is meaningful; this follows the existing
 * resolver's convention rather than inventing a second, contradictory one.
 */
function applyThreshold(
  label: string,
  configured: number | null | undefined,
  fallback: number,
): AppliedThreshold {
  if (configured === null || configured === undefined) {
    return { minutes: fallback, rejectedValue: null, warning: null };
  }
  if (!Number.isFinite(configured) || configured <= 0) {
    return {
      minutes: fallback,
      rejectedValue: configured,
      warning:
        `Configured ${label} of ${String(configured)} is not a finite number greater than zero; ` +
        `applied the default of ${fallback} minutes instead.`,
    };
  }
  return { minutes: configured, rejectedValue: null, warning: null };
}

/**
 * criteria 4.2, 4.3, 5.6. Selects the minutes that classify the day.
 *
 * Requirement 5's non-blocking guarantee lives in this signature: neither CorroborationResult nor
 * VarianceEvaluation is a parameter, and on the `biometric` branch `evidence` is never read. A
 * corroboration shortfall therefore cannot alter what this returns — not by policy, but because
 * there is no parameter through which it could arrive.
 */
export function selectClassificationMinutes(
  resolvedSource: ResolvedAttendanceSource,
  biometricMinutes: number | null,
  evidence: ProductivityEvidence,
): ClassificationInput {
  if (resolvedSource === 'biometric') {
    // criterion 5.6: from Biometric_Minutes alone.
    return { basis: 'biometric_minutes', minutes: usableMinutes(biometricMinutes) };
  }
  // criterion 4.3: from Canonical_Productive_Minutes. Absent evidence stays absent (null) so the
  // caller reaches criterion 4.7's requires-review state instead of a zero-minute absence.
  return {
    basis: 'canonical_productive_minutes',
    minutes: normalizeEvidence(evidence).minutes,
  };
}

/**
 * Requirement 5. Returns the corroboration outcome for one employee-day. Cannot block the day:
 * see the file header, guarantee 1.
 */
export function evaluateCorroboration(input: CorroborationEvaluationInput): CorroborationResult {
  const threshold = applyThreshold(
    'APR_Corroboration_Threshold',
    input.configuredCorroborationThresholdMinutes,
    DEFAULT_APR_CORROBORATION_THRESHOLD_MINUTES,
  );
  const evidence = normalizeEvidence(input.evidence);
  const warnings = [threshold.warning, evidence.warning].filter(
    (w): w is string => w !== null,
  );

  const base = {
    productiveMinutes: evidence.minutes,
    producingRule: evidence.rule,
    appliedThresholdMinutes: threshold.minutes,
    rejectedThresholdValue: threshold.rejectedValue,
    configurationWarnings: Object.freeze(warnings),
  };

  // criteria 5.1, 5.6, 5.7: Requirement 5 governs biometric-resolved days. A dialler-resolved day
  // is classified from the same productivity figure (criterion 4.3), so there is no second
  // opinion to corroborate and none is invented.
  if (input.resolvedSource === 'dialler') {
    return { state: 'not_applicable', ...base };
  }

  // criterion 5.7: absence is the expected case (26,215 of 29,271 July 2026 biometric-source
  // days had no productivity figure at all, evidence E7), and the biometric classification
  // stands untouched.
  if (evidence.minutes === null) {
    return { state: 'evidence_absent', ...base };
  }

  // A present zero is a measurement, not an absence: it corroborates nothing and is a shortfall.
  return {
    state: evidence.minutes >= threshold.minutes ? 'corroborated' : 'shortfall',
    ...base,
  };
}

/**
 * Requirement 6. Returns whether a Variance_Record is raised for one employee-day, the tolerance
 * test in isolation and the Variance_Risk_Score.
 *
 * Boundary reading, stated explicitly because the requirement's two halves are worded
 * differently: criteria 6.1 and 6.4 raise when Biometric_Minutes exceed
 * Canonical_Productive_Minutes by "at least the Variance_Tolerance", so an excess exactly equal
 * to the tolerance RAISES. Criterion 6.6's "within the Variance_Tolerance of each other" is
 * therefore read as an excess strictly below the tolerance.
 */
export function evaluateVariance(input: VarianceEvaluationInput): VarianceEvaluation {
  const corroboration = evaluateCorroboration(input);
  const tolerance = applyThreshold(
    'Variance_Tolerance',
    input.configuredVarianceToleranceMinutes,
    DEFAULT_VARIANCE_TOLERANCE_MINUTES,
  );

  const biometricMinutes = usableMinutes(input.biometricMinutes);
  const canonicalProductiveMinutes = corroboration.productiveMinutes;

  const warnings = [...corroboration.configurationWarnings];
  if (tolerance.warning !== null) warnings.push(tolerance.warning);

  const comparable = biometricMinutes !== null && canonicalProductiveMinutes !== null;
  const varianceRiskScore = comparable
    ? biometricMinutes - canonicalProductiveMinutes
    : null;
  const exceedsTolerance = varianceRiskScore !== null && varianceRiskScore >= tolerance.minutes;

  const decide = (decision: VarianceDecision, raised: boolean): VarianceEvaluation => ({
    decision,
    raised,
    needsReview: raised,
    exceedsTolerance,
    varianceRiskScore,
    biometricMinutes,
    canonicalProductiveMinutes,
    resolvedAttendanceSource: input.resolvedSource,
    appliedCorroborationThresholdMinutes: corroboration.appliedThresholdMinutes,
    appliedVarianceToleranceMinutes: tolerance.minutes,
    configurationWarnings: Object.freeze(warnings),
  });

  // criterion 6.7: no Variance_Record on approved leave, holiday or week off, whatever the feeds
  // report. Checked first because it is unconditional.
  if (VARIANCE_SUPPRESSING_CLASSIFICATIONS.includes(input.dayClassification)) {
    return decide('not_raised_suppressed_day', false);
  }

  // criteria 6.1 and 6.4 both compare two present figures. Either figure absent means there is
  // no comparison to make here; that day belongs to criterion 4.6's `unreconciled` path.
  if (biometricMinutes === null) {
    return decide('not_raised_biometric_absent', false);
  }
  if (canonicalProductiveMinutes === null) {
    return decide('not_raised_evidence_absent', false);
  }

  // criterion 6.6, checked before the source-specific conjuncts so the no-false-positive
  // property holds on both sources by one branch.
  if (!exceedsTolerance) {
    return decide('not_raised_within_tolerance', false);
  }

  if (input.resolvedSource === 'biometric') {
    // criterion 6.1's remaining conjunct: productivity must fall below the corroboration
    // threshold. `state` is 'corroborated' or 'shortfall' here, evidence being present.
    if (corroboration.state === 'corroborated') {
      return decide('not_raised_corroborated', false);
    }
    return decide('raised_biometric_shortfall', true);
  }

  // criterion 6.4's remaining conjunct: the day is classified as an absence or a half day. A
  // dialler-resolved day already classified `present` from the same productivity figure is not a
  // disagreement between feeds worth a reviewer's time.
  if (input.dayClassification !== 'absent' && input.dayClassification !== 'half_day') {
    return decide('not_raised_classification_not_shortfall', false);
  }
  return decide('raised_dialler_underclassified', true);
}
