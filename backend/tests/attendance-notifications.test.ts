/**
 * Attendance notification wiring.
 *
 * The attendance percentage is the figure people will argue with, so the arithmetic is
 * pinned here. Two rules matter more than the rest:
 *
 *  - holidays and week-offs are EXCLUDED from the denominator. Counting a Sunday against
 *    someone's attendance is the kind of wrong number that discredits every other
 *    notification the platform sends.
 *  - with no qualifying days the answer is null, not 0. A mid-month joiner has no
 *    percentage yet, and 0% would be a lie.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), query: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));
vi.mock('../src/modules/communication/notification.gateway.js', () => ({
  notificationGateway: { notify: vi.fn().mockResolvedValue({ outcome: 'shadow' }) },
}));

import {
  notifyRegularizationDecision, notifyRegularizationStage2Pending, notifyRegularizationSubmitted,
} from '../src/modules/wfm/attendance.notifications.js';
import { notificationGateway } from '../src/modules/communication/notification.gateway.js';
import { db } from '../src/db/mysql.js';

const notify = () => notificationGateway.notify as ReturnType<typeof vi.fn>;
const sent = () => notify().mock.calls[0][0];
const exec = () => db.execute as ReturnType<typeof vi.fn>;

const ctx = (over: Record<string, unknown> = {}) => ({
  employee_id: 'emp-1', employee_code: 'MAS001', employee_name: 'Test Person',
  branch_id: 'br-1', process_id: 'pr-1',
  session_date: '2026-08-05', requested_status: 'present',
  current_attendance_status: 'absent', reason: 'biometric failure', ...over,
});

/** ctx query first, then the attendance-percentage query (and queue query where used). */
function mockFlow(ctxRow: Record<string, unknown> | null, att?: { present_days: number; working_days: number }, queue?: Record<string, unknown>) {
  exec().mockReset();
  exec().mockImplementation(async (sql: string) => {
    if (/FROM attendance_regularization ar/i.test(sql)) return [ctxRow ? [ctxRow] : [], []];
    if (/present_days/i.test(sql)) return [[att ?? { present_days: 0, working_days: 0 }], []];
    if (/COUNT\(\*\) AS pending/i.test(sql)) return [[queue ?? { pending: 4, oldest: '2026-08-01' }], []];
    return [[], []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notify().mockResolvedValue({ outcome: 'shadow' });
});

describe('attendance percentage', () => {
  it('excludes holidays and week-offs from the denominator', async () => {
    mockFlow(ctx(), { present_days: 20, working_days: 22 });
    await notifyRegularizationDecision('reg-1', 'approved');
    const sql = exec().mock.calls.map((c) => String(c[0])).find((s) => /present_days/.test(s))!;
    expect(sql).toMatch(/NOT IN \('holiday','week_off'\)/);
  });

  it('counts approved leave as present, not as an absence', async () => {
    mockFlow(ctx(), { present_days: 20, working_days: 22 });
    await notifyRegularizationDecision('reg-1', 'approved');
    const sql = exec().mock.calls.map((c) => String(c[0])).find((s) => /present_days/.test(s))!;
    expect(sql).toMatch(/IN \('present','leave_approved'\)/);
  });

  it('computes the percentage to one decimal', async () => {
    mockFlow(ctx(), { present_days: 20, working_days: 22 });
    await notifyRegularizationDecision('reg-1', 'approved');
    expect(sent().data.attendance_pct_mtd).toBe(90.9);
  });

  it('reports null rather than 0% when there are no qualifying days', async () => {
    mockFlow(ctx(), { present_days: 0, working_days: 0 });
    await notifyRegularizationDecision('reg-1', 'approved');
    expect(sent().data.attendance_pct_mtd).toBeNull();
    expect(sent().data.working_days_mtd).toBeNull();
  });

  it('reports null when the attendance query fails', async () => {
    exec().mockReset();
    exec().mockImplementation(async (sql: string) => {
      if (/FROM attendance_regularization ar/i.test(sql)) return [[ctx()], []];
      throw new Error('adr unavailable');
    });
    await notifyRegularizationDecision('reg-1', 'approved');
    expect(sent().data.attendance_pct_mtd).toBeNull();
  });
});

describe('regularization decision', () => {
  it('reports one day corrected on approval and none on rejection', async () => {
    mockFlow(ctx(), { present_days: 18, working_days: 20 });
    await notifyRegularizationDecision('reg-1', 'approved');
    expect(sent().data.days_corrected).toBe(1);

    notify().mockClear();
    mockFlow(ctx(), { present_days: 18, working_days: 20 });
    await notifyRegularizationDecision('reg-1', 'rejected');
    expect(sent().data.days_corrected).toBe(0);
  });

  it('puts the decision in the dedupe key', async () => {
    mockFlow(ctx(), { present_days: 1, working_days: 1 });
    await notifyRegularizationDecision('reg-9', 'rejected');
    expect(sent().dedupeKey).toBe('attendance_regularization:reg-9:rejected');
  });

  it('does nothing when the regularization no longer exists', async () => {
    mockFlow(null);
    await notifyRegularizationDecision('gone', 'approved');
    expect(notify()).not.toHaveBeenCalled();
  });

  it('never throws — a mail failure must not fail the approval', async () => {
    mockFlow(ctx(), { present_days: 1, working_days: 1 });
    notify().mockRejectedValueOnce(new Error('gateway down'));
    await expect(notifyRegularizationDecision('reg-1', 'approved')).resolves.toBeUndefined();
  });
});

describe('stage 2 pending', () => {
  it('tells the WFM chain how deep the queue is', async () => {
    mockFlow(ctx(), { present_days: 1, working_days: 1 }, { pending: 7, oldest: '2026-07-28' });
    await notifyRegularizationStage2Pending('reg-2');
    expect(sent().eventCode).toBe('regularization_stage2_pending');
    expect(sent().data).toMatchObject({ queue_depth: 7, oldest_pending: '2026-07-28' });
  });

  it('still notifies when the queue count is unavailable', async () => {
    exec().mockReset();
    exec().mockImplementation(async (sql: string) => {
      if (/FROM attendance_regularization ar/i.test(sql)) return [[ctx()], []];
      if (/COUNT\(\*\) AS pending/i.test(sql)) throw new Error('no perms');
      return [[{ present_days: 1, working_days: 1 }], []];
    });
    await notifyRegularizationStage2Pending('reg-2');
    expect(notify()).toHaveBeenCalledOnce();
    expect(sent().data.queue_depth).toBeNull();
  });
});

describe('regularization submitted', () => {
  it('shows the approver what is being asked for', async () => {
    mockFlow(ctx(), { present_days: 15, working_days: 20 });
    await notifyRegularizationSubmitted('reg-3');
    expect(sent().eventCode).toBe('regularization_submitted');
    expect(sent().data).toMatchObject({
      current_status: 'absent', requested_status: 'present', attendance_pct_mtd: 75,
    });
  });
});
