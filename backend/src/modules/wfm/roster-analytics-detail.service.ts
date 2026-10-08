/**
 * Roster Analytics drill-down payloads (Drill-Down Mandate): every KPI / chart segment / table row on the
 * Analytics panel opens a drawer backed by one of these. They reuse classifyRow so the numbers match the
 * headline exactly. Sections with no data return empty arrays (the UI renders "None").
 */
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { lobAnd, type LobFilter } from '../../shared/lobFilter.js';
import { fetchBranchRosterRows, tallyWeek, loadBudgetPct } from './roster-analytics.service.js';
import { employeeScope } from './roster-analytics-quality.service.js';
import {
  DEFAULT_HOURLY_COST_INR, addDays, classifyRow, dayNameOf, localDateStr, periodBounds, realRosterSql,
  round1, type RowOutcome,
} from './roster-analytics.calc.js';

export type ShrinkageDetailKind = 'total' | 'planned_leave' | 'unplanned_absence' | 'late' | 'early' | 'training' | 'day' | 'manager' | 'process';
export const SHRINKAGE_DETAIL_KINDS: ShrinkageDetailKind[] = ['total', 'planned_leave', 'unplanned_absence', 'late', 'early', 'training', 'day', 'manager', 'process'];

const KIND_LABEL: Record<ShrinkageDetailKind, string> = {
  total: 'Total shrinkage', planned_leave: 'Planned leave', unplanned_absence: 'Unplanned absence', late: 'Late arrivals',
  early: 'Early departures / short shifts', training: 'Training', day: 'Day', manager: 'Manager team', process: 'Process',
};

function matchesKind(kind: ShrinkageDetailKind, o: RowOutcome): boolean {
  switch (kind) {
    case 'planned_leave': return o.status === 'LEAVE';
    case 'training': return o.status === 'TRAINING';
    case 'unplanned_absence': return o.status === 'ABSENT';
    case 'late': return o.late;
    case 'early': return o.short;
    default: return o.isShrinkage; // total / day / manager / process list the shrinkage rows
  }
}

export async function getShrinkageDetail(
  branchId: string, weekStart: string, kind: ShrinkageDetailKind, key: string | undefined,
  lob: LobFilter, processId?: string
) {
  const now = new Date();
  const weeks = 8;
  const histStart = addDays(weekStart, -7 * (weeks - 1));
  const end = addDays(weekStart, 6);
  const [rows, budgetPct] = await Promise.all([
    fetchBranchRosterRows(branchId, histStart, end, lob, processId),
    loadBudgetPct(branchId),
  ]);

  const inEntity = (r: Record<string, any>) => {
    if (kind === 'day') return String(r.roster_date).slice(0, 10) === key;
    if (kind === 'manager') return (r.reporting_manager_id ? String(r.reporting_manager_id) : 'unknown') === key;
    if (kind === 'process') return (r.process_id ? String(r.process_id) : 'unknown') === key;
    return true;
  };
  const scoped = rows.filter(inEntity);

  const trend: Array<{ weekStart: string; shrinkagePct: number; base: number }> = [];
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(histStart, 7 * w);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const set = new Set(dates);
    const t = tallyWeek(scoped.filter(r => set.has(String(r.roster_date).slice(0, 10))), dates, now);
    trend.push({ weekStart: ws, shrinkagePct: t.breakdown.total.pct, base: t.base });
  }

  const weekDates = new Set(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
  const weekRows = scoped.filter(r => weekDates.has(String(r.roster_date).slice(0, 10)));
  const t = tallyWeek(weekRows, [...weekDates], now);

  const records: Array<Record<string, any>> = [];
  for (const r of weekRows) {
    const o = classifyRow(r as any, now);
    if (!o.inBase || !matchesKind(kind, o)) continue;
    records.push({
      employeeId: String(r.employee_id), employeeCode: r.employee_code ? String(r.employee_code) : null,
      employeeName: r.employee_name ? String(r.employee_name) : null,
      managerName: r.manager_name ? String(r.manager_name) : null,
      processName: r.process_name ? String(r.process_name) : null,
      date: String(r.roster_date).slice(0, 10), day: dayNameOf(String(r.roster_date).slice(0, 10)),
      status: o.status, assignmentType: r.assignment_type ? String(r.assignment_type) : null,
      expectedHours: round1(o.expectedHours), workedHours: round1(o.workedHours),
      lateMinutes: o.lateMinutes, hoursLost: round1(o.hoursLost),
      clockIn: r.first_in ? String(r.first_in) : null,
    });
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || String(a.employeeName).localeCompare(String(b.employeeName)));

  return {
    kind, key: key ?? null, label: KIND_LABEL[kind], branchId, weekStart, weekEnd: end, budgetPct,
    summary: {
      counted: t.base, shrinkageCount: t.breakdown.total.count, shrinkagePct: t.breakdown.total.pct,
      breakdown: t.breakdown, hoursLost: round1(t.hoursLost),
      costINR: Math.round(t.hoursLost * DEFAULT_HOURLY_COST_INR),
    },
    totalRecords: records.length,
    records: records.slice(0, 300),
    trend,
    timeline: [] as unknown[], // no workflow / decision stages exist for an analytics aggregate
    audit: [] as unknown[],
  };
}

export async function getEmployeeAnalyticsDetail(employeeId: string, period: string) {
  const now = new Date();
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.employment_status, e.active_status, e.date_of_joining,
            e.branch_id, b.branch_name, e.process_id, pm.process_name, e.lob_id, e.reporting_manager_id,
            mgr.full_name AS manager_name, dm.designation_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
      WHERE e.id = ?`,
    [employeeId]
  );
  const emp = empRows[0];
  if (!emp) return null;

  const { first } = periodBounds(period);
  const monthEnd = periodBounds(period).last;
  // 6 months of history ending at the selected period, for the adherence trend.
  const [py, pm] = period.split('-').map(Number);
  const startD = new Date(Date.UTC(py, pm - 6, 1)).toISOString().slice(0, 10);
  const [rosterRows] = await db.execute<RowDataPacket[]>(
    `SELECT ra.roster_date, ra.assignment_type, ra.shift_start_time, ra.shift_end_time,
            st.start_time AS template_start, st.end_time AS template_end,
            att.clock_in_time AS first_in, att.clock_out_time AS last_out, att.raw_minutes / 60 AS total_hours
       FROM wfm_roster_assignment ra
       LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
       LEFT JOIN attendance_daily_record att ON att.employee_id = ra.employee_id AND att.record_date = ra.roster_date
      WHERE ra.employee_id = ? AND ra.roster_date BETWEEN ? AND ? AND ${realRosterSql('ra')}
      ORDER BY ra.roster_date`,
    [employeeId, startD, monthEnd < first ? first : monthEnd]
  );
  const [qualityRows] = await db.execute<RowDataPacket[]>(
    `SELECT ks.period, km.metric_name, km.unit, ks.actual_value
       FROM kpi_score ks JOIN kpi_metric_master km ON km.id = ks.metric_id
      WHERE ks.employee_id = ? AND km.family = 'quality' AND ks.period BETWEEN ? AND ?
      ORDER BY ks.period, km.metric_name`,
    [employeeId, `${startD.slice(0, 7)}`, period]
  );

  const byMonth = new Map<string, { planned: number; attended: number; lost: number }>();
  const days: Array<Record<string, any>> = [];
  for (const r of rosterRows) {
    const o = classifyRow(r as any, now);
    const d = String(r.roster_date).slice(0, 10);
    const m = d.slice(0, 7);
    if (o.isPlanned) {
      const b = byMonth.get(m) ?? { planned: 0, attended: 0, lost: 0 };
      b.planned++; if (o.status === 'PRESENT') b.attended++; b.lost += o.hoursLost;
      byMonth.set(m, b);
    }
    if (m === period) {
      days.push({
        date: d, day: dayNameOf(d), status: o.status, assignmentType: r.assignment_type ? String(r.assignment_type) : null,
        expectedHours: round1(o.expectedHours), workedHours: round1(o.workedHours), lateMinutes: o.lateMinutes,
        hoursLost: round1(o.hoursLost), clockIn: r.first_in ? String(r.first_in) : null, clockOut: r.last_out ? String(r.last_out) : null,
      });
    }
  }
  const adherenceTrend = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, b]) => ({
    period: m, planned: b.planned, attended: b.attended,
    adherencePct: b.planned > 0 ? round1((b.attended / b.planned) * 100) : 0,
    hoursLost: round1(b.lost), costINR: Math.round(b.lost * DEFAULT_HOURLY_COST_INR),
  }));
  const cur = byMonth.get(period);

  return {
    employee: {
      id: String(emp.id), code: emp.employee_code, name: emp.full_name, designation: emp.designation_name ?? null,
      employmentStatus: emp.employment_status ?? null, active: Number(emp.active_status) === 1,
      dateOfJoining: emp.date_of_joining ?? null, branchName: emp.branch_name ?? null,
      processName: emp.process_name ?? null, managerName: emp.manager_name ?? null,
    },
    period,
    summary: {
      planned: cur?.planned ?? 0, attended: cur?.attended ?? 0,
      adherencePct: cur && cur.planned > 0 ? round1((cur.attended / cur.planned) * 100) : null,
      hoursLost: round1(cur?.lost ?? 0), costINR: Math.round((cur?.lost ?? 0) * DEFAULT_HOURLY_COST_INR),
    },
    days,
    adherenceTrend,
    quality: qualityRows.map(q => ({ period: String(q.period), metric: String(q.metric_name), unit: q.unit ?? null, value: q.actual_value === null ? null : Number(q.actual_value) })),
    timeline: [] as unknown[],
    audit: [] as unknown[],
  };
}

export type CostComponent = 'total' | 'absent' | 'late' | 'early' | 'incomplete';
export const COST_COMPONENTS: CostComponent[] = ['total', 'absent', 'late', 'early', 'incomplete'];

export async function getCostDetail(
  period: string, component: CostComponent, branchId?: string, processId?: string, lob?: LobFilter
) {
  const now = new Date();
  const { conditions, params } = employeeScope(branchId, processId, lob);
  const { first, last, empty } = periodBounds(period);
  const [py, pm] = period.split('-').map(Number);
  const trendStart = new Date(Date.UTC(py, pm - 6, 1)).toISOString().slice(0, 10);
  const from = trendStart < first ? trendStart : first;
  const [rows] = empty ? [[] as RowDataPacket[]] : await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code, e.full_name AS employee_name,
            ra.roster_date, ra.assignment_type, ra.shift_start_time, ra.shift_end_time,
            st.start_time AS template_start, st.end_time AS template_end,
            att.clock_in_time AS first_in, att.raw_minutes / 60 AS total_hours
       FROM employees e
       JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
       LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
       LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
      WHERE ${conditions.join(' AND ')}
        AND COALESCE(ra.assignment_type, '') NOT IN ('WEEK_OFF', 'HOLIDAY')
        AND ra.roster_date BETWEEN ? AND ?
        AND ${realRosterSql('ra')}`,
    [...params, from, last]
  );

  const pick = (o: RowOutcome) => component === 'absent' ? o.lostAbsent : component === 'late' ? o.lostLate
    : component === 'early' ? o.lostEarly : component === 'incomplete' ? o.lostIncomplete : o.hoursLost;
  const perEmp = new Map<string, { code: string; name: string; hours: number; days: number }>();
  const perDay = new Map<string, number>();
  const perMonth = new Map<string, { lost: number; planned: number }>();
  for (const r of rows) {
    const o = classifyRow(r as any, now);
    if (!o.isPlanned) continue;
    const d = String(r.roster_date).slice(0, 10);
    const m = d.slice(0, 7);
    const mm = perMonth.get(m) ?? { lost: 0, planned: 0 };
    mm.lost += pick(o); mm.planned += o.expectedHours; perMonth.set(m, mm);
    if (m !== period) continue;
    const h = pick(o);
    if (h <= 0) continue;
    const id = String(r.employee_id);
    const e = perEmp.get(id) ?? { code: String(r.employee_code ?? ''), name: String(r.employee_name ?? ''), hours: 0, days: 0 };
    e.hours += h; e.days++; perEmp.set(id, e);
    perDay.set(d, (perDay.get(d) ?? 0) + h);
  }
  const cost = (h: number) => Math.round(h * DEFAULT_HOURLY_COST_INR);
  const all = [...perEmp.entries()].map(([id, e]) => ({ employeeId: id, employeeCode: e.code, employeeName: e.name, days: e.days, hoursLost: round1(e.hours), costINR: cost(e.hours) }))
    .sort((a, b) => b.hoursLost - a.hoursLost);
  const totalHours = [...perEmp.values()].reduce((s, e) => s + e.hours, 0);
  return {
    period, component, hourlyCostINR: DEFAULT_HOURLY_COST_INR, today: localDateStr(now),
    summary: { hoursLost: round1(totalHours), costINR: cost(totalHours), employees: all.length },
    topEmployees: all.slice(0, 25),
    daily: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, h]) => ({ date, hoursLost: round1(h), costINR: cost(h) })),
    trend: [...perMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({
      period: m, hoursLost: round1(v.lost), costINR: cost(v.lost), lossPct: v.planned > 0 ? round1((v.lost / v.planned) * 100) : 0,
    })),
    timeline: [] as unknown[],
    audit: [] as unknown[],
  };
}

/** History behind one forecast day: the same weekday over the last 8 weeks (unplanned-absence rate). */
export async function getForecastDayDetail(branchId: string, date: string, lob: LobFilter, processId?: string) {
  const lobSql = lobAnd(lob);
  const proc = processId ? { sql: ' AND e.process_id = ?', params: [processId] } : { sql: '', params: [] as string[] };
  const yesterday = addDays(localDateStr(), -1);
  const from = addDays(yesterday, -56);
  const dowMysql = new Date(`${date}T00:00:00Z`).getUTCDay() + 1; // MySQL DAYOFWEEK: 1=Sunday
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ra.roster_date,
            COUNT(CASE WHEN COALESCE(ra.assignment_type, '') NOT IN ('WEEK_OFF', 'HOLIDAY') THEN 1 END) AS planned,
            COUNT(CASE WHEN COALESCE(ra.assignment_type, '') NOT IN ('WEEK_OFF', 'HOLIDAY', 'LEAVE', 'TRAINING')
                        AND att.clock_in_time IS NULL AND COALESCE(att.raw_minutes, 0) = 0 THEN 1 END) AS absent
       FROM employees e
       JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
       LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
      WHERE e.branch_id = ? AND e.active_status = 1${lobSql.sql}${proc.sql}
        AND ra.roster_date BETWEEN ? AND ? AND DAYOFWEEK(ra.roster_date) = ?
        AND ${realRosterSql('ra')}
      GROUP BY ra.roster_date ORDER BY ra.roster_date`,
    [branchId, ...lobSql.params, ...proc.params, from, yesterday, dowMysql]
  );
  const history = rows.map(r => {
    const planned = Number(r.planned) || 0, absent = Number(r.absent) || 0;
    const d = String(r.roster_date).slice(0, 10);
    return { date: d, planned, absent, absencePct: planned > 0 ? round1((absent / planned) * 100) : 0 };
  });
  const tp = history.reduce((s, h) => s + h.planned, 0), ta = history.reduce((s, h) => s + h.absent, 0);
  return {
    date, day: dayNameOf(date), branchId,
    summary: { sameWeekdaySamples: history.length, avgAbsencePct: tp > 0 ? round1((ta / tp) * 100) : 0 },
    history,
    timeline: [] as unknown[],
    audit: [] as unknown[],
  };
}
