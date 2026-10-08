import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const _geofenceRadius = parseFloat(process.env.GEOFENCE_RADIUS_KM ?? "1.0");
const GEOFENCE_RADIUS_KM = Number.isFinite(_geofenceRadius) && _geofenceRadius > 0 ? _geofenceRadius : 1.0;

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

  // Append to the movement trail (route replay). Best-effort: if migration 423
  // has not run yet the table is absent, so we swallow the error and never let
  // it break the live heartbeat that the map depends on.
  try {
    await db.execute(
      `INSERT INTO employee_location_history
         (employee_id, latitude, longitude, accuracy, captured_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [emp.id, latitude, longitude, accuracy ?? null],
    );
  } catch (err) {
    console.warn("[location] history insert skipped:", (err as Error).message);
  }

  // Geofence check — best-effort, never fails the heartbeat
  let geofenceResult: { outside: boolean; distanceKm: number; branchName: string } | undefined;
  try {
    const [branchRows] = await db.execute<RowDataPacket[]>(
      `SELECT b.id, b.branch_name, b.latitude, b.longitude
         FROM employees e
         JOIN branch_master b ON b.id = e.branch_id
        WHERE e.id = ? AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL
        LIMIT 1`,
      [emp.id],
    );
    if (branchRows.length) {
      const br = branchRows[0] as { id: string; branch_name: string; latitude: number; longitude: number };
      const distanceKm = haversineKm(latitude, longitude, Number(br.latitude), Number(br.longitude));
      const outside = distanceKm > GEOFENCE_RADIUS_KM;
      geofenceResult = { outside, distanceKm: parseFloat(distanceKm.toFixed(3)), branchName: br.branch_name };
      if (outside) {
        await db.execute(
          `INSERT INTO employee_geofence_alerts
             (employee_id, branch_id, branch_name, latitude, longitude, distance_km, radius_km)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [emp.id, br.id, br.branch_name, latitude, longitude, distanceKm, GEOFENCE_RADIUS_KM],
        ).catch((err: Error) => console.warn("[location] geofence alert insert skipped:", err.message));
      }
    }
  } catch (err) {
    console.warn("[location] geofence check skipped:", (err as Error).message);
  }

  return res.json({ success: true, ...(geofenceResult ? { geofence: geofenceResult } : {}) });
}));

// GET /api/location/live
// super_admin: unrestricted; all employees visible.
// branch_head, hr_admin, operations_manager, process_manager: must pass branch_id query param;
//   access is validated against user_assignment_scope via hasScopedAccess.
// window=online (default) → heartbeats in the last 15 min (currently on-shift).
// window=all             → last 24h, so offline workers still show at their last-known spot.
// window=<minutes>       → custom lookback (capped at 7 days).
// Each row carries a `stale` flag (1/0): 1 when the last fix is older than 15 min.
const ONLINE_WINDOW_MINUTES = 15;
const SCOPED_LIVE_ROLES = ["branch_head", "hr_admin", "operations_manager", "process_manager"];

router.get("/live", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;

  const isSuperAdmin = await hasAnyRole(userId, "super_admin");
  let branchIdFilter: string | null = null;

  if (!isSuperAdmin) {
    const hasScopedRole = await hasAnyRole(userId, ...SCOPED_LIVE_ROLES);
    if (!hasScopedRole) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    const branchIdParam = String(req.query.branch_id ?? "").trim();
    if (!branchIdParam) {
      return res.status(400).json({ success: false, error: "branch_id is required for your role" });
    }
    const allowed = await hasScopedAccess(userId, SCOPED_LIVE_ROLES, { branchId: branchIdParam });
    if (!allowed) {
      return res.status(403).json({ success: false, error: "Outside assigned scope" });
    }
    branchIdFilter = branchIdParam;
  }

  const windowParam = String(req.query.window ?? "online").toLowerCase();
  let minutes = ONLINE_WINDOW_MINUTES;
  if (windowParam === "all") {
    minutes = 24 * 60;
  } else if (windowParam !== "online") {
    const n = parseInt(windowParam, 10);
    if (Number.isFinite(n) && n > 0) minutes = Math.min(n, 7 * 24 * 60);
  }

  let query: string;
  let params: unknown[];

  if (branchIdFilter) {
    query = `SELECT
       ell.employee_id,
       ell.latitude,
       ell.longitude,
       ell.accuracy,
       ell.captured_at,
       ell.full_name,
       ell.branch_name,
       ell.process_name,
       ell.designation,
       (ell.captured_at < NOW() - INTERVAL ${ONLINE_WINDOW_MINUTES} MINUTE) AS stale
     FROM employee_live_location ell
     WHERE ell.captured_at >= NOW() - INTERVAL ? MINUTE
       AND ell.employee_id IN (SELECT id FROM employees WHERE branch_id = ? AND active_status = 1)
     ORDER BY ell.full_name ASC`;
    params = [minutes, branchIdFilter];
  } else {
    query = `SELECT
       ell.employee_id,
       ell.latitude,
       ell.longitude,
       ell.accuracy,
       ell.captured_at,
       ell.full_name,
       ell.branch_name,
       ell.process_name,
       ell.designation,
       (ell.captured_at < NOW() - INTERVAL ${ONLINE_WINDOW_MINUTES} MINUTE) AS stale
     FROM employee_live_location ell
     WHERE ell.captured_at >= NOW() - INTERVAL ? MINUTE
     ORDER BY ell.full_name ASC`;
    params = [minutes];
  }

  const [rows] = await db.execute<RowDataPacket[]>(query, params);
  return res.json({ success: true, data: rows });
}));

// GET /api/location/history/:employeeId?date=YYYY-MM-DD
// super_admin: unrestricted.
// Scoped roles: access validated against the employee's branch via hasScopedAccess.
// Ordered GPS trail for one employee on a given day (default: today, server time).
router.get("/history/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const employeeId = String(req.params.employeeId);

  const isSuperAdmin = await hasAnyRole(userId, "super_admin");
  if (!isSuperAdmin) {
    const hasScopedRole = await hasAnyRole(userId, ...SCOPED_LIVE_ROLES);
    if (!hasScopedRole) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    // Look up the employee's branch_id to enforce scope
    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT branch_id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1",
      [employeeId],
    );
    const emp = (empRows as RowDataPacket[])[0] as any;
    const empBranchId: string | null = emp?.branch_id ?? null;
    const allowed = await hasScopedAccess(userId, SCOPED_LIVE_ROLES, { branchId: empBranchId });
    if (!allowed) {
      return res.status(403).json({ success: false, error: "Outside assigned scope" });
    }
  }

  const dateParam  = String(req.query.date ?? "").trim();
  const dayFilter  = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;

  // dayExpr is either a bound "?" (validated date) or CURDATE(); it appears twice.
  const dayExpr = dayFilter ? "?" : "CURDATE()";
  const params  = dayFilter ? [employeeId, dayFilter, dayFilter] : [employeeId];

  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT latitude, longitude, accuracy, captured_at
         FROM employee_location_history
        WHERE employee_id = ?
          AND captured_at >= ${dayExpr}
          AND captured_at <  ${dayExpr} + INTERVAL 1 DAY
        ORDER BY captured_at ASC`,
      params,
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    // Table absent until migration 423 runs — degrade gracefully, don't 500.
    console.warn("[location] history query skipped:", (err as Error).message);
    return res.json({ success: true, data: [] });
  }
}));

export const locationRouter = router;
