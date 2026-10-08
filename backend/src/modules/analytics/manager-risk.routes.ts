/**
 * Manager Risk Routes
 * File: backend/src/modules/analytics/manager-risk.routes.ts
 * Purpose: Express routes for manager team-level risk endpoints
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { db } from '../../db/mysql.js';
import { attachEmployeeScope, canAccessEmployeeRecord } from '../dashboards/branch-scope-guards.js';
import type { NextFunction, Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getManagerRiskLeaderboard,
  getCriticalManagers,
  getManagerTeamDrilldown
} from './manager-risk.service.js';

const router = Router();

/** By-id guard (id or employee_code): the manager must be inside the caller's branch / assigned scope. Unknown -> handler's 404. */
async function guardManager(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as Request & { authUser?: { id: string } }).authUser;
    if (!user) return res.status(403).json({ success: false, error: 'Forbidden: no resolvable scope' });
    const key = String(req.params.managerId ?? '').trim();
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM employees WHERE id = ? OR employee_code = ? LIMIT 1', [key, key]);
    const id = rows[0]?.id ? String(rows[0].id) : null;
    if (id && !(await canAccessEmployeeRecord(user, id))) {
      return res.status(403).json({ success: false, error: 'Forbidden: this manager is outside your branch / assigned scope' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// GET /api/analytics/manager-risk/leaderboard?branchId=&processId=&limit=50&riskLevel=
router.get(
  '/leaderboard',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  attachEmployeeScope('mgr'),
  getManagerRiskLeaderboard
);

// GET /api/analytics/manager-risk/critical
router.get(
  '/critical',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  attachEmployeeScope('mgr'),
  getCriticalManagers
);

// GET /api/analytics/manager-risk/:managerId
router.get(
  '/:managerId',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  guardManager,
  getManagerTeamDrilldown
);

export const managerRiskRouter = router;
