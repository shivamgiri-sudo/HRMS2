import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";

/**
 * Process Performance Health Report Card.
 *
 * Three grains of the same shape: a process row, the manager rows inside it, and
 * the agent rows inside a manager. Each carries the same set of KPI sections so
 * the UI renders one cell layout at every depth.
 *
 * Why a section registry in code rather than process_metric_definition:
 * that table models exactly the right per-process flexibility and is
 * effective-dated, but it holds ZERO rows today (0 processes defined), and the
 * sections asked for here mostly do not live in the KPI pipeline at all --
 * Headcount, Shrinkage, Attrition and Late Comers % come from `employees` and
 * `attendance_daily_record`. Populating 132 processes' worth of definitions to
 * make the page light up would be inventing configuration, so the page reads
 * real tables directly and reports per-process flexibility as "which sections
 * actually resolve data for this process".
 *
 * The honesty rule this module exists to enforce: a section either returns a
 * number computed from real rows, or it returns availability:'not_tracked' /
 * 'no_data'. There is no third path. Nothing here fabricates a value, and
 * root-cause breakdowns are only offered where the database genuinely
 * categorises the cause (see ROOT_CAUSE_AVAILABILITY).
 */

export type Grain = "process" | "manager" | "agent";

export type SectionKey =
  | "headcount"
  | "mandate"
  | "buffer"
  | "shrinkage"
  | "attrition"
  | "quality"
  | "operations"
  | "hygiene"
  | "late_comers"
  | "pnl";

export type Availability = "ok" | "no_data" | "not_tracked";

export interface SectionValue {
  key: SectionKey;
  label: string;
  unit: "percent" | "count" | "seconds" | "currency" | null;
  value: number | null;
  availability: Availability;
  /** Why a value is absent, shown to the user instead of a number. */
  note?: string;
  direction: "higher_is_better" | "lower_is_better" | null;
  hasRootCause: boolean;
}

export interface PerformanceRow {
  grain: Grain;
  id: string;
  name: string;
  subtitle: string | null;
  /** Present on process rows: how many manager sub-rows exist beneath. */
  childCount: number | null;
  sections: SectionValue[];
}

/**
 * Sections with no data source anywhere in the schema.
 *
 * Searched for each across backend/src/modules and the live schema: "mandate"
 * and "buffer" return only unrelated matches (role catalogue text, Node's
 * Buffer), and "hygiene" only ATS document-hygiene checks unrelated to process
 * performance. "Shrinkage" does exist in WFM but purely as a PLANNING INPUT
 * (auto-roster's shrinkage_pct fed into roster sizing), never as a measured
 * actual -- so measured shrinkage is derived from attendance below rather than
 * read from there.
 *
 * These are declared rather than silently omitted so the UI can say "not
 * tracked" in the cell, which is a different statement from a bad score.
 */
const NOT_TRACKED: Record<string, string> = {
  mandate: "No mandate/target source exists in the schema yet.",
  buffer: "No buffer headcount source exists in the schema yet.",
  hygiene: "No process hygiene metric is captured yet.",
};

/**
 * Which sections can show a real root-cause breakdown.
 *
 * Attrition is deliberately false: `employees` carries only date_of_exit,
 * resignation_date and previous_exit_date -- there is NO categorised exit-reason
 * column, so any "why people left" split would be invented. The exit count
 * itself is real and is still shown.
 *
 * Quality and Operations are false because their underlying kpi_daily_actual
 * rows carry a value but no failure category (QUALITY_SCORE has no error-type
 * dimension in that table).
 */
const ROOT_CAUSE_AVAILABILITY: Record<SectionKey, boolean> = {
  headcount: true,
  late_comers: true,
  shrinkage: true,
  attrition: false,
  quality: false,
  operations: false,
  mandate: false,
  buffer: false,
  hygiene: false,
  pnl: false,
};

export interface PerfFilters {
  from: string;
  to: string;
  processId?: string | null;
  managerId?: string | null;
}

/** Employee-grain scope predicate, applied at every level rather than only the top filter. */
async function employeeScope(userId: string, allowedRoles: string[]) {
  return buildScopeWhereClause(userId, allowedRoles, {
    processId: "e.process_id",
    branchId: "e.branch_id",
    managerEmployeeId: "e.reporting_manager_id",
    employeeId: "e.id",
  }, { allowAdminBypass: true, allowCeoAllRead: true });
}

// Kept identical to the route's list plus super_admin, and to the roles granted
// OPERATIONS_DASHBOARD in page_catalog -- three gates that must agree, or a role
// passes one and is refused by another.
const VIEWER_ROLES = [
  "super_admin", "admin", "ceo", "coo", "manager", "process_manager",
  "operations_manager", "branch_head", "qa", "quality_analyst", "tq_head",
];

/**
 * One aggregate query per grain.
 *
 * Attendance, exits and KPI actuals are joined as pre-aggregated subqueries
 * keyed on employee rather than joined row-by-row: attendance_daily_record alone
 * holds ~98k rows for a single quarter, and a direct join would multiply every
 * employee by their attendance days before grouping, inflating headcount.
 */
function buildAggregateSql(groupBy: "process" | "manager" | "agent", scopeSql: string) {
  const groupCol =
    groupBy === "process" ? "e.process_id"
    : groupBy === "manager" ? "e.reporting_manager_id"
    : "e.id";

  const nameCol =
    groupBy === "process" ? "pm.process_name"
    : groupBy === "manager" ? "mgr.full_name"
    : "e.full_name";

  const subtitleCol =
    groupBy === "process" ? "pm.process_code"
    : groupBy === "manager" ? "mgr.employee_code"
    : "e.employee_code";

  return `
    SELECT
      ${groupCol}                                   AS group_id,
      ${nameCol}                                    AS group_name,
      ${subtitleCol}                                AS group_subtitle,
      COUNT(DISTINCT e.id)                          AS headcount,
      COUNT(DISTINCT CASE WHEN e.reporting_manager_id IS NOT NULL
                          THEN e.reporting_manager_id END) AS manager_count,
      COALESCE(SUM(att.present_days), 0)            AS present_days,
      COALESCE(SUM(att.late_days), 0)               AS late_days,
      COALESCE(SUM(att.absent_days), 0)             AS absent_days,
      COALESCE(SUM(att.half_days), 0)               AS half_days,
      COALESCE(SUM(att.leave_days), 0)              AS leave_days,
      COALESCE(SUM(att.total_days), 0)              AS total_days,
      COUNT(DISTINCT CASE WHEN e.date_of_exit BETWEEN ? AND ? THEN e.id END) AS exits,
      AVG(q.quality_score)                          AS quality_score,
      AVG(o.aht)                                    AS aht
    FROM employees e
    LEFT JOIN process_master pm ON pm.id = e.process_id
    LEFT JOIN employees mgr     ON mgr.id = e.reporting_manager_id
    LEFT JOIN (
      SELECT a.employee_id,
             SUM(a.attendance_status = 'present')        AS present_days,
             -- Numerator and denominator must agree: late_mark is also set on
             -- absent / half_day / missing_punch rows, so counting every late
             -- mark over present days alone produced percentages above 100
             -- (232% for one process). A late arrival is only meaningful on a
             -- day the person actually attended.
             SUM(a.attendance_status = 'present' AND a.late_mark = 1) AS late_days,
             SUM(a.attendance_status = 'absent')         AS absent_days,
             SUM(a.attendance_status = 'half_day')       AS half_days,
             SUM(a.attendance_status = 'leave_approved') AS leave_days,
             COUNT(*)                                    AS total_days
        FROM attendance_daily_record a
       WHERE a.record_date BETWEEN ? AND ?
       GROUP BY a.employee_id
    ) att ON att.employee_id = e.id
    LEFT JOIN (
      SELECT k.employee_id, AVG(k.actual_value) AS quality_score
        FROM kpi_daily_actual k
        JOIN kpi_metric_master m ON m.id = k.metric_id AND m.metric_code = 'QUALITY_SCORE'
       WHERE k.score_date BETWEEN ? AND ?
       GROUP BY k.employee_id
    ) q ON q.employee_id = e.id
    LEFT JOIN (
      SELECT k.employee_id, AVG(k.actual_value) AS aht
        FROM kpi_daily_actual k
        JOIN kpi_metric_master m ON m.id = k.metric_id AND m.metric_code = 'AHT'
       WHERE k.score_date BETWEEN ? AND ?
       GROUP BY k.employee_id
    ) o ON o.employee_id = e.id
    WHERE e.active_status = 1
      AND ${groupCol} IS NOT NULL
      AND (${scopeSql})
  `;
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 10000) / 100;
}

/** Turns one aggregate row into the section cells the UI renders. */
function toSections(r: RowDataPacket): SectionValue[] {
  const presentDays = Number(r.present_days ?? 0);
  const totalDays = Number(r.total_days ?? 0);
  const headcount = Number(r.headcount ?? 0);

  // Shrinkage = time lost against time scheduled. A half day is counted as half,
  // which is what makes it comparable with a full absence.
  const lost = Number(r.absent_days ?? 0) + Number(r.leave_days ?? 0) + Number(r.half_days ?? 0) / 2;

  const sec = (
    key: SectionKey,
    label: string,
    unit: SectionValue["unit"],
    value: number | null,
    direction: SectionValue["direction"],
    note?: string,
  ): SectionValue => {
    const notTracked = NOT_TRACKED[key];
    const availability: Availability = notTracked ? "not_tracked" : value === null ? "no_data" : "ok";
    return {
      key, label, unit,
      value: availability === "ok" ? value : null,
      availability,
      note: notTracked ?? (availability === "no_data" ? note ?? "No records in this period." : undefined),
      direction,
      hasRootCause: availability === "ok" && ROOT_CAUSE_AVAILABILITY[key],
    };
  };

  return [
    sec("headcount", "Headcount", "count", headcount || null, "higher_is_better"),
    sec("mandate", "Mandate", "count", null, null),
    sec("buffer", "Buffer", "count", null, null),
    sec("shrinkage", "Shrinkage", "percent", pct(lost, totalDays), "lower_is_better"),
    sec("attrition", "Attrition", "percent", headcount ? pct(Number(r.exits ?? 0), headcount) : null, "lower_is_better"),
    sec("quality", "Quality", "percent",
      r.quality_score == null ? null : Math.round(Number(r.quality_score) * 100) / 100,
      "higher_is_better", "No QA audits recorded for this group in the period."),
    sec("operations", "Operations (AHT)", "seconds",
      r.aht == null ? null : Math.round(Number(r.aht)),
      "lower_is_better", "No dialler activity recorded for this group in the period."),
    sec("hygiene", "Hygiene", "percent", null, null),
    sec("late_comers", "Late Comers %", "percent", pct(Number(r.late_days ?? 0), presentDays), "lower_is_better"),
    sec("pnl", "P&L", "currency", null, null, "Process P&L is served by the Process P&L module."),
  ];
}

async function fetchRows(
  userId: string,
  grain: Grain,
  filters: PerfFilters,
): Promise<PerformanceRow[]> {
  const scope = await employeeScope(userId, VIEWER_ROLES);
  // A caller with no resolvable scope gets 1=0 from buildScopeWhereClause, which
  // returns zero rows rather than leaking another manager's numbers.
  const groupBy = grain === "process" ? "process" : grain === "manager" ? "manager" : "agent";

  const extra: string[] = [];
  const extraParams: unknown[] = [];
  // Narrowing by process/manager is applied in SQL, never in JS after the fact:
  // filtering client-side would mean the wider result set was already fetched.
  if (filters.processId) { extra.push("e.process_id = ?"); extraParams.push(filters.processId); }
  if (filters.managerId) { extra.push("e.reporting_manager_id = ?"); extraParams.push(filters.managerId); }

  const sql = `${buildAggregateSql(groupBy, scope.sql)}
    ${extra.length ? `AND ${extra.join(" AND ")}` : ""}
    GROUP BY group_id, group_name, group_subtitle
    HAVING headcount > 0
    ORDER BY headcount DESC
    LIMIT 200`;

  const params = [
    filters.from, filters.to,   // exits window
    filters.from, filters.to,   // attendance window
    filters.from, filters.to,   // quality window
    filters.from, filters.to,   // operations window
    ...scope.params,
    ...extraParams,
  ];

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows.map((r) => ({
    grain,
    id: String(r.group_id),
    name: String(r.group_name ?? "Unnamed"),
    subtitle: r.group_subtitle ? String(r.group_subtitle) : null,
    childCount: grain === "process" ? Number(r.manager_count ?? 0) : null,
    sections: toSections(r),
  }));
}

export const getProcessRows = (userId: string, f: PerfFilters) => fetchRows(userId, "process", f);
export const getManagerRows = (userId: string, f: PerfFilters) => fetchRows(userId, "manager", f);
export const getAgentRows = (userId: string, f: PerfFilters) => fetchRows(userId, "agent", f);

export interface MetricDetail {
  section: SectionKey;
  label: string;
  availability: Availability;
  trend: Array<{ period: string; value: number | null }>;
  rootCause: Array<{ label: string; value: number; share: number }> | null;
  rootCauseNote: string | null;
  records: Array<{ id: string; name: string; subtitle: string | null; value: number | null }>;
}

/**
 * Trend, root cause and drill-down records for one KPI cell.
 *
 * rootCause is null -- not an empty array -- wherever the schema cannot
 * categorise the cause, so the UI can hide the tab rather than render an empty
 * chart that implies "no causes found".
 */
export async function getMetricDetail(
  userId: string,
  section: SectionKey,
  filters: PerfFilters,
): Promise<MetricDetail> {
  const scope = await employeeScope(userId, VIEWER_ROLES);
  const label = ({
    headcount: "Headcount", shrinkage: "Shrinkage", attrition: "Attrition",
    quality: "Quality", operations: "Operations (AHT)", late_comers: "Late Comers %",
    mandate: "Mandate", buffer: "Buffer", hygiene: "Hygiene", pnl: "P&L",
  } as Record<SectionKey, string>)[section];

  if (NOT_TRACKED[section]) {
    return {
      section, label, availability: "not_tracked",
      trend: [], rootCause: null,
      rootCauseNote: NOT_TRACKED[section],
      records: [],
    };
  }

  const narrow: string[] = [];
  const narrowParams: unknown[] = [];
  if (filters.processId) { narrow.push("e.process_id = ?"); narrowParams.push(filters.processId); }
  if (filters.managerId) { narrow.push("e.reporting_manager_id = ?"); narrowParams.push(filters.managerId); }
  const narrowSql = narrow.length ? `AND ${narrow.join(" AND ")}` : "";

  // ── Trend: month by month across the requested window ────────────────────
  const trendExpr =
    section === "late_comers"
      ? "ROUND(100 * SUM(a.attendance_status = 'present' AND a.late_mark = 1) / NULLIF(SUM(a.attendance_status = 'present'), 0), 2)"
      : section === "shrinkage"
      ? "ROUND(100 * (SUM(a.attendance_status='absent') + SUM(a.attendance_status='leave_approved') + SUM(a.attendance_status='half_day')/2) / NULLIF(COUNT(*), 0), 2)"
      : section === "headcount"
      ? "COUNT(DISTINCT a.employee_id)"
      : null;

  let trend: MetricDetail["trend"] = [];
  if (trendExpr) {
    const [tr] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(a.record_date, '%Y-%m') AS period, ${trendExpr} AS value
         FROM attendance_daily_record a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.record_date BETWEEN ? AND ?
          AND e.active_status = 1
          AND (${scope.sql}) ${narrowSql}
        GROUP BY period ORDER BY period ASC`,
      [filters.from, filters.to, ...scope.params, ...narrowParams],
    );
    trend = tr.map((r) => ({ period: String(r.period), value: r.value == null ? null : Number(r.value) }));
  } else if (section === "quality" || section === "operations") {
    const code = section === "quality" ? "QUALITY_SCORE" : "AHT";
    const [tr] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(k.score_date, '%Y-%m') AS period, ROUND(AVG(k.actual_value), 2) AS value
         FROM kpi_daily_actual k
         JOIN kpi_metric_master m ON m.id = k.metric_id AND m.metric_code = ?
         JOIN employees e ON e.id = k.employee_id
        WHERE k.score_date BETWEEN ? AND ?
          AND e.active_status = 1
          AND (${scope.sql}) ${narrowSql}
        GROUP BY period ORDER BY period ASC`,
      [code, filters.from, filters.to, ...scope.params, ...narrowParams],
    );
    trend = tr.map((r) => ({ period: String(r.period), value: r.value == null ? null : Number(r.value) }));
  }

  // ── Root cause: only where the schema genuinely categorises it ───────────
  let rootCause: MetricDetail["rootCause"] = null;
  let rootCauseNote: string | null = null;

  if (section === "shrinkage" || section === "late_comers" || section === "headcount") {
    const [rc] = await db.execute<RowDataPacket[]>(
      `SELECT a.attendance_status AS label, COUNT(*) AS value
         FROM attendance_daily_record a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.record_date BETWEEN ? AND ?
          AND e.active_status = 1
          AND (${scope.sql}) ${narrowSql}
        GROUP BY a.attendance_status ORDER BY value DESC`,
      [filters.from, filters.to, ...scope.params, ...narrowParams],
    );
    const total = rc.reduce((a, r) => a + Number(r.value), 0);
    rootCause = total
      ? rc.map((r) => ({
          label: String(r.label),
          value: Number(r.value),
          share: Math.round((Number(r.value) / total) * 10000) / 100,
        }))
      : null;
    if (!rootCause) rootCauseNote = "No attendance records in this period.";
  } else if (section === "attrition") {
    // Deliberate: `employees` has date_of_exit / resignation_date only, with no
    // categorised exit reason anywhere, so there is nothing truthful to break
    // this down by. The count above is real; the reasons are not recorded.
    rootCauseNote = "Exit reasons are not categorised in the system yet, so no breakdown can be shown.";
  } else {
    rootCauseNote = "This metric does not carry a categorised cause in the source data.";
  }

  // ── Records: the drill-down list, one row per employee in scope ──────────
  const recordExpr =
    section === "late_comers"
      ? "ROUND(100 * SUM(a.attendance_status='present' AND a.late_mark = 1) / NULLIF(SUM(a.attendance_status='present'), 0), 2)"
      : section === "shrinkage"
      ? "ROUND(100 * (SUM(a.attendance_status='absent') + SUM(a.attendance_status='leave_approved') + SUM(a.attendance_status='half_day')/2) / NULLIF(COUNT(*), 0), 2)"
      : "COUNT(*)";

  const [recs] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.full_name AS name, e.employee_code AS subtitle, ${recordExpr} AS value
       FROM attendance_daily_record a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.record_date BETWEEN ? AND ?
        AND e.active_status = 1
        AND (${scope.sql}) ${narrowSql}
      GROUP BY e.id, e.full_name, e.employee_code
      ORDER BY value DESC
      LIMIT 100`,
    [filters.from, filters.to, ...scope.params, ...narrowParams],
  );

  return {
    section, label,
    availability: trend.length || recs.length ? "ok" : "no_data",
    trend,
    rootCause,
    rootCauseNote,
    records: recs.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "Unknown"),
      subtitle: r.subtitle ? String(r.subtitle) : null,
      value: r.value == null ? null : Number(r.value),
    })),
  };
}
