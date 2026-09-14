// backend/src/modules/wfm/__tests__/rule-admin-impact.test.ts
//
// Requirement 12 (Rule Administration Interface). Unit tests for each criterion the module owns,
// then the four properties that are the honest test of the impact logic, then the adversarial
// cases: a rule constraining nothing, a rule constraining all six dimensions, an equal-
// Specificity_Count tie, abutting and overlapping effective windows, the exact decision-A1 hazard
// (a cost centre implying a process that a process-scoped rule also constrains), and an empty
// employee population.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MAX_ROLLING_WINDOW_DAYS,
  MINUTES_IN_A_CALENDAR_DAY,
  activeRulesInWindow,
  analyseCostCentreProcessContradiction,
  analyseDeactivationImpact,
  analyseSubmissionImpact,
  computeSpecificityCount,
  describeRule,
  intersectPopulations,
  isWithinEffectiveWindow,
  listRules,
  matchedPopulation,
  previewRuleResolution,
  ruleMatchesEmployee,
  validateThresholdConfiguration,
  type ActiveEmployee,
  type AdminRule,
  type AttendanceSource,
} from '../rule-admin-impact.js';
import {
  DIMENSION_PRIORITY_ORDER,
  type RuleDimension,
} from '../attendance-source-rule-resolver.js';

const TODAY = '2026-09-15';

type DimensionSpec = Partial<Record<RuleDimension, string | readonly string[]>>;

function rule(
  id: string,
  attendanceSource: AttendanceSource,
  dimensions: DimensionSpec = {},
  overrides: Partial<Pick<AdminRule, 'effectiveFrom' | 'effectiveTo' | 'active' | 'createdAt'>> = {},
): AdminRule {
  const dimensionValues: Partial<Record<RuleDimension, Set<string>>> = {};
  for (const dimension of DIMENSION_PRIORITY_ORDER) {
    const value = dimensions[dimension];
    if (value === undefined) continue;
    dimensionValues[dimension] = new Set(typeof value === 'string' ? [value] : value);
  }
  return {
    id,
    attendanceSource,
    dimensionValues,
    effectiveFrom: overrides.effectiveFrom ?? '2026-01-01',
    effectiveTo: overrides.effectiveTo ?? null,
    active: overrides.active ?? true,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  };
}

function employee(
  employeeId: string,
  attributes: Partial<ActiveEmployee['attributes']> = {},
): ActiveEmployee {
  return {
    employeeId,
    attributes: {
      costCentreId: attributes.costCentreId ?? null,
      processId: attributes.processId ?? null,
      branchId: attributes.branchId ?? null,
      departmentId: attributes.departmentId ?? null,
      designationId: attributes.designationId ?? null,
      employmentProfile: attributes.employmentProfile ?? null,
    },
  };
}

/** The System_Default_Rule of criterion 1.10: constrains nothing, biometric. */
const SYSTEM_DEFAULT = rule('rule-system-default', 'biometric');

// ── criterion 12.1: the list row, with a COMPUTED Specificity_Count ───────────────────────────

describe('describeRule / computeSpecificityCount (criterion 12.1)', () => {
  it('projects the six Rule_Dimension values, the source, the window, the active state and the count', () => {
    const row = describeRule(
      rule('rule-a', 'dialler', { cost_centre: 'cc-1', process: 'proc-1' }, {
        effectiveFrom: '2026-07-01',
        effectiveTo: '2026-12-31',
      }),
    );
    expect(row).toEqual({
      id: 'rule-a',
      dimensionValues: {
        cost_centre: ['cc-1'],
        process: ['proc-1'],
        branch: null,
        department: null,
        designation: null,
        employment_profile: null,
      },
      attendanceSource: 'dialler',
      effectiveFrom: '2026-07-01',
      effectiveTo: '2026-12-31',
      active: true,
      specificityCount: 2,
    });
  });

  it('reports 0 for the System_Default_Rule and 6 for a rule constraining every dimension', () => {
    expect(computeSpecificityCount(SYSTEM_DEFAULT)).toBe(0);
    const allSix = rule('rule-all', 'dialler', {
      cost_centre: 'cc-1',
      process: 'proc-1',
      branch: 'br-1',
      department: 'dep-1',
      designation: 'desig-1',
      employment_profile: 'VOICE',
    });
    expect(computeSpecificityCount(allSix)).toBe(6);
  });

  it('is computed from the dimension values, not read from a stored count, and ignores an empty set', () => {
    // An empty Set is what resolveRule treats as unconstrained; the displayed count must agree
    // with the count the tie-break uses or the screen lies about which rule wins.
    const withEmptySet: AdminRule = {
      ...rule('rule-empty', 'biometric', { branch: 'br-1' }),
      dimensionValues: { branch: new Set(['br-1']), process: new Set<string>() },
    };
    expect(computeSpecificityCount(withEmptySet)).toBe(1);
    expect(describeRule(withEmptySet).dimensionValues.process).toBeNull();
  });

  it('projects a set-valued constraint (criterion 2.10) as a sorted array', () => {
    const row = describeRule(rule('rule-ops', 'biometric', { department: ['dep-b', 'dep-a'] }));
    expect(row.dimensionValues.department).toEqual(['dep-a', 'dep-b']);
    expect(row.specificityCount).toBe(1);
  });
});

// ── criterion 12.2: filtering, including combinations ─────────────────────────────────────────

describe('listRules (criterion 12.2)', () => {
  const rules: AdminRule[] = [
    SYSTEM_DEFAULT,
    rule('rule-cc', 'dialler', { cost_centre: 'cc-1' }),
    rule('rule-proc', 'dialler', { process: 'proc-1' }),
    rule('rule-branch', 'biometric', { branch: 'br-1' }),
    rule('rule-dept', 'biometric', { department: ['dep-upper', 'dep-lower'] }),
    rule('rule-desig', 'biometric', { designation: 'desig-exec' }),
    rule('rule-profile', 'dialler', { employment_profile: 'VOICE' }, { active: false }),
    rule('rule-cc-proc', 'biometric', { cost_centre: 'cc-1', process: 'proc-1' }),
  ];

  it('filters by each of the six Rule_Dimensions', () => {
    const expected: Array<[RuleDimension, string, string[]]> = [
      ['cost_centre', 'cc-1', ['rule-cc-proc', 'rule-cc']],
      ['process', 'proc-1', ['rule-cc-proc', 'rule-proc']],
      ['branch', 'br-1', ['rule-branch']],
      ['department', 'dep-lower', ['rule-dept']],
      ['designation', 'desig-exec', ['rule-desig']],
      ['employment_profile', 'VOICE', ['rule-profile']],
    ];
    for (const [dimension, valueId, ids] of expected) {
      const rows = listRules(rules, {
        dimensions: { [dimension]: { kind: 'constrains_value', valueId } },
      });
      expect(rows.map((r) => r.id)).toEqual(ids);
    }
  });

  it('filters by Attendance_Source and by active state', () => {
    expect(listRules(rules, { attendanceSource: 'dialler' }).map((r) => r.id)).toEqual([
      'rule-cc',
      'rule-proc',
      'rule-profile',
    ]);
    expect(listRules(rules, { active: false }).map((r) => r.id)).toEqual(['rule-profile']);
    expect(listRules(rules, { active: true })).toHaveLength(7);
  });

  it('combines filters conjunctively', () => {
    const rows = listRules(rules, {
      dimensions: {
        cost_centre: { kind: 'constrains_value', valueId: 'cc-1' },
        process: { kind: 'constrains_any_value' },
      },
      attendanceSource: 'biometric',
      active: true,
    });
    expect(rows.map((r) => r.id)).toEqual(['rule-cc-proc']);
  });

  it('finds the System_Default_Rule through an unconstrained filter on every dimension', () => {
    const dimensions = Object.fromEntries(
      DIMENSION_PRIORITY_ORDER.map((d) => [d, { kind: 'unconstrained' as const }]),
    );
    expect(listRules(rules, { dimensions }).map((r) => r.id)).toEqual(['rule-system-default']);
  });

  it('a constrains_value filter does not return rules that leave the dimension unset', () => {
    // The stated judgement: filtering a configuration list asks which rules MENTION the value,
    // not which rules reach it. The System_Default_Rule reaches every employee but appears under
    // no value filter.
    const rows = listRules(rules, {
      dimensions: { branch: { kind: 'constrains_value', valueId: 'br-1' } },
    });
    expect(rows.map((r) => r.id)).not.toContain('rule-system-default');
  });

  it('orders most specific first, then latest effective-from, then id, whatever the input order', () => {
    const shuffled = [rules[3], rules[7], rules[0], rules[1]];
    expect(listRules(shuffled).map((r) => r.id)).toEqual([
      'rule-cc-proc',
      'rule-branch',
      'rule-cc',
      'rule-system-default',
    ]);
  });

  it('filters by the effective window without implying an active-state filter', () => {
    const windowed = [
      rule('rule-past', 'dialler', { branch: 'br-1' }, { effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }),
      rule('rule-now', 'dialler', { branch: 'br-1' }, { effectiveFrom: '2026-07-01', active: false }),
    ];
    expect(listRules(windowed, { inWindowOn: TODAY }).map((r) => r.id)).toEqual(['rule-now']);
    expect(listRules(windowed, { inWindowOn: '2026-06-30' }).map((r) => r.id)).toEqual(['rule-past']);
  });
});

// ── effective windows: abutting and overlapping ───────────────────────────────────────────────

describe('isWithinEffectiveWindow / activeRulesInWindow (criteria 1.6, 2.2)', () => {
  const closing = rule('rule-closing', 'biometric', { branch: 'br-1' }, {
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-06-30',
  });
  const opening = rule('rule-opening', 'dialler', { branch: 'br-1' }, { effectiveFrom: '2026-07-01' });
  const overlapping = rule('rule-overlapping', 'dialler', { branch: 'br-1' }, {
    effectiveFrom: '2026-06-01',
    effectiveTo: '2026-07-31',
  });

  it('treats both window ends as inclusive', () => {
    expect(isWithinEffectiveWindow(closing, '2026-06-30')).toBe(true);
    expect(isWithinEffectiveWindow(closing, '2026-07-01')).toBe(false);
    expect(isWithinEffectiveWindow(opening, '2026-07-01')).toBe(true);
    expect(isWithinEffectiveWindow(opening, '2026-06-30')).toBe(false);
  });

  it('abutting windows never both apply — exactly one is a candidate on the boundary dates', () => {
    expect(activeRulesInWindow([closing, opening], '2026-06-30').map((r) => r.id)).toEqual([
      'rule-closing',
    ]);
    expect(activeRulesInWindow([closing, opening], '2026-07-01').map((r) => r.id)).toEqual([
      'rule-opening',
    ]);
  });

  it('overlapping windows both apply, and the tie-break decides which one wins', () => {
    expect(activeRulesInWindow([closing, overlapping], '2026-06-15')).toHaveLength(2);
    const preview = previewRuleResolution(
      [closing, overlapping],
      employee('emp-1', { branchId: 'br-1' }),
      '2026-06-15',
    );
    // Equal Specificity_Count, both constrain branch only, so criterion 2.5's deterministic tail
    // decides on the latest effective-from: 2026-06-01 beats 2026-01-01.
    expect(preview.decidingRuleId).toBe('rule-overlapping');
    expect(preview.otherCandidates).toEqual([
      { rule: describeRule(closing), eliminatedAtStep: 'deterministic_tail' },
    ]);
  });

  it('an inactive rule is a candidate for nobody, and excludes itself from every population', () => {
    const retired = rule('rule-retired', 'dialler', { branch: 'br-1' }, { active: false });
    expect(activeRulesInWindow([retired], TODAY)).toEqual([]);
    expect(matchedPopulation(retired, [employee('emp-1', { branchId: 'br-1' })], TODAY)).toEqual([]);
    // The dimensions still match — it is the active flag alone that empties the population.
    expect(ruleMatchesEmployee(retired, employee('emp-1', { branchId: 'br-1' }))).toBe(true);
  });

  it('rejects a malformed date rather than comparing against garbage', () => {
    expect(() => isWithinEffectiveWindow(opening, '15-09-2026')).toThrow(RangeError);
  });
});

// ── criterion 12.4 / 2.9: the resolution preview ──────────────────────────────────────────────

describe('previewRuleResolution (criteria 12.4, 2.9)', () => {
  const ccRule = rule('rule-cc', 'dialler', { cost_centre: 'cc-1' });
  const branchRule = rule('rule-branch', 'biometric', { branch: 'br-1' });
  const bothRule = rule('rule-cc-branch', 'dialler', { cost_centre: 'cc-1', branch: 'br-1' });
  const retired = rule('rule-retired', 'dialler', { cost_centre: 'cc-1' }, { active: false });
  const future = rule('rule-future', 'dialler', { cost_centre: 'cc-1' }, { effectiveFrom: '2027-01-01' });
  const store = [SYSTEM_DEFAULT, ccRule, branchRule, bothRule, retired, future];

  it('returns the selected rule, every other candidate, and the step each was eliminated at', () => {
    const preview = previewRuleResolution(
      store,
      employee('emp-1', { costCentreId: 'cc-1', branchId: 'br-1', processId: 'proc-1' }),
      TODAY,
    );
    expect(preview.employeeId).toBe('emp-1');
    expect(preview.date).toBe(TODAY);
    expect(preview.decidingRuleId).toBe('rule-cc-branch');
    expect(preview.resolvedAttendanceSource).toBe('dialler');
    expect(preview.selectedRule).toEqual(describeRule(bothRule));

    const steps = new Map(preview.otherCandidates.map((c) => [c.rule.id, c.eliminatedAtStep]));
    expect(steps.get('rule-system-default')).toBe('below_max_specificity');
    expect(steps.get('rule-cc')).toBe('below_max_specificity');
    expect(steps.get('rule-branch')).toBe('below_max_specificity');
    expect(steps.get('rule-retired')).toBe('inactive');
    expect(steps.get('rule-future')).toBe('outside_effective_window');
    expect(preview.otherCandidates).toHaveLength(5);
  });

  it('records the unresolved dimensions of criterion 2.8 and treats them as non-candidates', () => {
    // A7: process_id is NULL on 75 of 1,123 active employees. Such an employee must fall through
    // to a less specific rule, never be matched by accident.
    const processRule = rule('rule-proc', 'dialler', { process: 'proc-1' });
    const preview = previewRuleResolution(
      [SYSTEM_DEFAULT, processRule],
      employee('emp-no-process', { branchId: 'br-1' }),
      TODAY,
    );
    expect(preview.decidingRuleId).toBe('rule-system-default');
    // Branch is the one attribute this employee carries; the other five are unresolved.
    expect([...preview.unresolvedDimensions].sort()).toEqual([
      'cost_centre',
      'department',
      'designation',
      'employment_profile',
      'process',
    ]);
    const step = preview.otherCandidates.find((c) => c.rule.id === 'rule-proc');
    expect(step?.eliminatedAtStep).toBe('not_candidate');
  });

  it('reports an unresolvable store instead of throwing, so the preview can explain a broken store', () => {
    const preview = previewRuleResolution([rule('rule-only', 'dialler', { branch: 'br-9' })], employee('emp-1'), TODAY);
    expect(preview.resolvedAttendanceSource).toBeNull();
    expect(preview.decidingRuleId).toBeNull();
    expect(preview.selectedRule).toBeNull();
    expect(preview.otherCandidates.map((c) => c.eliminatedAtStep)).toEqual(['not_candidate']);
  });

  it('breaks an equal-Specificity_Count tie deterministically and identically on every call', () => {
    // Two rules of Specificity_Count 1 disagreeing on source, distinguished only by
    // Dimension_Priority_Order: cost centre precedes process (decision A1).
    const cc = rule('rule-b-cc', 'dialler', { cost_centre: 'cc-1' });
    const proc = rule('rule-a-proc', 'biometric', { process: 'proc-1' });
    const emp = employee('emp-1', { costCentreId: 'cc-1', processId: 'proc-1' });
    const first = previewRuleResolution([cc, proc], emp, TODAY);
    const second = previewRuleResolution([proc, cc], emp, TODAY);
    expect(first.decidingRuleId).toBe('rule-b-cc');
    expect(second.decidingRuleId).toBe('rule-b-cc');
    expect(second.otherCandidates[0].eliminatedAtStep).toBe('priority_order');
  });

  it('a rule constraining all six dimensions wins over every less specific rule that also matches', () => {
    const allSix = rule('rule-all-six', 'dialler', {
      cost_centre: 'cc-1',
      process: 'proc-1',
      branch: 'br-1',
      department: 'dep-1',
      designation: 'desig-1',
      employment_profile: 'VOICE',
    });
    const emp = employee('emp-1', {
      costCentreId: 'cc-1',
      processId: 'proc-1',
      branchId: 'br-1',
      departmentId: 'dep-1',
      designationId: 'desig-1',
      employmentProfile: 'VOICE',
    });
    const preview = previewRuleResolution([SYSTEM_DEFAULT, ccRule, allSix], emp, TODAY);
    expect(preview.decidingRuleId).toBe('rule-all-six');
    expect(preview.selectedRule?.specificityCount).toBe(6);
  });
});

// ── criterion 12.3: submission impact ─────────────────────────────────────────────────────────

describe('analyseSubmissionImpact (criterion 12.3)', () => {
  const employees = [
    employee('emp-1', { costCentreId: 'cc-1', processId: 'proc-1', branchId: 'br-1' }),
    employee('emp-2', { costCentreId: 'cc-1', processId: 'proc-2', branchId: 'br-1' }),
    employee('emp-3', { costCentreId: 'cc-2', processId: 'proc-1', branchId: 'br-2' }),
  ];

  it('counts the matched population and the subset whose resolved source would change', () => {
    // emp-1 and emp-2 sit in cc-1. The store resolves both to biometric through the
    // System_Default_Rule, so a dialler rule on cc-1 matches 2 and changes 2.
    const impact = analyseSubmissionImpact({
      proposedRule: rule('rule-new', 'dialler', { cost_centre: 'cc-1' }),
      existingRules: [SYSTEM_DEFAULT],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(impact.matchedEmployeeIds).toEqual(['emp-1', 'emp-2']);
    expect(impact.matchedEmployeeCount).toBe(2);
    expect(impact.changedEmployeeCount).toBe(2);
    expect(impact.changes[0]).toEqual({
      employeeId: 'emp-1',
      fromAttendanceSource: 'biometric',
      fromDecidingRuleId: 'rule-system-default',
      toAttendanceSource: 'dialler',
      toDecidingRuleId: 'rule-new',
    });
    expect(impact.proposedSpecificityCount).toBe(1);
    expect(impact.proposedRuleLiveOnEvaluationDate).toBe(true);
    expect(impact.evaluatedOn).toBe(TODAY);
  });

  it('matches without changing anybody when the proposed rule agrees with the current outcome', () => {
    const impact = analyseSubmissionImpact({
      proposedRule: rule('rule-new', 'biometric', { cost_centre: 'cc-1' }),
      existingRules: [SYSTEM_DEFAULT],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(impact.matchedEmployeeCount).toBe(2);
    expect(impact.changedEmployeeCount).toBe(0);
    expect(impact.changes).toEqual([]);
  });

  it('changes only the employees the proposed rule actually outranks', () => {
    // A more specific existing rule already puts emp-1 on dialler; the new cost-centre rule wins
    // over the System_Default_Rule but loses to the two-dimension rule.
    const existing = [
      SYSTEM_DEFAULT,
      rule('rule-specific', 'dialler', { cost_centre: 'cc-1', process: 'proc-1' }),
    ];
    const impact = analyseSubmissionImpact({
      proposedRule: rule('rule-new', 'dialler', { cost_centre: 'cc-1' }),
      existingRules: existing,
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(impact.matchedEmployeeCount).toBe(2);
    expect(impact.changes.map((c) => c.employeeId)).toEqual(['emp-2']);
  });

  it('a rule constraining no dimension matches everyone', () => {
    const impact = analyseSubmissionImpact({
      proposedRule: rule('rule-second-default', 'dialler'),
      existingRules: [SYSTEM_DEFAULT],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(impact.matchedEmployeeCount).toBe(3);
    expect(impact.proposedSpecificityCount).toBe(0);
    // Criterion 1.13 forbids SAVING this rule; the impact preview still has to answer honestly
    // what it would do, which is exactly the disagreement production carries today between
    // arc-global-001 (biometric) and arc-apr-ops-exec (dialler).
    expect(impact.changedEmployeeCount).toBe(3);
  });

  it('reports zero and says why when the proposed rule is future-dated or submitted inactive', () => {
    const future = analyseSubmissionImpact({
      proposedRule: rule('rule-new', 'dialler', { cost_centre: 'cc-1' }, { effectiveFrom: '2027-01-01' }),
      existingRules: [SYSTEM_DEFAULT],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(future.proposedRuleLiveOnEvaluationDate).toBe(false);
    expect(future.matchedEmployeeCount).toBe(0);
    expect(future.changedEmployeeCount).toBe(0);

    const inactive = analyseSubmissionImpact({
      proposedRule: rule('rule-new', 'dialler', { cost_centre: 'cc-1' }, { active: false }),
      existingRules: [SYSTEM_DEFAULT],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(inactive.proposedRuleLiveOnEvaluationDate).toBe(false);
    expect(inactive.matchedEmployeeCount).toBe(0);
  });

  it('counts a move from unresolved to resolved as a change rather than hiding a broken store', () => {
    const impact = analyseSubmissionImpact({
      proposedRule: rule('rule-new', 'dialler', { cost_centre: 'cc-1' }),
      existingRules: [], // no System_Default_Rule at all: criteria 1.10/1.11 violated
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(impact.changedEmployeeCount).toBe(2);
    expect(impact.changes[0].fromAttendanceSource).toBeNull();
    expect(impact.changes[0].fromDecidingRuleId).toBeNull();
  });

  it('returns zeroes on an empty employee population instead of failing', () => {
    const impact = analyseSubmissionImpact({
      proposedRule: rule('rule-new', 'dialler', { cost_centre: 'cc-1' }),
      existingRules: [SYSTEM_DEFAULT],
      activeEmployees: [],
      evaluationDate: TODAY,
    });
    expect(impact.matchedEmployeeCount).toBe(0);
    expect(impact.changedEmployeeCount).toBe(0);
    expect(impact.proposedRuleLiveOnEvaluationDate).toBe(true);
  });
});

// ── criterion 12.5: deactivation impact ───────────────────────────────────────────────────────

describe('analyseDeactivationImpact (criterion 12.5)', () => {
  const employees = [
    employee('emp-1', { costCentreId: 'cc-1', processId: 'proc-1' }),
    employee('emp-2', { costCentreId: 'cc-1', processId: 'proc-2' }),
    employee('emp-3', { costCentreId: 'cc-2', processId: 'proc-1' }),
  ];
  const ccDialler = rule('rule-cc-dialler', 'dialler', { cost_centre: 'cc-1' });

  it('counts the employees whose resolved source would change and demands confirmation', () => {
    const impact = analyseDeactivationImpact({
      ruleId: 'rule-cc-dialler',
      existingRules: [SYSTEM_DEFAULT, ccDialler],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(impact.confirmationRequired).toBe(true);
    expect(impact.currentlyDecidedEmployeeCount).toBe(2);
    expect(impact.changedEmployeeCount).toBe(2);
    expect(impact.changes.map((c) => c.employeeId)).toEqual(['emp-1', 'emp-2']);
    expect(impact.changes[0]).toEqual({
      employeeId: 'emp-1',
      fromAttendanceSource: 'dialler',
      fromDecidingRuleId: 'rule-cc-dialler',
      toAttendanceSource: 'biometric',
      toDecidingRuleId: 'rule-system-default',
    });
    expect(impact.refusal).toBeNull();
  });

  it('still requires confirmation when the deactivation moves nobody', () => {
    const impact = analyseDeactivationImpact({
      ruleId: 'rule-cc-biometric',
      existingRules: [SYSTEM_DEFAULT, rule('rule-cc-biometric', 'biometric', { cost_centre: 'cc-1' })],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(impact.currentlyDecidedEmployeeCount).toBe(2);
    expect(impact.changedEmployeeCount).toBe(0);
    expect(impact.confirmationRequired).toBe(true);
  });

  it('refuses to preview deactivating the System_Default_Rule (criteria 1.10, 1.11)', () => {
    const impact = analyseDeactivationImpact({
      ruleId: 'rule-system-default',
      existingRules: [SYSTEM_DEFAULT, ccDialler],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(impact.refusal?.code).toBe('system_default_rule_mandatory');
    expect(impact.refusal?.criteria).toContain('1.11');
    expect(impact.confirmationRequired).toBe(false);
    expect(impact.changedEmployeeCount).toBe(0);
  });

  it('refuses an unknown rule id and an already-inactive rule', () => {
    expect(
      analyseDeactivationImpact({
        ruleId: 'rule-absent',
        existingRules: [SYSTEM_DEFAULT],
        activeEmployees: employees,
        evaluationDate: TODAY,
      }).refusal?.code,
    ).toBe('rule_not_found');
    expect(
      analyseDeactivationImpact({
        ruleId: 'rule-off',
        existingRules: [SYSTEM_DEFAULT, rule('rule-off', 'dialler', { cost_centre: 'cc-1' }, { active: false })],
        activeEmployees: employees,
        evaluationDate: TODAY,
      }).refusal?.code,
    ).toBe('rule_already_inactive');
  });

  it('falls back to the next rule in the window rather than to the default when one exists', () => {
    const employeesOne = [employee('emp-1', { costCentreId: 'cc-1', processId: 'proc-1' })];
    const impact = analyseDeactivationImpact({
      ruleId: 'rule-cc',
      existingRules: [
        SYSTEM_DEFAULT,
        rule('rule-cc', 'dialler', { cost_centre: 'cc-1' }),
        rule('rule-proc', 'biometric', { process: 'proc-1' }),
      ],
      activeEmployees: employeesOne,
      evaluationDate: TODAY,
    });
    expect(impact.changes[0].toDecidingRuleId).toBe('rule-proc');
    expect(impact.changes[0].toAttendanceSource).toBe('biometric');
  });

  it('handles an empty employee population', () => {
    const impact = analyseDeactivationImpact({
      ruleId: 'rule-cc-dialler',
      existingRules: [SYSTEM_DEFAULT, ccDialler],
      activeEmployees: [],
      evaluationDate: TODAY,
    });
    expect(impact.changedEmployeeCount).toBe(0);
    expect(impact.currentlyDecidedEmployeeCount).toBe(0);
    expect(impact.confirmationRequired).toBe(true);
  });
});

// ── criteria 12.9 / 12.10: the decision-A1 contradiction warning ──────────────────────────────

describe('analyseCostCentreProcessContradiction (criteria 12.9, 12.10, decision A1)', () => {
  // THE EXACT A1 HAZARD. cost_centre_master carries process_id, so cc-1 already implies proc-1:
  // every employee in cc-1 below also carries proc-1. A cost-centre-scoped dialler rule and a
  // process-scoped biometric rule therefore contradict each other over the same people, and the
  // cost-centre rule wins the Dimension_Priority_Order tie-break silently.
  const employees = [
    employee('emp-1', { costCentreId: 'cc-1', processId: 'proc-1', branchId: 'br-1' }),
    employee('emp-2', { costCentreId: 'cc-1', processId: 'proc-1', branchId: 'br-2' }),
    employee('emp-3', { costCentreId: 'cc-2', processId: 'proc-1', branchId: 'br-1' }),
    employee('emp-4', { costCentreId: 'cc-1', processId: 'proc-9', branchId: 'br-1' }),
  ];
  const processBiometric = rule('rule-proc-1', 'biometric', { process: 'proc-1' });
  const proposed = rule('rule-new-cc', 'dialler', { cost_centre: 'cc-1' });

  it('names the differing process-scoped rule, counts the intersecting population and demands confirmation', () => {
    const result = analyseCostCentreProcessContradiction({
      proposedRule: proposed,
      existingRules: [SYSTEM_DEFAULT, processBiometric],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(result.applicable).toBe(true);
    expect(result.submittedMatchedEmployeeCount).toBe(3); // emp-1, emp-2, emp-4
    expect(result.intersectingProcessScopedRules).toHaveLength(1);
    expect(result.intersectingProcessScopedRules[0].attendanceSourceDiffers).toBe(true);
    expect(result.intersectingProcessScopedRules[0].intersectingEmployeeIds).toEqual(['emp-1', 'emp-2']);
    expect(result.differingRuleIds).toEqual(['rule-proc-1']);
    expect(result.intersectingEmployeeCount).toBe(2);
    expect(result.confirmationRequired).toBe(true);
    expect(result.warning).toContain('rule-proc-1');
    expect(result.warning).toContain('2 active employees');
  });

  it('states for each intersecting rule whether its source differs, and warns only about the differing ones', () => {
    const agreeing = rule('rule-proc-9', 'dialler', { process: 'proc-9' });
    const result = analyseCostCentreProcessContradiction({
      proposedRule: proposed,
      existingRules: [SYSTEM_DEFAULT, processBiometric, agreeing],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(
      result.intersectingProcessScopedRules.map((r) => [r.rule.id, r.attendanceSourceDiffers]),
    ).toEqual([
      ['rule-proc-1', true],
      ['rule-proc-9', false],
    ]);
    expect(result.differingRuleIds).toEqual(['rule-proc-1']);
    expect(result.warning).not.toContain('rule-proc-9');
  });

  it('counts an employee caught by two differing rules once (criterion 12.10)', () => {
    const alsoDiffering = rule('rule-proc-1-dup', 'biometric', { process: ['proc-1', 'proc-9'] });
    const result = analyseCostCentreProcessContradiction({
      proposedRule: proposed,
      existingRules: [processBiometric, alsoDiffering],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(result.differingRuleIds).toEqual(['rule-proc-1', 'rule-proc-1-dup']);
    // rule-proc-1 shares emp-1, emp-2; rule-proc-1-dup shares emp-1, emp-2, emp-4. Union is 3.
    expect(result.intersectingEmployeeCount).toBe(3);
    expect(result.intersectingEmployeeIds).toEqual(['emp-1', 'emp-2', 'emp-4']);
  });

  it('does not fire for a rule that does not constrain cost centre', () => {
    const result = analyseCostCentreProcessContradiction({
      proposedRule: rule('rule-new-branch', 'dialler', { branch: 'br-1' }),
      existingRules: [processBiometric],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(result.applicable).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.confirmationRequired).toBe(false);
  });

  it('finds an overlap the dimension values alone would have missed', () => {
    // A cost-centre-scoped rule on cc-3 and a process-scoped rule on proc-7. Nothing in the two
    // rules' dimension values relates them, and cost_centre_master would say cc-3 implies proc-1.
    // The people say otherwise: emp-5 sits in cc-3 and carries proc-7.
    const drifted = [
      employee('emp-5', { costCentreId: 'cc-3', processId: 'proc-7' }),
      employee('emp-6', { costCentreId: 'cc-3', processId: 'proc-1' }),
    ];
    const result = analyseCostCentreProcessContradiction({
      proposedRule: rule('rule-cc-3', 'dialler', { cost_centre: 'cc-3' }),
      existingRules: [rule('rule-proc-7', 'biometric', { process: 'proc-7' })],
      activeEmployees: drifted,
      evaluationDate: TODAY,
    });
    expect(result.intersectingEmployeeIds).toEqual(['emp-5']);
    expect(result.confirmationRequired).toBe(true);
  });

  it('does not warn when the populations do not intersect', () => {
    const result = analyseCostCentreProcessContradiction({
      proposedRule: rule('rule-cc-2', 'dialler', { cost_centre: 'cc-2' }),
      existingRules: [rule('rule-proc-9', 'biometric', { process: 'proc-9' })],
      activeEmployees: employees, // emp-3 is the only cc-2 employee and carries proc-1
      evaluationDate: TODAY,
    });
    expect(result.applicable).toBe(true);
    expect(result.intersectingProcessScopedRules).toEqual([]);
    expect(result.confirmationRequired).toBe(false);
    expect(result.warning).toBeNull();
  });

  it('ignores inactive process-scoped rules and the rule being amended', () => {
    const result = analyseCostCentreProcessContradiction({
      proposedRule: proposed,
      existingRules: [
        rule('rule-proc-retired', 'biometric', { process: 'proc-1' }, { active: false }),
        { ...proposed, attendanceSource: 'biometric', dimensionValues: { process: new Set(['proc-1']) } },
      ],
      activeEmployees: employees,
      evaluationDate: TODAY,
    });
    expect(result.intersectingProcessScopedRules).toEqual([]);
    expect(result.confirmationRequired).toBe(false);
  });

  it('reports not-applicable on an empty employee population', () => {
    const result = analyseCostCentreProcessContradiction({
      proposedRule: proposed,
      existingRules: [processBiometric],
      activeEmployees: [],
      evaluationDate: TODAY,
    });
    expect(result.applicable).toBe(false);
    expect(result.intersectingEmployeeCount).toBe(0);
    expect(result.confirmationRequired).toBe(false);
  });
});

// ── criterion 12.7: the threshold configuration validator ─────────────────────────────────────

describe('validateThresholdConfiguration (criterion 12.7)', () => {
  const valid = {
    dimensionValues: { branch: ['br-1'], process: ['proc-1'] },
    aprCorroborationThresholdMinutes: 480,
    varianceToleranceMinutes: 60,
    floorAbsencePatternCeilingMinutes: 60,
    repeatThresholdCount: 3,
    rollingWindowDays: 30,
    dayThresholds: { fullDayMinutes: 540, halfDayMinutes: 270, graceMinutes: 15 },
    dualReviewCeilingsByBranch: [{ branchId: 'br-1', ceiling: 100 }],
  };

  it('accepts the seeded production values (480 / 60 / 60, 3-in-30, 540 / 270 / 15, ceiling 100)', () => {
    const result = validateThresholdConfiguration(valid);
    expect(result.violations).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.unconfiguredFields).toEqual([]);
  });

  it('treats an omitted value as unconfigured rather than invalid', () => {
    const result = validateThresholdConfiguration({});
    expect(result.valid).toBe(true);
    expect(result.unconfiguredFields).toEqual([
      'aprCorroborationThresholdMinutes',
      'varianceToleranceMinutes',
      'floorAbsencePatternCeilingMinutes',
      'repeatThresholdCount',
      'rollingWindowDays',
      'dayThresholds',
      'dualReviewCeilingsByBranch',
    ]);
  });

  it('rejects negatives and non-integers on every minute and count value', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validateThresholdConfiguration({
        ...valid,
        aprCorroborationThresholdMinutes: bad,
        varianceToleranceMinutes: bad,
        repeatThresholdCount: bad,
        rollingWindowDays: bad,
        dayThresholds: { fullDayMinutes: bad, halfDayMinutes: bad, graceMinutes: bad },
        dualReviewCeilingsByBranch: [{ branchId: 'br-1', ceiling: bad }],
      });
      expect(result.valid).toBe(false);
      const codes = new Set(result.violations.map((v) => v.code));
      expect(codes.has(bad === -1 ? 'negative' : 'not_an_integer')).toBe(true);
      expect(result.violations).toHaveLength(8);
    }
  });

  it('rejects zero where zero would silently hand the value back to the default', () => {
    const result = validateThresholdConfiguration({ ...valid, varianceToleranceMinutes: 0 });
    expect(result.violations.map((v) => [v.field, v.code])).toEqual([
      ['varianceToleranceMinutes', 'not_positive'],
    ]);
  });

  it('accepts zero for grace_minutes and for a Dual_Review_Ceiling, which are real configurations', () => {
    const result = validateThresholdConfiguration({
      ...valid,
      dayThresholds: { fullDayMinutes: 540, halfDayMinutes: 270, graceMinutes: 0 },
      dualReviewCeilingsByBranch: [{ branchId: 'br-1', ceiling: 0 }],
    });
    expect(result.valid).toBe(true);
  });

  it('bounds every minute value by the calendar day and the window by a year', () => {
    const overDay = validateThresholdConfiguration({
      ...valid,
      aprCorroborationThresholdMinutes: MINUTES_IN_A_CALENDAR_DAY + 1,
    });
    expect(overDay.violations.map((v) => v.code)).toEqual(['exceeds_calendar_day']);
    const overWindow = validateThresholdConfiguration({
      ...valid,
      rollingWindowDays: MAX_ROLLING_WINDOW_DAYS + 1,
    });
    expect(overWindow.violations.map((v) => v.code)).toEqual(['exceeds_max_rolling_window']);
  });

  it('enforces half_day_minutes <= full_day_minutes', () => {
    const result = validateThresholdConfiguration({
      ...valid,
      dayThresholds: { fullDayMinutes: 270, halfDayMinutes: 540, graceMinutes: 15 },
    });
    expect(result.violations.map((v) => v.code)).toEqual(['half_day_exceeds_full_day']);
    // Equal is permitted: a policy may set the two thresholds to the same minute count.
    expect(
      validateThresholdConfiguration({
        ...valid,
        dayThresholds: { fullDayMinutes: 540, halfDayMinutes: 540, graceMinutes: 15 },
      }).valid,
    ).toBe(true);
  });

  it('enforces grace_minutes <= full_day_minutes', () => {
    const result = validateThresholdConfiguration({
      ...valid,
      dayThresholds: { fullDayMinutes: 540, halfDayMinutes: 270, graceMinutes: 600 },
    });
    expect(result.violations.map((v) => v.code)).toEqual(['grace_exceeds_full_day']);
  });

  it('enforces Floor_Absence_Pattern_Ceiling <= APR_Corroboration_Threshold', () => {
    const result = validateThresholdConfiguration({
      ...valid,
      aprCorroborationThresholdMinutes: 480,
      floorAbsencePatternCeilingMinutes: 481,
    });
    expect(result.violations.map((v) => v.code)).toEqual([
      'floor_ceiling_exceeds_corroboration_threshold',
    ]);
  });

  it('enforces repeat threshold <= rolling window, since at most one occurrence is counted per date', () => {
    const result = validateThresholdConfiguration({ ...valid, repeatThresholdCount: 31, rollingWindowDays: 30 });
    expect(result.violations.map((v) => v.code)).toEqual([
      'repeat_threshold_exceeds_rolling_window',
    ]);
  });

  it('rejects an empty or blank Rule_Dimension value set', () => {
    const empty = validateThresholdConfiguration({ ...valid, dimensionValues: { branch: [] } });
    expect(empty.violations.map((v) => [v.field, v.code])).toEqual([
      ['dimensionValues.branch', 'empty_dimension_value_set'],
    ]);
    const blank = validateThresholdConfiguration({ ...valid, dimensionValues: { branch: ['br-1', '  '] } });
    expect(blank.violations.map((v) => v.code)).toEqual(['blank_dimension_value']);
  });

  it('validates the Dual_Review_Ceiling per branch and rejects a duplicated or blank branch', () => {
    const duplicated = validateThresholdConfiguration({
      ...valid,
      dualReviewCeilingsByBranch: [
        { branchId: 'br-1', ceiling: 100 },
        { branchId: 'br-1', ceiling: 50 },
      ],
    });
    expect(duplicated.violations.map((v) => v.code)).toEqual(['duplicate_branch_ceiling']);
    const blank = validateThresholdConfiguration({
      ...valid,
      dualReviewCeilingsByBranch: [{ branchId: '', ceiling: 100 }],
    });
    expect(blank.violations.map((v) => v.code)).toEqual(['blank_branch_id']);
  });

  it('names the criteria each violation enforces, so an audit row can cite them', () => {
    const result = validateThresholdConfiguration({ ...valid, repeatThresholdCount: -3 });
    expect(result.violations[0].criteria).toEqual(['10.7', '10.8', '12.7']);
  });
});

// ── Generators ────────────────────────────────────────────────────────────────────────────────
//
// Constrained to the shape of the measured population rather than to arbitrary strings: a handful
// of identifiers per dimension, so generated rules and generated employees actually collide often
// enough for the properties to be non-vacuous. A6/A7's NULLs are generated too (17.5% of
// profile_type is NULL, 6.7% of process_id), because criterion 2.8's treatment of a missing value
// is where an impact count would otherwise be quietly wrong.

const DIMENSION_VALUES: Record<RuleDimension, string[]> = {
  cost_centre: ['cc-1', 'cc-2', 'cc-3'],
  process: ['proc-1', 'proc-2'],
  branch: ['br-1', 'br-2'],
  department: ['dep-1', 'dep-2'],
  designation: ['desig-1', 'desig-2'],
  employment_profile: ['VOICE', 'NON-VOICE'],
};

const attributeArb = (dimension: RuleDimension) =>
  fc.option(fc.constantFrom(...DIMENSION_VALUES[dimension]), { nil: null, freq: 6 });

const employeeArb: fc.Arbitrary<ActiveEmployee> = fc
  .tuple(
    fc.integer({ min: 1, max: 40 }),
    attributeArb('cost_centre'),
    attributeArb('process'),
    attributeArb('branch'),
    attributeArb('department'),
    attributeArb('designation'),
    attributeArb('employment_profile'),
  )
  .map(([n, costCentreId, processId, branchId, departmentId, designationId, employmentProfile]) => ({
    employeeId: `emp-${String(n).padStart(2, '0')}`,
    attributes: { costCentreId, processId, branchId, departmentId, designationId, employmentProfile },
  }));

const populationArb = fc
  .array(employeeArb, { minLength: 0, maxLength: 12 })
  // Employee ids must be unique: a population holding the same person twice is not a population.
  .map((employees) => {
    const seen = new Set<string>();
    return employees.filter((e) => (seen.has(e.employeeId) ? false : (seen.add(e.employeeId), true)));
  });

const dimensionValuesArb: fc.Arbitrary<Partial<Record<RuleDimension, Set<string>>>> = fc
  .tuple(
    ...DIMENSION_PRIORITY_ORDER.map((dimension) =>
      fc.option(
        fc
          .uniqueArray(fc.constantFrom(...DIMENSION_VALUES[dimension]), { minLength: 1, maxLength: 2 })
          .map((values) => new Set(values)),
        { nil: undefined, freq: 3 },
      ),
    ),
  )
  .map((sets) => {
    const dimensionValues: Partial<Record<RuleDimension, Set<string>>> = {};
    DIMENSION_PRIORITY_ORDER.forEach((dimension, index) => {
      const set = sets[index];
      if (set !== undefined) dimensionValues[dimension] = set;
    });
    return dimensionValues;
  });

const EFFECTIVE_FROMS = ['2026-01-01', '2026-06-01', '2026-07-01', '2026-09-15'];
const EFFECTIVE_TOS = [null, '2026-06-30', '2026-09-15', '2026-12-31'];

const ruleArb = (idPrefix: string): fc.Arbitrary<AdminRule> =>
  fc
    .tuple(
      fc.integer({ min: 1, max: 99 }),
      fc.constantFrom<AttendanceSource>('dialler', 'biometric'),
      dimensionValuesArb,
      fc.constantFrom(...EFFECTIVE_FROMS),
      fc.constantFrom(...EFFECTIVE_TOS),
      fc.boolean(),
    )
    .map(([n, attendanceSource, dimensionValues, effectiveFrom, effectiveTo, active]) => ({
      id: `${idPrefix}-${String(n).padStart(2, '0')}`,
      attendanceSource,
      dimensionValues,
      effectiveFrom,
      // Keep the window well-formed (criterion 1.7 rejects the inverted case at write time).
      effectiveTo: effectiveTo !== null && effectiveTo < effectiveFrom ? null : effectiveTo,
      active,
      createdAt: `${effectiveFrom}T00:00:00.000Z`,
    }));

const storeArb = fc
  .array(ruleArb('rule'), { minLength: 0, maxLength: 6 })
  .map((rules) => {
    const seen = new Set<string>();
    const unique = rules.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    // Criterion 1.10: exactly one System_Default_Rule always exists, so every generated store
    // carries it. Without it the properties would be dominated by unresolvable stores.
    return [SYSTEM_DEFAULT, ...unique];
  });

// ── Property 1: population intersection is symmetric ──────────────────────────────────────────

describe('Requirement 12 — Property: population intersection is symmetric (criterion 12.9)', () => {
  it('for any two rules and any population, each rule sees the same shared people as the other', () => {
    // Feature: payroll-attendance-source-rules, Requirement 12 acceptance criterion 12.9 —
    // "whose matched active-employee population intersects the submitted rule's matched
    // active-employee population". "Intersects" is a symmetric relation; if it were not, whether
    // the warning fired would depend on which rule the screen happened to call the submitted one.
    fc.assert(
      fc.property(ruleArb('left'), ruleArb('right'), populationArb, (left, right, employees) => {
        const leftPopulation = matchedPopulation(left, employees, TODAY);
        const rightPopulation = matchedPopulation(right, employees, TODAY);
        const forward = intersectPopulations(leftPopulation, rightPopulation);
        const backward = intersectPopulations(rightPopulation, leftPopulation);
        expect(forward).toEqual(backward);
        // And the intersection is a subset of both, never an invention.
        for (const id of forward) {
          expect(leftPopulation).toContain(id);
          expect(rightPopulation).toContain(id);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('a rule intersected with itself is exactly its own population, and both directions agree on emptiness', () => {
    fc.assert(
      fc.property(ruleArb('self'), populationArb, (r, employees) => {
        const population = matchedPopulation(r, employees, TODAY);
        expect(intersectPopulations(population, population)).toEqual(population);
      }),
      { numRuns: 200 },
    );
  });
});

// ── Property 2: a rule that matches nobody changes nobody ─────────────────────────────────────

describe('Requirement 12 — Property: a rule matching nobody changes nobody (criteria 12.3, 12.5)', () => {
  it('an empty matched population forces a zero change count on submission', () => {
    // Feature: payroll-attendance-source-rules, Requirement 12 acceptance criterion 12.3. The
    // impact preview must never claim a rule moves people it does not match — that is the count a
    // Rule_Administrator decides on, and an over-count here is the 445-employee mistake again.
    fc.assert(
      fc.property(
        ruleArb('proposed'),
        storeArb,
        populationArb,
        (proposedRule, existingRules, activeEmployees) => {
          const impact = analyseSubmissionImpact({
            proposedRule,
            existingRules,
            activeEmployees,
            evaluationDate: TODAY,
          });
          if (impact.matchedEmployeeCount === 0) {
            expect(impact.changedEmployeeCount).toBe(0);
            expect(impact.changes).toEqual([]);
          }
          // Stated the other way round: every changed employee is a matched employee.
          for (const change of impact.changes) {
            expect(impact.matchedEmployeeIds).toContain(change.employeeId);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('an empty population makes every count zero, for a submission and for a deactivation', () => {
    fc.assert(
      fc.property(ruleArb('proposed'), storeArb, (proposedRule, existingRules) => {
        const submission = analyseSubmissionImpact({
          proposedRule,
          existingRules,
          activeEmployees: [],
          evaluationDate: TODAY,
        });
        expect(submission.matchedEmployeeCount).toBe(0);
        expect(submission.changedEmployeeCount).toBe(0);

        const target = existingRules.find((r) => computeSpecificityCount(r) > 0 && r.active);
        if (target !== undefined) {
          const deactivation = analyseDeactivationImpact({
            ruleId: target.id,
            existingRules,
            activeEmployees: [],
            evaluationDate: TODAY,
          });
          expect(deactivation.changedEmployeeCount).toBe(0);
          expect(deactivation.currentlyDecidedEmployeeCount).toBe(0);
          expect(deactivation.confirmationRequired).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ── Property 3: would-change never exceeds would-match ────────────────────────────────────────

describe('Requirement 12 — Property: the change count never exceeds the match count (criterion 12.3)', () => {
  it('for any proposed rule, any store and any population, changed <= matched <= population', () => {
    // Feature: payroll-attendance-source-rules, Requirement 12 acceptance criterion 12.3 — the
    // screen displays "the count of currently active employees the rule would match and the count
    // whose resolved Attendance_Source the rule would change". The second is a subset of the
    // first by construction; if it ever were not, one of the two counts would be measuring
    // something else.
    fc.assert(
      fc.property(
        ruleArb('proposed'),
        storeArb,
        populationArb,
        (proposedRule, existingRules, activeEmployees) => {
          const impact = analyseSubmissionImpact({
            proposedRule,
            existingRules,
            activeEmployees,
            evaluationDate: TODAY,
          });
          expect(impact.changedEmployeeCount).toBeLessThanOrEqual(impact.matchedEmployeeCount);
          expect(impact.matchedEmployeeCount).toBeLessThanOrEqual(activeEmployees.length);
          expect(impact.changes).toHaveLength(impact.changedEmployeeCount);
          expect(impact.matchedEmployeeIds).toHaveLength(impact.matchedEmployeeCount);

          // Every reported change is a genuine change: resolving the employee against the store
          // with the rule inserted really does return the reported source.
          const after = activeRulesInWindow([...existingRules, proposedRule], TODAY);
          for (const change of impact.changes) {
            const emp = activeEmployees.find((e) => e.employeeId === change.employeeId);
            expect(emp).toBeDefined();
            const preview = previewRuleResolution(after, emp as ActiveEmployee, TODAY);
            expect(preview.resolvedAttendanceSource).toBe(change.toAttendanceSource);
            expect(change.fromAttendanceSource).not.toBe(change.toAttendanceSource);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('for any deactivation, changed <= currently decided <= population', () => {
    // Feature: payroll-attendance-source-rules, Requirement 12 acceptance criterion 12.5.
    fc.assert(
      fc.property(storeArb, populationArb, (existingRules, activeEmployees) => {
        for (const target of existingRules) {
          const impact = analyseDeactivationImpact({
            ruleId: target.id,
            existingRules,
            activeEmployees,
            evaluationDate: TODAY,
          });
          expect(impact.changedEmployeeCount).toBeLessThanOrEqual(
            impact.currentlyDecidedEmployeeCount,
          );
          expect(impact.currentlyDecidedEmployeeCount).toBeLessThanOrEqual(activeEmployees.length);
          // A refused preview reports nothing and demands no confirmation; an allowed one always
          // demands confirmation (criterion 12.5).
          expect(impact.confirmationRequired).toBe(impact.refusal === null);
        }
      }),
      { numRuns: 250 },
    );
  });
});

// ── Property 4: Specificity_Count is monotonic in the constrained dimensions ──────────────────

describe('Requirement 12 — Property: Specificity_Count is monotonic in the constrained dimensions (criterion 12.1)', () => {
  it('constraining one more dimension raises the count by exactly one, and never lowers it', () => {
    // Feature: payroll-attendance-source-rules, Requirement 12 acceptance criterion 12.1 with the
    // Specificity_Count definition in the glossary ("the number of Rule_Dimensions an
    // Attendance_Source_Rule constrains"). The count the screen displays is the count the
    // resolver breaks ties on (criterion 2.3), so a non-monotonic count would make a more tightly
    // scoped rule appear to lose to a broader one.
    fc.assert(
      fc.property(dimensionValuesArb, fc.constantFrom(...DIMENSION_PRIORITY_ORDER), (base, extra) => {
        const baseRule = { ...SYSTEM_DEFAULT, id: 'rule-base', dimensionValues: base };
        const baseCount = computeSpecificityCount(baseRule);
        expect(baseCount).toBe(
          DIMENSION_PRIORITY_ORDER.filter((d) => base[d] !== undefined && base[d].size > 0).length,
        );
        expect(baseCount).toBeGreaterThanOrEqual(0);
        expect(baseCount).toBeLessThanOrEqual(DIMENSION_PRIORITY_ORDER.length);

        const widened = {
          ...baseRule,
          id: 'rule-widened',
          dimensionValues: { ...base, [extra]: new Set([DIMENSION_VALUES[extra][0]]) },
        };
        const widenedCount = computeSpecificityCount(widened);
        expect(widenedCount).toBeGreaterThanOrEqual(baseCount);
        // Exactly one more when `extra` was previously unconstrained; unchanged when it was not.
        const wasConstrained = base[extra] !== undefined && base[extra].size > 0;
        expect(widenedCount).toBe(wasConstrained ? baseCount : baseCount + 1);

        // Removing a constraint is the mirror image: never raises the count.
        const narrowed = { ...baseRule, id: 'rule-narrowed', dimensionValues: { ...base, [extra]: undefined } };
        expect(computeSpecificityCount(narrowed)).toBeLessThanOrEqual(baseCount);

        // And the displayed row agrees with the computed count, always.
        expect(describeRule(widened).specificityCount).toBe(widenedCount);
      }),
      { numRuns: 400 },
    );
  });
});

// ── Property 5: the preview is total and self-consistent ──────────────────────────────────────

describe('Requirement 12 — Property: the resolution preview accounts for every rule exactly once (criteria 12.4, 2.9)', () => {
  it('the selected rule plus the other candidates is the whole store, and only the winner has a null step', () => {
    // Feature: payroll-attendance-source-rules, Requirement 12 acceptance criterion 12.4 /
    // Requirement 2 acceptance criterion 2.9 — the preview returns "the selected rule, every other
    // candidate rule, and the comparison step at which each rejected candidate was eliminated".
    // A rule missing from the preview is a rule an administrator cannot ask about.
    fc.assert(
      fc.property(storeArb, employeeArb, (rules, emp) => {
        const preview = previewRuleResolution(rules, emp, TODAY);
        const listedIds = preview.otherCandidates.map((c) => c.rule.id);
        const expectedIds = rules.map((r) => r.id).filter((id) => id !== preview.decidingRuleId);
        expect([...listedIds].sort()).toEqual([...expectedIds].sort());
        for (const candidate of preview.otherCandidates) {
          expect(candidate.eliminatedAtStep).not.toBeNull();
        }
        // The System_Default_Rule guarantees a result (criterion 2.6).
        expect(preview.resolvedAttendanceSource).not.toBeNull();
        expect(preview.selectedRule?.id).toBe(preview.decidingRuleId);
        // Determinism (criterion 2.7): the same store and employee, resolved again.
        expect(previewRuleResolution(rules, emp, TODAY)).toEqual(preview);
        // And input order cannot move the winner.
        expect(previewRuleResolution([...rules].reverse(), emp, TODAY).decidingRuleId).toBe(
          preview.decidingRuleId,
        );
      }),
      { numRuns: 400 },
    );
  });
});
