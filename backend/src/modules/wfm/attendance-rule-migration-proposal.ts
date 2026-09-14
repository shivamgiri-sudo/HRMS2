//
// Requirement 15's migration proposal builder (requirements.md criteria 15.1, 15.2, 15.3,
// 15.8, 15.12), implemented as a PURE function in the same shape as
// attendance-source-rule-resolver.ts and canonical-productivity.ts.
//
// PURITY IS THE POINT, NOT A STYLE CHOICE
// This module reads no database, opens no connection, and never calls new Date(). Everything
// it needs arrives as an argument: the legacy rows, the Pay_Month the migration is applied in
// and the attendance_feature_config values. That is what makes it testable at all - the thing
// under test is "given these 30 + 61 rows, what rule set is proposed", and a proposal that
// depended on a clock or on live data could not be asserted against.
//
// It also means running this function changes nothing. It returns a plain object. Persisting
// that object into the tables of migration 1641 is a separate, later phase, and so is the
// approval action of criterion 15.11 that copies an approved run into attendance_source_rule /
// day_threshold_rule. Nothing here writes anywhere.
//
// NO IDENTIFIERS ARE MINTED HERE
// The 1641 tables key rows by CHAR(36) id, but a randomUUID() per proposed rule would make two
// runs over unchanged legacy data differ in every row, which is exactly what criterion 15.11's
// reviewer must be able to diff. So identity in this module is proposalKey - the sha-256 of the
// rule's canonical signature - and the persister mints the CHAR(36) ids. proposalKey is what
// uq_asrpr_key / uq_asrpdt_key are declared on.
//
// OUTPUT SHAPE MAPS ONTO 1641 DIRECTLY
//   ProposedSourceRule        -> attendance_source_rule_proposal_rule
//     .dimensionValues        -> attendance_source_rule_proposal_rule_dimension_value
//     .sourceRows             -> attendance_source_rule_proposal_source_row (target_kind 'source_rule')
//   ProposedDayThresholdRule  -> attendance_source_rule_proposal_day_threshold
//     .dimensionValues        -> attendance_source_rule_proposal_day_threshold_dimension_value
//     .sourceRows             -> attendance_source_rule_proposal_source_row (target_kind 'day_threshold')
//   ProposalFinding           -> attendance_source_rule_proposal_finding
// The provenance links are nested on each rule rather than returned as a second flat list,
// because target_id is the id the persister mints - a parallel list keyed on proposalKey would
// be the same link stored twice, and 1641's own header rejects duplicated state for that reason.

import { createHash } from 'node:crypto';

import { DIMENSION_PRIORITY_ORDER, type RuleDimension } from './attendance-source-rule-resolver.js';

// Bumped whenever the canonical signature format changes. It is part of every signature, so a
// format change produces visibly different proposal_keys instead of silently colliding with
// keys computed under the old format.
export const PROPOSAL_SIGNATURE_VERSION = 'v1';

// criterion 1.3 / decision A9: the value set is exactly enum('dialler','biometric'). No third
// value is introduced anywhere, and 'apr' is not a value in this schema.
export type ProposedAttendanceSource = 'dialler' | 'biometric';

export type LegacyTable =
  | 'attendance_rule_config'
  | 'apr_eligibility_config'
  | 'attendance_feature_config';

export type FindingSeverity = 'info' | 'decision_required' | 'blocking';

// A DATE column comes back from mysql2 either as 'YYYY-MM-DD' or as a Date constructed in the
// process's local zone, depending on the connection's dateStrings setting - so both are accepted
// and a Date is read back with local getters, which is the inverse of how mysql2 built it. UTC
// getters here would shift a date by a day for any negative-offset host.
export type LegacyDate = string | Date | null | undefined;

/** The live column list of attendance_rule_config (sql/schema-snapshot.json). 30 active rows. */
export interface LegacyAttendanceRuleConfigRow {
  id: string;
  rule_name?: string | null;
  scope_type?: string | null;
  designation_id?: string | null;
  process_id?: string | null;
  branch_id?: string | null;
  attendance_source?: string | null;
  full_day_minutes?: number | string | null;
  half_day_minutes?: number | string | null;
  grace_minutes?: number | string | null;
  effective_from?: LegacyDate;
  effective_to?: LegacyDate;
  notes?: string | null;
  active_status?: number | string | null;
  created_by?: string | null;
  created_at?: LegacyDate;
  updated_at?: LegacyDate;
}

/**
 * The live column list of apr_eligibility_config (sql/schema-snapshot.json). 61 active rows.
 *
 * There is no effective_from, no effective_to and no attendance_source column here. Both gaps
 * are handled explicitly below: criterion 15.2 for the dating, and APR_ELIGIBILITY_SOURCE for
 * the source.
 */
export interface LegacyAprEligibilityConfigRow {
  id: string;
  rule_name?: string | null;
  designation_id?: string | null;
  department_id?: string | null;
  process_id?: string | null;
  active_status?: number | string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: LegacyDate;
  updated_at?: LegacyDate;
}

/**
 * The two attendance_feature_config values criterion 15.8 names as the seed for the
 * unconstrained Day_Threshold_Rule. Passed in rather than read, and passed in as the raw
 * config_value so that "absent" and "present but unusable" stay distinguishable.
 */
export interface AttendanceFeatureConfigValues {
  biometric_half_day_floor_minutes?: string | number | null;
  netlogin_half_day_floor_minutes?: string | number | null;
}

export interface BuildProposalInput {
  attendanceRuleConfigRows: readonly LegacyAttendanceRuleConfigRow[];
  aprEligibilityConfigRows: readonly LegacyAprEligibilityConfigRow[];
  /** 'YYYY-MM'. The Pay_Month the migration is applied in - criterion 15.2's dating input. */
  appliedInPayMonth: string;
  featureConfig: AttendanceFeatureConfigValues;
}

export interface ProposedDimensionValue {
  dimension: RuleDimension;
  valueId: string;
}

export interface ProposedSourceRowLink {
  legacyTable: LegacyTable;
  legacyRowId: string;
}

export interface ProposedSourceRule {
  proposalKey: string;
  canonicalSignature: string;
  ruleName: string;
  attendanceSource: ProposedAttendanceSource;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: string;
  /** criterion 1.10 / 15.3. Exactly one proposed source rule carries 1. */
  isSystemDefault: 0 | 1;
  /** criterion 15.2. 1 when effectiveFrom was assigned from the Pay_Month, not sourced. */
  undatedSource: 0 | 1;
  ordinal: number;
  /** Empty means unconstrained. Two or more entries for one dimension is criterion 2.10. */
  dimensionValues: ProposedDimensionValue[];
  sourceRows: ProposedSourceRowLink[];
}

export interface ProposedDayThresholdRule {
  proposalKey: string;
  canonicalSignature: string;
  ruleName: string;
  fullDayMinutes: number;
  halfDayMinutes: number;
  graceMinutes: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: string;
  /** criterion 1.15. Exactly one proposed threshold rule carries 1, and it is the only one with no dimensions. */
  isUnconstrainedDefault: 0 | 1;
  undatedSource: 0 | 1;
  ordinal: number;
  dimensionValues: ProposedDimensionValue[];
  sourceRows: ProposedSourceRowLink[];
}

export interface ProposalFinding {
  findingKind: string;
  severity: FindingSeverity;
  subjectRef: string | null;
  detail: string;
  detailJson: Record<string, unknown> | null;
  ordinal: number;
}

export interface AttendanceRuleMigrationProposal {
  appliedInPayMonth: string;
  /** First day of appliedInPayMonth. The date criterion 15.2 assigns to an undated row. */
  assignedEffectiveFrom: string;
  sourceRules: ProposedSourceRule[];
  dayThresholdRules: ProposedDayThresholdRule[];
  findings: ProposalFinding[];
}

export const FINDING_KIND = {
  /** criterion 15.2, one per undated legacy row. */
  UNDATED_SOURCE_ROW: 'undated_source_row',
  /** criterion 15.2, the aggregate a reviewer approves. */
  UNDATED_ROWS_DATED_FROM_PAY_MONTH: 'undated_rows_dated_from_pay_month',
  /** The source assigned to apr_eligibility_config rows, which carry no source column. */
  APR_ELIGIBILITY_SOURCE_ASSIGNED: 'apr_eligibility_source_assigned',
  /** criterion 15.3, the collapse of the unconstrained rows into one System_Default_Rule. */
  UNCONSTRAINED_RULE_COLLAPSE: 'unconstrained_rule_collapse',
  /** criteria 1.10 / 2.6: no legacy row could supply the mandatory System_Default_Rule. */
  SYSTEM_DEFAULT_SYNTHESISED: 'system_default_synthesised',
  /** Two legacy rows describing one scope disagree on Attendance_Source (1641 header). */
  SCOPE_SOURCE_DISAGREEMENT: 'scope_source_disagreement',
  /** attendance_source outside enum('dialler','biometric'). */
  UNRECOGNISED_LEGACY_ATTENDANCE_SOURCE: 'unrecognised_legacy_attendance_source',
  /** criterion 15.8: a legacy row whose three threshold columns are not all readable. */
  LEGACY_THRESHOLDS_INCOMPLETE: 'legacy_thresholds_incomplete',
  /** criterion 15.8 / 1.15: which values the unconstrained Day_Threshold_Rule was seeded from. */
  UNCONSTRAINED_DEFAULT_SEEDED: 'unconstrained_default_seeded',
  /** criterion 15.8: a named attendance_feature_config key was absent or unusable. */
  FEATURE_CONFIG_KEY_UNUSABLE: 'feature_config_key_unusable',
  /** criterion 1.15: an unconstrained legacy row's thresholds folded into the single default. */
  UNCONSTRAINED_LEGACY_THRESHOLDS_MERGED: 'unconstrained_legacy_thresholds_merged',
} as const;

/**
 * The Attendance_Source assigned to every active apr_eligibility_config row.
 *
 * WHY dialler. apr_eligibility_config has no attendance_source column because it does not
 * describe a choice between two feeds - the table's entire purpose is to declare which
 * designation / department / process combinations are APR eligible, and the legacy engine
 * consults it (isAprEligible() in attendance-engine.service.ts) precisely to decide that an
 * employee's day is built from dialler net-login minutes rather than from biometric punches.
 * A row existing in this table IS the statement "this scope runs on the dialler". Proposing
 * biometric for these rows would invert the meaning of all 61 of them.
 *
 * This is a derived value, not a stored one, so it is disclosed as a finding
 * (APR_ELIGIBILITY_SOURCE_ASSIGNED) rather than left for a reviewer to infer from the output.
 */
export const APR_ELIGIBILITY_SOURCE: ProposedAttendanceSource = 'dialler';

/**
 * The source the single System_Default_Rule carries when the unconstrained legacy rows
 * disagree (criterion 15.3).
 *
 * WHY biometric. The default is the rule that reaches every employee no scoped rule matches,
 * so its source decides what EVIDENCE those employees' pay rests on. Biometric is a physical
 * punch; dialler is derived from login activity, and an employee with no dialler activity at
 * all resolves to zero productive minutes rather than to "no data". Promoting the default to
 * dialler is therefore the failure mode migration 1127 already measured once, at 1,577.5 paid
 * days removed. arc-global-001 (biometric) is also the older and wider of the two rows, and
 * arc-apr-ops-exec (dialler) describes Operations executives - a population the scoped rules
 * and apr_eligibility_config already cover on their own merits.
 *
 * The builder does NOT act on this silently: the collapse always emits a decision_required
 * finding naming both inputs, both contributing rows appear in sourceRows, and criterion
 * 15.11's approval is where a human confirms or overrides it.
 */
export const SYSTEM_DEFAULT_PREFERRED_SOURCE: ProposedAttendanceSource = 'biometric';

/**
 * Fallbacks for the two threshold values attendance_feature_config does NOT hold.
 *
 * Criterion 15.8 names only the two half-day floors as the seed, so full_day_minutes and
 * grace_minutes for the unconstrained default have to come from somewhere else. First choice is
 * an unconstrained active attendance_rule_config row, because that is literally what the engine
 * applies today for a globally-scoped employee. When no such row supplies them, these constants
 * stand in - and they are not invented numbers: they are the "Fallback Default" rule
 * attendance-engine.service.ts already applies to an employee no attendance_rule_config row
 * matches (full 540, half 270, grace 15). Duplicated as literals rather than imported because
 * that module opens a database connection and this one must not.
 */
export const LEGACY_ENGINE_FALLBACK_FULL_DAY_MINUTES = 540;
export const LEGACY_ENGINE_FALLBACK_GRACE_MINUTES = 15;

/**
 * Applied when NEITHER named half-day floor key is readable. Same value and same reasoning as
 * DEFAULT_HALF_DAY_FLOOR_MINUTES in attendance-engine.service.ts, which is what production
 * classifies against when the key is missing. Using it produces a store that still satisfies
 * criterion 1.15, and the accompanying finding is 'blocking' so the proposal cannot be approved
 * on a guess.
 */
export const DEFAULT_HALF_DAY_FLOOR_MINUTES = 240;

// -- small pure helpers -------------------------------------------------------------------

function isActive(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  return Number(value) === 1;
}

/** Trimmed non-empty identifier, or null. An empty string is not a constraint on a value. */
function normaliseId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normaliseDate(value: LegacyDate): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = String(value.getFullYear()).padStart(4, '0');
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  if (text === '') return null;
  // Accepts 'YYYY-MM-DD' and 'YYYY-MM-DD HH:MM:SS'; anything else is not a usable date.
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/.exec(text);
  return match ? match[1]! : null;
}

/** A minute count that can be stored in SMALLINT UNSIGNED NOT NULL, or null. */
function toMinutes(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    return null;
  }
  return parsed;
}

/** A positive minute count from a feature-config value, or null when absent or unusable. */
function toFeatureConfigMinutes(value: string | number | null | undefined): number | null {
  const minutes = toMinutes(value);
  if (minutes === null || minutes <= 0) return null;
  return minutes;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const DIMENSION_INDEX = new Map<RuleDimension, number>(
  DIMENSION_PRIORITY_ORDER.map((d, i) => [d, i]),
);

/** Dimension_Priority_Order first, then value, so the list is a function of content only. */
function sortDimensionValues(values: readonly ProposedDimensionValue[]): ProposedDimensionValue[] {
  return [...values].sort((a, b) => {
    const da = DIMENSION_INDEX.get(a.dimension) ?? Number.MAX_SAFE_INTEGER;
    const db = DIMENSION_INDEX.get(b.dimension) ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return compareText(a.valueId, b.valueId);
  });
}

function dimensionSignature(values: readonly ProposedDimensionValue[]): string {
  if (values.length === 0) return '-';
  return sortDimensionValues(values)
    .map((v) => `${v.dimension}=${v.valueId}`)
    .join(',');
}

function sortSourceRows(rows: readonly ProposedSourceRowLink[]): ProposedSourceRowLink[] {
  const seen = new Set<string>();
  const unique: ProposedSourceRowLink[] = [];
  for (const row of rows) {
    const key = `${row.legacyTable}:${row.legacyRowId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique.sort(
    (a, b) =>
      compareText(a.legacyTable, b.legacyTable) || compareText(a.legacyRowId, b.legacyRowId),
  );
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function describeSourceRows(rows: readonly ProposedSourceRowLink[]): string {
  return rows.map((r) => `${r.legacyTable}:${r.legacyRowId}`).join(', ');
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  blocking: 0,
  decision_required: 1,
  info: 2,
};

// -- normalised legacy candidates --------------------------------------------------------

interface SourceRuleCandidate {
  legacyTable: 'attendance_rule_config' | 'apr_eligibility_config';
  legacyRowId: string;
  ruleName: string | null;
  attendanceSource: ProposedAttendanceSource;
  dimensionValues: ProposedDimensionValue[];
  effectiveFrom: string;
  effectiveTo: string | null;
  undatedSource: boolean;
}

interface ThresholdCandidate {
  legacyRowId: string;
  ruleName: string | null;
  fullDayMinutes: number;
  halfDayMinutes: number;
  graceMinutes: number;
  dimensionValues: ProposedDimensionValue[];
  effectiveFrom: string;
  effectiveTo: string | null;
  undatedSource: boolean;
}

interface FindingDraft {
  findingKind: string;
  severity: FindingSeverity;
  subjectRef: string | null;
  detail: string;
  detailJson: Record<string, unknown> | null;
}

/** A dimension value list built from the named columns. NULL and '' both mean unconstrained. */
function dimensionValuesFrom(
  pairs: ReadonlyArray<[RuleDimension, string | null | undefined]>,
): ProposedDimensionValue[] {
  const out: ProposedDimensionValue[] = [];
  for (const [dimension, raw] of pairs) {
    const valueId = normaliseId(raw);
    // A NULL dimension column means the legacy row does not constrain that dimension. It is
    // never a constraint on the value NULL: criterion 2.8 makes an employee with no value for a
    // dimension a non-match for every rule constraining it, so a rule "constraining" the
    // dimension to NULL would match nobody at all.
    if (valueId === null) continue;
    out.push({ dimension, valueId });
  }
  return sortDimensionValues(out);
}

// -- the builder --------------------------------------------------------------------------

/**
 * Build the Requirement 15 migration proposal. Pure: same arguments in, byte-identical
 * proposal out, in any input order.
 *
 * @throws when appliedInPayMonth is not 'YYYY-MM'. The Pay_Month is criterion 15.2's dating
 *   input, and a proposal built from an unparseable one would silently mis-date 61 rows.
 */
export function buildAttendanceRuleMigrationProposal(
  input: BuildProposalInput,
): AttendanceRuleMigrationProposal {
  const payMonth = String(input.appliedInPayMonth ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payMonth)) {
    throw new Error(
      `appliedInPayMonth must be 'YYYY-MM' (received ${JSON.stringify(input.appliedInPayMonth)}). ` +
        'Criterion 15.2 dates every undated legacy row from the first day of this month.',
    );
  }
  const assignedEffectiveFrom = `${payMonth}-01`;

  const findings: FindingDraft[] = [];

  const sourceCandidates: SourceRuleCandidate[] = [];
  const thresholdCandidates: ThresholdCandidate[] = [];
  const undatedRows: ProposedSourceRowLink[] = [];

  // -- attendance_rule_config: 30 active rows, source + thresholds + a real effective window --
  for (const row of input.attendanceRuleConfigRows) {
    if (!isActive(row.active_status)) continue; // criteria 15.1: ACTIVE rows only
    const legacyRowId = normaliseId(row.id) ?? String(row.id ?? '');

    const dimensionValues = dimensionValuesFrom([
      ['process', row.process_id],
      ['branch', row.branch_id],
      ['designation', row.designation_id],
    ]);

    const rawSource = normaliseId(row.attendance_source)?.toLowerCase() ?? null;
    let attendanceSource: ProposedAttendanceSource;
    if (rawSource === 'dialler' || rawSource === 'biometric') {
      attendanceSource = rawSource;
    } else {
      // The column is enum('dialler','biometric') so this is unreachable through MySQL, but a
      // proposal that quietly picked a source for an unreadable value would be asserting
      // something it does not know. Conservative choice plus a blocking finding.
      attendanceSource = SYSTEM_DEFAULT_PREFERRED_SOURCE;
      findings.push({
        findingKind: FINDING_KIND.UNRECOGNISED_LEGACY_ATTENDANCE_SOURCE,
        severity: 'blocking',
        subjectRef: `attendance_rule_config:${legacyRowId}`,
        detail:
          `attendance_rule_config row ${legacyRowId} carries the Attendance_Source ` +
          `${JSON.stringify(row.attendance_source ?? null)}, which is not one of ` +
          `'dialler' or 'biometric'. ${attendanceSource} was proposed as the conservative ` +
          'option; this proposal is not approvable until the legacy value is corrected.',
        detailJson: {
          legacy_table: 'attendance_rule_config',
          legacy_row_id: legacyRowId,
          legacy_value: row.attendance_source ?? null,
          proposed_attendance_source: attendanceSource,
        },
      });
    }

    const sourcedFrom = normaliseDate(row.effective_from);
    const effectiveFrom = sourcedFrom ?? assignedEffectiveFrom;
    const undatedSource = sourcedFrom === null;
    const effectiveTo = normaliseDate(row.effective_to);
    if (undatedSource) {
      undatedRows.push({ legacyTable: 'attendance_rule_config', legacyRowId });
    }

    sourceCandidates.push({
      legacyTable: 'attendance_rule_config',
      legacyRowId,
      ruleName: normaliseId(row.rule_name),
      attendanceSource,
      dimensionValues,
      effectiveFrom,
      effectiveTo,
      undatedSource,
    });

    // criterion 15.8: the thresholds come from these rows and only these rows.
    // apr_eligibility_config holds no threshold columns.
    const fullDayMinutes = toMinutes(row.full_day_minutes);
    const halfDayMinutes = toMinutes(row.half_day_minutes);
    const graceMinutes = toMinutes(row.grace_minutes);
    if (fullDayMinutes === null || halfDayMinutes === null || graceMinutes === null) {
      findings.push({
        findingKind: FINDING_KIND.LEGACY_THRESHOLDS_INCOMPLETE,
        severity: 'decision_required',
        subjectRef: `attendance_rule_config:${legacyRowId}`,
        detail:
          `attendance_rule_config row ${legacyRowId} does not carry all three day-classification ` +
          'thresholds, so no Day_Threshold_Rule was proposed for its scope and employees in that ' +
          'scope will resolve to the unconstrained default. Supply the missing values or confirm ' +
          'the default is correct for that scope.',
        detailJson: {
          legacy_table: 'attendance_rule_config',
          legacy_row_id: legacyRowId,
          full_day_minutes: row.full_day_minutes ?? null,
          half_day_minutes: row.half_day_minutes ?? null,
          grace_minutes: row.grace_minutes ?? null,
        },
      });
    } else {
      thresholdCandidates.push({
        legacyRowId,
        ruleName: normaliseId(row.rule_name),
        fullDayMinutes,
        halfDayMinutes,
        graceMinutes,
        dimensionValues,
        effectiveFrom,
        effectiveTo,
        undatedSource,
      });
    }
  }

  // -- apr_eligibility_config: 61 active rows, no source column and no effective dating ------
  const aprRowIds: string[] = [];
  for (const row of input.aprEligibilityConfigRows) {
    if (!isActive(row.active_status)) continue;
    const legacyRowId = normaliseId(row.id) ?? String(row.id ?? '');
    aprRowIds.push(legacyRowId);

    sourceCandidates.push({
      legacyTable: 'apr_eligibility_config',
      legacyRowId,
      ruleName: normaliseId(row.rule_name),
      attendanceSource: APR_ELIGIBILITY_SOURCE,
      dimensionValues: dimensionValuesFrom([
        ['process', row.process_id],
        ['department', row.department_id],
        ['designation', row.designation_id],
      ]),
      // criterion 15.2: the table has no effective-dating column at all, so EVERY active row
      // is undated and every one of them is dated from the run's Pay_Month.
      effectiveFrom: assignedEffectiveFrom,
      effectiveTo: null,
      undatedSource: true,
    });
    undatedRows.push({ legacyTable: 'apr_eligibility_config', legacyRowId });
  }

  if (aprRowIds.length > 0) {
    const sortedAprRowIds = [...aprRowIds].sort(compareText);
    findings.push({
      findingKind: FINDING_KIND.APR_ELIGIBILITY_SOURCE_ASSIGNED,
      severity: 'info',
      subjectRef: 'apr_eligibility_config',
      detail:
        `${sortedAprRowIds.length} active apr_eligibility_config row(s) were proposed with ` +
        `Attendance_Source '${APR_ELIGIBILITY_SOURCE}'. That table carries no attendance_source ` +
        'column: a row existing in it is the declaration that its designation, department and ' +
        'process scope is APR eligible, which is what routes the day to dialler net-login ' +
        'minutes rather than to biometric punches in the current engine.',
      detailJson: {
        legacy_table: 'apr_eligibility_config',
        assigned_attendance_source: APR_ELIGIBILITY_SOURCE,
        active_row_count: sortedAprRowIds.length,
        legacy_row_ids: sortedAprRowIds,
      },
    });
  }

  // -- criterion 15.2 disclosure -------------------------------------------------------------
  const sortedUndatedRows = sortSourceRows(undatedRows);
  for (const link of sortedUndatedRows) {
    findings.push({
      findingKind: FINDING_KIND.UNDATED_SOURCE_ROW,
      severity: 'info',
      subjectRef: `${link.legacyTable}:${link.legacyRowId}`,
      detail:
        `${link.legacyTable} row ${link.legacyRowId} carries no effective-from date, so the ` +
        `proposed rule was dated ${assignedEffectiveFrom}, the first day of Pay_Month ` +
        `${payMonth}.`,
      detailJson: {
        legacy_table: link.legacyTable,
        legacy_row_id: link.legacyRowId,
        assigned_effective_from: assignedEffectiveFrom,
      },
    });
  }
  if (sortedUndatedRows.length > 0) {
    findings.push({
      findingKind: FINDING_KIND.UNDATED_ROWS_DATED_FROM_PAY_MONTH,
      severity: 'decision_required',
      subjectRef: payMonth,
      detail:
        `${sortedUndatedRows.length} legacy row(s) carried no effective-from date and were ` +
        `assigned ${assignedEffectiveFrom} (criterion 15.2). Confirm that this Pay_Month is the ` +
        'month the migration is being applied in: the assigned date decides from when each of ' +
        'these rules is in force, and a wrong month back-dates or delays all of them together.',
      detailJson: {
        applied_in_pay_month: payMonth,
        assigned_effective_from: assignedEffectiveFrom,
        undated_row_count: sortedUndatedRows.length,
        undated_rows: sortedUndatedRows.map((r) => `${r.legacyTable}:${r.legacyRowId}`),
      },
    });
  }

  // -- 1641 header disclosure: scopes where two legacy rows disagree on source ---------------
  const byScope = new Map<string, SourceRuleCandidate[]>();
  for (const candidate of sourceCandidates) {
    const scope = dimensionSignature(candidate.dimensionValues);
    const bucket = byScope.get(scope);
    if (bucket) bucket.push(candidate);
    else byScope.set(scope, [candidate]);
  }
  for (const [scope, bucket] of [...byScope.entries()].sort((a, b) => compareText(a[0], b[0]))) {
    const sources = [...new Set(bucket.map((c) => c.attendanceSource))].sort(compareText);
    if (sources.length < 2) continue;
    const contributors = sortSourceRows(
      bucket.map((c) => ({ legacyTable: c.legacyTable, legacyRowId: c.legacyRowId })),
    );
    findings.push({
      findingKind: FINDING_KIND.SCOPE_SOURCE_DISAGREEMENT,
      severity: 'decision_required',
      subjectRef: scope,
      detail:
        `Scope ${scope} is described by legacy rows that disagree on Attendance_Source ` +
        `(${sources.join(' and ')}): ${describeSourceRows(contributors)}. One proposed rule per ` +
        'legacy row preserves both, so resolution for an employee in this scope is decided by ' +
        'the Requirement 2 tie-break rather than by an explicit choice. Deactivate the row that ' +
        'is wrong, or confirm the tie-break outcome.',
      detailJson: {
        scope,
        attendance_sources: sources,
        legacy_rows: contributors.map((r) => `${r.legacyTable}:${r.legacyRowId}`),
      },
    });
  }

  // -- criterion 15.3: exactly one System_Default_Rule ---------------------------------------
  const unconstrained = sourceCandidates.filter((c) => c.dimensionValues.length === 0);
  const constrained = sourceCandidates.filter((c) => c.dimensionValues.length > 0);

  // Both the System_Default_Rule and the unconstrained Day_Threshold_Rule have to be candidates
  // for every date any other proposed rule is in force, or criterion 2.6's total coverage and
  // criterion 1.15's guarantee hold only from a later date. So they take the earliest
  // effective-from in the whole proposal, open-ended.
  const datedCandidates: Array<{ effectiveFrom: string; undatedSource: boolean }> = [
    ...sourceCandidates.map((c) => ({ effectiveFrom: c.effectiveFrom, undatedSource: c.undatedSource })),
    ...thresholdCandidates.map((c) => ({
      effectiveFrom: c.effectiveFrom,
      undatedSource: c.undatedSource,
    })),
  ];
  let earliestFrom = assignedEffectiveFrom;
  let earliestFromWasAssigned = true;
  for (const c of datedCandidates) {
    if (
      c.effectiveFrom < earliestFrom ||
      // Same date sourced from a real legacy value beats the same date we assigned.
      (c.effectiveFrom === earliestFrom && !c.undatedSource && earliestFromWasAssigned)
    ) {
      earliestFrom = c.effectiveFrom;
      earliestFromWasAssigned = c.undatedSource;
    }
  }

  const systemDefaultContributors = sortSourceRows(
    unconstrained.map((c) => ({ legacyTable: c.legacyTable, legacyRowId: c.legacyRowId })),
  );
  const unconstrainedSources = [...new Set(unconstrained.map((c) => c.attendanceSource))].sort(
    compareText,
  );

  let systemDefaultSource: ProposedAttendanceSource;
  if (unconstrained.length === 0) {
    systemDefaultSource = SYSTEM_DEFAULT_PREFERRED_SOURCE;
    findings.push({
      findingKind: FINDING_KIND.SYSTEM_DEFAULT_SYNTHESISED,
      severity: 'blocking',
      subjectRef: 'System_Default_Rule',
      detail:
        'No active legacy row constrains none of the Rule_Dimensions, so nothing in the legacy ' +
        `data could supply the System_Default_Rule criterion 1.10 requires. One carrying ` +
        `'${systemDefaultSource}' was synthesised so that criterion 2.6's total coverage holds, ` +
        'with no legacy provenance. It cannot be approved without a stated owner decision.',
      detailJson: {
        proposed_attendance_source: systemDefaultSource,
        contributing_legacy_rows: [],
      },
    });
  } else {
    systemDefaultSource = unconstrainedSources.includes(SYSTEM_DEFAULT_PREFERRED_SOURCE)
      ? SYSTEM_DEFAULT_PREFERRED_SOURCE
      : // Every contributor agrees on the other value, so that is the only honest answer.
        unconstrainedSources[0]!;
    findings.push({
      findingKind: FINDING_KIND.UNCONSTRAINED_RULE_COLLAPSE,
      severity: unconstrained.length > 1 ? 'decision_required' : 'info',
      subjectRef: 'System_Default_Rule',
      detail:
        `${unconstrained.length} active legacy row(s) constrain no Rule_Dimension: ` +
        `${describeSourceRows(systemDefaultContributors)} ` +
        `(source${unconstrainedSources.length > 1 ? 's' : ''} ${unconstrainedSources.join(' and ')}). ` +
        `They were collapsed into exactly one System_Default_Rule carrying ` +
        `'${systemDefaultSource}', effective from ${earliestFrom} with no end date, as criterion ` +
        `1.10 requires. ` +
        (unconstrained.length > 1
          ? `'${systemDefaultSource}' was chosen because the default decides what evidence pay ` +
            'rests on for every employee no scoped rule matches, and biometric is a physical ' +
            'punch while dialler is derived from login activity that an employee may have none ' +
            'of. Two unconstrained rows are why resolution is non-deterministic today, so this ' +
            'choice must be confirmed rather than discovered later. Every contributing row is ' +
            'recorded against the proposed rule.'
          : 'Its Attendance_Source is carried through unchanged.'),
      detailJson: {
        unconstrained_row_count: unconstrained.length,
        contributing_legacy_rows: systemDefaultContributors.map(
          (r) => `${r.legacyTable}:${r.legacyRowId}`,
        ),
        legacy_attendance_sources: unconstrainedSources,
        proposed_attendance_source: systemDefaultSource,
        effective_from: earliestFrom,
      },
    });
  }

  // -- criterion 15.1: one proposed rule per active row, identical proposals deduplicated -----
  interface SourceRuleGroup {
    canonicalSignature: string;
    attendanceSource: ProposedAttendanceSource;
    dimensionValues: ProposedDimensionValue[];
    effectiveFrom: string;
    effectiveTo: string | null;
    undatedSource: boolean;
    contributors: SourceRuleCandidate[];
  }
  const sourceGroups = new Map<string, SourceRuleGroup>();
  for (const candidate of constrained) {
    const signature = sourceRuleSignature({
      isSystemDefault: false,
      attendanceSource: candidate.attendanceSource,
      dimensionValues: candidate.dimensionValues,
      effectiveFrom: candidate.effectiveFrom,
      effectiveTo: candidate.effectiveTo,
    });
    const existing = sourceGroups.get(signature);
    if (existing) {
      existing.contributors.push(candidate);
      continue;
    }
    sourceGroups.set(signature, {
      canonicalSignature: signature,
      attendanceSource: candidate.attendanceSource,
      dimensionValues: candidate.dimensionValues,
      effectiveFrom: candidate.effectiveFrom,
      effectiveTo: candidate.effectiveTo,
      undatedSource: candidate.undatedSource,
      contributors: [candidate],
    });
  }

  const sourceRules: ProposedSourceRule[] = [];

  const systemDefaultSignature = sourceRuleSignature({
    isSystemDefault: true,
    attendanceSource: systemDefaultSource,
    dimensionValues: [],
    effectiveFrom: earliestFrom,
    effectiveTo: null,
  });
  sourceRules.push({
    proposalKey: sha256Hex(systemDefaultSignature),
    canonicalSignature: systemDefaultSignature,
    ruleName: 'System_Default_Rule',
    attendanceSource: systemDefaultSource,
    effectiveFrom: earliestFrom,
    effectiveTo: null,
    changeReason:
      unconstrained.length === 0
        ? 'Synthesised by the Requirement 15 migration builder: criterion 1.10 requires exactly ' +
          'one System_Default_Rule and no active legacy row was unconstrained.'
        : `Collapsed by the Requirement 15 migration builder (criterion 15.3) from ` +
          `${unconstrained.length} unconstrained legacy row(s) into the single ` +
          `System_Default_Rule criterion 1.10 requires: ` +
          `${describeSourceRows(systemDefaultContributors)}.`,
    isSystemDefault: 1,
    undatedSource: earliestFromWasAssigned ? 1 : 0,
    ordinal: 0,
    dimensionValues: [],
    sourceRows: systemDefaultContributors,
  });

  for (const group of sourceGroups.values()) {
    const sourceRows = sortSourceRows(
      group.contributors.map((c) => ({ legacyTable: c.legacyTable, legacyRowId: c.legacyRowId })),
    );
    sourceRules.push({
      proposalKey: sha256Hex(group.canonicalSignature),
      canonicalSignature: group.canonicalSignature,
      ruleName: pickRuleName(group.contributors, sourceRows),
      attendanceSource: group.attendanceSource,
      effectiveFrom: group.effectiveFrom,
      effectiveTo: group.effectiveTo,
      changeReason:
        `Proposed by the Requirement 15 migration builder (criterion 15.1) from ` +
        `${sourceRows.length} legacy row(s): ${describeSourceRows(sourceRows)}. Rule_Dimension ` +
        'values, Attendance_Source and effective-date window are carried through unchanged.',
      isSystemDefault: 0,
      undatedSource: group.undatedSource ? 1 : 0,
      ordinal: 0,
      dimensionValues: group.dimensionValues,
      sourceRows,
    });
  }

  // -- criterion 15.8 + 1.15: the day-threshold rules ----------------------------------------
  const unconstrainedThresholds = thresholdCandidates.filter(
    (c) => c.dimensionValues.length === 0,
  );
  const constrainedThresholds = thresholdCandidates.filter((c) => c.dimensionValues.length > 0);

  const seeded = seedUnconstrainedDefault(
    input.featureConfig,
    unconstrainedThresholds,
    findings,
  );

  interface ThresholdGroup {
    canonicalSignature: string;
    fullDayMinutes: number;
    halfDayMinutes: number;
    graceMinutes: number;
    dimensionValues: ProposedDimensionValue[];
    effectiveFrom: string;
    effectiveTo: string | null;
    undatedSource: boolean;
    contributors: ThresholdCandidate[];
  }
  const thresholdGroups = new Map<string, ThresholdGroup>();
  for (const candidate of constrainedThresholds) {
    const signature = dayThresholdSignature({
      isUnconstrainedDefault: false,
      fullDayMinutes: candidate.fullDayMinutes,
      halfDayMinutes: candidate.halfDayMinutes,
      graceMinutes: candidate.graceMinutes,
      dimensionValues: candidate.dimensionValues,
      effectiveFrom: candidate.effectiveFrom,
      effectiveTo: candidate.effectiveTo,
    });
    const existing = thresholdGroups.get(signature);
    if (existing) {
      existing.contributors.push(candidate);
      continue;
    }
    thresholdGroups.set(signature, {
      canonicalSignature: signature,
      fullDayMinutes: candidate.fullDayMinutes,
      halfDayMinutes: candidate.halfDayMinutes,
      graceMinutes: candidate.graceMinutes,
      dimensionValues: candidate.dimensionValues,
      effectiveFrom: candidate.effectiveFrom,
      effectiveTo: candidate.effectiveTo,
      undatedSource: candidate.undatedSource,
      contributors: [candidate],
    });
  }

  const dayThresholdRules: ProposedDayThresholdRule[] = [];

  const defaultThresholdSignature = dayThresholdSignature({
    isUnconstrainedDefault: true,
    fullDayMinutes: seeded.fullDayMinutes,
    halfDayMinutes: seeded.halfDayMinutes,
    graceMinutes: seeded.graceMinutes,
    dimensionValues: [],
    effectiveFrom: earliestFrom,
    effectiveTo: null,
  });
  dayThresholdRules.push({
    proposalKey: sha256Hex(defaultThresholdSignature),
    canonicalSignature: defaultThresholdSignature,
    ruleName: 'Unconstrained_Day_Threshold_Default',
    fullDayMinutes: seeded.fullDayMinutes,
    halfDayMinutes: seeded.halfDayMinutes,
    graceMinutes: seeded.graceMinutes,
    effectiveFrom: earliestFrom,
    effectiveTo: null,
    changeReason: seeded.changeReason,
    isUnconstrainedDefault: 1,
    undatedSource: earliestFromWasAssigned ? 1 : 0,
    ordinal: 0,
    dimensionValues: [],
    sourceRows: seeded.sourceRows,
  });

  for (const group of thresholdGroups.values()) {
    const sourceRows = sortSourceRows(
      group.contributors.map((c) => ({
        legacyTable: 'attendance_rule_config' as const,
        legacyRowId: c.legacyRowId,
      })),
    );
    dayThresholdRules.push({
      proposalKey: sha256Hex(group.canonicalSignature),
      canonicalSignature: group.canonicalSignature,
      ruleName: pickThresholdRuleName(group.contributors, sourceRows),
      fullDayMinutes: group.fullDayMinutes,
      halfDayMinutes: group.halfDayMinutes,
      graceMinutes: group.graceMinutes,
      effectiveFrom: group.effectiveFrom,
      effectiveTo: group.effectiveTo,
      changeReason:
        `Proposed by the Requirement 15 migration builder (criterion 15.8) from ` +
        `${sourceRows.length} legacy row(s) sharing one combination of full_day_minutes, ` +
        `half_day_minutes, grace_minutes, Rule_Dimension values and effective-date window: ` +
        `${describeSourceRows(sourceRows)}.`,
      isUnconstrainedDefault: 0,
      undatedSource: group.undatedSource ? 1 : 0,
      ordinal: 0,
      dimensionValues: group.dimensionValues,
      sourceRows,
    });
  }

  return {
    appliedInPayMonth: payMonth,
    assignedEffectiveFrom,
    sourceRules: assignSourceRuleOrdinals(sourceRules),
    dayThresholdRules: assignDayThresholdOrdinals(dayThresholdRules),
    findings: assignFindingOrdinals(findings),
  };
}

// -- canonical signatures ------------------------------------------------------------------
//
// The signature is the rule's identity: everything the rule MEANS and nothing about where it
// came from or what an administrator called it. Two legacy rows with the same meaning therefore
// produce the same signature, the same sha-256 proposal_key and one proposed rule with two
// contributors, which is what makes a re-run over unchanged data byte-identical to the previous
// one and a real change visible as a real diff.

function sourceRuleSignature(rule: {
  isSystemDefault: boolean;
  attendanceSource: ProposedAttendanceSource;
  dimensionValues: readonly ProposedDimensionValue[];
  effectiveFrom: string;
  effectiveTo: string | null;
}): string {
  return [
    'attendance_source_rule',
    PROPOSAL_SIGNATURE_VERSION,
    `system_default=${rule.isSystemDefault ? 1 : 0}`,
    `source=${rule.attendanceSource}`,
    `dims=${dimensionSignature(rule.dimensionValues)}`,
    `from=${rule.effectiveFrom}`,
    `to=${rule.effectiveTo ?? '-'}`,
  ].join('|');
}

function dayThresholdSignature(rule: {
  isUnconstrainedDefault: boolean;
  fullDayMinutes: number;
  halfDayMinutes: number;
  graceMinutes: number;
  dimensionValues: readonly ProposedDimensionValue[];
  effectiveFrom: string;
  effectiveTo: string | null;
}): string {
  return [
    'day_threshold_rule',
    PROPOSAL_SIGNATURE_VERSION,
    `unconstrained_default=${rule.isUnconstrainedDefault ? 1 : 0}`,
    `full=${rule.fullDayMinutes}`,
    `half=${rule.halfDayMinutes}`,
    `grace=${rule.graceMinutes}`,
    `dims=${dimensionSignature(rule.dimensionValues)}`,
    `from=${rule.effectiveFrom}`,
    `to=${rule.effectiveTo ?? '-'}`,
  ].join('|');
}

// A deduplicated rule can have contributors with different rule_name values, and rule_name is
// deliberately NOT in the signature - two rows meaning the same thing under different names are
// still one rule. The name therefore has to be chosen by a rule that does not depend on input
// order: the lexicographically least non-empty legacy name, falling back to a name derived from
// the least contributor id.
function pickRuleName(
  contributors: readonly SourceRuleCandidate[],
  sourceRows: readonly ProposedSourceRowLink[],
): string {
  return leastName(
    contributors.map((c) => c.ruleName),
    sourceRows,
  );
}

function pickThresholdRuleName(
  contributors: readonly ThresholdCandidate[],
  sourceRows: readonly ProposedSourceRowLink[],
): string {
  return leastName(
    contributors.map((c) => c.ruleName),
    sourceRows,
  );
}

function leastName(
  names: ReadonlyArray<string | null>,
  sourceRows: readonly ProposedSourceRowLink[],
): string {
  const usable = names.filter((n): n is string => n !== null && n !== '').sort(compareText);
  if (usable.length > 0) return usable[0]!;
  const first = sourceRows[0];
  return first ? `Migrated_${first.legacyTable}_${first.legacyRowId}` : 'Migrated_rule';
}

// -- the unconstrained Day_Threshold_Rule of criteria 15.8 / 1.15 --------------------------

interface SeededDefault {
  fullDayMinutes: number;
  halfDayMinutes: number;
  graceMinutes: number;
  changeReason: string;
  sourceRows: ProposedSourceRowLink[];
}

/**
 * Seed the single unconstrained Day_Threshold_Rule.
 *
 * WHY THERE IS EXACTLY ONE, EVEN THOUGH CRITERION 15.8 WOULD PRODUCE MORE
 * Criterion 15.8 asks for one Day_Threshold_Rule per distinct threshold-plus-dimensions
 * combination across the 30 active attendance_rule_config rows. Two of those rows constrain no
 * dimension, so read literally that yields up to two dimension-free threshold rules on top of
 * the seeded default - and criterion 1.15 states the store holds exactly ONE rule constraining
 * no dimension, which is what guarantees every employee and date resolves to exactly one set of
 * thresholds. 1.15 is the store invariant, so it wins: an unconstrained legacy row does not
 * become a rule of its own. It is recorded as a contributor to the seeded default, and if its
 * thresholds differ from the seeded values that difference is a decision_required finding rather
 * than a silently discarded value.
 *
 * WHICH HALF-DAY FLOOR
 * biometric_half_day_floor_minutes, not netlogin_half_day_floor_minutes, because the single
 * System_Default_Rule carries biometric (see SYSTEM_DEFAULT_PREFERRED_SOURCE): an employee who
 * reaches the unconstrained Day_Threshold_Rule reaches the unconstrained Attendance_Source_Rule
 * too, and their day is built from biometric minutes. Applying the net-login floor to a
 * biometric day would be classifying one feed's minutes against the other feed's threshold.
 * The value not taken is named in the finding either way.
 *
 * MISSING KEYS
 *   biometric usable                     -> applied, finding 'info'
 *   biometric absent/unusable, netlogin usable -> netlogin applied, finding 'decision_required'
 *   neither usable                       -> DEFAULT_HALF_DAY_FLOOR_MINUTES applied so criterion
 *                                           1.15 still holds, finding 'blocking' so the
 *                                           proposal cannot be approved on a guess
 * "Unusable" and "absent" are treated alike on purpose: Number('') is 0 and Number('abc') is
 * NaN, and either one silently reclassifies every short day. Same reasoning as
 * resolveHalfDayFloorMinutes() in attendance-engine.service.ts.
 */
function seedUnconstrainedDefault(
  featureConfig: AttendanceFeatureConfigValues,
  unconstrainedThresholds: readonly ThresholdCandidate[],
  findings: FindingDraft[],
): SeededDefault {
  const biometricFloor = toFeatureConfigMinutes(featureConfig?.biometric_half_day_floor_minutes);
  const netloginFloor = toFeatureConfigMinutes(featureConfig?.netlogin_half_day_floor_minutes);

  let halfDayMinutes: number;
  let halfDaySourceKey: string | null;
  if (biometricFloor !== null) {
    halfDayMinutes = biometricFloor;
    halfDaySourceKey = 'biometric_half_day_floor_minutes';
  } else if (netloginFloor !== null) {
    halfDayMinutes = netloginFloor;
    halfDaySourceKey = 'netlogin_half_day_floor_minutes';
    findings.push({
      findingKind: FINDING_KIND.FEATURE_CONFIG_KEY_UNUSABLE,
      severity: 'decision_required',
      subjectRef: 'biometric_half_day_floor_minutes',
      detail:
        'attendance_feature_config.biometric_half_day_floor_minutes is absent or not a usable ' +
        'number of minutes, so the unconstrained Day_Threshold_Rule was seeded from ' +
        `netlogin_half_day_floor_minutes (${halfDayMinutes}) instead. The default rule pairs ` +
        'with a biometric System_Default_Rule, so confirm that the net-login floor is the ' +
        'correct half-day threshold for a biometric day, or set the biometric key.',
      detailJson: {
        absent_key: 'biometric_half_day_floor_minutes',
        absent_key_raw_value: featureConfig?.biometric_half_day_floor_minutes ?? null,
        applied_key: 'netlogin_half_day_floor_minutes',
        applied_half_day_minutes: halfDayMinutes,
      },
    });
  } else {
    halfDayMinutes = DEFAULT_HALF_DAY_FLOOR_MINUTES;
    halfDaySourceKey = null;
    findings.push({
      findingKind: FINDING_KIND.FEATURE_CONFIG_KEY_UNUSABLE,
      severity: 'blocking',
      subjectRef: 'biometric_half_day_floor_minutes,netlogin_half_day_floor_minutes',
      detail:
        'Neither attendance_feature_config.biometric_half_day_floor_minutes nor ' +
        'netlogin_half_day_floor_minutes holds a usable number of minutes, and criterion 15.8 ' +
        'names those two values as the seed for the unconstrained Day_Threshold_Rule. ' +
        `${DEFAULT_HALF_DAY_FLOOR_MINUTES} was applied so that criterion 1.15 still holds and ` +
        'every employee resolves to some threshold set, but that is the engine fallback rather ' +
        'than a configured value: this proposal is not approvable until one of the two keys is set.',
      detailJson: {
        biometric_half_day_floor_minutes:
          featureConfig?.biometric_half_day_floor_minutes ?? null,
        netlogin_half_day_floor_minutes: featureConfig?.netlogin_half_day_floor_minutes ?? null,
        applied_half_day_minutes: DEFAULT_HALF_DAY_FLOOR_MINUTES,
      },
    });
  }

  // full_day_minutes and grace_minutes are not in attendance_feature_config at all. Prefer an
  // unconstrained active attendance_rule_config row, which is what the engine applies today for
  // a globally scoped employee. Deterministic pick: earliest effective_from, then least id -
  // the oldest, and the tie-break is content, never input order.
  const ordered = [...unconstrainedThresholds].sort(
    (a, b) =>
      compareText(a.effectiveFrom, b.effectiveFrom) || compareText(a.legacyRowId, b.legacyRowId),
  );
  const supplier = ordered[0] ?? null;

  const fullDayMinutes = supplier ? supplier.fullDayMinutes : LEGACY_ENGINE_FALLBACK_FULL_DAY_MINUTES;
  const graceMinutes = supplier ? supplier.graceMinutes : LEGACY_ENGINE_FALLBACK_GRACE_MINUTES;

  const sourceRows: ProposedSourceRowLink[] = sortSourceRows([
    ...(halfDaySourceKey
      ? [
          {
            legacyTable: 'attendance_feature_config' as const,
            legacyRowId: halfDaySourceKey,
          },
        ]
      : []),
    ...ordered.map((c) => ({
      legacyTable: 'attendance_rule_config' as const,
      legacyRowId: c.legacyRowId,
    })),
  ]);

  findings.push({
    findingKind: FINDING_KIND.UNCONSTRAINED_DEFAULT_SEEDED,
    severity: supplier ? 'info' : 'decision_required',
    subjectRef: 'Unconstrained_Day_Threshold_Default',
    detail:
      `The single unconstrained Day_Threshold_Rule required by criterion 1.15 was seeded with ` +
      `full_day_minutes ${fullDayMinutes}, half_day_minutes ${halfDayMinutes} and grace_minutes ` +
      `${graceMinutes}. half_day_minutes came from ` +
      `${halfDaySourceKey ? `attendance_feature_config.${halfDaySourceKey}` : `the engine fallback ${DEFAULT_HALF_DAY_FLOOR_MINUTES}`}` +
      ` (criterion 15.8); the net-login floor was ` +
      `${netloginFloor === null ? 'not readable' : String(netloginFloor)}. ` +
      (supplier
        ? `full_day_minutes and grace_minutes came from unconstrained attendance_rule_config row ` +
          `${supplier.legacyRowId}, the oldest such row, because attendance_feature_config holds ` +
          'neither value and that row is what the engine applies today for a globally scoped ' +
          'employee.'
        : `full_day_minutes and grace_minutes came from the engine's own Fallback Default ` +
          `(${LEGACY_ENGINE_FALLBACK_FULL_DAY_MINUTES} and ` +
          `${LEGACY_ENGINE_FALLBACK_GRACE_MINUTES}) because attendance_feature_config holds ` +
          'neither value and no unconstrained active attendance_rule_config row supplied them. ' +
          'Confirm both before approval.'),
    detailJson: {
      full_day_minutes: fullDayMinutes,
      half_day_minutes: halfDayMinutes,
      grace_minutes: graceMinutes,
      half_day_source_key: halfDaySourceKey,
      biometric_half_day_floor_minutes: biometricFloor,
      netlogin_half_day_floor_minutes: netloginFloor,
      full_grace_source_legacy_row_id: supplier ? supplier.legacyRowId : null,
    },
  });

  // Criterion 1.15 allows only one unconstrained rule, so an unconstrained legacy row whose
  // thresholds differ from the seeded values is a value that does NOT survive the migration.
  // Saying so is the difference between a migration and a silent change to day classification.
  for (const candidate of ordered) {
    if (
      candidate.fullDayMinutes === fullDayMinutes &&
      candidate.halfDayMinutes === halfDayMinutes &&
      candidate.graceMinutes === graceMinutes
    ) {
      continue;
    }
    findings.push({
      findingKind: FINDING_KIND.UNCONSTRAINED_LEGACY_THRESHOLDS_MERGED,
      severity: 'decision_required',
      subjectRef: `attendance_rule_config:${candidate.legacyRowId}`,
      detail:
        `Unconstrained attendance_rule_config row ${candidate.legacyRowId} holds ` +
        `full_day_minutes ${candidate.fullDayMinutes}, half_day_minutes ` +
        `${candidate.halfDayMinutes} and grace_minutes ${candidate.graceMinutes}, which differ ` +
        `from the seeded unconstrained default (${fullDayMinutes} / ${halfDayMinutes} / ` +
        `${graceMinutes}). Criterion 1.15 permits exactly one Day_Threshold_Rule constraining no ` +
        'Rule_Dimension, so this row was folded into that one rule and its own values are not ' +
        'proposed. Every employee currently classified by this row will be classified against ' +
        'the seeded values instead - confirm or scope this row before approval.',
      detailJson: {
        legacy_table: 'attendance_rule_config',
        legacy_row_id: candidate.legacyRowId,
        legacy_full_day_minutes: candidate.fullDayMinutes,
        legacy_half_day_minutes: candidate.halfDayMinutes,
        legacy_grace_minutes: candidate.graceMinutes,
        seeded_full_day_minutes: fullDayMinutes,
        seeded_half_day_minutes: halfDayMinutes,
        seeded_grace_minutes: graceMinutes,
      },
    });
  }

  const changeReason =
    `Seeded by the Requirement 15 migration builder as the single unconstrained ` +
    `Day_Threshold_Rule of criteria 15.8 and 1.15. half_day_minutes ${halfDayMinutes} from ` +
    `${halfDaySourceKey ? `attendance_feature_config.${halfDaySourceKey}` : `the engine fallback (${DEFAULT_HALF_DAY_FLOOR_MINUTES})`}; ` +
    `full_day_minutes ${fullDayMinutes} and grace_minutes ${graceMinutes} from ` +
    `${supplier ? `attendance_rule_config:${supplier.legacyRowId}` : "the engine's Fallback Default"}.`;

  return { fullDayMinutes, halfDayMinutes, graceMinutes, changeReason, sourceRows };
}

// -- ordering and ordinals -----------------------------------------------------------------
//
// Ordinal is assigned from a total order that is a function of the rule's CONTENT only, so two
// runs over unchanged legacy data agree on every ordinal no matter what order the rows arrived
// in. Reading order for a reviewer: the mandatory default first, then least specific to most,
// then by signature.

function assignSourceRuleOrdinals(rules: ProposedSourceRule[]): ProposedSourceRule[] {
  return [...rules]
    .sort(
      (a, b) =>
        b.isSystemDefault - a.isSystemDefault ||
        a.dimensionValues.length - b.dimensionValues.length ||
        compareText(a.canonicalSignature, b.canonicalSignature),
    )
    .map((rule, index) => ({ ...rule, ordinal: index + 1 }));
}

function assignDayThresholdOrdinals(
  rules: ProposedDayThresholdRule[],
): ProposedDayThresholdRule[] {
  return [...rules]
    .sort(
      (a, b) =>
        b.isUnconstrainedDefault - a.isUnconstrainedDefault ||
        a.dimensionValues.length - b.dimensionValues.length ||
        compareText(a.canonicalSignature, b.canonicalSignature),
    )
    .map((rule, index) => ({ ...rule, ordinal: index + 1 }));
}

function assignFindingOrdinals(drafts: FindingDraft[]): ProposalFinding[] {
  return [...drafts]
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        compareText(a.findingKind, b.findingKind) ||
        compareText(a.subjectRef ?? '', b.subjectRef ?? '') ||
        compareText(a.detail, b.detail),
    )
    .map((draft, index) => ({ ...draft, ordinal: index + 1 }));
}
