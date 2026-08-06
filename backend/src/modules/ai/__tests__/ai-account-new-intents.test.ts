import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), getEmployeeForUser: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
vi.mock('../../../shared/accessGuard.js', () => ({ getEmployeeForUser: mocks.getEmployeeForUser }));

import { answerSelfAccountQuestion, clearMiraCacheForUser, detectMiraIntent } from '../ai-account.service.js';

beforeEach(() => {
  clearMiraCacheForUser();
  mocks.execute.mockReset();
  mocks.getEmployeeForUser.mockReset();
  mocks.getEmployeeForUser.mockResolvedValue({ id: 'employee-self', employee_code: 'EMP-001' });
});

describe('detectMiraIntent — new intents do not get swallowed by existing broader intents', () => {
  it.each([
    ["what's the status of my leave request", 'leave_status'],
    ['is my leave approved yet', 'leave_status'],
    ['has my leave been rejected', 'leave_status'],
    ['my leave request status', 'leave_status'],
  ])('%s -> leave_status (not the balance-only leave intent)', (question, expected) => {
    expect(detectMiraIntent(question)).toBe(expected);
  });

  it('leave balance questions still resolve to the plain leave intent, unaffected', () => {
    expect(detectMiraIntent('what is my leave balance')).toBe('leave');
    expect(detectMiraIntent('kitni chhutti baki hai?')).toBe('leave');
  });

  it.each([
    ['when is the next holiday', 'holidays'],
    ['list of upcoming holidays', 'holidays'],
    ['public holidays this year', 'holidays'],
    ['show me the holiday calendar', 'holidays'],
  ])('%s -> holidays (not the generic roster fallback)', (question, expected) => {
    expect(detectMiraIntent(question)).toBe(expected);
  });

  it('a bare mention of "holiday" not matching the specific holidays phrasings still falls through to roster', () => {
    expect(detectMiraIntent('is Monday a holiday for my shift')).toBe('roster');
  });

  it.each([
    ['what is my resignation status', 'resignation'],
    ['what is my last working day', 'resignation'],
    ['how many days is my notice period', 'resignation'],
    ['has my resignation been accepted', 'resignation'],
  ])('%s -> resignation', (question, expected) => {
    expect(detectMiraIntent(question)).toBe(expected);
  });

  it('a resignation question naming another employee is blocked as a scope violation, not answered from the caller\'s own record', () => {
    expect(detectMiraIntent('what is his resignation status')).toBe('scope_violation');
    expect(detectMiraIntent("what is another employee's resignation status")).toBe('scope_violation');
  });
});

describe('cross-employee guard — possessive apostrophe fix ("employee\'s", not just "employee ")', () => {
  it('regression: "another employee\'s X" now blocked for every guarded subject, not just resignation', () => {
    // Before this fix, the literal "employee\s+" in the pronoun-guard pattern
    // required whitespace immediately after "employee" — "employee's" has
    // "'s" there instead, so this silently never matched at all, for every
    // subject (salary, attendance, leave, profile, details, documents,
    // payslip), not just the new resignation intent.
    expect(detectMiraIntent("another employee's salary")).toBe('scope_violation');
    expect(detectMiraIntent("another employee's attendance")).toBe('scope_violation');
    expect(detectMiraIntent("another employee's leave")).toBe('scope_violation');
    expect(detectMiraIntent("another employee's documents")).toBe('scope_violation');
  });

  it('still blocks the non-possessive phrasing that already worked before this fix', () => {
    expect(detectMiraIntent('another employee salary')).toBe('scope_violation');
  });
});

describe('leave_status intent', () => {
  it('lists recent leave requests with status, dates and pending count', async () => {
    mocks.execute.mockResolvedValueOnce([[
      { id: 'lr-1', from_date: '2026-08-10', to_date: '2026-08-11', total_days: 2, status: 'pending', applied_at: '2026-08-01', leave_name: 'Casual Leave', leave_code: 'CL' },
      { id: 'lr-2', from_date: '2026-07-01', to_date: '2026-07-01', total_days: 1, status: 'approved', applied_at: '2026-06-25', leave_name: 'Sick Leave', leave_code: 'SL' },
    ]]);
    const result = await answerSelfAccountQuestion('what is the status of my leave request', 'user-self', ['employee']);
    expect(result.handled).toBe(true);
    expect(result.response?.answer).toContain('Casual Leave');
    expect(result.response?.answer).toContain('pending');
    expect(result.response?.insights?.[0]?.count).toBe(1);
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('FROM leave_request lr');
    expect(String(sql)).toContain('lr.employee_id = ?');
    expect(params).toEqual(['employee-self']);
    expect(result.response?.actions?.[0]?.url).toBe('/leaves');
  });

  it('handles no leave requests on record gracefully', async () => {
    mocks.execute.mockResolvedValueOnce([[]]);
    const result = await answerSelfAccountQuestion('is my leave approved', 'user-self', ['employee']);
    expect(result.handled).toBe(true);
    expect(result.response?.answer).toContain('no leave requests');
  });
});

describe('holidays intent', () => {
  it('lists upcoming holidays scoped to the caller\'s own branch', async () => {
    mocks.execute.mockResolvedValueOnce([[
      { holiday_name: 'Independence Day', holiday_date: '2026-08-15', holiday_type: 'national' },
      { holiday_name: 'Gandhi Jayanti', holiday_date: '2026-10-02', holiday_type: 'national' },
    ]]);
    const result = await answerSelfAccountQuestion('when is the next holiday', 'user-self', ['employee']);
    expect(result.handled).toBe(true);
    expect(result.response?.answer).toContain('Independence Day');
    expect(result.response?.answer).toContain('Gandhi Jayanti');
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('FROM leave_holiday_master');
    expect(String(sql)).toContain('branch_id IS NULL OR branch_id = (SELECT branch_id FROM employees WHERE id = ?)');
    expect(params).toEqual(['employee-self']);
    expect(result.response?.actions?.[0]?.url).toBe('/calendar');
  });

  it('handles no published holidays gracefully', async () => {
    mocks.execute.mockResolvedValueOnce([[]]);
    const result = await answerSelfAccountQuestion('public holidays this year', 'user-self', ['employee']);
    expect(result.handled).toBe(true);
    expect(result.response?.answer).toContain('No upcoming holidays');
  });
});

describe('resignation intent', () => {
  it('reports status, last working day and notice period from the most recent exit_request', async () => {
    mocks.execute.mockResolvedValueOnce([[{
      status: 'notice_serving',
      exit_type: 'voluntary',
      exit_sub_type: 'resignation',
      last_working_day_proposed: '2026-09-15',
      last_working_day_confirmed: '2026-09-20',
      notice_period_days: 30,
      notice_start_date: '2026-08-21',
      notice_end_date: '2026-09-20',
      submitted_at: '2026-08-20',
    }]]);
    const result = await answerSelfAccountQuestion('what is my resignation status', 'user-self', ['employee']);
    expect(result.handled).toBe(true);
    expect(result.response?.answer).toContain('notice_serving');
    expect(result.response?.answer).toContain('confirmed');
    expect(result.response?.answer).toContain('30 days');
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('FROM exit_request');
    expect(String(sql)).toContain('employee_id = ?');
    expect(params).toEqual(['employee-self']);
    expect(result.response?.actions?.[0]?.url).toBe('/exit/resignation');
  });

  it('reports no resignation on file when the employee never submitted one', async () => {
    mocks.execute.mockResolvedValueOnce([[]]);
    const result = await answerSelfAccountQuestion('what is my last working day', 'user-self', ['employee']);
    expect(result.handled).toBe(true);
    expect(result.response?.answer).toContain('No resignation or exit request is on file');
  });

  it('prefers the confirmed last working day over the proposed one when both are set', async () => {
    mocks.execute.mockResolvedValueOnce([[{
      status: 'accepted', notice_period_days: 30,
      last_working_day_proposed: '2026-09-15', last_working_day_confirmed: '2026-09-20',
    }]]);
    const result = await answerSelfAccountQuestion('my resignation status', 'user-self', ['employee']);
    expect(result.response?.answer).toContain('confirmed');
    expect(result.response?.answer).not.toContain('pending confirmation');
  });
});

describe('reimbursements — rejection_reason now rendered (was already selected, never shown)', () => {
  it('includes the rejection reason for a rejected claim', async () => {
    mocks.execute.mockResolvedValueOnce([[{
      claim_type: 'MEDICAL', claim_month: '2026-07', amount_claimed: 5000, amount_approved: null,
      status: 'rejected', rejection_reason: 'Missing original bills', submitted_at: '2026-07-01', processed_at: null,
    }]]);
    const result = await answerSelfAccountQuestion('what is the status of my reimbursement claim', 'user-self', ['employee']);
    expect(result.response?.answer).toContain('Missing original bills');
  });

  it('does not print anything extra for a non-rejected claim', async () => {
    mocks.execute.mockResolvedValueOnce([[{
      claim_type: 'FUEL', claim_month: '2026-07', amount_claimed: 1000, amount_approved: 1000,
      status: 'approved', rejection_reason: null, submitted_at: '2026-07-01', processed_at: null,
    }]]);
    const result = await answerSelfAccountQuestion('what is the status of my reimbursement claim', 'user-self', ['employee']);
    expect(result.response?.answer).not.toContain(' — ');
  });
});
