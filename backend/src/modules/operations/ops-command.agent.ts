import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addDays, num, numOrNull, realRoster } from "./ops-command.context.js";

export interface AgentDay {
  date: string;
  weekday: string;
  roster: { type: string; start: string | null; end: string | null; minutes: number | null; publish: string | null; ack: string | null } | null;
  attendance: { status: string; late: boolean; lateBy: number | null; clockIn: string | null; clockOut: string | null; minutes: number | null } | null;
  breakMinutes: number | null;
  breakExceeded: number | null;
  calls: number | null;
  talkMinutes: number | null;
  dialMinutes: number | null;
  kpis: Record<string, number | null>;
  audit: { count: number; avg: number | null; fatal: number } | null;
  callAudit: { count: number; avg: number | null; fatal: number } | null;
  warning: boolean;
  /** Plain-language exception for the day (rostered no-show, late, break over limit, low audit…). */
  flags: string[];
}

export interface AgentDays {
  from: string;
  to: string;
  days: AgentDay[];
  kpiMetrics: Array<{ code: string; name: string; unit: string | null }>;
  summary: {
    rosteredDays: number;
    workedDays: number;
    noShows: number;
    lateDays: number;
    avgLoginHours: number | null;
    avgBreakMinutes: number | null;
    totalCalls: number;
    avgAudit: number | null;
  };
  sources: { calls: boolean; dialler: boolean; callAudit: boolean };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WORKED = new Set(["present", "half_day", "week_off_worked"]);
const timeout = <T>(p: Promise<T>, ms = 6000) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/** Optional sources degrade to "not available" instead of failing the whole drawer. */
async function optional<T>(name: string, run: () => Promise<T>, fallback: T): Promise<{ value: T; ok: boolean }> {
  try {
    return { value: await timeout(run()), ok: true };
  } catch (err) {
    logger.warn(`[ops-command] agent day source ${name} unavailable: ${(err as Error).message}`);
    return { value: fallback, ok: false };
  }
}

/** One person, one row per calendar day: roster vs actual, breaks, calls, KPI values, audits, warnings. */
export async function computeAgentDays(employeeId: string, from: string, to: string): Promise<AgentDays | null> {
  const q = (sql: string, params: unknown[]) => db.execute<RowDataPacket[]>(sql, params).then(([r]) => r);
  const [emp] = await db.execute<RowDataPacket[]>("SELECT employee_code FROM employees WHERE id = ?", [employeeId]);
  const code = emp[0]?.employee_code as string | undefined;
  if (!code) return null;

  const [roster, att, brk, kpi, qa, warn, calls, dial, ext] = await Promise.all([
    q(`SELECT DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS d,
              COALESCE(ra.assignment_type, IF(ra.is_week_off = 1,'WEEK_OFF','SHIFT')) AS type,
              TIME_FORMAT(ra.shift_start_time,'%H:%i') AS s, TIME_FORMAT(ra.shift_end_time,'%H:%i') AS e,
              ra.scheduled_minutes AS mins, ra.publish_status AS pub, ra.employee_ack_status AS ack
         FROM wfm_roster_assignment ra
        WHERE ra.employee_id = ? AND ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")}`, [employeeId, from, to]),
    q(`SELECT DATE_FORMAT(record_date,'%Y-%m-%d') AS d, attendance_status AS st, late_mark, late_by_minutes,
              DATE_FORMAT(clock_in_time,'%H:%i') AS cin, DATE_FORMAT(clock_out_time,'%H:%i') AS cout,
              COALESCE(raw_minutes, biometric_minutes, dialler_minutes) AS mins
         FROM attendance_daily_record WHERE employee_id = ? AND record_date BETWEEN ? AND ?`, [employeeId, from, to]),
    q(`SELECT DATE_FORMAT(shift_date,'%Y-%m-%d') AS d, total_break_minutes AS mins, exceeded_break_count AS ex
         FROM break_daily_summary WHERE employee_id = ? AND shift_date BETWEEN ? AND ?`, [employeeId, from, to]),
    q(`SELECT DATE_FORMAT(k.score_date,'%Y-%m-%d') AS d, m.metric_code AS code, m.metric_name AS name, m.unit, k.actual_value AS v
         FROM kpi_daily_actual k JOIN kpi_metric_master m ON m.id = k.metric_id
        WHERE k.employee_id = ? AND k.score_date BETWEEN ? AND ?`, [employeeId, from, to]),
    q(`SELECT DATE_FORMAT(audit_date,'%Y-%m-%d') AS d, COUNT(*) AS n, AVG(quality_percentage) AS avg, SUM(fatal_triggered = 1) AS fatal
         FROM qa_audit WHERE employee_id = ? AND audit_date BETWEEN ? AND ? AND status IN ('submitted','calibrated','closed') GROUP BY audit_date`, [employeeId, from, to]),
    q(`SELECT DATE_FORMAT(warning_date,'%Y-%m-%d') AS d FROM employee_warning
        WHERE employee_id = ? AND warning_date BETWEEN ? AND ? AND status = 'active'`, [employeeId, from, to]),
    optional("calls", () => q(`SELECT DATE_FORMAT(activity_date,'%Y-%m-%d') AS d, SUM(total_calls) AS calls, SUM(talk_minutes) AS talk
                                FROM integration_call_daily WHERE employee_code = ? AND activity_date BETWEEN ? AND ? GROUP BY activity_date`, [code, from, to]), [] as RowDataPacket[]),
    optional("dialler", () => q(`SELECT DATE_FORMAT(session_date,'%Y-%m-%d') AS d, SUM(login_minutes) AS mins
                                  FROM dialer_session_log WHERE employee_id = ? AND session_date BETWEEN ? AND ? GROUP BY session_date`, [employeeId, from, to]), [] as RowDataPacket[]),
    optional("call-audit", () => q(`SELECT DATE_FORMAT(q.CallDate,'%Y-%m-%d') AS d, COUNT(*) AS n, AVG(q.quality_percentage) AS avg, SUM(q.quality_percentage = 0) AS fatal
                                     FROM db_audit.call_quality_assessment q
                                    WHERE q.User = ? AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY DATE(q.CallDate)`, [code, from, to]), [] as RowDataPacket[]),
  ]);

  const byDate = <T extends RowDataPacket>(rows: T[]) => new Map(rows.map((r) => [String(r.d), r]));
  const rosterBy = byDate(roster), attBy = byDate(att), brkBy = byDate(brk), qaBy = byDate(qa);
  const callBy = byDate(calls.value), dialBy = byDate(dial.value), extBy = byDate(ext.value);
  const warnDates = new Set(warn.map((r) => String(r.d)));
  const kpiBy = new Map<string, Record<string, number | null>>();
  const kpiMeta = new Map<string, { code: string; name: string; unit: string | null }>();
  for (const r of kpi) {
    const d = String(r.d);
    if (!kpiBy.has(d)) kpiBy.set(d, {});
    kpiBy.get(d)![String(r.code)] = numOrNull(r.v);
    kpiMeta.set(String(r.code), { code: String(r.code), name: String(r.name), unit: r.unit ? String(r.unit) : null });
  }

  const days: AgentDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = rosterBy.get(d), a = attBy.get(d), b = brkBy.get(d), c = callBy.get(d), dl = dialBy.get(d), qd = qaBy.get(d), ed = extBy.get(d);
    const row: AgentDay = {
      date: d,
      weekday: WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()],
      roster: r ? { type: String(r.type), start: r.s ?? null, end: r.e ?? null, minutes: numOrNull(r.mins), publish: r.pub ?? null, ack: r.ack ?? null } : null,
      attendance: a ? { status: String(a.st), late: num(a.late_mark) === 1, lateBy: numOrNull(a.late_by_minutes), clockIn: a.cin ?? null, clockOut: a.cout ?? null, minutes: numOrNull(a.mins) } : null,
      breakMinutes: b ? numOrNull(b.mins) : null,
      breakExceeded: b ? numOrNull(b.ex) : null,
      calls: c ? numOrNull(c.calls) : null,
      talkMinutes: c ? numOrNull(c.talk) : null,
      dialMinutes: dl ? numOrNull(dl.mins) : null,
      kpis: kpiBy.get(d) ?? {},
      audit: qd ? { count: num(qd.n), avg: numOrNull(qd.avg), fatal: num(qd.fatal) } : null,
      callAudit: ed ? { count: num(ed.n), avg: numOrNull(ed.avg), fatal: num(ed.fatal) } : null,
      warning: warnDates.has(d),
      flags: [],
    };
    const working = row.roster && !["WEEK_OFF", "HOLIDAY", "LEAVE"].includes(row.roster.type);
    const st = row.attendance?.status;
    if (working && st && ["absent", "missing_punch", "unreconciled"].includes(st)) row.flags.push(st === "absent" ? "Rostered, absent" : "Rostered, no usable punch");
    if (row.attendance?.late) row.flags.push(row.attendance.lateBy ? `Late by ${row.attendance.lateBy} min` : "Late");
    if ((row.breakExceeded ?? 0) > 0) row.flags.push("Break over limit");
    if (row.callAudit?.fatal) row.flags.push("Fatal call audited");
    else if (row.callAudit?.avg !== null && row.callAudit && (row.callAudit.avg ?? 100) < 85) row.flags.push("Call quality below 85%");
    if (row.warning) row.flags.push("Warning issued");
    days.push(row);
  }

  const worked = days.filter((d) => d.attendance && WORKED.has(d.attendance.status));
  const mins = worked.map((d) => d.attendance!.minutes).filter((m): m is number => m !== null && m > 0);
  const brks = days.map((d) => d.breakMinutes).filter((m): m is number => m !== null && m > 0);
  const audits = days.map((d) => d.callAudit?.avg ?? d.audit?.avg).filter((m): m is number => m !== null && m !== undefined);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

  return {
    from, to, days,
    kpiMetrics: [...kpiMeta.values()].sort((x, y) => x.name.localeCompare(y.name)),
    summary: {
      rosteredDays: days.filter((d) => d.roster && !["WEEK_OFF", "HOLIDAY", "LEAVE"].includes(d.roster.type)).length,
      workedDays: worked.length,
      noShows: days.filter((d) => d.flags.some((f) => f.startsWith("Rostered"))).length,
      lateDays: days.filter((d) => d.attendance?.late).length,
      avgLoginHours: mins.length ? Math.round((mins.reduce((s, m) => s + m, 0) / mins.length / 60) * 100) / 100 : null,
      avgBreakMinutes: avg(brks),
      totalCalls: days.reduce((s, d) => s + (d.calls ?? 0), 0),
      avgAudit: avg(audits),
    },
    sources: { calls: calls.ok, dialler: dial.ok, callAudit: ext.ok },
  };
}
