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
 * Admits a listed role OR anyone who actually has direct reports.
 *
 * requireRole alone refused the page's real audience: of the 78 active employees with direct
 * reports, 64 hold only the `employee` role (counted 2026-08-27), so a manager opening the My
 * Team Quality tab was told "Access denied" about her own team. This does NOT widen the data
 * — getTeamQuality() resolves the caller's own employee_code and reports only on their direct
 * reports, exactly as before. It widens who may ask the question about their own team.
 */
function allowRolesOrManagers(...roles: string[]) {
  const roleGate = requireRole(...roles);
  return async (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => {
    const userId = req.authUser?.id;
    if (userId) {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT 1 AS has_reports
             FROM mas_hrms.employees mgr
            WHERE mgr.user_id = ?
              AND EXISTS (SELECT 1 FROM mas_hrms.employees r
                           WHERE (r.reporting_manager_id = mgr.id OR r.manager_id = mgr.id)
                             AND r.active_status = 1)
            LIMIT 1`,
          [userId],
        );
        if (rows.length > 0) return next();
      } catch (error) {
        // Fall through to the role gate rather than failing open.
        logger.error('Error checking direct reports for quality access:', error);
      }
    }
    return (roleGate as unknown as (rq: unknown, rs: unknown, nx: unknown) => void)(req, res, next);
  };
}

/**
 * GET /api/manager/team-quality
 * Returns team quality summary + agent breakdown for manager's direct reports
 * Auth: a manager-shaped role, or any caller who has direct reports.
 * Query params: daysBack (default 7), process (optional — no campaign filter by default)
 */
router.get(
  '/team-quality',
  requireAuth,
  allowRolesOrManagers('admin', 'hr', 'ceo', 'process_manager', 'team_leader', 'manager', 'branch_head', 'assistant_manager'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

      const employeeCode = await getEmployeeCode(userId);

      const daysBack = parseInt(req.query.daysBack as string) || 7;
      // Defaults to no campaign filter, not to 'INBOUND'. The old default silently excluded
      // every row, because live assessments carry Campaign = NULL — see the query in
      // quality-manager.service.ts. A caller may still pass ?process=... to narrow.
      const process = (req.query.process as string) || '';

      // Validate inputs
      if (daysBack < 1 || daysBack > 365) {
        return res.status(400).json({ success: false, error: 'daysBack must be between 1 and 365' });
      }

      // Wide roles (admin/hr/ceo) without an employee record get org-wide quality via null managerCode
      const result = await service.getTeamQuality(employeeCode ?? '__ALL__', daysBack, process);

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
      // Return graceful empty payload so the frontend renders an empty state
      // rather than entering TanStack Query error mode and blanking the page.
      return res.json({
        success: true,
        _unavailable: true,
        data: {
          team_summary: {
            avg_quality: 0,
            agent_count: 0,
            calls_handled: 0,
            top_performer: { agent_code: '', agent_name: '—', quality: 0 },
            bottom_performer: { agent_code: '', agent_name: '—', quality: 0 },
            quality_distribution: { excellent: 0, good: 0, average: 0, poor: 0 },
          },
          agent_breakdown: [],
          last_updated: new Date(),
          filter: { daysBack: 7, process: 'INBOUND' },
        },
      });
    }
  }
);

export { router as qualityManagerRouter };
