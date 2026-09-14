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
 * effective-dated, but it holds ZERO rows today. The sections asked for here
 * mostly do not live in the KPI pipeline at all -- they come from `employees`,
 * `attendance_daily_record`, `cost_centre_master`,
 * `attendance_reconciliation_issue` and `pnl_running_salary_snapshot`.
 *
 * The honesty rule this module exists to enforce: a section either returns a
 * number computed from real rows, or it returns availability:'not_tracked' /
 * 'no_data'. There is no third path. Nothing here fabricates a value, and
 * root-cause breakdowns are only offered where the database genuinely
 * categorises the cause.
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

const SECTION_LABELS: Record<SectionKey, string> = {
  headcount: "Headcount",
  mandate: "Mandate",
  buffer: "Buffer",
  shrinkage: "Shrinkage",
  attrition: "Attrition",
  quality: "Quality",
  operations: "Operations (AHT)",
  hygiene: "Hygiene",
  late_comers: "Late Comers %",
  pnl: "People Cost",
};

/**
 * Mandate and Buffer are properties of a COST CENTRE, not of a person.
 *
 * `cost_centre_master.mandated_seats` is contracted seats for a cost centre; a
 * process is reported as the sum over the distinct cost centres its people sit
 * in. Splitting that figure across managers or agents would be an allocation
 * nobody has agreed, so below process grain these two say so rather than show a
 * made-up share.
 */
const PROCESS_GRAIN_ONLY: SectionKey[] = ["mandate", "buffer"];
const BELOW_PROCESS_NOTE =
  "Mandate is contracted per cost centre, so it is reported at process level only.";

/**
 * The 20 assessed parameters on `db_audit.call_quality_assessment`.
 *
 * 1 = met, 0 = failed, NULL = not applicable to that call. The NULL is why a
 * fail rate divides by `IS NOT NULL` rather than by the row count: live, 5,840
 * of August's 13,513 calls simply were not assessed on professionalism, and
 * scoring those as passes would flatter every agent who never handled a call
 * where it applied.
 */
const QUALITY_PARAMS = [
  "call_answered_within_5_seconds", "customer_concern_acknowledged", "professionalism_maintained",
  "assurance_or_appreciation_provided", "pronunciation_and_clarity", "enthusiasm_and_no_fumbling",
  "active_listening", "politeness_and_no_sarcasm", "proper_grammar", "accurate_issue_probing",
  "proper_hold_procedure", "proper_transfer_and_language", "dead_air_under_10_seconds",
  "case_escalated_correctly", "address_recorded_completely", "correct_and_complete_information",
  "upselling_or_offers_suggested", "further_assistance_offered", "proper_call_closure",
  "express_empathy",
] as const;

/**
 * Which sections can show a real root-cause breakdown.
 *
 * Attrition is deliberately false: `employees` carries only date_of_exit,
 * resignation_date and previous_exit_date -- there is NO categorised exit-reason
 * column, so any "why people left" split would be invented. The exit count
 * itself is real and is still shown.
 *
 * Operations is false because kpi_daily_actual's AHT rows carry a duration and
 * no failure category. Quality IS true, because the call audit scores each of
 * the 20 parameters above separately -- "which parameter is failing" is recorded
 * data, not an inference.
 */
const ROOT_CAUSE_AVAILABILITY: Record<SectionKey, boolean> = {
  headcount: false,
  late_comers: true,
  shrinkage: true,
  hygiene: true,
  attrition: false,
  quality: true,
  operations: false,
  mandate: true,
  buffer: true,
  pnl: true,
};

export interface PerfFilters {
  from: string;
  to: string;
  processId?: string | null;
  managerId?: string | null;
  employeeId?: string | null;
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

/** 'YYYY-MM-DD' -> 'YYYY-MM', the grain `pnl_running_salary_snapshot.period_code` uses. */
const toPeriod = (d: string) => d.slice(0, 7);

/**
 * `cost_centre_master.mandated_seats` is a VARCHAR holding "4", "0", "" and "NA".
 * Anything that is not a plain number is absent data, not zero.
 */
const NUMERIC_SEATS = "CASE WHEN c.mandated_seats REGEXP '^[0-9]+([.][0-9]+)?$' THEN c.mandated_seats + 0 ELSE NULL END";

function groupColumns(groupBy: Grain) {
  return {
    groupCol:
      groupBy === "process" ? "e.process_id"
      : groupBy === "manager" ? "e.reporting_manager_id"
      : "e.id",
    nameCol:
      groupBy === "process" ? "pm.process_name"
      : groupBy === "manager" ? "mgr.full_name"
      : "e.full_name",
    subtitleCol:
      groupBy === "process" ? "pm.process_code"
      : groupBy === "manager" ? "mgr.employee_code"
      : "e.employee_code",
  };
}

/**
 * One aggregate query per grain.
 *
 * Attendance, hygiene, cost and KPI actuals are joined as pre-aggregated
 * subqueries keyed on employee rather than joined row-by-row:
 * attendance_daily_record alone holds ~98k rows for a single quarter, and a
 * direct join would multiply every employee by their attendance days before
 * grouping, inflating headcount.
 */
function buildAggregateSql(groupBy: Grain, scopeSql: string) {
  const { groupCol, nameCol, subtitleCol } = groupColumns(groupBy);

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
      COALESCE(SUM(att.missing_punch_days), 0)      AS missing_punch_days,
      COALESCE(SUM(att.off_days), 0)                AS off_days,
      COALESCE(SUM(att.total_days), 0)              AS total_days,
      COALESCE(SUM(hyg.issue_days), 0)              AS issue_days,
      COALESCE(SUM(hyg.missing_adr_days), 0)        AS missing_adr_days,
      SUM(cost.people_cost)                         AS people_cost,
      -- Weighted by volume, NOT a mean of per-person means: an agent audited on
      -- 4 calls must not move the process score as far as one audited on 400.
      -- It is also what makes this cell agree with the drill-down behind it,
      -- which averages the underlying rows directly.
      SUM(q.quality_sum) / NULLIF(SUM(q.audited_calls), 0) AS quality_score,
      COALESCE(SUM(q.audited_calls), 0)             AS audited_calls,
      SUM(o.aht_sum) / NULLIF(SUM(o.aht_days), 0)   AS aht
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
             -- An unresolved missing punch is unpaid and unworked, so it is lost
             -- capacity exactly like an absence. Live it is 13% of all rows and
             -- 34% for one process; excluding it understated shrinkage badly.
             SUM(a.attendance_status = 'missing_punch')  AS missing_punch_days,
             -- Week offs and holidays were never scheduled, so they belong in
             -- neither the numerator nor the denominator of shrinkage.
             SUM(a.attendance_status IN ('week_off', 'holiday')) AS off_days,
             COUNT(*)                                    AS total_days
        FROM attendance_daily_record a
       WHERE a.record_date BETWEEN ? AND ?
       GROUP BY a.employee_id
    ) att ON att.employee_id = e.id
    LEFT JOIN (
      -- Records hygiene: attendance day-slots still carrying an UNRESOLVED
      -- reconciliation issue. missing_adr is counted separately because by
      -- definition it has no attendance row, so it has to be added back to the
      -- denominator or those days would vanish from both sides.
      SELECT i.employee_id,
             COUNT(DISTINCT i.issue_date) AS issue_days,
             COUNT(DISTINCT CASE WHEN i.issue_type = 'missing_adr' THEN i.issue_date END) AS missing_adr_days
        FROM attendance_reconciliation_issue i
       WHERE i.issue_date BETWEEN ? AND ?
         AND i.resolved_at IS NULL
         AND i.employee_id IS NOT NULL
       GROUP BY i.employee_id
    ) hyg ON hyg.employee_id = e.id
    LEFT JOIN (
      SELECT s.employee_id, SUM(s.earned_salary_till_date) AS people_cost
        FROM pnl_running_salary_snapshot s
       WHERE s.period_code BETWEEN ? AND ?
       GROUP BY s.employee_id
    ) cost ON cost.employee_id = e.id
    LEFT JOIN (
      -- Quality comes from the call audit warehouse, NOT from kpi_daily_actual.
      -- Live for August: this table holds 13,513 assessed calls across 10+
      -- processes, every one of which matches an employee_code; the
      -- QUALITY_SCORE metric in kpi_daily_actual held 414 rows reaching two.
      -- mas_hrms.qa_audit is empty, so it is not the source either.
      SELECT q.User AS employee_code,
             SUM(q.quality_percentage) AS quality_sum,
             COUNT(*)                  AS audited_calls
        FROM db_audit.call_quality_assessment q
       -- CallDate is a DATETIME: BETWEEN would stop at 00:00 and silently drop
       -- the whole of the last day in the window.
       WHERE q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
         AND q.User IS NOT NULL AND q.User <> ''
       GROUP BY q.User
    ) q ON q.employee_code = e.employee_code
    LEFT JOIN (
      SELECT k.employee_id,
             SUM(k.actual_value) AS aht_sum,
             COUNT(*)            AS aht_days
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

/**
 * Did the engines behind these metrics actually run in this window?
 *
 * Live, late_mark is set on ZERO of the 18,159 April and 20,967 May attendance
 * rows, and attendance_reconciliation_issue holds nothing before July. Reporting
 * those as "0% late" and "100% hygiene" is worse than reporting nothing: a
 * flattering number that says the rule never ran. Both sections are therefore
 * gated on evidence that the producing engine wrote anything at all.
 */
export interface Coverage {
  lateMarking: boolean;
  reconciliation: boolean;
  exitsPosted: boolean;
  /** Latest exit recorded anywhere, so the note can say how stale the feed is. */
  lastExitOn: string | null;
}

async function fetchCoverage(filters: PerfFilters): Promise<Coverage> {
  // Unscoped on purpose: this asks whether the ENGINE ran, which is a property
  // of the period, not of the caller's slice of it.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM attendance_daily_record
         WHERE record_date BETWEEN ? AND ? AND late_mark = 1)      AS late_marks,
       (SELECT COUNT(*) FROM attendance_reconciliation_issue
         WHERE issue_date BETWEEN ? AND ?)                         AS issues,
       (SELECT COUNT(*) FROM employees
         WHERE COALESCE(date_of_exit, resignation_date) BETWEEN ? AND ?) AS exits,
       (SELECT DATE_FORMAT(MAX(COALESCE(date_of_exit, resignation_date)), '%Y-%m-%d')
          FROM employees)                                          AS last_exit`,
    [filters.from, filters.to, filters.from, filters.to, filters.from, filters.to],
  );
  const r = rows[0] ?? {};
  return {
    lateMarking: Number(r.late_marks ?? 0) > 0,
    reconciliation: Number(r.issues ?? 0) > 0,
    exitsPosted: Number(r.exits ?? 0) > 0,
    lastExitOn: r.last_exit ? String(r.last_exit) : null,
  };
}

const NOT_RUN_NOTE = {
  lateMarking: "Late marking was not applied to attendance in this period, so there is no late data to report.",
  reconciliation: "Attendance reconciliation did not run in this period, so records hygiene cannot be scored.",
};

/**
 * Zero exits ACROSS THE WHOLE SYSTEM for a month is a stale feed, not a month
 * nobody left. Live, the exit dates stop on 29 July while July itself recorded
 * 163 exits -- so August scored 0% attrition for all 39 processes, which reads
 * as perfect retention. The note carries the last recorded exit so the reader
 * can see how far behind the source is.
 */
const staleExitsNote = (lastExitOn: string | null) =>
  `No exit is recorded anywhere in the system for this period${
    lastExitOn ? `; the most recent exit on file is ${lastExitOn}` : ""
  }. That is a gap in the exit records, not a month without leavers.`;

interface RowContext {
  grain: Grain;
  /** Exits in the window for this group, counted OUTSIDE the active-employee filter. */
  exits: number | null;
  /** Contracted seats for this group, process grain only. */
  mandate: number | null;
  coverage: Coverage;
}

/** Turns one aggregate row plus its out-of-band context into the cells the UI renders. */
function toSections(r: RowDataPacket, ctx: RowContext): SectionValue[] {
  const presentDays = Number(r.present_days ?? 0);
  const totalDays = Number(r.total_days ?? 0);
  const offDays = Number(r.off_days ?? 0);
  const headcount = Number(r.headcount ?? 0);

  // Shrinkage = time lost against time SCHEDULED. Week offs and holidays were
  // never scheduled, so they come out of the denominator; a half day is counted
  // as half, which is what makes it comparable with a full absence.
  const scheduledDays = Math.max(totalDays - offDays, 0);
  const lost =
    Number(r.absent_days ?? 0) +
    Number(r.leave_days ?? 0) +
    Number(r.missing_punch_days ?? 0) +
    Number(r.half_days ?? 0) / 2;

  // Hygiene = share of day-slots with no unresolved reconciliation issue.
  const issueDays = Number(r.issue_days ?? 0);
  const missingAdrDays = Number(r.missing_adr_days ?? 0);
  const hygieneSlots = totalDays + missingAdrDays;
  const cleanDays = Math.max(hygieneSlots - issueDays, 0);

  const mandate = ctx.mandate;
  const exits = ctx.exits;
  const peopleCost = r.people_cost == null ? null : Number(r.people_cost);

  const sec = (
    key: SectionKey,
    unit: SectionValue["unit"],
    value: number | null,
    direction: SectionValue["direction"],
    note?: string,
  ): SectionValue => {
    const belowProcess = ctx.grain !== "process" && PROCESS_GRAIN_ONLY.includes(key);
    const availability: Availability =
      belowProcess ? "not_tracked" : value === null ? "no_data" : "ok";
    return {
      key,
      label: SECTION_LABELS[key],
      unit,
      value: availability === "ok" ? value : null,
      availability,
      note: belowProcess
        ? BELOW_PROCESS_NOTE
        : availability === "no_data" ? note ?? "No records in this period." : undefined,
      direction,
      hasRootCause: availability === "ok" && ROOT_CAUSE_AVAILABILITY[key],
    };
  };

  return [
    sec("headcount", "count", headcount || null, "higher_is_better"),
    sec("mandate", "count", mandate, null,
      "No cost centre in this group carries a contracted seat count."),
    // Buffer is the real surplus (or, negative, the shortfall) of people against
    // contracted seats. Both sides are counted figures, so the difference is too.
    sec("buffer", "count", mandate == null ? null : headcount - mandate, null,
      "Needs a contracted seat count to compare headcount against."),
    sec("shrinkage", "percent", pct(lost, scheduledDays), "lower_is_better",
      "No scheduled attendance days for this group in the period."),
    // Attrition is exits over the population that was present during the window
    // (those still active, plus those who left). Dividing by the surviving
    // headcount alone would push the figure above 100% for a small team.
    sec("attrition", "percent",
      ctx.coverage.exitsPosted && exits != null ? pct(exits, headcount + exits) : null,
      "lower_is_better",
      ctx.coverage.exitsPosted
        ? "No exits or headcount recorded for this group in the period."
        : staleExitsNote(ctx.coverage.lastExitOn)),
    sec("quality", "percent",
      r.quality_score == null ? null : Math.round(Number(r.quality_score) * 100) / 100,
      "higher_is_better", "No call was audited for this group in the period."),
    sec("operations", "seconds",
      r.aht == null ? null : Math.round(Number(r.aht)),
      "lower_is_better", "No dialler activity recorded for this group in the period."),
    sec("hygiene", "percent",
      ctx.coverage.reconciliation ? pct(cleanDays, hygieneSlots) : null,
      "higher_is_better",
      ctx.coverage.reconciliation
        ? "No attendance day-slots for this group in the period."
        : NOT_RUN_NOTE.reconciliation),
    sec("late_comers", "percent",
      ctx.coverage.lateMarking ? pct(Number(r.late_days ?? 0), presentDays) : null,
      "lower_is_better",
      ctx.coverage.lateMarking
        ? "Nobody in this group attended a day in the period."
        : NOT_RUN_NOTE.lateMarking),
    sec("pnl", "currency", peopleCost == null ? null : Math.round(peopleCost), null,
      "No running-salary snapshot exists for this period. It is written by the Process P&L module's refresh, which has no scheduler -- it only runs when someone triggers it, so open months stay blank until then."),
  ];
}

/** Narrowing that applies on top of the caller's scope, never instead of it. */
function narrowing(filters: PerfFilters) {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (filters.processId) { sql.push("e.process_id = ?"); params.push(filters.processId); }
  if (filters.managerId) { sql.push("e.reporting_manager_id = ?"); params.push(filters.managerId); }
  if (filters.employeeId) { sql.push("e.id = ?"); params.push(filters.employeeId); }
  return { sql: sql.length ? `AND ${sql.join(" AND ")}` : "", params };
}

/**
 * Exits, counted OUTSIDE the active-employee filter.
 *
 * This is why attrition needs its own query: a leaver has active_status = 0, so
 * counting exits inside the main aggregate's `WHERE e.active_status = 1` scored
 * every process at exactly 0% attrition for every month in the system. Live,
 * 100% of the 1,202 exits between January and May 2026 are inactive rows.
 */
async function fetchExits(
  grain: Grain,
  scope: { sql: string; params: unknown[] },
  filters: PerfFilters,
): Promise<Map<string, number>> {
  const { groupCol } = groupColumns(grain);
  const narrow = narrowing(filters);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${groupCol} AS group_id, COUNT(*) AS exits
       FROM employees e
      WHERE COALESCE(e.date_of_exit, e.resignation_date) BETWEEN ? AND ?
        AND ${groupCol} IS NOT NULL
        AND (${scope.sql}) ${narrow.sql}
      GROUP BY group_id`,
    [filters.from, filters.to, ...scope.params, ...narrow.params],
  );
  return new Map(rows.map((r) => [String(r.group_id), Number(r.exits ?? 0)]));
}

/**
 * Contracted seats per process.
 *
 * Deduplicated to one row per (process, cost centre) BEFORE summing: seats are a
 * property of the cost centre, so summing across employees would multiply the
 * mandate by the headcount sitting in it.
 */
async function fetchMandate(
  scope: { sql: string; params: unknown[] },
  filters: PerfFilters,
): Promise<Map<string, number>> {
  const narrow = narrowing(filters);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.group_id, SUM(g.seats) AS mandate
       FROM (
         SELECT DISTINCT e.process_id AS group_id, e.cost_centre_id, ${NUMERIC_SEATS} AS seats
           FROM employees e
           JOIN cost_centre_master c ON c.id = e.cost_centre_id
          WHERE e.active_status = 1
            AND e.process_id IS NOT NULL
            AND (${scope.sql}) ${narrow.sql}
       ) g
      WHERE g.seats IS NOT NULL
      GROUP BY g.group_id`,
    [...scope.params, ...narrow.params],
  );
  return new Map(rows.map((r) => [String(r.group_id), Number(r.mandate ?? 0)]));
}

async function fetchRows(
  userId: string,
  grain: Grain,
  filters: PerfFilters,
): Promise<PerformanceRow[]> {
  const scope = await employeeScope(userId, VIEWER_ROLES);
  // A caller with no resolvable scope gets 1=0 from buildScopeWhereClause, which
  // returns zero rows rather than leaking another manager's numbers.
  const narrow = narrowing(filters);

  const sql = `${buildAggregateSql(grain, scope.sql)}
    ${narrow.sql}
    GROUP BY group_id, group_name, group_subtitle
    HAVING headcount > 0
    ORDER BY headcount DESC
    LIMIT 200`;

  const params = [
    filters.from, filters.to,                       // attendance window
    filters.from, filters.to,                       // hygiene window
    toPeriod(filters.from), toPeriod(filters.to),   // people-cost periods
    filters.from, filters.to,                       // quality window
    filters.from, filters.to,                       // operations window
    ...scope.params,
    ...narrow.params,
  ];

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  const exits = await fetchExits(grain, scope, filters);
  const coverage = await fetchCoverage(filters);
  const mandate = grain === "process"
    ? await fetchMandate(scope, filters)
    : new Map<string, number>();

  return rows.map((r) => {
    const id = String(r.group_id);
    return {
      grain,
      id,
      name: String(r.group_name ?? "Unnamed"),
      subtitle: r.group_subtitle ? String(r.group_subtitle) : null,
      childCount: grain === "process" ? Number(r.manager_count ?? 0) : null,
      sections: toSections(r, {
        grain,
        coverage,
        exits: exits.get(id) ?? 0,
        mandate: grain === "process" ? mandate.get(id) ?? null : null,
      }),
    };
  });
}

export const getProcessRows = (userId: string, f: PerfFilters) => fetchRows(userId, "process", f);
export const getManagerRows = (userId: string, f: PerfFilters) => fetchRows(userId, "manager", f);
export const getAgentRows = (userId: string, f: PerfFilters) => fetchRows(userId, "agent", f);

export interface FilterOptions {
  processes: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; name: string }>;
}

/**
 * The two pickers at the top of the page, from the SAME scope the table uses.
 *
 * They used to be fed by /api/processes/my-processes, which reads
 * user_assignment_scope. Live that table grants a process to 10 users in the
 * whole system, so every admin, CEO and COO -- exactly the roles this page is
 * built for -- saw an empty Process picker, which in turn left the Manager
 * picker permanently disabled, while the table below listed all 39 processes.
 * Deriving both lists from the same predicate makes the picker and the table
 * incapable of disagreeing.
 */
export async function getFilterOptions(userId: string, filters: PerfFilters): Promise<FilterOptions> {
  const scope = await employeeScope(userId, VIEWER_ROLES);

  const [procRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.process_id AS id, pm.process_name AS name
       FROM employees e
       JOIN process_master pm ON pm.id = e.process_id
      WHERE e.active_status = 1
        AND (${scope.sql})
      ORDER BY name ASC`,
    [...scope.params],
  );

  // Managers are listed WITHOUT requiring a process, and narrowed by one when
  // given: picking a manager first is a legitimate way to use this page.
  const mgrNarrow = filters.processId ? "AND e.process_id = ?" : "";
  const mgrParams = filters.processId ? [filters.processId] : [];
  const [mgrRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.reporting_manager_id AS id,
            COALESCE(mgr.full_name, 'Unnamed') AS name
       FROM employees e
       JOIN employees mgr ON mgr.id = e.reporting_manager_id
      WHERE e.active_status = 1
        AND e.reporting_manager_id IS NOT NULL
        AND (${scope.sql}) ${mgrNarrow}
      ORDER BY name ASC`,
    [...scope.params, ...mgrParams],
  );

  return {
    processes: procRows.map((r) => ({ id: String(r.id), name: String(r.name) })),
    managers: mgrRows.map((r) => ({ id: String(r.id), name: String(r.name) })),
  };
}

export interface DetailRecord {
  id: string;
  name: string;
  subtitle: string | null;
  value: number | null;
  /** Which filter the id belongs to, so the UI drills to the right level (null = leaf). */
  drillAs: "manager" | "employee" | null;
}

export interface MetricDetail {
  section: SectionKey;
  label: string;
  availability: Availability;
  unit: SectionValue["unit"];
  trend: Array<{ period: string; value: number | null }>;
  rootCause: Array<{ label: string; value: number; share: number }> | null;
  rootCauseNote: string | null;
  recordsLabel: string;
  records: DetailRecord[];
}

const share = (rows: Array<{ label: string; value: number }>) => {
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (!total) return null;
  return rows.map((r) => ({ ...r, share: Math.round((r.value / total) * 10000) / 100 }));
};

/**
 * Trend, root cause and drill-down records for one KPI cell.
 *
 * Every section reads its OWN source. Previously the record list was hard-wired
 * to attendance for all ten sections, so opening a Quality cell listed each
 * person's attendance-day count under a "Quality" heading -- a real number
 * answering a different question, which is worse than no number.
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
  const label = SECTION_LABELS[section];
  const narrow = narrowing(filters);
  const unit: SectionValue["unit"] =
    section === "pnl" ? "currency"
    : section === "operations" ? "seconds"
    : section === "headcount" || section === "mandate" || section === "buffer" ? "count"
    : "percent";

  // Below process grain the record list is people, not managers, so drilling one
  // more level would filter a person as if they were a manager and return
  // nothing. The list is a leaf there.
  const drillAs: DetailRecord["drillAs"] =
    filters.employeeId ? null : filters.managerId ? "employee" : "manager";

  const base: MetricDetail = {
    section, label, availability: "no_data", unit,
    trend: [], rootCause: null, rootCauseNote: null,
    recordsLabel: drillAs === "manager" ? "Managers" : "Employees",
    records: [],
  };

  // The same coverage gate the table applies, so opening a cell can never
  // contradict the number (or the absence of one) that was clicked.
  if (section === "hygiene" || section === "late_comers" || section === "attrition") {
    const coverage = await fetchCoverage(filters);
    const ran =
      section === "hygiene" ? coverage.reconciliation
      : section === "late_comers" ? coverage.lateMarking
      : coverage.exitsPosted;
    if (!ran) {
      return {
        ...base,
        availability: "no_data",
        rootCauseNote:
          section === "hygiene" ? NOT_RUN_NOTE.reconciliation
          : section === "late_comers" ? NOT_RUN_NOTE.lateMarking
          : staleExitsNote(coverage.lastExitOn),
      };
    }
  }

  const scoped = `AND e.active_status = 1 AND (${scope.sql}) ${narrow.sql}`;
  const scopedParams = [...scope.params, ...narrow.params];
  // The list groups by manager at process grain and by person below it, so the
  // drill-down mirrors the table's own process -> manager -> agent hierarchy.
  const recordKey = drillAs === "manager"
    ? { id: "e.reporting_manager_id", name: "mgr.full_name", sub: "mgr.employee_code",
        join: "JOIN employees mgr ON mgr.id = e.reporting_manager_id" }
    : { id: "e.id", name: "e.full_name", sub: "e.employee_code", join: "" };

  // -- Mandate and Buffer: cost-centre configuration, not a time series -------
  if (section === "mandate" || section === "buffer") {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.cost_centre_id AS id, g.cc_name AS name, g.cc_code AS subtitle,
              g.seats, g.headcount
         FROM (
           SELECT DISTINCT e.cost_centre_id, c.cost_centre_name AS cc_name,
                  c.cost_centre_code AS cc_code, ${NUMERIC_SEATS} AS seats,
                  COUNT(*) OVER (PARTITION BY e.cost_centre_id) AS headcount
             FROM employees e
             JOIN cost_centre_master c ON c.id = e.cost_centre_id
            WHERE 1=1 ${scoped}
         ) g
        ORDER BY g.seats DESC
        LIMIT 100`,
      scopedParams,
    );
    const rc = rows
      .filter((r) => r.seats != null)
      .map((r) => ({ label: String(r.name ?? r.subtitle ?? "Cost centre"), value: Number(r.seats) }));
    return {
      ...base,
      availability: rows.length ? "ok" : "no_data",
      recordsLabel: "Cost centres",
      rootCause: share(rc),
      rootCauseNote: rc.length ? null : "No cost centre in this group carries a contracted seat count.",
      records: rows.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? "Unnamed cost centre"),
        subtitle: r.subtitle ? String(r.subtitle) : null,
        value: r.seats == null ? null
          : section === "mandate" ? Number(r.seats) : Number(r.headcount) - Number(r.seats),
        drillAs: null,
      })),
    };
  }

  // -- Attrition: leavers, read OUTSIDE the active-employee filter ------------
  if (section === "attrition") {
    const exitScoped = `AND (${scope.sql}) ${narrow.sql}`;
    const [tr] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(COALESCE(e.date_of_exit, e.resignation_date), '%Y-%m') AS period,
              COUNT(*) AS value
         FROM employees e
        WHERE COALESCE(e.date_of_exit, e.resignation_date) BETWEEN ? AND ?
          ${exitScoped}
        GROUP BY period ORDER BY period ASC`,
      [filters.from, filters.to, ...scope.params, ...narrow.params],
    );
    const [recs] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.full_name AS name, e.employee_code AS subtitle,
              DATEDIFF(COALESCE(e.date_of_exit, e.resignation_date), e.date_of_joining) AS value
         FROM employees e
        WHERE COALESCE(e.date_of_exit, e.resignation_date) BETWEEN ? AND ?
          ${exitScoped}
        ORDER BY value ASC
        LIMIT 100`,
      [filters.from, filters.to, ...scope.params, ...narrow.params],
    );
    return {
      ...base,
      availability: tr.length || recs.length ? "ok" : "no_data",
      unit: "count",
      trend: tr.map((r) => ({ period: String(r.period), value: Number(r.value) })),
      // Deliberate: `employees` has date_of_exit / resignation_date only, with no
      // categorised exit reason anywhere, so there is nothing truthful to break
      // this down by. The count above is real; the reasons are not recorded.
      rootCause: null,
      rootCauseNote: "Exit reasons are not categorised in the system yet, so no breakdown can be shown. Each leaver is listed below with their tenure in days.",
      recordsLabel: "Leavers (tenure in days)",
      records: recs.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? "Unknown"),
        subtitle: r.subtitle ? String(r.subtitle) : null,
        value: r.value == null ? null : Number(r.value),
        drillAs: null,
      })),
    };
  }

  // -- Quality: the call audit warehouse, with a real per-parameter cause ----
  if (section === "quality") {
    const auditJoin = `JOIN db_audit.call_quality_assessment q ON q.User = e.employee_code
      WHERE q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)`;
    const auditParams = [filters.from, filters.to, ...scopedParams];
    const [tr] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(q.CallDate, '%Y-%m') AS period, ROUND(AVG(q.quality_percentage), 2) AS value
         FROM employees e ${auditJoin} ${scoped}
        GROUP BY period ORDER BY period ASC`,
      auditParams,
    );
    // One pass over the window returns a fail count and an applicable count for
    // every parameter, so the breakdown is 20 numbers from one query rather than
    // 20 queries.
    const failCols = QUALITY_PARAMS
      .map((c) => `SUM(q.${c} = 0) AS f_${c}, SUM(q.${c} IS NOT NULL) AS n_${c}`)
      .join(", ");
    const [rcRows] = await db.execute<RowDataPacket[]>(
      `SELECT ${failCols} FROM employees e ${auditJoin} ${scoped}`,
      auditParams,
    );
    const rcRow = rcRows[0] ?? {};
    const causes = QUALITY_PARAMS
      .map((c) => ({
        label: c.replace(/_/g, " "),
        value: Number(rcRow[`f_${c}`] ?? 0),
        applicable: Number(rcRow[`n_${c}`] ?? 0),
      }))
      .filter((x) => x.applicable > 0 && x.value > 0)
      .sort((a, b) => b.value - a.value);
    const [recs] = await db.execute<RowDataPacket[]>(
      `SELECT ${recordKey.id} AS id, ${recordKey.name} AS name, ${recordKey.sub} AS subtitle,
              ROUND(AVG(q.quality_percentage), 2) AS value
         FROM employees e ${recordKey.join} ${auditJoin} ${scoped}
        GROUP BY id, name, subtitle
        ORDER BY value ASC
        LIMIT 100`,
      auditParams,
    );
    return {
      ...base,
      availability: tr.length || recs.length ? "ok" : "no_data",
      trend: tr.map((r) => ({ period: String(r.period), value: r.value == null ? null : Number(r.value) })),
      rootCause: share(causes.map(({ label, value }) => ({ label, value }))),
      rootCauseNote: causes.length
        ? null
        : "No audited call in this period failed any assessed parameter.",
      recordsLabel: `${drillAs === "manager" ? "Managers" : "Employees"} (lowest score first)`,
      records: recs.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? "Unknown"),
        subtitle: r.subtitle ? String(r.subtitle) : null,
        value: r.value == null ? null : Number(r.value),
        drillAs,
      })),
    };
  }

  // -- Operations: the KPI pipeline, not attendance --------------------------
  if (section === "operations") {
    const code = "AHT";
    const kpiJoin = `JOIN kpi_daily_actual k ON k.employee_id = e.id
       JOIN kpi_metric_master m ON m.id = k.metric_id AND m.metric_code = ?
      WHERE k.score_date BETWEEN ? AND ?`;
    const [tr] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(k.score_date, '%Y-%m') AS period, ROUND(AVG(k.actual_value), 2) AS value
         FROM employees e ${kpiJoin} ${scoped}
        GROUP BY period ORDER BY period ASC`,
      [code, filters.from, filters.to, ...scopedParams],
    );
    const [recs] = await db.execute<RowDataPacket[]>(
      `SELECT ${recordKey.id} AS id, ${recordKey.name} AS name, ${recordKey.sub} AS subtitle,
              ROUND(AVG(k.actual_value), 2) AS value
         FROM employees e ${recordKey.join} ${kpiJoin} ${scoped}
        GROUP BY id, name, subtitle
        ORDER BY value ASC
        LIMIT 100`,
      [code, filters.from, filters.to, ...scopedParams],
    );
    return {
      ...base,
      availability: tr.length || recs.length ? "ok" : "no_data",
      rootCause: null,
      rootCauseNote: `${label} is stored in kpi_daily_actual as a score with no failure category, so no cause breakdown exists in the source data.`,
      trend: tr.map((r) => ({ period: String(r.period), value: r.value == null ? null : Number(r.value) })),
      records: recs.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? "Unknown"),
        subtitle: r.subtitle ? String(r.subtitle) : null,
        value: r.value == null ? null : Number(r.value),
        drillAs,
      })),
    };
  }

  // -- People cost: the running salary snapshot, by period --------------------
  if (section === "pnl") {
    const snapJoin = `JOIN pnl_running_salary_snapshot s ON s.employee_id = e.id
      WHERE s.period_code BETWEEN ? AND ?`;
    const [tr] = await db.execute<RowDataPacket[]>(
      `SELECT s.period_code AS period, ROUND(SUM(s.earned_salary_till_date)) AS value
         FROM employees e ${snapJoin} ${scoped}
        GROUP BY period ORDER BY period ASC`,
      [toPeriod(filters.from), toPeriod(filters.to), ...scopedParams],
    );
    const [rc] = await db.execute<RowDataPacket[]>(
      `SELECT s.pnl_bucket AS label, ROUND(SUM(s.earned_salary_till_date)) AS value
         FROM employees e ${snapJoin} ${scoped}
        GROUP BY label ORDER BY value DESC`,
      [toPeriod(filters.from), toPeriod(filters.to), ...scopedParams],
    );
    const [recs] = await db.execute<RowDataPacket[]>(
      `SELECT ${recordKey.id} AS id, ${recordKey.name} AS name, ${recordKey.sub} AS subtitle,
              ROUND(SUM(s.earned_salary_till_date)) AS value
         FROM employees e ${recordKey.join} ${snapJoin} ${scoped}
        GROUP BY id, name, subtitle
        ORDER BY value DESC
        LIMIT 100`,
      [toPeriod(filters.from), toPeriod(filters.to), ...scopedParams],
    );
    const buckets = rc.map((r) => ({ label: String(r.label ?? "unclassified"), value: Number(r.value ?? 0) }));
    return {
      ...base,
      availability: tr.length || recs.length ? "ok" : "no_data",
      trend: tr.map((r) => ({ period: String(r.period), value: r.value == null ? null : Number(r.value) })),
      rootCause: share(buckets),
      rootCauseNote: buckets.length
        ? null
        : "No running-salary snapshot exists for this period; the Process P&L refresh has not been run for it.",
      records: recs.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? "Unknown"),
        subtitle: r.subtitle ? String(r.subtitle) : null,
        value: r.value == null ? null : Number(r.value),
        drillAs,
      })),
    };
  }

  // -- Hygiene: unresolved attendance reconciliation issues -------------------
  if (section === "hygiene") {
    const issueJoin = `JOIN attendance_reconciliation_issue i ON i.employee_id = e.id
      WHERE i.issue_date BETWEEN ? AND ? AND i.resolved_at IS NULL`;
    const [tr] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(i.issue_date, '%Y-%m') AS period, COUNT(DISTINCT i.id) AS value
         FROM employees e ${issueJoin} ${scoped}
        GROUP BY period ORDER BY period ASC`,
      [filters.from, filters.to, ...scopedParams],
    );
    const [rc] = await db.execute<RowDataPacket[]>(
      `SELECT i.issue_type AS label, COUNT(*) AS value
         FROM employees e ${issueJoin} ${scoped}
        GROUP BY label ORDER BY value DESC`,
      [filters.from, filters.to, ...scopedParams],
    );
    const [recs] = await db.execute<RowDataPacket[]>(
      `SELECT ${recordKey.id} AS id, ${recordKey.name} AS name, ${recordKey.sub} AS subtitle,
              COUNT(*) AS value
         FROM employees e ${recordKey.join} ${issueJoin} ${scoped}
        GROUP BY id, name, subtitle
        ORDER BY value DESC
        LIMIT 100`,
      [filters.from, filters.to, ...scopedParams],
    );
    const causes = rc.map((r) => ({ label: String(r.label), value: Number(r.value) }));
    return {
      ...base,
      availability: tr.length || recs.length ? "ok" : "no_data",
      unit: "count",
      trend: tr.map((r) => ({ period: String(r.period), value: Number(r.value) })),
      rootCause: share(causes),
      rootCauseNote: causes.length ? null : "No unresolved reconciliation issues in this period.",
      recordsLabel: `${drillAs === "manager" ? "Managers" : "Employees"} by open issues`,
      records: recs.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? "Unknown"),
        subtitle: r.subtitle ? String(r.subtitle) : null,
        value: Number(r.value ?? 0),
        drillAs,
      })),
    };
  }

  // -- Headcount, shrinkage and late comers: attendance -----------------------
  const attJoin = `JOIN attendance_daily_record a ON a.employee_id = e.id
    WHERE a.record_date BETWEEN ? AND ?`;
  const SCHEDULED = "NULLIF(SUM(a.attendance_status NOT IN ('week_off','holiday')), 0)";
  const LOST = "(SUM(a.attendance_status='absent') + SUM(a.attendance_status='leave_approved')"
    + " + SUM(a.attendance_status='missing_punch') + SUM(a.attendance_status='half_day')/2)";
  const expr =
    section === "late_comers"
      ? "ROUND(100 * SUM(a.attendance_status = 'present' AND a.late_mark = 1) / NULLIF(SUM(a.attendance_status = 'present'), 0), 2)"
      : section === "shrinkage"
      ? `ROUND(100 * ${LOST} / ${SCHEDULED}, 2)`
      : "COUNT(DISTINCT e.id)";

  const [tr] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(a.record_date, '%Y-%m') AS period, ${expr} AS value
       FROM employees e ${attJoin} ${scoped}
      GROUP BY period ORDER BY period ASC`,
    [filters.from, filters.to, ...scopedParams],
  );

  let rootCause: MetricDetail["rootCause"] = null;
  let rootCauseNote: string | null = null;
  if (section === "shrinkage" || section === "late_comers") {
    const [rc] = await db.execute<RowDataPacket[]>(
      `SELECT a.attendance_status AS label, COUNT(*) AS value
         FROM employees e ${attJoin} ${scoped}
        GROUP BY label ORDER BY value DESC`,
      [filters.from, filters.to, ...scopedParams],
    );
    rootCause = share(rc.map((r) => ({ label: String(r.label), value: Number(r.value) })));
    if (!rootCause) rootCauseNote = "No attendance records in this period.";
  } else {
    rootCauseNote = "Headcount is a count of people, not an outcome with a cause. The list below is who is in scope and how many days each attended.";
  }

  const recordExpr =
    section === "headcount"
      ? "COUNT(DISTINCT a.record_date)"
      : section === "late_comers"
      ? "ROUND(100 * SUM(a.attendance_status='present' AND a.late_mark = 1) / NULLIF(SUM(a.attendance_status='present'), 0), 2)"
      : `ROUND(100 * ${LOST} / ${SCHEDULED}, 2)`;

  const [recs] = await db.execute<RowDataPacket[]>(
    `SELECT ${recordKey.id} AS id, ${recordKey.name} AS name, ${recordKey.sub} AS subtitle,
            ${recordExpr} AS value
       FROM employees e ${recordKey.join} ${attJoin} ${scoped}
      GROUP BY id, name, subtitle
      ORDER BY value DESC
      LIMIT 100`,
    [filters.from, filters.to, ...scopedParams],
  );

  return {
    ...base,
    availability: tr.length || recs.length ? "ok" : "no_data",
    unit: section === "headcount" ? "count" : "percent",
    trend: tr.map((r) => ({ period: String(r.period), value: r.value == null ? null : Number(r.value) })),
    rootCause,
    rootCauseNote,
    recordsLabel: section === "headcount"
      ? `${drillAs === "manager" ? "Managers" : "Employees"} (days attended)`
      : base.recordsLabel,
    records: recs.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "Unknown"),
      subtitle: r.subtitle ? String(r.subtitle) : null,
      value: r.value == null ? null : Number(r.value),
      drillAs,
    })),
  };
}
