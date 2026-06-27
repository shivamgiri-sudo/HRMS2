import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { toIST } from "../../shared/timezone.js";
import { getRealTimePunchesToday, getRealTimePunchesRange } from "./attendance-realtime-ncosec.service.js";

export const attendanceDailyScopedRouter = Router();
attendanceDailyScopedRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const DB_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/;

function safeId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value);
  if (!DB_ID_REGEX.test(v)) {
    const err = new Error(`Invalid ${field}`) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  return v;
}

attendanceDailyScopedRouter.get("/daily", h(async (req, res) => {
  const userId = req.authUser!.id;
  const isAdminHrWfm = await hasRole(userId, "admin", "hr", "wfm", "ceo");
  const isManager = await hasRole(userId, "manager", "assistant_manager", "tl");
  const callerEmp = await getEmployeeForUser(userId);

  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 200) || 200), 500);
  const offset = (page - 1) * limit;
  const params: unknown[] = [];
  const where: string[] = ["1=1"];

  if (!isAdminHrWfm) {
    if (!callerEmp?.id) return res.status(403).json({ success: false, error: "No employee record" });
    if (isManager) {
      where.push("(e.reporting_manager_id = ? OR e.manager_id = ? OR adr.employee_id = ?)");
      params.push(callerEmp.id, callerEmp.id, callerEmp.id);
    } else {
      where.push("adr.employee_id = ?");
      params.push(callerEmp.id);
    }
  } else if (req.query.employeeId) {
    const qEmpId = safeId(req.query.employeeId, "employeeId");
    if (qEmpId) {
      where.push("adr.employee_id = ?");
      params.push(qEmpId);
    }
  }

  const branchId = safeId(req.query.branchId, "branchId");
  const processId = safeId(req.query.processId, "processId");
  const costCentreId = safeId(req.query.costCentreId ?? req.query.costCenterId, "costCentreId");

  if (branchId) { where.push("COALESCE(adr.branch_id, e.branch_id) = ?"); params.push(branchId); }
  if (processId) { where.push("COALESCE(adr.process_id, e.process_id) = ?"); params.push(processId); }
  if (costCentreId) { where.push("e.cost_centre_id = ?"); params.push(costCentreId); }
  if (req.query.fromDate) { where.push("adr.record_date >= ?"); params.push(String(req.query.fromDate)); }
  if (req.query.toDate) { where.push("adr.record_date <= ?"); params.push(String(req.query.toDate)); }
  if (req.query.attendanceStatus) { where.push("adr.attendance_status = ?"); params.push(String(req.query.attendanceStatus)); }

  const fromSql = `
    FROM attendance_daily_record adr
    LEFT JOIN employees e ON e.id = adr.employee_id
    LEFT JOIN department_master dm ON dm.id = e.department_id
    LEFT JOIN branch_master bm ON bm.id = COALESCE(adr.branch_id, e.branch_id)
    LEFT JOIN process_master pm ON pm.id = COALESCE(adr.process_id, e.process_id)
    LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
  `;
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total ${fromSql} ${whereSql}`,
    params,
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.*,
            DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
            DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS date,
            adr.clock_in_time AS clock_in,
            adr.clock_out_time AS clock_out,
            ROUND(COALESCE(adr.raw_minutes, adr.biometric_minutes, adr.dialler_minutes, 0) / 60, 2) AS total_hours,
            adr.attendance_status AS status,
            adr.clock_in_location AS clock_in_location_name,
            adr.clock_out_location AS clock_out_location_name,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name,
            COALESCE(NULLIF(e.first_name, ''), NULLIF(e.full_name, ''), '') AS first_name,
            COALESCE(e.last_name, '') AS last_name,
            e.employee_code,
            e.working_hours_start,
            e.working_hours_end,
            dm.dept_name AS department_name,
            bm.branch_name,
            pm.process_name,
            ccm.cost_centre_name
       ${fromSql}
       ${whereSql}
      ORDER BY adr.record_date DESC, e.employee_code ASC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const data = rows.map((r: any) => ({
    ...r,
    clock_in_time:  toIST(r.clock_in_time),
    clock_out_time: toIST(r.clock_out_time),
    clock_in:       toIST(r.clock_in),
    clock_out:      toIST(r.clock_out),
    employee: {
      first_name: r.first_name ?? "",
      last_name: r.last_name ?? "",
      employee_code: r.employee_code ?? "",
      working_hours_start: r.working_hours_start ?? null,
      working_hours_end: r.working_hours_end ?? null,
    },
  }));

  return res.json({ success: true, data, total: Number(countRows[0]?.total ?? 0), page, limit });
}));

// GET /today-live — returns today's real-time punch data
// PRIMARY: Direct NCOSEC query for real-time visibility (5-10s latency)
// FALLBACK: Synced biometric_attendance_log if NCOSEC unavailable
// NOTE: This is DISPLAY ONLY - payroll calculations use validated sync pipeline
attendanceDailyScopedRouter.get("/today-live", h(async (req, res) => {
  const userId = req.authUser!.id;
  const callerEmp = await getEmployeeForUser(userId);
  if (!callerEmp?.id) return res.status(403).json({ success: false, error: "No employee record" });

  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  // Try real-time NCOSEC first
  try {
    const realtimeData = await getRealTimePunchesToday(callerEmp.id);
    if (realtimeData) {
      return res.json({
        success: true,
        data: {
          punch_date: realtimeData.punch_date,
          first_punch_in: realtimeData.first_punch_in,   // already IST-tagged by service
          last_punch_out: realtimeData.last_punch_out,   // already IST-tagged by service
          raw_minutes: realtimeData.raw_minutes,
          total_punches: realtimeData.total_punches,
          source: realtimeData.source,
        },
      });
    }
  } catch (ncosecError) {
    console.warn('[today-live] Real-time NCOSEC query failed, falling back to synced data:',
                 ncosecError instanceof Error ? ncosecError.message : String(ncosecError));
  }

  // Fallback to synced biometric_attendance_log
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT first_punch_in, last_punch_out, raw_minutes, total_punches
       FROM biometric_attendance_log
      WHERE employee_id = ? AND punch_date = ?
      ORDER BY migrated_at DESC
      LIMIT 1`,
    [callerEmp.id, todayStr],
  );

  const row = (rows as any[])[0] ?? null;
  if (!row) return res.json({ success: true, data: null });

  return res.json({
    success: true,
    data: {
      punch_date: todayStr,
      first_punch_in: toIST(row.first_punch_in),
      last_punch_out: toIST(row.last_punch_out),
      raw_minutes: row.raw_minutes ?? 0,
      total_punches: row.total_punches ?? 0,
      source: "biometric_synced",
    },
  });
}));

// GET /calendar-live — returns real-time punch data for date range (max 7 days)
// For attendance calendar display - bypasses sync for immediate visibility
attendanceDailyScopedRouter.get("/calendar-live", h(async (req, res) => {
  const userId = req.authUser!.id;
  const callerEmp = await getEmployeeForUser(userId);
  if (!callerEmp?.id) return res.status(403).json({ success: false, error: "No employee record" });

  const fromDate = String(req.query.fromDate || '');
  const toDate = String(req.query.toDate || '');

  if (!fromDate || !toDate) {
    return res.status(400).json({ success: false, error: "fromDate and toDate required" });
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
    return res.status(400).json({ success: false, error: "Dates must be in YYYY-MM-DD format" });
  }

  try {
    const realtimeData = await getRealTimePunchesRange(callerEmp.id, fromDate, toDate);

    const data = realtimeData.map(punch => ({
      punch_date: punch.punch_date,
      first_punch_in: punch.first_punch_in,   // already IST-tagged by service
      last_punch_out: punch.last_punch_out,   // already IST-tagged by service
      raw_minutes: punch.raw_minutes,
      total_punches: punch.total_punches,
      source: punch.source,
    }));

    return res.json({
      success: true,
      data,
      count: data.length,
    });
  } catch (error) {
    console.error('[calendar-live] Error:', error instanceof Error ? error.message : String(error));

    if (error instanceof Error && error.message.includes('limited to 7 days')) {
      return res.status(400).json({ success: false, error: error.message });
    }

    return res.status(503).json({
      success: false,
      error: "Real-time attendance data unavailable",
      message: "NCOSEC connection failed. Please try again or contact IT support.",
    });
  }
}));
