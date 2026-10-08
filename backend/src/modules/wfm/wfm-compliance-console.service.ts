/**
 * Data access + orchestration for the Roster Command Center "Compliance" tab
 * (GET /api/wfm/compliance/{summary,violations,trend} and the /detail/* drill-downs).
 *
 * Every number comes from ONE computation (computeCompliance): roster rows for the selected
 * month plus five months of history -> rule incidents (wfm-compliance.calc) -> per-month
 * summaries, branch ranking, violation feed and trend. The result is cached per scope+month
 * so the three endpoints and every drill-down share a single scan of wfm_roster_assignment.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { TtlCache } from "../../shared/ttlCache.js";
import { lobWhere, type LobFilter } from "../../shared/lobFilter.js";
import {
  RULE_IDS, RULE_META, evaluateRules, groupCompliance, isValidMonth, monthBounds, monthOf, parseTimeToMinutes,
  pointsDelta, previousMonth, summarizeAttendance, summarizeMonth,
  type Incident, type MonthSummary, type RosterDay, type RuleId, type ShiftTemplate,
} from "./wfm-compliance.calc.js";

export interface ScopeFilter { branchId?: string; processId?: string; lob?: LobFilter }

export interface EmpMeta {
  id: string; code: string; name: string;
  branchId: string | null; branchName: string | null;
  processId: string | null; processName: string | null;
}

export interface BranchRow { branchId: string; branchName: string; rostered: number; breaching: number; violations: number; compliancePct: number | null }

export interface Computed {
  month: string;
  months: string[];
  incidents: Incident[];
  monthly: MonthSummary[];
  meta: Map<string, EmpMeta>;
  branchMonthly: Record<string, BranchRow[]>;
  generatedAt: string;
}

/** Same provenance guard as the original endpoint: excludes the synthetic 2026-06-11 cohort. */
export const realRoster = (alias: string) =>
  `NOT (${alias}.import_batch_id IS NULL AND ${alias}.cycle_id IS NULL ` +
  `AND ${alias}.assignment_type IS NULL AND ${alias}.shift_template_id IS NULL)`;

function employeeScope(f: ScopeFilter): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (f.branchId) { parts.push("AND e.branch_id = ?"); params.push(f.branchId); }
  if (f.processId) { parts.push("AND e.process_id = ?"); params.push(f.processId); }
  const l = f.lob ? lobWhere(f.lob) : { sql: "", params: [] as string[] };
  if (l.sql) { parts.push(l.sql); params.push(...l.params); }
  return { sql: parts.join(" "), params };
}

/** Today / current month in IST regardless of server timezone (toISOString() alone is UTC). */
export function todayIst(now: number = Date.now()): string {
  return new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

export function resolveMonth(raw: unknown, now: number = Date.now()): string {
  return isValidMonth(raw) ? raw : todayIst(now).slice(0, 7);
}

export function monthsEndingAt(month: string, count = 6): string[] {
  const out = [month];
  while (out.length < count) out.unshift(previousMonth(out[0]));
  return out;
}

let templateCache: { at: number; map: Map<string, ShiftTemplate> } | null = null;

export async function loadTemplates(): Promise<Map<string, ShiftTemplate>> {
  if (templateCache && Date.now() - templateCache.at < 300_000) return templateCache.map;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, shift_name, TIME_FORMAT(start_time,'%H:%i') AS st, TIME_FORMAT(end_time,'%H:%i') AS et,
            night_shift, productive_minutes, break_entitlement FROM wfm_shift_template`,
  );
  const map = new Map<string, ShiftTemplate>();
  for (const r of rows) {
    const startMin = parseTimeToMinutes(r.st);
    const endMin = parseTimeToMinutes(r.et);
    if (startMin === null || endMin === null) continue;
    map.set(String(r.id), {
      id: String(r.id), name: String(r.shift_name ?? ""), startMin, endMin, nightShift: Number(r.night_shift) === 1,
      productiveMinutes: r.productive_minutes === null ? null : Number(r.productive_minutes),
      breakMinutes: r.break_entitlement === null ? null : Number(r.break_entitlement),
    });
  }
  templateCache = { at: Date.now(), map };
  return map;
}

export async function loadRosterDays(from: string, to: string, scope: ScopeFilter, employeeId?: string): Promise<RosterDay[]> {
  const sc = employeeScope(scope);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ra.employee_id AS employee_id, DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS d,
            ra.is_week_off AS wo, ra.shift_template_id AS sid
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id
      WHERE ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")}
        ${employeeId ? "AND ra.employee_id = ?" : ""} ${sc.sql}`,
    [from, to, ...(employeeId ? [employeeId] : []), ...sc.params],
  );
  return rows.map((r) => ({ employeeId: String(r.employee_id), date: String(r.d), isWeekOff: Number(r.wo) === 1, shiftId: r.sid ? String(r.sid) : null }));
}

export async function loadEmployeeMeta(ids: string[]): Promise<Map<string, EmpMeta>> {
  const out = new Map<string, EmpMeta>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.branch_id, b.branch_name, e.process_id, p.process_name
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
        WHERE e.id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of rows) {
      out.set(String(r.id), {
        id: String(r.id), code: String(r.employee_code ?? ""), name: String(r.full_name ?? "").trim(),
        branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_name ?? null,
        processId: r.process_id ? String(r.process_id) : null, processName: r.process_name ?? null,
      });
    }
  }
  return out;
}

const computeCache = new TtlCache<Computed>({ maxEntries: 24, defaultTtlMs: 120_000 });

export function scopeKey(scope: ScopeFilter, month: string): string {
  const lob = scope.lob?.kind === "lob" ? scope.lob.id : scope.lob?.kind ?? "none";
  return `${month}|${scope.branchId ?? ""}|${scope.processId ?? ""}|${lob}`;
}

export async function computeCompliance(scope: ScopeFilter, month: string, refresh = false): Promise<Computed> {
  const { value } = await computeCache.getOrCompute(scopeKey(scope, month), async () => {
    const months = monthsEndingAt(month, 6);
    const [days, templates] = await Promise.all([
      loadRosterDays(monthBounds(months[0]).start, monthBounds(month).end, scope),
      loadTemplates(),
    ]);
    const incidents = evaluateRules(days, templates);
    const meta = await loadEmployeeMeta([...new Set(days.map((d) => d.employeeId))]);
    const groupOf = (id: string) => meta.get(id)?.branchId ?? null;
    const branchNames = new Map<string, string>();
    for (const e of meta.values()) if (e.branchId && e.branchName) branchNames.set(e.branchId, e.branchName);
    const branchMonthly: Record<string, BranchRow[]> = {};
    for (const m of months) {
      const g = groupCompliance(incidents, days, m, groupOf);
      branchMonthly[m] = [...g].map(([branchId, v]) => ({
        branchId, branchName: branchNames.get(branchId) ?? "Unassigned", ...v,
      }));
    }
    return {
      month, months, incidents, meta, branchMonthly,
      monthly: months.map((m) => summarizeMonth(incidents, days, m)),
      generatedAt: new Date().toISOString(),
    };
  }, { bypass: refresh });
  return value;
}

async function attendanceForMonth(scope: ScopeFilter, month: string) {
  const { start, end } = monthBounds(month);
  const yesterday = new Date(new Date(todayIst() + "T00:00:00Z").getTime() - 86_400_000).toISOString().slice(0, 10);
  const to = end < yesterday ? end : yesterday;
  if (start > to) return null;
  const sc = employeeScope(scope);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.attendance_status AS status, COALESCE(adr.late_mark,0) AS late, COUNT(*) AS n
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
      WHERE ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")} AND ra.is_week_off = 0 ${sc.sql}
      GROUP BY adr.attendance_status, COALESCE(adr.late_mark,0)`,
    [start, to, ...sc.params],
  );
  return { through: to, ...summarizeAttendance(rows.map((r) => ({ status: r.status ?? null, late: Number(r.late), n: Number(r.n) }))) };
}

export async function getSummary(scope: ScopeFilter, month: string, refresh = false) {
  const [c, attendance] = await Promise.all([computeCompliance(scope, month, refresh), attendanceForMonth(scope, month)]);
  const cur = c.monthly[c.monthly.length - 1];
  const prev = c.monthly[c.monthly.length - 2];
  const prevBranch = new Map((c.branchMonthly[previousMonth(month)] ?? []).map((b) => [b.branchId, b]));
  const byBranch = (c.branchMonthly[month] ?? [])
    .filter((b) => b.rostered > 0)
    .map((b) => ({
      branchId: b.branchId, branchName: b.branchName, score: b.compliancePct, violations: b.violations,
      rostered: b.rostered, employeesWithViolations: b.breaching,
      trend: pointsDelta(b.compliancePct, prevBranch.get(b.branchId)?.compliancePct ?? null),
    }))
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || b.violations - a.violations);
  return {
    period: month,
    hasData: cur.rostered > 0,
    compliancePct: cur.compliancePct,
    totalEmployees: cur.rostered,
    employeesWithViolations: cur.employeesWithViolations,
    totalViolations: cur.totalViolations,
    rules: cur.rules,
    byBranch,
    trend: pointsDelta(cur.compliancePct, prev?.compliancePct ?? null),
    previous: prev ? { period: prev.month, compliancePct: prev.compliancePct, totalViolations: prev.totalViolations } : null,
    history: c.monthly.map((m) => ({ month: m.month, compliancePct: m.compliancePct, violations: m.totalViolations })),
    attendance,
    generatedAt: c.generatedAt,
  };
}

export async function getTrend(scope: ScopeFilter, month: string, refresh = false) {
  const c = await computeCompliance(scope, month, refresh);
  return {
    period: month,
    trend: c.monthly.map((m) => ({
      month: m.month, compliancePct: m.compliancePct, violations: m.totalViolations,
      employeesWithViolations: m.employeesWithViolations, rostered: m.rostered,
      byRule: Object.fromEntries(m.rules.map((r) => [r.ruleId, r.violationCount])) as Record<RuleId, number>,
    })),
  };
}

export interface FeedQuery { ruleId?: string; severity?: string; q?: string; page: number; pageSize: number }

export async function getRosterViolations(scope: ScopeFilter, month: string, f: FeedQuery, refresh = false) {
  const c = await computeCompliance(scope, month, refresh);
  const q = f.q?.trim().toLowerCase();
  const inMonth = c.incidents.filter((i) => monthOf(i.date) === month);
  const matchesText = (i: Incident) => {
    if (!q) return true;
    const e = c.meta.get(i.employeeId);
    return !!e && (e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q));
  };
  const base = inMonth.filter((i) => matchesText(i) && (!f.severity || i.severity === f.severity));
  const rows = base.filter((i) => !f.ruleId || i.ruleId === f.ruleId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.employeeId < b.employeeId ? -1 : 1));
  const byRule = Object.fromEntries(RULE_IDS.map((r) => [r, base.filter((i) => i.ruleId === r).length]));
  const page = rows.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  return {
    period: month, kind: "roster" as const, page: f.page, pageSize: f.pageSize, totalCount: rows.length,
    counts: { byRule },
    violations: page.map((i) => {
      const e = c.meta.get(i.employeeId);
      return {
        violationId: i.id, date: i.date, employeeId: i.employeeId, employeeCode: e?.code ?? "", employeeName: e?.name ?? "Unknown",
        processName: e?.processName ?? null, branchName: e?.branchName ?? null, ruleId: i.ruleId, ruleName: RULE_META[i.ruleId].name,
        severity: i.severity, shiftName: null, status: "OPEN", details: i.detail, affectedDates: i.dates,
      };
    }),
  };
}

const ATT_CLASS_SQL: Record<string, string> = {
  ABSENT_NO_CALL: "adr.attendance_status = 'absent'",
  LATE_ARRIVAL: "(adr.attendance_status IN ('present','half_day','late') AND (adr.late_mark = 1 OR adr.attendance_status = 'late'))",
  MISSING_PUNCH: "adr.attendance_status = 'missing_punch'",
  UNRECONCILED: "(adr.attendance_status IS NULL OR adr.attendance_status = 'unreconciled')",
};
export const ATTENDANCE_EXCEPTION_IDS = Object.keys(ATT_CLASS_SQL);

const ATT_META: Record<string, { name: string; severity: "high" | "medium" | "low" }> = {
  ABSENT_NO_CALL: { name: "Absent", severity: "high" },
  LATE_ARRIVAL: { name: "Late Arrival", severity: "low" },
  MISSING_PUNCH: { name: "Missing Punch", severity: "medium" },
  UNRECONCILED: { name: "Attendance Not Reconciled", severity: "medium" },
};

/** Attendance exceptions on rostered working days that have already elapsed (never future days, never leave/holiday). */
export async function getAttendanceExceptions(scope: ScopeFilter, month: string, f: FeedQuery) {
  const { start, end } = monthBounds(month);
  const yesterday = new Date(new Date(todayIst() + "T00:00:00Z").getTime() - 86_400_000).toISOString().slice(0, 10);
  const to = end < yesterday ? end : yesterday;
  const sc = employeeScope(scope);
  const wanted = f.ruleId ? [ATT_CLASS_SQL[f.ruleId]] : Object.values(ATT_CLASS_SQL);
  const where = `ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")} AND ra.is_week_off = 0 AND (${wanted.join(" OR ")}) ${sc.sql}`;
  const from = `FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id
      LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date`;
  const params = [start, to, ...sc.params];
  if (start > to) return { period: month, kind: "attendance" as const, page: f.page, pageSize: f.pageSize, totalCount: 0, counts: { byRule: {} }, violations: [] };
  const limit = Math.max(1, Math.min(200, Math.floor(f.pageSize)));
  const offset = Math.max(0, (Math.floor(f.page) - 1) * limit);
  const [cntRes, rowsRes] = await Promise.all([
    db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n ${from} WHERE ${where}`, params),
    db.execute<RowDataPacket[]>(
      `SELECT ra.id AS violation_id, DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS d, e.id AS employee_id, e.employee_code, e.full_name,
              p.process_name, b.branch_name, sm.shift_name, adr.attendance_status AS status, COALESCE(adr.late_mark,0) AS late,
              COALESCE(adr.late_by_minutes,0) AS late_by
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN wfm_shift_template sm ON sm.id = ra.shift_template_id
         LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
        WHERE ${where} ORDER BY ra.roster_date DESC, e.employee_code ASC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
  ]);
  const cnt = cntRes[0];
  const rows = rowsRes[0];
  const classify = (r: RowDataPacket): string => {
    if (r.status === "absent") return "ABSENT_NO_CALL";
    if (r.status === "missing_punch") return "MISSING_PUNCH";
    if (r.status === null || r.status === "unreconciled") return "UNRECONCILED";
    return "LATE_ARRIVAL";
  };
  return {
    period: month, kind: "attendance" as const, page: f.page, pageSize: limit, totalCount: Number(cnt[0]?.n ?? 0), counts: { byRule: {} },
    violations: rows.map((r) => {
      const id = classify(r);
      return {
        violationId: String(r.violation_id), date: String(r.d), employeeId: String(r.employee_id), employeeCode: r.employee_code,
        employeeName: String(r.full_name ?? "").trim(), processName: r.process_name ?? null, branchName: r.branch_name ?? null,
        ruleId: id, ruleName: ATT_META[id].name, severity: ATT_META[id].severity, shiftName: r.shift_name ?? null, status: "OPEN",
        details: id === "LATE_ARRIVAL" && Number(r.late_by) > 0 ? `Late by ${r.late_by} min` : ATT_META[id].name, affectedDates: [String(r.d)],
      };
    }),
  };
}
