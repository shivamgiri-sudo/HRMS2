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
  clearKpiMasterConfigCell,
  getKpiTargetMatrix,
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

// ─── Target matrix ───────────────────────────────────────────────────────────────────
// One payload backing the process × designation grid: the pairs that have employees, the
// metrics worth a column, and the effective value of every cell with the tier it came from.

router.get(
  '/matrix',
  requireRole('admin', 'hr', 'manager', 'process_manager'),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await getKpiTargetMatrix();
    res.json({ success: true, data });
  })
);

/**
 * Validates one cell edit. Returns a message instead of throwing so a bulk apply can report
 * which row failed rather than losing the whole batch.
 */
function readCellInput(
  body: any,
  metric?: { unit?: string | null; direction?: string | null },
): { ok: true; value: any } | { ok: false; message: string } {
  const metricId = typeof body?.metric_id === 'string' ? body.metric_id.trim() : '';
  const processId = typeof body?.process_id === 'string' ? body.process_id.trim() : '';
  if (!metricId) return { ok: false, message: 'metric_id is required' };
  if (!processId) return { ok: false, message: 'process_id is required' };

  const target = Number(body?.target_value);
  if (!Number.isFinite(target)) return { ok: false, message: 'target_value must be a number' };
  if (target < 0) return { ok: false, message: 'target_value cannot be negative' };
  // Targets are unit-typed: AHT in seconds, error rate in percent, sales in currency. A
  // percentage above 100 is a typo, not an ambitious goal.
  if (metric?.unit === 'percent' && target > 100) {
    return { ok: false, message: `target_value ${target} is above 100 for a percentage metric` };
  }

  const min = body?.min_threshold === null || body?.min_threshold === undefined || body?.min_threshold === ''
    ? null
    : Number(body.min_threshold);
  if (min !== null && !Number.isFinite(min)) return { ok: false, message: 'min_threshold must be a number or blank' };
  // The threshold is the unacceptable bound, so it always sits on the worse side of the
  // target — under it when higher is better, over it when lower is better. Reversed, it
  // would gate on the wrong side and fail everyone who is performing well.
  if (min !== null && metric?.direction) {
    const lowerBetter = metric.direction === 'lower_is_better';
    if (lowerBetter && min < target) {
      return { ok: false, message: `min_threshold ${min} must be above the target ${target} when lower is better` };
    }
    if (!lowerBetter && min > target) {
      return { ok: false, message: `min_threshold ${min} must be below the target ${target} when higher is better` };
    }
  }

  const weightage = body?.weightage === undefined || body?.weightage === null || body?.weightage === ''
    ? undefined
    : Number(body.weightage);
  if (weightage !== undefined && (!Number.isFinite(weightage) || weightage < 0 || weightage > 100)) {
    return { ok: false, message: 'weightage must be between 0 and 100' };
  }

  return {
    ok: true,
    value: {
      metric_id: metricId,
      org_unit_type: 'process' as const,
      org_unit_id: processId,
      // Blank designation means the row applies to every designation on the process, which
      // is what the pre-1035 rows have always meant.
      designation_id: typeof body?.designation_id === 'string' && body.designation_id.trim()
        ? body.designation_id.trim()
        : null,
      target_value: target,
      min_threshold: min,
      weightage,
    },
  };
}

router.post(
  '/matrix/cell',
  requireRole('admin', 'hr', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [metricRows] = await db.execute<RowDataPacket[]>(
      'SELECT unit, direction FROM kpi_metric_master WHERE id = ? LIMIT 1',
      [typeof req.body?.metric_id === 'string' ? req.body.metric_id.trim() : ''],
    );
    const parsed = readCellInput(req.body, (metricRows as any[])[0]);
    if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
    await upsertKpiMasterConfig({ ...parsed.value, created_by: req.authUser?.id });
    res.json({ success: true });
  })
);

router.delete(
  '/matrix/cell',
  requireRole('admin', 'hr', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const metricId = typeof req.body?.metric_id === 'string' ? req.body.metric_id.trim() : '';
    const processId = typeof req.body?.process_id === 'string' ? req.body.process_id.trim() : '';
    if (!metricId || !processId) {
      return res.status(400).json({ success: false, message: 'metric_id and process_id are required' });
    }
    await clearKpiMasterConfigCell({
      metric_id: metricId,
      org_unit_type: 'process',
      org_unit_id: processId,
      designation_id: typeof req.body?.designation_id === 'string' && req.body.designation_id.trim()
        ? req.body.designation_id.trim()
        : null,
    });
    res.json({ success: true });
  })
);

/**
 * Applies one metric's target across many pairs in a single call — the point of the grid,
 * since setting DIALS for 40 process×designation pairs one request at a time is what made
 * the old screens unusable. Reports per-row failures rather than aborting the batch.
 */
router.post(
  '/matrix/bulk',
  requireRole('admin', 'hr', 'process_manager'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const cells = Array.isArray(req.body?.cells) ? req.body.cells : null;
    if (!cells) return res.status(400).json({ success: false, message: 'cells must be an array' });
    if (!cells.length) return res.status(400).json({ success: false, message: 'cells is empty' });
    if (cells.length > 500) {
      return res.status(400).json({ success: false, message: 'cells exceeds the 500-row limit' });
    }

    // Loaded once rather than per row: unit and direction decide what a valid target and
    // threshold look like, and a bulk apply can carry hundreds of rows.
    const [metricRows] = await db.execute<RowDataPacket[]>(
      'SELECT id, unit, direction FROM kpi_metric_master'
    );
    const metricsById = new Map(
      (metricRows as any[]).map((row) => [String(row.id), { unit: row.unit, direction: row.direction }]),
    );

    const failures: Array<{ index: number; message: string }> = [];
    let applied = 0;
    for (const [index, cell] of cells.entries()) {
      const parsed = readCellInput(cell, metricsById.get(String(cell?.metric_id)));
      if (!parsed.ok) { failures.push({ index, message: parsed.message }); continue; }
      try {
        await upsertKpiMasterConfig({ ...parsed.value, created_by: req.authUser?.id });
        applied += 1;
      } catch (error) {
        failures.push({ index, message: error instanceof Error ? error.message : String(error) });
      }
    }

    res.json({ success: failures.length === 0, applied, failed: failures.length, failures });
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
