import { Router, Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { QualityExecutiveService } from './quality-executive.service.js';
import { logger } from '../../logger.js';

const router = Router();

// Initialize service
const service = new QualityExecutiveService(db);

/**
 * GET /api/executive/quality-summary
 * Returns organization-wide quality summary with KPIs, top/bottom performers, and risks
 * Auth: requireRole(['CEO', 'ADMIN', 'super_admin'])
 * Query params: daysBack (default 30)
 */
router.get(
  '/quality-summary',
  requireAuth,
  requireRole('ceo', 'super_admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

      const daysBack = parseInt(req.query.daysBack as string) || 30;

      // Validate inputs
      if (daysBack < 1 || daysBack > 365) {
        return res.status(400).json({ success: false, error: 'daysBack must be between 1 and 365' });
      }

      const result = await service.getExecutiveSummary(daysBack);

      res.json({
        success: true,
        data: {
          ...result,
          last_updated: new Date(),
          filter: { daysBack }
        }
      });
    } catch (error) {
      logger.error('Error fetching executive quality summary:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

export { router as qualityExecutiveRouter };
