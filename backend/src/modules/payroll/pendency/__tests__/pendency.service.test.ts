import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../config/env.js', () => ({ env: { FRONTEND_URL: 'https://hrms.example.com' } }));
vi.mock('../../../../db/mysql.js', () => ({ db: { execute: vi.fn() } }));
vi.mock('../../../communication/email.service.js', () => ({ emailService: { send: vi.fn() } }));
vi.mock('../../esi-pending.query.js', () => ({ fetchEsiPendingRows: vi.fn(), ESI_STILL_APPLICABLE_SQL: '1=1' }));

import { db } from '../../../../db/mysql.js';
import { emailService } from '../../../communication/email.service.js';
import { fetchEsiPendingRows } from '../../esi-pending.query.js';
import {
  cooldownDecision, describeSkip, esiMissingItems, pickRecipient, sendPendencyReminders, MAX_REMINDERS,
} from '../pendency.service.js';
import { buildPendencyEmail } from '../pendency-email.template.js';
import { buildAppLink } from '../../../../shared/appLink.js';

describe('buildAppLink', () => {
  it('joins base, path and encoded query without double slashes', () => {
    expect(buildAppLink('/profile', { tab: 'documents' })).toBe('https://hrms.example.com/profile?tab=documents');
    expect(buildAppLink('profile')).toBe('https://hrms.example.com/profile');
    expect(buildAppLink('/x', { a: 'b c', skip: undefined })).toBe('https://hrms.example.com/x?a=b%20c');
  });
});

describe('pickRecipient', () => {
  it('prefers personal, then official, then email; skips invalid', () => {
    expect(pickRecipient({ personal_email: 'p@x.com', official_email: 'o@x.com', email: 'e@x.com' })).toBe('p@x.com');
    expect(pickRecipient({ personal_email: 'not-an-email', official_email: 'o@x.com' })).toBe('o@x.com');
    expect(pickRecipient({ personal_email: '', official_email: null, email: ' e@x.com ' })).toBe('e@x.com');
    expect(pickRecipient({})).toBeNull();
  });
});

describe('esiMissingItems', () => {
  it('lists only what is missing', () => {
    expect(esiMissingItems({ pan_ready: true, aadhaar_ready: true, photo_ready: true, bank_passbook_ready: true })).toEqual([]);
    const all = esiMissingItems({ pan_ready: false, aadhaar_ready: false, photo_ready: false, bank_passbook_ready: false });
    expect(all).toHaveLength(4);
    expect(esiMissingItems({ pan_ready: true, aadhaar_ready: false, photo_ready: true, bank_passbook_ready: true })).toEqual(['Aadhaar card']);
    expect(esiMissingItems({ pan_ready: true, aadhaar_ready: true, photo_ready: false, bank_passbook_ready: true })).toEqual([
      'Your photo (clear face, plain background)',
    ]);
  });
});

describe('cooldownDecision', () => {
  const now = new Date('2026-10-10T10:00:00Z');
  it('allows the first reminder', () => expect(cooldownDecision(0, null, now)).toBeNull());
  it('blocks inside the gap', () =>
    expect(cooldownDecision(1, new Date('2026-10-08T10:00:00Z'), now)).toBe('recently_reminded'));
  it('allows after the gap', () =>
    expect(cooldownDecision(1, new Date('2026-10-07T09:00:00Z'), now)).toBeNull());
  it('stops at the cap even when the gap has passed', () =>
    expect(cooldownDecision(MAX_REMINDERS, new Date('2026-09-01T00:00:00Z'), now)).toBe('max_reminders_reached'));
});

describe('describeSkip', () => {
  it('explains every skip reason in words', () => {
    for (const r of ['not_pending', 'no_email', 'recently_reminded', 'max_reminders_reached', 'no_valid_link']) {
      expect(describeSkip(r)).toMatch(/\w{5,}/);
      expect(describeSkip(r)).not.toBe(r);
    }
    expect(describeSkip(undefined)).toBe('Skipped.');
  });
});

describe('buildPendencyEmail', () => {
  it('puts the link in the button and in the plain-text part', () => {
    const { html, text } = buildPendencyEmail({
      name: 'A <b>', heading: 'H', intro: 'I', items: ['PAN card'], ctaLabel: 'Go', ctaUrl: 'https://h/x?a=1&b=2',
    });
    expect(html).toContain('href="https://h/x?a=1&amp;b=2"');
    expect(html).toContain('A &lt;b&gt;');
    expect(text).toContain('Go: https://h/x?a=1&b=2');
  });
});

describe('sendPendencyReminders', () => {
  const exec = vi.mocked(db.execute);
  beforeEach(() => { vi.clearAllMocks(); });

  /** loadContacts, loadHistory are queried after the pending loader; order matches Promise.all start order. */
  function mockDb(opts: { contacts: any[]; history?: any[] }) {
    exec.mockImplementation(async (sql: any) => {
      const s = String(sql);
      if (s.includes('FROM employees WHERE id IN')) return [opts.contacts, []] as any;
      if (s.includes('FROM pendency_reminder_log')) return [opts.history ?? [], []] as any;
      if (s.includes('INSERT INTO pendency_reminder_log')) return [{}, []] as any;
      return [[], []] as any;
    });
  }

  it('sends the ESI email with the documents link, and logs it to pendency_reminder_log', async () => {
    mockDb({ contacts: [{ id: 'e1', employee_code: 'MAS1', first_name: 'Asha', email: null, official_email: null, personal_email: 'asha@x.com' }] });
    vi.mocked(fetchEsiPendingRows).mockResolvedValue([
      { employee_id: 'e1', pan_ready: 1, aadhaar_ready: 1, photo_ready: 0, bank_passbook_url: null },
    ] as any);
    vi.mocked(emailService.send).mockResolvedValue({} as any);

    const res = await sendPendencyReminders({ kind: 'esi_docs', employeeIds: ['e1'], sentBy: 'u1', trigger: 'manual' });

    expect(res).toEqual([{ employee_id: 'e1', employee_code: 'MAS1', status: 'sent' }]);
    const mail = vi.mocked(emailService.send).mock.calls[0][0] as any;
    expect(mail.to).toBe('asha@x.com');
    expect(mail.html).toContain('https://hrms.example.com/profile?tab=documents');
    // The list names exactly what is missing (PAN is ready, so it is not listed as an item).
    const listed = [...String(mail.html).matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1]);
    expect(listed).toHaveLength(2);
    expect(listed[0]).toContain('Your photo');
    expect(listed[1]).toContain('Bank passbook');

    const insert = exec.mock.calls.find((c) => String(c[0]).includes('INSERT INTO pendency_reminder_log'))!;
    expect(insert[1]).toEqual(expect.arrayContaining(['e1', 'esi_docs', 'sent', 'asha@x.com', 'manual', 'u1']));
  });

  it('dry-run reports would_send without sending or writing a log row', async () => {
    mockDb({ contacts: [{ id: 'e1', employee_code: 'MAS1', first_name: 'A', personal_email: 'a@x.com' }] });
    vi.mocked(fetchEsiPendingRows).mockResolvedValue([{ employee_id: 'e1', pan_ready: 0, aadhaar_ready: 1, photo_ready: 1, bank_passbook_url: '/x' }] as any);
    const res = await sendPendencyReminders({ kind: 'esi_docs', employeeIds: ['e1'], sentBy: null, trigger: 'scheduler', dryRun: true });
    expect(res[0]).toMatchObject({ status: 'would_send' });
    expect(emailService.send).not.toHaveBeenCalled();
    expect(exec.mock.calls.some((c) => String(c[0]).includes('INSERT INTO pendency_reminder_log'))).toBe(false);
  });

  it('skips employees who are not pending, without sending', async () => {
    mockDb({ contacts: [{ id: 'e1', employee_code: 'MAS1', first_name: 'A', personal_email: 'a@x.com' }] });
    vi.mocked(fetchEsiPendingRows).mockResolvedValue([
      { employee_id: 'e1', pan_ready: 1, aadhaar_ready: 1, photo_ready: 1, bank_passbook_url: '/x' },
    ] as any);
    const res = await sendPendencyReminders({ kind: 'esi_docs', employeeIds: ['e1'], sentBy: null, trigger: 'manual' });
    expect(res[0]).toMatchObject({ status: 'skipped', reason: 'not_pending' });
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('respects the cooldown', async () => {
    mockDb({
      contacts: [{ id: 'e1', employee_code: 'MAS1', first_name: 'A', personal_email: 'a@x.com' }],
      history: [{ employee_id: 'e1', sent: 1, last_sent: new Date('2026-10-09T10:00:00Z') }],
    });
    vi.mocked(fetchEsiPendingRows).mockResolvedValue([{ employee_id: 'e1', pan_ready: 0, aadhaar_ready: 0, photo_ready: 0, bank_passbook_url: null }] as any);
    const res = await sendPendencyReminders({
      kind: 'esi_docs', employeeIds: ['e1'], sentBy: null, trigger: 'scheduler', now: new Date('2026-10-10T10:00:00Z'),
    });
    expect(res[0]).toMatchObject({ status: 'skipped', reason: 'recently_reminded' });
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('skips when there is no deliverable address', async () => {
    mockDb({ contacts: [{ id: 'e1', employee_code: 'MAS1', first_name: 'A', personal_email: null, official_email: null, email: null }] });
    vi.mocked(fetchEsiPendingRows).mockResolvedValue([{ employee_id: 'e1', pan_ready: 0, aadhaar_ready: 1, photo_ready: 1, bank_passbook_url: '/x' }] as any);
    const res = await sendPendencyReminders({ kind: 'esi_docs', employeeIds: ['e1'], sentBy: null, trigger: 'manual' });
    expect(res[0]).toMatchObject({ status: 'skipped', reason: 'no_email' });
  });

  it('records a failed send as failed, not sent, so it does not count toward the cap', async () => {
    mockDb({ contacts: [{ id: 'e1', employee_code: 'MAS1', first_name: 'A', personal_email: 'a@x.com' }] });
    vi.mocked(fetchEsiPendingRows).mockResolvedValue([{ employee_id: 'e1', pan_ready: 0, aadhaar_ready: 1, photo_ready: 1, bank_passbook_url: '/x' }] as any);
    vi.mocked(emailService.send).mockRejectedValue(new Error('smtp down'));
    const res = await sendPendencyReminders({ kind: 'esi_docs', employeeIds: ['e1'], sentBy: null, trigger: 'manual' });
    expect(res[0]).toMatchObject({ status: 'failed', reason: 'smtp down' });
    const insert = exec.mock.calls.find((c) => String(c[0]).includes('INSERT INTO pendency_reminder_log'))!;
    expect(insert[1]).toEqual(expect.arrayContaining(['failed', 'smtp down']));
  });

  it('digilocker: reuses a valid onboarding link and skips an expired one', async () => {
    exec.mockImplementation(async (sql: any) => {
      const s = String(sql);
      if (s.includes('FROM ats_onboarding_bridge')) {
        return [[
          { employee_id: 'e1', onboarding_token: 'tok-1', token_valid: 1 },
          { employee_id: 'e2', onboarding_token: 'tok-2', token_valid: 0 },
        ], []] as any;
      }
      if (s.includes('FROM employees WHERE id IN')) {
        return [[
          { id: 'e1', employee_code: 'A', first_name: 'A', personal_email: 'a@x.com' },
          { id: 'e2', employee_code: 'B', first_name: 'B', personal_email: 'b@x.com' },
        ], []] as any;
      }
      return [[], []] as any;
    });
    vi.mocked(emailService.send).mockResolvedValue({} as any);
    const res = await sendPendencyReminders({ kind: 'digilocker', employeeIds: ['e1', 'e2'], sentBy: null, trigger: 'manual' });
    expect(res.map((r) => [r.employee_id, r.status, r.reason])).toEqual([
      ['e1', 'sent', undefined],
      ['e2', 'skipped', 'no_valid_link'],
    ]);
    expect((vi.mocked(emailService.send).mock.calls[0][0] as any).html).toContain('https://hrms.example.com/onboard-full?token=tok-1');
  });

  describe('shared ledger with Ops Control Tower WhatsApp nudges', () => {
    const contact = { id: 'e1', employee_code: 'MAS1', first_name: 'Asha', email: null, official_email: null, personal_email: 'asha@x.com' };

    it('a WhatsApp nudge in the last 3 days restarts the gap: no email, and it is not counted toward the cap', async () => {
      exec.mockImplementation(async (sql: any) => {
        const s = String(sql);
        if (s.includes('FROM employees WHERE id IN')) return [[contact], []] as any;
        if (s.includes('FROM ats_onboarding_bridge')) return [[{ employee_id: 'e1', onboarding_token: 't', token_valid: 1 }], []] as any;
        if (s.includes('FROM ops_nudge_log')) return [[{ employee_id: 'e1', last_sent: new Date(Date.now() - 3600_000).toISOString() }], []] as any;
        return [[], []] as any;
      });
      vi.mocked(emailService.send).mockResolvedValue({} as any);
      const res = await sendPendencyReminders({ kind: 'digilocker', employeeIds: ['e1'], sentBy: null, trigger: 'scheduler' });
      expect(emailService.send).not.toHaveBeenCalled();
      expect(res[0]).toMatchObject({ status: 'skipped', reason: 'recently_reminded' });
    });

    it('esi_docs has no WhatsApp counterpart and never reads ops_nudge_log', async () => {
      mockDb({ contacts: [contact] });
      vi.mocked(fetchEsiPendingRows).mockResolvedValue([{ employee_id: 'e1', pan_ready: 1, aadhaar_ready: 1, photo_ready: 0, bank_passbook_url: null }] as any);
      vi.mocked(emailService.send).mockResolvedValue({} as any);
      await sendPendencyReminders({ kind: 'esi_docs', employeeIds: ['e1'], sentBy: null, trigger: 'scheduler' });
      expect(exec.mock.calls.some((c) => String(c[0]).includes('ops_nudge_log'))).toBe(false);
    });
  });
});
