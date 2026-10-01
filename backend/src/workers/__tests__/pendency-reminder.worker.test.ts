import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/worker-config.js', () => ({ isWorkerEnabled: vi.fn(async () => true), markWorkerRun: vi.fn() }));
vi.mock('../../shared/workItem.js', () => ({ upsertOpenWorkItem: vi.fn(async () => 'created') }));
vi.mock('../../modules/payroll/pendency/pendency.service.js', async (orig) => ({
  ...(await orig<typeof import('../../modules/payroll/pendency/pendency.service.js')>()),
  listPendingEmployeeIds: vi.fn(async () => ['e1', 'e2']),
  sendPendencyReminders: vi.fn(),
}));
vi.mock('../../db/mysql.js', () => ({ db: { execute: vi.fn() } }));
vi.mock('../../config/env.js', () => ({ env: { FRONTEND_URL: 'https://hrms.example.com' } }));

import { istParts, readMode, runPendencyReminders } from '../pendency-reminder.worker.js';
import { sendPendencyReminders } from '../../modules/payroll/pendency/pendency.service.js';
import { upsertOpenWorkItem } from '../../shared/workItem.js';

describe('readMode', () => {
  it('is off unless explicitly set to dry-run or live', () => {
    expect(readMode(undefined)).toBe('off');
    expect(readMode('')).toBe('off');
    expect(readMode('true')).toBe('off');
    expect(readMode('LIVE')).toBe('live');
    expect(readMode(' dry-run ')).toBe('dry-run');
  });
});

describe('istParts', () => {
  it('converts to IST date and hour across midnight UTC', () => {
    expect(istParts(new Date('2026-10-09T20:30:00Z'))).toEqual({ date: '2026-10-10', hour: 2 });
    expect(istParts(new Date('2026-10-10T05:00:00Z'))).toEqual({ date: '2026-10-10', hour: 10 });
  });
});

describe('runPendencyReminders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dry-run passes dryRun through and creates no escalations', async () => {
    vi.mocked(sendPendencyReminders).mockResolvedValue([
      { employee_id: 'e1', employee_code: 'A', status: 'would_send' },
      { employee_id: 'e2', employee_code: 'B', status: 'skipped', reason: 'max_reminders_reached' },
    ]);
    const s: any = await runPendencyReminders('dry-run');
    expect(vi.mocked(sendPendencyReminders).mock.calls.every((c) => c[0].dryRun === true && c[0].trigger === 'scheduler')).toBe(true);
    expect(s.esi_docs).toEqual({ pending: 2, sent: 0, would_send: 1, failed: 0, skipped: 1 });
    expect(upsertOpenWorkItem).not.toHaveBeenCalled();
  });

  it('live mode escalates employees who hit the cap, once per kind', async () => {
    vi.mocked(sendPendencyReminders).mockResolvedValue([
      { employee_id: 'e1', employee_code: 'A', status: 'sent' },
      { employee_id: 'e2', employee_code: 'B', status: 'skipped', reason: 'max_reminders_reached' },
    ]);
    await runPendencyReminders('live');
    expect(vi.mocked(sendPendencyReminders).mock.calls.every((c) => c[0].dryRun === false)).toBe(true);
    const items = vi.mocked(upsertOpenWorkItem).mock.calls.map((c) => c[0].itemType).sort();
    expect(items).toEqual(['PENDENCY_BANK_ACCOUNT_ESCALATION', 'PENDENCY_DIGILOCKER_ESCALATION', 'PENDENCY_ESI_DOCS_ESCALATION']);
    expect(vi.mocked(upsertOpenWorkItem).mock.calls[0][0]).toMatchObject({ entityType: 'employee', entityId: 'e2', assignedToRole: 'payroll_hr' });
  });
});
