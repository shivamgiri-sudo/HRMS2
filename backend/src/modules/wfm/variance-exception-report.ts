//
// Requirement 13 of requirements.md ("Review Queue And Reporting Interfaces"), implemented as
// PURE functions over an in-memory set of Variance_Records that have already been raised by
// attendance-variance.ts, already been given a queue state by the Requirement 6 queueing pass,
// and already been fetched inside the signed-in user's business scope by the route layer.
//
// Same shape as attendance-source-rule-resolver.ts, canonical-productivity.ts,
// attendance-variance.ts, variance-review.ts and variance-payroll-cutoff.ts: no database import,
// no `db.execute`, no `new Date()`, no `randomUUID()`, no `fs`, no network. Everything arrives as
// an argument INCLUDING the clock -- criterion 13.8 counts whole days remaining until
// Payroll_Cut_Off, so the reference date is a parameter. Nothing here writes anywhere; every
// function returns a plain value describing what the screen should display, what the export should
// carry, or what the caller should refuse.
//
// THIS IS A BACKEND LOGIC MODULE ONLY. Requirement 13 is written in the language of screens, and
// none of the screens are built here. What is built is the logic each screen calls: the scope-aware
// listing (13.1), the filter (13.2), the bulk recorder (13.3), the aggregate (13.4), the export
// row/column structure (13.5), the pre-close listing (13.6), the contested view (13.7) and the
// clearance outlook (13.8). File generation (13.5's spreadsheet bytes), HTTP scoping, page
// permissions (14.7) and React belong to the layers above and are deliberately absent.
//
// WHAT IS REUSED RATHER THAN REIMPLEMENTED. Requirement 13 is a reporting surface over vocabulary
// that Requirements 6 to 9 already fixed, so this module imports rather than restates:
//   - `VarianceRecord`, `QueueState`, `ReviewOutcome`, `ReviewerRole`, `VarianceRecordStatus`,
//     `RecordedReview` and `ConflictAssessment` from variance-review.ts.
//   - criterion 7.4's comment measurement: `normalizeReviewerComment` and
//     `MIN_REVIEWER_COMMENT_LENGTH`, applied ONCE to 13.3's single set-wide comment.
//   - criterion 7.7's unforgeable authority: `authorizeReviewer`, and criteria 7.3/7.5/7.10's
//     recorder `recordReviewOutcome`. 13.3 is a loop over the single-record path, not a second
//     implementation of it, so every guarantee variance-review.ts makes structurally (no
//     self-review, no Recorded_Not_Queued presentation, no classification channel on an accepted
//     or disputed outcome) holds for the bulk action for free.
//   - criterion 7.10's conflict reading: `assessOutcomeConflict`, for 13.7.
//   - criterion 7.8's calendar-day arithmetic: `wholeDaysBetween`, for 13.8.
//   - criterion 6.8's occurrence: `FloorAbsenceOccurrence` from floor-absence-pattern.ts.
//   - the reviewed/unreviewed status partition of criterion 9.5: `UnreviewedStatus` /
//     `ReviewedStatus` from variance-payroll-cutoff.ts, with a compile-time assertion that the two
//     modules' status vocabularies still agree.
//
// THREE STRUCTURAL GUARANTEES, enforced by the compiler rather than by comment:
//
//  1. Criterion 13.4's no-discard invariant (also criteria 6.13, 9.5) cannot be violated by
//     arithmetic drift. Every grouping's `recordedNotQueued` is computed as
//     `raised - queuedForDualReview`, and `reviewed` as `queuedForDualReview - unreviewed`, so the
//     partition holds by subtraction rather than by two filters that could disagree. The invariant
//     is additionally exposed as `checkNoDiscardInvariant`, so a caller (and the property test) can
//     assert it over EVERY reported grouping rather than trust it.
//
//  2. Criterion 13.5's export is column-identical to the screen aggregate by construction, not by
//     review. `VARIANCE_EXCEPTION_REPORT_COLUMNS` is the single source of both, its `key` type is
//     pinned to `keyof VarianceExceptionScreenRow` by a `satisfies` clause, and two compile-time
//     assertions below make a column list that omits a screen field, or names a field the screen
//     row does not have, a type error. `buildVarianceExceptionExport` then reads each cell out of
//     the screen row THROUGH that column list, so an export cell cannot come from anywhere else.
//
//  3. Criterion 13.8's day count is never negative. `wholeDaysRemainingUntilPayrollCutOff` is
//     produced by exactly one private function, `clampWholeDaysRemaining`, whose return type is
//     narrowed by a `Math.max(0, ...)` it is the only caller of. Past the cut-off the value is 0,
//     and `pastPayrollCutOff` carries the fact that would otherwise have been a negative number.
//
// DELIBERATELY NOT MODELLED HERE, because a pure function cannot do it:
//   - criterion 14.4's scope RESOLUTION. `resolveUserBusinessScope()` is a query. This module
//     takes the answer as an argument (`QueueViewer.scopedBranchIds`) alongside the per-record
//     reviewer identities the Variance_Record already carries, and then applies it.
//   - criterion 13.5's spreadsheet BYTES. This module returns headers and rows; the route layer
//     serialises them (design.md section 11 routes the inline export through the CSV pattern of
//     attendance-exceptions.routes.ts).
//   - criterion 13.3's WRITE. The bulk recorder returns the accepted new record states, the
//     adjustment requests and the Override_Approver routings; the queue writer persists them.
//   - criterion 13.6's salary-line JOIN. The pre-close listing groups the unreviewed records by
//     employee and reports the `salaryLineId` the caller supplied; it does not read the salary run.
//   - the Payroll_Cut_Off DATE. Criterion 13.8 counts days until it; which date that is comes from
//     `salary_prep_run` and is therefore a parameter.
//

import type { DayClassification, ResolvedAttendanceSource } from './attendance-variance.js';
import type { FloorAbsenceOccurrence } from './floor-absence-pattern.js';
import type {
  UnreviewedStatus,
  VarianceRecordStatus as CutOffVarianceRecordStatus,
} from './variance-payroll-cutoff.js';
import {
  MIN_REVIEWER_COMMENT_LENGTH,
  assessOutcomeConflict,
  authorizeReviewer,
  isQueuedForDualReview,
  normalizeReviewerComment,
  recordReviewOutcome,
  wholeDaysBetween,
  type AdjustmentRequest,
  type ConflictAssessment,
  type OverrideApproverRouting,
  type QueuedVarianceRecord,
  type QueueState,
  type RecordedReview,
  type RecordOutcomeAccepted,
  type ReviewerRole,
  type ReviewOutcome,
  type ReviewSubmission,
  type VarianceRecord,
  type VarianceRecordStatus,
} from './variance-review.js';

// ---------------------------------------------------------------------------------------------
// Compile-time assertions. `Assert<false>` is an error because false does not extend true; the
// tuple wrapping is what makes an accidental `never` fail rather than pass vacuously. Same device
// as variance-payroll-cutoff.ts.
// ---------------------------------------------------------------------------------------------

type Assert<T extends true> = T;

// variance-review.ts and variance-payroll-cutoff.ts each declare the record status vocabulary of
// criterion 7.11. This module imports the reviewed/unreviewed partition from the second and the
// record type from the first, so the two vocabularies must be the same set. If either grows a
// value the other lacks, this fails to compile rather than silently dropping a status out of the
// reviewed count.
type _StatusVocabulariesAgree = Assert<
  [Exclude<VarianceRecordStatus, CutOffVarianceRecordStatus>] extends [never]
    ? [Exclude<CutOffVarianceRecordStatus, VarianceRecordStatus>] extends [never]
      ? true
      : false
    : false
>;

// ---------------------------------------------------------------------------------------------
// Vocabulary and defaults
// ---------------------------------------------------------------------------------------------

/**
 * criterion 6.10's default Dual_Review_Ceiling. Restated here rather than imported because the
 * value lives in `attendance_threshold_config` and the resolver for it is DB-backed; this module
 * must not reach a module that imports `db`. Same duplication-with-a-reason as
 * DEFAULT_FLOOR_ABSENCE_CEILING_MINUTES in floor-absence-pattern.ts.
 */
export const DEFAULT_DUAL_REVIEW_CEILING = 100;

/**
 * What a null grouping dimension displays as on the screen and in the export (criteria 13.4,
 * 13.5). An employee with no designation is a real row in `employees`, not an error, so the
 * grouping keeps `designationId: null` and only the DISPLAY value is substituted. Filtering can
 * still target those rows by putting `null` in the filter list -- see `VarianceQueueFilter`.
 */
export const UNASSIGNED_GROUPING_LABEL = '(unassigned)';

/**
 * criterion 9.5's partition, imported as a type and re-expressed here as the one predicate this
 * module tests. 'open' is a record nobody has been notified about; 'notified' is a record a
 * reviewer has been told about and has not acted on. Everything else ('reviewed', 'contested',
 * 'no_issue', 'regularization_required') is closed to further recording -- which is exactly
 * variance-review.ts's private CLOSED_STATUSES list, derived here rather than copied.
 */
function isUnreviewedStatus(status: VarianceRecordStatus): status is UnreviewedStatus {
  return status === 'open' || status === 'notified';
}

/** The complement of `isUnreviewedStatus`: closed to further Review_Outcomes (criteria 7.5, 7.10). */
function isClosedStatus(status: VarianceRecordStatus): boolean {
  return !isUnreviewedStatus(status);
}

// ---------------------------------------------------------------------------------------------
// The record this module reports over
// ---------------------------------------------------------------------------------------------

/**
 * The reporting dimensions criterion 13.4 groups by and criterion 13.2 filters on, which a
 * Variance_Record as variance-review.ts models it does not carry: that type holds the review
 * state, and these are the employee's organisational placement at the time the record was raised.
 * The route layer joins them off `employees` / `cost_centre_master` / `process_master` /
 * `designation_master`.
 *
 * Every one is nullable except the branch, which the Variance_Record itself already carries as a
 * non-null field. An employee with no designation, no cost centre or no process is ordinary data
 * (criterion 13.4 must still report them), so null is a grouping key here, never an error.
 */
export interface VarianceReportingDimensions {
  /** null when the employee is not placed on a cost centre. */
  readonly costCentreId: string | null;
  /** null when the employee is not placed on a process. */
  readonly processId: string | null;
  /** null when the employee holds no designation. */
  readonly designationId: string | null;
  /**
   * criterion 6.8's occurrence for this employee and date, or null. Reused from
   * floor-absence-pattern.ts rather than reduced to a boolean, so criterion 13.4's
   * `queuedAsFloorAbsencePattern` count is traceable to the occurrence that caused the queueing
   * and the reason can be shown next to it.
   */
  readonly floorAbsenceOccurrence: FloorAbsenceOccurrence | null;
  /**
   * criterion 9.3's carried-forward state, filtered on by criterion 13.2: the Pay_Month this
   * record was carried forward FROM, or null when it was raised in its own Pay_Month and has not
   * survived a Payroll_Cut_Off. Produced by `deriveCarryForward` in variance-payroll-cutoff.ts.
   */
  readonly carriedForwardFromPayMonth: string | null;
  /** criteria 9.2, 13.6: the salary line this employee-month pays on, when the caller knows it. */
  readonly salaryLineId?: string | null;
}

/** A Variance_Record with the reporting dimensions attached. The unit of everything below. */
export type ReportableVarianceRecord = VarianceRecord & VarianceReportingDimensions;

/** The Queued_For_Dual_Review arm of `ReportableVarianceRecord`, dimensions retained. */
export type QueuedReportableVarianceRecord = QueuedVarianceRecord & VarianceReportingDimensions;

/**
 * Narrowing that keeps the reporting dimensions. `isQueuedForDualReview` narrows to
 * `QueuedVarianceRecord`, which would drop them; this wrapper narrows to the intersection instead,
 * so a caller does not have to re-widen.
 */
export function isQueuedReportable(
  record: ReportableVarianceRecord,
): record is QueuedReportableVarianceRecord {
  return isQueuedForDualReview(record);
}

/** True when this record is queued AND carries criterion 6.8's Floor_Absence_Pattern occurrence. */
function isQueuedFloorAbsence(record: ReportableVarianceRecord): boolean {
  return isQueuedReportable(record) && record.floorAbsenceOccurrence !== null;
}

/**
 * criterion 13.4's `adjusted` count, and the one place its reading is decided.
 *
 * AMBIGUITY, STATED. Criterion 13.4 asks for "the counts reviewed, unreviewed, contested and
 * adjusted" and does not define "adjusted". Two readings are available:
 *   (a) a Review_Outcome of `adjustment_requested` was recorded on the record (criterion 8.2);
 *   (b) an Override_Approver APPROVED an adjustment for the date (criterion 8.3).
 * Reading (a) is applied. Reading (b) is rejected because a Variance_Record does not carry an
 * approval: criterion 8.3's approval lives on the adjustment request, is authorised by a different
 * user under criteria 8.4 and 8.5, and can be refused after the review is complete. Reporting (b)
 * from this input would require a field the record does not have, and inventing one would make the
 * count silently zero for every caller that did not populate it. Reading (a) is answerable from the
 * record alone and is the count a reviewer clearing a queue actually wants: how many of these days
 * a reviewer has asked to move. The approved-adjustment count belongs to a payroll report over the
 * adjustment requests, not to the variance exception report.
 */
function hasRequestedAdjustment(record: ReportableVarianceRecord): boolean {
  return (
    record.wfmReview?.outcome === 'adjustment_requested' ||
    record.managerReview?.outcome === 'adjustment_requested'
  );
}

/** The Dialler_Sources that actually contributed evidence to this record's canonical figure. */
function contributingDiallerSourceIds(record: ReportableVarianceRecord): readonly string[] {
  // AMBIGUITY, STATED. Criterion 13.2 filters by Dialler_Source and does not say what it means for
  // a Variance_Record -- which is an employee-day, not a source row -- to belong to one. The
  // reading applied: a record matches a Dialler_Source when that source SUPPLIED minutes for the
  // date. criterion 7.2's contribution rows carry `minutes: null` for a source that held no record
  // for the date (never 0 standing in for absence), and those are excluded, because a reviewer
  // filtering on ViciDial is asking which days ViciDial's figures are behind, not which days it was
  // merely registered and silent. The rejected alternative -- matching every source listed on the
  // record, including the null-minute placeholders -- would return the same near-total set for
  // every source once all sources are listed on every record, which makes the filter useless.
  return record.evidence.diallerSourceContributions
    .filter((contribution) => contribution.minutes !== null)
    .map((contribution) => contribution.diallerSourceId);
}

// ---------------------------------------------------------------------------------------------
// Determinism helpers. Every array this module returns is sorted, so the same records in a
// different input order produce an identical result -- the same posture as
// variance-payroll-cutoff.ts.
// ---------------------------------------------------------------------------------------------

/** Plain string comparison, not localeCompare: no result may depend on the process locale. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Nulls sort LAST, so an unassigned grouping appears at the end of the report rather than the top. */
function compareNullableStrings(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareStrings(a, b);
}

/**
 * Total order over records. `id` is last and is unique, so the order is total rather than merely
 * deterministic-if-lucky.
 */
function compareRecords(a: ReportableVarianceRecord, b: ReportableVarianceRecord): number {
  if (a.workDate !== b.workDate) return compareStrings(a.workDate, b.workDate);
  if (a.employeeId !== b.employeeId) return compareStrings(a.employeeId, b.employeeId);
  return compareStrings(a.id, b.id);
}

/**
 * Identity of a record over exactly the fields this module reads. Field order is fixed, so two
 * entries describing the same record produce the same key regardless of object literal key order.
 * The evidence set is reduced to the figures that are read (the risk score and the contributing
 * source ids) rather than serialised whole, because the punch list is large and is never a
 * grouping, filter or count input.
 */
function recordIdentity(record: ReportableVarianceRecord): string {
  return JSON.stringify([
    record.id,
    record.employeeId,
    record.branchId,
    record.workDate,
    record.payMonth,
    record.queueState,
    record.status,
    record.costCentreId,
    record.processId,
    record.designationId,
    record.carriedForwardFromPayMonth,
    record.salaryLineId ?? null,
    record.floorAbsenceOccurrence === null ? null : record.floorAbsenceOccurrence.reason,
    record.evidence.evaluation.varianceRiskScore,
    record.evidence.evaluation.resolvedAttendanceSource,
    record.wfmReview?.outcome ?? null,
    record.managerReview?.outcome ?? null,
    [...contributingDiallerSourceIds(record)].sort(compareStrings),
  ]);
}

/**
 * Collapses exact duplicates (so passing the same list twice concatenated changes nothing) and
 * rejects two different records sharing one id.
 *
 * @throws when one record id carries two different sets of field values. That is a PROGRAMMER
 *   ERROR: the record id is the queue's primary key, so the database cannot produce it, and
 *   silently picking one of the two would make every count in this module depend on input order --
 *   the exact property it promises not to have. Same contract as `dedupeRecords` in
 *   variance-payroll-cutoff.ts.
 */
function dedupeRecords(
  records: readonly ReportableVarianceRecord[],
): readonly ReportableVarianceRecord[] {
  const byId = new Map<string, { record: ReportableVarianceRecord; identity: string }>();
  for (const record of records) {
    const identity = recordIdentity(record);
    const seen = byId.get(record.id);
    if (seen === undefined) {
      byId.set(record.id, { record, identity });
      continue;
    }
    if (seen.identity !== identity) {
      throw new Error(
        `variance-exception-report: two different Variance_Records were supplied under id ` +
          `${JSON.stringify(record.id)}. The record id is the queue's primary key, so the result ` +
          `would otherwise depend on input order.`,
      );
    }
  }
  return [...byId.values()].map((entry) => entry.record);
}

/**
 * criterion 6.8's occurrence must belong to the record it is attached to, or every count derived
 * from it names the wrong employee-day.
 *
 * @throws on a mismatch. A PROGRAMMER ERROR -- a wiring mistake in the join that attaches the
 *   occurrence -- and one that a warning would not save, because the Floor_Absence_Pattern count is
 *   the whole reason criterion 6.8's always-queue disposition is visible in this report.
 */
function assertFloorAbsenceOccurrenceMatches(record: ReportableVarianceRecord): void {
  const occurrence = record.floorAbsenceOccurrence;
  if (occurrence === null) return;
  if (occurrence.employeeId !== record.employeeId || occurrence.date !== record.workDate) {
    throw new Error(
      `variance-exception-report: the Floor_Absence_Pattern occurrence attached to Variance_Record ` +
        `${JSON.stringify(record.id)} names employee ${JSON.stringify(occurrence.employeeId)} on ` +
        `${JSON.stringify(occurrence.date)}, but the record is for employee ` +
        `${JSON.stringify(record.employeeId)} on ${JSON.stringify(record.workDate)}.`,
    );
  }
}

const PAY_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * @throws when the value is not 'YYYY-MM'. A malformed Pay_Month is a programmer error, not
 *   ordinary data, and the same guard `assertPayMonth` applies in variance-payroll-cutoff.ts: every
 *   in-scope test in this module is made against this value, so an unparseable one would silently
 *   report a branch as having no variances at all. Compare with the deliberately non-throwing
 *   cases here: an empty record set, an empty filter and an absent Dual_Review_Ceiling all return
 *   defined results.
 */
function assertPayMonth(label: string, value: string): void {
  if (typeof value !== 'string' || !PAY_MONTH_PATTERN.test(value)) {
    throw new Error(
      `variance-exception-report: ${label} must be a Pay_Month of the form 'YYYY-MM' ` +
        `(received ${JSON.stringify(value)}).`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// criterion 13.1: the scope-aware listing, and what "my own outcome is outstanding" means
// ---------------------------------------------------------------------------------------------

/**
 * The signed-in user, as criterion 13.1 needs them. `scopedBranchIds` is criterion 14.4's answer,
 * resolved by `resolveUserBusinessScope()` in the route layer and handed in -- the same convention
 * `approveAdjustmentRequest` uses for `approverOverrideApproverBranchIds` in variance-review.ts.
 */
export interface QueueViewer {
  readonly userId: string;
  /** The viewer's own employee row, when they have one. Half of criterion 7.7's identity test. */
  readonly employeeId?: string | null;
  /**
   * Branches the viewer's resolved business scope covers. A record in one of these branches is
   * listed even when the viewer holds neither reviewer slot on it -- a WFM head reads the queue
   * without being a named reviewer on every row. null or absent means "no branch-level scope", not
   * "every branch": a caller that has not resolved scope must not be handed the whole platform.
   */
  readonly scopedBranchIds?: readonly string[] | null;
}

/** Why a record is inside the viewer's scope (criteria 13.1, 14.4). */
export type ViewerScopeBasis =
  /** criterion 7.1: the viewer is one of the WFM_Reviewers the record is presented to. */
  | 'wfm_reviewer_slot'
  /** criteria 7.1, 7.6: the viewer holds the second slot, as manager or as branch substitute. */
  | 'reporting_manager_slot'
  /** criterion 7.10: the viewer is an Override_Approver for the employee's branch. */
  | 'override_approver'
  /** criterion 14.4: the viewer's resolved business scope covers the record's branch. */
  | 'business_scope_branch';

/** Why no Review_Outcome is outstanding for the viewer even though they hold a slot. */
export type OutstandingSuppressionReason =
  /** criteria 6.11, 7.1: never presented for Dual_Review, so nothing is owed on it. */
  | 'recorded_not_queued'
  /** criteria 7.5, 7.10: reviewed, contested or legacy-closed; it accepts no further outcome. */
  | 'record_closed'
  /** criterion 7.7: the viewer is the employee named on the record and may never review it. */
  | 'self_review_not_permitted'
  /** criterion 7.3: the viewer has already recorded on every slot they hold. */
  | 'own_outcome_already_recorded';

/** One of the viewer's own recorded outcomes, so the screen can show what they said. */
export interface ViewerRecordedOutcome {
  readonly role: ReviewerRole;
  readonly outcome: ReviewOutcome;
  readonly recordedAt: string;
  readonly comment: string;
}

/**
 * criterion 13.1's row. Carries the projection a queue list needs and no evidence set: this is a
 * LIST, and criterion 7.2's evidence is `presentForDualReview`'s job in variance-review.ts. A
 * Recorded_Not_Queued record therefore appears here (criterion 6.11 keeps it retrievable) without
 * this function ever becoming a review presentation.
 */
export interface QueueListingRow {
  readonly recordId: string;
  readonly employeeId: string;
  readonly branchId: string;
  readonly workDate: string;
  readonly payMonth: string;
  readonly costCentreId: string | null;
  readonly processId: string | null;
  readonly designationId: string | null;
  readonly queueState: QueueState;
  readonly status: VarianceRecordStatus;
  readonly varianceRiskScore: number | null;
  readonly resolvedAttendanceSource: ResolvedAttendanceSource;
  readonly contributingDiallerSourceIds: readonly string[];
  readonly isFloorAbsencePatternOccurrence: boolean;
  /** criterion 9.3. null when the record was not carried across a Payroll_Cut_Off. */
  readonly carriedForwardFromPayMonth: string | null;
  readonly carriedForward: boolean;
  /** Why this row is in the viewer's scope. Never empty: an out-of-scope row is not listed. */
  readonly viewerScopeBases: readonly ViewerScopeBasis[];
  /** The reviewer slots the viewer fills on THIS record. Empty for a scope-only viewer. */
  readonly viewerSlots: readonly ReviewerRole[];
  /**
   * criterion 13.1's indicator, PER SLOT. With two reviewer slots (criterion 7.5) "the user's own
   * Review_Outcome is outstanding" is a fact about a slot, not about a record: a user who holds
   * both slots (the branch workforce-management point of contact of criterion 7.6 who is also a
   * named WFM_Reviewer) can owe one outcome and have recorded the other, and a record whose OTHER
   * slot is still empty owes that user nothing. This array is the slots the viewer personally still
   * owes an outcome on.
   */
  readonly viewerOutstandingSlots: readonly ReviewerRole[];
  /** criterion 13.1, the boolean the screen renders. True exactly when the array above is non-empty. */
  readonly ownReviewOutstanding: boolean;
  /** The viewer's own outcomes already recorded, sorted by role. */
  readonly viewerRecordedOutcomes: readonly ViewerRecordedOutcome[];
  /**
   * Why nothing is outstanding, when the viewer holds a slot and yet owes nothing. null when the
   * viewer does owe an outcome, and null for a scope-only viewer who holds no slot at all.
   */
  readonly outstandingSuppressionReason: OutstandingSuppressionReason | null;
  /** The other slot's state, so the screen can show "waiting on the reporting manager". */
  readonly wfmOutcome: ReviewOutcome | null;
  readonly managerOutcome: ReviewOutcome | null;
  readonly awaitingSlots: readonly ReviewerRole[];
}

export interface QueueListingInput {
  readonly viewer: QueueViewer;
  readonly records: readonly ReportableVarianceRecord[];
  /** criterion 13.2. Absent means no constraint. */
  readonly filter?: VarianceQueueFilter | null;
}

export interface QueueListing {
  readonly viewerUserId: string;
  /** Sorted by workDate, then employeeId, then record id. */
  readonly rows: readonly QueueListingRow[];
  readonly rowCount: number;
  /** criterion 13.1: how many rows the viewer personally still owes an outcome on. */
  readonly ownOutstandingCount: number;
  /** Distinct slots the viewer owes an outcome on somewhere in the listing. */
  readonly ownOutstandingSlots: readonly ReviewerRole[];
  /**
   * criterion 14.4: supplied records the viewer may not see. A COUNT only, never the ids -- see
   * the note on `BulkReviewRefusal.outOfScopeRecordCount`.
   */
  readonly outOfScopeRecordCount: number;
  /** Rows the criterion 13.2 filter removed from the in-scope set. */
  readonly filteredOutRecordCount: number;
}

/**
 * Which reviewer slots one user fills on one record (criteria 7.1, 7.5, 7.6), and whether the
 * record is inside their scope at all (criterion 14.4).
 *
 * Slot eligibility mirrors `authorizeReviewer` in variance-review.ts exactly, including criterion
 * 7.6's substitution rule -- the branch workforce-management point of contact fills the second slot
 * ONLY when the employee has no Reporting_Manager. It is recomputed here rather than obtained by
 * calling `authorizeReviewer`, because that function is the RECORDING gate and refuses a
 * Recorded_Not_Queued or closed record outright; criterion 13.1 still has to list those rows and
 * say that nothing is outstanding on them. `assessBulkSelection` and `recordBulkReviewOutcome` do
 * go through `authorizeReviewer`, so the recording path retains its single unforgeable gate.
 */
function resolveViewerSlots(
  record: ReportableVarianceRecord,
  viewer: QueueViewer,
): readonly ReviewerRole[] {
  const slots: ReviewerRole[] = [];
  if (record.authorizedWfmReviewerUserIds.includes(viewer.userId)) slots.push('wfm_reviewer');
  const holdsSecondSlot =
    record.reportingManagerUserId !== null
      ? record.reportingManagerUserId === viewer.userId
      : // criterion 7.6: only reachable when there is no Reporting_Manager at all.
        record.branchWfmContactUserId !== null && record.branchWfmContactUserId === viewer.userId;
  if (holdsSecondSlot) slots.push('reporting_manager');
  return slots;
}

/** criterion 7.7's identity test, both halves, as `authorizeReviewer` applies it. */
function viewerIsTheEmployee(record: ReportableVarianceRecord, viewer: QueueViewer): boolean {
  const isEmployeeLogin =
    record.employeeUserId !== null && record.employeeUserId === viewer.userId;
  const isEmployeeRow =
    viewer.employeeId !== null &&
    viewer.employeeId !== undefined &&
    viewer.employeeId === record.employeeId;
  return isEmployeeLogin || isEmployeeRow;
}

function resolveViewerScopeBases(
  record: ReportableVarianceRecord,
  viewer: QueueViewer,
  slots: readonly ReviewerRole[],
): readonly ViewerScopeBasis[] {
  const bases: ViewerScopeBasis[] = [];
  if (slots.includes('wfm_reviewer')) bases.push('wfm_reviewer_slot');
  if (slots.includes('reporting_manager')) bases.push('reporting_manager_slot');
  if (record.overrideApproverUserIds.includes(viewer.userId)) bases.push('override_approver');
  if ((viewer.scopedBranchIds ?? []).includes(record.branchId)) bases.push('business_scope_branch');
  return bases;
}

function recordedReviewFor(
  record: ReportableVarianceRecord,
  role: ReviewerRole,
): RecordedReview | null {
  return role === 'wfm_reviewer' ? record.wfmReview : record.managerReview;
}

interface ViewerOutstanding {
  readonly outstandingSlots: readonly ReviewerRole[];
  readonly recordedOutcomes: readonly ViewerRecordedOutcome[];
  readonly suppressionReason: OutstandingSuppressionReason | null;
}

/**
 * criterion 13.1's per-slot outstanding test. A slot is outstanding for this viewer when the viewer
 * fills it, the record is presented for Dual_Review, the record is not closed, the viewer is not
 * the employee, and that slot holds no outcome yet.
 */
function resolveViewerOutstanding(
  record: ReportableVarianceRecord,
  viewer: QueueViewer,
  slots: readonly ReviewerRole[],
): ViewerOutstanding {
  const recordedOutcomes: ViewerRecordedOutcome[] = [];
  for (const role of slots) {
    const review = recordedReviewFor(record, role);
    // Only the viewer's OWN recorded outcome is reported here. A slot filled by somebody else --
    // possible when a substitution changed hands -- is other people's opinion and belongs to the
    // wfmOutcome / managerOutcome fields, not to "your outcome".
    if (review !== null && review.userId === viewer.userId) {
      recordedOutcomes.push(
        Object.freeze({
          role,
          outcome: review.outcome,
          recordedAt: review.recordedAt,
          comment: review.comment,
        }),
      );
    }
  }
  const frozenOutcomes = Object.freeze(
    recordedOutcomes.sort((a, b) => compareStrings(a.role, b.role)),
  );

  const settle = (
    outstandingSlots: readonly ReviewerRole[],
    suppressionReason: OutstandingSuppressionReason | null,
  ): ViewerOutstanding =>
    Object.freeze({
      outstandingSlots: Object.freeze([...outstandingSlots]),
      recordedOutcomes: frozenOutcomes,
      suppressionReason,
    });

  // A viewer who holds no slot is a scope-only reader (an Override_Approver, or a WFM head reading
  // a branch). Nothing is outstanding for them and nothing is being suppressed either.
  if (slots.length === 0) return settle([], null);
  // criteria 6.11, 7.1.
  if (!isQueuedReportable(record)) return settle([], 'recorded_not_queued');
  // criteria 7.5, 7.10.
  if (isClosedStatus(record.status)) return settle([], 'record_closed');
  // criterion 7.7.
  if (viewerIsTheEmployee(record, viewer)) return settle([], 'self_review_not_permitted');

  const outstanding = slots.filter((role) => recordedReviewFor(record, role) === null);
  if (outstanding.length === 0) return settle([], 'own_outcome_already_recorded');
  return settle(outstanding, null);
}

function awaitingSlots(record: ReportableVarianceRecord): readonly ReviewerRole[] {
  if (!isQueuedReportable(record) || isClosedStatus(record.status)) return Object.freeze([]);
  const awaiting: ReviewerRole[] = [];
  if (record.wfmReview === null) awaiting.push('wfm_reviewer');
  if (record.managerReview === null) awaiting.push('reporting_manager');
  return Object.freeze(awaiting);
}

function buildQueueListingRow(
  record: ReportableVarianceRecord,
  viewer: QueueViewer,
  slots: readonly ReviewerRole[],
  scopeBases: readonly ViewerScopeBasis[],
): QueueListingRow {
  const outstanding = resolveViewerOutstanding(record, viewer, slots);
  return Object.freeze({
    recordId: record.id,
    employeeId: record.employeeId,
    branchId: record.branchId,
    workDate: record.workDate,
    payMonth: record.payMonth,
    costCentreId: record.costCentreId,
    processId: record.processId,
    designationId: record.designationId,
    queueState: record.queueState,
    status: record.status,
    varianceRiskScore: record.evidence.evaluation.varianceRiskScore,
    resolvedAttendanceSource: record.evidence.evaluation.resolvedAttendanceSource,
    contributingDiallerSourceIds: Object.freeze(
      [...contributingDiallerSourceIds(record)].sort(compareStrings),
    ),
    isFloorAbsencePatternOccurrence: record.floorAbsenceOccurrence !== null,
    carriedForwardFromPayMonth: record.carriedForwardFromPayMonth,
    carriedForward: record.carriedForwardFromPayMonth !== null,
    viewerScopeBases: Object.freeze([...scopeBases]),
    viewerSlots: Object.freeze([...slots]),
    viewerOutstandingSlots: outstanding.outstandingSlots,
    ownReviewOutstanding: outstanding.outstandingSlots.length > 0,
    viewerRecordedOutcomes: outstanding.recordedOutcomes,
    outstandingSuppressionReason: outstanding.suppressionReason,
    wfmOutcome: record.wfmReview?.outcome ?? null,
    managerOutcome: record.managerReview?.outcome ?? null,
    awaitingSlots: awaitingSlots(record),
  });
}

/**
 * criteria 13.1, 13.2 and 14.4. Lists the Variance_Records inside the signed-in user's scope, each
 * flagged with whether that user's own Review_Outcome is outstanding, optionally narrowed by the
 * criterion 13.2 filter.
 *
 * Total: an empty record set, an absent filter and a viewer with no scope at all all return
 * defined listings. Deterministic and ordering-independent.
 *
 * @throws only for programmer errors -- two different records under one id (see `dedupeRecords`), a
 *   mismatched Floor_Absence_Pattern occurrence, or a malformed Pay_Month inside the filter.
 */
export function listVarianceReviewQueue(input: QueueListingInput): QueueListing {
  const { viewer } = input;
  const deduped = dedupeRecords(input.records);
  for (const record of deduped) assertFloorAbsenceOccurrenceMatches(record);

  const inScope: { record: ReportableVarianceRecord; slots: readonly ReviewerRole[]; bases: readonly ViewerScopeBasis[] }[] =
    [];
  let outOfScopeRecordCount = 0;
  for (const record of deduped) {
    const slots = resolveViewerSlots(record, viewer);
    const bases = resolveViewerScopeBases(record, viewer, slots);
    // criterion 14.4: no basis, no row. Not a filter the caller can turn off.
    if (bases.length === 0) {
      outOfScopeRecordCount += 1;
      continue;
    }
    inScope.push({ record, slots, bases });
  }

  const filter = input.filter ?? null;
  const kept =
    filter === null ? inScope : inScope.filter((entry) => matchesQueueFilter(entry.record, filter));

  const rows = kept
    .sort((a, b) => compareRecords(a.record, b.record))
    .map((entry) => buildQueueListingRow(entry.record, viewer, entry.slots, entry.bases));

  const outstandingRows = rows.filter((row) => row.ownReviewOutstanding);
  const outstandingSlots = new Set<ReviewerRole>();
  for (const row of outstandingRows) for (const slot of row.viewerOutstandingSlots) outstandingSlots.add(slot);

  return Object.freeze({
    viewerUserId: viewer.userId,
    rows: Object.freeze(rows),
    rowCount: rows.length,
    ownOutstandingCount: outstandingRows.length,
    ownOutstandingSlots: Object.freeze([...outstandingSlots].sort(compareStrings)),
    outOfScopeRecordCount,
    filteredOutRecordCount: inScope.length - kept.length,
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 13.2: filtering
// ---------------------------------------------------------------------------------------------

/**
 * criterion 13.2's filter. Every member is optional, and EVERY member means "no constraint" when
 * it is absent, null OR an empty array.
 *
 * WHY AN EMPTY ARRAY IS NO CONSTRAINT RATHER THAN NO MATCH. The screen builds this object from a
 * set of multi-select controls, and a control with nothing selected means the user has not narrowed
 * that dimension. Reading `branchIds: []` as "match no branch" would make an untouched control
 * empty the whole queue, and would make the difference between an absent key and a present-but-
 * empty key -- an accident of how the query string was parsed -- change the answer. Absent, null
 * and empty are therefore the same thing here, deliberately, and `isConstrained` is the single
 * place that decides it.
 *
 * The dimension lists accept `null` as a MEMBER, which is how a caller targets the rows criterion
 * 13.4 groups under `(unassigned)`: `designationIds: [null]` selects the employees who hold no
 * designation. A null on a record never matches a non-null id, and a non-null id never matches a
 * null filter member, so the two directions cannot be confused.
 */
export interface VarianceQueueFilter {
  /** 'YYYY-MM'. Validated; a malformed Pay_Month is a programmer error. */
  readonly payMonths?: readonly string[] | null;
  readonly branchIds?: readonly string[] | null;
  readonly processIds?: readonly (string | null)[] | null;
  readonly costCentreIds?: readonly (string | null)[] | null;
  /** Matched against the sources that supplied minutes -- see `contributingDiallerSourceIds`. */
  readonly diallerSourceIds?: readonly string[] | null;
  /** criterion 13.2's "review state": the Variance_Record status of criterion 7.11. */
  readonly reviewStates?: readonly VarianceRecordStatus[] | null;
  /** criterion 13.2: 'queued_for_dual_review' or 'recorded_not_queued', spelled exactly. */
  readonly queueStates?: readonly QueueState[] | null;
  /**
   * criteria 9.3, 13.2's carried-forward state. true keeps only carried-forward records, false
   * keeps only records that are not carried forward, and null/absent is no constraint -- three
   * distinguishable states, which a plain boolean could not express.
   */
  readonly carriedForward?: boolean | null;
}

/** Absent, null and empty all mean "no constraint" -- see the note on `VarianceQueueFilter`. */
function isConstrained<T>(values: readonly T[] | null | undefined): values is readonly T[] {
  return values !== null && values !== undefined && values.length > 0;
}

/**
 * One record against one filter. A conjunction of independent per-dimension predicates, which is
 * what makes `applyQueueFilter` commute: no predicate reads another dimension, so no order of
 * application can change the surviving set.
 */
function matchesQueueFilter(
  record: ReportableVarianceRecord,
  filter: VarianceQueueFilter,
): boolean {
  if (isConstrained(filter.payMonths)) {
    for (const payMonth of filter.payMonths) assertPayMonth('filter.payMonths entry', payMonth);
    if (!filter.payMonths.includes(record.payMonth)) return false;
  }
  if (isConstrained(filter.branchIds) && !filter.branchIds.includes(record.branchId)) return false;
  if (isConstrained(filter.processIds) && !filter.processIds.includes(record.processId)) return false;
  if (isConstrained(filter.costCentreIds) && !filter.costCentreIds.includes(record.costCentreId)) {
    return false;
  }
  if (isConstrained(filter.diallerSourceIds)) {
    const contributing = contributingDiallerSourceIds(record);
    if (!filter.diallerSourceIds.some((sourceId) => contributing.includes(sourceId))) return false;
  }
  if (isConstrained(filter.reviewStates) && !filter.reviewStates.includes(record.status)) {
    return false;
  }
  if (isConstrained(filter.queueStates) && !filter.queueStates.includes(record.queueState)) {
    return false;
  }
  if (filter.carriedForward !== null && filter.carriedForward !== undefined) {
    if ((record.carriedForwardFromPayMonth !== null) !== filter.carriedForward) return false;
  }
  return true;
}

/**
 * criterion 13.2. Applies a filter to a record set and returns the survivors, sorted.
 *
 * Three properties hold for every input and are property-tested:
 *   - SUBSET. The result is always a subset of the supplied set.
 *   - COMPOSITION. Applying two filters in either order gives the same set, because the predicates
 *     are independent conjuncts.
 *   - IDENTITY OF THE EMPTY FILTER. An empty filter constrains nothing and returns the whole set.
 *
 * Total: an empty record set and an empty filter both return defined results.
 *
 * @throws only when a filter Pay_Month is not 'YYYY-MM' (programmer error, see `assertPayMonth`).
 */
export function applyQueueFilter(
  records: readonly ReportableVarianceRecord[],
  filter: VarianceQueueFilter | null | undefined,
): readonly ReportableVarianceRecord[] {
  const sorted = [...records].sort(compareRecords);
  if (filter === null || filter === undefined) return Object.freeze(sorted);
  return Object.freeze(sorted.filter((record) => matchesQueueFilter(record, filter)));
}

// ---------------------------------------------------------------------------------------------
// criterion 13.3: one Review_Outcome across a selected set, with one comment applied to the set
// ---------------------------------------------------------------------------------------------

/**
 * criterion 13.3's submission. The per-record comment of `ReviewSubmission` is absent by design:
 * criterion 13.3 applies ONE comment to the whole set, so it is a property of the action
 * (`BulkReviewInput.comment`) rather than of each row, and there is no member here through which a
 * second, per-row comment could arrive.
 *
 * All three outcomes are accepted. A bulk `adjustment_requested` states one requested
 * classification for every selected employee-day, which is a coarse instrument but a legitimate one
 * (a whole floor's dialler feed was down and every day is the same correction), and it still moves
 * no pay on its own: each resulting adjustment request must be approved separately by an
 * Override_Approver under criteria 8.3 to 8.6.
 */
export type BulkReviewSubmission =
  | { readonly outcome: 'apr_accepted' }
  | { readonly outcome: 'apr_disputed' }
  | {
      readonly outcome: 'adjustment_requested';
      readonly requestedClassification: DayClassification;
      readonly requestedLwpValue?: number | null;
    };

/** Why one selected row could not take the bulk outcome. */
export type BulkRowRefusalCode =
  /** The selected id is not in the supplied record set at all. */
  | 'record_not_in_supplied_set'
  /** criteria 14.4, 14.6: the record is outside the acting user's scope. */
  | 'record_outside_user_scope'
  /** criteria 6.11, 7.1: Recorded_Not_Queued records are never presented for Dual_Review. */
  | 'record_not_queued_for_dual_review'
  /** criteria 7.5, 7.10: reviewed, contested or legacy-closed. */
  | 'record_already_closed'
  /** criterion 7.7. */
  | 'self_review_not_permitted'
  /** criteria 7.1, 7.3: the acting user holds no slot, or has already recorded on the one they hold. */
  | 'no_outstanding_slot_for_user'
  /**
   * criterion 7.5 protected. The acting user holds BOTH reviewer slots on this record and both are
   * outstanding -- reachable in criterion 7.6's substitution case, where the employee has no
   * Reporting_Manager and the branch workforce-management point of contact who substitutes is also
   * a named WFM_Reviewer for the same employee. Applying one bulk outcome would fill both slots
   * from one person and mark the record reviewed by a Dual_Review that only one human took part in,
   * which is the single thing Requirement 7 exists to prevent. The row is refused and the reviewer
   * is left to record each slot deliberately on the single-record screen.
   */
  | 'viewer_holds_both_outstanding_slots';

/** One selected row's eligibility for the bulk action. */
export interface BulkSelectionRow {
  readonly recordId: string;
  readonly eligible: boolean;
  /** The slot the outcome would be recorded into. null on every ineligible row. */
  readonly role: ReviewerRole | null;
  readonly refusalCode: BulkRowRefusalCode | null;
}

export interface BulkSelectionAssessment {
  /** Sorted by record id. One row per SELECTED id, including ids that matched nothing. */
  readonly rows: readonly BulkSelectionRow[];
  readonly selectedCount: number;
  readonly eligibleRecordIds: readonly string[];
  /**
   * Ineligible rows the acting user is allowed to know about -- that is, records inside their
   * scope. An out-of-scope record is counted only, never named: criterion 14.6 requires a refused
   * request to return NO employee data, and a Variance_Record id identifies an employee-day.
   */
  readonly ineligibleRows: readonly BulkSelectionRow[];
  readonly outOfScopeRecordCount: number;
  readonly missingRecordCount: number;
}

export interface BulkReviewInput {
  readonly viewer: QueueViewer;
  readonly records: readonly ReportableVarianceRecord[];
  /** criterion 13.3's selected set, by record id. Order is irrelevant; duplicates collapse. */
  readonly selectedRecordIds: readonly string[];
  readonly submission: BulkReviewSubmission;
  /** criterion 13.3's ONE comment for the set. Measured once by criterion 7.4's own rule. */
  readonly comment?: string | null;
  /** criterion 7.3's recording timestamp, supplied rather than read from a clock. */
  readonly recordedAt: string;
}

/**
 * criterion 13.3. Assesses a selection WITHOUT recording anything, so the screen can grey out the
 * rows a bulk action would refuse before the reviewer presses the button, and so
 * `recordBulkReviewOutcome` has exactly one implementation of the eligibility rules.
 *
 * Slot eligibility is decided by `authorizeReviewer` from variance-review.ts -- criterion 7.7's
 * single unforgeable gate -- and never by a re-implementation of it here.
 */
export function assessBulkSelection(
  input: Pick<BulkReviewInput, 'viewer' | 'records' | 'selectedRecordIds'>,
): BulkSelectionAssessment {
  const deduped = dedupeRecords(input.records);
  for (const record of deduped) assertFloorAbsenceOccurrenceMatches(record);
  const byId = new Map(deduped.map((record) => [record.id, record] as const));
  const selectedIds = [...new Set(input.selectedRecordIds)].sort(compareStrings);

  const rows: BulkSelectionRow[] = [];
  let outOfScopeRecordCount = 0;
  let missingRecordCount = 0;

  for (const recordId of selectedIds) {
    const record = byId.get(recordId);
    if (record === undefined) {
      missingRecordCount += 1;
      rows.push(
        Object.freeze({
          recordId,
          eligible: false,
          role: null,
          refusalCode: 'record_not_in_supplied_set' as const,
        }),
      );
      continue;
    }

    const slots = resolveViewerSlots(record, input.viewer);
    const bases = resolveViewerScopeBases(record, input.viewer, slots);
    if (bases.length === 0) {
      outOfScopeRecordCount += 1;
      rows.push(
        Object.freeze({
          recordId,
          eligible: false,
          role: null,
          refusalCode: 'record_outside_user_scope' as const,
        }),
      );
      continue;
    }

    // criteria 6.11, 7.1. Tested before the authority is sought, so the refusal names the queue
    // state rather than a slot eligibility message that would be beside the point.
    if (!isQueuedReportable(record)) {
      rows.push(
        Object.freeze({
          recordId,
          eligible: false,
          role: null,
          refusalCode: 'record_not_queued_for_dual_review' as const,
        }),
      );
      continue;
    }
    // criteria 7.5, 7.10.
    if (isClosedStatus(record.status)) {
      rows.push(
        Object.freeze({
          recordId,
          eligible: false,
          role: null,
          refusalCode: 'record_already_closed' as const,
        }),
      );
      continue;
    }

    const outstanding = slots.filter((role) => recordedReviewFor(record, role) === null);
    // criterion 7.7. Checked here so a self-reviewer sees the self-review refusal rather than an
    // "already recorded" one, matching the ordering `authorizeReviewer` deliberately applies.
    if (viewerIsTheEmployee(record, input.viewer)) {
      rows.push(
        Object.freeze({
          recordId,
          eligible: false,
          role: null,
          refusalCode: 'self_review_not_permitted' as const,
        }),
      );
      continue;
    }
    if (outstanding.length === 0) {
      rows.push(
        Object.freeze({
          recordId,
          eligible: false,
          role: null,
          refusalCode: 'no_outstanding_slot_for_user' as const,
        }),
      );
      continue;
    }
    if (outstanding.length > 1) {
      rows.push(
        Object.freeze({
          recordId,
          eligible: false,
          role: null,
          refusalCode: 'viewer_holds_both_outstanding_slots' as const,
        }),
      );
      continue;
    }

    const role = outstanding[0]!;
    // The real gate. If variance-review.ts refuses the authority for any reason this function has
    // not anticipated, the row is ineligible -- eligibility can only ever be narrower than the
    // recorder's own rules, never wider.
    const authorized = authorizeReviewer(record, {
      userId: input.viewer.userId,
      employeeId: input.viewer.employeeId ?? null,
      role,
    });
    if (!authorized.ok) {
      rows.push(
        Object.freeze({
          recordId,
          eligible: false,
          role: null,
          refusalCode:
            authorized.rejection.code === 'self_review_not_permitted'
              ? ('self_review_not_permitted' as const)
              : authorized.rejection.code === 'record_not_queued_for_dual_review'
                ? ('record_not_queued_for_dual_review' as const)
                : ('no_outstanding_slot_for_user' as const),
        }),
      );
      continue;
    }
    rows.push(Object.freeze({ recordId, eligible: true, role, refusalCode: null }));
  }

  const ineligibleRows = rows.filter(
    (row) => !row.eligible && row.refusalCode !== 'record_outside_user_scope',
  );

  return Object.freeze({
    rows: Object.freeze(rows),
    selectedCount: selectedIds.length,
    eligibleRecordIds: Object.freeze(rows.filter((row) => row.eligible).map((row) => row.recordId)),
    ineligibleRows: Object.freeze(ineligibleRows),
    outOfScopeRecordCount,
    missingRecordCount,
  });
}

/** Why the whole bulk action was refused. */
export type BulkRefusalCode =
  /** No record was selected. There is nothing to apply one outcome and one comment to. */
  | 'selection_empty'
  /** criterion 7.4, measured once for the set-wide comment. */
  | 'comment_too_short'
  /** criterion 8.2: an adjustment request must state the requested classification. */
  | 'requested_classification_required'
  /** criterion 13.3 with 14.4 / 7.1 / 7.3: at least one selected row could not take the outcome. */
  | 'selection_contains_ineligible_records';

export interface BulkReviewRefusal {
  /** The first refusal that applied. */
  readonly code: BulkRefusalCode;
  /** Every refusal that applied, so one attempt is not audited three times to learn three facts. */
  readonly codes: readonly BulkRefusalCode[];
  readonly message: string;
  readonly criteria: readonly string[];
  readonly selectedCount: number;
  /** Literal 0. See the all-or-nothing note on `recordBulkReviewOutcome`. */
  readonly appliedCount: 0;
  /** In-scope ineligible rows only, so the reviewer can deselect them and re-submit. */
  readonly ineligibleRows: readonly BulkSelectionRow[];
  /** criteria 14.4, 14.6: a count, never the ids. */
  readonly outOfScopeRecordCount: number;
  readonly missingRecordCount: number;
  readonly attemptedByUserId: string;
  readonly attemptedAt: string;
}

/** One row the bulk action recorded, wrapping variance-review.ts's own accepted result. */
export interface BulkReviewApplied {
  readonly recordId: string;
  readonly role: ReviewerRole;
  /** The single-record result, unchanged. Nothing here re-derives what that function decided. */
  readonly result: RecordOutcomeAccepted;
}

export interface BulkReviewAccepted {
  readonly ok: true;
  readonly outcome: ReviewOutcome;
  /** criterion 13.3's one comment, normalized once and applied identically to every row. */
  readonly comment: string;
  readonly recordedAt: string;
  readonly appliedCount: number;
  /** Sorted by record id. */
  readonly applied: readonly BulkReviewApplied[];
  /** criterion 7.5: records whose second slot this action filled. */
  readonly completedDualReviewRecordIds: readonly string[];
  /** criterion 7.10: records this action put into conflict. */
  readonly contestedRecordIds: readonly string[];
  /** criterion 8.2. Returned as intent; each still needs an Override_Approver under 8.3 to 8.6. */
  readonly adjustmentRequests: readonly AdjustmentRequest[];
  /** criterion 7.10's routing intents. This module notifies nobody. */
  readonly overrideApproverRoutings: readonly OverrideApproverRouting[];
}

export type BulkReviewResult =
  | BulkReviewAccepted
  | { readonly ok: false; readonly refusal: BulkReviewRefusal };

/**
 * criterion 13.3. Records ONE Review_Outcome across a selected set of Variance_Records, with ONE
 * comment applied to the set.
 *
 * ALL-OR-NOTHING, AND WHY. A selection containing a record outside the acting user's scope, or a
 * record on which that user has no outstanding slot, refuses the WHOLE action; no row is recorded.
 * The alternative -- applying the eligible rows and rejecting the offending ones individually -- was
 * rejected for three reasons:
 *
 *  1. The comment is one justification for one decision (criterion 13.3), but criterion 7.3 stores
 *     it on each row SEPARATELY. Silently narrowing the set would leave that sentence standing as
 *     the recorded reasoning for a set of employee-days the reviewer did not choose, and no
 *     subsequent reader -- reviewer, Override_Approver or auditor -- could tell which rows it was
 *     written about. Partial success is not a smaller version of the action; it is a different
 *     action with the same justification attached.
 *  2. Criterion 14.6 requires a refused request to return NO employee data. Per-row rejection has
 *     to name the rejected rows for the screen to be usable, and a Variance_Record id names an
 *     employee-day. Refusing wholesale lets the refusal report out-of-scope rows as a COUNT and
 *     name only the rows the user is already entitled to see -- which is exactly what
 *     `BulkReviewRefusal` does.
 *  3. In a pure module the rollback is free. Nothing is written until the caller persists the
 *     returned results, so refusing costs one discarded computation, whereas a partially applied
 *     write would need a transaction to undo. Choosing per-row here would buy convenience with a
 *     durability problem that does not otherwise exist.
 *
 * The cost of this choice is a stale selection: another reviewer recording on one of the selected
 * records between the screen loading and the button being pressed refuses the whole submission. That
 * is why `assessBulkSelection` is exported -- the screen re-assesses, shows which rows moved, and
 * the reviewer re-submits the rest. Nothing is lost, and the reviewer always knows what their
 * comment was recorded against.
 *
 * Total: an empty selection, an empty record set and an absent comment all return defined results;
 * this function never throws for ordinary data.
 *
 * @throws only for programmer errors -- two different records under one id, or a mismatched
 *   Floor_Absence_Pattern occurrence.
 */
export function recordBulkReviewOutcome(input: BulkReviewInput): BulkReviewResult {
  const assessment = assessBulkSelection(input);

  const codes: BulkRefusalCode[] = [];
  const criteria: string[] = [];

  if (assessment.selectedCount === 0) {
    codes.push('selection_empty');
    criteria.push('13.3');
  }

  // criterion 7.4, measured ONCE for the whole set with variance-review.ts's own measurement --
  // invisible characters dropped, whitespace runs collapsed, Unicode code points counted. Because
  // the same normalized string then goes to every row, `recordReviewOutcome`'s own per-row comment
  // check cannot disagree with this one.
  const comment = normalizeReviewerComment(input.comment);
  const commentRequired =
    input.submission.outcome === 'apr_disputed' ||
    input.submission.outcome === 'adjustment_requested';
  if (commentRequired && comment.length < MIN_REVIEWER_COMMENT_LENGTH) {
    codes.push('comment_too_short');
    criteria.push('7.4');
  }

  // criterion 8.2.
  if (
    input.submission.outcome === 'adjustment_requested' &&
    !input.submission.requestedClassification
  ) {
    codes.push('requested_classification_required');
    criteria.push('8.2');
  }

  if (
    assessment.ineligibleRows.length > 0 ||
    assessment.outOfScopeRecordCount > 0 ||
    assessment.missingRecordCount > 0
  ) {
    codes.push('selection_contains_ineligible_records');
    criteria.push('7.1', '7.3', '13.3', '14.4');
  }

  if (codes.length > 0) return bulkRefusal(codes, criteria, assessment, input);

  const byId = new Map(dedupeRecords(input.records).map((record) => [record.id, record] as const));
  const submission: ReviewSubmission =
    input.submission.outcome === 'adjustment_requested'
      ? {
          outcome: 'adjustment_requested',
          comment: comment.normalized,
          requestedClassification: input.submission.requestedClassification,
          requestedLwpValue: input.submission.requestedLwpValue ?? null,
        }
      : input.submission.outcome === 'apr_disputed'
        ? { outcome: 'apr_disputed', comment: comment.normalized }
        : { outcome: 'apr_accepted', comment: comment.normalized };

  const applied: BulkReviewApplied[] = [];
  const lateRefusals: BulkSelectionRow[] = [];

  for (const row of assessment.rows) {
    if (!row.eligible || row.role === null) continue;
    const record = byId.get(row.recordId);
    // Unreachable: an eligible row came from this same map. Handled rather than asserted so the
    // function stays total.
    if (record === undefined || !isQueuedReportable(record)) {
      lateRefusals.push({
        recordId: row.recordId,
        eligible: false,
        role: null,
        refusalCode: 'record_not_in_supplied_set',
      });
      continue;
    }
    const authorized = authorizeReviewer(record, {
      userId: input.viewer.userId,
      employeeId: input.viewer.employeeId ?? null,
      role: row.role,
    });
    if (!authorized.ok) {
      lateRefusals.push({
        recordId: row.recordId,
        eligible: false,
        role: null,
        refusalCode: 'no_outstanding_slot_for_user',
      });
      continue;
    }
    const result = recordReviewOutcome({
      record,
      authority: authorized.authority,
      submission,
      recordedAt: input.recordedAt,
    });
    if (!result.ok) {
      lateRefusals.push({
        recordId: row.recordId,
        eligible: false,
        role: null,
        refusalCode: 'no_outstanding_slot_for_user',
      });
      continue;
    }
    applied.push(Object.freeze({ recordId: row.recordId, role: row.role, result }));
  }

  // All-or-nothing, defence in depth. If the recorder refused a row this function had assessed as
  // eligible, the two disagree and nothing is returned as applied -- rather than recording the rest
  // and leaving the disagreement invisible.
  if (lateRefusals.length > 0) {
    const lateAssessment: BulkSelectionAssessment = Object.freeze({
      ...assessment,
      ineligibleRows: Object.freeze([...assessment.ineligibleRows, ...lateRefusals]),
    });
    return bulkRefusal(
      ['selection_contains_ineligible_records'],
      ['7.1', '7.3', '13.3'],
      lateAssessment,
      input,
    );
  }

  const sorted = applied.sort((a, b) => compareStrings(a.recordId, b.recordId));
  return Object.freeze({
    ok: true as const,
    outcome: input.submission.outcome,
    comment: comment.normalized,
    recordedAt: input.recordedAt,
    appliedCount: sorted.length,
    applied: Object.freeze(sorted),
    completedDualReviewRecordIds: Object.freeze(
      sorted.filter((entry) => entry.result.dualReviewComplete).map((entry) => entry.recordId),
    ),
    contestedRecordIds: Object.freeze(
      sorted
        .filter((entry) => entry.result.statusAfter === 'contested')
        .map((entry) => entry.recordId),
    ),
    adjustmentRequests: Object.freeze(
      sorted
        .map((entry) => entry.result.adjustmentRequest)
        .filter((request): request is AdjustmentRequest => request !== null),
    ),
    overrideApproverRoutings: Object.freeze(
      sorted
        .map((entry) => entry.result.routing)
        .filter((routing): routing is OverrideApproverRouting => routing !== null),
    ),
  });
}

function bulkRefusal(
  codes: readonly BulkRefusalCode[],
  criteria: readonly string[],
  assessment: BulkSelectionAssessment,
  input: BulkReviewInput,
): { readonly ok: false; readonly refusal: BulkReviewRefusal } {
  const code = codes[0]!;
  return Object.freeze({
    ok: false as const,
    refusal: Object.freeze({
      code,
      codes: Object.freeze([...codes]),
      message: bulkRefusalMessage(code, assessment),
      criteria: Object.freeze([...new Set(criteria)]),
      selectedCount: assessment.selectedCount,
      appliedCount: 0 as const,
      ineligibleRows: assessment.ineligibleRows,
      outOfScopeRecordCount: assessment.outOfScopeRecordCount,
      missingRecordCount: assessment.missingRecordCount,
      attemptedByUserId: input.viewer.userId,
      attemptedAt: input.recordedAt,
    }),
  });
}

function bulkRefusalMessage(code: BulkRefusalCode, assessment: BulkSelectionAssessment): string {
  switch (code) {
    case 'selection_empty':
      return 'No Variance_Record was selected, so there is nothing to record one Review_Outcome against.';
    case 'comment_too_short':
      return (
        `A bulk Review_Outcome of apr_disputed or adjustment_requested requires one reviewer ` +
        `comment of at least ${MIN_REVIEWER_COMMENT_LENGTH} characters for the whole set.`
      );
    case 'requested_classification_required':
      return 'A bulk adjustment request must state the requested classification.';
    case 'selection_contains_ineligible_records':
      return (
        `The bulk action was refused in full: ${assessment.ineligibleRows.length} selected ` +
        `Variance_Record(s) cannot take this Review_Outcome, ` +
        `${assessment.outOfScopeRecordCount} are outside your scope and ` +
        `${assessment.missingRecordCount} could not be found. One comment applies to the whole ` +
        `set, so no row was recorded. Deselect the affected rows and submit again.`
      );
  }
}

// ---------------------------------------------------------------------------------------------
// criterion 13.4: the variance exception report. THE INVARIANT LIVES HERE.
// ---------------------------------------------------------------------------------------------

/**
 * criterion 6.10's per-branch, per-Pay_Month Dual_Review_Ceiling as the caller read it from
 * `attendance_threshold_config`. `ceiling: null` means "no row", which applies the default of 100.
 */
export interface DualReviewCeilingConfig {
  readonly branchId: string;
  /** 'YYYY-MM'. */
  readonly payMonth: string;
  /**
   * A ceiling of ZERO is valid and meaningful, not an error: it queues nothing on the criterion 6.9
   * ranked path and leaves only criterion 6.8's Floor_Absence_Pattern days queued. The validity test
   * is therefore "a whole number of at least zero", not "greater than zero".
   */
  readonly ceiling: number | null;
}

interface AppliedCeiling {
  readonly ceiling: number;
  readonly wasConfigured: boolean;
  readonly warning: string | null;
}

/**
 * criterion 6.10. An absent row applies 100 silently. A configured value that is not a whole number
 * of at least zero applies 100 and says so, the same handling `applyThreshold` gives a malformed
 * threshold in attendance-variance.ts. Two rows for one branch and Pay_Month that DISAGREE apply
 * 100 and warn, rather than picking whichever arrived first -- an ordering-dependent ceiling would
 * make the report's own account of the ranking depend on row order.
 */
function resolveDualReviewCeiling(
  branchId: string,
  payMonth: string,
  configs: readonly DualReviewCeilingConfig[],
): AppliedCeiling {
  const matching = configs.filter(
    (config) => config.branchId === branchId && config.payMonth === payMonth,
  );
  const values = [...new Set(matching.map((config) => config.ceiling))];
  if (values.length === 0) return { ceiling: DEFAULT_DUAL_REVIEW_CEILING, wasConfigured: false, warning: null };
  if (values.length > 1) {
    return {
      ceiling: DEFAULT_DUAL_REVIEW_CEILING,
      wasConfigured: false,
      warning:
        `Branch ${branchId} has ${values.length} different Dual_Review_Ceiling values configured ` +
        `for ${payMonth}; applied the default of ${DEFAULT_DUAL_REVIEW_CEILING} (criterion 6.10) ` +
        `rather than an order-dependent one.`,
    };
  }
  const configured = values[0]!;
  if (configured === null) {
    return { ceiling: DEFAULT_DUAL_REVIEW_CEILING, wasConfigured: false, warning: null };
  }
  if (!Number.isInteger(configured) || configured < 0) {
    return {
      ceiling: DEFAULT_DUAL_REVIEW_CEILING,
      wasConfigured: false,
      warning:
        `Configured Dual_Review_Ceiling of ${String(configured)} for branch ${branchId} in ` +
        `${payMonth} is not a whole number of at least zero; applied the default of ` +
        `${DEFAULT_DUAL_REVIEW_CEILING} (criterion 6.10).`,
    };
  }
  return { ceiling: configured, wasConfigured: true, warning: null };
}

/** criterion 13.4's grouping: cost centre, branch, process and designation. */
export interface VarianceExceptionGroupingKey {
  readonly costCentreId: string | null;
  readonly branchId: string;
  readonly processId: string | null;
  readonly designationId: string | null;
}

/**
 * criterion 13.4's counts, and the one place their definitions are fixed.
 *
 *  - `raised` -- every Variance_Record in the grouping. A record exists only because criterion 6.1
 *    or 6.4 raised it, so this is the size of the grouping rather than a filter over it.
 *  - `queuedForDualReview` / `recordedNotQueued` -- an exact partition of `raised` by queue state.
 *    `recordedNotQueued` is computed as `raised - queuedForDualReview`, so criterion 13.4's stated
 *    invariant holds by arithmetic and not by two filters that could disagree.
 *  - `queuedAsFloorAbsencePattern` -- the subset of `queuedForDualReview` that carries criterion
 *    6.8's occurrence and was therefore queued irrespective of the Dual_Review_Ceiling. A subset of
 *    the queued count, never a fifth bucket.
 *  - `reviewed` / `unreviewed` -- an exact partition of `queuedForDualReview` only, by status, and
 *    `reviewed` is again computed by subtraction. A Recorded_Not_Queued record was never presented
 *    to anybody, so no review is outstanding on it; it is counted once, under `recordedNotQueued`.
 *    This is the same definition `buildPreCloseReconciliation` applies in
 *    variance-payroll-cutoff.ts, deliberately, so criterion 9.5's view and criterion 13.4's report
 *    cannot report different numbers for one branch and month.
 *  - `contested` -- status 'contested' across the WHOLE grouping (criterion 7.10). Two reviewers
 *    already recorded outcomes and the record now awaits an Override_Approver, so it sits inside
 *    `reviewed` whenever it is queued; it is counted over the whole grouping so that a real dispute
 *    cannot vanish from the report.
 *  - `adjusted` -- see `hasRequestedAdjustment` for the reading applied and the one rejected.
 */
export interface VarianceExceptionCounts {
  readonly raised: number;
  readonly queuedForDualReview: number;
  readonly recordedNotQueued: number;
  readonly queuedAsFloorAbsencePattern: number;
  readonly reviewed: number;
  readonly unreviewed: number;
  readonly contested: number;
  readonly adjusted: number;
}

export interface VarianceExceptionGroupRow
  extends VarianceExceptionGroupingKey,
    VarianceExceptionCounts {
  /** criteria 6.10, 6.12, 13.4: the ceiling that was applied to this grouping's branch and month. */
  readonly appliedDualReviewCeiling: number;
  /** false when the default of 100 was applied, whether because no row existed or one was invalid. */
  readonly dualReviewCeilingWasConfigured: boolean;
  /** Sorted. The records behind the counts, so a grouping can be drilled into. */
  readonly recordIds: readonly string[];
}

/** The report footer. Same counts, no grouping key, so the invariant is checkable on it too. */
export interface VarianceExceptionOverall extends VarianceExceptionCounts {
  readonly groupingCount: number;
  readonly branchIds: readonly string[];
}

export interface VarianceExceptionReport {
  readonly payMonth: string;
  /**
   * One row per distinct (cost centre, branch, process, designation), sorted by those four with
   * nulls last. A grouping with no records is not emitted: criterion 13.4 aggregates the records
   * that exist and does not enumerate the master-data cross product.
   */
  readonly groupings: readonly VarianceExceptionGroupRow[];
  readonly overall: VarianceExceptionOverall;
  /** Supplied records for another Pay_Month, counted out rather than silently included. */
  readonly outOfScopeRecordCount: number;
  readonly configurationWarnings: readonly string[];
}

export interface VarianceExceptionReportInput {
  /** 'YYYY-MM'. criterion 13.4's stated Pay_Month. */
  readonly payMonth: string;
  readonly records: readonly ReportableVarianceRecord[];
  /** criterion 6.10. Absent applies the default of 100 to every branch. */
  readonly dualReviewCeilings?: readonly DualReviewCeilingConfig[] | null;
}

function groupingKeyOf(record: ReportableVarianceRecord): VarianceExceptionGroupingKey {
  return {
    costCentreId: record.costCentreId,
    branchId: record.branchId,
    processId: record.processId,
    designationId: record.designationId,
  };
}

/** Fixed field order, so two records in one grouping produce one key whatever their literal order. */
function groupingKeyString(key: VarianceExceptionGroupingKey): string {
  return JSON.stringify([key.costCentreId, key.branchId, key.processId, key.designationId]);
}

function compareGroupingKeys(
  a: VarianceExceptionGroupingKey,
  b: VarianceExceptionGroupingKey,
): number {
  const byCostCentre = compareNullableStrings(a.costCentreId, b.costCentreId);
  if (byCostCentre !== 0) return byCostCentre;
  const byBranch = compareStrings(a.branchId, b.branchId);
  if (byBranch !== 0) return byBranch;
  const byProcess = compareNullableStrings(a.processId, b.processId);
  if (byProcess !== 0) return byProcess;
  return compareNullableStrings(a.designationId, b.designationId);
}

/** The eight counts of criterion 13.4 over one set of records. Subtraction, not parallel filters. */
function countGroup(records: readonly ReportableVarianceRecord[]): VarianceExceptionCounts {
  const raised = records.length;
  const queued = records.filter(isQueuedReportable);
  const queuedForDualReview = queued.length;
  const unreviewed = queued.filter((record) => isUnreviewedStatus(record.status)).length;
  return {
    raised,
    queuedForDualReview,
    // The invariant, by construction.
    recordedNotQueued: raised - queuedForDualReview,
    queuedAsFloorAbsencePattern: records.filter(isQueuedFloorAbsence).length,
    // The queued partition, also by construction.
    reviewed: queuedForDualReview - unreviewed,
    unreviewed,
    contested: records.filter((record) => record.status === 'contested').length,
    adjusted: records.filter(hasRequestedAdjustment).length,
  };
}

/**
 * criteria 13.4, 6.12 and 6.13. Aggregates Variance_Records by cost centre, branch, process and
 * designation for a stated Pay_Month.
 *
 * Total: an empty record set returns an empty grouping list and an all-zero footer. Deterministic
 * and ordering-independent: every array is sorted and every count is set-based.
 *
 * @throws only for programmer errors -- a malformed Pay_Month, two different records under one id,
 *   or a Floor_Absence_Pattern occurrence attached to the wrong employee-day.
 */
export function buildVarianceExceptionReport(
  input: VarianceExceptionReportInput,
): VarianceExceptionReport {
  assertPayMonth('payMonth', input.payMonth);
  const ceilings = input.dualReviewCeilings ?? [];
  for (const config of ceilings) assertPayMonth('dualReviewCeilings entry payMonth', config.payMonth);

  const deduped = dedupeRecords(input.records);
  for (const record of deduped) {
    assertPayMonth('record.payMonth', record.payMonth);
    assertFloorAbsenceOccurrenceMatches(record);
  }

  const inScope = deduped.filter((record) => record.payMonth === input.payMonth);

  const buckets = new Map<string, { key: VarianceExceptionGroupingKey; records: ReportableVarianceRecord[] }>();
  for (const record of inScope) {
    const key = groupingKeyOf(record);
    const keyString = groupingKeyString(key);
    const bucket = buckets.get(keyString);
    if (bucket === undefined) buckets.set(keyString, { key, records: [record] });
    else bucket.records.push(record);
  }

  const warnings: string[] = [];
  const groupings = [...buckets.values()]
    .sort((a, b) => compareGroupingKeys(a.key, b.key))
    .map(({ key, records }) => {
      const applied = resolveDualReviewCeiling(key.branchId, input.payMonth, ceilings);
      if (applied.warning !== null && !warnings.includes(applied.warning)) {
        warnings.push(applied.warning);
      }
      return Object.freeze({
        ...key,
        ...countGroup(records),
        appliedDualReviewCeiling: applied.ceiling,
        dualReviewCeilingWasConfigured: applied.wasConfigured,
        recordIds: Object.freeze(records.map((record) => record.id).sort(compareStrings)),
      });
    });

  return Object.freeze({
    payMonth: input.payMonth,
    groupings: Object.freeze(groupings),
    overall: Object.freeze({
      ...countGroup(inScope),
      groupingCount: groupings.length,
      branchIds: Object.freeze(
        [...new Set(inScope.map((record) => record.branchId))].sort(compareStrings),
      ),
    }),
    outOfScopeRecordCount: deduped.length - inScope.length,
    configurationWarnings: Object.freeze(warnings),
  });
}

/** One grouping on which criterion 13.4's invariant failed. Empty in every correct report. */
export interface NoDiscardViolation {
  readonly scope: 'grouping' | 'overall';
  /** null on the footer, which has no grouping key. */
  readonly key: VarianceExceptionGroupingKey | null;
  readonly raised: number;
  readonly queuedForDualReview: number;
  readonly recordedNotQueued: number;
}

export interface NoDiscardInvariantCheck {
  readonly holds: boolean;
  /** Every grouping plus the footer, so "every reported grouping" is literally what was checked. */
  readonly checkedGroupingCount: number;
  readonly violations: readonly NoDiscardViolation[];
}

/**
 * criteria 13.4 and 6.13, made operational rather than documentary: the no-discard invariant
 * CHECKED on every reported grouping and on the footer, instead of assumed. `countGroup` computes
 * `recordedNotQueued` by subtraction, so this cannot fail today -- which is the point of exporting
 * it. If a future edit replaces that subtraction with a second filter, the property test that calls
 * this function fails, and so does any caller that asserts it in production.
 */
export function checkNoDiscardInvariant(report: VarianceExceptionReport): NoDiscardInvariantCheck {
  const violations: NoDiscardViolation[] = [];
  for (const grouping of report.groupings) {
    if (grouping.raised !== grouping.queuedForDualReview + grouping.recordedNotQueued) {
      violations.push(
        Object.freeze({
          scope: 'grouping' as const,
          key: Object.freeze({
            costCentreId: grouping.costCentreId,
            branchId: grouping.branchId,
            processId: grouping.processId,
            designationId: grouping.designationId,
          }),
          raised: grouping.raised,
          queuedForDualReview: grouping.queuedForDualReview,
          recordedNotQueued: grouping.recordedNotQueued,
        }),
      );
    }
  }
  const overall = report.overall;
  if (overall.raised !== overall.queuedForDualReview + overall.recordedNotQueued) {
    violations.push(
      Object.freeze({
        scope: 'overall' as const,
        key: null,
        raised: overall.raised,
        queuedForDualReview: overall.queuedForDualReview,
        recordedNotQueued: overall.recordedNotQueued,
      }),
    );
  }
  return Object.freeze({
    holds: violations.length === 0,
    checkedGroupingCount: report.groupings.length + 1,
    violations: Object.freeze(violations),
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 13.5: the export carries the same rows and columns the screen displays
// ---------------------------------------------------------------------------------------------

/**
 * criterion 13.4's grouping row as the SCREEN displays it: the four grouping dimensions rendered
 * (a null dimension becoming `UNASSIGNED_GROUPING_LABEL`) and the nine figures as numbers.
 *
 * Identifiers, not names. This module resolves no master-data names: two records in one grouping
 * could carry different cached names for one id, and picking one would be an ordering-dependent
 * answer. The route layer joins the display names onto these ids, for the screen and the export
 * alike, so both keep getting the same rows.
 */
export interface VarianceExceptionScreenRow {
  readonly costCentre: string;
  readonly branch: string;
  readonly process: string;
  readonly designation: string;
  readonly raised: number;
  readonly queuedForDualReview: number;
  readonly recordedNotQueued: number;
  readonly queuedAsFloorAbsencePattern: number;
  readonly appliedDualReviewCeiling: number;
  readonly reviewed: number;
  readonly unreviewed: number;
  readonly contested: number;
  readonly adjusted: number;
}

/**
 * criterion 13.5's single source of truth for BOTH the screen's columns and the export's columns.
 * The order here is the column order in both places, and the `satisfies` clause pins every `key` to
 * a real field of `VarianceExceptionScreenRow`.
 */
export const VARIANCE_EXCEPTION_REPORT_COLUMNS = [
  { key: 'costCentre', header: 'Cost centre' },
  { key: 'branch', header: 'Branch' },
  { key: 'process', header: 'Process' },
  { key: 'designation', header: 'Designation' },
  { key: 'raised', header: 'Raised' },
  { key: 'queuedForDualReview', header: 'Queued for dual review' },
  { key: 'recordedNotQueued', header: 'Recorded not queued' },
  { key: 'queuedAsFloorAbsencePattern', header: 'Queued as floor absence pattern' },
  { key: 'appliedDualReviewCeiling', header: 'Applied dual review ceiling' },
  { key: 'reviewed', header: 'Reviewed' },
  { key: 'unreviewed', header: 'Unreviewed' },
  { key: 'contested', header: 'Contested' },
  { key: 'adjusted', header: 'Adjusted' },
] as const satisfies readonly {
  readonly key: keyof VarianceExceptionScreenRow;
  readonly header: string;
}[];

export type VarianceExceptionReportColumnKey =
  (typeof VARIANCE_EXCEPTION_REPORT_COLUMNS)[number]['key'];

// criterion 13.5, made structural. The first assertion fails if a field is added to the screen row
// and not to the column list -- which would ship an export missing a column the screen shows. The
// second fails if a column names a field the screen row does not have. Together they make
// "the export carries the same columns the screen displays" a compile error to break, and the
// property test then checks the same fact at run time over generated reports.
type _ColumnsCoverEveryScreenField = Assert<
  [Exclude<keyof VarianceExceptionScreenRow, VarianceExceptionReportColumnKey>] extends [never]
    ? true
    : false
>;
type _ScreenRowHasEveryColumn = Assert<
  [Exclude<VarianceExceptionReportColumnKey, keyof VarianceExceptionScreenRow>] extends [never]
    ? true
    : false
>;

/** A null grouping dimension displays as `UNASSIGNED_GROUPING_LABEL`; the key itself stays null. */
function displayDimension(value: string | null): string {
  return value === null ? UNASSIGNED_GROUPING_LABEL : value;
}

/**
 * criteria 13.4 and 13.5. The rows the screen displays, one per reported grouping, in report order.
 *
 * The footer (`report.overall`) is deliberately NOT a row: criterion 13.5 says the export carries
 * the same ROWS the screen displays, and a total is a footer over the rows rather than one of them.
 * Emitting it as a fourteenth row with an invented grouping key would put a value in the cost-centre
 * column that no cost centre holds, and would double every figure for anyone who summed the export.
 */
export function buildVarianceExceptionScreenRows(
  report: VarianceExceptionReport,
): readonly VarianceExceptionScreenRow[] {
  return Object.freeze(
    report.groupings.map((grouping) =>
      Object.freeze({
        costCentre: displayDimension(grouping.costCentreId),
        branch: grouping.branchId,
        process: displayDimension(grouping.processId),
        designation: displayDimension(grouping.designationId),
        raised: grouping.raised,
        queuedForDualReview: grouping.queuedForDualReview,
        recordedNotQueued: grouping.recordedNotQueued,
        queuedAsFloorAbsencePattern: grouping.queuedAsFloorAbsencePattern,
        appliedDualReviewCeiling: grouping.appliedDualReviewCeiling,
        reviewed: grouping.reviewed,
        unreviewed: grouping.unreviewed,
        contested: grouping.contested,
        adjusted: grouping.adjusted,
      }),
    ),
  );
}

/**
 * criterion 13.5's export as a plain row/column structure. NOT a spreadsheet: the bytes are the
 * route layer's (design.md section 11 routes this inline export through the CSV pattern of
 * attendance-exceptions.routes.ts), and a pure module cannot and should not produce a file.
 */
export interface VarianceExceptionExport {
  readonly payMonth: string;
  readonly headers: readonly string[];
  /** The same keys, in the same order, so a caller can re-associate a cell with its screen field. */
  readonly columnKeys: readonly VarianceExceptionReportColumnKey[];
  readonly rows: readonly (readonly (string | number)[])[];
  readonly rowCount: number;
}

/**
 * criterion 13.5. Every cell is read out of the screen row THROUGH
 * `VARIANCE_EXCEPTION_REPORT_COLUMNS`, so an export cell cannot come from anywhere the screen does
 * not also read, and the column count and order are the same object in both places rather than two
 * lists that agree today.
 */
export function buildVarianceExceptionExport(
  report: VarianceExceptionReport,
): VarianceExceptionExport {
  const screenRows = buildVarianceExceptionScreenRows(report);
  return Object.freeze({
    payMonth: report.payMonth,
    headers: Object.freeze(VARIANCE_EXCEPTION_REPORT_COLUMNS.map((column) => column.header)),
    columnKeys: Object.freeze(VARIANCE_EXCEPTION_REPORT_COLUMNS.map((column) => column.key)),
    rows: Object.freeze(
      screenRows.map((row) =>
        Object.freeze(VARIANCE_EXCEPTION_REPORT_COLUMNS.map((column) => row[column.key])),
      ),
    ),
    rowCount: screenRows.length,
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 13.6: the pre-close reconciliation listing
// ---------------------------------------------------------------------------------------------

/** One unreviewed date on one employee's line, with the resolved Attendance_Source for that date. */
export interface PreCloseUnreviewedDate {
  readonly workDate: string;
  readonly recordId: string;
  readonly branchId: string;
  /** criterion 13.6's resolved Attendance_Source, read off the variance evaluation for the date. */
  readonly resolvedAttendanceSource: ResolvedAttendanceSource;
  /** criterion 9.3. */
  readonly carriedForwardFromPayMonth: string | null;
}

export interface PreCloseUnreviewedEmployeeRow {
  readonly employeeId: string;
  /** Sorted. Normally one branch; more than one means the employee moved inside the month. */
  readonly branchIds: readonly string[];
  /**
   * criterion 9.2's salary line. null when the caller supplied none, or when two records for the
   * employee disagree about it -- reporting an order-dependent line id would be worse than
   * reporting none, and the payroll writer already knows the line.
   */
  readonly salaryLineId: string | null;
  /** Literal true: this row exists only because the line carries an unreviewed variance. */
  readonly paidWithUnreviewedVariance: true;
  /** criterion 13.6's count of unreviewed dates. Distinct dates, so two records on one date count once. */
  readonly unreviewedDateCount: number;
  /** Sorted 'YYYY-MM-DD'. */
  readonly unreviewedDates: readonly string[];
  /**
   * criterion 13.6's resolved Attendance_Source. Non-null when every unreviewed date on the line
   * resolved to the same source, which is the ordinary case; null when they differ, in which case
   * `resolvedAttendanceSources` and the per-date rows carry the detail. A single value would have to
   * pick one, and the criterion asks for the resolved source of the variance, not of the employee.
   */
  readonly resolvedAttendanceSource: ResolvedAttendanceSource | null;
  /** Sorted distinct sources across the line's unreviewed dates. Never empty. */
  readonly resolvedAttendanceSources: readonly ResolvedAttendanceSource[];
  readonly unreviewedRecordIds: readonly string[];
  /** Sorted by date then record id. */
  readonly dates: readonly PreCloseUnreviewedDate[];
}

export interface PreCloseUnreviewedListing {
  readonly payMonth: string;
  /** Sorted by employee id. */
  readonly rows: readonly PreCloseUnreviewedEmployeeRow[];
  readonly employeeCount: number;
  /** Total distinct unreviewed employee-dates across the listing. */
  readonly unreviewedDateCount: number;
  /** Supplied records for another Pay_Month, or outside the requested branches. */
  readonly outOfScopeRecordCount: number;
}

export interface PreCloseUnreviewedListingInput {
  /** 'YYYY-MM'. criterion 13.6's stated Pay_Month. */
  readonly payMonth: string;
  readonly records: readonly ReportableVarianceRecord[];
  /** Optional narrowing. Absent, null or empty means every branch in the supplied set. */
  readonly branchIds?: readonly string[] | null;
}

/**
 * criterion 13.6. Lists, for a stated Pay_Month, each employee whose salary line carries an
 * unreviewed variance, with the count of unreviewed dates and the resolved Attendance_Source.
 *
 * UNREVIEWED means the same thing here as in criteria 9.2 and 9.5: a record that is presented for
 * Dual_Review and whose status is 'open' or 'notified'. A Recorded_Not_Queued record was never shown
 * to anybody, so listing it here would report a review nobody was asked for -- 14,891 of 42,181 July
 * 2026 mismatch rows, on the figures in criterion 9.7.
 *
 * Total: an empty record set returns an empty listing. Deterministic and ordering-independent.
 *
 * @throws only for programmer errors -- a malformed Pay_Month, two different records under one id,
 *   or a mismatched Floor_Absence_Pattern occurrence.
 */
export function buildPreCloseUnreviewedListing(
  input: PreCloseUnreviewedListingInput,
): PreCloseUnreviewedListing {
  assertPayMonth('payMonth', input.payMonth);
  const deduped = dedupeRecords(input.records);
  for (const record of deduped) {
    assertPayMonth('record.payMonth', record.payMonth);
    assertFloorAbsenceOccurrenceMatches(record);
  }

  const branchFilter = input.branchIds ?? null;
  const inScope = deduped.filter(
    (record) =>
      record.payMonth === input.payMonth &&
      (!isConstrained(branchFilter) || branchFilter.includes(record.branchId)),
  );
  const unreviewed = inScope.filter(
    (record) => isQueuedReportable(record) && isUnreviewedStatus(record.status),
  );

  const byEmployee = new Map<string, ReportableVarianceRecord[]>();
  for (const record of unreviewed) {
    const bucket = byEmployee.get(record.employeeId);
    if (bucket === undefined) byEmployee.set(record.employeeId, [record]);
    else bucket.push(record);
  }

  const rows = [...byEmployee.entries()]
    .map(([employeeId, records]) => {
      const dates = [...new Set(records.map((record) => record.workDate))].sort(compareStrings);
      const lineIds = [...new Set(records.map((record) => record.salaryLineId ?? null))];
      const sources = [
        ...new Set(records.map((record) => record.evidence.evaluation.resolvedAttendanceSource)),
      ].sort(compareStrings);
      return Object.freeze({
        employeeId,
        branchIds: Object.freeze(
          [...new Set(records.map((record) => record.branchId))].sort(compareStrings),
        ),
        salaryLineId: lineIds.length === 1 ? lineIds[0]! : null,
        paidWithUnreviewedVariance: true as const,
        unreviewedDateCount: dates.length,
        unreviewedDates: Object.freeze(dates),
        resolvedAttendanceSource: sources.length === 1 ? sources[0]! : null,
        resolvedAttendanceSources: Object.freeze(sources),
        unreviewedRecordIds: Object.freeze(records.map((record) => record.id).sort(compareStrings)),
        dates: Object.freeze(
          [...records]
            .sort(compareRecords)
            .map((record) =>
              Object.freeze({
                workDate: record.workDate,
                recordId: record.id,
                branchId: record.branchId,
                resolvedAttendanceSource: record.evidence.evaluation.resolvedAttendanceSource,
                carriedForwardFromPayMonth: record.carriedForwardFromPayMonth,
              }),
            ),
        ),
      });
    })
    .sort((a, b) => compareStrings(a.employeeId, b.employeeId));

  return Object.freeze({
    payMonth: input.payMonth,
    rows: Object.freeze(rows),
    employeeCount: rows.length,
    unreviewedDateCount: rows.reduce((total, row) => total + row.unreviewedDateCount, 0),
    outOfScopeRecordCount: deduped.length - inScope.length,
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 13.7: a contested record's conflicting outcomes and comments, together
// ---------------------------------------------------------------------------------------------

/** One reviewer's outcome as criterion 13.7 displays it, comment included. */
export interface ContestedOutcomeView {
  readonly role: ReviewerRole;
  readonly userId: string;
  readonly outcome: ReviewOutcome;
  readonly recordedAt: string;
  /** criterion 7.4's comment, as stored. The half of 13.7 that is easiest to drop and must not be. */
  readonly comment: string;
  /** criterion 8.2. Non-null only on an `adjustment_requested` outcome. */
  readonly requestedClassification: DayClassification | null;
  readonly requestedLwpValue: number | null;
  /** criterion 7.6: this slot was filled by the branch workforce-management point of contact. */
  readonly substituted: boolean;
}

export type ContestedRecordDisplay =
  | {
      readonly displayed: true;
      readonly recordId: string;
      readonly status: VarianceRecordStatus;
      /**
       * criterion 7.10's assessment, from `assessOutcomeConflict` in variance-review.ts. Not
       * re-derived here: one reading of "conflicting" for the recorder and the screen, or the screen
       * shows a dispute the recorder did not create.
       */
      readonly conflict: ConflictAssessment;
      /**
       * False when the record is marked contested but the two stored outcomes assess as agreeing --
       * a data inconsistency (an outcome edited underneath the status, or a legacy row migrated
       * under criterion 7.12). The outcomes are still displayed, because hiding them would leave an
       * Override_Approver with a contested record and nothing to read.
       */
      readonly assessmentAgreesWithContestedStatus: boolean;
      /**
       * Exactly two, as a tuple. Criterion 13.7 asks for the conflicting outcomes and their comments
       * TOGETHER, and a tuple makes a one-element display unrepresentable rather than merely
       * unlikely.
       */
      readonly outcomes: readonly [ContestedOutcomeView, ContestedOutcomeView];
      /** criterion 7.10's Override_Approvers for the employee's branch. */
      readonly overrideApproverUserIds: readonly string[];
      /** True when the branch has no Override_Approver configured, which the screen must surface. */
      readonly unroutable: boolean;
    }
  | {
      readonly displayed: false;
      readonly recordId: string;
      readonly status: VarianceRecordStatus;
      readonly reason: 'not_marked_contested' | 'second_outcome_not_recorded';
      /** Whatever is recorded so far, so a partially reviewed record is still readable. */
      readonly outcomes: readonly ContestedOutcomeView[];
    };

function contestedOutcomeView(role: ReviewerRole, review: RecordedReview): ContestedOutcomeView {
  return Object.freeze({
    role,
    userId: review.userId,
    outcome: review.outcome,
    recordedAt: review.recordedAt,
    comment: review.comment,
    // criterion 8.1 made visible: only the `adjustment_requested` arm HAS these members, so the
    // narrowing below is the type system stating that an accepted or disputed outcome cannot carry
    // a requested classification.
    requestedClassification:
      review.outcome === 'adjustment_requested' ? review.requestedClassification : null,
    requestedLwpValue:
      review.outcome === 'adjustment_requested' ? (review.requestedLwpValue ?? null) : null,
    substituted: review.substitution !== null,
  });
}

/**
 * criterion 13.7. For a record marked contested, returns the conflicting Review_Outcomes and their
 * reviewer comments together, with the Override_Approvers criterion 7.10 routes it to.
 *
 * Total: every record returns a defined display; nothing throws.
 */
export function describeContestedRecord(
  record: ReportableVarianceRecord,
): ContestedRecordDisplay {
  const views: ContestedOutcomeView[] = [];
  if (record.wfmReview !== null) views.push(contestedOutcomeView('wfm_reviewer', record.wfmReview));
  if (record.managerReview !== null) {
    views.push(contestedOutcomeView('reporting_manager', record.managerReview));
  }
  const frozenViews = Object.freeze([...views]);

  // criterion 13.7 is scoped to "WHEN a Variance_Record is marked contested". A record that is not
  // is not a conflict display, and saying so is more useful than inventing one.
  if (record.status !== 'contested') {
    return Object.freeze({
      displayed: false as const,
      recordId: record.id,
      status: record.status,
      reason: 'not_marked_contested' as const,
      outcomes: frozenViews,
    });
  }
  if (record.wfmReview === null || record.managerReview === null) {
    return Object.freeze({
      displayed: false as const,
      recordId: record.id,
      status: record.status,
      reason: 'second_outcome_not_recorded' as const,
      outcomes: frozenViews,
    });
  }

  // criterion 7.10's own reading, reused. Called with (wfm, manager) but the function normalizes the
  // ordered pair internally, so the verdict does not depend on who recorded first.
  const conflict = assessOutcomeConflict(record.wfmReview, record.managerReview);
  return Object.freeze({
    displayed: true as const,
    recordId: record.id,
    status: record.status,
    conflict,
    assessmentAgreesWithContestedStatus: conflict.conflicting,
    outcomes: Object.freeze([
      contestedOutcomeView('wfm_reviewer', record.wfmReview),
      contestedOutcomeView('reporting_manager', record.managerReview),
    ]) as readonly [ContestedOutcomeView, ContestedOutcomeView],
    overrideApproverUserIds: Object.freeze([...record.overrideApproverUserIds]),
    unroutable: record.overrideApproverUserIds.length === 0,
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 13.8: outstanding count, and WHOLE days remaining until Payroll_Cut_Off
// ---------------------------------------------------------------------------------------------

/**
 * criterion 13.8's day count, and the ONLY producer of it. See guarantee 3 in the file header.
 *
 * TIMEZONE AND DATE-ONLY HANDLING, STATED BECAUSE THE CRITERION DOES NOT. `wholeDaysBetween` from
 * variance-review.ts reads only the leading 'YYYY-MM-DD' of each argument -- so an ISO timestamp and
 * a bare date behave identically -- and differences the two calendar day numbers built with
 * `Date.UTC`. Two consequences, both wanted:
 *
 *  - The TIME OF DAY never enters the arithmetic. A reviewer opening the screen at 23:00 sees the
 *    same "3 days remaining" as one opening it at 01:00 on the same date. Flooring elapsed
 *    milliseconds instead would make the number depend on the hour.
 *  - The HOST TIMEZONE never enters it either. `Date.UTC` has no daylight saving, so the difference
 *    is exact, and no instant is constructed through the local zone -- which on any host west of UTC
 *    would shift the date itself and could report one day fewer than the true remainder.
 *
 * The count is therefore whole by construction (both operands are whole calendar days, so no
 * rounding or flooring is needed at all) and is clamped at zero: on the cut-off date itself the
 * answer is 0, and past it the answer is 0 rather than a negative number. `pastPayrollCutOff` on the
 * result carries the fact the clamp discards, so no caller has to infer it from a negative value
 * that never appears.
 */
function clampWholeDaysRemaining(referenceDate: string, payrollCutOffDate: string): number {
  return Math.max(0, wholeDaysBetween(referenceDate, payrollCutOffDate));
}

export interface QueueClearanceOutlookInput {
  /** 'YYYY-MM'. criterion 13.8's stated Pay_Month. */
  readonly payMonth: string;
  /** criterion 13.8's stated branch. */
  readonly branchId: string;
  readonly records: readonly ReportableVarianceRecord[];
  /**
   * The Payroll_Cut_Off date for the Pay_Month, 'YYYY-MM-DD' or an ISO timestamp beginning with
   * one. null when no cut-off is scheduled yet -- which is ordinary data on a month whose
   * `salary_prep_run` has not been created, and returns a null day count rather than a guess.
   */
  readonly payrollCutOffDate: string | null;
  /** The clock, as an argument. 'YYYY-MM-DD' or an ISO timestamp. */
  readonly referenceDate: string;
}

export interface QueueClearanceOutlook {
  readonly payMonth: string;
  readonly branchId: string;
  /**
   * criterion 13.8's outstanding count: Variance_Records presented for Dual_Review whose review is
   * not complete. The same "unreviewed queued" set criteria 9.2, 9.5 and 13.6 count, so a reviewer
   * comparing the queue screen with the pre-close view never sees two different numbers.
   */
  readonly outstandingVarianceRecordCount: number;
  readonly outstandingRecordIds: readonly string[];
  readonly outstandingEmployeeIds: readonly string[];
  /** criterion 9.3: how many of the outstanding records arrived from an earlier Pay_Month. */
  readonly outstandingCarriedForwardCount: number;
  readonly payrollCutOffDate: string | null;
  readonly referenceDate: string;
  /**
   * criterion 13.8's count of WHOLE days remaining. Never negative; 0 on the cut-off date and 0
   * past it. null only when no Payroll_Cut_Off date was supplied.
   */
  readonly wholeDaysRemainingUntilPayrollCutOff: number | null;
  /** True when the reference date is strictly after the Payroll_Cut_Off date. */
  readonly pastPayrollCutOff: boolean;
  /** Supplied records for another branch or another Pay_Month. */
  readonly outOfScopeRecordCount: number;
}

/**
 * criterion 13.8. States, for a stated Pay_Month and branch, the count of outstanding
 * Variance_Records and the count of whole days remaining until Payroll_Cut_Off.
 *
 * Total: an empty record set, an absent cut-off date and a cut-off date already in the past all
 * return defined results. Deterministic and ordering-independent.
 *
 * @throws only for programmer errors -- a malformed Pay_Month, a malformed reference or cut-off date
 *   (see `wholeDaysBetween`), two different records under one id, or a mismatched
 *   Floor_Absence_Pattern occurrence.
 */
export function buildQueueClearanceOutlook(
  input: QueueClearanceOutlookInput,
): QueueClearanceOutlook {
  assertPayMonth('payMonth', input.payMonth);
  const deduped = dedupeRecords(input.records);
  for (const record of deduped) {
    assertPayMonth('record.payMonth', record.payMonth);
    assertFloorAbsenceOccurrenceMatches(record);
  }

  const inScope = deduped.filter(
    (record) => record.branchId === input.branchId && record.payMonth === input.payMonth,
  );
  const outstanding = inScope
    .filter((record) => isQueuedReportable(record) && isUnreviewedStatus(record.status))
    .sort(compareRecords);

  const cutOff = input.payrollCutOffDate;
  // Both branches read the same calendar-day arithmetic, so "past the cut-off" and "zero days
  // remaining" cannot disagree.
  const daysRemaining = cutOff === null ? null : clampWholeDaysRemaining(input.referenceDate, cutOff);
  const pastPayrollCutOff =
    cutOff === null ? false : wholeDaysBetween(input.referenceDate, cutOff) < 0;

  return Object.freeze({
    payMonth: input.payMonth,
    branchId: input.branchId,
    outstandingVarianceRecordCount: outstanding.length,
    outstandingRecordIds: Object.freeze(
      outstanding.map((record) => record.id).sort(compareStrings),
    ),
    outstandingEmployeeIds: Object.freeze(
      [...new Set(outstanding.map((record) => record.employeeId))].sort(compareStrings),
    ),
    outstandingCarriedForwardCount: outstanding.filter(
      (record) => record.carriedForwardFromPayMonth !== null,
    ).length,
    payrollCutOffDate: cutOff,
    referenceDate: input.referenceDate,
    wholeDaysRemainingUntilPayrollCutOff: daysRemaining,
    pastPayrollCutOff,
    outOfScopeRecordCount: deduped.length - inScope.length,
  });
}
