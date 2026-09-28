/**
 * META WhatsApp inbox — branch scoping, fail-closed behaviour and the shortlist-before-chat gate.
 *
 * Before this fix every per-lead call (thread, mark-read, reply, send-file) checked only the
 * caller's role, so a Branch HR holding any lead id could read or message another branch's
 * candidate, and a scoped user with no resolvable branch saw every branch in the list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/modules/meta-campaign/wassenger.provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/meta-campaign/wassenger.provider.js')>();
  return {
    ...actual,
    isWassengerConfigured: vi.fn(() => true),
    sendCustomMessage: vi.fn(async () => ({ success: true, messageId: 'wa-1' })),
  };
});

import { db } from '../src/db/mysql.js';
import { metaCampaignRouter } from '../src/modules/meta-campaign/meta-campaign.routes.js';
import { metaCampaignService } from '../src/modules/meta-campaign/meta-campaign.service.js';
import { sendCustomMessage } from '../src/modules/meta-campaign/wassenger.provider.js';

const app = express().use(express.json()).use('/api/meta', metaCampaignRouter);

/** lead id -> branch, screening result, number of inbound messages */
const LEADS: Record<string, { branch: string; screening: string; inbound: number }> = {
  'lead-noida': { branch: 'Noida', screening: 'qualified', inbound: 0 },
  'lead-delhi': { branch: 'Delhi', screening: 'qualified', inbound: 0 },
  'lead-rejected': { branch: 'Noida', screening: 'disqualified', inbound: 0 },
  'lead-rejected-wrote': { branch: 'Noida', screening: 'disqualified', inbound: 2 },
};

let callerBranch: string | null = 'Noida';
const executed: string[] = [];

function installDb() {
  (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string, params: unknown[] = []) => {
    executed.push(sql);
    if (sql.includes('FROM employees e') && sql.includes('branch_master')) {
      return [callerBranch ? [{ branch_name: callerBranch }] : [], []];
    }
    if (sql.includes('JOIN job_requisition jr') && sql.includes('jr.branch_name = ?') && sql.includes('SELECT 1')) {
      const lead = LEADS[String(params[0])];
      return [lead && lead.branch === params[1] ? [{ ok: 1 }] : [], []];
    }
    if (sql.includes('inbound_count')) {
      const lead = LEADS[String(params[0])];
      return [lead ? [{ screening_result: lead.screening, inbound_count: lead.inbound }] : [], []];
    }
    return [[], []];
  });
}

const auth = (role: string) => ({ Authorization: `Bearer mock-token-${role}` });

beforeEach(() => {
  executed.length = 0;
  callerBranch = 'Noida';
  vi.mocked(sendCustomMessage).mockClear();
  installDb();
  vi.spyOn(metaCampaignService, 'getLeadDetail').mockImplementation(
    async (id: string) => ({ id, parsedPhone: '9876543210', parsedName: 'Asha' }) as never
  );
});

describe('thread access is branch-scoped', () => {
  it("refuses another branch's thread and never reads its messages", async () => {
    const res = await request(app).get('/api/meta/leads/lead-delhi/messages').set(auth('recruiter'));
    expect(res.status).toBe(403);
    expect(executed.some((s) => s.includes('ORDER BY created_at ASC'))).toBe(false);
  });

  it("serves a thread from the caller's own branch", async () => {
    const res = await request(app).get('/api/meta/leads/lead-noida/messages').set(auth('recruiter'));
    expect(res.status).toBe(200);
  });

  it('lets an all-branch role open any branch', async () => {
    const res = await request(app).get('/api/meta/leads/lead-delhi/messages').set(auth('admin'));
    expect(res.status).toBe(200);
  });

  it("refuses mark-read on another branch's thread", async () => {
    const res = await request(app).patch('/api/meta/leads/lead-delhi/messages/read').set(auth('recruiter'));
    expect(res.status).toBe(403);
    expect(executed.some((s) => s.includes('SET read_at'))).toBe(false);
  });

  it("refuses the lead detail drawer for another branch's lead", async () => {
    const res = await request(app).get('/api/meta/leads/lead-delhi').set(auth('recruiter'));
    expect(res.status).toBe(403);
  });
});

describe('fail-closed when the branch cannot be resolved', () => {
  beforeEach(() => {
    callerBranch = null;
  });

  it('returns an empty inbox instead of every branch', async () => {
    const res = await request(app).get('/api/meta/inbox').set(auth('recruiter'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(executed.some((s) => s.includes('FROM meta_lead_raw ml') && s.includes('meta_lead_messages'))).toBe(false);
  });

  it('reports zero unread', async () => {
    const res = await request(app).get('/api/meta/inbox/unread-count').set(auth('recruiter'));
    expect(res.body.data.count).toBe(0);
  });

  it('refuses every thread', async () => {
    const res = await request(app).get('/api/meta/leads/lead-noida/messages').set(auth('recruiter'));
    expect(res.status).toBe(403);
  });
});

describe('reply requires shortlisting first', () => {
  it("sends to a shortlisted candidate in the caller's branch", async () => {
    const res = await request(app)
      .post('/api/meta/leads/lead-noida/reply')
      .set(auth('recruiter'))
      .send({ message: 'Hello' });
    expect(res.status).toBe(200);
    expect(sendCustomMessage).toHaveBeenCalledWith('9876543210', 'Hello');
    expect(executed.some((s) => s.includes('INSERT INTO meta_lead_messages'))).toBe(true);
  });

  it('refuses a candidate who was not shortlisted and has not written in', async () => {
    const res = await request(app)
      .post('/api/meta/leads/lead-rejected/reply')
      .set(auth('recruiter'))
      .send({ message: 'Hello' });
    expect(res.status).toBe(409);
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('lets HR answer a non-shortlisted candidate who wrote first', async () => {
    const res = await request(app)
      .post('/api/meta/leads/lead-rejected-wrote/reply')
      .set(auth('recruiter'))
      .send({ message: 'Hi' });
    expect(res.status).toBe(200);
  });

  it('refuses to reply into another branch and sends nothing', async () => {
    const res = await request(app)
      .post('/api/meta/leads/lead-delhi/reply')
      .set(auth('recruiter'))
      .send({ message: 'Hello' });
    expect(res.status).toBe(403);
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('refuses a file for a non-shortlisted candidate', async () => {
    const res = await request(app)
      .post('/api/meta/leads/lead-rejected/send-file')
      .set(auth('recruiter'))
      .attach('file', Buffer.from('%PDF-1.4'), 'offer.pdf');
    expect(res.status).toBe(409);
  });
});
