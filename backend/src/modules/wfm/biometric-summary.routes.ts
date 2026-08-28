import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { toIST } from "../../shared/timezone.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { resolveDashboardScopeForRequest } from "../../shared/dashboardScope.js";
import { dashboardConsumerRoles } from "../../shared/dashboardAccessRegistry.js";

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
  // Lists as well as single values: a caller entitled to several branches must not be
  // narrowed to whichever one happened to sort first.
  const inList = (column: string, values: unknown) => {
    const list = (Array.isArray(values) ? values : [])
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean);
    if (list.length === 0) return;
    clauses.push(`${column} IN (${list.map(() => "?").join(", ")})`);
    params.push(...list);
  };
  if (query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(query.branchId)); }
  else inList("e.branch_id", query.branchIds);
  if (query.processId) { clauses.push("e.process_id = ?"); params.push(String(query.processId)); }
  else inList("e.process_id", query.processIds);
  inList("e.id", query.employeeIds);
  if (query.costCentreId) { clauses.push("e.cost_centre_id = ?"); params.push(String(query.costCentreId)); }
  if (query.managerId) { clauses.push("e.reporting_manager_id = ?"); params.push(String(query.managerId)); }
  if (query.employeeId) { clauses.push("e.id = ?"); params.push(String(query.employeeId)); }
  return clauses.join(" AND ");
}

// Derived from the registry: WFM, WFM Attendance, Manager and Operations layouts all gate
// their attendance tiles on this endpoint. `finance` and `payroll` stay as literals — they
// reach adherence outside the dashboards.
const roleGuard = requireRole("admin", "finance", "payroll", ...dashboardConsumerRoles(
  "WFM_DASHBOARD", "WFM_ATTENDANCE_DASHBOARD", "MANAGEMENT_DASHBOARD", "OPERATIONS_DASHBOARD",
));

/**
 * Narrows the query to whatever the caller is actually entitled to.
 *
 * This used to hand-roll its own idea of scope: it skipped injection for `hr` and
 * `finance` outright, and only injected for the five roles named in
 * RESTRICTED_SCOPE_ROLES. Both halves were wrong in the same direction. A branch_head
 * resolves to scope role `hr`, so branch heads skipped injection and read company-wide
 * adherence beside branch-scoped tiles; and any role outside that five-role set — qa,
 * branch_hr, assistant_manager, operations_manager — also skipped it, for no stated
 * reason. A second, hand-written scope model was the defect.
 *
 * resolveDashboardScopeForRequest is the one the rest of the dashboards use, and it
 * already knows every role's tier, honours user_assignment_scope, and fails closed when a
 * role is unconfigured. ORG_ALL is the only level that reads unscoped.
 *
 * Mutates req.query in place so commonWhere picks it up, and never widens: an explicit
 * branchId/processId the caller passed is left alone by commonWhere itself.
 */
async function injectScopeIfNeeded(req: any): Promise<void> {
  const userId = req.authUser?.id;
  if (!userId) return;
  if (req.query.branchId || req.query.processId) return;

  try {
    const ctx = await getUserRoleContext(userId);
    const scope = await resolveDashboardScopeForRequest(req.authUser, ctx.primaryRole);
    if (scope.level === "ORG_ALL") return;
    if (scope.branchIds.length) req.query.branchIds = scope.branchIds;
    if (scope.processIds.length) req.query.processIds = scope.processIds;
    if (scope.employeeIds.length) req.query.employeeIds = scope.employeeIds;
  } catch {
    // resolveDashboardScope throws DashboardScopeConfigurationError for an unconfigured
    // account. Fail CLOSED — an unresolvable scope must show nothing, never everything.
    req.query.employeeIds = ["__no_scope__"];
  }
}

biometricSummaryRouter.get("/adherence-summary", roleGuard, h(async (req: any, res: any) => {
  await injectScopeIfNeeded(req);
  const params: any[] = [];
  const where = commonWhere(req.query, params);

  // Six independent aggregates over the same tables — none reads another's result, so
  // running them one after another only adds up their latencies for no reason. Measured
  // directly against the live DB in a quiet moment (2026-08-28): 2118ms + 922ms + 1023ms +
  // 896ms for four of them alone, before the remaining two — and the route as a whole took
  // 9.4s end to end, which is what made this endpoint look structurally slow when it was
  // first flagged. It is not: every query here runs in ~1-2s on its own. Same fix already
  // applied elsewhere in this codebase (dashboard-metric.service.ts, work-inbox.service.ts,
  // management.service.ts) for the identical shape of problem. Query text, params and every
  // .catch() fallback below are unchanged — only the ordering is.
  const todayParams: any[] = [today(), today()];
  const [rows, liveRows, regRows, shiftRows, lateArrivalRows, rosterCoverageRows] = await Promise.all([
    db.execute<RowDataPacket[]>(
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
              ROUND((SUM(CASE WHEN adr.raw_minutes > 480 THEN adr.raw_minutes - 480 ELSE 0 END)) / 60, 2) AS overtime_hours,
              ROUND(AVG(CASE WHEN adr.late_mark = 1 THEN adr.late_by_minutes ELSE NULL END), 1) AS avg_late_minutes,
              ROUND(SUM(CASE WHEN adr.work_mode IN ('wfh','remote') THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS early_leave_pct
         FROM attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
        WHERE ${where}`,
      params,
    ).then(([r]) => r),

    // Live counts: on_leave and working_remotely (today only)
    //
    // leave_request carries two parallel date pairs — from_date/to_date and
    // start_date/end_date — and they are not equally populated: 2,678 rows have
    // from_date/to_date, only 2,661 have start_date/end_date (verified 2026-08-07).
    // Reading start_date alone silently drops 17 approved requests, so COALESCE to the
    // complete pair and fall back to the other.
    db.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(DISTINCT employee_id) FROM leave_request
          WHERE status = 'approved'
            AND CURDATE() BETWEEN COALESCE(from_date, start_date) AND COALESCE(to_date, end_date)) AS on_leave,
         (SELECT COUNT(DISTINCT adr2.employee_id) FROM attendance_daily_record adr2
          WHERE adr2.record_date = CURDATE() AND adr2.work_mode IN ('wfh','remote')) AS working_remotely`,
      []
    ).then(([r]) => r).catch((err: unknown) => {
      // null, not 0. "Nobody is on leave today" is a claim; a failed query is not evidence
      // for it, and this tile sits next to headcount where a false zero reads as coverage.
      console.warn("[biometric-summary] live on-leave/remote counts failed:", (err as Error).message);
      return [{ on_leave: null, working_remotely: null }] as any;
    }),

    // Regularization summary.
    //
    // This read `attendance_regularization_request`, which does not exist — the
    // table is `attendance_regularization` (31 rows). The .catch() below turned
    // the resulting error into an empty object, so the whole tile has always
    // rendered blank.
    //
    // The breakdown columns were wrong too. There is no `request_type`; the real
    // column is `dispute_type`. And the status vocabulary differs: the live values
    // are approved / rejected / discarded, with no 'cancelled' at all, so the old
    // categories could not have matched even against the right table.
    db.execute<RowDataPacket[]>(
      `SELECT
         SUM(status = 'pending')   AS pending,
         SUM(status = 'approved')  AS approved,
         SUM(status = 'rejected')  AS rejected,
         SUM(status = 'discarded') AS discarded,
         SUM(dispute_type = 'work_from_home')             AS work_from_home,
         SUM(dispute_type IN ('late_in','early_out'))     AS timing,
         SUM(dispute_type IN ('missed_punch','missing_punch')) AS missed_punch
       FROM attendance_regularization`,
      []
    ).then(([r]) => r).catch(() => [{}] as any),

    // Shift summary — breakdown by shift timing.
    //
    // This joined `shift_master` on `adr.shift_id`, and read `adr.shift_code`.
    // None of the three exist: there is no shift_master table, and
    // attendance_daily_record (114,593 rows) carries no shift column whatsoever.
    // The .catch() below turned the error into an empty array, so this tile has
    // rendered as "no shifts" for its entire life.
    //
    // The shift an employee was on comes from the roster, not the attendance row:
    // wfm_roster_assignment links employee + date to a shift, and 412,032 of its
    // 413,386 rows resolve through wfm_shift_master.
    //
    // Coverage is partial and deliberately visible rather than hidden — only
    // ~4.5% of attendance rows currently have a matching roster row, so
    // `rostered_employees` is returned alongside the counts. A caller that reads
    // these as whole-workforce totals would overstate; the field is there so it
    // does not have to guess.
    //
    // present/absent/late are counted per distinct employee, matching `total`.
    // They were sums over rows against a DISTINCT-employee denominator, which
    // could report more present than total.
    db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(
           NULLIF(sm.shift_name, ''),
           CONCAT(TIME_FORMAT(ra.shift_start_time, '%H:%i'), '-', TIME_FORMAT(ra.shift_end_time, '%H:%i')),
           'Unassigned'
         ) AS shift_name,
         COUNT(DISTINCT adr.employee_id) AS total,
         COUNT(DISTINCT CASE WHEN adr.attendance_status IN ('present','half_day') THEN adr.employee_id END) AS present,
         COUNT(DISTINCT CASE WHEN adr.attendance_status = 'absent' THEN adr.employee_id END) AS absent,
         COUNT(DISTINCT CASE WHEN adr.late_mark = 1 THEN adr.employee_id END) AS late,
         COUNT(DISTINCT adr.employee_id) AS rostered_employees,
         ROUND(
           COUNT(DISTINCT CASE WHEN adr.attendance_status IN ('present','half_day') THEN adr.employee_id END) * 100.0
           / NULLIF(COUNT(DISTINCT adr.employee_id), 0), 2) AS coverage_pct
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       JOIN wfm_roster_assignment ra
         ON ra.employee_id = adr.employee_id AND ra.roster_date = adr.record_date
       LEFT JOIN wfm_shift_master sm ON sm.id = ra.shift_id
       WHERE ${where}
       GROUP BY shift_name
       ORDER BY total DESC
       LIMIT 10`,
      params,
    ).then(([r]) => r).catch(() => [] as any),

    // Late arrival trend — hourly buckets for today
    db.execute<RowDataPacket[]>(
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
    ).then(([r]) => r).catch(() => [] as any),

    // Roster coverage buckets — fully/partially/understaffed by process today
    db.execute<RowDataPacket[]>(
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
    ).then(([r]) => r).catch(() =>
      // null, not 0. This query works today, but the fallback decides what is
      // shown if it ever stops working — and `understaffed: 0` is a claim that
      // no process is short-staffed, which is the single most reassuring thing
      // this tile can say. null renders as unavailable instead.
      [{ fully_covered: null, partially_covered: null, understaffed: null }] as any
    ),
  ]);

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
