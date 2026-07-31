/**
 * Roster notification wiring — the first business events routed through the gateway.
 *
 * Two things matter here beyond "does it call notify":
 *  - the dedupe key must make a re-publish idempotent per employee, and
 *  - `nights` must be OMITTED rather than reported as 0 when a shift template could not be
 *    resolved. A confidently wrong zero is worse than a missing figure, and the join is
 *    easy to get wrong: roster_daily_assignment.shift_template_id references
 *    wfm_shift_template, NOT the similarly-named wfm_shift.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), query: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));
vi.mock('../src/modules/communication/notification.gateway.js', () => ({
  notificationGateway: { notify: vi.fn().mockResolvedValue({ outcome: 'shadow' }) },
}));

import { notifyRosterPublished, notifyShiftChanged } from '../src/modules/roster/roster.notifications.js';
import { notificationGateway } from '../src/modules/communication/notification.gateway.js';
import { db } from '../src/db/mysql.js';

const notify = () => notificationGateway.notify as ReturnType<typeof vi.fn>;
const calls = () => notify().mock.calls.map((c) => c[0]);

const summary = (over: Record<string, unknown> = {}) => ({
  employee_id: 'emp-1', employee_code: 'MAS001', full_name: 'Test Person',
  shifts: 5, week_offs: 2, holidays: 0, nights: 2, unresolved_shifts: 0,
  first_date: '2026-08-03', last_date: '2026-08-09', ...over,
});

const cycle = {
  id: 'cyc-1', branch_id: 'br-1', process_id: 'pr-1',
  week_start_date: '2026-08-03', week_end_date: '2026-08-09', ack_deadline: '2026-08-02 18:00',
};

const mockSummaries = (rows: Record<string, unknown>[]) =>
  (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([rows, []]);

beforeEach(() => {
  vi.clearAllMocks();
  notify().mockResolvedValue({ outcome: 'shadow' });
});

describe('roster published', () => {
  it('notifies once per rostered employee', async () => {
    mockSummaries([summary(), summary({ employee_id: 'emp-2', employee_code: 'MAS002' })]);
    const r = await notifyRosterPublished(cycle);
    expect(notify()).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ employees: 2, shadow: 2, sent: 0, skipped: 0 });
  });

  it('uses a per-employee dedupe key so a re-publish cannot double-notify', async () => {
    mockSummaries([summary(), summary({ employee_id: 'emp-2' })]);
    await notifyRosterPublished(cycle);
    const keys = calls().map((c) => c.dedupeKey);
    expect(keys).toEqual([
      'weekly_roster_cycle:cyc-1:employee:emp-1',
      'weekly_roster_cycle:cyc-1:employee:emp-2',
    ]);
    expect(new Set(keys).size).toBe(2);
  });

  it('carries the analytics the catalogue specifies', async () => {
    mockSummaries([summary()]);
    await notifyRosterPublished(cycle);
    expect(calls()[0].data).toMatchObject({
      shifts: 5, week_offs: 2, nights: 2, ack_deadline: '2026-08-02 18:00',
    });
  });

  it('OMITS nights when a shift template could not be resolved', async () => {
    // The wrong-join failure mode: reporting 0 nights to a night-shift worker.
    mockSummaries([summary({ nights: 0, unresolved_shifts: 3 })]);
    await notifyRosterPublished(cycle);
    expect(calls()[0].data.nights).toBeNull();
  });

  it('reports nights as 0 only when every shift resolved and none were nights', async () => {
    mockSummaries([summary({ nights: 0, unresolved_shifts: 0 })]);
    await notifyRosterPublished(cycle);
    expect(calls()[0].data.nights).toBe(0);
  });

  it('passes branch and process so branch-scoped CC can resolve', async () => {
    mockSummaries([summary()]);
    await notifyRosterPublished(cycle);
    expect(calls()[0].context).toMatchObject({ employeeId: 'emp-1', branchId: 'br-1', processId: 'pr-1' });
  });

  it('joins wfm_shift_template, not the similarly-named wfm_shift', async () => {
    mockSummaries([summary()]);
    await notifyRosterPublished(cycle);
    const sql = String((db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(sql).toMatch(/JOIN wfm_shift_template/);
    expect(sql).not.toMatch(/JOIN wfm_shift\s/);
  });

  it('keeps notifying the rest of the roster when one employee fails', async () => {
    mockSummaries([summary(), summary({ employee_id: 'emp-2' }), summary({ employee_id: 'emp-3' })]);
    notify()
      .mockResolvedValueOnce({ outcome: 'shadow' })
      .mockRejectedValueOnce(new Error('resolver blew up'))
      .mockResolvedValueOnce({ outcome: 'shadow' });
    const r = await notifyRosterPublished(cycle);
    expect(notify()).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ employees: 3, shadow: 2, skipped: 1 });
  });

  it('handles an empty roster without notifying anyone', async () => {
    mockSummaries([]);
    const r = await notifyRosterPublished(cycle);
    expect(notify()).not.toHaveBeenCalled();
    expect(r.employees).toBe(0);
  });
});

describe('shift changed', () => {
  it('keys dedupe on the change row so each change notifies exactly once', async () => {
    await notifyShiftChanged({
      cycle, employeeId: 'emp-1', rosterDate: '2026-08-05', changeId: 'chg-9',
      fromShift: 'GEN', toShift: 'NGT', reason: 'coverage gap',
    });
    expect(calls()[0].dedupeKey).toBe('roster_change_log:chg-9');
  });

  it('reports how much notice the employee actually got', async () => {
    const future = new Date(Date.now() + 48 * 3_600_000).toISOString().slice(0, 10);
    await notifyShiftChanged({
      cycle, employeeId: 'emp-1', rosterDate: future, changeId: 'chg-1', reason: 'swap',
    });
    expect(calls()[0].data.notice_hours).toBeGreaterThan(0);
  });

  it('never reports negative notice for a retrospective change', async () => {
    await notifyShiftChanged({
      cycle, employeeId: 'emp-1', rosterDate: '2020-01-01', changeId: 'chg-2', reason: 'backdated',
    });
    expect(calls()[0].data.notice_hours).toBe(0);
  });

  it('swallows a gateway failure — a shift change must not fail because mail failed', async () => {
    notify().mockRejectedValueOnce(new Error('smtp down'));
    await expect(notifyShiftChanged({
      cycle, employeeId: 'emp-1', rosterDate: '2026-08-05', changeId: 'chg-3',
    })).resolves.toBeUndefined();
  });
});
