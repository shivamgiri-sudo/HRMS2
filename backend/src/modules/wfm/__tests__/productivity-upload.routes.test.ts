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

// GET /sources reads dialler_source directly, so the pool is stubbed. vi.hoisted, not a bare
// const: the factory below runs before this file's const initializers do.
const dbMocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: dbMocks.execute } }));

// Both gates are stubbed so the tests below can exercise the handler bodies — but they are stubbed
// with NAMED functions, and a test at the bottom of this file asserts they are actually present in
// the router's middleware stack. Without that, a typo like requireRole('wfm_uploader') or a
// deleted `router.use(requireAuth)` would pass every test in this file while leaving the endpoint
// wide open.
// Declared as hoisted function declarations, not consts: requireRole() is invoked while the route
// module is being imported (inside router.post(...)), which happens before any const initializer
// in this file has run.
function requireAuthStub(req: any, _res: any, next: any) {
  req.authUser = { id: 'user-1', role: 'wfm' };
  next();
}
function roleGateStub(_req: any, _res: any, next: any) { next(); }
// Every role list requireRole() was called with while the route module was imported, so the gate
// test below can prove /sources was gated on the SAME list as /preview and /commit rather than on
// a hand-rolled one that merely happens to be a list of roles. vi.hoisted because requireRoleStub
// runs during the route module's import, before any plain const in this file is initialised.
const gateCalls = vi.hoisted(() => ({ roleLists: [] as string[][] }));
function requireRoleStub(...roles: string[]) {
  gateCalls.roleLists.push(roles);
  return roleGateStub;
}
vi.mock('../../../middleware/authMiddleware.js', () => ({ requireAuth: requireAuthStub }));
vi.mock('../../../middleware/requireRole.js', () => ({ requireRole: requireRoleStub }));

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

describe('GET /api/wfm/productivity-upload/sources', () => {
  beforeEach(() => {
    dbMocks.execute.mockReset();
  });

  it('returns only active manual-upload sources, in the documented shape', async () => {
    dbMocks.execute.mockResolvedValueOnce([
      [
        {
          id: 'ds-1',
          source_key: 'VICIDIAL_MAIN',
          display_name: 'ViciDial Main',
          ingestion_mode: 'manual_upload',
          column_mappings: { 'Emp Code': 'employee_code', 'Report Date': 'report_date' },
          mapping_version: 3,
        },
      ],
      [],
    ]);

    const res = await request(buildApp()).get('/api/wfm/productivity-upload/sources');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      sources: [
        {
          diallerSourceId: 'ds-1',
          sourceCode: 'VICIDIAL_MAIN',
          displayName: 'ViciDial Main',
          sourceType: 'manual_upload',
          columnMappings: { 'Emp Code': 'employee_code', 'Report Date': 'report_date' },
          mappingVersion: 3,
        },
      ],
    });

    // The filtering is the whole security/correctness content of this endpoint, so it is asserted
    // on the query itself rather than inferred from a mocked row set that could not disagree.
    const [sql, params] = dbMocks.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('s.active_status = 1');
    expect(sql).toContain('s.ingestion_mode = ?');
    expect(params).toEqual(['manual_upload']);
  });

  it('reports a source with no mapping row as columnMappings:null and mappingVersion:null', async () => {
    dbMocks.execute.mockResolvedValueOnce([
      [
        {
          id: 'ds-2',
          source_key: 'NEW_SOURCE',
          display_name: 'Newly Registered Source',
          ingestion_mode: 'manual_upload',
          column_mappings: null,
          mapping_version: null,
        },
      ],
      [],
    ]);

    const res = await request(buildApp()).get('/api/wfm/productivity-upload/sources');

    expect(res.status).toBe(200);
    expect(res.body.sources[0].columnMappings).toBeNull();
    expect(res.body.sources[0].mappingVersion).toBeNull();
  });

  it('degrades a malformed mapping blob to columnMappings:null instead of failing the whole list', async () => {
    dbMocks.execute.mockResolvedValueOnce([
      [
        {
          id: 'ds-3',
          source_key: 'BROKEN_MAPPING',
          display_name: 'Source With Broken Mapping',
          ingestion_mode: 'manual_upload',
          column_mappings: '{"Emp Code": "employee_code"',
          mapping_version: 2,
        },
        {
          id: 'ds-4',
          source_key: 'GOOD_MAPPING',
          display_name: 'Source With Good Mapping',
          ingestion_mode: 'manual_upload',
          column_mappings: '{"Emp Code":"employee_code"}',
          mapping_version: 1,
        },
      ],
      [],
    ]);

    const res = await request(buildApp()).get('/api/wfm/productivity-upload/sources');

    expect(res.status).toBe(200);
    expect(res.body.sources[0].columnMappings).toBeNull();
    // A version alongside a null mapping would invite a commit labelled with a mapping the caller
    // never received.
    expect(res.body.sources[0].mappingVersion).toBeNull();
    // The bad row must not cost the good one.
    expect(res.body.sources[1].columnMappings).toEqual({ 'Emp Code': 'employee_code' });
    expect(res.body.sources[1].mappingVersion).toBe(1);
  });

  it('degrades a mapping blob that is valid JSON but not an object of strings to null', async () => {
    dbMocks.execute.mockResolvedValueOnce([
      [
        {
          id: 'ds-5', source_key: 'ARRAY_BLOB', display_name: 'Array Blob',
          ingestion_mode: 'manual_upload', column_mappings: '["employee_code"]', mapping_version: 1,
        },
        {
          id: 'ds-6', source_key: 'NUMERIC_TARGET', display_name: 'Numeric Target',
          ingestion_mode: 'manual_upload', column_mappings: { 'Emp Code': 7 }, mapping_version: 1,
        },
      ],
      [],
    ]);

    const res = await request(buildApp()).get('/api/wfm/productivity-upload/sources');

    expect(res.status).toBe(200);
    expect(res.body.sources[0].columnMappings).toBeNull();
    expect(res.body.sources[1].columnMappings).toBeNull();
  });

  it('answers a query failure without leaking driver error text', async () => {
    dbMocks.execute.mockRejectedValueOnce(
      Object.assign(new Error("Unknown column 's.source_key' in 'field list'"), { code: 'ER_BAD_FIELD_ERROR' }),
    );

    const res = await request(buildApp()).get('/api/wfm/productivity-upload/sources');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).not.toContain('ER_BAD_FIELD_ERROR');
    expect(res.body.message).not.toContain('Unknown column');
  });

  // Without this, a missing requireRole on /sources — or one gated on a different, wider list —
  // would pass every test above while exposing the shape of every productivity feed the business
  // runs to any authenticated user. The stubs are asserted to be in the real middleware stack
  // because the tests above stub them out to reach the handler bodies at all.
  it('sits behind the same auth and role gate as /preview and /commit', () => {
    const stack = (productivityUploadRouter as any).stack as any[];
    expect(stack.some((layer) => layer.handle === requireAuthStub)).toBe(true);

    const handlersFor = (path: string, method: string): unknown[] => {
      const layer = stack.find((l) => l.route?.path === path && l.route?.methods?.[method]);
      expect(layer, `no ${method.toUpperCase()} ${path} route registered`).toBeTruthy();
      return layer.route.stack.map((s: any) => s.handle);
    };

    expect(handlersFor('/sources', 'get')).toContain(roleGateStub);
    expect(handlersFor('/preview', 'post')).toContain(roleGateStub);
    expect(handlersFor('/commit', 'post')).toContain(roleGateStub);

    // Same gate function is not enough: it is handed out by a stubbed requireRole that ignores its
    // arguments. Every call must have named the identical role list, so /sources cannot be gated
    // on a list of its own that drifts from UPLOAD_ROLES.
    expect(gateCalls.roleLists.length).toBeGreaterThanOrEqual(3);
    const [firstList] = gateCalls.roleLists;
    expect(firstList!.length).toBeGreaterThan(0);
    for (const list of gateCalls.roleLists) {
      expect(list).toEqual(firstList);
    }
  });
});
