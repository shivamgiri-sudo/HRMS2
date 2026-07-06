import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the service module before importing the router
vi.mock('../ats.joiningDocumentsTracker.service.js', () => ({
  getJoiningDocumentsTracker: vi.fn(),
}));

// Mock the middleware modules
vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: 'test-user-id' };
    next();
  },
}));

vi.mock('../../../middleware/requireRole.js', () => ({
  requireRole: (..._roles: string[]) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { getJoiningDocumentsTracker } from '../ats.joiningDocumentsTracker.service.js';

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
    });
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
