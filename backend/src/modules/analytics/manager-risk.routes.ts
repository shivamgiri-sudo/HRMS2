/**
 * Manager Risk Routes
 * File: backend/src/modules/analytics/manager-risk.routes.ts
 * Purpose: Express routes for manager team-level risk endpoints
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getManagerRiskLeaderboard,
  getCriticalManagers,
  getManagerTeamDrilldown
} from './manager-risk.service.js';

const router = Router();

// GET /api/analytics/manager-risk/leaderboard?branchId=&processId=&limit=50&riskLevel=
router.get(
  '/leaderboard',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  getManagerRiskLeaderboard
);

// GET /api/analytics/manager-risk/critical
router.get(
  '/critical',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  getCriticalManagers
);

// GET /api/analytics/manager-risk/:managerId
router.get(
  '/:managerId',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  getManagerTeamDrilldown
);

export const managerRiskRouter = router;
