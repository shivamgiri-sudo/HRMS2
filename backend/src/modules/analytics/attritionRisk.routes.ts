/**
 * Attrition Risk & Performance Degradation Routes
 * File: backend/src/modules/analytics/attritionRisk.routes.ts
 * Purpose: Express routes for attrition risk analysis endpoints
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getPerformanceDegradation,
  getAbsenteeismCorrelation,
  getCompoundRiskProfile,
  getQualityVelocity,
  getEarlyWarningIndicators,
  getConsolidatedRiskReport
} from './attritionRisk.service.js';

const router = Router();

/**
 * All endpoints require authentication and appropriate role
 * Authorized roles: HR Admin, WFM Manager, Operations Manager
 */

// Performance Degradation Analysis
router.get(
  '/performance-degradation',
  requireAuth,
  requireRole('hr', 'wfm', 'manager', 'admin'),
  getPerformanceDegradation
);

// Absenteeism Correlation Analysis
router.get(
  '/absenteeism-correlation',
  requireAuth,
  requireRole('hr', 'manager', 'admin'),
  getAbsenteeismCorrelation
);

// Compound Risk Profile Analysis
router.get(
  '/compound-risk',
  requireAuth,
  requireRole('hr', 'wfm', 'manager', 'admin'),
  getCompoundRiskProfile
);

// Quality Velocity Analysis
router.get(
  '/quality-velocity',
  requireAuth,
  requireRole('hr', 'wfm', 'admin'),
  getQualityVelocity
);

// Early Warning Indicators
router.get(
  '/early-warning',
  requireAuth,
  requireRole('hr', 'manager', 'admin'),
  getEarlyWarningIndicators
);

// Consolidated Risk Report
router.get(
  '/consolidated',
  requireAuth,
  requireRole('hr', 'wfm', 'manager', 'admin'),
  getConsolidatedRiskReport
);

export default router;
