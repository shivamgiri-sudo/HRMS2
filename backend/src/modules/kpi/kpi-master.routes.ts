import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';
import { hasProcessScope } from '../../shared/accessGuard.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  listKpiMasterConfig,
  upsertKpiMasterConfig,
  deleteKpiMasterConfig,
  resolveEmployeeKpis,
  getResolvedKpis,
  getLiveKpiPerformance,
  getOrgUnitOptions,
  getTeamKpiSummary,
  type OrgUnitType,
  type Period,
} from './kpi-master.service.js';
import {
  syncAprMetrics,
  syncAttendanceMetrics,
  syncConversionMetrics,
  syncSalesBrandMisMetrics,
  syncSalesOrderMetrics,
  syncQualityMetrics,
} from './kpi-data-connector.service.js';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

function readPerformanceQuery(req: AuthenticatedRequest, res: Response) {
  const period = (req.query.period as Period) ?? 'day';
  const validPeriods: Period[] = ['day', 'wtd', 'mtd', 'past_month'];
  if (!validPeriods.includes(period)) {
    res.status(400).json({ success: false, message: 'Invalid period. Use: day, wtd, mtd, past_month' });
    return null;
  }

  const date = req.query.date ? String(req.query.date) : undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ success: false, message: 'Invalid date. Use YYYY-MM-DD' });
    return null;
  }
  return { period, date };
}

async function canViewEmployeePerformance(req: AuthenticatedRequest, employeeId: string) {
  const roles = ((req as AuthenticatedRequest & { userRoles?: string[] }).userRoles ?? []);
  if (roles.some((role) => ['super_admin', 'admin', 'hr'].includes(role))) return true;

  const viewer = await getEmployeeForUser(req.authUser!.id);
  if (!viewer) return false;
  if (viewer.id === employeeId) return true;

  if (roles.some((role) => ['manager', 'process_manager'].includes(role))) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `WITH RECURSIVE reporting_tree AS (
         SELECT id
           FROM employees
          WHERE reporting_manager_id = ? AND active_status = 1
         UNION ALL
         SELECT e.id
           FROM employees e
           JOIN reporting_tree rt ON e.reporting_manager_id = rt.id
          WHERE e.active_status = 1
       )
       SELECT id FROM reporting_tree WHERE id = ? LIMIT 1`,
      [viewer.id, employeeId]
    );
    return rows.length > 0;
  }

  if (roles.includes('qa')) {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT process_id, branch_id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1',
      [employeeId]
    );
    const target = rows[0] as any;
    return Boolean(target?.process_id) && hasProcessScope(
      req.authUser!.id,
      target.process_id,
      target.branch_id,
      'qa'
    );
  }

  return false;
}

// Admin: list configs
router.get(
  '/',
  requireRole('admin', 'hr', 'manager', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { org_unit_type, is_active } = req.query as any;
    const rows = await listKpiMasterConfig({
      org_unit_type: org_unit_type as OrgUnitType | undefined,
      is_active: is_active !== undefined ? Number(is_active) : undefined,
    });
    res.json({ success: true, data: rows });
  })
);

// Admin: upsert config
router.post(
  '/',
  requireRole('admin', 'hr', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const result = await upsertKpiMasterConfig({
      ...req.body,
      created_by: req.authUser?.id,
    });
    res.json({ success: true, data: result });
  })
);

// Manager: team KPI summary
router.get(
  '/team-summary',
  h(async (req: AuthenticatedRequest, res: Response) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) {
      return res.status(400).json({ success: false, message: 'No employee linked to this user' });
    }

    const query = readPerformanceQuery(req, res);
    if (!query) return;

    const data = await getTeamKpiSummary(emp.id, query.period, query.date);
    res.json({ success: true, data });
  })
);

// Admin: soft-delete
router.delete(
  '/:id',
  requireRole('admin', 'hr', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const result = await deleteKpiMasterConfig(req.params.id);
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }
    res.json({ success: true });
  })
);

// Org unit dropdown options
router.get(
  '/org-units/:type',
  requireRole('admin', 'hr', 'manager', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const type = req.params.type as OrgUnitType;
    const allowed: OrgUnitType[] = ['department', 'designation', 'process', 'cost_centre'];
    if (!allowed.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid org unit type' });
    }
    const rows = await getOrgUnitOptions(type);
    res.json({ success: true, data: rows });
  })
);

// Admin: resolve KPIs for a specific employee
router.post(
  '/resolve/:empId',
  requireRole('admin', 'hr', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const count = await resolveEmployeeKpis(req.params.empId);
    res.json({ success: true, resolved: count });
  })
);

// Employee: get my resolved KPIs (resolves on-demand if empty)
router.get(
  '/my-kpis',
  h(async (req: AuthenticatedRequest, res: Response) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) {
      return res.status(400).json({ success: false, message: 'No employee linked to this user' });
    }

    let resolved = await getResolvedKpis(emp.id);
    if (!(resolved as any[]).length) {
      await resolveEmployeeKpis(emp.id);
      resolved = await getResolvedKpis(emp.id);
    }

    res.json({ success: true, data: resolved });
  })
);

// Employee: live performance (self)
router.get(
  '/live',
  h(async (req: AuthenticatedRequest, res: Response) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) {
      return res.status(400).json({ success: false, message: 'No employee linked to this user' });
    }

    const query = readPerformanceQuery(req, res);
    if (!query) return;

    // Auto-resolve if not done yet
    const existing = await getResolvedKpis(emp.id);
    if (!(existing as any[]).length) {
      await resolveEmployeeKpis(emp.id);
    }

    const data = await getLiveKpiPerformance(emp.id, query.period, query.date);
    res.json({ success: true, data });
  })
);

// Manager: live performance for a specific employee
router.get(
  '/live/:empId',
  requireRole('admin', 'hr', 'manager', 'process_manager', 'qa'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const query = readPerformanceQuery(req, res);
    if (!query) return;
    if (!(await canViewEmployeePerformance(req, req.params.empId))) {
      return res.status(403).json({ success: false, message: 'Employee is outside your reporting or assigned scope' });
    }
    const data = await getLiveKpiPerformance(req.params.empId, query.period, query.date);
    res.json({ success: true, data });
  })
);

// Admin: trigger data sync
router.post(
  '/sync',
  requireRole('admin', 'hr', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { date, year_month } = req.body;

    const results: Record<string, unknown> = {};

    if (date) {
      results.apr = await syncAprMetrics(date);
      results.attendance = await syncAttendanceMetrics(date);
      results.conversion = await syncConversionMetrics(date);
      results.salesBrandMis = await syncSalesBrandMisMetrics(date);
      results.salesOrders = await syncSalesOrderMetrics(date);
    }
    if (year_month) {
      results.quality = await syncQualityMetrics(year_month);
    }

    res.json({ success: true, results });
  })
);

export { router as kpiMasterRouter };
