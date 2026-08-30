import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import { requireAuth, requireWriteAccess } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import {
  getJoiningDocumentsTracker,
  sendBulkReminders,
  bulkGenerateChecklists,
  bulkAssignHR,
  bulkSetDueDate,
  bulkVerifyDocuments,
  streamBulkDocumentsZip,
  clampPage,
  clampLimit,
  type TrackerQueryParams,
} from './ats.joiningDocumentsTracker.service.js';
import { sendPayrollHrJoiningDocNotification } from './ats.email.service.js';

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
      // The clamps are the service's, not a copy of them. Re-deriving the bounds here
      // would put the row cap in two files, and the one that got missed on the next
      // change would be the one deciding how large a page a caller can ask for.
      //
      // The raw query value goes in unconverted on purpose: absent, empty string and
      // non-numeric all read as NaN or 0 through Number() and land on the defaults, so
      // there is no input shape that reaches the OFFSET arithmetic as NaN.
      page: clampPage(req.query.page),
      limit: clampLimit(req.query.limit),
    };

    const data = await getJoiningDocumentsTracker(req.authUser!.id, filters);

    return res.json({ success: true, data });
  } catch (error: unknown) {
    console.error('[tracker] GET /joining-documents-tracker error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch joining documents tracker' });
  }
}));

// POST /api/ats/joining-documents-tracker/bulk-remind
joiningDocumentsTrackerRouter.post('/bulk-remind', requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
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
joiningDocumentsTrackerRouter.post('/bulk-generate-checklist', requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
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
joiningDocumentsTrackerRouter.post('/bulk-assign', requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
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
joiningDocumentsTrackerRouter.post('/bulk-set-due-date', requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employee_ids, due_date, document_codes } = req.body as {
      employee_ids?: unknown;
      due_date?: string;
      document_codes?: string[];
    };

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'employee_ids array is required' });
    }

    if (!due_date || !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
      return res.status(400).json({ success: false, message: 'due_date must be in YYYY-MM-DD format' });
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
joiningDocumentsTrackerRouter.post('/bulk-verify', requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
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

// POST /api/ats/joining-documents-tracker/resend-notification
joiningDocumentsTrackerRouter.post('/resend-notification', requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id } = req.body as { employee_id?: string };
  if (!employee_id) {
    return res.status(400).json({ success: false, message: 'employee_id is required' });
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.branch_id,
            aob.candidate_id
       FROM employees e
       LEFT JOIN ats_onboarding_bridge aob ON aob.employee_id = e.id
      WHERE e.id = ? LIMIT 1`,
    [employee_id],
  );
  const emp = (empRows as RowDataPacket[])[0];
  if (!emp) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const [hrRows] = await db.execute<RowDataPacket[]>(
    `SELECT u.email, e2.full_name
       FROM auth_user u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN employees e2 ON e2.user_id = u.id AND e2.active_status = 1
      WHERE ur.role_key = 'payroll_hr'
        AND (? IS NULL OR e2.branch_id = ?)
      LIMIT 3`,
    [emp.branch_id, emp.branch_id],
  );

  if (!(hrRows as RowDataPacket[]).length) {
    return res.status(404).json({ success: false, message: 'No Payroll HR users found for this branch' });
  }

  let sent = 0;
  for (const hr of hrRows as RowDataPacket[]) {
    await sendPayrollHrJoiningDocNotification({
      to: hr.email,
      hrName: hr.full_name,
      employeeCode: emp.employee_code,
      employeeName: emp.full_name,
      joiningDocUrl: `${baseUrl}/employees/${emp.id}/joining-documents`,
      candidateId: emp.candidate_id ?? null,
    }).catch((err: unknown) => console.error('[tracker] resend-notification email failed:', err));
    sent++;
  }

  return res.json({ success: true, sent, message: `Notification resent to ${sent} Payroll HR user(s)` });
}));

// POST /api/ats/joining-documents-tracker/bulk-download
joiningDocumentsTrackerRouter.post('/bulk-download', requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employee_ids, document_codes } = req.body as {
      employee_ids?: unknown;
      document_codes?: string[];
    };

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'employee_ids array is required' });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="joining-documents-${timestamp}.zip"`);

    await streamBulkDocumentsZip(employee_ids as string[], document_codes ?? null, res, req.authUser!.id);

    return res;
  } catch (error: unknown) {
    console.error('[tracker] POST /bulk-download error:', error);
    if (!res.headersSent) {
      // Reset headers set for ZIP so res.json() can write application/json
      res.removeHeader('Content-Type');
      res.removeHeader('Content-Disposition');
      return res.status(500).json({ success: false, message: 'Failed to create ZIP file' });
    }
    // Headers already sent — streaming was in progress, can't send JSON
    return res;
  }
}));
