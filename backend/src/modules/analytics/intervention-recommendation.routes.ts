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
import {
  getPendingInterventions,
  markInterventionActioned,
  getInterventionOutcomes
} from './intervention-recommendation.service.js';

const router = Router();

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

// Mark a recommendation as actioned — PATCH /:id
router.patch(
  '/:id',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager'),
  markInterventionActioned
);

export const interventionRecommendationRouter = router;
