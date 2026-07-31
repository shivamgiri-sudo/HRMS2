/**
 * Regression cover for alerts that would not stop.
 *
 * Production had 65,831 open inbox items against 38 ever closed. Acting on the
 * work — approving leave, submitting interview feedback, clearing a
 * regularization — updated the business table and never touched the alert, so
 * the reminder kept firing for work that was already finished. These tests pin
 * the two halves of the fix: alerts can now be closed by the completing
 * action, and an unresolved condition stops minting a fresh row every 30
 * minutes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));

import { inboxService } from '../inbox.service.js';
import { INBOX_RESOLUTION_RULES, runInboxReconciliation } from '../inbox-reconciliation.js';

/** Shape mysql2 returns for a write. */
const write = (affectedRows: number) => [{ affectedRows }, []];
/** Shape mysql2 returns for a read. */
const read = (rows: unknown[]) => [rows, []];

describe('inboxService.resolveItems', () => {
  beforeEach(() => mocks.execute.mockReset());

  it('closes the open alerts raised for an entity', async () => {
    mocks.execute.mockResolvedValueOnce(write(2));

    const closed = await inboxService.resolveItems({
      entity_type: 'leave',
      entity_id: 'leave-req-1',
      types: ['leave_request'],
    });

    expect(closed).toBe(2);
    const [sql, args] = mocks.execute.mock.calls[0];
    expect(sql).toContain('SET is_actioned = 1');
    expect(sql).toContain('is_actioned = 0');
    expect(args).toEqual(['leave', 'leave-req-1', 'leave_request']);
  });

  it('closes the alert for every recipient when no user is named', async () => {
    // An approval finishes the work for everyone it was raised against, so the
    // statement must not be narrowed to whoever happened to click approve.
    mocks.execute.mockResolvedValueOnce(write(3));

    await inboxService.resolveItems({ entity_type: 'ats_candidate', entity_id: 'cand-1' });

    const [sql] = mocks.execute.mock.calls[0];
    expect(sql).not.toContain('user_id = ?');
  });

  it('never throws, so a failed close cannot roll back the approval', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('deadlock'));
    await expect(
      inboxService.resolveItems({ entity_type: 'leave', entity_id: 'x' }),
    ).resolves.toBe(0);
  });

  it('refuses to run without an entity, which would close unrelated alerts', async () => {
    await expect(
      inboxService.resolveItems({ entity_type: 'leave', entity_id: '' }),
    ).resolves.toBe(0);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe('inboxService.createItem deduplication', () => {
  beforeEach(() => mocks.execute.mockReset());

  const alert = {
    user_id: 'recruiter-1',
    type: 'sla_breach_uncalled',
    title: 'Candidate not called — Asha',
    description: 'waiting 45 min',
    entity_type: 'ats_candidate',
    entity_id: 'cand-1',
    action_url: '/ats/walkin-queue',
    priority: 'urgent',
  };

  it('refreshes the standing alert instead of raising a duplicate', async () => {
    // The old rule expired dedup after 30 minutes, so an unresolved condition
    // minted a new row every half hour — 488 rows for a handful of candidates.
    mocks.execute
      .mockResolvedValueOnce(read([{ id: 'existing-1' }])) // open item found
      .mockResolvedValueOnce(write(1))                      // refresh wording
      .mockResolvedValueOnce(read([{ id: 'existing-1' }])); // re-read

    const result = await inboxService.createItem(alert);

    expect((result as { id: string }).id).toBe('existing-1');
    const statements = mocks.execute.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes('INSERT INTO work_inbox_item'))).toBe(false);
    expect(statements[1]).toContain('UPDATE work_inbox_item SET title');
  });

  it('does not expire dedup on elapsed time', async () => {
    mocks.execute
      .mockResolvedValueOnce(read([{ id: 'existing-1' }]))
      .mockResolvedValueOnce(write(1))
      .mockResolvedValueOnce(read([{ id: 'existing-1' }]));

    await inboxService.createItem(alert);

    const [lookupSql] = mocks.execute.mock.calls[0];
    expect(String(lookupSql)).not.toContain('DATE_SUB');
  });

  it('leaves created_at alone so ageing counts from the first alert', async () => {
    mocks.execute
      .mockResolvedValueOnce(read([{ id: 'existing-1' }]))
      .mockResolvedValueOnce(write(1))
      .mockResolvedValueOnce(read([{ id: 'existing-1' }]));

    await inboxService.createItem(alert);

    expect(String(mocks.execute.mock.calls[1][0])).not.toContain('created_at');
  });

  it('keys dedup on action_url so each date gets its own missing-punch alert', async () => {
    mocks.execute
      .mockResolvedValueOnce(read([]))
      .mockResolvedValueOnce(write(1))
      .mockResolvedValueOnce(read([{ id: 'new-1' }]));

    await inboxService.createItem({
      user_id: 'emp-1',
      type: 'attendance_missing_punch',
      title: 'No attendance recorded for 2026-07-21',
      entity_type: 'attendance',
      entity_id: 'employee-1',
      action_url: '/attendance-regularization?employeeId=employee-1&date=2026-07-21',
    });

    const [lookupSql, lookupArgs] = mocks.execute.mock.calls[0];
    expect(String(lookupSql)).toContain('action_url <=> ?');
    expect(lookupArgs).toContain('/attendance-regularization?employeeId=employee-1&date=2026-07-21');
  });

  it('raises a fresh alert once the previous one was actioned', async () => {
    mocks.execute
      .mockResolvedValueOnce(read([])) // dedup only looks at open rows
      .mockResolvedValueOnce(write(1))
      .mockResolvedValueOnce(read([{ id: 'new-1' }]));

    await inboxService.createItem(alert);

    expect(String(mocks.execute.mock.calls[1][0])).toContain('INSERT INTO work_inbox_item');
  });
});

describe('inbox reconciliation rules', () => {
  beforeEach(() => mocks.execute.mockReset());

  it('covers every alert type that a worker re-raises on a timer', () => {
    const covered = new Set(INBOX_RESOLUTION_RULES.map((r) => r.key));
    for (const type of [
      'sla_breach_uncalled',
      'walkin_submission_sla',
      'interview_submission_overdue',
      'walkin_feedback_pending',
      'leave_request',
      'attendance_regularization',
      'official_email_compliance',
      'it_provisioning',
    ]) {
      expect(covered).toContain(type);
    }
  });

  it('only ever closes items that are still open', () => {
    for (const rule of INBOX_RESOLUTION_RULES) {
      expect(rule.where).toContain('is_actioned = 0');
    }
  });

  it('accepts an outcome in either candidate column', () => {
    // The generating worker reads candidate_status, which sits at 'registered'
    // for 32,653 candidates and never moves; the real decision lands in status.
    const rule = INBOX_RESOLUTION_RULES.find((r) => r.key === 'walkin_feedback_pending');
    expect(rule?.where).toContain('c.status IN');
    expect(rule?.where).toContain('c.candidate_status NOT IN');
    expect(rule?.where).toContain('ats_interview_result');
  });

  it('keeps a leave alert standing while any matching request is pending', () => {
    const rule = INBOX_RESOLUTION_RULES.find((r) => r.key === 'leave_request');
    expect(rule?.where).toContain('NOT EXISTS');
    expect(rule?.where).toContain("lr.status IN ('pending','pending_branch_head')");
    // entity_id has held the employee id historically and the request id since;
    // both readings must be honoured or old alerts never clear.
    expect(rule?.where).toContain('lr.id = w.entity_id');
    expect(rule?.where).toContain('lr.employee_id = w.entity_id');
  });

  it('writes nothing on a dry run', async () => {
    mocks.execute.mockResolvedValue(read([{ n: 7 }]));

    const result = await runInboxReconciliation({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.total).toBe(7 * INBOX_RESOLUTION_RULES.length);
    for (const [sql] of mocks.execute.mock.calls) {
      expect(String(sql)).toContain('SELECT COUNT(*)');
      expect(String(sql)).not.toContain('UPDATE');
    }
  });

  it('carries on after a rule fails so one bad rule cannot stall the sweep', async () => {
    const rules = [
      { key: 'broken', resolvedWhen: 'never', where: 'w.is_actioned = 0 AND bad_column = 1' },
      { key: 'good', resolvedWhen: 'always', where: 'w.is_actioned = 0' },
    ];
    mocks.execute
      .mockRejectedValueOnce(new Error("Unknown column 'bad_column'"))
      .mockResolvedValueOnce(write(4));

    const result = await runInboxReconciliation({ rules });

    expect(result.byRule.broken).toBe(0);
    expect(result.byRule.good).toBe(4);
  });
});
