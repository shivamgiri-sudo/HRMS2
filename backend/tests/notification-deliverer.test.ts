/**
 * NotificationDeliverer — transport behaviour.
 *
 * The gateway owns policy; this owns the envelope. The cases below are the ones where a
 * plausible implementation quietly does the wrong thing: exposing an address book on a
 * broadcast, or turning a delivered message into a reported failure so it gets sent twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({
  db: { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]), query: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));
vi.mock('../src/modules/communication/email.service.js', () => ({
  emailService: { send: vi.fn().mockResolvedValue({ messageId: 'msg-1' }), isConfigured: () => true },
}));
vi.mock('../src/modules/communication/template.service.js', () => ({
  templateService: { renderTemplate: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../src/modules/inbox/inbox.service.js', () => ({
  inboxService: { createItem: vi.fn().mockResolvedValue(undefined) },
}));

import { notificationDeliverer } from '../src/modules/communication/notification.deliverer.js';
import { emailService } from '../src/modules/communication/email.service.js';
import { templateService } from '../src/modules/communication/template.service.js';
import { inboxService } from '../src/modules/inbox/inbox.service.js';
import { db } from '../src/db/mysql.js';
import type { ResolvedRecipient } from '../src/shared/recipient-resolver.types.js';

const person = (n: number, bucket: 'to' | 'cc' | 'bcc' = 'to'): ResolvedRecipient => ({
  bucket, employeeId: `emp-${n}`, userId: `usr-${n}`, employeeCode: `MAS${n}`,
  name: `Person ${n}`, email: `p${n}@teammas.in`, emailSource: 'official_email',
  branchId: 'br-1', processId: null, audience: 'internal', viaSelector: 'employee',
});

const resolution = (to: number, cc = 0, bcc = 0) => ({
  to: Array.from({ length: to }, (_, i) => person(i)),
  cc: Array.from({ length: cc }, (_, i) => person(100 + i, 'cc')),
  bcc: Array.from({ length: bcc }, (_, i) => person(200 + i, 'bcc')),
  dropped: [], truncated: false,
});

const call = (over: Partial<Parameters<typeof notificationDeliverer.deliver>[0]> = {}) =>
  notificationDeliverer.deliver({
    eventCode: 'leave_decision', templateKey: null, data: { leave_type: 'EL', days: 2 },
    resolution: resolution(1, 1), isCritical: false,
    entityType: 'leave_request', entityId: 'lr-1', ...over,
  });

const sent = () => (emailService.send as ReturnType<typeof vi.fn>).mock.calls[0][0];

beforeEach(() => vi.clearAllMocks());

describe('envelope construction', () => {
  it('sends ONE message rather than one per recipient', async () => {
    await call({ resolution: resolution(3, 2) });
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('puts every To recipient on the same message', async () => {
    await call({ resolution: resolution(3) });
    const to = sent().to as string;
    expect(to).toContain('p0@teammas.in');
    expect(to).toContain('p2@teammas.in');
  });

  it('keeps a small CC list visible', async () => {
    await call({ resolution: resolution(1, 3) });
    expect(sent().cc).toBeTruthy();
    expect(sent().bcc).toBeUndefined();
  });

  it('moves a large CC list to BCC so recipients are not exposed to each other', async () => {
    await call({ resolution: resolution(1, 9) });
    expect(sent().cc).toBeUndefined();
    expect(String(sent().bcc).split(',').length).toBe(9);
  });

  it('omits empty CC and BCC headers entirely', async () => {
    await call({ resolution: resolution(1) });
    expect(sent()).not.toHaveProperty('cc');
    expect(sent()).not.toHaveProperty('bcc');
  });
});

describe('templates', () => {
  it('uses the rendered template when one resolves', async () => {
    (templateService.renderTemplate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ html: '<p>Rendered</p>', subject: 'Real subject', text: 'Rendered' });
    await call({ templateKey: 'LEAVE_DECISION' });
    expect(sent().subject).toBe('Real subject');
    expect(sent().html).toBe('<p>Rendered</p>');
  });

  it('still sends when a named template is missing — a missing template must not suppress an escalation', async () => {
    (templateService.renderTemplate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await call({ templateKey: 'DOES_NOT_EXIST' });
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(sent().html).toContain('no template');
  });

  it('still sends when template rendering throws', async () => {
    (templateService.renderTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad handlebars'));
    await call({ templateKey: 'BROKEN' });
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });
});

describe('logging and mirroring never break delivery', () => {
  it('does not report failure when the dispatch_log insert fails', async () => {
    // The mail has already left. Reporting failure here would make the gateway mark the
    // claim failed and the next run would send it again.
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('log table gone'));
    await expect(call()).resolves.toHaveProperty('dispatchLogId');
  });

  it('does not report failure when the inbox mirror fails', async () => {
    (inboxService.createItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('inbox down'));
    await expect(call()).resolves.toBeTruthy();
  });

  it('propagates a real send failure so the gateway can mark the claim failed', async () => {
    (emailService.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('smtp refused'));
    await expect(call()).rejects.toThrow('smtp refused');
  });

  it('passes the entity through so the inbox mirror can dedupe', async () => {
    await call();
    const arg = (inboxService.createItem as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ type: 'leave_decision', entity_type: 'leave_request', entity_id: 'lr-1' });
  });
});
