import { Router, Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { QualityExecutiveService } from './quality-executive.service.js';
import { logger } from '../../logger.js';
import { dashboardConsumerRoles } from "../../shared/dashboardAccessRegistry.js";

const router = Router();

// Initialize service
const service = new QualityExecutiveService(db);

function buildQualityFallback(daysBack: number, reason: string) {
  return {
    metrics: {
      overall_quality_score: 0,
      target_quality_score: 85,
      gap_pct: 85,
      status: 'Critical' as const,
      trend_7day: { direction: 'flat', change_pct: 0 },
      trend_30day: { direction: 'flat', change_pct: 0 }
    },
    top_performers: [],
    bottom_performers: [],
    process_performance: [],
    risk_summary: {
      critical_agents_count: 0,
      at_risk_agents_count: 0,
      coaching_priority_count: 0
    },
    org_benchmarks: {
      avg_quality: 0,
      median_quality: 0,
      std_deviation: 0
    },
    last_updated: new Date(),
    filter: { daysBack },
    data_status: 'UNAVAILABLE',
    note: reason
  };
}

/**
 * GET /api/executive/quality-summary
 * Returns organization-wide quality summary with KPIs, top/bottom performers, and risks
 * Auth: requireRole(['CEO', 'ADMIN', 'super_admin'])
 * Query params: daysBack (default 30)
 */
router.get(
  '/quality-summary',
  requireAuth,
  // CEO and Super Admin layouts read this; `management` is admitted to CEO_DASHBOARD too.
  requireRole('admin', ...dashboardConsumerRoles('CEO_DASHBOARD', 'SUPER_ADMIN_DASHBOARD')),
  async (req: AuthenticatedRequest, res: Response) => {
    const daysBack = parseInt(req.query.daysBack as string) || 30;
    try {
      const userId = req.authUser?.id;
      if (!userId) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

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
      res.json({
        success: true,
        data: buildQualityFallback(daysBack, 'Quality audit data is currently unavailable')
      });
    }
  }
);

/**
 * GET /api/executive/quality-summary/process-breakdown
 *
 * The per-process rows on their own. useExecutiveQuality asks for this
 * separately so the breakdown table can refresh without re-fetching the whole
 * executive summary, but the route did not exist — the hook swallowed the 404
 * into an empty array and the table simply rendered blank.
 *
 * No new query: getExecutiveSummary already computes process_performance, and
 * this returns exactly that slice. Same roles as the parent summary, because it
 * is the same organisation-wide quality data viewed more narrowly.
 *
 * The failure path sets unavailable:true alongside the empty array. An empty
 * list on its own is indistinguishable from genuinely perfect quality across
 * every process, which is the reading an executive dashboard must never invite.
 */
router.get(
  '/quality-summary/process-breakdown',
  requireAuth,
  requireRole('admin', ...dashboardConsumerRoles('CEO_DASHBOARD', 'SUPER_ADMIN_DASHBOARD')),
  async (req: AuthenticatedRequest, res: Response) => {
    const daysBack = parseInt(req.query.daysBack as string) || 30;
    try {
      if (!req.authUser?.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }
      if (daysBack < 1 || daysBack > 365) {
        return res.status(400).json({ success: false, error: 'daysBack must be between 1 and 365' });
      }

      const result = await service.getExecutiveSummary(daysBack);
      res.json({
        success: true,
        data: result.process_performance ?? [],
        last_updated: new Date(),
        filter: { daysBack },
      });
    } catch (error) {
      logger.error('Error fetching executive process breakdown:', error);
      res.json({
        success: true,
        data: buildQualityFallback(daysBack, 'Quality audit data is currently unavailable').process_performance ?? [],
        unavailable: true,
      });
    }
  }
);

export { router as qualityExecutiveRouter };
