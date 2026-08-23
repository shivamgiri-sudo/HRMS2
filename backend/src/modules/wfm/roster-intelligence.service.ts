/**
 * Roster Intelligence Service
 *
 * Aggregates roster + attendance + quality data for:
 * 1. Manager Daily Digest — team attendance summary
 * 2. Unplanned Absence Alerts — real-time RED detection
 * 3. Branch Head Dashboard — branch-wide attendance analytics
 *
 * Data sources:
 * - wfm_roster_assignment (what was planned)
 * - attendance_daily_record (what actually happened)
 * - db_audit.call_quality_assessment (quality scores) - optional
 * - apr_requests (pending regularizations)
 */
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TeamMemberAttendance {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  rosterType: 'SHIFT' | 'WEEK_OFF' | 'LEAVE' | 'HOLIDAY' | 'TRAINING';
  shiftTime: string | null;
  adherence: 'GREEN' | 'AMBER' | 'RED' | 'BROWN' | 'GREY';
  firstIn: string | null;
  lastOut: string | null;
  lateMinutes: number | null;
  workedHours: number | null;
  workedPct: number | null;
}

export interface ManagerDailyDigest {
  managerId: string;
  managerName: string;
  managerEmail: string | null;
  date: string;
  teamSize: number;
  planned: number;
  present: number;
  shrinkagePct: number;
  unplannedAbsences: TeamMemberAttendance[];
  lateArrivals: TeamMemberAttendance[];
  incompleteShifts: TeamMemberAttendance[];
  onTime: TeamMemberAttendance[];
  qualityAvg: number | null;
  aprPending: number;
}

export interface BranchDailyDashboard {
  branchId: string;
  branchName: string;
  date: string;
  totalHC: number;
  planned: number;
  present: number;
  shrinkagePct: number;
  byProcess: Array<{
    processId: string;
    processName: string;
    planned: number;
    onTime: number;
    adherencePct: number;
  }>;
  chronicAbsentees: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    processName: string | null;
    unplannedAbsences30d: number;
  }>;
  qualityImpact: {
    lowAdherenceQuality: number | null;
    highAdherenceQuality: number | null;
  };
}

export interface UnplannedAbsenceAlert {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  shiftTime: string;
  managerId: string | null;
  managerName: string | null;
  managerEmail: string | null;
  processName: string | null;
  branchName: string | null;
  minutesSinceShiftStart: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeToMinutes(t: string): number {
  const parts = t.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

function todayDate(): string {
  return formatDate(new Date());
}

const GRACE_MINUTES = 5;
const INCOMPLETE_THRESHOLD = 0.8;

// ── Manager Daily Digest ─────────────────────────────────────────────────────

/**
 * Generate daily digest for all managers with active team members.
 * Called by cron at 7 AM IST.
 */
export async function generateManagerDailyDigests(
  date: string = yesterdayDate()
): Promise<ManagerDailyDigest[]> {
  // Get all managers with active team members who have roster for the date
  const [managers] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT
       mgr.id AS manager_id,
       mgr.full_name AS manager_name,
       mgr.official_email AS manager_email
     FROM employees e
     JOIN employees mgr ON mgr.id = e.reporting_manager_id
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id AND ra.roster_date = ?
     WHERE e.active_status = 1
       AND e.employment_status = 'Active'
       AND mgr.active_status = 1`,
    [date]
  );

  const digests: ManagerDailyDigest[] = [];

  for (const mgr of managers) {
    const digest = await generateSingleManagerDigest(
      String(mgr.manager_id),
      String(mgr.manager_name),
      mgr.manager_email ? String(mgr.manager_email) : null,
      date
    );
    if (digest.teamSize > 0) {
      digests.push(digest);
    }
  }

  return digests;
}

async function generateSingleManagerDigest(
  managerId: string,
  managerName: string,
  managerEmail: string | null,
  date: string
): Promise<ManagerDailyDigest> {
  // Get team roster + attendance for the date
  const [teamRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       e.full_name AS employee_name,
       ra.assignment_type,
       ra.shift_start_time,
       ra.shift_end_time,
       st.start_time AS template_start,
       st.end_time AS template_end,
       att.first_in,
       att.last_out,
       att.total_hours,
       att.status AS att_status
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id AND ra.roster_date = ?
     LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.attendance_date = ?
     WHERE e.reporting_manager_id = ?
       AND e.active_status = 1
       AND e.employment_status = 'Active'`,
    [date, date, managerId]
  );

  const unplannedAbsences: TeamMemberAttendance[] = [];
  const lateArrivals: TeamMemberAttendance[] = [];
  const incompleteShifts: TeamMemberAttendance[] = [];
  const onTime: TeamMemberAttendance[] = [];
  let planned = 0;
  let present = 0;

  for (const r of teamRows) {
    const type = String(r.assignment_type ?? '').toUpperCase();
    const isOff = ['WEEK_OFF', 'LEAVE', 'HOLIDAY'].includes(type);

    const shiftStart = r.template_start || r.shift_start_time;
    const shiftEnd = r.template_end || r.shift_end_time;
    const shiftTime = shiftStart && shiftEnd
      ? `${String(shiftStart).slice(0, 5)}-${String(shiftEnd).slice(0, 5)}`
      : null;

    const member: TeamMemberAttendance = {
      employeeId: String(r.employee_id),
      employeeCode: String(r.employee_code),
      employeeName: String(r.employee_name),
      rosterType: isOff ? (type as any) : 'SHIFT',
      shiftTime,
      adherence: 'GREY',
      firstIn: r.first_in ? String(r.first_in) : null,
      lastOut: r.last_out ? String(r.last_out) : null,
      lateMinutes: null,
      workedHours: r.total_hours ? Number(r.total_hours) : null,
      workedPct: null,
    };

    if (isOff) {
      member.adherence = 'GREY';
      continue;
    }

    planned++;

    // Calculate expected shift duration
    let expectedMinutes = 480; // 8 hours default
    if (shiftStart && shiftEnd) {
      const start = timeToMinutes(String(shiftStart));
      const end = timeToMinutes(String(shiftEnd));
      expectedMinutes = end >= start ? end - start : (24 * 60 - start) + end;
    }

    if (!r.first_in) {
      // No attendance = RED (unplanned absence)
      member.adherence = 'RED';
      unplannedAbsences.push(member);
    } else {
      present++;
      const loginMinutes = timeToMinutes(String(r.first_in));
      const shiftStartMinutes = shiftStart ? timeToMinutes(String(shiftStart)) : 0;
      const workedMinutes = (Number(r.total_hours) || 0) * 60;
      const workedPct = expectedMinutes > 0 ? Math.round((workedMinutes / expectedMinutes) * 100) : 100;
      member.workedPct = workedPct;

      if (workedPct < INCOMPLETE_THRESHOLD * 100) {
        // Incomplete shift = BROWN
        member.adherence = 'BROWN';
        incompleteShifts.push(member);
      } else if (shiftStart && loginMinutes > shiftStartMinutes + GRACE_MINUTES) {
        // Late = AMBER
        member.adherence = 'AMBER';
        member.lateMinutes = loginMinutes - shiftStartMinutes;
        lateArrivals.push(member);
      } else {
        // On-time = GREEN
        member.adherence = 'GREEN';
        onTime.push(member);
      }
    }
  }

  const teamSize = teamRows.length;
  const shrinkagePct = planned > 0 ? Math.round(((planned - present) / planned) * 100) : 0;

  // Get APR pending count for this manager's team
  const [aprRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM apr_requests apr
     JOIN employees e ON e.id = apr.employee_id
     WHERE e.reporting_manager_id = ?
       AND apr.status IN ('pending', 'submitted')`,
    [managerId]
  );
  const aprPending = Number(aprRows[0]?.cnt ?? 0);

  // Quality average would require cross-db join, skip for now
  const qualityAvg: number | null = null;

  return {
    managerId,
    managerName,
    managerEmail,
    date,
    teamSize,
    planned,
    present,
    shrinkagePct,
    unplannedAbsences,
    lateArrivals,
    incompleteShifts,
    onTime,
    qualityAvg,
    aprPending,
  };
}

// ── Branch Daily Dashboard ───────────────────────────────────────────────────

/**
 * Generate branch-level dashboard for branch head.
 */
export async function generateBranchDashboard(
  branchId: string,
  date: string = yesterdayDate()
): Promise<BranchDailyDashboard> {
  // Get branch info
  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name FROM branch_master WHERE id = ?`,
    [branchId]
  );
  const branchName = branchRows[0]?.branch_name ? String(branchRows[0].branch_name) : 'Unknown';

  // Get roster + attendance for all employees in branch
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       e.full_name AS employee_name,
       e.process_id,
       pm.process_name,
       ra.assignment_type,
       ra.shift_start_time,
       st.start_time AS template_start,
       att.first_in,
       att.total_hours
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id AND ra.roster_date = ?
     LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.attendance_date = ?
     LEFT JOIN process_master pm ON pm.id = e.process_id
     WHERE e.branch_id = ?
       AND e.active_status = 1
       AND e.employment_status = 'Active'`,
    [date, date, branchId]
  );

  const totalHC = rows.length;
  let planned = 0;
  let present = 0;

  // Process-level aggregation
  const processMap = new Map<string, { name: string; planned: number; onTime: number }>();

  for (const r of rows) {
    const type = String(r.assignment_type ?? '').toUpperCase();
    const isOff = ['WEEK_OFF', 'LEAVE', 'HOLIDAY'].includes(type);
    if (isOff) continue;

    planned++;
    const processId = r.process_id ? String(r.process_id) : 'unknown';
    const processName = r.process_name ? String(r.process_name) : 'Unknown';

    if (!processMap.has(processId)) {
      processMap.set(processId, { name: processName, planned: 0, onTime: 0 });
    }
    const proc = processMap.get(processId)!;
    proc.planned++;

    if (r.first_in) {
      present++;
      const shiftStart = r.template_start || r.shift_start_time;
      if (shiftStart) {
        const loginMin = timeToMinutes(String(r.first_in));
        const shiftMin = timeToMinutes(String(shiftStart));
        if (loginMin <= shiftMin + GRACE_MINUTES) {
          proc.onTime++;
        }
      } else {
        proc.onTime++; // No shift time = assume on-time if present
      }
    }
  }

  const byProcess = [...processMap.entries()].map(([processId, p]) => ({
    processId,
    processName: p.name,
    planned: p.planned,
    onTime: p.onTime,
    adherencePct: p.planned > 0 ? Math.round((p.onTime / p.planned) * 100) : 0,
  })).sort((a, b) => a.adherencePct - b.adherencePct); // Worst first

  const shrinkagePct = planned > 0 ? Math.round(((planned - present) / planned) * 100) : 0;

  // Chronic absentees (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromDate = formatDate(thirtyDaysAgo);

  const [chronicRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       e.full_name AS employee_name,
       pm.process_name,
       COUNT(*) AS unplanned_count
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.attendance_date = ra.roster_date
     LEFT JOIN process_master pm ON pm.id = e.process_id
     WHERE e.branch_id = ?
       AND e.active_status = 1
       AND ra.roster_date BETWEEN ? AND ?
       AND ra.assignment_type NOT IN ('WEEK_OFF', 'LEAVE', 'HOLIDAY')
       AND att.first_in IS NULL
     GROUP BY e.id, e.employee_code, e.full_name, pm.process_name
     HAVING unplanned_count >= 3
     ORDER BY unplanned_count DESC
     LIMIT 10`,
    [branchId, fromDate, date]
  );

  const chronicAbsentees = chronicRows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code),
    employeeName: String(r.employee_name),
    processName: r.process_name ? String(r.process_name) : null,
    unplannedAbsences30d: Number(r.unplanned_count),
  }));

  return {
    branchId,
    branchName,
    date,
    totalHC,
    planned,
    present,
    shrinkagePct,
    byProcess,
    chronicAbsentees,
    qualityImpact: { lowAdherenceQuality: null, highAdherenceQuality: null },
  };
}

// ── Unplanned Absence Detection ──────────────────────────────────────────────

/**
 * Detect employees who are rostered for a shift but haven't punched in.
 * Called every 30 minutes to catch RED alerts.
 *
 * @param gracePeriodMinutes Minutes after shift start to wait before alerting
 */
export async function detectUnplannedAbsences(
  date: string = todayDate(),
  gracePeriodMinutes: number = 30
): Promise<UnplannedAbsenceAlert[]> {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Find employees rostered for shifts that have started but haven't punched in
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       e.full_name AS employee_name,
       e.reporting_manager_id,
       mgr.full_name AS manager_name,
       mgr.official_email AS manager_email,
       pm.process_name,
       bm.branch_name,
       COALESCE(st.start_time, ra.shift_start_time) AS shift_start,
       COALESCE(st.end_time, ra.shift_end_time) AS shift_end
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id AND ra.roster_date = ?
     LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.attendance_date = ?
     LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
     LEFT JOIN process_master pm ON pm.id = e.process_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     WHERE e.active_status = 1
       AND e.employment_status = 'Active'
       AND ra.assignment_type NOT IN ('WEEK_OFF', 'LEAVE', 'HOLIDAY', 'TRAINING')
       AND att.first_in IS NULL`,
    [date, date]
  );

  const alerts: UnplannedAbsenceAlert[] = [];

  for (const r of rows) {
    const shiftStart = r.shift_start;
    if (!shiftStart) continue;

    const shiftMinutes = timeToMinutes(String(shiftStart));
    const minutesSinceStart = currentMinutes - shiftMinutes;

    // Only alert if shift started + grace period passed
    if (minutesSinceStart >= gracePeriodMinutes) {
      const shiftTime = r.shift_end
        ? `${String(shiftStart).slice(0, 5)}-${String(r.shift_end).slice(0, 5)}`
        : String(shiftStart).slice(0, 5);

      alerts.push({
        employeeId: String(r.employee_id),
        employeeCode: String(r.employee_code),
        employeeName: String(r.employee_name),
        date,
        shiftTime,
        managerId: r.reporting_manager_id ? String(r.reporting_manager_id) : null,
        managerName: r.manager_name ? String(r.manager_name) : null,
        managerEmail: r.manager_email ? String(r.manager_email) : null,
        processName: r.process_name ? String(r.process_name) : null,
        branchName: r.branch_name ? String(r.branch_name) : null,
        minutesSinceShiftStart: minutesSinceStart,
      });
    }
  }

  return alerts;
}

// ── Weekly Shrinkage Report ──────────────────────────────────────────────────

export interface WeeklyShrinkageReport {
  branchId: string;
  branchName: string;
  weekStart: string;
  weekEnd: string;
  shrinkageBreakdown: {
    plannedLeave: number;
    unplannedAbsence: number;
    lateEarlyOut: number;
    training: number;
    total: number;
  };
  budgetPct: number;
  trend: number; // vs previous week
  managerRanking: Array<{
    managerId: string;
    managerName: string;
    teamSize: number;
    shrinkagePct: number;
  }>;
}

export async function generateWeeklyShrinkageReport(
  branchId: string,
  weekStartDate: string
): Promise<WeeklyShrinkageReport> {
  // Calculate week end
  const weekStart = new Date(weekStartDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = formatDate(weekEnd);

  // Get branch name
  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name FROM branch_master WHERE id = ?`,
    [branchId]
  );
  const branchName = branchRows[0]?.branch_name ? String(branchRows[0].branch_name) : 'Unknown';

  // Get roster + attendance for the week
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.reporting_manager_id,
       mgr.full_name AS manager_name,
       ra.roster_date,
       ra.assignment_type,
       ra.shift_start_time,
       st.start_time AS template_start,
       att.first_in,
       att.total_hours
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
     LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.attendance_date = ra.roster_date
     LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
     WHERE e.branch_id = ?
       AND e.active_status = 1
       AND ra.roster_date BETWEEN ? AND ?`,
    [branchId, weekStartDate, weekEndStr]
  );

  let plannedLeaveCount = 0;
  let unplannedAbsenceCount = 0;
  let lateEarlyOutCount = 0;
  let trainingCount = 0;
  let totalPlanned = 0;

  const managerStats = new Map<string, { name: string; teamDays: number; shrinkageDays: number }>();

  for (const r of rows) {
    const type = String(r.assignment_type ?? '').toUpperCase();
    const managerId = r.reporting_manager_id ? String(r.reporting_manager_id) : 'unknown';
    const managerName = r.manager_name ? String(r.manager_name) : 'Unknown';

    if (!managerStats.has(managerId)) {
      managerStats.set(managerId, { name: managerName, teamDays: 0, shrinkageDays: 0 });
    }
    const stats = managerStats.get(managerId)!;

    if (type === 'LEAVE') {
      plannedLeaveCount++;
      stats.shrinkageDays++;
    } else if (type === 'TRAINING') {
      trainingCount++;
      stats.shrinkageDays++;
    } else if (type === 'WEEK_OFF' || type === 'HOLIDAY') {
      // Not counted in shrinkage
    } else {
      totalPlanned++;
      stats.teamDays++;

      if (!r.first_in) {
        unplannedAbsenceCount++;
        stats.shrinkageDays++;
      } else {
        // Check for late or early out
        const workedHours = Number(r.total_hours) || 0;
        const shiftStart = r.template_start || r.shift_start_time;
        if (shiftStart) {
          const loginMin = timeToMinutes(String(r.first_in));
          const shiftMin = timeToMinutes(String(shiftStart));
          if (loginMin > shiftMin + GRACE_MINUTES || workedHours < 7) {
            lateEarlyOutCount++;
          }
        }
      }
    }
  }

  const totalShrinkage = plannedLeaveCount + unplannedAbsenceCount + trainingCount;
  const totalPossible = totalPlanned + plannedLeaveCount + trainingCount;
  const shrinkagePct = totalPossible > 0 ? Math.round((totalShrinkage / totalPossible) * 100 * 10) / 10 : 0;

  const managerRanking = [...managerStats.entries()]
    .filter(([_, s]) => s.teamDays > 0)
    .map(([id, s]) => ({
      managerId: id,
      managerName: s.name,
      teamSize: s.teamDays,
      shrinkagePct: s.teamDays > 0 ? Math.round((s.shrinkageDays / s.teamDays) * 100 * 10) / 10 : 0,
    }))
    .sort((a, b) => b.shrinkagePct - a.shrinkagePct);

  return {
    branchId,
    branchName,
    weekStart: weekStartDate,
    weekEnd: weekEndStr,
    shrinkageBreakdown: {
      plannedLeave: totalPossible > 0 ? Math.round((plannedLeaveCount / totalPossible) * 100 * 10) / 10 : 0,
      unplannedAbsence: totalPossible > 0 ? Math.round((unplannedAbsenceCount / totalPossible) * 100 * 10) / 10 : 0,
      lateEarlyOut: totalPossible > 0 ? Math.round((lateEarlyOutCount / totalPossible) * 100 * 10) / 10 : 0,
      training: totalPossible > 0 ? Math.round((trainingCount / totalPossible) * 100 * 10) / 10 : 0,
      total: shrinkagePct,
    },
    budgetPct: 8, // Default budget - should come from workforce_mandate
    trend: 0, // Would need previous week comparison
    managerRanking,
  };
}
