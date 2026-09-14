/**
 * Exit notification wiring, and the strangler that retires a private mailer.
 *
 * exit.service.ts owns one of the four private nodemailer transporters. Rather than
 * delete it or duplicate it, notifyResignationSubmitted reports whether the gateway
 * ACTUALLY delivered, and the caller falls back to the legacy mailer only when it did
 * not. The contract that makes that safe is tested here: shadow must NOT report delivery,
 * or the legacy path would be skipped while nothing was actually sent — a resignation
 * silently reaching nobody.
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
  notifyResignationSubmitted, notifyResignationDecision, notifyLastWorkingDayApproaching,
} from '../src/modules/exit/exit.notifications.js';
import { notificationGateway } from '../src/modules/communication/notification.gateway.js';
import { db } from '../src/db/mysql.js';

const notify = () => notificationGateway.notify as ReturnType<typeof vi.fn>;
const sent = () => notify().mock.calls[0][0];
const exec = () => db.execute as ReturnType<typeof vi.fn>;

const ctx = (over: Record<string, unknown> = {}) => ({
  employee_id: 'emp-1', employee_code: 'MAS001', employee_name: 'Test Person',
  branch_id: 'br-1', process_id: 'pr-1', designation: 'Agent',
  date_of_joining: '2023-08-01', status: 'submitted',
  exit_reason_category: 'better_opportunity', resignation_reason: 'new role',
  notice_period_days: 30,
  last_working_day_proposed: '2026-09-15', last_working_day_confirmed: null, ...over,
});

function mockFlow(row: Record<string, unknown> | null, clearance?: Record<string, unknown>) {
  exec().mockReset();
  exec().mockImplementation(async (sql: string) => {
    if (/FROM exit_request er/i.test(sql)) return [row ? [row] : [], []];
    if (/exit_clearance_checklist/i.test(sql)) return [[clearance ?? { pending: 3, departments: 'IT, Finance' }], []];
    return [[], []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notify().mockResolvedValue({ outcome: 'shadow' });
});

describe('the strangler contract', () => {
  it('reports NOT delivered in shadow, so the legacy mailer still runs', async () => {
    mockFlow(ctx());
    notify().mockResolvedValueOnce({ outcome: 'shadow' });
    expect(await notifyResignationSubmitted('ex-1')).toBe(false);
  });

  it('reports delivered only on a real send, so the legacy mailer is skipped', async () => {
    mockFlow(ctx());
    notify().mockResolvedValueOnce({ outcome: 'sent' });
    expect(await notifyResignationSubmitted('ex-1')).toBe(true);
  });

  it.each(['disabled', 'capped', 'undeliverable', 'duplicate', 'blocked', 'cooldown'])(
    'reports NOT delivered on %s', async (outcome) => {
      mockFlow(ctx());
      notify().mockResolvedValueOnce({ outcome });
      expect(await notifyResignationSubmitted('ex-1')).toBe(false);
    });

  it('reports NOT delivered when the gateway throws', async () => {
    mockFlow(ctx());
    notify().mockRejectedValueOnce(new Error('gateway down'));
    expect(await notifyResignationSubmitted('ex-1')).toBe(false);
  });

  it('reports NOT delivered when the exit request is gone', async () => {
    mockFlow(null);
    expect(await notifyResignationSubmitted('gone')).toBe(false);
    expect(notify()).not.toHaveBeenCalled();
  });
});

describe('resignation submitted', () => {
  it('gives the manager tenure and notice runway to plan backfill', async () => {
    mockFlow(ctx());
    await notifyResignationSubmitted('ex-1');
    expect(sent().eventCode).toBe('resignation_submitted');
    expect(sent().data.tenure_years).toBeGreaterThan(2);
    expect(typeof sent().data.days_to_proposed_lwd).toBe('number');
  });

  it('reports null tenure rather than a wrong number when joining date is unknown', async () => {
    mockFlow(ctx({ date_of_joining: null }));
    await notifyResignationSubmitted('ex-1');
    expect(sent().data.tenure_years).toBeNull();
  });

  it('reports null tenure for an unparseable joining date', async () => {
    mockFlow(ctx({ date_of_joining: 'not-a-date' }));
    await notifyResignationSubmitted('ex-1');
    expect(sent().data.tenure_years).toBeNull();
  });
});

describe('resignation decision', () => {
  it('routes a revocation to its own event', async () => {
    mockFlow(ctx({ status: 'revoked' }));
    await notifyResignationDecision('ex-1', 'revoked');
    expect(sent().eventCode).toBe('resignation_revoked');
  });

  it.each(['accepted', 'rejected'] as const)('routes %s to resignation_decision', async (d) => {
    mockFlow(ctx());
    await notifyResignationDecision('ex-1', d);
    expect(sent().eventCode).toBe('resignation_decision');
  });

  it('puts the decision in the dedupe key so accept-then-revoke both notify', async () => {
    mockFlow(ctx());
    await notifyResignationDecision('ex-1', 'accepted');
    await notifyResignationDecision('ex-1', 'revoked');
    expect(notify().mock.calls.map((c) => c[0].dedupeKey)).toEqual([
      'exit_request:ex-1:accepted', 'exit_request:ex-1:revoked',
    ]);
  });

  it('never throws — a mail failure must not fail the decision', async () => {
    mockFlow(ctx());
    notify().mockRejectedValueOnce(new Error('down'));
    await expect(notifyResignationDecision('ex-1', 'accepted')).resolves.toBeUndefined();
  });
});

describe('last working day approaching', () => {
  it('carries the open clearance count, which is what makes it actionable', async () => {
    mockFlow(ctx({ last_working_day_confirmed: '2026-09-15' }), { pending: 3, departments: 'IT, Finance' });
    await notifyLastWorkingDayApproaching('ex-1');
    expect(sent().data).toMatchObject({ clearance_pending: 3, clearance_departments: 'IT, Finance' });
  });

  it('reports null — not 0 — when the checklist cannot be read, so it never reads as all-clear', async () => {
    exec().mockReset();
    exec().mockImplementation(async (sql: string) => {
      if (/FROM exit_request er/i.test(sql)) return [[ctx({ last_working_day_confirmed: '2026-09-15' })], []];
      throw new Error('checklist unavailable');
    });
    await notifyLastWorkingDayApproaching('ex-1');
    expect(sent().data.clearance_pending).toBeNull();
  });
});
