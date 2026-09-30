/**
 * Manager Analytics Service — Manager Dashboard Metrics
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { attendedDaysSql, expectedToWorkSql } from "../../shared/attendanceStatus.js";

interface ManagerAnalyticsSummary {
  team_size: number;
  team_quality_avg: number;
  team_kpi_avg: number;
  one_on_one_completion: {
    scheduled: number;
    completed: number;
    completion_rate: number;
  };
  pip_tracking: {
    active_pips: number;
    completed_this_month: number;
    at_risk_count: number;
  };
  performance_bands: {
    s_rating: number;
    a_rating: number;
    b_rating: number;
    c_rating: number;
    d_rating: number;
  };
  attrition_risk: Array<{
    employee_id: number;
    employee_name: string;
    quality_score: number;
    attendance_pct: number;
    risk_level: string;
  }>;
  team_kpi_by_process: Array<{
    process_id: number;
    process_name: string;
    target: number;
    actual: number;
    achievement_pct: number;
    status: string;
  }>;
  quality_distribution: Array<{
    score_range: string;
    count: number;
  }>;
}

// None of the tables this service named exist (quality_scores, kpi_scores,
// one_on_one_meetings, performance_improvement_plans, attendance, processes), employees has
// no `status` or `name` column, and the route passed Number(<uuid>) — NaN — as the manager,
// so the endpoint raised ER_NO_SUCH_TABLE and could not have matched a team anyway.
// Mapped onto the tables the modules actually write:
//
//   the team            -> employees.reporting_manager_id = the caller's employee id (a CHAR(36)
//                          UUID, passed as a string), active_status = 1. Every query below is
//                          driven from that set, so nothing is read for anyone outside it.
//                          The two hot tables are STRAIGHT_JOINed after the team so they are
//                          always reached per employee through their (employee_id, ...) keys.
//   quality_scores      -> qa_audit (quality_percentage, audit_date), counting audits that are
//                          submitted / calibrated / closed — a draft is not a score yet.
//   kpi_scores          -> kpi_daily_actual for the current month, scored against
//                          kpi_process_config targets with the same direction-aware, weighted,
//                          120%-capped achievement formula as the Team KPI page
//                          (managementService.getTeamKpiSummary). One score per employee.
//   KPI by process      -> the team's employee scores averaged per process. Metrics carry
//                          different units, so there is no single raw target/actual to show:
//                          `target` is 100 (full achievement) and `actual` is the achievement
//                          score, both in achievement points.
//   attendance          -> attendance_daily_record, last 30 completed days, as attended days
//                          over days expected to work (week offs, holidays and approved leave
//                          are not absences).
//   one_on_one_meetings -> coaching_session rows this month where the manager is the coach
//                          (coach_user_id is a user id, so it is matched on the manager's
//                          user account). Cancelled sessions are not counted as scheduled.
//   performance_improvement_plans -> pip_record: active = active / extended; completed this
//                          month = status 'completed' with closed_at in the month.
//   processes           -> process_master
//
// Nothing in this summary is empty by design: every field reads a real table. Tables that
// hold no rows yet simply report 0 / [].
//
// An employee with no audits is not flagged on quality and one with no attendance rows is
// not flagged on attendance; `quality_score` / `attendance_pct` then read 0 in the at-risk
// list because the declared type has no "not measured" value.
//
// employee_id and process_id are CHAR(36) UUIDs in this schema; the interface keeps the
// `number` the dashboard hook declares, but the value on the wire is the UUID string.
const TEAM = "e.reporting_manager_id = ? AND e.active_status = 1";
const EMPLOYEE_NAME =
  "COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))))";
const QA_SCORED = "'submitted', 'calibrated', 'closed'";
const MONTH_START = "DATE_FORMAT(CURDATE(), '%Y-%m-01')";
const NEXT_MONTH_START = `DATE_ADD(${MONTH_START}, INTERVAL 1 MONTH)`;
const KPI_ACHIEVEMENT = `CASE WHEN kmm.direction = 'lower_is_better'
            THEN LEAST(kpc.target_value / NULLIF(kda.actual_value, 0), 1.2)
            ELSE LEAST(kda.actual_value / NULLIF(kpc.target_value, 0), 1.2)
       END * 100`;
const QUALITY_BANDS = ["90-100", "80-89", "70-79", "60-69", "<60"] as const;

const num = (value: unknown): number => Number(value ?? 0) || 0;
const orNull = (value: unknown): number | null => (value == null ? null : Number(value));

function riskLevel(quality: number | null, attendance: number | null): string | null {
  if ((quality != null && quality < 50) || (attendance != null && attendance < 70)) return "critical";
  if ((quality != null && quality < 60) || (attendance != null && attendance < 80)) return "high";
  return null;
}

export async function getManagerAnalyticsSummary(managerId: string): Promise<ManagerAnalyticsSummary> {
  // The team
  const [team] = await db.query<RowDataPacket[]>(
    `SELECT e.id as employee_id, ${EMPLOYEE_NAME} as employee_name
     FROM employees e
     WHERE ${TEAM}`,
    [managerId]
  );

  // Quality per team member (last 30 days), with the histogram buckets per audit
  const [quality] = await db.query<RowDataPacket[]>(
    `SELECT
       q.employee_id,
       COUNT(*) as audits,
       SUM(q.quality_percentage) as score_total,
       SUM(CASE WHEN q.quality_percentage >= 90 THEN 1 ELSE 0 END) as band_90,
       SUM(CASE WHEN q.quality_percentage >= 80 AND q.quality_percentage < 90 THEN 1 ELSE 0 END) as band_80,
       SUM(CASE WHEN q.quality_percentage >= 70 AND q.quality_percentage < 80 THEN 1 ELSE 0 END) as band_70,
       SUM(CASE WHEN q.quality_percentage >= 60 AND q.quality_percentage < 70 THEN 1 ELSE 0 END) as band_60,
       SUM(CASE WHEN q.quality_percentage < 60 THEN 1 ELSE 0 END) as band_low
     FROM employees e
     INNER JOIN qa_audit q ON q.employee_id = e.id
       AND q.audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     WHERE ${TEAM}
       AND q.status IN (${QA_SCORED})
       AND q.quality_percentage IS NOT NULL
     GROUP BY q.employee_id`,
    [managerId]
  );

  // Attendance per team member (last 30 completed days)
  const [attendance] = await db.query<RowDataPacket[]>(
    `SELECT
       a.employee_id,
       ${attendedDaysSql("a.attendance_status")} / NULLIF(${expectedToWorkSql("a.attendance_status")}, 0) * 100 as attendance_pct
     FROM employees e
     STRAIGHT_JOIN attendance_daily_record a ON a.employee_id = e.id
       AND a.record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       AND a.record_date < CURDATE()
     WHERE ${TEAM}
     GROUP BY a.employee_id`,
    [managerId]
  );

  // KPI achievement per team member (current month)
  const [kpi] = await db.query<RowDataPacket[]>(
    `SELECT
       e.id as employee_id,
       e.process_id,
       p.process_name,
       SUM((${KPI_ACHIEVEMENT}) * kpc.weightage) / NULLIF(SUM(kpc.weightage), 0) as achievement_pct
     FROM employees e
     STRAIGHT_JOIN kpi_daily_actual kda ON kda.employee_id = e.id
       AND kda.score_date >= ${MONTH_START}
       AND kda.score_date < ${NEXT_MONTH_START}
     INNER JOIN kpi_process_config kpc ON kpc.process_id = e.process_id
       AND kpc.metric_id = kda.metric_id
     INNER JOIN kpi_metric_master kmm ON kmm.id = kda.metric_id
     LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${TEAM}
     GROUP BY e.id, e.process_id, p.process_name`,
    [managerId]
  );

  // 1:1 completion — coaching sessions this month with the manager as coach
  const [managerUser] = await db.query<RowDataPacket[]>(
    `SELECT user_id FROM employees WHERE id = ? LIMIT 1`,
    [managerId]
  );
  const managerUserId = managerUser[0]?.user_id ?? null;

  const [oneOnOne] = managerUserId == null ? [[] as RowDataPacket[]] : await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as scheduled,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
     FROM coaching_session
     WHERE session_date >= ${MONTH_START}
       AND session_date < ${NEXT_MONTH_START}
       AND coach_user_id = ?
       AND status <> 'cancelled'`,
    [managerUserId]
  );

  const scheduled = num(oneOnOne[0]?.scheduled);
  const completed = num(oneOnOne[0]?.completed);
  const completionRate = scheduled > 0 ? Math.round((completed / scheduled) * 100) : 0;

  // PIP tracking
  const [pipStats] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN p.status IN ('active', 'extended') THEN 1 ELSE 0 END) as active_pips,
       SUM(CASE WHEN p.status = 'completed'
                 AND p.closed_at >= ${MONTH_START}
                 AND p.closed_at < ${NEXT_MONTH_START} THEN 1 ELSE 0 END) as completed_month
     FROM employees e
     INNER JOIN pip_record p ON p.employee_id = e.id
     WHERE ${TEAM}`,
    [managerId]
  );

  // Team quality average and histogram
  const qualityByEmployee = new Map<string, number>();
  const bandCounts = [0, 0, 0, 0, 0];
  let audits = 0;
  let scoreTotal = 0;
  for (const r of quality) {
    const count = num(r.audits);
    if (count > 0) qualityByEmployee.set(String(r.employee_id), num(r.score_total) / count);
    audits += count;
    scoreTotal += num(r.score_total);
    bandCounts[0] += num(r.band_90);
    bandCounts[1] += num(r.band_80);
    bandCounts[2] += num(r.band_70);
    bandCounts[3] += num(r.band_60);
    bandCounts[4] += num(r.band_low);
  }

  const attendanceByEmployee = new Map<string, number>();
  for (const r of attendance) {
    const value = orNull(r.attendance_pct);
    if (value != null) attendanceByEmployee.set(String(r.employee_id), value);
  }

  // At-risk employees (quality < 60 OR attendance < 80%)
  const atRisk = team
    .map((r) => {
      const quality30 = qualityByEmployee.get(String(r.employee_id)) ?? null;
      const attendance30 = attendanceByEmployee.get(String(r.employee_id)) ?? null;
      return { row: r, quality30, attendance30, level: riskLevel(quality30, attendance30) };
    })
    .filter((m): m is typeof m & { level: string } => m.level !== null)
    .sort((a, b) =>
      (a.level === "critical" ? 0 : 1) - (b.level === "critical" ? 0 : 1)
      || (a.quality30 ?? Infinity) - (b.quality30 ?? Infinity));

  // KPI average, performance bands (S/A/B/C/D) and per-process roll-up
  const bands = { s_rating: 0, a_rating: 0, b_rating: 0, c_rating: 0, d_rating: 0 };
  const byProcess = new Map<string, { process_id: string; process_name: string; total: number; count: number }>();
  let kpiTotal = 0;
  let kpiCount = 0;
  for (const r of kpi) {
    const achievement = orNull(r.achievement_pct);
    if (achievement == null) continue;
    kpiTotal += achievement;
    kpiCount += 1;
    if (achievement >= 100) bands.s_rating += 1;
    else if (achievement >= 90) bands.a_rating += 1;
    else if (achievement >= 75) bands.b_rating += 1;
    else if (achievement >= 60) bands.c_rating += 1;
    else bands.d_rating += 1;

    if (r.process_id == null) continue;
    const processId = String(r.process_id);
    const entry = byProcess.get(processId)
      ?? { process_id: processId, process_name: String(r.process_name ?? ""), total: 0, count: 0 };
    entry.total += achievement;
    entry.count += 1;
    byProcess.set(processId, entry);
  }

  return {
    team_size: team.length,
    team_quality_avg: audits > 0 ? Math.round(scoreTotal / audits) : 0,
    team_kpi_avg: kpiCount > 0 ? Math.round(kpiTotal / kpiCount) : 0,
    one_on_one_completion: {
      scheduled,
      completed,
      completion_rate: completionRate,
    },
    pip_tracking: {
      active_pips: num(pipStats[0]?.active_pips),
      completed_this_month: num(pipStats[0]?.completed_month),
      at_risk_count: atRisk.length,
    },
    performance_bands: bands,
    attrition_risk: atRisk.slice(0, 10).map((m) => ({
      employee_id: m.row.employee_id,
      employee_name: m.row.employee_name,
      quality_score: Math.round(m.quality30 ?? 0),
      attendance_pct: Math.round(m.attendance30 ?? 0),
      risk_level: m.level,
    })),
    team_kpi_by_process: [...byProcess.values()]
      .map((entry) => {
        const achievement = entry.total / entry.count;
        return {
          // A UUID string at runtime; see the note above the constants.
          process_id: entry.process_id as unknown as number,
          process_name: entry.process_name,
          target: 100,
          actual: Math.round(achievement * 10) / 10,
          achievement_pct: Math.round(achievement),
          status: achievement >= 90 ? "green" : achievement >= 75 ? "amber" : "red",
        };
      })
      .sort((a, b) => b.achievement_pct - a.achievement_pct),
    quality_distribution: QUALITY_BANDS
      .map((score_range, i) => ({ score_range, count: bandCounts[i] }))
      .filter((band) => band.count > 0),
  };
}
