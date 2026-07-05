import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getAssignedCandidates,
  getCandidateForInterview,
  submitInterviewResult,
  getInterviewHistory,
  getRecruiterPerformance,
  updateQueueStatus,
} from './interview.service.js';

export const interviewRouter = Router();

type AsyncHandler = (req: AuthenticatedRequest | Request, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest | Request, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

// All routes require authentication and recruiter/hr/admin role
interviewRouter.use(requireAuth);
interviewRouter.use(requireRole('admin', 'hr', 'recruiter'));

// ── 1. Get assigned candidates for logged-in recruiter ────────────────────────
interviewRouter.get('/assigned-candidates', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const recruiterId = req.authUser!.id;
    const candidates = await getAssignedCandidates(recruiterId);
    return res.json({ success: true, data: candidates });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 2. Get candidate details for interview ────────────────────────────────────
interviewRouter.get('/candidate/:candidateId', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { candidateId } = req.params;
    const recruiterId = req.authUser!.id;
    const candidate = await getCandidateForInterview(candidateId, recruiterId);
    return res.json({ success: true, data: candidate });
  } catch (error: unknown) {
    return res.status(404).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 3. Submit interview result ─────────────────────────────────────────────────
const interviewResultSchema = z.object({
  candidate_id: z.string().uuid(),
  interview_status: z.enum(['selected', 'rejected', 'hold', 'callback', 'no_show', 'walkout']),
  communication_rating: z.number().min(1).max(5).optional(),
  stability_rating: z.number().min(1).max(5).optional(),
  salary_fit: z.boolean().optional(),
  shift_fit: z.boolean().optional(),
  location_fit: z.boolean().optional(),
  role_fit: z.boolean().optional(),
  remarks: z.string().optional(),
  rejection_reason: z.string().optional(),
  next_step: z.string().optional(),
  documents_pending: z.boolean().optional(),
  joining_interest: z.boolean().optional(),
  expected_joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  recruiter_recommendation: z.string().optional(),
});

interviewRouter.post('/submit-result', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = interviewResultSchema.parse(req.body);

    const result = await submitInterviewResult({
      ...input,
      recruiter_id: req.authUser!.id,
    });

    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors,
      });
    }
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 4. Get interview history for a candidate ───────────────────────────────────
interviewRouter.get('/history/:candidateId', h(async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const history = await getInterviewHistory(candidateId);
    return res.json({ success: true, data: history });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 5. Get recruiter performance metrics ───────────────────────────────────────
interviewRouter.get('/performance', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const recruiterId = req.authUser!.id;
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };

    const performance = await getRecruiterPerformance(recruiterId, fromDate, toDate);

    return res.json({ success: true, data: performance });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 6. Update queue status (called/in_interview) ───────────────────────────────
const updateQueueStatusSchema = z.object({
  candidate_id: z.string().uuid(),
  status: z.enum(['called', 'in_interview']),
});

interviewRouter.post('/update-queue-status', h(async (req: Request, res: Response) => {
  try {
    const { candidate_id, status } = updateQueueStatusSchema.parse(req.body);

    const result = await updateQueueStatus(candidate_id, status);

    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors,
      });
    }
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));
