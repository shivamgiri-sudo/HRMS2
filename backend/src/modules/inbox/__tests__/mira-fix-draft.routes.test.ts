import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  generateFixDraftForWorkItem: vi.fn(),
  listFixDraftsForWorkItem: vi.fn(),
}));

vi.mock('../../ai/mira-fix-draft-generate.service.js', () => ({
  generateFixDraftForWorkItem: mocks.generateFixDraftForWorkItem,
}));
vi.mock('../../ai/mira-fix-draft.service.js', () => ({
  listFixDraftsForWorkItem: mocks.listFixDraftsForWorkItem,
}));

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ success: false, message: 'Unauthenticated' });
    (req as express.Request & { authUser: { id: string; role: string } }).authUser = {
      id: 'test-user-id',
      role: header === 'Bearer super-admin' ? 'super_admin' : 'employee',
    };
    next();
  },
}));

vi.mock('../../../middleware/requireRole.js', () => ({
  // Minimal, deterministic stand-in: this suite only exercises the super_admin gate on
  // these two routes, not requireRole's own DB-driven role resolution (covered elsewhere).
  requireRole: (...allowed: string[]) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = (req as express.Request & { authUser?: { role?: string } }).authUser?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  },
}));

// The router pulls in inbox.service.js too (for the other routes it exports) — stub it so
// this suite only depends on what it actually exercises.
vi.mock('../inbox.service.js', () => ({
  inboxService: {},
  getMyPending: vi.fn(),
  getTimeline: vi.fn(),
}));

describe('mira-fix-draft routes — super_admin gated', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { inboxRouter } = await import('../inbox.routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/inbox', inboxRouter);
  });

  describe('GET /mira-fix-draft/:workItemId', () => {
    it('rejects without auth', async () => {
      const res = await request(app).get('/api/inbox/mira-fix-draft/wi-1');
      expect(res.status).toBe(401);
    });

    it('rejects a non-super_admin caller', async () => {
      const res = await request(app)
        .get('/api/inbox/mira-fix-draft/wi-1')
        .set('Authorization', 'Bearer employee');
      expect(res.status).toBe(403);
      expect(mocks.listFixDraftsForWorkItem).not.toHaveBeenCalled();
    });

    it('returns drafts for a super_admin caller', async () => {
      mocks.listFixDraftsForWorkItem.mockResolvedValueOnce([{ id: 'd-1', status: 'drafted' }]);
      const res = await request(app)
        .get('/api/inbox/mira-fix-draft/wi-1')
        .set('Authorization', 'Bearer super-admin');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, drafts: [{ id: 'd-1', status: 'drafted' }] });
      expect(mocks.listFixDraftsForWorkItem).toHaveBeenCalledWith('wi-1');
    });
  });

  describe('POST /mira-fix-draft/:workItemId/generate', () => {
    it('rejects without auth, and never calls the generator', async () => {
      const res = await request(app).post('/api/inbox/mira-fix-draft/wi-1/generate');
      expect(res.status).toBe(401);
      expect(mocks.generateFixDraftForWorkItem).not.toHaveBeenCalled();
    });

    it('rejects a non-super_admin caller, and never calls the generator', async () => {
      const res = await request(app)
        .post('/api/inbox/mira-fix-draft/wi-1/generate')
        .set('Authorization', 'Bearer employee');
      expect(res.status).toBe(403);
      expect(mocks.generateFixDraftForWorkItem).not.toHaveBeenCalled();
    });

    it('returns a 200 with the outcome even when the model declines — that is a normal result, not an error', async () => {
      mocks.generateFixDraftForWorkItem.mockResolvedValueOnce({ status: 'model_declined', reason: 'requires payroll changes' });
      const res = await request(app)
        .post('/api/inbox/mira-fix-draft/wi-1/generate')
        .set('Authorization', 'Bearer super-admin');
      expect(res.status).toBe(200);
      expect(res.body.outcome.status).toBe('model_declined');
      expect(mocks.generateFixDraftForWorkItem).toHaveBeenCalledWith('wi-1');
    });

    it('returns a 200 with the outcome on a successful draft', async () => {
      mocks.generateFixDraftForWorkItem.mockResolvedValueOnce({
        status: 'drafted',
        draft: { id: 'd-2', status: 'drafted' },
      });
      const res = await request(app)
        .post('/api/inbox/mira-fix-draft/wi-2/generate')
        .set('Authorization', 'Bearer super-admin');
      expect(res.status).toBe(200);
      expect(res.body.outcome).toEqual({ status: 'drafted', draft: { id: 'd-2', status: 'drafted' } });
    });
  });
});
