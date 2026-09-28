/**
 * FSM contract — validates that transitionExitStatus():
 *   1. Reads the current record and enforces the allowed-transitions matrix.
 *   2. Writes the correct fields for each terminal state.
 *   3. Always inserts an exit_approval_log row.
 *   4. Calls createDefaultClearanceTasks on notice_active.
 *
 * Uses the global mocked db (tests/setup.ts) and stubs the modules that
 * transitionExitStatus itself does not exercise, keeping this test fast and
 * CI-safe without a real DB connection.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { RowDataPacket } from 'mysql2';

// ── Module stubs for the exit.service import chain ────────────────────────
vi.mock('../exit-intelligence.service.js', () => ({
  createDefaultClearanceTasks: vi.fn().mockResolvedValue([]),
  createExitHealthSnapshot: vi.fn().mockResolvedValue(null),
}));
vi.mock('../exit.notifications.js', () => ({
  notifyResignationSubmitted: vi.fn().mockResolvedValue(false),
  notifyResignationDecision: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../communication/sms.helper.js', () => ({ sendSMS: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: vi.fn() }) },
}));
vi.mock('../../work-inbox/work-inbox.triggers.js', () => ({
  triggerResignationPendingReview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../management/manager-attribution.service.js', () => ({
  recordManagerChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shared/sessionRevocation.js', () => ({
  revokeSessionsForEmployee: vi.fn().mockResolvedValue({ refreshTokensRevoked: 0, deviceSessionsRevoked: 0 }),
}));
vi.mock('../../../shared/employeeDeprovisioning.js', () => ({
  deprovisionEmployeeAccess: vi.fn().mockResolvedValue({ failures: [] }),
}));
vi.mock('../exit-followup-recovery.js', () => ({
  recordExitFollowUpFailure: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../policy-engine/policy-engine.cache.js', () => ({
  getPolicyValue: vi.fn().mockResolvedValue('30'),
}));
vi.mock('../../../shared/auditLog.js', () => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shared/workItem.js', () => ({
  upsertOpenWorkItem: vi.fn().mockResolvedValue(undefined),
}));

// ── Grab db mock AFTER stubs are declared ─────────────────────────────────
import { db } from '../../../db/mysql.js';
import { transitionExitStatus } from '../exit.service.js';
import { createDefaultClearanceTasks } from '../exit-intelligence.service.js';

const dbExecute = db.execute as ReturnType<typeof vi.fn>;

function makeExitRow(status: string) {
  return [
    [{ id: 'exit-1', employee_id: 'emp-1', status, exit_type: 'voluntary', exit_sub_type: 'resignation' }] as RowDataPacket[],
    [],
  ];
}

const emptyResult = [[] as RowDataPacket[], []];

const managerActor = { userId: 'mgr-1', userRole: 'manager' };
const empActor    = { userId: 'emp-1', userRole: 'employee' };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: SELECT returns a submitted row; UPDATE and INSERT succeed silently.
  dbExecute.mockResolvedValue(emptyResult);
});

describe('Exit FSM transitionExitStatus', () => {
  it('submitted → notice_active: UPDATE fires with manager_actioned_at, then approval log INSERT', async () => {
    dbExecute
      .mockResolvedValueOnce(makeExitRow('submitted')) // SELECT
      .mockResolvedValueOnce(emptyResult)              // UPDATE
      .mockResolvedValueOnce(emptyResult);             // INSERT approval log

    await transitionExitStatus('exit-1', 'notice_active', managerActor);

    const calls: [string, unknown[]][] = dbExecute.mock.calls;
    const updateCall = calls.find(([sql]) => typeof sql === 'string' && /UPDATE exit_request/.test(sql));
    expect(updateCall).toBeTruthy();
    expect(updateCall![0]).toMatch(/manager_actioned_at/);
    expect(updateCall![0]).toMatch(/status = \?/);
    expect(updateCall![1][0]).toBe('notice_active');

    const logCall = calls.find(([sql]) => typeof sql === 'string' && /INSERT INTO exit_approval_log/.test(sql));
    expect(logCall).toBeTruthy();
    expect(logCall![1]).toContain('manager');  // action_by_role
  });

  it('submitted → returned: stores return_reason and sets manager_actioned_at', async () => {
    dbExecute
      .mockResolvedValueOnce(makeExitRow('submitted'))
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    await transitionExitStatus('exit-1', 'returned', managerActor, { reason: 'Wrong LWD' });

    const calls: [string, unknown[]][] = dbExecute.mock.calls;
    const updateCall = calls.find(([sql]) => typeof sql === 'string' && /UPDATE exit_request/.test(sql));
    expect(updateCall![0]).toMatch(/return_reason/);
    expect(updateCall![0]).toMatch(/manager_actioned_at/);
    expect(updateCall![1]).toContain('Wrong LWD');
  });

  it('invalid transition throws 409 with code invalid_transition', async () => {
    dbExecute.mockResolvedValueOnce(makeExitRow('submitted'));

    await expect(transitionExitStatus('exit-1', 'exited', managerActor))
      .rejects.toMatchObject({ statusCode: 409, code: 'invalid_transition' });
  });

  it('notice_active → revoked: sets revoked_at, revoke_reason, revoked_by', async () => {
    dbExecute
      .mockResolvedValueOnce(makeExitRow('notice_active'))
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    await transitionExitStatus('exit-1', 'revoked', empActor, { reason: 'Changed mind' });

    const calls: [string, unknown[]][] = dbExecute.mock.calls;
    const updateCall = calls.find(([sql]) => typeof sql === 'string' && /UPDATE exit_request/.test(sql));
    expect(updateCall![0]).toMatch(/revoked_at/);
    expect(updateCall![0]).toMatch(/revoke_reason/);
    expect(updateCall![0]).toMatch(/revoked_by/);
    expect(updateCall![1]).toContain('Changed mind');
    expect(updateCall![1]).toContain('emp-1');
  });

  it('notice_active transition calls createDefaultClearanceTasks', async () => {
    dbExecute
      .mockResolvedValueOnce(makeExitRow('submitted'))
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    await transitionExitStatus('exit-1', 'notice_active', managerActor);
    expect(createDefaultClearanceTasks).toHaveBeenCalledWith('exit-1', 'emp-1');
  });

  it('every transition writes an exit_approval_log entry with actor role', async () => {
    dbExecute
      .mockResolvedValueOnce(makeExitRow('submitted'))
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    await transitionExitStatus('exit-1', 'notice_active', managerActor);

    const calls: [string, unknown[]][] = dbExecute.mock.calls;
    const logCall = calls.find(([sql]) => typeof sql === 'string' && /INSERT INTO exit_approval_log/.test(sql));
    expect(logCall).toBeTruthy();
    // params: [uuid, exitRequestId, stage, action, actor.userId, actor.userRole, reason]
    expect(logCall![1][5]).toBe('manager');
  });
});
