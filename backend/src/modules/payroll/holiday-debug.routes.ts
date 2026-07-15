// Diagnostic API endpoint to show holiday configurations
import { Router } from 'express';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

router.use(requireAuth);
router.use(requireRole('super_admin', 'admin', 'hr', 'payroll_head', 'payroll_admin', 'wfm'));

// GET /api/payroll/holiday-debug/:month - Show detailed holiday configuration for a month
router.get('/:month', async (req, res) => {
  try {
    const month = req.params.month; // Format: YYYY-MM

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid month format. Use YYYY-MM'
      });
    }

    // Get holidays for the month
    const [holidays] = await db.execute<RowDataPacket[]>(`
      SELECT
        id,
        holiday_name,
        DATE_FORMAT(holiday_date, '%Y-%m-%d') as holiday_date,
        holiday_type,
        branch_id,
        active_status
      FROM leave_holiday_master
      WHERE DATE_FORMAT(holiday_date, '%Y-%m') = ?
      ORDER BY holiday_date
    `, [month]);

    if (holidays.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: `No holidays found for ${month}`
      });
    }

    // Get branch names
    const [branches] = await db.execute<RowDataPacket[]>(`
      SELECT id, branch_name FROM branch_master
    `);
    const branchMap = new Map(branches.map((b: any) => [b.id, b.branch_name]));

    const results: any[] = [];

    for (const holiday of holidays as any[]) {
      // Get cost centre mappings
      const [ccMappings] = await db.execute<RowDataPacket[]>(`
        SELECT
          hccm.cost_centre_id,
          ccm.cost_centre_name,
          ccm.cost_centre_code,
          ccm.process_name,
          bm.branch_name
        FROM holiday_cost_centre_mapping hccm
        JOIN cost_centre_master ccm ON ccm.id = hccm.cost_centre_id
        LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
        WHERE hccm.holiday_id = ?
        ORDER BY ccm.cost_centre_name
      `, [holiday.id]);

      // Get designation mappings
      const [desMappings] = await db.execute<RowDataPacket[]>(`
        SELECT
          hdm.designation_id,
          dm.designation_name
        FROM holiday_designation_mapping hdm
        JOIN designation_master dm ON dm.id = hdm.designation_id
        WHERE hdm.holiday_id = ?
        ORDER BY dm.designation_name
      `, [holiday.id]);

      // Count affected employees
      let countQuery = `
        SELECT COUNT(DISTINCT e.id) as employee_count
        FROM employees e
        WHERE e.active_status = 1
      `;
      const countParams: any[] = [];

      if (holiday.branch_id) {
        countQuery += ` AND e.branch_id = ?`;
        countParams.push(holiday.branch_id);
      }

      if (ccMappings.length > 0) {
        const ccIds = ccMappings.map((cc: any) => cc.cost_centre_id);
        countQuery += ` AND e.cost_centre_id IN (${ccIds.map(() => '?').join(',')})`;
        countParams.push(...ccIds);
      }

      if (desMappings.length > 0) {
        const desIds = desMappings.map((d: any) => d.designation_id);
        countQuery += ` AND e.designation_id IN (${desIds.map(() => '?').join(',')})`;
        countParams.push(...desIds);
      }

      const [countResult] = await db.execute<RowDataPacket[]>(countQuery, countParams);

      results.push({
        holiday_id: holiday.id,
        holiday_name: holiday.holiday_name,
        holiday_date: holiday.holiday_date,
        holiday_type: holiday.holiday_type,
        active_status: holiday.active_status,
        branch: holiday.branch_id ? branchMap.get(holiday.branch_id) || holiday.branch_id : 'All Branches',
        branch_id: holiday.branch_id,
        cost_centre_mappings: ccMappings,
        cost_centre_scope: ccMappings.length > 0
          ? `${ccMappings.length} specific cost centres`
          : 'ALL cost centres',
        designation_mappings: desMappings,
        designation_scope: desMappings.length > 0
          ? `${desMappings.length} specific designations`
          : 'ALL designations',
        affected_employees: (countResult[0] as any).employee_count,
      });
    }

    return res.json({
      success: true,
      data: results,
      month,
      total_holidays: results.length
    });

  } catch (error) {
    console.error('[holiday-debug] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as holidayDebugRouter };
