import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import {
  getDailyOpsPulse,
  getAttritionRiskSignal,
  getPayrollExposureSummary,
  getTrainingReadinessPulse,
  getRevenueAtRisk,
  getQualityIntervention,
} from './bi.service.js';

export const biRouter = Router();
biRouter.use(requireAuth);

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) =>
  fn(req, res).catch(next);

const OPS_ROLES = ['super_admin', 'admin', 'ceo', 'management', 'manager', 'process_manager', 'branch_head', 'operations_manager', 'ho_operations', 'ho_wfm', 'wfm', 'wfm_spoc'] as const;
const FINANCE_ROLES = ['super_admin', 'admin', 'ceo', 'payroll_head', 'finance_head', 'ho_payroll'] as const;

// GET /api/bi/daily-operations-pulse
biRouter.get('/daily-operations-pulse', requireRole(...OPS_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const date = req.query.date ? String(req.query.date) : undefined;
    const data = await getDailyOpsPulse(date);
    return res.json({ success: true, data });
  }));

// GET /api/bi/attrition-risk-signal
biRouter.get('/attrition-risk-signal', requireRole(...OPS_ROLES, 'hr', 'branch_hr'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const processId = req.query.processId ? String(req.query.processId) : undefined;
    const data = await getAttritionRiskSignal(branchId, processId);
    return res.json({ success: true, data });
  }));

// GET /api/bi/payroll-exposure-summary
biRouter.get('/payroll-exposure-summary', requireRole(...FINANCE_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await getPayrollExposureSummary();
    return res.json({ success: true, data });
  }));

// GET /api/bi/training-readiness-pulse
biRouter.get('/training-readiness-pulse', requireRole(...OPS_ROLES, 'hr', 'trainer', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const processId = req.query.processId ? String(req.query.processId) : undefined;
    const data = await getTrainingReadinessPulse(branchId, processId);
    return res.json({ success: true, data });
  }));

// GET /api/bi/revenue-at-risk
biRouter.get('/revenue-at-risk', requireRole('super_admin', 'admin', 'ceo', 'management', 'manager', 'process_manager', 'finance_head', 'ho_operations'),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await getRevenueAtRisk();
    return res.json({ success: true, data });
  }));

// GET /api/bi/quality-intervention
biRouter.get('/quality-intervention', requireRole(...OPS_ROLES, 'qa', 'qa_manager', 'quality_analyst'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const processId = req.query.processId ? String(req.query.processId) : undefined;
    const data = await getQualityIntervention(branchId, processId);
    return res.json({ success: true, data });
  }));
