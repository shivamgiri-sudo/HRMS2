/**
 * Attrition Risk & Performance Degradation Routes
 * File: backend/src/modules/analytics/attritionRisk.routes.ts
 * Purpose: Express routes for attrition risk analysis endpoints
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';
import {
  getPerformanceDegradation,
  getAbsenteeismCorrelation,
  getCompoundRiskProfile,
  getQualityVelocity,
  getEarlyWarningIndicators,
  getConsolidatedRiskReport
} from './attritionRisk.service';

const router = Router();

/**
 * All endpoints require authentication and appropriate role
 * Authorized roles: HR Admin, WFM Manager, Operations Manager
 */

// Performance Degradation Analysis
router.get(
  '/performance-degradation',
  requireAuth,
  requireRole(['HR_ADMIN', 'WFM_MANAGER', 'OPERATIONS_MANAGER']),
  getPerformanceDegradation
);

// Absenteeism Correlation Analysis
router.get(
  '/absenteeism-correlation',
  requireAuth,
  requireRole(['HR_ADMIN', 'OPERATIONS_MANAGER']),
  getAbsenteeismCorrelation
);

// Compound Risk Profile Analysis
router.get(
  '/compound-risk',
  requireAuth,
  requireRole(['HR_ADMIN', 'WFM_MANAGER', 'OPERATIONS_MANAGER']),
  getCompoundRiskProfile
);

// Quality Velocity Analysis
router.get(
  '/quality-velocity',
  requireAuth,
  requireRole(['HR_ADMIN', 'WFM_MANAGER']),
  getQualityVelocity
);

// Early Warning Indicators
router.get(
  '/early-warning',
  requireAuth,
  requireRole(['HR_ADMIN', 'OPERATIONS_MANAGER']),
  getEarlyWarningIndicators
);

// Consolidated Risk Report
router.get(
  '/consolidated',
  requireAuth,
  requireRole(['HR_ADMIN', 'WFM_MANAGER', 'OPERATIONS_MANAGER']),
  getConsolidatedRiskReport
);

export default router;
