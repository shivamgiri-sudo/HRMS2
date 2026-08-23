/**
 * Attrition Reason Inference Routes
 * File: backend/src/modules/analytics/attrition-reason-inference.routes.ts
 * Purpose: Express routes for attrition reason inference endpoints
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  inferAttritionReason,
  getInferredReasonBreakdown
} from './attrition-reason-inference.service.js';

const router = Router();

// GET /api/analytics/attrition-reason-inference?employeeId=&mode=realtime|historical
router.get(
  '/',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  inferAttritionReason
);

// GET /api/analytics/attrition-reason-inference/breakdown?period=YYYY-MM&branchId=
router.get(
  '/breakdown',
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  getInferredReasonBreakdown
);

export const attritionReasonInferenceRouter = router;
