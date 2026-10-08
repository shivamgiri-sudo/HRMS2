//
// Requirement 11 (Attendance Provenance And Audit Trail) of requirements.md, implemented as PURE
// functions over inputs the attendance engine, the review workflow and the rule administration
// screen already hold.
//
// Same shape as attendance-source-rule-resolver.ts, canonical-productivity.ts,
// attendance-variance.ts and variance-review.ts: no database import, no `db.execute`, no
// `new Date()`, no `randomUUID()`, no fs, no network. Every timestamp arrives as an argument,
// because criterion 11.1 records the PROCESSING timestamp and criteria 11.2 / 11.4 record the
// timestamp of an action that has already happened -- neither is "now at the moment the builder
// runs". Nothing here writes anywhere; every function returns a plain value describing what the
// caller should persist or refuse to persist.
//
// TOTALITY. No function here throws, for any input. A missing field, a blank change reason, an
// amendment that changes nothing and a request to mutate an existing log entry are all RETURNED
// as typed refusals, because criterion 11.3's refusal is itself an auditable event and an
// exception is the one shape that loses it.
//
// THREE STRUCTURAL GUARANTEES, enforced by the compiler rather than by comment:
//
//  1. Criterion 11.1, completeness. Every member of `AttendanceProvenanceRecord` is required and
//     non-optional, and `buildAttendanceProvenanceRecord` re-checks each one at run time and
//     REFUSES rather than substituting a default. In particular the applied
//     APR_Corroboration_Threshold is never re-defaulted to 480 here: attendance-variance.ts
//     applies that default at DECISION time, and a provenance record exists to state what was
//     actually applied, so a missing value is a caller bug and is reported as one.
//
//  2. Criterion 11.2, a real delta. `RuleAuditLogEntry` for an amendment is a separate arm of a
//     discriminated union carrying a non-empty `fieldDeltas`, so an amend entry with no
//     before/after difference is not a value this module can produce.
//
//  3. Criterion 11.3, append-only. `guardRuleAuditLogOperation` is a total function over an
//     existing entry and a requested operation whose only permitted operation is `append`. The
//     module exports NO function that takes an existing `RuleAuditLogEntry` and returns a
//     modified one, so there is no in-place amendment path to forget to guard.
//
// DELIBERATELY NOT MODELLED HERE:
//   - The SQL enforcement of criterion 11.3 (triggers, REVOKE of UPDATE/DELETE). That is the
//     migration phase's, and this module states the contract the storage layer must honour.
//   - Reading `attendance_provenance` back, and the retention window. `verifyFinalisedRunProvenance`
//     takes the retrieved records and the digests captured at finalisation as arguments; the
//     query is the caller's.
//   - The derivation of Canonical_Productive_Minutes itself (Requirement 18,
//     canonical-productivity.ts). This module records and RECONCILES that figure; it does not
//     recompute it, because the per-Dialler_Source intervals a recomputation needs are not part
//     of the provenance record (see `reconcileAggregation`).
//   - Payable_Days derivation. `verifyProvenanceCompleteness` takes the contributing dates as an
//     argument; only payrollCalculate.service can produce them.
//

import type { DayClassification, ResolvedAttendanceSource } from './attendance-variance.js';
import type { ProducingRule } from './canonical-productivity.js';

// ---------------------------------------------------------------------------------------------
// Shared refusal shape (mirrors ReviewRejection in variance-review.ts)
// ---------------------------------------------------------------------------------------------

export type ProvenanceRefusalCode =
  /** criterion 11.1 / 11.2 / 11.4: a required member is absent, null where null is not a value, or blank. */
  | 'required_field_missing'
  /** The member is present but not a usable value (unparseable date, negative minutes, junk number). */
  | 'field_value_invalid'
  /** criteria 11.1, 18.9: two contributions claim the same Dialler_Source. */
  | 'duplicate_dialler_source_contribution'
  /** criteria 18.2, 18.11: Canonical_Productive_Minutes above the daily bound. */
  | 'canonical_minutes_exceed_daily_bound'
  /** criterion 18.10: absent Canonical_Productive_Minutes alongside contributions that exist. */
  | 'absent_canonical_with_contributions'
  /** criteria 18.1, 18.10: a Canonical_Productive_Minutes value with no attributed contribution. */
  | 'present_canonical_without_contributions'
  /** criterion 18.7: the recorded producing rule and the recorded canonical state disagree. */
  | 'producing_rule_disagrees_with_canonical_state'
  /** criterion 11.2: the stated change reason is blank after whitespace normalisation. */
  | 'change_reason_blank'
  /** criterion 11.2: an amendment must carry a real before/after field-level delta. */
  | 'amendment_records_no_field_change'
  /** criterion 11.2: an amendment or deactivation must carry the prior field values. */
  | 'prior_field_values_required'
  /** criterion 11.2: a creation, amendment or deactivation must carry the new field values. */
  | 'new_field_values_required'
  /** criterion 11.3: the Rule_Audit_Log is append-only. */
  | 'audit_log_entry_is_immutable'
  /** criterion 11.4: an Upload_Batch submission names no affected employee-date. */
  | 'no_affected_employee_dates';

export interface ProvenanceRefusal {
  /** The first refusal that applied. */
  readonly code: ProvenanceRefusalCode;
  /** Every refusal that applied, so one rejected write is not audited three times to learn three facts. */
  readonly codes: readonly ProvenanceRefusalCode[];
  readonly message: string;
  /** The acceptance criteria this refusal enforces, so an audit row can name them. */
  readonly criteria: readonly string[];
  /** The member names that caused it, in input order. */
  readonly fields: readonly string[];
}

export type Refused = { readonly ok: false; readonly refusal: ProvenanceRefusal };

interface Problem {
  readonly code: ProvenanceRefusalCode;
  readonly message: string;
  readonly criteria: readonly string[];
  readonly field: string;
}

function refuseWith(problems: readonly Problem[]): Refused {
  const criteria: string[] = [];
  for (const problem of problems) {
    for (const criterion of problem.criteria) {
      if (!criteria.includes(criterion)) criteria.push(criterion);
    }
  }
  return Object.freeze({
    ok: false as const,
    refusal: Object.freeze({
      code: problems[0].code,
      codes: Object.freeze(problems.map((p) => p.code)),
      message: problems.map((p) => p.message).join(' '),
      criteria: Object.freeze(criteria),
      fields: Object.freeze(problems.map((p) => p.field)),
    }),
  });
}

// ---------------------------------------------------------------------------------------------
// Value checks. Total, no throw, no coercion.
// ---------------------------------------------------------------------------------------------

/** criteria 18.2, 18.11. */
export const MAX_DAILY_MINUTES = 1440;

// Zero-width and word-joiner characters: not matched by \s, invisible to a human, so a change
// reason padded with them would look like a stated reason and be none. Removed before anything is
// measured. Written as an alternation rather than a character class because a class containing the
// zero-width joiner is what eslint's no-misleading-character-class flags. No literal irregular
// whitespace appears in this file (eslint no-irregular-whitespace).
const INVISIBLE_CHARACTERS = /\u200B|\u200C|\u200D|\u2060|\uFEFF/gu;

// \s already covers the tab, the newline, the no-break space \u00A0 and \uFEFF, so one class
// handles every padding character a paste can carry.
const WHITESPACE_RUN = /\s+/gu;

const CALENDAR_DATE_EXACT = /^(\d{4})-(\d{2})-(\d{2})$/;
const CALENDAR_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const PAY_MONTH_EXACT = /^(\d{4})-(\d{2})$/;

/**
 * Trimmed, invisible characters dropped, internal whitespace runs collapsed to one space. Used
 * for criterion 11.2's stated change reason. Deliberately imposes NO minimum length: criterion
 * 11.2 requires a stated reason and says nothing about its length, and criterion 7.4's
 * twenty-character floor is stated for reviewer comments only. Inventing a floor here would
 * refuse a perfectly good "Client renegotiated APR" and is not this module's policy to make.
 */
export function normalizeChangeReason(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(INVISIBLE_CHARACTERS, '').replace(WHITESPACE_RUN, ' ').trim();
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && normalizeChangeReason(value).length > 0;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const ms = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(ms)) return false;
  const roundTrip = new Date(ms);
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

/**
 * 'YYYY-MM-DD', and a date that exists. `Date.UTC` is used rather than the local zone so the
 * verdict cannot depend on where the job runs, and the round trip is what rejects '2026-02-31',
 * which parses arithmetically and would silently become 2026-03-03.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = CALENDAR_DATE_EXACT.exec(value);
  if (match === null) return false;
  return isRealDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** 'YYYY-MM', matching `salary_prep_run.run_month`. */
export function isPayMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = PAY_MONTH_EXACT.exec(value);
  if (match === null) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/**
 * A timestamp, as loosely as this module needs it: an ISO-8601 string whose date part exists.
 * The clock resolution and the offset are the caller's business; what a provenance record cannot
 * carry is a timestamp that names no real day.
 */
export function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = CALENDAR_DATE_PREFIX.exec(value);
  if (match === null) return false;
  return isRealDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * A minutes figure is usable only when it is a finite, non-negative number. NaN from an unparsed
 * cell and a negative from a mis-signed subtraction are NOT silently turned into 0 -- the same
 * rule attendance-variance.ts applies, for the same reason: junk must never present itself as a
 * measured zero-minute day. Here it is a refusal rather than a degradation to absent, because a
 * provenance record is a statement of record, not a decision that has to reach an answer.
 */
function isUsableMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// ---------------------------------------------------------------------------------------------
// criterion 11.1: the Attendance_Provenance_Record
// ---------------------------------------------------------------------------------------------

/**
 * criterion 11.1's "identifier and contributed minutes of each Dialler_Source that participated",
 * and criterion 18.9's individually retained contribution. ONE entry per Dialler_Source carrying
 * that source's total for the date -- see `buildAttendanceProvenanceRecord` on duplicates.
 */
export interface DiallerSourceContributionRecord {
  readonly diallerSourceId: string;
  /** Not nullable: a source that contributed nothing did not participate and is simply absent from the list. */
  readonly contributedMinutes: number;
}

/**
 * criterion 11.1. Every member is required. Two members are NULLABLE, and null means absent, never
 * zero (criteria 5.3, 18.10):
 *
 *   - `biometricMinutes`: null when the biometric feed holds no record for the date.
 *   - `canonicalProductiveMinutes`: null when no registered Dialler_Source holds a record, which
 *     is the common case (26,215 of 29,271 July 2026 biometric-source days, evidence E7).
 *
 * `canonicalProducingRule` is not named by criterion 11.1 but IS required here, for two reasons:
 * criterion 18.7 requires the producing rule to be recorded for every employee-date anyway, and
 * criterion 11.7's reconciliation is not decidable without it -- the union rule of criterion 18.4
 * and the maximum-contribution rule of criterion 18.6 reconcile the same contribution list to
 * different figures. See `reconcileAggregation`.
 *
 * `payMonth` is likewise not named by criterion 11.1 but is required, because criterion 11.6
 * counts provenance records per employee and PAY_MONTH, and deriving the Pay_Month from the work
 * date would assume a calendar-aligned pay cycle. It is NOT cross-checked against `workDate` for
 * exactly that reason: a 26th-to-25th cycle is a legitimate configuration and this module has no
 * business deciding otherwise.
 */
export interface AttendanceProvenanceRecord {
  readonly employeeId: string;
  /** 'YYYY-MM-DD'. */
  readonly workDate: string;
  /** 'YYYY-MM', matching `salary_prep_run.run_month`. */
  readonly payMonth: string;
  /** criterion 11.1: the RESOLVED Attendance_Source. */
  readonly resolvedAttendanceSource: ResolvedAttendanceSource;
  /** criterion 11.1: the Attendance_Source_Rule that decided it. */
  readonly decidingRuleId: string;
  /** null means the biometric feed held no record -- never 0. */
  readonly biometricMinutes: number | null;
  /** null means no attributed contribution existed (criterion 18.10) -- never 0. */
  readonly canonicalProductiveMinutes: number | null;
  /** criteria 18.7, 11.7. null exactly when `canonicalProductiveMinutes` is null. */
  readonly canonicalProducingRule: ProducingRule | null;
  /** criteria 11.1, 18.9. Empty exactly when `canonicalProductiveMinutes` is null. */
  readonly diallerSourceContributions: readonly DiallerSourceContributionRecord[];
  /** criterion 11.1: the APPLIED value, not the configured one and not a re-derived default. */
  readonly appliedCorroborationThresholdMinutes: number;
  readonly classification: DayClassification;
  /** criterion 11.1's processing timestamp, supplied rather than read from a clock. */
  readonly processedAt: string;
}

/**
 * The builder's input. Identical in shape to the record so a correct call site is checked by the
 * compiler; the run-time checks in `buildAttendanceProvenanceRecord` exist for values that reach
 * the builder from untyped JSON or through a cast.
 */
export type AttendanceProvenanceDraft = AttendanceProvenanceRecord;

export type BuildProvenanceResult =
  | { readonly ok: true; readonly record: AttendanceProvenanceRecord }
  | Refused;

const PROVENANCE_SOURCES: readonly ResolvedAttendanceSource[] = Object.freeze([
  'dialler',
  'biometric',
]);

const DAY_CLASSIFICATIONS: readonly DayClassification[] = Object.freeze([
  'present',
  'half_day',
  'absent',
  'leave_approved',
  'holiday',
  'week_off',
  'unreconciled',
  'missing_punch',
  'week_off_worked',
]);

const PRODUCING_RULES: readonly ProducingRule[] = Object.freeze([
  'interval_union',
  'max_contribution',
]);

/**
 * criterion 11.1. Assembles the Attendance_Provenance_Record, or refuses.
 *
 * WHAT "REQUIRED" MEANS HERE, stated because the criterion does not: a member must be PRESENT and
 * usable. A missing member is never replaced by a default -- not by 0 minutes, not by the 480
 * minute APR_Corroboration_Threshold of criterion 5.5, not by an empty contribution list standing
 * in for "no contributions were recorded". The record is the evidence a salary register is proved
 * with; a defaulted field would be this module inventing that evidence.
 *
 * DUPLICATE Dialler_Source IDENTIFIERS ARE REFUSED. Criterion 11.1 asks for the contribution of
 * "each Dialler_Source that participated", one figure per source, and criterion 11.7 sums those
 * figures -- two entries for the same source make that sum ambiguous and double-count the source.
 * A source that supplied several sessions in a day is therefore recorded as one entry carrying its
 * total. The alternative, silently merging the duplicates, was rejected: it would hide a caller
 * that is fanning out rows it should have grouped, and the sum it produced would be right by
 * accident rather than by construction.
 */
export function buildAttendanceProvenanceRecord(
  draft: AttendanceProvenanceDraft,
): BuildProvenanceResult {
  const problems: Problem[] = [];
  const missing = (field: string, why: string, criteria: readonly string[] = ['11.1']): void => {
    problems.push({
      code: 'required_field_missing',
      message: `${field} is required on an Attendance_Provenance_Record: ${why}`,
      criteria,
      field,
    });
  };
  const invalid = (field: string, why: string, criteria: readonly string[] = ['11.1']): void => {
    problems.push({ code: 'field_value_invalid', message: `${field} ${why}`, criteria, field });
  };

  if (draft === null || draft === undefined) {
    return refuseWith([
      {
        code: 'required_field_missing',
        message: 'No Attendance_Provenance_Record draft was supplied.',
        criteria: ['11.1'],
        field: 'draft',
      },
    ]);
  }

  if (!isNonBlankString(draft.employeeId)) missing('employeeId', 'the record identifies one employee.');
  if (!isCalendarDate(draft.workDate)) {
    invalid('workDate', `must be an existing 'YYYY-MM-DD' date; received ${JSON.stringify(draft.workDate)}.`);
  }
  if (!isPayMonth(draft.payMonth)) {
    invalid('payMonth', `must be a 'YYYY-MM' Pay_Month; received ${JSON.stringify(draft.payMonth)}.`, ['11.1', '11.6']);
  }
  if (!PROVENANCE_SOURCES.includes(draft.resolvedAttendanceSource)) {
    invalid(
      'resolvedAttendanceSource',
      `must be 'dialler' or 'biometric'; received ${JSON.stringify(draft.resolvedAttendanceSource)}.`,
    );
  }
  if (!isNonBlankString(draft.decidingRuleId)) {
    missing(
      'decidingRuleId',
      'criterion 11.1 requires the identifier of the Attendance_Source_Rule that decided the date, ' +
        'so a record cannot be written before resolution has named one.',
    );
  }
  if (draft.biometricMinutes !== null && !isUsableMinutes(draft.biometricMinutes)) {
    invalid(
      'biometricMinutes',
      `must be a finite non-negative number of minutes, or null for "the biometric feed held no ` +
        `record"; received ${String(draft.biometricMinutes)}.`,
      ['11.1', '5.3'],
    );
  }
  if (draft.canonicalProductiveMinutes !== null && !isUsableMinutes(draft.canonicalProductiveMinutes)) {
    invalid(
      'canonicalProductiveMinutes',
      `must be a finite non-negative number of minutes, or null for "no attributed contribution ` +
        `exists"; received ${String(draft.canonicalProductiveMinutes)}.`,
      ['11.1', '18.10'],
    );
  } else if (
    draft.canonicalProductiveMinutes !== null &&
    draft.canonicalProductiveMinutes > MAX_DAILY_MINUTES
  ) {
    problems.push({
      code: 'canonical_minutes_exceed_daily_bound',
      message:
        `canonicalProductiveMinutes of ${String(draft.canonicalProductiveMinutes)} exceeds the ` +
        `daily bound of ${MAX_DAILY_MINUTES} minutes.`,
      criteria: ['18.2', '18.11'],
      field: 'canonicalProductiveMinutes',
    });
  }
  if (!isUsableMinutes(draft.appliedCorroborationThresholdMinutes) || draft.appliedCorroborationThresholdMinutes <= 0) {
    // criterion 5.5's 480 is applied by attendance-variance.ts at decision time. This record
    // states what WAS applied, so it is not re-derived here.
    invalid(
      'appliedCorroborationThresholdMinutes',
      `must be the finite, greater-than-zero APR_Corroboration_Threshold that was actually ` +
        `applied; received ${String(draft.appliedCorroborationThresholdMinutes)}. It is not ` +
        `defaulted here, because the record states what was applied rather than what would be.`,
      ['11.1', '5.5'],
    );
  }
  if (!DAY_CLASSIFICATIONS.includes(draft.classification)) {
    invalid(
      'classification',
      `must be one of the recorded attendance classifications; received ${JSON.stringify(draft.classification)}.`,
    );
  }
  if (!isTimestamp(draft.processedAt)) {
    invalid(
      'processedAt',
      `must be a timestamp beginning with an existing 'YYYY-MM-DD' date; received ${JSON.stringify(draft.processedAt)}.`,
    );
  }

  const contributions = Array.isArray(draft.diallerSourceContributions)
    ? draft.diallerSourceContributions
    : null;
  if (contributions === null) {
    missing(
      'diallerSourceContributions',
      'criterion 11.1 requires the per-Dialler_Source breakdown; an empty array states "no source ' +
        'participated" and is a different statement from a missing one.',
    );
  } else {
    const seen = new Set<string>();
    contributions.forEach((contribution, index) => {
      const field = `diallerSourceContributions[${String(index)}]`;
      if (contribution === null || contribution === undefined) {
        missing(field, 'a contribution entry is required to carry a source identifier and its minutes.');
        return;
      }
      if (!isNonBlankString(contribution.diallerSourceId)) {
        missing(`${field}.diallerSourceId`, 'criterion 11.1 requires the identifier of each participating Dialler_Source.');
      } else if (seen.has(contribution.diallerSourceId)) {
        problems.push({
          code: 'duplicate_dialler_source_contribution',
          message:
            `Dialler_Source ${contribution.diallerSourceId} appears more than once; criterion 11.1 ` +
            `records one contributed-minutes figure per participating source, and criterion 11.7 ` +
            `sums those figures.`,
          criteria: ['11.1', '11.7', '18.9'],
          field: `${field}.diallerSourceId`,
        });
      } else {
        seen.add(contribution.diallerSourceId);
      }
      if (!isUsableMinutes(contribution.contributedMinutes)) {
        invalid(
          `${field}.contributedMinutes`,
          `must be a finite non-negative number of minutes; received ${String(contribution.contributedMinutes)}.`,
        );
      }
    });
  }

  // criteria 18.1, 18.7, 18.10: the three members that describe the productivity side must agree
  // about whether productivity evidence exists at all. Absent is a state, not a zero, and it is
  // not compatible with a contribution list that has entries in it.
  const canonicalAbsent = draft.canonicalProductiveMinutes === null;
  const contributionCount = contributions === null ? 0 : contributions.length;
  if (canonicalAbsent && contributionCount > 0) {
    problems.push({
      code: 'absent_canonical_with_contributions',
      message:
        `canonicalProductiveMinutes is absent while ${String(contributionCount)} Dialler_Source ` +
        `contribution(s) are recorded; an employee-date with contributions has a derived figure ` +
        `(criterion 18.1) and absence is not the same as zero (criterion 18.10).`,
      criteria: ['18.1', '18.10'],
      field: 'canonicalProductiveMinutes',
    });
  }
  if (!canonicalAbsent && contributions !== null && contributionCount === 0) {
    problems.push({
      code: 'present_canonical_without_contributions',
      message:
        'canonicalProductiveMinutes is present while no Dialler_Source contribution is recorded; ' +
        'the figure is derived from attributed contributions (criterion 18.1) and criterion 11.7 ' +
        'must be able to reconcile it against them.',
      criteria: ['18.1', '11.7'],
      field: 'diallerSourceContributions',
    });
  }
  const producingRule = draft.canonicalProducingRule;
  if (canonicalAbsent) {
    if (producingRule !== null) {
      problems.push({
        code: 'producing_rule_disagrees_with_canonical_state',
        message:
          `canonicalProducingRule is ${JSON.stringify(producingRule)} while ` +
          `canonicalProductiveMinutes is absent; no rule produced a figure that does not exist.`,
        criteria: ['18.7', '18.10'],
        field: 'canonicalProducingRule',
      });
    }
  } else if (producingRule === null || !PRODUCING_RULES.includes(producingRule)) {
    problems.push({
      code: 'producing_rule_disagrees_with_canonical_state',
      message:
        `canonicalProducingRule must name which of criteria 18.4 and 18.6 produced the recorded ` +
        `Canonical_Productive_Minutes; received ${JSON.stringify(producingRule)}.`,
      criteria: ['18.7', '11.7'],
      field: 'canonicalProducingRule',
    });
  }

  if (problems.length > 0) return refuseWith(problems);

  return Object.freeze({
    ok: true as const,
    record: Object.freeze({
      employeeId: draft.employeeId,
      workDate: draft.workDate,
      payMonth: draft.payMonth,
      resolvedAttendanceSource: draft.resolvedAttendanceSource,
      decidingRuleId: draft.decidingRuleId,
      biometricMinutes: draft.biometricMinutes,
      canonicalProductiveMinutes: draft.canonicalProductiveMinutes,
      canonicalProducingRule: draft.canonicalProducingRule,
      diallerSourceContributions: Object.freeze(
        (contributions ?? []).map((contribution) =>
          Object.freeze({
            diallerSourceId: contribution.diallerSourceId,
            contributedMinutes: contribution.contributedMinutes,
          }),
        ),
      ),
      appliedCorroborationThresholdMinutes: draft.appliedCorroborationThresholdMinutes,
      classification: draft.classification,
      processedAt: draft.processedAt,
    }),
  });
}

/**
 * A canonical, order-independent serialisation of one Attendance_Provenance_Record, used as the
 * "unchanged" test of criterion 11.5. Positional rather than keyed, and the contribution list is
 * sorted, so two records that differ only in key order or in the order the contributions were
 * retrieved produce the same digest -- while any change to a recorded VALUE changes it.
 *
 * Not a cryptographic hash: this module has no dependencies, and the comparison it supports is
 * equality against a baseline captured by the same code, not tamper-proofing against an attacker
 * who can rewrite the baseline too.
 */
export function provenanceRecordDigest(record: AttendanceProvenanceRecord): string {
  const contributions = [...record.diallerSourceContributions]
    .map((contribution) => [contribution.diallerSourceId, contribution.contributedMinutes] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  return JSON.stringify([
    record.employeeId,
    record.workDate,
    record.payMonth,
    record.resolvedAttendanceSource,
    record.decidingRuleId,
    record.biometricMinutes,
    record.canonicalProductiveMinutes,
    record.canonicalProducingRule,
    contributions,
    record.appliedCorroborationThresholdMinutes,
    record.classification,
    record.processedAt,
  ]);
}

// ---------------------------------------------------------------------------------------------
// criterion 11.2: the Rule_Audit_Log entry for rule and Dialler_Source administration
// ---------------------------------------------------------------------------------------------

/** criterion 11.2: the two administered objects. */
export type RuleAuditSubject = 'attendance_source_rule' | 'dialler_source';

/** criterion 11.2: the three administrative actions. */
export type RuleAuditAction = 'create' | 'amend' | 'deactivate';

/**
 * A recorded field value. Deliberately narrow: an audit row stores what a column held, and
 * allowing an arbitrary object would let a caller record a reference whose contents change after
 * the entry is written, which is exactly what criterion 11.3 exists to prevent.
 */
export type AuditFieldValue = string | number | boolean | null;

export type AuditFieldValues = Readonly<Record<string, AuditFieldValue>>;

/** criterion 11.2's field-level before/after. */
export interface AuditFieldDelta {
  readonly field: string;
  /** null both when the prior value was NULL and when the field did not exist; `priorPresent` distinguishes them. */
  readonly priorValue: AuditFieldValue;
  readonly newValue: AuditFieldValue;
  readonly priorPresent: boolean;
  readonly newPresent: boolean;
}

interface RuleAuditLogEntryBase {
  readonly subject: RuleAuditSubject;
  readonly subjectId: string;
  readonly actingUserId: string;
  readonly recordedAt: string;
  readonly priorFieldValues: AuditFieldValues;
  readonly newFieldValues: AuditFieldValues;
  /** The normalised reason, never blank. */
  readonly changeReason: string;
}

/**
 * criterion 11.2, as a discriminated union so guarantee 2 in the file header is the compiler's
 * business: only the `amend` arm exists, and it requires `fieldDeltas`, which `buildRuleAuditEntry`
 * never returns empty.
 */
export type RuleAuditLogEntry =
  | (RuleAuditLogEntryBase & { readonly action: 'create'; readonly fieldDeltas: readonly AuditFieldDelta[] })
  | (RuleAuditLogEntryBase & { readonly action: 'amend'; readonly fieldDeltas: readonly AuditFieldDelta[] })
  | (RuleAuditLogEntryBase & { readonly action: 'deactivate'; readonly fieldDeltas: readonly AuditFieldDelta[] });

export interface RuleAuditDraft {
  readonly subject: RuleAuditSubject;
  readonly subjectId: string;
  readonly action: RuleAuditAction;
  readonly actingUserId: string;
  readonly recordedAt: string;
  /** criterion 11.2's prior field values. Empty on `create`, where nothing existed to record. */
  readonly priorFieldValues: AuditFieldValues;
  readonly newFieldValues: AuditFieldValues;
  readonly changeReason: string;
}

export type BuildRuleAuditResult =
  | { readonly ok: true; readonly entry: RuleAuditLogEntry }
  | Refused;

const RULE_AUDIT_SUBJECTS: readonly RuleAuditSubject[] = Object.freeze([
  'attendance_source_rule',
  'dialler_source',
]);

const RULE_AUDIT_ACTIONS: readonly RuleAuditAction[] = Object.freeze([
  'create',
  'amend',
  'deactivate',
]);

function isRecordedValue(value: unknown): value is AuditFieldValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isFieldValueMap(value: unknown): value is AuditFieldValues {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isRecordedValue);
}

/**
 * criterion 11.2's before/after, computed rather than asserted. The union of both key sets is
 * walked, so a field the amendment ADDED and a field it REMOVED both appear; unchanged fields are
 * omitted, which is what makes an empty result mean "this amendment changed nothing".
 */
export function computeFieldDeltas(
  prior: AuditFieldValues,
  next: AuditFieldValues,
): readonly AuditFieldDelta[] {
  const fields = [...new Set([...Object.keys(prior), ...Object.keys(next)])].sort();
  const deltas: AuditFieldDelta[] = [];
  for (const field of fields) {
    const priorPresent = Object.prototype.hasOwnProperty.call(prior, field);
    const newPresent = Object.prototype.hasOwnProperty.call(next, field);
    const priorValue = priorPresent ? prior[field] : null;
    const newValue = newPresent ? next[field] : null;
    if (priorPresent === newPresent && priorValue === newValue) continue;
    deltas.push(Object.freeze({ field, priorValue, newValue, priorPresent, newPresent }));
  }
  return Object.freeze(deltas);
}

/**
 * criterion 11.2. Builds the Rule_Audit_Log entry for the creation, amendment or deactivation of
 * an Attendance_Source_Rule or a Dialler_Source registration, or refuses.
 *
 * Three refusals, each stated by the criterion rather than invented here:
 *   - a blank change reason, measured after whitespace normalisation, is no stated reason at all;
 *   - an `amend` whose before/after values are identical records no change and would put a row in
 *     the log that proves nothing;
 *   - an `amend` or `deactivate` with no prior field values cannot state what the values were.
 *
 * A `create` carries no prior values by nature, so its delta is every new field with
 * `priorPresent: false` -- which is the honest before/after for a row that did not exist.
 */
export function buildRuleAuditEntry(draft: RuleAuditDraft): BuildRuleAuditResult {
  const problems: Problem[] = [];
  const demand = (
    ok: boolean,
    field: string,
    message: string,
    code: ProvenanceRefusalCode = 'required_field_missing',
    criteria: readonly string[] = ['11.2'],
  ): void => {
    if (!ok) problems.push({ code, message, criteria, field });
  };

  if (draft === null || draft === undefined) {
    return refuseWith([
      {
        code: 'required_field_missing',
        message: 'No Rule_Audit_Log draft was supplied.',
        criteria: ['11.2'],
        field: 'draft',
      },
    ]);
  }

  demand(
    RULE_AUDIT_SUBJECTS.includes(draft.subject),
    'subject',
    `subject must be 'attendance_source_rule' or 'dialler_source'; received ${JSON.stringify(draft.subject)}.`,
    'field_value_invalid',
  );
  demand(isNonBlankString(draft.subjectId), 'subjectId', 'subjectId is required: the entry names the object that changed.');
  demand(
    RULE_AUDIT_ACTIONS.includes(draft.action),
    'action',
    `action must be 'create', 'amend' or 'deactivate'; received ${JSON.stringify(draft.action)}.`,
    'field_value_invalid',
  );
  demand(
    isNonBlankString(draft.actingUserId),
    'actingUserId',
    'actingUserId is required: criterion 11.2 records the acting user.',
  );
  demand(
    isTimestamp(draft.recordedAt),
    'recordedAt',
    `recordedAt must be a timestamp beginning with an existing 'YYYY-MM-DD' date; received ${JSON.stringify(draft.recordedAt)}.`,
    'field_value_invalid',
  );
  demand(
    isFieldValueMap(draft.priorFieldValues),
    'priorFieldValues',
    'priorFieldValues must be a map of field name to a string, finite number, boolean or null.',
    'field_value_invalid',
  );
  demand(
    isFieldValueMap(draft.newFieldValues),
    'newFieldValues',
    'newFieldValues must be a map of field name to a string, finite number, boolean or null.',
    'field_value_invalid',
  );

  const changeReason = normalizeChangeReason(draft.changeReason);
  if (changeReason.length === 0) {
    problems.push({
      code: 'change_reason_blank',
      message:
        'A stated change reason is required and this one is blank after whitespace normalisation; ' +
        'whitespace, a no-break space and a zero-width character state nothing.',
      criteria: ['11.2'],
      field: 'changeReason',
    });
  }

  const prior = isFieldValueMap(draft.priorFieldValues) ? draft.priorFieldValues : {};
  const next = isFieldValueMap(draft.newFieldValues) ? draft.newFieldValues : {};

  if (draft.action === 'amend' || draft.action === 'deactivate') {
    if (Object.keys(prior).length === 0) {
      problems.push({
        code: 'prior_field_values_required',
        message:
          `A ${draft.action} entry must carry the prior field values: criterion 11.2 records what ` +
          `the values were, and the object existed before the change.`,
        criteria: ['11.2'],
        field: 'priorFieldValues',
      });
    }
  }
  if (Object.keys(next).length === 0) {
    problems.push({
      code: 'new_field_values_required',
      message: `A ${String(draft.action)} entry must carry the new field values.`,
      criteria: ['11.2'],
      field: 'newFieldValues',
    });
  }

  const fieldDeltas = computeFieldDeltas(prior, next);
  if (draft.action === 'amend' && fieldDeltas.length === 0) {
    problems.push({
      code: 'amendment_records_no_field_change',
      message:
        'An amend entry must carry a real field-level before/after difference; the prior and new ' +
        'field values are identical, so this entry would record no change.',
      criteria: ['11.2'],
      field: 'newFieldValues',
    });
  }

  if (problems.length > 0) return refuseWith(problems);

  return Object.freeze({
    ok: true as const,
    entry: Object.freeze({
      subject: draft.subject,
      subjectId: draft.subjectId,
      action: draft.action,
      actingUserId: draft.actingUserId,
      recordedAt: draft.recordedAt,
      priorFieldValues: Object.freeze({ ...prior }),
      newFieldValues: Object.freeze({ ...next }),
      fieldDeltas,
      changeReason,
    }) as RuleAuditLogEntry,
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 11.3: the append-only contract
// ---------------------------------------------------------------------------------------------

/** The operations a caller can ask of a log that already holds an entry. */
export type RuleAuditLogOperation = 'append' | 'amend_in_place' | 'delete';

/**
 * An entry as it already stands in the log. Only its identity is needed: criterion 11.3 refuses
 * the mutation whatever the entry says, so no field of it can influence the verdict.
 */
export interface PersistedAuditLogEntry {
  readonly entryId: string;
  readonly recordedAt: string;
}

export type AuditLogOperationVerdict =
  | {
      readonly permitted: true;
      readonly operation: 'append';
      /** The existing entry is untouched by an append; stated so a caller can assert it. */
      readonly existingEntryId: string;
    }
  | {
      readonly permitted: false;
      readonly operation: 'amend_in_place' | 'delete';
      readonly refusal: ProvenanceRefusal;
      /** The only correction the log supports: state the correction as a NEW entry. */
      readonly remedy: 'append_a_new_entry';
    };

/**
 * criterion 11.3. Total over every operation: `append` is permitted, `amend_in_place` and
 * `delete` are refused, and there is no fourth case because the union has three members.
 *
 * This is the CONTRACT, expressed where it can be tested. It is deliberately not an attempt to
 * enforce immutability in SQL -- no trigger, no REVOKE, no generated column. Those belong to the
 * migration phase, and a guard in TypeScript would in any case not stop a hand-written UPDATE.
 * What it does do is remove the in-process path: this module exports no function that takes a
 * `RuleAuditLogEntry` and returns a changed one, so a service that wants to "fix" an entry has
 * nothing to call.
 */
export function guardRuleAuditLogOperation(
  existing: PersistedAuditLogEntry,
  request: { readonly operation: RuleAuditLogOperation },
): AuditLogOperationVerdict {
  const entryId = existing !== null && existing !== undefined ? existing.entryId : '(unknown)';
  if (request !== null && request !== undefined && request.operation === 'append') {
    return Object.freeze({
      permitted: true as const,
      operation: 'append' as const,
      existingEntryId: entryId,
    });
  }
  const operation: 'amend_in_place' | 'delete' =
    request !== null && request !== undefined && request.operation === 'delete'
      ? 'delete'
      : 'amend_in_place';
  const verb = operation === 'delete' ? 'delete' : 'modify';
  return Object.freeze({
    permitted: false as const,
    operation,
    refusal: Object.freeze({
      code: 'audit_log_entry_is_immutable' as const,
      codes: Object.freeze(['audit_log_entry_is_immutable' as const]),
      message:
        `The Rule_Audit_Log is append-only and rejects any request to ${verb} existing entry ` +
        `${entryId}. Record the correction as a new entry instead.`,
      criteria: Object.freeze(['11.3']),
      fields: Object.freeze(['entryId']),
    }),
    remedy: 'append_a_new_entry' as const,
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 11.4: the audit entry for review, adjustment and upload actions
// ---------------------------------------------------------------------------------------------

/** criterion 11.4's five recorded events. */
export type OperationalAuditEvent =
  | 'review_outcome_recorded'
  | 'adjustment_requested'
  | 'adjustment_approved'
  | 'adjustment_rejected'
  | 'upload_batch_submitted';

/**
 * criterion 11.4 requires the acting ROLE as well as the acting user, which is why this is a
 * separate required member and not derived from the user id: the same user can hold more than one
 * grant, and which one they acted under is the fact an auditor needs.
 *
 * Carried as a non-blank string rather than a closed union because the platform's role vocabulary
 * lives in the auth tables, not in this requirement; the roles these requirements name are
 * `wfm_reviewer`, `reporting_manager`, `override_approver`, `rule_administrator` and the
 * Upload_Batch submitter. A closed union here would silently be wrong the first time a grant is
 * added, and this module cannot query the grants to check.
 */
export interface OperationalAuditLogEntry {
  readonly event: OperationalAuditEvent;
  readonly actingUserId: string;
  readonly actingRole: string;
  readonly recordedAt: string;
  readonly employeeId: string;
  /** 'YYYY-MM-DD'. */
  readonly workDate: string;
  /** The Variance_Record, adjustment request or Upload_Batch the action was taken on; null when the caller holds none. */
  readonly subjectId: string | null;
}

export type OperationalAuditDraft = OperationalAuditLogEntry;

export type BuildOperationalAuditResult =
  | { readonly ok: true; readonly entry: OperationalAuditLogEntry }
  | Refused;

const OPERATIONAL_AUDIT_EVENTS: readonly OperationalAuditEvent[] = Object.freeze([
  'review_outcome_recorded',
  'adjustment_requested',
  'adjustment_approved',
  'adjustment_rejected',
  'upload_batch_submitted',
]);

/**
 * criterion 11.4. Builds the audit entry for a Review_Outcome, an adjustment request, an
 * adjustment approval, an adjustment rejection or an Upload_Batch submission, or refuses.
 *
 * THE AFFECTED EMPLOYEE AND DATE ARE REQUIRED FOR EVERY EVENT, INCLUDING AN UPLOAD BATCH.
 * Criterion 11.4 names them without exception. An Upload_Batch covers many employee-dates, so it
 * is recorded as ONE ENTRY PER AFFECTED EMPLOYEE-DATE -- see `buildUploadBatchAuditEntries`. The
 * alternative, a nullable employee and date on batch entries, was rejected: it makes criterion
 * 11.4 unenforceable for exactly the event with the widest blast radius, and leaves an auditor
 * looking at a paid day unable to see that an upload touched it.
 */
export function buildOperationalAuditEntry(
  draft: OperationalAuditDraft,
): BuildOperationalAuditResult {
  const problems: Problem[] = [];
  const fail = (
    field: string,
    message: string,
    code: ProvenanceRefusalCode = 'required_field_missing',
  ): void => {
    problems.push({ code, message, criteria: ['11.4'], field });
  };

  if (draft === null || draft === undefined) {
    return refuseWith([
      {
        code: 'required_field_missing',
        message: 'No audit entry draft was supplied.',
        criteria: ['11.4'],
        field: 'draft',
      },
    ]);
  }

  if (!OPERATIONAL_AUDIT_EVENTS.includes(draft.event)) {
    fail('event', `event must be one of the five events criterion 11.4 names; received ${JSON.stringify(draft.event)}.`, 'field_value_invalid');
  }
  if (!isNonBlankString(draft.actingUserId)) {
    fail('actingUserId', 'actingUserId is required: criterion 11.4 records the acting user.');
  }
  if (!isNonBlankString(draft.actingRole)) {
    fail(
      'actingRole',
      'actingRole is required: criterion 11.4 records the acting ROLE as well as the acting user, ' +
        'and it is not inferable from the user id because one user can hold several grants.',
    );
  }
  if (!isTimestamp(draft.recordedAt)) {
    fail(
      'recordedAt',
      `recordedAt must be a timestamp beginning with an existing 'YYYY-MM-DD' date; received ${JSON.stringify(draft.recordedAt)}.`,
      'field_value_invalid',
    );
  }
  if (!isNonBlankString(draft.employeeId)) {
    fail('employeeId', 'employeeId is required: criterion 11.4 records the affected employee.');
  }
  if (!isCalendarDate(draft.workDate)) {
    fail(
      'workDate',
      `workDate must be an existing 'YYYY-MM-DD' date: criterion 11.4 records the affected date; received ${JSON.stringify(draft.workDate)}.`,
      'field_value_invalid',
    );
  }
  if (draft.subjectId !== null && !isNonBlankString(draft.subjectId)) {
    fail(
      'subjectId',
      `subjectId must be a non-blank identifier or explicitly null; received ${JSON.stringify(draft.subjectId)}.`,
      'field_value_invalid',
    );
  }

  if (problems.length > 0) return refuseWith(problems);

  return Object.freeze({
    ok: true as const,
    entry: Object.freeze({
      event: draft.event,
      actingUserId: draft.actingUserId,
      actingRole: draft.actingRole,
      recordedAt: draft.recordedAt,
      employeeId: draft.employeeId,
      workDate: draft.workDate,
      subjectId: draft.subjectId,
    }),
  });
}

export interface AffectedEmployeeDate {
  readonly employeeId: string;
  /** 'YYYY-MM-DD'. */
  readonly workDate: string;
}

export type BuildUploadBatchAuditResult =
  | { readonly ok: true; readonly entries: readonly OperationalAuditLogEntry[] }
  | Refused;

/**
 * criterion 11.4 for an Upload_Batch submission: the fan-out described on
 * `buildOperationalAuditEntry`. One entry per affected employee-date, all carrying the same batch
 * identifier, acting user, role and timestamp.
 *
 * An empty affected list is REFUSED rather than returning no entries, because a submission that
 * records nothing is a submission an auditor cannot see happened.
 */
export function buildUploadBatchAuditEntries(
  submission: {
    readonly actingUserId: string;
    readonly actingRole: string;
    readonly recordedAt: string;
    readonly uploadBatchId: string;
  },
  affected: readonly AffectedEmployeeDate[],
): BuildUploadBatchAuditResult {
  if (submission === null || submission === undefined) {
    return refuseWith([
      {
        code: 'required_field_missing',
        message: 'No Upload_Batch submission was supplied.',
        criteria: ['11.4'],
        field: 'submission',
      },
    ]);
  }
  if (!Array.isArray(affected) || affected.length === 0) {
    return refuseWith([
      {
        code: 'no_affected_employee_dates',
        message:
          'An Upload_Batch submission must name at least one affected employee and date: ' +
          'criterion 11.4 records the affected employee and date for every recorded event.',
        criteria: ['11.4'],
        field: 'affected',
      },
    ]);
  }

  const entries: OperationalAuditLogEntry[] = [];
  const problems: Problem[] = [];
  affected.forEach((rawTarget, index) => {
    // A null entry in the list is ordinary bad data, not a reason to throw: it degrades to an
    // empty target and is refused field by field like any other incomplete draft.
    const target: AffectedEmployeeDate =
      rawTarget === null || rawTarget === undefined
        ? ({ employeeId: '', workDate: '' } as AffectedEmployeeDate)
        : rawTarget;
    const result = buildOperationalAuditEntry({
      event: 'upload_batch_submitted',
      actingUserId: submission.actingUserId,
      actingRole: submission.actingRole,
      recordedAt: submission.recordedAt,
      employeeId: target.employeeId,
      workDate: target.workDate,
      subjectId: submission.uploadBatchId,
    });
    if (result.ok) {
      entries.push(result.entry);
      return;
    }
    result.refusal.codes.forEach((code, position) => {
      problems.push({
        code,
        message: `affected[${String(index)}]: ${result.refusal.message}`,
        criteria: result.refusal.criteria,
        field: `affected[${String(index)}].${result.refusal.fields[position] ?? 'unknown'}`,
      });
    });
  });

  if (problems.length > 0) return refuseWith(problems);
  return Object.freeze({ ok: true as const, entries: Object.freeze(entries) });
}

// ---------------------------------------------------------------------------------------------
// criterion 11.5: retrievable and unchanged after finalisation
// ---------------------------------------------------------------------------------------------

export interface FinalisedRunProvenanceInput {
  readonly employeeId: string;
  /** 'YYYY-MM'. */
  readonly payMonth: string;
  /** criterion 11.5: the dates contributing to this run's Payable_Days. */
  readonly payableDayDates: readonly string[];
  /** The records retrieved AFTER finalisation. */
  readonly retrievedRecords: readonly AttendanceProvenanceRecord[];
  /** Work date -> `provenanceRecordDigest` captured AT finalisation. */
  readonly digestsAtFinalisation: Readonly<Record<string, string>>;
}

export interface FinalisedRunProvenanceVerdict {
  /** True only when every contributing date is retrievable, digest-matched and provable. */
  readonly holds: boolean;
  readonly contributingDateCount: number;
  readonly retrievableDateCount: number;
  /** Contributing dates with no retrievable record: criterion 11.5's "remain retrievable" broken. */
  readonly missingDates: readonly string[];
  /** Contributing dates whose record no longer digests to its finalisation baseline. */
  readonly alteredDates: readonly string[];
  /** Contributing dates retrievable but with no baseline, so "unchanged" cannot be shown either way. */
  readonly datesWithoutFinalisationDigest: readonly string[];
  /** Records for another employee that reached the input; reported, not a criterion 11.5 breach. */
  readonly unrelatedRecordCount: number;
  readonly criteria: readonly string[];
}

/**
 * criterion 11.5, as a predicate over one finalised run and one employee.
 *
 * "UNCHANGED" IS MEASURED AGAINST A BASELINE, and the baseline is an argument. A pure function
 * cannot know what a row looked like last month, so the caller captures
 * `provenanceRecordDigest(record)` for each contributing date at finalisation and hands the map
 * back in. A contributing date that is retrievable but has NO baseline counts against `holds`:
 * criterion 11.5 asks for a record that provably did not change, and a record with nothing to
 * compare against is exactly the state in which a silent edit is undetectable. Treating it as
 * satisfied was the alternative, and it would make the check pass most loudly in the situation it
 * is meant to catch.
 *
 * Duplicate contributing dates are counted once: a date either contributes or it does not.
 */
export function verifyFinalisedRunProvenance(
  input: FinalisedRunProvenanceInput,
): FinalisedRunProvenanceVerdict {
  const contributingDates = [...new Set(input.payableDayDates ?? [])];
  const records = input.retrievedRecords ?? [];
  const digests = input.digestsAtFinalisation ?? {};

  const mine = records.filter((record) => record.employeeId === input.employeeId);
  const unrelatedRecordCount = records.length - mine.length;
  const byDate = new Map<string, AttendanceProvenanceRecord>();
  for (const record of mine) byDate.set(record.workDate, record);

  const missingDates: string[] = [];
  const alteredDates: string[] = [];
  const withoutBaseline: string[] = [];
  for (const date of contributingDates) {
    const record = byDate.get(date);
    if (record === undefined) {
      missingDates.push(date);
      continue;
    }
    const baseline = Object.prototype.hasOwnProperty.call(digests, date) ? digests[date] : undefined;
    if (baseline === undefined) {
      withoutBaseline.push(date);
      continue;
    }
    if (provenanceRecordDigest(record) !== baseline) alteredDates.push(date);
  }

  return Object.freeze({
    holds:
      missingDates.length === 0 && alteredDates.length === 0 && withoutBaseline.length === 0,
    contributingDateCount: contributingDates.length,
    retrievableDateCount: contributingDates.filter((date) => byDate.has(date)).length,
    missingDates: Object.freeze(missingDates),
    alteredDates: Object.freeze(alteredDates),
    datesWithoutFinalisationDigest: Object.freeze(withoutBaseline),
    unrelatedRecordCount,
    criteria: Object.freeze(['11.5']),
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 11.6: provenance completeness
// ---------------------------------------------------------------------------------------------

export interface ProvenanceCompletenessInput {
  readonly employeeId: string;
  /** 'YYYY-MM'. */
  readonly payMonth: string;
  /** criterion 11.6: the dates contributing to this employee's Payable_Days for the Pay_Month. */
  readonly payableDayDates: readonly string[];
  readonly provenanceRecords: readonly AttendanceProvenanceRecord[];
}

export interface ProvenanceCompletenessVerdict {
  readonly complete: boolean;
  readonly payableDayDateCount: number;
  readonly provenanceDateCount: number;
  readonly datesMissingProvenance: readonly string[];
  readonly provenanceDatesNotContributing: readonly string[];
  readonly criteria: readonly string[];
}

/**
 * criterion 11.6, as the equality the criterion states: the count of DATES carrying an
 * Attendance_Provenance_Record equals the count of DATES contributing to Payable_Days, for one
 * employee and one Pay_Month.
 *
 * Counted over DISTINCT dates on both sides, because the criterion counts dates and a date is
 * either carrying a record or not; two records for the same date is one date, and the same date
 * listed twice as contributing is one date. Records for another employee or another Pay_Month are
 * excluded before counting, so a run over a whole month cannot be made to look complete by
 * borrowing a neighbour's rows.
 *
 * Equality is reported alongside BOTH set differences rather than as a bare boolean, because the
 * two failures need different remedies: a contributing date with no record is a missing write,
 * and a record for a non-contributing date is a Payable_Days derivation that dropped a day.
 */
export function verifyProvenanceCompleteness(
  input: ProvenanceCompletenessInput,
): ProvenanceCompletenessVerdict {
  const contributing = new Set(input.payableDayDates ?? []);
  const provenanceDates = new Set(
    (input.provenanceRecords ?? [])
      .filter(
        (record) => record.employeeId === input.employeeId && record.payMonth === input.payMonth,
      )
      .map((record) => record.workDate),
  );

  const missing = [...contributing].filter((date) => !provenanceDates.has(date));
  const extra = [...provenanceDates].filter((date) => !contributing.has(date));

  return Object.freeze({
    complete: provenanceDates.size === contributing.size && missing.length === 0,
    payableDayDateCount: contributing.size,
    provenanceDateCount: provenanceDates.size,
    datesMissingProvenance: Object.freeze(missing),
    provenanceDatesNotContributing: Object.freeze(extra),
    criteria: Object.freeze(['11.6']),
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 11.7: aggregation traceability
// ---------------------------------------------------------------------------------------------

export type AggregationReconciliationCode =
  /** No contribution and no figure: criterion 18.10's absent state, which reconciles trivially. */
  | 'reconciled_absent'
  /** criteria 18.4, 18.11, 18.12, 18.14: the figure sits inside the bounds the union rule guarantees. */
  | 'reconciled_within_union_bounds'
  /** criterion 18.6: the figure equals the largest single contribution, capped at the daily bound. */
  | 'reconciled_max_contribution'
  /** criteria 18.1, 18.10. */
  | 'contradiction_absent_canonical_with_contributions'
  /** criteria 18.1, 11.7. */
  | 'contradiction_present_canonical_without_contributions'
  /** criterion 18.7: no producing rule recorded, so there is no rule to reconcile under. */
  | 'producing_rule_missing'
  /** criteria 18.2, 18.11. */
  | 'violates_daily_bound'
  /** criterion 18.14: the figure exceeds the sum of the contributions it was derived from. */
  | 'violates_no_inflation'
  /** criterion 18.12: the figure is below the largest single contribution. */
  | 'violates_no_shrinkage'
  /** criterion 18.6: the secondary rule is recorded but the figure is not the maximum contribution. */
  | 'violates_max_contribution_rule';

export interface AggregationTraceability {
  readonly reconciles: boolean;
  readonly code: AggregationReconciliationCode;
  readonly message: string;
  readonly recordedCanonicalProductiveMinutes: number | null;
  readonly appliedRule: ProducingRule | null;
  /** The sum of the recorded per-Dialler_Source contributions. */
  readonly contributionSumMinutes: number;
  /** null when no contribution is recorded. */
  readonly largestContributionMinutes: number | null;
  /** The upper bound the recorded figure must respect: min(sum, 1440). */
  readonly upperBoundMinutes: number;
  /** The lower bound the recorded figure must respect: min(largest, 1440), or 0 when absent. */
  readonly lowerBoundMinutes: number;
  readonly criteria: readonly string[];
}

/**
 * criterion 11.7: the recorded per-Dialler_Source contributions reconcile to the recorded
 * Canonical_Productive_Minutes UNDER THE AGGREGATION RULE OF REQUIREMENT 18.
 *
 * WHICH RULE IS IMPLEMENTED, AND WHY IT IS NOT A PLAIN SUM. Requirement 18's aggregation is
 * deliberately NOT addition. Criterion 18.3 forbids summing net login across concurrent sessions
 * outright, with the measurement that says why: 8,638 of 36,594 employee-days carry more than one
 * such row and naive summation produces 218 employee-days over 24 hours, to a maximum of 6,282.8
 * minutes in a single day. The two rules that DO apply are:
 *
 *   - PRIMARY, criterion 18.4: the total duration of the UNION of the non-overlapping session
 *     intervals, each covered instant counted exactly once.
 *   - SECONDARY, criterion 18.6, mandatory when any contributing row supplies no usable interval:
 *     the MAXIMUM single contribution for the date.
 *
 * So "sum of contributions equals Canonical_Productive_Minutes" is FALSE as a property, and
 * asserting it would be asserting the very arithmetic criterion 18.3 forbids. Two overlapping
 * 480-minute sessions sum to 960 and reconcile to anything from 480 to 960 depending on the
 * overlap; under the secondary rule they reconcile to 480 exactly.
 *
 * What CAN be checked from a provenance record -- which carries per-source MINUTES but no
 * intervals, by criterion 11.1 -- is the exact set of relations Requirement 18 states as
 * properties, and that is what this function checks:
 *
 *   - absent state (18.10): no contribution, no figure. Reconciles.
 *   - secondary rule recorded (18.6): the figure must EQUAL min(largest contribution, 1440).
 *     Exact, not a bound.
 *   - primary rule recorded (18.4): the figure must satisfy
 *         min(largest, 1440) <= figure <= min(sum, 1440)
 *     which is 18.12 (no shrinkage), 18.14 (no inflation) and 18.11 (daily bound) together. Note
 *     that this is an EQUALITY whenever one source contributed, since the two bounds coincide.
 *
 * WHAT THIS CANNOT CATCH, stated so nobody reads more into a reconciled verdict than it holds. A
 * figure equal to the plain sum sits exactly ON the upper bound, so it reconciles -- and it must,
 * because a day whose sessions genuinely do not overlap has a union equal to the sum. Minutes
 * alone cannot separate that from the concurrent-session summation criterion 18.3 forbids; only
 * the intervals can, and criterion 11.1 does not put them in the provenance record. Catching a
 * wrong derivation is therefore canonical-productivity.ts's job, checked by criterion 18.13's
 * recomputation stability, not this function's. What this function does catch is a figure above
 * the sum, a figure below the largest single contribution, a figure above the daily bound, a
 * secondary-rule figure that is not the maximum contribution, and either half of the
 * absent-versus-present contradiction.
 *
 * Re-deriving the union from the intervals is deliberately NOT attempted here. The intervals are
 * not in the record, and inventing them would make this function agree with itself rather than
 * with the data. canonical-productivity.ts owns the derivation; this owns the reconciliation.
 */
export function reconcileAggregation(record: AttendanceProvenanceRecord): AggregationTraceability {
  const contributions = record.diallerSourceContributions ?? [];
  const minutes = contributions.map((contribution) =>
    isUsableMinutes(contribution.contributedMinutes) ? contribution.contributedMinutes : 0,
  );
  const contributionSumMinutes = minutes.reduce((total, value) => total + value, 0);
  const largestContributionMinutes = minutes.length === 0 ? null : Math.max(...minutes);
  const upperBoundMinutes = Math.min(contributionSumMinutes, MAX_DAILY_MINUTES);
  const lowerBoundMinutes =
    largestContributionMinutes === null
      ? 0
      : Math.min(largestContributionMinutes, MAX_DAILY_MINUTES);
  const canonical = record.canonicalProductiveMinutes;

  const settle = (
    reconciles: boolean,
    code: AggregationReconciliationCode,
    message: string,
    criteria: readonly string[],
  ): AggregationTraceability =>
    Object.freeze({
      reconciles,
      code,
      message,
      recordedCanonicalProductiveMinutes: canonical,
      appliedRule: record.canonicalProducingRule,
      contributionSumMinutes,
      largestContributionMinutes,
      upperBoundMinutes,
      lowerBoundMinutes,
      criteria: Object.freeze([...criteria]),
    });

  // criteria 18.1, 18.10: absent is a state, and it is the state with no contributions.
  if (canonical === null) {
    if (contributions.length > 0) {
      return settle(
        false,
        'contradiction_absent_canonical_with_contributions',
        `Canonical_Productive_Minutes is absent while ${String(contributions.length)} contribution(s) ` +
          `totalling ${String(contributionSumMinutes)} minutes are recorded.`,
        ['11.7', '18.1', '18.10'],
      );
    }
    return settle(
      true,
      'reconciled_absent',
      'No attributed contribution and no Canonical_Productive_Minutes: the absent state of criterion 18.10.',
      ['11.7', '18.10'],
    );
  }

  if (contributions.length === 0) {
    return settle(
      false,
      'contradiction_present_canonical_without_contributions',
      `Canonical_Productive_Minutes of ${String(canonical)} is recorded with no per-Dialler_Source ` +
        `contribution to reconcile it against.`,
      ['11.7', '18.1'],
    );
  }

  if (canonical > MAX_DAILY_MINUTES) {
    return settle(
      false,
      'violates_daily_bound',
      `Canonical_Productive_Minutes of ${String(canonical)} exceeds the daily bound of ` +
        `${String(MAX_DAILY_MINUTES)} minutes.`,
      ['11.7', '18.2', '18.11'],
    );
  }

  // criterion 18.6, the mandatory secondary rule: an exact equality, not a bound.
  if (record.canonicalProducingRule === 'max_contribution') {
    const expected = lowerBoundMinutes;
    if (canonical !== expected) {
      return settle(
        false,
        'violates_max_contribution_rule',
        `The secondary rule of criterion 18.6 is recorded, so Canonical_Productive_Minutes must ` +
          `equal the largest single contribution (${String(expected)} minutes after the daily bound); ` +
          `${String(canonical)} minutes is recorded.`,
        ['11.7', '18.6'],
      );
    }
    return settle(
      true,
      'reconciled_max_contribution',
      `Canonical_Productive_Minutes equals the largest single contribution, as criterion 18.6 requires.`,
      ['11.7', '18.6'],
    );
  }

  if (record.canonicalProducingRule !== 'interval_union') {
    return settle(
      false,
      'producing_rule_missing',
      `No producing rule is recorded, so there is no aggregation rule to reconcile ` +
        `${String(canonical)} minutes under; criterion 18.7 requires it to be recorded.`,
      ['11.7', '18.7'],
    );
  }

  // criterion 18.14, no inflation. Also carries the daily bound of 18.11 through the min().
  if (canonical > upperBoundMinutes) {
    return settle(
      false,
      'violates_no_inflation',
      `Canonical_Productive_Minutes of ${String(canonical)} exceeds the ${String(upperBoundMinutes)} ` +
        `minute upper bound set by the sum of its contributions; the union of intervals cannot be ` +
        `longer than the intervals it unions.`,
      ['11.7', '18.14'],
    );
  }
  // criterion 18.12, no shrinkage.
  if (canonical < lowerBoundMinutes) {
    return settle(
      false,
      'violates_no_shrinkage',
      `Canonical_Productive_Minutes of ${String(canonical)} is below the largest single contribution ` +
        `of ${String(lowerBoundMinutes)} minutes; the union of intervals contains each interval.`,
      ['11.7', '18.12'],
    );
  }
  return settle(
    true,
    'reconciled_within_union_bounds',
    `Canonical_Productive_Minutes of ${String(canonical)} reconciles under the interval-union rule ` +
      `of criterion 18.4: at least the largest single contribution (${String(lowerBoundMinutes)}) and ` +
      `at most the bounded sum (${String(upperBoundMinutes)}).`,
    ['11.7', '18.4', '18.11', '18.12', '18.14'],
  );
}
