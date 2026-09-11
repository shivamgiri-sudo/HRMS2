import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";

const router = Router();

/**
 * GET /api/leave/reconciliation/mismatches?month=YYYY-MM
 *
 * Returns employee-days where a leave request is approved but the attendance
 * record for that day does NOT have a leave-type status.
 * Used by HR to identify sync gaps and correct attendance (HR-044).
 *
 * No data is modified — this is a read-only audit view.
 */
router.get(
  "/reconciliation/mismatches",
  requireAuth,
  requireRole("Super Admin", "HR Admin"),
  async (req, res) => {
    const month = (req.query.month as string) ?? "";
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month parameter required in YYYY-MM format" });
    }
    const monthStart = `${month}-01`;

    // Generate a series of dates for the target month using a cross-join of
    // information_schema.COLUMNS as a numbers table (safe, always >= 100 rows).
    const [rows] = await db.execute<RowDataPacket[]>(`
      WITH RECURSIVE cal AS (
        SELECT DATE(?) AS d
        UNION ALL
        SELECT DATE_ADD(d, INTERVAL 1 DAY) FROM cal
        WHERE d < LAST_DAY(?)
      )
      SELECT
        lr.id                                                  AS leave_request_id,
        lr.employee_id,
        CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')) AS employee_name,
        e.employee_code,
        lt.leave_name                                          AS leave_type,
        lr.status                                              AS leave_status,
        cal.d                                                  AS leave_date,
        adr.attendance_status,
        adr.id                                                 AS attendance_record_id
      FROM cal
      JOIN leave_request lr
        ON  lr.status IN ('approved')
        AND lr.from_date <= cal.d
        AND lr.to_date   >= cal.d
      JOIN employees e  ON e.id = lr.employee_id
      LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
      LEFT JOIN attendance_daily_record adr
        ON  adr.employee_id = lr.employee_id
        AND adr.record_date = cal.d
      WHERE (
        adr.attendance_status IS NULL
        OR adr.attendance_status NOT IN (
          'leave','leave_approved','approved_leave','on_leave','cl','el','sl','pl',
          'casual_leave','earned_leave','sick_leave','privilege_leave'
        )
      )
      ORDER BY cal.d, e.employee_code
    `, [monthStart, monthStart]);

    return res.json({
      mismatches: rows,
      total: (rows as RowDataPacket[]).length,
      month,
    });
  }
);

export default router;
