//
// Requirement 12 (Rule Administration Interface) of requirements.md, implemented as PURE
// functions over an in-memory rule set and an in-memory active-employee population. This module
// is the decidable logic BEHIND the rule administration screen: the list-and-filter projection
// (12.1, 12.2), the submission impact counts (12.3), the resolution preview (12.4), the
// deactivation impact (12.5), the threshold configuration validator (12.7) and the
// cost-centre-versus-process contradiction warning (12.9, 12.10). No screen, no route, no query.
//
// Same shape as attendance-source-rule-resolver.ts, canonical-productivity.ts,
// attendance-variance.ts, floor-absence-pattern.ts and variance-review.ts: no database import,
// no `db.execute`, no `new Date()`, no `randomUUID()`, no `fs`, no network. Everything arrives as
// an argument INCLUDING the clock — every count in Requirement 12 is stated for "currently
// active employees", and "currently" is a date the caller supplies, so an impact preview is
// reproducible in a test and in an audit rather than depending on when it ran.
//
// RESOLUTION IS NOT REIMPLEMENTED HERE. Requirement 2's candidacy, Specificity_Count,
// Dimension_Priority_Order (decision A1) and deterministic tail already exist as one pure
// function, `resolveRule` in attendance-source-rule-resolver.ts, which is what
// attendance-source-rule.service.ts, day-threshold-rule.service.ts and
// attendance-threshold-config.service.ts all resolve through. That function is imported and
// reused verbatim; nothing about matching or tie-breaking is copied. Two consequences worth
// stating because they are the whole reason 12.3 and 12.9 are answerable at all:
//
//   * "Would this rule match this employee" is answered by calling `resolveRule` with a
//     ONE-RULE store (see `ruleMatchesEmployee`). A rule is the winner of a single-rule store
//     exactly when it is a candidate, so candidacy semantics — including criterion 2.8's rule
//     that a missing employee attribute makes every rule constraining that dimension a
//     non-candidate rather than an accidental match — cannot drift away from the resolver.
//   * "Would the resolved Attendance_Source change" is answered by resolving twice, before and
//     after the proposed change, over the same population. The tie-break under decision A1 is
//     therefore the resolver's, not a second opinion about it.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO:
//   * 12.6, the Rule_Audit_Log display, and 12.8, the Dialler_Source registry. Those are a query
//     and Requirement 16 respectively, both owned elsewhere (dialler-source-registry.service.ts).
//   * 1.8's master-table existence check and 2.11's duplicate-master-row warning. Both need
//     master data, which is a query; a pure module cannot see `department_master`.
//   * Writing anything. Every function returns a plain value describing what the caller should
//     display, refuse or persist.
//
// POPULATION INTERSECTION IS COMPUTED OVER PEOPLE, NOT OVER DIMENSION VALUES (12.9). design.md
// describes the 12.9 check as resolving the submitted cost centre's implied `process_id` from
// `cost_centre_master` and querying process-scoped rules on that process. This module does not
// take that shortcut: it intersects the two rules' MATCHED ACTIVE-EMPLOYEE POPULATIONS, which is
// what criterion 12.9 actually says ("whose matched active-employee population intersects the
// submitted rule's matched active-employee population"). The difference is not academic —
// `cost_centre_master.process_id` is master data that can disagree with the `employees.process_id`
// of the people actually sitting in that cost centre, and A7 measures `process_id` NULL on 75 of
// 1,123 active employees. Comparing dimension values would then either miss a genuine overlap or
// invent one. Intersecting real employee sets cannot: two rules overlap exactly when a person is
// matched by both.

import {
  DIMENSION_PRIORITY_ORDER,
  resolveRule,
  type DimensionScopedRule,
  type EliminationStep,
  type EmployeeAttributes,
  type RuleDimension,
} from './attendance-source-rule-resolver.js';

// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------

/** requirements.md decision A9: the enum stays `enum('dialler','biometric')`; no third value. */
export type AttendanceSource = 'dialler' | 'biometric';

/**
 * One Attendance_Source_Rule as the administration screen holds it in memory. Extends the
 * resolver's `DimensionScopedRule` — same `dimensionValues` shape, same `effectiveFrom`, same
 * `createdAt` — and adds the three members the resolver does not need but criterion 12.1 must
 * display: the source, the effective-TO end of the window, and the active state.
 *
 * `effectiveTo` null is an open-ended window (criterion 1.6). Both dates are inclusive, matching
 * the `effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)` window filter
 * attendance-source-rule.service.ts issues.
 */
export interface AdminRule extends DimensionScopedRule {
  readonly attendanceSource: AttendanceSource;
  readonly effectiveTo: string | null;
  readonly active: boolean;
}

/** One currently active employee, with the attribute values Requirement 2 resolves against. */
export interface ActiveEmployee {
  readonly employeeId: string;
  readonly attributes: EmployeeAttributes;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Civil dates are compared as strings. 'YYYY-MM-DD' is lexicographically ordered, so this is
 * exact and — unlike `new Date(...)` — cannot be moved across a boundary by the process time
 * zone. A malformed date is a programmer error: continuing would silently compare against
 * garbage and report an impact count for the wrong day.
 */
function assertCivilDate(value: string, label: string): void {
  if (!DATE_PATTERN.test(value)) {
    // programmer error
    throw new RangeError(`${label} must be a 'YYYY-MM-DD' civil date, received ${JSON.stringify(value)}`);
  }
}

/** criteria 1.6, 2.2: inclusive both ends; a null effective-to never closes. */
export function isWithinEffectiveWindow(rule: AdminRule, date: string): boolean {
  assertCivilDate(date, 'date');
  assertCivilDate(rule.effectiveFrom, `rule ${rule.id} effectiveFrom`);
  if (rule.effectiveTo !== null) assertCivilDate(rule.effectiveTo, `rule ${rule.id} effectiveTo`);
  if (rule.effectiveFrom > date) return false;
  if (rule.effectiveTo !== null && rule.effectiveTo < date) return false;
  return true;
}

/**
 * criterion 2.2's first two conditions. The resolver deliberately does NOT apply these — its
 * callers push them into SQL — so a pure caller has to apply them itself, and this is the one
 * place that does.
 */
export function activeRulesInWindow<T extends AdminRule>(rules: readonly T[], date: string): T[] {
  return rules.filter((rule) => rule.active && isWithinEffectiveWindow(rule, date));
}

/**
 * criterion 12.1's Specificity_Count, COMPUTED rather than read from a stored column. The screen
 * must not display a count that disagrees with the count the resolver breaks ties on, and the
 * only way to guarantee that is to derive it from the same `dimensionValues` the resolver reads.
 * An empty Set is treated as unconstrained, exactly as `resolveRule` treats it.
 */
export function computeSpecificityCount(rule: DimensionScopedRule): number {
  let count = 0;
  for (const dimension of DIMENSION_PRIORITY_ORDER) {
    const constraint = rule.dimensionValues[dimension];
    if (constraint && constraint.size > 0) count += 1;
  }
  return count;
}

/**
 * Whether `rule` would match `employee` on the dimensions alone (criteria 2.2, 2.8). Delegated to
 * `resolveRule` over a one-rule store rather than reimplemented: the winner of a single-rule
 * store is that rule exactly when it is a candidate, so this cannot drift from the resolver's
 * candidacy semantics. Effective window and active state are NOT considered here — callers apply
 * `activeRulesInWindow` first, so this function answers only "do the dimensions match".
 */
export function ruleMatchesEmployee(rule: AdminRule, employee: ActiveEmployee): boolean {
  return resolveRule([rule], employee.attributes).winner !== null;
}

/**
 * The active-employee population one rule matches on one date (the "matched active-employee
 * population" of criteria 12.3 and 12.9). Returns employee ids sorted ascending, so the value is
 * order-independent and two populations can be compared and intersected directly.
 *
 * An inactive rule, or a rule outside its effective window on `date`, matches nobody — it is not
 * a candidate for anyone on that date (criterion 2.2), so its population is empty rather than
 * "the people it would match if it were live".
 */
export function matchedPopulation(
  rule: AdminRule,
  employees: readonly ActiveEmployee[],
  date: string,
): string[] {
  if (!rule.active || !isWithinEffectiveWindow(rule, date)) return [];
  return employees
    .filter((employee) => ruleMatchesEmployee(rule, employee))
    .map((employee) => employee.employeeId)
    .sort();
}

/**
 * criterion 12.9's "intersects". Sorted ascending and duplicate-free, so the result is a set and
 * `intersectPopulations(a, b)` equals `intersectPopulations(b, a)` for any inputs — the symmetry
 * the property test asserts.
 */
export function intersectPopulations(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((id) => rightSet.has(id)))].sort();
}

// ---------------------------------------------------------------------------------------------
// criteria 12.1 and 12.2: the rule list, and filtering it
// ---------------------------------------------------------------------------------------------

/**
 * criterion 12.1's row. The six Rule_Dimension values are projected as sorted arrays rather than
 * Sets so the row is serialisable as it stands (a Set becomes `{}` through JSON), and a dimension
 * the rule leaves unset is `null` rather than an empty array — the screen must be able to show
 * "matches every value" differently from "constrained to nothing", and criterion 1.4 makes those
 * two different statements.
 */
export interface RuleListRow {
  readonly id: string;
  readonly dimensionValues: Readonly<Record<RuleDimension, readonly string[] | null>>;
  readonly attendanceSource: AttendanceSource;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly active: boolean;
  readonly specificityCount: number;
}

export function describeRule(rule: AdminRule): RuleListRow {
  const dimensionValues = {} as Record<RuleDimension, readonly string[] | null>;
  for (const dimension of DIMENSION_PRIORITY_ORDER) {
    const constraint = rule.dimensionValues[dimension];
    dimensionValues[dimension] =
      constraint && constraint.size > 0 ? Object.freeze([...constraint].sort()) : null;
  }
  return Object.freeze({
    id: rule.id,
    dimensionValues: Object.freeze(dimensionValues),
    attendanceSource: rule.attendanceSource,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    active: rule.active,
    specificityCount: computeSpecificityCount(rule),
  });
}

/**
 * criterion 12.2's per-dimension filter. Three kinds, because "filter by cost centre" is
 * ambiguous on its own and guessing would hide rules from the administrator:
 *
 *   `constrains_value`      the rule constrains this dimension to a set CONTAINING this value.
 *                           Set-valued constraints (criterion 2.10) match on membership, so a
 *                           rule constraining department to {'OPERATIONS', 'Operations'} is
 *                           returned by a filter on either identifier.
 *   `constrains_any_value`  the rule constrains this dimension, whatever the value.
 *   `unconstrained`         the rule leaves this dimension unset and therefore matches every
 *                           value of it (criterion 1.4).
 *
 * JUDGEMENT, stated because criterion 12.2 does not: `constrains_value` does NOT return rules
 * that leave the dimension unset, even though such a rule does match employees holding that
 * value. Filtering a configuration list is asking "which rules mention this", not "which rules
 * reach this" — the System_Default_Rule constrains nothing and would otherwise appear under every
 * filter combination, which makes the filter useless for finding the rule you are looking for.
 * An administrator who wants the reach question has `analyseSubmissionImpact` and the resolution
 * preview, which answer it exactly. The rejected alternative was to treat an unset dimension as
 * matching every filter value.
 */
export type DimensionFilter =
  | { readonly kind: 'constrains_value'; readonly valueId: string }
  | { readonly kind: 'constrains_any_value' }
  | { readonly kind: 'unconstrained' };

/**
 * criterion 12.2. Every supplied member is a conjunction: a filter naming two dimensions, a
 * source and an active state returns only the rules satisfying all four. An omitted or null
 * member filters nothing.
 */
export interface RuleListFilter {
  readonly dimensions?: Partial<Record<RuleDimension, DimensionFilter>>;
  readonly attendanceSource?: AttendanceSource | null;
  readonly active?: boolean | null;
  /**
   * Not named by criterion 12.2, but the effective-date window IS a displayed column (12.1) and
   * an administrator looking at a live population needs "the rules in force on this date". When
   * supplied, keeps only rules whose window covers it. Active state is a separate filter, so this
   * does not silently imply `active: true`.
   */
  readonly inWindowOn?: string | null;
}

function matchesDimensionFilter(rule: AdminRule, dimension: RuleDimension, filter: DimensionFilter): boolean {
  const constraint = rule.dimensionValues[dimension];
  const constrained = constraint !== undefined && constraint.size > 0;
  switch (filter.kind) {
    case 'unconstrained':
      return !constrained;
    case 'constrains_any_value':
      return constrained;
    case 'constrains_value':
      return constrained && constraint.has(filter.valueId);
  }
}

/**
 * criteria 12.1 and 12.2: the filtered list, as display rows carrying a computed
 * Specificity_Count.
 *
 * Ordering is deterministic and does not depend on the order the rules arrived in: most specific
 * first (the order in which they win), then latest effective-from, then rule id ascending — the
 * same descending-specificity, latest-first shape the resolver's tie-break uses, so the row an
 * administrator reads at the top of the list is the row that decides.
 */
export function listRules(rules: readonly AdminRule[], filter: RuleListFilter = {}): RuleListRow[] {
  const dimensionFilters = filter.dimensions ?? {};
  const kept = rules.filter((rule) => {
    if (filter.attendanceSource != null && rule.attendanceSource !== filter.attendanceSource) {
      return false;
    }
    if (filter.active != null && rule.active !== filter.active) return false;
    if (filter.inWindowOn != null && !isWithinEffectiveWindow(rule, filter.inWindowOn)) return false;
    for (const dimension of DIMENSION_PRIORITY_ORDER) {
      const dimensionFilter = dimensionFilters[dimension];
      if (dimensionFilter && !matchesDimensionFilter(rule, dimension, dimensionFilter)) return false;
    }
    return true;
  });

  return kept
    .map(describeRule)
    .sort((a, b) => {
      if (a.specificityCount !== b.specificityCount) return b.specificityCount - a.specificityCount;
      if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

// ---------------------------------------------------------------------------------------------
// criterion 12.4: the resolution preview, field for field against criterion 2.9
// ---------------------------------------------------------------------------------------------

/**
 * criterion 2.9's "the comparison step at which each rejected candidate was eliminated", extended
 * by the two steps that happen BEFORE the resolver is reached. `resolveRule` is only ever handed
 * rules that are already active and already in window, so it has no vocabulary for a rule that
 * failed either test; the preview does, because an administrator asking "why did this rule not
 * decide" is very often asking about a rule that is retired or not yet in force.
 */
export type PreviewEliminationStep = EliminationStep | 'inactive' | 'outside_effective_window';

export interface PreviewCandidate {
  readonly rule: RuleListRow;
  /** null on the selected rule only. */
  readonly eliminatedAtStep: PreviewEliminationStep | null;
}

/**
 * criterion 2.9's return, which criterion 12.4 displays verbatim: the selected rule, every other
 * candidate rule, and the elimination step of each rejected candidate. `resolvedAttendanceSource`
 * and `decidingRuleId` are criterion 2.1's pair, carried alongside so the caller does not have to
 * reach into `selectedRule` to read the answer.
 *
 * `unresolvedDimensions` is criterion 2.8's "SHALL record that the dimension was unresolved".
 * `resolvedAttendanceSource` is null only when the store holds no candidate at all, which cannot
 * happen while the System_Default_Rule invariant of criteria 1.10 and 1.11 holds — the preview
 * reports it rather than throwing, because a preview whose job is to explain resolution is
 * exactly the tool an administrator should be able to point at a broken store.
 */
export interface ResolutionPreview {
  readonly employeeId: string;
  readonly date: string;
  readonly resolvedAttendanceSource: AttendanceSource | null;
  readonly decidingRuleId: string | null;
  readonly selectedRule: RuleListRow | null;
  readonly otherCandidates: readonly PreviewCandidate[];
  readonly unresolvedDimensions: readonly RuleDimension[];
}

/**
 * criteria 12.4 and 2.9. Accepts the employee (identified, with the attribute values held for the
 * date) and the date, and returns the outcome criterion 2.9 specifies.
 */
export function previewRuleResolution(
  rules: readonly AdminRule[],
  employee: ActiveEmployee,
  date: string,
): ResolutionPreview {
  assertCivilDate(date, 'date');

  const preResolverStep = new Map<string, PreviewEliminationStep>();
  const candidateRules: AdminRule[] = [];
  for (const rule of rules) {
    if (!rule.active) {
      preResolverStep.set(rule.id, 'inactive');
    } else if (!isWithinEffectiveWindow(rule, date)) {
      preResolverStep.set(rule.id, 'outside_effective_window');
    } else {
      candidateRules.push(rule);
    }
  }

  const resolution = resolveRule(candidateRules, employee.attributes);
  const resolverStep = new Map<string, PreviewEliminationStep | null>();
  for (const candidate of resolution.candidates) {
    resolverStep.set(candidate.rule.id, candidate.eliminatedAtStep);
  }

  const winner = resolution.winner;
  const otherCandidates: PreviewCandidate[] = rules
    .filter((rule) => winner === null || rule.id !== winner.id)
    .map((rule) =>
      Object.freeze({
        rule: describeRule(rule),
        eliminatedAtStep: preResolverStep.get(rule.id) ?? resolverStep.get(rule.id) ?? null,
      }),
    );

  return Object.freeze({
    employeeId: employee.employeeId,
    date,
    resolvedAttendanceSource: winner === null ? null : winner.attendanceSource,
    decidingRuleId: winner === null ? null : winner.id,
    selectedRule: winner === null ? null : describeRule(winner),
    otherCandidates: Object.freeze(otherCandidates),
    unresolvedDimensions: Object.freeze([...resolution.unresolvedDimensions]),
  });
}

// ---------------------------------------------------------------------------------------------
// criteria 12.3 and 12.5: what a submission or a deactivation would do to real people
// ---------------------------------------------------------------------------------------------

/** One employee whose resolved Attendance_Source would move, with the rule on each side of it. */
export interface ResolvedSourceChange {
  readonly employeeId: string;
  /** null when no rule resolved for the employee before the change (a store with no default). */
  readonly fromAttendanceSource: AttendanceSource | null;
  readonly fromDecidingRuleId: string | null;
  readonly toAttendanceSource: AttendanceSource | null;
  readonly toDecidingRuleId: string | null;
}

export interface SubmissionImpact {
  /** The date every count is stated as of — criterion 12.3's "currently". */
  readonly evaluatedOn: string;
  /** criterion 12.3, first count: currently active employees the proposed rule would match. */
  readonly matchedEmployeeCount: number;
  readonly matchedEmployeeIds: readonly string[];
  /** criterion 12.3, second count: of those, the ones whose RESOLVED source would change. */
  readonly changedEmployeeCount: number;
  readonly changes: readonly ResolvedSourceChange[];
  readonly proposedSpecificityCount: number;
  /**
   * False when the proposed rule's own effective-date window does not cover `evaluatedOn`, or the
   * rule is submitted inactive. Both counts are then 0 and this flag says why, rather than a bare
   * zero the administrator has to explain to themselves.
   */
  readonly proposedRuleLiveOnEvaluationDate: boolean;
}

export interface SubmissionImpactInput {
  /** The rule as submitted. Its own `active` and window are honoured, not assumed. */
  readonly proposedRule: AdminRule;
  /** The store as it stands, WITHOUT the proposed rule. */
  readonly existingRules: readonly AdminRule[];
  readonly activeEmployees: readonly ActiveEmployee[];
  readonly evaluationDate: string;
}

/**
 * criterion 12.3. Resolves the population twice — once against the store as it stands, once
 * against the store with the proposed rule inserted — and reports the two counts the screen must
 * display on submission.
 *
 * WHY THE CHANGE COUNT CANNOT EXCEED THE MATCH COUNT, structurally rather than by assertion:
 * only matched employees are resolved twice at all. An employee the proposed rule does not match
 * has the identical candidate set before and after insertion, so `resolveRule` — a pure function
 * of that set and the employee's attributes — returns the identical winner. Iterating the matched
 * set is therefore not an optimisation; it is the statement that inserting a rule cannot move
 * somebody it does not match.
 *
 * A `fromAttendanceSource` of null is counted as a change when the rule resolves something after
 * insertion: going from "no rule decided this employee" to a decided source is the largest change
 * there is, and reporting it as no change would hide a broken store behind a reassuring zero.
 */
export function analyseSubmissionImpact(input: SubmissionImpactInput): SubmissionImpact {
  const { proposedRule, existingRules, activeEmployees, evaluationDate } = input;
  assertCivilDate(evaluationDate, 'evaluationDate');

  const live = proposedRule.active && isWithinEffectiveWindow(proposedRule, evaluationDate);
  const matchedIds = matchedPopulation(proposedRule, activeEmployees, evaluationDate);
  const matchedIdSet = new Set(matchedIds);

  const before = activeRulesInWindow(existingRules, evaluationDate);
  // The proposed rule is appended to the same already-filtered candidate list rather than
  // re-filtered, so the "after" store differs from the "before" store by exactly one rule.
  const after = live ? [...before, proposedRule] : before;

  const changes: ResolvedSourceChange[] = [];
  for (const employee of activeEmployees) {
    if (!matchedIdSet.has(employee.employeeId)) continue;
    const beforeWinner = resolveRule(before, employee.attributes).winner;
    const afterWinner = resolveRule(after, employee.attributes).winner;
    const beforeSource = beforeWinner === null ? null : beforeWinner.attendanceSource;
    const afterSource = afterWinner === null ? null : afterWinner.attendanceSource;
    if (beforeSource !== afterSource) {
      changes.push(
        Object.freeze({
          employeeId: employee.employeeId,
          fromAttendanceSource: beforeSource,
          fromDecidingRuleId: beforeWinner === null ? null : beforeWinner.id,
          toAttendanceSource: afterSource,
          toDecidingRuleId: afterWinner === null ? null : afterWinner.id,
        }),
      );
    }
  }
  changes.sort((a, b) => (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0));

  return Object.freeze({
    evaluatedOn: evaluationDate,
    matchedEmployeeCount: matchedIds.length,
    matchedEmployeeIds: Object.freeze(matchedIds),
    changedEmployeeCount: changes.length,
    changes: Object.freeze(changes),
    proposedSpecificityCount: computeSpecificityCount(proposedRule),
    proposedRuleLiveOnEvaluationDate: live,
  });
}

/** Why a deactivation cannot be previewed or applied at all. */
export type DeactivationRefusalCode =
  /** No rule in the supplied store carries the requested id. */
  | 'rule_not_found'
  /** criterion 1.11: the System_Default_Rule is mandatory (criterion 1.10). */
  | 'system_default_rule_mandatory'
  /** The rule is already inactive, so there is nothing to deactivate and nothing to confirm. */
  | 'rule_already_inactive';

export interface DeactivationRefusal {
  readonly code: DeactivationRefusalCode;
  readonly message: string;
  readonly criteria: readonly string[];
}

export interface DeactivationImpact {
  readonly ruleId: string;
  readonly evaluatedOn: string;
  /**
   * criterion 12.5. Always true when the deactivation is previewable: the criterion requires
   * confirmation before applying the deactivation unconditionally, not only when the count is
   * non-zero. A deactivation that moves nobody today still moves whoever joins that population
   * tomorrow, so an unconfirmed zero is not a safe default.
   */
  readonly confirmationRequired: boolean;
  /** criterion 12.5's count. */
  readonly changedEmployeeCount: number;
  readonly changes: readonly ResolvedSourceChange[];
  /** The population the rule currently decides — a superset of the changed population. */
  readonly currentlyDecidedEmployeeCount: number;
  /** Non-null exactly when the deactivation is refused; both counts are then 0. */
  readonly refusal: DeactivationRefusal | null;
}

export interface DeactivationImpactInput {
  readonly ruleId: string;
  /** The store as it stands, INCLUDING the rule being deactivated. */
  readonly existingRules: readonly AdminRule[];
  readonly activeEmployees: readonly ActiveEmployee[];
  readonly evaluationDate: string;
}

/**
 * criterion 12.5. Resolves the population with and without the rule and reports the count whose
 * resolved Attendance_Source would move, plus the explicit confirmation-required flag.
 *
 * Only the employees the rule CURRENTLY DECIDES can change: removing a rule leaves the candidate
 * set of everyone it did not decide untouched, and leaves the winner of everyone it did not win
 * untouched. `currentlyDecidedEmployeeCount` is reported alongside because it is the honest
 * denominator for the change count — a deactivation that decides 200 people and moves 3 of them is
 * a different decision from one that decides 3 and moves 3.
 */
export function analyseDeactivationImpact(input: DeactivationImpactInput): DeactivationImpact {
  const { ruleId, existingRules, activeEmployees, evaluationDate } = input;
  assertCivilDate(evaluationDate, 'evaluationDate');

  const empty = (refusal: DeactivationRefusal): DeactivationImpact =>
    Object.freeze({
      ruleId,
      evaluatedOn: evaluationDate,
      confirmationRequired: false,
      changedEmployeeCount: 0,
      changes: Object.freeze([]),
      currentlyDecidedEmployeeCount: 0,
      refusal: Object.freeze({ ...refusal, criteria: Object.freeze([...refusal.criteria]) }),
    });

  const target = existingRules.find((rule) => rule.id === ruleId);
  if (target === undefined) {
    return empty({
      code: 'rule_not_found',
      message: `No Attendance_Source_Rule with id ${ruleId} is present in the supplied rule set.`,
      criteria: ['12.5'],
    });
  }
  if (computeSpecificityCount(target) === 0) {
    return empty({
      code: 'system_default_rule_mandatory',
      message:
        'This rule constrains no Rule_Dimension and is therefore the System_Default_Rule; a System_Default_Rule is mandatory and cannot be deactivated.',
      criteria: ['1.10', '1.11', '12.5'],
    });
  }
  if (!target.active) {
    return empty({
      code: 'rule_already_inactive',
      message: `Attendance_Source_Rule ${ruleId} is already inactive.`,
      criteria: ['12.5'],
    });
  }

  const before = activeRulesInWindow(existingRules, evaluationDate);
  const after = before.filter((rule) => rule.id !== ruleId);

  let currentlyDecided = 0;
  const changes: ResolvedSourceChange[] = [];
  for (const employee of activeEmployees) {
    const beforeWinner = resolveRule(before, employee.attributes).winner;
    if (beforeWinner === null || beforeWinner.id !== ruleId) continue;
    currentlyDecided += 1;
    const afterWinner = resolveRule(after, employee.attributes).winner;
    const afterSource = afterWinner === null ? null : afterWinner.attendanceSource;
    if (beforeWinner.attendanceSource !== afterSource) {
      changes.push(
        Object.freeze({
          employeeId: employee.employeeId,
          fromAttendanceSource: beforeWinner.attendanceSource,
          fromDecidingRuleId: beforeWinner.id,
          toAttendanceSource: afterSource,
          toDecidingRuleId: afterWinner === null ? null : afterWinner.id,
        }),
      );
    }
  }
  changes.sort((a, b) => (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0));

  return Object.freeze({
    ruleId,
    evaluatedOn: evaluationDate,
    confirmationRequired: true,
    changedEmployeeCount: changes.length,
    changes: Object.freeze(changes),
    currentlyDecidedEmployeeCount: currentlyDecided,
    refusal: null,
  });
}

// ---------------------------------------------------------------------------------------------
// criteria 12.9 and 12.10: the cost-centre-versus-process contradiction warning (decision A1)
// ---------------------------------------------------------------------------------------------
//
// This is the mitigation A1 accepted when it put cost centre first in Dimension_Priority_Order.
// `cost_centre_master` carries `branch_id`, `department_id`, `process_id`, `client_id` and
// `lob_id`, so a cost centre ALREADY IMPLIES a process. Two rules of equal Specificity_Count, one
// constraining cost centre and one constraining process, can therefore state opposite
// Attendance_Sources over overlapping people, and criterion 2.4 hands the win to the cost-centre
// rule silently. The warning is what makes that win a decision instead of an accident.
//
// Note what is NOT required for the warning to fire: equal Specificity_Count, or any relationship
// between the two rules' dimension values. Whether the cost-centre rule actually wins is the
// resolver's business (and `analyseSubmissionImpact` reports the outcome); criterion 12.9 asks
// only for intersecting populations and differing sources.

export interface IntersectingProcessScopedRule {
  readonly rule: RuleListRow;
  /** criterion 12.9: stated for every intersecting rule, differing or not. */
  readonly attendanceSourceDiffers: boolean;
  /** criterion 12.10's count, per intersecting rule. */
  readonly intersectingEmployeeCount: number;
  readonly intersectingEmployeeIds: readonly string[];
}

export interface CostCentreProcessContradiction {
  /** False when the submitted rule does not constrain cost centre — criterion 12.9's trigger. */
  readonly applicable: boolean;
  readonly evaluatedOn: string;
  readonly submittedMatchedEmployeeCount: number;
  /** Every active process-scoped rule with an intersecting population, differing or not. */
  readonly intersectingProcessScopedRules: readonly IntersectingProcessScopedRule[];
  /** The subset whose Attendance_Source differs — the rules the warning names. */
  readonly differingRuleIds: readonly string[];
  /**
   * criterion 12.10: the count of active employees in the intersecting population. This is the
   * size of the UNION over the differing rules, so an employee caught by two contradicting rules
   * is one person, not two. Per-rule counts are on each entry.
   */
  readonly intersectingEmployeeCount: number;
  readonly intersectingEmployeeIds: readonly string[];
  /** criterion 12.9's warning text, naming each differing rule. Null when there is nothing to warn about. */
  readonly warning: string | null;
  /** criterion 12.10. */
  readonly confirmationRequired: boolean;
}

export interface ContradictionInput {
  readonly proposedRule: AdminRule;
  readonly existingRules: readonly AdminRule[];
  readonly activeEmployees: readonly ActiveEmployee[];
  readonly evaluationDate: string;
}

function constrains(rule: AdminRule, dimension: RuleDimension): boolean {
  const constraint = rule.dimensionValues[dimension];
  return Boolean(constraint && constraint.size > 0);
}

/**
 * criteria 12.9 and 12.10. Fires only for a submitted rule that constrains cost centre; returns
 * `applicable: false` otherwise, with no warning and no confirmation demanded, because inventing a
 * confirmation step the requirement does not ask for trains administrators to click through the
 * one that matters.
 *
 * The submitted rule is evaluated at `evaluationDate` through `matchedPopulation`, which honours
 * its own window and active flag — a rule submitted as future-dated matches nobody today and can
 * contradict nobody today, and saying so is more useful than warning about a population that does
 * not exist yet.
 */
export function analyseCostCentreProcessContradiction(
  input: ContradictionInput,
): CostCentreProcessContradiction {
  const { proposedRule, existingRules, activeEmployees, evaluationDate } = input;
  assertCivilDate(evaluationDate, 'evaluationDate');

  const notApplicable = (submittedCount: number): CostCentreProcessContradiction =>
    Object.freeze({
      applicable: false,
      evaluatedOn: evaluationDate,
      submittedMatchedEmployeeCount: submittedCount,
      intersectingProcessScopedRules: Object.freeze([]),
      differingRuleIds: Object.freeze([]),
      intersectingEmployeeCount: 0,
      intersectingEmployeeIds: Object.freeze([]),
      warning: null,
      confirmationRequired: false,
    });

  if (!constrains(proposedRule, 'cost_centre')) return notApplicable(0);

  const submittedPopulation = matchedPopulation(proposedRule, activeEmployees, evaluationDate);
  if (submittedPopulation.length === 0) return notApplicable(0);

  const intersecting: IntersectingProcessScopedRule[] = [];
  for (const existing of existingRules) {
    if (existing.id === proposedRule.id) continue;
    if (!existing.active) continue;
    if (!constrains(existing, 'process')) continue;

    const existingPopulation = matchedPopulation(existing, activeEmployees, evaluationDate);
    const shared = intersectPopulations(submittedPopulation, existingPopulation);
    if (shared.length === 0) continue;

    intersecting.push(
      Object.freeze({
        rule: describeRule(existing),
        attendanceSourceDiffers: existing.attendanceSource !== proposedRule.attendanceSource,
        intersectingEmployeeCount: shared.length,
        intersectingEmployeeIds: Object.freeze(shared),
      }),
    );
  }
  intersecting.sort((a, b) => (a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0));

  const differing = intersecting.filter((entry) => entry.attendanceSourceDiffers);
  const unionIds = [...new Set(differing.flatMap((entry) => [...entry.intersectingEmployeeIds]))].sort();

  const warning =
    differing.length === 0
      ? null
      : `This rule constrains cost centre and states Attendance_Source '${proposedRule.attendanceSource}'. ` +
        `${differing.length} active process-scoped rule${differing.length === 1 ? '' : 's'} ` +
        `state${differing.length === 1 ? 's' : ''} a different Attendance_Source over an overlapping ` +
        `population of ${unionIds.length} active employee${unionIds.length === 1 ? '' : 's'}: ` +
        differing
          .map(
            (entry) =>
              `${entry.rule.id} ('${entry.rule.attendanceSource}', ${entry.intersectingEmployeeCount} shared)`,
          )
          .join(', ') +
        '. A cost centre already implies a process, so this rule wins the tie-break under ' +
        'Dimension_Priority_Order and overrides them. Confirm before saving.';

  return Object.freeze({
    applicable: true,
    evaluatedOn: evaluationDate,
    submittedMatchedEmployeeCount: submittedPopulation.length,
    intersectingProcessScopedRules: Object.freeze(intersecting),
    differingRuleIds: Object.freeze(differing.map((entry) => entry.rule.id)),
    intersectingEmployeeCount: unionIds.length,
    intersectingEmployeeIds: Object.freeze(unionIds),
    warning,
    confirmationRequired: differing.length > 0,
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 12.7: validating a threshold configuration submission
// ---------------------------------------------------------------------------------------------
//
// This is the WRITE-TIME half of the guard attendance-threshold-config.service.ts already applies
// at read time ("a non-finite or non-positive stored value falls back to the default and must be
// flagged — the write-time validation that prevents this from being written at all is a later
// phase's rule-admin-screen task"). Every value here is a count of minutes or of whole days, and
// every read-time consumer applies `Number.isFinite(v) && v > 0` before trusting it, so a value
// this validator lets through must be one the readers will actually use.
//
// A null or omitted value is NOT a violation: criteria 5.5, 6.2, 10.4 and 10.8 each supply a
// default (480 / 60 / 60 / 3-in-30) that applies when nothing is configured, so "unset" is a valid
// configuration state and is reported in `unconfiguredFields` rather than rejected.

export const MINUTES_IN_A_CALENDAR_DAY = 1440;

/** An upper bound on the rolling window, so a typo cannot ask for a century of history. */
export const MAX_ROLLING_WINDOW_DAYS = 366;

export type ThresholdViolationCode =
  | 'not_an_integer'
  | 'negative'
  | 'not_positive'
  | 'exceeds_calendar_day'
  | 'exceeds_max_rolling_window'
  | 'half_day_exceeds_full_day'
  | 'grace_exceeds_full_day'
  | 'floor_ceiling_exceeds_corroboration_threshold'
  | 'repeat_threshold_exceeds_rolling_window'
  | 'empty_dimension_value_set'
  | 'blank_dimension_value'
  | 'blank_branch_id'
  | 'duplicate_branch_ceiling';

export interface ThresholdViolation {
  /** Dotted path of the offending member, e.g. `dayThresholds.halfDayMinutes`. */
  readonly field: string;
  readonly code: ThresholdViolationCode;
  readonly message: string;
  readonly criteria: readonly string[];
}

/** criterion 12.7's per-branch Dual_Review_Ceiling. */
export interface BranchDualReviewCeiling {
  readonly branchId: string;
  readonly ceiling: number;
}

/**
 * criterion 12.7's submission. The Rule_Dimension scope is validated alongside the values, because
 * the criterion configures these "against the same six Rule_Dimensions" — a threshold rule scoped
 * to an empty value set would be written as constrained and resolved as unconstrained, which is
 * the shape of defect that makes a configuration store disagree with itself.
 */
export interface ThresholdConfigSubmission {
  readonly dimensionValues?: Partial<Record<RuleDimension, readonly string[]>>;
  /** criteria 5.5, 12.7. Default 480 (decision A2). */
  readonly aprCorroborationThresholdMinutes?: number | null;
  /** criteria 6.2, 12.7. Default 60 (decision A2). */
  readonly varianceToleranceMinutes?: number | null;
  /** criteria 10.4, 12.7. Default 60. */
  readonly floorAbsencePatternCeilingMinutes?: number | null;
  /** criteria 10.7, 10.8, 12.7. Default 3 occurrences. */
  readonly repeatThresholdCount?: number | null;
  /** criteria 10.7, 10.8, 12.7. Default 30 days, inclusive of the triggering date. */
  readonly rollingWindowDays?: number | null;
  /** criteria 1.14, 12.7. Seeded 540 / 270 / 15. */
  readonly dayThresholds?: {
    readonly fullDayMinutes?: number | null;
    readonly halfDayMinutes?: number | null;
    readonly graceMinutes?: number | null;
  } | null;
  /** criteria 6.10, 12.7. Default 100. Scoped to branch, not to the six Rule_Dimensions. */
  readonly dualReviewCeilingsByBranch?: readonly BranchDualReviewCeiling[] | null;
}

export interface ThresholdConfigValidation {
  readonly valid: boolean;
  readonly violations: readonly ThresholdViolation[];
  /** Members left null or omitted, whose documented default will apply. */
  readonly unconfiguredFields: readonly string[];
}

interface NumericRule {
  readonly field: string;
  readonly value: number | null | undefined;
  /** `positive` rejects 0; `non_negative` accepts it. */
  readonly sign: 'positive' | 'non_negative';
  readonly max: number | null;
  readonly maxCode: ThresholdViolationCode;
  readonly criteria: readonly string[];
}

function checkNumeric(rule: NumericRule, violations: ThresholdViolation[], unconfigured: string[]): number | null {
  const { field, value, sign, max, maxCode, criteria } = rule;
  if (value === null || value === undefined) {
    unconfigured.push(field);
    return null;
  }
  // Number.isInteger is false for NaN, Infinity and any fractional value, so one test covers all
  // three of the malformed shapes a form or a JSON body can deliver.
  if (!Number.isInteger(value)) {
    violations.push(
      Object.freeze({
        field,
        code: 'not_an_integer' as const,
        message: `${field} must be a whole number, received ${String(value)}.`,
        criteria: Object.freeze([...criteria]),
      }),
    );
    return null;
  }
  if (value < 0) {
    violations.push(
      Object.freeze({
        field,
        code: 'negative' as const,
        message: `${field} must not be negative, received ${value}.`,
        criteria: Object.freeze([...criteria]),
      }),
    );
    return null;
  }
  if (sign === 'positive' && value === 0) {
    violations.push(
      Object.freeze({
        field,
        code: 'not_positive' as const,
        message: `${field} must be greater than zero; a zero value is discarded by every consumer and the default would silently apply instead.`,
        criteria: Object.freeze([...criteria]),
      }),
    );
    return null;
  }
  if (max !== null && value > max) {
    violations.push(
      Object.freeze({
        field,
        code: maxCode,
        message: `${field} must not exceed ${max}, received ${value}.`,
        criteria: Object.freeze([...criteria]),
      }),
    );
    return null;
  }
  return value;
}

function orderingViolation(
  field: string,
  code: ThresholdViolationCode,
  message: string,
  criteria: readonly string[],
): ThresholdViolation {
  return Object.freeze({ field, code, message, criteria: Object.freeze([...criteria]) });
}

/**
 * criterion 12.7. Validates the six threshold-family values, the three Day_Threshold_Rule minute
 * values, the per-branch Dual_Review_Ceiling and the Rule_Dimension scope they are configured
 * against.
 *
 * THE ORDERINGS ENFORCED, and why each one MUST hold rather than merely being tidy:
 *
 *   halfDayMinutes <= fullDayMinutes
 *       A half day that needs more minutes than a full day is unsatisfiable in one direction and
 *       classifies every full day as a half day in the other. classifyMinutes reads both from the
 *       same resolved rule, so the two are always compared against each other.
 *   graceMinutes <= fullDayMinutes
 *       grace_minutes is the lateness allowance the engine compares `lateByMinutes` against
 *       (attendance-engine.service.ts, seeded 15). An allowance longer than the full working day
 *       cannot mark anyone late, which silently switches the late-mark off rather than configuring
 *       it.
 *   floorAbsencePatternCeilingMinutes <= aprCorroborationThresholdMinutes
 *       A Floor_Absence_Pattern is a full biometric day whose productive minutes fall BELOW the
 *       ceiling (criterion 10.3), and it is always queued for Dual_Review (decision A2). A day at
 *       or above the corroboration threshold is corroborated (criterion 5.2). A ceiling above the
 *       threshold therefore declares corroborated days to be the fraud pattern — the two verdicts
 *       contradict, and the strictest one wins the queue.
 *   repeatThresholdCount <= rollingWindowDays
 *       floor-absence-pattern.ts counts at most one occurrence per date, so N occurrences inside a
 *       W-day window is unreachable whenever N > W. Such a configuration cannot ever fire and
 *       reads as if repeat detection were switched on.
 *
 * Each value is additionally bounded by the calendar day, because Canonical_Productive_Minutes is
 * itself bounded to 1,440 (Requirement 18) and a threshold above that bound can never be met.
 */
export function validateThresholdConfiguration(
  submission: ThresholdConfigSubmission,
): ThresholdConfigValidation {
  const violations: ThresholdViolation[] = [];
  const unconfigured: string[] = [];

  const apr = checkNumeric(
    {
      field: 'aprCorroborationThresholdMinutes',
      value: submission.aprCorroborationThresholdMinutes,
      sign: 'positive',
      max: MINUTES_IN_A_CALENDAR_DAY,
      maxCode: 'exceeds_calendar_day',
      criteria: ['5.5', '12.7'],
    },
    violations,
    unconfigured,
  );
  checkNumeric(
    {
      field: 'varianceToleranceMinutes',
      value: submission.varianceToleranceMinutes,
      sign: 'positive',
      max: MINUTES_IN_A_CALENDAR_DAY,
      maxCode: 'exceeds_calendar_day',
      criteria: ['6.2', '12.7'],
    },
    violations,
    unconfigured,
  );
  const floorCeiling = checkNumeric(
    {
      field: 'floorAbsencePatternCeilingMinutes',
      value: submission.floorAbsencePatternCeilingMinutes,
      sign: 'positive',
      max: MINUTES_IN_A_CALENDAR_DAY,
      maxCode: 'exceeds_calendar_day',
      criteria: ['10.4', '12.7'],
    },
    violations,
    unconfigured,
  );
  const repeatCount = checkNumeric(
    {
      field: 'repeatThresholdCount',
      value: submission.repeatThresholdCount,
      sign: 'positive',
      max: null,
      maxCode: 'exceeds_calendar_day',
      criteria: ['10.7', '10.8', '12.7'],
    },
    violations,
    unconfigured,
  );
  const windowDays = checkNumeric(
    {
      field: 'rollingWindowDays',
      value: submission.rollingWindowDays,
      sign: 'positive',
      max: MAX_ROLLING_WINDOW_DAYS,
      maxCode: 'exceeds_max_rolling_window',
      criteria: ['10.7', '10.8', '12.7'],
    },
    violations,
    unconfigured,
  );

  const day = submission.dayThresholds ?? null;
  if (day === null) {
    unconfigured.push('dayThresholds');
  }
  const fullDay = checkNumeric(
    {
      field: 'dayThresholds.fullDayMinutes',
      value: day === null ? null : day.fullDayMinutes,
      sign: 'positive',
      max: MINUTES_IN_A_CALENDAR_DAY,
      maxCode: 'exceeds_calendar_day',
      criteria: ['1.14', '12.7'],
    },
    violations,
    day === null ? [] : unconfigured,
  );
  const halfDay = checkNumeric(
    {
      field: 'dayThresholds.halfDayMinutes',
      value: day === null ? null : day.halfDayMinutes,
      sign: 'positive',
      max: MINUTES_IN_A_CALENDAR_DAY,
      maxCode: 'exceeds_calendar_day',
      criteria: ['1.14', '12.7'],
    },
    violations,
    day === null ? [] : unconfigured,
  );
  // grace_minutes 0 is a real configuration: no lateness allowance at all.
  const grace = checkNumeric(
    {
      field: 'dayThresholds.graceMinutes',
      value: day === null ? null : day.graceMinutes,
      sign: 'non_negative',
      max: MINUTES_IN_A_CALENDAR_DAY,
      maxCode: 'exceeds_calendar_day',
      criteria: ['1.14', '12.7'],
    },
    violations,
    day === null ? [] : unconfigured,
  );

  if (fullDay !== null && halfDay !== null && halfDay > fullDay) {
    violations.push(
      orderingViolation(
        'dayThresholds.halfDayMinutes',
        'half_day_exceeds_full_day',
        `half_day_minutes (${halfDay}) must not exceed full_day_minutes (${fullDay}).`,
        ['1.14', '12.7'],
      ),
    );
  }
  if (fullDay !== null && grace !== null && grace > fullDay) {
    violations.push(
      orderingViolation(
        'dayThresholds.graceMinutes',
        'grace_exceeds_full_day',
        `grace_minutes (${grace}) must not exceed full_day_minutes (${fullDay}); a longer allowance than the working day can never mark anyone late.`,
        ['1.14', '12.7'],
      ),
    );
  }
  if (apr !== null && floorCeiling !== null && floorCeiling > apr) {
    violations.push(
      orderingViolation(
        'floorAbsencePatternCeilingMinutes',
        'floor_ceiling_exceeds_corroboration_threshold',
        `Floor_Absence_Pattern_Ceiling (${floorCeiling}) must not exceed APR_Corroboration_Threshold (${apr}); a day at or above the threshold is corroborated and cannot also be the floor-absence pattern.`,
        ['5.2', '10.3', '12.7'],
      ),
    );
  }
  if (repeatCount !== null && windowDays !== null && repeatCount > windowDays) {
    violations.push(
      orderingViolation(
        'repeatThresholdCount',
        'repeat_threshold_exceeds_rolling_window',
        `The repeat threshold (${repeatCount} occurrences) must not exceed the rolling window (${windowDays} days); at most one occurrence is counted per date, so this can never fire.`,
        ['10.7', '10.8', '12.7'],
      ),
    );
  }

  const dimensionValues = submission.dimensionValues ?? {};
  for (const dimension of DIMENSION_PRIORITY_ORDER) {
    const values = dimensionValues[dimension];
    if (values === undefined) continue;
    if (values.length === 0) {
      violations.push(
        orderingViolation(
          `dimensionValues.${dimension}`,
          'empty_dimension_value_set',
          `${dimension} is present with no value; leave the dimension out to mean "matches every value" rather than supplying an empty set.`,
          ['1.4', '12.7'],
        ),
      );
      continue;
    }
    if (values.some((value) => typeof value !== 'string' || value.trim() === '')) {
      violations.push(
        orderingViolation(
          `dimensionValues.${dimension}`,
          'blank_dimension_value',
          `${dimension} carries a blank value; every constrained value must be a non-empty identifier.`,
          ['1.8', '12.7'],
        ),
      );
    }
  }

  const ceilings = submission.dualReviewCeilingsByBranch ?? null;
  if (ceilings === null) {
    unconfigured.push('dualReviewCeilingsByBranch');
  } else {
    const seen = new Set<string>();
    ceilings.forEach((entry, index) => {
      const field = `dualReviewCeilingsByBranch[${index}]`;
      if (typeof entry.branchId !== 'string' || entry.branchId.trim() === '') {
        violations.push(
          orderingViolation(`${field}.branchId`, 'blank_branch_id', `${field}.branchId must be a non-empty branch identifier.`, [
            '6.10',
            '12.7',
          ]),
        );
      } else if (seen.has(entry.branchId)) {
        violations.push(
          orderingViolation(
            `${field}.branchId`,
            'duplicate_branch_ceiling',
            `Branch ${entry.branchId} carries more than one Dual_Review_Ceiling in this submission; the resolved ceiling would depend on row order.`,
            ['6.10', '12.7'],
          ),
        );
      } else {
        seen.add(entry.branchId);
      }
      // A ceiling of 0 is permitted and meaningful: it queues nothing except the
      // Floor_Absence_Pattern occurrences that criterion 6.8 queues irrespective of the ceiling.
      checkNumeric(
        {
          field: `${field}.ceiling`,
          value: entry.ceiling,
          sign: 'non_negative',
          max: null,
          maxCode: 'exceeds_calendar_day',
          criteria: ['6.10', '12.7'],
        },
        violations,
        [],
      );
    });
  }

  return Object.freeze({
    valid: violations.length === 0,
    violations: Object.freeze(violations),
    unconfiguredFields: Object.freeze(unconfigured),
  });
}
