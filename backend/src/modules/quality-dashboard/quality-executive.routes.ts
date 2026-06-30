import { Router, Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { QualityExecutiveService } from './quality-executive.service.js';
import { logger } from '../../logger.js';

const router = Router();
router.use(requireAuth);

// Initialize service
const service = new QualityExecutiveService(db);

const EXEC_ROLES = ['super_admin', 'admin', 'ceo', 'coo'] as const;

/**
 * GET /api/executive/quality-summary
 * Returns organization-wide quality summary with KPIs, top/bottom performers, and risks
 * Auth: requireRole(['super_admin', 'admin', 'ceo', 'coo'])
 * Query params: daysBack (default 30, max 365)
 */
router.get(
  '/quality-summary',
  requireRole(...EXEC_ROLES),
  async (req: AuthenticatedRequest, res: Response) => {
    const daysBack = parseInt((req.query.daysBack as string) ?? '30', 10);
    const safeDays = isNaN(daysBack) || daysBack < 1 ? 30 : Math.min(daysBack, 365);
    try {
      const data = await service.getExecutiveSummary(safeDays);
      return res.json({ success: true, data });
    } catch (err: any) {
      logger.error('Error fetching executive quality summary:', err);
      return res.status(500).json({ success: false, error: 'Failed to load executive quality summary' });
    }
  }
);

/**
 * GET /api/executive/quality-summary/process-breakdown
 * Returns process-level quality scorecard
 * Auth: requireRole(['super_admin', 'admin', 'ceo', 'coo'])
 * Query params: daysBack (default 30, max 365)
 */
router.get(
  '/quality-summary/process-breakdown',
  requireRole(...EXEC_ROLES),
  async (req: AuthenticatedRequest, res: Response) => {
    const daysBack = parseInt((req.query.daysBack as string) ?? '30', 10);
    const safeDays = isNaN(daysBack) || daysBack < 1 ? 30 : Math.min(daysBack, 365);
    try {
      const full = await service.getExecutiveSummary(safeDays);
      return res.json({ success: true, data: full.process_performance ?? [] });
    } catch (err: any) {
      logger.error('Error fetching quality process breakdown:', err);
      return res.status(500).json({ success: false, error: 'Failed to load process breakdown' });
    }
  }
);

export { router as qualityExecutiveRouter };
