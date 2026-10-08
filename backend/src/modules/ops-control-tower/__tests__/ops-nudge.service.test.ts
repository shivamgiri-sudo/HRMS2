import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbExecute, send, isConfigured } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  send: vi.fn(),
  isConfigured: vi.fn(),
}));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: dbExecute } }));
vi.mock('../../../config/env.js', () => ({ env: { FRONTEND_URL: 'https://hrms.test' } }));
vi.mock('../../communication/providers/provider.factory.js', () => ({
  providerFactory: { getProvider: () => ({ send, isConfigured }) },
}));
vi.mock('../ops-control-tower.service.js', () => ({
  allBranches: vi.fn(async () => [{ branchId: 'b1', branchName: 'NOIDA' }]),
  getAccountDetailsMissingDetail: vi.fn(async () => [{ employeeId: 'e1' }, { employeeId: 'e2' }]),
  getDocsPendingDetail: vi.fn(async () => []),
  getPennyDropMissingDetail: vi.fn(async () => [{ employeeId: 'e1' }]),
  getDigilockerPendingDetail: vi.fn(async () => []),
  getEsignPendingDetail: vi.fn(async () => []),
  getAppointmentLetterDetail: vi.fn(async () => []),
  getBgvPendingDetail: vi.fn(async () => []),
}));

import { nudgeEmployee, bulkNudge, getNudgeStats, runAutoNudgeSweep, issueOnboardingLink } from '../ops-nudge.service.js';

const NOW = new Date('2026-10-02T10:00:00Z').getTime();
let recipient: Record<string, unknown> | null;
let lastSent: string | null;
let inserts: unknown[][];
let updates: unknown[][];
let sentCount = 1;
let escalated = false;
let workItems: unknown[][] = [];
let bridgeAffected: number;

let joinersMove = true;

beforeEach(() => {
  dbExecute.mockReset(); send.mockReset(); isConfigured.mockReset();
  inserts = []; updates = []; bridgeAffected = 1; sentCount = 1; escalated = false; workItems = [];
  recipient = { full_name: 'Asha Rao', branch_id: 'b1', emp_mobile: '9999999999', candidate_id: 'c1',
    cand_mobile: '8888888888', candidate_status: null, onboarding_token: 'tok', onboarding_token_expires_at: null, days_open: 4 };
  lastSent = null; joinersMove = true;
  isConfigured.mockReturnValue(true);
  send.mockResolvedValue({ success: true });
  dbExecute.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes(' AS ok')) return [[{ ok: joinersMove ? 1 : 0 }]];
    if (sql.includes('FROM employees e')) return [recipient ? [recipient] : []];
    if (sql.includes('MAX(created_at) AS last_sent')) return [[{ last_sent: lastSent }]];
    if (sql.includes('INSERT INTO ops_nudge_log')) { inserts.push(params); return [{}]; }
    if (sql.includes('COUNT(*) AS n FROM ops_nudge_log')) return [[{ n: sentCount }]];
    if (sql.includes('FROM work_item WHERE item_type')) return [escalated ? [{ id: 'w' }] : []];
    if (sql.includes('INSERT INTO work_item')) { workItems.push(params); return [{}]; }
    if (sql.includes('UPDATE ats_onboarding_bridge')) { updates.push(params); return [{ affectedRows: bridgeAffected }]; }
    return [[]];
  });
});

const call = (over = {}) => nudgeEmployee({ employeeId: 'e1', issue: 'digilocker-pending', trigger: 'manual', actorId: 'u1', nowMs: NOW, ...over });
const loggedStatus = () => inserts.map((p) => p[5]);

describe('nudgeEmployee', () => {
  it('sends WhatsApp to the candidate mobile with the onboarding link, and logs sent', async () => {
    const r = await call();
    expect(r.status).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('8888888888');
    expect(send.mock.calls[0][2]).toContain('https://hrms.test/onboard-full?token=tok');
    expect(loggedStatus()).toEqual(['sent']);
  });

  it('falls back to employee mobile and re-issues a fresh link when the token expired', async () => {
    recipient = { ...recipient!, cand_mobile: null, onboarding_token_expires_at: '2026-01-01 00:00:00' };
    await call();
    expect(send.mock.calls[0][0]).toBe('9999999999');
    expect(updates).toHaveLength(1);
    const [fresh, expiry, candidateId] = updates[0] as [string, Date, string];
    expect(candidateId).toBe('c1');
    expect(fresh).not.toBe('tok');
    expect(expiry.getTime()).toBe(NOW + 72 * 60 * 60 * 1000);
    expect(send.mock.calls[0][2]).toContain(`https://hrms.test/onboard-full?token=${fresh}`);
  });

  it('does not touch a live token', async () => {
    await call();
    expect(updates).toHaveLength(0);
  });

  it('omits the link when the employee has no onboarding bridge row', async () => {
    recipient = { ...recipient!, candidate_id: null, onboarding_token: null };
    await call();
    expect(updates).toHaveLength(0);
    expect(send.mock.calls[0][2]).not.toContain('onboard-full');
  });

  it('does not mint a token when the message is skipped for cooldown', async () => {
    recipient = { ...recipient!, onboarding_token_expires_at: '2026-01-01 00:00:00' };
    lastSent = new Date(NOW - 60 * 1000).toISOString();
    expect((await call()).status).toBe('skipped_cooldown');
    expect(updates).toHaveLength(0);
  });

  it('returns not_found without logging for an unknown employee', async () => {
    recipient = null;
    expect((await call()).status).toBe('not_found');
    expect(inserts).toHaveLength(0);
  });

  it('skips not_joining candidates', async () => {
    recipient = { ...recipient!, candidate_status: 'not_joining' };
    expect((await call()).status).toBe('skipped_not_joining');
    expect(send).not.toHaveBeenCalled();
    expect(loggedStatus()).toEqual(['skipped_not_joining']);
  });

  it('skips when no mobile on file', async () => {
    recipient = { ...recipient!, cand_mobile: null, emp_mobile: '  ' };
    expect((await call()).status).toBe('skipped_no_contact');
    expect(send).not.toHaveBeenCalled();
  });

  it('respects the 24h cooldown and does not log or send', async () => {
    lastSent = new Date(NOW - 2 * 3600_000).toISOString();
    const r = await call();
    expect(r.status).toBe('skipped_cooldown');
    expect(r.nextEligibleMs).toBe(new Date(lastSent).getTime() + 24 * 3600_000);
    expect(send).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('sends again once 24h have passed', async () => {
    lastSent = new Date(NOW - 25 * 3600_000).toISOString();
    expect((await call()).status).toBe('sent');
  });

  it('logs skipped_unconfigured and never calls the provider when WhatsApp is not set up', async () => {
    isConfigured.mockReturnValue(false);
    expect((await call()).status).toBe('skipped_unconfigured');
    expect(send).not.toHaveBeenCalled();
    expect(loggedStatus()).toEqual(['skipped_unconfigured']);
  });

  it('logs failed with the provider error when the send is rejected', async () => {
    send.mockResolvedValue({ success: false, error: 'template rejected' });
    const r = await call();
    expect(r).toMatchObject({ status: 'failed', error: 'template rejected' });
    expect(loggedStatus()).toEqual(['failed']);
  });

  it('logs failed when the provider throws', async () => {
    send.mockRejectedValue(new Error('boom'));
    expect((await call()).status).toBe('failed');
  });

  it('records trigger and actor', async () => {
    await call({ trigger: 'auto', actorId: null });
    expect(inserts[0][4]).toBe('auto');
    expect(inserts[0][6]).toBeNull();
  });
});

describe('bulkNudge', () => {
  it('dedupes ids and reports a result per employee', async () => {
    const res = await bulkNudge({ employeeIds: ['e1', 'e1', 'e2'], issue: 'digilocker-pending', actorId: 'u1' });
    expect(res.map((r) => r.employeeId)).toEqual(['e1', 'e2']);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('getNudgeStats', () => {
  it('maps count and last send per employee; empty input skips the query', async () => {
    expect((await getNudgeStats('bgv-pending', [])).size).toBe(0);
    expect(dbExecute).not.toHaveBeenCalled();
    dbExecute.mockImplementation(async () => [[{ employee_id: 'e1', n: 3, last_sent: '2026-10-01 09:00:00' }]]);
    const m = await getNudgeStats('bgv-pending', ['e1', 'e2']);
    expect(m.get('e1')?.count).toBe(3);
    expect(m.has('e2')).toBe(false);
  });
});

describe('runAutoNudgeSweep', () => {
  it('is a no-op while WhatsApp is not configured', async () => {
    isConfigured.mockReturnValue(false);
    const s = await runAutoNudgeSweep(NOW);
    expect(s.skippedUnconfigured).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('nudges each pending (employee, issue) once and counts results', async () => {
    const s = await runAutoNudgeSweep(NOW);
    // account-details: e1,e2 ; penny-drop: e1  => 3 distinct pairs
    expect(s).toMatchObject({ attempted: 3, sent: 3, failed: 0, skipped: 0 });
    expect(inserts.every((p) => p[4] === 'auto')).toBe(true);
  });

  it('holds back items whose next step is HR\'s, without logging or sending', async () => {
    joinersMove = false;
    const s = await runAutoNudgeSweep(NOW);
    // penny-drop (e1) is checked and held back; account-details has no condition and still goes out.
    expect(s).toMatchObject({ attempted: 2, sent: 2, notJoinersMove: 1 });
  });

  it('does not count cooled-down pairs as attempts', async () => {
    lastSent = new Date(NOW - 3600_000).toISOString();
    const s = await runAutoNudgeSweep(NOW);
    expect(s.attempted).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

import { enrichDetailRows, nudgeBranchPending, employeeBranchId } from '../ops-nudge.service.js';

describe('enrichDetailRows', () => {
  it('adds ageing, candidateId and nudge info on a nudgeable block', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ats_onboarding_bridge')) return [[{ employee_id: 'e1', candidate_id: 'c1' }]];
      if (sql.includes('FROM ops_nudge_log')) return [[{ employee_id: 'e1', n: 2, last_sent: '2026-10-02 09:00:00' }]];
      return [[]];
    });
    const [a, b] = await enrichDetailRows('digilocker-pending',
      [{ employeeId: 'e1', daysOpen: 9 }, { employeeId: 'e2', daysOverdue: 1 }], NOW);
    expect(a).toMatchObject({ daysOpen: 9, ageBucket: '8+', candidateId: 'c1' });
    expect(a.nudge).toMatchObject({ count: 2, due: false });
    expect(b).toMatchObject({ daysOpen: 1, ageBucket: '0-2', candidateId: null });
    expect(b.nudge).toMatchObject({ count: 0, lastSentMs: null, due: true });
  });

  it('omits nudge info (and skips the log query) for non-nudgeable blocks', async () => {
    dbExecute.mockImplementation(async () => [[]]);
    const [r] = await enrichDetailRows('fnf-pending', [{ employeeId: 'e1', daysOpen: 5 }], NOW);
    expect(r.nudge).toBeUndefined();
    expect(dbExecute.mock.calls.some((c) => String(c[0]).includes('ops_nudge_log'))).toBe(false);
  });
});

describe('nudgeBranchPending', () => {
  it('nudges every pending joiner the branch loader returns, as manual', async () => {
    const res = await nudgeBranchPending({ branchId: 'b1', issue: 'account-details-missing', actorId: 'u1' });
    expect(res.map((r) => r.employeeId)).toEqual(['e1', 'e2']);
    expect(inserts.every((p) => p[4] === 'manual')).toBe(true);
  });
});

describe('employeeBranchId', () => {
  it('returns null when employee missing', async () => {
    dbExecute.mockImplementation(async () => [[]]);
    expect(await employeeBranchId('x')).toBeNull();
  });
});

describe('shared ledger with payroll pendency emails', () => {
  const emailAt = (ms: number) => new Date(ms).toISOString();

  it('an email reminder in the last 24h for the same item blocks the WhatsApp nudge', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM employees e')) return [[recipient]];
      if (sql.includes('FROM pendency_reminder_log')) return [[{ last_sent: emailAt(NOW - 3600_000) }]];
      if (sql.includes('MAX(created_at) AS last_sent')) return [[{ last_sent: null }]];
      if (sql.includes('INSERT INTO ops_nudge_log')) { inserts.push([]); return [{}]; }
      return [[]];
    });
    const r = await nudgeEmployee({ employeeId: 'e1', issue: 'digilocker-pending', trigger: 'auto', actorId: null, nowMs: NOW });
    expect(r.status).toBe('skipped_cooldown');
    expect(send).not.toHaveBeenCalled();
  });

  it('issues the emails do not cover never consult the pendency log', async () => {
    await call({ issue: 'bgv-pending' });
    expect(dbExecute.mock.calls.some((c) => String(c[0]).includes('pendency_reminder_log'))).toBe(false);
  });

  it('a missing pendency table does not block the nudge', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM employees e')) return [[recipient]];
      if (sql.includes('FROM pendency_reminder_log')) throw Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
      if (sql.includes('MAX(created_at) AS last_sent')) return [[{ last_sent: null }]];
      return [{}];
    });
    const r = await nudgeEmployee({ employeeId: 'e1', issue: 'digilocker-pending', trigger: 'manual', actorId: 'u1', nowMs: NOW });
    expect(r.status).toBe('sent');
  });

  it('stats fold email reminders into count and last-sent', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ops_nudge_log')) return [[{ employee_id: 'e1', n: 1, last_sent: '2026-10-01 09:00:00' }]];
      if (sql.includes('FROM pendency_reminder_log')) return [[{ employee_id: 'e1', n: 2, last_sent: '2026-10-02 08:00:00' }, { employee_id: 'e2', n: 1, last_sent: '2026-09-30 08:00:00' }]];
      return [[]];
    });
    const m = await getNudgeStats('digilocker-pending', ['e1', 'e2']);
    expect(m.get('e1')).toEqual({ count: 3, lastSentMs: new Date('2026-10-02 08:00:00').getTime() });
    expect(m.get('e2')?.count).toBe(1);
  });
});

describe('issueOnboardingLink', () => {
  it('reuses a live token without writing', async () => {
    const out = await issueOnboardingLink('e1', NOW);
    expect(out?.link).toBe('https://hrms.test/onboard-full?token=tok');
    expect(updates).toHaveLength(0);
  });
  it('re-issues an expired token (72h) and returns the new link', async () => {
    recipient = { ...recipient!, onboarding_token_expires_at: '2026-01-01 00:00:00' };
    const out = await issueOnboardingLink('e1', NOW);
    expect(updates).toHaveLength(1);
    expect(out?.link).toContain(`token=${(updates[0] as string[])[0]}`);
  });
  it('null for an unknown employee, a not-joining candidate, or one with no onboarding record', async () => {
    recipient = null;
    expect(await issueOnboardingLink('e1', NOW)).toBeNull();
    recipient = { ...baseRecipient(), candidate_status: 'not_joining' };
    expect(await issueOnboardingLink('e1', NOW)).toBeNull();
    recipient = { ...baseRecipient(), candidate_id: null, onboarding_token: null };
    expect(await issueOnboardingLink('e1', NOW)).toBeNull();
  });
});
function baseRecipient() {
  return { full_name: 'Asha Rao', branch_id: 'b1', emp_mobile: '9999999999', candidate_id: 'c1', cand_mobile: '8888888888',
    candidate_status: null, onboarding_token: 'tok', onboarding_token_expires_at: null, days_open: 4 };
}

describe('escalation after repeated nudges', () => {
  it('does nothing below the threshold', async () => {
    sentCount = 2;
    await call();
    expect(workItems).toHaveLength(0);
  });
  it('raises one work item for the branch head at the third delivered nudge', async () => {
    sentCount = 3;
    await call();
    expect(workItems).toHaveLength(1);
    const p = workItems[0] as string[];
    expect(p[0]).toBe('OPS_NUDGE_ESCALATION');
    expect(p[1]).toContain('Asha Rao');
    expect(p).toEqual(expect.arrayContaining(['digilocker-pending', 'e1', 'b1']));
  });
  it('does not raise a second one for the same joiner and issue', async () => {
    sentCount = 5; escalated = true;
    await call();
    expect(workItems).toHaveLength(0);
  });
  it('a failing escalation never turns a delivered nudge into an error', async () => {
    sentCount = 3;
    const base = dbExecute.getMockImplementation()!;
    dbExecute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO work_item')) throw new Error('work_item missing');
      return base(sql, params);
    });
    expect((await call()).status).toBe('sent');
  });
});

import { isJoinersMove, JOINER_ACTION_SQL } from '../ops-nudge.service.js';

describe('isJoinersMove', () => {
  it('never auto-reminds for BGV (run and reviewed by HR and the provider)', async () => {
    expect(await isJoinersMove('e1', 'bgv-pending')).toBe(false);
    expect(dbExecute.mock.calls.some((c) => String(c[0]).includes(' AS ok'))).toBe(false);
  });

  it('asks the database for items that depend on what HR has sent, binding the employee id', async () => {
    joinersMove = false;
    expect(await isJoinersMove('e9', 'esign-pending')).toBe(false);
    const [sql, params] = dbExecute.mock.calls.find((c) => String(c[0]).includes(' AS ok'))!;
    expect(String(sql)).toContain("k.status = 'sent'");
    expect(params).toEqual(['e9']);
  });

  it('pins which statuses count as the joiner\'s move', () => {
    expect(JOINER_ACTION_SQL['appointment-letter']).toContain("'sent', 'opened'");
    expect(JOINER_ACTION_SQL['docs-pending']).toContain("'draft_generated'");
    expect(JOINER_ACTION_SQL['penny-drop-missing']).toContain("'manual_review'");
    expect(JOINER_ACTION_SQL['digilocker-pending']).toBeNull();
    expect(JOINER_ACTION_SQL['account-details-missing']).toBeNull();
  });
});
