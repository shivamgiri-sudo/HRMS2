import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getDashboardMetrics,
  getSourceMetrics,
  getBranchMetrics,
  getRecruiterPerformance,
  getTimelineData,
  getStageDistribution,
  getRoleMetrics,
  getExperienceDistribution,
} from './command-centre.service.js';

export const commandCentreRouter = Router();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

// Accessible to all management/supervisory roles (view-only analytics)
commandCentreRouter.use(requireAuth);
commandCentreRouter.use(requireRole(
  'super_admin', 'admin', 'ceo',
  'hr', 'manager', 'process_manager', 'branch_head',
  'recruiter', 'tl', 'team_leader',
  'qa', 'wfm', 'trainer', 'payroll', 'finance',
  'assistant_manager'
));

// ── 1. Get dashboard metrics ──────────────────────────────────────────────────
commandCentreRouter.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const metrics = await getDashboardMetrics();
    return res.json({ success: true, data: metrics });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 2. Get source channel metrics ─────────────────────────────────────────────
commandCentreRouter.get('/sources', async (_req: Request, res: Response) => {
  try {
    const sources = await getSourceMetrics();
    return res.json({ success: true, data: sources });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 3. Get branch metrics ─────────────────────────────────────────────────────
commandCentreRouter.get('/branches', async (_req: Request, res: Response) => {
  try {
    const branches = await getBranchMetrics();
    return res.json({ success: true, data: branches });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 4. Get recruiter performance ──────────────────────────────────────────────
commandCentreRouter.get('/recruiters', async (req: Request, res: Response) => {
  try {
    const fromDate = req.query.from_date as string | undefined;
    const toDate = req.query.to_date as string | undefined;

    const performance = await getRecruiterPerformance(fromDate, toDate);
    return res.json({ success: true, data: performance });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 5. Get timeline data ──────────────────────────────────────────────────────
commandCentreRouter.get('/timeline', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const timeline = await getTimelineData(days);
    return res.json({ success: true, data: timeline });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 6. Get stage distribution ─────────────────────────────────────────────────
commandCentreRouter.get('/stages', async (_req: Request, res: Response) => {
  try {
    const stages = await getStageDistribution();
    return res.json({ success: true, data: stages });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 7. Get role metrics ───────────────────────────────────────────────────────
commandCentreRouter.get('/roles', async (_req: Request, res: Response) => {
  try {
    const roles = await getRoleMetrics();
    return res.json({ success: true, data: roles });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 8. Get experience distribution ────────────────────────────────────────────
commandCentreRouter.get('/experience', async (_req: Request, res: Response) => {
  try {
    const experience = await getExperienceDistribution();
    return res.json({ success: true, data: experience });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});
