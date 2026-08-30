import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the service module before importing the router.
//
// Spread over the real module rather than replacing it wholesale: the route calls the
// service's own `clampPage` / `clampLimit` so the page bounds live in one place, and a
// bare factory would leave those two undefined and turn every GET into a 500 — which is
// a failure of the mock, not of the route. Only the DB-touching entry points are stubbed.
vi.mock('../ats.joiningDocumentsTracker.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ats.joiningDocumentsTracker.service.js')>()),
  getJoiningDocumentsTracker: vi.fn(),
  sendBulkReminders: vi.fn(),
  bulkGenerateChecklists: vi.fn(),
  bulkAssignHR: vi.fn(),
  bulkSetDueDate: vi.fn(),
  bulkVerifyDocuments: vi.fn(),
  streamBulkDocumentsZip: vi.fn(),
}));

// Mock the middleware modules
vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: 'test-user-id' };
    next();
  },
  requireWriteAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../../../middleware/requireRole.js', () => ({
  requireRole: (..._roles: string[]) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { getJoiningDocumentsTracker, sendBulkReminders, bulkGenerateChecklists, bulkAssignHR, bulkSetDueDate, bulkVerifyDocuments, streamBulkDocumentsZip, DEFAULT_PAGE, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../ats.joiningDocumentsTracker.service.js';

describe('GET /joining-documents-tracker', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to get a fresh router after mocks are set
    const { joiningDocumentsTrackerRouter } = await import('../ats.joiningDocumentsTracker.routes.js');
    app = express();
    app.use(express.json());
    app.use('/joining-documents-tracker', joiningDocumentsTrackerRouter);
  });

  it('should return 200 with tracker data on success', async () => {
    const mockResponse = {
      employees: [
        {
          id: 'emp-1',
          employee_code: 'EMP001',
          full_name: 'John Doe',
          branch_name: 'Mumbai',
          process_name: 'Sales',
          lob_name: null,
          date_of_joining: '2026-01-15',
          joining_document_status: 'in_progress',
          joining_document_completion_pct: 50,
          total_documents: 10,
          verified_count: 5,
          needs_correction_count: 0,
          overdue_count: 0,
          last_document_update: '2026-01-20',
          assigned_hr_name: null,
          key_documents: [],
        },
      ],
      summary: {
        total: 1,
        complete: 0,
        pending_verification: 0,
        in_progress: 1,
        not_started: 0,
        overdue: 0,
        needs_correction: 0,
      },
    };

    vi.mocked(getJoiningDocumentsTracker).mockResolvedValueOnce(mockResponse);

    const response = await request(app)
      .get('/joining-documents-tracker')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: mockResponse });
    expect(getJoiningDocumentsTracker).toHaveBeenCalledWith('test-user-id', expect.objectContaining({
      branch_id: undefined,
      process_id: undefined,
      overdue_only: false,
    }));
  });

  it('should pass query parameters to the service', async () => {
    vi.mocked(getJoiningDocumentsTracker).mockResolvedValueOnce({ employees: [], summary: { total: 0, complete: 0, pending_verification: 0, in_progress: 0, not_started: 0, overdue: 0, needs_correction: 0 } });

    await request(app)
      .get('/joining-documents-tracker?branch_id=br-1&process_id=pr-1&search=John&overdue_only=true&completion_min=25&completion_max=75')
      .set('Authorization', 'Bearer test-token');

    expect(getJoiningDocumentsTracker).toHaveBeenCalledWith('test-user-id', {
      branch_id: 'br-1',
      process_id: 'pr-1',
      status: undefined,
      completion_min: 25,
      completion_max: 75,
      document_code: undefined,
      overdue_only: true,
      updated_since: undefined,
      search: 'John',
      page: DEFAULT_PAGE,
      limit: DEFAULT_PAGE_LIMIT,
    });
  });

  // ─── Task 3.11: page / limit reach the service ──────────────────────────────

  it('should forward page and limit to the service', async () => {
    vi.mocked(getJoiningDocumentsTracker).mockResolvedValueOnce({ employees: [], summary: { total: 0, complete: 0, pending_verification: 0, in_progress: 0, not_started: 0, overdue: 0, needs_correction: 0 } });

    await request(app)
      .get('/joining-documents-tracker?page=3&limit=25')
      .set('Authorization', 'Bearer test-token');

    expect(getJoiningDocumentsTracker).toHaveBeenCalledWith('test-user-id', expect.objectContaining({
      page: 3,
      limit: 25,
    }));
  });

  // Table-driven because the interesting cases are all the same shape: a value the
  // frontend could plausibly send, and the effective page it must resolve to. Every
  // one of these used to be silently dropped; none of them may 500.
  const clampCases: Array<{ query: string; page: number; limit: number; why: string }> = [
    { query: '', page: DEFAULT_PAGE, limit: DEFAULT_PAGE_LIMIT, why: 'absent' },
    { query: '?page=&limit=', page: DEFAULT_PAGE, limit: DEFAULT_PAGE_LIMIT, why: 'empty string' },
    { query: '?page=abc&limit=xyz', page: DEFAULT_PAGE, limit: DEFAULT_PAGE_LIMIT, why: 'non-numeric' },
    { query: '?page=0&limit=0', page: DEFAULT_PAGE, limit: DEFAULT_PAGE_LIMIT, why: 'below the floor' },
    { query: '?page=-4&limit=-9', page: DEFAULT_PAGE, limit: DEFAULT_PAGE_LIMIT, why: 'negative' },
    { query: '?page=2.7&limit=25.9', page: 2, limit: 25, why: 'fractional' },
    { query: '?limit=100000', page: DEFAULT_PAGE, limit: MAX_PAGE_LIMIT, why: 'above the ceiling' },
  ];

  for (const { query, page, limit, why } of clampCases) {
    it(`should fall back to usable bounds for a ${why} page/limit`, async () => {
      vi.mocked(getJoiningDocumentsTracker).mockResolvedValueOnce({ employees: [], summary: { total: 0, complete: 0, pending_verification: 0, in_progress: 0, not_started: 0, overdue: 0, needs_correction: 0 } });

      const response = await request(app)
        .get(`/joining-documents-tracker${query}`)
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(getJoiningDocumentsTracker).toHaveBeenCalledWith('test-user-id', expect.objectContaining({ page, limit }));
    });
  }

  it('should pass the page echo, total and hasNext/hasPrev through to the client', async () => {
    const serviceResponse = {
      rows: [],
      total: 512,
      summary: { total: 512, completed_count: 1, in_progress_count: 2, pending_count: 3, overdue_count: 0, needs_correction: 0 },
      page: 2,
      limit: 50,
      hasNext: true,
      hasPrev: true,
    };
    vi.mocked(getJoiningDocumentsTracker).mockResolvedValueOnce(serviceResponse);

    const response = await request(app)
      .get('/joining-documents-tracker?page=2&limit=50')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: serviceResponse });
  });

  it('should treat overdue_only=false as false', async () => {
    vi.mocked(getJoiningDocumentsTracker).mockResolvedValueOnce({ employees: [], summary: { total: 0, complete: 0, pending_verification: 0, in_progress: 0, not_started: 0, overdue: 0, needs_correction: 0 } });

    await request(app)
      .get('/joining-documents-tracker?overdue_only=false')
      .set('Authorization', 'Bearer test-token');

    expect(getJoiningDocumentsTracker).toHaveBeenCalledWith('test-user-id', expect.objectContaining({
      overdue_only: false,
    }));
  });

  it('should return 500 when the service throws an error', async () => {
    vi.mocked(getJoiningDocumentsTracker).mockRejectedValueOnce(new Error('DB connection failed'));

    const response = await request(app)
      .get('/joining-documents-tracker')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: 'Failed to fetch joining documents tracker',
    });
  });
});

// ─── Task 4: Bulk Remind route tests ─────────────────────────────────────────

describe('POST /joining-documents-tracker/bulk-remind', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { joiningDocumentsTrackerRouter } = await import('../ats.joiningDocumentsTracker.routes.js');
    app = express();
    app.use(express.json());
    app.use('/joining-documents-tracker', joiningDocumentsTrackerRouter);
  });

  it('should return 400 when employee_ids is missing', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-remind')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should return 400 when employee_ids is empty array', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-remind')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: [] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should return 400 when employee_ids is not an array', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-remind')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: 'emp-1' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should call sendBulkReminders and return result on success', async () => {
    const mockResult = { success: true as const, sent: 2, failed: 0, errors: [] };
    vi.mocked(sendBulkReminders).mockResolvedValueOnce(mockResult);

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-remind')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1', 'emp-2'], custom_message: 'Please submit documents' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockResult);
    expect(sendBulkReminders).toHaveBeenCalledWith(['emp-1', 'emp-2'], 'Please submit documents', 'test-user-id');
  });

  it('should pass null custom_message when not provided', async () => {
    const mockResult = { success: true as const, sent: 1, failed: 0, errors: [] };
    vi.mocked(sendBulkReminders).mockResolvedValueOnce(mockResult);

    await request(app)
      .post('/joining-documents-tracker/bulk-remind')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'] });

    expect(sendBulkReminders).toHaveBeenCalledWith(['emp-1'], null, 'test-user-id');
  });

  it('should return 500 when service throws', async () => {
    vi.mocked(sendBulkReminders).mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-remind')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'] });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, message: 'Failed to send reminders' });
  });
});

// ─── Task 4: Bulk Generate Checklist route tests ──────────────────────────────

describe('POST /joining-documents-tracker/bulk-generate-checklist', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { joiningDocumentsTrackerRouter } = await import('../ats.joiningDocumentsTracker.routes.js');
    app = express();
    app.use(express.json());
    app.use('/joining-documents-tracker', joiningDocumentsTrackerRouter);
  });

  it('should return 400 when employee_ids is missing', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-generate-checklist')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should return 400 when employee_ids is empty array', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-generate-checklist')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: [] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should return 400 when employee_ids is not an array', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-generate-checklist')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: 'emp-1' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should call bulkGenerateChecklists and return result on success', async () => {
    const mockResult = { success: true as const, generated: 2, skipped: 1, errors: [] };
    vi.mocked(bulkGenerateChecklists).mockResolvedValueOnce(mockResult);

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-generate-checklist')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1', 'emp-2', 'emp-3'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockResult);
    expect(bulkGenerateChecklists).toHaveBeenCalledWith(['emp-1', 'emp-2', 'emp-3'], 'test-user-id');
  });

  it('should return 500 when service throws', async () => {
    vi.mocked(bulkGenerateChecklists).mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-generate-checklist')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'] });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, message: 'Failed to generate checklists' });
  });
});

// ─── Task 5: Bulk Assign HR route tests ──────────────────────────────────────

describe('POST /joining-documents-tracker/bulk-assign', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { joiningDocumentsTrackerRouter } = await import('../ats.joiningDocumentsTracker.routes.js');
    app = express();
    app.use(express.json());
    app.use('/joining-documents-tracker', joiningDocumentsTrackerRouter);
  });

  it('should return 400 when employee_ids is missing', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-assign')
      .set('Authorization', 'Bearer test-token')
      .send({ assigned_hr_user_id: 'hr-1' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should return 400 when assigned_hr_user_id is missing', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-assign')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'assigned_hr_user_id is required' });
  });

  it('should return 400 when employee_ids is empty array', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-assign')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: [], assigned_hr_user_id: 'hr-1' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should call bulkAssignHR and return result on success', async () => {
    const mockResult = { success: true as const, updated: 3 };
    vi.mocked(bulkAssignHR).mockResolvedValueOnce(mockResult);

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-assign')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1', 'emp-2'], assigned_hr_user_id: 'hr-user-42' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockResult);
    expect(bulkAssignHR).toHaveBeenCalledWith(['emp-1', 'emp-2'], 'hr-user-42', 'test-user-id');
  });

  it('should return 500 when service throws', async () => {
    vi.mocked(bulkAssignHR).mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-assign')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'], assigned_hr_user_id: 'hr-1' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, message: 'Failed to assign HR' });
  });
});

// ─── Task 5: Bulk Set Due Date route tests ────────────────────────────────────

describe('POST /joining-documents-tracker/bulk-set-due-date', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { joiningDocumentsTrackerRouter } = await import('../ats.joiningDocumentsTracker.routes.js');
    app = express();
    app.use(express.json());
    app.use('/joining-documents-tracker', joiningDocumentsTrackerRouter);
  });

  it('should return 400 when employee_ids is missing', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-set-due-date')
      .set('Authorization', 'Bearer test-token')
      .send({ due_date: '2026-08-01' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should return 400 when due_date is missing', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-set-due-date')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'due_date must be in YYYY-MM-DD format' });
  });

  it('should return 400 when due_date is not in YYYY-MM-DD format', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-set-due-date')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'], due_date: '01/08/2026' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'due_date must be in YYYY-MM-DD format' });
  });

  it('should call bulkSetDueDate with null document_codes when not provided', async () => {
    const mockResult = { success: true as const, updated: 5 };
    vi.mocked(bulkSetDueDate).mockResolvedValueOnce(mockResult);

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-set-due-date')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1', 'emp-2'], due_date: '2026-08-01' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockResult);
    expect(bulkSetDueDate).toHaveBeenCalledWith(['emp-1', 'emp-2'], '2026-08-01', null, 'test-user-id');
  });

  it('should pass document_codes when provided', async () => {
    const mockResult = { success: true as const, updated: 2 };
    vi.mocked(bulkSetDueDate).mockResolvedValueOnce(mockResult);

    await request(app)
      .post('/joining-documents-tracker/bulk-set-due-date')
      .set('Authorization', 'Bearer test-token')
      .send({
        employee_ids: ['emp-1'],
        due_date: '2026-08-15',
        document_codes: ['APPOINTMENT_LETTER', 'ID_PROOF'],
      });

    expect(bulkSetDueDate).toHaveBeenCalledWith(
      ['emp-1'],
      '2026-08-15',
      ['APPOINTMENT_LETTER', 'ID_PROOF'],
      'test-user-id'
    );
  });

  it('should return 500 when service throws', async () => {
    vi.mocked(bulkSetDueDate).mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-set-due-date')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'], due_date: '2026-08-01' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, message: 'Failed to set due dates' });
  });
});

// ─── Task 5: Bulk Verify route tests ─────────────────────────────────────────

describe('POST /joining-documents-tracker/bulk-verify', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { joiningDocumentsTrackerRouter } = await import('../ats.joiningDocumentsTracker.routes.js');
    app = express();
    app.use(express.json());
    app.use('/joining-documents-tracker', joiningDocumentsTrackerRouter);
  });

  it('should return 400 when employee_ids is missing', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-verify')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should return 400 when employee_ids is empty array', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-verify')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: [] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should call bulkVerifyDocuments and return result on success', async () => {
    const mockResult = { success: true as const, verified: 4, errors: [] };
    vi.mocked(bulkVerifyDocuments).mockResolvedValueOnce(mockResult);

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-verify')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1', 'emp-2'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockResult);
    expect(bulkVerifyDocuments).toHaveBeenCalledWith(['emp-1', 'emp-2'], 'test-user-id');
  });

  it('should return partial success with errors array when some employees fail', async () => {
    const mockResult = {
      success: true as const,
      verified: 2,
      errors: [{ employee_id: 'emp-3', employee_code: 'EMP003', error: 'Not found' }],
    };
    vi.mocked(bulkVerifyDocuments).mockResolvedValueOnce(mockResult);

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-verify')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1', 'emp-2', 'emp-3'] });

    expect(response.status).toBe(200);
    expect(response.body.errors).toHaveLength(1);
    expect(response.body.verified).toBe(2);
  });

  it('should return 500 when service throws', async () => {
    vi.mocked(bulkVerifyDocuments).mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-verify')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'] });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, message: 'Failed to verify documents' });
  });
});

// ─── Task 6: Bulk Download route tests ───────────────────────────────────────

describe('POST /joining-documents-tracker/bulk-download', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { joiningDocumentsTrackerRouter } = await import('../ats.joiningDocumentsTracker.routes.js');
    app = express();
    app.use(express.json());
    app.use('/joining-documents-tracker', joiningDocumentsTrackerRouter);
  });

  it('should return 400 when employee_ids is missing', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-download')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should return 400 when employee_ids is empty array', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-download')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: [] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should return 400 when employee_ids is not an array', async () => {
    const response = await request(app)
      .post('/joining-documents-tracker/bulk-download')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: 'emp-1' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'employee_ids array is required' });
  });

  it('should set correct Content-Type and Content-Disposition headers', async () => {
    // Mock must end the response; archiver normally does this via pipe
    vi.mocked(streamBulkDocumentsZip).mockImplementationOnce(async (_ids, _codes, res) => {
      res.end();
    });

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-download')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1', 'emp-2'] });

    expect(response.headers['content-type']).toMatch(/application\/zip/i);
    expect(response.headers['content-disposition']).toMatch(/attachment/i);
    expect(response.headers['content-disposition']).toMatch(/joining-documents-\d{4}-\d{2}-\d{2}\.zip/);
  });

  it('should call streamBulkDocumentsZip with employee_ids and null document_codes', async () => {
    vi.mocked(streamBulkDocumentsZip).mockImplementationOnce(async (_ids, _codes, res) => {
      res.end();
    });

    await request(app)
      .post('/joining-documents-tracker/bulk-download')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1', 'emp-2'] });

    expect(streamBulkDocumentsZip).toHaveBeenCalledWith(
      ['emp-1', 'emp-2'],
      null,
      expect.anything(),
      'test-user-id'
    );
  });

  it('should pass document_codes to streamBulkDocumentsZip when provided', async () => {
    vi.mocked(streamBulkDocumentsZip).mockImplementationOnce(async (_ids, _codes, res) => {
      res.end();
    });

    await request(app)
      .post('/joining-documents-tracker/bulk-download')
      .set('Authorization', 'Bearer test-token')
      .send({
        employee_ids: ['emp-1'],
        document_codes: ['APPOINTMENT_LETTER', 'ID_PROOF'],
      });

    expect(streamBulkDocumentsZip).toHaveBeenCalledWith(
      ['emp-1'],
      ['APPOINTMENT_LETTER', 'ID_PROOF'],
      expect.anything(),
      'test-user-id'
    );
  });

  it('should return 500 JSON when service throws before headers are sent', async () => {
    vi.mocked(streamBulkDocumentsZip).mockRejectedValueOnce(new Error('ZIP creation failed'));

    const response = await request(app)
      .post('/joining-documents-tracker/bulk-download')
      .set('Authorization', 'Bearer test-token')
      .send({ employee_ids: ['emp-1'] });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, message: 'Failed to create ZIP file' });
  });
});
