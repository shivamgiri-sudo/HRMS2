import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReconciliationRecord {
  id: string;
  employee_id: string;
  roster_date: string;
  roster_cycle_id: string | null;
  planned_shift_start: string | null;
  planned_shift_end: string | null;
  required_minutes: number;
  actual_login_time: string | null;
  actual_logout_time: string | null;
  actual_minutes: number;
  break_minutes: number;
  productive_minutes: number;
  attendance_status: string;
  adherence_pct: number;
  late_by_minutes: number;
  early_exit_minutes: number;
  regularization_id: string | null;
  reconciled_at: string | null;
}

export interface ShrinkageSnapshot {
  id: string;
  snapshot_date: string;
  process_id: string | null;
  branch_id: string | null;
  rostered_hc: number;
  present_hc: number;
  absent_hc: number;
  on_leave_hc: number;
  late_count: number;
  planned_shrinkage_pct: number;
  unplanned_shrinkage_pct: number;
  total_shrinkage_pct: number;
  avg_adherence_pct: number;
  attendance_locked: number;
}

export interface AdherenceAlert {
  id: string;
  alert_date: string;
  alert_type: string;
  severity: string;
  employee_id: string | null;
  process_id: string | null;
  actual_pct: number | null;
  breach_minutes: number | null;
  status: string;
  created_at: string;
}

export interface PayrollReadinessFlag {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  working_days: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  lwp_days: number;
  status: string;
}

// ─── Attendance Reconciliation Service ───────────────────────────────────────

export const reconciliationService = {
  /**
   * Reconcile attendance for a date range across a process/branch.
   * Compares wfm_roster_assignment against wfm_attendance_session.
   * Upserts attendance_reconciliation_record rows.
   */
  async reconcileDate(
    date: string,
    opts: { processName?: string; branchName?: string; userId: string }
  ): Promise<{ reconciled: number; absent: number; unresolved: number }> {
    // Get rostered employees for this date
    const [rosterRows] = await db.execute<RowDataPacket[]>(
      `SELECT ra.employee_id, ra.shift_start_time, ra.shift_end_time, ra.plan_id,
              sm.required_minutes, sm.start_time AS sm_start, sm.end_time AS sm_end
       FROM wfm_roster_assignment ra
       LEFT JOIN wfm_shift_master sm ON sm.id = ra.shift_id
       WHERE ra.roster_date = ?
         AND ra.publish_status = 'published'
         ${opts.processName ? "AND ra.process_name = ?" : ""}
         ${opts.branchName  ? "AND ra.branch_name = ?"  : ""}`,
      [date, ...(opts.processName ? [opts.processName] : []), ...(opts.branchName ? [opts.branchName] : [])]
    );

    const [sessionRows] = await db.execute<RowDataPacket[]>(
      `SELECT s.employee_id, s.login_time, s.logout_time, s.total_login_minutes,
              s.current_status, s.punch_source
       FROM wfm_attendance_session s
       WHERE s.session_date = ?`,
      [date]
    );

    // Get approved leaves for this date
    const [leaveRows] = await db.execute<RowDataPacket[]>(
      `SELECT lr.employee_id FROM leave_request lr
       WHERE lr.status = 'approved'
         AND lr.from_date <= ? AND lr.to_date >= ?`,
      [date, date]
    );

    const sessionMap = new Map<string, RowDataPacket>(
      (sessionRows as RowDataPacket[]).map((s) => [s.employee_id as string, s])
    );
    const onLeaveSet = new Set<string>(
      (leaveRows as RowDataPacket[]).map((l) => l.employee_id as string)
    );

    let reconciled = 0, absent = 0, unresolved = 0;

    for (const roster of rosterRows as RowDataPacket[]) {
      const empId = roster.employee_id as string;
      const session = sessionMap.get(empId);
      const isOnLeave = onLeaveSet.has(empId);

      const requiredMins = Number(roster.required_minutes ?? 480);
      const shiftStart = roster.shift_start_time ?? roster.sm_start ?? null;
      const shiftEnd   = roster.shift_end_time   ?? roster.sm_end   ?? null;

      let status: string;
      let actualMins = 0;
      let breakMins  = 0;
      let productiveMins = 0;
      let lateBy = 0;
      let earlyExit = 0;
      let adherencePct = 0;

      if (isOnLeave) {
        status = "leave_approved";
      } else if (!session || !session.login_time) {
        status = "absent";
        absent++;
      } else {
        actualMins    = Number(session.total_login_minutes ?? 0);
        productiveMins = actualMins; // break deducted separately
        adherencePct   = requiredMins > 0 ? Math.min(100, Math.round((actualMins / requiredMins) * 100)) : 0;

        // Late arrival
        if (shiftStart && session.login_time) {
          const planned = new Date(`${date}T${shiftStart}`);
          const actual  = new Date(session.login_time as string);
          lateBy = Math.max(0, Math.round((actual.getTime() - planned.getTime()) / 60000));
        }

        // Early exit
        if (shiftEnd && session.logout_time) {
          const planned = new Date(`${date}T${shiftEnd}`);
          const actual  = new Date(session.logout_time as string);
          earlyExit = Math.max(0, Math.round((planned.getTime() - actual.getTime()) / 60000));
        }

        if (adherencePct >= 90) status = "present";
        else if (adherencePct >= 50) status = "half_day";
        else if (lateBy > 30) status = "late";
        else status = "present";

        reconciled++;
      }

      await db.execute(
        `INSERT INTO attendance_reconciliation_record
           (id, employee_id, roster_date, roster_cycle_id,
            planned_shift_start, planned_shift_end, required_minutes,
            actual_login_time, actual_logout_time, actual_minutes,
            break_minutes, productive_minutes, attendance_status,
            adherence_pct, late_by_minutes, early_exit_minutes,
            reconciled_at, reconciled_by)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           actual_login_time    = VALUES(actual_login_time),
           actual_logout_time   = VALUES(actual_logout_time),
           actual_minutes       = VALUES(actual_minutes),
           productive_minutes   = VALUES(productive_minutes),
           attendance_status    = VALUES(attendance_status),
           adherence_pct        = VALUES(adherence_pct),
           late_by_minutes      = VALUES(late_by_minutes),
           early_exit_minutes   = VALUES(early_exit_minutes),
           reconciled_at        = NOW(),
           reconciled_by        = VALUES(reconciled_by)`,
        [
          empId, date, roster.plan_id ?? null,
          shiftStart, shiftEnd, requiredMins,
          session?.login_time ?? null,
          session?.logout_time ?? null,
          actualMins, breakMins, productiveMins, status,
          adherencePct, lateBy, earlyExit, opts.userId,
        ]
      );
    }

    return { reconciled, absent, unresolved };
  },

  async listReconciliation(filters: {
    fromDate: string; toDate: string;
    employeeId?: string; processId?: string; processName?: string; status?: string;
    page: number; limit: number;
  }) {
    const conds: string[] = ["r.roster_date BETWEEN ? AND ?"];
    const params: unknown[] = [filters.fromDate, filters.toDate];
    if (filters.employeeId)  { conds.push("r.employee_id = ?");           params.push(filters.employeeId); }
    if (filters.processId)   { conds.push("e.process_id = ?");            params.push(filters.processId); }
    if (filters.processName) { conds.push("ra.process_name = ?");         params.push(filters.processName); }
    if (filters.status)      { conds.push("r.attendance_status = ?");     params.push(filters.status); }

    const offset = (filters.page - 1) * filters.limit;
    const where = conds.join(" AND ");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
              e.employee_code, ra.process_name, ra.branch_name
       FROM attendance_reconciliation_record r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN wfm_roster_assignment ra ON ra.employee_id = r.employee_id AND ra.roster_date = r.roster_date
       WHERE ${where}
        ORDER BY r.roster_date DESC, e.employee_code
        LIMIT ${filters.limit} OFFSET ${offset}`,
      params
    );

    const [cnt] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM attendance_reconciliation_record r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN wfm_roster_assignment ra ON ra.employee_id = r.employee_id AND ra.roster_date = r.roster_date
       WHERE ${where}`,
      params
    );

    return { data: rows as ReconciliationRecord[], total: Number((cnt as RowDataPacket[])[0]?.total ?? 0), page: filters.page, limit: filters.limit };
  },
};

export async function getLiveAttendanceSummary(
  requestedDate: string,
  filters: { processId?: string; branchId?: string }
) {
  const filterSql = `${filters.processId ? " AND adr.process_id = ?" : ""}${filters.branchId ? " AND adr.branch_id = ?" : ""}`;
  const filterParams = [
    ...(filters.processId ? [filters.processId] : []),
    ...(filters.branchId ? [filters.branchId] : []),
  ];

  const [requestedCount] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM attendance_daily_record adr
      WHERE adr.record_date = ?${filterSql}`,
    [requestedDate, ...filterParams]
  );

  let dataDate = requestedDate;
  let isLatestAvailable = false;
  if (Number(requestedCount[0]?.total ?? 0) === 0) {
    const [latest] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(MAX(adr.record_date), '%Y-%m-%d') AS data_date
         FROM attendance_daily_record adr
        WHERE 1=1${filterSql}`,
      filterParams
    );
    const rawDate = latest[0]?.data_date;
    if (rawDate) {
      dataDate = String(rawDate);
      isLatestAvailable = dataDate !== requestedDate;
    }
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS rostered,
       SUM(CASE WHEN adr.attendance_status IN ('present','half_day') THEN 1 ELSE 0 END) AS logged_in,
       SUM(CASE WHEN adr.clock_out_time IS NOT NULL THEN 1 ELSE 0 END) AS logged_out,
       SUM(CASE WHEN adr.attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent,
       SUM(CASE WHEN adr.late_mark = 1 THEN 1 ELSE 0 END) AS late_count,
       ROUND(AVG(LEAST(100, (COALESCE(adr.raw_minutes, 0) / 480) * 100)), 1) AS adherence_pct
     FROM attendance_daily_record adr
     WHERE adr.record_date = ?${filterSql}`,
    [dataDate, ...filterParams]
  );

  return {
    ts: Date.now(),
    requested_date: requestedDate,
    data_date: dataDate,
    is_latest_available: isLatestAvailable,
    rostered: Number(rows[0]?.rostered ?? 0),
    logged_in: Number(rows[0]?.logged_in ?? 0),
    logged_out: Number(rows[0]?.logged_out ?? 0),
    absent: Number(rows[0]?.absent ?? 0),
    late_count: Number(rows[0]?.late_count ?? 0),
    adherence_pct: Number(rows[0]?.adherence_pct ?? 0),
  };
}

// ─── Shrinkage Service ────────────────────────────────────────────────────────

export const shrinkageService = {
  async calculateSnapshot(
    date: string,
    opts: { processId?: string; branchId?: string; userId: string }
  ): Promise<ShrinkageSnapshot> {
    // Get reconciliation stats for this date/process
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT attendance_status, COUNT(*) AS cnt
       FROM attendance_reconciliation_record r
       LEFT JOIN wfm_roster_assignment ra ON ra.employee_id = r.employee_id AND ra.roster_date = r.roster_date
       WHERE r.roster_date = ?
         ${opts.processId ? "AND ra.process_id = ?" : ""}
         ${opts.branchId  ? "AND ra.branch_id = ?"  : ""}
       GROUP BY attendance_status`,
      [date, ...(opts.processId ? [opts.processId] : []), ...(opts.branchId ? [opts.branchId] : [])]
    );

    const [adhRows] = await db.execute<RowDataPacket[]>(
      `SELECT AVG(adherence_pct) AS avg_adh, AVG(productive_minutes) AS avg_prod,
              SUM(break_minutes) AS total_break,
              SUM(CASE WHEN late_by_minutes > 10 THEN 1 ELSE 0 END) AS late_count
       FROM attendance_reconciliation_record r
       LEFT JOIN wfm_roster_assignment ra ON ra.employee_id = r.employee_id AND ra.roster_date = r.roster_date
       WHERE r.roster_date = ?
         ${opts.processId ? "AND ra.process_id = ?" : ""}`,
      [date, ...(opts.processId ? [opts.processId] : [])]
    );

    const statusMap: Record<string, number> = {};
    for (const row of rows as RowDataPacket[]) {
      statusMap[row.attendance_status as string] = Number(row.cnt);
    }

    const rosteredHc = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const presentHc  = (statusMap["present"] ?? 0) + (statusMap["half_day"] ?? 0) + (statusMap["late"] ?? 0);
    const absentHc   = statusMap["absent"] ?? 0;
    const onLeaveHc  = statusMap["leave_approved"] ?? 0;
    const lateCount  = Number((adhRows as RowDataPacket[])[0]?.late_count ?? 0);

    const plannedShrinkage = rosteredHc > 0 ? (onLeaveHc / rosteredHc) * 100 : 0;
    const unplannedShrinkage = rosteredHc > 0 ? (absentHc / rosteredHc) * 100 : 0;
    const totalShrinkage = plannedShrinkage + unplannedShrinkage;

    await db.execute(
      `INSERT INTO shrinkage_daily_snapshot
         (id, snapshot_date, process_id, branch_id,
          rostered_hc, present_hc, absent_hc, on_leave_hc, late_count,
          planned_shrinkage_pct, unplanned_shrinkage_pct, total_shrinkage_pct,
          avg_adherence_pct, avg_productive_mins, total_break_mins)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         rostered_hc = VALUES(rostered_hc), present_hc = VALUES(present_hc),
         absent_hc = VALUES(absent_hc), on_leave_hc = VALUES(on_leave_hc),
         late_count = VALUES(late_count),
         planned_shrinkage_pct = VALUES(planned_shrinkage_pct),
         unplanned_shrinkage_pct = VALUES(unplanned_shrinkage_pct),
         total_shrinkage_pct = VALUES(total_shrinkage_pct),
         avg_adherence_pct = VALUES(avg_adherence_pct)`,
      [
        date, opts.processId ?? null, opts.branchId ?? null,
        rosteredHc, presentHc, absentHc, onLeaveHc, lateCount,
        Math.round(plannedShrinkage * 100) / 100,
        Math.round(unplannedShrinkage * 100) / 100,
        Math.round(totalShrinkage * 100) / 100,
        Math.round(Number((adhRows as RowDataPacket[])[0]?.avg_adh ?? 0) * 100) / 100,
        Math.round(Number((adhRows as RowDataPacket[])[0]?.avg_prod ?? 0)),
        Math.round(Number((adhRows as RowDataPacket[])[0]?.total_break ?? 0)),
      ]
    );

    const [snap] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM shrinkage_daily_snapshot WHERE snapshot_date = ? AND process_id <=> ? AND branch_id <=> ?",
      [date, opts.processId ?? null, opts.branchId ?? null]
    );
    return (snap as RowDataPacket[])[0] as ShrinkageSnapshot;
  },

  async listSnapshots(filters: { fromDate: string; toDate: string; processId?: string; branchId?: string }) {
    const conds: string[] = ["snapshot_date BETWEEN ? AND ?"];
    const params: unknown[] = [filters.fromDate, filters.toDate];
    if (filters.processId) { conds.push("process_id = ?"); params.push(filters.processId); }
    if (filters.branchId)  { conds.push("branch_id = ?");  params.push(filters.branchId); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM shrinkage_daily_snapshot WHERE ${conds.join(" AND ")} ORDER BY snapshot_date DESC LIMIT 90`,
      params
    );
    return rows as ShrinkageSnapshot[];
  },
};

// ─── Adherence Alert Service ──────────────────────────────────────────────────

const ALERT_THRESHOLDS = {
  low_adherence:    70,  // % below this fires warning
  critical_adherence: 50,
  shrinkage_warning: 15, // % above this fires warning
  shrinkage_critical: 25,
  break_breach_mins: 60, // break minutes above this
};

export const alertService = {
  async fireAlertsForDate(date: string, opts: { userId: string }): Promise<number> {
    let fired = 0;

    // 1. Low adherence individual alerts
    const [lowAdh] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id, adherence_pct, late_by_minutes, break_minutes
       FROM attendance_reconciliation_record
       WHERE roster_date = ? AND attendance_status NOT IN ('leave_approved','absent')
         AND adherence_pct < ?`,
      [date, ALERT_THRESHOLDS.low_adherence]
    );

    for (const row of lowAdh as RowDataPacket[]) {
      const severity = Number(row.adherence_pct) < ALERT_THRESHOLDS.critical_adherence ? "critical" : "warning";
      await db.execute(
        `INSERT IGNORE INTO adherence_alert
           (id, alert_date, alert_type, severity, employee_id,
            threshold_pct, actual_pct, status)
         VALUES (UUID(), ?, 'low_adherence', ?, ?, ?, ?, 'open')`,
        [date, severity, row.employee_id, ALERT_THRESHOLDS.low_adherence, row.adherence_pct]
      );
      fired++;
    }

    // 2. No-show alerts
    const [noShows] = await db.execute<RowDataPacket[]>(
      "SELECT employee_id FROM attendance_reconciliation_record WHERE roster_date = ? AND attendance_status = 'absent'",
      [date]
    );
    for (const row of noShows as RowDataPacket[]) {
      await db.execute(
        `INSERT IGNORE INTO adherence_alert
           (id, alert_date, alert_type, severity, employee_id, status)
         VALUES (UUID(), ?, 'no_show', 'critical', ?, 'open')`,
        [date, row.employee_id]
      );
      fired++;
    }

    // 3. Process-level shrinkage alerts
    const [shrinkSnaps] = await db.execute<RowDataPacket[]>(
      `SELECT process_id, branch_id, total_shrinkage_pct
       FROM shrinkage_daily_snapshot WHERE snapshot_date = ? AND total_shrinkage_pct >= ?`,
      [date, ALERT_THRESHOLDS.shrinkage_warning]
    );
    for (const snap of shrinkSnaps as RowDataPacket[]) {
      const severity = Number(snap.total_shrinkage_pct) >= ALERT_THRESHOLDS.shrinkage_critical ? "critical" : "warning";
      await db.execute(
        `INSERT IGNORE INTO adherence_alert
           (id, alert_date, alert_type, severity, process_id, branch_id,
            threshold_pct, actual_pct, status)
         VALUES (UUID(), ?, 'shrinkage_spike', ?, ?, ?, ?, ?, 'open')`,
        [date, severity, snap.process_id, snap.branch_id,
         ALERT_THRESHOLDS.shrinkage_warning, snap.total_shrinkage_pct]
      );
      fired++;
    }

    return fired;
  },

  async listAlerts(filters: {
    fromDate?: string; toDate?: string; status?: string;
    processId?: string; employeeId?: string; page: number; limit: number;
  }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.fromDate)   { conds.push("alert_date >= ?");   params.push(filters.fromDate); }
    if (filters.toDate)     { conds.push("alert_date <= ?");   params.push(filters.toDate); }
    if (filters.status)     { conds.push("status = ?");        params.push(filters.status); }
    if (filters.processId)  { conds.push("process_id = ?");    params.push(filters.processId); }
    if (filters.employeeId) { conds.push("employee_id = ?");   params.push(filters.employeeId); }
    const offset = (filters.page - 1) * filters.limit;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM adherence_alert WHERE ${conds.join(" AND ")}
       ORDER BY alert_date DESC, severity DESC LIMIT ${filters.limit} OFFSET ${offset}`,
      params
    );
    return rows as AdherenceAlert[];
  },

  async acknowledgeAlert(id: string, userId: string) {
    await db.execute(
      "UPDATE adherence_alert SET status='acknowledged', acknowledged_by=?, acknowledged_at=NOW() WHERE id=?",
      [userId, id]
    );
  },
};

// ─── Payroll Readiness Service ────────────────────────────────────────────────

export const payrollReadinessService = {
  async generateReadinessFlags(
    periodStart: string,
    periodEnd: string,
    opts: { processId?: string; userId: string }
  ): Promise<{ flagged: number; errors: string[] }> {
    const errors: string[] = [];
    let flagged = 0;

    // Get all employees with reconciliation data in this period
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT r.employee_id FROM attendance_reconciliation_record r
       WHERE r.roster_date BETWEEN ? AND ?`,
      [periodStart, periodEnd]
    );

    for (const emp of empRows as RowDataPacket[]) {
      const empId = emp.employee_id as string;
      try {
        const [statsRows] = await db.execute<RowDataPacket[]>(
          `SELECT
             COUNT(DISTINCT roster_date) AS working_days,
             SUM(CASE WHEN attendance_status IN ('present','late') THEN 1 ELSE 0 END) AS present_days,
             SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_days,
             SUM(CASE WHEN attendance_status = 'leave_approved' THEN 1 ELSE 0 END) AS leave_days,
             SUM(CASE WHEN attendance_status = 'half_day' THEN 0.5 ELSE 0 END) AS half_days,
             SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) AS lwp_days,
             SUM(productive_minutes) AS total_productive_mins
           FROM attendance_reconciliation_record
           WHERE employee_id = ? AND roster_date BETWEEN ? AND ?`,
          [empId, periodStart, periodEnd]
        );

        const stats = (statsRows as RowDataPacket[])[0] ?? {};

        await db.execute(
          `INSERT INTO payroll_readiness_flag
             (id, employee_id, period_start, period_end,
              working_days, present_days, absent_days, leave_days,
              half_days, lwp_days, total_productive_mins, status, flagged_at, flagged_by)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', NOW(), ?)
           ON DUPLICATE KEY UPDATE
             working_days = VALUES(working_days), present_days = VALUES(present_days),
             absent_days = VALUES(absent_days), leave_days = VALUES(leave_days),
             lwp_days = VALUES(lwp_days), total_productive_mins = VALUES(total_productive_mins),
             status = 'ready', flagged_at = NOW(), flagged_by = VALUES(flagged_by)`,
          [
            empId, periodStart, periodEnd,
            Number(stats.working_days ?? 0), Number(stats.present_days ?? 0),
            Number(stats.absent_days ?? 0),  Number(stats.leave_days ?? 0),
            Number(stats.half_days ?? 0),    Number(stats.lwp_days ?? 0),
            Number(stats.total_productive_mins ?? 0), opts.userId,
          ]
        );
        flagged++;
      } catch (err: any) {
        errors.push(`${empId}: ${err.message}`);
      }
    }

    return { flagged, errors };
  },

  async listFlags(filters: { periodStart?: string; status?: string; employeeId?: string; page: number; limit: number }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.periodStart) { conds.push("period_start = ?"); params.push(filters.periodStart); }
    if (filters.status)      { conds.push("status = ?");       params.push(filters.status); }
    if (filters.employeeId)  { conds.push("employee_id = ?");  params.push(filters.employeeId); }
    const offset = (filters.page - 1) * filters.limit;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT prf.*, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name, e.employee_code
       FROM payroll_readiness_flag prf
       JOIN employees e ON e.id = prf.employee_id
       WHERE ${conds.join(" AND ")}
       ORDER BY prf.period_start DESC, e.employee_code
        LIMIT ${filters.limit} OFFSET ${offset}`,
      params
    );
    return rows as (PayrollReadinessFlag & { employee_name: string; employee_code: string })[];
  },
};

// ─── Leave Staffing Impact Service ───────────────────────────────────────────

export const leaveImpactService = {
  async calculateLeaveImpact(leaveRequestId: string): Promise<number> {
    const [leaveRows] = await db.execute<RowDataPacket[]>(
      `SELECT lr.employee_id, lr.from_date, lr.to_date, ra.process_name, ra.branch_name
       FROM leave_request lr
       LEFT JOIN wfm_roster_assignment ra ON ra.employee_id = lr.employee_id
         AND ra.roster_date BETWEEN lr.from_date AND lr.to_date
       WHERE lr.id = ? LIMIT 1`,
      [leaveRequestId]
    );
    if (!(leaveRows as RowDataPacket[]).length) return 0;
    const leave = (leaveRows as RowDataPacket[])[0];
    const fromDate = new Date(leave.from_date as string);
    const toDate   = new Date(leave.to_date   as string);
    let impacted = 0;

    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);

      // Count others rostered that day for same process
      const [covRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM wfm_roster_assignment
         WHERE roster_date = ? AND process_name = ? AND publish_status = 'published'`,
        [dateStr, leave.process_name ?? ""]
      );
      const totalHc = Number((covRows as RowDataPacket[])[0]?.total ?? 0);

      const impactLevel = totalHc <= 1 ? "critical"
        : totalHc <= 3 ? "high"
        : totalHc <= 6 ? "medium"
        : "low";

      await db.execute(
        `INSERT INTO leave_roster_impact
           (id, leave_request_id, employee_id, impact_date,
            planned_hc, leave_count, coverage_after_leave, coverage_pct, impact_level)
         VALUES (UUID(), ?, ?, ?, ?, 1, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           planned_hc = VALUES(planned_hc), coverage_after_leave = VALUES(coverage_after_leave),
           coverage_pct = VALUES(coverage_pct), impact_level = VALUES(impact_level)`,
        [
          leaveRequestId, leave.employee_id as string, dateStr,
          totalHc, Math.max(0, totalHc - 1),
          totalHc > 0 ? Math.round(((totalHc - 1) / totalHc) * 100) : 0,
          impactLevel,
        ]
      );
      impacted++;
    }

    return impacted;
  },

  async listImpacts(filters: { fromDate?: string; toDate?: string; processId?: string; impactLevel?: string }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.fromDate)    { conds.push("lri.impact_date >= ?"); params.push(filters.fromDate); }
    if (filters.toDate)      { conds.push("lri.impact_date <= ?"); params.push(filters.toDate); }
    if (filters.impactLevel) { conds.push("lri.impact_level = ?"); params.push(filters.impactLevel); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lri.*, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name, e.employee_code
       FROM leave_roster_impact lri
       JOIN employees e ON e.id = lri.employee_id
       WHERE ${conds.join(" AND ")}
       ORDER BY lri.impact_date DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },
};
