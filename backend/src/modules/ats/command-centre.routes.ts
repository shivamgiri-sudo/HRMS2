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
import { resolveCandidateScope } from './candidate-access.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';

// Branch scoping (owner ruling 2026-10-01): every figure is limited to the caller's candidate row scope
// (own branch / assigned scope; org-wide roles unrestricted; no resolvable scope => zeros/empty).
const scopeOf = (req: Request, alias?: string) => resolveCandidateScope((req as AuthenticatedRequest).authUser!.id, alias);

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
commandCentreRouter.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await getDashboardMetrics(await scopeOf(req), await scopeOf(req, 'c'));
    return res.json({ success: true, data: metrics });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 2. Get source channel metrics ─────────────────────────────────────────────
commandCentreRouter.get('/sources', async (req: Request, res: Response) => {
  try {
    const sources = await getSourceMetrics(await scopeOf(req));
    return res.json({ success: true, data: sources });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 3. Get branch metrics ─────────────────────────────────────────────────────
commandCentreRouter.get('/branches', async (req: Request, res: Response) => {
  try {
    const branches = await getBranchMetrics(await scopeOf(req, 'c'));
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

    const performance = await getRecruiterPerformance(fromDate, toDate, await scopeOf(req));
    return res.json({ success: true, data: performance });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 5. Get timeline data ──────────────────────────────────────────────────────
commandCentreRouter.get('/timeline', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const timeline = await getTimelineData(days, await scopeOf(req));
    return res.json({ success: true, data: timeline });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 6. Get stage distribution ─────────────────────────────────────────────────
commandCentreRouter.get('/stages', async (req: Request, res: Response) => {
  try {
    const stages = await getStageDistribution(await scopeOf(req));
    return res.json({ success: true, data: stages });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 7. Get role metrics ───────────────────────────────────────────────────────
commandCentreRouter.get('/roles', async (req: Request, res: Response) => {
  try {
    const roles = await getRoleMetrics(await scopeOf(req));
    return res.json({ success: true, data: roles });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 8. Get experience distribution ────────────────────────────────────────────
commandCentreRouter.get('/experience', async (req: Request, res: Response) => {
  try {
    const experience = await getExperienceDistribution(await scopeOf(req));
    return res.json({ success: true, data: experience });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});
