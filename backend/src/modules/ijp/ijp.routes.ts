/**
 * IJP Routes
 * API endpoints for Internal Job Posting module
 */

import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';
import * as ijpService from './ijp.service.js';
import type { IjpApplicationStatus } from './ijp.types.js';

const router = Router();
router.use(requireAuth);

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) =>
    fn(req, res).catch(next);

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createPostingSchema = z.object({
  job_title: z.string().min(3).max(200),
  description: z.string().max(5000).optional(),
  department_id: z.string().uuid().optional(),
  process_id: z.string().uuid().optional(),
  designation_id: z.string().uuid().optional(),
  branch_id: z.string().uuid().optional(),
  vacancies: z.number().int().min(1).max(100).optional(),
  min_tenure_months: z.number().int().min(0).max(240).optional(),
  eligible_employment_status: z.array(z.string()).optional(),
  eligible_department_ids: z.array(z.string().uuid()).optional(),
  eligible_process_ids: z.array(z.string().uuid()).optional(),
  excluded_process_ids: z.array(z.string().uuid()).optional(),
  eligible_designation_ids: z.array(z.string().uuid()).optional(),
  eligible_branch_ids: z.array(z.string().uuid()).optional(),
  min_performance_rating: z.number().min(0).max(5).optional(),
  require_manager_approval: z.boolean().optional(),
  closes_at: z.string().datetime().optional(),
}).strict();

const updatePostingSchema = createPostingSchema.partial().extend({
  status: z.enum(['draft', 'open', 'closed', 'filled', 'cancelled']).optional(),
  close_reason: z.string().max(200).optional(),
});

const applySchema = z.object({
  application_note: z.string().max(2000).optional(),
}).strict();

const updateStatusSchema = z.object({
  status: z.enum([
    'submitted', 'pending_manager', 'manager_approved', 'manager_rejected',
    'under_review', 'shortlisted', 'interview_scheduled', 'selected',
    'rejected', 'withdrawn', 'offer_extended', 'offer_accepted', 'offer_declined'
  ] as const),
  remarks: z.string().max(1000).optional(),
  interview_scheduled_at: z.string().datetime().optional(),
  offer_details: z.record(z.unknown()).optional(),
}).strict();

// ─── Admin Routes ───────────────────────────────────────────────────────────

// Create posting
router.post(
  '/postings',
  requireRole('super_admin', 'hr', 'hr_admin', 'recruitment_hr'),
  h(async (req, res) => {
    const input = createPostingSchema.parse(req.body);
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    const posting = await ijpService.createPosting(input, emp.id, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return res.status(201).json({ posting });
  })
);

// List all postings (admin view)
router.get(
  '/postings',
  requireRole('super_admin', 'hr', 'hr_admin', 'recruitment_hr', 'branch_head', 'process_manager', 'operations_manager'),
  h(async (req, res) => {
    const result = await ijpService.listPostings(req.authUser, {
      status: req.query.status as string,
      departmentId: req.query.department_id as string,
      processId: req.query.process_id as string,
      branchId: req.query.branch_id as string,
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    });

    return res.json(result);
  })
);

// Get posting detail
router.get(
  '/postings/:id',
  h(async (req, res) => {
    const posting = await ijpService.getPostingById(req.params.id);
    if (!posting) return res.status(404).json({ error: 'Posting not found' });

    return res.json({ posting });
  })
);

// Update posting
router.patch(
  '/postings/:id',
  requireRole('super_admin', 'hr', 'hr_admin', 'recruitment_hr'),
  h(async (req, res) => {
    const input = updatePostingSchema.parse(req.body);
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    const posting = await ijpService.updatePosting(req.params.id, input, emp.id, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    if (!posting) return res.status(404).json({ error: 'Posting not found' });

    return res.json({ posting });
  })
);

// Publish posting
router.post(
  '/postings/:id/publish',
  requireRole('super_admin', 'hr', 'hr_admin', 'recruitment_hr'),
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    const posting = await ijpService.publishPosting(req.params.id, emp.id, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    if (!posting) return res.status(404).json({ error: 'Posting not found' });

    return res.json({ posting, message: 'Posting is now open for applications' });
  })
);

// Close posting
router.post(
  '/postings/:id/close',
  requireRole('super_admin', 'hr', 'hr_admin', 'recruitment_hr'),
  h(async (req, res) => {
    const { reason, filled } = req.body;
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    const posting = await ijpService.closePosting(
      req.params.id,
      reason || 'Closed by HR',
      emp.id,
      { ipAddress: req.ip, userAgent: req.get('user-agent'), filled: Boolean(filled) }
    );
    if (!posting) return res.status(404).json({ error: 'Posting not found' });

    return res.json({ posting, message: 'Posting closed' });
  })
);

// List applications for a posting
router.get(
  '/postings/:id/applications',
  requireRole('super_admin', 'hr', 'hr_admin', 'recruitment_hr', 'branch_head', 'process_manager', 'operations_manager'),
  h(async (req, res) => {
    const result = await ijpService.listApplicationsForPosting(req.authUser, req.params.id, {
      status: req.query.status as string,
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    });

    return res.json(result);
  })
);

// Update application status (HR review)
router.patch(
  '/applications/:id/status',
  requireRole('super_admin', 'hr', 'hr_admin', 'recruitment_hr'),
  h(async (req, res) => {
    const input = updateStatusSchema.parse(req.body);
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    const application = await ijpService.updateApplicationStatus(
      req.params.id,
      input as { status: IjpApplicationStatus; remarks?: string; interview_scheduled_at?: string; offer_details?: Record<string, unknown> },
      emp.id,
      { ipAddress: req.ip, userAgent: req.get('user-agent') }
    );
    if (!application) return res.status(404).json({ error: 'Application not found' });

    return res.json({ application });
  })
);

// Get IJP dashboard stats
router.get(
  '/stats',
  requireRole('super_admin', 'hr', 'hr_admin', 'recruitment_hr'),
  h(async (_req, res) => {
    const stats = await ijpService.getIjpStats();
    return res.json({ stats });
  })
);

// ─── Employee Self-Service Routes ───────────────────────────────────────────

// List eligible IJPs for current employee
router.get(
  '/my/eligible',
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    const result = await ijpService.listEligiblePostings(emp.id);
    return res.json(result);
  })
);

// List my applications
router.get(
  '/my/applications',
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    const result = await ijpService.listMyApplications(emp.id, {
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    });
    return res.json(result);
  })
);

// Check eligibility for a posting
router.get(
  '/postings/:id/eligibility',
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    const eligibility = await ijpService.checkEligibility(emp.id, req.params.id);
    return res.json({ eligibility });
  })
);

// Apply to a posting
router.post(
  '/postings/:id/apply',
  h(async (req, res) => {
    const input = applySchema.parse(req.body);
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    try {
      const result = await ijpService.applyToPosting(req.params.id, emp.id, input, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.status(201).json(result);
    } catch (error: unknown) {
      const err = error as { code?: string; reasons?: string[]; applicationId?: string; status?: string };
      if (err.code === 'NOT_ELIGIBLE') {
        return res.status(400).json({ error: 'Not eligible', reasons: err.reasons });
      }
      if (err.code === 'ALREADY_APPLIED') {
        return res.status(409).json({
          error: 'Already applied',
          applicationId: err.applicationId,
          status: err.status,
        });
      }
      throw error;
    }
  })
);

// Withdraw application
router.delete(
  '/applications/:id',
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    try {
      const application = await ijpService.withdrawApplication(req.params.id, emp.id, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      if (!application) return res.status(404).json({ error: 'Application not found' });

      return res.json({ application, message: 'Application withdrawn' });
    } catch (error: unknown) {
      const err = error as { code?: string; status?: string };
      if (err.code === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Cannot withdraw another employee\'s application' });
      }
      if (err.code === 'INVALID_STATUS') {
        return res.status(400).json({ error: 'Cannot withdraw application in current status', status: err.status });
      }
      throw error;
    }
  })
);

// ─── Manager Approval Route ─────────────────────────────────────────────────

// Manager approve/reject application (for their direct reports)
router.patch(
  '/applications/:id/manager-action',
  h(async (req, res) => {
    const { action, remarks } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "approve" or "reject"' });
    }

    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: 'Employee record not found' });

    const application = await ijpService.getApplicationById(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.manager_id !== emp.id) {
      return res.status(403).json({ error: 'You are not the assigned manager for this application' });
    }
    if (application.status !== 'pending_manager') {
      return res.status(400).json({ error: 'Application is not pending manager approval' });
    }

    const status: IjpApplicationStatus = action === 'approve' ? 'manager_approved' : 'manager_rejected';
    const updated = await ijpService.updateApplicationStatus(
      req.params.id,
      { status, remarks },
      emp.id,
      { ipAddress: req.ip, userAgent: req.get('user-agent'), isManager: true }
    );

    return res.json({ application: updated });
  })
);

export default router;
