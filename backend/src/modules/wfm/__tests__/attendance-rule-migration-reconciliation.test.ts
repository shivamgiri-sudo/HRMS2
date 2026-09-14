// backend/src/modules/wfm/__tests__/attendance-rule-migration-reconciliation.test.ts
//
// Requirement 15's reconciliation reports: criteria 15.9, 15.10, 15.13, 15.14 and 15.15.
//
// No mocks and no database. The reconciliation is a pure function over a proposed rule set and a
// list of employees, so every assertion here is about the REPORT a reviewer approves against
// rather than about which queries were issued. The comparison runs through the real resolver
// (attendance-source-rule-resolver.ts), which is what will resolve the rules in production, so
// these tests exercise the same matching, specificity and tie-breaking that will actually run.
//
// The production figures criterion 15.15 quotes (34 / 75 / 196 of 1,123) are deliberately NOT
// asserted anywhere: the real rows are not available here and those numbers are expected to move
// as master data is corrected. The counts and percentages are asserted on fixtures instead.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  buildAttendanceRuleMigrationReconciliation,
  NO_SILENT_CHANGE_VIOLATION,
  type BuildReconciliationInput,
  type DayThresholdValues,
  type ReconciliationEmployee,
  type ReconciliationRuleSet,
} from '../attendance-rule-migration-reconciliation.js';
import {
  buildAttendanceRuleMigrationProposal,
  type ProposedDayThresholdRule,
  type ProposedSourceRule,
} from '../attendance-rule-migration-proposal.js';
import type { EmployeeAttributes } from '../attendance-source-rule-resolver.js';

const AS_OF = '2026-09-15';

const DEFAULT_THRESHOLDS: DayThresholdValues = {
  fullDayMinutes: 540,
  halfDayMinutes: 270,
  graceMinutes: 15,
};

function sourceRule(over: Partial<ProposedSourceRule> = {}): ProposedSourceRule {
  return {
    proposalKey: 'src-key',
    canonicalSignature: 'src-sig',
    ruleName: 'Proposed rule',
    attendanceSource: 'biometric',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    changeReason: 'test fixture',
    isSystemDefault: 0,
    undatedSource: 0,
    ordinal: 1,
    dimensionValues: [],
    sourceRows: [],
    ...over,
  };
}

function thresholdRule(over: Partial<ProposedDayThresholdRule> = {}): ProposedDayThresholdRule {
  return {
    proposalKey: 'thr-key',
    canonicalSignature: 'thr-sig',
    ruleName: 'Proposed thresholds',
    fullDayMinutes: 540,
    halfDayMinutes: 270,
    graceMinutes: 15,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    changeReason: 'test fixture',
    isUnconstrainedDefault: 0,
    undatedSource: 0,
    ordinal: 1,
    dimensionValues: [],
    sourceRows: [],
    ...over,
  };
}

/** The mandatory System_Default_Rule of criterion 1.10 - reaches every employee. */
const SYSTEM_DEFAULT = sourceRule({
  proposalKey: 'sd-biometric',
  ruleName: 'System_Default_Rule',
  attendanceSource: 'biometric',
  isSystemDefault: 1,
  ordinal: 1,
});

/** The single unconstrained Day_Threshold_Rule of criterion 1.15. */
const THRESHOLD_DEFAULT = thresholdRule({
  proposalKey: 'thr-default',
  ruleName: 'Unconstrained_Day_Threshold_Default',
  isUnconstrainedDefault: 1,
});

function attrs(over: Partial<EmployeeAttributes> = {}): EmployeeAttributes {
  return {
    costCentreId: 'CC-1',
    processId: 'PRC-1',
    branchId: 'BR-1',
    departmentId: 'DEP-1',
    designationId: 'DSG-1',
    employmentProfile: 'ON_ROLL',
    ...over,
  };
}

function employee(
  employeeId: string,
  over: Partial<ReconciliationEmployee> = {},
): ReconciliationEmployee {
  return {
    employeeId,
    attributes: attrs(),
    existingAttendanceSource: 'biometric',
    existingThresholds: DEFAULT_THRESHOLDS,
    ...over,
  };
}

function reconcile(over: Partial<BuildReconciliationInput> = {}) {
  const proposal: ReconciliationRuleSet = {
    sourceRules: [SYSTEM_DEFAULT],
    dayThresholdRules: [THRESHOLD_DEFAULT],
  };
  return buildAttendanceRuleMigrationReconciliation({
    proposal,
    employees: [],
    effectiveDate: AS_OF,
    ...over,
  });
}

function comparisonFor(
  report: ReturnType<typeof reconcile>,
  employeeId: string,
) {
  const found = report.attendanceSource.comparisons.find((c) => c.employeeId === employeeId);
  if (!found) throw new Error(`no source comparison for ${employeeId}`);
  return found;
}

function thresholdComparisonFor(
  report: ReturnType<typeof reconcile>,
  employeeId: string,
) {
  const found = report.dayThresholds.comparisons.find((c) => c.employeeId === employeeId);
  if (!found) throw new Error(`no threshold comparison for ${employeeId}`);
  return found;
}

// -- criterion 15.10: existing versus proposed Attendance_Source ---------------------------

describe('criterion 15.10 - Attendance_Source reconciliation', () => {
  it('reports the existing and the proposed source for every employee, and lists only those that differ', () => {
    const report = reconcile({
      proposal: {
        // A dialler rule scoped to one process, plus the biometric System_Default_Rule.
        sourceRules: [
          SYSTEM_DEFAULT,
          sourceRule({
            proposalKey: 'src-dialler-prc9',
            ruleName: 'Dialler for PRC-9',
            attendanceSource: 'dialler',
            dimensionValues: [{ dimension: 'process', valueId: 'PRC-9' }],
            ordinal: 2,
          }),
        ],
        dayThresholdRules: [THRESHOLD_DEFAULT],
      },
      employees: [
        // Existing engine says biometric; the scoped dialler rule now matches -> changes.
        employee('E-CHANGES', {
          attributes: attrs({ processId: 'PRC-9' }),
          existingAttendanceSource: 'biometric',
        }),
        // Existing engine says biometric; only the default matches -> unchanged.
        employee('E-SAME', { existingAttendanceSource: 'biometric' }),
      ],
    });

    expect(report.employeeCount).toBe(2);
    expect(report.attendanceSource.comparisons).toHaveLength(2);

    const changed = comparisonFor(report, 'E-CHANGES');
    expect(changed.existingAttendanceSource).toBe('biometric');
    expect(changed.proposedAttendanceSource).toBe('dialler');
    expect(changed.proposedRuleProposalKey).toBe('src-dialler-prc9');
    expect(changed.proposedRuleName).toBe('Dialler for PRC-9');
    expect(changed.proposedRuleIsSystemDefault).toBe(false);
    expect(changed.proposedSpecificityCount).toBe(1);
    expect(changed.status).toBe('differs');

    const same = comparisonFor(report, 'E-SAME');
    expect(same.existingAttendanceSource).toBe('biometric');
    expect(same.proposedAttendanceSource).toBe('biometric');
    expect(same.proposedRuleIsSystemDefault).toBe(true);
    expect(same.proposedSpecificityCount).toBe(0);
    expect(same.status).toBe('match');

    expect(report.attendanceSource.differingEmployeeIds).toEqual(['E-CHANGES']);
    expect(report.attendanceSource.differingCount).toBe(1);
    expect(report.attendanceSource.matchedCount).toBe(1);
    expect(report.attendanceSource.unresolvedCount).toBe(0);
    expect(report.attendanceSource.existingUnknownCount).toBe(0);
  });

  it('reports an existing source it cannot read as unknown rather than guessing at a match', () => {
    const report = reconcile({
      employees: [
        employee('E-NULL', { existingAttendanceSource: null }),
        employee('E-JUNK', { existingAttendanceSource: 'apr' }),
      ],
    });

    const nullCase = comparisonFor(report, 'E-NULL');
    expect(nullCase.status).toBe('existing_unknown');
    expect(nullCase.existingAttendanceSource).toBeNull();
    expect(nullCase.proposedAttendanceSource).toBe('biometric');

    const junkCase = comparisonFor(report, 'E-JUNK');
    expect(junkCase.status).toBe('existing_unknown');
    expect(junkCase.existingAttendanceSource).toBeNull();
    // The unreadable value is retained so a reviewer can see what the caller supplied.
    expect(junkCase.existingAttendanceSourceRaw).toBe('apr');

    expect(report.attendanceSource.existingUnknownEmployeeIds).toEqual(['E-JUNK', 'E-NULL']);
    expect(report.attendanceSource.matchedCount).toBe(0);
  });

  it('excludes a proposed rule whose effective-date window does not cover the date', () => {
    const report = reconcile({
      proposal: {
        sourceRules: [
          SYSTEM_DEFAULT,
          // Superseded before the date being resolved.
          sourceRule({
            proposalKey: 'src-expired',
            attendanceSource: 'dialler',
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30',
          }),
          // Not yet in force.
          sourceRule({
            proposalKey: 'src-future',
            attendanceSource: 'dialler',
            effectiveFrom: '2027-01-01',
          }),
        ],
        dayThresholdRules: [THRESHOLD_DEFAULT],
      },
      employees: [employee('E-1')],
    });

    expect(report.windowedSourceRuleCount).toBe(1);
    expect(comparisonFor(report, 'E-1').proposedRuleProposalKey).toBe('sd-biometric');
  });
});

// -- criterion 15.9: existing versus proposed day thresholds -------------------------------

describe('criterion 15.9 - day threshold reconciliation', () => {
  it('lists every employee whose full/half/grace values move, naming the fields that differ', () => {
    const report = reconcile({
      proposal: {
        sourceRules: [SYSTEM_DEFAULT],
        dayThresholdRules: [
          THRESHOLD_DEFAULT,
          thresholdRule({
            proposalKey: 'thr-dsg7',
            ruleName: 'Thresholds for DSG-7',
            fullDayMinutes: 480,
            halfDayMinutes: 240,
            graceMinutes: 15,
            dimensionValues: [{ dimension: 'designation', valueId: 'DSG-7' }],
          }),
        ],
      },
      employees: [
        employee('E-THR-MOVES', {
          attributes: attrs({ designationId: 'DSG-7' }),
          existingThresholds: { fullDayMinutes: 540, halfDayMinutes: 270, graceMinutes: 15 },
        }),
        employee('E-THR-SAME', { existingThresholds: DEFAULT_THRESHOLDS }),
      ],
    });

    const moved = thresholdComparisonFor(report, 'E-THR-MOVES');
    expect(moved.status).toBe('differs');
    expect(moved.existingThresholds).toEqual({
      fullDayMinutes: 540,
      halfDayMinutes: 270,
      graceMinutes: 15,
    });
    expect(moved.proposedThresholds).toEqual({
      fullDayMinutes: 480,
      halfDayMinutes: 240,
      graceMinutes: 15,
    });
    // grace_minutes is unchanged, so it is not listed.
    expect(moved.differingFields).toEqual(['fullDayMinutes', 'halfDayMinutes']);
    expect(moved.proposedRuleProposalKey).toBe('thr-dsg7');
    expect(moved.proposedRuleIsUnconstrainedDefault).toBe(false);

    const same = thresholdComparisonFor(report, 'E-THR-SAME');
    expect(same.status).toBe('match');
    expect(same.differingFields).toEqual([]);
    expect(same.proposedRuleIsUnconstrainedDefault).toBe(true);

    expect(report.dayThresholds.differingEmployeeIds).toEqual(['E-THR-MOVES']);
    expect(report.dayThresholds.differingCount).toBe(1);
    expect(report.dayThresholds.matchedCount).toBe(1);
  });

  it('reports thresholds the caller could not determine as unknown, and unmatched thresholds as unresolved', () => {
    const report = reconcile({
      proposal: {
        sourceRules: [SYSTEM_DEFAULT],
        // No unconstrained default: an employee outside the scoped rule resolves to nothing.
        dayThresholdRules: [
          thresholdRule({
            proposalKey: 'thr-scoped',
            dimensionValues: [{ dimension: 'branch', valueId: 'BR-99' }],
          }),
        ],
      },
      employees: [
        employee('E-THR-UNKNOWN', {
          attributes: attrs({ branchId: 'BR-99' }),
          existingThresholds: null,
        }),
        employee('E-THR-UNRESOLVED'),
      ],
    });

    expect(thresholdComparisonFor(report, 'E-THR-UNKNOWN').status).toBe('existing_unknown');
    const unresolved = thresholdComparisonFor(report, 'E-THR-UNRESOLVED');
    expect(unresolved.status).toBe('proposed_unresolved');
    expect(unresolved.proposedThresholds).toBeNull();
    expect(unresolved.proposedSpecificityCount).toBe(-1);
    expect(report.dayThresholds.unresolvedEmployeeIds).toEqual(['E-THR-UNRESOLVED']);
  });
});

// -- criterion 15.15: employees holding no value for a Rule_Dimension ----------------------

describe('criterion 15.15 - employees with a Rule_Dimension holding no value', () => {
  it('lists the employees and the dimensions they are missing, with counts and percentages', () => {
    const report = reconcile({
      employees: [
        employee('E-NO-CC', { attributes: attrs({ costCentreId: null }) }),
        employee('E-NO-PROC-AND-PROFILE', {
          attributes: attrs({ processId: null, employmentProfile: null }),
        }),
        employee('E-COMPLETE-1'),
        employee('E-COMPLETE-2'),
      ],
    });

    expect(report.missingDimensions.activeEmployeeCount).toBe(4);
    expect(report.missingDimensions.employeeCount).toBe(2);
    expect(report.missingDimensions.employeeIds).toEqual(['E-NO-CC', 'E-NO-PROC-AND-PROFILE']);
    expect(report.missingDimensions.employees).toEqual([
      { employeeId: 'E-NO-CC', missingDimensions: ['cost_centre'] },
      { employeeId: 'E-NO-PROC-AND-PROFILE', missingDimensions: ['process', 'employment_profile'] },
    ]);

    // All six dimensions are always present, so a reviewer reads a zero rather than an absence.
    expect(report.missingDimensions.byDimension.map((d) => d.dimension)).toEqual([
      'cost_centre',
      'process',
      'branch',
      'department',
      'designation',
      'employment_profile',
    ]);
    const byDimension = new Map(
      report.missingDimensions.byDimension.map((d) => [d.dimension, d]),
    );
    expect(byDimension.get('cost_centre')).toEqual({
      dimension: 'cost_centre',
      employeeIds: ['E-NO-CC'],
      employeeCount: 1,
      percentOfEmployees: 25,
    });
    expect(byDimension.get('process')!.employeeCount).toBe(1);
    expect(byDimension.get('employment_profile')!.employeeCount).toBe(1);
    expect(byDimension.get('branch')).toEqual({
      dimension: 'branch',
      employeeIds: [],
      employeeCount: 0,
      percentOfEmployees: 0,
    });
  });

  it('does not throw for an employee matched by no rule at all, and does not treat them as unchanged', () => {
    const report = reconcile({
      proposal: {
        // A rule set with no System_Default_Rule, constraining a dimension this employee has no
        // value for. Criterion 2.8 makes them a non-candidate for it, which is exactly the
        // population criterion 15.15 exists to surface.
        sourceRules: [
          sourceRule({
            proposalKey: 'src-needs-cc',
            attendanceSource: 'dialler',
            dimensionValues: [{ dimension: 'cost_centre', valueId: 'CC-1' }],
          }),
        ],
        dayThresholdRules: [THRESHOLD_DEFAULT],
      },
      employees: [employee('E-NO-CC', { attributes: attrs({ costCentreId: null }) })],
    });

    const comparison = comparisonFor(report, 'E-NO-CC');
    expect(comparison.status).toBe('proposed_unresolved');
    expect(comparison.proposedAttendanceSource).toBeNull();
    expect(comparison.proposedSpecificityCount).toBe(-1);
    expect(comparison.missingDimensions).toEqual(['cost_centre']);

    expect(report.attendanceSource.unresolvedEmployeeIds).toEqual(['E-NO-CC']);
    expect(report.noSilentChange.unchangedEmployeeIds).toEqual([]);
    expect(report.noSilentChange.holds).toBe(false);
  });
});

// -- criterion 15.13: the no-silent-change property ---------------------------------------

describe('criterion 15.13 - no-silent-change property', () => {
  it('holds, and partitions every employee into unchanged or changed', () => {
    const report = reconcile({
      proposal: {
        sourceRules: [
          SYSTEM_DEFAULT,
          sourceRule({
            proposalKey: 'src-dialler-prc9',
            attendanceSource: 'dialler',
            dimensionValues: [{ dimension: 'process', valueId: 'PRC-9' }],
          }),
        ],
        dayThresholdRules: [THRESHOLD_DEFAULT],
      },
      employees: [
        employee('E-SAME-1'),
        employee('E-SAME-2'),
        employee('E-CHANGES', {
          attributes: attrs({ processId: 'PRC-9' }),
          existingAttendanceSource: 'biometric',
        }),
      ],
    });

    expect(report.noSilentChange.holds).toBe(true);
    expect(report.noSilentChange.violations).toEqual([]);
    expect(report.noSilentChange.unchangedEmployeeIds).toEqual(['E-SAME-1', 'E-SAME-2']);
    expect(report.noSilentChange.unchangedCount).toBe(2);
    expect(report.noSilentChange.changedEmployeeIds).toEqual(['E-CHANGES']);
    expect(report.noSilentChange.undeterminedCount).toBe(0);
    // Totality: every employee is accounted for exactly once.
    expect(report.noSilentChange.evaluatedEmployeeCount).toBe(report.employeeCount);
    expect(
      report.noSilentChange.unchangedCount +
        report.noSilentChange.changedCount +
        report.noSilentChange.undeterminedCount,
    ).toBe(report.employeeCount);
  });

  it('is violated, not assumed, when the proposed rule set reaches no rule for an employee', () => {
    const report = reconcile({
      proposal: {
        // Criterion 1.10's System_Default_Rule is missing, so the employee below is unreachable.
        sourceRules: [
          sourceRule({
            proposalKey: 'src-scoped',
            dimensionValues: [{ dimension: 'branch', valueId: 'BR-OTHER' }],
          }),
        ],
        dayThresholdRules: [THRESHOLD_DEFAULT],
      },
      employees: [employee('E-UNREACHABLE')],
    });

    expect(report.noSilentChange.holds).toBe(false);
    expect(report.noSilentChange.violations).toHaveLength(1);
    expect(report.noSilentChange.violations[0]!.kind).toBe(
      NO_SILENT_CHANGE_VIOLATION.PROPOSED_UNRESOLVED,
    );
    expect(report.noSilentChange.violations[0]!.employeeId).toBe('E-UNREACHABLE');
    expect(report.noSilentChange.undeterminedEmployeeIds).toEqual(['E-UNREACHABLE']);
    expect(report.noSilentChange.unchangedCount).toBe(0);
  });

  it('is violated when the existing resolution was not supplied, so "unchanged" cannot be evaluated', () => {
    const report = reconcile({ employees: [employee('E-NO-EXISTING', { existingAttendanceSource: null })] });

    expect(report.noSilentChange.holds).toBe(false);
    expect(report.noSilentChange.violations.map((v) => v.kind)).toEqual([
      NO_SILENT_CHANGE_VIOLATION.EXISTING_UNKNOWN,
    ]);
  });

  it('is violated when the winner was decided by rule identity, because the applied rules carry different identifiers', () => {
    const report = reconcile({
      proposal: {
        // Two equally specific rules on the same dimension and the same effective-from date.
        // Nothing but the identifier separates them, and the applied rules will carry minted
        // ids rather than these proposal keys.
        sourceRules: [
          sourceRule({
            proposalKey: 'aaa-biometric',
            attendanceSource: 'biometric',
            dimensionValues: [{ dimension: 'designation', valueId: 'DSG-1' }],
          }),
          sourceRule({
            proposalKey: 'bbb-dialler',
            attendanceSource: 'dialler',
            dimensionValues: [{ dimension: 'designation', valueId: 'DSG-1' }],
          }),
        ],
        dayThresholdRules: [THRESHOLD_DEFAULT],
      },
      employees: [employee('E-TIED', { existingAttendanceSource: 'biometric' })],
    });

    const comparison = comparisonFor(report, 'E-TIED');
    expect(comparison.status).toBe('match');
    expect(comparison.tieBreakReachedIdentity).toBe(true);
    // A match that only holds because of an identifier comparison is not a demonstration.
    expect(report.noSilentChange.holds).toBe(false);
    expect(report.noSilentChange.unchangedEmployeeIds).toEqual([]);
    expect(report.noSilentChange.violations.map((v) => v.kind)).toEqual([
      NO_SILENT_CHANGE_VIOLATION.TIE_BREAK_NOT_REPRODUCIBLE,
    ]);
  });

  it('is violated when resolution is not order-independent, for example two proposed rules sharing one key', () => {
    const duplicated = {
      proposalKey: 'duplicate-key',
      dimensionValues: [{ dimension: 'designation' as const, valueId: 'DSG-1' }],
    };
    const report = reconcile({
      proposal: {
        sourceRules: [
          sourceRule({ ...duplicated, attendanceSource: 'biometric' }),
          sourceRule({ ...duplicated, attendanceSource: 'dialler' }),
        ],
        dayThresholdRules: [THRESHOLD_DEFAULT],
      },
      employees: [employee('E-AMBIGUOUS', { existingAttendanceSource: 'biometric' })],
    });

    expect(report.noSilentChange.holds).toBe(false);
    expect(report.noSilentChange.violations.map((v) => v.kind)).toEqual([
      NO_SILENT_CHANGE_VIOLATION.RESOLUTION_NOT_ORDER_INDEPENDENT,
    ]);
    expect(report.noSilentChange.unchangedEmployeeIds).toEqual([]);
  });
});

// -- criterion 15.14: reprocessing is listed, not performed --------------------------------

describe('criterion 15.14 - reprocessing list', () => {
  it('lists one entry per affected employee and open Pay_Month, and reprocesses nothing', () => {
    const report = reconcile({
      proposal: {
        sourceRules: [
          SYSTEM_DEFAULT,
          sourceRule({
            proposalKey: 'src-dialler-prc9',
            attendanceSource: 'dialler',
            dimensionValues: [{ dimension: 'process', valueId: 'PRC-9' }],
          }),
        ],
        dayThresholdRules: [
          THRESHOLD_DEFAULT,
          thresholdRule({
            proposalKey: 'thr-dsg7',
            fullDayMinutes: 480,
            halfDayMinutes: 240,
            graceMinutes: 10,
            dimensionValues: [{ dimension: 'designation', valueId: 'DSG-7' }],
          }),
        ],
      },
      employees: [
        employee('E-SOURCE-MOVES', { attributes: attrs({ processId: 'PRC-9' }) }),
        employee('E-THRESHOLDS-MOVE', { attributes: attrs({ designationId: 'DSG-7' }) }),
        employee('E-UNAFFECTED'),
      ],
      openPayMonths: ['2026-09', '2026-08', '2026-09'],
    });

    expect(report.reprocessing.reprocessed).toBe(false);
    // Deduplicated and sorted, so the same open months in any order give the same report.
    expect(report.reprocessing.openPayMonths).toEqual(['2026-08', '2026-09']);
    expect(report.reprocessing.employeeIds).toEqual(['E-SOURCE-MOVES', 'E-THRESHOLDS-MOVE']);
    expect(report.reprocessing.employeeCount).toBe(2);
    expect(report.reprocessing.entryCount).toBe(4);
    expect(report.reprocessing.entries).toEqual([
      { employeeId: 'E-SOURCE-MOVES', payMonth: '2026-08', reasons: ['attendance_source_differs'] },
      { employeeId: 'E-SOURCE-MOVES', payMonth: '2026-09', reasons: ['attendance_source_differs'] },
      { employeeId: 'E-THRESHOLDS-MOVE', payMonth: '2026-08', reasons: ['day_thresholds_differ'] },
      { employeeId: 'E-THRESHOLDS-MOVE', payMonth: '2026-09', reasons: ['day_thresholds_differ'] },
    ]);
  });

  it('still lists the affected employees when no open Pay_Month was supplied', () => {
    const report = reconcile({
      proposal: {
        sourceRules: [
          sourceRule({
            proposalKey: 'src-dialler-default',
            attendanceSource: 'dialler',
            isSystemDefault: 1,
          }),
        ],
        dayThresholdRules: [THRESHOLD_DEFAULT],
      },
      employees: [employee('E-MOVES', { existingAttendanceSource: 'biometric' })],
    });

    expect(report.reprocessing.openPayMonths).toEqual([]);
    expect(report.reprocessing.entries).toEqual([]);
    expect(report.reprocessing.employeeIds).toEqual(['E-MOVES']);
  });
});

// -- totality and determinism -------------------------------------------------------------

describe('totality and determinism', () => {
  it('returns empty reports for an empty employee list without throwing', () => {
    const report = reconcile({ employees: [] });

    expect(report.employeeCount).toBe(0);
    expect(report.attendanceSource.comparisons).toEqual([]);
    expect(report.attendanceSource.differingCount).toBe(0);
    expect(report.dayThresholds.comparisons).toEqual([]);
    expect(report.missingDimensions.employees).toEqual([]);
    expect(report.missingDimensions.byDimension).toHaveLength(6);
    expect(report.missingDimensions.byDimension.every((d) => d.percentOfEmployees === 0)).toBe(
      true,
    );
    expect(report.reprocessing.entries).toEqual([]);
    // Vacuously true: there is no employee whose resolution could change silently.
    expect(report.noSilentChange.holds).toBe(true);
    expect(report.noSilentChange.violations).toEqual([]);
  });

  it('handles an empty proposed rule set by reporting every employee unresolved', () => {
    const report = reconcile({
      proposal: { sourceRules: [], dayThresholdRules: [] },
      employees: [employee('E-1'), employee('E-2')],
    });

    expect(report.windowedSourceRuleCount).toBe(0);
    expect(report.attendanceSource.unresolvedCount).toBe(2);
    expect(report.dayThresholds.unresolvedCount).toBe(2);
    expect(report.noSilentChange.holds).toBe(false);
  });

  it('produces an identical report for the same employees in a different order', () => {
    const employees = [
      employee('E-3', { attributes: attrs({ processId: 'PRC-9' }) }),
      employee('E-1', { attributes: attrs({ costCentreId: null }) }),
      employee('E-2', { existingAttendanceSource: null }),
      employee('E-4', { existingThresholds: { fullDayMinutes: 1, halfDayMinutes: 2, graceMinutes: 3 } }),
    ];
    const proposal: ReconciliationRuleSet = {
      sourceRules: [
        SYSTEM_DEFAULT,
        sourceRule({
          proposalKey: 'src-dialler-prc9',
          attendanceSource: 'dialler',
          dimensionValues: [{ dimension: 'process', valueId: 'PRC-9' }],
        }),
      ],
      dayThresholdRules: [THRESHOLD_DEFAULT],
    };
    const openPayMonths = ['2026-09', '2026-07'];

    const forward = buildAttendanceRuleMigrationReconciliation({
      proposal,
      employees,
      effectiveDate: AS_OF,
      openPayMonths,
    });
    const reversed = buildAttendanceRuleMigrationReconciliation({
      proposal,
      employees: [...employees].reverse(),
      effectiveDate: AS_OF,
      openPayMonths: [...openPayMonths].reverse(),
    });

    expect(reversed).toEqual(forward);
  });

  it('is ordering-independent for arbitrary employee populations', () => {
    const proposal: ReconciliationRuleSet = {
      sourceRules: [
        SYSTEM_DEFAULT,
        sourceRule({
          proposalKey: 'src-dialler-prc9',
          attendanceSource: 'dialler',
          dimensionValues: [{ dimension: 'process', valueId: 'PRC-9' }],
        }),
        sourceRule({
          proposalKey: 'src-dialler-dsg7-br1',
          attendanceSource: 'dialler',
          dimensionValues: [
            { dimension: 'branch', valueId: 'BR-1' },
            { dimension: 'designation', valueId: 'DSG-7' },
          ],
        }),
      ],
      dayThresholdRules: [
        THRESHOLD_DEFAULT,
        thresholdRule({
          proposalKey: 'thr-dsg7',
          fullDayMinutes: 480,
          halfDayMinutes: 240,
          graceMinutes: 10,
          dimensionValues: [{ dimension: 'designation', valueId: 'DSG-7' }],
        }),
      ],
    };

    const maybeId = fc.option(fc.constantFrom('PRC-1', 'PRC-9'), { nil: null });
    const employeeArb: fc.Arbitrary<ReconciliationEmployee> = fc.record({
      employeeId: fc.string({ minLength: 1, maxLength: 6 }),
      attributes: fc.record({
        costCentreId: fc.option(fc.constant('CC-1'), { nil: null }),
        processId: maybeId,
        branchId: fc.option(fc.constantFrom('BR-1', 'BR-2'), { nil: null }),
        departmentId: fc.option(fc.constant('DEP-1'), { nil: null }),
        designationId: fc.option(fc.constantFrom('DSG-1', 'DSG-7'), { nil: null }),
        employmentProfile: fc.option(fc.constant('ON_ROLL'), { nil: null }),
      }),
      existingAttendanceSource: fc.constantFrom('biometric', 'dialler', null, 'apr'),
      existingThresholds: fc.option(
        fc.record({
          fullDayMinutes: fc.integer({ min: 0, max: 720 }),
          halfDayMinutes: fc.integer({ min: 0, max: 720 }),
          graceMinutes: fc.integer({ min: 0, max: 60 }),
        }),
        { nil: null },
      ),
    });

    fc.assert(
      fc.property(
        fc.array(employeeArb, { maxLength: 12 }),
        fc.array(fc.constantFrom('2026-07', '2026-08', '2026-09'), { maxLength: 3 }),
        (employees, openPayMonths) => {
          const forward = buildAttendanceRuleMigrationReconciliation({
            proposal,
            employees,
            effectiveDate: AS_OF,
            openPayMonths,
          });
          const backward = buildAttendanceRuleMigrationReconciliation({
            proposal,
            employees: [...employees].reverse(),
            effectiveDate: AS_OF,
            openPayMonths: [...openPayMonths].reverse(),
          });
          expect(backward).toEqual(forward);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects an effective date it cannot window rules against', () => {
    expect(() => reconcile({ effectiveDate: '2026-9-1' })).toThrow(/effectiveDate/);
    expect(() => reconcile({ effectiveDate: '' })).toThrow(/effectiveDate/);
  });
});

// -- against the real proposal builder ----------------------------------------------------

describe('against the proposal the builder actually produces', () => {
  it('reconciles a proposal built from legacy rows without any adaptation', () => {
    const proposal = buildAttendanceRuleMigrationProposal({
      attendanceRuleConfigRows: [
        {
          id: 'arc-global-001',
          rule_name: 'Global default',
          designation_id: null,
          process_id: null,
          branch_id: null,
          attendance_source: 'biometric',
          full_day_minutes: 540,
          half_day_minutes: 270,
          grace_minutes: 15,
          effective_from: '2024-01-01',
          effective_to: null,
          active_status: 1,
        },
        {
          id: 'arc-dsg7',
          rule_name: 'Dialler for DSG-7',
          designation_id: 'DSG-7',
          process_id: null,
          branch_id: null,
          attendance_source: 'dialler',
          full_day_minutes: 480,
          half_day_minutes: 240,
          grace_minutes: 10,
          effective_from: '2025-04-01',
          effective_to: null,
          active_status: 1,
        },
      ],
      aprEligibilityConfigRows: [],
      appliedInPayMonth: '2026-09',
      featureConfig: {
        biometric_half_day_floor_minutes: '270',
        netlogin_half_day_floor_minutes: '240',
      },
    });

    const report = buildAttendanceRuleMigrationReconciliation({
      // The builder's own output, passed straight through.
      proposal,
      employees: [
        employee('E-DEFAULT', { existingAttendanceSource: 'biometric' }),
        employee('E-DSG7', {
          attributes: attrs({ designationId: 'DSG-7' }),
          existingAttendanceSource: 'biometric',
          existingThresholds: { fullDayMinutes: 480, halfDayMinutes: 240, graceMinutes: 10 },
        }),
      ],
      effectiveDate: AS_OF,
      openPayMonths: ['2026-09'],
    });

    expect(comparisonFor(report, 'E-DEFAULT').proposedAttendanceSource).toBe('biometric');
    expect(comparisonFor(report, 'E-DEFAULT').proposedRuleIsSystemDefault).toBe(true);
    expect(comparisonFor(report, 'E-DSG7').proposedAttendanceSource).toBe('dialler');
    expect(report.attendanceSource.differingEmployeeIds).toEqual(['E-DSG7']);
    // The designation-scoped legacy thresholds survive the migration for that employee.
    expect(thresholdComparisonFor(report, 'E-DSG7').status).toBe('match');
    expect(thresholdComparisonFor(report, 'E-DEFAULT').status).toBe('match');
    expect(report.noSilentChange.unchangedEmployeeIds).toEqual(['E-DEFAULT']);
    expect(report.noSilentChange.changedEmployeeIds).toEqual(['E-DSG7']);
    expect(report.noSilentChange.holds).toBe(true);
    expect(report.reprocessing.entries).toEqual([
      { employeeId: 'E-DSG7', payMonth: '2026-09', reasons: ['attendance_source_differs'] },
    ]);
  });
});
