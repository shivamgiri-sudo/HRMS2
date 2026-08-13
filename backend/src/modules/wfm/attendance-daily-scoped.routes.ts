import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { toIST } from "../../shared/timezone.js";
import { composeIstDateTime } from "./apr-attendance.service.js";

/**
 * Whether mas_hrms.apr exists. The day-detail route already tolerates its
 * absence, so this list endpoint must too — without the check, an environment
 * without the table would 500 on every attendance query instead of simply
 * showing no APR login/logout. Probed once and cached.
 */
let aprTableExists: boolean | null = null;
async function hasAprTable(): Promise<boolean> {
  if (aprTableExists !== null) return aprTableExists;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr'`
    );
    aprTableExists = Number((rows[0] as any)?.c ?? 0) > 0;
  } catch {
    aprTableExists = false;
  }
  return aprTableExists;
}

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

/**
 * Extracted so wfm.routes.ts's colliding "/attendance/daily" (same full path,
 * `/api/wfm/attendance/daily` — earlier-mounted at app.ts:334, so it always
 * wins over this router's own mount at app.ts:516) can delegate to this exact
 * scoping logic for the one case it doesn't itself handle: no `employeeId`
 * given (self/team/branch/process scoped, multi-employee, single-date/range
 * query) — see the delegation call site in wfm.routes.ts for the full story.
 */
export async function scopedAttendanceDailyHandler(req: AuthenticatedRequest, res: any) {
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
  // Separate from fromSql (used by both the count and data queries) rather than adding
  // break_daily_summary to fromSql itself: bds shares several column names with
  // attendance_daily_record (employee_id, attendance_status, branch_id, process_id, ...),
  // and `adr.*` below already spreads all of adr's columns unqualified into the result —
  // adding bds to the shared FROM would risk a second, differently-timed edit here
  // reintroducing an unqualified reference that collides. Keeping the join local to the
  // one query that needs it (net_minutes) is the safer scope.
  const fromSqlWithBreaks = `${fromSql}
    LEFT JOIN break_daily_summary bds
      ON bds.employee_id = adr.employee_id AND bds.shift_date = adr.record_date
  `;
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total ${fromSql} ${whereSql}`,
    params,
  );

  // Dialler/APR days carry no punch times in attendance_daily_record, so
  // Login/Logout rendered empty for APR employees. Pull the real times from
  // mas_hrms.apr. Correlated subqueries (not a JOIN) because apr has one row per
  // campaign per day and a JOIN would fan the result out. Gated on
  // attendance_source so biometric rows skip the lookup entirely.
  const aprSelect = (await hasAprTable())
    ? `CASE WHEN adr.attendance_source = 'dialler' THEN (
              SELECT MIN(NULLIF(a.Login_Time, '00:00:00')) FROM apr a
               WHERE a.ReportDate = adr.record_date
                 AND a.UserID IN (e.call_centre_code, e.employee_code, e.biometric_code)
            ) END AS apr_login_time,
            CASE WHEN adr.attendance_source = 'dialler' THEN (
              SELECT MAX(NULLIF(a.Logout_Time, '00:00:00')) FROM apr a
               WHERE a.ReportDate = adr.record_date
                 AND a.UserID IN (e.call_centre_code, e.employee_code, e.biometric_code)
            ) END AS apr_logout_time,`
    : `NULL AS apr_login_time, NULL AS apr_logout_time,`;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.*,
            DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
            DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS date,
            adr.clock_in_time AS clock_in,
            adr.clock_out_time AS clock_out,
            -- The UI reads the source field to label rows and drive the
            -- All / Biometric / APR filter. Without this alias every row
            -- defaulted to biometric and APR days were indistinguishable.
            adr.attendance_source AS source,
            -- Dialler/APR days carry no punch times in attendance_daily_record,
            -- so Login/Logout rendered empty for APR employees. Pull the real
            -- times from mas_hrms.apr. Correlated subqueries (not a JOIN) because
            -- apr has one row per campaign per day and a JOIN would fan out.
            -- Gated on attendance_source so biometric rows skip the lookup.
            ${aprSelect}
            ROUND(COALESCE(adr.raw_minutes, adr.biometric_minutes, adr.dialler_minutes, 0) / 60, 2) AS total_hours,
            -- Net Hours = worked minutes less this day's kiosk-tracked break minutes,
            -- floored at 0. break_daily_summary is a 2026-07+ feature with sparse
            -- historical coverage (bds.total_break_minutes NULL on any day without a
            -- kiosk row) — COALESCE to 0 so those days net to their full worked minutes
            -- rather than showing a blank/wrong value.
            GREATEST(COALESCE(adr.raw_minutes, 0) - COALESCE(bds.total_break_minutes, 0), 0) AS net_minutes,
            adr.attendance_status,
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
       ${fromSqlWithBreaks}
       ${whereSql}
      ORDER BY adr.record_date DESC, e.employee_code ASC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const data = rows.map((r: any) => ({
    ...r,
    clock_in_time:  toIST(r.clock_in_time),
    clock_out_time: toIST(r.clock_out_time),
    // For dialler rows fall back to the APR login/logout. Those are MySQL TIME
    // values, so they are composed onto the record date and tagged IST — the
    // client must never receive a bare TIME where it expects a datetime.
    clock_in:       toIST(r.clock_in)  ?? composeIstDateTime(r.record_date, r.apr_login_time),
    clock_out:      toIST(r.clock_out) ?? composeIstDateTime(r.record_date, r.apr_logout_time),
    source:         r.source ?? r.attendance_source ?? "biometric",
    employee: {
      first_name: r.first_name ?? "",
      last_name: r.last_name ?? "",
      employee_code: r.employee_code ?? "",
      working_hours_start: r.working_hours_start ?? null,
      working_hours_end: r.working_hours_end ?? null,
    },
  }));

  return res.json({ success: true, data, total: Number(countRows[0]?.total ?? 0), page, limit });
}

attendanceDailyScopedRouter.get("/daily", h(scopedAttendanceDailyHandler));
