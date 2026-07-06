import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import {
  getJoiningDocumentsTracker,
  sendBulkReminders,
  bulkGenerateChecklists,
  bulkAssignHR,
  bulkSetDueDate,
  bulkVerifyDocuments,
  type TrackerQueryParams,
} from './ats.joiningDocumentsTracker.service.js';

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

// POST /api/ats/joining-documents-tracker/bulk-remind
joiningDocumentsTrackerRouter.post('/bulk-remind', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employee_ids, custom_message } = req.body as {
      employee_ids?: unknown;
      custom_message?: string;
    };

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'employee_ids array is required' });
    }

    const result = await sendBulkReminders(
      employee_ids as string[],
      custom_message ?? null,
      req.authUser!.id
    );

    return res.json(result);
  } catch (error: unknown) {
    console.error('[tracker] POST /bulk-remind error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send reminders' });
  }
}));

// POST /api/ats/joining-documents-tracker/bulk-generate-checklist
joiningDocumentsTrackerRouter.post('/bulk-generate-checklist', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employee_ids } = req.body as { employee_ids?: unknown };

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'employee_ids array is required' });
    }

    const result = await bulkGenerateChecklists(employee_ids as string[], req.authUser!.id);

    return res.json(result);
  } catch (error: unknown) {
    console.error('[tracker] POST /bulk-generate-checklist error:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate checklists' });
  }
}));

// POST /api/ats/joining-documents-tracker/bulk-assign
joiningDocumentsTrackerRouter.post('/bulk-assign', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employee_ids, assigned_hr_user_id } = req.body as {
      employee_ids?: unknown;
      assigned_hr_user_id?: string;
    };

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'employee_ids array is required' });
    }

    if (!assigned_hr_user_id) {
      return res.status(400).json({ success: false, message: 'assigned_hr_user_id is required' });
    }

    const result = await bulkAssignHR(employee_ids as string[], assigned_hr_user_id, req.authUser!.id);

    return res.json(result);
  } catch (error: unknown) {
    console.error('[tracker] POST /bulk-assign error:', error);
    return res.status(500).json({ success: false, message: 'Failed to assign HR' });
  }
}));

// POST /api/ats/joining-documents-tracker/bulk-set-due-date
joiningDocumentsTrackerRouter.post('/bulk-set-due-date', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employee_ids, due_date, document_codes } = req.body as {
      employee_ids?: unknown;
      due_date?: string;
      document_codes?: string[];
    };

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'employee_ids array is required' });
    }

    if (!due_date) {
      return res.status(400).json({ success: false, message: 'due_date is required' });
    }

    const result = await bulkSetDueDate(
      employee_ids as string[],
      due_date,
      document_codes ?? null,
      req.authUser!.id
    );

    return res.json(result);
  } catch (error: unknown) {
    console.error('[tracker] POST /bulk-set-due-date error:', error);
    return res.status(500).json({ success: false, message: 'Failed to set due dates' });
  }
}));

// POST /api/ats/joining-documents-tracker/bulk-verify
joiningDocumentsTrackerRouter.post('/bulk-verify', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employee_ids } = req.body as { employee_ids?: unknown };

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'employee_ids array is required' });
    }

    const result = await bulkVerifyDocuments(employee_ids as string[], req.authUser!.id);

    return res.json(result);
  } catch (error: unknown) {
    console.error('[tracker] POST /bulk-verify error:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify documents' });
  }
}));
