/**
 * Leave notification wiring.
 *
 * The balance figures are the point of these emails — an approver deciding a leave
 * request needs to see what the employee has left. Two traps are pinned here:
 *
 *  - the legacy leave-type twins ('PTRL' alongside 'PL') seeded by
 *    052_legacy_migration_tables.sql. leaveService.getBalance already collapses them, so
 *    this reuses that function rather than writing fresh balance SQL that would report
 *    one of the pair and understate entitlement.
 *  - a balance that cannot be read must come through as null, not 0. Telling someone they
 *    have zero leave left when the query simply failed is worse than showing nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), query: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));
vi.mock('../src/modules/communication/notification.gateway.js', () => ({
  notificationGateway: { notify: vi.fn().mockResolvedValue({ outcome: 'shadow' }) },
}));
vi.mock('../src/modules/leave/leave.service.js', () => ({
  leaveService: { getBalance: vi.fn().mockResolvedValue([]) },
}));

import {
  notifyLeaveSubmitted, notifyLeaveDecision, notifyLeavePendingBranchHead,
} from '../src/modules/leave/leave.notifications.js';
import { notificationGateway } from '../src/modules/communication/notification.gateway.js';
import { leaveService } from '../src/modules/leave/leave.service.js';
import { db } from '../src/db/mysql.js';

const notify = () => notificationGateway.notify as ReturnType<typeof vi.fn>;
const sent = () => notify().mock.calls[0][0];

const ctx = (over: Record<string, unknown> = {}) => ({
  employee_id: 'emp-1', employee_code: 'MAS001', employee_name: 'Test Person',
  branch_id: 'br-1', process_id: 'pr-1',
  leave_type_id: 'lt-el', leave_name: 'Earned Leave', leave_code: 'EL',
  from_date: '2026-08-10', to_date: '2026-08-12', total_days: 3,
  reason: 'family function', status: 'approved', ...over,
});

const mockCtx = (row: Record<string, unknown> | null) =>
  (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([row ? [row] : [], []]);

const mockBalance = (rows: Record<string, unknown>[]) =>
  (leaveService.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

beforeEach(() => {
  vi.clearAllMocks();
  notify().mockResolvedValue({ outcome: 'shadow' });
  mockBalance([]);
});

describe('leave decision', () => {
  it('carries the balance analytics the catalogue specifies', async () => {
    mockCtx(ctx());
    mockBalance([{ leave_type_id: 'lt-el', leave_name: 'Earned Leave', available_days: 9, used_days: 3 }]);
    await notifyLeaveDecision('lr-1', 'approved');
    expect(sent().data).toMatchObject({ balance_after: 9, taken_ytd: 3, decision: 'approved' });
  });

  it('reuses leaveService.getBalance so legacy leave-type twins stay collapsed', async () => {
    mockCtx(ctx());
    await notifyLeaveDecision('lr-1', 'approved');
    expect(leaveService.getBalance).toHaveBeenCalledWith('emp-1', new Date().getFullYear());
  });

  it('reports null — not 0 — when the balance cannot be read', async () => {
    mockCtx(ctx());
    (leaveService.getBalance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ledger down'));
    await notifyLeaveDecision('lr-1', 'approved');
    expect(sent().data.balance_after).toBeNull();
    expect(sent().data.taken_ytd).toBeNull();
  });

  it('reports null when the leave type has no balance row', async () => {
    mockCtx(ctx());
    mockBalance([{ leave_type_id: 'lt-other', available_days: 5, used_days: 1 }]);
    await notifyLeaveDecision('lr-1', 'approved');
    expect(sent().data.balance_after).toBeNull();
  });

  it('routes a cancellation to leave_cancelled, not leave_decision', async () => {
    mockCtx(ctx({ status: 'cancelled' }));
    await notifyLeaveDecision('lr-1', 'cancelled');
    expect(sent().eventCode).toBe('leave_cancelled');
  });

  it('puts the status in the dedupe key so approve-then-cancel both notify', async () => {
    mockCtx(ctx());
    await notifyLeaveDecision('lr-1', 'approved');
    await notifyLeaveDecision('lr-1', 'cancelled');
    const keys = notify().mock.calls.map((c) => c[0].dedupeKey);
    expect(keys).toEqual(['leave_request:lr-1:approved', 'leave_request:lr-1:cancelled']);
  });

  it('formats a single-day leave as one date, not a range', async () => {
    mockCtx(ctx({ from_date: '2026-08-10', to_date: '2026-08-10', total_days: 1 }));
    await notifyLeaveDecision('lr-1', 'approved');
    expect(sent().data.dates).toBe('2026-08-10');
  });

  it('does nothing when the request no longer exists', async () => {
    mockCtx(null);
    await notifyLeaveDecision('gone', 'approved');
    expect(notify()).not.toHaveBeenCalled();
  });

  it('never throws — a mail failure must not fail the approval', async () => {
    mockCtx(ctx());
    notify().mockRejectedValueOnce(new Error('gateway down'));
    await expect(notifyLeaveDecision('lr-1', 'approved')).resolves.toBeUndefined();
  });
});

describe('leave submitted', () => {
  it('gives the approver the balance they need to decide', async () => {
    mockCtx(ctx({ status: 'pending' }));
    mockBalance([{ leave_type_id: 'lt-el', leave_name: 'Earned Leave', available_days: 12, used_days: 0 }]);
    await notifyLeaveSubmitted('lr-2');
    expect(sent().eventCode).toBe('leave_submitted');
    expect(sent().data).toMatchObject({ balance_after: 12, taken_ytd: 0, days: 3 });
  });

  it('passes branch and process so branch-scoped recipients resolve', async () => {
    mockCtx(ctx({ status: 'pending' }));
    await notifyLeaveSubmitted('lr-2');
    expect(sent().context).toMatchObject({ employeeId: 'emp-1', branchId: 'br-1', processId: 'pr-1' });
  });
});

describe('branch head escalation', () => {
  it('states the rule that routed it there', async () => {
    mockCtx(ctx({ status: 'pending_branch_head' }));
    await notifyLeavePendingBranchHead('lr-3', 3);
    expect(sent().eventCode).toBe('leave_pending_branch_head');
    expect(sent().data.el_occurrences_ytd).toBe(3);
    expect(String(sent().data.policy_rule)).toMatch(/third earned-leave/i);
  });

  it('still notifies when the occurrence count is unknown', async () => {
    mockCtx(ctx({ status: 'pending_branch_head' }));
    await notifyLeavePendingBranchHead('lr-3');
    expect(sent().data.el_occurrences_ytd).toBeNull();
  });
});
