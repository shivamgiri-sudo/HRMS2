//
// Requirement 15's migration reconciliation reports (requirements.md criteria 15.9, 15.10,
// 15.13, 15.14 and 15.15), implemented as a PURE function in the same shape as
// attendance-rule-migration-proposal.ts and attendance-source-rule-resolver.ts.
//
// WHAT THIS IS FOR
// Criterion 15.11 requires an explicit approval before the proposed rule set becomes the active
// store. These are the reports that approval is judged on: what changes, what does not, and what
// cannot be answered at all. Criterion 15.13 is the no-silent-change property, which is the
// entire safety argument for the migration, so it is returned as a machine-checkable flag with
// enumerated violations rather than as prose a reviewer has to trust.
//
// PURITY IS THE POINT, NOT A STYLE CHOICE
// No database import, no db.execute, no new Date(), no randomUUID(). The proposed rule set, the
// employees with their existing resolutions, the effective date and the open Pay_Months all
// arrive as arguments. That is what makes the reports assertable: the thing under test is "given
// this rule set and these employees, what changes", and a report that reached for a clock or a
// connection could not be diffed between two runs. Running this function changes nothing; it
// returns a plain object.
//
// THE COMPARISON USES THE REAL RESOLVER
// resolveRule() from attendance-source-rule-resolver.ts is what will resolve the approved rules
// in production (attendance-source-rule.service.ts and day-threshold-rule.service.ts are thin
// DB-backed wrappers over it). This module adapts the proposed rules into that resolver's input
// shape and calls it. Reimplementing matching, specificity, Dimension_Priority_Order and the
// deterministic tail here would make the report a comparison against something other than what
// will actually run, which is precisely the failure the report exists to prevent.
//
// WHAT THE CALLER SUPPLIES AND WHY
// The EXISTING engine's resolution per employee is an argument, not something this module
// derives. attendance-engine.service.ts resolves it with SQL against attendance_rule_config and
// apr_eligibility_config, so deriving it here would mean either a database connection or a
// second implementation of the legacy engine. Both are worse than an argument the caller reads
// once and passes in.
//
// PRODUCTION NUMBERS ARE CONTEXT, NOT EXPECTATIONS
// Criterion 15.15 quotes 34 employees with no cost_centre_id, 75 with no process_id, 196 with no
// profile_type, out of 1,123 active. Those figures are not encoded anywhere in this module or in
// its tests: the real rows are not available here, and a hardcoded expectation would fail the
// day master data is corrected, which is the outcome the report is meant to drive. Counts and
// percentages are reported so a reviewer can compare them against those figures by eye.

import {
  DIMENSION_PRIORITY_ORDER,
  resolveRule,
  type DimensionScopedRule,
  type EmployeeAttributes,
  type RuleDimension,
} from './attendance-source-rule-resolver.js';

import type {
  AttendanceRuleMigrationProposal,
  ProposedAttendanceSource,
  ProposedDayThresholdRule,
  ProposedDimensionValue,
  ProposedSourceRule,
} from './attendance-rule-migration-proposal.js';

/**
 * The part of the builder's output these reports consume. Declared as a Pick of the builder's
 * own type rather than as a fresh interface so that a shape change in the proposal is a
 * compile error here instead of a silently stale report, and so a whole
 * AttendanceRuleMigrationProposal can be passed straight in.
 */
export type ReconciliationRuleSet = Pick<
  AttendanceRuleMigrationProposal,
  'sourceRules' | 'dayThresholdRules'
>;

/** The three day-classification thresholds of criteria 15.9 / 15.8. */
export interface DayThresholdValues {
  fullDayMinutes: number;
  halfDayMinutes: number;
  graceMinutes: number;
}

/**
 * One currently active employee: the six Rule_Dimension values, plus what the EXISTING engine
 * resolves for them today.
 *
 * existingAttendanceSource is typed as a raw string because it comes out of the legacy engine
 * rather than out of this codebase's enum. It is normalised below, and a value that is neither
 * 'dialler' nor 'biometric' is reported as unknown rather than guessed at.
 *
 * existingThresholds may be null when the caller could not determine what the legacy engine
 * applies (for instance an employee no attendance_rule_config row matches, where the engine
 * falls back internally). Null is reported as unknown, never as a match.
 */
export interface ReconciliationEmployee {
  employeeId: string;
  attributes: EmployeeAttributes;
  existingAttendanceSource?: string | null;
  existingThresholds?: DayThresholdValues | null;
}

export interface BuildReconciliationInput {
  /** The proposed rule set from buildAttendanceRuleMigrationProposal(). */
  proposal: ReconciliationRuleSet;
  /** Every currently active employee. An empty list is valid and yields empty reports. */
  employees: readonly ReconciliationEmployee[];
  /** 'YYYY-MM-DD'. The date the proposed rules are resolved as of. */
  effectiveDate: string;
  /**
   * criterion 15.14: the open Pay_Month dates ('YYYY-MM'). Which months are open is state this
   * module does not hold, so the caller supplies it. Omitted or empty still lists the employees
   * requiring reprocessing, just with no month attached.
   */
  openPayMonths?: readonly string[];
}

export type SourceComparisonStatus =
  /** Existing and proposed resolutions agree. Eligible for the criterion 15.13 unchanged set. */
  | 'match'
  /** Both resolutions are known and they differ. criterion 15.10's differing list. */
  | 'differs'
  /** No proposed rule matched this employee at all. Usually a criterion 15.15 population. */
  | 'proposed_unresolved'
  /** The caller could not supply the existing resolution, so nothing can be asserted. */
  | 'existing_unknown';

export interface AttendanceSourceComparison {
  employeeId: string;
  /** criterion 15.10: what the existing engine resolves today, normalised. */
  existingAttendanceSource: ProposedAttendanceSource | null;
  /** The caller's value as supplied, retained when it normalised to null. */
  existingAttendanceSourceRaw: string | null;
  /** criterion 15.10: what the proposed rule set resolves. Null when no rule matched. */
  proposedAttendanceSource: ProposedAttendanceSource | null;
  proposedRuleProposalKey: string | null;
  proposedRuleName: string | null;
  proposedRuleIsSystemDefault: boolean;
  /** Number of Rule_Dimensions the winning proposed rule constrains, or -1 when none matched. */
  proposedSpecificityCount: number;
  status: SourceComparisonStatus;
  /**
   * True when the winner was decided by comparing rule identity rather than by scope, date or
   * created_at. Every proposed rule is created by one migration run, so created_at cannot break
   * a tie between two of them, and the identity compared here is the proposal_key rather than
   * the CHAR(36) id the persister will mint. A resolution decided that way is not guaranteed to
   * reproduce in production, so it is flagged and it fails the criterion 15.13 property.
   */
  tieBreakReachedIdentity: boolean;
  /** criterion 2.8 / 15.15: dimensions this employee holds no value for. */
  missingDimensions: RuleDimension[];
}

export type ThresholdComparisonStatus = SourceComparisonStatus;

export type DayThresholdField = 'fullDayMinutes' | 'halfDayMinutes' | 'graceMinutes';

export interface DayThresholdComparison {
  employeeId: string;
  /** criterion 15.9: what the existing engine applies today. */
  existingThresholds: DayThresholdValues | null;
  /** criterion 15.9: what the proposed Day_Threshold_Rule store resolves. */
  proposedThresholds: DayThresholdValues | null;
  proposedRuleProposalKey: string | null;
  proposedRuleName: string | null;
  proposedRuleIsUnconstrainedDefault: boolean;
  proposedSpecificityCount: number;
  status: ThresholdComparisonStatus;
  /** Which of the three values differ. Empty unless status is 'differs'. */
  differingFields: DayThresholdField[];
  tieBreakReachedIdentity: boolean;
  missingDimensions: RuleDimension[];
}

/** criterion 15.10. */
export interface AttendanceSourceReconciliationReport {
  comparisons: AttendanceSourceComparison[];
  /** The employees criterion 15.10 requires listed: existing and proposed differ. */
  differing: AttendanceSourceComparison[];
  differingEmployeeIds: string[];
  matchedCount: number;
  differingCount: number;
  /** No proposed rule matched. Empty once the System_Default_Rule invariant holds. */
  unresolvedEmployeeIds: string[];
  unresolvedCount: number;
  existingUnknownEmployeeIds: string[];
  existingUnknownCount: number;
}

/** criterion 15.9. */
export interface DayThresholdReconciliationReport {
  comparisons: DayThresholdComparison[];
  differing: DayThresholdComparison[];
  differingEmployeeIds: string[];
  matchedCount: number;
  differingCount: number;
  unresolvedEmployeeIds: string[];
  unresolvedCount: number;
  existingUnknownEmployeeIds: string[];
  existingUnknownCount: number;
}

/**
 * criterion 15.13's violation kinds. Each one is a reason the report CANNOT demonstrate the
 * no-silent-change property, and each is detectable from the data rather than asserted.
 */
export const NO_SILENT_CHANGE_VIOLATION = {
  /**
   * No proposed rule matched the employee, so there is no proposed resolution to compare and
   * the employee cannot be placed in the unchanged set. A proposed set missing its
   * System_Default_Rule (criterion 1.10) produces this for everyone no scoped rule matches.
   */
  PROPOSED_UNRESOLVED: 'proposed_unresolved',
  /**
   * The caller supplied no usable existing resolution, so "unchanged" is unverifiable for this
   * employee - the report would be claiming a property of a value it does not have.
   */
  EXISTING_UNKNOWN: 'existing_unknown',
  /**
   * The winning proposed rule was picked by comparing identity, so the applied migration may
   * resolve a different rule than this report did. See tieBreakReachedIdentity.
   */
  TIE_BREAK_NOT_REPRODUCIBLE: 'tie_break_not_reproducible',
  /**
   * Re-resolving the same employee against the same rules in the opposite order produced a
   * different answer. Resolution must be a function of content only; when it is not, "matches
   * the existing resolution" is an accident of iteration order rather than a property.
   */
  RESOLUTION_NOT_ORDER_INDEPENDENT: 'resolution_not_order_independent',
  /**
   * Internal partition guard: an employee counted as unchanged whose proposed source does not
   * equal their existing source. Unreachable by construction, checked anyway, because the whole
   * value of this report is that its unchanged set is trustworthy.
   */
  PARTITION_INCONSISTENT: 'partition_inconsistent',
} as const;

export type NoSilentChangeViolationKind =
  (typeof NO_SILENT_CHANGE_VIOLATION)[keyof typeof NO_SILENT_CHANGE_VIOLATION];

export interface NoSilentChangeViolation {
  employeeId: string;
  kind: NoSilentChangeViolationKind;
  detail: string;
}

/**
 * criterion 15.13, made checkable.
 *
 * `holds` is the assertion "for all currently active employees whose proposed resolution matches
 * their existing resolution, applying this migration leaves the resolved Attendance_Source
 * unchanged". It is true only when every employee in the report is decidably in exactly one of
 * the unchanged / changed sets and every unchanged employee's resolution reproduces
 * independently. Anything that would make the claim unverifiable is a violation, and any
 * violation makes `holds` false - so a caller can gate criterion 15.11's approval on this one
 * boolean and read `violations` for the reason.
 */
export interface NoSilentChangeAssertion {
  holds: boolean;
  unchangedEmployeeIds: string[];
  unchangedCount: number;
  changedEmployeeIds: string[];
  changedCount: number;
  /** Employees for whom the property could not be evaluated either way. */
  undeterminedEmployeeIds: string[];
  undeterminedCount: number;
  violations: NoSilentChangeViolation[];
  /** Employees covered by the assertion. Equals unchanged + changed + undetermined. */
  evaluatedEmployeeCount: number;
}

export interface MissingDimensionEmployee {
  employeeId: string;
  missingDimensions: RuleDimension[];
}

export interface MissingDimensionCount {
  dimension: RuleDimension;
  employeeIds: string[];
  employeeCount: number;
  /** Share of the supplied employees, one decimal place, so 34 of 1,123 reads as 3.0. */
  percentOfEmployees: number;
}

/** criterion 15.15. */
export interface MissingDimensionReport {
  /** Every employee holding no value for at least one of the six Rule_Dimensions. */
  employees: MissingDimensionEmployee[];
  employeeIds: string[];
  employeeCount: number;
  /** One entry per Rule_Dimension, always all six, in Dimension_Priority_Order. */
  byDimension: MissingDimensionCount[];
  /** Denominator for the percentages: the employees supplied. */
  activeEmployeeCount: number;
}

export type ReprocessingReason =
  | 'attendance_source_differs'
  | 'attendance_source_unresolved'
  | 'existing_attendance_source_unknown'
  | 'day_thresholds_differ'
  | 'day_thresholds_unresolved'
  | 'existing_day_thresholds_unknown';

export interface ReprocessingEntry {
  employeeId: string;
  payMonth: string;
  reasons: ReprocessingReason[];
}

/** criterion 15.14. */
export interface ReprocessingReport {
  /**
   * Always false. Criterion 15.14 requires the work to be LISTED rather than performed, and this
   * module could not reprocess anything if it wanted to - it holds no connection. The flag is
   * here so the contract is visible in the payload a reviewer reads.
   */
  reprocessed: false;
  openPayMonths: string[];
  /** One entry per (employee requiring reprocessing, open Pay_Month). */
  entries: ReprocessingEntry[];
  entryCount: number;
  employeeIds: string[];
  employeeCount: number;
}

export interface AttendanceRuleMigrationReconciliation {
  effectiveDate: string;
  /** The employees supplied. Sanity-check figure for criteria 15.9, 15.10 and 15.15 alike. */
  employeeCount: number;
  /** Proposed rules whose effective-date window covers effectiveDate. */
  windowedSourceRuleCount: number;
  windowedDayThresholdRuleCount: number;
  /** criterion 15.10 */
  attendanceSource: AttendanceSourceReconciliationReport;
  /** criterion 15.9 */
  dayThresholds: DayThresholdReconciliationReport;
  /** criterion 15.13 */
  noSilentChange: NoSilentChangeAssertion;
  /** criterion 15.15 */
  missingDimensions: MissingDimensionReport;
  /** criterion 15.14 */
  reprocessing: ReprocessingReport;
}

/**
 * created_at for every adapted proposed rule.
 *
 * A proposed rule has no created_at: the whole rule set is produced by one migration run, so
 * every row would carry the same timestamp anyway. Passing one shared constant reproduces that
 * faithfully and, importantly, does not invent an ordering the real data will not have. The
 * consequence is that criterion 2.5's created_at step can never break a tie between two proposed
 * rules, so a tie falls through to identity - which is detected and reported rather than hidden.
 */
const PROPOSED_RULE_CREATED_AT = '';

// -- small pure helpers -------------------------------------------------------------------

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const DIMENSION_INDEX = new Map<RuleDimension, number>(
  DIMENSION_PRIORITY_ORDER.map((d, i) => [d, i]),
);

function sortDimensions(dimensions: readonly RuleDimension[]): RuleDimension[] {
  return [...dimensions].sort(
    (a, b) =>
      (DIMENSION_INDEX.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (DIMENSION_INDEX.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Trimmed non-empty text, or null. */
function normaliseText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The legacy engine's answer, normalised onto the enum('dialler','biometric') of criterion 1.3.
 * Anything else - absent, empty, or a third value - becomes null and is reported as unknown.
 * Guessing here would put an employee in the unchanged set on the strength of a value nobody
 * could read.
 */
function normaliseAttendanceSource(
  value: string | null | undefined,
): ProposedAttendanceSource | null {
  const text = normaliseText(value)?.toLowerCase() ?? null;
  if (text === 'dialler' || text === 'biometric') return text;
  return null;
}

function normaliseThresholds(
  value: DayThresholdValues | null | undefined,
): DayThresholdValues | null {
  if (value === null || value === undefined) return null;
  const full = toFiniteInteger(value.fullDayMinutes);
  const half = toFiniteInteger(value.halfDayMinutes);
  const grace = toFiniteInteger(value.graceMinutes);
  // Partially readable thresholds are not partially comparable: a comparison against a NaN
  // would report "differs" for a value nobody actually knows. Unknown is the honest answer.
  if (full === null || half === null || grace === null) return null;
  return { fullDayMinutes: full, halfDayMinutes: half, graceMinutes: grace };
}

function toFiniteInteger(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}

function percentOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

/**
 * A proposed rule's dimension list as the resolver's Set map. Two entries for one dimension
 * become one two-element Set, which is criterion 2.10's set-valued constraint, so a migrated
 * duplicate master row is matched rather than silently dropped.
 */
function toDimensionSets(
  values: readonly ProposedDimensionValue[],
): Partial<Record<RuleDimension, Set<string>>> {
  const out: Partial<Record<RuleDimension, Set<string>>> = {};
  for (const value of values) {
    const valueId = normaliseText(value.valueId);
    if (valueId === null) continue;
    const existing = out[value.dimension];
    if (existing) existing.add(valueId);
    else out[value.dimension] = new Set([valueId]);
  }
  return out;
}

/**
 * criterion 1.7 / 1.17's effective-date window, applied here because resolveRule() deliberately
 * does not: the DB-backed callers push this filter into indexed SQL, so the pure resolver never
 * sees an out-of-window rule. Lexicographic comparison is exact for 'YYYY-MM-DD'.
 */
function coversDate(effectiveFrom: string, effectiveTo: string | null, date: string): boolean {
  if (effectiveFrom > date) return false;
  if (effectiveTo !== null && effectiveTo < date) return false;
  return true;
}

interface WindowedSourceRule extends DimensionScopedRule {
  proposalKey: string;
  ruleName: string;
  attendanceSource: ProposedAttendanceSource;
  isSystemDefault: boolean;
}

interface WindowedThresholdRule extends DimensionScopedRule {
  proposalKey: string;
  ruleName: string;
  thresholds: DayThresholdValues;
  isUnconstrainedDefault: boolean;
}

function toWindowedSourceRule(rule: ProposedSourceRule): WindowedSourceRule {
  return {
    // The persister mints the CHAR(36) id, so the stable content hash is the only identity a
    // pure report can use. Where this decides a tie, tieBreakReachedIdentity says so.
    id: rule.proposalKey,
    dimensionValues: toDimensionSets(rule.dimensionValues),
    effectiveFrom: rule.effectiveFrom,
    createdAt: PROPOSED_RULE_CREATED_AT,
    proposalKey: rule.proposalKey,
    ruleName: rule.ruleName,
    attendanceSource: rule.attendanceSource,
    isSystemDefault: rule.isSystemDefault === 1,
  };
}

function toWindowedThresholdRule(rule: ProposedDayThresholdRule): WindowedThresholdRule {
  return {
    id: rule.proposalKey,
    dimensionValues: toDimensionSets(rule.dimensionValues),
    effectiveFrom: rule.effectiveFrom,
    createdAt: PROPOSED_RULE_CREATED_AT,
    proposalKey: rule.proposalKey,
    ruleName: rule.ruleName,
    thresholds: {
      fullDayMinutes: rule.fullDayMinutes,
      halfDayMinutes: rule.halfDayMinutes,
      graceMinutes: rule.graceMinutes,
    },
    isUnconstrainedDefault: rule.isUnconstrainedDefault === 1,
  };
}

/**
 * Did criterion 2.5's identity comparison decide this resolution?
 *
 * Every proposed rule shares one created_at, so the tail reduces to "latest effective_from, then
 * lowest id". When a rule was eliminated at the tail while carrying the SAME effective_from as
 * the winner, only the id separated them.
 */
function tieBrokenOnIdentity<T extends DimensionScopedRule>(
  candidates: ReadonlyArray<{ rule: T; eliminatedAtStep: string | null }>,
  winner: T | null,
): boolean {
  if (winner === null) return false;
  return candidates.some(
    (c) =>
      c.eliminatedAtStep === 'deterministic_tail' &&
      c.rule.effectiveFrom === winner.effectiveFrom,
  );
}

// -- the reconciliation -------------------------------------------------------------------

/**
 * Build the Requirement 15 reconciliation reports. Pure and total: the same employees in a
 * different order produce an identical report, and no ordinary input throws - not an employee
 * matched by no rule at all (criterion 15.15's whole subject), not a missing existing
 * resolution, not an empty employee list.
 *
 * @throws only when effectiveDate is not 'YYYY-MM-DD'. Every proposed rule is selected by
 *   effective-date window against this value, so an unparseable date would silently window out
 *   the entire rule set and report that every employee is unresolved. That is a caller bug, not
 *   data, and the same reasoning as buildAttendanceRuleMigrationProposal()'s Pay_Month guard.
 */
export function buildAttendanceRuleMigrationReconciliation(
  input: BuildReconciliationInput,
): AttendanceRuleMigrationReconciliation {
  const effectiveDate = String(input.effectiveDate ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(effectiveDate)) {
    throw new Error(
      `effectiveDate must be 'YYYY-MM-DD' (received ${JSON.stringify(input.effectiveDate)}). ` +
        'Every proposed rule is selected by effective-date window against this date.',
    );
  }

  const windowedSourceRules = (input.proposal?.sourceRules ?? [])
    .filter((rule) => coversDate(rule.effectiveFrom, rule.effectiveTo, effectiveDate))
    .map(toWindowedSourceRule);

  const windowedThresholdRules = (input.proposal?.dayThresholdRules ?? [])
    .filter((rule) => coversDate(rule.effectiveFrom, rule.effectiveTo, effectiveDate))
    .map(toWindowedThresholdRule);

  // Reversed copies exist only for the criterion 15.13 order-independence check below. Built
  // once rather than per employee.
  const reversedSourceRules = [...windowedSourceRules].reverse();

  const employees = input.employees ?? [];

  const sourceComparisons: AttendanceSourceComparison[] = [];
  const thresholdComparisons: DayThresholdComparison[] = [];
  const missingByDimension = new Map<RuleDimension, string[]>(
    DIMENSION_PRIORITY_ORDER.map((d) => [d, []]),
  );
  const missingEmployees: MissingDimensionEmployee[] = [];
  const violations: NoSilentChangeViolation[] = [];
  const unchangedEmployeeIds: string[] = [];
  const changedEmployeeIds: string[] = [];
  const undeterminedEmployeeIds: string[] = [];
  const reprocessingByEmployee: Array<{ employeeId: string; reasons: ReprocessingReason[] }> = [];

  for (const employee of employees) {
    const employeeId = normaliseText(employee.employeeId) ?? String(employee.employeeId ?? '');
    const attributes = employee.attributes;

    // -- criterion 15.10: existing versus proposed Attendance_Source ------------------------
    const sourceResult = resolveRule(windowedSourceRules, attributes);
    const sourceWinner = sourceResult.winner;
    const existingSourceRaw = normaliseText(employee.existingAttendanceSource);
    const existingSource = normaliseAttendanceSource(employee.existingAttendanceSource);
    const proposedSource = sourceWinner ? sourceWinner.attendanceSource : null;
    const missingDimensions = sortDimensions(sourceResult.unresolvedDimensions);
    const sourceTieOnIdentity = tieBrokenOnIdentity(sourceResult.candidates, sourceWinner);

    let sourceStatus: SourceComparisonStatus;
    if (proposedSource === null) {
      // criterion 2.8 / 15.15: no rule matched. Not an error, and not a match either.
      sourceStatus = 'proposed_unresolved';
    } else if (existingSource === null) {
      sourceStatus = 'existing_unknown';
    } else if (existingSource === proposedSource) {
      sourceStatus = 'match';
    } else {
      sourceStatus = 'differs';
    }

    sourceComparisons.push({
      employeeId,
      existingAttendanceSource: existingSource,
      existingAttendanceSourceRaw: existingSourceRaw,
      proposedAttendanceSource: proposedSource,
      proposedRuleProposalKey: sourceWinner ? sourceWinner.proposalKey : null,
      proposedRuleName: sourceWinner ? sourceWinner.ruleName : null,
      proposedRuleIsSystemDefault: sourceWinner ? sourceWinner.isSystemDefault : false,
      proposedSpecificityCount: sourceResult.specificityCount,
      status: sourceStatus,
      tieBreakReachedIdentity: sourceTieOnIdentity,
      missingDimensions,
    });

    // -- criterion 15.9: existing versus proposed day thresholds ---------------------------
    const thresholdResult = resolveRule(windowedThresholdRules, attributes);
    const thresholdWinner = thresholdResult.winner;
    const existingThresholds = normaliseThresholds(employee.existingThresholds);
    const proposedThresholds = thresholdWinner ? thresholdWinner.thresholds : null;

    let thresholdStatus: ThresholdComparisonStatus;
    let differingFields: DayThresholdField[] = [];
    if (proposedThresholds === null) {
      thresholdStatus = 'proposed_unresolved';
    } else if (existingThresholds === null) {
      thresholdStatus = 'existing_unknown';
    } else {
      differingFields = (
        ['fullDayMinutes', 'halfDayMinutes', 'graceMinutes'] as const
      ).filter((field) => existingThresholds[field] !== proposedThresholds[field]);
      thresholdStatus = differingFields.length === 0 ? 'match' : 'differs';
    }

    thresholdComparisons.push({
      employeeId,
      existingThresholds,
      proposedThresholds,
      proposedRuleProposalKey: thresholdWinner ? thresholdWinner.proposalKey : null,
      proposedRuleName: thresholdWinner ? thresholdWinner.ruleName : null,
      proposedRuleIsUnconstrainedDefault: thresholdWinner
        ? thresholdWinner.isUnconstrainedDefault
        : false,
      proposedSpecificityCount: thresholdResult.specificityCount,
      status: thresholdStatus,
      differingFields,
      tieBreakReachedIdentity: tieBrokenOnIdentity(thresholdResult.candidates, thresholdWinner),
      missingDimensions,
    });

    // -- criterion 15.15: an employee holding no value for some Rule_Dimension -------------
    if (missingDimensions.length > 0) {
      missingEmployees.push({ employeeId, missingDimensions });
      for (const dimension of missingDimensions) {
        missingByDimension.get(dimension)?.push(employeeId);
      }
    }

    // -- criterion 15.13: the no-silent-change property ------------------------------------
    if (sourceStatus === 'match') {
      // Independent re-resolution over the same rules in the opposite order. If resolution is a
      // function of content, as criteria 2.3-2.5 require, this is the same answer. If it is not,
      // then "matches the existing resolution" was an artefact of iteration order and the
      // employee must not be certified unchanged.
      const reResolved = resolveRule(reversedSourceRules, attributes);
      const reResolvedSource = reResolved.winner ? reResolved.winner.attendanceSource : null;
      const reResolvedKey = reResolved.winner ? reResolved.winner.proposalKey : null;
      const orderIndependent =
        reResolvedSource === proposedSource &&
        reResolvedKey === (sourceWinner ? sourceWinner.proposalKey : null);

      if (!orderIndependent) {
        undeterminedEmployeeIds.push(employeeId);
        violations.push({
          employeeId,
          kind: NO_SILENT_CHANGE_VIOLATION.RESOLUTION_NOT_ORDER_INDEPENDENT,
          detail:
            `Resolving employee ${employeeId} against the same windowed proposed rules in the ` +
            `opposite order produced ${JSON.stringify(reResolvedSource)} from rule ` +
            `${JSON.stringify(reResolvedKey)} instead of ${JSON.stringify(proposedSource)} from ` +
            `${JSON.stringify(sourceWinner ? sourceWinner.proposalKey : null)}. Two proposed ` +
            'rules tie all the way through the deterministic tail, so this employee cannot be ' +
            'certified unchanged.',
        });
      } else if (sourceTieOnIdentity) {
        undeterminedEmployeeIds.push(employeeId);
        violations.push({
          employeeId,
          kind: NO_SILENT_CHANGE_VIOLATION.TIE_BREAK_NOT_REPRODUCIBLE,
          detail:
            `Employee ${employeeId} resolves to proposed rule ` +
            `${JSON.stringify(sourceWinner ? sourceWinner.proposalKey : null)} only because rule ` +
            'identity broke a tie between two equally specific rules sharing an effective-from ' +
            'date. The applied rules carry minted identifiers rather than these proposal keys, ' +
            'so the applied resolution is not guaranteed to be the one reported here.',
        });
      } else if (existingSource !== proposedSource) {
        undeterminedEmployeeIds.push(employeeId);
        violations.push({
          employeeId,
          kind: NO_SILENT_CHANGE_VIOLATION.PARTITION_INCONSISTENT,
          detail:
            `Employee ${employeeId} was classified as matching while the existing source ` +
            `${JSON.stringify(existingSource)} and the proposed source ` +
            `${JSON.stringify(proposedSource)} differ.`,
        });
      } else {
        unchangedEmployeeIds.push(employeeId);
      }
    } else if (sourceStatus === 'differs') {
      changedEmployeeIds.push(employeeId);
    } else {
      undeterminedEmployeeIds.push(employeeId);
      violations.push(
        sourceStatus === 'proposed_unresolved'
          ? {
              employeeId,
              kind: NO_SILENT_CHANGE_VIOLATION.PROPOSED_UNRESOLVED,
              detail:
                `No proposed Attendance_Source_Rule in force on ${effectiveDate} matches ` +
                `employee ${employeeId}` +
                (missingDimensions.length > 0
                  ? `, who holds no value for ${missingDimensions.join(', ')} and so cannot be ` +
                    'matched by a rule constraining any of those dimensions (criteria 2.8, ' +
                    '15.15)'
                  : '') +
                '. There is no proposed resolution to compare, so the employee cannot be shown ' +
                'unchanged. Criterion 1.10 requires a System_Default_Rule that reaches every ' +
                'employee.',
            }
          : {
              employeeId,
              kind: NO_SILENT_CHANGE_VIOLATION.EXISTING_UNKNOWN,
              detail:
                `No usable existing Attendance_Source was supplied for employee ${employeeId} ` +
                `(received ${JSON.stringify(employee.existingAttendanceSource ?? null)}), so ` +
                'whether the proposed rule set leaves their resolution unchanged cannot be ' +
                'evaluated.',
            },
      );
    }

    // -- criterion 15.14: who needs reprocessing ------------------------------------------
    const reasons: ReprocessingReason[] = [];
    if (sourceStatus === 'differs') reasons.push('attendance_source_differs');
    if (sourceStatus === 'proposed_unresolved') reasons.push('attendance_source_unresolved');
    if (sourceStatus === 'existing_unknown') reasons.push('existing_attendance_source_unknown');
    if (thresholdStatus === 'differs') reasons.push('day_thresholds_differ');
    if (thresholdStatus === 'proposed_unresolved') reasons.push('day_thresholds_unresolved');
    if (thresholdStatus === 'existing_unknown') reasons.push('existing_day_thresholds_unknown');
    if (reasons.length > 0) {
      reprocessingByEmployee.push({ employeeId, reasons });
    }
  }

  // -- ordering ---------------------------------------------------------------------------
  //
  // Every list is sorted on content, so the report is a function of the SET of employees rather
  // than of the order they arrived in. employeeId first, then a content signature, so that even
  // two entries carrying the same employeeId order identically between runs.
  sourceComparisons.sort(
    (a, b) =>
      compareText(a.employeeId, b.employeeId) ||
      compareText(sourceComparisonSignature(a), sourceComparisonSignature(b)),
  );
  thresholdComparisons.sort(
    (a, b) =>
      compareText(a.employeeId, b.employeeId) ||
      compareText(thresholdComparisonSignature(a), thresholdComparisonSignature(b)),
  );
  missingEmployees.sort(
    (a, b) =>
      compareText(a.employeeId, b.employeeId) ||
      compareText(a.missingDimensions.join(','), b.missingDimensions.join(',')),
  );
  violations.sort(
    (a, b) =>
      compareText(a.employeeId, b.employeeId) ||
      compareText(a.kind, b.kind) ||
      compareText(a.detail, b.detail),
  );
  unchangedEmployeeIds.sort(compareText);
  changedEmployeeIds.sort(compareText);
  undeterminedEmployeeIds.sort(compareText);
  // employeeId alone is not a total order: two entries can share an id (and a caller is not
  // obliged to supply unique ids), which would leave their relative order decided by arrival
  // order and make the report order-dependent. The reasons list completes the ordering. Found
  // by the ordering-independence property test, not by inspection.
  reprocessingByEmployee.sort(
    (a, b) =>
      compareText(a.employeeId, b.employeeId) ||
      compareText(a.reasons.join(','), b.reasons.join(',')),
  );

  const openPayMonths = [
    ...new Set((input.openPayMonths ?? []).map((m) => normaliseText(m)).filter(isNonNullString)),
  ].sort(compareText);

  const reprocessingEntries: ReprocessingEntry[] = [];
  for (const { employeeId, reasons } of reprocessingByEmployee) {
    for (const payMonth of openPayMonths) {
      reprocessingEntries.push({ employeeId, payMonth, reasons: [...reasons].sort(compareText) });
    }
  }

  const differingSources = sourceComparisons.filter((c) => c.status === 'differs');
  const differingThresholds = thresholdComparisons.filter((c) => c.status === 'differs');
  const employeeCount = sourceComparisons.length;

  return {
    effectiveDate,
    employeeCount,
    windowedSourceRuleCount: windowedSourceRules.length,
    windowedDayThresholdRuleCount: windowedThresholdRules.length,

    // criterion 15.10
    attendanceSource: {
      comparisons: sourceComparisons,
      differing: differingSources,
      differingEmployeeIds: differingSources.map((c) => c.employeeId),
      matchedCount: sourceComparisons.filter((c) => c.status === 'match').length,
      differingCount: differingSources.length,
      unresolvedEmployeeIds: sourceComparisons
        .filter((c) => c.status === 'proposed_unresolved')
        .map((c) => c.employeeId),
      unresolvedCount: sourceComparisons.filter((c) => c.status === 'proposed_unresolved').length,
      existingUnknownEmployeeIds: sourceComparisons
        .filter((c) => c.status === 'existing_unknown')
        .map((c) => c.employeeId),
      existingUnknownCount: sourceComparisons.filter((c) => c.status === 'existing_unknown')
        .length,
    },

    // criterion 15.9
    dayThresholds: {
      comparisons: thresholdComparisons,
      differing: differingThresholds,
      differingEmployeeIds: differingThresholds.map((c) => c.employeeId),
      matchedCount: thresholdComparisons.filter((c) => c.status === 'match').length,
      differingCount: differingThresholds.length,
      unresolvedEmployeeIds: thresholdComparisons
        .filter((c) => c.status === 'proposed_unresolved')
        .map((c) => c.employeeId),
      unresolvedCount: thresholdComparisons.filter((c) => c.status === 'proposed_unresolved')
        .length,
      existingUnknownEmployeeIds: thresholdComparisons
        .filter((c) => c.status === 'existing_unknown')
        .map((c) => c.employeeId),
      existingUnknownCount: thresholdComparisons.filter((c) => c.status === 'existing_unknown')
        .length,
    },

    // criterion 15.13
    noSilentChange: {
      // Holds only when nothing stood in the way of evaluating it: every employee is decidably
      // unchanged or changed, and every unchanged one reproduced independently.
      holds:
        violations.length === 0 &&
        undeterminedEmployeeIds.length === 0 &&
        unchangedEmployeeIds.length + changedEmployeeIds.length === employeeCount,
      unchangedEmployeeIds,
      unchangedCount: unchangedEmployeeIds.length,
      changedEmployeeIds,
      changedCount: changedEmployeeIds.length,
      undeterminedEmployeeIds,
      undeterminedCount: undeterminedEmployeeIds.length,
      violations,
      evaluatedEmployeeCount:
        unchangedEmployeeIds.length + changedEmployeeIds.length + undeterminedEmployeeIds.length,
    },

    // criterion 15.15
    missingDimensions: {
      employees: missingEmployees,
      employeeIds: missingEmployees.map((e) => e.employeeId),
      employeeCount: missingEmployees.length,
      byDimension: DIMENSION_PRIORITY_ORDER.map((dimension) => {
        const employeeIds = [...(missingByDimension.get(dimension) ?? [])].sort(compareText);
        return {
          dimension,
          employeeIds,
          employeeCount: employeeIds.length,
          percentOfEmployees: percentOf(employeeIds.length, employeeCount),
        };
      }),
      activeEmployeeCount: employeeCount,
    },

    // criterion 15.14
    reprocessing: {
      reprocessed: false,
      openPayMonths,
      entries: reprocessingEntries,
      entryCount: reprocessingEntries.length,
      employeeIds: reprocessingByEmployee.map((e) => e.employeeId),
      employeeCount: reprocessingByEmployee.length,
    },
  };
}

function isNonNullString(value: string | null): value is string {
  return value !== null;
}

function sourceComparisonSignature(c: AttendanceSourceComparison): string {
  return [
    c.status,
    c.existingAttendanceSource ?? '-',
    c.proposedAttendanceSource ?? '-',
    c.proposedRuleProposalKey ?? '-',
    String(c.proposedSpecificityCount),
    c.missingDimensions.join(','),
  ].join('|');
}

function thresholdComparisonSignature(c: DayThresholdComparison): string {
  return [
    c.status,
    c.existingThresholds
      ? `${c.existingThresholds.fullDayMinutes}/${c.existingThresholds.halfDayMinutes}/${c.existingThresholds.graceMinutes}`
      : '-',
    c.proposedThresholds
      ? `${c.proposedThresholds.fullDayMinutes}/${c.proposedThresholds.halfDayMinutes}/${c.proposedThresholds.graceMinutes}`
      : '-',
    c.proposedRuleProposalKey ?? '-',
    c.differingFields.join(','),
  ].join('|');
}
