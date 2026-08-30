import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { DuplicateUploadBatchError } from '../productivity-upload-commit.service.js';

const buildUploadPreviewMock = vi.fn();
const commitUploadBatchMock = vi.fn();
vi.mock('../productivity-upload-preview.service.js', () => ({
  buildUploadPreview: (...args: unknown[]) => buildUploadPreviewMock(...args),
}));
// Only commitUploadBatch itself is mocked — DuplicateUploadBatchError is re-exported from the
// REAL module via importActual, so a test that does `new DuplicateUploadBatchError(...)` and the
// route's own `err instanceof DuplicateUploadBatchError` check refer to the exact same class. A
// locally redeclared lookalike class here would make `instanceof` silently false in the test
// while passing in production, hiding exactly the kind of drift a round-4 review flagged this
// error-mapping code for once already.
vi.mock('../productivity-upload-commit.service.js', async () => {
  const actual = await vi.importActual<typeof import('../productivity-upload-commit.service.js')>(
    '../productivity-upload-commit.service.js',
  );
  return {
    ...actual,
    commitUploadBatch: (...args: unknown[]) => commitUploadBatchMock(...args),
  };
});

const resolveUserBusinessScopeMock = vi.fn();
vi.mock('../../../shared/enterpriseScope.js', () => ({
  resolveUserBusinessScope: (...args: unknown[]) => resolveUserBusinessScopeMock(...args),
}));

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: 'user-1', role: 'wfm' };
    next();
  },
}));
vi.mock('../../../middleware/requireRole.js', () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import { productivityUploadRouter } from '../productivity-upload.routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wfm/productivity-upload', productivityUploadRouter);
  return app;
}

const CSV_CONTENT = 'Emp Code,Report Date,Login Minutes\nMAS1,2026-07-15,420\n';

describe('POST /api/wfm/productivity-upload/preview', () => {
  beforeEach(() => {
    buildUploadPreviewMock.mockReset();
    commitUploadBatchMock.mockReset();
    resolveUserBusinessScopeMock.mockReset();
  });

  it('rejects a branch outside the uploader\'s resolved scope (criterion 17.8)', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: false, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [{ branchId: 'branch-allowed' }],
    });

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/preview')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-outside-scope')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', JSON.stringify({ 'Emp Code': 'employee_code', 'Report Date': 'report_date', 'Login Minutes': 'login_minutes' }))
      .attach('file', Buffer.from(CSV_CONTENT), 'july.csv');

    expect(res.status).toBe(403);
    expect(buildUploadPreviewMock).not.toHaveBeenCalled();
  });

  it('previews a CSV within scope without committing anything', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: false, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [{ branchId: 'branch-1' }],
    });
    buildUploadPreviewMock.mockResolvedValueOnce({
      accepted: [{ rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 }],
      rejected: [],
    });

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/preview')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-1')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', JSON.stringify({ 'Emp Code': 'employee_code', 'Report Date': 'report_date', 'Login Minutes': 'login_minutes' }))
      .attach('file', Buffer.from(CSV_CONTENT), 'july.csv');

    expect(res.status).toBe(200);
    expect(res.body.accepted).toHaveLength(1);
    expect(commitUploadBatchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/wfm/productivity-upload/commit', () => {
  beforeEach(() => {
    buildUploadPreviewMock.mockReset();
    commitUploadBatchMock.mockReset();
    resolveUserBusinessScopeMock.mockReset();
  });

  it('commits a CSV within scope and returns the batch summary', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: true, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [],
    });
    buildUploadPreviewMock.mockResolvedValueOnce({
      accepted: [{ rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 }],
      rejected: [],
    });
    commitUploadBatchMock.mockResolvedValueOnce({
      batchId: 'batch-1', batchReference: 'batch-1', acceptedCount: 1, rejectedCount: 0, writeErrors: [],
    });

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/commit')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-1')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', JSON.stringify({ 'Emp Code': 'employee_code', 'Report Date': 'report_date', 'Login Minutes': 'login_minutes' }))
      .attach('file', Buffer.from(CSV_CONTENT), 'july.csv');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.batchId).toBe('batch-1');
    expect(commitUploadBatchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 207 with success:false when some rows failed to write, rather than a bare 200', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: true, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [],
    });
    buildUploadPreviewMock.mockResolvedValueOnce({
      accepted: [{ rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 }],
      rejected: [],
    });
    commitUploadBatchMock.mockResolvedValueOnce({
      batchId: 'batch-1', batchReference: 'batch-1', acceptedCount: 0, rejectedCount: 0,
      writeErrors: ['1 accepted row(s) (rows 2-2) failed to save: ER_LOCK_WAIT_TIMEOUT'],
    });

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/commit')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-1')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', JSON.stringify({ 'Emp Code': 'employee_code', 'Report Date': 'report_date', 'Login Minutes': 'login_minutes' }))
      .attach('file', Buffer.from(CSV_CONTENT), 'july.csv');

    expect(res.status).toBe(207);
    expect(res.body.success).toBe(false);
    expect(res.body.writeErrors).toHaveLength(1);
  });

  it('maps the duplicate-submission guard error to 409 with the actionable message, not a masked 500', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: true, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [],
    });
    buildUploadPreviewMock.mockResolvedValueOnce({
      accepted: [{ rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 }],
      rejected: [],
    });
    commitUploadBatchMock.mockRejectedValueOnce(
      new DuplicateUploadBatchError(
        'batch-existing',
        'A batch (batch-existing) already exists for this exact file and scope (dialler_source ds-1, ' +
        'branch branch-1, process process-1, 2026-07-01 to 2026-07-31). If this is a deliberate ' +
        're-upload, resubmit with supersedesBatchId set to batch-existing.',
      ),
    );

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/commit')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-1')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', JSON.stringify({ 'Emp Code': 'employee_code', 'Report Date': 'report_date', 'Login Minutes': 'login_minutes' }))
      .attach('file', Buffer.from(CSV_CONTENT), 'july.csv');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('supersedesBatchId set to batch-existing');
    expect(res.body.priorBatchId).toBe('batch-existing');
  });

  it('rejects a non-CSV file with a real status, not a masked 500', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: true, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [],
    });

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/commit')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-1')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', '{}')
      .attach('file', Buffer.from('not a csv'), 'report.xlsx');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('CSV');
  });
});
