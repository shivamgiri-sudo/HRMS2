/**
 * Shortlist report endpoints: branch scoping, fail-closed, and export restricted to HR roles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { db } from '../src/db/mysql.js';
import { metaCampaignRouter } from '../src/modules/meta-campaign/meta-campaign.routes.js';
import { invalidateShortlistCache } from '../src/modules/meta-campaign/shortlist-report.service.js';

const app = express().use(express.json()).use('/api/meta', metaCampaignRouter);

let callerBranch: string | null = 'Noida';

const reqRow = (id: string, code: string, branch: string) => ({
  id, requisition_code: code, designation_name: 'Agent', branch_name: branch, process_name: 'Sales',
  meta_target_age_min: 18, meta_target_age_max: 35, education_requirement: null,
  experience_min_years: null, experience_max_years: null, meta_screening_config: null,
  approval_status: 'approved', active_status: 1, closed_at: null, requested_headcount: 10, fulfilled_headcount: 1,
});

const leadRow = (id: string, reqId: string | null, age: string) => ({
  id, requisition_id: reqId,
  raw_payload: JSON.stringify({ id: `m-${id}`, field_data: [{ name: 'full_name', values: [`Lead ${id}`] }, { name: 'age', values: [age] }] }),
  parsed_name: `Lead ${id}`, parsed_phone: '9876543210', screening_result: 'pending',
  notification_sent_at: null, created_at: '2026-09-01T10:00:00Z',
});

beforeEach(() => {
  callerBranch = 'Noida';
  invalidateShortlistCache();
  (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM employees e') && sql.includes('branch_master')) {
      return [callerBranch ? [{ branch_name: callerBranch }] : [], []];
    }
    if (sql.includes('FROM job_requisition') && sql.includes('requisition_code')) {
      return [[reqRow('r-noida', 'REQ-N', 'Noida'), reqRow('r-delhi', 'REQ-D', 'Delhi')], []];
    }
    if (sql.includes('FROM meta_lead_raw') && sql.includes('WHERE id > ?')) {
      return params[0] === '' ? [[leadRow('a', 'r-noida', '25'), leadRow('b', 'r-delhi', '25'), leadRow('c', 'r-noida', '16'), leadRow('d', null, '25')], []] : [[], []];
    }
    return [[], []];
  });
});

const auth = (role: string) => ({ Authorization: `Bearer mock-token-${role}` });

describe('GET /shortlist/summary', () => {
  it('shows an all-branch role every lead', async () => {
    const res = await request(app).get('/api/meta/shortlist/summary').set(auth('admin'));
    expect(res.status).toBe(200);
    expect(res.body.data.totalLeads).toBe(4);
    expect(res.body.data.proposed).toEqual({ qualified: 2, disqualified: 1, unmapped: 1, no_data: 0 });
  });

  it("limits a branch user to their own branch's requisitions", async () => {
    const res = await request(app).get('/api/meta/shortlist/summary').set(auth('recruiter'));
    expect(res.status).toBe(200);
    expect(res.body.data.totalLeads).toBe(2); // a and c; b is Delhi, d is unmapped
    expect(res.body.data.byRequisition.map((r: { requisitionId: string }) => r.requisitionId)).toEqual(['r-noida']);
  });

  it('shows nothing when the branch cannot be resolved', async () => {
    callerBranch = null;
    const res = await request(app).get('/api/meta/shortlist/summary').set(auth('recruiter'));
    expect(res.body.data.totalLeads).toBe(0);
  });
});

describe('GET /shortlist/leads', () => {
  it('filters by proposed result and pages', async () => {
    const res = await request(app).get('/api/meta/shortlist/leads?proposed=disqualified').set(auth('admin'));
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.rows[0].leadId).toBe('c');
    expect(res.body.data.rows[0].reason).toContain('below minimum 18');
  });

  it('cannot be widened by a branch user passing another branch in the query', async () => {
    const res = await request(app).get('/api/meta/shortlist/leads?branchName=Delhi').set(auth('recruiter'));
    expect(res.body.data.rows.every((r: { branch: string }) => r.branch === 'Noida')).toBe(true);
  });
});

describe('GET /shortlist/export.csv', () => {
  it('is refused for a read-only campaign role', async () => {
    const res = await request(app).get('/api/meta/shortlist/export.csv').set(auth('recruiter'));
    expect(res.status).toBe(403);
  });

  it('exports for HR with a BOM and one row per lead', async () => {
    const res = await request(app).get('/api/meta/shortlist/export.csv').set(auth('hr'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text.trim().split('\r\n')).toHaveLength(5);
  });
});
