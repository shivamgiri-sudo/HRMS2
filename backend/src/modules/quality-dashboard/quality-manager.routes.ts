import { Router, Request, Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { QualityManagerService } from './quality-manager.service.js';
import { logger } from '../../logger.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();

// Initialize service
const service = new QualityManagerService(db);

// Helper: Get employee_code from authenticated user
async function getEmployeeCode(userId: string): Promise<string | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code FROM mas_hrms.employees WHERE user_id = ?`,
      [userId]
    );
    return rows && rows.length > 0 ? (rows[0] as any).employee_code : null;
  } catch (error) {
    logger.error('Error fetching employee code:', error);
    return null;
  }
}

/**
 * GET /api/manager/team-quality
 * Returns team quality summary + agent breakdown for manager's direct reports
 * Auth: requireRole(['RM', 'TL', 'process_manager', 'team_leader'])
 * Query params: daysBack (default 7), process (default INBOUND)
 */
router.get(
  '/team-quality',
  requireAuth,
  requireRole('process_manager', 'team_leader', 'manager', 'branch_head'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

      // Get employee code for the authenticated manager
      const employeeCode = await getEmployeeCode(userId);
      if (!employeeCode) {
        return res.status(403).json({ success: false, error: 'Manager employee code not found' });
      }

      const daysBack = parseInt(req.query.daysBack as string) || 7;
      const process = (req.query.process as string) || 'INBOUND';

      // Validate inputs
      if (daysBack < 1 || daysBack > 365) {
        return res.status(400).json({ success: false, error: 'daysBack must be between 1 and 365' });
      }

      const result = await service.getTeamQuality(employeeCode, daysBack, process);

      res.json({
        success: true,
        data: {
          team_summary: result.team_summary,
          agent_breakdown: result.agent_breakdown,
          last_updated: new Date(),
          filter: { daysBack, process }
        }
      });
    } catch (error) {
      logger.error('Error fetching team quality:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

export { router as qualityManagerRouter };
