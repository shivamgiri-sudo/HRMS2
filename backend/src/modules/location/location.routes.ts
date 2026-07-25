import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import geoip from "geoip-lite";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// POST /api/location/heartbeat
// Called on every auth'd API request (or on a timer). Resolves the client's
// real IP via geoip-lite — no browser GPS permission needed or requested.
router.post("/heartbeat", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;

  // Extract real client IP (trust proxy is set in app.ts so req.ip is correct)
  const rawIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || req.ip
    || "";
  // Strip IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
  const clientIp = rawIp.replace(/^::ffff:/, "");

  // Resolve lat/lng from IP using local geoip database — silent, no user prompt
  const geo = geoip.lookup(clientIp);
  let latitude: number | null = null;
  let longitude: number | null = null;

  if (geo?.ll) {
    [latitude, longitude] = geo.ll;
  }

  // Still accept browser-provided coords as an optional override (for future
  // use) but do NOT require them — the IP lookup is the primary source.
  const body = req.body as { latitude?: number; longitude?: number; accuracy?: number };
  if (body.latitude != null && body.longitude != null) {
    latitude = body.latitude;
    longitude = body.longitude;
  }

  if (latitude == null || longitude == null) {
    // Private/LAN IP with no geo data — accept silently (e.g. localhost dev)
    return res.json({ success: true });
  }

  // Resolve employee record
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

  if (!empRows.length) return res.json({ success: true });

  const emp = empRows[0] as {
    id: string; full_name: string;
    branch_name: string | null; process_name: string | null; designation_name: string | null;
  };

  await db.execute(
    `INSERT INTO employee_live_location
       (employee_id, latitude, longitude, accuracy, captured_at, full_name, branch_name, process_name, designation)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       latitude     = VALUES(latitude),
       longitude    = VALUES(longitude),
       accuracy     = VALUES(accuracy),
       captured_at  = NOW(),
       full_name    = VALUES(full_name),
       branch_name  = VALUES(branch_name),
       process_name = VALUES(process_name),
       designation  = VALUES(designation)`,
    [
      emp.id, latitude, longitude,
      body.accuracy ?? null,
      emp.full_name, emp.branch_name ?? null,
      emp.process_name ?? null, emp.designation_name ?? null,
    ],
  );

  return res.json({ success: true });
}));

// GET /api/location/live
router.get("/live", requireRole("super_admin", "hr", "wfm", "branch_head"), h(async (_req: AuthenticatedRequest, res: Response) => {
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
       ell.designation,
       TIMESTAMPDIFF(MINUTE, ell.captured_at, NOW()) AS minutes_ago
     FROM employee_live_location ell
     WHERE ell.captured_at >= NOW() - INTERVAL 30 MINUTE
     ORDER BY ell.captured_at DESC`,
  );
  return res.json({ success: true, data: rows });
}));

export const locationRouter = router;
