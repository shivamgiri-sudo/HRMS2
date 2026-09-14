import { Router, Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { QualityQAService } from './quality-qa.service.js';
import { logger } from '../../logger.js';

const router = Router();

// Initialize service
const service = new QualityQAService(db);

/**
 * GET /api/qa/quality-audit
 * Returns comprehensive quality audit report with process metrics and anomalies
 * Auth: requireRole(['QA'])
 * Query params: daysBack (default 7), process (optional)
 */
router.get(
  '/quality-audit',
  requireAuth,
  requireRole('qa'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

      const daysBack = parseInt(req.query.daysBack as string) || 7;
      const process = req.query.process as string;

      // Validate inputs
      if (daysBack < 1 || daysBack > 365) {
        return res.status(400).json({ success: false, error: 'daysBack must be between 1 and 365' });
      }

      const result = await service.getQualityAudit(daysBack, process);

      res.json({
        success: true,
        data: {
          ...result,
          last_updated: new Date(),
          filter: { daysBack, process: process || 'All' }
        }
      });
    } catch (error) {
      logger.error('Error fetching quality audit:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

export { router as qualityQARouter };
