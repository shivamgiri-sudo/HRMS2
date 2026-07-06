import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { getJoiningDocumentsTracker, type TrackerQueryParams } from './ats.joiningDocumentsTracker.service.js';

export const joiningDocumentsTrackerRouter = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// All routes require authentication and specific roles
joiningDocumentsTrackerRouter.use(requireAuth);
joiningDocumentsTrackerRouter.use(requireRole('admin', 'super_admin', 'hr', 'payroll_hr', 'branch_head'));

// GET /api/ats/joining-documents-tracker
joiningDocumentsTrackerRouter.get('/', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filters: TrackerQueryParams = {
      branch_id: req.query.branch_id as string | undefined,
      process_id: req.query.process_id as string | undefined,
      status: req.query.status as string | undefined,
      completion_min: req.query.completion_min ? Number(req.query.completion_min) : undefined,
      completion_max: req.query.completion_max ? Number(req.query.completion_max) : undefined,
      document_code: req.query.document_code as string | undefined,
      overdue_only: req.query.overdue_only === 'true',
      updated_since: req.query.updated_since as string | undefined,
      search: req.query.search as string | undefined,
    };

    const data = await getJoiningDocumentsTracker(req.authUser!.id, filters);

    return res.json({ success: true, data });
  } catch (error: unknown) {
    console.error('[tracker] GET /joining-documents-tracker error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch joining documents tracker' });
  }
}));
