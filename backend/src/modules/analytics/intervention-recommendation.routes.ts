/**
 * Intervention Recommendation Routes
 * File: backend/src/modules/analytics/intervention-recommendation.routes.ts
 * Purpose: Express routes for rule-based retention intervention recommendations
 *
 * Authorised roles: hr, admin, super_admin, manager
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { consoleScopeGuard, getScope, canAccessEmployee, OUT_OF_SCOPE_MSG } from '../wfm/console-scope.js';
import {
  getPendingInterventions,
  markInterventionActioned,
  getInterventionOutcomes
} from './intervention-recommendation.service.js';
import { getInterventionDetail, listInterventionCases } from './intervention-cases.service.js';

const router = Router();

// Branch / process scoping (see wfm/console-scope.ts). Only the Roster Command Center calls these endpoints.
router.use(requireAuth);
router.use(consoleScopeGuard());
// :id is an employee_retention_recommendation row — it must belong to an employee the caller may see.
router.param('id', async (req, res, next, id) => {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const [rows] = await db.execute<RowDataPacket[]>('SELECT employee_id FROM employee_retention_recommendation WHERE id = ? LIMIT 1', [id]);
    const employeeId = (rows as RowDataPacket[])[0]?.employee_id;
    if (!employeeId) return next(); // unknown id: the handler answers its own 404
    if (await canAccessEmployee(scope, String(employeeId))) return next();
    return res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });
  } catch (err) { return next(err); }
});

// Outcome summary — must be registered before /:id to avoid route shadowing
router.get(
  '/outcomes',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager'),
  getInterventionOutcomes
);

// Open pending interventions — optional ?owner= and ?limit= query params
router.get(
  '/pending',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager'),
  getPendingInterventions
);

// Cases by bucket (open|actioned|retained|exited|overdue|all) — drill-down lists
router.get(
  '/cases',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager'),
  listInterventionCases
);

// Full case detail for the drill-down drawer
router.get(
  '/:id',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager'),
  getInterventionDetail
);

// Mark a recommendation as actioned — PATCH /:id
router.patch(
  '/:id',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager'),
  markInterventionActioned
);

export const interventionRecommendationRouter = router;
