import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse a YYYY-MM period string into first/last day boundaries.
 * Defaults to the current calendar month if absent or malformed.
 */
function parsePeriod(period?: string): { periodStart: string; periodEnd: string; label: string } {
  const now = new Date();
  const match = typeof period === "string" ? period.match(/^(\d{4})-(\d{2})$/) : null;
  const year = match ? parseInt(match[1], 10) : now.getFullYear();
  const month = match ? parseInt(match[2], 10) : now.getMonth() + 1;

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    periodStart: `${year}-${mm}-01`,
    periodEnd: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
    label: `${year}-${mm}`,
  };
}

// ── Employee compliance ───────────────────────────────────────────────────────

/**
 * GET /api/wfm-compliance/employee
 * Query params: employeeId (required), period (YYYY-MM, optional)
 *
 * Returns per-employee WFM compliance metrics for the given month.
 */
export async function getEmployeeWfmCompliance(req: Request, res: Response): Promise<Response> {
  const { employeeId, period } = req.query as Record<string, string>;

  if (!employeeId) {
    return res.status(400).json({ error: "employeeId is required" });
  }

  const { periodStart, periodEnd, label } = parsePeriod(period);

  try {
    // ── Employee basics ──────────────────────────────────────────────────────
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code,
              CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
              b.branch_name, p.process_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       WHERE e.id = ?
       LIMIT 1`,
      [employeeId]
    );
    if ((empRows as RowDataPacket[]).length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }
    const employee = (empRows as RowDataPacket[])[0];

    // ── Roster assignments in period ─────────────────────────────────────────
    const [rosterRows] = await db.execute<RowDataPacket[]>(
      `SELECT wra.id AS assignment_id,
              wra.roster_date,
              wra.shift_id,
              ws.start_time,
              ws.required_minutes
       FROM wfm_roster_assignment wra
       LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
       WHERE wra.employee_id = ?
         AND wra.roster_date BETWEEN ? AND ?`,
      [employeeId, periodStart, periodEnd]
    );
    const rosterEntries = rosterRows as RowDataPacket[];
    const totalRostered = rosterEntries.length;

    if (totalRostered === 0) {
      return res.json({
        period: label,
        employee,
        metrics: {
          session_count: 0,
          schedule_adherence_pct: null,
          avg_late_by_minutes: null,
          occupancy_pct: null,
          break_compliance_pct: null,
          avg_excess_break_minutes: null,
          total_login_hours: null,
        },
        message: "No roster assignments found for this period",
      });
    }

    // ── Attendance sessions in period ────────────────────────────────────────
    const [sessionRows] = await db.execute<RowDataPacket[]>(
      `SELECT was.id AS session_id,
              was.session_date,
              was.login_time,
              was.total_login_minutes
       FROM wfm_attendance_session was
       WHERE was.employee_id = ?
         AND was.session_date BETWEEN ? AND ?`,
      [employeeId, periodStart, periodEnd]
    );
    const sessions = sessionRows as RowDataPacket[];
    const sessionCount = sessions.length;

    // Build a map keyed by session_date for quick roster cross-reference
    const sessionByDate = new Map<string, RowDataPacket>();
    for (const s of sessions) {
      const dateKey = typeof s.session_date === "string"
        ? s.session_date.slice(0, 10)
        : new Date(s.session_date).toISOString().slice(0, 10);
      sessionByDate.set(dateKey, s);
    }

    // ── Schedule adherence ────────────────────────────────────────────────────
    let onTimeCount = 0;
    let totalLateMinutes = 0;
    let lateCount = 0;
    let totalRequiredMinutes = 0;
    let totalActualMinutes = 0;

    for (const roster of rosterEntries) {
      const dateKey = typeof roster.roster_date === "string"
        ? roster.roster_date.slice(0, 10)
        : new Date(roster.roster_date).toISOString().slice(0, 10);
      const session = sessionByDate.get(dateKey);
      if (!session) continue;

      totalRequiredMinutes += toNum(roster.required_minutes);
      totalActualMinutes += toNum(session.total_login_minutes);

      // Compare login_time vs shift start_time (both are TIME strings HH:MM:SS)
      if (roster.start_time && session.login_time) {
        const shiftMinutes = timeToMinutes(String(roster.start_time));
        const loginMinutes = timeToMinutes(String(session.login_time));
        const graceLimit = shiftMinutes + 5;

        if (loginMinutes <= graceLimit) {
          onTimeCount++;
        } else {
          lateCount++;
          totalLateMinutes += loginMinutes - shiftMinutes;
        }
      }
    }

    const scheduleAdherencePct =
      totalRostered > 0 ? (onTimeCount / totalRostered) * 100 : null;
    const avgLateByMinutes = lateCount > 0 ? totalLateMinutes / lateCount : null;
    const occupancyPct =
      totalRequiredMinutes > 0 ? (totalActualMinutes / totalRequiredMinutes) * 100 : null;
    const totalLoginHours = totalActualMinutes / 60;

    // ── Break compliance ──────────────────────────────────────────────────────
    let breakCompliancePct: number | null = null;
    let avgExcessBreakMinutes: number | null = null;

    const sessionIds = sessions.map((s) => s.session_id as string).filter(Boolean);

    if (sessionIds.length > 0) {
      const placeholders = sessionIds.map(() => "?").join(", ");
      const [breakRows] = await db.execute<RowDataPacket[]>(
        `SELECT session_id, SUM(duration_minutes) AS total_break_minutes
         FROM wfm_break_log
         WHERE session_id IN (${placeholders})
           AND employee_id = ?
         GROUP BY session_id`,
        [...sessionIds, employeeId]
      );
      const breakBySession = new Map<string, number>();
      for (const br of breakRows as RowDataPacket[]) {
        breakBySession.set(String(br.session_id), toNum(br.total_break_minutes));
      }

      const BREAK_BUDGET = 30;
      let compliantSessions = 0;
      let totalExcess = 0;
      let excessCount = 0;

      for (const s of sessions) {
        const sid = String(s.session_id);
        const breakMins = breakBySession.get(sid) ?? 0;
        if (breakMins <= BREAK_BUDGET) {
          compliantSessions++;
        } else {
          totalExcess += breakMins - BREAK_BUDGET;
          excessCount++;
        }
      }

      breakCompliancePct = sessionCount > 0 ? (compliantSessions / sessionCount) * 100 : null;
      avgExcessBreakMinutes = excessCount > 0 ? totalExcess / excessCount : null;
    }

    return res.json({
      period: label,
      employee,
      metrics: {
        session_count: sessionCount,
        total_rostered: totalRostered,
        schedule_adherence_pct: scheduleAdherencePct !== null ? round2(scheduleAdherencePct) : null,
        avg_late_by_minutes: avgLateByMinutes !== null ? round2(avgLateByMinutes) : null,
        occupancy_pct: occupancyPct !== null ? round2(occupancyPct) : null,
        break_compliance_pct: breakCompliancePct !== null ? round2(breakCompliancePct) : null,
        avg_excess_break_minutes: avgExcessBreakMinutes !== null ? round2(avgExcessBreakMinutes) : null,
        total_login_hours: round2(totalLoginHours),
      },
    });
  } catch (err: unknown) {
    console.error("[wfm-compliance] getEmployeeWfmCompliance error:", err);
    return res.status(500).json({ error: "Failed to compute employee WFM compliance" });
  }
}

// ── Branch compliance ─────────────────────────────────────────────────────────

/**
 * GET /api/wfm-compliance/branch
 * Query params: branchId (required), period (YYYY-MM, optional), processId (optional)
 *
 * Returns aggregate + per-employee breakdown for the branch.
 */
export async function getBranchWfmCompliance(req: Request, res: Response): Promise<Response> {
  const { branchId, period, processId } = req.query as Record<string, string>;

  if (!branchId) {
    return res.status(400).json({ error: "branchId is required" });
  }

  const { periodStart, periodEnd, label } = parsePeriod(period);

  try {
    // ── Employees in scope ────────────────────────────────────────────────────
    const empConds = ["e.branch_id = ?", "e.active_status = 1"];
    const empParams: unknown[] = [branchId];
    if (processId) {
      empConds.push("e.process_id = ?");
      empParams.push(processId);
    }
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.employee_code,
              CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
              b.branch_name, p.process_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       WHERE ${empConds.join(" AND ")}`,
      empParams
    );
    const employees = empRows as RowDataPacket[];
    if (employees.length === 0) {
      return res.json({
        period: label,
        branch_id: branchId,
        process_id: processId ?? null,
        aggregate: {
          total_employees: 0,
          schedule_adherence_pct: null,
          avg_late_by_minutes: null,
          occupancy_pct: null,
          break_compliance_pct: null,
          avg_excess_break_minutes: null,
          total_login_hours: null,
        },
        worst_adherence: [],
        message: "No active employees found for scope",
      });
    }

    const employeeIds = employees.map((e) => e.employee_id as string);
    const empPlaceholders = employeeIds.map(() => "?").join(", ");

    // ── Roster assignments for all employees ──────────────────────────────────
    const [rosterRows] = await db.execute<RowDataPacket[]>(
      `SELECT wra.employee_id,
              wra.roster_date,
              ws.start_time,
              ws.required_minutes
       FROM wfm_roster_assignment wra
       LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
       WHERE wra.employee_id IN (${empPlaceholders})
         AND wra.roster_date BETWEEN ? AND ?`,
      [...employeeIds, periodStart, periodEnd]
    );

    // ── Attendance sessions for all employees ─────────────────────────────────
    const [sessionRows] = await db.execute<RowDataPacket[]>(
      `SELECT was.id AS session_id,
              was.employee_id,
              was.session_date,
              was.login_time,
              was.total_login_minutes
       FROM wfm_attendance_session was
       WHERE was.employee_id IN (${empPlaceholders})
         AND was.session_date BETWEEN ? AND ?`,
      [...employeeIds, periodStart, periodEnd]
    );
    const allSessions = sessionRows as RowDataPacket[];

    // ── Break log for all sessions ────────────────────────────────────────────
    const allSessionIds = allSessions.map((s) => s.session_id as string).filter(Boolean);
    const breakBySession = new Map<string, number>();

    if (allSessionIds.length > 0) {
      const bPlaceholders = allSessionIds.map(() => "?").join(", ");
      const [breakRows] = await db.execute<RowDataPacket[]>(
        `SELECT session_id, SUM(duration_minutes) AS total_break_minutes
         FROM wfm_break_log
         WHERE session_id IN (${bPlaceholders})
         GROUP BY session_id`,
        allSessionIds
      );
      for (const br of breakRows as RowDataPacket[]) {
        breakBySession.set(String(br.session_id), toNum(br.total_break_minutes));
      }
    }

    // ── Per-employee metric accumulation ──────────────────────────────────────
    // Group roster by employee
    const rosterByEmp = new Map<string, RowDataPacket[]>();
    for (const r of rosterRows as RowDataPacket[]) {
      const eid = String(r.employee_id);
      if (!rosterByEmp.has(eid)) rosterByEmp.set(eid, []);
      rosterByEmp.get(eid)!.push(r);
    }

    // Group sessions by employee
    const sessionsByEmp = new Map<string, RowDataPacket[]>();
    for (const s of allSessions) {
      const eid = String(s.employee_id);
      if (!sessionsByEmp.has(eid)) sessionsByEmp.set(eid, []);
      sessionsByEmp.get(eid)!.push(s);
    }

    const BREAK_BUDGET = 30;
    const perEmployeeResults: Array<{
      employee_id: string;
      employee_code: string;
      employee_name: string;
      session_count: number;
      total_rostered: number;
      schedule_adherence_pct: number | null;
      avg_late_by_minutes: number | null;
      occupancy_pct: number | null;
      break_compliance_pct: number | null;
      total_login_hours: number;
    }> = [];

    let aggOnTimeCount = 0;
    let aggTotalRostered = 0;
    let aggLateMinutes = 0;
    let aggLateCount = 0;
    let aggRequiredMinutes = 0;
    let aggActualMinutes = 0;
    let aggCompliantSessions = 0;
    let aggTotalSessions = 0;
    let aggExcessBreak = 0;
    let aggExcessCount = 0;

    for (const emp of employees) {
      const eid = String(emp.employee_id);
      const empRoster = rosterByEmp.get(eid) ?? [];
      const empSessions = sessionsByEmp.get(eid) ?? [];

      const totalRostered = empRoster.length;
      const sessionCount = empSessions.length;

      // Session map by date
      const sessionByDate = new Map<string, RowDataPacket>();
      for (const s of empSessions) {
        const dk = typeof s.session_date === "string"
          ? s.session_date.slice(0, 10)
          : new Date(s.session_date).toISOString().slice(0, 10);
        sessionByDate.set(dk, s);
      }

      let onTime = 0;
      let lateMin = 0;
      let lateC = 0;
      let reqMin = 0;
      let actMin = 0;

      for (const r of empRoster) {
        const dk = typeof r.roster_date === "string"
          ? r.roster_date.slice(0, 10)
          : new Date(r.roster_date).toISOString().slice(0, 10);
        const s = sessionByDate.get(dk);
        if (!s) continue;

        reqMin += toNum(r.required_minutes);
        actMin += toNum(s.total_login_minutes);

        if (r.start_time && s.login_time) {
          const shiftMin = timeToMinutes(String(r.start_time));
          const loginMin = timeToMinutes(String(s.login_time));
          if (loginMin <= shiftMin + 5) {
            onTime++;
          } else {
            lateC++;
            lateMin += loginMin - shiftMin;
          }
        }
      }

      let compliant = 0;
      let excessB = 0;
      let excessC = 0;
      for (const s of empSessions) {
        const sid = String(s.session_id);
        const bm = breakBySession.get(sid) ?? 0;
        if (bm <= BREAK_BUDGET) {
          compliant++;
        } else {
          excessB += bm - BREAK_BUDGET;
          excessC++;
        }
      }

      const adherence = totalRostered > 0 ? (onTime / totalRostered) * 100 : null;

      perEmployeeResults.push({
        employee_id: eid,
        employee_code: String(emp.employee_code),
        employee_name: String(emp.employee_name),
        session_count: sessionCount,
        total_rostered: totalRostered,
        schedule_adherence_pct: adherence !== null ? round2(adherence) : null,
        avg_late_by_minutes: lateC > 0 ? round2(lateMin / lateC) : null,
        occupancy_pct: reqMin > 0 ? round2((actMin / reqMin) * 100) : null,
        break_compliance_pct: sessionCount > 0 ? round2((compliant / sessionCount) * 100) : null,
        total_login_hours: round2(actMin / 60),
      });

      // Aggregate accumulation
      aggOnTimeCount += onTime;
      aggTotalRostered += totalRostered;
      aggLateMinutes += lateMin;
      aggLateCount += lateC;
      aggRequiredMinutes += reqMin;
      aggActualMinutes += actMin;
      aggCompliantSessions += compliant;
      aggTotalSessions += sessionCount;
      aggExcessBreak += excessB;
      aggExcessCount += excessC;
    }

    // ── Aggregate metrics ─────────────────────────────────────────────────────
    const aggregate = {
      total_employees: employees.length,
      schedule_adherence_pct:
        aggTotalRostered > 0 ? round2((aggOnTimeCount / aggTotalRostered) * 100) : null,
      avg_late_by_minutes:
        aggLateCount > 0 ? round2(aggLateMinutes / aggLateCount) : null,
      occupancy_pct:
        aggRequiredMinutes > 0
          ? round2((aggActualMinutes / aggRequiredMinutes) * 100)
          : null,
      break_compliance_pct:
        aggTotalSessions > 0
          ? round2((aggCompliantSessions / aggTotalSessions) * 100)
          : null,
      avg_excess_break_minutes:
        aggExcessCount > 0 ? round2(aggExcessBreak / aggExcessCount) : null,
      total_login_hours: round2(aggActualMinutes / 60),
    };

    // Top 20 worst by schedule adherence (nulls last)
    const worst20 = [...perEmployeeResults]
      .sort((a, b) => {
        const aVal = a.schedule_adherence_pct ?? 101;
        const bVal = b.schedule_adherence_pct ?? 101;
        return aVal - bVal;
      })
      .slice(0, 20);

    return res.json({
      period: label,
      branch_id: branchId,
      process_id: processId ?? null,
      aggregate,
      worst_adherence: worst20,
    });
  } catch (err: unknown) {
    console.error("[wfm-compliance] getBranchWfmCompliance error:", err);
    return res.status(500).json({ error: "Failed to compute branch WFM compliance" });
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Convert HH:MM or HH:MM:SS time string to total minutes. */
function timeToMinutes(t: string): number {
  const parts = t.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
