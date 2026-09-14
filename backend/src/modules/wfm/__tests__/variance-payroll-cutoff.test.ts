// backend/src/modules/wfm/__tests__/variance-payroll-cutoff.test.ts
//
// Requirement 9 of requirements.md. The unit tests cover each criterion by number; the property
// tests at the end cover the two guarantees that must hold for every input rather than for the
// examples somebody thought of: "the default configuration never blocks a payroll run" (criteria
// 9.1, 9.8) and "the six reconciliation counts partition" (criterion 9.5).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildPreCloseReconciliation,
  comparePayMonths,
  decidePayrollCutOff,
  deriveCarryForward,
  earliestOpenPayMonth,
  resolveFeatureFlag,
  reviewClosedMonthRecord,
  splitDetectionFromPresentation,
  FEATURE_FLAG_MISMATCH_WORKFLOW_ENABLED,
  FEATURE_FLAG_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH,
  RELEASE_DEFAULT_MISMATCH_WORKFLOW_ENABLED,
  RELEASE_DEFAULT_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH,
  type PayrollVarianceRecord,
  type VarianceRecordStatus,
} from '../variance-payroll-cutoff.js';

const PAY_MONTH = '2026-07';
const BRANCH = 'branch-hyd';

let seq = 0;
function rec(overrides: Partial<PayrollVarianceRecord> = {}): PayrollVarianceRecord {
  seq += 1;
  return {
    recordId: `vr-${seq}`,
    employeeId: 'emp-1',
    branchId: BRANCH,
    attendanceDate: `${PAY_MONTH}-05`,
    payMonth: PAY_MONTH,
    queueState: 'queued_for_dual_review',
    status: 'open',
    reviewOutcome: null,
    varianceDecision: 'raised_biometric_shortfall',
    salaryLineId: 'line-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// criterion 9.5: the pre-close reconciliation view
// ---------------------------------------------------------------------------------------------

describe('buildPreCloseReconciliation - criterion 9.5', () => {
  it('states all six counts for a Pay_Month and branch', () => {
    const records = [
      rec({ status: 'open' }),
      rec({ status: 'notified' }),
      rec({ status: 'reviewed', reviewOutcome: 'apr_accepted' }),
      rec({ status: 'no_issue', reviewOutcome: 'apr_accepted' }),
      rec({ status: 'regularization_required', reviewOutcome: 'adjustment_requested' }),
      rec({ status: 'contested', reviewOutcome: 'apr_disputed' }),
      rec({ queueState: 'recorded_not_queued', status: 'open' }),
      rec({ queueState: 'recorded_not_queued', status: 'open' }),
    ];

    const view = buildPreCloseReconciliation({ payMonth: PAY_MONTH, branchId: BRANCH, records });

    expect(view.raised).toBe(8);
    expect(view.queuedForDualReview).toBe(6);
    expect(view.recordedNotQueued).toBe(2);
    expect(view.reviewed).toBe(4);
    expect(view.unreviewed).toBe(2);
    expect(view.contested).toBe(1);
  });

  it('partitions raised into queued + recordedNotQueued, and queued into reviewed + unreviewed', () => {
    const records = [
      rec({ status: 'open' }),
      rec({ status: 'notified' }),
      rec({ status: 'contested' }),
      rec({ queueState: 'recorded_not_queued', status: 'notified' }),
    ];

    const view = buildPreCloseReconciliation({ payMonth: PAY_MONTH, branchId: BRANCH, records });

    expect(view.queuedForDualReview + view.recordedNotQueued).toBe(view.raised);
    expect(view.reviewed + view.unreviewed).toBe(view.queuedForDualReview);
    // A recorded_not_queued record was never presented, so it is NOT unreviewed: only the two
    // queued open/notified records are.
    expect(view.unreviewed).toBe(2);
    expect(view.contestedQueued).toBeLessThanOrEqual(view.reviewed);
  });

  it('counts a contested record as reviewed, not as unreviewed', () => {
    const contested = rec({ status: 'contested', reviewOutcome: 'apr_disputed' });
    const view = buildPreCloseReconciliation({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [contested],
    });

    expect(view.unreviewed).toBe(0);
    expect(view.reviewed).toBe(1);
    expect(view.contested).toBe(1);
    expect(view.contestedQueued).toBe(1);

    // A contested record whose branch has since turned mismatch_workflow_enabled off is no longer
    // presented, so it leaves `reviewed` — but the dispute is real and must stay visible under
    // `contested`. This is why `contested` is counted over the raised set and only
    // `contestedQueued` is a sub-count of `reviewed`.
    const gated = buildPreCloseReconciliation({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [contested],
      mismatchWorkflowEnabled: 0,
    });
    expect(gated.contested).toBe(1);
    expect(gated.contestedQueued).toBe(0);
    expect(gated.reviewed).toBe(0);
    expect(gated.recordedNotQueued).toBe(1);
  });

  it('excludes records from another branch or another Pay_Month and says how many', () => {
    const view = buildPreCloseReconciliation({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [
        rec(),
        rec({ branchId: 'branch-blr' }),
        rec({ payMonth: '2026-08', attendanceDate: '2026-08-03' }),
      ],
    });

    expect(view.raised).toBe(1);
    expect(view.outOfScopeRecordCount).toBe(2);
  });

  it('names the unreviewed records and employees, sorted', () => {
    const view = buildPreCloseReconciliation({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [
        rec({ recordId: 'vr-z', employeeId: 'emp-9', status: 'notified' }),
        rec({ recordId: 'vr-a', employeeId: 'emp-2', status: 'open' }),
        rec({ recordId: 'vr-m', employeeId: 'emp-2', status: 'open' }),
      ],
    });

    expect(view.unreviewedRecordIds).toEqual(['vr-a', 'vr-m', 'vr-z']);
    expect(view.unreviewedEmployeeIds).toEqual(['emp-2', 'emp-9']);
  });

  it('returns all-zero counts for an empty record set', () => {
    const view = buildPreCloseReconciliation({ payMonth: PAY_MONTH, branchId: BRANCH, records: [] });

    expect(view.raised).toBe(0);
    expect(view.queuedForDualReview).toBe(0);
    expect(view.recordedNotQueued).toBe(0);
    expect(view.reviewed).toBe(0);
    expect(view.unreviewed).toBe(0);
    expect(view.contested).toBe(0);
    expect(view.contestedQueued).toBe(0);
    expect(view.unreviewedRecordIds).toEqual([]);
    expect(view.configurationWarnings).toEqual([]);
  });

  it('throws on a malformed Pay_Month, which is a programmer error rather than data', () => {
    expect(() =>
      buildPreCloseReconciliation({ payMonth: '2026-7', branchId: BRANCH, records: [] }),
    ).toThrow(/'YYYY-MM'/);
    expect(() =>
      buildPreCloseReconciliation({ payMonth: PAY_MONTH, branchId: BRANCH, records: [rec({ payMonth: '2026-13' })] }),
    ).toThrow(/record\.payMonth/);
  });

  it('throws when one recordId carries two different records', () => {
    expect(() =>
      buildPreCloseReconciliation({
        payMonth: PAY_MONTH,
        branchId: BRANCH,
        records: [rec({ recordId: 'vr-dup', status: 'open' }), rec({ recordId: 'vr-dup', status: 'reviewed' })],
      }),
    ).toThrow(/primary key/);
  });

  it('collapses an exactly duplicated record, so a doubled list changes nothing', () => {
    const one = rec();
    const single = buildPreCloseReconciliation({ payMonth: PAY_MONTH, branchId: BRANCH, records: [one] });
    const doubled = buildPreCloseReconciliation({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [one, { ...one }],
    });

    expect(doubled).toEqual(single);
  });
});

// ---------------------------------------------------------------------------------------------
// criteria 9.1, 9.2, 9.6, 9.8: the cut-off decision
// ---------------------------------------------------------------------------------------------

describe('decidePayrollCutOff - criteria 9.1, 9.2 (default proceeds)', () => {
  it('proceeds with unreviewed records when the lock flag is absent (criterion 9.8 default)', () => {
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [rec({ status: 'open' }), rec({ status: 'notified' })],
    });

    expect(decision.disposition).toBe('proceeds');
    expect(decision.mayProceed).toBe(true);
    expect(decision.payrollLockOnUnresolvedMismatch).toBe(0);
    expect(decision.lockFlagWasAbsent).toBe(true);
    if (decision.disposition !== 'proceeds') throw new Error('unreachable');
    // criterion 9.1: Payable_Days still derive from the resolved Attendance_Source.
    expect(decision.payableDaysBasis).toBe('resolved_attendance_source');
    expect(decision.unreviewedQueuedCount).toBe(2);
  });

  it('proceeds for an explicit 0 and for every unreadable flag spelling', () => {
    for (const raw of [0, '0', 'false', false, '', '  ', 'maybe', 7, -1, Number.NaN]) {
      const decision = decidePayrollCutOff({
        payMonth: PAY_MONTH,
        branchId: BRANCH,
        records: [rec({ status: 'open' })],
        payrollLockOnUnresolvedMismatch: raw as never,
      });
      expect(decision.mayProceed).toBe(true);
      expect(decision.payrollLockOnUnresolvedMismatch).toBe(0);
    }
  });

  it('warns but still proceeds when the flag value is present and unreadable', () => {
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [rec({ status: 'open' })],
      payrollLockOnUnresolvedMismatch: 'perhaps',
    });

    expect(decision.mayProceed).toBe(true);
    expect(decision.configurationWarnings.join(' ')).toContain(
      FEATURE_FLAG_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH,
    );
  });

  it('marks each affected salary line with the count of unreviewed dates on it (criterion 9.2)', () => {
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [
        rec({ employeeId: 'emp-2', attendanceDate: '2026-07-03', status: 'open' }),
        rec({ employeeId: 'emp-2', attendanceDate: '2026-07-09', status: 'notified' }),
        // Same employee, same date, two records: one date, counted once.
        rec({ employeeId: 'emp-2', attendanceDate: '2026-07-09', status: 'open' }),
        rec({ employeeId: 'emp-1', attendanceDate: '2026-07-11', status: 'open' }),
        // Already reviewed: not an unreviewed variance, so no mark.
        rec({ employeeId: 'emp-3', attendanceDate: '2026-07-12', status: 'reviewed' }),
      ],
    });

    if (decision.disposition !== 'proceeds') throw new Error('unreachable');
    expect(decision.salaryLineMarks.map((m) => m.employeeId)).toEqual(['emp-1', 'emp-2']);

    const empTwo = decision.salaryLineMarks.find((m) => m.employeeId === 'emp-2')!;
    expect(empTwo.paidWithUnreviewedVariance).toBe(true);
    expect(empTwo.unreviewedDateCount).toBe(2);
    expect(empTwo.unreviewedDates).toEqual(['2026-07-03', '2026-07-09']);
    expect(empTwo.varianceRecordIds).toHaveLength(3);
    expect(decision.salaryLineMarks.some((m) => m.employeeId === 'emp-3')).toBe(false);
  });

  it('makes no mark when nothing is unreviewed', () => {
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [rec({ status: 'reviewed' }), rec({ status: 'no_issue' })],
    });

    if (decision.disposition !== 'proceeds') throw new Error('unreachable');
    expect(decision.salaryLineMarks).toEqual([]);
    expect(decision.unreviewedQueuedCount).toBe(0);
  });

  it('does not mark a recorded_not_queued record, which nobody was asked to review', () => {
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [rec({ queueState: 'recorded_not_queued', status: 'open' })],
    });

    if (decision.disposition !== 'proceeds') throw new Error('unreachable');
    expect(decision.salaryLineMarks).toEqual([]);
    expect(decision.reconciliation.recordedNotQueued).toBe(1);
    expect(decision.reconciliation.unreviewed).toBe(0);
  });

  it('proceeds on an empty record set', () => {
    const decision = decidePayrollCutOff({ payMonth: PAY_MONTH, branchId: BRANCH, records: [] });
    expect(decision.mayProceed).toBe(true);
    expect(decision.reconciliation.raised).toBe(0);
  });
});

describe('decidePayrollCutOff - criterion 9.6 (per-branch opt-in blocks)', () => {
  it('refuses cut-off and names the count of unreviewed records', () => {
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [
        rec({ employeeId: 'emp-1', status: 'open' }),
        rec({ employeeId: 'emp-4', status: 'notified' }),
        rec({ status: 'reviewed' }),
      ],
      payrollLockOnUnresolvedMismatch: 1,
    });

    expect(decision.disposition).toBe('refused_unreviewed_queued_variances');
    expect(decision.mayProceed).toBe(false);
    if (decision.disposition !== 'refused_unreviewed_queued_variances') throw new Error('unreachable');
    expect(decision.unreviewedQueuedCount).toBe(2);
    // criterion 9.6: the refusal SHALL name the count.
    expect(decision.reason).toContain('2');
    expect(decision.reason).toContain(PAY_MONTH);
    expect(decision.blockingEmployeeIds).toEqual(['emp-1', 'emp-4']);
    expect(decision.blockingRecordIds).toHaveLength(2);
  });

  it('accepts 1, "1" and true as the opt-in', () => {
    for (const raw of [1, '1', 'true', 'YES', true]) {
      const decision = decidePayrollCutOff({
        payMonth: PAY_MONTH,
        branchId: BRANCH,
        records: [rec({ status: 'open' })],
        payrollLockOnUnresolvedMismatch: raw as never,
      });
      expect(decision.mayProceed).toBe(false);
    }
  });

  it('proceeds with the flag on once every queued record is reviewed', () => {
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [rec({ status: 'reviewed' }), rec({ status: 'contested' })],
      payrollLockOnUnresolvedMismatch: 1,
    });

    expect(decision.mayProceed).toBe(true);
    expect(decision.payrollLockOnUnresolvedMismatch).toBe(1);
  });

  it('never blocks on a recorded_not_queued record, even with the flag on', () => {
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [
        rec({ queueState: 'recorded_not_queued', status: 'open' }),
        rec({ queueState: 'recorded_not_queued', status: 'notified' }),
      ],
      payrollLockOnUnresolvedMismatch: 1,
    });

    expect(decision.mayProceed).toBe(true);
    expect(decision.reconciliation.recordedNotQueued).toBe(2);
  });

  it('does not block a branch out of another branch\u0027s unreviewed records', () => {
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [rec({ branchId: 'branch-blr', status: 'open' })],
      payrollLockOnUnresolvedMismatch: 1,
    });

    expect(decision.mayProceed).toBe(true);
    expect(decision.reconciliation.outOfScopeRecordCount).toBe(1);
  });

  it('cannot deadlock: with the workflow disabled nothing is presented, so nothing blocks', () => {
    // criteria 9.6 and 9.9 together. Without the presentation gate applied first, a branch with
    // the workflow off and the lock on could never review anything and could never close.
    const decision = decidePayrollCutOff({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [rec({ status: 'open' }), rec({ status: 'notified' })],
      payrollLockOnUnresolvedMismatch: 1,
      mismatchWorkflowEnabled: 0,
    });

    expect(decision.mayProceed).toBe(true);
    expect(decision.reconciliation.queuedForDualReview).toBe(0);
    expect(decision.reconciliation.demotedByPresentationGate).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// criterion 9.3: carry-forward
// ---------------------------------------------------------------------------------------------

describe('deriveCarryForward - criterion 9.3', () => {
  it('carries the unreviewed records forward and names the Pay_Month they came from', () => {
    const result = deriveCarryForward({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records: [
        rec({ recordId: 'vr-open', status: 'open' }),
        rec({ recordId: 'vr-notified', status: 'notified' }),
        rec({ recordId: 'vr-done', status: 'reviewed' }),
        rec({ recordId: 'vr-quiet', queueState: 'recorded_not_queued', status: 'open' }),
      ],
    });

    expect(result.carriedForwardCount).toBe(2);
    expect(result.carriedForward.map((c) => c.record.recordId).sort()).toEqual([
      'vr-notified',
      'vr-open',
    ]);
    for (const carried of result.carriedForward) {
      expect(carried.carriedForwardFromPayMonth).toBe(PAY_MONTH);
      expect(carried.retained).toBe(true);
    }
    expect(result.closedAtCutOffCount).toBe(1);
    expect(result.retainedNotPresented.map((r) => r.recordId)).toEqual(['vr-quiet']);
  });

  it('carries nothing forward from an empty month', () => {
    const result = deriveCarryForward({ payMonth: PAY_MONTH, branchId: BRANCH, records: [] });
    expect(result.carriedForward).toEqual([]);
    expect(result.carriedForwardCount).toBe(0);
    expect(result.retainedNotPresented).toEqual([]);
  });

  it('carries forward exactly the records the cut-off decision marked', () => {
    const records = [rec({ status: 'open' }), rec({ status: 'notified' }), rec({ status: 'no_issue' })];
    const decision = decidePayrollCutOff({ payMonth: PAY_MONTH, branchId: BRANCH, records });
    const carried = deriveCarryForward({ payMonth: PAY_MONTH, branchId: BRANCH, records });

    if (decision.disposition !== 'proceeds') throw new Error('unreachable');
    const markedDates = decision.salaryLineMarks.flatMap((m) => [...m.unreviewedDates]);
    expect(carried.carriedForwardCount).toBe(decision.unreviewedQueuedCount);
    expect(new Set(carried.carriedForward.map((c) => c.record.attendanceDate))).toEqual(
      new Set(markedDates),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// criteria 9.4 and 9.10: reviewing a record for a closed Pay_Month
// ---------------------------------------------------------------------------------------------

describe('reviewClosedMonthRecord - criterion 9.4 (arrear targeting)', () => {
  const closed = rec({ recordId: 'vr-closed', employeeId: 'emp-7', attendanceDate: '2026-07-14' });

  it('raises an arrear for the difference in the earliest open Pay_Month', () => {
    const result = reviewClosedMonthRecord({
      record: closed,
      // Deliberately out of order, and spanning a year boundary.
      openPayMonths: ['2027-01', '2026-09', '2026-12'],
      outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 1 },
      paidPayableDayValue: 0,
      unreviewedVarianceMarkRecordedAtCutOff: true,
    });

    expect(result.disposition).toBe('arrear_raised');
    expect(result.payableDayDifference).toBe(1);
    expect(result.entry).not.toBeNull();
    expect(result.entry!.kind).toBe('arrear');
    expect(result.entry!.targetPayMonth).toBe('2026-09');
    expect(result.entry!.sourcePayMonth).toBe('2026-07');
    expect(result.entry!.employeeId).toBe('emp-7');
    expect(result.entry!.attendanceDate).toBe('2026-07-14');
    expect(result.closedMonthPayableDaysChanged).toBe(false);
  });

  it('raises a recovery when the difference is negative', () => {
    const result = reviewClosedMonthRecord({
      record: closed,
      openPayMonths: ['2026-08'],
      outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 0.5 },
      paidPayableDayValue: 1,
      unreviewedVarianceMarkRecordedAtCutOff: true,
    });

    expect(result.disposition).toBe('recovery_raised');
    expect(result.payableDayDifference).toBe(-0.5);
    expect(result.entry!.kind).toBe('recovery');
    expect(result.entry!.payableDayMagnitude).toBe(0.5);
    expect(result.entry!.targetPayMonth).toBe('2026-08');
  });

  it('raises nothing when no Pay_Month is open, and returns the difference as a pending intent', () => {
    for (const openPayMonths of [undefined, [] as string[]]) {
      const result = reviewClosedMonthRecord({
        record: closed,
        openPayMonths,
        outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 1 },
        paidPayableDayValue: 0.5,
        unreviewedVarianceMarkRecordedAtCutOff: true,
      });

      expect(result.disposition).toBe('no_entry_no_open_pay_month');
      expect(result.entry).toBeNull();
      expect(result.earliestOpenPayMonth).toBeNull();
      expect(result.pendingEntry).not.toBeNull();
      expect(result.pendingEntry!.kind).toBe('arrear');
      expect(result.pendingEntry!.payableDayDifference).toBe(0.5);
      expect(result.pendingEntry!.sourcePayMonth).toBe('2026-07');
    }
  });

  it('raises no entry when the approved adjustment does not move Payable_Days', () => {
    const result = reviewClosedMonthRecord({
      record: closed,
      openPayMonths: ['2026-08'],
      outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 1 },
      paidPayableDayValue: 1,
      unreviewedVarianceMarkRecordedAtCutOff: true,
    });

    expect(result.disposition).toBe('no_entry_no_difference');
    expect(result.payableDayDifference).toBe(0);
    expect(result.entry).toBeNull();
    expect(result.pendingEntry).toBeNull();
  });

  it('invents no difference when either Payable_Days value is undetermined', () => {
    const result = reviewClosedMonthRecord({
      record: closed,
      openPayMonths: ['2026-08'],
      outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 1 },
      // payable-days.ts returns null for a day still in review.
      paidPayableDayValue: null,
      unreviewedVarianceMarkRecordedAtCutOff: true,
    });

    expect(result.disposition).toBe('no_entry_difference_not_determinable');
    expect(result.payableDayDifference).toBeNull();
    expect(result.entry).toBeNull();
    expect(result.pendingEntry).toBeNull();
  });

  it('excludes the closed Pay_Month from the target candidates and warns', () => {
    const result = reviewClosedMonthRecord({
      record: closed,
      openPayMonths: ['2026-07', '2026-08'],
      outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 1 },
      paidPayableDayValue: 0,
      unreviewedVarianceMarkRecordedAtCutOff: true,
    });

    expect(result.entry!.targetPayMonth).toBe('2026-08');
    expect(result.openPayMonthsConsidered).toEqual(['2026-08']);
    expect(result.configurationWarnings.join(' ')).toContain('2026-07');
  });

  it('is independent of the order of openPayMonths', () => {
    const forwards = reviewClosedMonthRecord({
      record: closed,
      openPayMonths: ['2026-08', '2026-09', '2027-01'],
      outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 1 },
      paidPayableDayValue: 0,
      unreviewedVarianceMarkRecordedAtCutOff: false,
    });
    const backwards = reviewClosedMonthRecord({
      record: closed,
      openPayMonths: ['2027-01', '2026-09', '2026-08', '2026-08'],
      outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 1 },
      paidPayableDayValue: 0,
      unreviewedVarianceMarkRecordedAtCutOff: false,
    });

    expect(backwards).toEqual(forwards);
  });

  it('throws on a malformed open Pay_Month', () => {
    expect(() =>
      reviewClosedMonthRecord({
        record: closed,
        openPayMonths: ['2026-8'],
        outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 1 },
        paidPayableDayValue: 0,
        unreviewedVarianceMarkRecordedAtCutOff: false,
      }),
    ).toThrow(/openPayMonths entry/);
  });
});

describe('reviewClosedMonthRecord - criterion 9.10 (no adjustment approved)', () => {
  const closed = rec({ recordId: 'vr-a3', employeeId: 'emp-7' });

  it('leaves the closed month untouched and retains the 9.2 mark as historical fact', () => {
    for (const reviewOutcome of ['apr_accepted', 'apr_disputed', 'adjustment_requested'] as const) {
      const result = reviewClosedMonthRecord({
        record: closed,
        openPayMonths: ['2026-08'],
        outcome: { kind: 'no_adjustment_approved', reviewOutcome },
        paidPayableDayValue: 0,
        unreviewedVarianceMarkRecordedAtCutOff: true,
      });

      expect(result.disposition).toBe('no_entry_no_adjustment_approved');
      expect(result.closedMonthPayableDaysChanged).toBe(false);
      expect(result.entry).toBeNull();
      expect(result.pendingEntry).toBeNull();
      expect(result.unreviewedVarianceMark.recordedAtCutOff).toBe(true);
      expect(result.unreviewedVarianceMark.clearedByReview).toBe(false);
      expect(result.unreviewedVarianceMark.retainedAsHistoricalFact).toBe(true);
    }
  });

  it('retains the mark on the approved-adjustment path too - a later review never erases it', () => {
    const result = reviewClosedMonthRecord({
      record: closed,
      openPayMonths: ['2026-08'],
      outcome: { kind: 'adjustment_approved', adjustedPayableDayValue: 1 },
      paidPayableDayValue: 0,
      unreviewedVarianceMarkRecordedAtCutOff: true,
    });

    expect(result.disposition).toBe('arrear_raised');
    expect(result.unreviewedVarianceMark.recordedAtCutOff).toBe(true);
    expect(result.unreviewedVarianceMark.clearedByReview).toBe(false);
    expect(result.closedMonthPayableDaysChanged).toBe(false);
  });

  it('reports no mark to retain when none was recorded at cut-off', () => {
    const result = reviewClosedMonthRecord({
      record: closed,
      outcome: { kind: 'no_adjustment_approved', reviewOutcome: 'apr_accepted' },
      paidPayableDayValue: 1,
      unreviewedVarianceMarkRecordedAtCutOff: false,
    });

    expect(result.unreviewedVarianceMark.recordedAtCutOff).toBe(false);
    expect(result.unreviewedVarianceMark.clearedByReview).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// criterion 9.9: detection versus presentation
// ---------------------------------------------------------------------------------------------

describe('splitDetectionFromPresentation - criterion 9.9', () => {
  const records = [
    rec({ recordId: 'vr-p1', status: 'open' }),
    rec({ recordId: 'vr-p2', status: 'notified' }),
    rec({ recordId: 'vr-q1', queueState: 'recorded_not_queued', status: 'open' }),
  ];

  it('still raises and records everything with mismatch_workflow_enabled = 0, and presents none', () => {
    const result = splitDetectionFromPresentation({ records, mismatchWorkflowEnabled: 0 });

    expect(result.mismatchWorkflowEnabled).toBe(0);
    expect(result.raisedCount).toBe(3);
    expect(result.recordedCount).toBe(3);
    expect(result.presentedForDualReview).toEqual([]);
    expect(result.notPresented).toHaveLength(3);
    expect(result.demotedByPresentationGate).toBe(2);
    expect(result.backfillRequiredOnEnable).toBe(false);
  });

  it('presents the queued records once the flag is on, with no change to what was raised', () => {
    const off = splitDetectionFromPresentation({ records, mismatchWorkflowEnabled: 0 });
    const on = splitDetectionFromPresentation({ records, mismatchWorkflowEnabled: 1 });

    // Detection is identical either way: enabling the flag backfills nothing.
    expect(on.raisedCount).toBe(off.raisedCount);
    expect(on.recordedCount).toBe(off.recordedCount);
    expect(on.presentedForDualReview.map((r) => r.recordId)).toEqual(['vr-p1', 'vr-p2']);
    expect(on.demotedByPresentationGate).toBe(0);
  });

  it('treats an absent mismatch_workflow_enabled as criterion 9.7\u0027s released 1', () => {
    const result = splitDetectionFromPresentation({ records });
    expect(result.mismatchWorkflowEnabled).toBe(RELEASE_DEFAULT_MISMATCH_WORKFLOW_ENABLED);
    expect(result.presentedForDualReview).toHaveLength(2);
  });

  it('records nothing to present for an empty set', () => {
    const result = splitDetectionFromPresentation({ records: [] });
    expect(result.raisedCount).toBe(0);
    expect(result.presentedForDualReview).toEqual([]);
  });

  it('reports the reconciliation view as unreviewed 0 while the workflow is off', () => {
    const view = buildPreCloseReconciliation({
      payMonth: PAY_MONTH,
      branchId: BRANCH,
      records,
      mismatchWorkflowEnabled: 0,
    });

    expect(view.raised).toBe(3);
    expect(view.recordedNotQueued).toBe(3);
    expect(view.unreviewed).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Flags and Pay_Month arithmetic
// ---------------------------------------------------------------------------------------------

describe('resolveFeatureFlag', () => {
  it('applies the release default for absent and blank values without warning', () => {
    for (const raw of [null, undefined, '', '   ']) {
      const resolved = resolveFeatureFlag(FEATURE_FLAG_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH, raw, 0);
      expect(resolved.value).toBe(0);
      expect(resolved.wasAbsent).toBe(true);
      expect(resolved.warning).toBeNull();
    }
  });

  it('retains an unreadable value and warns', () => {
    const resolved = resolveFeatureFlag(FEATURE_FLAG_MISMATCH_WORKFLOW_ENABLED, 'sometimes', 1);
    expect(resolved.value).toBe(1);
    expect(resolved.wasAbsent).toBe(false);
    expect(resolved.rejectedValue).toBe('sometimes');
    expect(resolved.warning).toContain(FEATURE_FLAG_MISMATCH_WORKFLOW_ENABLED);
  });

  it('exports the two release values criteria 9.7 and 9.8 name', () => {
    expect(RELEASE_DEFAULT_MISMATCH_WORKFLOW_ENABLED).toBe(1);
    expect(RELEASE_DEFAULT_PAYROLL_LOCK_ON_UNRESOLVED_MISMATCH).toBe(0);
  });
});

describe('Pay_Month comparison', () => {
  it('compares chronologically across a year boundary and a single-digit month step', () => {
    expect(comparePayMonths('2026-09', '2026-10')).toBeLessThan(0);
    expect(comparePayMonths('2026-12', '2027-01')).toBeLessThan(0);
    expect(comparePayMonths('2027-01', '2026-12')).toBeGreaterThan(0);
    expect(comparePayMonths('2026-07', '2026-07')).toBe(0);
  });

  it('picks the chronological minimum whatever the input order', () => {
    expect(earliestOpenPayMonth(['2027-01', '2026-12', '2026-09'])).toBe('2026-09');
    expect(earliestOpenPayMonth(['2026-10', '2026-09'])).toBe('2026-09');
    expect(earliestOpenPayMonth([])).toBeNull();
  });

  it('throws on a malformed Pay_Month rather than guessing', () => {
    expect(() => comparePayMonths('2026-13', '2026-01')).toThrow(/'YYYY-MM'/);
    expect(() => earliestOpenPayMonth(['2026/08'])).toThrow(/'YYYY-MM'/);
  });
});

// ---------------------------------------------------------------------------------------------
// Ordering independence
// ---------------------------------------------------------------------------------------------

describe('ordering independence', () => {
  const records = [
    rec({ recordId: 'vr-o1', employeeId: 'emp-3', attendanceDate: '2026-07-21', status: 'open' }),
    rec({ recordId: 'vr-o2', employeeId: 'emp-1', attendanceDate: '2026-07-02', status: 'notified' }),
    rec({ recordId: 'vr-o3', employeeId: 'emp-1', attendanceDate: '2026-07-02', status: 'reviewed' }),
    rec({ recordId: 'vr-o4', employeeId: 'emp-2', attendanceDate: '2026-07-30', status: 'contested' }),
    rec({
      recordId: 'vr-o5',
      employeeId: 'emp-2',
      attendanceDate: '2026-07-30',
      queueState: 'recorded_not_queued',
      status: 'open',
    }),
  ];

  it('produces an identical reconciliation view, decision and carry-forward when reversed', () => {
    const reversed = [...records].reverse();

    expect(
      buildPreCloseReconciliation({ payMonth: PAY_MONTH, branchId: BRANCH, records: reversed }),
    ).toEqual(buildPreCloseReconciliation({ payMonth: PAY_MONTH, branchId: BRANCH, records }));

    expect(
      decidePayrollCutOff({
        payMonth: PAY_MONTH,
        branchId: BRANCH,
        records: reversed,
        payrollLockOnUnresolvedMismatch: 1,
      }),
    ).toEqual(
      decidePayrollCutOff({
        payMonth: PAY_MONTH,
        branchId: BRANCH,
        records,
        payrollLockOnUnresolvedMismatch: 1,
      }),
    );

    expect(deriveCarryForward({ payMonth: PAY_MONTH, branchId: BRANCH, records: reversed })).toEqual(
      deriveCarryForward({ payMonth: PAY_MONTH, branchId: BRANCH, records }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------------------------

const STATUSES: readonly VarianceRecordStatus[] = [
  'open',
  'notified',
  'reviewed',
  'contested',
  'no_issue',
  'regularization_required',
];

const recordArb: fc.Arbitrary<PayrollVarianceRecord> = fc
  .record({
    id: fc.integer({ min: 1, max: 40 }),
    employeeId: fc.constantFrom('emp-1', 'emp-2', 'emp-3'),
    branchId: fc.constantFrom(BRANCH, 'branch-blr'),
    day: fc.integer({ min: 1, max: 28 }),
    payMonth: fc.constantFrom('2026-07', '2026-08'),
    queueState: fc.constantFrom('queued_for_dual_review' as const, 'recorded_not_queued' as const),
    status: fc.constantFrom(...STATUSES),
    varianceDecision: fc.constantFrom(
      'raised_biometric_shortfall' as const,
      'raised_dialler_underclassified' as const,
    ),
  })
  .map((r) => ({
    recordId: `vr-${r.id}`,
    employeeId: r.employeeId,
    branchId: r.branchId,
    attendanceDate: `${r.payMonth}-${String(r.day).padStart(2, '0')}`,
    payMonth: r.payMonth,
    queueState: r.queueState,
    status: r.status,
    reviewOutcome: null,
    varianceDecision: r.varianceDecision,
    salaryLineId: `line-${r.employeeId}`,
  }));

// Unique on recordId, because two different records under one id is the module's documented
// programmer error rather than a case worth generating.
const recordSetArb = fc.uniqueArray(recordArb, {
  maxLength: 12,
  selector: (r) => r.recordId,
});

// Every spelling of "not opted in", including the absent and unreadable ones.
const nonBlockingFlagArb = fc.constantFrom(
  undefined,
  null,
  0,
  '0',
  'false',
  false,
  '',
  '   ',
  'off',
  'no',
  'perhaps',
  2,
  -1,
  Number.NaN,
);

describe('Property: the default configuration never blocks a payroll run (criteria 9.1, 9.8)', () => {
  it('cut-off proceeds for every record set when the lock flag is absent, 0 or unreadable', () => {
    fc.assert(
      fc.property(
        recordSetArb,
        nonBlockingFlagArb,
        fc.constantFrom(undefined, 0, 1),
        (records, lock, workflow) => {
          const decision = decidePayrollCutOff({
            payMonth: PAY_MONTH,
            branchId: BRANCH,
            records,
            payrollLockOnUnresolvedMismatch: lock as never,
            mismatchWorkflowEnabled: workflow as never,
          });

          expect(decision.mayProceed).toBe(true);
          expect(decision.disposition).toBe('proceeds');
          expect(decision.payrollLockOnUnresolvedMismatch).toBe(0);
          if (decision.disposition !== 'proceeds') throw new Error('unreachable');
          // criterion 9.1: the run completes on the resolved Attendance_Source regardless.
          expect(decision.payableDaysBasis).toBe('resolved_attendance_source');
          // criterion 9.2: one mark per employee carrying at least one unreviewed date.
          const markedDates = decision.salaryLineMarks.reduce(
            (sum, mark) => sum + mark.unreviewedDateCount,
            0,
          );
          expect(markedDates).toBeLessThanOrEqual(decision.unreviewedQueuedCount);
          for (const mark of decision.salaryLineMarks) {
            expect(mark.unreviewedDateCount).toBeGreaterThan(0);
            expect(mark.paidWithUnreviewedVariance).toBe(true);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('a refusal is only ever reachable with the flag at 1 and names a count of at least 1', () => {
    fc.assert(
      fc.property(
        recordSetArb,
        fc.constantFrom(undefined, null, 0, '0', 1, '1', true, false, 'true', 'garbage'),
        (records, lock) => {
          const decision = decidePayrollCutOff({
            payMonth: PAY_MONTH,
            branchId: BRANCH,
            records,
            payrollLockOnUnresolvedMismatch: lock as never,
          });

          if (decision.mayProceed) return;
          expect(decision.payrollLockOnUnresolvedMismatch).toBe(1);
          expect(decision.disposition).toBe('refused_unreviewed_queued_variances');
          if (decision.disposition !== 'refused_unreviewed_queued_variances') return;
          expect(decision.unreviewedQueuedCount).toBeGreaterThanOrEqual(1);
          expect(decision.reason).toContain(String(decision.unreviewedQueuedCount));
          // Only queued records can block.
          expect(decision.unreviewedQueuedCount).toBe(decision.reconciliation.unreviewed);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('Property: the six reconciliation counts partition (criterion 9.5)', () => {
  it('raised = queued + recordedNotQueued, queued = reviewed + unreviewed, contestedQueued <= reviewed', () => {
    fc.assert(
      fc.property(recordSetArb, fc.constantFrom(undefined, 0, 1), (records, workflow) => {
        const view = buildPreCloseReconciliation({
          payMonth: PAY_MONTH,
          branchId: BRANCH,
          records,
          mismatchWorkflowEnabled: workflow as never,
        });

        expect(view.queuedForDualReview + view.recordedNotQueued).toBe(view.raised);
        expect(view.reviewed + view.unreviewed).toBe(view.queuedForDualReview);
        // contestedQueued sits inside reviewed for every input; contested only inside raised. The
        // gap is a contested record the 9.9 gate has demoted out of the presented set.
        expect(view.contestedQueued).toBeLessThanOrEqual(view.reviewed);
        expect(view.contested).toBeLessThanOrEqual(view.raised);
        expect(view.contestedQueued).toBeLessThanOrEqual(view.contested);
        expect(view.raised + view.outOfScopeRecordCount).toBe(
          new Set(records.map((r) => r.recordId)).size,
        );
        expect(view.unreviewedRecordIds).toHaveLength(view.unreviewed);
        expect(view.unreviewedEmployeeIds.length).toBeLessThanOrEqual(view.unreviewed);
      }),
      { numRuns: 400 },
    );
  });
});

describe('Property: results do not depend on input order', () => {
  it('any permutation of the records yields an identical decision', () => {
    fc.assert(
      fc.property(recordSetArb, fc.constantFrom(0, 1), (records, lock) => {
        const shuffled = [...records].reverse();
        const a = decidePayrollCutOff({
          payMonth: PAY_MONTH,
          branchId: BRANCH,
          records,
          payrollLockOnUnresolvedMismatch: lock,
        });
        const b = decidePayrollCutOff({
          payMonth: PAY_MONTH,
          branchId: BRANCH,
          records: shuffled,
          payrollLockOnUnresolvedMismatch: lock,
        });
        expect(b).toEqual(a);
      }),
      { numRuns: 300 },
    );
  });
});
