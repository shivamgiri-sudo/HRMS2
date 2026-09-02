// backend/src/modules/wfm/__tests__/attendance-provenance.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MAX_DAILY_MINUTES,
  buildAttendanceProvenanceRecord,
  buildOperationalAuditEntry,
  buildRuleAuditEntry,
  buildUploadBatchAuditEntries,
  computeFieldDeltas,
  guardRuleAuditLogOperation,
  normalizeChangeReason,
  provenanceRecordDigest,
  reconcileAggregation,
  verifyFinalisedRunProvenance,
  verifyProvenanceCompleteness,
  type AttendanceProvenanceDraft,
  type AttendanceProvenanceRecord,
  type OperationalAuditEvent,
  type RuleAuditLogOperation,
} from '../attendance-provenance.js';
import { deriveCanonical, type Contribution } from '../canonical-productivity.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

// A biometric-resolved day with one corroborating Dialler_Source: 545 biometric minutes against
// 300 canonical productive minutes, under the 480-minute APR_Corroboration_Threshold.
const BASE: AttendanceProvenanceRecord = {
  employeeId: 'EMP-001',
  workDate: '2026-07-15',
  payMonth: '2026-07',
  resolvedAttendanceSource: 'biometric',
  decidingRuleId: 'rule-77',
  biometricMinutes: 545,
  canonicalProductiveMinutes: 300,
  canonicalProducingRule: 'interval_union',
  diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: 300 }],
  appliedCorroborationThresholdMinutes: 480,
  classification: 'present',
  processedAt: '2026-08-01T04:30:00.000Z',
};

const draftOf = (
  overrides: Partial<AttendanceProvenanceRecord> = {},
): AttendanceProvenanceDraft => ({ ...BASE, ...overrides });

const buildOrThrow = (
  overrides: Partial<AttendanceProvenanceRecord> = {},
): AttendanceProvenanceRecord => {
  const result = buildAttendanceProvenanceRecord(draftOf(overrides));
  if (!result.ok) throw new Error(`expected a record, got: ${result.refusal.message}`);
  return result.record;
};

const refusalOf = (
  overrides: Partial<AttendanceProvenanceRecord> = {},
): { code: string; codes: readonly string[]; fields: readonly string[]; message: string } => {
  const result = buildAttendanceProvenanceRecord(draftOf(overrides));
  if (result.ok) throw new Error('expected a refusal, got a record');
  return result.refusal;
};

// ── criterion 11.1: the Attendance_Provenance_Record ──────────────────────────────────────────

describe('buildAttendanceProvenanceRecord — every member criterion 11.1 names (criterion 11.1)', () => {
  it('assembles the whole record from the resolved inputs', () => {
    const record = buildOrThrow();
    expect(record).toEqual({
      employeeId: 'EMP-001',
      workDate: '2026-07-15',
      payMonth: '2026-07',
      resolvedAttendanceSource: 'biometric',
      decidingRuleId: 'rule-77',
      biometricMinutes: 545,
      canonicalProductiveMinutes: 300,
      canonicalProducingRule: 'interval_union',
      diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: 300 }],
      appliedCorroborationThresholdMinutes: 480,
      classification: 'present',
      processedAt: '2026-08-01T04:30:00.000Z',
    });
  });

  it('refuses rather than defaulting when ANY required member is absent', () => {
    // criterion 11.1 lists what the record carries; a defaulted field would be this module
    // inventing the evidence a salary register is proved with.
    const fields = Object.keys(BASE);
    expect(fields).toHaveLength(12);
    for (const field of fields) {
      const partial: Record<string, unknown> = { ...BASE };
      delete partial[field];
      // The compiler already refuses the omission; the cast is what an untyped JSON caller does.
      const result = buildAttendanceProvenanceRecord(partial as unknown as AttendanceProvenanceDraft);
      expect(result.ok, `omitting ${field} must be refused`).toBe(false);
      if (!result.ok) {
        expect(result.refusal.fields.join(' '), `refusal for ${field}`).toContain(field);
        // Ten of the twelve members are named by criterion 11.1 itself. The producing rule is
        // required by criterion 18.7 and needed by 11.7's reconciliation, so its refusal cites
        // those instead -- see the doc comment on AttendanceProvenanceRecord.
        expect(result.refusal.criteria, `criteria for ${field}`).toContain(
          field === 'canonicalProducingRule' ? '18.7' : '11.1',
        );
      }
    }
  });

  it('refuses a null draft instead of throwing', () => {
    const result = buildAttendanceProvenanceRecord(null as unknown as AttendanceProvenanceDraft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.code).toBe('required_field_missing');
  });

  it('does not re-derive the APR_Corroboration_Threshold when it is missing or unusable', () => {
    const missing = refusalOf({
      appliedCorroborationThresholdMinutes: undefined as unknown as number,
    });
    expect(missing.fields).toContain('appliedCorroborationThresholdMinutes');
    expect(missing.message).toContain('states what was applied');
    // criterion 5.5's 480 is applied at decision time, never re-manufactured here.
    for (const rejected of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(refusalOf({ appliedCorroborationThresholdMinutes: rejected }).code).toBe(
        'field_value_invalid',
      );
    }
    // A real applied value, including exactly the 480-minute boundary, is recorded as given.
    expect(buildOrThrow({ appliedCorroborationThresholdMinutes: 480 }).appliedCorroborationThresholdMinutes).toBe(480);
    expect(buildOrThrow({ appliedCorroborationThresholdMinutes: 420 }).appliedCorroborationThresholdMinutes).toBe(420);
  });

  it('refuses minutes that are not finite and non-negative, and never turns them into zero', () => {
    for (const junk of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(refusalOf({ biometricMinutes: junk }).fields).toContain('biometricMinutes');
      expect(refusalOf({ canonicalProductiveMinutes: junk }).fields).toContain(
        'canonicalProductiveMinutes',
      );
      const contribution = refusalOf({
        diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: junk }],
      });
      expect(contribution.fields.join(' ')).toContain('contributedMinutes');
    }
  });

  it('records a genuine zero on both feeds, because zero is a measurement and not an absence', () => {
    const record = buildOrThrow({
      biometricMinutes: 0,
      canonicalProductiveMinutes: 0,
      canonicalProducingRule: 'max_contribution',
      diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: 0 }],
      classification: 'absent',
    });
    expect(record.biometricMinutes).toBe(0);
    expect(record.canonicalProductiveMinutes).toBe(0);
    expect(reconcileAggregation(record).reconciles).toBe(true);
  });

  it('accepts Canonical_Productive_Minutes exactly at the daily bound and refuses one minute above it', () => {
    const atBound = buildOrThrow({
      canonicalProductiveMinutes: MAX_DAILY_MINUTES,
      diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: MAX_DAILY_MINUTES }],
    });
    expect(atBound.canonicalProductiveMinutes).toBe(1440);
    expect(
      refusalOf({
        canonicalProductiveMinutes: MAX_DAILY_MINUTES + 1,
        diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: 1441 }],
      }).code,
    ).toBe('canonical_minutes_exceed_daily_bound');
  });

  it('refuses two contributions claiming the same Dialler_Source', () => {
    const refusal = refusalOf({
      canonicalProductiveMinutes: 300,
      diallerSourceContributions: [
        { diallerSourceId: 'src-a', contributedMinutes: 120 },
        { diallerSourceId: 'src-a', contributedMinutes: 180 },
      ],
    });
    expect(refusal.code).toBe('duplicate_dialler_source_contribution');
    // The reason it matters: criterion 11.7 sums these figures.
    expect(refusal.message).toContain('11.7');
  });

  it('records many distinct Dialler_Sources on one date', () => {
    const record = buildOrThrow({
      canonicalProductiveMinutes: 600,
      diallerSourceContributions: [
        { diallerSourceId: 'src-a', contributedMinutes: 200 },
        { diallerSourceId: 'src-b', contributedMinutes: 250 },
        { diallerSourceId: 'src-c', contributedMinutes: 150.5 },
      ],
    });
    expect(record.diallerSourceContributions).toHaveLength(3);
    expect(reconcileAggregation(record).contributionSumMinutes).toBeCloseTo(600.5, 6);
  });

  it('records a biometric day with no dialler evidence at all (the common case)', () => {
    // 26,215 of 29,271 July 2026 biometric-source days carried no productivity figure (E7).
    const record = buildOrThrow({
      canonicalProductiveMinutes: null,
      canonicalProducingRule: null,
      diallerSourceContributions: [],
    });
    expect(record.canonicalProductiveMinutes).toBeNull();
    expect(record.diallerSourceContributions).toEqual([]);
    expect(reconcileAggregation(record).code).toBe('reconciled_absent');
  });

  it('records a dialler day with no biometric evidence', () => {
    const record = buildOrThrow({
      resolvedAttendanceSource: 'dialler',
      biometricMinutes: null,
      canonicalProductiveMinutes: 420,
      diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: 420 }],
    });
    expect(record.biometricMinutes).toBeNull();
    expect(record.canonicalProductiveMinutes).toBe(420);
  });

  it('refuses the two absent-versus-present contradictions on the productivity side', () => {
    expect(
      refusalOf({
        canonicalProductiveMinutes: null,
        canonicalProducingRule: null,
        diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: 300 }],
      }).code,
    ).toBe('absent_canonical_with_contributions');
    expect(
      refusalOf({ canonicalProductiveMinutes: 300, diallerSourceContributions: [] }).code,
    ).toBe('present_canonical_without_contributions');
  });

  it('refuses a producing rule that disagrees with whether a figure exists (criterion 18.7)', () => {
    expect(
      refusalOf({
        canonicalProductiveMinutes: null,
        diallerSourceContributions: [],
        canonicalProducingRule: 'interval_union',
      }).code,
    ).toBe('producing_rule_disagrees_with_canonical_state');
    expect(refusalOf({ canonicalProducingRule: null }).code).toBe(
      'producing_rule_disagrees_with_canonical_state',
    );
  });

  it('refuses dates and timestamps that name no real day', () => {
    expect(refusalOf({ workDate: '2026-02-31' }).fields).toContain('workDate');
    expect(refusalOf({ workDate: '15-07-2026' }).fields).toContain('workDate');
    expect(refusalOf({ payMonth: '2026-13' }).fields).toContain('payMonth');
    expect(refusalOf({ processedAt: 'yesterday' }).fields).toContain('processedAt');
    // A blank identifier is missing, not present.
    expect(refusalOf({ employeeId: '   ' }).fields).toContain('employeeId');
    expect(refusalOf({ decidingRuleId: '' }).fields).toContain('decidingRuleId');
  });

  it('collects every problem in one refusal rather than one per attempted write', () => {
    const refusal = refusalOf({
      employeeId: '',
      decidingRuleId: '',
      processedAt: 'not-a-date',
    });
    expect(refusal.codes.length).toBeGreaterThanOrEqual(3);
    expect(refusal.fields).toEqual(expect.arrayContaining(['employeeId', 'decidingRuleId', 'processedAt']));
  });

  it('returns a frozen record so a caller cannot edit it after it is built', () => {
    const record = buildOrThrow();
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.diallerSourceContributions)).toBe(true);
  });
});

describe('provenanceRecordDigest — the "unchanged" test of criterion 11.5', () => {
  it('does not depend on the order the contributions were retrieved in', () => {
    const forward = buildOrThrow({
      canonicalProductiveMinutes: 300,
      diallerSourceContributions: [
        { diallerSourceId: 'src-a', contributedMinutes: 100 },
        { diallerSourceId: 'src-b', contributedMinutes: 200 },
      ],
    });
    const reversed = buildOrThrow({
      canonicalProductiveMinutes: 300,
      diallerSourceContributions: [
        { diallerSourceId: 'src-b', contributedMinutes: 200 },
        { diallerSourceId: 'src-a', contributedMinutes: 100 },
      ],
    });
    expect(provenanceRecordDigest(reversed)).toBe(provenanceRecordDigest(forward));
  });

  it('changes when any recorded value changes', () => {
    const baseline = provenanceRecordDigest(buildOrThrow());
    const mutations: Partial<AttendanceProvenanceRecord>[] = [
      { employeeId: 'EMP-002' },
      { workDate: '2026-07-16' },
      { payMonth: '2026-08' },
      { resolvedAttendanceSource: 'dialler' },
      { decidingRuleId: 'rule-78' },
      { biometricMinutes: 546 },
      { canonicalProductiveMinutes: 301 },
      { canonicalProducingRule: 'max_contribution' },
      { diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: 301 }] },
      { appliedCorroborationThresholdMinutes: 481 },
      { classification: 'half_day' },
      { processedAt: '2026-08-01T04:30:01.000Z' },
    ];
    for (const mutation of mutations) {
      expect(provenanceRecordDigest(buildOrThrow(mutation)), JSON.stringify(mutation)).not.toBe(
        baseline,
      );
    }
  });
});

// ── criterion 11.2: the Rule_Audit_Log entry ─────────────────────────────────────────────────

const RULE_BEFORE = {
  attendance_source: 'biometric',
  effective_from: '2026-04-01',
  is_active: true,
} as const;

const RULE_AFTER = {
  attendance_source: 'dialler',
  effective_from: '2026-04-01',
  is_active: true,
} as const;

describe('buildRuleAuditEntry — acting user, timestamp, before, after and reason (criterion 11.2)', () => {
  it('records a rule creation, with every new field as a delta that had no prior value', () => {
    const result = buildRuleAuditEntry({
      subject: 'attendance_source_rule',
      subjectId: 'rule-77',
      action: 'create',
      actingUserId: 'user-9',
      recordedAt: '2026-08-01T05:00:00.000Z',
      priorFieldValues: {},
      newFieldValues: RULE_AFTER,
      changeReason: 'New process onboarded on the dialler.',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.actingUserId).toBe('user-9');
    expect(result.entry.recordedAt).toBe('2026-08-01T05:00:00.000Z');
    expect(result.entry.priorFieldValues).toEqual({});
    expect(result.entry.newFieldValues).toEqual(RULE_AFTER);
    expect(result.entry.fieldDeltas).toHaveLength(3);
    expect(result.entry.fieldDeltas.every((delta) => delta.priorPresent === false)).toBe(true);
  });

  it('records an amendment with a real field-level before and after', () => {
    const result = buildRuleAuditEntry({
      subject: 'attendance_source_rule',
      subjectId: 'rule-77',
      action: 'amend',
      actingUserId: 'user-9',
      recordedAt: '2026-08-02T05:00:00.000Z',
      priorFieldValues: RULE_BEFORE,
      newFieldValues: RULE_AFTER,
      changeReason: 'Client moved the process to APR corroboration.',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.fieldDeltas).toEqual([
      {
        field: 'attendance_source',
        priorValue: 'biometric',
        newValue: 'dialler',
        priorPresent: true,
        newPresent: true,
      },
    ]);
  });

  it('refuses an amendment whose prior and new values are identical', () => {
    const result = buildRuleAuditEntry({
      subject: 'attendance_source_rule',
      subjectId: 'rule-77',
      action: 'amend',
      actingUserId: 'user-9',
      recordedAt: '2026-08-02T05:00:00.000Z',
      priorFieldValues: RULE_BEFORE,
      newFieldValues: { ...RULE_BEFORE },
      changeReason: 'Tidying up.',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('amendment_records_no_field_change');
    expect(result.refusal.criteria).toContain('11.2');
  });

  it('refuses a change reason that is blank after whitespace normalisation', () => {
    // The last two are a no-break space and a zero-width space: invisible, and not a stated
    // reason. Written as escapes so no irregular whitespace appears in this file.
    for (const reason of ['', '   ', '\t\n', '\u00A0\u00A0', '\u200B', null, undefined]) {
      const result = buildRuleAuditEntry({
        subject: 'dialler_source',
        subjectId: 'src-a',
        action: 'deactivate',
        actingUserId: 'user-9',
        recordedAt: '2026-08-02T05:00:00.000Z',
        priorFieldValues: { is_active: true },
        newFieldValues: { is_active: false },
        changeReason: reason as unknown as string,
      });
      expect(result.ok, JSON.stringify(reason)).toBe(false);
      if (!result.ok) expect(result.refusal.codes).toContain('change_reason_blank');
    }
  });

  it('normalises the accepted reason without imposing a minimum length', () => {
    expect(normalizeChangeReason('  Client\u200B   asked\n\nfor  it ')).toBe('Client asked for it');
    const result = buildRuleAuditEntry({
      subject: 'dialler_source',
      subjectId: 'src-a',
      action: 'deactivate',
      actingUserId: 'user-9',
      recordedAt: '2026-08-02T05:00:00.000Z',
      priorFieldValues: { is_active: true },
      newFieldValues: { is_active: false },
      changeReason: '  Vendor   contract ended.  ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.changeReason).toBe('Vendor contract ended.');
  });

  it('refuses an amendment or a deactivation that carries no prior field values', () => {
    for (const action of ['amend', 'deactivate'] as const) {
      const result = buildRuleAuditEntry({
        subject: 'attendance_source_rule',
        subjectId: 'rule-77',
        action,
        actingUserId: 'user-9',
        recordedAt: '2026-08-02T05:00:00.000Z',
        priorFieldValues: {},
        newFieldValues: { is_active: false },
        changeReason: 'Retired.',
      });
      expect(result.ok, action).toBe(false);
      if (!result.ok) expect(result.refusal.codes).toContain('prior_field_values_required');
    }
  });

  it('refuses an entry with no new field values, and one whose values are not recordable scalars', () => {
    const noNew = buildRuleAuditEntry({
      subject: 'attendance_source_rule',
      subjectId: 'rule-77',
      action: 'create',
      actingUserId: 'user-9',
      recordedAt: '2026-08-02T05:00:00.000Z',
      priorFieldValues: {},
      newFieldValues: {},
      changeReason: 'Created.',
    });
    expect(noNew.ok).toBe(false);
    if (!noNew.ok) expect(noNew.refusal.codes).toContain('new_field_values_required');

    const notScalar = buildRuleAuditEntry({
      subject: 'attendance_source_rule',
      subjectId: 'rule-77',
      action: 'create',
      actingUserId: 'user-9',
      recordedAt: '2026-08-02T05:00:00.000Z',
      priorFieldValues: {},
      newFieldValues: { dimensions: { branchId: 4 } } as unknown as Record<string, string>,
      changeReason: 'Created.',
    });
    expect(notScalar.ok).toBe(false);
    if (!notScalar.ok) expect(notScalar.refusal.fields).toContain('newFieldValues');
  });

  it('requires the acting user and a timestamp that names a real day', () => {
    const result = buildRuleAuditEntry({
      subject: 'attendance_source_rule',
      subjectId: 'rule-77',
      action: 'create',
      actingUserId: '  ',
      recordedAt: '2026-02-31T05:00:00.000Z',
      priorFieldValues: {},
      newFieldValues: RULE_AFTER,
      changeReason: 'Created.',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.fields).toEqual(expect.arrayContaining(['actingUserId', 'recordedAt']));
    }
  });

  it('records a Dialler_Source registration as well as a rule', () => {
    const result = buildRuleAuditEntry({
      subject: 'dialler_source',
      subjectId: 'src-b',
      action: 'create',
      actingUserId: 'user-9',
      recordedAt: '2026-08-02T05:00:00.000Z',
      priorFieldValues: {},
      newFieldValues: { source_name: 'Ameyo', is_active: true },
      changeReason: 'New dialler onboarded.',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.subject).toBe('dialler_source');
  });
});

describe('computeFieldDeltas — added, removed and changed fields (criterion 11.2)', () => {
  it('reports an added field, a removed field and a changed value, and omits unchanged ones', () => {
    const deltas = computeFieldDeltas(
      { kept: 'same', changed: 1, removed: true },
      { kept: 'same', changed: 2, added: null },
    );
    expect(deltas.map((delta) => delta.field)).toEqual(['added', 'changed', 'removed']);
    expect(deltas.find((delta) => delta.field === 'added')).toMatchObject({
      priorPresent: false,
      newPresent: true,
    });
    expect(deltas.find((delta) => delta.field === 'removed')).toMatchObject({
      priorPresent: true,
      newPresent: false,
    });
  });

  it('treats a value moving to or from NULL as a change, not as an absence', () => {
    expect(computeFieldDeltas({ effective_to: null }, { effective_to: '2026-09-30' })).toHaveLength(1);
    expect(computeFieldDeltas({ effective_to: '2026-09-30' }, { effective_to: null })).toHaveLength(1);
    expect(computeFieldDeltas({ effective_to: null }, { effective_to: null })).toHaveLength(0);
  });
});

// ── criterion 11.3: append-only ───────────────────────────────────────────────────────────────

describe('guardRuleAuditLogOperation — the Rule_Audit_Log is append-only (criterion 11.3)', () => {
  const existing = { entryId: 'audit-1001', recordedAt: '2026-08-02T05:00:00.000Z' };

  it('refuses a modification and a deletion of an existing entry, and names the remedy', () => {
    for (const operation of ['amend_in_place', 'delete'] as const) {
      const verdict = guardRuleAuditLogOperation(existing, { operation });
      expect(verdict.permitted, operation).toBe(false);
      if (verdict.permitted) return;
      expect(verdict.refusal.code).toBe('audit_log_entry_is_immutable');
      expect(verdict.refusal.criteria).toEqual(['11.3']);
      expect(verdict.refusal.message).toContain('audit-1001');
      expect(verdict.remedy).toBe('append_a_new_entry');
    }
  });

  it('permits appending alongside an existing entry, which leaves that entry untouched', () => {
    const verdict = guardRuleAuditLogOperation(existing, { operation: 'append' });
    expect(verdict.permitted).toBe(true);
    if (verdict.permitted) expect(verdict.existingEntryId).toBe('audit-1001');
  });

  it('is total: an unknown or missing operation is refused rather than thrown on', () => {
    const verdict = guardRuleAuditLogOperation(existing, {
      operation: 'upsert' as unknown as RuleAuditLogOperation,
    });
    expect(verdict.permitted).toBe(false);
    const noRequest = guardRuleAuditLogOperation(
      existing,
      null as unknown as { operation: RuleAuditLogOperation },
    );
    expect(noRequest.permitted).toBe(false);
  });

  it('property: append is the only operation ever permitted, whatever the entry says', () => {
    // Feature: payroll-attendance-source-rules, Requirement 11 acceptance criterion 11.3 —
    // "THE Rule_Audit_Log SHALL reject any request to modify or delete an existing log entry."
    // **Validates: Requirements 11.3**
    fc.assert(
      fc.property(
        fc.record({
          entryId: fc.uuid(),
          recordedAt: fc.constantFrom('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.000Z'),
        }),
        fc.constantFrom<RuleAuditLogOperation>('append', 'amend_in_place', 'delete'),
        (entry, operation) => {
          const verdict = guardRuleAuditLogOperation(entry, { operation });
          expect(verdict.permitted).toBe(operation === 'append');
          if (!verdict.permitted) expect(verdict.refusal.criteria).toEqual(['11.3']);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ── criterion 11.4: review, adjustment and upload audit entries ───────────────────────────────

const EVENTS: readonly OperationalAuditEvent[] = [
  'review_outcome_recorded',
  'adjustment_requested',
  'adjustment_approved',
  'adjustment_rejected',
  'upload_batch_submitted',
];

describe('buildOperationalAuditEntry — acting user, acting ROLE, timestamp, employee and date (criterion 11.4)', () => {
  const base = {
    actingUserId: 'user-9',
    actingRole: 'wfm_reviewer',
    recordedAt: '2026-08-02T05:00:00.000Z',
    employeeId: 'EMP-001',
    workDate: '2026-07-15',
    subjectId: 'variance-42',
  };

  it('records all five events criterion 11.4 names, carrying the acting role', () => {
    for (const event of EVENTS) {
      const result = buildOperationalAuditEntry({ ...base, event });
      expect(result.ok, event).toBe(true);
      if (result.ok) {
        expect(result.entry.actingRole).toBe('wfm_reviewer');
        expect(result.entry.actingUserId).toBe('user-9');
        expect(result.entry.employeeId).toBe('EMP-001');
        expect(result.entry.workDate).toBe('2026-07-15');
      }
    }
  });

  it('refuses an entry that names the acting user but not the acting role', () => {
    for (const role of ['', '   ', null, undefined]) {
      const result = buildOperationalAuditEntry({
        ...base,
        event: 'adjustment_approved',
        actingRole: role as unknown as string,
      });
      expect(result.ok, JSON.stringify(role)).toBe(false);
      if (!result.ok) {
        expect(result.refusal.fields).toContain('actingRole');
        expect(result.refusal.criteria).toEqual(['11.4']);
      }
    }
  });

  it('requires the affected employee and date, and a real timestamp', () => {
    const result = buildOperationalAuditEntry({
      ...base,
      event: 'adjustment_rejected',
      employeeId: '',
      workDate: '2026-02-31',
      recordedAt: 'whenever',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.fields).toEqual(
        expect.arrayContaining(['recordedAt', 'employeeId', 'workDate']),
      );
    }
  });

  it('accepts an explicitly null subject identifier but refuses a blank one', () => {
    const withNull = buildOperationalAuditEntry({
      ...base,
      event: 'review_outcome_recorded',
      subjectId: null,
    });
    expect(withNull.ok).toBe(true);
    const withBlank = buildOperationalAuditEntry({
      ...base,
      event: 'review_outcome_recorded',
      subjectId: '  ',
    });
    expect(withBlank.ok).toBe(false);
  });
});

describe('buildUploadBatchAuditEntries — one entry per affected employee-date (criterion 11.4)', () => {
  const submission = {
    actingUserId: 'user-12',
    actingRole: 'upload_submitter',
    recordedAt: '2026-08-02T06:00:00.000Z',
    uploadBatchId: 'batch-7',
  };

  it('fans a batch out so every affected employee and date is recorded', () => {
    const result = buildUploadBatchAuditEntries(submission, [
      { employeeId: 'EMP-001', workDate: '2026-07-15' },
      { employeeId: 'EMP-002', workDate: '2026-07-15' },
      { employeeId: 'EMP-001', workDate: '2026-07-16' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(3);
    expect(result.entries.every((entry) => entry.event === 'upload_batch_submitted')).toBe(true);
    expect(result.entries.every((entry) => entry.subjectId === 'batch-7')).toBe(true);
    expect(result.entries.every((entry) => entry.actingRole === 'upload_submitter')).toBe(true);
  });

  it('refuses a submission that names no affected employee-date', () => {
    const empty = buildUploadBatchAuditEntries(submission, []);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.refusal.code).toBe('no_affected_employee_dates');
  });

  it('names the offending index when one affected target is incomplete', () => {
    const result = buildUploadBatchAuditEntries(submission, [
      { employeeId: 'EMP-001', workDate: '2026-07-15' },
      { employeeId: '', workDate: 'not-a-date' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.fields.join(' ')).toContain('affected[1]');
  });
});

// ── criterion 11.5: retrievable and unchanged after finalisation ──────────────────────────────

describe('verifyFinalisedRunProvenance — retrievable and unchanged (criterion 11.5)', () => {
  const dates = ['2026-07-15', '2026-07-16', '2026-07-17'];
  const records = dates.map((workDate) => buildOrThrow({ workDate }));
  const baseline = Object.fromEntries(
    records.map((record) => [record.workDate, provenanceRecordDigest(record)]),
  );

  it('holds when every contributing date is retrievable and digests to its baseline', () => {
    const verdict = verifyFinalisedRunProvenance({
      employeeId: 'EMP-001',
      payMonth: '2026-07',
      payableDayDates: dates,
      retrievedRecords: records,
      digestsAtFinalisation: baseline,
    });
    expect(verdict.holds).toBe(true);
    expect(verdict.contributingDateCount).toBe(3);
    expect(verdict.retrievableDateCount).toBe(3);
    expect(verdict.missingDates).toEqual([]);
    expect(verdict.alteredDates).toEqual([]);
  });

  it('fails and names a contributing date whose record is no longer retrievable', () => {
    const verdict = verifyFinalisedRunProvenance({
      employeeId: 'EMP-001',
      payMonth: '2026-07',
      payableDayDates: dates,
      retrievedRecords: records.slice(1),
      digestsAtFinalisation: baseline,
    });
    expect(verdict.holds).toBe(false);
    expect(verdict.missingDates).toEqual(['2026-07-15']);
  });

  it('fails and names a contributing date whose record changed after finalisation', () => {
    const altered = [buildOrThrow({ workDate: '2026-07-16', biometricMinutes: 300 }), records[0], records[2]];
    const verdict = verifyFinalisedRunProvenance({
      employeeId: 'EMP-001',
      payMonth: '2026-07',
      payableDayDates: dates,
      retrievedRecords: altered,
      digestsAtFinalisation: baseline,
    });
    expect(verdict.holds).toBe(false);
    expect(verdict.alteredDates).toEqual(['2026-07-16']);
  });

  it('fails when a contributing date has no finalisation baseline to be unchanged against', () => {
    const verdict = verifyFinalisedRunProvenance({
      employeeId: 'EMP-001',
      payMonth: '2026-07',
      payableDayDates: dates,
      retrievedRecords: records,
      digestsAtFinalisation: { '2026-07-15': baseline['2026-07-15'] },
    });
    expect(verdict.holds).toBe(false);
    expect(verdict.datesWithoutFinalisationDigest).toEqual(['2026-07-16', '2026-07-17']);
  });

  it('ignores another employee rows that reach the input, and counts them', () => {
    const verdict = verifyFinalisedRunProvenance({
      employeeId: 'EMP-001',
      payMonth: '2026-07',
      payableDayDates: dates,
      retrievedRecords: [...records, buildOrThrow({ employeeId: 'EMP-999', workDate: '2026-07-18' })],
      digestsAtFinalisation: baseline,
    });
    expect(verdict.holds).toBe(true);
    expect(verdict.unrelatedRecordCount).toBe(1);
  });

  it('counts a duplicated contributing date once', () => {
    const verdict = verifyFinalisedRunProvenance({
      employeeId: 'EMP-001',
      payMonth: '2026-07',
      payableDayDates: [...dates, '2026-07-15'],
      retrievedRecords: records,
      digestsAtFinalisation: baseline,
    });
    expect(verdict.contributingDateCount).toBe(3);
    expect(verdict.holds).toBe(true);
  });
});

// ── criterion 11.6: PROPERTY — provenance completeness ────────────────────────────────────────

const dateOf = (day: number): string => `2026-07-${String(day).padStart(2, '0')}`;

describe('Requirement 11 — Property: provenance completeness (criterion 11.6)', () => {
  it('for any employee and Pay_Month, the count of dates carrying a record equals the count of dates contributing to Payable_Days', () => {
    // Feature: payroll-attendance-source-rules, Requirement 11 acceptance criterion 11.6 —
    // "FOR ALL employees and Pay_Months, the count of dates carrying an
    // Attendance_Provenance_Record SHALL equal the count of dates contributing to that employee's
    // Payable_Days for that Pay_Month (provenance completeness property)."
    // **Validates: Requirements 11.6**
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uniqueArray(fc.integer({ min: 1, max: 31 }), { minLength: 0, maxLength: 31 }),
        // A record is written for a mixture of day shapes, so completeness is not an artefact of
        // every date looking the same: some days carry dialler evidence, some carry none.
        fc.array(fc.boolean(), { minLength: 31, maxLength: 31 }),
        (employeeId, days, withEvidence) => {
          const payableDayDates = days.map(dateOf);
          const provenanceRecords = days.map((day, index) =>
            buildOrThrow(
              withEvidence[index]
                ? { employeeId, workDate: dateOf(day) }
                : {
                    employeeId,
                    workDate: dateOf(day),
                    canonicalProductiveMinutes: null,
                    canonicalProducingRule: null,
                    diallerSourceContributions: [],
                  },
            ),
          );

          const verdict = verifyProvenanceCompleteness({
            employeeId,
            payMonth: '2026-07',
            payableDayDates,
            provenanceRecords,
          });

          expect(verdict.provenanceDateCount).toBe(verdict.payableDayDateCount);
          expect(verdict.provenanceDateCount).toBe(days.length);
          expect(verdict.complete).toBe(true);
          expect(verdict.datesMissingProvenance).toEqual([]);
          expect(verdict.provenanceDatesNotContributing).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('for any dropped subset of contributing dates, completeness fails and names exactly those dates', () => {
    // Feature: payroll-attendance-source-rules, Requirement 11 acceptance criterion 11.6 — the
    // other direction: the property must be able to FAIL, and must name what is missing.
    // **Validates: Requirements 11.6**
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.integer({ min: 1, max: 31 }), { minLength: 2, maxLength: 31 })
          .chain((days) =>
            fc.subarray(days, { minLength: 1 }).map((dropped) => ({ days, dropped })),
          ),
        ({ days, dropped }) => {
          const written = days.filter((day) => !dropped.includes(day));
          const verdict = verifyProvenanceCompleteness({
            employeeId: 'EMP-001',
            payMonth: '2026-07',
            payableDayDates: days.map(dateOf),
            provenanceRecords: written.map((day) => buildOrThrow({ workDate: dateOf(day) })),
          });

          expect(verdict.complete).toBe(false);
          expect(verdict.payableDayDateCount).toBe(days.length);
          expect(verdict.provenanceDateCount).toBe(written.length);
          expect([...verdict.datesMissingProvenance].sort()).toEqual(
            [...dropped].map(dateOf).sort(),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('counts a date once however many records it carries, and excludes other employees and Pay_Months', () => {
    const verdict = verifyProvenanceCompleteness({
      employeeId: 'EMP-001',
      payMonth: '2026-07',
      payableDayDates: ['2026-07-15', '2026-07-15', '2026-07-16'],
      provenanceRecords: [
        buildOrThrow({ workDate: '2026-07-15' }),
        buildOrThrow({ workDate: '2026-07-15', biometricMinutes: 400 }),
        buildOrThrow({ workDate: '2026-07-16' }),
        buildOrThrow({ workDate: '2026-07-17', employeeId: 'EMP-002' }),
        buildOrThrow({ workDate: '2026-08-01', payMonth: '2026-08' }),
      ],
    });
    expect(verdict.payableDayDateCount).toBe(2);
    expect(verdict.provenanceDateCount).toBe(2);
    expect(verdict.complete).toBe(true);
  });

  it('names a record written for a date that contributes nothing', () => {
    const verdict = verifyProvenanceCompleteness({
      employeeId: 'EMP-001',
      payMonth: '2026-07',
      payableDayDates: ['2026-07-15'],
      provenanceRecords: [
        buildOrThrow({ workDate: '2026-07-15' }),
        buildOrThrow({ workDate: '2026-07-16' }),
      ],
    });
    expect(verdict.complete).toBe(false);
    expect(verdict.provenanceDatesNotContributing).toEqual(['2026-07-16']);
  });

  it('is complete for an employee with no contributing date and no record', () => {
    const verdict = verifyProvenanceCompleteness({
      employeeId: 'EMP-001',
      payMonth: '2026-07',
      payableDayDates: [],
      provenanceRecords: [],
    });
    expect(verdict.complete).toBe(true);
    expect(verdict.payableDayDateCount).toBe(0);
  });
});

// ── criterion 11.7: PROPERTY — aggregation traceability ───────────────────────────────────────

// Requirement 18's aggregation is NOT a plain sum: criterion 18.3 forbids summing net login
// across concurrent sessions outright, criterion 18.4 makes the primary rule the union of the
// session intervals, and criterion 18.6 makes the mandatory secondary rule the maximum single
// contribution. These generators therefore build the contribution set, hand it to
// canonical-productivity.ts (which owns the derivation) and record whatever it produced -- so the
// property below tests a record produced by Requirement 18's own rule, not by a re-implementation
// of it inside the test.
interface GeneratedSession {
  readonly sourceIndex: number;
  readonly interval: { readonly startMinute: number; readonly endMinute: number } | null;
  readonly fallbackMinutes: number;
}

const sessionArb: fc.Arbitrary<GeneratedSession> = fc.record({
  sourceIndex: fc.integer({ min: 0, max: 5 }),
  interval: fc.option(
    fc
      .tuple(fc.integer({ min: 0, max: 1200 }), fc.integer({ min: 1, max: 240 }))
      .map(([startMinute, length]) => ({ startMinute, endMinute: startMinute + length })),
    { nil: null },
  ),
  // Only read when the interval is absent (a manual upload carries login minutes and no logout).
  fallbackMinutes: fc.integer({ min: 0, max: 600 }),
});

// One contribution per Dialler_Source, which is what criterion 11.1 records.
const contributionSetArb: fc.Arbitrary<Contribution[]> = fc
  .uniqueArray(sessionArb, { selector: (session) => session.sourceIndex, maxLength: 6 })
  .map((sessions) =>
    sessions.map((session) => ({
      diallerSourceId: `src-${String(session.sourceIndex)}`,
      interval: session.interval === null ? null : { ...session.interval },
      magnitudeMinutes:
        session.interval === null
          ? session.fallbackMinutes
          : session.interval.endMinute - session.interval.startMinute,
    })),
  );

const recordFromContributions = (contributions: Contribution[]): AttendanceProvenanceRecord => {
  const canonical = deriveCanonical(contributions);
  return buildOrThrow({
    canonicalProductiveMinutes: canonical.minutes,
    canonicalProducingRule: canonical.rule,
    diallerSourceContributions: contributions.map((contribution) => ({
      diallerSourceId: contribution.diallerSourceId,
      contributedMinutes: contribution.magnitudeMinutes,
    })),
  });
};

describe('Requirement 11 — Property: aggregation traceability (criterion 11.7)', () => {
  it('for any contribution set, the recorded figure reconciles to the contributions under Requirement 18 rule', () => {
    // Feature: payroll-attendance-source-rules, Requirement 11 acceptance criterion 11.7 —
    // "FOR ALL Attendance_Provenance_Records, the sum of the recorded per-Dialler_Source
    // contributions SHALL reconcile to the recorded Canonical_Productive_Minutes under the
    // aggregation rule of Requirement 18 (aggregation traceability property)."
    // **Validates: Requirements 11.7**
    //
    // NOT "sum equals canonical". Criterion 18.3 forbids that arithmetic explicitly. The
    // reconciliation asserted is the one Requirement 18 actually states: an exact equality under
    // the secondary rule of 18.6, and the joint bounds of 18.11, 18.12 and 18.14 under the
    // interval-union rule of 18.4.
    fc.assert(
      fc.property(contributionSetArb, (contributions) => {
        const record = recordFromContributions(contributions);
        const traceability = reconcileAggregation(record);

        expect(traceability.reconciles).toBe(true);
        if (contributions.length === 0) {
          expect(traceability.code).toBe('reconciled_absent');
          expect(record.canonicalProductiveMinutes).toBeNull();
          return;
        }
        expect(traceability.code).toBe(
          record.canonicalProducingRule === 'max_contribution'
            ? 'reconciled_max_contribution'
            : 'reconciled_within_union_bounds',
        );
      }),
      { numRuns: 500 },
    );
  });

  it('for any contribution set, the recorded figure is at most the bounded sum and at least the largest contribution', () => {
    // Feature: payroll-attendance-source-rules, Requirement 11 acceptance criterion 11.7, read
    // through Requirement 18 criteria 18.11 (daily bound), 18.12 (no shrinkage) and 18.14 (no
    // inflation) — the three relations that make the reconciliation checkable from minutes alone.
    // **Validates: Requirements 11.7**
    fc.assert(
      fc.property(contributionSetArb, (contributions) => {
        const record = recordFromContributions(contributions);
        const traceability = reconcileAggregation(record);
        const canonical = record.canonicalProductiveMinutes;
        if (canonical === null) {
          expect(contributions).toHaveLength(0);
          return;
        }
        expect(canonical).toBeLessThanOrEqual(traceability.contributionSumMinutes);
        expect(canonical).toBeLessThanOrEqual(MAX_DAILY_MINUTES);
        expect(canonical).toBeGreaterThanOrEqual(traceability.lowerBoundMinutes);
        if (record.canonicalProducingRule === 'max_contribution') {
          expect(canonical).toBe(traceability.lowerBoundMinutes);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('witnesses why a plain sum is the wrong property: overlapping sessions do not add up', () => {
    // criterion 18.3: 8,638 of 36,594 employee-days carry more than one row, and naive summation
    // produced 218 employee-days over 24 hours. Two overlapping eight-hour sessions sum to 960
    // minutes and reconcile to 720.
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 480 }, magnitudeMinutes: 480 },
      { diallerSourceId: 'src-b', interval: { startMinute: 240, endMinute: 720 }, magnitudeMinutes: 480 },
    ];
    const record = recordFromContributions(contributions);
    expect(record.canonicalProducingRule).toBe('interval_union');
    expect(record.canonicalProductiveMinutes).toBe(720);

    const traceability = reconcileAggregation(record);
    expect(traceability.reconciles).toBe(true);
    expect(traceability.contributionSumMinutes).toBe(960);
    // The sum is NOT the canonical figure. A property asserting equality would fail here, and
    // asserting it would be asserting the arithmetic criterion 18.3 forbids.
    expect(record.canonicalProductiveMinutes).not.toBe(traceability.contributionSumMinutes);

    // Stated honestly: a record claiming the plain sum sits exactly ON the upper bound, so the
    // bounds cannot reject it -- a day whose sessions genuinely do not overlap has a union equal
    // to the sum, and minutes alone cannot tell the two apart. That is canonical-productivity.ts's
    // derivation to get right (criterion 18.13), not this reconciliation's to detect.
    const claimingTheSum = buildOrThrow({
      canonicalProductiveMinutes: 960,
      canonicalProducingRule: 'interval_union',
      diallerSourceContributions: [
        { diallerSourceId: 'src-a', contributedMinutes: 480 },
        { diallerSourceId: 'src-b', contributedMinutes: 480 },
      ],
    });
    expect(reconcileAggregation(claimingTheSum).reconciles).toBe(true);
    // One minute above the sum is rejected, because nothing can inflate past its own inputs.
    const claimingMore = buildOrThrow({
      canonicalProductiveMinutes: 961,
      canonicalProducingRule: 'interval_union',
      diallerSourceContributions: [
        { diallerSourceId: 'src-a', contributedMinutes: 480 },
        { diallerSourceId: 'src-b', contributedMinutes: 480 },
      ],
    });
    expect(reconcileAggregation(claimingMore).code).toBe('violates_no_inflation');
  });

  it('requires an exact maximum under the secondary rule of criterion 18.6', () => {
    const contributions = [
      { diallerSourceId: 'src-a', contributedMinutes: 300 },
      { diallerSourceId: 'src-b', contributedMinutes: 445 },
    ];
    const exact = buildOrThrow({
      canonicalProductiveMinutes: 445,
      canonicalProducingRule: 'max_contribution',
      diallerSourceContributions: contributions,
    });
    expect(reconcileAggregation(exact).code).toBe('reconciled_max_contribution');

    for (const wrong of [444, 446, 745]) {
      const off = buildOrThrow({
        canonicalProductiveMinutes: wrong,
        canonicalProducingRule: 'max_contribution',
        diallerSourceContributions: contributions,
      });
      expect(reconcileAggregation(off).code, String(wrong)).toBe('violates_max_contribution_rule');
    }
  });

  it('rejects a figure below the largest single contribution', () => {
    const record = buildOrThrow({
      canonicalProductiveMinutes: 200,
      canonicalProducingRule: 'interval_union',
      diallerSourceContributions: [
        { diallerSourceId: 'src-a', contributedMinutes: 300 },
        { diallerSourceId: 'src-b', contributedMinutes: 100 },
      ],
    });
    expect(reconcileAggregation(record).code).toBe('violates_no_shrinkage');
  });

  it('reconciles a single Dialler_Source as an exact equality, both bounds coinciding', () => {
    const record = buildOrThrow({
      canonicalProductiveMinutes: 480,
      canonicalProducingRule: 'interval_union',
      diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: 480 }],
    });
    const traceability = reconcileAggregation(record);
    expect(traceability.reconciles).toBe(true);
    expect(traceability.lowerBoundMinutes).toBe(480);
    expect(traceability.upperBoundMinutes).toBe(480);
    // One minute either side of the single contribution fails.
    expect(
      reconcileAggregation({ ...record, canonicalProductiveMinutes: 479 }).code,
    ).toBe('violates_no_shrinkage');
    expect(
      reconcileAggregation({ ...record, canonicalProductiveMinutes: 481 }).code,
    ).toBe('violates_no_inflation');
  });

  it('reconciles at the 480-minute APR_Corroboration_Threshold boundary', () => {
    // The threshold is not part of the reconciliation, and the boundary day must still reconcile:
    // three sources contributing exactly 480 minutes between them.
    const record = buildOrThrow({
      biometricMinutes: 480,
      canonicalProductiveMinutes: 480,
      canonicalProducingRule: 'interval_union',
      appliedCorroborationThresholdMinutes: 480,
      diallerSourceContributions: [
        { diallerSourceId: 'src-a', contributedMinutes: 160 },
        { diallerSourceId: 'src-b', contributedMinutes: 160 },
        { diallerSourceId: 'src-c', contributedMinutes: 160 },
      ],
    });
    const traceability = reconcileAggregation(record);
    expect(traceability.reconciles).toBe(true);
    expect(traceability.contributionSumMinutes).toBe(480);
    expect(traceability.upperBoundMinutes).toBe(480);
  });

  it('reports both absent-versus-present contradictions on a record read back from storage', () => {
    // The builder refuses these, so they can only arrive from a row written before the builder
    // existed or by a caller bypassing it -- which is exactly when a reconciliation report is the
    // thing that catches them.
    const withoutContributions: AttendanceProvenanceRecord = {
      ...BASE,
      canonicalProductiveMinutes: 300,
      diallerSourceContributions: [],
    };
    expect(reconcileAggregation(withoutContributions).code).toBe(
      'contradiction_present_canonical_without_contributions',
    );

    const absentWithContributions: AttendanceProvenanceRecord = {
      ...BASE,
      canonicalProductiveMinutes: null,
      canonicalProducingRule: null,
    };
    expect(reconcileAggregation(absentWithContributions).code).toBe(
      'contradiction_absent_canonical_with_contributions',
    );

    const noRule: AttendanceProvenanceRecord = { ...BASE, canonicalProducingRule: null };
    expect(reconcileAggregation(noRule).code).toBe('producing_rule_missing');

    const overBound: AttendanceProvenanceRecord = {
      ...BASE,
      canonicalProductiveMinutes: 1441,
      diallerSourceContributions: [{ diallerSourceId: 'src-a', contributedMinutes: 2000 }],
    };
    expect(reconcileAggregation(overBound).code).toBe('violates_daily_bound');
  });

  it('reconciles the absent state, and an empty contribution list is not a zero', () => {
    const record = buildOrThrow({
      canonicalProductiveMinutes: null,
      canonicalProducingRule: null,
      diallerSourceContributions: [],
    });
    const traceability = reconcileAggregation(record);
    expect(traceability.code).toBe('reconciled_absent');
    expect(traceability.recordedCanonicalProductiveMinutes).toBeNull();
    expect(traceability.largestContributionMinutes).toBeNull();
    expect(traceability.contributionSumMinutes).toBe(0);
  });
});
