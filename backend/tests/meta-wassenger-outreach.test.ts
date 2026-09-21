/**
 * Wassenger media send / inbound media, and the "closed batch requisition" outreach gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => {
  const post = vi.fn();
  return {
    default: { post, isAxiosError: () => false },
    isAxiosError: () => false,
  };
});

import axios from 'axios';
import { db } from '../src/db/mysql.js';
import { parseWassengerWebhook, sendMediaMessage } from '../src/modules/meta-campaign/wassenger.provider.js';
import { notifyQualifiedLead } from '../src/modules/meta-campaign/lead-outreach.service.js';

const post = axios.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.WASSENGER_API_TOKEN = 'test-token';
  process.env.WASSENGER_DEVICE_ID = 'test-device';
  post.mockReset();
});

describe('sendMediaMessage', () => {
  it('uploads the file to /files first and sends the returned id, not inline base64', async () => {
    post
      .mockResolvedValueOnce({ data: [{ id: 'file-123' }] }) // POST /files
      .mockResolvedValueOnce({ data: { id: 'msg-9' } }); // POST /messages

    const res = await sendMediaMessage('9876543210', {
      base64: Buffer.from('%PDF-1.4').toString('base64'),
      mimeType: 'application/pdf',
      filename: 'offer.pdf',
      caption: 'Your offer',
    });

    expect(res).toEqual({ success: true, messageId: 'msg-9' });
    expect(String(post.mock.calls[0][0])).toMatch(/\/files$/);
    const [, body] = post.mock.calls[1];
    expect(body.media).toEqual({ file: 'file-123' });
    expect(body.phone).toBe('919876543210');
    expect(JSON.stringify(body)).not.toContain('"data"');
  });

  it('reports a failed upload instead of sending an empty message', async () => {
    post.mockResolvedValueOnce({ data: [] });
    const res = await sendMediaMessage('9876543210', { base64: 'AAAA', filename: 'x.pdf' });
    expect(res.success).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('parseWassengerWebhook inbound media', () => {
  it('records an image with its caption instead of dropping it', () => {
    const r = parseWassengerWebhook({
      event: 'message:in:new',
      data: { id: 'm1', phone: '+919876543210', type: 'image', body: 'my CV' },
    });
    expect(r.isIncoming).toBe(true);
    expect(r.rawBody).toBe('📎 [image] my CV');
    expect(r.reply).toBe('unknown');
  });

  it('records a document with no caption', () => {
    const r = parseWassengerWebhook({
      event: 'message:in:new',
      data: { id: 'm2', phone: '+919876543210', type: 'document' },
    });
    expect(r.rawBody).toBe('📎 [document]');
  });

  it('still ignores outbound and unrelated event types', () => {
    expect(parseWassengerWebhook({ event: 'message:in:new', data: { fromMe: true, type: 'chat', phone: '1' } }).isIncoming).toBe(false);
    expect(parseWassengerWebhook({ event: 'message:in:new', data: { type: 'location', phone: '1' } }).isIncoming).toBe(false);
  });
});

describe('notifyQualifiedLead refuses a closed or filled batch', () => {
  const leadRow = (over: Record<string, unknown>) => ({
    id: 'lead-1',
    parsed_name: 'Asha',
    parsed_phone: '9876543210',
    parsed_email: null,
    screening_result: 'qualified',
    notification_sent_at: null,
    designation_name: 'Agent',
    branch_name: 'Noida',
    requisition_code: 'REQ-1',
    bmi_assessment_url: null,
    salary_min: null,
    salary_max: null,
    approval_status: 'approved',
    active_status: 1,
    closed_at: null,
    requested_headcount: 10,
    fulfilled_headcount: 2,
    branch_address: null,
    branch_city: null,
    branch_lat: null,
    branch_lng: null,
    ...over,
  });

  it('sends nothing when every seat is filled, even with force', async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[leadRow({ fulfilled_headcount: 10 })], []]);
    const out = await notifyQualifiedLead('lead-1', { force: true });
    expect(out.attempted).toEqual([]);
    expect(out.skipped[0]?.reason).toMatch(/filled/);
  });

  it('sends nothing for a cancelled requisition', async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[leadRow({ approval_status: 'cancelled' })], []]);
    const out = await notifyQualifiedLead('lead-1');
    expect(out.attempted).toEqual([]);
    expect(out.skipped[0]?.reason).toMatch(/cancelled/);
  });
});
