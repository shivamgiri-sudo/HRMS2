//
// Requirement 19 (Consolidated Productivity And Attendance View) of requirements.md, implemented
// as a PURE assembly module in the same shape as canonical-productivity.ts,
// attendance-variance.ts, floor-absence-pattern.ts and variance-review.ts: no database import,
// no clock, no filesystem, no network, no identifier minting. Every input arrives as an argument
// — the already-fetched per-Dialler_Source contributions, the already-read
// `attendance_daily_record` figures, the already-raised Variance_Record / Floor_Absence_Pattern
// occurrence and the caller's already-resolved business scope. Nothing here writes anywhere: the
// refusal audit of criterion 19.10 is RETURNED for the caller to persist, and the export payload
// of criterion 19.9 is a headers-and-rows structure, not a spreadsheet file — file generation
// belongs to the route layer (design.md section 11, "Export goes through the existing report
// pipeline").
//
// This is a backend read-assembly module only. No React, no route, no screen: the screen is a
// later phase and this is the logic it will call.
//
// THREE STRUCTURAL GUARANTEES, enforced by the compiler rather than by comment:
//
//  1. Criteria 19.6 and 19.7 — THE TRI-STATE. `MetricCell` is a three-armed discriminated union
//     tagged on `availability`, and only the `reported` arm carries a `value` member at all. A
//     caller cannot read a number without first narrowing to `reported`, and cannot distinguish
//     the other two states by testing a number, because there is no number on them. So
//     `unavailable` (the metric is absent from that Dialler_Source's declared
//     Metric_Availability — the real production case, since `apr_manual_upload` carries no talk,
//     wait, dispo, pause or logout column at all), `not_reported` (declared, but that source
//     held no value on that date) and a genuine reported 0 are three distinct states that no
//     caller can collapse. null, undefined and 0 are deliberately NOT the discriminator.
//
//  2. Criterion 19.13 — declared-metric containment holds BY CONSTRUCTION, not by check. The
//     per-source cell map is built by iterating the metric vocabulary and asking the source's
//     declared set; `presentedMetrics` is derived from the same iteration. A metric the source
//     did not declare can only ever land in the `unavailable` arm, which carries no value, so
//     the set of metrics presented WITH A VALUE is a subset of the declared set for every input.
//
//  3. Criterion 19.10 — a scope refusal cannot leak employee data. `ConsolidatedViewResult` is a
//     discriminated union on `refused`, and the refused arm has NO `dates`, NO `rows` and NO
//     `employee` member — there is no field on it through which an employee's minutes could
//     travel. The refusal audit payload names only the acting user, the requested employee
//     identifier the caller already had in hand, and the scope that was resolved.
//
// AGGREGATION (criterion 19.3, and the reconciliation of 19.12). Canonical_Productive_Minutes is
// NOT recomputed here by a different arithmetic: this module calls deriveCanonical() from
// canonical-productivity.ts over exactly the contributions it displays, so the figure shown and
// the figure reconciled against are the same derivation. That derivation is Requirement 18's
// decision A8, and it is NOT a plain sum:
//   - PRIMARY, `interval_union` (criterion 18.4): the total duration of the UNION of the
//     contributing sessions' Login_Time..Logout_Time intervals, counting an instant covered by
//     two overlapping sessions exactly once. A naive sum of per-source contributions would
//     therefore be WRONG, and criterion 18.3 forbids it explicitly (8,638 of 36,594 employee-days
//     carry more than one concurrent row; naive summation produced a 6,282.8-minute day).
//   - SECONDARY, `max_contribution` (criterion 18.6): if ANY contributing row supplies no usable
//     ordered interval, the whole employee-date falls to the maximum single contribution instead.
//     This governs every date holding an `apr_manual_upload` contribution.
// So the 19.12 property implemented here is design.md Property 16's re-derivation: re-deriving
// from the DISPLAYED per-source contributions reproduces the DISPLAYED canonical figure and the
// DISPLAYED rule name — never `sum(contributions) === canonical`.
//
// DELIBERATELY NOT MODELLED HERE, because a pure function cannot do it:
//   - Fetching. The caller runs the queries over `attendance_productive_contribution`,
//     `attendance_productive_day`, `attendance_daily_record`, `variance_record` and
//     `dialler_source`, and hands the rows in.
//   - Resolving the caller's business scope. `resolveUserBusinessScope` is a query; the resolved
//     scope is an argument (see `RequesterScope`).
//   - WRITING the refusal audit row of criterion 19.10 / 14.6, and generating the spreadsheet
//     file of criterion 19.9. Both are returned as values for the caller to carry out.
//   - Criterion 18.8's midnight apportionment. The contributions arriving here are already
//     apportioned to the calendar date by the aggregator; re-apportioning would double-count.
//

import { deriveCanonical, type Contribution, type ProducingRule } from './canonical-productivity.js';
import type { DayClassification, ResolvedAttendanceSource } from './attendance-variance.js';
import type { QueueState, ReviewOutcome, VarianceRecordStatus } from './variance-review.js';
import type { FloorAbsenceReason } from './floor-absence-pattern.js';

// Type-only namespace import: fully erased by the compiler, so this module keeps NO runtime edge
// to dialler-source-registry.service.ts, which imports `db`. It exists so the metric vocabulary
// below is checked against Requirement 16's registry vocabulary by the compiler instead of by
// hope — the same problem attendance-variance.ts and floor-absence-pattern.ts solve by
// duplicating a constant with a comment, solved here without losing the coupling.
import type * as diallerSourceRegistry from './dialler-source-registry.service.js';

// ---------------------------------------------------------------------------------------------
// Requirement 16's metric vocabulary, reused rather than reinvented
// ---------------------------------------------------------------------------------------------

/**
 * criterion 16.3's controlled metric list, as `dialler_source.metric_availability` declares it.
 * The single source of truth is `PRODUCTIVITY_METRICS` in dialler-source-registry.service.ts
 * (Requirement 16, already built); this is its element type, imported type-only.
 */
export type ProductivityMetric = (typeof diallerSourceRegistry.PRODUCTIVITY_METRICS)[number];

/**
 * The metrics criterion 19.2 requires the view to present, in display order: login time, logout
 * time, net login minutes, talk time, wait time, dispo time, pause time, AHT, calls handled, and
 * the five break categories BIO, LUNCH, QA, TRAINING and DISMX.
 *
 * Every member is a `ProductivityMetric`, so the annotation below is a compile-time assertion
 * that criterion 19.2 names nothing outside Requirement 16's declared vocabulary. `training` and
 * `dismx` are the registry's spellings for the TRAINING and DISMX break categories; the display
 * spellings criterion 19.2 states are carried on BREAK_CATEGORY_LABELS.
 */
export const VIEW_METRICS: readonly ProductivityMetric[] = Object.freeze([
  'login_time',
  'logout_time',
  'net_login',
  'talk_time',
  'wait_time',
  'dispo_time',
  'pause_time',
  'aht',
  'calls',
  'bio',
  'lunch',
  'qa',
  'training',
  'dismx',
]);

/**
 * criterion 19.2's five break categories, in exactly the spellings the criterion states, mapped
 * to their registry metric keys. Exported so the export payload of criterion 19.9 and the screen
 * of a later phase label the same columns identically.
 */
export const BREAK_CATEGORY_LABELS: Readonly<Record<'bio' | 'lunch' | 'qa' | 'training' | 'dismx', string>> =
  Object.freeze({
    bio: 'BIO',
    lunch: 'LUNCH',
    qa: 'QA',
    training: 'TRAINING',
    dismx: 'DISMX',
  });

/** criterion 16.1's two ingestion modes. Same literals as the registry's `ingestion_mode`. */
export type IngestionMode = 'integrated_pull' | 'manual_upload';

// ---------------------------------------------------------------------------------------------
// criteria 19.6 and 19.7: the tri-state (guarantee 1)
// ---------------------------------------------------------------------------------------------

/** The three states of criteria 19.6 and 19.7. Never collapsed, never inferred from a number. */
export type MetricAvailability = 'unavailable' | 'not_reported' | 'reported';

/**
 * ONE metric of ONE Dialler_Source on ONE date, in exactly one of three states. Note that only
 * the `reported` arm has a `value` member: there is no field on the other two arms through which
 * a number could arrive, so a caller cannot read 0 out of an unavailable or not-reported metric,
 * and cannot use `value === null` or `value === 0` as the discriminator. See guarantee 1.
 *
 * `unavailable` also carries no value even though the underlying feed row might physically hold
 * one: criterion 19.6 requires no numeric value to be presented for a metric the Dialler_Source
 * never declared, and the safest reading of "SHALL present no numeric value" is that the number
 * is not carried at all rather than carried and hidden by the screen.
 */
export type MetricCell =
  // criterion 19.6: absent from the source's declared Metric_Availability.
  | { readonly availability: 'unavailable' }
  // criterion 19.7: declared, but this source held no value for it on this date.
  | { readonly availability: 'not_reported' }
  // A real reported figure — including a genuine 0, which is a measurement.
  | { readonly availability: 'reported'; readonly value: number };

export const METRIC_UNAVAILABLE: MetricCell = Object.freeze({ availability: 'unavailable' });
export const METRIC_NOT_REPORTED: MetricCell = Object.freeze({ availability: 'not_reported' });

/** The only constructor of a `reported` cell, so an unusable number cannot become a value. */
function reportedCell(value: number): MetricCell | null {
  if (!Number.isFinite(value)) return null;
  return Object.freeze({ availability: 'reported' as const, value });
}

/**
 * The marker the export of criterion 19.9 carries for each non-reported state, and the reason the
 * export cannot collapse the tri-state: `unavailable`, `not_reported` and a reported 0 serialise
 * to three different cell values. Stated as constants rather than inline literals so the screen
 * of a later phase and the export agree.
 */
export const EXPORT_MARKER_UNAVAILABLE = 'n/a';
export const EXPORT_MARKER_NOT_REPORTED = '--';

/** Renders one cell for export. A reported 0 renders as the number 0, never as a marker. */
export function renderMetricCellForExport(cell: MetricCell): string | number {
  switch (cell.availability) {
    case 'unavailable':
      return EXPORT_MARKER_UNAVAILABLE;
    case 'not_reported':
      return EXPORT_MARKER_NOT_REPORTED;
    default:
      return cell.value;
  }
}

// ---------------------------------------------------------------------------------------------
// Inputs: already-fetched evidence, handed in by the caller
// ---------------------------------------------------------------------------------------------

/**
 * One registered Dialler_Source as the registry holds it (criterion 16.1), reduced to what the
 * view needs. `active` is carried but never used to filter: criterion 16.9 requires a
 * deactivated Dialler_Source's historical contributions to keep appearing here, so a false value
 * is presentation metadata, not an exclusion.
 */
export interface DiallerSourceDescriptor {
  readonly diallerSourceId: string;
  readonly diallerSourceName: string | null;
  readonly ingestionMode: IngestionMode;
  /** criterion 16.1's declared Metric_Availability. An empty list is legal and is tested. */
  readonly metricAvailability: readonly ProductivityMetric[];
  readonly active?: boolean;
}

/**
 * The per-metric values one Dialler_Source holds for one employee-date. A KEY THAT IS ABSENT, or
 * present with null / undefined, is "this source holds no value for that metric on that date" —
 * criterion 19.7's not-reported. A key present with 0 is a reported zero. That is the whole
 * distinction criteria 19.6 and 19.7 turn on, so it is stated here rather than left to a caller's
 * habit.
 */
export type MetricValueMap = {
  readonly [K in ProductivityMetric]?: number | null;
};

/**
 * One contributing row for one employee-date, already resolved to exactly one Dialler_Source
 * (criterion 16.4) and already apportioned to this calendar date (criterion 18.8). Structurally a
 * Requirement 18 `Contribution` plus the per-metric values and the provenance criterion 19.8
 * needs, so the figure displayed and the figure aggregated cannot drift apart.
 */
export interface ContributionEvidence {
  readonly diallerSourceId: string;
  /**
   * Minutes from 00:00 on this date. null means the feed supplies no ordered interval at all —
   * which is every `apr_manual_upload` row, because that table carries no logout column
   * (criteria 17.4, 18.6).
   */
  readonly interval: { readonly startMinute: number; readonly endMinute: number } | null;
  /** Net_Login / login_minutes. The magnitude Requirement 18's secondary rule reads. */
  readonly magnitudeMinutes: number;
  readonly metrics?: MetricValueMap;
  /** criterion 19.8, and criteria 17.2 / 17.3's audit trail. */
  readonly uploadBatchId?: string | null;
  readonly uploadedByUserId?: string | null;
  /** `attendance_productive_contribution.source_row_ref`, carried through for traceability. */
  readonly sourceRowRef?: string | null;
}

/** criterion 19.4: `attendance_daily_record`'s biometric figures for the date. */
export interface BiometricEvidence {
  /** `attendance_daily_record.biometric_minutes`. null means no biometric duration recorded. */
  readonly biometricMinutes?: number | null;
  /** The FIRST punch's `clock_in_time`, exactly as recorded. */
  readonly firstClockInTime?: string | null;
  /** The LAST punch's `clock_out_time`, exactly as recorded. */
  readonly lastClockOutTime?: string | null;
  readonly punchCount?: number | null;
}

/** criterion 19.5's resolution and classification facts for the date. */
export interface AttendanceEvidence {
  readonly resolvedAttendanceSource?: ResolvedAttendanceSource | null;
  /** The deciding Attendance_Source_Rule identifier (criteria 2.9, 11.2, 19.5). */
  readonly decidingAttendanceSourceRuleId?: string | null;
  readonly classification?: DayClassification | null;
}

/**
 * criterion 19.5's Variance_Record, reduced to what the view shows. The vocabulary is
 * variance-review.ts's own (`QueueState`, `VarianceRecordStatus`, `ReviewOutcome`), imported
 * type-only rather than redeclared, so the review state shown here cannot drift from the state
 * the review workflow records.
 */
export interface VarianceEvidence {
  readonly varianceRecordId: string;
  readonly queueState: QueueState;
  readonly status: VarianceRecordStatus;
  readonly varianceRiskScore?: number | null;
  readonly wfmOutcome?: ReviewOutcome | null;
  readonly managerOutcome?: ReviewOutcome | null;
}

/**
 * criterion 19.5's Floor_Absence_Pattern occurrence. `reason` is floor-absence-pattern.ts's own
 * `FloorAbsenceReason`. `varianceRecordId` is the Variance_Record criterion 10.6 requires every
 * occurrence to carry; its review state is read from the date's `variance` evidence when the two
 * identifiers agree.
 */
export interface FloorAbsenceEvidence {
  readonly reason: FloorAbsenceReason;
  readonly varianceRecordId?: string | null;
}

/** All the evidence held for ONE employee and ONE calendar date. */
export interface DateEvidence {
  /** 'YYYY-MM-DD'. */
  readonly date: string;
  readonly contributions?: readonly ContributionEvidence[];
  readonly biometric?: BiometricEvidence | null;
  readonly attendance?: AttendanceEvidence | null;
  readonly variance?: VarianceEvidence | null;
  readonly floorAbsence?: FloorAbsenceEvidence | null;
}

/**
 * The caller's already-resolved business scope (criteria 14.4, 19.10). Resolving it is a query
 * (`resolveUserBusinessScope`), so it arrives as an argument. 'all' means unrestricted.
 */
export interface RequesterScope {
  readonly userId: string;
  readonly branchIds: readonly string[] | 'all';
  /**
   * An explicit employee allow-list, for a scope that is narrower than a branch — a Reporting
   * Manager's direct reports, for instance. 'all' means the branch test alone governs.
   */
  readonly employeeIds?: readonly string[] | 'all';
}

export interface ConsolidatedViewRequest {
  readonly requester: RequesterScope;
  readonly employeeId: string;
  /**
   * The requested employee's branch. null when the caller could not resolve it, which REFUSES
   * the request for a scoped caller rather than waving it through — the same convention
   * wfm.regularization.secure.routes.ts already applies ("an unresolvable branch is refused, not
   * waved through").
   */
  readonly employeeBranchId: string | null;
  /** Inclusive, 'YYYY-MM-DD'. An inverted range presents nothing; see `rangeInverted`. */
  readonly fromDate: string;
  readonly toDate: string;
  readonly evidence: readonly DateEvidence[];
  readonly diallerSources: readonly DiallerSourceDescriptor[];
}

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------

/** criterion 19.8. The `manual_upload` arm cannot exist without its Upload_Batch identifier. */
export type UploadAttributionField = 'upload_batch_id' | 'uploading_user';

export type UploadProvenance =
  | { readonly kind: 'integrated_pull' }
  | {
      readonly kind: 'manual_upload';
      readonly uploadBatchId: string;
      readonly uploadedByUserId: string;
    }
  /**
   * A `manual_upload` contribution whose Upload_Batch identifier or uploading user is missing.
   * Criteria 17.3 and 17.10 close the path that creates such a row, but 3,810 of them already sit
   * in `apr` with a NULL `upload_batch_id`, so the view SURFACES the gap as its own state instead
   * of rendering a blank cell that reads like an ordinary absence.
   */
  | {
      readonly kind: 'manual_upload_unattributed';
      readonly uploadBatchId: string | null;
      readonly uploadedByUserId: string | null;
      readonly missingFields: readonly UploadAttributionField[];
    };

/** criteria 19.2, 19.6, 19.7, 19.8, 19.13: one contributing Dialler_Source on one date. */
export interface PresentedSourceRow {
  readonly diallerSourceId: string;
  readonly diallerSourceName: string | null;
  readonly ingestionMode: IngestionMode;
  /** Presentation metadata only — a deactivated source is still presented (criterion 16.9). */
  readonly diallerSourceActive: boolean;
  /** True when no registry row was supplied for this contribution's Dialler_Source id. */
  readonly diallerSourceRegistered: boolean;
  /** The source's declared Metric_Availability, in VIEW_METRICS display order. */
  readonly declaredMetrics: readonly ProductivityMetric[];
  /** Total over VIEW_METRICS: every metric criterion 19.2 names carries exactly one cell. */
  readonly metrics: Readonly<Record<ProductivityMetric, MetricCell>>;
  /**
   * criterion 19.13: the metrics actually presented WITH A VALUE. Always a subset of
   * `declaredMetrics` by construction — see guarantee 2 in the file header.
   */
  readonly presentedMetrics: readonly ProductivityMetric[];
  /**
   * The contribution as Requirement 18 consumes it. Retained on the presented row so criterion
   * 19.12's reconciliation re-derives from exactly what was DISPLAYED (design.md Property 16).
   */
  readonly contribution: Contribution;
  /**
   * Requirement 18's rules applied to this source ALONE. Useful next to the canonical figure,
   * and deliberately not summed anywhere: criterion 18.3 forbids that arithmetic.
   */
  readonly soloProductiveMinutes: number | null;
  readonly upload: UploadProvenance;
  readonly sourceRowRef: string | null;
}

/**
 * criterion 19.4. `minutes` reuses `MetricCell` so an absent biometric duration renders with the
 * same marker the dialler metrics use and can never be read as a zero. The `unavailable` arm is
 * unreachable here: the biometric feed is not a Dialler_Source and declares no
 * Metric_Availability, so a missing figure is always `not_reported`.
 */
export interface BiometricPresentation {
  readonly minutes: MetricCell;
  readonly firstClockInTime: string | null;
  readonly lastClockOutTime: string | null;
  readonly punchCount: number | null;
}

/** criterion 19.5, derived from the Variance_Record's queue state, status and recorded outcomes. */
export type ReviewState =
  /** criteria 6.11, 7.1: raised and retained, never presented for Dual_Review. */
  | 'not_queued'
  | 'awaiting_both_reviewers'
  | 'awaiting_wfm_reviewer'
  | 'awaiting_reporting_manager'
  | 'reviewed'
  /** criterion 7.10: the two reviewers disagree; the Override_Approver holds it. */
  | 'contested'
  /** The legacy `payroll_attendance_conflict_review` closures of criterion 7.11. */
  | 'closed_legacy'
  /** No Variance_Record exists for the date, so there is no review state to show. */
  | 'not_recorded';

export interface PresentedVariance {
  readonly varianceRecordId: string;
  readonly queueState: QueueState;
  readonly status: VarianceRecordStatus;
  readonly varianceRiskScore: number | null;
  readonly wfmOutcome: ReviewOutcome | null;
  readonly managerOutcome: ReviewOutcome | null;
  readonly reviewState: ReviewState;
}

export interface PresentedFloorAbsence {
  readonly reason: FloorAbsenceReason;
  readonly varianceRecordId: string | null;
  /** The review state of the Variance_Record criterion 10.6 raised for this occurrence. */
  readonly reviewState: ReviewState;
}

/** criterion 19.5. */
export interface AttendancePresentation {
  readonly resolvedAttendanceSource: ResolvedAttendanceSource | null;
  readonly decidingAttendanceSourceRuleId: string | null;
  readonly classification: DayClassification | null;
  readonly variance: PresentedVariance | null;
  readonly floorAbsence: PresentedFloorAbsence | null;
}

/** criterion 19.1: what made a date's row exist at all. Never empty on an emitted row. */
export type EvidenceKind =
  | 'dialler_contribution'
  | 'biometric'
  | 'attendance_record'
  | 'variance_record'
  | 'floor_absence_pattern';

export interface ConsolidatedDateRow {
  readonly date: string;
  /** Ascending by Dialler_Source id, then by interval start, so two runs are byte-identical. */
  readonly sources: readonly PresentedSourceRow[];
  /** criteria 18.10, 19.3: null means absent for this date — never a measured zero. */
  readonly canonicalProductiveMinutes: number | null;
  /** criterion 19.3: the NAME of the aggregation rule that produced the figure above. */
  readonly aggregationRule: ProducingRule | null;
  readonly aggregationRuleLabel: string | null;
  /** criterion 18.5: contributions supplying no usable ordered interval. */
  readonly excludedContributionCount: number;
  readonly biometric: BiometricPresentation;
  readonly attendance: AttendancePresentation;
  /** criterion 19.1. Sorted, de-duplicated, and guaranteed non-empty on an emitted row. */
  readonly evidenceKinds: readonly EvidenceKind[];
}

/** Why a supplied evidence entry produced no row. Reported, never silently dropped. */
export type DroppedDateReason =
  | 'no_evidence'
  | 'outside_requested_range'
  | 'invalid_date'
  | 'duplicate_date_merged';

export interface DroppedDate {
  readonly date: string;
  readonly reason: DroppedDateReason;
}

export interface ConsolidatedProductivityView {
  readonly refused: false;
  readonly employeeId: string;
  readonly requestedFromDate: string;
  readonly requestedToDate: string;
  /** True when the requested end date precedes the requested start date. No rows are presented. */
  readonly rangeInverted: boolean;
  /** criterion 19.1: ascending by date, one row per date holding ANY evidence, and no others. */
  readonly rows: readonly ConsolidatedDateRow[];
  readonly droppedDates: readonly DroppedDate[];
}

export type ViewRefusalCode =
  /** criteria 14.4, 19.10. */
  | 'employee_outside_resolved_scope'
  /** The employee's branch could not be resolved, so in-scope cannot be proven. */
  | 'employee_branch_unresolvable'
  /** criterion 19.11's branch/process mode, requested for a branch outside the caller's scope. */
  | 'branch_outside_resolved_scope';

export type RequestedViewAction =
  | 'consolidated_productivity_view'
  | 'consolidated_productivity_view_branch';

/**
 * criteria 19.10 and 14.6's refused attempt, RETURNED for the caller to record. Nothing here is
 * employee data: the acting user, the identifiers the requester themselves supplied, and the
 * scope that was resolved for them. No minutes, no classification, no punch time. See guarantee 3.
 */
export interface RefusedAttemptAudit {
  readonly actingUserId: string;
  readonly requestedAction: RequestedViewAction;
  readonly requestedEmployeeId: string | null;
  readonly requestedBranchId: string | null;
  readonly requestedProcessId: string | null;
  readonly requestedFromDate: string | null;
  readonly requestedToDate: string | null;
  readonly refusalCode: ViewRefusalCode;
  readonly resolvedScopeBranchIds: readonly string[] | 'all';
}

/**
 * criterion 19.10. NO `rows`, NO `employeeId`, NO evidence member of any kind — there is no field
 * on this arm through which a minute of employee data could travel.
 */
export interface ConsolidatedViewRefused {
  readonly refused: true;
  readonly code: ViewRefusalCode;
  readonly message: string;
  readonly criteria: readonly string[];
  readonly audit: RefusedAttemptAudit;
}

export type ConsolidatedViewResult = ConsolidatedProductivityView | ConsolidatedViewRefused;

// ---------------------------------------------------------------------------------------------
// Calendar and numeric helpers. No Date object anywhere: a 'YYYY-MM-DD' is validated by shape and
// by days-in-month, and range containment is a lexicographic comparison, which is exact for
// fixed-width ISO dates. So no host time zone can move a range boundary by a day.
// ---------------------------------------------------------------------------------------------

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH: readonly number[] = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** True only for a real calendar date. '2026-02-30' and '2025-02-29' are rejected, never guessed. */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const limit = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day <= limit;
}

/** A metric value is usable only when it is a finite number. */
function isUsableValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizedMagnitude(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function toContribution(evidence: ContributionEvidence): Contribution {
  return {
    diallerSourceId: evidence.diallerSourceId,
    interval:
      evidence.interval === null || evidence.interval === undefined
        ? null
        : { startMinute: evidence.interval.startMinute, endMinute: evidence.interval.endMinute },
    magnitudeMinutes: sanitizedMagnitude(evidence.magnitudeMinutes),
  };
}

/** criterion 19.3's human-readable rule name, alongside the machine name. */
export const AGGREGATION_RULE_LABELS: Readonly<Record<ProducingRule, string>> = Object.freeze({
  interval_union: 'Union of session intervals (Requirement 18.4, primary rule)',
  max_contribution: 'Maximum single contribution (Requirement 18.6, secondary rule)',
});

// ---------------------------------------------------------------------------------------------
// criteria 19.6, 19.7, 19.13: building the tri-state cells
// ---------------------------------------------------------------------------------------------

/**
 * Reads one metric for one contribution.
 *
 * Precedence, stated because the criteria do not: an explicit value in the `metrics` map wins.
 * Where the map holds nothing, `net_login` falls back to the contribution's own magnitude (they
 * are the same quantity — see canonical-productivity.ts's `magnitudeMinutes`), and `login_time` /
 * `logout_time` fall back to the interval's ends, because Requirement 18 CONSTRUCTS that interval
 * from Login_Time and Logout_Time (criterion 18.5). Presenting a different login time from the one
 * the aggregation used would be showing two numbers for one fact.
 *
 * A value that is not a finite number becomes `not_reported`, never 0. A NEGATIVE value is
 * presented as reported: the view's job is to show what the feed holds, and quietly hiding a
 * negative AHT would hide the data defect a WFM person is looking at the screen to find.
 */
function readMetricValue(
  metric: ProductivityMetric,
  evidence: ContributionEvidence,
): number | null {
  const explicit = evidence.metrics?.[metric];
  if (isUsableValue(explicit)) return explicit;
  if (explicit === null) return null;

  if (metric === 'net_login' && Number.isFinite(evidence.magnitudeMinutes)) {
    return evidence.magnitudeMinutes;
  }
  if (evidence.interval !== null && evidence.interval !== undefined) {
    if (metric === 'login_time' && Number.isFinite(evidence.interval.startMinute)) {
      return evidence.interval.startMinute;
    }
    if (metric === 'logout_time' && Number.isFinite(evidence.interval.endMinute)) {
      return evidence.interval.endMinute;
    }
  }
  return null;
}

/**
 * criteria 19.6, 19.7 and 19.13 in one loop. The iteration is over VIEW_METRICS and the declared
 * set is consulted FIRST, so a metric the Dialler_Source did not declare can only reach the
 * `unavailable` arm — which carries no value. That is why containment holds by construction
 * rather than by a check a future edit could delete (guarantee 2).
 */
function buildMetricCells(
  declared: ReadonlySet<ProductivityMetric>,
  evidence: ContributionEvidence,
): { cells: Record<ProductivityMetric, MetricCell>; presented: ProductivityMetric[] } {
  const cells = {} as Record<ProductivityMetric, MetricCell>;
  const presented: ProductivityMetric[] = [];

  for (const metric of VIEW_METRICS) {
    // criterion 19.6: absent from the declared Metric_Availability. No numeric value at all.
    if (!declared.has(metric)) {
      cells[metric] = METRIC_UNAVAILABLE;
      continue;
    }
    const raw = readMetricValue(metric, evidence);
    // criterion 19.7: declared, but this source holds no value for it on this date.
    if (raw === null) {
      cells[metric] = METRIC_NOT_REPORTED;
      continue;
    }
    const cell = reportedCell(raw);
    if (cell === null) {
      cells[metric] = METRIC_NOT_REPORTED;
      continue;
    }
    cells[metric] = cell;
    presented.push(metric);
  }

  return { cells, presented };
}

/** criterion 19.8. A `manual_upload` row missing either attribution is its own visible state. */
function buildUploadProvenance(
  ingestionMode: IngestionMode,
  evidence: ContributionEvidence,
): UploadProvenance {
  if (ingestionMode !== 'manual_upload') {
    return Object.freeze({ kind: 'integrated_pull' as const });
  }

  const uploadBatchId =
    typeof evidence.uploadBatchId === 'string' && evidence.uploadBatchId.length > 0
      ? evidence.uploadBatchId
      : null;
  const uploadedByUserId =
    typeof evidence.uploadedByUserId === 'string' && evidence.uploadedByUserId.length > 0
      ? evidence.uploadedByUserId
      : null;

  if (uploadBatchId !== null && uploadedByUserId !== null) {
    return Object.freeze({ kind: 'manual_upload' as const, uploadBatchId, uploadedByUserId });
  }

  const missingFields: UploadAttributionField[] = [];
  if (uploadBatchId === null) missingFields.push('upload_batch_id');
  if (uploadedByUserId === null) missingFields.push('uploading_user');
  return Object.freeze({
    kind: 'manual_upload_unattributed' as const,
    uploadBatchId,
    uploadedByUserId,
    missingFields: Object.freeze(missingFields),
  });
}

/**
 * A contribution whose Dialler_Source id matches no supplied registry row. Criterion 16.5 rejects
 * such a row at ingestion, so it should not exist; if one arrives here it is presented with an
 * EMPTY declared set, which makes every metric `unavailable` and therefore valueless. The
 * alternative — assuming the full vocabulary — would invent an availability the registry never
 * declared and break criterion 19.13.
 */
const UNREGISTERED_SOURCE_DECLARED_METRICS: ReadonlySet<ProductivityMetric> = new Set();

function buildSourceRow(
  evidence: ContributionEvidence,
  registry: ReadonlyMap<string, DiallerSourceDescriptor>,
): PresentedSourceRow {
  const descriptor = registry.get(evidence.diallerSourceId);
  const declared: ReadonlySet<ProductivityMetric> =
    descriptor === undefined
      ? UNREGISTERED_SOURCE_DECLARED_METRICS
      : new Set(descriptor.metricAvailability);
  const ingestionMode: IngestionMode = descriptor?.ingestionMode ?? 'integrated_pull';

  const { cells, presented } = buildMetricCells(declared, evidence);
  const contribution = toContribution(evidence);

  return Object.freeze({
    diallerSourceId: evidence.diallerSourceId,
    diallerSourceName: descriptor?.diallerSourceName ?? null,
    ingestionMode,
    diallerSourceActive: descriptor?.active ?? true,
    diallerSourceRegistered: descriptor !== undefined,
    declaredMetrics: Object.freeze(VIEW_METRICS.filter((m) => declared.has(m))),
    metrics: Object.freeze(cells),
    presentedMetrics: Object.freeze(presented),
    contribution,
    soloProductiveMinutes: deriveCanonical([contribution]).minutes,
    upload: buildUploadProvenance(ingestionMode, evidence),
    sourceRowRef: evidence.sourceRowRef ?? null,
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 19.5: the review state
// ---------------------------------------------------------------------------------------------

const LEGACY_CLOSED_STATUSES: readonly VarianceRecordStatus[] = Object.freeze([
  'no_issue',
  'regularization_required',
]);

/**
 * criterion 19.5's "with its review state". Derived rather than stored, from the same three facts
 * variance-review.ts records: the queue state (criteria 6.9, 6.11), the status (criteria 7.10,
 * 7.11) and which reviewer slots hold an outcome (criterion 7.3).
 *
 * `contested` and `reviewed` are tested before the queue state because they are terminal: a
 * record can be Recorded_Not_Queued and still carry a legacy closure from the 268 migrated
 * `payroll_attendance_conflict_review` rows, and reporting that as "not queued" would hide the
 * closure.
 */
export function deriveReviewState(variance: VarianceEvidence): ReviewState {
  if (variance.status === 'contested') return 'contested';
  if (variance.status === 'reviewed') return 'reviewed';
  if (LEGACY_CLOSED_STATUSES.includes(variance.status)) return 'closed_legacy';

  const wfm = variance.wfmOutcome ?? null;
  const manager = variance.managerOutcome ?? null;
  if (wfm !== null && manager !== null) return 'reviewed';

  // criteria 6.11, 7.1: raised and retained, but never presented for Dual_Review, so it is not
  // "awaiting" anyone.
  if (variance.queueState === 'recorded_not_queued') return 'not_queued';

  if (wfm === null && manager === null) return 'awaiting_both_reviewers';
  return wfm === null ? 'awaiting_wfm_reviewer' : 'awaiting_reporting_manager';
}

function presentVariance(variance: VarianceEvidence): PresentedVariance {
  return Object.freeze({
    varianceRecordId: variance.varianceRecordId,
    queueState: variance.queueState,
    status: variance.status,
    varianceRiskScore: isUsableValue(variance.varianceRiskScore) ? variance.varianceRiskScore : null,
    wfmOutcome: variance.wfmOutcome ?? null,
    managerOutcome: variance.managerOutcome ?? null,
    reviewState: deriveReviewState(variance),
  });
}

function presentFloorAbsence(
  occurrence: FloorAbsenceEvidence,
  variance: PresentedVariance | null,
): PresentedFloorAbsence {
  const varianceRecordId = occurrence.varianceRecordId ?? null;
  // The occurrence's review state is the state of the Variance_Record criterion 10.6 raised for
  // it. Only the date's own Variance_Record can supply it, and only when the identifiers agree —
  // borrowing an unrelated record's state would misreport who has reviewed what.
  const reviewState: ReviewState =
    variance !== null &&
    (varianceRecordId === null || varianceRecordId === variance.varianceRecordId)
      ? variance.reviewState
      : 'not_recorded';
  return Object.freeze({ reason: occurrence.reason, varianceRecordId, reviewState });
}

// ---------------------------------------------------------------------------------------------
// criteria 19.1 through 19.5: one date's row
// ---------------------------------------------------------------------------------------------

function hasBiometricEvidence(biometric: BiometricEvidence | null | undefined): boolean {
  if (biometric === null || biometric === undefined) return false;
  return (
    isUsableValue(biometric.biometricMinutes) ||
    (typeof biometric.firstClockInTime === 'string' && biometric.firstClockInTime.length > 0) ||
    (typeof biometric.lastClockOutTime === 'string' && biometric.lastClockOutTime.length > 0) ||
    (isUsableValue(biometric.punchCount) && biometric.punchCount > 0)
  );
}

function hasAttendanceEvidence(attendance: AttendanceEvidence | null | undefined): boolean {
  if (attendance === null || attendance === undefined) return false;
  return (
    (attendance.resolvedAttendanceSource ?? null) !== null ||
    (attendance.decidingAttendanceSourceRuleId ?? null) !== null ||
    (attendance.classification ?? null) !== null
  );
}

function buildBiometricPresentation(biometric: BiometricEvidence | null | undefined): BiometricPresentation {
  const minutes = biometric === null || biometric === undefined ? null : biometric.biometricMinutes;
  const cell = isUsableValue(minutes) ? reportedCell(minutes) : null;
  return Object.freeze({
    // criteria 5.3 / 18.10's discipline applied to the biometric figure too: no record means
    // not reported, never 0.
    minutes: cell ?? METRIC_NOT_REPORTED,
    firstClockInTime: biometric?.firstClockInTime ?? null,
    lastClockOutTime: biometric?.lastClockOutTime ?? null,
    punchCount: isUsableValue(biometric?.punchCount) ? biometric.punchCount : null,
  });
}

/**
 * Sorts the presented sources so two assemblies over the same evidence are byte-identical:
 * Dialler_Source id, then interval start, then interval end, then magnitude. A source with no
 * interval sorts before one with an interval (-1), matching floor-absence-pattern.ts's
 * sortedContributions().
 */
function sortSourceRows(rows: PresentedSourceRow[]): PresentedSourceRow[] {
  return rows.sort((a, b) => {
    if (a.diallerSourceId !== b.diallerSourceId) {
      return a.diallerSourceId < b.diallerSourceId ? -1 : 1;
    }
    const aStart = a.contribution.interval?.startMinute ?? -1;
    const bStart = b.contribution.interval?.startMinute ?? -1;
    if (aStart !== bStart) return aStart - bStart;
    const aEnd = a.contribution.interval?.endMinute ?? -1;
    const bEnd = b.contribution.interval?.endMinute ?? -1;
    if (aEnd !== bEnd) return aEnd - bEnd;
    return a.contribution.magnitudeMinutes - b.contribution.magnitudeMinutes;
  });
}

/**
 * Assembles ONE date's row from ONE date's evidence, or returns null when the date holds no
 * evidence at all — which is criterion 19.1's omission: an evidence-free date is not presented as
 * an empty row.
 *
 * Exported so the branch/process mode of criterion 19.11 and the per-employee mode of criterion
 * 19.1 build the SAME columns from the SAME code rather than two drifting assemblies.
 */
export function assembleDateRow(
  evidence: DateEvidence,
  registry: ReadonlyMap<string, DiallerSourceDescriptor>,
): ConsolidatedDateRow | null {
  const contributions = evidence.contributions ?? [];
  const kinds: EvidenceKind[] = [];
  if (contributions.length > 0) kinds.push('dialler_contribution');
  if (hasBiometricEvidence(evidence.biometric)) kinds.push('biometric');
  if (hasAttendanceEvidence(evidence.attendance)) kinds.push('attendance_record');
  if (evidence.variance !== null && evidence.variance !== undefined) kinds.push('variance_record');
  if (evidence.floorAbsence !== null && evidence.floorAbsence !== undefined) {
    kinds.push('floor_absence_pattern');
  }

  // criterion 19.1: no evidence, no row.
  if (kinds.length === 0) return null;

  const sources = sortSourceRows(contributions.map((c) => buildSourceRow(c, registry)));

  // criteria 19.3 and 19.12. Derived from exactly the contributions this row DISPLAYS, by
  // Requirement 18's own function, so the displayed figure and the reconciliation cannot diverge.
  // Not a sum: see the aggregation note in the file header.
  const canonical = deriveCanonical(sources.map((s) => s.contribution));

  const variance =
    evidence.variance === null || evidence.variance === undefined
      ? null
      : presentVariance(evidence.variance);

  return Object.freeze({
    date: evidence.date,
    sources: Object.freeze(sources),
    canonicalProductiveMinutes: canonical.minutes,
    aggregationRule: canonical.rule,
    aggregationRuleLabel: canonical.rule === null ? null : AGGREGATION_RULE_LABELS[canonical.rule],
    excludedContributionCount: canonical.excludedCount,
    biometric: buildBiometricPresentation(evidence.biometric),
    attendance: Object.freeze({
      resolvedAttendanceSource: evidence.attendance?.resolvedAttendanceSource ?? null,
      decidingAttendanceSourceRuleId: evidence.attendance?.decidingAttendanceSourceRuleId ?? null,
      classification: evidence.attendance?.classification ?? null,
      variance,
      floorAbsence:
        evidence.floorAbsence === null || evidence.floorAbsence === undefined
          ? null
          : presentFloorAbsence(evidence.floorAbsence, variance),
    }),
    evidenceKinds: Object.freeze(kinds),
  });
}

/** Indexes the supplied registry rows. A later duplicate for one id does not displace the first. */
export function indexDiallerSources(
  sources: readonly DiallerSourceDescriptor[],
): ReadonlyMap<string, DiallerSourceDescriptor> {
  const index = new Map<string, DiallerSourceDescriptor>();
  for (const source of sources) {
    if (!index.has(source.diallerSourceId)) index.set(source.diallerSourceId, source);
  }
  return index;
}

// ---------------------------------------------------------------------------------------------
// criteria 14.4, 14.6, 19.10: scope, and the refusal that leaks nothing
// ---------------------------------------------------------------------------------------------

function branchInScope(scope: RequesterScope, branchId: string | null): boolean {
  if (scope.branchIds === 'all') return true;
  // An unresolvable branch is refused, not waved through: a request whose employee row carries no
  // branch cannot be PROVEN in scope, and criterion 19.10 refuses what cannot be proven.
  if (branchId === null) return false;
  return scope.branchIds.includes(branchId);
}

function employeeAllowListed(scope: RequesterScope, employeeId: string): boolean {
  const allowed = scope.employeeIds ?? 'all';
  if (allowed === 'all') return true;
  return allowed.includes(employeeId);
}

/**
 * criteria 14.4 and 19.10. Both tests must pass: the employee's branch must sit inside the
 * resolved branch scope, AND — where the caller's scope is narrower than a branch — the employee
 * must sit on the allow-list.
 */
export function isEmployeeInScope(
  scope: RequesterScope,
  employeeId: string,
  employeeBranchId: string | null,
): boolean {
  return branchInScope(scope, employeeBranchId) && employeeAllowListed(scope, employeeId);
}

function refuse(
  code: ViewRefusalCode,
  message: string,
  criteria: readonly string[],
  audit: RefusedAttemptAudit,
): ConsolidatedViewRefused {
  return Object.freeze({
    refused: true as const,
    code,
    message,
    criteria: Object.freeze([...criteria]),
    audit: Object.freeze(audit),
  });
}

// ---------------------------------------------------------------------------------------------
// criteria 19.1 through 19.10: the per-employee view
// ---------------------------------------------------------------------------------------------

interface MergedEvidence {
  readonly date: string;
  readonly entry: DateEvidence;
  readonly merged: boolean;
}

/**
 * Collapses two evidence entries for the same date into one. Criterion 19.1 requires ONE row per
 * calendar date, so emitting both would break it, and dropping the date would lose evidence. The
 * contributions concatenate; the singular facts (biometric, attendance, Variance_Record,
 * Floor_Absence_Pattern occurrence) take the first non-null, and the merge is REPORTED on
 * `droppedDates` so a caller can see it happened rather than discover it in a total.
 */
function mergeEvidence(first: DateEvidence, second: DateEvidence): DateEvidence {
  return {
    date: first.date,
    contributions: [...(first.contributions ?? []), ...(second.contributions ?? [])],
    biometric: first.biometric ?? second.biometric ?? null,
    attendance: first.attendance ?? second.attendance ?? null,
    variance: first.variance ?? second.variance ?? null,
    floorAbsence: first.floorAbsence ?? second.floorAbsence ?? null,
  };
}

/**
 * Requirement 19's per-employee assembly (criteria 19.1 through 19.10).
 *
 * Total: never throws for ordinary data. An inverted range, an unparseable evidence date, a date
 * outside the requested range, a duplicated date, a contribution naming an unregistered
 * Dialler_Source and an entirely empty evidence list all produce a result rather than an
 * exception, because criterion 19.10's refusal must be RECORDABLE and an exception is the one
 * shape that loses it.
 *
 * Deterministic and order-independent: the dates are sorted here and so are the per-date sources,
 * so the same evidence in any order returns a deeply equal view.
 */
export function assembleConsolidatedProductivityView(
  request: ConsolidatedViewRequest,
): ConsolidatedViewResult {
  const audit: RefusedAttemptAudit = {
    actingUserId: request.requester.userId,
    requestedAction: 'consolidated_productivity_view',
    requestedEmployeeId: request.employeeId,
    requestedBranchId: request.employeeBranchId,
    requestedProcessId: null,
    requestedFromDate: request.fromDate,
    requestedToDate: request.toDate,
    refusalCode: 'employee_outside_resolved_scope',
    resolvedScopeBranchIds:
      request.requester.branchIds === 'all' ? 'all' : Object.freeze([...request.requester.branchIds]),
  };

  // criterion 19.10, checked before ANY evidence is read, so there is no assembled row in scope
  // for a refusal to accidentally return.
  if (request.requester.branchIds !== 'all' && request.employeeBranchId === null) {
    return refuse(
      'employee_branch_unresolvable',
      'Refused: the requested employee\'s branch could not be resolved, so the request cannot be proven to fall inside the resolved business scope.',
      ['14.4', '19.10'],
      { ...audit, refusalCode: 'employee_branch_unresolvable' },
    );
  }
  if (!isEmployeeInScope(request.requester, request.employeeId, request.employeeBranchId)) {
    return refuse(
      'employee_outside_resolved_scope',
      'Refused: the requested employee is outside the acting user\'s resolved business scope. No employee data is returned and the attempt is recorded.',
      ['14.4', '14.6', '19.10'],
      audit,
    );
  }

  const rangeValid = isCalendarDate(request.fromDate) && isCalendarDate(request.toDate);
  const rangeInverted = rangeValid && request.toDate < request.fromDate;

  const droppedDates: DroppedDate[] = [];
  const byDate = new Map<string, MergedEvidence>();

  for (const entry of request.evidence) {
    if (!isCalendarDate(entry.date)) {
      droppedDates.push({ date: entry.date, reason: 'invalid_date' });
      continue;
    }
    // criterion 19.1: the presented dates are the requested range's dates and no others. An
    // invalid or inverted requested range contains nothing, so nothing is presented.
    const inRange =
      rangeValid && !rangeInverted && entry.date >= request.fromDate && entry.date <= request.toDate;
    if (!inRange) {
      droppedDates.push({ date: entry.date, reason: 'outside_requested_range' });
      continue;
    }
    const existing = byDate.get(entry.date);
    if (existing === undefined) {
      byDate.set(entry.date, { date: entry.date, entry, merged: false });
    } else {
      byDate.set(entry.date, {
        date: entry.date,
        entry: mergeEvidence(existing.entry, entry),
        merged: true,
      });
    }
  }

  const registry = indexDiallerSources(request.diallerSources);
  const rows: ConsolidatedDateRow[] = [];

  for (const { date, entry, merged } of [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  )) {
    if (merged) droppedDates.push({ date, reason: 'duplicate_date_merged' });
    const row = assembleDateRow(entry, registry);
    if (row === null) {
      // criterion 19.1: a date whose evidence entry carried nothing is omitted entirely.
      droppedDates.push({ date, reason: 'no_evidence' });
      continue;
    }
    rows.push(row);
  }

  droppedDates.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
  });

  return Object.freeze({
    refused: false as const,
    employeeId: request.employeeId,
    requestedFromDate: request.fromDate,
    requestedToDate: request.toDate,
    rangeInverted,
    rows: Object.freeze(rows),
    droppedDates: Object.freeze(droppedDates),
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 19.11: branch-and-process mode for a stated date
// ---------------------------------------------------------------------------------------------

export interface BranchEmployeeEvidence {
  readonly employeeId: string;
  readonly employeeCode?: string | null;
  readonly employeeName?: string | null;
  readonly branchId: string | null;
  readonly processId?: string | null;
  /** The evidence for the single stated date. */
  readonly evidence: DateEvidence;
}

export interface BranchViewRequest {
  readonly requester: RequesterScope;
  readonly branchId: string;
  readonly processId: string | null;
  /** The stated date, 'YYYY-MM-DD'. */
  readonly date: string;
  readonly employees: readonly BranchEmployeeEvidence[];
  readonly diallerSources: readonly DiallerSourceDescriptor[];
}

/** criterion 19.11: one row per employee, carrying the same columns as a per-date row. */
export interface BranchEmployeeRow {
  readonly employeeId: string;
  readonly employeeCode: string | null;
  readonly employeeName: string | null;
  readonly branchId: string | null;
  readonly processId: string | null;
  readonly row: ConsolidatedDateRow;
}

export interface BranchProductivityView {
  readonly refused: false;
  readonly branchId: string;
  readonly processId: string | null;
  readonly date: string;
  /** Ascending by employee id. Only employees inside the caller's resolved scope. */
  readonly rows: readonly BranchEmployeeRow[];
  /**
   * criteria 14.4, 19.10: employees supplied but omitted because they sit outside the caller's
   * resolved scope. Identifiers only — no minutes, no classification, no punch time.
   */
  readonly omittedOutOfScopeEmployeeIds: readonly string[];
  /** Employees whose evidence entry held nothing, or whose date did not match (criterion 19.1). */
  readonly omittedWithoutEvidenceEmployeeIds: readonly string[];
}

export type BranchViewResult = BranchProductivityView | ConsolidatedViewRefused;

/**
 * criterion 19.11, subject to the same scope check as the per-employee mode (design.md section 11:
 * "so a WFM person cannot request a branch outside their own scope").
 *
 * Two refusal levels, deliberately different: a request for a branch outside the caller's scope is
 * REFUSED outright, because the request itself is out of bounds. An individual out-of-scope
 * employee inside an in-scope branch is OMITTED and named on `omittedOutOfScopeEmployeeIds`,
 * because criterion 14.4 requires the list to return only in-scope employees and refusing the
 * whole page would deny a legitimate branch request over one stray row.
 */
export function assembleBranchProductivityView(request: BranchViewRequest): BranchViewResult {
  const audit: RefusedAttemptAudit = {
    actingUserId: request.requester.userId,
    requestedAction: 'consolidated_productivity_view_branch',
    requestedEmployeeId: null,
    requestedBranchId: request.branchId,
    requestedProcessId: request.processId,
    requestedFromDate: request.date,
    requestedToDate: request.date,
    refusalCode: 'branch_outside_resolved_scope',
    resolvedScopeBranchIds:
      request.requester.branchIds === 'all' ? 'all' : Object.freeze([...request.requester.branchIds]),
  };

  if (!branchInScope(request.requester, request.branchId)) {
    return refuse(
      'branch_outside_resolved_scope',
      'Refused: the requested branch is outside the acting user\'s resolved business scope. No employee data is returned and the attempt is recorded.',
      ['14.4', '14.6', '19.10', '19.11'],
      audit,
    );
  }

  const registry = indexDiallerSources(request.diallerSources);
  const rows: BranchEmployeeRow[] = [];
  const outOfScope: string[] = [];
  const withoutEvidence: string[] = [];

  for (const employee of request.employees) {
    if (!isEmployeeInScope(request.requester, employee.employeeId, employee.branchId)) {
      outOfScope.push(employee.employeeId);
      continue;
    }
    if (employee.evidence.date !== request.date) {
      withoutEvidence.push(employee.employeeId);
      continue;
    }
    const row = assembleDateRow(employee.evidence, registry);
    if (row === null) {
      withoutEvidence.push(employee.employeeId);
      continue;
    }
    rows.push(
      Object.freeze({
        employeeId: employee.employeeId,
        employeeCode: employee.employeeCode ?? null,
        employeeName: employee.employeeName ?? null,
        branchId: employee.branchId,
        processId: employee.processId ?? null,
        row,
      }),
    );
  }

  const byEmployeeId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  rows.sort((a, b) => byEmployeeId(a.employeeId, b.employeeId));

  return Object.freeze({
    refused: false as const,
    branchId: request.branchId,
    processId: request.processId,
    date: request.date,
    rows: Object.freeze(rows),
    omittedOutOfScopeEmployeeIds: Object.freeze(outOfScope.sort(byEmployeeId)),
    omittedWithoutEvidenceEmployeeIds: Object.freeze(withoutEvidence.sort(byEmployeeId)),
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 19.12: display reconciliation
// ---------------------------------------------------------------------------------------------

export interface DateReconciliation {
  readonly date: string;
  /** True when the displayed figure and rule are exactly what the displayed contributions produce. */
  readonly reconciles: boolean;
  readonly displayedMinutes: number | null;
  readonly rederivedMinutes: number | null;
  readonly displayedRule: ProducingRule | null;
  readonly rederivedRule: ProducingRule | null;
  /**
   * The plain sum of the displayed per-Dialler_Source magnitudes. Carried for the screen's
   * benefit, NOT as the reconciliation target: criterion 18.3 forbids that arithmetic and
   * criterion 18.14 only bounds the canonical figure BELOW it.
   */
  readonly sumOfDisplayedContributions: number;
  /** criterion 18.14's no-inflation bound, restated over what was displayed. */
  readonly withinNoInflationBound: boolean;
}

/**
 * criterion 19.12, implemented as Requirement 18's own rule re-applied to the DISPLAYED
 * contributions (design.md Property 16, "re-deriving Canonical_Productive_Minutes from the
 * retained contributions reproduces the recorded figure").
 *
 * WHICH RULE. Not a plain sum. `deriveCanonical` applies the union of session intervals
 * (criterion 18.4) when every displayed contribution supplies a usable ordered interval, and the
 * maximum single contribution (criterion 18.6) as soon as one does not. A sum-based reconciliation
 * would fail on 8,638 of 36,594 real employee-days, which is exactly the defect criterion 18.3
 * exists to forbid.
 */
export function reconcileDateRow(row: ConsolidatedDateRow): DateReconciliation {
  const contributions = row.sources.map((s) => s.contribution);
  const rederived = deriveCanonical(contributions);
  const sum = contributions.reduce((total, c) => total + sanitizedMagnitude(c.magnitudeMinutes), 0);
  const displayed = row.canonicalProductiveMinutes;
  return Object.freeze({
    date: row.date,
    reconciles: displayed === rederived.minutes && row.aggregationRule === rederived.rule,
    displayedMinutes: displayed,
    rederivedMinutes: rederived.minutes,
    displayedRule: row.aggregationRule,
    rederivedRule: rederived.rule,
    sumOfDisplayedContributions: sum,
    // The canonical figure is capped at 1,440 (criterion 18.2), so a day whose contributions sum
    // beyond a day can legitimately exceed the sum only if the sum itself is below the cap; the
    // bound is therefore stated against the cap too.
    withinNoInflationBound: displayed === null || displayed <= Math.min(sum, 1440),
  });
}

export interface ViewReconciliation {
  readonly allDatesReconcile: boolean;
  readonly dates: readonly DateReconciliation[];
}

/** criterion 19.12 over every date presented. */
export function reconcileDisplayedView(
  rows: readonly ConsolidatedDateRow[],
): ViewReconciliation {
  const dates = rows.map(reconcileDateRow);
  return Object.freeze({
    allDatesReconcile: dates.every((d) => d.reconciles),
    dates: Object.freeze(dates),
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 19.9: export rows, carrying the same columns and the same unavailability markers
// ---------------------------------------------------------------------------------------------

/** Column labels for the metrics of criterion 19.2. The five break categories use its spellings. */
export const METRIC_EXPORT_LABELS: Readonly<Record<ProductivityMetric, string>> = Object.freeze({
  login_time: 'Login Time',
  logout_time: 'Logout Time',
  net_login: 'Net Login Minutes',
  talk_time: 'Talk Time',
  wait_time: 'Wait Time',
  dispo_time: 'Dispo Time',
  pause_time: 'Pause Time',
  aht: 'AHT',
  calls: 'Calls Handled',
  bio: BREAK_CATEGORY_LABELS.bio,
  lunch: BREAK_CATEGORY_LABELS.lunch,
  qa: BREAK_CATEGORY_LABELS.qa,
  training: BREAK_CATEGORY_LABELS.training,
  dismx: BREAK_CATEGORY_LABELS.dismx,
});

export type ExportCell = string | number | null;

/**
 * criterion 19.9. Headers and rows, NOT a spreadsheet file: file generation belongs to the route
 * layer's report pipeline (design.md section 11). The unavailability markers survive here
 * distinctly from not-reported and from a reported zero, which is the half of the criterion that
 * is easy to lose — see `renderMetricCellForExport`.
 */
export interface ExportPayload {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly ExportCell[])[];
}

const DATE_HEADERS: readonly string[] = Object.freeze([
  'Date',
  'Dialler Source',
  'Dialler Source Name',
  'Ingestion Mode',
  'Upload Batch',
  'Uploaded By',
]);

const TAIL_HEADERS: readonly string[] = Object.freeze([
  'Canonical Productive Minutes',
  'Aggregation Rule',
  'Biometric Minutes',
  'First Clock In',
  'Last Clock Out',
  'Resolved Attendance Source',
  'Deciding Attendance Source Rule',
  'Attendance Classification',
  'Variance Record',
  'Variance Review State',
  'Floor Absence Pattern',
  'Floor Absence Review State',
]);

function uploadCells(upload: UploadProvenance): readonly ExportCell[] {
  switch (upload.kind) {
    case 'integrated_pull':
      // criterion 19.8 asks for the Upload_Batch only where the mode is manual_upload; an
      // integrated pull has none, and that is not an unavailable metric.
      return [null, null];
    case 'manual_upload':
      return [upload.uploadBatchId, upload.uploadedByUserId];
    default:
      return [
        upload.uploadBatchId ?? 'MISSING',
        upload.uploadedByUserId ?? 'MISSING',
      ];
  }
}

function tailCells(row: ConsolidatedDateRow): readonly ExportCell[] {
  return [
    // criterion 18.10: absent stays absent in the export too, as the not-reported marker rather
    // than as a 0.
    row.canonicalProductiveMinutes === null
      ? EXPORT_MARKER_NOT_REPORTED
      : row.canonicalProductiveMinutes,
    row.aggregationRule ?? EXPORT_MARKER_NOT_REPORTED,
    renderMetricCellForExport(row.biometric.minutes),
    row.biometric.firstClockInTime ?? EXPORT_MARKER_NOT_REPORTED,
    row.biometric.lastClockOutTime ?? EXPORT_MARKER_NOT_REPORTED,
    row.attendance.resolvedAttendanceSource ?? EXPORT_MARKER_NOT_REPORTED,
    row.attendance.decidingAttendanceSourceRuleId ?? EXPORT_MARKER_NOT_REPORTED,
    row.attendance.classification ?? EXPORT_MARKER_NOT_REPORTED,
    row.attendance.variance?.varianceRecordId ?? EXPORT_MARKER_NOT_REPORTED,
    row.attendance.variance?.reviewState ?? 'not_recorded',
    row.attendance.floorAbsence?.reason ?? EXPORT_MARKER_NOT_REPORTED,
    row.attendance.floorAbsence?.reviewState ?? 'not_recorded',
  ];
}

/**
 * One export line per (date, contributing Dialler_Source). A date holding evidence but no
 * contributing source still produces exactly one line — the biometric-only day, which is the
 * common case — with the source columns carrying the not-reported marker, because with no
 * Dialler_Source there is no declared Metric_Availability to call anything unavailable against.
 */
function sourceLines(row: ConsolidatedDateRow, leading: readonly ExportCell[]): ExportCell[][] {
  const tail = tailCells(row);
  if (row.sources.length === 0) {
    return [
      [
        ...leading,
        row.date,
        EXPORT_MARKER_NOT_REPORTED,
        EXPORT_MARKER_NOT_REPORTED,
        EXPORT_MARKER_NOT_REPORTED,
        null,
        null,
        ...VIEW_METRICS.map(() => EXPORT_MARKER_NOT_REPORTED),
        ...tail,
      ],
    ];
  }
  return row.sources.map((source) => [
    ...leading,
    row.date,
    source.diallerSourceId,
    source.diallerSourceName ?? EXPORT_MARKER_NOT_REPORTED,
    source.ingestionMode,
    ...uploadCells(source.upload),
    ...VIEW_METRICS.map((metric) => renderMetricCellForExport(source.metrics[metric])),
    ...tail,
  ]);
}

/** criterion 19.9, per-employee mode. */
export function buildExportPayload(view: ConsolidatedProductivityView): ExportPayload {
  const headers = [
    ...DATE_HEADERS,
    ...VIEW_METRICS.map((m) => METRIC_EXPORT_LABELS[m]),
    ...TAIL_HEADERS,
  ];
  const rows: ExportCell[][] = [];
  for (const row of view.rows) rows.push(...sourceLines(row, []));
  return Object.freeze({ headers: Object.freeze(headers), rows: Object.freeze(rows) });
}

/** criteria 19.9 with 19.11, branch-and-process mode: the same columns behind an employee column. */
export function buildBranchExportPayload(view: BranchProductivityView): ExportPayload {
  const headers = [
    'Employee',
    'Employee Code',
    'Employee Name',
    ...DATE_HEADERS,
    ...VIEW_METRICS.map((m) => METRIC_EXPORT_LABELS[m]),
    ...TAIL_HEADERS,
  ];
  const rows: ExportCell[][] = [];
  for (const employeeRow of view.rows) {
    rows.push(
      ...sourceLines(employeeRow.row, [
        employeeRow.employeeId,
        employeeRow.employeeCode ?? EXPORT_MARKER_NOT_REPORTED,
        employeeRow.employeeName ?? EXPORT_MARKER_NOT_REPORTED,
      ]),
    );
  }
  return Object.freeze({ headers: Object.freeze(headers), rows: Object.freeze(rows) });
}
