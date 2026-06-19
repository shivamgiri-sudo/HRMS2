import { Router } from 'express';
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

// All routes require authentication and manager/admin role
commandCentreRouter.use(requireAuth);
commandCentreRouter.use(requireRole('admin', 'manager', 'hr'));

// ── 1. Get dashboard metrics ──────────────────────────────────────────────────
commandCentreRouter.get('/metrics', async (_req, res) => {
  try {
    const metrics = await getDashboardMetrics();
    return res.json({ success: true, data: metrics });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 2. Get source channel metrics ─────────────────────────────────────────────
commandCentreRouter.get('/sources', async (_req, res) => {
  try {
    const sources = await getSourceMetrics();
    return res.json({ success: true, data: sources });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 3. Get branch metrics ─────────────────────────────────────────────────────
commandCentreRouter.get('/branches', async (_req, res) => {
  try {
    const branches = await getBranchMetrics();
    return res.json({ success: true, data: branches });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 4. Get recruiter performance ──────────────────────────────────────────────
commandCentreRouter.get('/recruiters', async (req, res) => {
  try {
    const fromDate = req.query.from_date as string | undefined;
    const toDate = req.query.to_date as string | undefined;

    const performance = await getRecruiterPerformance(fromDate, toDate);
    return res.json({ success: true, data: performance });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 5. Get timeline data ──────────────────────────────────────────────────────
commandCentreRouter.get('/timeline', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const timeline = await getTimelineData(days);
    return res.json({ success: true, data: timeline });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 6. Get stage distribution ─────────────────────────────────────────────────
commandCentreRouter.get('/stages', async (_req, res) => {
  try {
    const stages = await getStageDistribution();
    return res.json({ success: true, data: stages });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 7. Get role metrics ───────────────────────────────────────────────────────
commandCentreRouter.get('/roles', async (_req, res) => {
  try {
    const roles = await getRoleMetrics();
    return res.json({ success: true, data: roles });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 8. Get experience distribution ────────────────────────────────────────────
commandCentreRouter.get('/experience', async (_req, res) => {
  try {
    const experience = await getExperienceDistribution();
    return res.json({ success: true, data: experience });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});
