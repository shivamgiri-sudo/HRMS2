import type { RowDataPacket } from "mysql2";
import { empScope, lastDays, num, rows, severityFor, toneFor } from "../../helpers.js";
import type { InsightContext, InsightSection, InsightSignal } from "../../types.js";
import {
  idFilter, adrScope, abscondRisk, absentStreak, activeHeadcount, anchorDate, attendanceRate, dailyAttendance, expectedToWork, forecastAbsence, once,
  ratio, shortDate, shrinkage, unreconciledPct, weekdayShort,
} from "./shared.js";

/** Attendance trend KPIs, shrinkage by process, tomorrow's forecast, abscond risk and break overuse. */

/** Active employees with no processed attendance row on the anchor day (a blind spot, not "absent"). */
export const unmarkedOnAnchor = (ctx: InsightContext) =>
  once(ctx, "unmarked", async () => {
    const anchor = await anchorDate(ctx);
    if (!anchor) return null;
    const s = empScope(ctx);
    const r = await rows(
      `SELECT COUNT(*) AS n FROM employees e
        WHERE e.active_status = 1 AND e.date_of_joining <= ?${s.sql}
          AND NOT EXISTS (SELECT 1 FROM attendance_daily_record a WHERE a.employee_id = e.id AND a.record_date = ?)`,
      [anchor, ...s.params, anchor],
    );
    return num(r[0]?.n);
  });

export async function attendanceKpiSection(ctx: InsightContext): Promise<InsightSection> {
  const [days, unmarked, active] = await Promise.all([dailyAttendance(ctx), unmarkedOnAnchor(ctx), activeHeadcount(ctx)]);
  const last = days[days.length - 1];
  if (!last) return { kpis: [], series: [{ key: "att_trend", title: "Attendance trend", kind: "line", points: [], unavailable: "No complete processed attendance day in the last 21 days" }] };
  const prev = days.length > 1 ? days[days.length - 2] : null;
  const rate = attendanceRate(last), prevRate = prev ? attendanceRate(prev) : null;
  const shr = shrinkage(last), prevShr = prev ? shrinkage(prev) : null;
  const asOf = `as of ${shortDate(last.date)}`;
  const attended = last.present + last.half;
  const late = ratio(last.late, attended);
  const un = unreconciledPct(last);
  const pp = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.round((a - b) * 10) / 10 : null);
  const spark = <T,>(f: (d: (typeof days)[number]) => T | null) => days.slice(-14).map(f).filter((v): v is T => v !== null);
  const kpis = [
    { key: "attendance_rate", label: "Attendance rate", value: rate, unit: "percent" as const, tone: toneFor(rate, 85, 70), delta: pp(rate, prevRate), deltaLabel: `pp vs previous day (${asOf})`, spark: spark((d) => attendanceRate(d)), href: "/wfm/attendance-integrity?tab=exceptions",
      formula: "(present + week_off_worked + 0.5 x half_day) over days expected to work. Expected excludes week-off, holiday and approved leave. Latest complete processed day; today is still being written.",
      helper: un !== null && un >= 10 ? `${un}% of rows still missing-punch (unreconciled)` : undefined },
    { key: "unplanned_shrinkage", label: "Unplanned shrinkage", value: shr.unplanned, unit: "percent" as const, higherIsBetter: false, tone: toneFor(shr.unplanned, 10, 20, false), delta: pp(shr.unplanned, prevShr?.unplanned ?? null), deltaLabel: `pp vs previous day (${asOf})`, spark: spark((d) => shrinkage(d).unplanned), href: "/wfm/roster-command-center",
      formula: "Absent days over every day that is not a week-off or holiday. Same denominator as planned shrinkage so the two add up." },
    { key: "planned_shrinkage", label: "Planned shrinkage (leave)", value: shr.planned, unit: "percent" as const, higherIsBetter: false, tone: toneFor(shr.planned, 8, 15, false), delta: pp(shr.planned, prevShr?.planned ?? null), deltaLabel: `pp vs previous day (${asOf})`, spark: spark((d) => shrinkage(d).planned), href: "/leaves",
      formula: "Approved-leave days over every day that is not a week-off or holiday." },
    { key: "late_rate", label: "Late-coming rate", value: late, unit: "percent" as const, higherIsBetter: false, tone: toneFor(late, 10, 20, false), delta: pp(late, prev ? ratio(prev.late, prev.present + prev.half) : null), deltaLabel: `pp vs previous day (${asOf})`, spark: spark((d) => ratio(d.late, d.present + d.half)), href: "/wfm/attendance-integrity?tab=exceptions",
      formula: "Late-marked days over days worked (present + half-day). Late is the late_mark flag, not an attendance status." },
    { key: "ot_hours", label: "Overtime hours", value: last.otHours, unit: "hours" as const, higherIsBetter: false, tone: "violet" as const, spark: spark((d) => d.otHours), helper: `${last.otPeople} people beyond 8h (${asOf})`, href: "/reports",
      formula: "Sum of (worked minutes above 480) / 60 per employee-day. Hours only: cost needs pay rates, which are not shown on the WFM dashboard." },
    { key: "no_record", label: "No attendance record", value: unmarked, unit: "count" as const, higherIsBetter: false, tone: unmarked && active && unmarked / active > 0.1 ? "amber" as const : "green" as const, href: "/wfm/attendance-integrity?tab=mismatches",
      helper: active ? `${ratio(unmarked, active) ?? 0}% of ${active.toLocaleString("en-IN")} active (${asOf})` : asOf,
      formula: "Active employees who have no attendance_daily_record row for the anchor day. They are neither present nor absent in the rate above (week-off or not yet processed).", unavailable: unmarked === null ? "Anchor day unavailable" : null },
  ];
  const trend = days.slice(-14);
  const signals: InsightSignal[] = [];
  if (rate !== null && rate < 70) signals.push({ tone: "bad", title: `Attendance ${rate}% (${asOf})`, detail: un !== null && un >= 10 ? `${un}% of that day is unreconciled missing-punch rows, so part of the dip is process lag, not absence.` : "Below the 70% critical line.", value: `${rate}%`, href: "/wfm/attendance-integrity?tab=exceptions" });
  else if (rate !== null && rate >= 85) signals.push({ tone: "good", title: `Attendance healthy at ${rate}% (${asOf})`, detail: "At or above the 85% target on the latest complete day.", value: `${rate}%` });
  if (shr.unplanned !== null && shr.unplanned > 20) signals.push({ tone: "bad", title: `Unplanned shrinkage ${shr.unplanned}%`, detail: "More than one in five working days ended in an unplanned absence.", value: `${shr.unplanned}%`, href: "/wfm/roster-command-center" });
  if (un !== null && un >= 20) signals.push({ tone: "watch", title: `${un}% of ${shortDate(last.date)} rows are missing-punch`, detail: "The reconciliation engine has not resolved them: the attendance rate understates real presence until it does.", value: `${un}%`, href: "/wfm/attendance-integrity?tab=mismatches" });
  return {
    kpis, signals,
    series: [
      { key: "att_trend", title: "Attendance vs shrinkage trend", subtitle: "Latest complete processed days", kind: "line", unit: "percent", href: "/wfm/roster-command-center",
        keys: [{ key: "rate", label: "Attendance", tone: "green" }, { key: "unplanned", label: "Unplanned shrinkage", tone: "red" }, { key: "planned", label: "Planned shrinkage", tone: "blue" }],
        points: trend.map((d) => ({ label: d.date.slice(5), rate: attendanceRate(d), unplanned: shrinkage(d).unplanned, planned: shrinkage(d).planned })) },
      { key: "status_mix", title: "Daily status mix", subtitle: "Employee-days by processed status", kind: "stacked", unit: "count", href: "/wfm/attendance-integrity?tab=exceptions",
        keys: [{ key: "present", label: "Present", tone: "green" }, { key: "half", label: "Half day", tone: "amber" }, { key: "absent", label: "Absent", tone: "red" }, { key: "leave", label: "Leave", tone: "blue" }, { key: "missing", label: "Missing punch", tone: "violet" }],
        points: trend.map((d) => ({ label: d.date.slice(5), present: d.present, half: d.half, absent: d.absent, leave: d.leave, missing: d.missing })) },
    ],
  };
}

/** Planned vs unplanned shrinkage by process over the 7 days ending on the anchor. */
export async function shrinkageByProcess(ctx: InsightContext): Promise<InsightSection> {
  const anchor = await anchorDate(ctx);
  if (!anchor) return { tables: [{ key: "shrinkage_process", title: "Shrinkage by process", columns: [], rows: [], unavailable: "No processed attendance day yet" }] };
  const s = adrScope(ctx);
  const from = lastDays(anchor, 7)[0];
  const r = await rows<RowDataPacket>(
    `SELECT COALESCE(pm.process_name, 'No process') AS process, COUNT(CASE WHEN a.attendance_status NOT IN ('holiday','week_off') THEN 1 END) AS base,
            SUM(a.attendance_status = 'absent') AS absent, SUM(a.attendance_status IN ('leave_approved','on_leave','leave')) AS leave_n
       FROM attendance_daily_record a
       LEFT JOIN process_master pm ON pm.id = a.process_id
      WHERE a.record_date BETWEEN ? AND ?${s.sql}
      GROUP BY pm.process_name HAVING base >= 20`,
    [from, anchor, ...s.params],
  );
  const list = r.map((x) => { const base = num(x.base) ?? 0, ab = num(x.absent) ?? 0, lv = num(x.leave_n) ?? 0; return { process: String(x.process), days: base, unplanned: ratio(ab, base), planned: ratio(lv, base), total: ratio(ab + lv, base) }; })
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 12);
  return {
    series: [{ key: "shrinkage_ranked", title: "Shrinkage by process", subtitle: `7 days to ${shortDate(anchor)}, absent + approved leave`, kind: "ranked", unit: "percent", href: "/wfm/roster-command-center",
      points: list.map((x) => ({ label: x.process, value: x.total })), unavailable: list.length ? null : "No process with 20+ tracked days in the window" }],
    tables: [{ key: "shrinkage_process", title: "Planned vs unplanned shrinkage by process", href: "/wfm/roster-command-center",
      columns: [{ key: "process", label: "Process" }, { key: "days", label: "Days", align: "right" }, { key: "unplanned", label: "Unplanned", unit: "percent", align: "right" }, { key: "planned", label: "Planned", unit: "percent", align: "right" }, { key: "total", label: "Total", unit: "percent", align: "right" }],
      rows: list, unavailable: list.length ? null : "No process with 20+ tracked days in the window" }],
  };
}

/** Tomorrow's absenteeism forecast from same-weekday history plus leave already booked. */
export async function forecastSection(ctx: InsightContext): Promise<InsightSection> {
  const days = await dailyAttendance(ctx);
  const tomorrow = new Date(Date.parse(`${ctx.today}T00:00:00Z`) + 86_400_000);
  const ymd = tomorrow.toISOString().slice(0, 10);
  const sameWeekday = days.filter((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === tomorrow.getUTCDay());
  const s = await idFilter(ctx, "lr.employee_id", "active");
  const lv = await rows(
    `SELECT COUNT(DISTINCT lr.employee_id) AS n FROM leave_request lr
      WHERE lr.status = 'approved' AND lr.from_date <= ? AND lr.to_date >= ?${s.sql}`,
    [ymd, ymd, ...s.params],
  );
  const base = days.length ? expectedToWork(days[days.length - 1]) : null;
  const history = sameWeekday.map((d) => shrinkage(d).unplanned).filter((v): v is number => v !== null);
  const f = forecastAbsence(history, base, num(lv[0]?.n));
  if (!f) return { kpis: [{ key: "absence_forecast", label: "Tomorrow's absence forecast", value: null, unit: "count", unavailable: "No same-weekday history in the last 21 days" }] };
  const label = `${weekdayShort(ymd)} ${shortDate(ymd)}`;
  return {
    kpis: [{ key: "absence_forecast", label: `Absence forecast: ${label}`, value: f.total, unit: "count", higherIsBetter: false, tone: toneFor(f.shrinkagePct, 15, 25, false), href: "/wfm/roster-builder",
      helper: `${f.unplanned} unplanned (~${f.meanPct}%) + ${f.planned} on approved leave; ${f.samples} past ${weekdayShort(ymd)}${f.samples === 1 ? "" : "s"}`, spark: history,
      formula: "Mean unplanned-absence rate on the same weekday over recent complete days x people expected to work on the latest day, plus approved leave already covering tomorrow. A planning estimate, not a prediction of who." }],
    signals: (f.shrinkagePct ?? 0) >= 25 ? [{ tone: "watch", title: `${label}: expect ~${f.total} people short (${f.shrinkagePct}%)`, detail: "Plan overtime or standby cover before the shift starts.", value: f.total, href: "/wfm/roster-builder" }] : [],
  };
}

/** Abscond risk (3+ consecutive absences ending on the anchor) and repeat-absence attrition watch. */
export async function absconderSection(ctx: InsightContext): Promise<InsightSection> {
  const anchor = await anchorDate(ctx);
  if (!anchor) return {};
  const s = adrScope(ctx);
  const dates = lastDays(anchor, 7);
  const r = await rows<RowDataPacket>(
    // Aggregate on the (indexed) attendance rows first, then look up names for the few survivors:
    // joining employees before grouping is what made this scan slow.
    `SELECT e.id, e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS name,
            COALESCE(pm.process_name,'-') AS process, x.n, x.dates
       FROM (SELECT a.employee_id, COUNT(*) AS n, GROUP_CONCAT(DATE_FORMAT(a.record_date,'%Y-%m-%d')) AS dates
               FROM attendance_daily_record a
              WHERE a.record_date BETWEEN ? AND ? AND a.attendance_status = 'absent'${s.sql}
              GROUP BY a.employee_id HAVING COUNT(*) >= 3) x
       JOIN employees e ON e.id = x.employee_id AND e.active_status = 1
       LEFT JOIN process_master pm ON pm.id = e.process_id
      ORDER BY x.n DESC LIMIT 200`,
    [dates[0], anchor, ...s.params],
  );
  const people = r.map((x) => {
    const streak = absentStreak(String(x.dates).split(","), anchor);
    return { id: String(x.id), name: String(x.name).trim(), code: String(x.employee_code), process: String(x.process), absent7: num(x.n) ?? 0, streak, risk: abscondRisk(streak) };
  });
  const abscond = people.filter((p) => p.risk !== null);
  const repeat = people.filter((p) => p.risk === null);
  const critical = abscond.filter((p) => p.risk === "abscond").length;
  const top = [...people].sort((a, b) => b.streak - a.streak || b.absent7 - a.absent7).slice(0, 12);
  return {
    actions: [{ id: "abscond_risk", label: "Abscond risk: 3+ consecutive days absent", count: abscond.length, severity: critical > 0 ? "critical" : severityFor(abscond.length, 1, 10), href: "/wfm/attendance-integrity?tab=exceptions", hint: critical ? `${critical} absent 5+ days running; ${repeat.length} more with repeat absence` : `${repeat.length} more with 3+ absences in 7 days`, group: "Attrition risk" }],
    kpis: [{ key: "abscond_risk", label: "Abscond risk", value: abscond.length, unit: "count", higherIsBetter: false, tone: critical ? "red" : abscond.length ? "amber" : "green", href: "/wfm/attendance-integrity?tab=exceptions",
      helper: `consecutive absent days ending ${shortDate(anchor)}`, formula: "Active employees marked absent on every processed day up to the anchor for 3 or more days running. 5+ = abscond; 3-4 = watch. Employees with 3+ absences in 7 days that are not consecutive are counted as repeat-absence attrition risk." }],
    tables: [{ key: "abscond_list", title: "Absent 3+ days: abscond and attrition watch", href: "/wfm/attendance-integrity?tab=exceptions",
      columns: [{ key: "name", label: "Employee" }, { key: "code", label: "Code" }, { key: "process", label: "Process" }, { key: "streak", label: "Days running", align: "right" }, { key: "absent7", label: "Absent in 7d", align: "right" }],
      rows: top.map((p) => ({ ...p, href: `/wfm/employee-roster/${p.id}` })) }],
    signals: critical ? [{ tone: "bad", title: `${critical} employee${critical === 1 ? "" : "s"} absent 5+ days running`, detail: "Treat as abscond risk: contact the employee and the manager, then start the notice process.", value: critical, href: "/wfm/attendance-integrity?tab=exceptions" }] : [],
  };
}

/** Break overuse on the latest day with break data, plus the 7-day trend. break_settings holds no thresholds. */
export async function breakSection(ctx: InsightContext): Promise<InsightSection> {
  const s = await idFilter(ctx, "b.employee_id", "scoped");
  const latest = await rows(`SELECT DATE_FORMAT(MAX(shift_date),'%Y-%m-%d') AS d FROM break_daily_summary WHERE shift_date <= ?`, [ctx.today]);
  const d = (latest[0]?.d as string | null) ?? null;
  if (!d) return { kpis: [{ key: "break_overuse", label: "Break overuse", value: null, unit: "percent", unavailable: "No break data recorded" }] };
  const from = lastDays(d, 7)[0];
  const [trend, byProc] = await Promise.all([
    rows<RowDataPacket>(
      `SELECT DATE_FORMAT(b.shift_date,'%Y-%m-%d') AS d, COUNT(*) AS n, SUM(b.exceeded_break_count > 0) AS over_n
         FROM break_daily_summary b
        WHERE b.shift_date BETWEEN ? AND ?${s.sql} GROUP BY b.shift_date ORDER BY b.shift_date`, [from, d, ...s.params]),
    rows<RowDataPacket>(
      `SELECT COALESCE(pm.process_name,'No process') AS process, COUNT(*) AS n, SUM(b.exceeded_break_count > 0) AS over_n, ROUND(AVG(b.total_break_minutes),0) AS avg_min
         FROM break_daily_summary b LEFT JOIN process_master pm ON pm.id = b.process_id
        WHERE b.shift_date = ?${s.sql} GROUP BY pm.process_name HAVING n >= 5 ORDER BY SUM(b.exceeded_break_count > 0) / COUNT(*) DESC LIMIT 8`, [d, ...s.params]),
  ]);
  const cur = trend.find((x) => x.d === d);
  const pct = cur ? ratio(num(cur.over_n), num(cur.n)) : null;
  const series = trend.map((x) => ratio(num(x.over_n), num(x.n))).filter((v): v is number => v !== null);
  return {
    kpis: [{ key: "break_overuse", label: "Break overuse", value: pct, unit: "percent", higherIsBetter: false, tone: toneFor(pct, 20, 40, false), spark: series, helper: `agents over break limit on ${shortDate(d)}`, href: "/reports?view=library&report=break-daily-summary",
      formula: "Agents with at least one exceeded break on their shift day over agents with a break summary that day. The limit is the break engine's own flag; break_settings holds no thresholds to audit it against.", unavailable: pct === null ? "No break summaries for the latest day" : null }],
    series: [{ key: "break_by_process", title: "Break overuse by process", subtitle: `% of agents over limit, ${shortDate(d)}`, kind: "ranked", unit: "percent", href: "/reports?view=library&report=break-daily-summary",
      points: byProc.map((x) => ({ label: String(x.process), value: ratio(num(x.over_n), num(x.n)) })), unavailable: byProc.length ? null : "No process has 5+ break summaries" }],
    signals: pct !== null && pct >= 50 ? [{ tone: "watch", title: `${pct}% of agents flagged for break overuse`, detail: "A flag rate this high usually means the limit is mis-set rather than that most of the floor is abusing breaks. Review the break limit before acting on individuals.", value: `${pct}%`, href: "/wfm/break-desk-devices" }] : [],
  };
}
