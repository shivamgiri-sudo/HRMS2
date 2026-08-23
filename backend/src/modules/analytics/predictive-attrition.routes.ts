/**
 * Predictive Attrition Analytics Routes
 * File: backend/src/modules/analytics/predictive-attrition.routes.ts
 * Purpose: Express routes for formula-based predictive attrition risk scoring
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getAttritionRiskSummary,
  getAtRiskEmployees,
  getPredictiveScoreForEmployee
} from './predictive-attrition.service.js';

const router = Router();

/**
 * All endpoints require authentication and an authorised role.
 * Authorised roles: hr, wfm, manager, admin, super_admin
 */

// Org-wide summary: total_active, tier counts, predicted_exits_30d
router.get(
  '/summary',
  requireAuth,
  requireRole('hr', 'wfm', 'manager', 'admin', 'super_admin'),
  getAttritionRiskSummary
);

// At-risk employee list — optional query params: branchId, processId, tier, limit
router.get(
  '/at-risk',
  requireAuth,
  requireRole('hr', 'wfm', 'manager', 'admin', 'super_admin'),
  getAtRiskEmployees
);

// Full score breakdown for a single employee — :employeeId is the numeric DB id
router.get(
  '/:employeeId',
  requireAuth,
  requireRole('hr', 'wfm', 'manager', 'admin', 'super_admin'),
  getPredictiveScoreForEmployee
);

export const predictiveAttritionRouter = router;
