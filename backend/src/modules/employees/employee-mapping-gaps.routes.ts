import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";

const router = Router();

/**
 * GET /api/employees/mapping-gaps
 * Returns active employees missing process_id or cost_centre_id.
 * Used by HR admins to identify and remediate data quality gaps (HR-043).
 */
router.get(
  "/mapping-gaps",
  requireAuth,
  requireRole("Super Admin", "HR Admin"),
  async (_req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(`
      SELECT
        e.id,
        e.employee_code,
        CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) AS employee_name,
        e.status,
        e.branch_id,
        bm.branch_name,
        e.process_id,
        pm.process_name,
        e.cost_centre_id,
        cc.display_name AS cost_centre_name
      FROM employees e
      LEFT JOIN branch_master bm ON bm.id = e.branch_id
      LEFT JOIN process_master pm ON pm.id = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      WHERE e.status = 'active'
        AND (e.process_id IS NULL OR e.cost_centre_id IS NULL)
      ORDER BY e.employee_code
    `);

    const gaps = (rows as RowDataPacket[]).map((r) => ({
      employee_id: r.id,
      employee_code: r.employee_code,
      employee_name: (r.employee_name as string).trim(),
      branch_name: r.branch_name ?? null,
      process_id: r.process_id ?? null,
      process_name: r.process_name ?? null,
      cost_centre_id: r.cost_centre_id ?? null,
      cost_centre_name: r.cost_centre_name ?? null,
      missing: [
        ...(!r.process_id ? ["process"] : []),
        ...(!r.cost_centre_id ? ["cost_centre"] : []),
      ] as string[],
    }));

    return res.json({ gaps, total: gaps.length });
  }
);

export default router;
