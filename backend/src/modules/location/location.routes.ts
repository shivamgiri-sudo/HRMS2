import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// POST /api/location/heartbeat
// Upserts the calling employee's live location. employee_id always resolved from JWT.
router.post("/heartbeat", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { latitude, longitude, accuracy } = req.body as {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
  };

  if (latitude == null || longitude == null) {
    return res.status(400).json({ success: false, error: "latitude and longitude are required" });
  }

  // Resolve employee_id, branch, process and designation from auth user
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.full_name, bm.branch_name, pm.process_name,
            desig.designation_name
     FROM employees e
     LEFT JOIN branch_master      bm    ON bm.id    = e.branch_id
     LEFT JOIN process_master     pm    ON pm.id    = e.process_id
     LEFT JOIN designation_master desig ON desig.id = e.designation_id
     WHERE e.user_id = ? AND e.active_status = 1
     LIMIT 1`,
    [userId],
  );

  if (!empRows.length) {
    // User has no active employee record — accept silently
    return res.json({ success: true });
  }

  const emp = empRows[0] as {
    id: string;
    full_name: string;
    branch_name: string | null;
    process_name: string | null;
    designation_name: string | null;
  };

  await db.execute(
    `INSERT INTO employee_live_location
       (employee_id, latitude, longitude, accuracy, captured_at, full_name, branch_name, process_name, designation)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       latitude         = VALUES(latitude),
       longitude        = VALUES(longitude),
       accuracy         = VALUES(accuracy),
       captured_at      = NOW(),
       full_name        = VALUES(full_name),
       branch_name      = VALUES(branch_name),
       process_name     = VALUES(process_name),
       designation      = VALUES(designation)`,
    [
      emp.id,
      latitude,
      longitude,
      accuracy ?? null,
      emp.full_name,
      emp.branch_name ?? null,
      emp.process_name ?? null,
      emp.designation_name ?? null,
    ],
  );

  return res.json({ success: true });
}));

// GET /api/location/live — super_admin only
// Returns all employees whose heartbeat arrived in the last 5 minutes.
router.get("/live", requireRole("super_admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       ell.employee_id,
       ell.latitude,
       ell.longitude,
       ell.accuracy,
       ell.captured_at,
       ell.full_name,
       ell.branch_name,
       ell.process_name,
       ell.designation
     FROM employee_live_location ell
     WHERE ell.captured_at >= NOW() - INTERVAL 5 MINUTE
     ORDER BY ell.full_name ASC`,
  );

  return res.json({ success: true, data: rows });
}));

export const locationRouter = router;
