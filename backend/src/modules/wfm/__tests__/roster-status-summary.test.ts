/**
 * getRosterStatusSummary — "has the roster actually been published, and has anyone
 * acknowledged it" for a branch/process/date-range scope. All DB calls mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecute, state } = vi.hoisted(() => {
  const state = {
    publishRows: [] as any[],
    ackRows: [] as any[],
    lastPublishParams: null as any[] | null,
    lastAckParams: null as any[] | null,
  };
  const mockExecute = vi.fn(async (sql: string, params?: any[]) => {
    const s = sql.trim().toUpperCase();
    if (s.includes('FINAL_ROSTER_STATUS')) {
      state.lastPublishParams = params ?? [];
      return [state.publishRows];
    }
    if (s.includes('EMPLOYEE_ACK_STATUS')) {
      state.lastAckParams = params ?? [];
      return [state.ackRows];
    }
    return [[]];
  });
  return { mockExecute, state };
});

vi.mock('../../../db/mysql.js', () => ({
  db: { execute: mockExecute },
}));

import { getRosterStatusSummary } from '../roster-view.service.js';

describe('getRosterStatusSummary', () => {
  beforeEach(() => {
    state.publishRows = [];
    state.ackRows = [];
    state.lastPublishParams = null;
    state.lastAckParams = null;
    mockExecute.mockClear();
  });

  it('computes published vs unpublished from the final_roster_status breakdown', async () => {
    state.publishRows = [
      { status: 'generated', cnt: 30 },
      { status: 'pending_employee_ack', cnt: 12 },
      { status: 'acknowledged', cnt: 8 },
    ];
    state.ackRows = [
      { status: 'pending', cnt: 42 },
      { status: 'acknowledged', cnt: 8 },
    ];

    const result = await getRosterStatusSummary({ fromDate: '2026-08-01', toDate: '2026-08-07' });

    expect(result.totalAssignments).toBe(50);
    expect(result.unpublishedCount).toBe(30);
    expect(result.publishedCount).toBe(20);
    expect(result.byPublishStage).toEqual([
      { status: 'generated', count: 30 },
      { status: 'pending_employee_ack', count: 12 },
      { status: 'acknowledged', count: 8 },
    ]);
    expect(result.byAckStatus).toEqual([
      { status: 'pending', count: 42 },
      { status: 'acknowledged', count: 8 },
    ]);
  });

  it('treats an empty scope as 0/0, not an error', async () => {
    const result = await getRosterStatusSummary({ fromDate: '2026-08-01', toDate: '2026-08-07' });
    expect(result.totalAssignments).toBe(0);
    expect(result.unpublishedCount).toBe(0);
    expect(result.publishedCount).toBe(0);
  });

  it('applies branchId and processId as additional filters, scoped via employees not the assignment text columns', async () => {
    await getRosterStatusSummary({
      fromDate: '2026-08-01', toDate: '2026-08-07', branchId: 'branch-1', processId: 'process-1',
    });

    expect(state.lastPublishParams).toEqual(['2026-08-01', '2026-08-07', 'branch-1', 'process-1']);
    expect(state.lastAckParams).toEqual(['2026-08-01', '2026-08-07', 'branch-1', 'process-1']);
    const publishCall = mockExecute.mock.calls.find(([sql]) => sql.toUpperCase().includes('FINAL_ROSTER_STATUS'));
    expect(publishCall![0]).toContain('e.branch_id = ?');
    expect(publishCall![0]).toContain('e.process_id = ?');
    expect(publishCall![0]).toContain('JOIN employees e ON e.id = ra.employee_id');
  });

  it('publishedCount is never negative even if unpublishedCount somehow exceeds total (defensive)', async () => {
    state.publishRows = [{ status: 'generated', cnt: 5 }];
    const result = await getRosterStatusSummary({ fromDate: '2026-08-01', toDate: '2026-08-07' });
    expect(result.publishedCount).toBe(0);
    expect(result.unpublishedCount).toBe(5);
  });
});
