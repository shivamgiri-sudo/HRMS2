//
// Requirement 7 (Dual Review By WFM And Reporting Manager) and Requirement 8 (Review Outcomes And
// Adjustment Authority) of requirements.md, implemented as PURE functions over one Variance_Record
// that has already been raised by attendance-variance.ts and already been given a queue state by
// the Requirement 6 queueing pass.
//
// Same shape as attendance-source-rule-resolver.ts, canonical-productivity.ts,
// attendance-variance.ts and attendance-rule-migration-proposal.ts: no database import, no
// `db.execute`, no `new Date()`, no `randomUUID()`. Everything arrives as an argument INCLUDING
// the clock -- criterion 7.8 measures an SLA in whole days, so the reference date is a parameter
// (see `evaluateEscalation`) and the recording timestamp of criterion 7.3 is a parameter too.
// Nothing here writes anywhere; every function returns a plain value describing what the caller
// should persist, notify or refuse.
//
// TOTALITY. No function here throws for ordinary data: a rejected review and a refused approval
// are RETURNED as typed values, because criterion 8.4 requires the refused attempt to be
// RECORDED, and an exception is the one shape that loses it. Throws are reserved for programmer
// errors -- a malformed date string, or a Payroll_Cut_Off state handed in for a different
// Pay_Month than the request targets -- where continuing would silently compute the wrong SLA or
// authorise against the wrong month. Those throw `RangeError` / `Error` and are marked
// "programmer error" at the throw site.
//
// FOUR STRUCTURAL GUARANTEES, enforced by the compiler rather than by comment:
//
//  1. Criterion 7.7, self-review. `recordReviewOutcome` does not take a user id. It takes a
//     `ReviewAuthority`, an opaque branded value whose brand symbol is module-private, so no
//     caller can construct one with an object literal or a cast from a plain shape. The only
//     producer is `authorizeReviewer`, which refuses when the acting user is the employee named
//     on the Variance_Record. The check is therefore not a line a future caller can forget to
//     call: there is no way to reach the recorder without passing through it. `recordReviewOutcome`
//     then re-checks the identity and the record id anyway (defence in depth against a
//     deliberate `as unknown as` cast).
//
//  2. Criterion 7.1, a Recorded_Not_Queued record is never presented for Dual_Review.
//     `VarianceRecord` is a discriminated union on `queueState`, and both review entry points --
//     `recordReviewOutcome` and `evaluateEscalation` -- accept only the
//     `QueuedVarianceRecord` arm. A caller holding a `VarianceRecord` cannot call either without
//     narrowing first. `describeForReport` accepts the whole union, so the record stays
//     retrievable and reportable, which is the other half of 7.1.
//
//  3. Criterion 8.1, `apr_accepted` and `apr_disputed` leave classification, LWP and Payable_Days
//     unchanged. `ReviewSubmission` and `RecordedReview` are discriminated unions whose
//     `apr_accepted` and `apr_disputed` arms have NO `requestedClassification` and NO
//     `requestedLwpValue` member at all -- there is no field on those arms through which a
//     classification could travel. `buildAdjustmentRequest` takes the `adjustment_requested` arm
//     specifically, so an accepted or disputed review cannot even be handed to the function that
//     creates a pay-moving request. `recordReviewOutcome` returns the record's own
//     `dailyOutcome` BY REFERENCE for those two outcomes, so the property test can assert
//     identity, not just equality.
//
//  4. Criterion 8.7, reversibility. `ApprovedAdjustment.superseded` is read from the
//     `dailyOutcomeBeforeAdjustment` argument of `approveAdjustmentRequest` -- the state as it
//     stands immediately before application -- never from the request's own idea of what the day
//     was. `verifyReversibility` and `revertApprovedAdjustment` let a caller (and the property
//     test) check the equality rather than trust it.
//
// DELIBERATELY NOT MODELLED HERE, because a pure function cannot do it. These are returned as
// intent for the caller to carry out, or left to the phases that own them:
//   - 7.8's notification DELIVERY. `evaluateEscalation` returns who should be notified and why;
//     sending is the worker's.
//   - 7.11 and 7.12, the `payroll_attendance_conflict_review` extension and the migration of its
//     268 rows. Schema and data movement, owned by the migration phase.
//   - 8.3's APPLICATION of the approved classification to `attendance_daily_record`, and the
//     arrear entry of 9.4. `approveAdjustmentRequest` returns the approved values and the
//     superseded snapshot; the write is the attendance engine's.
//   - 8.3's Payable_Days recomputation. `applyApprovedAdjustment` returns `payableDays: null`
//     because only payrollCalculate.service can re-derive it; the superseded snapshot keeps the
//     old figure so a revert is still exact.
//   - 14.5, rule-author-cannot-approve. It needs `attendance_source_rule_audit`, which is a
//     query. `approveAdjustmentRequest` accepts `approverAuthoredDecidingRule` as an argument so
//     the caller that CAN run that query can feed the answer in.
//   - 6.8 through 6.14, the queueing pass and the Dual_Review_Ceiling. This module consumes the
//     `queueState` those produce.
//

import type { DayClassification, VarianceEvaluation } from './attendance-variance.js';

// ---------------------------------------------------------------------------------------------
// Fixed vocabulary (criterion 7.11)
// ---------------------------------------------------------------------------------------------

/** criterion 7.11's new Review_Outcome vocabulary. */
export type ReviewOutcome = 'apr_accepted' | 'apr_disputed' | 'adjustment_requested';

/** criteria 6.9, 6.11, 7.1, 7.11. */
export type QueueState = 'queued_for_dual_review' | 'recorded_not_queued';

/** The two reviewer slots of criterion 7.5. */
export type ReviewerRole = 'wfm_reviewer' | 'reporting_manager';

/**
 * The existing `payroll_attendance_conflict_review.status` enum plus criterion 7.10's contested
 * state. `no_issue` and `regularization_required` are the legacy values (268 rows) and are kept
 * because criterion 7.11 extends that structure rather than replacing it.
 */
export type VarianceRecordStatus =
  | 'open'
  | 'notified'
  | 'reviewed'
  | 'contested'
  | 'no_issue'
  | 'regularization_required';

/**
 * Statuses that close a Variance_Record to further recording. A `contested` record is closed to
 * reviewers too: criterion 7.10 hands it to the Override_Approver, and letting a reviewer
 * overwrite their outcome afterwards would let one of the two disputing parties clear the
 * dispute they are party to.
 */
const CLOSED_STATUSES: readonly VarianceRecordStatus[] = Object.freeze([
  'reviewed',
  'contested',
  'no_issue',
  'regularization_required',
]);

/** criterion 7.9: three whole days when the escalation age is not configured. */
export const DEFAULT_ESCALATION_AGE_DAYS = 3;

// criterion 7.8 names a "configured escalation interval" but criterion 7.9 supplies a default only
// for the AGE. Rather than invent a second cadence, an unconfigured interval reuses the applied
// escalation age and says so in `configurationWarnings`, so an administrator can see that the
// value was inferred rather than chosen. See applyDayCount / evaluateEscalation.

/** criterion 7.4. See `normalizeReviewerComment` for exactly what is counted. */
export const MIN_REVIEWER_COMMENT_LENGTH = 20;

/** criterion 7.4: the two outcomes that require a comment. */
const OUTCOMES_REQUIRING_COMMENT: readonly ReviewOutcome[] = Object.freeze([
  'apr_disputed',
  'adjustment_requested',
]);

// ---------------------------------------------------------------------------------------------
// The record and its evidence
// ---------------------------------------------------------------------------------------------

/** criterion 7.2's per-Dialler_Source contribution row, as the reviewer sees it. */
export interface DiallerSourceContribution {
  readonly diallerSourceId: string;
  readonly diallerSourceName: string | null;
  /** null when the source held no record for the date -- never 0 standing in for absence. */
  readonly minutes: number | null;
}

/** criterion 7.2's biometric punch times, as strings exactly as the feed recorded them. */
export interface BiometricPunch {
  readonly punchAt: string;
  readonly direction: 'in' | 'out' | 'unknown';
}

/**
 * criterion 7.2. The evidence the queue must present. `evaluation` is attendance-variance.ts's
 * own `VarianceEvaluation`, reused rather than redefined, so the Biometric_Minutes, the
 * Canonical_Productive_Minutes, the applied APR_Corroboration_Threshold and the resolved
 * Attendance_Source presented to the reviewer are literally the figures the variance decision was
 * taken on. The two members criterion 7.2 names that a per-employee-day variance decision does
 * not compute -- the per-Dialler_Source breakdown and the punch times -- are carried alongside.
 */
export interface ReviewEvidence {
  readonly evaluation: VarianceEvaluation;
  readonly diallerSourceContributions: readonly DiallerSourceContribution[];
  readonly biometricPunches: readonly BiometricPunch[];
}

/**
 * What resolution and daily processing produced for the date BEFORE any adjustment (criteria 8.1,
 * 8.7). `payableDays` is the payroll figure for the date; null when the caller has not derived it
 * yet.
 */
export interface DailyOutcome {
  readonly classification: DayClassification;
  readonly lwpValue: number | null;
  readonly payableDays: number | null;
}

/** criterion 7.3: one reviewer's recorded opinion, stored independently of the other's. */
export type RecordedReview =
  // criterion 8.1: no classification and no lwp member exists on this arm.
  | {
      readonly outcome: 'apr_accepted';
      readonly role: ReviewerRole;
      readonly userId: string;
      readonly recordedAt: string;
      readonly comment: string;
      readonly substitution: ManagerSubstitution | null;
    }
  // criterion 8.1: likewise.
  | {
      readonly outcome: 'apr_disputed';
      readonly role: ReviewerRole;
      readonly userId: string;
      readonly recordedAt: string;
      readonly comment: string;
      readonly substitution: ManagerSubstitution | null;
    }
  // criterion 8.2: the ONLY arm that carries a requested classification.
  | {
      readonly outcome: 'adjustment_requested';
      readonly role: ReviewerRole;
      readonly userId: string;
      readonly recordedAt: string;
      readonly comment: string;
      readonly substitution: ManagerSubstitution | null;
      readonly requestedClassification: DayClassification;
      readonly requestedLwpValue: number | null;
    };

/**
 * criterion 7.6. The employee has no Reporting_Manager, so the branch workforce-management point
 * of contact fills the second slot, and the substitution is recorded on the Variance_Record --
 * which is why this value travels on `RecordedReview.substitution` rather than being computed and
 * discarded. 1 of 1,123 active employees.
 */
export interface ManagerSubstitution {
  readonly kind: 'branch_wfm_point_of_contact';
  readonly substituteUserId: string;
  readonly reason: 'employee_has_no_reporting_manager';
}

interface VarianceRecordBase {
  readonly id: string;
  readonly employeeId: string;
  /** The employee's own login, when they have one. Half of the criterion 7.7 identity test. */
  readonly employeeUserId: string | null;
  readonly branchId: string;
  /** 'YYYY-MM-DD'. */
  readonly workDate: string;
  /** 'YYYY-MM', matching `salary_prep_run.run_month`. */
  readonly payMonth: string;
  readonly status: VarianceRecordStatus;
  readonly evidence: ReviewEvidence;
  /** criteria 8.1, 8.7: the day as resolution and daily processing left it. */
  readonly dailyOutcome: DailyOutcome;
  /** criterion 7.1: the WFM_Reviewers whose scope contains the employee. */
  readonly authorizedWfmReviewerUserIds: readonly string[];
  /** criterion 7.6: null is the substitution trigger, not an error. */
  readonly reportingManagerUserId: string | null;
  readonly branchWfmContactUserId: string | null;
  /** criterion 7.10: the Override_Approvers for the employee's branch. */
  readonly overrideApproverUserIds: readonly string[];
  readonly wfmReview: RecordedReview | null;
  readonly managerReview: RecordedReview | null;
  /** criterion 7.8. 'YYYY-MM-DD' or an ISO timestamp; only the calendar date is read. */
  readonly presentedAt: string | null;
  readonly lastEscalatedAt: string | null;
  /** criterion 7.9: null means unconfigured and applies DEFAULT_ESCALATION_AGE_DAYS. */
  readonly escalationAgeDays: number | null;
  readonly escalationIntervalDays: number | null;
}

/** criteria 6.8, 6.9: presented for Dual_Review. */
export type QueuedVarianceRecord = VarianceRecordBase & {
  readonly queueState: 'queued_for_dual_review';
};

/**
 * criteria 6.11, 7.1: raised and retained, retrievable and reportable, NEVER presented for
 * Dual_Review. Structurally distinct from `QueuedVarianceRecord` so the type system enforces
 * that rather than a comment asking a caller to remember it.
 */
export type RecordedNotQueuedVarianceRecord = VarianceRecordBase & {
  readonly queueState: 'recorded_not_queued';
};

export type VarianceRecord = QueuedVarianceRecord | RecordedNotQueuedVarianceRecord;

/** Narrowing helper, so a caller does not compare the string literal by hand. */
export function isQueuedForDualReview(record: VarianceRecord): record is QueuedVarianceRecord {
  return record.queueState === 'queued_for_dual_review';
}

// ---------------------------------------------------------------------------------------------
// criterion 7.4: how a reviewer comment is measured
// ---------------------------------------------------------------------------------------------

// Zero-width and word-joiner characters. Not matched by \s, and invisible to a reviewer, so a
// comment padded with them would look like two characters and count as twenty. Removed outright
// before anything is counted. Written as escapes; no literal irregular whitespace appears in this
// file (eslint no-irregular-whitespace). Written as an alternation rather than a character class
// because a class containing the zero-width joiner is what eslint's
// no-misleading-character-class flags -- the joiner can form a single grapheme with its
// neighbours, and this deletes it either way.
const INVISIBLE_CHARACTERS = /\u200B|\u200C|\u200D|\u2060|\uFEFF/gu;

// \s in JavaScript already covers the tab, the newline, the no-break space \u00A0 and \uFEFF, so
// one class handles every padding character a paste can carry.
const WHITESPACE_RUN = /\s+/gu;

export interface NormalizedComment {
  /** Trimmed, invisible characters dropped, every internal whitespace run collapsed to one space. */
  readonly normalized: string;
  /** Unicode code points of `normalized`, so an emoji or any astral character counts as one. */
  readonly length: number;
}

/**
 * criterion 7.4. HOW THE 20 CHARACTERS ARE COUNTED, stated because the criterion does not say:
 *
 *  1. Invisible characters (zero width space, zero width joiner, word joiner, BOM) are deleted.
 *  2. The comment is trimmed.
 *  3. Every internal run of whitespace collapses to a single space.
 *  4. The length is the number of Unicode CODE POINTS of the result, not UTF-16 units, so one
 *     astral character is one character rather than two.
 *
 * A comment of twenty spaces, tabs, newlines or no-break spaces therefore normalizes to the empty
 * string and has length 0 -- rejected. Padding by repeating whitespace is defeated by step 3.
 *
 * What this deliberately does NOT do is require twenty NON-whitespace characters. Criterion 7.4
 * says "at least 20 characters", and a space in a sentence is a character; refusing a genuine
 * twenty-character sentence such as "Punches look correct" would be a stricter rule than the
 * requirement states, and inventing policy is not this module's job. Steps 1 and 3 are the
 * minimum needed to close the trivial evasion, and no more.
 */
export function normalizeReviewerComment(raw: string | null | undefined): NormalizedComment {
  if (raw === null || raw === undefined) return { normalized: '', length: 0 };
  const normalized = raw.replace(INVISIBLE_CHARACTERS, '').replace(WHITESPACE_RUN, ' ').trim();
  return { normalized, length: Array.from(normalized).length };
}

// ---------------------------------------------------------------------------------------------
// criterion 7.7: the authority to record, which cannot be forged
// ---------------------------------------------------------------------------------------------

// Module-private brand. `declare const` means it exists only in the type system, so it erases at
// runtime, and because the symbol is not exported no code outside this file can write the
// property. That is what makes ReviewAuthority unconstructable elsewhere: an object literal is
// rejected by the compiler for a missing property whose key it cannot name.
declare const REVIEW_AUTHORITY_BRAND: unique symbol;

/**
 * Proof that ONE named user may record on ONE named Variance_Record and is not the employee named
 * on it (criteria 7.1, 7.6, 7.7). Obtainable only from `authorizeReviewer`.
 */
export interface ReviewAuthority {
  readonly [REVIEW_AUTHORITY_BRAND]: 'checked_not_self_review';
  readonly recordId: string;
  readonly userId: string;
  readonly role: ReviewerRole;
  /** criterion 7.6, non-null only on the substituted second slot. */
  readonly substitution: ManagerSubstitution | null;
}

export interface ReviewActor {
  readonly userId: string;
  /** The actor's own employee row, when they have one. Half of the 7.7 identity test. */
  readonly employeeId?: string | null;
  readonly role: ReviewerRole;
}

export type ReviewRejectionCode =
  /** criterion 7.7. */
  | 'self_review_not_permitted'
  /** criterion 7.1: a Recorded_Not_Queued record reached a review entry point at runtime. */
  | 'record_not_queued_for_dual_review'
  /** criterion 7.1: the acting WFM_Reviewer's scope does not contain the employee. */
  | 'reviewer_not_in_scope'
  /** criteria 7.1, 7.6: not the Reporting_Manager and not the branch substitute. */
  | 'not_the_reporting_manager'
  /** criterion 7.6: neither a Reporting_Manager nor a branch WFM point of contact exists. */
  | 'no_manager_reviewer_available'
  /** The authority was issued for a different Variance_Record. */
  | 'authority_record_mismatch'
  /** criterion 7.4. */
  | 'comment_too_short'
  /** criterion 8.2: an adjustment request must state the requested classification. */
  | 'requested_classification_required'
  /** criterion 7.3: the slot already holds an outcome. */
  | 'outcome_already_recorded_for_role'
  /** criteria 7.5, 7.10: the record is reviewed, contested or legacy-closed. */
  | 'record_already_closed';

export interface ReviewRejection {
  readonly code: ReviewRejectionCode;
  readonly message: string;
  /** The criteria this refusal enforces, so an audit row can name them. */
  readonly criteria: readonly string[];
}

export type AuthorizeReviewerResult =
  | { readonly ok: true; readonly authority: ReviewAuthority }
  | { readonly ok: false; readonly rejection: ReviewRejection };

function reject(
  code: ReviewRejectionCode,
  message: string,
  criteria: readonly string[],
): { readonly ok: false; readonly rejection: ReviewRejection } {
  return Object.freeze({
    ok: false as const,
    rejection: Object.freeze({ code, message, criteria: Object.freeze([...criteria]) }),
  });
}

/**
 * criterion 7.7 is the reason this function exists at all: it is the single gate through which a
 * recording user must pass, so self-review cannot be forgotten at a call site.
 *
 * It also settles which slot the user fills (criterion 7.5) and applies criterion 7.6's
 * substitution. Self-review is tested FIRST, before scope and before slot eligibility, so the
 * refusal a self-reviewer sees is always "self-review is not permitted" and never an
 * eligibility message that would tell them which identity to present instead.
 */
export function authorizeReviewer(
  record: QueuedVarianceRecord,
  actor: ReviewActor,
): AuthorizeReviewerResult {
  // criterion 7.1, defence in depth. The parameter type already excludes a Recorded_Not_Queued
  // record; this catches a value that reached here through `as` or from untyped JSON.
  if (record.queueState !== 'queued_for_dual_review') {
    return reject(
      'record_not_queued_for_dual_review',
      'This Variance_Record is Recorded_Not_Queued and is not presented for Dual_Review.',
      ['7.1'],
    );
  }

  // criterion 7.7. Both identities are compared: the employee's login, and the employee row
  // behind the acting user, because a reviewer whose user id differs from the employee's login is
  // still the same person when the employee row matches.
  const isEmployeeLogin =
    record.employeeUserId !== null && record.employeeUserId === actor.userId;
  const isEmployeeRow =
    actor.employeeId !== null &&
    actor.employeeId !== undefined &&
    actor.employeeId === record.employeeId;
  if (isEmployeeLogin || isEmployeeRow) {
    return reject(
      'self_review_not_permitted',
      'Self-review is not permitted: the recording user is the employee named on this Variance_Record.',
      ['7.7'],
    );
  }

  if (actor.role === 'wfm_reviewer') {
    // criterion 7.1: the WFM_Reviewers whose scope contains the employee.
    if (!record.authorizedWfmReviewerUserIds.includes(actor.userId)) {
      return reject(
        'reviewer_not_in_scope',
        'This Variance_Record is not presented to the acting WFM_Reviewer: the employee is outside their scope.',
        ['7.1'],
      );
    }
    return Object.freeze({
      ok: true as const,
      authority: makeAuthority(record.id, actor.userId, 'wfm_reviewer', null),
    });
  }

  // criterion 7.1: the employee's Reporting_Manager holds the second slot.
  if (record.reportingManagerUserId !== null) {
    if (record.reportingManagerUserId !== actor.userId) {
      return reject(
        'not_the_reporting_manager',
        "The acting user is not the employee's Reporting_Manager for this Variance_Record.",
        ['7.1'],
      );
    }
    return Object.freeze({
      ok: true as const,
      authority: makeAuthority(record.id, actor.userId, 'reporting_manager', null),
    });
  }

  // criterion 7.6: no Reporting_Manager, so the branch workforce-management point of contact
  // substitutes and the substitution is recorded on the record.
  if (record.branchWfmContactUserId === null) {
    return reject(
      'no_manager_reviewer_available',
      'The employee has no Reporting_Manager and the branch has no workforce-management point of contact to substitute.',
      ['7.6'],
    );
  }
  if (record.branchWfmContactUserId !== actor.userId) {
    return reject(
      'not_the_reporting_manager',
      "The employee has no Reporting_Manager; only the branch workforce-management point of contact may fill the second slot.",
      ['7.1', '7.6'],
    );
  }
  return Object.freeze({
    ok: true as const,
    authority: makeAuthority(record.id, actor.userId, 'reporting_manager', {
      kind: 'branch_wfm_point_of_contact',
      substituteUserId: actor.userId,
      reason: 'employee_has_no_reporting_manager',
    }),
  });
}

function makeAuthority(
  recordId: string,
  userId: string,
  role: ReviewerRole,
  substitution: ManagerSubstitution | null,
): ReviewAuthority {
  // The single cast in this module, and the reason the brand works: nothing outside this function
  // can produce a value of this type, because nothing outside this file can name the brand key.
  return Object.freeze({
    recordId,
    userId,
    role,
    substitution: substitution === null ? null : Object.freeze(substitution),
  }) as unknown as ReviewAuthority;
}

// ---------------------------------------------------------------------------------------------
// criterion 7.1 / 7.2: presentation, and reportability of a Recorded_Not_Queued record
// ---------------------------------------------------------------------------------------------

export interface PresentedReviewer {
  readonly role: ReviewerRole;
  readonly userId: string;
  readonly substituted: boolean;
}

export type PresentationResult =
  | {
      readonly presented: true;
      readonly recordId: string;
      /** criterion 7.2. */
      readonly evidence: ReviewEvidence;
      readonly reviewers: readonly PresentedReviewer[];
      readonly substitution: ManagerSubstitution | null;
      readonly missingReviewerSlots: readonly ReviewerRole[];
    }
  | {
      readonly presented: false;
      readonly recordId: string;
      readonly reason: 'recorded_not_queued' | 'review_already_complete' | 'record_closed';
      /** criterion 7.1: not presented is not the same as not retrievable. */
      readonly retrievableForReporting: true;
    };

/**
 * criteria 7.1 and 7.2. Returns the evidence set and the reviewers to present it to, or states
 * that the record is not presented. The union return type is the point: a caller cannot read
 * `evidence` without first handling the Recorded_Not_Queued case, so criterion 7.1's "SHALL NOT
 * be presented for Dual_Review" is not something a UI can forget.
 */
export function presentForDualReview(record: VarianceRecord): PresentationResult {
  if (!isQueuedForDualReview(record)) {
    return Object.freeze({
      presented: false as const,
      recordId: record.id,
      reason: 'recorded_not_queued' as const,
      retrievableForReporting: true as const,
    });
  }
  if (record.wfmReview !== null && record.managerReview !== null) {
    return Object.freeze({
      presented: false as const,
      recordId: record.id,
      reason: 'review_already_complete' as const,
      retrievableForReporting: true as const,
    });
  }
  if (CLOSED_STATUSES.includes(record.status)) {
    return Object.freeze({
      presented: false as const,
      recordId: record.id,
      reason: 'record_closed' as const,
      retrievableForReporting: true as const,
    });
  }

  const reviewers: PresentedReviewer[] = record.authorizedWfmReviewerUserIds.map((userId) => ({
    role: 'wfm_reviewer' as const,
    userId,
    substituted: false,
  }));

  let substitution: ManagerSubstitution | null = null;
  if (record.reportingManagerUserId !== null) {
    reviewers.push({
      role: 'reporting_manager',
      userId: record.reportingManagerUserId,
      substituted: false,
    });
  } else if (record.branchWfmContactUserId !== null) {
    // criterion 7.6.
    substitution = Object.freeze({
      kind: 'branch_wfm_point_of_contact' as const,
      substituteUserId: record.branchWfmContactUserId,
      reason: 'employee_has_no_reporting_manager' as const,
    });
    reviewers.push({
      role: 'reporting_manager',
      userId: record.branchWfmContactUserId,
      substituted: true,
    });
  }

  const missing: ReviewerRole[] = [];
  if (record.wfmReview === null) missing.push('wfm_reviewer');
  if (record.managerReview === null) missing.push('reporting_manager');

  return Object.freeze({
    presented: true as const,
    recordId: record.id,
    evidence: record.evidence,
    reviewers: Object.freeze(reviewers),
    substitution,
    missingReviewerSlots: Object.freeze(missing),
  });
}

export interface ReportRow {
  readonly recordId: string;
  readonly employeeId: string;
  readonly branchId: string;
  readonly workDate: string;
  readonly payMonth: string;
  readonly queueState: QueueState;
  readonly status: VarianceRecordStatus;
  readonly varianceRiskScore: number | null;
  readonly presentedForDualReview: boolean;
  readonly wfmOutcome: ReviewOutcome | null;
  readonly managerOutcome: ReviewOutcome | null;
  readonly managerSubstituted: boolean;
}

/**
 * criterion 7.1's other half: a Recorded_Not_Queued record is retrievable and reportable. Takes
 * the whole `VarianceRecord` union, unlike the review entry points, and carries no evidence set
 * and no reviewer list -- so this projection can be listed and counted (criterion 9.5) without
 * ever becoming a review presentation.
 */
export function describeForReport(record: VarianceRecord): ReportRow {
  return Object.freeze({
    recordId: record.id,
    employeeId: record.employeeId,
    branchId: record.branchId,
    workDate: record.workDate,
    payMonth: record.payMonth,
    queueState: record.queueState,
    status: record.status,
    varianceRiskScore: record.evidence.evaluation.varianceRiskScore,
    presentedForDualReview: record.queueState === 'queued_for_dual_review',
    wfmOutcome: record.wfmReview?.outcome ?? null,
    managerOutcome: record.managerReview?.outcome ?? null,
    managerSubstituted: record.managerReview !== null && record.managerReview.substitution !== null,
  });
}

// ---------------------------------------------------------------------------------------------
// criterion 7.10: what "conflicting" means
// ---------------------------------------------------------------------------------------------

export type ConflictReason =
  /** One reviewer accepts the APR record, the other disputes it. */
  | 'accepted_versus_disputed'
  /** One reviewer would leave the day alone, the other would move the day's pay. */
  | 'accepted_versus_adjustment'
  /** Both want an adjustment, to different classifications or different LWP values. */
  | 'divergent_requested_adjustments';

export type AgreementReason =
  | 'identical_outcomes'
  | 'same_requested_adjustment'
  | 'dispute_and_adjustment_agree_on_the_finding';

export type ConflictAssessment =
  | { readonly conflicting: false; readonly reason: AgreementReason }
  | { readonly conflicting: true; readonly reason: ConflictReason };

/**
 * criterion 7.10. The requirement says "conflicting Review_Outcomes" and does not define the
 * word, so here is the reading applied, pair by pair. It is symmetric in its arguments by
 * construction (the ordered pair is normalized before the comparison), because "the two reviewers
 * disagree" cannot depend on who recorded first.
 *
 *  apr_accepted   + apr_accepted         -> AGREE. Both reviewers accept the APR record.
 *  apr_disputed   + apr_disputed         -> AGREE. Both reject it. They agree on the finding, and
 *                                           neither asks for a pay change, so there is nothing for
 *                                           an Override_Approver to decide.
 *  apr_accepted   + apr_disputed         -> CONFLICT. The plain case: the same question, opposite
 *                                           answers.
 *  apr_accepted   + adjustment_requested -> CONFLICT. One reviewer says leave classification, LWP
 *                                           and Payable_Days unchanged (criterion 8.1); the other
 *                                           says move them (criterion 8.2). They disagree on
 *                                           whether the employee is paid differently, which is the
 *                                           highest-stakes disagreement the queue can hold, and
 *                                           criterion 7.10's Override_Approver is exactly who
 *                                           should settle it.
 *  adjustment_requested x2, SAME target  -> AGREE. Both reviewers reached the same conclusion
 *                                           about what the day was. One adjustment request, two
 *                                           supporters.
 *  adjustment_requested x2, DIFFERENT
 *  classification or LWP                 -> CONFLICT. Both agree the record is wrong and disagree
 *                                           on what is right. Applying either would pick a winner
 *                                           between two equally authorised reviewers, which is the
 *                                           decision criterion 7.10 reserves for the
 *                                           Override_Approver. The LWP value is compared as well
 *                                           as the classification because two requests for
 *                                           `half_day` with different LWP values still ask for
 *                                           different pay.
 *  apr_disputed   + adjustment_requested -> AGREE. The one debatable pair, and the reading is
 *                                           deliberate. Both reviewers reject the APR record, so
 *                                           they agree on the FINDING and differ only in the
 *                                           remedy: `apr_disputed` records the disagreement and
 *                                           changes nothing (8.1), `adjustment_requested` proposes
 *                                           a fix (8.2). Criterion 7.10 exists so that one
 *                                           reviewer's answer cannot override the other's on the
 *                                           same question; here there is no answer being
 *                                           overridden, and the proposed fix still cannot reach
 *                                           payroll without a separate Override_Approver under
 *                                           criteria 8.3 to 8.5. The safeguard 7.10 provides is
 *                                           therefore already present on this path, and marking it
 *                                           contested would stall a case the two reviewers do not
 *                                           actually disagree about. Recorded here rather than
 *                                           buried so it can be reversed with one edit if the WFM
 *                                           head reads it the other way.
 */
export function assessOutcomeConflict(
  first: RecordedReview,
  second: RecordedReview,
): ConflictAssessment {
  const agree = (reason: AgreementReason): ConflictAssessment =>
    Object.freeze({ conflicting: false as const, reason });
  const conflict = (reason: ConflictReason): ConflictAssessment =>
    Object.freeze({ conflicting: true as const, reason });

  if (first.outcome === 'adjustment_requested' && second.outcome === 'adjustment_requested') {
    const sameClassification = first.requestedClassification === second.requestedClassification;
    const sameLwp = (first.requestedLwpValue ?? null) === (second.requestedLwpValue ?? null);
    return sameClassification && sameLwp
      ? agree('same_requested_adjustment')
      : conflict('divergent_requested_adjustments');
  }

  if (first.outcome === second.outcome) return agree('identical_outcomes');

  // Normalized to an unordered pair so the verdict cannot depend on recording order.
  const pair = new Set<ReviewOutcome>([first.outcome, second.outcome]);
  if (pair.has('apr_accepted') && pair.has('apr_disputed')) {
    return conflict('accepted_versus_disputed');
  }
  if (pair.has('apr_accepted') && pair.has('adjustment_requested')) {
    return conflict('accepted_versus_adjustment');
  }
  // The remaining pair: apr_disputed + adjustment_requested.
  return agree('dispute_and_adjustment_agree_on_the_finding');
}

// ---------------------------------------------------------------------------------------------
// criteria 7.3, 7.4, 7.5, 7.10, 8.1, 8.2: recording an outcome
// ---------------------------------------------------------------------------------------------

/**
 * criterion 8.1 made structural: the `apr_accepted` and `apr_disputed` arms have no member
 * through which a classification or an LWP value could arrive, so those two outcomes have no
 * channel to pay. `apr_accepted` accepts an optional comment because criterion 7.4 requires one
 * only for the other two.
 */
export type ReviewSubmission =
  | { readonly outcome: 'apr_accepted'; readonly comment?: string | null }
  | { readonly outcome: 'apr_disputed'; readonly comment: string }
  | {
      readonly outcome: 'adjustment_requested';
      readonly comment: string;
      readonly requestedClassification: DayClassification;
      readonly requestedLwpValue?: number | null;
    };

/** criterion 7.10's routing target. Returned as intent; this module notifies nobody. */
export interface OverrideApproverRouting {
  readonly reason: 'conflicting_review_outcomes';
  readonly conflictReason: ConflictReason;
  readonly branchId: string;
  readonly overrideApproverUserIds: readonly string[];
  /** True when the branch has no Override_Approver configured, which the caller must surface. */
  readonly unroutable: boolean;
}

export interface RecordOutcomeAccepted {
  readonly ok: true;
  /** criterion 7.3, stored for this reviewer independently of the other. */
  readonly recorded: RecordedReview;
  /** The record with this slot filled and the status of criteria 7.5 / 7.10 applied. */
  readonly record: QueuedVarianceRecord;
  readonly statusBefore: VarianceRecordStatus;
  readonly statusAfter: VarianceRecordStatus;
  /** criterion 7.5. */
  readonly dualReviewComplete: boolean;
  /** criterion 7.10, null until both slots hold an outcome. */
  readonly conflict: ConflictAssessment | null;
  readonly routing: OverrideApproverRouting | null;
  /** criterion 8.2, non-null only for `adjustment_requested`. */
  readonly adjustmentRequest: AdjustmentRequest | null;
  /**
   * criterion 8.1. Returned BY REFERENCE from the input record, so a caller (and the property
   * test) can assert identity: recording an outcome cannot have altered classification, LWP or
   * Payable_Days, because it returned the very object it was given.
   */
  readonly dailyOutcome: DailyOutcome;
}

export type RecordOutcomeResult =
  | RecordOutcomeAccepted
  | { readonly ok: false; readonly rejection: ReviewRejection };

export interface RecordOutcomeInput {
  readonly record: QueuedVarianceRecord;
  /** criterion 7.7: obtainable only from `authorizeReviewer`. */
  readonly authority: ReviewAuthority;
  readonly submission: ReviewSubmission;
  /** criterion 7.3's recording timestamp, supplied rather than read from a clock. */
  readonly recordedAt: string;
}

/**
 * criteria 7.3, 7.4, 7.5, 7.10, 8.1 and 8.2. Returns the accepted new state or a typed rejection.
 * Never throws for ordinary data.
 */
export function recordReviewOutcome(input: RecordOutcomeInput): RecordOutcomeResult {
  const { record, authority, submission, recordedAt } = input;

  // criterion 7.1, defence in depth behind the parameter type.
  if (record.queueState !== 'queued_for_dual_review') {
    return reject(
      'record_not_queued_for_dual_review',
      'This Variance_Record is Recorded_Not_Queued and is not presented for Dual_Review.',
      ['7.1'],
    );
  }

  // An authority is proof about ONE record. Reusing one across records would reintroduce exactly
  // the self-review hole the brand closes, since the employee differs per record.
  if (authority.recordId !== record.id) {
    return reject(
      'authority_record_mismatch',
      'The reviewer authority was issued for a different Variance_Record.',
      ['7.1', '7.7'],
    );
  }

  // criterion 7.7 re-checked. `authorizeReviewer` already refused this, so reaching it means the
  // brand was bypassed by a cast; the security rule still holds.
  const isEmployeeLogin =
    record.employeeUserId !== null && record.employeeUserId === authority.userId;
  if (isEmployeeLogin) {
    return reject(
      'self_review_not_permitted',
      'Self-review is not permitted: the recording user is the employee named on this Variance_Record.',
      ['7.7'],
    );
  }

  if (CLOSED_STATUSES.includes(record.status)) {
    return reject(
      'record_already_closed',
      `This Variance_Record is ${record.status} and accepts no further Review_Outcome.`,
      ['7.5', '7.10'],
    );
  }

  const existing = authority.role === 'wfm_reviewer' ? record.wfmReview : record.managerReview;
  if (existing !== null) {
    return reject(
      'outcome_already_recorded_for_role',
      `A Review_Outcome is already recorded for the ${authority.role} slot on this Variance_Record.`,
      ['7.3'],
    );
  }

  // criterion 7.4.
  const comment = normalizeReviewerComment(submission.comment);
  if (
    OUTCOMES_REQUIRING_COMMENT.includes(submission.outcome) &&
    comment.length < MIN_REVIEWER_COMMENT_LENGTH
  ) {
    return reject(
      'comment_too_short',
      `A Review_Outcome of ${submission.outcome} requires a reviewer comment of at least ` +
        `${MIN_REVIEWER_COMMENT_LENGTH} characters; this one counts ${comment.length}.`,
      ['7.4'],
    );
  }

  // criterion 8.2: a request that names no classification states nothing to approve.
  if (submission.outcome === 'adjustment_requested' && !submission.requestedClassification) {
    return reject(
      'requested_classification_required',
      'An adjustment request must state the requested classification.',
      ['8.2'],
    );
  }

  const common = {
    role: authority.role,
    userId: authority.userId,
    recordedAt,
    comment: comment.normalized,
    // criterion 7.6: the substitution travels onto the stored review.
    substitution: authority.substitution,
  } as const;

  const recorded: RecordedReview =
    submission.outcome === 'adjustment_requested'
      ? Object.freeze({
          outcome: 'adjustment_requested' as const,
          ...common,
          requestedClassification: submission.requestedClassification,
          requestedLwpValue: submission.requestedLwpValue ?? null,
        })
      : submission.outcome === 'apr_disputed'
        ? Object.freeze({ outcome: 'apr_disputed' as const, ...common })
        : Object.freeze({ outcome: 'apr_accepted' as const, ...common });

  const wfmReview = authority.role === 'wfm_reviewer' ? recorded : record.wfmReview;
  const managerReview = authority.role === 'reporting_manager' ? recorded : record.managerReview;

  // criterion 7.5: both slots filled marks the record reviewed. criterion 7.10 overrides that
  // with contested when the two outcomes conflict.
  const dualReviewComplete = wfmReview !== null && managerReview !== null;
  const conflict = dualReviewComplete ? assessOutcomeConflict(wfmReview, managerReview) : null;

  let statusAfter: VarianceRecordStatus = record.status;
  let routing: OverrideApproverRouting | null = null;
  if (conflict !== null && conflict.conflicting) {
    statusAfter = 'contested';
    routing = Object.freeze({
      reason: 'conflicting_review_outcomes' as const,
      conflictReason: conflict.reason,
      branchId: record.branchId,
      overrideApproverUserIds: Object.freeze([...record.overrideApproverUserIds]),
      unroutable: record.overrideApproverUserIds.length === 0,
    });
  } else if (dualReviewComplete) {
    statusAfter = 'reviewed';
  }

  const nextRecord: QueuedVarianceRecord = Object.freeze({
    ...record,
    queueState: 'queued_for_dual_review' as const,
    status: statusAfter,
    wfmReview,
    managerReview,
  });

  // criterion 8.2. The type of `recorded` is what gates this: only the `adjustment_requested`
  // arm is assignable to buildAdjustmentRequest's parameter.
  const adjustmentRequest =
    recorded.outcome === 'adjustment_requested'
      ? buildAdjustmentRequest(record, recorded)
      : null;

  return Object.freeze({
    ok: true as const,
    recorded,
    record: nextRecord,
    statusBefore: record.status,
    statusAfter,
    dualReviewComplete,
    conflict,
    routing,
    adjustmentRequest,
    // criterion 8.1: the same object, not a copy of it.
    dailyOutcome: record.dailyOutcome,
  });
}

// ---------------------------------------------------------------------------------------------
// criteria 7.8, 7.9: escalation, measured in whole days
// ---------------------------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * The calendar day number (days since the Unix epoch) of a 'YYYY-MM-DD' date or of the date part
 * of an ISO timestamp.
 *
 * WHY THE CALENDAR DATE AND NOT THE ELAPSED MILLISECONDS. Criterion 7.8 counts "whole days since
 * it was presented". Reading the whole timestamp and flooring the elapsed time would make the
 * answer depend on the hour a record happened to be presented -- a record presented at 23:00
 * would escalate a day later than one presented at 01:00 on the same date -- and constructing
 * either instant through the local zone would shift the date itself for any host west of UTC.
 * Both are ways for the same record to escalate or not depending on where and when the job runs.
 * Differencing calendar day numbers built with `Date.UTC` removes both: UTC has no daylight
 * saving, so the difference is exact, and the time of day never enters the arithmetic.
 *
 * Throws for a malformed or non-existent date. That is a PROGRAMMER ERROR, not ordinary data: a
 * silent 0 here would compute an SLA against the epoch and either escalate everything or nothing.
 */
function calendarDayNumber(value: string, label: string): number {
  const match = CALENDAR_DATE.exec(value);
  if (match === null) {
    throw new RangeError(
      `${label} must be a 'YYYY-MM-DD' date or an ISO timestamp beginning with one; received ${JSON.stringify(value)}.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(ms)) {
    throw new RangeError(`${label} is not a valid date; received ${JSON.stringify(value)}.`);
  }
  const roundTrip = new Date(ms);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    // '2026-02-31' parses arithmetically and would silently become 2026-03-03.
    throw new RangeError(`${label} names a date that does not exist; received ${JSON.stringify(value)}.`);
  }
  return ms / MS_PER_DAY;
}

/**
 * criteria 7.8, 7.9. Exported because the whole-day count is the load-bearing part of the SLA and
 * a caller (or a test) must be able to check it directly. Negative when `to` precedes `from`.
 */
export function wholeDaysBetween(from: string, to: string): number {
  return calendarDayNumber(to, 'reference date') - calendarDayNumber(from, 'start date');
}

/** criterion 7.8's "next escalation level", resolved by the caller and handed in. */
export interface EscalationLadder {
  readonly wfmReviewerNextLevelUserId: string | null;
  readonly reportingManagerNextLevelUserId: string | null;
}

export interface EscalationNotificationIntent {
  readonly pendingRole: ReviewerRole;
  readonly pendingReviewerUserId: string | null;
  readonly notifyUserId: string;
  readonly recordId: string;
  readonly employeeId: string;
  readonly branchId: string;
  readonly workDate: string;
  readonly ageInWholeDays: number;
}

export type EscalationReason =
  | 'due'
  | 'record_not_queued'
  | 'record_closed'
  | 'review_already_complete'
  | 'not_presented'
  | 'presented_after_reference_date'
  | 'age_below_escalation_age'
  | 'interval_not_elapsed'
  | 'no_escalation_target';

export interface EscalationEvaluation {
  readonly due: boolean;
  readonly reason: EscalationReason;
  /** null only when the record has no `presentedAt`. */
  readonly ageInWholeDays: number | null;
  readonly appliedEscalationAgeDays: number;
  readonly appliedEscalationIntervalDays: number;
  readonly daysSinceLastEscalation: number | null;
  readonly pendingRoles: readonly ReviewerRole[];
  readonly notifications: readonly EscalationNotificationIntent[];
  readonly pendingRolesWithoutEscalationTarget: readonly ReviewerRole[];
  readonly configurationWarnings: readonly string[];
}

export interface EscalationEvaluationInput {
  readonly record: QueuedVarianceRecord;
  /** 'YYYY-MM-DD' or an ISO timestamp. The clock, as an argument. */
  readonly referenceDate: string;
  readonly ladder: EscalationLadder;
}

interface AppliedDayCount {
  readonly days: number;
  readonly warning: string | null;
}

/**
 * criterion 7.9 for the age, and the stated fallback for the interval. An unconfigured value
 * applies the default silently; a configured value that is not a positive whole number applies
 * the default, and says so, in the same shape as `applyThreshold` in attendance-variance.ts.
 * Fractional days are refused rather than rounded because criterion 7.8 counts WHOLE days, and
 * silently rounding 2.5 would make the SLA disagree with the value an administrator set.
 */
function applyDayCount(
  label: string,
  configured: number | null | undefined,
  fallback: number,
  fallbackDescription: string,
): AppliedDayCount {
  if (configured === null || configured === undefined) {
    return { days: fallback, warning: null };
  }
  if (!Number.isInteger(configured) || configured <= 0) {
    return {
      days: fallback,
      warning:
        `Configured ${label} of ${String(configured)} is not a whole number of days greater than ` +
        `zero; applied ${fallbackDescription} instead.`,
    };
  }
  return { days: configured, warning: null };
}

/**
 * criteria 7.8 and 7.9. Decides whether escalation is due for one queued, unreviewed
 * Variance_Record as at `referenceDate`, to whom, and whether the configured interval has elapsed
 * since the last escalation. Returns intent only: this module notifies nobody.
 *
 * Throws only for a malformed date (see `calendarDayNumber`) -- a programmer error.
 */
export function evaluateEscalation(input: EscalationEvaluationInput): EscalationEvaluation {
  const { record, referenceDate, ladder } = input;

  const age = applyDayCount(
    'escalation age',
    record.escalationAgeDays,
    DEFAULT_ESCALATION_AGE_DAYS,
    `the default of ${DEFAULT_ESCALATION_AGE_DAYS} whole days (criterion 7.9)`,
  );
  const interval = applyDayCount(
    'escalation interval',
    record.escalationIntervalDays,
    age.days,
    `the applied escalation age of ${age.days} whole days`,
  );
  const warnings: string[] = [];
  if (age.warning !== null) warnings.push(age.warning);
  if (interval.warning !== null) warnings.push(interval.warning);
  if (record.escalationIntervalDays === null || record.escalationIntervalDays === undefined) {
    warnings.push(
      'No escalation interval is configured and criterion 7.9 supplies a default only for the ' +
        `escalation age; applied the escalation age of ${age.days} whole days as the interval.`,
    );
  }

  const pendingRoles: ReviewerRole[] = [];
  if (record.wfmReview === null) pendingRoles.push('wfm_reviewer');
  if (record.managerReview === null) pendingRoles.push('reporting_manager');

  const settle = (
    due: boolean,
    reason: EscalationReason,
    ageInWholeDays: number | null,
    daysSinceLastEscalation: number | null,
    notifications: readonly EscalationNotificationIntent[],
    withoutTarget: readonly ReviewerRole[],
  ): EscalationEvaluation =>
    Object.freeze({
      due,
      reason,
      ageInWholeDays,
      appliedEscalationAgeDays: age.days,
      appliedEscalationIntervalDays: interval.days,
      daysSinceLastEscalation,
      pendingRoles: Object.freeze([...pendingRoles]),
      notifications: Object.freeze([...notifications]),
      pendingRolesWithoutEscalationTarget: Object.freeze([...withoutTarget]),
      configurationWarnings: Object.freeze([...warnings]),
    });

  // criterion 7.1, defence in depth behind the parameter type: a Recorded_Not_Queued record was
  // never presented, so it has no SLA to breach.
  if (record.queueState !== 'queued_for_dual_review') {
    return settle(false, 'record_not_queued', null, null, [], []);
  }
  // criterion 7.8 applies WHILE the record remains unreviewed.
  if (pendingRoles.length === 0) {
    return settle(false, 'review_already_complete', null, null, [], []);
  }
  if (CLOSED_STATUSES.includes(record.status)) {
    return settle(false, 'record_closed', null, null, [], []);
  }
  if (record.presentedAt === null) {
    return settle(false, 'not_presented', null, null, [], []);
  }

  const ageInWholeDays = wholeDaysBetween(record.presentedAt, referenceDate);
  if (ageInWholeDays < 0) {
    return settle(false, 'presented_after_reference_date', ageInWholeDays, null, [], []);
  }

  const daysSinceLastEscalation =
    record.lastEscalatedAt === null
      ? null
      : wholeDaysBetween(record.lastEscalatedAt, referenceDate);

  // criterion 7.8: "at least the configured escalation age", so exactly the age escalates.
  if (ageInWholeDays < age.days) {
    return settle(
      false,
      'age_below_escalation_age',
      ageInWholeDays,
      daysSinceLastEscalation,
      [],
      [],
    );
  }

  // criterion 7.8: once per configured escalation interval. A never-escalated record is due now;
  // an already-escalated one waits out the interval, again in whole days.
  if (daysSinceLastEscalation !== null && daysSinceLastEscalation < interval.days) {
    return settle(false, 'interval_not_elapsed', ageInWholeDays, daysSinceLastEscalation, [], []);
  }

  const notifications: EscalationNotificationIntent[] = [];
  const withoutTarget: ReviewerRole[] = [];
  for (const role of pendingRoles) {
    const notifyUserId =
      role === 'wfm_reviewer'
        ? ladder.wfmReviewerNextLevelUserId
        : ladder.reportingManagerNextLevelUserId;
    if (notifyUserId === null) {
      withoutTarget.push(role);
      continue;
    }
    const pendingReviewerUserId =
      role === 'wfm_reviewer'
        ? (record.authorizedWfmReviewerUserIds[0] ?? null)
        : (record.reportingManagerUserId ?? record.branchWfmContactUserId ?? null);
    notifications.push(
      Object.freeze({
        pendingRole: role,
        pendingReviewerUserId,
        notifyUserId,
        recordId: record.id,
        employeeId: record.employeeId,
        branchId: record.branchId,
        workDate: record.workDate,
        ageInWholeDays,
      }),
    );
  }

  if (notifications.length === 0) {
    return settle(
      false,
      'no_escalation_target',
      ageInWholeDays,
      daysSinceLastEscalation,
      [],
      withoutTarget,
    );
  }
  return settle(
    true,
    'due',
    ageInWholeDays,
    daysSinceLastEscalation,
    notifications,
    withoutTarget,
  );
}

// ---------------------------------------------------------------------------------------------
// Requirement 8: adjustment authority
// ---------------------------------------------------------------------------------------------

/** criterion 8.2. */
export interface AdjustmentRequest {
  readonly varianceRecordId: string;
  readonly employeeId: string;
  readonly branchId: string;
  readonly targetDate: string;
  readonly payMonth: string;
  readonly requestedClassification: DayClassification;
  readonly requestedLwpValue: number | null;
  readonly requestingUserId: string;
  readonly requestingRole: ReviewerRole;
  readonly justification: string;
  readonly requestedAt: string;
  /**
   * criterion 8.7. The day as it stood when the request was raised. This is NOT what gets
   * recorded as superseded -- `approveAdjustmentRequest` reads the state immediately before
   * application instead -- but keeping it lets the approver see whether the day moved in between
   * (`precedingStateDrifted` on the approval).
   */
  readonly dailyOutcomeAtRequest: DailyOutcome;
}

/**
 * criterion 8.2. The parameter type is the criterion 8.1 guarantee: only the
 * `adjustment_requested` arm of `RecordedReview` is assignable here, so no `apr_accepted` or
 * `apr_disputed` review can be turned into a pay-moving request, whatever a caller intends.
 */
export function buildAdjustmentRequest(
  record: VarianceRecord,
  review: Extract<RecordedReview, { outcome: 'adjustment_requested' }>,
): AdjustmentRequest {
  return Object.freeze({
    varianceRecordId: record.id,
    employeeId: record.employeeId,
    branchId: record.branchId,
    targetDate: record.workDate,
    payMonth: record.payMonth,
    requestedClassification: review.requestedClassification,
    requestedLwpValue: review.requestedLwpValue,
    requestingUserId: review.userId,
    requestingRole: review.role,
    justification: review.comment,
    requestedAt: review.recordedAt,
    dailyOutcomeAtRequest: record.dailyOutcome,
  });
}

/**
 * criterion 8.6. Resolved by the caller with the predicate the rest of the platform uses (a
 * `salary_prep_run` for the month with `attendance_snapshot_locked = 1` or a finalized / locked /
 * disbursed / approved status), because that is a query.
 */
export interface PayMonthCutOffState {
  readonly payMonth: string;
  readonly reachedCutOff: boolean;
  /** criteria 8.6, 9.4: where the arrear or recovery entry belongs. */
  readonly earliestOpenPayMonth: string | null;
}

export type AdjustmentRefusalCode =
  /** criterion 8.4. */
  | 'approver_lacks_override_grant'
  /** criterion 8.5. */
  | 'approver_is_requester'
  /** criterion 8.6. */
  | 'pay_month_reached_cut_off'
  /** criterion 14.5, decided by the caller and passed in. */
  | 'approver_authored_deciding_rule';

/**
 * criterion 8.4 requires the refused attempt to be RECORDED, which is why every refusal is a
 * returned value carrying everything an audit row needs. The caller writes it; this module writes
 * nothing.
 */
export interface RecordedRefusal {
  /** The first refusal that applied, in the order of design.md section 9. */
  readonly code: AdjustmentRefusalCode;
  /** Every refusal that applied, so one attempt is not audited three times to learn three facts. */
  readonly codes: readonly AdjustmentRefusalCode[];
  readonly message: string;
  readonly criteria: readonly string[];
  readonly attemptedByUserId: string;
  readonly attemptedAt: string;
  readonly varianceRecordId: string;
  readonly employeeId: string;
  readonly branchId: string;
  readonly targetDate: string;
  readonly payMonth: string;
  readonly requestingUserId: string;
  /** criterion 8.6: the Pay_Month the requester should use for the arrear path. */
  readonly arrearPayMonth: string | null;
}

/** criterion 8.3. */
export interface ApprovedAdjustment {
  readonly varianceRecordId: string;
  readonly employeeId: string;
  readonly branchId: string;
  readonly targetDate: string;
  readonly payMonth: string;
  readonly appliedClassification: DayClassification;
  readonly appliedLwpValue: number | null;
  readonly approvingUserId: string;
  readonly approvedAt: string;
  readonly requestingUserId: string;
  readonly justification: string;
  /**
   * criterion 8.7. The whole day as it stood IMMEDIATELY BEFORE application, taken from
   * `dailyOutcomeBeforeAdjustment`, never from the request. Criterion 8.3's "superseded
   * classification" is `superseded.classification`; `payableDays` is kept alongside it so a
   * revert restores the payroll figure too.
   */
  readonly superseded: DailyOutcome;
  /**
   * True when the day changed between the request and the approval. Not a refusal -- criterion
   * 8.7 asks that the SUPERSEDED value be the real pre-application one, which it is either way --
   * but the approver should see it.
   */
  readonly precedingStateDrifted: boolean;
}

export type AdjustmentApprovalResult =
  | { readonly ok: true; readonly approval: ApprovedAdjustment }
  | { readonly ok: false; readonly refusal: RecordedRefusal };

export interface ApprovalAttempt {
  readonly request: AdjustmentRequest;
  readonly approvingUserId: string;
  /** criterion 8.4: the branches for which this user holds the Override_Approver grant. */
  readonly approverOverrideApproverBranchIds: readonly string[];
  /** criterion 8.6, for `request.payMonth`. */
  readonly payMonthCutOff: PayMonthCutOffState;
  /**
   * criterion 8.7: the day as resolution and daily processing leave it immediately before this
   * approval is applied. This is what is recorded as superseded.
   */
  readonly dailyOutcomeBeforeAdjustment: DailyOutcome;
  readonly approvedAt: string;
  /** criterion 14.5, resolved by the caller against `attendance_source_rule_audit`. */
  readonly approverAuthoredDecidingRule?: boolean;
}

/**
 * criteria 8.3, 8.4, 8.5, 8.6, 8.7 (and 14.5 when the caller supplies the answer). Returns an
 * approval or a recordable refusal. Never throws for ordinary data.
 *
 * Throws only when `payMonthCutOff` describes a different Pay_Month than the request targets --
 * a programmer error, and one that would otherwise authorise a closed month against an open
 * month's cut-off state.
 */
export function approveAdjustmentRequest(attempt: ApprovalAttempt): AdjustmentApprovalResult {
  const { request, approvingUserId, payMonthCutOff } = attempt;

  if (payMonthCutOff.payMonth !== request.payMonth) {
    throw new Error(
      `Payroll_Cut_Off state was supplied for Pay_Month ${payMonthCutOff.payMonth} but the ` +
        `adjustment request targets ${request.payMonth}; refusing to authorise against the wrong month.`,
    );
  }

  const codes: AdjustmentRefusalCode[] = [];
  const criteria: string[] = [];

  // criterion 8.4. Order follows design.md section 9: grant, then separation of duties, then
  // cut-off.
  if (!attempt.approverOverrideApproverBranchIds.includes(request.branchId)) {
    codes.push('approver_lacks_override_grant');
    criteria.push('8.4');
  }
  // criterion 8.5.
  if (approvingUserId === request.requestingUserId) {
    codes.push('approver_is_requester');
    criteria.push('8.5');
  }
  // criterion 14.5, only when the caller resolved it.
  if (attempt.approverAuthoredDecidingRule === true) {
    codes.push('approver_authored_deciding_rule');
    criteria.push('14.5');
  }
  // criterion 8.6.
  if (payMonthCutOff.reachedCutOff) {
    codes.push('pay_month_reached_cut_off');
    criteria.push('8.6');
  }

  if (codes.length > 0) {
    return Object.freeze({
      ok: false as const,
      refusal: Object.freeze({
        code: codes[0],
        codes: Object.freeze([...codes]),
        message: refusalMessage(codes[0], payMonthCutOff),
        criteria: Object.freeze([...criteria]),
        attemptedByUserId: approvingUserId,
        attemptedAt: attempt.approvedAt,
        varianceRecordId: request.varianceRecordId,
        employeeId: request.employeeId,
        branchId: request.branchId,
        targetDate: request.targetDate,
        payMonth: request.payMonth,
        requestingUserId: request.requestingUserId,
        arrearPayMonth: payMonthCutOff.reachedCutOff
          ? payMonthCutOff.earliestOpenPayMonth
          : null,
      }),
    });
  }

  const before = attempt.dailyOutcomeBeforeAdjustment;
  return Object.freeze({
    ok: true as const,
    approval: Object.freeze({
      varianceRecordId: request.varianceRecordId,
      employeeId: request.employeeId,
      branchId: request.branchId,
      targetDate: request.targetDate,
      payMonth: request.payMonth,
      appliedClassification: request.requestedClassification,
      appliedLwpValue: request.requestedLwpValue,
      approvingUserId,
      approvedAt: attempt.approvedAt,
      requestingUserId: request.requestingUserId,
      justification: request.justification,
      // criterion 8.7: read from the pre-application state, not from the request.
      superseded: Object.freeze({
        classification: before.classification,
        lwpValue: before.lwpValue,
        payableDays: before.payableDays,
      }),
      precedingStateDrifted:
        before.classification !== request.dailyOutcomeAtRequest.classification ||
        before.lwpValue !== request.dailyOutcomeAtRequest.lwpValue,
    }),
  });
}

function refusalMessage(code: AdjustmentRefusalCode, cutOff: PayMonthCutOffState): string {
  switch (code) {
    case 'approver_lacks_override_grant':
      return 'The approving user does not hold the Override_Approver grant for the employee\'s branch; the attempt has been recorded.';
    case 'approver_is_requester':
      return 'A separate approver is required: the requesting reviewer may not approve their own adjustment request.';
    case 'approver_authored_deciding_rule':
      return 'The approving user created or amended the Attendance_Source_Rule that decided this date; a different Override_Approver is required.';
    case 'pay_month_reached_cut_off':
      return (
        `Pay_Month ${cutOff.payMonth} has reached Payroll_Cut_Off. Use the arrear adjustment path ` +
        `for ${cutOff.earliestOpenPayMonth ?? 'the earliest open Pay_Month'} instead.`
      );
  }
}

/**
 * criterion 8.3's effect on the date, as a value. `payableDays` is null because only
 * payrollCalculate.service can re-derive it from the new classification; the superseded snapshot
 * on the approval keeps the old figure, so `revertApprovedAdjustment` is still exact.
 */
export function applyApprovedAdjustment(approval: ApprovedAdjustment): DailyOutcome {
  return Object.freeze({
    classification: approval.appliedClassification,
    lwpValue: approval.appliedLwpValue,
    payableDays: null,
  });
}

/**
 * criterion 8.7 made operational rather than documentary: the exact state to restore, read off
 * the approval itself. `revertApprovedAdjustment(approval)` equals the `DailyOutcome` that was
 * passed as `dailyOutcomeBeforeAdjustment`, which is what the reversibility property asserts.
 */
export function revertApprovedAdjustment(approval: ApprovedAdjustment): DailyOutcome {
  return approval.superseded;
}

export interface ReversibilityCheck {
  readonly holds: boolean;
  readonly recordedSupersededClassification: DayClassification;
  readonly expectedSupersededClassification: DayClassification;
  readonly recordedSupersededLwpValue: number | null;
  readonly expectedSupersededLwpValue: number | null;
}

/**
 * criterion 8.7. Lets a caller CHECK that the recorded superseded classification equals the
 * classification that resolution and daily processing produced before the adjustment, instead of
 * assuming it. Used by the reversibility property test, and safe to call in production before the
 * approved classification is written.
 */
export function verifyReversibility(
  approval: ApprovedAdjustment,
  dailyOutcomeBeforeAdjustment: DailyOutcome,
): ReversibilityCheck {
  const holds =
    approval.superseded.classification === dailyOutcomeBeforeAdjustment.classification &&
    approval.superseded.lwpValue === dailyOutcomeBeforeAdjustment.lwpValue &&
    approval.superseded.payableDays === dailyOutcomeBeforeAdjustment.payableDays;
  return Object.freeze({
    holds,
    recordedSupersededClassification: approval.superseded.classification,
    expectedSupersededClassification: dailyOutcomeBeforeAdjustment.classification,
    recordedSupersededLwpValue: approval.superseded.lwpValue,
    expectedSupersededLwpValue: dailyOutcomeBeforeAdjustment.lwpValue,
  });
}
