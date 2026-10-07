/**
 * Shift Effectiveness queries (list + break compliance + recommendations + drill-down detail).
 * Extracted from roster-analytics.routes.ts; arithmetic lives in shift-effectiveness.calc.ts.
 *
 * Verified columns: wfm_roster_assignment(employee_id, roster_date, shift_template_id, is_week_off,
 * assignment_type, import_batch_id, cycle_id), wfm_shift_template(shift_code, version, shift_name, process_id,
 * branch_id, start_time, end_time, break_entitlement, effective_from/to, active_status),
 * attendance_daily_record(employee_id, record_date, attendance_status, late_mark),
 * break_daily_summary(employee_id, shift_date, branch_id, process_id, total_break_minutes, ...),
 * break_sessions, break_alert_logs, break_settings (see backend/sql/376_break_management_module.sql).
 */
import { db } from "../../db/mysql.js";
import { lobAnd, type LobFilter } from "../../shared/lobFilter.js";
import {
  BREAK_DAILY_HARD_MAX,
  analysisWindows,
  buildRecommendations,
  deltaPts,
  pct,
  rankShifts,
  shiftMetrics,
  shiftTypeFromStartHour,
  type CohortShift,
  type DateWindow,
  type EmployeeShiftRow,
  type ShiftAggRow,
} from "./shift-effectiveness.calc.js";

/** Same provenance guard as roster-analytics.routes.ts (excludes the synthetic 2026-06-11 cohort). */
const realRoster = (a: string) =>
  `NOT (${a}.import_batch_id IS NULL AND ${a}.cycle_id IS NULL AND ${a}.assignment_type IS NULL AND ${a}.shift_template_id IS NULL)`;

/** A working day whose attendance outcome is decided; the only rows that enter a denominator. */
const COUNTED =
  `(ra.is_week_off = 0 AND COALESCE(ra.assignment_type,'') <> 'WEEK_OFF' ` +
  `AND COALESCE(adr.attendance_status,'absent') NOT IN ('leave_approved','holiday','week_off','unreconciled'))`;
const PRESENT = `adr.attendance_status IN ('present','half_day')`;

/**
 * Daily break allowance for a break_daily_summary row: same precedence as
 * break-management.service.ts getSettings() (branch+process, then branch, then process, then global), capped at 60.
 * Was a hardcoded 30 here, which disagreed with the kiosk's own 60-minute default.
 */
const budgetSql = (a: string) =>
  `LEAST(${BREAK_DAILY_HARD_MAX}, COALESCE((SELECT bs.daily_total_allowed_minutes FROM break_settings bs ` +
  `WHERE (bs.branch_id = ${a}.branch_id OR bs.branch_id IS NULL) AND (bs.process_id = ${a}.process_id OR bs.process_id IS NULL) ` +
  `ORDER BY (bs.branch_id IS NOT NULL) DESC, (bs.process_id IS NOT NULL) DESC LIMIT 1), ${BREAK_DAILY_HARD_MAX}))`;

/**
 * break_daily_summary bounded to a window, with the resolved daily allowance computed ONCE per row as `budget`
 * (2 placeholders: from, to). Callers alias it `bds` and read bds.budget.
 */
const BDS_DERIVED =
  `(SELECT b.id, b.employee_id, b.shift_date, b.branch_id, b.process_id, b.total_break_minutes, b.mini_break_count, ` +
  `b.long_break_count, b.exceeded_break_count, b.exception_count, b.final_status, b.first_break_start, b.last_break_end, ` +
  `${budgetSql("b")} AS budget FROM break_daily_summary b WHERE b.shift_date BETWEEN ? AND ?) bds`;
const BUDGET = "bds.budget";

export interface ScopeFilter {
  branchId?: string;
  processId?: string;
  lob: LobFilter;
}

function scope(f: ScopeFilter): { sql: string; params: string[] } {
  let sql = "";
  const params: string[] = [];
  if (f.branchId) {
    sql += " AND e.branch_id = ?";
    params.push(f.branchId);
  }
  if (f.processId) {
    sql += " AND e.process_id = ?";
    params.push(f.processId);
  }
  const l = lobAnd(f.lob);
  sql += l.sql;
  params.push(...l.params);
  return { sql, params };
}

const n = (v: unknown) => (v == null ? 0 : Number(v));
const nn = (v: unknown) => (v == null ? null : Number(v));

// ── /shift-effectiveness ─────────────────────────────────────────────────────

const SHIFT_KEYS = `sm.id AS shift_id, sm.shift_name, sm.process_id AS tpl_process_id, sm.branch_id AS tpl_branch_id,
         TIME_FORMAT(sm.start_time, '%H:%i') AS start_hhmm, TIME_FORMAT(sm.end_time, '%H:%i') AS end_hhmm,
         HOUR(sm.start_time) AS start_hour`;
const SHIFT_GROUP = `GROUP BY sm.id, sm.shift_name, sm.process_id, sm.branch_id, sm.start_time, sm.end_time`;

function shiftAggQuery(
  w: DateWindow,
  f: ScopeFilter,
  full: boolean,
  onlyShiftId?: string,
) {
  const sc = scope(f);
  const params: string[] = [];
  let qaJoin = "";
  let bdsJoin = "";
  let fullCols = "";
  let bdsParams: string[] = [];
  if (full) {
    // call_quality_assessment lives in db_audit, keyed by the agent login (`User`) — which is the EMPLOYEE CODE
    // (quality-queries.ts passes employeeCode as User). employees.call_centre_code is NULL on every row, so the
    // previous join key never matched and quality always read 0. Bounded by CallDate (unbounded = 115s live).
    qaJoin = `LEFT JOIN (
         SELECT UPPER(TRIM(\`User\`)) AS agent_user, DATE(CallDate) AS d, AVG(quality_percentage) AS quality_percentage
         FROM db_audit.call_quality_assessment
         WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
         GROUP BY UPPER(TRIM(\`User\`)), DATE(CallDate)
       ) qa ON UPPER(TRIM(COALESCE(NULLIF(TRIM(e.call_centre_code), ''), e.employee_code))) = qa.agent_user AND ra.roster_date = qa.d`;
    params.push(w.from, w.to);
    // Kiosk breaks: sparse (only days with a kiosk summary). Days without a row are UNKNOWN, not "30 minutes".
    bdsJoin = `LEFT JOIN ${BDS_DERIVED} ON bds.employee_id = ra.employee_id AND bds.shift_date = ra.roster_date`;
    bdsParams = [w.from, w.to];
    const BR = `bds.id IS NOT NULL AND ${COUNTED} AND ${PRESENT}`;
    fullCols = `,
         AVG(CASE WHEN ${COUNTED} THEN qa.quality_percentage END) AS quality_avg,
         COUNT(CASE WHEN ${COUNTED} THEN qa.d END) AS quality_days,
         SUM(CASE WHEN ${BR} THEN 1 ELSE 0 END) AS break_days,
         SUM(CASE WHEN ${BR} AND bds.total_break_minutes <= ${BUDGET} THEN 1 ELSE 0 END) AS compliant_break_days,
         AVG(CASE WHEN ${BR} THEN bds.total_break_minutes END) AS avg_break_minutes,
         AVG(CASE WHEN ${BR} THEN ${BUDGET} END) AS avg_budget`;
  }
  params.push(...bdsParams);
  let where = `WHERE ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")}`;
  params.push(w.from, w.to);
  if (onlyShiftId) {
    where += " AND sm.id = ?";
    params.push(onlyShiftId);
  }
  where += sc.sql;
  params.push(...sc.params);
  const sql = `SELECT ${SHIFT_KEYS},
         COUNT(DISTINCT ra.employee_id) AS total_employees,
         SUM(CASE WHEN ${COUNTED} THEN 1 ELSE 0 END) AS scheduled_days,
         SUM(CASE WHEN ${COUNTED} AND ${PRESENT} THEN 1 ELSE 0 END) AS present_days,
         SUM(CASE WHEN ${COUNTED} AND ${PRESENT} AND adr.late_mark = 0 THEN 1 ELSE 0 END) AS on_time_days${fullCols}
       FROM wfm_roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       JOIN wfm_shift_template sm ON ra.shift_template_id = sm.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       ${qaJoin}
       ${bdsJoin}
       ${where}
       ${SHIFT_GROUP}`;
  return { sql, params };
}

function toAgg(r: any): ShiftAggRow {
  return {
    shiftId: r.shift_id,
    scheduledDays: n(r.scheduled_days),
    presentDays: n(r.present_days),
    onTimeDays: n(r.on_time_days),
    qualityAvg: nn(r.quality_avg),
    qualityDays: n(r.quality_days),
    breakDays: n(r.break_days),
    compliantBreakDays: n(r.compliant_break_days),
    avgBreakMinutes: nn(r.avg_break_minutes),
    avgBudget: nn(r.avg_budget),
  };
}

export async function getShiftEffectiveness(
  f: ScopeFilter,
  now: Date = new Date(),
) {
  const win = analysisWindows(now);
  const cur = shiftAggQuery(win.cur, f, true);
  const prev = shiftAggQuery(win.prev, f, true);
  const sc = scope(f);
  const daily = `SELECT sm.id AS shift_id, DATE_FORMAT(ra.roster_date, '%Y-%m-%d') AS d,
         SUM(CASE WHEN ${COUNTED} THEN 1 ELSE 0 END) AS scheduled,
         SUM(CASE WHEN ${COUNTED} AND ${PRESENT} THEN 1 ELSE 0 END) AS present
       FROM wfm_roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       JOIN wfm_shift_template sm ON ra.shift_template_id = sm.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       WHERE ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")}${sc.sql}
       GROUP BY sm.id, ra.roster_date ORDER BY ra.roster_date`;
  // Two heavy aggregations in parallel (2 in flight max); the light daily series after.
  const [[curRows], [prevRows]] = await Promise.all([
    db.execute<any[]>(cur.sql, cur.params),
    db.execute<any[]>(prev.sql, prev.params),
  ]);
  const [dailyRows] = await db.execute<any[]>(daily, [
    win.cur.from,
    win.cur.to,
    ...sc.params,
  ]);

  const prevById = new Map<string, ShiftAggRow>(
    prevRows.map((r: any) => [r.shift_id, toAgg(r)]),
  );
  const sparkById = new Map<
    string,
    Array<{ date: string; adherencePct: number | null }>
  >();
  const overall = new Map<string, { scheduled: number; present: number }>();
  for (const r of dailyRows) {
    const list = sparkById.get(r.shift_id) ?? [];
    list.push({ date: r.d, adherencePct: pct(n(r.present), n(r.scheduled)) });
    sparkById.set(r.shift_id, list);
    const o = overall.get(r.d) ?? { scheduled: 0, present: 0 };
    o.scheduled += n(r.scheduled);
    o.present += n(r.present);
    overall.set(r.d, o);
  }

  const shifts = rankShifts(
    curRows.map((r: any) => {
      const agg = toAgg(r);
      const metrics = shiftMetrics(agg);
      const p = prevById.get(r.shift_id);
      const pm = p ? shiftMetrics(p) : null;
      return {
        shiftId: r.shift_id as string,
        shiftName: r.shift_name as string,
        shiftTime: `${r.start_hhmm} - ${r.end_hhmm}`,
        shiftType: shiftTypeFromStartHour(n(r.start_hour)),
        processId: (r.tpl_process_id as string | null) ?? null,
        totalEmployees: n(r.total_employees),
        scheduledDays: agg.scheduledDays,
        presentDays: agg.presentDays,
        breakDays: agg.breakDays,
        qualityDays: agg.qualityDays,
        metrics,
        trend: {
          adherence: deltaPts(metrics.adherencePct, pm?.adherencePct),
          quality: deltaPts(metrics.qualityAvg, pm?.qualityAvg),
        },
        spark: (sparkById.get(r.shift_id) ?? []).map(
          (x) => x.adherencePct ?? 0,
        ),
      };
    }),
  );

  const tot = (rows: any[], col: string) =>
    rows.reduce((a, r) => a + n(r[col]), 0);
  const curSched = tot(curRows, "scheduled_days"),
    curPresent = tot(curRows, "present_days");
  const prevSched = tot(prevRows, "scheduled_days"),
    prevPresent = tot(prevRows, "present_days");
  return {
    shifts,
    window: win,
    totals: {
      scheduledDays: curSched,
      presentDays: curPresent,
      adherencePct: pct(curPresent, curSched),
      adherenceDelta: deltaPts(
        pct(curPresent, curSched),
        pct(prevPresent, prevSched),
      ),
    },
    daily: [...overall.entries()].map(([date, o]) => ({
      date,
      adherencePct: pct(o.present, o.scheduled),
      scheduledDays: o.scheduled,
    })),
  };
}

// ── /break-compliance ────────────────────────────────────────────────────────

function breakFrom(f: ScopeFilter, w: DateWindow) {
  const sc = scope(f);
  return {
    from: `FROM ${BDS_DERIVED}
       JOIN employees e ON e.id = bds.employee_id
       JOIN wfm_roster_assignment ra ON ra.employee_id = bds.employee_id AND ra.roster_date = bds.shift_date AND ${realRoster("ra")}
       JOIN wfm_shift_template sm ON sm.id = ra.shift_template_id
       WHERE ra.is_week_off = 0${sc.sql}`,
    params: [w.from, w.to, ...sc.params],
  };
}

export async function getBreakCompliance(
  f: ScopeFilter,
  now: Date = new Date(),
) {
  const win = analysisWindows(now);
  const base = breakFrom(f, win.cur);
  const basePrev = breakFrom(f, win.prev);
  const OVERALL = `SELECT COUNT(*) AS days, COUNT(DISTINCT bds.employee_id) AS employees, AVG(bds.total_break_minutes) AS avg_break,
         AVG(${BUDGET}) AS avg_budget,
         SUM(CASE WHEN bds.total_break_minutes <= ${BUDGET} THEN 1 ELSE 0 END) AS compliant_days,
         COUNT(DISTINCT CASE WHEN bds.total_break_minutes > ${BUDGET} THEN bds.employee_id END) AS over_employees,
         COUNT(DISTINCT CASE WHEN bds.total_break_minutes < 15 THEN bds.employee_id END) AS under_employees`;
  const [[o], [po]] = await Promise.all([
    db.execute<any[]>(`${OVERALL} ${base.from}`, base.params),
    db.execute<any[]>(`${OVERALL} ${basePrev.from}`, basePrev.params),
  ]);
  const [[shiftRows], [processRows]] = await Promise.all([
    db.execute<any[]>(
      `SELECT sm.id AS shift_id, sm.shift_name, COUNT(*) AS days, AVG(bds.total_break_minutes) AS avg_break, AVG(${BUDGET}) AS avg_budget,
         SUM(CASE WHEN bds.total_break_minutes <= ${BUDGET} THEN 1 ELSE 0 END) AS compliant_days
       ${base.from} GROUP BY sm.id, sm.shift_name ORDER BY sm.shift_name`,
      base.params,
    ),
    db.execute<any[]>(
      `SELECT bds.process_id AS process_id, COALESCE(p.process_name, 'Unassigned') AS process_name, COUNT(*) AS days,
         AVG(bds.total_break_minutes) AS avg_break, AVG(${BUDGET}) AS avg_budget,
         SUM(CASE WHEN bds.total_break_minutes <= ${BUDGET} THEN 1 ELSE 0 END) AS compliant_days,
         AVG(CASE WHEN bds.total_break_minutes > ${BUDGET} THEN bds.total_break_minutes - ${BUDGET} END) AS avg_excess
       ${base.from.replace("WHERE ra.is_week_off", "LEFT JOIN process_master p ON p.id = bds.process_id WHERE ra.is_week_off")}
       GROUP BY bds.process_id, p.process_name ORDER BY process_name`,
      base.params,
    ),
  ]);
  const [[violatorRows], [dailyRows]] = await Promise.all([
    db.execute<any[]>(
      `SELECT e.id AS employee_id, e.employee_code, e.full_name AS employee_name, COUNT(*) AS days_observed,
         SUM(CASE WHEN bds.total_break_minutes > ${BUDGET} THEN 1 ELSE 0 END) AS over_days,
         AVG(CASE WHEN bds.total_break_minutes > ${BUDGET} THEN bds.total_break_minutes - ${BUDGET} END) AS avg_excess,
         MAX(CASE WHEN bds.total_break_minutes > ${BUDGET} THEN DATE_FORMAT(bds.shift_date, '%Y-%m-%d') END) AS last_violation
       ${base.from} GROUP BY e.id, e.employee_code, e.full_name
       HAVING over_days >= 2 AND avg_excess > 5 ORDER BY avg_excess DESC, over_days DESC LIMIT 25`,
      base.params,
    ),
    db.execute<any[]>(
      `SELECT DATE_FORMAT(bds.shift_date, '%Y-%m-%d') AS d, COUNT(*) AS days, AVG(bds.total_break_minutes) AS avg_break,
         SUM(CASE WHEN bds.total_break_minutes <= ${BUDGET} THEN 1 ELSE 0 END) AS compliant_days
       ${base.from} GROUP BY bds.shift_date ORDER BY bds.shift_date`,
      base.params,
    ),
  ]);

  const row = (r: any) => ({
    days: n(r?.days),
    compliant: n(r?.compliant_days),
  });
  const c = row(o?.[0]),
    p = row(po?.[0]);
  const cp = pct(c.compliant, c.days);
  const overall = {
    compliancePct: cp,
    avgBreakMinutes: c.days > 0 ? Math.round(n(o[0].avg_break)) : null,
    budgetMinutes: Math.round(n(o[0]?.avg_budget) || BREAK_DAILY_HARD_MAX),
    overBreakCount: n(o[0]?.over_employees),
    underBreakCount: n(o[0]?.under_employees),
    sessions: c.days,
    employeesTracked: n(o[0]?.employees),
    delta: deltaPts(cp, pct(p.compliant, p.days)),
  };
  const grp = (r: any) => ({
    compliancePct: pct(n(r.compliant_days), n(r.days)),
    avgBreakMinutes: Math.round(n(r.avg_break)),
    budgetMinutes: Math.round(n(r.avg_budget) || BREAK_DAILY_HARD_MAX),
    days: n(r.days),
  });
  return {
    overall,
    window: win,
    byShift: shiftRows.map((r: any) => ({
      shiftId: r.shift_id,
      shiftName: r.shift_name,
      ...grp(r),
      trend: null as number | null,
    })),
    byProcess: processRows.map((r: any) => ({
      processId: r.process_id ?? "",
      processName: r.process_name,
      ...grp(r),
      avgExcessMinutes: Math.round(n(r.avg_excess)),
    })),
    topViolators: violatorRows.map((r: any) => ({
      employeeId: r.employee_id,
      employeeCode: r.employee_code,
      employeeName: r.employee_name,
      avgExcessMinutes: Math.round(n(r.avg_excess)),
      occurrences: n(r.over_days),
      daysObserved: n(r.days_observed),
      lastViolation: r.last_violation ?? null,
    })),
    daily: dailyRows.map((r: any) => ({
      date: r.d,
      compliancePct: pct(n(r.compliant_days), n(r.days)),
      avgBreakMinutes: Math.round(n(r.avg_break)),
      sessions: n(r.days),
    })),
  };
}

// ── /shift-recommendations ───────────────────────────────────────────────────

export async function getShiftRecommendations(
  f: ScopeFilter,
  now: Date = new Date(),
) {
  const win = analysisWindows(now);
  const cohortQ = shiftAggQuery(win.cur, f, false);
  const sc = scope(f);
  const [[shiftRows], [empRows]] = await Promise.all([
    db.execute<any[]>(cohortQ.sql, cohortQ.params),
    db.execute<any[]>(
      `SELECT ra.employee_id, e.employee_code, e.full_name, e.process_id, e.branch_id, sm.id AS shift_id,
         SUM(CASE WHEN ${COUNTED} THEN 1 ELSE 0 END) AS scheduled_days,
         SUM(CASE WHEN ${COUNTED} AND ${PRESENT} THEN 1 ELSE 0 END) AS present_days
       FROM wfm_roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       JOIN wfm_shift_template sm ON ra.shift_template_id = sm.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       WHERE ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")}${sc.sql}
       GROUP BY ra.employee_id, e.employee_code, e.full_name, e.process_id, e.branch_id, sm.id`,
      [win.cur.from, win.cur.to, ...sc.params],
    ),
  ]);
  const cohort: CohortShift[] = shiftRows.map((r: any) => ({
    shiftId: r.shift_id,
    shiftName: r.shift_name,
    shiftTime: `${r.start_hhmm} - ${r.end_hhmm}`,
    templateProcessId: r.tpl_process_id ?? null,
    templateBranchId: r.tpl_branch_id ?? null,
    totalEmployees: n(r.total_employees),
    scheduledDays: n(r.scheduled_days),
    presentDays: n(r.present_days),
  }));
  const emps: EmployeeShiftRow[] = empRows.map((r: any) => ({
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.full_name,
    processId: r.process_id ?? null,
    branchId: r.branch_id ?? null,
    shiftId: r.shift_id,
    scheduledDays: n(r.scheduled_days),
    presentDays: n(r.present_days),
  }));
  return { recommendations: buildRecommendations(cohort, emps), window: win };
}

// ── Drill-down: shift ────────────────────────────────────────────────────────

export async function getShiftDetail(
  shiftId: string,
  f: ScopeFilter,
  now: Date = new Date(),
) {
  const [tplRows] = await db.execute<any[]>(
    `SELECT * FROM wfm_shift_template WHERE id = ?`,
    [shiftId],
  );
  const tpl = tplRows[0];
  if (!tpl) return null;
  const win = analysisWindows(now);
  const sc = scope(f);
  const cur = shiftAggQuery(win.cur, f, true, shiftId);
  const prev = shiftAggQuery(win.prev, f, true, shiftId);
  const [[curRows], [prevRows]] = await Promise.all([
    db.execute<any[]>(cur.sql, cur.params),
    db.execute<any[]>(prev.sql, prev.params),
  ]);
  const common = `FROM wfm_roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       JOIN wfm_shift_template sm ON ra.shift_template_id = sm.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       WHERE sm.id = ? AND ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")}${sc.sql}`;
  const baseParams = [shiftId, win.cur.from, win.cur.to, ...sc.params];
  const [[dailyRows], [procRows], [empRows], [versions], [audit]] =
    await Promise.all([
      db.execute<any[]>(
        `SELECT DATE_FORMAT(ra.roster_date, '%Y-%m-%d') AS d, SUM(CASE WHEN ${COUNTED} THEN 1 ELSE 0 END) AS scheduled,
         SUM(CASE WHEN ${COUNTED} AND ${PRESENT} THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN ${COUNTED} AND ${PRESENT} AND adr.late_mark = 0 THEN 1 ELSE 0 END) AS on_time
       ${common} GROUP BY ra.roster_date ORDER BY ra.roster_date`,
        baseParams,
      ),
      db.execute<any[]>(
        `SELECT COALESCE(pm.process_name, 'Unassigned') AS process_name, COUNT(DISTINCT ra.employee_id) AS employees,
         SUM(CASE WHEN ${COUNTED} THEN 1 ELSE 0 END) AS scheduled, SUM(CASE WHEN ${COUNTED} AND ${PRESENT} THEN 1 ELSE 0 END) AS present
       FROM wfm_roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       JOIN wfm_shift_template sm ON ra.shift_template_id = sm.id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       WHERE sm.id = ? AND ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")}${sc.sql}
       GROUP BY pm.process_name ORDER BY scheduled DESC LIMIT 20`,
        baseParams,
      ),
      db.execute<any[]>(
        `SELECT e.id AS employee_id, e.employee_code, e.full_name, SUM(CASE WHEN ${COUNTED} THEN 1 ELSE 0 END) AS scheduled,
         SUM(CASE WHEN ${COUNTED} AND ${PRESENT} THEN 1 ELSE 0 END) AS present
       ${common} GROUP BY e.id, e.employee_code, e.full_name
       HAVING scheduled >= 5 ORDER BY (present / scheduled) ASC, scheduled DESC LIMIT 15`,
        baseParams,
      ),
      db.execute<any[]>(
        `SELECT id, version, shift_name, DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from, DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to,
         active_status, created_by, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at
       FROM wfm_shift_template WHERE shift_code = ? ORDER BY version DESC LIMIT 20`,
        [tpl.shift_code],
      ),
      db.execute<any[]>(
        `SELECT actor_user_id, action_type, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at, metadata_json
       FROM audit_action_log WHERE entity_id = ? AND entity_type IN ('wfm_shift_template','shift_template','shift')
       ORDER BY created_at DESC LIMIT 20`,
        [shiftId],
      ),
    ]);
  const metrics = curRows[0] ? shiftMetrics(toAgg(curRows[0])) : null;
  const pm = prevRows[0] ? shiftMetrics(toAgg(prevRows[0])) : null;
  return {
    template: tpl,
    window: win,
    metrics,
    trend: {
      adherence: deltaPts(metrics?.adherencePct, pm?.adherencePct),
      quality: deltaPts(metrics?.qualityAvg, pm?.qualityAvg),
    },
    totalEmployees: n(curRows[0]?.total_employees),
    scheduledDays: n(curRows[0]?.scheduled_days),
    daily: dailyRows.map((r: any) => ({
      date: r.d,
      scheduledDays: n(r.scheduled),
      adherencePct: pct(n(r.present), n(r.scheduled)),
      onTimePct: pct(n(r.on_time), n(r.present)),
    })),
    byProcess: procRows.map((r: any) => ({
      processName: r.process_name,
      employees: n(r.employees),
      scheduledDays: n(r.scheduled),
      adherencePct: pct(n(r.present), n(r.scheduled)),
    })),
    lowestAdherence: empRows.map((r: any) => ({
      employeeId: r.employee_id,
      employeeCode: r.employee_code,
      employeeName: r.full_name,
      scheduledDays: n(r.scheduled),
      presentDays: n(r.present),
      adherencePct: pct(n(r.present), n(r.scheduled)),
    })),
    versions,
    audit,
  };
}

// ── Drill-down: employee break record ────────────────────────────────────────

export async function getEmployeeBreakDetail(
  employeeId: string,
  now: Date = new Date(),
) {
  const win = analysisWindows(now);
  const [empRows] = await db.execute<any[]>(
    `SELECT e.id, e.employee_code, e.full_name, pm.process_name, bm.branch_name, m.full_name AS manager_name
     FROM employees e
     LEFT JOIN process_master pm ON pm.id = e.process_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     LEFT JOIN employees m ON m.id = e.reporting_manager_id
     WHERE e.id = ?`,
    [employeeId],
  );
  const emp = empRows[0];
  if (!emp) return null;
  const [[dayRows], [sessionRows], [alertRows]] = await Promise.all([
    db.execute<any[]>(
      `SELECT DATE_FORMAT(bds.shift_date, '%Y-%m-%d') AS d, bds.total_break_minutes, bds.mini_break_count, bds.long_break_count,
         bds.exceeded_break_count, bds.exception_count, bds.final_status, bds.budget AS budget,
         DATE_FORMAT(bds.first_break_start, '%Y-%m-%d %H:%i') AS first_break_start, DATE_FORMAT(bds.last_break_end, '%Y-%m-%d %H:%i') AS last_break_end
       FROM ${BDS_DERIVED} WHERE bds.employee_id = ? ORDER BY bds.shift_date`,
      [win.cur.from, win.cur.to, employeeId],
    ),
    db.execute<any[]>(
      `SELECT id, DATE_FORMAT(break_start_time, '%Y-%m-%d %H:%i') AS start_time, DATE_FORMAT(break_end_time, '%Y-%m-%d %H:%i') AS end_time,
         duration_minutes, break_type, break_reason, status, exception_reason, manager_approved_by,
         DATE_FORMAT(manager_approved_at, '%Y-%m-%d %H:%i') AS manager_approved_at
       FROM break_sessions WHERE employee_id = ? AND shift_date BETWEEN ? AND ? ORDER BY break_start_time DESC LIMIT 60`,
      [employeeId, win.cur.from, win.cur.to],
    ),
    db.execute<any[]>(
      `SELECT alert_type, alert_level, threshold_minutes, actual_minutes, exceeded_by_minutes, email_status,
         DATE_FORMAT(sent_at, '%Y-%m-%d %H:%i') AS sent_at, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at
       FROM break_alert_logs WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20`,
      [employeeId],
    ),
  ]);
  const days = dayRows.map((r: any) => ({
    date: r.d,
    totalBreakMinutes: n(r.total_break_minutes),
    budgetMinutes: n(r.budget),
    overBudget: n(r.total_break_minutes) > n(r.budget),
    miniBreaks: n(r.mini_break_count),
    longBreaks: n(r.long_break_count),
    exceededBreaks: n(r.exceeded_break_count),
    exceptions: n(r.exception_count),
    status: r.final_status ?? null,
    firstBreakStart: r.first_break_start ?? null,
    lastBreakEnd: r.last_break_end ?? null,
  }));
  const over = days.filter((d) => d.overBudget);
  return {
    employee: {
      id: emp.id,
      employeeCode: emp.employee_code,
      fullName: emp.full_name,
      processName: emp.process_name ?? null,
      branchName: emp.branch_name ?? null,
      managerName: emp.manager_name ?? null,
    },
    window: win,
    summary: {
      daysObserved: days.length,
      overBudgetDays: over.length,
      compliancePct: pct(days.length - over.length, days.length),
      avgBreakMinutes: days.length
        ? Math.round(
            days.reduce((a, d) => a + d.totalBreakMinutes, 0) / days.length,
          )
        : null,
      avgExcessMinutes: over.length
        ? Math.round(
            over.reduce(
              (a, d) => a + (d.totalBreakMinutes - d.budgetMinutes),
              0,
            ) / over.length,
          )
        : null,
    },
    days,
    sessions: sessionRows,
    alerts: alertRows,
  };
}
