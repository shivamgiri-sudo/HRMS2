/**
 * TAT escalation — the query and the sweep.
 *
 * This worker's first run is the most storm-prone moment in the notification build:
 * task_tat_instance holds months of overdue tasks, and the previous implementation
 * (tat.service.ts before migration 1024) walked EVERY escalation level for EVERY breached
 * task in a single pass. These tests pin the guards that replaced that behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), query: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));

import { findDueEscalations, recordEscalation } from '../src/modules/governance/tat.service.js';
import { db } from '../src/db/mysql.js';

const exec = () => db.execute as ReturnType<typeof vi.fn>;
const lastSql = (match: RegExp): string =>
  exec().mock.calls.map((c) => String(c[0])).find((s) => match.test(s)) ?? '';

beforeEach(() => vi.clearAllMocks());

describe('the due-escalation query', () => {
  beforeEach(() => exec().mockResolvedValue([[], []]));

  it('honours trigger_after_hours instead of firing every level at once', async () => {
    await findDueEscalations({ backfillFloor: new Date('2026-07-31') });
    const sql = lastSql(/FROM task_tat_instance/);
    // The old code had no such condition: one minute overdue notified owner, manager and
    // branch head simultaneously.
    expect(sql).toMatch(/NOW\(\)\s*>=\s*DATE_ADD\(t\.due_at,\s*INTERVAL e\.trigger_after_hours HOUR\)/);
  });

  it('excludes levels already logged, so a 15-minute poll cannot re-notify', async () => {
    await findDueEscalations({ backfillFloor: new Date('2026-07-31') });
    const sql = lastSql(/FROM task_tat_instance/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*task_escalation_log[\s\S]*escalation_level = e\.escalation_level/);
  });

  it('applies the backfill floor so historical backlog is invisible, not throttled', async () => {
    const floor = new Date('2026-07-31T00:00:00Z');
    await findDueEscalations({ backfillFloor: floor });
    const sql = lastSql(/FROM task_tat_instance/);
    expect(sql).toMatch(/t\.due_at >= \?/);
    expect(exec().mock.calls[0][1]).toEqual([floor]);
  });

  it('never returns an unbounded result set', async () => {
    await findDueEscalations({ backfillFloor: new Date(), limit: 50 });
    expect(lastSql(/FROM task_tat_instance/)).toMatch(/LIMIT 50/);
  });

  it('clamps an absurd caller-supplied limit', async () => {
    await findDueEscalations({ backfillFloor: new Date(), limit: 999_999 });
    expect(lastSql(/FROM task_tat_instance/)).toMatch(/LIMIT 500/);
  });

  it('skips completed instances', async () => {
    await findDueEscalations({ backfillFloor: new Date() });
    const sql = lastSql(/FROM task_tat_instance/);
    expect(sql).toMatch(/t\.status IN \('open', 'in_progress', 'sla_breached'\)/);
    expect(sql).not.toMatch(/'completed'/);
  });
});

describe('escalation logging uses the real column names', () => {
  const esc = {
    tatInstanceId: 'tat-1', taskType: 'EMAIL_CREATION', entityType: 'employee', entityId: 'e-1',
    assignedTo: 'emp-1', ownerUserId: 'usr-1', branchId: 'br-1', processId: null,
    dueAt: new Date(), escalationLevel: 2, notifyRole: 'manager', notifyUserId: null,
    escalationAction: 'notify', hoursOverdue: 6,
  };

  it('writes tat_instance_id / triggered_at / action_taken, not the names that threw', async () => {
    exec().mockResolvedValue([{ affectedRows: 1 }, []]);
    await recordEscalation(esc);
    const sql = lastSql(/INSERT INTO task_escalation_log/);
    expect(sql).toMatch(/tat_instance_id/);
    expect(sql).toMatch(/triggered_at/);
    expect(sql).toMatch(/action_taken/);
    // These are the columns the old code used. None of them exist.
    expect(sql).not.toMatch(/task_tat_instance_id/);
    expect(sql).not.toMatch(/\bcreated_at\b/);
    expect(sql).not.toMatch(/notify_user_id/);
  });

  it('treats a duplicate level as "already escalated", not an error', async () => {
    const dup = new Error('dup') as Error & { code: string };
    dup.code = 'ER_DUP_ENTRY';
    exec().mockRejectedValue(dup);
    await expect(recordEscalation(esc)).resolves.toBe(false);
  });

  it('still surfaces genuine database failures', async () => {
    exec().mockRejectedValue(new Error('connection lost'));
    await expect(recordEscalation(esc)).rejects.toThrow('connection lost');
  });
});
