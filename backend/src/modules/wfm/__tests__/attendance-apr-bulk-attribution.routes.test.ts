import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * attendance-apr-bulk.routes.ts, phase 3: the evidence write into `apr` is ATTRIBUTED
 * (requirements.md criterion 17.10).
 *
 * The defect this proves closed: that write filed every row under the hardcoded string
 * 'MANUAL_UPLOAD' with upload_batch_id left NULL - the path that produced 3,810 production rows
 * with no owning Dialler_Source, no upload batch and empty process_name / branch_name.
 *
 * Four properties, in the order they matter:
 *  1. Every apr row the route writes carries a campaign owned by a registered Dialler_Source (not
 *     the sentinel) and a non-null upload_batch_id naming a productivity_upload_batch row that was
 *     actually created.
 *  2. When attribution cannot be established - the source/campaign resolve fails, or the batch row
 *     cannot be written, or the employee has no branch/process to attribute a batch to - the route
 *     degrades to per-row errors and writes NOTHING to apr. It never falls back to an unattributed
 *     row, which is the one behaviour the criterion forbids and migration 1640's trigger rejects.
 *  3. The response fields AprBulkUpload.tsx reads (success, uploaded, skipped_locked, errors[]) are
 *     unchanged, and the attendance_daily_record write and its protections are untouched.
 *  4. The pre-existing lock/skip behaviour still holds.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

let actor: { id: string; role: string; roles: string[] };
vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = actor;
    next();
  },
}));

// requireRole is NOT mocked - the real role gate runs, same as the sibling contract test for this
// route, so a change to its role list cannot pass unnoticed here.
import { attendanceAprBulkRouter } from '../attendance-apr-bulk.routes.js';
import { APR_BULK_CAMPAIGN_CODE, APR_BULK_SOURCE_KEY } from '../attendance-apr-bulk-attribution.service.js';

function appFor(role: string) {
  actor = { id: 'user-1', role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use('/api/wfm/attendance', attendanceAprBulkRouter);
  return app;
}

const EMP_A = {
  employee_id: 'emp-a', employee_code: 'E001',
  dept_name: 'operations', designation_name: 'executive',
  branch_id: 'branch-1', process_id: 'process-1',
};
const EMP_B = {
  employee_id: 'emp-b', employee_code: 'E002',
  dept_name: 'operations', designation_name: 'executive',
  branch_id: 'branch-2', process_id: 'process-2',
};

interface StubOptions {
  employees?: Array<Record<string, unknown>>;
  locked?: Array<Record<string, unknown>>;
  sourceMissing?: boolean;
  batchInsertThrows?: boolean;
  batchFinaliseThrows?: boolean;
}

/**
 * Answers the route's queries by shape, the same way the existing
 * src/__tests__/attendance-apr-bulk.routes.contract.test.ts stub does. The dialler_source and
 * campaign_master reads answer as "already registered", so the happy path is one where the
 * resolve-or-create found existing rows - the state every upload after the first is in.
 */
function stub(opts: StubOptions = {}) {
  execute.mockReset();
  execute.mockImplementation(async (sql: string, _params: unknown[] = []) => {
    if (/FROM employees e/.test(sql)) return [opts.employees ?? [EMP_A], []];
    if (/FROM attendance_daily_record adr/.test(sql) && /LEFT JOIN attendance_regularization/.test(sql)) {
      return [opts.locked ?? [], []];
    }
    if (/FROM apr\s+WHERE \(UserID, ReportDate\)/.test(sql)) return [[], []];
    if (/attendance_feature_config/i.test(sql)) return [[], []];
    if (/FROM dialler_source WHERE source_key/.test(sql)) {
      return [opts.sourceMissing ? [] : [{ id: 'ds-apr-bulk' }], []];
    }
    if (/FROM campaign_master WHERE campaign_code/.test(sql)) return [[{ id: 'camp-apr-bulk' }], []];
    if (/INSERT INTO attendance_daily_record/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/INSERT INTO productivity_upload_batch/.test(sql)) {
      if (opts.batchInsertThrows) throw new Error('ER_NO_SUCH_TABLE: productivity_upload_batch');
      return [{ affectedRows: 1 }, []];
    }
    if (/UPDATE productivity_upload_batch/.test(sql)) {
      if (opts.batchFinaliseThrows) throw new Error('Lock wait timeout exceeded');
      return [{ affectedRows: 1 }, []];
    }
    if (/INSERT INTO apr /.test(sql)) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
}

function csvOf(rows: Array<{ code: string; date: string; mins: number }>): string {
  return [
    'employee_code,attendance_date,net_login_minutes',
    ...rows.map(r => `${r.code},${r.date},${r.mins}`),
  ].join('\n');
}

function post(csv: string, role = 'wfm') {
  return request(appFor(role))
    .post('/api/wfm/attendance/apr-bulk-upload')
    .attach('file', Buffer.from(csv), 'apr.csv');
}

const callsFor = (pattern: RegExp) => execute.mock.calls.filter(([sql]) => pattern.test(String(sql)));

beforeEach(() => {
  stub();
});

describe('the evidence write is attributed', () => {
  it('files the apr row under the registered campaign, never the MANUAL_UPLOAD sentinel', async () => {
    const res = await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    expect(res.status).toBe(200);
    expect(res.body.evidence_recorded).toBe(1);

    const aprCalls = callsFor(/INSERT INTO apr /);
    expect(aprCalls.length).toBe(1);
    const [sql, params] = aprCalls[0]!;
    expect(sql).toMatch(/upload_batch_id/);
    expect(params).toContain(APR_BULK_CAMPAIGN_CODE);
    expect(params).not.toContain('MANUAL_UPLOAD');
  });

  it('carries a non-null upload_batch_id naming a batch row it actually created', async () => {
    const res = await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    const batchInserts = callsFor(/INSERT INTO productivity_upload_batch/);
    expect(batchInserts.length).toBe(1);
    const createdBatchId = String(batchInserts[0]![1]![0]);
    expect(res.body.evidence_batch_ids).toEqual([createdBatchId]);

    const [, aprParams] = callsFor(/INSERT INTO apr /)[0]!;
    // Last bound param of the single row's VALUES group.
    expect(aprParams[aprParams.length - 1]).toBe(createdBatchId);
    expect(aprParams[aprParams.length - 1]).toBeTruthy();
  });

  it('writes the batch row before the apr rows that reference it, and finalises its counts', async () => {
    await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    const order = execute.mock.calls.map(([sql]) => String(sql));
    const batchAt = order.findIndex(s => /INSERT INTO productivity_upload_batch/.test(s));
    const aprAt = order.findIndex(s => /INSERT INTO apr /.test(s));
    expect(batchAt).toBeGreaterThan(-1);
    expect(batchAt).toBeLessThan(aprAt);

    const finalise = callsFor(/UPDATE productivity_upload_batch/);
    expect(finalise.length).toBe(1);
    // accepted 1, rejected 0, status accepted (criterion 17.11 on the batch's own scope).
    expect(finalise[0]![1]).toEqual([1, 0, 'accepted', expect.any(String)]);
  });

  it('registers the Dialler_Source on first use, idempotently, when none exists yet', async () => {
    stub({ sourceMissing: true });

    const res = await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    // The re-select after the insert answers from the same "missing" branch, so the route must
    // report the failure rather than write an unattributed row.
    expect(res.body.evidence_recorded).toBe(0);
    const sourceInsert = callsFor(/INSERT INTO dialler_source/);
    expect(sourceInsert.length).toBe(1);
    expect(String(sourceInsert[0]![0])).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(sourceInsert[0]![1]).toContain(APR_BULK_SOURCE_KEY);
    expect(callsFor(/INSERT INTO apr /).length).toBe(0);
  });

  it('opens one batch per (branch, process), not one per file', async () => {
    stub({ employees: [EMP_A, EMP_B] });

    const res = await post(csvOf([
      { code: 'E001', date: '01-08-2026', mins: 500 },
      { code: 'E002', date: '02-08-2026', mins: 500 },
    ]));

    expect(res.body.uploaded).toBe(2);
    expect(res.body.evidence_recorded).toBe(2);
    expect(res.body.evidence_batch_ids).toHaveLength(2);

    const batchInserts = callsFor(/INSERT INTO productivity_upload_batch/);
    expect(batchInserts.length).toBe(2);
    const branchIds = batchInserts.map(([, p]) => p![3]);
    expect(branchIds.sort()).toEqual(['branch-1', 'branch-2']);
    // Every column of the batch row is true of the rows pointing at it: the branch's own process
    // and the group's own single date, not the file's span.
    expect(batchInserts.map(([, p]) => p![4]).sort()).toEqual(['process-1', 'process-2']);
  });
});

describe('attribution cannot be established: per-row errors, never an unattributed write', () => {
  it('reports every row and writes no apr row when the batch record cannot be created', async () => {
    stub({ batchInsertThrows: true });

    const res = await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The attendance write already committed is never rolled back by an evidence failure.
    expect(res.body.uploaded).toBe(1);
    expect(res.body.evidence_recorded).toBe(0);
    expect(res.body.evidence_batch_ids).toEqual([]);
    expect(callsFor(/INSERT INTO apr /).length).toBe(0);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 2,
          employee_code: 'E001',
          reason: expect.stringMatching(/unattributed evidence row is no longer written/i),
        }),
      ]),
    );
  });

  it('reports the row and writes no apr row when the employee has no branch or process', async () => {
    stub({ employees: [{ ...EMP_A, branch_id: null, process_id: null }] });

    const res = await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    expect(res.body.uploaded).toBe(1);
    expect(res.body.evidence_recorded).toBe(0);
    expect(callsFor(/INSERT INTO productivity_upload_batch/).length).toBe(0);
    expect(callsFor(/INSERT INTO apr /).length).toBe(0);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringMatching(/no branch and\/or no process mapping/i) }),
      ]),
    );
  });

  it('treats a finalise failure as an audit warning, not a row failure - the rows did land', async () => {
    stub({ batchFinaliseThrows: true });

    const res = await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    expect(res.body.evidence_recorded).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(res.body.evidence_warnings).toEqual([
      expect.stringMatching(/still marked pending/i),
    ]);
  });
});

describe('nothing the UI or the earlier phases depended on has changed', () => {
  it('returns the response fields AprBulkUpload.tsx reads, with the same meanings', async () => {
    const res = await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    expect(res.body).toMatchObject({ success: true, uploaded: 1, skipped_locked: 0 });
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors).toEqual([]);
  });

  it('still writes attendance_daily_record with is_locked = 1 and the override precedence guard', async () => {
    await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    const [sql] = callsFor(/INSERT INTO attendance_daily_record/)[0]!;
    expect(String(sql)).toMatch(/is_locked\s*=\s*IF\(override_by IS NULL AND regularization_id IS NULL, 1,/);
  });

  it('still skips a protected day, counts it in skipped_locked, and writes no evidence for it', async () => {
    stub({
      locked: [{
        employee_id: 'emp-a', record_date: '2026-08-01', is_locked: 1,
        regularization_id: null, override_by: 'someone', approved_regularization_id: null,
      }],
    });

    const res = await post(csvOf([{ code: 'E001', date: '01-08-2026', mins: 500 }]));

    expect(res.body.uploaded).toBe(0);
    expect(res.body.skipped_locked).toBe(1);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'Manual attendance override already controls payroll attendance for this date' }),
      ]),
    );
    expect(callsFor(/INSERT INTO apr /).length).toBe(0);
    expect(callsFor(/INSERT INTO productivity_upload_batch/).length).toBe(0);
  });
});
