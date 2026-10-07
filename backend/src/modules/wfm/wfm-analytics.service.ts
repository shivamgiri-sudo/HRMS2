/**
 * WFM Analytics Service — WFM Dashboard Metrics
 *
 * Provides workforce management KPIs:
 * - Roster publish rate (% processes with published roster for next 7 days)
 * - Adherence % (rostered vs actual attendance)
 * - Shrinkage % (unplanned absence + late arrivals)
 * - Attendance exceptions (mismatch, COSEC sync errors)
 * - Break compliance (over-break employees)
 * - Workforce forecast (demand vs supply)
 * - Real-time attendance (live tracking)
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface WfmAnalyticsSummary {
  roster_publish_rate: number; // % processes with roster for next 7 days
  total_processes: number;
  published_processes: number;
  adherence_pct: number; // rostered vs actual
  shrinkage_pct: number; // unplanned absence + late
  attendance_exceptions: {
    mismatch_count: number;
    cosec_sync_errors: number;
    manual_entry_count: number;
  };
  real_time_attendance: {
    expected_today: number;
    present: number;
    absent: number;
    late: number;
    on_leave: number;
    attendance_pct: number;
  };
  break_compliance: {
    over_break_count: number;
    avg_over_break_mins: number;
    top_violators: Array<{
      employee_id: number;
      employee_name: string;
      branch_name: string;
      avg_over_break_mins: number;
    }>;
  };
  workforce_forecast: Array<{
    date: string;
    demand: number;
    supply: number;
    gap: number;
  }>;
  adherence_by_process: Array<{
    process_id: number;
    process_name: string;
    rostered: number;
    actual: number;
    adherence_pct: number;
  }>;
}

export async function getWfmAnalyticsSummary(): Promise<WfmAnalyticsSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const next7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Roster publish rate (processes with published roster for next 7 days)
  const [rosterPublish] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT r.process_id) as published_processes,
       (SELECT COUNT(DISTINCT process_id) FROM processes WHERE is_active = 1) as total_processes
     FROM roster r
     WHERE r.roster_date BETWEEN ? AND ?
       AND r.status = 'published'
       AND r.is_active = 1`,
    [today, next7Days],
  );

  const publishedCount = rosterPublish[0]?.published_processes ?? 0;
  const totalProcesses = rosterPublish[0]?.total_processes ?? 1;
  const publishRate = Math.round((publishedCount / totalProcesses) * 100);

  // Adherence % (rostered vs actual) - today
  const [adherence] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT r.employee_id) as rostered_count,
       COUNT(DISTINCT a.employee_id) as actual_count
     FROM roster r
     LEFT JOIN attendance a ON r.employee_id = a.employee_id
       AND a.attendance_date = r.roster_date
       AND a.status IN ('present', 'half_day')
     WHERE r.roster_date = ?
       AND r.status = 'published'
       AND r.is_active = 1`,
    [today],
  );

  const rostered = adherence[0]?.rostered_count ?? 1;
  const actual = adherence[0]?.actual_count ?? 0;
  const adherencePct = Math.round((actual / rostered) * 100);

  // Shrinkage % (unplanned absence + late arrivals) - last 7 days
  const [shrinkage] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status = 'absent' AND leave_status IS NULL THEN 1 ELSE 0 END) as unplanned_absent,
       SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as late_arrivals,
       COUNT(*) as total_attendance_records
     FROM attendance
     WHERE attendance_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND CURDATE()`,
  );

  const unplannedAbsent = shrinkage[0]?.unplanned_absent ?? 0;
  const lateArrivals = shrinkage[0]?.late_arrivals ?? 0;
  const totalRecords = shrinkage[0]?.total_attendance_records ?? 1;
  const shrinkagePct = Math.round(
    ((unplannedAbsent + lateArrivals) / totalRecords) * 100,
  );

  // Attendance exceptions
  const [exceptions] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN exception_type = 'mismatch' THEN 1 ELSE 0 END) as mismatch_count,
       SUM(CASE WHEN exception_type = 'cosec_sync_error' THEN 1 ELSE 0 END) as sync_errors,
       SUM(CASE WHEN exception_type = 'manual_entry' THEN 1 ELSE 0 END) as manual_entries
     FROM attendance_exceptions
     WHERE exception_date = ?
       AND is_resolved = 0`,
    [today],
  );

  // Real-time attendance (today)
  const [rtAttendance] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT r.employee_id) as expected_today,
       SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present,
       SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent,
       SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END) as late,
       SUM(CASE WHEN a.leave_status IS NOT NULL THEN 1 ELSE 0 END) as on_leave
     FROM roster r
     LEFT JOIN attendance a ON r.employee_id = a.employee_id
       AND a.attendance_date = r.roster_date
     WHERE r.roster_date = ?
       AND r.status = 'published'
       AND r.is_active = 1`,
    [today],
  );

  const expectedToday = rtAttendance[0]?.expected_today ?? 1;
  const present = rtAttendance[0]?.present ?? 0;
  const attendancePct = Math.round((present / expectedToday) * 100);

  // Break compliance (top 10 over-break employees)
  const [breakCompliance] = await db.query<RowDataPacket[]>(
    `SELECT
       a.employee_id,
       e.name as employee_name,
       b.name as branch_name,
       AVG(TIMESTAMPDIFF(MINUTE, a.break_start, a.break_end) -
           COALESCE(a.break_allowed_mins, 30)) as avg_over_break_mins
     FROM attendance a
     INNER JOIN employees e ON a.employee_id = e.id
     LEFT JOIN branches b ON e.branch_id = b.id
     WHERE a.attendance_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND CURDATE()
       AND a.break_start IS NOT NULL
       AND a.break_end IS NOT NULL
       AND TIMESTAMPDIFF(MINUTE, a.break_start, a.break_end) > COALESCE(a.break_allowed_mins, 30)
     GROUP BY a.employee_id, e.name, b.name
     HAVING avg_over_break_mins > 0
     ORDER BY avg_over_break_mins DESC
     LIMIT 10`,
  );

  const overBreakCount = breakCompliance.length;
  const avgOverBreak =
    overBreakCount > 0
      ? Math.round(
          breakCompliance.reduce(
            (sum, r) => sum + Number(r.avg_over_break_mins ?? 0),
            0,
          ) / overBreakCount,
        )
      : 0;

  // Workforce forecast (next 7 days: demand vs supply)
  const [forecast] = await db.query<RowDataPacket[]>(
    `SELECT
       d.forecast_date as date,
       SUM(d.demand) as demand,
       COUNT(DISTINCT r.employee_id) as supply
     FROM workforce_demand d
     LEFT JOIN roster r ON d.process_id = r.process_id
       AND d.forecast_date = r.roster_date
       AND r.status = 'published'
       AND r.is_active = 1
     WHERE d.forecast_date BETWEEN ? AND ?
     GROUP BY d.forecast_date
     ORDER BY d.forecast_date ASC`,
    [today, next7Days],
  );

  // Adherence by process (today)
  const [adherenceByProcess] = await db.query<RowDataPacket[]>(
    `SELECT
       p.id as process_id,
       p.name as process_name,
       COUNT(DISTINCT r.employee_id) as rostered,
       COUNT(DISTINCT a.employee_id) as actual
     FROM processes p
     LEFT JOIN roster r ON p.id = r.process_id
       AND r.roster_date = ?
       AND r.status = 'published'
       AND r.is_active = 1
     LEFT JOIN attendance a ON r.employee_id = a.employee_id
       AND a.attendance_date = r.roster_date
       AND a.status IN ('present', 'half_day')
     WHERE p.is_active = 1
     GROUP BY p.id, p.name
     HAVING rostered > 0
     ORDER BY p.name ASC`,
    [today],
  );

  return {
    roster_publish_rate: publishRate,
    total_processes: totalProcesses,
    published_processes: publishedCount,
    adherence_pct: adherencePct,
    shrinkage_pct: shrinkagePct,
    attendance_exceptions: {
      mismatch_count: exceptions[0]?.mismatch_count ?? 0,
      cosec_sync_errors: exceptions[0]?.sync_errors ?? 0,
      manual_entry_count: exceptions[0]?.manual_entries ?? 0,
    },
    real_time_attendance: {
      expected_today: expectedToday,
      present: present ?? 0,
      absent: rtAttendance[0]?.absent ?? 0,
      late: rtAttendance[0]?.late ?? 0,
      on_leave: rtAttendance[0]?.on_leave ?? 0,
      attendance_pct: attendancePct,
    },
    break_compliance: {
      over_break_count: overBreakCount,
      avg_over_break_mins: avgOverBreak,
      top_violators: breakCompliance.map((r) => ({
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        branch_name: r.branch_name ?? "Unknown",
        avg_over_break_mins: Math.round(Number(r.avg_over_break_mins ?? 0)),
      })),
    },
    workforce_forecast: forecast.map((r) => ({
      date: r.date,
      demand: Number(r.demand ?? 0),
      supply: Number(r.supply ?? 0),
      gap: Number(r.demand ?? 0) - Number(r.supply ?? 0),
    })),
    adherence_by_process: adherenceByProcess.map((r) => {
      const rostered = Number(r.rostered ?? 0);
      const actual = Number(r.actual ?? 0);
      return {
        process_id: r.process_id,
        process_name: r.process_name,
        rostered,
        actual,
        adherence_pct: rostered > 0 ? Math.round((actual / rostered) * 100) : 0,
      };
    }),
  };
}
