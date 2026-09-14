import { describe, expect, it } from 'vitest';
import { planLeaveRestore, planRegularizationRestore } from '../attendanceRestore.js';

/**
 * When a reversal cannot touch a day, the reason has to name what holds it.
 *
 * Reported live on 2026-09-03 for MAS47905: an approved leave and an approved
 * regularization sat on the SAME day (31 Aug), the regularization owned and locked the
 * attendance row, so discarding the leave changed nothing. The dialog said "locked by a
 * correction or payroll process", which is true, unactionable, and reads as a failure —
 * the reviewer cannot tell that the fix is to discard the regularization first.
 *
 * These pin the note to something a person can act on. They are about wording, and wording
 * is the whole feature here: the restore behaviour itself (skip, never overwrite a newer
 * correction) is deliberately unchanged.
 */

const lockedByRegularization = {
  attendance_status: 'present',
  lwp_value: '0.00',
  is_locked: 1,
  regularization_id: 'reg-other',
  status_change_reason: 'Regularization approved: Already mark in MIS',
};

describe('restore plan — what locked this day', () => {
  it('points a blocked leave discard at the regularization holding the day', () => {
    const plan = planLeaveRestore('2026-08-31', lockedByRegularization, undefined);

    expect(plan.mode).toBe('skip_locked');
    expect(plan.note).toContain('regularization');
    expect(plan.note).toContain('discard that one first');
    // The old wording said only this, and left the reviewer with nowhere to go.
    expect(plan.note).not.toBe(
      'Attendance row is locked by a correction or payroll process; it was left untouched.'
    );
  });

  it('names a manual attendance change, with the reason that was given for it', () => {
    const plan = planLeaveRestore('2026-08-31', {
      attendance_status: 'absent',
      lwp_value: '1.00',
      is_locked: 1,
      override_by: 'user-1',
      override_reason: 'Manual override approved: biometric device offline',
    }, undefined);

    expect(plan.mode).toBe('skip_locked');
    expect(plan.note).toContain('manual attendance change');
    expect(plan.note).toContain('biometric device offline');
  });

  it('falls back to the recorded reason when nothing identifies the owner', () => {
    const plan = planLeaveRestore('2026-08-31', {
      attendance_status: 'present',
      lwp_value: '0.00',
      is_locked: 1,
      status_change_reason: 'Payroll month closed',
    }, undefined);

    expect(plan.note).toContain('Payroll month closed');
  });

  it('says so plainly when the row carries no clue at all', () => {
    const plan = planLeaveRestore('2026-08-31', {
      attendance_status: 'present', lwp_value: '0.00', is_locked: 1,
    }, undefined);

    expect(plan.note).toContain('another correction or a payroll process');
  });

  it('applies the same wording to a regularization blocked by a different correction', () => {
    const plan = planRegularizationRestore('reg-mine', '2026-08-31', {
      attendance_status: 'present',
      lwp_value: '0.00',
      is_locked: 1,
      // No regularization_id, so this is the is_locked branch rather than skip_owned.
      override_by: 'user-2',
      override_reason: 'Manual override approved: shift register checked',
    }, undefined);

    expect(plan.mode).toBe('skip_locked');
    expect(plan.note).toContain('manual attendance change');
    expect(plan.note).toContain('shift register checked');
  });

  it('still refuses to overwrite a day a newer correction owns', () => {
    // Unchanged behaviour, pinned so the wording work above cannot loosen it.
    const plan = planRegularizationRestore('reg-mine', '2026-08-31', {
      attendance_status: 'present', lwp_value: '0.00', is_locked: 1,
      regularization_id: 'reg-someone-else',
    }, undefined);

    expect(plan.mode).toBe('skip_owned');
  });
});
