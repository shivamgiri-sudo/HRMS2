import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { toIST } from "../../shared/timezone.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";

export const biometricSummaryRouter = Router();
biometricSummaryRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

function dateValue(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function limitValue(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 1000) : fallback;
}

function commonWhere(query: any, params: any[]) {
  const clauses = ["adr.record_date BETWEEN ? AND ?"];
  params.push(dateValue(query.from, monthStart()), dateValue(query.to, today()));
  if (query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(query.branchId)); }
  if (query.processId) { clauses.push("e.process_id = ?"); params.push(String(query.processId)); }
  if (query.costCentreId) { clauses.push("e.cost_centre_id = ?"); params.push(String(query.costCentreId)); }
  if (query.managerId) { clauses.push("e.reporting_manager_id = ?"); params.push(String(query.managerId)); }
  if (query.employeeId) { clauses.push("e.id = ?"); params.push(String(query.employeeId)); }
  return clauses.join(" AND ");
}

const roleGuard = requireRole("admin", "hr", "wfm", "manager", "process_manager", "team_leader", "ceo", "finance", "payroll");

// Roles that must have scope auto-injected if not explicitly passed
const RESTRICTED_SCOPE_ROLES = new Set(["manager", "process_manager", "team_leader", "tl", "wfm"]);

/**
 * For non-admin callers who haven't passed explicit branchId/processId,
 * auto-inject their own employee's branch/process from mas_hrms.
 * Mutates req.query in-place so downstream commonWhere picks it up.
 */
async function injectScopeIfNeeded(req: any): Promise<void> {
  const userId = req.authUser?.id;
  if (!userId) return;
  const ctx = await getUserRoleContext(userId);
  if (ctx.isSuperAdmin || ctx.isHO || ctx.roleKeys.includes("ceo") || ctx.roleKeys.includes("finance") || ctx.roleKeys.includes("hr")) return;
  if (!ctx.roleKeys.some(r => RESTRICTED_SCOPE_ROLES.has(r))) return;
  // Only inject if caller didn't pass explicit scope params
  if (req.query.branchId || req.query.processId) return;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [userId]
  );
  const emp = (rows as any[])[0];
  if (emp?.branch_id) req.query.branchId = String(emp.branch_id);
  if (emp?.process_id) req.query.processId = String(emp.process_id);
}

biometricSummaryRouter.get("/adherence-summary", roleGuard, h(async (req: any, res: any) => {
  await injectScopeIfNeeded(req);
  const params: any[] = [];
  const where = commonWhere(req.query, params);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS mandate_agent_days,
            SUM(adr.attendance_status = 'present') AS present_days,
            SUM(adr.attendance_status = 'half_day') AS half_days,
            SUM(adr.attendance_status = 'absent') AS absent_days,
            SUM(adr.late_mark = 1) AS late_days,
            SUM(adr.work_mode IN ('wfh','remote')) AS wfh_days,
            ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS adherence_pct,
            ROUND(SUM(adr.late_mark = 1) * 100.0 / NULLIF(COUNT(*), 0), 2) AS late_pct,
            ROUND(SUM(adr.attendance_status = 'absent') * 100.0 / NULLIF(COUNT(*), 0), 2) AS shrinkage_pct,
            ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS on_time_in_pct,
            ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS on_time_out_pct,
            ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS weekly_compliance_pct,
            ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS biometric_compliance_pct,
            SUM(CASE WHEN adr.clock_in_time IS NOT NULL AND adr.clock_out_time IS NULL AND adr.attendance_status NOT IN ('absent','week_off','holiday') THEN 1 ELSE 0 END) AS missed_out,
            SUM(CASE WHEN adr.clock_in_time IS NULL AND adr.attendance_status NOT IN ('absent','week_off','holiday') THEN 1 ELSE 0 END) AS missed_in,
            SUM(CASE WHEN adr.clock_in_time IS NOT NULL AND adr.clock_out_time IS NOT NULL THEN 1 ELSE 0 END) AS valid_punch,
            0 AS multiple_punch,
            0 AS invalid_punch,
            SUM(CASE WHEN adr.late_by_minutes > 30 THEN 1 ELSE 0 END) AS variance_0_1,
            SUM(CASE WHEN adr.late_by_minutes > 60 AND adr.late_by_minutes <= 240 THEN 1 ELSE 0 END) AS variance_1_4,
            SUM(CASE WHEN adr.late_by_minutes > 240 THEN 1 ELSE 0 END) AS variance_4_plus,
            ROUND(SUM(COALESCE(adr.raw_minutes,0)) / 60, 2) AS total_ot_hours,
            COUNT(DISTINCT CASE WHEN adr.raw_minutes > 480 THEN adr.employee_id END) AS overtime_employees,
            ROUND((SUM(CASE WHEN adr.raw_minutes > 480 THEN adr.raw_minutes - 480 ELSE 0 END)) / 60, 2) AS overtime_hours
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
      WHERE ${where}`,
    params,
  );

  // Live counts: on_leave and working_remotely (today only)
  const [liveRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(DISTINCT employee_id) FROM leave_request
        WHERE status = 'approved' AND CURDATE() BETWEEN start_date AND end_date) AS on_leave,
       (SELECT COUNT(DISTINCT adr2.employee_id) FROM attendance_daily_record adr2
        WHERE adr2.record_date = CURDATE() AND adr2.work_mode IN ('wfh','remote')) AS working_remotely`,
    []
  ).catch(() => [[{ on_leave: 0, working_remotely: 0 }]] as any);

  // Regularization summary (pending/approved/rejected/cancelled)
  const [regRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(status = 'pending') AS pending,
       SUM(status = 'approved') AS approved,
       SUM(status = 'rejected') AS rejected,
       SUM(status = 'cancelled') AS cancelled,
       SUM(request_type = 'late_in') AS late_in,
       SUM(request_type = 'early_out') AS early_out,
       SUM(request_type IN ('missed_punch','missing_punch')) AS missed_punch
     FROM attendance_regularization_request`,
    []
  ).catch(() => [[{}]] as any);

  // Shift summary — breakdown by shift timing
  const [shiftRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(NULLIF(sm.shift_name, ''), adr.shift_code, 'Default') AS shift_name,
       COUNT(DISTINCT adr.employee_id) AS total,
       SUM(adr.attendance_status IN ('present','half_day')) AS present,
       SUM(adr.attendance_status = 'absent') AS absent,
       SUM(adr.late_mark = 1) AS late,
       ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(DISTINCT adr.employee_id), 0), 2) AS coverage_pct
     FROM attendance_daily_record adr
     JOIN employees e ON e.id = adr.employee_id
     LEFT JOIN shift_master sm ON sm.id = adr.shift_id
     WHERE ${where}
     GROUP BY COALESCE(NULLIF(sm.shift_name, ''), adr.shift_code, 'Default')
     ORDER BY total DESC
     LIMIT 10`,
    params,
  ).catch(() => [[]] as any);

  // Late arrival trend — hourly buckets for today
  const todayParams: any[] = [today(), today()];
  const [lateArrivalRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       HOUR(adr.clock_in_time) AS hour_bucket,
       COUNT(*) AS count
     FROM attendance_daily_record adr
     JOIN employees e ON e.id = adr.employee_id
     WHERE adr.record_date = ? AND adr.late_mark = 1 AND adr.clock_in_time IS NOT NULL
       AND adr.record_date = ?
     GROUP BY HOUR(adr.clock_in_time)
     ORDER BY hour_bucket`,
    todayParams,
  ).catch(() => [[]] as any);

  // Roster coverage buckets — fully/partially/understaffed by process today
  const [rosterCoverageRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN present_pct >= 90 THEN 1 ELSE 0 END) AS fully_covered,
       SUM(CASE WHEN present_pct >= 70 AND present_pct < 90 THEN 1 ELSE 0 END) AS partially_covered,
       SUM(CASE WHEN present_pct < 70 THEN 1 ELSE 0 END) AS understaffed
     FROM (
       SELECT
         e.process_id,
         ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS present_pct
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       WHERE adr.record_date = (SELECT MAX(record_date) FROM attendance_daily_record WHERE record_date <= CURDATE())
         AND e.process_id IS NOT NULL
       GROUP BY e.process_id
     ) process_pcts`,
    [],
  ).catch(() => [[{ fully_covered: 0, partially_covered: 0, understaffed: 0 }]] as any);

  const summary = rows[0] ?? {};
  const live = liveRows[0] ?? {};
  const reg = regRows[0] ?? {};
  const coverage = (rosterCoverageRows as any[])[0] ?? {};

  return res.json({
    success: true,
    data: {
      ...summary,
      ...live,
      fully_covered: Number(coverage.fully_covered ?? 0),
      partially_covered: Number(coverage.partially_covered ?? 0),
      understaffed: Number(coverage.understaffed ?? 0),
      shift_summary: (shiftRows as any[]).map((row: any) => ({
        shift_name: String(row.shift_name),
        total: Number(row.total ?? 0),
        present: Number(row.present ?? 0),
        absent: Number(row.absent ?? 0),
        late: Number(row.late ?? 0),
        coverage_pct: row.coverage_pct !== null ? Number(row.coverage_pct) : null,
      })),
      late_arrival_trend: (lateArrivalRows as any[]).map((row: any) => ({
        label: `${String(row.hour_bucket).padStart(2, "0")}:00`,
        value: Number(row.count ?? 0),
      })),
      regularization_summary: {
        pending: Number(reg.pending ?? 0),
        approved: Number(reg.approved ?? 0),
        rejected: Number(reg.rejected ?? 0),
        cancelled: Number(reg.cancelled ?? 0),
        late_in: Number(reg.late_in ?? 0),
        early_out: Number(reg.early_out ?? 0),
        missed_punch: Number(reg.missed_punch ?? 0),
      },
    },
  });
}));

biometricSummaryRouter.get("/agent-view", roleGuard, h(async (req: any, res: any) => {
  await injectScopeIfNeeded(req);
  const params: any[] = [];
  const where = commonWhere(req.query, params);
  const limit = limitValue(req.query.limit, 500);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
            COUNT(*) AS working_days,
            SUM(adr.attendance_status = 'present') AS present_days,
            SUM(adr.attendance_status = 'half_day') AS half_days,
            SUM(adr.attendance_status = 'absent') AS absent_days,
            SUM(adr.late_mark = 1) AS late_days,
            ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS adherence_pct,
            ROUND(SUM(adr.late_mark = 1) * 100.0 / NULLIF(COUNT(*), 0), 2) AS late_pct,
            ROUND(SUM(COALESCE(adr.biometric_minutes, adr.raw_minutes, 0)) / 60, 2) AS total_biometric_hours
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
      WHERE ${where}
      GROUP BY e.id, e.employee_code, employee_name
      ORDER BY late_days DESC, employee_name ASC
      LIMIT ${limit}`,
    params,
  );
  return res.json({ success: true, data: rows, meta: { count: rows.length } });
}));

biometricSummaryRouter.get("/reconciliation", roleGuard, h(async (req: any, res: any) => {
  await injectScopeIfNeeded(req);
  const params: any[] = [];
  const where = commonWhere(req.query, params);
  const limit = limitValue(req.query.limit, 500);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.record_date,
            e.id AS employee_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
            adr.attendance_status,
            adr.lwp_value,
            adr.late_mark,
            adr.late_by_minutes,
            adr.clock_in_time,
            adr.clock_out_time,
            adr.biometric_minutes,
            ibd.first_punch,
            ibd.last_punch,
            ibd.biometric_minutes AS imported_biometric_minutes
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
      WHERE ${where}
      ORDER BY adr.record_date DESC, employee_name ASC
      LIMIT ${limit}`,
    params,
  );
  const data = rows.map((row: any) => ({
    ...row,
    clock_in_time:  toIST(row.clock_in_time),
    clock_out_time: toIST(row.clock_out_time),
    first_punch:    toIST(row.first_punch),
    last_punch:     toIST(row.last_punch),
    mismatch_type: !row.first_punch && ["present", "half_day"].includes(String(row.attendance_status))
      ? "NO_BIOMETRIC_FOR_PRESENT"
      : row.first_punch && String(row.attendance_status) === "absent"
        ? "PUNCHED_BUT_ABSENT"
        : null,
  }));
  return res.json({ success: true, data, meta: { count: data.length } });
}));
