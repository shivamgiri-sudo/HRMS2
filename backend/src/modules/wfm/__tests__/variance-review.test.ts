// backend/src/modules/wfm/__tests__/variance-review.test.ts
//
// Requirement 7 (Dual Review) and Requirement 8 (Review Outcomes And Adjustment Authority).
// Everything here is a pure call: no database, no clock, no fixtures to seed. The reference date
// of criterion 7.8 and the recording timestamp of criterion 7.3 are arguments, so the SLA tests
// assert exact whole-day boundaries instead of sleeping.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_ESCALATION_AGE_DAYS,
  MIN_REVIEWER_COMMENT_LENGTH,
  applyApprovedAdjustment,
  approveAdjustmentRequest,
  assessOutcomeConflict,
  authorizeReviewer,
  buildAdjustmentRequest,
  describeForReport,
  evaluateEscalation,
  isQueuedForDualReview,
  normalizeReviewerComment,
  presentForDualReview,
  recordReviewOutcome,
  revertApprovedAdjustment,
  verifyReversibility,
  wholeDaysBetween,
  type AdjustmentRequest,
  type DailyOutcome,
  type QueuedVarianceRecord,
  type RecordedNotQueuedVarianceRecord,
  type RecordedReview,
  type ReviewAuthority,
  type ReviewerRole,
  type ReviewEvidence,
  type VarianceRecord,
} from '../variance-review.js';
import { evaluateVariance, type DayClassification } from '../attendance-variance.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

const EMPLOYEE_ID = 'emp-0001';
const EMPLOYEE_USER_ID = 'user-emp-0001';
const BRANCH_ID = 'branch-cbd';
const WFM_USER = 'user-wfm-1';
const MANAGER_USER = 'user-mgr-1';
const BRANCH_WFM_CONTACT = 'user-branch-wfm-poc';
const OVERRIDE_APPROVER = 'user-override-1';

// A real VarianceEvaluation from attendance-variance.ts rather than a hand-written literal, so the
// evidence criterion 7.2 presents is the figures the variance decision was actually taken on.
const EVALUATION = evaluateVariance({
  resolvedSource: 'biometric',
  evidence: { state: 'present', minutes: 120, rule: 'interval_union' },
  biometricMinutes: 480,
  dayClassification: 'present',
});

const EVIDENCE: ReviewEvidence = {
  evaluation: EVALUATION,
  diallerSourceContributions: [
    { diallerSourceId: 'src-vici', diallerSourceName: 'ViciDial', minutes: 120 },
    { diallerSourceId: 'src-manual', diallerSourceName: 'Manual upload', minutes: null },
  ],
  biometricPunches: [
    { punchAt: '2026-07-01T09:02:00', direction: 'in' },
    { punchAt: '2026-07-01T17:04:00', direction: 'out' },
  ],
};

const DAILY_OUTCOME: DailyOutcome = {
  classification: 'present',
  lwpValue: 0,
  payableDays: 1,
};

function queuedRecord(overrides: Partial<QueuedVarianceRecord> = {}): QueuedVarianceRecord {
  return {
    id: 'vr-1',
    employeeId: EMPLOYEE_ID,
    employeeUserId: EMPLOYEE_USER_ID,
    branchId: BRANCH_ID,
    workDate: '2026-07-01',
    payMonth: '2026-07',
    status: 'open',
    evidence: EVIDENCE,
    dailyOutcome: DAILY_OUTCOME,
    authorizedWfmReviewerUserIds: [WFM_USER],
    reportingManagerUserId: MANAGER_USER,
    branchWfmContactUserId: BRANCH_WFM_CONTACT,
    overrideApproverUserIds: [OVERRIDE_APPROVER],
    wfmReview: null,
    managerReview: null,
    presentedAt: '2026-07-02',
    lastEscalatedAt: null,
    escalationAgeDays: null,
    escalationIntervalDays: null,
    queueState: 'queued_for_dual_review',
    ...overrides,
  };
}

function notQueuedRecord(): RecordedNotQueuedVarianceRecord {
  return { ...queuedRecord(), queueState: 'recorded_not_queued' };
}

/** Obtains the criterion 7.7 authority the way production must: through authorizeReviewer. */
function authorityFor(record: QueuedVarianceRecord, role: ReviewerRole): ReviewAuthority {
  const userId =
    role === 'wfm_reviewer'
      ? record.authorizedWfmReviewerUserIds[0]
      : (record.reportingManagerUserId ?? record.branchWfmContactUserId);
  const result = authorizeReviewer(record, { userId: String(userId), role });
  if (!result.ok) throw new Error(`fixture could not authorize ${role}: ${result.rejection.code}`);
  return result.authority;
}

const LONG_COMMENT = 'Biometric punches match the roster; the dialler feed is missing entirely.';

// ── criterion 7.4: how a reviewer comment is measured ─────────────────────────────────────────

describe('normalizeReviewerComment (criterion 7.4)', () => {
  it('counts Unicode code points of the trimmed, whitespace-collapsed comment', () => {
    expect(normalizeReviewerComment('  hello   world  ')).toEqual({
      normalized: 'hello world',
      length: 11,
    });
  });

  it('a comment of twenty spaces counts zero, not twenty', () => {
    const twentySpaces = ' '.repeat(20);
    expect(twentySpaces).toHaveLength(20);
    expect(normalizeReviewerComment(twentySpaces)).toEqual({ normalized: '', length: 0 });
  });

  it('no-break-space padding does not manufacture length', () => {
    const padded = `valid${'\u00A0'.repeat(30)}x`;
    expect(normalizeReviewerComment(padded)).toEqual({ normalized: 'valid x', length: 7 });
  });

  it('zero-width padding is deleted outright', () => {
    expect(normalizeReviewerComment(`short${'\u200B'.repeat(40)}`)).toEqual({
      normalized: 'short',
      length: 5,
    });
  });

  it('an astral character counts as one character, not two UTF-16 units', () => {
    const twentyEmoji = '\u{1F44D}'.repeat(20);
    expect(twentyEmoji.length).toBe(40);
    expect(normalizeReviewerComment(twentyEmoji).length).toBe(20);
  });

  it('null and undefined count zero rather than throwing', () => {
    expect(normalizeReviewerComment(null).length).toBe(0);
    expect(normalizeReviewerComment(undefined).length).toBe(0);
  });
});

describe('recordReviewOutcome comment floor (criterion 7.4)', () => {
  const nineteen = 'Punchesarecorrect12';
  const twenty = 'Punchesarecorrect123';

  it('the fixtures really are 19 and 20 characters', () => {
    expect(normalizeReviewerComment(nineteen).length).toBe(19);
    expect(normalizeReviewerComment(twenty).length).toBe(MIN_REVIEWER_COMMENT_LENGTH);
  });

  for (const outcome of ['apr_disputed', 'adjustment_requested'] as const) {
    it(`rejects a 19-character comment on ${outcome}`, () => {
      const record = queuedRecord();
      const result = recordReviewOutcome({
        record,
        authority: authorityFor(record, 'wfm_reviewer'),
        submission:
          outcome === 'apr_disputed'
            ? { outcome, comment: nineteen }
            : { outcome, comment: nineteen, requestedClassification: 'absent' },
        recordedAt: '2026-07-03T10:00:00Z',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejection.code).toBe('comment_too_short');
      expect(result.rejection.criteria).toEqual(['7.4']);
      expect(result.rejection.message).toContain('19');
    });

    it(`accepts a 20-character comment on ${outcome}`, () => {
      const record = queuedRecord();
      const result = recordReviewOutcome({
        record,
        authority: authorityFor(record, 'wfm_reviewer'),
        submission:
          outcome === 'apr_disputed'
            ? { outcome, comment: twenty }
            : { outcome, comment: twenty, requestedClassification: 'absent' },
        recordedAt: '2026-07-03T10:00:00Z',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.recorded.outcome).toBe(outcome);
      expect(result.recorded.comment).toBe(twenty);
    });
  }

  it('rejects a 20-character comment made of pure whitespace', () => {
    const record = queuedRecord();
    const result = recordReviewOutcome({
      record,
      authority: authorityFor(record, 'wfm_reviewer'),
      submission: { outcome: 'apr_disputed', comment: ' '.repeat(20) },
      recordedAt: '2026-07-03T10:00:00Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('comment_too_short');
    expect(result.rejection.message).toContain('counts 0');
  });

  it('apr_accepted needs no comment at all', () => {
    const record = queuedRecord();
    const result = recordReviewOutcome({
      record,
      authority: authorityFor(record, 'wfm_reviewer'),
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-03T10:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recorded.comment).toBe('');
  });
});

// ── criterion 7.7: self-review ────────────────────────────────────────────────────────────────

describe('authorizeReviewer (criteria 7.1, 7.6, 7.7)', () => {
  it('refuses the employee named on the record, by their login', () => {
    const record = queuedRecord({ authorizedWfmReviewerUserIds: [WFM_USER, EMPLOYEE_USER_ID] });
    const result = authorizeReviewer(record, { userId: EMPLOYEE_USER_ID, role: 'wfm_reviewer' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('self_review_not_permitted');
    expect(result.rejection.criteria).toEqual(['7.7']);
    expect(result.rejection.message).toContain('Self-review is not permitted');
  });

  it('refuses the employee named on the record when only the employee row matches', () => {
    // The employee reviewing under a second login: the user ids differ, the person does not.
    const record = queuedRecord({
      employeeUserId: null,
      reportingManagerUserId: 'user-other-login',
    });
    const result = authorizeReviewer(record, {
      userId: 'user-other-login',
      employeeId: EMPLOYEE_ID,
      role: 'reporting_manager',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('self_review_not_permitted');
  });

  it('refuses self-review before it refuses eligibility, so the message never leaks a route in', () => {
    // The employee is not in WFM scope either; the refusal must still name self-review.
    const record = queuedRecord();
    const result = authorizeReviewer(record, { userId: EMPLOYEE_USER_ID, role: 'wfm_reviewer' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('self_review_not_permitted');
  });

  it('refuses a WFM_Reviewer whose scope does not contain the employee (criterion 7.1)', () => {
    const record = queuedRecord();
    const result = authorizeReviewer(record, { userId: 'user-wfm-other', role: 'wfm_reviewer' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('reviewer_not_in_scope');
  });

  it('refuses a user who is not the Reporting_Manager (criterion 7.1)', () => {
    const record = queuedRecord();
    const result = authorizeReviewer(record, { userId: 'user-mgr-2', role: 'reporting_manager' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('not_the_reporting_manager');
  });

  it('authorizes the WFM_Reviewer and the Reporting_Manager with no substitution', () => {
    const record = queuedRecord();
    const wfm = authorizeReviewer(record, { userId: WFM_USER, role: 'wfm_reviewer' });
    const mgr = authorizeReviewer(record, { userId: MANAGER_USER, role: 'reporting_manager' });
    expect(wfm.ok && wfm.authority.substitution).toBeNull();
    expect(mgr.ok && mgr.authority.substitution).toBeNull();
    expect(wfm.ok && wfm.authority.recordId).toBe('vr-1');
  });
});

// ── criterion 7.6: the branch WFM substitution ────────────────────────────────────────────────

describe('criterion 7.6 manager substitution (1 of 1,123 employees)', () => {
  const noManager = () => queuedRecord({ reportingManagerUserId: null });

  it('presents the second slot to the branch workforce-management point of contact', () => {
    const presentation = presentForDualReview(noManager());
    expect(presentation.presented).toBe(true);
    if (!presentation.presented) return;
    expect(presentation.substitution).toEqual({
      kind: 'branch_wfm_point_of_contact',
      substituteUserId: BRANCH_WFM_CONTACT,
      reason: 'employee_has_no_reporting_manager',
    });
    expect(presentation.reviewers).toEqual([
      { role: 'wfm_reviewer', userId: WFM_USER, substituted: false },
      { role: 'reporting_manager', userId: BRANCH_WFM_CONTACT, substituted: true },
    ]);
  });

  it('records the substitution on the stored review', () => {
    const record = noManager();
    const result = recordReviewOutcome({
      record,
      authority: authorityFor(record, 'reporting_manager'),
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-03T10:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recorded.userId).toBe(BRANCH_WFM_CONTACT);
    expect(result.recorded.substitution).toEqual({
      kind: 'branch_wfm_point_of_contact',
      substituteUserId: BRANCH_WFM_CONTACT,
      reason: 'employee_has_no_reporting_manager',
    });
    expect(describeForReport(result.record).managerSubstituted).toBe(true);
  });

  it('refuses anyone else for the substituted slot', () => {
    const result = authorizeReviewer(noManager(), {
      userId: 'user-random',
      role: 'reporting_manager',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('not_the_reporting_manager');
    expect(result.rejection.criteria).toEqual(['7.1', '7.6']);
  });

  it('states that no second reviewer exists when the branch has no point of contact either', () => {
    const record = queuedRecord({ reportingManagerUserId: null, branchWfmContactUserId: null });
    const result = authorizeReviewer(record, { userId: 'user-anyone', role: 'reporting_manager' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('no_manager_reviewer_available');
    expect(result.rejection.criteria).toEqual(['7.6']);
    // And the presentation offers the WFM slot only, rather than inventing a manager.
    const presentation = presentForDualReview(record);
    expect(presentation.presented && presentation.reviewers).toEqual([
      { role: 'wfm_reviewer', userId: WFM_USER, substituted: false },
    ]);
  });
});

// ── criteria 7.3, 7.5: two reviewers, independently stored ────────────────────────────────────

describe('criteria 7.3 and 7.5: one reviewer, then the second completing it', () => {
  it('stores each reviewer independently and marks reviewed only when both have recorded', () => {
    const record = queuedRecord();

    const first = recordReviewOutcome({
      record,
      authority: authorityFor(record, 'wfm_reviewer'),
      submission: { outcome: 'apr_disputed', comment: LONG_COMMENT },
      recordedAt: '2026-07-03T10:00:00Z',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.dualReviewComplete).toBe(false);
    expect(first.statusAfter).toBe('open');
    expect(first.record.wfmReview).toEqual({
      outcome: 'apr_disputed',
      role: 'wfm_reviewer',
      userId: WFM_USER,
      recordedAt: '2026-07-03T10:00:00Z',
      comment: LONG_COMMENT,
      substitution: null,
    });
    expect(first.record.managerReview).toBeNull();
    // The input record is untouched: this module returns new values, it mutates nothing.
    expect(record.wfmReview).toBeNull();

    const second = recordReviewOutcome({
      record: first.record,
      authority: authorityFor(first.record, 'reporting_manager'),
      submission: { outcome: 'apr_disputed', comment: 'The team was on a client call all day.' },
      recordedAt: '2026-07-04T08:30:00Z',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.dualReviewComplete).toBe(true);
    expect(second.statusAfter).toBe('reviewed');
    expect(second.conflict).toEqual({ conflicting: false, reason: 'identical_outcomes' });
    expect(second.routing).toBeNull();
    // criterion 7.3: two outcomes, two users, two timestamps, two comments.
    expect(second.record.wfmReview?.recordedAt).toBe('2026-07-03T10:00:00Z');
    expect(second.record.managerReview?.recordedAt).toBe('2026-07-04T08:30:00Z');
    expect(second.record.wfmReview?.comment).not.toBe(second.record.managerReview?.comment);
  });

  it('refuses a second outcome for a slot that already holds one', () => {
    const record = queuedRecord();
    const first = recordReviewOutcome({
      record,
      authority: authorityFor(record, 'wfm_reviewer'),
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-03T10:00:00Z',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = recordReviewOutcome({
      record: first.record,
      authority: authorityFor(first.record, 'wfm_reviewer'),
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-03T11:00:00Z',
    });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.rejection.code).toBe('outcome_already_recorded_for_role');
  });

  it('refuses recording on a closed record, contested included', () => {
    for (const status of ['reviewed', 'contested', 'no_issue', 'regularization_required'] as const) {
      const record = queuedRecord({ status });
      const result = recordReviewOutcome({
        record,
        authority: authorityFor(record, 'wfm_reviewer'),
        submission: { outcome: 'apr_accepted' },
        recordedAt: '2026-07-03T10:00:00Z',
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.rejection.code).toBe('record_already_closed');
    }
  });

  it('refuses an authority issued for a different Variance_Record', () => {
    const recordA = queuedRecord({ id: 'vr-A' });
    const recordB = queuedRecord({ id: 'vr-B' });
    const result = recordReviewOutcome({
      record: recordB,
      authority: authorityFor(recordA, 'wfm_reviewer'),
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-03T10:00:00Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('authority_record_mismatch');
  });

  it('still refuses self-review when the branded authority is forged by a cast (criterion 7.7)', () => {
    const record = queuedRecord();
    const forged = {
      recordId: record.id,
      userId: EMPLOYEE_USER_ID,
      role: 'wfm_reviewer',
      substitution: null,
    } as unknown as ReviewAuthority;
    const result = recordReviewOutcome({
      record,
      authority: forged,
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-03T10:00:00Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('self_review_not_permitted');
  });
});

// ── criterion 7.10: conflicting outcomes ──────────────────────────────────────────────────────

function review(
  role: ReviewerRole,
  outcome: 'apr_accepted' | 'apr_disputed',
): RecordedReview;
function review(
  role: ReviewerRole,
  outcome: 'adjustment_requested',
  requestedClassification: DayClassification,
  requestedLwpValue?: number | null,
): RecordedReview;
function review(
  role: ReviewerRole,
  outcome: RecordedReview['outcome'],
  requestedClassification: DayClassification = 'absent',
  requestedLwpValue: number | null = null,
): RecordedReview {
  const common = {
    role,
    userId: role === 'wfm_reviewer' ? WFM_USER : MANAGER_USER,
    recordedAt: '2026-07-03T10:00:00Z',
    comment: LONG_COMMENT,
    substitution: null,
  } as const;
  if (outcome === 'adjustment_requested') {
    return { outcome, ...common, requestedClassification, requestedLwpValue };
  }
  return { outcome, ...common };
}

describe('assessOutcomeConflict (criterion 7.10) — every pair', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly a: RecordedReview;
    readonly b: RecordedReview;
    readonly conflicting: boolean;
    readonly reason: string;
  }> = [
    {
      name: 'accepted + accepted',
      a: review('wfm_reviewer', 'apr_accepted'),
      b: review('reporting_manager', 'apr_accepted'),
      conflicting: false,
      reason: 'identical_outcomes',
    },
    {
      name: 'disputed + disputed',
      a: review('wfm_reviewer', 'apr_disputed'),
      b: review('reporting_manager', 'apr_disputed'),
      conflicting: false,
      reason: 'identical_outcomes',
    },
    {
      name: 'accepted + disputed',
      a: review('wfm_reviewer', 'apr_accepted'),
      b: review('reporting_manager', 'apr_disputed'),
      conflicting: true,
      reason: 'accepted_versus_disputed',
    },
    {
      name: 'accepted + adjustment_requested',
      a: review('wfm_reviewer', 'apr_accepted'),
      b: review('reporting_manager', 'adjustment_requested', 'absent'),
      conflicting: true,
      reason: 'accepted_versus_adjustment',
    },
    {
      name: 'disputed + adjustment_requested',
      a: review('wfm_reviewer', 'apr_disputed'),
      b: review('reporting_manager', 'adjustment_requested', 'absent'),
      conflicting: false,
      reason: 'dispute_and_adjustment_agree_on_the_finding',
    },
    {
      name: 'adjustment_requested x2, same classification and LWP',
      a: review('wfm_reviewer', 'adjustment_requested', 'half_day', 0.5),
      b: review('reporting_manager', 'adjustment_requested', 'half_day', 0.5),
      conflicting: false,
      reason: 'same_requested_adjustment',
    },
    {
      name: 'adjustment_requested x2, DIFFERENT classification',
      a: review('wfm_reviewer', 'adjustment_requested', 'absent'),
      b: review('reporting_manager', 'adjustment_requested', 'half_day'),
      conflicting: true,
      reason: 'divergent_requested_adjustments',
    },
    {
      name: 'adjustment_requested x2, same classification but DIFFERENT LWP',
      a: review('wfm_reviewer', 'adjustment_requested', 'half_day', 0.5),
      b: review('reporting_manager', 'adjustment_requested', 'half_day', 1),
      conflicting: true,
      reason: 'divergent_requested_adjustments',
    },
  ];

  for (const c of cases) {
    it(`${c.name} -> ${c.conflicting ? 'conflict' : 'agree'} (${c.reason})`, () => {
      expect(assessOutcomeConflict(c.a, c.b)).toEqual({
        conflicting: c.conflicting,
        reason: c.reason,
      });
      // The verdict cannot depend on which reviewer recorded first.
      expect(assessOutcomeConflict(c.b, c.a)).toEqual({
        conflicting: c.conflicting,
        reason: c.reason,
      });
    });
  }
});

describe('criterion 7.10 routing', () => {
  it('marks the record contested and routes it to the branch Override_Approver', () => {
    const record = queuedRecord();
    const first = recordReviewOutcome({
      record,
      authority: authorityFor(record, 'wfm_reviewer'),
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-03T10:00:00Z',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = recordReviewOutcome({
      record: first.record,
      authority: authorityFor(first.record, 'reporting_manager'),
      submission: { outcome: 'apr_disputed', comment: LONG_COMMENT },
      recordedAt: '2026-07-04T10:00:00Z',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.statusAfter).toBe('contested');
    expect(second.record.status).toBe('contested');
    expect(second.routing).toEqual({
      reason: 'conflicting_review_outcomes',
      conflictReason: 'accepted_versus_disputed',
      branchId: BRANCH_ID,
      overrideApproverUserIds: [OVERRIDE_APPROVER],
      unroutable: false,
    });
  });

  it('flags a branch with no Override_Approver as unroutable rather than silently dropping it', () => {
    const record = queuedRecord({
      overrideApproverUserIds: [],
      wfmReview: review('wfm_reviewer', 'apr_accepted'),
    });
    const result = recordReviewOutcome({
      record,
      authority: authorityFor(record, 'reporting_manager'),
      submission: { outcome: 'adjustment_requested', comment: LONG_COMMENT, requestedClassification: 'absent' },
      recordedAt: '2026-07-04T10:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.statusAfter).toBe('contested');
    expect(result.routing?.unroutable).toBe(true);
  });

  it('two adjustment requests for different classifications contest the record', () => {
    const record = queuedRecord({
      wfmReview: review('wfm_reviewer', 'adjustment_requested', 'absent', 1),
    });
    const result = recordReviewOutcome({
      record,
      authority: authorityFor(record, 'reporting_manager'),
      submission: {
        outcome: 'adjustment_requested',
        comment: LONG_COMMENT,
        requestedClassification: 'half_day',
        requestedLwpValue: 0.5,
      },
      recordedAt: '2026-07-04T10:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conflict).toEqual({
      conflicting: true,
      reason: 'divergent_requested_adjustments',
    });
    expect(result.statusAfter).toBe('contested');
    expect(result.routing?.conflictReason).toBe('divergent_requested_adjustments');
    // criterion 8.2 still produced the request; only an Override_Approver can act on it.
    expect(result.adjustmentRequest?.requestedClassification).toBe('half_day');
  });

  it('two adjustment requests for the SAME classification mark the record reviewed', () => {
    const record = queuedRecord({
      wfmReview: review('wfm_reviewer', 'adjustment_requested', 'half_day', 0.5),
    });
    const result = recordReviewOutcome({
      record,
      authority: authorityFor(record, 'reporting_manager'),
      submission: {
        outcome: 'adjustment_requested',
        comment: LONG_COMMENT,
        requestedClassification: 'half_day',
        requestedLwpValue: 0.5,
      },
      recordedAt: '2026-07-04T10:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.statusAfter).toBe('reviewed');
    expect(result.routing).toBeNull();
  });
});

// ── criterion 7.1: a Recorded_Not_Queued record is never presented ────────────────────────────

describe('criterion 7.1: Recorded_Not_Queued', () => {
  it('is never presented for Dual_Review, but says it stays reportable', () => {
    const presentation = presentForDualReview(notQueuedRecord());
    expect(presentation).toEqual({
      presented: false,
      recordId: 'vr-1',
      reason: 'recorded_not_queued',
      retrievableForReporting: true,
    });
    // There is no `evidence` member on the not-presented arm to read at all.
    expect((presentation as { evidence?: unknown }).evidence).toBeUndefined();
  });

  it('is retrievable and reportable', () => {
    const row = describeForReport(notQueuedRecord());
    expect(row).toEqual({
      recordId: 'vr-1',
      employeeId: EMPLOYEE_ID,
      branchId: BRANCH_ID,
      workDate: '2026-07-01',
      payMonth: '2026-07',
      queueState: 'recorded_not_queued',
      status: 'open',
      varianceRiskScore: 360,
      presentedForDualReview: false,
      wfmOutcome: null,
      managerOutcome: null,
      managerSubstituted: false,
    });
  });

  it('is refused by the review entry points even when the type guard is bypassed', () => {
    // The parameter type of recordReviewOutcome / evaluateEscalation already excludes this record;
    // the cast is what a route deserializing untyped JSON could do, and the runtime guard holds.
    const smuggled = notQueuedRecord() as unknown as QueuedVarianceRecord;
    const queued = queuedRecord();
    const recorded = recordReviewOutcome({
      record: smuggled,
      authority: authorityFor(queued, 'wfm_reviewer'),
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-03T10:00:00Z',
    });
    expect(recorded.ok).toBe(false);
    if (recorded.ok) return;
    expect(recorded.rejection.code).toBe('record_not_queued_for_dual_review');
    expect(recorded.rejection.criteria).toEqual(['7.1']);

    const escalation = evaluateEscalation({
      record: smuggled,
      referenceDate: '2027-01-01',
      ladder: { wfmReviewerNextLevelUserId: 'user-head', reportingManagerNextLevelUserId: 'user-head' },
    });
    expect(escalation.due).toBe(false);
    expect(escalation.reason).toBe('record_not_queued');
    expect(escalation.notifications).toEqual([]);

    // And authorization itself refuses, so no authority for it can ever be minted.
    const authorized = authorizeReviewer(smuggled, { userId: WFM_USER, role: 'wfm_reviewer' });
    expect(authorized.ok).toBe(false);
  });

  it('isQueuedForDualReview narrows the union', () => {
    const records: VarianceRecord[] = [queuedRecord(), notQueuedRecord()];
    expect(records.filter(isQueuedForDualReview)).toHaveLength(1);
  });
});

describe('criterion 7.2: the evidence presented', () => {
  it('presents both minute figures, the applied threshold, the resolved source, the punches and the per-source contributions', () => {
    const presentation = presentForDualReview(queuedRecord());
    expect(presentation.presented).toBe(true);
    if (!presentation.presented) return;
    const { evaluation } = presentation.evidence;
    expect(evaluation.biometricMinutes).toBe(480);
    expect(evaluation.canonicalProductiveMinutes).toBe(120);
    expect(evaluation.appliedCorroborationThresholdMinutes).toBe(480);
    expect(evaluation.resolvedAttendanceSource).toBe('biometric');
    expect(presentation.evidence.biometricPunches).toHaveLength(2);
    expect(presentation.evidence.diallerSourceContributions[1].minutes).toBeNull();
    expect(presentation.missingReviewerSlots).toEqual(['wfm_reviewer', 'reporting_manager']);
  });

  it('stops presenting once both slots hold an outcome', () => {
    const record = queuedRecord({
      status: 'reviewed',
      wfmReview: review('wfm_reviewer', 'apr_accepted'),
      managerReview: review('reporting_manager', 'apr_accepted'),
    });
    expect(presentForDualReview(record)).toMatchObject({
      presented: false,
      reason: 'review_already_complete',
    });
  });
});

// ── criteria 7.8, 7.9: escalation in whole days ───────────────────────────────────────────────

const LADDER = {
  wfmReviewerNextLevelUserId: 'user-wfm-head',
  reportingManagerNextLevelUserId: 'user-ops-head',
};

describe('wholeDaysBetween (criteria 7.8, 7.9)', () => {
  it('counts calendar days and ignores the time of day', () => {
    expect(wholeDaysBetween('2026-07-01', '2026-07-04')).toBe(3);
    expect(wholeDaysBetween('2026-07-01T23:59:59Z', '2026-07-04T00:00:01Z')).toBe(3);
    expect(wholeDaysBetween('2026-07-01T00:00:00+05:30', '2026-07-04T23:30:00-08:00')).toBe(3);
  });

  it('crosses a month and a leap day without drift', () => {
    expect(wholeDaysBetween('2028-02-27', '2028-03-01')).toBe(3);
    expect(wholeDaysBetween('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('is negative when the reference date precedes the start', () => {
    expect(wholeDaysBetween('2026-07-04', '2026-07-01')).toBe(-3);
  });

  it('throws for a malformed or non-existent date (programmer error, not data)', () => {
    expect(() => wholeDaysBetween('yesterday', '2026-07-04')).toThrow(RangeError);
    expect(() => wholeDaysBetween('2026-02-31', '2026-07-04')).toThrow(/does not exist/);
    expect(() => wholeDaysBetween('01-07-2026', '2026-07-04')).toThrow(RangeError);
  });
});

describe('evaluateEscalation (criteria 7.8, 7.9)', () => {
  const presented = (overrides: Partial<QueuedVarianceRecord> = {}) =>
    queuedRecord({ presentedAt: '2026-07-01', status: 'notified', ...overrides });

  it('applies three whole days when the escalation age is unconfigured (criterion 7.9)', () => {
    const result = evaluateEscalation({
      record: presented(),
      referenceDate: '2026-07-04',
      ladder: LADDER,
    });
    expect(result.appliedEscalationAgeDays).toBe(DEFAULT_ESCALATION_AGE_DAYS);
    expect(result.appliedEscalationAgeDays).toBe(3);
  });

  it('is due at exactly three whole days, not before', () => {
    const twoDays = evaluateEscalation({
      record: presented(),
      referenceDate: '2026-07-03',
      ladder: LADDER,
    });
    expect(twoDays.ageInWholeDays).toBe(2);
    expect(twoDays.due).toBe(false);
    expect(twoDays.reason).toBe('age_below_escalation_age');

    const threeDays = evaluateEscalation({
      record: presented(),
      referenceDate: '2026-07-04',
      ladder: LADDER,
    });
    expect(threeDays.ageInWholeDays).toBe(3);
    expect(threeDays.due).toBe(true);
    expect(threeDays.reason).toBe('due');

    const fourDays = evaluateEscalation({
      record: presented(),
      referenceDate: '2026-07-05',
      ladder: LADDER,
    });
    expect(fourDays.ageInWholeDays).toBe(4);
    expect(fourDays.due).toBe(true);
  });

  it('does not let the time of day or a timezone shift the boundary', () => {
    // Presented late in the evening, checked just after midnight three dates later: still 3.
    const late = evaluateEscalation({
      record: presented({ presentedAt: '2026-07-01T23:45:00+05:30' }),
      referenceDate: '2026-07-04T00:05:00Z',
      ladder: LADDER,
    });
    expect(late.ageInWholeDays).toBe(3);
    expect(late.due).toBe(true);

    // And two dates later it is still 2, however the hours line up.
    const early = evaluateEscalation({
      record: presented({ presentedAt: '2026-07-01T00:05:00Z' }),
      referenceDate: '2026-07-03T23:45:00+05:30',
      ladder: LADDER,
    });
    expect(early.ageInWholeDays).toBe(2);
    expect(early.due).toBe(false);
  });

  it('names the pending reviewers next escalation level for each empty slot', () => {
    const result = evaluateEscalation({
      record: presented({ wfmReview: review('wfm_reviewer', 'apr_accepted') }),
      referenceDate: '2026-07-06',
      ladder: LADDER,
    });
    expect(result.due).toBe(true);
    expect(result.pendingRoles).toEqual(['reporting_manager']);
    expect(result.notifications).toEqual([
      {
        pendingRole: 'reporting_manager',
        pendingReviewerUserId: MANAGER_USER,
        notifyUserId: 'user-ops-head',
        recordId: 'vr-1',
        employeeId: EMPLOYEE_ID,
        branchId: BRANCH_ID,
        workDate: '2026-07-01',
        ageInWholeDays: 5,
      },
    ]);
  });

  it('suppresses a second notification until the interval has elapsed, in whole days', () => {
    const record = presented({ escalationAgeDays: 3, escalationIntervalDays: 3 });

    const tooSoon = evaluateEscalation({
      record: { ...record, lastEscalatedAt: '2026-07-04' },
      referenceDate: '2026-07-06',
      ladder: LADDER,
    });
    expect(tooSoon.daysSinceLastEscalation).toBe(2);
    expect(tooSoon.due).toBe(false);
    expect(tooSoon.reason).toBe('interval_not_elapsed');
    expect(tooSoon.notifications).toEqual([]);

    const elapsed = evaluateEscalation({
      record: { ...record, lastEscalatedAt: '2026-07-04' },
      referenceDate: '2026-07-07',
      ladder: LADDER,
    });
    expect(elapsed.daysSinceLastEscalation).toBe(3);
    expect(elapsed.due).toBe(true);
  });

  it('reuses the escalation age as the interval when the interval is unconfigured, and warns', () => {
    const result = evaluateEscalation({
      record: presented({ escalationAgeDays: 4, escalationIntervalDays: null }),
      referenceDate: '2026-07-10',
      ladder: LADDER,
    });
    expect(result.appliedEscalationIntervalDays).toBe(4);
    expect(result.configurationWarnings.join(' ')).toContain('No escalation interval is configured');
  });

  it('falls back to three days and warns when the configured age is not a positive whole number', () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      const result = evaluateEscalation({
        record: presented({ escalationAgeDays: bad }),
        referenceDate: '2026-07-04',
        ladder: LADDER,
      });
      expect(result.appliedEscalationAgeDays).toBe(3);
      expect(result.configurationWarnings.join(' ')).toContain('escalation age');
    }
  });

  it('does not escalate a reviewed, closed, unpresented or future-presented record', () => {
    const complete = evaluateEscalation({
      record: presented({
        wfmReview: review('wfm_reviewer', 'apr_accepted'),
        managerReview: review('reporting_manager', 'apr_accepted'),
      }),
      referenceDate: '2027-01-01',
      ladder: LADDER,
    });
    expect(complete).toMatchObject({ due: false, reason: 'review_already_complete' });

    expect(
      evaluateEscalation({
        record: presented({ status: 'contested' }),
        referenceDate: '2027-01-01',
        ladder: LADDER,
      }),
    ).toMatchObject({ due: false, reason: 'record_closed' });

    expect(
      evaluateEscalation({
        record: presented({ presentedAt: null }),
        referenceDate: '2027-01-01',
        ladder: LADDER,
      }),
    ).toMatchObject({ due: false, reason: 'not_presented', ageInWholeDays: null });

    expect(
      evaluateEscalation({
        record: presented({ presentedAt: '2026-07-10' }),
        referenceDate: '2026-07-04',
        ladder: LADDER,
      }),
    ).toMatchObject({ due: false, reason: 'presented_after_reference_date', ageInWholeDays: -6 });
  });

  it('reports pending reviewers with no escalation level instead of pretending to notify', () => {
    const result = evaluateEscalation({
      record: presented(),
      referenceDate: '2026-07-30',
      ladder: { wfmReviewerNextLevelUserId: null, reportingManagerNextLevelUserId: null },
    });
    expect(result.due).toBe(false);
    expect(result.reason).toBe('no_escalation_target');
    expect(result.pendingRolesWithoutEscalationTarget).toEqual([
      'wfm_reviewer',
      'reporting_manager',
    ]);
  });
});

// ── Requirement 8: adjustment authority ───────────────────────────────────────────────────────

const CUT_OFF_OPEN = {
  payMonth: '2026-07',
  reachedCutOff: false,
  earliestOpenPayMonth: '2026-07',
};

function requestFrom(record = queuedRecord()): AdjustmentRequest {
  const result = recordReviewOutcome({
    record,
    authority: authorityFor(record, 'wfm_reviewer'),
    submission: {
      outcome: 'adjustment_requested',
      comment: LONG_COMMENT,
      requestedClassification: 'absent',
      requestedLwpValue: 1,
    },
    recordedAt: '2026-07-03T10:00:00Z',
  });
  if (!result.ok || result.adjustmentRequest === null) {
    throw new Error('fixture failed to build an adjustment request');
  }
  return result.adjustmentRequest;
}

describe('criterion 8.2: adjustment_requested creates a request', () => {
  it('states the requested classification and the requesting reviewers justification', () => {
    const request = requestFrom();
    expect(request).toEqual({
      varianceRecordId: 'vr-1',
      employeeId: EMPLOYEE_ID,
      branchId: BRANCH_ID,
      targetDate: '2026-07-01',
      payMonth: '2026-07',
      requestedClassification: 'absent',
      requestedLwpValue: 1,
      requestingUserId: WFM_USER,
      requestingRole: 'wfm_reviewer',
      justification: LONG_COMMENT,
      requestedAt: '2026-07-03T10:00:00Z',
      dailyOutcomeAtRequest: DAILY_OUTCOME,
    });
  });

  it('buildAdjustmentRequest accepts only the adjustment_requested arm (criterion 8.1)', () => {
    const accepted = review('wfm_reviewer', 'apr_accepted');
    // @ts-expect-error criterion 8.1: an apr_accepted review has no channel to a pay change.
    buildAdjustmentRequest(queuedRecord(), accepted);
  });
});

describe('criterion 8.1: apr_accepted and apr_disputed change nothing', () => {
  for (const outcome of ['apr_accepted', 'apr_disputed'] as const) {
    it(`${outcome} returns the day untouched and raises no request`, () => {
      const record = queuedRecord();
      const result = recordReviewOutcome({
        record,
        authority: authorityFor(record, 'wfm_reviewer'),
        submission:
          outcome === 'apr_accepted' ? { outcome } : { outcome, comment: LONG_COMMENT },
        recordedAt: '2026-07-03T10:00:00Z',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Identity, not equality: the very object that came in.
      expect(result.dailyOutcome).toBe(record.dailyOutcome);
      expect(result.adjustmentRequest).toBeNull();
      expect(result.record.dailyOutcome).toBe(record.dailyOutcome);
      // And the stored review has no classification member at all.
      expect((result.recorded as { requestedClassification?: unknown }).requestedClassification)
        .toBeUndefined();
      expect((result.recorded as { requestedLwpValue?: unknown }).requestedLwpValue).toBeUndefined();
    });
  }
});

describe('criteria 8.3 to 8.6: who may approve', () => {
  it('approves for an Override_Approver of the branch and records the superseded state', () => {
    const request = requestFrom();
    const result = approveAdjustmentRequest({
      request,
      approvingUserId: OVERRIDE_APPROVER,
      approverOverrideApproverBranchIds: [BRANCH_ID],
      payMonthCutOff: CUT_OFF_OPEN,
      dailyOutcomeBeforeAdjustment: DAILY_OUTCOME,
      approvedAt: '2026-07-05T09:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approval).toEqual({
      varianceRecordId: 'vr-1',
      employeeId: EMPLOYEE_ID,
      branchId: BRANCH_ID,
      targetDate: '2026-07-01',
      payMonth: '2026-07',
      appliedClassification: 'absent',
      appliedLwpValue: 1,
      approvingUserId: OVERRIDE_APPROVER,
      approvedAt: '2026-07-05T09:00:00Z',
      requestingUserId: WFM_USER,
      justification: LONG_COMMENT,
      superseded: DAILY_OUTCOME,
      precedingStateDrifted: false,
    });
    expect(applyApprovedAdjustment(result.approval)).toEqual({
      classification: 'absent',
      lwpValue: 1,
      payableDays: null,
    });
  });

  it('refuses a user without the Override_Approver grant, and returns the refusal to record (criterion 8.4)', () => {
    const request = requestFrom();
    const result = approveAdjustmentRequest({
      request,
      approvingUserId: 'user-nobody',
      approverOverrideApproverBranchIds: [],
      payMonthCutOff: CUT_OFF_OPEN,
      dailyOutcomeBeforeAdjustment: DAILY_OUTCOME,
      approvedAt: '2026-07-05T09:00:00Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('approver_lacks_override_grant');
    expect(result.refusal.criteria).toEqual(['8.4']);
    // Everything an audit row needs, returned rather than thrown.
    expect(result.refusal.attemptedByUserId).toBe('user-nobody');
    expect(result.refusal.attemptedAt).toBe('2026-07-05T09:00:00Z');
    expect(result.refusal.varianceRecordId).toBe('vr-1');
    expect(result.refusal.employeeId).toBe(EMPLOYEE_ID);
    expect(result.refusal.targetDate).toBe('2026-07-01');
    expect(result.refusal.arrearPayMonth).toBeNull();
  });

  it('refuses a grant held for a different branch (criterion 8.4)', () => {
    const result = approveAdjustmentRequest({
      request: requestFrom(),
      approvingUserId: OVERRIDE_APPROVER,
      approverOverrideApproverBranchIds: ['branch-other'],
      payMonthCutOff: CUT_OFF_OPEN,
      dailyOutcomeBeforeAdjustment: DAILY_OUTCOME,
      approvedAt: '2026-07-05T09:00:00Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('approver_lacks_override_grant');
  });

  it('refuses the requesting reviewer approving their own request (criterion 8.5)', () => {
    const request = requestFrom();
    const result = approveAdjustmentRequest({
      request,
      approvingUserId: request.requestingUserId,
      approverOverrideApproverBranchIds: [BRANCH_ID],
      payMonthCutOff: CUT_OFF_OPEN,
      dailyOutcomeBeforeAdjustment: DAILY_OUTCOME,
      approvedAt: '2026-07-05T09:00:00Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('approver_is_requester');
    expect(result.refusal.criteria).toEqual(['8.5']);
    expect(result.refusal.message).toContain('A separate approver is required');
  });

  it('refuses a Pay_Month that has reached Payroll_Cut_Off and names the arrear month (criterion 8.6)', () => {
    const result = approveAdjustmentRequest({
      request: requestFrom(),
      approvingUserId: OVERRIDE_APPROVER,
      approverOverrideApproverBranchIds: [BRANCH_ID],
      payMonthCutOff: {
        payMonth: '2026-07',
        reachedCutOff: true,
        earliestOpenPayMonth: '2026-09',
      },
      dailyOutcomeBeforeAdjustment: DAILY_OUTCOME,
      approvedAt: '2026-10-05T09:00:00Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('pay_month_reached_cut_off');
    expect(result.refusal.criteria).toEqual(['8.6']);
    expect(result.refusal.message).toContain('arrear adjustment path');
    expect(result.refusal.message).toContain('2026-09');
    expect(result.refusal.arrearPayMonth).toBe('2026-09');
  });

  it('reports every refusal that applied, not just the first', () => {
    const request = requestFrom();
    const result = approveAdjustmentRequest({
      request,
      approvingUserId: request.requestingUserId,
      approverOverrideApproverBranchIds: [],
      payMonthCutOff: { payMonth: '2026-07', reachedCutOff: true, earliestOpenPayMonth: '2026-09' },
      dailyOutcomeBeforeAdjustment: DAILY_OUTCOME,
      approvedAt: '2026-10-05T09:00:00Z',
      approverAuthoredDecidingRule: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.codes).toEqual([
      'approver_lacks_override_grant',
      'approver_is_requester',
      'approver_authored_deciding_rule',
      'pay_month_reached_cut_off',
    ]);
    expect(result.refusal.criteria).toEqual(['8.4', '8.5', '14.5', '8.6']);
  });

  it('throws when the cut-off state describes a different Pay_Month (programmer error)', () => {
    expect(() =>
      approveAdjustmentRequest({
        request: requestFrom(),
        approvingUserId: OVERRIDE_APPROVER,
        approverOverrideApproverBranchIds: [BRANCH_ID],
        payMonthCutOff: { payMonth: '2026-08', reachedCutOff: false, earliestOpenPayMonth: '2026-08' },
        dailyOutcomeBeforeAdjustment: DAILY_OUTCOME,
        approvedAt: '2026-07-05T09:00:00Z',
      }),
    ).toThrow(/refusing to authorise against the wrong month/);
  });

  it('flags drift when the day moved between the request and the approval, and supersedes the CURRENT state', () => {
    const drifted: DailyOutcome = { classification: 'half_day', lwpValue: 0.5, payableDays: 0.5 };
    const result = approveAdjustmentRequest({
      request: requestFrom(),
      approvingUserId: OVERRIDE_APPROVER,
      approverOverrideApproverBranchIds: [BRANCH_ID],
      payMonthCutOff: CUT_OFF_OPEN,
      dailyOutcomeBeforeAdjustment: drifted,
      approvedAt: '2026-07-05T09:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approval.precedingStateDrifted).toBe(true);
    // criterion 8.7: superseded is the state immediately before application, not the stale one.
    expect(result.approval.superseded).toEqual(drifted);
    expect(verifyReversibility(result.approval, drifted).holds).toBe(true);
  });
});

// ── Property tests ────────────────────────────────────────────────────────────────────────────

const CLASSIFICATIONS: readonly DayClassification[] = [
  'present',
  'half_day',
  'absent',
  'leave_approved',
  'holiday',
  'week_off',
  'unreconciled',
  'missing_punch',
  'week_off_worked',
];

const classificationArb = fc.constantFrom(...CLASSIFICATIONS);
const lwpArb = fc.option(fc.constantFrom(0, 0.5, 1), { nil: null });
const dailyOutcomeArb: fc.Arbitrary<DailyOutcome> = fc.record({
  classification: classificationArb,
  lwpValue: lwpArb,
  payableDays: fc.option(fc.constantFrom(0, 0.5, 1), { nil: null }),
});

describe('Property 13: Reversibility of an approved adjustment', () => {
  it('the recorded superseded classification equals the classification that existed before the adjustment', () => {
    // Feature: payroll-attendance-source-rules, Property 13: Reversibility of an approved
    // adjustment
    // **Validates: Requirements 8.7**
    fc.assert(
      fc.property(
        dailyOutcomeArb,
        dailyOutcomeArb,
        classificationArb,
        lwpArb,
        (beforeAtRequest, beforeAtApproval, requestedClassification, requestedLwpValue) => {
          const record = queuedRecord({ dailyOutcome: beforeAtRequest });
          const recorded = recordReviewOutcome({
            record,
            authority: authorityFor(record, 'wfm_reviewer'),
            submission: {
              outcome: 'adjustment_requested',
              comment: LONG_COMMENT,
              requestedClassification,
              requestedLwpValue,
            },
            recordedAt: '2026-07-03T10:00:00Z',
          });
          expect(recorded.ok).toBe(true);
          if (!recorded.ok || recorded.adjustmentRequest === null) return;

          const approved = approveAdjustmentRequest({
            request: recorded.adjustmentRequest,
            approvingUserId: OVERRIDE_APPROVER,
            approverOverrideApproverBranchIds: [BRANCH_ID],
            payMonthCutOff: CUT_OFF_OPEN,
            dailyOutcomeBeforeAdjustment: beforeAtApproval,
            approvedAt: '2026-07-05T09:00:00Z',
          });
          expect(approved.ok).toBe(true);
          if (!approved.ok) return;

          // criterion 8.7 as stated: the recorded superseded classification IS the one that
          // existed before the adjustment was applied.
          expect(approved.approval.superseded.classification).toBe(beforeAtApproval.classification);
          expect(verifyReversibility(approved.approval, beforeAtApproval).holds).toBe(true);
          // And the revert restores the whole day, so the approval is undoable from its own record.
          expect(revertApprovedAdjustment(approved.approval)).toEqual(beforeAtApproval);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('Property: apr_accepted and apr_disputed never change pay (criterion 8.1)', () => {
  it('for any day state and either non-adjusting outcome, the day comes back untouched and no request exists', () => {
    // Feature: payroll-attendance-source-rules, criterion 8.1
    fc.assert(
      fc.property(
        dailyOutcomeArb,
        fc.constantFrom('apr_accepted' as const, 'apr_disputed' as const),
        fc.constantFrom('wfm_reviewer' as const, 'reporting_manager' as const),
        (dailyOutcome, outcome, role) => {
          const record = queuedRecord({ dailyOutcome });
          const result = recordReviewOutcome({
            record,
            authority: authorityFor(record, role),
            submission:
              outcome === 'apr_accepted' ? { outcome } : { outcome, comment: LONG_COMMENT },
            recordedAt: '2026-07-03T10:00:00Z',
          });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.dailyOutcome).toBe(dailyOutcome);
          expect(result.record.dailyOutcome).toBe(dailyOutcome);
          expect(result.adjustmentRequest).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Property: the conflict verdict is symmetric (criterion 7.10)', () => {
  it('swapping the two reviewers never changes whether the record is contested', () => {
    const reviewArb: fc.Arbitrary<RecordedReview> = fc
      .tuple(
        fc.constantFrom('apr_accepted' as const, 'apr_disputed' as const, 'adjustment_requested' as const),
        classificationArb,
        lwpArb,
        fc.constantFrom('wfm_reviewer' as const, 'reporting_manager' as const),
      )
      .map(([outcome, classification, lwp, role]) =>
        outcome === 'adjustment_requested'
          ? review(role, outcome, classification, lwp)
          : review(role, outcome),
      );
    fc.assert(
      fc.property(reviewArb, reviewArb, (a, b) => {
        expect(assessOutcomeConflict(a, b)).toEqual(assessOutcomeConflict(b, a));
      }),
      { numRuns: 300 },
    );
  });
});

describe('Property: escalation is decided by whole days only (criteria 7.8, 7.9)', () => {
  it('the time of day on either timestamp never changes the verdict', () => {
    const timeArb = fc.constantFrom(
      '',
      'T00:00:00Z',
      'T00:05:00+05:30',
      'T12:00:00Z',
      'T23:59:59-08:00',
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 }),
        timeArb,
        timeArb,
        fc.constantFrom(1, 2, 3, 4, 5),
        (offsetDays, presentedTime, referenceTime, ageDays) => {
          // 2026-07-01 plus offsetDays, kept inside July so the string arithmetic stays trivial.
          const day = String(1 + offsetDays).padStart(2, '0');
          const record = queuedRecord({
            status: 'notified',
            presentedAt: `2026-07-01${presentedTime}`,
            escalationAgeDays: ageDays,
            escalationIntervalDays: ageDays,
          });
          const result = evaluateEscalation({
            record,
            referenceDate: `2026-07-${day}${referenceTime}`,
            ladder: LADDER,
          });
          expect(result.ageInWholeDays).toBe(offsetDays);
          expect(result.due).toBe(offsetDays >= ageDays);
        },
      ),
      { numRuns: 300 },
    );
  });
});
