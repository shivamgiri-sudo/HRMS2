/**
 * Roster view — "who is working what, this week", as a table.
 *
 * One row per employee with their dates across, carrying the context a WFM person needs to read
 * it without cross-referencing anything: reporting manager, process, branch and cost centre.
 *
 * Deliberately reads wfm_roster_assignment, the only table with real roster data (413,386 rows),
 * and resolves the employee attributes live from `employees` rather than from whatever was stamped
 * on the assignment — 333,762 assignment rows carry process_name NULL, so the assignment is not a
 * reliable place to read context from.
 *
 * Enhanced with roster adherence tracking (2026-08-23):
 * - GREEN (followed): On-time attendance within 5-min grace
 * - AMBER (late): Attended but late by > 5 min
 * - RED (unplanned): Rostered for shift but no attendance record
 * - BROWN (incomplete): Attended but worked < 80% of required shift
 * - GREY (off): WO/Leave/Holiday — no adherence tracking
 * - FUTURE: Date is in the future — no adherence tracking yet
 */
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

export interface RosterViewFilters {
  fromDate: string;
  toDate: string;
  branchId?: string;
  processId?: string;
  costCentreId?: string;
  /** Free text over employee code and name. */
  search?: string;
  limit?: number;
  offset?: number;
  /** Include adherence data (joins attendance) — slower but shows color coding */
  includeAdherence?: boolean;
}

/** Adherence status for color-coding */
export type AdherenceStatus = 'GREEN' | 'AMBER' | 'RED' | 'BROWN' | 'GREY' | 'FUTURE';

/** Day cell with optional adherence info */
export interface DayCell {
  label: string;
  adherence?: AdherenceStatus;
  lateMinutes?: number;
  workedPct?: number;
}

export interface RosterViewRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  reportingManager: string | null;
  processName: string | null;
  branchName: string | null;
  costCentre: string | null;
  /** date (YYYY-MM-DD) -> what is planned that day */
  days: Record<string, string>;
  /** date (YYYY-MM-DD) -> detailed cell with adherence — only if includeAdherence=true */
  dayCells?: Record<string, DayCell>;
  /** Employee-level adherence % for the period — only if includeAdherence=true */
  adherencePct?: number;
}

/** Turn an assignment row into the single label a planner wants to see in a cell. */
function cellLabel(r: RowDataPacket): string {
  const type = String(r.assignment_type ?? '').toUpperCase();
  if (type === 'WEEK_OFF') return 'WO';
  if (type === 'LEAVE') return 'Leave';
  if (type === 'HOLIDAY') return 'Holiday';
  if (type === 'TRAINING') return 'Training';
  if (r.start_time && r.end_time) {
    return `${String(r.start_time).slice(0, 5)}-${String(r.end_time).slice(0, 5)}`;
  }
  // Fallback for a row with no shift_template_id (e.g. roster-import's spreadsheet-commit path,
  // fixed 2026-08-22, which parses a shift time straight from the cell and has no shift template to
  // link to) — the assignment's own shift_start_time/shift_end_time columns, instead of falling all
  // the way through to printing the bare word "SHIFT". Same columns roster.service.ts::assignEmployee
  // already writes for the manual-assign/CSV-upload path.
  if (r.own_start_time && r.own_end_time) {
    return `${String(r.own_start_time).slice(0, 5)}-${String(r.own_end_time).slice(0, 5)}`;
  }
  if (r.shift_name) return String(r.shift_name);
  if (type && type !== 'UNASSIGNED') return type;
  return '—';
}

/** Check if assignment type is a non-working day (no adherence tracking) */
function isOffType(type: string): boolean {
  const t = type.toUpperCase();
  return t === 'WEEK_OFF' || t === 'LEAVE' || t === 'HOLIDAY';
}

/** Convert HH:MM or HH:MM:SS time string to total minutes */
function timeToMinutes(t: string): number {
  const parts = t.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/** Get expected shift duration in minutes from roster or template */
function getExpectedMinutes(r: RowDataPacket): number {
  // Try shift template first
  if (r.start_time && r.end_time) {
    const start = timeToMinutes(String(r.start_time));
    const end = timeToMinutes(String(r.end_time));
    // Handle overnight shifts
    return end >= start ? end - start : (24 * 60 - start) + end;
  }
  // Try assignment's own times
  if (r.own_start_time && r.own_end_time) {
    const start = timeToMinutes(String(r.own_start_time));
    const end = timeToMinutes(String(r.own_end_time));
    return end >= start ? end - start : (24 * 60 - start) + end;
  }
  return 480; // Default 8 hours
}

const GRACE_MINUTES = 5;
const INCOMPLETE_THRESHOLD = 0.8; // < 80% worked = incomplete

export async function getRosterView(
  filters: RosterViewFilters
): Promise<{
  rows: RosterViewRow[];
  dates: string[];
  total: number;
  analytics?: RosterAdherenceAnalytics;
}> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const includeAdherence = filters.includeAdherence ?? false;

  const where: string[] = ['ra.roster_date BETWEEN ? AND ?'];
  const params: unknown[] = [filters.fromDate, filters.toDate];
  if (filters.branchId) { where.push('e.branch_id = ?'); params.push(filters.branchId); }
  if (filters.processId) { where.push('e.process_id = ?'); params.push(filters.processId); }
  if (filters.costCentreId) { where.push('e.cost_centre_id = ?'); params.push(filters.costCentreId); }
  if (filters.search) {
    where.push('(e.employee_code LIKE ? OR e.full_name LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const whereSql = where.join(' AND ');

  // Count distinct employees first so the page size means "employees", not "cells".
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT e.id) AS n
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id
      WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.n ?? 0);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id                AS employee_id,
            e.employee_code     AS employee_code,
            e.full_name         AS employee_name,
            mgr.full_name       AS reporting_manager,
            pm.process_name     AS process_name,
            pm.id               AS process_id,
            b.branch_name       AS branch_name,
            b.id                AS branch_id,
            cc.cost_centre_name AS cost_centre,
            DATE_FORMAT(ra.roster_date, '%Y-%m-%d') AS roster_date,
            ra.assignment_type,
            ra.shift_start_time  AS own_start_time,
            ra.shift_end_time    AS own_end_time,
            st.shift_name,
            st.start_time,
            st.end_time
       FROM wfm_roster_assignment ra
       JOIN employees e            ON e.id  = ra.employee_id
       LEFT JOIN employees mgr     ON mgr.id = e.reporting_manager_id
       LEFT JOIN process_master pm ON pm.id  = e.process_id
       LEFT JOIN branch_master b   ON b.id   = e.branch_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
      WHERE ${whereSql}
        AND e.id IN (
          SELECT id FROM (
            SELECT e2.id
              FROM wfm_roster_assignment ra2
              JOIN employees e2 ON e2.id = ra2.employee_id
             WHERE ${whereSql.replace(/\bra\./g, 'ra2.').replace(/\be\./g, 'e2.')}
             GROUP BY e2.id, e2.employee_code
             ORDER BY e2.employee_code
             -- Inlined, not bound: MySQL's prepared-statement protocol rejects placeholders in
             -- LIMIT/OFFSET (ER_WRONG_ARGUMENTS). Both are clamped integers above, never strings.
             LIMIT ${limit} OFFSET ${offset}
          ) paged
        )
      ORDER BY e.employee_code, ra.roster_date`,
    [...params, ...params]
  );

  // Collect employee IDs for attendance lookup
  const employeeIds = new Set<string>();
  const rosterData: Array<{ empId: string; date: string; row: RowDataPacket }> = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const r of rows) {
    const id = String(r.employee_id);
    employeeIds.add(id);
    rosterData.push({ empId: id, date: String(r.roster_date), row: r });
  }

  // Fetch attendance data if adherence requested
  let attendanceMap = new Map<string, RowDataPacket>(); // key: `${empId}|${date}`
  if (includeAdherence && employeeIds.size > 0) {
    const empIdList = [...employeeIds];
    const placeholders = empIdList.map(() => '?').join(', ');
    const [attRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id,
              DATE_FORMAT(attendance_date, '%Y-%m-%d') AS att_date,
              first_in,
              last_out,
              total_hours,
              status
         FROM attendance_daily_record
        WHERE employee_id IN (${placeholders})
          AND attendance_date BETWEEN ? AND ?`,
      [...empIdList, filters.fromDate, filters.toDate]
    );
    for (const att of attRows) {
      const key = `${att.employee_id}|${att.att_date}`;
      attendanceMap.set(key, att);
    }
  }

  // Build result with optional adherence
  const byEmployee = new Map<string, RosterViewRow & { _adherenceStats: { green: number; amber: number; red: number; brown: number; total: number } }>();
  const dates = new Set<string>();

  // Analytics accumulators
  const byProcess = new Map<string, { name: string; green: number; total: number }>();
  const byBranch = new Map<string, { name: string; green: number; total: number }>();
  let globalGreen = 0, globalTotal = 0;

  for (const { empId, date, row } of rosterData) {
    if (!byEmployee.has(empId)) {
      byEmployee.set(empId, {
        employeeId: empId,
        employeeCode: String(row.employee_code ?? ''),
        employeeName: String(row.employee_name ?? ''),
        reportingManager: row.reporting_manager ? String(row.reporting_manager) : null,
        processName: row.process_name ? String(row.process_name) : null,
        branchName: row.branch_name ? String(row.branch_name) : null,
        costCentre: row.cost_centre ? String(row.cost_centre) : null,
        days: {},
        dayCells: includeAdherence ? {} : undefined,
        _adherenceStats: { green: 0, amber: 0, red: 0, brown: 0, total: 0 },
      });
    }
    dates.add(date);
    const emp = byEmployee.get(empId)!;
    const label = cellLabel(row);
    emp.days[date] = label;

    if (includeAdherence) {
      const type = String(row.assignment_type ?? '').toUpperCase();
      let adherence: AdherenceStatus;
      let lateMinutes: number | undefined;
      let workedPct: number | undefined;

      if (isOffType(type)) {
        adherence = 'GREY';
      } else if (date > today) {
        adherence = 'FUTURE';
      } else {
        const attKey = `${empId}|${date}`;
        const att = attendanceMap.get(attKey);
        const expectedMinutes = getExpectedMinutes(row);
        const shiftStart = row.start_time ? timeToMinutes(String(row.start_time))
          : (row.own_start_time ? timeToMinutes(String(row.own_start_time)) : null);

        if (!att || !att.first_in) {
          // No attendance record — unplanned absence
          adherence = 'RED';
          emp._adherenceStats.red++;
          emp._adherenceStats.total++;
        } else {
          const loginMinutes = att.first_in ? timeToMinutes(String(att.first_in)) : 0;
          const workedMinutes = (Number(att.total_hours) || 0) * 60;
          workedPct = expectedMinutes > 0 ? Math.round((workedMinutes / expectedMinutes) * 100) : 100;

          if (workedPct < INCOMPLETE_THRESHOLD * 100) {
            // Incomplete shift
            adherence = 'BROWN';
            emp._adherenceStats.brown++;
            emp._adherenceStats.total++;
          } else if (shiftStart !== null && loginMinutes > shiftStart + GRACE_MINUTES) {
            // Late
            adherence = 'AMBER';
            lateMinutes = loginMinutes - shiftStart;
            emp._adherenceStats.amber++;
            emp._adherenceStats.total++;
          } else {
            // On-time
            adherence = 'GREEN';
            emp._adherenceStats.green++;
            emp._adherenceStats.total++;
          }
        }

        // Aggregate for analytics (only for working days in past)
        const processId = row.process_id ? String(row.process_id) : null;
        const branchId = row.branch_id ? String(row.branch_id) : null;
        if (processId) {
          if (!byProcess.has(processId)) byProcess.set(processId, { name: String(row.process_name ?? ''), green: 0, total: 0 });
          const p = byProcess.get(processId)!;
          p.total++;
          if (adherence === 'GREEN') p.green++;
        }
        if (branchId) {
          if (!byBranch.has(branchId)) byBranch.set(branchId, { name: String(row.branch_name ?? ''), green: 0, total: 0 });
          const b = byBranch.get(branchId)!;
          b.total++;
          if (adherence === 'GREEN') b.green++;
        }
        globalTotal++;
        if (adherence === 'GREEN') globalGreen++;
      }

      emp.dayCells![date] = { label, adherence, lateMinutes, workedPct };
    }
  }

  // Compute employee-level adherence %
  const resultRows: RosterViewRow[] = [];
  for (const emp of byEmployee.values()) {
    const stats = emp._adherenceStats;
    const adherencePct = stats.total > 0
      ? Math.round(((stats.green + stats.amber) / stats.total) * 100) // Green + Amber = attended
      : undefined;
    const { _adherenceStats, ...rest } = emp;
    resultRows.push({ ...rest, adherencePct: includeAdherence ? adherencePct : undefined });
  }

  // Build analytics summary
  let analytics: RosterAdherenceAnalytics | undefined;
  if (includeAdherence) {
    analytics = {
      overall: {
        adherencePct: globalTotal > 0 ? Math.round((globalGreen / globalTotal) * 100) : null,
        totalShifts: globalTotal,
        onTimeShifts: globalGreen,
      },
      byProcess: [...byProcess.entries()].map(([id, p]) => ({
        processId: id,
        processName: p.name,
        adherencePct: p.total > 0 ? Math.round((p.green / p.total) * 100) : null,
        totalShifts: p.total,
      })),
      byBranch: [...byBranch.entries()].map(([id, b]) => ({
        branchId: id,
        branchName: b.name,
        adherencePct: b.total > 0 ? Math.round((b.green / b.total) * 100) : null,
        totalShifts: b.total,
      })),
    };
  }

  return { rows: resultRows, dates: [...dates].sort(), total, analytics };
}

/** Analytics summary for adherence */
export interface RosterAdherenceAnalytics {
  overall: {
    adherencePct: number | null;
    totalShifts: number;
    onTimeShifts: number;
  };
  byProcess: Array<{
    processId: string;
    processName: string;
    adherencePct: number | null;
    totalShifts: number;
  }>;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    adherencePct: number | null;
    totalShifts: number;
  }>;
}

// ── getRosterStatusSummary ──────────────────────────────────────────────────
//
// "Has the roster actually been published, and has anyone acknowledged it" — the question the
// audit found had no answer anywhere in the product (413,386 assignments, 100% still 'generated',
// zero ROSTER_ACK_PENDING items had ever been created). Scoped and filterable the same way the
// rest of this file is (branch/process via employees, never the assignment's own branch_name/
// process_name text columns — see the file header comment on why those are unreliable).

export interface RosterStatusSummaryFilters {
  fromDate: string;
  toDate: string;
  branchId?: string;
  processId?: string;
}

export interface RosterStatusSummary {
  totalAssignments: number;
  /** final_roster_status breakdown — 'generated' means never published. */
  byPublishStage: Array<{ status: string; count: number }>;
  /** employee_ack_status breakdown — meaningful only once a row has left 'generated'. */
  byAckStatus: Array<{ status: string; count: number }>;
  publishedCount: number;
  unpublishedCount: number;
}

// ── Employee Roster Adherence Trend ───────────────────────────────────────────
/**
 * Get historical adherence trend for a single employee over past N months.
 * Returns monthly adherence % for trend visualization.
 */
export async function getEmployeeAdherenceTrend(
  employeeId: string,
  months: number = 6
): Promise<{
  employeeId: string;
  months: Array<{
    month: string; // YYYY-MM
    adherencePct: number | null;
    totalShifts: number;
    onTimeShifts: number;
    lateShifts: number;
    absentShifts: number;
    incompleteShifts: number;
  }>;
}> {
  const result: Array<{
    month: string;
    adherencePct: number | null;
    totalShifts: number;
    onTimeShifts: number;
    lateShifts: number;
    absentShifts: number;
    incompleteShifts: number;
  }> = [];

  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const firstDay = `${monthStr}-01`;
    const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

    // Get roster assignments for this month
    const [rosterRows] = await db.execute<RowDataPacket[]>(
      `SELECT ra.roster_date,
              ra.assignment_type,
              ra.shift_start_time AS own_start_time,
              ra.shift_end_time AS own_end_time,
              st.start_time,
              st.end_time
         FROM wfm_roster_assignment ra
         LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
        WHERE ra.employee_id = ?
          AND ra.roster_date BETWEEN ? AND ?`,
      [employeeId, firstDay, lastDay]
    );

    // Get attendance for this month
    const [attRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS att_date,
              first_in,
              total_hours
         FROM attendance_daily_record
        WHERE employee_id = ?
          AND attendance_date BETWEEN ? AND ?`,
      [employeeId, firstDay, lastDay]
    );

    const attMap = new Map<string, RowDataPacket>();
    for (const a of attRows) attMap.set(a.att_date, a);

    let onTime = 0, late = 0, absent = 0, incomplete = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const r of rosterRows) {
      const date = new Date(r.roster_date).toISOString().slice(0, 10);
      const type = String(r.assignment_type ?? '').toUpperCase();
      if (isOffType(type)) continue; // Skip WO/Leave/Holiday
      if (date > today) continue; // Skip future dates

      const att = attMap.get(date);
      const expectedMinutes = getExpectedMinutes(r);
      const shiftStart = r.start_time ? timeToMinutes(String(r.start_time))
        : (r.own_start_time ? timeToMinutes(String(r.own_start_time)) : null);

      if (!att || !att.first_in) {
        absent++;
      } else {
        const loginMinutes = timeToMinutes(String(att.first_in));
        const workedMinutes = (Number(att.total_hours) || 0) * 60;
        const workedPct = expectedMinutes > 0 ? (workedMinutes / expectedMinutes) * 100 : 100;

        if (workedPct < INCOMPLETE_THRESHOLD * 100) {
          incomplete++;
        } else if (shiftStart !== null && loginMinutes > shiftStart + GRACE_MINUTES) {
          late++;
        } else {
          onTime++;
        }
      }
    }

    const total = onTime + late + absent + incomplete;
    result.push({
      month: monthStr,
      adherencePct: total > 0 ? Math.round((onTime / total) * 100) : null,
      totalShifts: total,
      onTimeShifts: onTime,
      lateShifts: late,
      absentShifts: absent,
      incompleteShifts: incomplete,
    });
  }

  return { employeeId, months: result };
}

export async function getRosterStatusSummary(
  filters: RosterStatusSummaryFilters
): Promise<RosterStatusSummary> {
  const where = ['ra.roster_date BETWEEN ? AND ?'];
  const params: unknown[] = [filters.fromDate, filters.toDate];
  if (filters.branchId) { where.push('e.branch_id = ?'); params.push(filters.branchId); }
  if (filters.processId) { where.push('e.process_id = ?'); params.push(filters.processId); }
  const whereSql = where.join(' AND ');

  const [publishRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(ra.final_roster_status, 'generated') AS status, COUNT(*) AS cnt
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id
      WHERE ${whereSql}
      GROUP BY status`,
    params
  );
  const [ackRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(ra.employee_ack_status, 'pending') AS status, COUNT(*) AS cnt
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id
      WHERE ${whereSql}
      GROUP BY status`,
    params
  );

  const byPublishStage = (publishRows as RowDataPacket[]).map((r) => ({
    status: String(r.status), count: Number(r.cnt),
  }));
  const byAckStatus = (ackRows as RowDataPacket[]).map((r) => ({
    status: String(r.status), count: Number(r.cnt),
  }));
  const totalAssignments = byPublishStage.reduce((sum, r) => sum + r.count, 0);
  const unpublishedCount = byPublishStage.find((r) => r.status === 'generated')?.count ?? 0;
  const publishedCount = totalAssignments - unpublishedCount;

  return { totalAssignments, byPublishStage, byAckStatus, publishedCount, unpublishedCount };
}
