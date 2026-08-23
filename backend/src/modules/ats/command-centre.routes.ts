import { Router, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  resolveDashboardScopeForRequest,
  type DashboardScope,
  DashboardScopeConfigurationError,
} from '../../shared/dashboardScope.js';
import { getUserRoleContext } from '../../shared/roleResolver.js';
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

// ── Scope Resolution Helper ───────────────────────────────────────────────────

/**
 * SECURITY FIX: Resolve the caller's DashboardScope so every endpoint returns
 * only data within their branch/process/team assignment — not org-wide.
 *
 * Returns 409 when scope is not configured for the role (fail-closed).
 */
async function resolveCommandCentreScope(req: AuthenticatedRequest, res: Response): Promise<DashboardScope | null> {
  try {
    const userId = req.authUser!.id;
    const context = await getUserRoleContext(userId);
    const scope = await resolveDashboardScopeForRequest(
      { id: userId, role: req.authUser!.role, isDemo: req.authUser!.isDemo },
      context.primaryRole,
    );
    return scope;
  } catch (error: unknown) {
    if (error instanceof DashboardScopeConfigurationError) {
      res.status(409).json({ success: false, message: error.message, code: error.code });
      return null;
    }
    throw error;
  }
}

// ── 1. Get dashboard metrics ──────────────────────────────────────────────────
commandCentreRouter.get('/metrics', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await resolveCommandCentreScope(req, res);
    if (!scope) return; // 409 already sent
    const metrics = await getDashboardMetrics(scope);
    return res.json({ success: true, data: metrics });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 2. Get source channel metrics ─────────────────────────────────────────────
commandCentreRouter.get('/sources', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await resolveCommandCentreScope(req, res);
    if (!scope) return;
    const sources = await getSourceMetrics(scope);
    return res.json({ success: true, data: sources });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 3. Get branch metrics ─────────────────────────────────────────────────────
commandCentreRouter.get('/branches', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await resolveCommandCentreScope(req, res);
    if (!scope) return;
    const branches = await getBranchMetrics(scope);
    return res.json({ success: true, data: branches });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 4. Get recruiter performance ──────────────────────────────────────────────
commandCentreRouter.get('/recruiters', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await resolveCommandCentreScope(req, res);
    if (!scope) return;
    const fromDate = req.query.from_date as string | undefined;
    const toDate = req.query.to_date as string | undefined;
    const performance = await getRecruiterPerformance(scope, fromDate, toDate);
    return res.json({ success: true, data: performance });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 5. Get timeline data ──────────────────────────────────────────────────────
commandCentreRouter.get('/timeline', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await resolveCommandCentreScope(req, res);
    if (!scope) return;
    const days = parseInt(req.query.days as string) || 30;
    const timeline = await getTimelineData(scope, days);
    return res.json({ success: true, data: timeline });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 6. Get stage distribution ─────────────────────────────────────────────────
commandCentreRouter.get('/stages', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await resolveCommandCentreScope(req, res);
    if (!scope) return;
    const stages = await getStageDistribution(scope);
    return res.json({ success: true, data: stages });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 7. Get role metrics ───────────────────────────────────────────────────────
commandCentreRouter.get('/roles', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await resolveCommandCentreScope(req, res);
    if (!scope) return;
    const roles = await getRoleMetrics(scope);
    return res.json({ success: true, data: roles });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// ── 8. Get experience distribution ────────────────────────────────────────────
commandCentreRouter.get('/experience', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await resolveCommandCentreScope(req, res);
    if (!scope) return;
    const experience = await getExperienceDistribution(scope);
    return res.json({ success: true, data: experience });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});
