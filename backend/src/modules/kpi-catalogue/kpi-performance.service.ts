/**
 * Live performance view over the KPI catalogue: real values per process, scoped to the caller.
 *
 * Reads kpi_daily_actual (per employee per day, via kpi_metric_master.metric_code), attendance_daily_record for the two
 * attendance-derived KPIs, and process_metric_actual for process-grain KPIs. Never fabricates: a KPI with no feed is
 * reported as not_tracked, one with a feed but no rows in the window as no_data.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildScopeWhereEmployees, resolveDashboardScope } from "../../shared/dashboardScope.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { getProcessKpis } from "./kpi-catalogue.service.js";
import { DEFAULT_RATING_BANDS, ratingFor, type RatingBand } from "./kpi-catalogue.resolve.js";
import {
  aggregate, attainmentPct, availabilityFor, buildBreakdown, buildSeries, round2, scaledTotalTarget, stalenessDays, windowFor,
  type Availability, type BreakdownRow, type Period,
} from "./kpi-performance.calc.js";

type Row = RowDataPacket & Record<string, any>;

export type GroupBy = "employee" | "team" | "branch";

export interface PerformanceOptions {
  userId: string;
  period: Period;
  from?: string;
  to?: string;
  groupBy: GroupBy;
  role?: string;
  employeeId?: string;
}

export interface KpiPerformance {
  id: string; metric_key: string; name: string; theme: string; unit: string; direction: string; grain: string;
  freshness: string; source_kind: string; source_ref: string | null; formula: string | null; metric_code: string | null;
  availability: Availability; value: number | null; target: number | null; attainment_pct: number | null; rating: string | null;
  last_data_date: string | null; staleness_days: number | null; samples: number;
  series: Array<{ date: string; value: number | null }>; breakdown: BreakdownRow[];
}

/** Catalogue KPIs computed straight from attendance_daily_record (real, scoped, daily). */
const DIRECT_ATTENDANCE_KEYS = new Set(["wf_login_hours", "wf_late_login_pct"]);

/** Union of process_codes JSON values (strings or arrays), de-duplicated, order preserved. */
export function unionCodes(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    let arr: unknown = v;
    if (typeof v === "string") { try { arr = JSON.parse(v); } catch { arr = []; } }
    if (Array.isArray(arr)) for (const c of arr) { const code = String(c ?? "").trim(); if (code && !out.includes(code)) out.push(code); }
  }
  return out;
}

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const inList = (n: number) => Array.from({ length: n }, () => "?").join(",");

async function loadBands(): Promise<RatingBand[]> {
  try {
    const [rows] = await db.execute<Row[]>(
      `SELECT b.band_label AS label, b.min_score AS min FROM kpi_rating_scale_band b
         JOIN kpi_rating_scale s ON s.id = b.scale_id WHERE s.is_default = 1`,
    );
    const bands = (rows as Row[]).map((r) => ({ label: String(r.label), minScore: Number(r.min) }));
    return bands.length ? bands : DEFAULT_RATING_BANDS;
  } catch { return DEFAULT_RATING_BANDS; }
}

export async function getProcessPerformance(processKey: string, o: PerformanceOptions) {
  const today = istToday();
  const window = windowFor(o.period, today, o.from, o.to);
  const bands = await loadBands();

  const ctx = await getUserRoleContext(o.userId);
  const scope = await resolveDashboardScope(o.userId, ctx.primaryRole);
  const scopeSql = buildScopeWhereEmployees(scope, "e");

  // Process restriction from the catalogue row's process codes.
  // Union over every catalogue row of the process: rows mirrored from KPI Studio can carry an older, narrower code list than the seed.
  const [codeRows] = await db.execute<Row[]>(`SELECT process_name, process_codes, seeded FROM kpi_catalogue WHERE process_key = ? ORDER BY seeded DESC`, [processKey]);
  const head = (codeRows as Row[])[0];
  if (!head) return null;
  const codes: string[] = unionCodes((codeRows as Row[]).map((r) => r.process_codes));
  let processIds: string[] = [];
  if (processKey !== "_global" && codes.length) {
    const [pm] = await db.execute<Row[]>(`SELECT id FROM process_master WHERE process_code IN (${inList(codes.length)})`, codes as never[]);
    processIds = (pm as Row[]).map((r) => String(r.id));
  }
  const processSql = processKey === "_global" ? "1=1" : processIds.length ? `e.process_id IN (${inList(processIds.length)})` : "1=0";
  // Facts written by the upload feeds carry the process they belong to (process_id_at_event); some of those processes
  // have no employees assigned in employees.process_id, so a fact counts for the process by either route.
  const factProcessSql = processKey === "_global" ? "1=1"
    : processIds.length ? `(e.process_id IN (${inList(processIds.length)}) OR a.process_id_at_event IN (${inList(processIds.length)}))` : "1=0";
  const empFilterSql = o.employeeId ? "AND e.id = ?" : "";
  const baseParams = [...scopeSql.params, ...processIds, ...(o.employeeId ? [o.employeeId] : [])];

  const kpis = await getProcessKpis(processKey, { role: o.role, includeNoData: true });

  // Headcount in view.
  const [hc] = await db.execute<Row[]>(
    `SELECT COUNT(*) AS n FROM employees e WHERE e.active_status = 1 AND (${scopeSql.sql}) AND (${processSql}) ${empFilterSql}`,
    baseParams as never[],
  );
  const headcount = Number((hc as Row[])[0]?.n ?? 0);

  const empKpis = kpis.filter((k) => k.grain !== "process");
  const codesNeeded = Array.from(new Set(empKpis.map((k) => k.metric_code).filter((c): c is string => Boolean(c))));

  // ── employee-day actuals from kpi_daily_actual ──
  type ActualRow = { code: string; date: string; employeeId: string; value: number | null; label: string; teamKey: string; teamLabel: string; branchKey: string; branchLabel: string };
  const actuals: ActualRow[] = [];
  const meta = new Map<string, { agg: string | null }>();
  if (codesNeeded.length) {
    const [mrows] = await db.execute<Row[]>(
      `SELECT metric_code, aggregation_method FROM kpi_metric_master WHERE metric_code IN (${inList(codesNeeded.length)})`, codesNeeded as never[]);
    for (const r of mrows as Row[]) meta.set(String(r.metric_code), { agg: r.aggregation_method ?? null });
    const [rows] = await db.execute<Row[]>(
      `SELECT m.metric_code, DATE_FORMAT(a.score_date, '%Y-%m-%d') AS d, a.employee_id, a.actual_value AS v,
              e.employee_code, COALESCE(NULLIF(TRIM(e.full_name), ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS ename,
              e.reporting_manager_id, COALESCE(NULLIF(TRIM(rm.full_name), ''), CONCAT(rm.first_name, ' ', COALESCE(rm.last_name, ''))) AS mname,
              e.branch_id, b.branch_name
         FROM kpi_daily_actual a
         JOIN kpi_metric_master m ON m.id = a.metric_id
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE m.metric_code IN (${inList(codesNeeded.length)}) AND a.score_date BETWEEN ? AND ?
          AND (${scopeSql.sql}) AND (${factProcessSql}) ${empFilterSql}
        ORDER BY a.score_date
        LIMIT 400000`,
      [...codesNeeded, window.from, window.to, ...scopeSql.params, ...(processKey === "_global" ? [] : [...processIds, ...processIds]), ...(o.employeeId ? [o.employeeId] : [])] as never[],
    );
    for (const r of rows as Row[]) {
      actuals.push({
        code: String(r.metric_code), date: String(r.d), employeeId: String(r.employee_id), value: r.v == null ? null : Number(r.v),
        label: `${String(r.ename ?? "").trim()} (${r.employee_code})`,
        teamKey: String(r.reporting_manager_id ?? "none"), teamLabel: String(r.mname ?? "").trim() || "No manager",
        branchKey: String(r.branch_id ?? "none"), branchLabel: String(r.branch_name ?? "No branch"),
      });
    }
  }

  // ── attendance-derived KPIs ──
  const attendance: ActualRow[] = [];
  if (empKpis.some((k) => DIRECT_ATTENDANCE_KEYS.has(k.metric_key))) {
    const [rows] = await db.execute<Row[]>(
      `SELECT DATE_FORMAT(r.record_date, '%Y-%m-%d') AS d, r.employee_id, r.dialler_minutes, r.late_mark, r.clock_in_time,
              e.employee_code, COALESCE(NULLIF(TRIM(e.full_name), ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS ename,
              e.reporting_manager_id, COALESCE(NULLIF(TRIM(rm.full_name), ''), CONCAT(rm.first_name, ' ', COALESCE(rm.last_name, ''))) AS mname,
              e.branch_id, b.branch_name
         FROM attendance_daily_record r
         JOIN employees e ON e.id = r.employee_id
         LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE r.record_date BETWEEN ? AND ? AND (${scopeSql.sql}) AND (${processSql}) ${empFilterSql}
        LIMIT 400000`,
      [window.from, window.to, ...baseParams] as never[],
    );
    for (const r of rows as Row[]) {
      const present = r.clock_in_time != null || Number(r.dialler_minutes ?? 0) > 0;
      if (!present) continue;
      const base = {
        date: String(r.d), employeeId: String(r.employee_id), label: `${String(r.ename ?? "").trim()} (${r.employee_code})`,
        teamKey: String(r.reporting_manager_id ?? "none"), teamLabel: String(r.mname ?? "").trim() || "No manager",
        branchKey: String(r.branch_id ?? "none"), branchLabel: String(r.branch_name ?? "No branch"),
      };
      if (Number(r.dialler_minutes ?? 0) > 0) attendance.push({ ...base, code: "wf_login_hours", value: Number(r.dialler_minutes) / 60 });
      attendance.push({ ...base, code: "wf_late_login_pct", value: Number(r.late_mark) ? 100 : 0 });
    }
  }

  // ── targets: average resolved target over the employees in view ──
  const targets = new Map<string, number>();
  if (codesNeeded.length) {
    const [trows] = await db.execute<Row[]>(
      `SELECT m.metric_code, AVG(r.target_value) AS t
         FROM kpi_employee_resolved r
         JOIN kpi_metric_master m ON m.id = r.metric_id
         JOIN employees e ON e.id = r.employee_id
        WHERE m.metric_code IN (${inList(codesNeeded.length)}) AND (${scopeSql.sql}) AND (${processSql}) ${empFilterSql}
        GROUP BY m.metric_code`,
      [...codesNeeded, ...baseParams] as never[],
    );
    for (const r of trows as Row[]) if (r.t != null) targets.set(String(r.metric_code), Number(r.t));
  }

  // ── process-grain KPIs (aggregate; not shown to self-only callers) ──
  const processKpis = kpis.filter((k) => k.grain === "process" || (k.grain === "both" && !k.metric_code));
  const processRows = new Map<string, Array<{ date: string; value: number | null }>>();
  if (scope.level !== "SELF_ONLY" && processIds.length && processKpis.length) {
    const keys = processKpis.map((k) => k.metric_key);
    const [prows] = await db.execute<Row[]>(
      `SELECT metric_key, DATE_FORMAT(score_date, '%Y-%m-%d') AS d, actual_value AS v FROM process_metric_actual
        WHERE process_id IN (${inList(processIds.length)}) AND metric_key IN (${inList(keys.length)}) AND score_date BETWEEN ? AND ?
        ORDER BY score_date`,
      [...processIds, ...keys, window.from, window.to] as never[],
    );
    for (const r of prows as Row[]) processRows.set(String(r.metric_key), [...(processRows.get(String(r.metric_key)) ?? []), { date: String(r.d), value: r.v == null ? null : Number(r.v) }]);
  }

  // last data date for mapped codes with no rows in the window (staleness explains an empty card)
  const lastSeen = new Map<string, string>();
  const emptyCodes = codesNeeded.filter((c) => !actuals.some((a) => a.code === c));
  if (emptyCodes.length) {
    const [lrows] = await db.execute<Row[]>(
      `SELECT m.metric_code, DATE_FORMAT(MAX(a.score_date), '%Y-%m-%d') AS d FROM kpi_daily_actual a
         JOIN kpi_metric_master m ON m.id = a.metric_id JOIN employees e ON e.id = a.employee_id
        WHERE m.metric_code IN (${inList(emptyCodes.length)}) AND (${scopeSql.sql}) AND (${factProcessSql}) ${empFilterSql} GROUP BY m.metric_code`,
      [...emptyCodes, ...scopeSql.params, ...(processKey === "_global" ? [] : [...processIds, ...processIds]), ...(o.employeeId ? [o.employeeId] : [])] as never[],
    );
    for (const r of lrows as Row[]) if (r.d) lastSeen.set(String(r.metric_code), String(r.d));
  }

  const out: KpiPerformance[] = kpis.map((k) => {
    const isAttendance = DIRECT_ATTENDANCE_KEYS.has(k.metric_key);
    const isProcessGrain = !isAttendance && processRows.has(k.metric_key);
    const code = isAttendance ? k.metric_key : k.metric_code;
    const rows = isAttendance ? attendance.filter((a) => a.code === code) : code ? actuals.filter((a) => a.code === code) : [];
    const procSeries = isProcessGrain ? processRows.get(k.metric_key)! : [];
    const rowCount = rows.length + procSeries.length;
    const mapped = Boolean(code) || isProcessGrain || isAttendance;
    const availability = availabilityFor({ mapped, hasData: k.has_data || isAttendance, rowCount });
    const agg = k.family === "volume" || k.unit === "count" || k.unit === "currency"
      ? "sum" : (code && meta.get(code)?.agg) || "average";

    let value: number | null = null;
    let series: KpiPerformance["series"] = [];
    let breakdown: BreakdownRow[] = [];
    const perDayTarget: number | null = (code ? targets.get(code) : undefined) ?? k.default_target ?? null;
    // Summed volume KPIs: the resolved target is per employee per day, so compare the total with target x worked days.
    const target: number | null = agg === "sum" && rows.length ? scaledTotalTarget(perDayTarget, rows.filter((r) => r.value != null).length) : perDayTarget;
    if (rows.length) {
      const perEmployee = new Map<string, number[]>();
      for (const r of rows) if (r.value != null) perEmployee.set(r.employeeId, [...(perEmployee.get(r.employeeId) ?? []), r.value]);
      // Headline: mean of each employee's window aggregate for rates; total for volume metrics.
      const empValues = [...perEmployee.values()].map((v) => aggregate(v, agg));
      value = round2(agg === "sum" ? aggregate(empValues, "sum") : aggregate(empValues, "average"));
      series = buildSeries(rows.map((r) => ({ date: r.date, employeeId: r.employeeId, value: r.value })), agg, window);
      const keyOf = (r: ActualRow) => o.groupBy === "team" ? [r.teamKey, r.teamLabel] : o.groupBy === "branch" ? [r.branchKey, r.branchLabel] : [r.employeeId, r.label];
      breakdown = buildBreakdown(
        rows.map((r) => ({ date: r.date, employeeId: r.employeeId, value: r.value, groupKey: keyOf(r)[0], groupLabel: keyOf(r)[1] })),
        agg, perDayTarget, k.direction, bands, 200, agg === "sum",
      );
    } else if (procSeries.length) {
      value = round2(aggregate(procSeries.map((p) => p.value), agg));
      series = buildSeries(procSeries.map((p) => ({ date: p.date, employeeId: "process", value: p.value })), agg, window);
    }
    const attainment = attainmentPct(value, target, k.direction);
    const lastData = rowCount
      ? [...rows.map((r) => r.date), ...procSeries.map((p) => p.date)].sort().pop() ?? null
      : (code ? lastSeen.get(code) ?? null : null);
    return {
      id: k.id, metric_key: k.metric_key, name: k.metric_name, theme: k.theme, unit: k.unit, direction: k.direction, grain: k.grain,
      freshness: k.freshness, source_kind: k.source_kind, source_ref: k.source_ref, formula: k.formula, metric_code: k.metric_code,
      availability, value, target: target == null ? null : round2(target), attainment_pct: attainment, rating: ratingFor(attainment, bands),
      last_data_date: lastData, staleness_days: stalenessDays(lastData, today), samples: rowCount, series, breakdown,
    };
  });

  const scored = out.filter((x) => x.attainment_pct != null);
  return {
    process: { key: processKey, name: head.process_name },
    window, scope: { level: scope.level }, headcount,
    summary: {
      kpis: out.length,
      ok: out.filter((x) => x.availability === "ok").length,
      no_data: out.filter((x) => x.availability === "no_data").length,
      not_tracked: out.filter((x) => x.availability === "not_tracked").length,
      overall_attainment: scored.length ? round2(scored.reduce((s, x) => s + (x.attainment_pct ?? 0), 0) / scored.length) : null,
      overall_rating: scored.length ? ratingFor(scored.reduce((s, x) => s + (x.attainment_pct ?? 0), 0) / scored.length, bands) : null,
    },
    kpis: out,
  };
}
