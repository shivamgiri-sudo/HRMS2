//
// Requirement 13 (Review Queue And Reporting Interfaces). Everything here is a pure call: no
// database, no clock, no fixtures to seed. Criterion 13.8's reference date and criterion 7.3's
// recording timestamp are arguments, so the day-count boundaries are asserted exactly rather than
// waited for.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_DUAL_REVIEW_CEILING,
  UNASSIGNED_GROUPING_LABEL,
  VARIANCE_EXCEPTION_REPORT_COLUMNS,
  applyQueueFilter,
  assessBulkSelection,
  buildPreCloseUnreviewedListing,
  buildQueueClearanceOutlook,
  buildVarianceExceptionExport,
  buildVarianceExceptionReport,
  buildVarianceExceptionScreenRows,
  checkNoDiscardInvariant,
  describeContestedRecord,
  isQueuedReportable,
  listVarianceReviewQueue,
  recordBulkReviewOutcome,
  type DualReviewCeilingConfig,
  type QueueViewer,
  type ReportableVarianceRecord,
  type VarianceQueueFilter,
} from '../variance-exception-report.js';
import {
  MIN_REVIEWER_COMMENT_LENGTH,
  type QueueState,
  type RecordedReview,
  type ReviewerRole,
  type ReviewOutcome,
  type VarianceRecordStatus,
} from '../variance-review.js';
import {
  evaluateVariance,
  type DayClassification,
  type ResolvedAttendanceSource,
} from '../attendance-variance.js';
import type { FloorAbsenceOccurrence } from '../floor-absence-pattern.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

const PAY_MONTH = '2026-07';
const BRANCH_A = 'branch-cbd';
const BRANCH_B = 'branch-north';
const WFM_USER = 'user-wfm-1';
const MANAGER_USER = 'user-mgr-1';
const BRANCH_WFM_CONTACT = 'user-branch-wfm-poc';
const OVERRIDE_APPROVER = 'user-override-1';
const SOURCE_VICI = 'src-vici';
const SOURCE_MANUAL = 'src-manual';

// Twenty characters or more, so criterion 7.4 is satisfied where it applies.
const LONG_COMMENT = 'Biometric punches match the roster; the dialler feed is missing entirely.';

function review(
  role: ReviewerRole,
  outcome: ReviewOutcome,
  userId: string,
  comment: string = LONG_COMMENT,
): RecordedReview {
  const common = {
    role,
    userId,
    recordedAt: '2026-07-10T10:00:00',
    comment,
    substitution: null,
  } as const;
  if (outcome === 'adjustment_requested') {
    return {
      outcome: 'adjustment_requested',
      ...common,
      requestedClassification: 'half_day',
      requestedLwpValue: 0.5,
    };
  }
  if (outcome === 'apr_disputed') return { outcome: 'apr_disputed', ...common };
  return { outcome: 'apr_accepted', ...common };
}

function floorAbsenceOccurrence(employeeId: string, date: string): FloorAbsenceOccurrence {
  return {
    employeeId,
    date,
    reason: 'productive_minutes_below_ceiling',
    biometricMinutes: 540,
    punchSpanMinutes: 540,
    canonicalProductiveMinutes: 12,
    canonicalRule: 'interval_union',
    contributingSources: [{ diallerSourceId: SOURCE_VICI, minutes: 12 }],
    appliedCeilingMinutes: 60,
    appliedFullDayMinutes: 540,
  };
}

interface RecordSpec {
  readonly id?: string;
  readonly employeeId?: string;
  readonly employeeUserId?: string | null;
  readonly branchId?: string;
  readonly workDate?: string;
  readonly payMonth?: string;
  readonly status?: VarianceRecordStatus;
  readonly queueState?: QueueState;
  readonly costCentreId?: string | null;
  readonly processId?: string | null;
  readonly designationId?: string | null;
  readonly floorAbsence?: boolean;
  readonly carriedForwardFromPayMonth?: string | null;
  readonly salaryLineId?: string | null;
  readonly wfmReview?: RecordedReview | null;
  readonly managerReview?: RecordedReview | null;
  readonly authorizedWfmReviewerUserIds?: readonly string[];
  readonly reportingManagerUserId?: string | null;
  readonly branchWfmContactUserId?: string | null;
  readonly overrideApproverUserIds?: readonly string[];
  readonly canonicalMinutes?: number;
  readonly biometricMinutes?: number;
  readonly resolvedSource?: ResolvedAttendanceSource;
  readonly dayClassification?: DayClassification;
  readonly diallerContributions?: readonly { readonly id: string; readonly minutes: number | null }[];
}

/**
 * One Variance_Record with the Requirement 13 reporting dimensions attached. The evidence carries a
 * REAL `VarianceEvaluation` from attendance-variance.ts rather than a hand-written literal, so the
 * resolved Attendance_Source and the Variance_Risk_Score this module reports are the figures the
 * variance decision was actually taken on.
 */
function record(spec: RecordSpec = {}): ReportableVarianceRecord {
  const employeeId = spec.employeeId ?? 'emp-0001';
  const workDate = spec.workDate ?? '2026-07-01';
  const canonicalMinutes = spec.canonicalMinutes ?? 120;
  const evaluation = evaluateVariance({
    resolvedSource: spec.resolvedSource ?? 'biometric',
    evidence: { state: 'present', minutes: canonicalMinutes, rule: 'interval_union' },
    biometricMinutes: spec.biometricMinutes ?? 480,
    dayClassification: spec.dayClassification ?? 'present',
  });
  const contributions = spec.diallerContributions ?? [
    { id: SOURCE_VICI, minutes: canonicalMinutes },
    { id: SOURCE_MANUAL, minutes: null },
  ];
  const base = {
    id: spec.id ?? 'vr-1',
    employeeId,
    employeeUserId: spec.employeeUserId === undefined ? `user-${employeeId}` : spec.employeeUserId,
    branchId: spec.branchId ?? BRANCH_A,
    workDate,
    payMonth: spec.payMonth ?? PAY_MONTH,
    status: spec.status ?? 'open',
    evidence: {
      evaluation,
      diallerSourceContributions: contributions.map((contribution) => ({
        diallerSourceId: contribution.id,
        diallerSourceName: contribution.id,
        minutes: contribution.minutes,
      })),
      biometricPunches: [
        { punchAt: `${workDate}T09:02:00`, direction: 'in' as const },
        { punchAt: `${workDate}T17:04:00`, direction: 'out' as const },
      ],
    },
    dailyOutcome: { classification: 'present' as DayClassification, lwpValue: 0, payableDays: 1 },
    authorizedWfmReviewerUserIds: spec.authorizedWfmReviewerUserIds ?? [WFM_USER],
    reportingManagerUserId:
      spec.reportingManagerUserId === undefined ? MANAGER_USER : spec.reportingManagerUserId,
    branchWfmContactUserId:
      spec.branchWfmContactUserId === undefined ? BRANCH_WFM_CONTACT : spec.branchWfmContactUserId,
    overrideApproverUserIds: spec.overrideApproverUserIds ?? [OVERRIDE_APPROVER],
    wfmReview: spec.wfmReview ?? null,
    managerReview: spec.managerReview ?? null,
    presentedAt: '2026-07-02',
    lastEscalatedAt: null,
    escalationAgeDays: null,
    escalationIntervalDays: null,
    costCentreId: spec.costCentreId === undefined ? 'cc-collections' : spec.costCentreId,
    processId: spec.processId === undefined ? 'proc-voice' : spec.processId,
    designationId: spec.designationId === undefined ? 'desig-exec' : spec.designationId,
    floorAbsenceOccurrence:
      spec.floorAbsence === true ? floorAbsenceOccurrence(employeeId, workDate) : null,
    carriedForwardFromPayMonth: spec.carriedForwardFromPayMonth ?? null,
    salaryLineId: spec.salaryLineId ?? null,
  };
  return spec.queueState === 'recorded_not_queued'
    ? { ...base, queueState: 'recorded_not_queued' as const }
    : { ...base, queueState: 'queued_for_dual_review' as const };
}

const WFM_VIEWER: QueueViewer = { userId: WFM_USER, employeeId: 'emp-wfm' };
const MANAGER_VIEWER: QueueViewer = { userId: MANAGER_USER, employeeId: 'emp-mgr' };

// ── criterion 13.1: the scope-aware listing, and per-slot outstanding ──────────────────────────

describe('listVarianceReviewQueue (criteria 13.1, 14.4)', () => {
  it('returns an empty listing for an empty record set rather than throwing', () => {
    const listing = listVarianceReviewQueue({ viewer: WFM_VIEWER, records: [] });
    expect(listing.rows).toEqual([]);
    expect(listing.rowCount).toBe(0);
    expect(listing.ownOutstandingCount).toBe(0);
    expect(listing.outOfScopeRecordCount).toBe(0);
  });

  it('lists only the records within the viewer\'s scope and counts the rest out (criterion 14.4)', () => {
    const mine = record({ id: 'vr-mine' });
    const theirs = record({
      id: 'vr-theirs',
      branchId: BRANCH_B,
      authorizedWfmReviewerUserIds: ['user-wfm-other'],
      reportingManagerUserId: 'user-mgr-other',
      branchWfmContactUserId: null,
      overrideApproverUserIds: [],
    });
    const listing = listVarianceReviewQueue({ viewer: WFM_VIEWER, records: [mine, theirs] });
    expect(listing.rows.map((row) => row.recordId)).toEqual(['vr-mine']);
    expect(listing.outOfScopeRecordCount).toBe(1);
    // criterion 14.6: the out-of-scope record is a count and nothing else on the listing names it.
    expect(JSON.stringify(listing)).not.toContain('vr-theirs');
  });

  it('flags the viewer\'s OWN outcome as outstanding, per slot rather than per record', () => {
    // criterion 7.6's substitution case: no Reporting_Manager, so the branch WFM point of contact
    // fills the second slot -- and here that same person is also the named WFM_Reviewer, so one user
    // holds both slots. One slot recorded, one outstanding.
    const bothSlots = record({
      id: 'vr-both',
      authorizedWfmReviewerUserIds: [BRANCH_WFM_CONTACT],
      reportingManagerUserId: null,
      branchWfmContactUserId: BRANCH_WFM_CONTACT,
      wfmReview: review('wfm_reviewer', 'apr_accepted', BRANCH_WFM_CONTACT),
    });
    const listing = listVarianceReviewQueue({
      viewer: { userId: BRANCH_WFM_CONTACT, employeeId: 'emp-poc' },
      records: [bothSlots],
    });
    const row = listing.rows[0]!;
    expect(row.viewerSlots).toEqual(['wfm_reviewer', 'reporting_manager']);
    // Per-slot: the WFM slot is done, the manager slot is not.
    expect(row.viewerOutstandingSlots).toEqual(['reporting_manager']);
    expect(row.ownReviewOutstanding).toBe(true);
    expect(row.viewerRecordedOutcomes).toEqual([
      {
        role: 'wfm_reviewer',
        outcome: 'apr_accepted',
        recordedAt: '2026-07-10T10:00:00',
        comment: LONG_COMMENT,
      },
    ]);
    expect(row.outstandingSuppressionReason).toBeNull();
  });

  it('owes nothing on a record whose OTHER slot is empty but whose own slot is filled', () => {
    const mine = record({ wfmReview: review('wfm_reviewer', 'apr_disputed', WFM_USER) });
    const listing = listVarianceReviewQueue({ viewer: WFM_VIEWER, records: [mine] });
    const row = listing.rows[0]!;
    expect(row.ownReviewOutstanding).toBe(false);
    expect(row.outstandingSuppressionReason).toBe('own_outcome_already_recorded');
    // The record is still awaiting the second reviewer -- just not this one.
    expect(row.awaitingSlots).toEqual(['reporting_manager']);
  });

  it('lists a Recorded_Not_Queued record and owes nothing on it (criteria 6.11, 7.1)', () => {
    const notQueued = record({ id: 'vr-rnq', queueState: 'recorded_not_queued' });
    const listing = listVarianceReviewQueue({ viewer: WFM_VIEWER, records: [notQueued] });
    const row = listing.rows[0]!;
    expect(row.queueState).toBe('recorded_not_queued');
    expect(row.ownReviewOutstanding).toBe(false);
    expect(row.outstandingSuppressionReason).toBe('recorded_not_queued');
    expect(listing.ownOutstandingCount).toBe(0);
  });

  it('owes nothing on a contested or reviewed record (criteria 7.5, 7.10)', () => {
    for (const status of ['reviewed', 'contested', 'no_issue'] as const) {
      const closed = record({ status });
      const listing = listVarianceReviewQueue({ viewer: WFM_VIEWER, records: [closed] });
      expect(listing.rows[0]!.outstandingSuppressionReason).toBe('record_closed');
      expect(listing.rows[0]!.ownReviewOutstanding).toBe(false);
    }
  });

  it('owes nothing to the employee named on the record (criterion 7.7)', () => {
    const own = record({ employeeId: 'emp-self', employeeUserId: WFM_USER });
    const listing = listVarianceReviewQueue({ viewer: WFM_VIEWER, records: [own] });
    expect(listing.rows[0]!.outstandingSuppressionReason).toBe('self_review_not_permitted');
    expect(listing.rows[0]!.ownReviewOutstanding).toBe(false);
  });

  it('lists a record for a scope-only viewer, with no slots and nothing suppressed', () => {
    const mine = record();
    const listing = listVarianceReviewQueue({
      viewer: { userId: OVERRIDE_APPROVER },
      records: [mine],
    });
    const row = listing.rows[0]!;
    expect(row.viewerScopeBases).toEqual(['override_approver']);
    expect(row.viewerSlots).toEqual([]);
    expect(row.ownReviewOutstanding).toBe(false);
    expect(row.outstandingSuppressionReason).toBeNull();
  });

  it('lists a branch the viewer\'s resolved business scope covers even without a reviewer slot', () => {
    const mine = record({
      authorizedWfmReviewerUserIds: ['user-wfm-other'],
      reportingManagerUserId: 'user-mgr-other',
      branchWfmContactUserId: null,
      overrideApproverUserIds: [],
    });
    const listing = listVarianceReviewQueue({
      viewer: { userId: 'user-wfm-head', scopedBranchIds: [BRANCH_A] },
      records: [mine],
    });
    expect(listing.rows[0]!.viewerScopeBases).toEqual(['business_scope_branch']);
    expect(listing.outOfScopeRecordCount).toBe(0);
  });

  it('reports a carried-forward record as carried forward (criteria 9.3, 13.2)', () => {
    const carried = record({ carriedForwardFromPayMonth: '2026-06' });
    const listing = listVarianceReviewQueue({ viewer: MANAGER_VIEWER, records: [carried] });
    expect(listing.rows[0]!.carriedForward).toBe(true);
    expect(listing.rows[0]!.carriedForwardFromPayMonth).toBe('2026-06');
  });

  it('is ordering-independent: the same records shuffled produce the same listing', () => {
    const records = [
      record({ id: 'vr-3', workDate: '2026-07-03' }),
      record({ id: 'vr-1', workDate: '2026-07-01' }),
      record({ id: 'vr-2', workDate: '2026-07-02' }),
    ];
    const forward = listVarianceReviewQueue({ viewer: WFM_VIEWER, records });
    const reversed = listVarianceReviewQueue({ viewer: WFM_VIEWER, records: [...records].reverse() });
    expect(forward).toEqual(reversed);
    expect(forward.rows.map((row) => row.recordId)).toEqual(['vr-1', 'vr-2', 'vr-3']);
  });

  it('throws for two different Variance_Records under one id (programmer error)', () => {
    expect(() =>
      listVarianceReviewQueue({
        viewer: WFM_VIEWER,
        records: [record({ id: 'vr-dup' }), record({ id: 'vr-dup', branchId: BRANCH_B })],
      }),
    ).toThrow(/primary key/);
  });

  it('collapses an exactly duplicated record rather than counting it twice', () => {
    const one = record({ id: 'vr-1' });
    const listing = listVarianceReviewQueue({ viewer: WFM_VIEWER, records: [one, { ...one }] });
    expect(listing.rowCount).toBe(1);
  });

  it('throws when a Floor_Absence_Pattern occurrence names another employee-day (programmer error)', () => {
    const wired = {
      ...record({ id: 'vr-bad' }),
      floorAbsenceOccurrence: floorAbsenceOccurrence('emp-9999', '2026-07-15'),
    };
    expect(() => listVarianceReviewQueue({ viewer: WFM_VIEWER, records: [wired] })).toThrow(
      /Floor_Absence_Pattern occurrence/,
    );
  });
});

// ── criterion 13.2: filtering ─────────────────────────────────────────────────────────────────

describe('applyQueueFilter (criterion 13.2)', () => {
  const spread: readonly ReportableVarianceRecord[] = [
    record({ id: 'vr-a', branchId: BRANCH_A, processId: 'proc-voice', costCentreId: 'cc-1' }),
    record({
      id: 'vr-b',
      branchId: BRANCH_B,
      processId: 'proc-chat',
      costCentreId: 'cc-2',
      queueState: 'recorded_not_queued',
    }),
    record({
      id: 'vr-c',
      branchId: BRANCH_A,
      processId: null,
      costCentreId: null,
      designationId: null,
      status: 'contested',
      carriedForwardFromPayMonth: '2026-06',
    }),
    record({ id: 'vr-d', payMonth: '2026-06', workDate: '2026-06-11' }),
  ];

  const ids = (records: readonly ReportableVarianceRecord[]): readonly string[] =>
    records.map((r) => r.id);

  it('an absent filter constrains nothing', () => {
    expect(ids(applyQueueFilter(spread, null))).toEqual(['vr-d', 'vr-a', 'vr-b', 'vr-c']);
    expect(ids(applyQueueFilter(spread, undefined))).toHaveLength(spread.length);
  });

  it('an EMPTY filter constrains nothing rather than matching nothing', () => {
    expect(applyQueueFilter(spread, {})).toHaveLength(spread.length);
  });

  it('an empty ARRAY on a dimension constrains nothing rather than matching nothing', () => {
    const filter: VarianceQueueFilter = {
      payMonths: [],
      branchIds: [],
      processIds: [],
      costCentreIds: [],
      diallerSourceIds: [],
      reviewStates: [],
      queueStates: [],
      carriedForward: null,
    };
    expect(applyQueueFilter(spread, filter)).toHaveLength(spread.length);
  });

  it('filters by Pay_Month, branch, process and cost centre', () => {
    expect(ids(applyQueueFilter(spread, { payMonths: [PAY_MONTH] }))).toEqual([
      'vr-a',
      'vr-b',
      'vr-c',
    ]);
    expect(ids(applyQueueFilter(spread, { branchIds: [BRANCH_B] }))).toEqual(['vr-b']);
    expect(ids(applyQueueFilter(spread, { processIds: ['proc-chat'] }))).toEqual(['vr-b']);
    expect(ids(applyQueueFilter(spread, { costCentreIds: ['cc-1'] }))).toEqual(['vr-a']);
  });

  it('targets the unassigned rows by putting null in the filter list', () => {
    expect(ids(applyQueueFilter(spread, { costCentreIds: [null] }))).toEqual(['vr-c']);
    expect(ids(applyQueueFilter(spread, { processIds: [null] }))).toEqual(['vr-c']);
    // A non-null id never matches a null dimension, and vice versa.
    expect(ids(applyQueueFilter(spread, { costCentreIds: ['cc-1', null] }))).toEqual([
      'vr-a',
      'vr-c',
    ]);
  });

  it('filters by review state and by queue state, spelled exactly', () => {
    expect(ids(applyQueueFilter(spread, { reviewStates: ['contested'] }))).toEqual(['vr-c']);
    expect(ids(applyQueueFilter(spread, { queueStates: ['recorded_not_queued'] }))).toEqual([
      'vr-b',
    ]);
    expect(applyQueueFilter(spread, { queueStates: ['queued_for_dual_review'] })).toHaveLength(3);
  });

  it('filters by carried-forward state in three distinguishable ways', () => {
    expect(ids(applyQueueFilter(spread, { carriedForward: true }))).toEqual(['vr-c']);
    expect(applyQueueFilter(spread, { carriedForward: false })).toHaveLength(3);
    expect(applyQueueFilter(spread, { carriedForward: null })).toHaveLength(4);
  });

  it('filters by Dialler_Source on the sources that supplied minutes, not the silent ones', () => {
    const viciOnly = record({
      id: 'vr-vici',
      diallerContributions: [{ id: SOURCE_VICI, minutes: 90 }],
    });
    const manualSilent = record({
      id: 'vr-silent',
      diallerContributions: [{ id: SOURCE_MANUAL, minutes: null }],
    });
    const pool = [viciOnly, manualSilent];
    expect(ids(applyQueueFilter(pool, { diallerSourceIds: [SOURCE_VICI] }))).toEqual(['vr-vici']);
    // The silent source held no record for the date, so it is not what the day's figures came from.
    expect(applyQueueFilter(pool, { diallerSourceIds: [SOURCE_MANUAL] })).toEqual([]);
  });

  it('supports combinations as a conjunction', () => {
    expect(
      ids(applyQueueFilter(spread, { payMonths: [PAY_MONTH], branchIds: [BRANCH_A] })),
    ).toEqual(['vr-a', 'vr-c']);
    expect(
      applyQueueFilter(spread, { branchIds: [BRANCH_A], processIds: ['proc-chat'] }),
    ).toEqual([]);
  });

  it('throws for a malformed Pay_Month in the filter (programmer error)', () => {
    expect(() => applyQueueFilter(spread, { payMonths: ['2026-7'] })).toThrow(/'YYYY-MM'/);
  });

  it('narrows a listing through the same filter (criteria 13.1, 13.2 together)', () => {
    const listing = listVarianceReviewQueue({
      viewer: WFM_VIEWER,
      records: spread,
      filter: { queueStates: ['recorded_not_queued'] },
    });
    expect(listing.rows.map((row) => row.recordId)).toEqual(['vr-b']);
    expect(listing.filteredOutRecordCount).toBe(3);
  });
});

// ── criterion 13.3: one Review_Outcome and one comment across a selected set ───────────────────

describe('recordBulkReviewOutcome (criteria 13.3, 7.3, 7.4)', () => {
  const two: readonly ReportableVarianceRecord[] = [
    record({ id: 'vr-1', workDate: '2026-07-01' }),
    record({ id: 'vr-2', workDate: '2026-07-02' }),
  ];

  it('applies one outcome and one comment across the set', () => {
    const result = recordBulkReviewOutcome({
      viewer: WFM_VIEWER,
      records: two,
      selectedRecordIds: ['vr-2', 'vr-1'],
      submission: { outcome: 'apr_disputed' },
      comment: LONG_COMMENT,
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedCount).toBe(2);
    expect(result.applied.map((entry) => entry.recordId)).toEqual(['vr-1', 'vr-2']);
    // criterion 13.3: ONE comment, recorded identically on every row (criterion 7.3 stores it per
    // reviewer, so it must be the same string on each).
    for (const entry of result.applied) {
      expect(entry.role).toBe('wfm_reviewer');
      expect(entry.result.recorded.comment).toBe(result.comment);
      expect(entry.result.recorded.outcome).toBe('apr_disputed');
      // criterion 8.1: recording an outcome returned the record's own DailyOutcome by reference.
      expect(entry.result.dailyOutcome).toBe(
        two.find((r) => r.id === entry.recordId)!.dailyOutcome,
      );
    }
    expect(result.completedDualReviewRecordIds).toEqual([]);
  });

  it('accepts apr_accepted with no comment at all (criterion 7.4 requires one only for the other two)', () => {
    const result = recordBulkReviewOutcome({
      viewer: WFM_VIEWER,
      records: two,
      selectedRecordIds: ['vr-1'],
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comment).toBe('');
    expect(result.appliedCount).toBe(1);
  });

  it('refuses the whole action when the set-wide comment is too short (criterion 7.4)', () => {
    const result = recordBulkReviewOutcome({
      viewer: WFM_VIEWER,
      records: two,
      selectedRecordIds: ['vr-1', 'vr-2'],
      submission: { outcome: 'apr_disputed' },
      comment: 'too short',
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('comment_too_short');
    expect(result.refusal.appliedCount).toBe(0);
    expect(result.refusal.message).toContain(String(MIN_REVIEWER_COMMENT_LENGTH));
  });

  it('refuses an empty selection', () => {
    const result = recordBulkReviewOutcome({
      viewer: WFM_VIEWER,
      records: two,
      selectedRecordIds: [],
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('selection_empty');
  });

  it('refuses the WHOLE action when one selected record is outside the user\'s scope, and does not name it', () => {
    const theirs = record({
      id: 'vr-theirs',
      branchId: BRANCH_B,
      authorizedWfmReviewerUserIds: ['user-wfm-other'],
      reportingManagerUserId: 'user-mgr-other',
      branchWfmContactUserId: null,
      overrideApproverUserIds: [],
    });
    const result = recordBulkReviewOutcome({
      viewer: WFM_VIEWER,
      records: [...two, theirs],
      selectedRecordIds: ['vr-1', 'vr-2', 'vr-theirs'],
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('selection_contains_ineligible_records');
    expect(result.refusal.appliedCount).toBe(0);
    expect(result.refusal.outOfScopeRecordCount).toBe(1);
    // criterion 14.6: the refusal returns no employee data for the out-of-scope row.
    expect(JSON.stringify(result.refusal)).not.toContain('vr-theirs');
    // The in-scope rows are still nameable, so the reviewer can re-submit them.
    expect(result.refusal.ineligibleRows).toEqual([]);
  });

  it('refuses the whole action when one selected record has no outstanding slot for the user (criterion 7.3)', () => {
    const alreadyDone = record({
      id: 'vr-done',
      wfmReview: review('wfm_reviewer', 'apr_accepted', WFM_USER),
    });
    const result = recordBulkReviewOutcome({
      viewer: WFM_VIEWER,
      records: [...two, alreadyDone],
      selectedRecordIds: ['vr-1', 'vr-done'],
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.ineligibleRows).toEqual([
      {
        recordId: 'vr-done',
        eligible: false,
        role: null,
        refusalCode: 'no_outstanding_slot_for_user',
      },
    ]);
  });

  it('refuses a Recorded_Not_Queued record, a closed record, a self-review and a missing id', () => {
    const notQueued = record({ id: 'vr-rnq', queueState: 'recorded_not_queued' });
    const closed = record({ id: 'vr-closed', status: 'reviewed' });
    const own = record({ id: 'vr-self', employeeId: 'emp-self', employeeUserId: WFM_USER });
    const assessment = assessBulkSelection({
      viewer: WFM_VIEWER,
      records: [notQueued, closed, own],
      selectedRecordIds: ['vr-rnq', 'vr-closed', 'vr-self', 'vr-nowhere'],
    });
    expect(assessment.rows.map((row) => row.refusalCode)).toEqual([
      'record_already_closed',
      'record_not_in_supplied_set',
      'record_not_queued_for_dual_review',
      'self_review_not_permitted',
    ]);
    expect(assessment.eligibleRecordIds).toEqual([]);
    expect(assessment.missingRecordCount).toBe(1);
  });

  it('refuses a record on which the user holds BOTH outstanding slots (criterion 7.5 protected)', () => {
    const bothSlots = record({
      id: 'vr-both',
      authorizedWfmReviewerUserIds: [BRANCH_WFM_CONTACT],
      reportingManagerUserId: null,
      branchWfmContactUserId: BRANCH_WFM_CONTACT,
    });
    const result = recordBulkReviewOutcome({
      viewer: { userId: BRANCH_WFM_CONTACT, employeeId: 'emp-poc' },
      records: [bothSlots],
      selectedRecordIds: ['vr-both'],
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.ineligibleRows[0]!.refusalCode).toBe(
      'viewer_holds_both_outstanding_slots',
    );
  });

  it('completes the Dual_Review and marks the record contested when the outcomes conflict (criteria 7.5, 7.10)', () => {
    const half = record({
      id: 'vr-half',
      managerReview: review('reporting_manager', 'adjustment_requested', MANAGER_USER),
    });
    const result = recordBulkReviewOutcome({
      viewer: WFM_VIEWER,
      records: [half],
      selectedRecordIds: ['vr-half'],
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedDualReviewRecordIds).toEqual(['vr-half']);
    expect(result.contestedRecordIds).toEqual(['vr-half']);
    expect(result.overrideApproverRoutings).toHaveLength(1);
    expect(result.overrideApproverRoutings[0]!.overrideApproverUserIds).toEqual([
      OVERRIDE_APPROVER,
    ]);
  });

  it('turns a bulk adjustment_requested into one adjustment request per row (criterion 8.2)', () => {
    const result = recordBulkReviewOutcome({
      viewer: WFM_VIEWER,
      records: two,
      selectedRecordIds: ['vr-1', 'vr-2'],
      submission: {
        outcome: 'adjustment_requested',
        requestedClassification: 'half_day',
        requestedLwpValue: 0.5,
      },
      comment: LONG_COMMENT,
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adjustmentRequests).toHaveLength(2);
    for (const request of result.adjustmentRequests) {
      expect(request.requestedClassification).toBe('half_day');
      expect(request.requestedLwpValue).toBe(0.5);
      expect(request.justification).toBe(result.comment);
    }
  });

  it('collapses duplicate selected ids rather than recording twice', () => {
    const result = recordBulkReviewOutcome({
      viewer: WFM_VIEWER,
      records: two,
      selectedRecordIds: ['vr-1', 'vr-1', 'vr-1'],
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedCount).toBe(1);
  });

  it('records into the reporting_manager slot when the manager acts (criterion 7.5)', () => {
    const result = recordBulkReviewOutcome({
      viewer: MANAGER_VIEWER,
      records: two,
      selectedRecordIds: ['vr-1'],
      submission: { outcome: 'apr_accepted' },
      recordedAt: '2026-07-11T09:00:00',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied[0]!.role).toBe('reporting_manager');
  });
});

// ── criterion 13.4: the variance exception report and its invariant ────────────────────────────

describe('buildVarianceExceptionReport (criteria 13.4, 6.10, 6.12, 6.13)', () => {
  it('returns an empty grouping list and an all-zero footer for an empty record set', () => {
    const report = buildVarianceExceptionReport({ payMonth: PAY_MONTH, records: [] });
    expect(report.groupings).toEqual([]);
    expect(report.overall.raised).toBe(0);
    expect(report.overall.queuedForDualReview).toBe(0);
    expect(report.overall.recordedNotQueued).toBe(0);
    expect(report.overall.groupingCount).toBe(0);
    expect(checkNoDiscardInvariant(report).holds).toBe(true);
  });

  it('aggregates by cost centre, branch, process and designation', () => {
    const records = [
      record({ id: 'vr-1', costCentreId: 'cc-1', processId: 'proc-voice', designationId: 'd-1' }),
      record({ id: 'vr-2', costCentreId: 'cc-1', processId: 'proc-voice', designationId: 'd-1' }),
      record({ id: 'vr-3', costCentreId: 'cc-1', processId: 'proc-voice', designationId: 'd-2' }),
      record({
        id: 'vr-4',
        branchId: BRANCH_B,
        costCentreId: 'cc-1',
        processId: 'proc-voice',
        designationId: 'd-1',
      }),
    ];
    const report = buildVarianceExceptionReport({ payMonth: PAY_MONTH, records });
    expect(report.groupings).toHaveLength(3);
    expect(
      report.groupings.map((g) => [g.costCentreId, g.branchId, g.processId, g.designationId, g.raised]),
    ).toEqual([
      ['cc-1', BRANCH_A, 'proc-voice', 'd-1', 2],
      ['cc-1', BRANCH_A, 'proc-voice', 'd-2', 1],
      ['cc-1', BRANCH_B, 'proc-voice', 'd-1', 1],
    ]);
    expect(report.overall.raised).toBe(4);
    expect(report.overall.branchIds).toEqual([BRANCH_A, BRANCH_B]);
  });

  it('groups an employee with no designation under a null key and sorts it last', () => {
    const records = [
      record({ id: 'vr-null', designationId: null }),
      record({ id: 'vr-named', designationId: 'd-1' }),
    ];
    const report = buildVarianceExceptionReport({ payMonth: PAY_MONTH, records });
    expect(report.groupings.map((g) => g.designationId)).toEqual(['d-1', null]);
    expect(checkNoDiscardInvariant(report).holds).toBe(true);
  });

  it('counts every record when EVERY record is Recorded_Not_Queued (criterion 6.11)', () => {
    const records = [1, 2, 3].map((n) =>
      record({ id: `vr-${n}`, queueState: 'recorded_not_queued', workDate: `2026-07-0${n}` }),
    );
    const report = buildVarianceExceptionReport({ payMonth: PAY_MONTH, records });
    const grouping = report.groupings[0]!;
    expect(grouping.raised).toBe(3);
    expect(grouping.queuedForDualReview).toBe(0);
    expect(grouping.recordedNotQueued).toBe(3);
    expect(grouping.reviewed).toBe(0);
    expect(grouping.unreviewed).toBe(0);
    expect(checkNoDiscardInvariant(report).holds).toBe(true);
  });

  it('counts the Floor_Absence_Pattern occurrences among the QUEUED records only (criterion 6.8)', () => {
    const records = [
      record({ id: 'vr-fa-queued', floorAbsence: true, workDate: '2026-07-01' }),
      // criterion 6.8 says a Floor_Absence_Pattern day is always queued; a record carrying the
      // occurrence while NOT queued is a contradiction the report must not count as queued.
      record({
        id: 'vr-fa-notqueued',
        floorAbsence: true,
        queueState: 'recorded_not_queued',
        workDate: '2026-07-02',
      }),
      record({ id: 'vr-plain', workDate: '2026-07-03' }),
    ];
    const grouping = buildVarianceExceptionReport({ payMonth: PAY_MONTH, records }).groupings[0]!;
    expect(grouping.raised).toBe(3);
    expect(grouping.queuedForDualReview).toBe(2);
    expect(grouping.queuedAsFloorAbsencePattern).toBe(1);
  });

  it('applies a Dual_Review_Ceiling of ZERO as configured, not as unconfigured (criterion 6.10)', () => {
    const ceilings: readonly DualReviewCeilingConfig[] = [
      { branchId: BRANCH_A, payMonth: PAY_MONTH, ceiling: 0 },
    ];
    const report = buildVarianceExceptionReport({
      payMonth: PAY_MONTH,
      records: [record()],
      dualReviewCeilings: ceilings,
    });
    expect(report.groupings[0]!.appliedDualReviewCeiling).toBe(0);
    expect(report.groupings[0]!.dualReviewCeilingWasConfigured).toBe(true);
    expect(report.configurationWarnings).toEqual([]);
  });

  it('applies a ceiling larger than the record count without complaint', () => {
    const report = buildVarianceExceptionReport({
      payMonth: PAY_MONTH,
      records: [record()],
      dualReviewCeilings: [{ branchId: BRANCH_A, payMonth: PAY_MONTH, ceiling: 5_000 }],
    });
    expect(report.groupings[0]!.appliedDualReviewCeiling).toBe(5_000);
    expect(report.configurationWarnings).toEqual([]);
  });

  it('applies 100 silently when nothing is configured (criterion 6.10)', () => {
    const report = buildVarianceExceptionReport({ payMonth: PAY_MONTH, records: [record()] });
    expect(report.groupings[0]!.appliedDualReviewCeiling).toBe(DEFAULT_DUAL_REVIEW_CEILING);
    expect(report.groupings[0]!.appliedDualReviewCeiling).toBe(100);
    expect(report.groupings[0]!.dualReviewCeilingWasConfigured).toBe(false);
    expect(report.configurationWarnings).toEqual([]);
  });

  it('falls back to 100 and warns for an unusable or contradictory configured ceiling', () => {
    for (const rejected of [-5, 2.5, Number.NaN]) {
      const report = buildVarianceExceptionReport({
        payMonth: PAY_MONTH,
        records: [record()],
        dualReviewCeilings: [{ branchId: BRANCH_A, payMonth: PAY_MONTH, ceiling: rejected }],
      });
      expect(report.groupings[0]!.appliedDualReviewCeiling).toBe(100);
      expect(report.configurationWarnings).toHaveLength(1);
    }
    const contradictory = buildVarianceExceptionReport({
      payMonth: PAY_MONTH,
      records: [record()],
      dualReviewCeilings: [
        { branchId: BRANCH_A, payMonth: PAY_MONTH, ceiling: 50 },
        { branchId: BRANCH_A, payMonth: PAY_MONTH, ceiling: 80 },
      ],
    });
    expect(contradictory.groupings[0]!.appliedDualReviewCeiling).toBe(100);
    expect(contradictory.configurationWarnings[0]).toContain('order-dependent');
  });

  it('counts reviewed, unreviewed, contested and adjusted', () => {
    const records = [
      record({ id: 'vr-open', workDate: '2026-07-01' }),
      record({ id: 'vr-notified', status: 'notified', workDate: '2026-07-02' }),
      record({
        id: 'vr-reviewed',
        status: 'reviewed',
        workDate: '2026-07-03',
        wfmReview: review('wfm_reviewer', 'apr_accepted', WFM_USER),
        managerReview: review('reporting_manager', 'apr_accepted', MANAGER_USER),
      }),
      record({
        id: 'vr-contested',
        status: 'contested',
        workDate: '2026-07-04',
        wfmReview: review('wfm_reviewer', 'apr_accepted', WFM_USER),
        managerReview: review('reporting_manager', 'adjustment_requested', MANAGER_USER),
      }),
    ];
    const grouping = buildVarianceExceptionReport({ payMonth: PAY_MONTH, records }).groupings[0]!;
    expect(grouping.raised).toBe(4);
    expect(grouping.queuedForDualReview).toBe(4);
    expect(grouping.unreviewed).toBe(2);
    expect(grouping.reviewed).toBe(2);
    expect(grouping.contested).toBe(1);
    // criterion 13.4's `adjusted`: an adjustment_requested outcome is recorded on the record.
    expect(grouping.adjusted).toBe(1);
  });

  it('is unaffected by ties in the Variance_Risk_Score ranking', () => {
    // Three records with an identical risk score: criterion 6.9's ranking cannot order them, and
    // criterion 13.4's counts must not depend on how the queueing pass broke the tie.
    const tied = [1, 2, 3].map((n) =>
      record({
        id: `vr-tie-${n}`,
        workDate: `2026-07-0${n}`,
        canonicalMinutes: 120,
        biometricMinutes: 480,
        queueState: n === 3 ? 'recorded_not_queued' : 'queued_for_dual_review',
      }),
    );
    expect(new Set(tied.map((r) => r.evidence.evaluation.varianceRiskScore)).size).toBe(1);
    const forward = buildVarianceExceptionReport({ payMonth: PAY_MONTH, records: tied });
    const reversed = buildVarianceExceptionReport({
      payMonth: PAY_MONTH,
      records: [...tied].reverse(),
    });
    expect(forward).toEqual(reversed);
    expect(forward.groupings[0]!.raised).toBe(3);
    expect(forward.groupings[0]!.queuedForDualReview).toBe(2);
    expect(forward.groupings[0]!.recordedNotQueued).toBe(1);
  });

  it('counts records for another Pay_Month out of scope rather than including them', () => {
    const report = buildVarianceExceptionReport({
      payMonth: PAY_MONTH,
      records: [
        record({ id: 'vr-jul' }),
        record({ id: 'vr-jun', payMonth: '2026-06', workDate: '2026-06-11' }),
      ],
    });
    expect(report.overall.raised).toBe(1);
    expect(report.outOfScopeRecordCount).toBe(1);
  });

  it('throws for a malformed Pay_Month (programmer error)', () => {
    expect(() => buildVarianceExceptionReport({ payMonth: '2026-13', records: [] })).toThrow(
      /'YYYY-MM'/,
    );
  });

  it('reports how many groupings the invariant was checked on', () => {
    const report = buildVarianceExceptionReport({
      payMonth: PAY_MONTH,
      records: [record({ id: 'vr-1' }), record({ id: 'vr-2', costCentreId: 'cc-2' })],
    });
    const check = checkNoDiscardInvariant(report);
    expect(check.holds).toBe(true);
    // Two groupings plus the footer.
    expect(check.checkedGroupingCount).toBe(3);
    expect(check.violations).toEqual([]);
  });
});

// ── criterion 13.5: the export carries the same rows and columns the screen displays ───────────

describe('buildVarianceExceptionExport (criterion 13.5)', () => {
  const report = buildVarianceExceptionReport({
    payMonth: PAY_MONTH,
    records: [
      record({ id: 'vr-1', costCentreId: 'cc-1', designationId: 'd-1' }),
      record({ id: 'vr-2', costCentreId: null, processId: null, designationId: null }),
    ],
  });

  it('takes its headers and column keys from the single column list', () => {
    const exported = buildVarianceExceptionExport(report);
    expect(exported.headers).toEqual(VARIANCE_EXCEPTION_REPORT_COLUMNS.map((c) => c.header));
    expect(exported.columnKeys).toEqual(VARIANCE_EXCEPTION_REPORT_COLUMNS.map((c) => c.key));
    expect(exported.payMonth).toBe(PAY_MONTH);
  });

  it('carries exactly the screen rows, cell for cell', () => {
    const screenRows = buildVarianceExceptionScreenRows(report);
    const exported = buildVarianceExceptionExport(report);
    expect(exported.rowCount).toBe(screenRows.length);
    expect(exported.rows).toHaveLength(screenRows.length);
    screenRows.forEach((screenRow, rowIndex) => {
      // The screen row's own field order is the column order, so the export cannot silently
      // reorder or drop one.
      expect(Object.keys(screenRow)).toEqual([...exported.columnKeys]);
      exported.columnKeys.forEach((key, columnIndex) => {
        expect(exported.rows[rowIndex]![columnIndex]).toBe(screenRow[key]);
      });
    });
  });

  it('renders a null grouping dimension as the unassigned label in both places', () => {
    const screenRows = buildVarianceExceptionScreenRows(report);
    const unassigned = screenRows.find((row) => row.costCentre === UNASSIGNED_GROUPING_LABEL);
    expect(unassigned).toBeDefined();
    expect(unassigned!.process).toBe(UNASSIGNED_GROUPING_LABEL);
    expect(unassigned!.designation).toBe(UNASSIGNED_GROUPING_LABEL);
    const exported = buildVarianceExceptionExport(report);
    expect(exported.rows.some((row) => row[0] === UNASSIGNED_GROUPING_LABEL)).toBe(true);
  });

  it('does not turn the footer total into a row', () => {
    const exported = buildVarianceExceptionExport(report);
    expect(exported.rowCount).toBe(report.groupings.length);
    const raisedColumn = exported.columnKeys.indexOf('raised');
    const summed = exported.rows.reduce((total, row) => total + Number(row[raisedColumn]), 0);
    // A footer emitted as a row would double this.
    expect(summed).toBe(report.overall.raised);
  });

  it('exports an empty row list for an empty report without losing the columns', () => {
    const empty = buildVarianceExceptionExport(
      buildVarianceExceptionReport({ payMonth: PAY_MONTH, records: [] }),
    );
    expect(empty.rows).toEqual([]);
    expect(empty.headers).toHaveLength(VARIANCE_EXCEPTION_REPORT_COLUMNS.length);
  });
});

// ── criterion 13.6: the pre-close reconciliation listing ───────────────────────────────────────

describe('buildPreCloseUnreviewedListing (criterion 13.6)', () => {
  it('returns an empty listing for an empty record set', () => {
    const listing = buildPreCloseUnreviewedListing({ payMonth: PAY_MONTH, records: [] });
    expect(listing.rows).toEqual([]);
    expect(listing.employeeCount).toBe(0);
    expect(listing.unreviewedDateCount).toBe(0);
  });

  it('lists each employee with the count of unreviewed dates and the resolved Attendance_Source', () => {
    const records = [
      record({ id: 'vr-1', employeeId: 'emp-1', workDate: '2026-07-01', salaryLineId: 'line-1' }),
      record({ id: 'vr-2', employeeId: 'emp-1', workDate: '2026-07-02', salaryLineId: 'line-1' }),
      record({ id: 'vr-3', employeeId: 'emp-2', workDate: '2026-07-01', salaryLineId: 'line-2' }),
    ];
    const listing = buildPreCloseUnreviewedListing({ payMonth: PAY_MONTH, records });
    expect(listing.employeeCount).toBe(2);
    expect(listing.unreviewedDateCount).toBe(3);
    const first = listing.rows[0]!;
    expect(first.employeeId).toBe('emp-1');
    expect(first.unreviewedDateCount).toBe(2);
    expect(first.unreviewedDates).toEqual(['2026-07-01', '2026-07-02']);
    expect(first.resolvedAttendanceSource).toBe('biometric');
    expect(first.resolvedAttendanceSources).toEqual(['biometric']);
    expect(first.salaryLineId).toBe('line-1');
    expect(first.paidWithUnreviewedVariance).toBe(true);
  });

  it('counts two records on one date as one unreviewed date', () => {
    const records = [
      record({ id: 'vr-1', employeeId: 'emp-1', workDate: '2026-07-01' }),
      record({ id: 'vr-2', employeeId: 'emp-1', workDate: '2026-07-01', canonicalMinutes: 90 }),
    ];
    const listing = buildPreCloseUnreviewedListing({ payMonth: PAY_MONTH, records });
    expect(listing.rows[0]!.unreviewedDateCount).toBe(1);
    expect(listing.rows[0]!.unreviewedRecordIds).toEqual(['vr-1', 'vr-2']);
  });

  it('reports no single resolved source when the line\'s dates resolved differently', () => {
    const records = [
      record({ id: 'vr-1', employeeId: 'emp-1', workDate: '2026-07-01', resolvedSource: 'biometric' }),
      record({
        id: 'vr-2',
        employeeId: 'emp-1',
        workDate: '2026-07-02',
        resolvedSource: 'dialler',
        dayClassification: 'absent',
      }),
    ];
    const listing = buildPreCloseUnreviewedListing({ payMonth: PAY_MONTH, records });
    expect(listing.rows[0]!.resolvedAttendanceSource).toBeNull();
    expect(listing.rows[0]!.resolvedAttendanceSources).toEqual(['biometric', 'dialler']);
    expect(listing.rows[0]!.dates.map((d) => d.resolvedAttendanceSource)).toEqual([
      'biometric',
      'dialler',
    ]);
  });

  it('excludes Recorded_Not_Queued and already-reviewed records', () => {
    const records = [
      record({ id: 'vr-rnq', employeeId: 'emp-1', queueState: 'recorded_not_queued' }),
      record({ id: 'vr-reviewed', employeeId: 'emp-2', status: 'reviewed' }),
      record({ id: 'vr-contested', employeeId: 'emp-3', status: 'contested' }),
      record({ id: 'vr-open', employeeId: 'emp-4' }),
    ];
    const listing = buildPreCloseUnreviewedListing({ payMonth: PAY_MONTH, records });
    expect(listing.rows.map((row) => row.employeeId)).toEqual(['emp-4']);
  });

  it('reports a null salary line rather than an order-dependent one when two records disagree', () => {
    const records = [
      record({ id: 'vr-1', employeeId: 'emp-1', workDate: '2026-07-01', salaryLineId: 'line-a' }),
      record({ id: 'vr-2', employeeId: 'emp-1', workDate: '2026-07-02', salaryLineId: 'line-b' }),
    ];
    expect(buildPreCloseUnreviewedListing({ payMonth: PAY_MONTH, records }).rows[0]!.salaryLineId)
      .toBeNull();
  });

  it('carries the carried-forward Pay_Month onto the date detail (criterion 9.3)', () => {
    const listing = buildPreCloseUnreviewedListing({
      payMonth: PAY_MONTH,
      records: [record({ carriedForwardFromPayMonth: '2026-06' })],
    });
    expect(listing.rows[0]!.dates[0]!.carriedForwardFromPayMonth).toBe('2026-06');
  });

  it('narrows to the requested branches, and treats an empty branch list as every branch', () => {
    const records = [
      record({ id: 'vr-a', employeeId: 'emp-1', branchId: BRANCH_A }),
      record({ id: 'vr-b', employeeId: 'emp-2', branchId: BRANCH_B }),
    ];
    expect(
      buildPreCloseUnreviewedListing({ payMonth: PAY_MONTH, records, branchIds: [BRANCH_B] }).rows
        .map((row) => row.employeeId),
    ).toEqual(['emp-2']);
    expect(
      buildPreCloseUnreviewedListing({ payMonth: PAY_MONTH, records, branchIds: [] }).employeeCount,
    ).toBe(2);
  });
});

// ── criterion 13.7: a contested record's conflicting outcomes and comments, together ───────────

describe('describeContestedRecord (criteria 13.7, 7.10)', () => {
  it('displays both conflicting outcomes with their reviewer comments', () => {
    const contested = record({
      status: 'contested',
      wfmReview: review('wfm_reviewer', 'apr_accepted', WFM_USER, 'The punches corroborate a full day here.'),
      managerReview: review(
        'reporting_manager',
        'adjustment_requested',
        MANAGER_USER,
        'The agent was on a client call not logged by the dialler.',
      ),
    });
    const display = describeContestedRecord(contested);
    expect(display.displayed).toBe(true);
    if (!display.displayed) return;
    expect(display.conflict).toEqual({ conflicting: true, reason: 'accepted_versus_adjustment' });
    expect(display.assessmentAgreesWithContestedStatus).toBe(true);
    expect(display.outcomes).toHaveLength(2);
    expect(display.outcomes[0]!.role).toBe('wfm_reviewer');
    expect(display.outcomes[0]!.comment).toBe('The punches corroborate a full day here.');
    expect(display.outcomes[0]!.requestedClassification).toBeNull();
    expect(display.outcomes[1]!.role).toBe('reporting_manager');
    expect(display.outcomes[1]!.comment).toBe(
      'The agent was on a client call not logged by the dialler.',
    );
    expect(display.outcomes[1]!.requestedClassification).toBe('half_day');
    expect(display.overrideApproverUserIds).toEqual([OVERRIDE_APPROVER]);
    expect(display.unroutable).toBe(false);
  });

  it('does not display a record that is not marked contested, but still returns what is recorded', () => {
    const display = describeContestedRecord(
      record({ wfmReview: review('wfm_reviewer', 'apr_disputed', WFM_USER) }),
    );
    expect(display.displayed).toBe(false);
    if (display.displayed) return;
    expect(display.reason).toBe('not_marked_contested');
    expect(display.outcomes).toHaveLength(1);
  });

  it('reports a contested record whose second outcome is missing rather than inventing a conflict', () => {
    const display = describeContestedRecord(
      record({ status: 'contested', wfmReview: review('wfm_reviewer', 'apr_disputed', WFM_USER) }),
    );
    expect(display.displayed).toBe(false);
    if (display.displayed) return;
    expect(display.reason).toBe('second_outcome_not_recorded');
  });

  it('still displays the outcomes when the contested status disagrees with the assessment', () => {
    // Both reviewers accepted, so criterion 7.10's reading is that they AGREE -- yet the record is
    // marked contested. An Override_Approver must still be able to read both outcomes.
    const display = describeContestedRecord(
      record({
        status: 'contested',
        wfmReview: review('wfm_reviewer', 'apr_accepted', WFM_USER),
        managerReview: review('reporting_manager', 'apr_accepted', MANAGER_USER),
      }),
    );
    expect(display.displayed).toBe(true);
    if (!display.displayed) return;
    expect(display.conflict.conflicting).toBe(false);
    expect(display.assessmentAgreesWithContestedStatus).toBe(false);
    expect(display.outcomes).toHaveLength(2);
  });

  it('flags an unroutable dispute when the branch has no Override_Approver', () => {
    const display = describeContestedRecord(
      record({
        status: 'contested',
        overrideApproverUserIds: [],
        wfmReview: review('wfm_reviewer', 'apr_accepted', WFM_USER),
        managerReview: review('reporting_manager', 'apr_disputed', MANAGER_USER),
      }),
    );
    expect(display.displayed).toBe(true);
    if (!display.displayed) return;
    expect(display.unroutable).toBe(true);
  });
});

// ── criterion 13.8: outstanding count and WHOLE days until Payroll_Cut_Off ─────────────────────

describe('buildQueueClearanceOutlook (criterion 13.8)', () => {
  const outstandingSet: readonly ReportableVarianceRecord[] = [
    record({ id: 'vr-open', employeeId: 'emp-1', workDate: '2026-07-01' }),
    record({ id: 'vr-notified', employeeId: 'emp-2', workDate: '2026-07-02', status: 'notified' }),
    record({ id: 'vr-reviewed', employeeId: 'emp-3', workDate: '2026-07-03', status: 'reviewed' }),
    record({
      id: 'vr-rnq',
      employeeId: 'emp-4',
      workDate: '2026-07-04',
      queueState: 'recorded_not_queued',
    }),
    record({
      id: 'vr-carried',
      employeeId: 'emp-5',
      workDate: '2026-07-05',
      carriedForwardFromPayMonth: '2026-06',
    }),
    record({ id: 'vr-otherbranch', employeeId: 'emp-6', branchId: BRANCH_B }),
  ];

  it('counts the outstanding records and no others', () => {
    const outlook = buildQueueClearanceOutlook({
      payMonth: PAY_MONTH,
      branchId: BRANCH_A,
      records: outstandingSet,
      payrollCutOffDate: '2026-08-05',
      referenceDate: '2026-07-31',
    });
    expect(outlook.outstandingRecordIds).toEqual(['vr-carried', 'vr-notified', 'vr-open']);
    expect(outlook.outstandingVarianceRecordCount).toBe(3);
    expect(outlook.outstandingEmployeeIds).toEqual(['emp-1', 'emp-2', 'emp-5']);
    expect(outlook.outstandingCarriedForwardCount).toBe(1);
    expect(outlook.outOfScopeRecordCount).toBe(1);
  });

  it('counts whole calendar days remaining, five days out', () => {
    const outlook = buildQueueClearanceOutlook({
      payMonth: PAY_MONTH,
      branchId: BRANCH_A,
      records: [],
      payrollCutOffDate: '2026-08-05',
      referenceDate: '2026-07-31',
    });
    expect(outlook.wholeDaysRemainingUntilPayrollCutOff).toBe(5);
    expect(outlook.pastPayrollCutOff).toBe(false);
  });

  it('reports zero on the cut-off date itself, and one the day before', () => {
    const onTheDay = buildQueueClearanceOutlook({
      payMonth: PAY_MONTH,
      branchId: BRANCH_A,
      records: [],
      payrollCutOffDate: '2026-08-05',
      referenceDate: '2026-08-05',
    });
    expect(onTheDay.wholeDaysRemainingUntilPayrollCutOff).toBe(0);
    expect(onTheDay.pastPayrollCutOff).toBe(false);

    const dayBefore = buildQueueClearanceOutlook({
      payMonth: PAY_MONTH,
      branchId: BRANCH_A,
      records: [],
      payrollCutOffDate: '2026-08-05',
      referenceDate: '2026-08-04',
    });
    expect(dayBefore.wholeDaysRemainingUntilPayrollCutOff).toBe(1);
  });

  it('reports zero, never a negative number, once the cut-off is in the past', () => {
    for (const referenceDate of ['2026-08-06', '2026-09-30', '2027-01-01']) {
      const outlook = buildQueueClearanceOutlook({
        payMonth: PAY_MONTH,
        branchId: BRANCH_A,
        records: outstandingSet,
        payrollCutOffDate: '2026-08-05',
        referenceDate,
      });
      expect(outlook.wholeDaysRemainingUntilPayrollCutOff).toBe(0);
      expect(outlook.pastPayrollCutOff).toBe(true);
      // The queue is still outstanding; only the time available has run out.
      expect(outlook.outstandingVarianceRecordCount).toBe(3);
    }
  });

  it('reports a null day count when no Payroll_Cut_Off is scheduled', () => {
    const outlook = buildQueueClearanceOutlook({
      payMonth: PAY_MONTH,
      branchId: BRANCH_A,
      records: [],
      payrollCutOffDate: null,
      referenceDate: '2026-07-31',
    });
    expect(outlook.wholeDaysRemainingUntilPayrollCutOff).toBeNull();
    expect(outlook.pastPayrollCutOff).toBe(false);
  });

  it('reads the calendar date only: the hour of the reference timestamp cannot change the count', () => {
    const counts = ['2026-07-31', '2026-07-31T00:00:00', '2026-07-31T23:59:59+05:30'].map(
      (referenceDate) =>
        buildQueueClearanceOutlook({
          payMonth: PAY_MONTH,
          branchId: BRANCH_A,
          records: [],
          payrollCutOffDate: '2026-08-05T18:00:00',
          referenceDate,
        }).wholeDaysRemainingUntilPayrollCutOff,
    );
    expect(counts).toEqual([5, 5, 5]);
  });

  it('crosses a month and a year boundary exactly', () => {
    expect(
      buildQueueClearanceOutlook({
        payMonth: '2026-12',
        branchId: BRANCH_A,
        records: [],
        payrollCutOffDate: '2027-01-05',
        referenceDate: '2026-12-31',
      }).wholeDaysRemainingUntilPayrollCutOff,
    ).toBe(5);
  });

  it('throws for a malformed reference date (programmer error)', () => {
    expect(() =>
      buildQueueClearanceOutlook({
        payMonth: PAY_MONTH,
        branchId: BRANCH_A,
        records: [],
        payrollCutOffDate: '2026-08-05',
        referenceDate: 'not-a-date',
      }),
    ).toThrow();
  });
});

// ── Generators for the properties ──────────────────────────────────────────────────────────────

interface GeneratedSpec {
  readonly employeeId: string;
  readonly branchId: string;
  readonly costCentreId: string | null;
  readonly processId: string | null;
  readonly designationId: string | null;
  readonly day: number;
  readonly payMonth: string;
  readonly queueState: QueueState;
  readonly status: VarianceRecordStatus;
  readonly floorAbsence: boolean;
  readonly carried: boolean;
  readonly canonicalMinutes: number;
  readonly wfmOutcome: ReviewOutcome | null;
  readonly managerOutcome: ReviewOutcome | null;
  readonly diallerSources: readonly string[];
}

// A smart generator, not a broad one: the grouping dimensions are drawn from small pools so that
// generated sets actually COLLIDE into shared groupings (a fresh uuid per record would put every
// record in a grouping of one and the aggregate would never be exercised), the day is 1..28 so
// every date exists in every month, and null is drawn deliberately on all three nullable dimensions
// so the unassigned grouping is reached.
const specArb: fc.Arbitrary<GeneratedSpec> = fc.record({
  employeeId: fc.constantFrom('emp-1', 'emp-2', 'emp-3'),
  branchId: fc.constantFrom(BRANCH_A, BRANCH_B),
  costCentreId: fc.option(fc.constantFrom('cc-1', 'cc-2'), { nil: null }),
  processId: fc.option(fc.constantFrom('proc-voice', 'proc-chat'), { nil: null }),
  designationId: fc.option(fc.constantFrom('desig-exec', 'desig-tl'), { nil: null }),
  day: fc.integer({ min: 1, max: 28 }),
  payMonth: fc.constantFrom('2026-06', '2026-07'),
  queueState: fc.constantFrom<QueueState>('queued_for_dual_review', 'recorded_not_queued'),
  status: fc.constantFrom<VarianceRecordStatus>(
    'open',
    'notified',
    'reviewed',
    'contested',
    'no_issue',
    'regularization_required',
  ),
  floorAbsence: fc.boolean(),
  carried: fc.boolean(),
  canonicalMinutes: fc.integer({ min: 0, max: 480 }),
  wfmOutcome: fc.option(
    fc.constantFrom<ReviewOutcome>('apr_accepted', 'apr_disputed', 'adjustment_requested'),
    { nil: null },
  ),
  managerOutcome: fc.option(
    fc.constantFrom<ReviewOutcome>('apr_accepted', 'apr_disputed', 'adjustment_requested'),
    { nil: null },
  ),
  diallerSources: fc.subarray([SOURCE_VICI, SOURCE_MANUAL]),
});

/** Ids are assigned by index, so a generated set never trips the conflicting-duplicate-id guard. */
function materialise(specs: readonly GeneratedSpec[]): readonly ReportableVarianceRecord[] {
  return specs.map((spec, index) =>
    record({
      id: `vr-${index}`,
      employeeId: spec.employeeId,
      branchId: spec.branchId,
      costCentreId: spec.costCentreId,
      processId: spec.processId,
      designationId: spec.designationId,
      payMonth: spec.payMonth,
      workDate: `${spec.payMonth}-${String(spec.day).padStart(2, '0')}`,
      queueState: spec.queueState,
      status: spec.status,
      floorAbsence: spec.floorAbsence,
      carriedForwardFromPayMonth: spec.carried ? '2026-05' : null,
      canonicalMinutes: spec.canonicalMinutes,
      wfmReview:
        spec.wfmOutcome === null ? null : review('wfm_reviewer', spec.wfmOutcome, WFM_USER),
      managerReview:
        spec.managerOutcome === null
          ? null
          : review('reporting_manager', spec.managerOutcome, MANAGER_USER),
      diallerContributions: spec.diallerSources.map((id) => ({
        id,
        minutes: spec.canonicalMinutes,
      })),
    }),
  );
}

const ceilingArb: fc.Arbitrary<DualReviewCeilingConfig> = fc.record({
  branchId: fc.constantFrom(BRANCH_A, BRANCH_B),
  payMonth: fc.constantFrom('2026-06', '2026-07'),
  // null (no row), a usable whole number including ZERO, a negative, and a fraction.
  ceiling: fc.oneof(
    fc.constant(null),
    fc.integer({ min: -10, max: 200 }),
    fc.constant(2.5),
    fc.constant(Number.NaN),
  ),
});

const filterArb: fc.Arbitrary<VarianceQueueFilter> = fc.record({
  payMonths: fc.option(fc.subarray(['2026-06', '2026-07']), { nil: null }),
  branchIds: fc.option(fc.subarray([BRANCH_A, BRANCH_B]), { nil: null }),
  processIds: fc.option(fc.subarray<string | null>(['proc-voice', 'proc-chat', null]), {
    nil: null,
  }),
  costCentreIds: fc.option(fc.subarray<string | null>(['cc-1', 'cc-2', null]), { nil: null }),
  diallerSourceIds: fc.option(fc.subarray([SOURCE_VICI, SOURCE_MANUAL]), { nil: null }),
  reviewStates: fc.option(
    fc.subarray<VarianceRecordStatus>([
      'open',
      'notified',
      'reviewed',
      'contested',
      'no_issue',
      'regularization_required',
    ]),
    { nil: null },
  ),
  queueStates: fc.option(
    fc.subarray<QueueState>(['queued_for_dual_review', 'recorded_not_queued']),
    { nil: null },
  ),
  carriedForward: fc.option(fc.boolean(), { nil: null }),
});

const calendarDateArb: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2024, max: 2029 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ year, month, day }) =>
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );

// ── Properties ────────────────────────────────────────────────────────────────────────────────

describe('Property: the count raised equals queued plus recorded_not_queued on every grouping', () => {
  it('holds for every generated record set, ceiling configuration and Pay_Month', () => {
    // Feature: payroll-attendance-source-rules, acceptance criteria 13.4, 6.13 (no-discard property)
    // **Validates: Requirements 13.4**
    fc.assert(
      fc.property(
        fc.array(specArb, { maxLength: 25 }),
        fc.constantFrom('2026-06', '2026-07'),
        fc.array(ceilingArb, { maxLength: 4 }),
        (specs, payMonth, ceilings) => {
          const report = buildVarianceExceptionReport({
            payMonth,
            records: materialise(specs),
            dualReviewCeilings: ceilings,
          });

          // The invariant, checked over EVERY reported grouping and the footer.
          const check = checkNoDiscardInvariant(report);
          expect(check.holds).toBe(true);
          expect(check.violations).toEqual([]);
          expect(check.checkedGroupingCount).toBe(report.groupings.length + 1);

          for (const grouping of report.groupings) {
            expect(grouping.raised).toBe(
              grouping.queuedForDualReview + grouping.recordedNotQueued,
            );
            // The queued set partitions exactly into reviewed and unreviewed.
            expect(grouping.reviewed + grouping.unreviewed).toBe(grouping.queuedForDualReview);
            // Every count is a non-negative whole number, and the subsets stay inside their sets.
            for (const value of [
              grouping.raised,
              grouping.queuedForDualReview,
              grouping.recordedNotQueued,
              grouping.queuedAsFloorAbsencePattern,
              grouping.reviewed,
              grouping.unreviewed,
              grouping.contested,
              grouping.adjusted,
            ]) {
              expect(Number.isInteger(value)).toBe(true);
              expect(value).toBeGreaterThanOrEqual(0);
            }
            expect(grouping.queuedAsFloorAbsencePattern).toBeLessThanOrEqual(
              grouping.queuedForDualReview,
            );
            expect(grouping.contested).toBeLessThanOrEqual(grouping.raised);
            expect(grouping.adjusted).toBeLessThanOrEqual(grouping.raised);
            expect(grouping.raised).toBeGreaterThan(0);
            // criterion 6.10: the applied ceiling is always a usable whole number.
            expect(Number.isInteger(grouping.appliedDualReviewCeiling)).toBe(true);
            expect(grouping.appliedDualReviewCeiling).toBeGreaterThanOrEqual(0);
          }

          // The footer holds it too, and equals the sum of the groupings.
          expect(report.overall.raised).toBe(
            report.overall.queuedForDualReview + report.overall.recordedNotQueued,
          );
          expect(report.groupings.reduce((total, g) => total + g.raised, 0)).toBe(
            report.overall.raised,
          );
          expect(report.overall.groupingCount).toBe(report.groupings.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is ordering-independent: the same records shuffled produce an identical report', () => {
    // Feature: payroll-attendance-source-rules, acceptance criterion 13.4 (determinism)
    // **Validates: Requirements 13.4**
    fc.assert(
      fc.property(fc.array(specArb, { maxLength: 20 }), (specs) => {
        const records = materialise(specs);
        const forward = buildVarianceExceptionReport({ payMonth: PAY_MONTH, records });
        const reversed = buildVarianceExceptionReport({
          payMonth: PAY_MONTH,
          records: [...records].reverse(),
        });
        expect(forward).toEqual(reversed);
      }),
      { numRuns: 200 },
    );
  });
});

describe('Property: filtering is a subset operation and composes in either order', () => {
  it('a filtered result is always a subset of the unfiltered set', () => {
    // Feature: payroll-attendance-source-rules, acceptance criterion 13.2
    // **Validates: Requirements 13.2**
    fc.assert(
      fc.property(fc.array(specArb, { maxLength: 20 }), filterArb, (specs, filter) => {
        const records = materialise(specs);
        const unfiltered = applyQueueFilter(records, null);
        const filtered = applyQueueFilter(records, filter);
        const unfilteredIds = new Set(unfiltered.map((r) => r.id));
        expect(filtered.length).toBeLessThanOrEqual(unfiltered.length);
        for (const survivor of filtered) expect(unfilteredIds.has(survivor.id)).toBe(true);
        // Every member of the result is the very object that was supplied, not a copy of it.
        for (const survivor of filtered) expect(records).toContain(survivor);
      }),
      { numRuns: 300 },
    );
  });

  it('an empty filter is the identity, whether written as {} or as empty arrays', () => {
    // Feature: payroll-attendance-source-rules, acceptance criterion 13.2
    // **Validates: Requirements 13.2**
    fc.assert(
      fc.property(fc.array(specArb, { maxLength: 20 }), (specs) => {
        const records = materialise(specs);
        const baseline = applyQueueFilter(records, null).map((r) => r.id);
        expect(applyQueueFilter(records, {}).map((r) => r.id)).toEqual(baseline);
        expect(
          applyQueueFilter(records, {
            payMonths: [],
            branchIds: [],
            processIds: [],
            costCentreIds: [],
            diallerSourceIds: [],
            reviewStates: [],
            queueStates: [],
            carriedForward: null,
          }).map((r) => r.id),
        ).toEqual(baseline);
      }),
      { numRuns: 200 },
    );
  });

  it('applying two filters in either order gives the same set', () => {
    // Feature: payroll-attendance-source-rules, acceptance criterion 13.2 (filter composition)
    // **Validates: Requirements 13.2**
    fc.assert(
      fc.property(
        fc.array(specArb, { maxLength: 20 }),
        filterArb,
        filterArb,
        (specs, first, second) => {
          const records = materialise(specs);
          const firstThenSecond = applyQueueFilter(applyQueueFilter(records, first), second);
          const secondThenFirst = applyQueueFilter(applyQueueFilter(records, second), first);
          expect(firstThenSecond.map((r) => r.id)).toEqual(secondThenFirst.map((r) => r.id));
          // And composing is never wider than either filter alone.
          expect(firstThenSecond.length).toBeLessThanOrEqual(
            applyQueueFilter(records, first).length,
          );
          expect(firstThenSecond.length).toBeLessThanOrEqual(
            applyQueueFilter(records, second).length,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('a listing never returns a record outside the viewer\'s scope, filtered or not', () => {
    // Feature: payroll-attendance-source-rules, acceptance criteria 13.1, 13.2, 14.4
    // **Validates: Requirements 13.1**
    fc.assert(
      fc.property(fc.array(specArb, { maxLength: 20 }), filterArb, (specs, filter) => {
        const records = materialise(specs);
        const listing = listVarianceReviewQueue({
          viewer: { userId: 'user-nobody', employeeId: 'emp-nobody' },
          records,
          filter,
        });
        // 'user-nobody' holds no slot, no Override_Approver grant and no branch scope.
        expect(listing.rows).toEqual([]);
        expect(listing.outOfScopeRecordCount).toBe(new Set(records.map((r) => r.id)).size);
        expect(listing.ownOutstandingCount).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});

describe('Property: the export columns are the screen columns', () => {
  it('every export row carries exactly the screen row cells, in the screen column order', () => {
    // Feature: payroll-attendance-source-rules, acceptance criterion 13.5
    // **Validates: Requirements 13.5**
    fc.assert(
      fc.property(
        fc.array(specArb, { maxLength: 20 }),
        fc.constantFrom('2026-06', '2026-07'),
        fc.array(ceilingArb, { maxLength: 3 }),
        (specs, payMonth, ceilings) => {
          const report = buildVarianceExceptionReport({
            payMonth,
            records: materialise(specs),
            dualReviewCeilings: ceilings,
          });
          const screenRows = buildVarianceExceptionScreenRows(report);
          const exported = buildVarianceExceptionExport(report);

          expect(exported.columnKeys).toEqual(
            VARIANCE_EXCEPTION_REPORT_COLUMNS.map((column) => column.key),
          );
          expect(exported.headers).toEqual(
            VARIANCE_EXCEPTION_REPORT_COLUMNS.map((column) => column.header),
          );
          expect(exported.rows).toHaveLength(screenRows.length);
          expect(exported.rowCount).toBe(report.groupings.length);

          screenRows.forEach((screenRow, rowIndex) => {
            expect(Object.keys(screenRow)).toEqual([...exported.columnKeys]);
            const exportedRow = exported.rows[rowIndex]!;
            expect(exportedRow).toHaveLength(exported.columnKeys.length);
            exported.columnKeys.forEach((key, columnIndex) => {
              expect(exportedRow[columnIndex]).toBe(screenRow[key]);
            });
          });
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('Property: the whole-day count until Payroll_Cut_Off is never negative', () => {
  it('is a non-negative whole number, zero exactly on and after the cut-off date', () => {
    // Feature: payroll-attendance-source-rules, acceptance criterion 13.8
    // **Validates: Requirements 13.8**
    fc.assert(
      fc.property(
        calendarDateArb,
        fc.option(calendarDateArb, { nil: null }),
        fc.array(specArb, { maxLength: 10 }),
        (referenceDate, payrollCutOffDate, specs) => {
          const outlook = buildQueueClearanceOutlook({
            payMonth: PAY_MONTH,
            branchId: BRANCH_A,
            records: materialise(specs),
            payrollCutOffDate,
            referenceDate,
          });
          const days = outlook.wholeDaysRemainingUntilPayrollCutOff;

          if (payrollCutOffDate === null) {
            expect(days).toBeNull();
            expect(outlook.pastPayrollCutOff).toBe(false);
            return;
          }
          expect(days).not.toBeNull();
          expect(days!).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(days!)).toBe(true);
          // Both dates are fixed-width and zero-padded, so a string comparison is the same order the
          // module computes arithmetically -- which is what makes this an independent check.
          expect(days === 0).toBe(payrollCutOffDate <= referenceDate);
          expect(outlook.pastPayrollCutOff).toBe(payrollCutOffDate < referenceDate);
          // The outstanding count never depends on the clock.
          expect(outlook.outstandingVarianceRecordCount).toBe(
            materialise(specs).filter(
              (r) =>
                r.branchId === BRANCH_A &&
                r.payMonth === PAY_MONTH &&
                isQueuedReportable(r) &&
                (r.status === 'open' || r.status === 'notified'),
            ).length,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
