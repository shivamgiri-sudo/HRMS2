/**
 * Lateness + attrition drill-downs for the Trends & Publish panel.
 *
 * Lateness used to be aggregated in the browser from the first 5,000 rows of the per-event
 * late-arrival-summary report, and every row counted as a late event — including rows the report
 * itself labels "Within Grace" (net late = 0). Here it is aggregated in SQL, over the whole
 * range, counting only arrivals later than the grace window (attendance_rule_config.grace_minutes,
 * default 15 — the report's own default), using the report's roster-based lateness test and the
 * same synthetic-cohort guard as the rest of the panel.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { REAL_ROSTER, scopeSql, type ScopeFilters } from "./roster-trends.sql.js";
import { HABITUAL_LATE_THRESHOLD, safePct, weekStartMonday } from "./roster-trends.calc.js";

export interface RangeFilters extends ScopeFilters { from: string; to: string }

const SHIFT_START = "COALESCE(wst.start_time, ws.start_time, CAST(wra.shift_start_time AS TIME))";
const GRACE = "COALESCE(arc.grace_minutes, 15)";

const LATE_FROM = `
  FROM attendance_daily_record adr
  JOIN employees e ON e.id = adr.employee_id
  JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id AND wra.roster_date = adr.record_date
  LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
  LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
  LEFT JOIN attendance_rule_config arc ON arc.id = adr.rule_config_id`;

function lateWhere(f: ScopeFilters): { sql: string; params: unknown[] } {
  const s = scopeSql(f);
  const realRoster = REAL_ROSTER.replace(/\bra\./g, "wra.");
  return {
    sql: `adr.record_date BETWEEN ? AND ? AND ${realRoster}${s.sql}
      AND UPPER(COALESCE(wra.assignment_type,'')) NOT IN ('WEEK_OFF','LEAVE','HOLIDAY')
      AND COALESCE(wra.is_week_off, 0) = 0
      AND adr.clock_in_time IS NOT NULL
      AND ${SHIFT_START} IS NOT NULL
      AND TIME(adr.clock_in_time) > ${SHIFT_START}
      AND adr.late_by_minutes > ${GRACE}`,
    params: s.params,
  };
}

export async function getLatenessOverview(f: RangeFilters) {
  const w = lateWhere(f);
  const p = [f.from, f.to, ...w.params];
  const [totals, daily, byEmp, byProc] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS events, COUNT(DISTINCT adr.employee_id) AS employees,
              SUM(adr.late_by_minutes - ${GRACE}) AS net_minutes,
              SUM(CASE WHEN adr.late_by_minutes <= 30 THEN 1 ELSE 0 END) AS mild,
              SUM(CASE WHEN adr.late_by_minutes > 30 AND adr.late_by_minutes <= 60 THEN 1 ELSE 0 END) AS moderate,
              SUM(CASE WHEN adr.late_by_minutes > 60 THEN 1 ELSE 0 END) AS severe
       ${LATE_FROM} WHERE ${w.sql}`, p),
    db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(adr.record_date,'%Y-%m-%d') AS d, COUNT(*) AS events, COUNT(DISTINCT adr.employee_id) AS employees
       ${LATE_FROM} WHERE ${w.sql} GROUP BY adr.record_date ORDER BY adr.record_date`, p),
    db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.employee_code,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              b.branch_name, pm.process_name, COUNT(*) AS events,
              ROUND(AVG(adr.late_by_minutes - ${GRACE})) AS avg_net_minutes, MAX(adr.late_by_minutes) AS max_minutes
       ${LATE_FROM}
       LEFT JOIN branch_master b ON b.id = e.branch_id LEFT JOIN process_master pm ON pm.id = e.process_id
       WHERE ${w.sql}
       GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name, pm.process_name
       HAVING events >= ${HABITUAL_LATE_THRESHOLD}
       ORDER BY events DESC, employee_name LIMIT 200`, p),
    db.execute<RowDataPacket[]>(
      `SELECT pm.id AS process_id, COALESCE(pm.process_name,'Unassigned') AS name, COUNT(*) AS events, COUNT(DISTINCT adr.employee_id) AS employees
       ${LATE_FROM} LEFT JOIN process_master pm ON pm.id = e.process_id
       WHERE ${w.sql} GROUP BY pm.id, name ORDER BY events DESC LIMIT 15`, p),
  ]);
  const t = totals[0][0] ?? {};
  const events = Number(t.events ?? 0);
  const habitualTotalQ = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM (SELECT adr.employee_id ${LATE_FROM} WHERE ${w.sql}
       GROUP BY adr.employee_id HAVING COUNT(*) >= ${HABITUAL_LATE_THRESHOLD}) x`, p);
  return {
    from: f.from, to: f.to, threshold: HABITUAL_LATE_THRESHOLD,
    totals: {
      events, employees: Number(t.employees ?? 0),
      avgNetMinutes: events > 0 ? Math.round(Number(t.net_minutes ?? 0) / events) : 0,
      mild: Number(t.mild ?? 0), moderate: Number(t.moderate ?? 0), severe: Number(t.severe ?? 0),
      severePct: safePct(Number(t.severe ?? 0), events),
      habitualEmployees: Number(habitualTotalQ[0][0]?.n ?? 0),
    },
    daily: daily[0].map((r) => ({ date: String(r.d), events: Number(r.events), employees: Number(r.employees) })),
    habitual: byEmp[0].map((r) => ({
      employeeId: String(r.employee_id), employeeCode: String(r.employee_code), employeeName: String(r.employee_name),
      branchName: r.branch_name ? String(r.branch_name) : null, processName: r.process_name ? String(r.process_name) : null,
      events: Number(r.events), avgNetMinutes: Number(r.avg_net_minutes ?? 0), maxMinutes: Number(r.max_minutes ?? 0),
    })),
    habitualTruncated: Number(habitualTotalQ[0][0]?.n ?? 0) > byEmp[0].length,
    byProcess: byProc[0].map((r) => ({ processId: r.process_id ? String(r.process_id) : null, name: String(r.name), events: Number(r.events), employees: Number(r.employees) })),
  };
}

const EVENT_COLS = `DATE_FORMAT(adr.record_date,'%Y-%m-%d') AS d,
  TIME_FORMAT(${SHIFT_START}, '%H:%i') AS scheduled_start, TIME_FORMAT(adr.clock_in_time, '%H:%i') AS punch_in,
  adr.late_by_minutes, ${GRACE} AS grace, (adr.regularization_id IS NOT NULL) AS has_exception`;

/** One employee's late events in the range (no scope filter: the drawer is about that person). */
export async function getLatenessEmployeeDetail(employeeId: string, from: string, to: string) {
  const w = lateWhere({});
  const [emp, events] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              b.branch_name, p.process_name,
              COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS manager_name
         FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN employees m ON m.id = e.reporting_manager_id WHERE e.id = ? LIMIT 1`, [employeeId]),
    db.execute<RowDataPacket[]>(
      `SELECT ${EVENT_COLS} ${LATE_FROM} WHERE ${w.sql} AND adr.employee_id = ?
        ORDER BY adr.record_date DESC LIMIT 200`, [from, to, employeeId]),
  ]);
  const e = emp[0][0];
  if (!e) return null;
  const rows = events[0].map((r) => ({
    date: String(r.d), scheduledStart: r.scheduled_start ? String(r.scheduled_start) : null,
    punchIn: r.punch_in ? String(r.punch_in) : null, lateMinutes: Number(r.late_by_minutes),
    netLateMinutes: Math.max(0, Number(r.late_by_minutes) - Number(r.grace)), exception: Number(r.has_exception) === 1,
  }));
  const weeks = new Map<string, number>();
  for (const r of rows) weeks.set(weekStartMonday(r.date), (weeks.get(weekStartMonday(r.date)) ?? 0) + 1);
  return {
    employee: {
      employeeCode: String(e.employee_code), employeeName: String(e.employee_name),
      branchName: e.branch_name ? String(e.branch_name) : null, processName: e.process_name ? String(e.process_name) : null,
      managerName: e.manager_name ? String(e.manager_name) : null,
    },
    from, to, count: rows.length, exceptions: rows.filter((r) => r.exception).length,
    avgNetMinutes: rows.length ? Math.round(rows.reduce((a, r) => a + r.netLateMinutes, 0) / rows.length) : 0,
    weekly: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count })),
    events: rows,
  };
}

/** Every late event on one date in scope (top 100 by minutes late). */
export async function getLatenessDayDetail(date: string, f: ScopeFilters) {
  const w = lateWhere(f);
  const [events, total] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT ${EVENT_COLS}, e.id AS employee_id, e.employee_code,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name, pm.process_name
       ${LATE_FROM} LEFT JOIN process_master pm ON pm.id = e.process_id
       WHERE ${w.sql} ORDER BY adr.late_by_minutes DESC LIMIT 100`, [date, date, ...w.params]),
    db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n ${LATE_FROM} WHERE ${w.sql}`, [date, date, ...w.params]),
  ]);
  const n = Number(total[0][0]?.n ?? 0);
  return {
    date, count: n, truncated: n > events[0].length,
    events: events[0].map((r) => ({
      employeeId: String(r.employee_id), employeeCode: String(r.employee_code), employeeName: String(r.employee_name),
      processName: r.process_name ? String(r.process_name) : null,
      scheduledStart: r.scheduled_start ? String(r.scheduled_start) : null, punchIn: r.punch_in ? String(r.punch_in) : null,
      lateMinutes: Number(r.late_by_minutes), netLateMinutes: Math.max(0, Number(r.late_by_minutes) - Number(r.grace)),
      exception: Number(r.has_exception) === 1,
    })),
  };
}

/* ── Attrition bucket drill-down ───────────────────────────────────────────── */

export const AON_BUCKET_KEYS = ["0-30", "31-60", "61-90", "90+"] as const;

const JOIN_REF = "COALESCE(e.salary_start_date, e.date_of_joining)";

/**
 * Exited employees in an age-on-network bucket, same population rules as aon-bucket-attrition:
 * dated exits only, and exits whose tenure is arithmetically possible (exit >= joining).
 */
export async function getAttritionBucketDetail(bucket: string, f: RangeFilters) {
  if (!(AON_BUCKET_KEYS as readonly string[]).includes(bucket)) return null;
  const s = scopeSql(f);
  const cond = bucket === "0-30" ? `DATEDIFF(e.date_of_exit, ${JOIN_REF}) <= 30`
    : bucket === "31-60" ? `DATEDIFF(e.date_of_exit, ${JOIN_REF}) BETWEEN 31 AND 60`
    : bucket === "61-90" ? `DATEDIFF(e.date_of_exit, ${JOIN_REF}) BETWEEN 61 AND 90`
    : `DATEDIFF(e.date_of_exit, ${JOIN_REF}) > 90`;
  const where = `e.date_of_exit BETWEEN ? AND ? AND e.date_of_exit >= e.date_of_joining AND ${JOIN_REF} IS NOT NULL AND ${cond}${s.sql}`;
  const p = [f.from, f.to, ...s.params];
  const [tot, monthly, byProc, rows] = await Promise.all([
    db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n, ROUND(AVG(DATEDIFF(e.date_of_exit, ${JOIN_REF}))) AS avg_days FROM employees e WHERE ${where}`, p),
    db.execute<RowDataPacket[]>(`SELECT DATE_FORMAT(e.date_of_exit,'%Y-%m') AS month, COUNT(*) AS n FROM employees e WHERE ${where} GROUP BY month ORDER BY month`, p),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(pm.process_name,'Unassigned') AS name, COUNT(*) AS n FROM employees e
         LEFT JOIN process_master pm ON pm.id = e.process_id WHERE ${where} GROUP BY name ORDER BY n DESC LIMIT 15`, p),
    db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              b.branch_name, pm.process_name, DATE_FORMAT(${JOIN_REF},'%Y-%m-%d') AS joined,
              DATE_FORMAT(e.date_of_exit,'%Y-%m-%d') AS exited, DATEDIFF(e.date_of_exit, ${JOIN_REF}) AS tenure_days
         FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id LEFT JOIN process_master pm ON pm.id = e.process_id
        WHERE ${where} ORDER BY e.date_of_exit DESC LIMIT 100`, p),
  ]);
  const n = Number(tot[0][0]?.n ?? 0);
  return {
    bucket, from: f.from, to: f.to, count: n, avgTenureDays: Number(tot[0][0]?.avg_days ?? 0),
    monthly: monthly[0].map((r) => ({ month: String(r.month), count: Number(r.n) })),
    byProcess: byProc[0].map((r) => ({ name: String(r.name), count: Number(r.n) })),
    truncated: n > rows[0].length,
    exits: rows[0].map((r) => ({
      employeeId: String(r.id), employeeCode: String(r.employee_code), employeeName: String(r.employee_name),
      branchName: r.branch_name ? String(r.branch_name) : null, processName: r.process_name ? String(r.process_name) : null,
      joined: r.joined ? String(r.joined) : null, exited: String(r.exited), tenureDays: Number(r.tenure_days),
    })),
  };
}
