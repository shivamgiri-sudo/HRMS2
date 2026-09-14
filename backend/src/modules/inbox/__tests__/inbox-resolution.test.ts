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
import {
  INBOX_RESOLUTION_RULES,
  findDuplicateOpenItems,
  runInboxReconciliation,
} from '../inbox-reconciliation.js';

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

  it('retires dated attendance alerts only once the day is past correcting', () => {
    // The one place age is allowed to close an alert: no proof of completion
    // exists for these (biometric_status is NULL on every attendance row) and
    // the regularization they ask for cannot be made after payroll closes.
    for (const key of ['attendance_missing_punch_expired', 'attendance_validation_expired']) {
      const rule = INBOX_RESOLUTION_RULES.find((r) => r.key === key);
      expect(rule).toBeTruthy();
      expect(rule?.where).toContain('INTERVAL 30 DAY');
      // Anything inside the window keeps nagging, which is the point.
      expect(rule?.where).toContain('<');
    }
  });

  it('ages dated alerts on the day they concern, not the day they were raised', () => {
    // A punch alert for the 1st raised on the 3rd must expire against the 1st,
    // or a backfilled alert would outlive the month it belongs to.
    const rule = INBOX_RESOLUTION_RULES.find((r) => r.key === 'attendance_missing_punch_expired');
    expect(rule?.where).toContain("SUBSTRING_INDEX(w.action_url, 'date=', -1)");
    // Rows with no date in the URL are still reachable, via created_at.
    expect(rule?.where).toContain('w.created_at <');
  });

  it('stops at the next query parameter when date= is not last', () => {
    // The inner SUBSTRING_INDEX alone was correct only while date= was the final
    // parameter. Newer alerts append more:
    //   …&date=2026-08-04&employeeName=KHUSHI&employeeCode=MAS62567
    // which yielded "2026-08-04&employeeName=..." — rejected in a date
    // comparison with ER_TRUNCATED_WRONG_VALUE. One bad row aborts the whole
    // statement, so BOTH dated rules failed outright: measured on production
    // 2026-08-08, 3,538 of 25,701 open dated alerts carry a trailing parameter,
    // and none of the 25,701 were being auto-resolved.
    for (const key of ['attendance_missing_punch', 'attendance_missing_punch_expired']) {
      const rule = INBOX_RESOLUTION_RULES.find((r) => r.key === key);
      expect(rule, `${key} missing`).toBeTruthy();
      expect(
        rule?.where,
        `${key} reads to end-of-string and breaks on a trailing &param`,
      ).toContain("SUBSTRING_INDEX(SUBSTRING_INDEX(w.action_url, 'date=', -1), '&', 1)");
    }
  });

  it('the date parse is a no-op when date= really is the last parameter', () => {
    // Trimming at the next & must not change rows that already worked.
    const parse = (url: string) => url.split('date=').pop()!.split('&')[0];
    expect(parse('/attendance?employeeId=abc&date=2026-08-04')).toBe('2026-08-04');
    expect(parse('/attendance?date=2026-08-04&employeeName=KHUSHI&employeeCode=MAS62567'))
      .toBe('2026-08-04');
  });

  it('never retires a non-attendance alert on age alone', () => {
    // Age is scoped to the two dated attendance types and nothing else — a
    // pending leave or an uncalled candidate must never expire quietly.
    for (const rule of INBOX_RESOLUTION_RULES) {
      if (rule.key.endsWith('_expired')) continue;
      expect(rule.where).not.toContain('INTERVAL 30 DAY');
    }
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

describe('duplicate collapse', () => {
  beforeEach(() => mocks.execute.mockReset());

  const row = (id: string, created_at: string, over: Record<string, unknown> = {}) => ({
    id,
    user_id: 'emp-1',
    type: 'alerts',
    entity_type: 'official_email_compliance',
    entity_id: 'employee-1',
    action_url: '/profile?tab=profile',
    created_at,
    ...over,
  });

  it('keeps the oldest of a group and closes the restatements', async () => {
    // 30,077 open rows stood for 757 pieces of work — ~40 copies each, written
    // before dedup was fixed. The oldest survives so ageing stays honest.
    mocks.execute.mockResolvedValueOnce(read([
      row('c', '2026-07-20 09:00:00'),
      row('a', '2026-06-15 09:00:00'),
      row('b', '2026-07-01 09:00:00'),
    ]));

    const { toClose, groupsAffected } = await findDuplicateOpenItems();

    expect(groupsAffected).toBe(1);
    expect(toClose.sort()).toEqual(['b', 'c']);
    expect(toClose).not.toContain('a');
  });

  it('leaves a lone item alone', async () => {
    mocks.execute.mockResolvedValueOnce(read([row('only', '2026-07-01 09:00:00')]));
    const { toClose, groupsAffected } = await findDuplicateOpenItems();
    expect(toClose).toEqual([]);
    expect(groupsAffected).toBe(0);
  });

  it('treats a different action_url as different work', async () => {
    // Two dates of the same employee's missing punch are not duplicates.
    mocks.execute.mockResolvedValueOnce(read([
      row('d1', '2026-07-01 09:00:00', { type: 'attendance_missing_punch', action_url: '/x?date=2026-07-01' }),
      row('d2', '2026-07-02 09:00:00', { type: 'attendance_missing_punch', action_url: '/x?date=2026-07-02' }),
    ]));

    const { toClose } = await findDuplicateOpenItems();

    expect(toClose).toEqual([]);
  });

  it('never merges across users — each recipient owns their own copy', async () => {
    mocks.execute.mockResolvedValueOnce(read([
      row('u1', '2026-07-01 09:00:00', { user_id: 'emp-1' }),
      row('u2', '2026-07-01 09:00:00', { user_id: 'emp-2' }),
    ]));

    const { toClose } = await findDuplicateOpenItems();

    expect(toClose).toEqual([]);
  });

  it('breaks created_at ties deterministically so a re-run closes nothing new', async () => {
    const sameInstant = '2026-07-01 09:00:00';
    mocks.execute.mockResolvedValueOnce(read([
      row('zz', sameInstant), row('aa', sameInstant), row('mm', sameInstant),
    ]));

    const first = await findDuplicateOpenItems();

    mocks.execute.mockResolvedValueOnce(read([
      row('mm', sameInstant), row('zz', sameInstant), row('aa', sameInstant),
    ]));
    const second = await findDuplicateOpenItems();

    expect(first.toClose.sort()).toEqual(['mm', 'zz']);
    expect(second.toClose.sort()).toEqual(first.toClose.sort());
  });

  it('only ever reads rows that are still open', async () => {
    mocks.execute.mockResolvedValueOnce(read([]));
    await findDuplicateOpenItems();
    expect(String(mocks.execute.mock.calls[0][0])).toContain('is_actioned = 0');
  });
});

describe('reconciliation rule failure isolation', () => {
  beforeEach(() => mocks.execute.mockReset());

  it('reports zero for a rule whose SQL is rejected', async () => {
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
