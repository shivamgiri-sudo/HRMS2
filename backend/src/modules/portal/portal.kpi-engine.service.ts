/**
 * Client Portal — KPI engine.
 *
 * Computes every client-visible KPI from the operational tables that actually hold data, replacing
 * the read path that made the portal look empty.
 *
 * ── WHY THE PORTAL WAS EMPTY ────────────────────────────────────────────────────────────────
 * Not for want of data. Verified row counts on the live database:
 *
 *     attendance_daily_record   147,000 rows spanning 2026-01 .. 2026-08
 *     leave_request              29,189 approved
 *     employees                   1,099 with employment_status = 'Active'
 *     kpi_process_config            291 real per-process targets across 97 processes
 *
 * The old path read `kpi_score`, which is per-employee and unpopulated, and decided WHICH metrics a
 * process shows by fuzzy-matching `kpi_template.template_name LIKE '%<process_name>%'`.
 * `kpi_process_assignment`, the table built to answer that question properly, has 0 rows. So the
 * join produced nothing, and where it did produce something the `kpi_score` join carried no
 * employee or process predicate at all — meaning any value returned belonged to an arbitrary
 * employee anywhere in the company.
 *
 * ── THE RULE THAT GOVERNS EVERY CALCULATION HERE ────────────────────────────────────────────
 * A metric with no data reports NO VALUE. It never reports zero.
 *
 * This is not a stylistic preference, it is the difference between a scorecard a client can trust
 * and one they cannot. Three concrete traps, all present in the code being replaced:
 *
 *  1. The old service maps a NULL actual to `achievement_pct: 0` and therefore `rag: 'red'`. A month
 *     with no feed is indistinguishable from a catastrophic month.
 *  2. `late_mark` was not captured at all in 2026-04 and 2026-05 (verified: 0 late marks across
 *     39,126 rows, against 9,465 in 2026-08). Dividing by that yields 0% lateness — a perfect score
 *     produced by absent instrumentation.
 *  3. `workforce_mandate` has 0 rows, so sanctioned headcount is unknown. The existing attrition
 *     service sets `sanctioned_strength = headcount`, which makes utilisation permanently 100% and
 *     tells a client their staffing is perfect regardless of reality.
 *
 * Every metric below therefore returns `actual: null` with a stated `no_data_reason`, and the RAG is
 * `no_data` rather than red.
 *
 * ── PROCESS ATTRIBUTION ─────────────────────────────────────────────────────────────────────
 * `attendance_daily_record` carries its own `process_id`, snapshotted at the time of the event, but
 * it is populated on only ~81% of rows (26,911 of 33,273 in 2026-08). Using it alone silently drops a
 * fifth of the floor. Using `employees.process_id` alone attributes an employee's CURRENT process to
 * historical rows, so a transfer retroactively rewrites last quarter's numbers for both processes.
 * Neither is right on its own, so the engine uses COALESCE(adr.process_id, e.process_id): prefer what
 * was recorded at the time, fall back to where the person sits now. The fallback share is reported in
 * the payload so the client is not told a number is exact when a fifth of it was inferred.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { PortalKpiMetric, PortalRag, SparklinePoint } from "./portal.types.js";

/** How many months of history a sparkline carries, including the selected period. */
const TREND_MONTHS = 6;

const PERIOD_RE = /^\d{4}-\d{2}$/;

function assertPeriod(period: string): void {
  if (!PERIOD_RE.test(period)) throw new Error(`Invalid period format: ${period}`);
}

/** Shifts a YYYY-MM period by whole months. Pure string maths, no Date involved. */
export function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split("-").map(Number);
  const zeroBased = year * 12 + (month - 1) + months;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

/**
 * Achievement as a percentage of target, direction-aware and capped.
 *
 * Capped at 120 to match the convention the rest of this codebase already uses, and floored at 0 so a
 * nonsensical negative cannot flow into a RAG comparison. A zero target yields null rather than a
 * division by zero: "no target set" is not "0% achieved".
 */
export function computeAchievement(
  actual: number | null,
  target: number,
  direction: string,
): number | null {
  if (actual === null) return null;
  if (!Number.isFinite(target) || target === 0) return null;

  const raw =
    direction === "lower_is_better"
      ? // A lower-is-better metric at zero has fully achieved its aim (zero absenteeism), and
        // target/0 would be Infinity. Awarding the cap is correct, not generous.
        actual === 0
        ? 120
        : (target / actual) * 100
      : (actual / target) * 100;

  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(Math.round(raw * 100) / 100, 120));
}

/**
 * RAG from achievement.
 *
 * `no_data` is a first-class state, not an absence of one. Collapsing it into red is the single
 * defect that made the old scorecard untrustworthy.
 */
export function computeRag(achievement: number | null, amberThreshold: number): PortalRag {
  if (achievement === null) return "no_data";
  if (achievement >= 100) return "green";
  if (achievement >= amberThreshold) return "amber";
  return "red";
}

// ─── Metric definitions ──────────────────────────────────────────────────────────────────────

interface MetricConfig {
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: string;
  target_value: number;
  amber_threshold: number;
  description: string | null;
  display_order: number;
  /** Where the target came from, so the portal can distinguish an agreed SLA from a default. */
  target_source: "process_specific" | "portal_default" | "engine_fallback";
}

/**
 * Last-resort defaults used only when migration 1647 has not been applied.
 *
 * Production applies migrations out of band (SKIP_MIGRATIONS=true), so this file can be live before
 * portal_kpi_config exists. Without these the portal would fall back to showing nothing, which is the
 * exact failure being fixed. The values match the seeds in 1647 so behaviour does not change when the
 * migration lands.
 */
const FALLBACK_METRICS: readonly Omit<MetricConfig, "target_source">[] = [
  { metric_code: "ATT", metric_name: "Attendance Rate", unit: "percent", direction: "higher_is_better", target_value: 95, amber_threshold: 85, display_order: 10, description: "Days actually worked as a share of days the roster expected work." },
  { metric_code: "ABN", metric_name: "Absenteeism Rate", unit: "percent", direction: "lower_is_better", target_value: 3, amber_threshold: 85, display_order: 20, description: "Unplanned absence as a share of expected working days." },
  { metric_code: "LAT", metric_name: "Late Arrival Rate", unit: "percent", direction: "lower_is_better", target_value: 5, amber_threshold: 85, display_order: 30, description: "Days flagged as a late arrival as a share of days present." },
  { metric_code: "LVE", metric_name: "Leave Rate", unit: "percent", direction: "lower_is_better", target_value: 5, amber_threshold: 85, display_order: 40, description: "Approved leave days as a share of expected working days." },
  { metric_code: "RET", metric_name: "Retention Rate", unit: "percent", direction: "higher_is_better", target_value: 97, amber_threshold: 95, display_order: 50, description: "Share of the month's opening headcount still employed at month end." },
  { metric_code: "HDY", metric_name: "Half Day Rate", unit: "percent", direction: "lower_is_better", target_value: 5, amber_threshold: 85, display_order: 60, description: "Days worked as a half shift, as a share of expected working days." },
  { metric_code: "DQ", metric_name: "Attendance Data Completeness", unit: "percent", direction: "higher_is_better", target_value: 98, amber_threshold: 90, display_order: 70, description: "Share of attendance days with a confirmed status." },
];

let configTableExists: boolean | null = null;

/**
 * Whether migration 1647 has been applied. Cached, and a failed probe counts as absent — a probe
 * error must not take the portal down.
 */
async function portalConfigAvailable(): Promise<boolean> {
  if (configTableExists !== null) return configTableExists;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_kpi_config'`,
    );
    configTableExists = Number((rows as RowDataPacket[])[0]?.n ?? 0) === 1;
  } catch {
    configTableExists = false;
  }
  return configTableExists;
}

/** Exposed so a test, or a process that has just run the migration, can re-probe. */
export function resetPortalConfigProbe(): void {
  configTableExists = null;
}

/**
 * Resolves which metrics a process shows and what each is measured against.
 *
 * Precedence, most specific first:
 *   1. kpi_process_config for this process — 291 rows already hold real agreed targets, and an
 *      agreed target must always beat a default.
 *   2. portal_kpi_config for this process.
 *   3. portal_kpi_config with process_id IS NULL — the default set.
 *   4. FALLBACK_METRICS, only when the table does not exist yet.
 */
export async function resolveMetricConfig(processId: string): Promise<MetricConfig[]> {
  const byCode = new Map<string, MetricConfig>();

  if (await portalConfigAvailable()) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT process_id, metric_code, metric_name, unit, direction,
              target_value, amber_threshold, description, display_order
         FROM portal_kpi_config
        WHERE active_status = 1
          AND (process_id IS NULL OR process_id = ?)
        -- Process-specific rows last so they overwrite the defaults as the map is filled.
        ORDER BY (process_id IS NULL) DESC, display_order`,
      [processId],
    );
    for (const row of rows as RowDataPacket[]) {
      byCode.set(String(row.metric_code), {
        metric_code: String(row.metric_code),
        metric_name: String(row.metric_name),
        unit: String(row.unit),
        direction: String(row.direction),
        target_value: Number(row.target_value),
        amber_threshold: Number(row.amber_threshold),
        description: row.description ? String(row.description) : null,
        display_order: Number(row.display_order),
        target_source: row.process_id ? "process_specific" : "portal_default",
      });
    }
  }

  if (byCode.size === 0) {
    for (const metric of FALLBACK_METRICS) {
      byCode.set(metric.metric_code, { ...metric, target_source: "engine_fallback" });
    }
  }

  // kpi_process_config holds targets agreed with the client. Where one exists for a metric this
  // portal shows, it overrides whatever default was resolved above — but only the NUMBER, never the
  // metric's identity, because that table's unit/direction describe internal dialler metrics whose
  // naming differs from what a client sees.
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.metric_code, c.target_value, c.min_threshold
         FROM kpi_process_config c
         JOIN kpi_metric_master m ON m.id = c.metric_id
        WHERE c.process_id = ?`,
      [processId],
    );
    for (const row of rows as RowDataPacket[]) {
      const existing = byCode.get(String(row.metric_code));
      if (!existing) continue;
      const target = Number(row.target_value);
      if (!Number.isFinite(target) || target === 0) continue;
      byCode.set(existing.metric_code, { ...existing, target_value: target, target_source: "process_specific" });
    }
  } catch {
    // kpi_process_config or kpi_metric_master unavailable — the resolved defaults still stand. A
    // missing override is a less specific target, not a broken scorecard.
  }

  return [...byCode.values()].sort((a, b) => a.display_order - b.display_order);
}

// ─── Attendance-derived metrics ──────────────────────────────────────────────────────────────

/**
 * One row per period with every attendance counter the scorecard needs.
 *
 * Computed in a single grouped pass rather than one query per metric: six metrics over six months of
 * history is 36 round trips done naively, against one here.
 *
 * The denominator, `expected_days`, deliberately EXCLUDES week_off, holiday and leave_approved. A
 * rest day is not a day somebody failed to attend, and counting it would make attendance a function
 * of how many Sundays fell in the month. It deliberately INCLUDES missing_punch and unreconciled in
 * `total_days` but not in `confirmed_days`, which is what makes the DQ metric possible.
 */
interface AttendanceCounters {
  period: string;
  total_days: number;
  expected_days: number;
  confirmed_expected_days: number;
  present_days: number;
  half_days: number;
  absent_days: number;
  unconfirmed_days: number;
  leave_days: number;
  late_days: number;
  employees_seen: number;
  /** Rows attributed via the employee's current process because the row carried none. */
  inferred_process_days: number;
}

async function loadAttendanceCounters(
  processId: string,
  fromPeriod: string,
  toPeriod: string,
): Promise<Map<string, AttendanceCounters>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       DATE_FORMAT(adr.record_date, '%Y-%m')                                   AS period,
       COUNT(*)                                                               AS total_days,

       -- Expected to work: everything that is not a rest day, a holiday, or approved leave.
       SUM(adr.attendance_status NOT IN ('week_off','holiday','leave_approved')) AS expected_days,

       -- Of those, the ones whose status is actually settled. missing_punch and unreconciled are
       -- awaiting reconciliation and are neither present nor absent.
       SUM(adr.attendance_status IN ('present','week_off_worked','half_day','absent')) AS confirmed_expected_days,

       SUM(adr.attendance_status IN ('present','week_off_worked'))             AS present_days,
       SUM(adr.attendance_status = 'half_day')                                AS half_days,
       SUM(adr.attendance_status = 'absent')                                  AS absent_days,
       SUM(adr.attendance_status IN ('missing_punch','unreconciled'))          AS unconfirmed_days,
       SUM(adr.attendance_status = 'leave_approved')                          AS leave_days,

       -- Late marks are counted only on days the employee was actually present. The same figure over
       -- expected days would exceed 100% whenever late_mark is also set on an absent or
       -- missing-punch row, which it is in this data.
       SUM(adr.attendance_status IN ('present','week_off_worked') AND adr.late_mark = 1) AS late_days,

       COUNT(DISTINCT adr.employee_id)                                        AS employees_seen,
       SUM(adr.process_id IS NULL)                                            AS inferred_process_days
     FROM attendance_daily_record adr
     JOIN employees e ON e.id = adr.employee_id
     WHERE COALESCE(adr.process_id, e.process_id) = ?
       AND DATE_FORMAT(adr.record_date, '%Y-%m') BETWEEN ? AND ?
       -- Synthetic end-to-end test employees would otherwise appear in a client's scorecard.
       AND e.employee_code NOT LIKE 'CODEX\\_E2E%'
     GROUP BY period
     ORDER BY period`,
    [processId, fromPeriod, toPeriod],
  );

  const result = new Map<string, AttendanceCounters>();
  for (const row of rows as RowDataPacket[]) {
    result.set(String(row.period), {
      period: String(row.period),
      total_days: Number(row.total_days) || 0,
      expected_days: Number(row.expected_days) || 0,
      confirmed_expected_days: Number(row.confirmed_expected_days) || 0,
      present_days: Number(row.present_days) || 0,
      half_days: Number(row.half_days) || 0,
      absent_days: Number(row.absent_days) || 0,
      unconfirmed_days: Number(row.unconfirmed_days) || 0,
      leave_days: Number(row.leave_days) || 0,
      late_days: Number(row.late_days) || 0,
      employees_seen: Number(row.employees_seen) || 0,
      inferred_process_days: Number(row.inferred_process_days) || 0,
    });
  }
  return result;
}

/**
 * Whether arrival time was instrumented at all in a period.
 *
 * Verified necessity: 2026-04 and 2026-05 carry 39,126 attendance rows and exactly zero late marks,
 * while 2026-08 carries 9,465. Reporting 0% lateness for those months would be a perfect score
 * manufactured by absent instrumentation. A period with present days but no late marks anywhere in
 * the process is treated as uninstrumented, not as flawless.
 */
function lateMarkCaptured(counters: AttendanceCounters): boolean {
  return counters.late_days > 0;
}

/** Approved leave days per period, from leave_request rather than the attendance status. */
async function loadLeaveDays(
  processId: string,
  fromPeriod: string,
  toPeriod: string,
): Promise<Map<string, number>> {
  // Dated on from_date, and ONLY from_date.
  //
  // This previously read COALESCE(lr.start_date, lr.from_date) on the belief that both columns
  // exist. start_date does exist on PRODUCTION, but no migration creates it — it arrived out of
  // band — so on any rebuilt database (UAT, CI, a restore, a new environment) the column is absent
  // and MySQL resolves column names at parse time, which makes this a hard ER_BAD_FIELD_ERROR
  // rather than a NULL. That took down every metric on the Performance tab, not just leave: the
  // engine loads leave inside the same computeKpisForProcess call that produces ATT, ABN, LAT, RET
  // and DQ, so one bad identifier emptied the whole scorecard. Found by running this service
  // against a UAT schema built from the migration manifest.
  //
  // from_date/to_date are the canonical pair: both are NOT NULL in the base leave schema, they are
  // what the other six leave call sites in this codebase read, and they are what the migrations
  // actually create. Nothing is lost by dropping start_date — where it is populated on production
  // it duplicates from_date.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(lr.from_date, '%Y-%m') AS period,
            SUM(COALESCE(lr.total_days, 0))    AS leave_days,
            COUNT(*)                           AS request_count
       FROM leave_request lr
       JOIN employees e ON e.id = lr.employee_id
      WHERE e.process_id = ?
        AND LOWER(lr.status) = 'approved'
        AND lr.from_date IS NOT NULL
        AND DATE_FORMAT(lr.from_date, '%Y-%m') BETWEEN ? AND ?
        AND e.employee_code NOT LIKE 'CODEX\\_E2E%'
      GROUP BY period`,
    [processId, fromPeriod, toPeriod],
  );

  const result = new Map<string, number>();
  for (const row of rows as RowDataPacket[]) {
    result.set(String(row.period), Number(row.leave_days) || 0);
  }
  return result;
}

/**
 * Opening headcount and exits per period, for retention.
 *
 * Opening headcount is reconstructed rather than read: nothing snapshots it. An employee counts
 * toward a period's opening headcount if they had joined before the period began and had not left
 * before it began. That is derivable from date_of_joining and date_of_exit, both of which are
 * populated (26,543 of 27,031 inactive rows carry an exit date).
 *
 * Note the data reality this navigates: `employment_status = 'Resigned'` covers 30,309 rows of which
 * only 2,109 carry a date_of_exit, so status alone cannot date an exit. Only rows WITH a date can
 * contribute to a dated retention figure, and a period whose opening headcount cannot be established
 * reports no value rather than 100%.
 */
async function loadRetentionCounters(
  processId: string,
  fromPeriod: string,
  toPeriod: string,
): Promise<Map<string, { opening: number; exits: number }>> {
  const result = new Map<string, { opening: number; exits: number }>();

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       p.period,
       SUM(
         e.date_of_joining IS NOT NULL
         AND e.date_of_joining < CONCAT(p.period, '-01')
         AND (e.date_of_exit IS NULL OR e.date_of_exit >= CONCAT(p.period, '-01'))
       ) AS opening,
       SUM(
         e.date_of_exit IS NOT NULL
         AND DATE_FORMAT(e.date_of_exit, '%Y-%m') = p.period
       ) AS exits
     FROM (
       -- The month list is generated from the attendance rows in range rather than a calendar table,
       -- because a period with no operational activity has no headcount story to tell either.
       SELECT DISTINCT DATE_FORMAT(record_date, '%Y-%m') AS period
         FROM attendance_daily_record
        WHERE DATE_FORMAT(record_date, '%Y-%m') BETWEEN ? AND ?
     ) p
     JOIN employees e ON e.process_id = ?
      AND e.employee_code NOT LIKE 'CODEX\\_E2E%'
     GROUP BY p.period
     ORDER BY p.period`,
    [fromPeriod, toPeriod, processId],
  );

  for (const row of rows as RowDataPacket[]) {
    result.set(String(row.period), {
      opening: Number(row.opening) || 0,
      exits: Number(row.exits) || 0,
    });
  }
  return result;
}

// ─── Metric computation ──────────────────────────────────────────────────────────────────────

interface MetricValue {
  actual: number | null;
  reason?: string;
  /** Numerator and denominator, so the portal can show the working behind the number. */
  numerator?: number;
  denominator?: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Computes one metric for one period from the loaded counters.
 *
 * Every branch that cannot produce a number states WHY, in language a client can read. "No data" with
 * no explanation is the thing that generates the support call this feature exists to prevent.
 */
function computeMetric(
  code: string,
  attendance: AttendanceCounters | undefined,
  leaveDays: number | undefined,
  retention: { opening: number; exits: number } | undefined,
): MetricValue {
  if (code === "RET") {
    if (!retention || retention.opening === 0) {
      return { actual: null, reason: "Opening headcount for this month could not be established" };
    }
    const retained = retention.opening - retention.exits;
    return {
      actual: round2((retained / retention.opening) * 100),
      numerator: retained,
      denominator: retention.opening,
    };
  }

  if (!attendance || attendance.total_days === 0) {
    return { actual: null, reason: "No attendance records for this process in this month" };
  }

  switch (code) {
    case "ATT": {
      // Scored over CONFIRMED expected days, not all expected days. Including unreconciled days in
      // the denominator would charge a reconciliation backlog to the employees: 13.7% of rows are
      // missing_punch, which would depress every attendance figure by up to that much for a reason
      // that has nothing to do with whether anyone turned up. The excluded share is published
      // separately as DQ so the exclusion is visible rather than hidden.
      if (attendance.confirmed_expected_days === 0) {
        return {
          actual: null,
          reason: "Every attendance day this month is still awaiting punch reconciliation",
        };
      }
      const worked = attendance.present_days + attendance.half_days * 0.5;
      return {
        actual: round2((worked / attendance.confirmed_expected_days) * 100),
        numerator: worked,
        denominator: attendance.confirmed_expected_days,
      };
    }

    case "ABN": {
      if (attendance.confirmed_expected_days === 0) {
        return { actual: null, reason: "No confirmed attendance days to measure against" };
      }
      return {
        actual: round2((attendance.absent_days / attendance.confirmed_expected_days) * 100),
        numerator: attendance.absent_days,
        denominator: attendance.confirmed_expected_days,
      };
    }

    case "HDY": {
      if (attendance.confirmed_expected_days === 0) {
        return { actual: null, reason: "No confirmed attendance days to measure against" };
      }
      return {
        actual: round2((attendance.half_days / attendance.confirmed_expected_days) * 100),
        numerator: attendance.half_days,
        denominator: attendance.confirmed_expected_days,
      };
    }

    case "LAT": {
      const presentBase = attendance.present_days;
      if (presentBase === 0) {
        return { actual: null, reason: "Nobody was recorded present this month" };
      }
      if (!lateMarkCaptured(attendance)) {
        // The instrumentation gap, stated rather than scored. Verified: 2026-04 and 2026-05 have
        // 39,126 attendance rows and zero late marks.
        return {
          actual: null,
          reason: "Arrival time was not captured for this month, so lateness cannot be measured",
        };
      }
      return {
        actual: round2((attendance.late_days / presentBase) * 100),
        numerator: attendance.late_days,
        denominator: presentBase,
      };
    }

    case "LVE": {
      if (attendance.expected_days === 0) {
        return { actual: null, reason: "No expected working days to measure against" };
      }
      // Leave taken is counted from leave_request where available, because attendance carries only 25
      // rows marked leave_approved against 29,189 approved leave requests — the attendance status is
      // not a reliable record of leave in this data. Falling back to the attendance count keeps a
      // process with no leave rows from reading as null when attendance does know about some.
      const days = leaveDays ?? attendance.leave_days;
      return {
        actual: round2((days / attendance.expected_days) * 100),
        numerator: round2(days),
        denominator: attendance.expected_days,
      };
    }

    case "DQ": {
      if (attendance.expected_days === 0) {
        return { actual: null, reason: "No expected working days this month" };
      }
      const confirmed = attendance.expected_days - attendance.unconfirmed_days;
      return {
        actual: round2((confirmed / attendance.expected_days) * 100),
        numerator: confirmed,
        denominator: attendance.expected_days,
      };
    }

    default:
      // A configured metric the engine has no formula for. Reported honestly rather than silently
      // dropped, so a mis-typed metric_code in portal_kpi_config is visible instead of invisible.
      return { actual: null, reason: `No calculation is defined for ${code}` };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────────────────────

export interface ProcessKpiResult {
  process_id: string;
  period: string;
  metrics: PortalKpiMetric[];
  /** Headline facts a client asks for before looking at any KPI. */
  summary: {
    active_headcount: number;
    employees_with_activity: number;
    expected_days: number;
    unconfirmed_days: number;
    /** Share of attendance rows whose process was inferred from the employee's current posting. */
    inferred_process_pct: number;
    data_through: string | null;
  };
}

/**
 * Every client-visible KPI for one process and period, each with six months of trend.
 *
 * One pass over attendance, one over leave, one over retention, covering the whole trend window —
 * so the cost is three queries regardless of how many metrics are configured, rather than three per
 * metric per month.
 */
export const portalKpiEngine = {
  computeAchievement,
  computeRag,
  shiftPeriod,
  resolveMetricConfig,

  async computeKpisForProcess(processId: string, period: string): Promise<PortalKpiMetric[]> {
    const result = await portalKpiEngine.computeProcessKpiResult(processId, period);
    return result.metrics;
  },

  async computeProcessKpiResult(processId: string, period: string): Promise<ProcessKpiResult> {
    if (!processId) throw Object.assign(new Error("processId is required"), { statusCode: 400 });
    assertPeriod(period);

    const fromPeriod = shiftPeriod(period, -(TREND_MONTHS - 1));
    const config = await resolveMetricConfig(processId);

    const [attendance, leave, retention, headcountRows] = await Promise.all([
      loadAttendanceCounters(processId, fromPeriod, period),
      loadLeaveDays(processId, fromPeriod, period),
      loadRetentionCounters(processId, fromPeriod, period),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS active_headcount
           FROM employees
          WHERE process_id = ?
            AND LOWER(employment_status) = 'active'
            AND employee_code NOT LIKE 'CODEX\\_E2E%'`,
        [processId],
      ),
    ]);

    // Trend runs oldest to newest so a chart can render it directly.
    const trendPeriods: string[] = [];
    for (let offset = TREND_MONTHS - 1; offset >= 0; offset -= 1) {
      trendPeriods.push(shiftPeriod(period, -offset));
    }

    const metrics: PortalKpiMetric[] = config.map((metric) => {
      const current = computeMetric(
        metric.metric_code,
        attendance.get(period),
        leave.get(period),
        retention.get(period),
      );

      // A trend point is omitted entirely when the month has no value. Substituting zero would draw a
      // cliff down to the axis and read as a collapse in performance.
      const sparkline: SparklinePoint[] = [];
      for (const trendPeriod of trendPeriods) {
        const value = computeMetric(
          metric.metric_code,
          attendance.get(trendPeriod),
          leave.get(trendPeriod),
          retention.get(trendPeriod),
        );
        if (value.actual !== null) sparkline.push({ period: trendPeriod, value: value.actual });
      }

      const achievement = computeAchievement(current.actual, metric.target_value, metric.direction);

      // Month-on-month movement, direction-aware. The previous point is the last month that HAS a
      // value, not literally last month, so a gap in the data does not read as a change.
      const previous = sparkline.length >= 2 ? sparkline[sparkline.length - 2] : null;
      const isCurrentLast =
        sparkline.length > 0 && sparkline[sparkline.length - 1].period === period;
      const delta =
        isCurrentLast && previous && current.actual !== null
          ? round2(current.actual - previous.value)
          : null;

      return {
        metric_code: metric.metric_code,
        metric_name: metric.metric_name,
        unit: metric.unit,
        direction: metric.direction as PortalKpiMetric["direction"],
        target: metric.target_value,
        target_source: metric.target_source,
        actual: current.actual,
        achievement_pct: achievement,
        rag: computeRag(achievement, metric.amber_threshold),
        description: metric.description,
        no_data_reason: current.actual === null ? (current.reason ?? "No data") : null,
        numerator: current.numerator ?? null,
        denominator: current.denominator ?? null,
        delta_vs_previous: delta,
        // "Better" is direction-aware: falling absenteeism is an improvement, falling attendance is
        // not. Getting this backwards would congratulate a client on a metric that deteriorated.
        improved:
          delta === null || delta === 0
            ? null
            : metric.direction === "lower_is_better"
              ? delta < 0
              : delta > 0,
        sparkline,
      };
    });

    const currentAttendance = attendance.get(period);
    const periodsWithData = [...attendance.keys()].sort();

    return {
      process_id: processId,
      period,
      metrics,
      summary: {
        active_headcount: Number((headcountRows[0] as RowDataPacket[])[0]?.active_headcount ?? 0),
        employees_with_activity: currentAttendance?.employees_seen ?? 0,
        expected_days: currentAttendance?.expected_days ?? 0,
        unconfirmed_days: currentAttendance?.unconfirmed_days ?? 0,
        inferred_process_pct:
          currentAttendance && currentAttendance.total_days > 0
            ? round2((currentAttendance.inferred_process_days / currentAttendance.total_days) * 100)
            : 0,
        data_through: periodsWithData.length ? periodsWithData[periodsWithData.length - 1] : null,
      },
    };
  },

  /**
   * The two or three metrics shown on an overview card.
   *
   * Chosen by worst RAG rather than a fixed list: a card exists to tell a client where to look, and a
   * fixed list shows the same three metrics whether or not those are the ones in trouble. Metrics
   * with no data sort last, because "we cannot measure this" is not the headline for a card whose
   * job is to flag risk.
   */
  async computeHeadlineMetrics(processId: string, period: string, limit = 3): Promise<PortalKpiMetric[]> {
    const { metrics } = await portalKpiEngine.computeProcessKpiResult(processId, period);
    const rank: Record<PortalRag, number> = { red: 0, amber: 1, green: 2, no_data: 3 };
    return [...metrics]
      .sort((left, right) => {
        const byRag = rank[left.rag] - rank[right.rag];
        if (byRag !== 0) return byRag;
        return (left.achievement_pct ?? 999) - (right.achievement_pct ?? 999);
      })
      .slice(0, limit);
  },

  /** Worst RAG across a process's metrics, ignoring the ones that have no data. */
  rollUpRag(metrics: readonly PortalKpiMetric[]): PortalRag {
    const scored = metrics.filter((metric) => metric.rag !== "no_data");
    if (scored.length === 0) return "no_data";
    if (scored.some((metric) => metric.rag === "red")) return "red";
    if (scored.some((metric) => metric.rag === "amber")) return "amber";
    return "green";
  },
};
