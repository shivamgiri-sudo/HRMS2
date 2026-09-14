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
import { resolveDashboardScopeForRequest, narrowDashboardScope } from '../../shared/dashboardScope.js';
import { getUserRoleContext } from '../../shared/roleResolver.js';
import { dashboardConsumerRoles } from "../../shared/dashboardAccessRegistry.js";

export const biRouter = Router();
biRouter.use(requireAuth);

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) =>
  fn(req, res).catch(next);

// Derived from the registry rather than restated. The daily-operations pulse and the
// quality-intervention feed are rendered by the WFM, WFM Attendance, Manager, CEO, Super
// Admin, Operations and Quality layouts; the previous literal list covered five of the
// eleven role keys those dashboards admit, so assistant_manager, team_leader, rta, qa and
// tq_head each hit 403 on a page they were entitled to open.
const OPS_ROLES = ['admin', ...dashboardConsumerRoles(
  'WFM_DASHBOARD', 'WFM_ATTENDANCE_DASHBOARD', 'MANAGEMENT_DASHBOARD', 'CEO_DASHBOARD',
  'SUPER_ADMIN_DASHBOARD', 'OPERATIONS_DASHBOARD', 'QUALITY_DASHBOARD',
)];
const FINANCE_ROLES = ['super_admin', 'admin', 'ceo', 'payroll_head', 'finance_head'] as const;

// GET /api/bi/daily-operations-pulse
biRouter.get('/daily-operations-pulse', requireRole(...OPS_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const date = req.query.date ? String(req.query.date) : undefined;
    const ctx = await getUserRoleContext(req.authUser!.id);
    const base = await resolveDashboardScopeForRequest(req.authUser!, ctx.primaryRole);
    const scope = await narrowDashboardScope(
      base,
      String(req.query.branchId ?? ""),
      String(req.query.processId ?? ""),
    );
    const data = await getDailyOpsPulse(date, scope.level === "ORG_ALL" ? undefined : scope.branchIds, scope.processIds);
    return res.json({ success: true, data });
  }));

// GET /api/bi/attrition-risk-signal
biRouter.get('/attrition-risk-signal', requireRole(...OPS_ROLES, 'hr'),
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
biRouter.get('/revenue-at-risk', requireRole('super_admin', 'admin', 'ceo', 'coo', 'manager', 'process_manager', 'branch_head', 'operations_manager', 'finance_head'),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await getRevenueAtRisk();
    return res.json({ success: true, data });
  }));

// GET /api/bi/quality-intervention
biRouter.get('/quality-intervention', requireRole(...OPS_ROLES, 'qa', 'quality_analyst'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const processId = req.query.processId ? String(req.query.processId) : undefined;
    const data = await getQualityIntervention(branchId, processId);
    return res.json({ success: true, data });
  }));
