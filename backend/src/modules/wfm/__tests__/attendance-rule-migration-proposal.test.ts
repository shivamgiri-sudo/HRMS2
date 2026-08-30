// backend/src/modules/wfm/__tests__/attendance-rule-migration-proposal.test.ts
//
// Requirement 15's proposal builder: criteria 15.1, 15.2, 15.3, 15.8 and 15.12, plus the
// criterion 1.10 / 1.15 store invariants the proposal has to satisfy before it can be approved.
//
// No mocks and no database. The builder is a pure function, which is the whole reason these
// assertions can be about the proposed RULE SET rather than about which queries were issued.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';

import {
  buildAttendanceRuleMigrationProposal,
  APR_ELIGIBILITY_SOURCE,
  DEFAULT_HALF_DAY_FLOOR_MINUTES,
  FINDING_KIND,
  LEGACY_ENGINE_FALLBACK_FULL_DAY_MINUTES,
  LEGACY_ENGINE_FALLBACK_GRACE_MINUTES,
  SYSTEM_DEFAULT_PREFERRED_SOURCE,
  type AttendanceFeatureConfigValues,
  type AttendanceRuleMigrationProposal,
  type BuildProposalInput,
  type LegacyAprEligibilityConfigRow,
  type LegacyAttendanceRuleConfigRow,
  type ProposalFinding,
} from '../attendance-rule-migration-proposal.js';

const PAY_MONTH = '2026-09';
const FIRST_OF_PAY_MONTH = '2026-09-01';

// Production values today (requirements.md criterion 15.8).
const FEATURE_CONFIG: AttendanceFeatureConfigValues = {
  biometric_half_day_floor_minutes: '270',
  netlogin_half_day_floor_minutes: '240',
};

// Constrained by default, so a test only becomes an unconstrained-rule test when it says so.
function arcRow(over: Partial<LegacyAttendanceRuleConfigRow> = {}): LegacyAttendanceRuleConfigRow {
  return {
    id: 'arc-1',
    rule_name: 'Legacy rule',
    scope_type: 'designation',
    designation_id: 'DSG-1',
    process_id: null,
    branch_id: null,
    attendance_source: 'biometric',
    full_day_minutes: 540,
    half_day_minutes: 270,
    grace_minutes: 15,
    effective_from: '2025-04-01',
    effective_to: null,
    notes: null,
    active_status: 1,
    created_at: '2025-04-01 09:00:00',
    ...over,
  };
}

function aprRow(over: Partial<LegacyAprEligibilityConfigRow> = {}): LegacyAprEligibilityConfigRow {
  return {
    id: 'apr-elig-1',
    rule_name: 'APR eligible',
    designation_id: 'DSG-9',
    department_id: 'DEP-9',
    process_id: 'PRC-9',
    active_status: 1,
    notes: null,
    created_at: '2026-08-28 12:00:00',
    ...over,
  };
}

function build(over: Partial<BuildProposalInput> = {}): AttendanceRuleMigrationProposal {
  return buildAttendanceRuleMigrationProposal({
    attendanceRuleConfigRows: [],
    aprEligibilityConfigRows: [],
    appliedInPayMonth: PAY_MONTH,
    featureConfig: FEATURE_CONFIG,
    ...over,
  });
}

function findingsOfKind(proposal: AttendanceRuleMigrationProposal, kind: string): ProposalFinding[] {
  return proposal.findings.filter((f) => f.findingKind === kind);
}

function keyOf(link: { legacyTable: string; legacyRowId: string }): string {
  return `${link.legacyTable}:${link.legacyRowId}`;
}

// The two active unconstrained rows named in criterion 15.3.
const ARC_GLOBAL_001 = arcRow({
  id: 'arc-global-001',
  rule_name: 'Global default',
  scope_type: 'global',
  designation_id: null,
  process_id: null,
  branch_id: null,
  attendance_source: 'biometric',
  effective_from: '2024-01-01',
  full_day_minutes: 540,
  half_day_minutes: 270,
  grace_minutes: 15,
});

const ARC_APR_OPS_EXEC = arcRow({
  id: 'arc-apr-ops-exec',
  rule_name: 'APR Operations executives',
  scope_type: 'global',
  designation_id: null,
  process_id: null,
  branch_id: null,
  attendance_source: 'dialler',
  effective_from: '2025-06-01',
  full_day_minutes: 480,
  half_day_minutes: 240,
  grace_minutes: 10,
});

describe('criterion 15.1 - one proposed Attendance_Source_Rule per active legacy row', () => {
  it('proposes one rule per active row from both tables and preserves its dimensions, source and window', () => {
    const proposal = build({
      attendanceRuleConfigRows: [
        ARC_GLOBAL_001,
        arcRow({
          id: 'arc-branch',
          designation_id: 'DSG-1',
          process_id: 'PRC-1',
          branch_id: 'BRN-1',
          attendance_source: 'biometric',
          effective_from: '2025-04-01',
          effective_to: '2025-12-31',
        }),
      ],
      aprEligibilityConfigRows: [aprRow()],
    });

    // One System_Default_Rule (from arc-global-001) plus one rule per constrained row.
    expect(proposal.sourceRules).toHaveLength(3);

    const branchRule = proposal.sourceRules.find(
      (r) => r.sourceRows.some((s) => s.legacyRowId === 'arc-branch'),
    );
    expect(branchRule).toBeDefined();
    expect(branchRule!.attendanceSource).toBe('biometric');
    expect(branchRule!.effectiveFrom).toBe('2025-04-01');
    expect(branchRule!.effectiveTo).toBe('2025-12-31');
    expect(branchRule!.undatedSource).toBe(0);
    expect(branchRule!.isSystemDefault).toBe(0);
    // Dimension_Priority_Order: process, branch, designation of the six.
    expect(branchRule!.dimensionValues).toEqual([
      { dimension: 'process', valueId: 'PRC-1' },
      { dimension: 'branch', valueId: 'BRN-1' },
      { dimension: 'designation', valueId: 'DSG-1' },
    ]);
    expect(branchRule!.sourceRows).toEqual([
      { legacyTable: 'attendance_rule_config', legacyRowId: 'arc-branch' },
    ]);
  });

  it("maps apr_eligibility_config onto designation, department and process and assigns the dialler source", () => {
    const proposal = build({ aprEligibilityConfigRows: [aprRow()] });

    const aprRule = proposal.sourceRules.find(
      (r) => r.sourceRows.some((s) => s.legacyTable === 'apr_eligibility_config'),
    );
    expect(aprRule).toBeDefined();
    expect(aprRule!.attendanceSource).toBe(APR_ELIGIBILITY_SOURCE);
    expect(aprRule!.attendanceSource).toBe('dialler');
    expect(aprRule!.dimensionValues).toEqual([
      { dimension: 'process', valueId: 'PRC-9' },
      { dimension: 'department', valueId: 'DEP-9' },
      { dimension: 'designation', valueId: 'DSG-9' },
    ]);

    // The assignment is derived, so it is disclosed rather than left to be inferred.
    const disclosure = findingsOfKind(proposal, FINDING_KIND.APR_ELIGIBILITY_SOURCE_ASSIGNED);
    expect(disclosure).toHaveLength(1);
    expect(disclosure[0]!.detailJson).toMatchObject({
      assigned_attendance_source: 'dialler',
      active_row_count: 1,
      legacy_row_ids: ['apr-elig-1'],
    });
  });

  it('excludes inactive legacy rows from both tables', () => {
    const proposal = build({
      attendanceRuleConfigRows: [
        ARC_GLOBAL_001,
        arcRow({ id: 'arc-off', designation_id: 'DSG-OFF', active_status: 0 }),
        arcRow({ id: 'arc-null-status', designation_id: 'DSG-NULL', active_status: null }),
      ],
      aprEligibilityConfigRows: [
        aprRow({ id: 'apr-off', active_status: 0 }),
        aprRow({ id: 'apr-on', active_status: 1 }),
      ],
    });

    const allSourceRowKeys = proposal.sourceRules.flatMap((r) => r.sourceRows.map(keyOf));
    expect(allSourceRowKeys).toContain('attendance_rule_config:arc-global-001');
    expect(allSourceRowKeys).toContain('apr_eligibility_config:apr-on');
    expect(allSourceRowKeys).not.toContain('attendance_rule_config:arc-off');
    expect(allSourceRowKeys).not.toContain('attendance_rule_config:arc-null-status');
    expect(allSourceRowKeys).not.toContain('apr_eligibility_config:apr-off');

    // An inactive row must not leak through the threshold path either (criterion 15.8).
    const thresholdRowKeys = proposal.dayThresholdRules.flatMap((r) => r.sourceRows.map(keyOf));
    expect(thresholdRowKeys).not.toContain('attendance_rule_config:arc-off');
  });

  it('treats a NULL or blank dimension column as unconstrained, never as a constraint on NULL', () => {
    const proposal = build({
      attendanceRuleConfigRows: [
        ARC_GLOBAL_001,
        arcRow({
          id: 'arc-partial',
          designation_id: 'DSG-1',
          process_id: null,
          // Blank is the same absence as NULL: it is not an identifier any employee holds.
          branch_id: '   ',
        }),
      ],
      aprEligibilityConfigRows: [
        // The process-NULL row of criterion 15.4: designation + department only.
        aprRow({ id: 'apr-elig-ops-executive', process_id: null }),
      ],
    });

    const partial = proposal.sourceRules.find((r) =>
      r.sourceRows.some((s) => s.legacyRowId === 'arc-partial'),
    );
    expect(partial!.dimensionValues).toEqual([{ dimension: 'designation', valueId: 'DSG-1' }]);

    const opsExec = proposal.sourceRules.find((r) =>
      r.sourceRows.some((s) => s.legacyRowId === 'apr-elig-ops-executive'),
    );
    expect(opsExec!.dimensionValues).toEqual([
      { dimension: 'department', valueId: 'DEP-9' },
      { dimension: 'designation', valueId: 'DSG-9' },
    ]);

    // Nothing anywhere in the proposal constrains a dimension to a null-ish value.
    const everyValue = proposal.sourceRules
      .concat([])
      .flatMap((r) => r.dimensionValues.map((d) => d.valueId))
      .concat(proposal.dayThresholdRules.flatMap((r) => r.dimensionValues.map((d) => d.valueId)));
    for (const value of everyValue) {
      expect(value.trim()).not.toBe('');
      expect(value).not.toBe('null');
    }
  });
});

describe('criterion 15.2 - undated legacy rows are dated from the applied-in Pay_Month', () => {
  it('dates every apr_eligibility_config row and every undated attendance_rule_config row from the first of the Pay_Month, flags them, and lists them', () => {
    const proposal = build({
      attendanceRuleConfigRows: [
        ARC_GLOBAL_001,
        arcRow({ id: 'arc-undated', designation_id: 'DSG-2', effective_from: null }),
      ],
      aprEligibilityConfigRows: [aprRow({ id: 'apr-a' }), aprRow({ id: 'apr-b', process_id: 'PRC-8' })],
    });

    expect(proposal.assignedEffectiveFrom).toBe(FIRST_OF_PAY_MONTH);

    const undatedRules = proposal.sourceRules.filter((r) => r.undatedSource === 1);
    const undatedKeys = undatedRules.flatMap((r) => r.sourceRows.map(keyOf)).sort();
    expect(undatedKeys).toEqual([
      'apr_eligibility_config:apr-a',
      'apr_eligibility_config:apr-b',
      'attendance_rule_config:arc-undated',
    ]);
    for (const rule of undatedRules) {
      expect(rule.effectiveFrom).toBe(FIRST_OF_PAY_MONTH);
    }

    // A dated row keeps its own date and is not flagged.
    const dated = proposal.sourceRules.find((r) =>
      r.sourceRows.some((s) => s.legacyRowId === 'arc-global-001'),
    );
    expect(dated!.undatedSource).toBe(0);

    const perRow = findingsOfKind(proposal, FINDING_KIND.UNDATED_SOURCE_ROW);
    expect(perRow.map((f) => f.subjectRef)).toEqual([
      'apr_eligibility_config:apr-a',
      'apr_eligibility_config:apr-b',
      'attendance_rule_config:arc-undated',
    ]);
    for (const finding of perRow) {
      expect(finding.detail).toContain(FIRST_OF_PAY_MONTH);
    }

    const aggregate = findingsOfKind(proposal, FINDING_KIND.UNDATED_ROWS_DATED_FROM_PAY_MONTH);
    expect(aggregate).toHaveLength(1);
    expect(aggregate[0]!.severity).toBe('decision_required');
    expect(aggregate[0]!.detailJson).toMatchObject({
      applied_in_pay_month: PAY_MONTH,
      assigned_effective_from: FIRST_OF_PAY_MONTH,
      undated_row_count: 3,
    });
  });

  it('reports nothing about undated rows when every active row carries a date', () => {
    const proposal = build({ attendanceRuleConfigRows: [ARC_GLOBAL_001] });
    expect(findingsOfKind(proposal, FINDING_KIND.UNDATED_SOURCE_ROW)).toHaveLength(0);
    expect(findingsOfKind(proposal, FINDING_KIND.UNDATED_ROWS_DATED_FROM_PAY_MONTH)).toHaveLength(0);
  });

  it('refuses a Pay_Month it cannot read rather than mis-dating every undated row', () => {
    expect(() => build({ appliedInPayMonth: '2026-9' })).toThrow(/appliedInPayMonth/);
    expect(() => build({ appliedInPayMonth: '2026-13' })).toThrow(/appliedInPayMonth/);
    expect(() => build({ appliedInPayMonth: 'September 2026' })).toThrow(/appliedInPayMonth/);
  });

  it('reads a mysql2 Date the same way mysql2 built it, and a datetime string', () => {
    const proposal = build({
      attendanceRuleConfigRows: [
        arcRow({ id: 'arc-date-obj', designation_id: 'DSG-A', effective_from: new Date(2025, 2, 9) }),
        arcRow({
          id: 'arc-date-str',
          designation_id: 'DSG-B',
          effective_from: '2025-03-10 00:00:00',
        }),
      ],
    });
    const fromOf = (id: string) =>
      proposal.sourceRules.find((r) => r.sourceRows.some((s) => s.legacyRowId === id))!.effectiveFrom;
    expect(fromOf('arc-date-obj')).toBe('2025-03-09');
    expect(fromOf('arc-date-str')).toBe('2025-03-10');
  });
});

describe('criterion 15.3 - the two unconstrained rows collapse to exactly one System_Default_Rule', () => {
  const proposal = build({
    attendanceRuleConfigRows: [
      ARC_GLOBAL_001,
      ARC_APR_OPS_EXEC,
      arcRow({ id: 'arc-scoped', designation_id: 'DSG-1' }),
    ],
  });

  it('produces exactly one System_Default_Rule with no dimension_value children', () => {
    const defaults = proposal.sourceRules.filter((r) => r.isSystemDefault === 1);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.dimensionValues).toEqual([]);
    // criterion 1.10 restated the other way round: a dimension-free rule IS the default.
    const dimensionless = proposal.sourceRules.filter((r) => r.dimensionValues.length === 0);
    expect(dimensionless).toHaveLength(1);
  });

  it('carries biometric, the conservative source, and spans from the earliest date any rule is in force', () => {
    const systemDefault = proposal.sourceRules.find((r) => r.isSystemDefault === 1)!;
    expect(systemDefault.attendanceSource).toBe('biometric');
    expect(systemDefault.attendanceSource).toBe(SYSTEM_DEFAULT_PREFERRED_SOURCE);
    // criterion 2.6 total coverage: the default has to be a candidate on every date any other
    // proposed rule can be, so it takes the earliest effective-from in the proposal.
    expect(systemDefault.effectiveFrom).toBe('2024-01-01');
    expect(systemDefault.effectiveTo).toBeNull();
  });

  it('records both contributing legacy rows as provenance', () => {
    const systemDefault = proposal.sourceRules.find((r) => r.isSystemDefault === 1)!;
    expect(systemDefault.sourceRows.map(keyOf)).toEqual([
      'attendance_rule_config:arc-apr-ops-exec',
      'attendance_rule_config:arc-global-001',
    ]);
  });

  it('does not pick silently: a decision_required finding names both inputs, both sources and the choice', () => {
    const collapse = findingsOfKind(proposal, FINDING_KIND.UNCONSTRAINED_RULE_COLLAPSE);
    expect(collapse).toHaveLength(1);
    expect(collapse[0]!.severity).toBe('decision_required');
    expect(collapse[0]!.detail).toContain('arc-global-001');
    expect(collapse[0]!.detail).toContain('arc-apr-ops-exec');
    expect(collapse[0]!.detail).toContain('biometric');
    expect(collapse[0]!.detail).toContain('dialler');
    expect(collapse[0]!.detailJson).toMatchObject({
      unconstrained_row_count: 2,
      legacy_attendance_sources: ['biometric', 'dialler'],
      proposed_attendance_source: 'biometric',
      contributing_legacy_rows: [
        'attendance_rule_config:arc-apr-ops-exec',
        'attendance_rule_config:arc-global-001',
      ],
    });
  });

  it('reports the unconstrained scope as a source disagreement as well', () => {
    const disagreements = findingsOfKind(proposal, FINDING_KIND.SCOPE_SOURCE_DISAGREEMENT);
    expect(disagreements).toHaveLength(1);
    expect(disagreements[0]!.detailJson).toMatchObject({
      attendance_sources: ['biometric', 'dialler'],
    });
  });

  it('carries a single unconstrained row through unchanged, at info severity', () => {
    const one = build({ attendanceRuleConfigRows: [ARC_APR_OPS_EXEC] });
    const systemDefault = one.sourceRules.find((r) => r.isSystemDefault === 1)!;
    expect(systemDefault.attendanceSource).toBe('dialler');
    const collapse = findingsOfKind(one, FINDING_KIND.UNCONSTRAINED_RULE_COLLAPSE);
    expect(collapse[0]!.severity).toBe('info');
  });

  it('synthesises the mandatory default and blocks approval when no legacy row is unconstrained', () => {
    const none = build({ attendanceRuleConfigRows: [arcRow({ id: 'arc-scoped-only' })] });
    const defaults = none.sourceRules.filter((r) => r.isSystemDefault === 1);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.sourceRows).toEqual([]);
    const synth = findingsOfKind(none, FINDING_KIND.SYSTEM_DEFAULT_SYNTHESISED);
    expect(synth).toHaveLength(1);
    expect(synth[0]!.severity).toBe('blocking');
  });

  it('reports a scope where two legacy rows disagree on source', () => {
    const proposalWithClash = build({
      attendanceRuleConfigRows: [
        ARC_GLOBAL_001,
        arcRow({ id: 'arc-bio', designation_id: 'DSG-9', process_id: 'PRC-9', attendance_source: 'biometric' }),
      ],
      // Same scope, dialler by assignment.
      aprEligibilityConfigRows: [aprRow({ id: 'apr-clash', department_id: null })],
    });
    const disagreements = findingsOfKind(
      proposalWithClash,
      FINDING_KIND.SCOPE_SOURCE_DISAGREEMENT,
    );
    const clash = disagreements.find((f) => f.subjectRef === 'process=PRC-9,designation=DSG-9');
    expect(clash).toBeDefined();
    expect(clash!.severity).toBe('decision_required');
    expect(clash!.detailJson).toMatchObject({
      legacy_rows: [
        'apr_eligibility_config:apr-clash',
        'attendance_rule_config:arc-bio',
      ],
    });
  });
});

describe('criterion 15.8 - one Day_Threshold_Rule per distinct threshold-and-dimension combination', () => {
  it('deduplicates identical combinations and keeps every contributor', () => {
    const proposal = build({
      attendanceRuleConfigRows: [
        // Same dimensions, same thresholds, same window - but different sources, so these are
        // two source rules and ONE threshold rule.
        arcRow({ id: 'arc-a', designation_id: 'DSG-1', attendance_source: 'biometric' }),
        arcRow({ id: 'arc-b', designation_id: 'DSG-1', attendance_source: 'dialler' }),
        // Same dimensions, different thresholds -> its own rule.
        arcRow({ id: 'arc-c', designation_id: 'DSG-1', full_day_minutes: 480, half_day_minutes: 240 }),
        // Same thresholds as arc-a but a different window -> its own rule (window preserved).
        arcRow({ id: 'arc-d', designation_id: 'DSG-1', effective_to: '2025-12-31' }),
      ],
    });

    const scoped = proposal.dayThresholdRules.filter((r) => r.isUnconstrainedDefault === 0);
    expect(scoped).toHaveLength(3);

    const shared = scoped.find((r) => r.sourceRows.some((s) => s.legacyRowId === 'arc-a'))!;
    expect(shared.sourceRows.map((s) => s.legacyRowId)).toEqual(['arc-a', 'arc-b']);
    expect(shared.fullDayMinutes).toBe(540);
    expect(shared.halfDayMinutes).toBe(270);
    expect(shared.graceMinutes).toBe(15);
    expect(shared.effectiveTo).toBeNull();
    expect(shared.dimensionValues).toEqual([{ dimension: 'designation', valueId: 'DSG-1' }]);

    const windowed = scoped.find((r) => r.sourceRows.some((s) => s.legacyRowId === 'arc-d'))!;
    expect(windowed.effectiveTo).toBe('2025-12-31');
    expect(windowed.proposalKey).not.toBe(shared.proposalKey);

    // Two source rules survive the same scope because the sources differ.
    const scopedSourceRules = proposal.sourceRules.filter((r) => r.isSystemDefault === 0);
    expect(new Set(scopedSourceRules.map((r) => r.attendanceSource))).toEqual(
      new Set(['biometric', 'dialler']),
    );
  });

  it('does not read thresholds from apr_eligibility_config, which holds none', () => {
    const proposal = build({ aprEligibilityConfigRows: [aprRow()] });
    expect(proposal.dayThresholdRules).toHaveLength(1);
    expect(proposal.dayThresholdRules[0]!.isUnconstrainedDefault).toBe(1);
  });

  it('reports rather than guesses when a legacy row does not carry all three thresholds', () => {
    const proposal = build({
      attendanceRuleConfigRows: [arcRow({ id: 'arc-gap', grace_minutes: null })],
    });
    expect(proposal.dayThresholdRules.filter((r) => r.isUnconstrainedDefault === 0)).toHaveLength(0);
    const gap = findingsOfKind(proposal, FINDING_KIND.LEGACY_THRESHOLDS_INCOMPLETE);
    expect(gap).toHaveLength(1);
    expect(gap[0]!.severity).toBe('decision_required');
    expect(gap[0]!.subjectRef).toBe('attendance_rule_config:arc-gap');
  });
});

describe('criteria 15.8 / 1.15 - the single unconstrained Day_Threshold_Rule', () => {
  it('seeds half_day_minutes from the passed-in biometric floor, not from a hardcoded number', () => {
    const proposal = build({
      featureConfig: {
        biometric_half_day_floor_minutes: 300,
        netlogin_half_day_floor_minutes: 200,
      },
    });
    const def = proposal.dayThresholdRules.find((r) => r.isUnconstrainedDefault === 1)!;
    expect(def.halfDayMinutes).toBe(300);
    expect(def.sourceRows).toEqual([
      {
        legacyTable: 'attendance_feature_config',
        legacyRowId: 'biometric_half_day_floor_minutes',
      },
    ]);

    const seeded = findingsOfKind(proposal, FINDING_KIND.UNCONSTRAINED_DEFAULT_SEEDED);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]!.detailJson).toMatchObject({
      half_day_minutes: 300,
      half_day_source_key: 'biometric_half_day_floor_minutes',
      biometric_half_day_floor_minutes: 300,
      netlogin_half_day_floor_minutes: 200,
    });
  });

  it('is the only Day_Threshold_Rule constraining no dimension, even with two unconstrained legacy rows', () => {
    const proposal = build({
      attendanceRuleConfigRows: [ARC_GLOBAL_001, ARC_APR_OPS_EXEC],
    });
    const dimensionless = proposal.dayThresholdRules.filter((r) => r.dimensionValues.length === 0);
    expect(dimensionless).toHaveLength(1);
    expect(dimensionless[0]!.isUnconstrainedDefault).toBe(1);
  });

  it('takes full_day_minutes and grace_minutes from the oldest unconstrained legacy row and records every contributor', () => {
    const proposal = build({
      attendanceRuleConfigRows: [ARC_APR_OPS_EXEC, ARC_GLOBAL_001],
    });
    const def = proposal.dayThresholdRules.find((r) => r.isUnconstrainedDefault === 1)!;
    // arc-global-001 is effective 2024-01-01, the older of the two.
    expect(def.fullDayMinutes).toBe(540);
    expect(def.graceMinutes).toBe(15);
    expect(def.halfDayMinutes).toBe(270);
    expect(def.sourceRows.map(keyOf)).toEqual([
      'attendance_feature_config:biometric_half_day_floor_minutes',
      'attendance_rule_config:arc-apr-ops-exec',
      'attendance_rule_config:arc-global-001',
    ]);
  });

  it('states which unconstrained legacy thresholds it folded away rather than dropping them silently', () => {
    const proposal = build({
      attendanceRuleConfigRows: [ARC_GLOBAL_001, ARC_APR_OPS_EXEC],
    });
    const merged = findingsOfKind(proposal, FINDING_KIND.UNCONSTRAINED_LEGACY_THRESHOLDS_MERGED);
    // arc-global-001 supplied the seed, so only arc-apr-ops-exec's values are lost.
    expect(merged.map((f) => f.subjectRef)).toEqual(['attendance_rule_config:arc-apr-ops-exec']);
    expect(merged[0]!.severity).toBe('decision_required');
    expect(merged[0]!.detailJson).toMatchObject({
      legacy_full_day_minutes: 480,
      legacy_half_day_minutes: 240,
      legacy_grace_minutes: 10,
      seeded_full_day_minutes: 540,
      seeded_half_day_minutes: 270,
      seeded_grace_minutes: 15,
    });
  });

  it("falls back to the engine's own Fallback Default for full_day and grace when no unconstrained row supplies them", () => {
    const proposal = build({ attendanceRuleConfigRows: [arcRow({ id: 'arc-scoped' })] });
    const def = proposal.dayThresholdRules.find((r) => r.isUnconstrainedDefault === 1)!;
    expect(def.fullDayMinutes).toBe(LEGACY_ENGINE_FALLBACK_FULL_DAY_MINUTES);
    expect(def.graceMinutes).toBe(LEGACY_ENGINE_FALLBACK_GRACE_MINUTES);
    expect(findingsOfKind(proposal, FINDING_KIND.UNCONSTRAINED_DEFAULT_SEEDED)[0]!.severity).toBe(
      'decision_required',
    );
  });

  describe('a missing or unusable attendance_feature_config key', () => {
    it('falls back to the net-login floor and requires a decision when the biometric key is absent', () => {
      const proposal = build({
        featureConfig: { netlogin_half_day_floor_minutes: '240' },
      });
      const def = proposal.dayThresholdRules.find((r) => r.isUnconstrainedDefault === 1)!;
      expect(def.halfDayMinutes).toBe(240);
      const unusable = findingsOfKind(proposal, FINDING_KIND.FEATURE_CONFIG_KEY_UNUSABLE);
      expect(unusable).toHaveLength(1);
      expect(unusable[0]!.severity).toBe('decision_required');
      expect(unusable[0]!.subjectRef).toBe('biometric_half_day_floor_minutes');
      expect(def.sourceRows.map(keyOf)).toContain(
        'attendance_feature_config:netlogin_half_day_floor_minutes',
      );
    });

    it('blocks approval when neither key is readable, but still emits a rule so criterion 1.15 holds', () => {
      const proposal = build({ featureConfig: {} });
      const def = proposal.dayThresholdRules.find((r) => r.isUnconstrainedDefault === 1)!;
      expect(def.halfDayMinutes).toBe(DEFAULT_HALF_DAY_FLOOR_MINUTES);
      // Nothing configured supplied it, so nothing is claimed as its source.
      expect(def.sourceRows).toEqual([]);
      const unusable = findingsOfKind(proposal, FINDING_KIND.FEATURE_CONFIG_KEY_UNUSABLE);
      expect(unusable).toHaveLength(1);
      expect(unusable[0]!.severity).toBe('blocking');
    });

    it.each([
      ['an empty string', ''],
      ['non-numeric text', 'abc'],
      ['zero', '0'],
      ['a negative value', '-30'],
      ['null', null],
    ])('treats %s as absent rather than coercing it into a threshold', (_label, value) => {
      const proposal = build({
        featureConfig: {
          biometric_half_day_floor_minutes: value,
          netlogin_half_day_floor_minutes: '240',
        },
      });
      const def = proposal.dayThresholdRules.find((r) => r.isUnconstrainedDefault === 1)!;
      expect(def.halfDayMinutes).toBe(240);
      expect(findingsOfKind(proposal, FINDING_KIND.FEATURE_CONFIG_KEY_UNUSABLE)).toHaveLength(1);
    });
  });
});

describe('determinism - the same legacy data always proposes the same rule set', () => {
  const rows: LegacyAttendanceRuleConfigRow[] = [
    ARC_GLOBAL_001,
    ARC_APR_OPS_EXEC,
    arcRow({ id: 'arc-1', designation_id: 'DSG-1' }),
    arcRow({ id: 'arc-2', designation_id: 'DSG-2', process_id: 'PRC-2' }),
    arcRow({ id: 'arc-3', designation_id: 'DSG-1', rule_name: 'Zebra' }),
    arcRow({ id: 'arc-4', designation_id: 'DSG-3', effective_from: null }),
  ];
  const aprRows: LegacyAprEligibilityConfigRow[] = [
    aprRow({ id: 'apr-1' }),
    aprRow({ id: 'apr-2', process_id: 'PRC-2' }),
    aprRow({ id: 'apr-3', department_id: null }),
  ];

  it('collapses two legacy rows that mean the same thing into one proposal with both contributors', () => {
    const proposal = build({
      attendanceRuleConfigRows: [
        ARC_GLOBAL_001,
        arcRow({ id: 'arc-1', designation_id: 'DSG-1', rule_name: 'Alpha' }),
        arcRow({ id: 'arc-3', designation_id: 'DSG-1', rule_name: 'Zebra' }),
      ],
    });
    const scoped = proposal.sourceRules.filter((r) => r.isSystemDefault === 0);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.sourceRows.map((s) => s.legacyRowId)).toEqual(['arc-1', 'arc-3']);
    // The name cannot depend on which contributor was seen first.
    expect(scoped[0]!.ruleName).toBe('Alpha');
  });

  it('is byte-identical across two runs over the same data', () => {
    const a = build({ attendanceRuleConfigRows: rows, aprEligibilityConfigRows: aprRows });
    const b = build({ attendanceRuleConfigRows: rows, aprEligibilityConfigRows: aprRows });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is byte-identical when the legacy rows arrive in a different order', () => {
    const a = build({ attendanceRuleConfigRows: rows, aprEligibilityConfigRows: aprRows });
    const b = build({
      attendanceRuleConfigRows: [...rows].reverse(),
      aprEligibilityConfigRows: [...aprRows].reverse(),
    });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('keys every proposal by the sha-256 of its canonical signature', () => {
    const proposal = build({ attendanceRuleConfigRows: rows, aprEligibilityConfigRows: aprRows });
    const all = [...proposal.sourceRules, ...proposal.dayThresholdRules];
    for (const rule of all) {
      expect(rule.proposalKey).toMatch(/^[0-9a-f]{64}$/);
      expect(rule.canonicalSignature).toContain('|v1|');
    }
    // uq_asrpr_key / uq_asrpdt_key are declared UNIQUE per proposal, so the builder must not
    // hand the persister two rows with one key.
    const sourceKeys = proposal.sourceRules.map((r) => r.proposalKey);
    expect(new Set(sourceKeys).size).toBe(sourceKeys.length);
    const thresholdKeys = proposal.dayThresholdRules.map((r) => r.proposalKey);
    expect(new Set(thresholdKeys).size).toBe(thresholdKeys.length);
  });

  it('numbers ordinals densely from 1 in reading order, default first', () => {
    const proposal = build({ attendanceRuleConfigRows: rows, aprEligibilityConfigRows: aprRows });
    expect(proposal.sourceRules.map((r) => r.ordinal)).toEqual(
      proposal.sourceRules.map((_, i) => i + 1),
    );
    expect(proposal.sourceRules[0]!.isSystemDefault).toBe(1);
    expect(proposal.dayThresholdRules[0]!.isUnconstrainedDefault).toBe(1);
    expect(proposal.findings.map((f) => f.ordinal)).toEqual(
      proposal.findings.map((_, i) => i + 1),
    );
  });

  // Reordering is the failure mode that matters here: the legacy rows arrive from a SELECT with
  // no ORDER BY, so two runs can legitimately see the same 91 rows in different orders. If any
  // of proposal_key, ordinal or the contributor lists depended on that order, a reviewer diffing
  // two runs would see churn that means nothing and would stop reading the diff.
  it('proposes the identical rule set for every permutation of the same legacy rows', () => {
    const arcArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => s.trim().length > 0),
      designation_id: fc.option(fc.constantFrom('DSG-1', 'DSG-2'), { nil: null }),
      process_id: fc.option(fc.constantFrom('PRC-1', 'PRC-2'), { nil: null }),
      branch_id: fc.option(fc.constantFrom('BRN-1'), { nil: null }),
      attendance_source: fc.constantFrom('biometric', 'dialler'),
      full_day_minutes: fc.constantFrom(480, 540),
      half_day_minutes: fc.constantFrom(240, 270),
      grace_minutes: fc.constantFrom(0, 10, 15),
      effective_from: fc.option(fc.constantFrom('2024-01-01', '2025-06-01'), { nil: null }),
      effective_to: fc.option(fc.constantFrom('2025-12-31'), { nil: null }),
      rule_name: fc.option(fc.constantFrom('Alpha', 'Zebra'), { nil: null }),
      active_status: fc.constantFrom(0, 1),
    });

    fc.assert(
      fc.property(
        fc.uniqueArray(arcArb, { maxLength: 8, selector: (r) => r.id.trim() }),
        (generated) => {
          const legacy = generated.map((r) => arcRow(r as Partial<LegacyAttendanceRuleConfigRow>));
          const reference = JSON.stringify(build({ attendanceRuleConfigRows: legacy }));
          for (const permutation of [
            [...legacy].reverse(),
            [...legacy].sort((a, b) => (a.id < b.id ? 1 : -1)),
            [...legacy].sort((a, b) => (a.id < b.id ? -1 : 1)),
          ]) {
            expect(JSON.stringify(build({ attendanceRuleConfigRows: permutation }))).toBe(reference);
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});

// The proposal is persisted into the tables Migration 1642 creates, whose ENUM columns will
// reject an out-of-set value with a hard error (or, worse, coerce it to '' under a non-strict
// sql_mode). Every enumerated value the builder can emit therefore has to be in the SQL's value
// set, and the two files are edited independently - so the check belongs in a test, not in a
// comment.
describe('the output maps onto Migration 1642', () => {
  const MIGRATION = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'sql', '1642_attendance_rule_migration_proposal.sql'),
    'utf-8',
  );

  function enumValues(pattern: RegExp): string[] {
    const match = pattern.exec(MIGRATION);
    expect(match, `enum not found for ${String(pattern)}`).toBeTruthy();
    return [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  }

  const proposal = build({
    attendanceRuleConfigRows: [
      ARC_GLOBAL_001,
      ARC_APR_OPS_EXEC,
      arcRow({ id: 'arc-1', designation_id: 'DSG-1', process_id: 'PRC-1', branch_id: 'BRN-1' }),
      arcRow({ id: 'arc-gap', designation_id: 'DSG-4', grace_minutes: null }),
    ],
    aprEligibilityConfigRows: [aprRow()],
  });

  it('emits only Attendance_Source values the enum admits', () => {
    const admitted = new Set(enumValues(/attendance_source\s+ENUM\(([^)]*)\)/));
    expect([...admitted].sort()).toEqual(['biometric', 'dialler']);
    for (const rule of proposal.sourceRules) {
      expect(admitted.has(rule.attendanceSource)).toBe(true);
    }
  });

  it('emits only Rule_Dimension names the dimension enum admits', () => {
    const admitted = new Set(enumValues(/dimension\s+ENUM\(([^)]*)\)/));
    const emitted = [...proposal.sourceRules, ...proposal.dayThresholdRules].flatMap((r) =>
      r.dimensionValues.map((d) => d.dimension),
    );
    expect(emitted.length).toBeGreaterThan(0);
    for (const dimension of emitted) {
      expect(admitted.has(dimension)).toBe(true);
    }
  });

  it('emits only legacy_table values the provenance enum admits', () => {
    const admitted = new Set(enumValues(/legacy_table\s+ENUM\(([^)]*)\)/));
    const emitted = [...proposal.sourceRules, ...proposal.dayThresholdRules].flatMap((r) =>
      r.sourceRows.map((s) => s.legacyTable),
    );
    expect(new Set(emitted).size).toBe(3);
    for (const table of emitted) {
      expect(admitted.has(table)).toBe(true);
    }
  });

  it('emits only severities the finding enum admits, and exercises all three', () => {
    const admitted = new Set(enumValues(/severity\s+ENUM\(([^)]*)\)/));
    for (const finding of proposal.findings) {
      expect(admitted.has(finding.severity)).toBe(true);
    }
    // arc-gap has no grace_minutes and the two unconstrained rows disagree, so this fixture
    // reaches decision_required and info. blocking comes from an unreadable feature-config key.
    expect(new Set(proposal.findings.map((f) => f.severity))).toEqual(
      new Set(['info', 'decision_required']),
    );
    expect(
      new Set(build({ featureConfig: {} }).findings.map((f) => f.severity)),
    ).toContain('blocking');
  });

  it('emits values that fit the declared column widths', () => {
    for (const rule of [...proposal.sourceRules, ...proposal.dayThresholdRules]) {
      // proposal_key CHAR(64), rule_name VARCHAR(255).
      expect(rule.proposalKey).toHaveLength(64);
      expect(rule.ruleName.length).toBeGreaterThan(0);
      expect(rule.ruleName.length).toBeLessThanOrEqual(255);
      // ordinal INT UNSIGNED NOT NULL.
      expect(rule.ordinal).toBeGreaterThan(0);
      for (const value of rule.dimensionValues) {
        // value_id VARCHAR(100).
        expect(value.valueId.length).toBeLessThanOrEqual(100);
      }
      for (const row of rule.sourceRows) {
        // legacy_row_id VARCHAR(100).
        expect(row.legacyRowId.length).toBeLessThanOrEqual(100);
      }
    }
    for (const finding of proposal.findings) {
      // finding_kind VARCHAR(64), subject_ref VARCHAR(255) NULL.
      expect(finding.findingKind.length).toBeLessThanOrEqual(64);
      expect((finding.subjectRef ?? '').length).toBeLessThanOrEqual(255);
    }
  });

  it('supplies SMALLINT UNSIGNED-safe minute counts on every threshold rule', () => {
    for (const rule of proposal.dayThresholdRules) {
      for (const minutes of [rule.fullDayMinutes, rule.halfDayMinutes, rule.graceMinutes]) {
        expect(Number.isInteger(minutes)).toBe(true);
        expect(minutes).toBeGreaterThanOrEqual(0);
        expect(minutes).toBeLessThanOrEqual(65535);
      }
    }
  });
});

describe('the builder stays pure', () => {
  // Executable statements only. The module's own header explains why it never calls new Date()
  // or randomUUID(), so a whole-file substring check would read the explanation as the thing
  // being explained and fail for the wrong reason.
  const CODE = readFileSync(join(__dirname, '..', 'attendance-rule-migration-proposal.ts'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  it('reads no database and imports nothing that opens a connection', () => {
    expect(CODE).not.toMatch(/from ['"][^'"]*\bdb\b/);
    expect(CODE).not.toMatch(/\bdb\.(execute|query)\b/);
    expect(CODE).not.toContain('getPool');
  });

  // A clock read would make the output of two runs over unchanged data differ, which is the one
  // thing criterion 15.11's reviewer relies on not happening. The Pay_Month is an argument for
  // exactly this reason.
  it('never reads a clock and mints no identifiers', () => {
    expect(CODE).not.toContain('new Date()');
    expect(CODE).not.toContain('Date.now(');
    expect(CODE).not.toContain('randomUUID');
  });
});
