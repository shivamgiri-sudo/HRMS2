import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  logSensitiveAction: vi.fn(),
}));

vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: mocks.execute,
  },
}));

vi.mock('../../../shared/auditLog.js', () => ({
  logSensitiveAction: mocks.logSensitiveAction,
}));

vi.mock('../roster.notifications.js', () => ({
  notifyRosterPublished: vi.fn(),
}));

vi.mock('../../communication/sms.helper.js', () => ({
  sendSMS: vi.fn(),
}));

import { rosterGovernanceService } from '../roster.governance.service.js';

const CYCLE_ID = 'cycle-001';
const EMPLOYEE_ID = 'emp-001';
const USER_ID = 'user-001';

const makeCycle = (status: string) => ({
  id: CYCLE_ID,
  process_id: 'proc-001',
  branch_id: null,
  status,
  week_start_date: '2026-09-01',
  week_end_date: '2026-09-07',
  published_by: null,
  published_at: null,
  locked_at: null,
  payroll_ready_at: null,
  created_by: USER_ID,
  created_at: '2026-08-19T00:00:00Z',
  updated_at: '2026-08-19T00:00:00Z',
});

const makeChangeLog = (overrides = {}) => ({
  id: 'change-001',
  cycle_id: CYCLE_ID,
  employee_id: EMPLOYEE_ID,
  change_type: 'shift_change',
  old_value_json: '{}',
  new_value_json: '{}',
  reason: 'test reason',
  change_date: '2026-09-03',
  changed_by: USER_ID,
  created_at: '2026-08-19T00:00:00Z',
  old_shift_id: null,
  new_shift_id: 'shift-002',
  old_assignment_type: null,
  new_assignment_type: 'regular',
  amendment_reason: 'test reason',
  is_late_change: 0,
  lead_time_hours: 336,
  notified_at: null,
  ...overrides,
});

describe('roster amendment service', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.logSensitiveAction.mockResolvedValue(undefined);
  });

  it('createAmendment throws 400 if cycle is DRAFT', async () => {
    // getCycle returns a DRAFT cycle
    mocks.execute.mockResolvedValueOnce([[makeCycle('draft')], []]);

    await expect(
      rosterGovernanceService.createAmendment(
        CYCLE_ID,
        { employeeId: EMPLOYEE_ID, date: '2026-09-03', newAssignmentType: 'regular', reason: 'test' },
        USER_ID
      )
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('draft') });
  });

  it('createAmendment creates change log for APPROVED_PUBLISHED (published) cycle', async () => {
    const futureDate = '2030-12-31'; // far future so is_late_change=0
    const mockChangeLog = makeChangeLog({ change_date: futureDate, is_late_change: 0 });

    mocks.execute
      .mockResolvedValueOnce([[makeCycle('published')], []])  // getCycle
      .mockResolvedValueOnce([[], []])                         // SELECT current assignment (none)
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])        // INSERT into roster_change_log
      .mockResolvedValueOnce([[mockChangeLog], []]);            // SELECT back the change log

    const result = await rosterGovernanceService.createAmendment(
      CYCLE_ID,
      {
        employeeId: EMPLOYEE_ID,
        date: futureDate,
        newShiftId: 'shift-002',
        newAssignmentType: 'regular',
        reason: 'test reason',
      },
      USER_ID
    );

    expect(result).toMatchObject({ id: 'change-001', cycle_id: CYCLE_ID });

    // Verify INSERT was called and SQL contains the hardcoded 'shift_change' type
    const insertCall = mocks.execute.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO roster_change_log');
    expect(insertCall[0]).toContain('shift_change');
  });

  it('createAmendment sets is_late_change=1 when lead time < threshold', async () => {
    const pastDate = '2020-01-01'; // past date → very negative lead time
    const mockChangeLog = makeChangeLog({ change_date: pastDate, is_late_change: 1, lead_time_hours: -50000 });

    mocks.execute
      .mockResolvedValueOnce([[makeCycle('published')], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[mockChangeLog], []]);

    const result = await rosterGovernanceService.createAmendment(
      CYCLE_ID,
      { employeeId: EMPLOYEE_ID, date: pastDate, newAssignmentType: 'regular', reason: 'urgent change' },
      USER_ID
    );

    // Verify is_late_change=1 was passed in the INSERT
    const insertCall = mocks.execute.mock.calls[2];
    const params: unknown[] = insertCall[1];
    // is_late_change is the 14th param (index 13); index 14 is lead_time_hours
    expect(params[13]).toBe(1);
    expect(result.is_late_change).toBe(1);
  });

  it('createAmendment sets is_late_change=0 when lead time >= threshold', async () => {
    const futureDate = '2030-06-01';
    const mockChangeLog = makeChangeLog({ change_date: futureDate, is_late_change: 0, lead_time_hours: 35000 });

    mocks.execute
      .mockResolvedValueOnce([[makeCycle('active')], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[mockChangeLog], []]);

    const result = await rosterGovernanceService.createAmendment(
      CYCLE_ID,
      {
        employeeId: EMPLOYEE_ID,
        date: futureDate,
        newAssignmentType: 'regular',
        reason: 'advance notice change',
        shortNoticeThresholdHours: 24,
      },
      USER_ID
    );

    const insertCall = mocks.execute.mock.calls[2];
    const params: unknown[] = insertCall[1];
    // is_late_change is at index 13; index 14 is lead_time_hours
    expect(params[13]).toBe(0);
    expect(result.is_late_change).toBe(0);
  });

  it('createAmendment updates wfm_roster_assignment when assignment exists and newShiftId provided', async () => {
    const futureDate = '2030-09-03';
    const existingAssignment = {
      id: 'assign-001',
      cycle_id: CYCLE_ID,
      employee_id: EMPLOYEE_ID,
      roster_date: futureDate,
      shift_template_id: 'shift-001',
      is_week_off: 0,
    };
    const mockChangeLog = makeChangeLog({ change_date: futureDate, old_shift_id: 'shift-001', new_shift_id: 'shift-002' });

    mocks.execute
      .mockResolvedValueOnce([[makeCycle('published')], []])       // getCycle
      .mockResolvedValueOnce([[existingAssignment], []])            // SELECT current assignment
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])             // INSERT roster_change_log
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])             // UPDATE roster_daily_assignment
      .mockResolvedValueOnce([[mockChangeLog], []]);                 // SELECT back

    await rosterGovernanceService.createAmendment(
      CYCLE_ID,
      {
        employeeId: EMPLOYEE_ID,
        date: futureDate,
        newShiftId: 'shift-002',
        newAssignmentType: 'regular',
        reason: 'shift swap',
      },
      USER_ID
    );

    // 5 execute calls: getCycle, SELECT assign, INSERT log, UPDATE assign, SELECT log
    expect(mocks.execute).toHaveBeenCalledTimes(5);

    const updateCall = mocks.execute.mock.calls[3];
    expect(updateCall[0]).toContain('UPDATE roster_daily_assignment');
    expect(updateCall[0]).toContain('shift_template_id = ?');
    expect(updateCall[1][0]).toBe('shift-002');
  });
});
