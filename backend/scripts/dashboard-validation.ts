/**
 * Per-widget / per-datapoint validation for the role dashboards. READ ONLY.
 *
 * The dashboards' failure mode is not "the page crashes" — it is "the page shows a
 * number that nobody checked". So for every datapoint a widget renders, this module
 * recomputes the expected value with an INDEPENDENT query (written against the live
 * schema, deliberately not by calling the same helper the service uses) and compares.
 *
 * Three outcomes are reported distinctly, because they need different fixes:
 *   MATCH        — service value equals the independent value
 *   MISMATCH     — the widget is showing a wrong number
 *   NO_DATA      — the source table is genuinely empty; the widget must say so,
 *                  not render a confident 0
 *   QUERY_FAILED — the service's own query raised; the widget silently blanks today
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import type { DashboardScope } from "../src/shared/dashboardScope.js";
import { buildScopeWhere, buildScopeWhereEmployees } from "../src/shared/dashboardScope.js";
import type { MetricResult } from "../src/modules/dashboards/dashboard-metric.service.js";

export type CheckOutcome = "MATCH" | "MISMATCH" | "NO_DATA" | "QUERY_FAILED" | "SKIPPED";

export type DatapointCheck = {
  metric: string;
  datapoint: string;
  serviceValue: number | null;
  expectedValue: number | null;
  outcome: CheckOutcome;
  note?: string;
};

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

async function scalar(sql: string, params: unknown[] = []): Promise<number | null> {
  const rows = await q(sql, params);
  const first = rows[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const value = Object.values(first)[0];
  return value === null || value === undefined ? null : Number(value);
}

/** Row count of a table, or null if the table does not exist. */
export async function rowCount(table: string): Promise<number | null> {
  try {
    return await scalar(`SELECT COUNT(*) AS n FROM \`${table}\``);
  } catch {
    return null;
  }
}

function compare(
  metric: string,
  datapoint: string,
  serviceValue: number | null,
  expectedValue: number | null,
  sourceRows: number | null,
  note?: string,
): DatapointCheck {
  // A metric whose whole source table is empty is a data gap, not a code defect.
  if (sourceRows === 0) {
    return { metric, datapoint, serviceValue, expectedValue, outcome: "NO_DATA", note };
  }
  if (serviceValue === null && expectedValue !== null) {
    return {
      metric, datapoint, serviceValue, expectedValue, outcome: "QUERY_FAILED",
      note: note ?? "service returned null while the source has rows",
    };
  }
  const outcome: CheckOutcome = Number(serviceValue ?? NaN) === Number(expectedValue ?? NaN)
    ? "MATCH"
    : "MISMATCH";
  return { metric, datapoint, serviceValue, expectedValue, outcome, note };
}

const detail = (m: MetricResult, key: string): number | null => {
  const v = (m.detail ?? {})[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/**
 * The date the dashboards should anchor "today" to.
 *
 * Production attendance trails by a day or two (the most recent record_date often has
 * a single stray row), so a CURDATE()-anchored tile reads ~0. Validation must compare
 * against the same day the widget claims to show.
 */
export async function latestAttendanceDate(): Promise<string | null> {
  const rows = await q(
    `SELECT record_date FROM attendance_daily_record
      GROUP BY record_date HAVING COUNT(*) > 10
      ORDER BY record_date DESC LIMIT 1`,
  );
  const v = (rows[0] as any)?.record_date;
  return v ? String(v) : null;
}

// ── Per-metric validators ────────────────────────────────────────────────────

export async function validateHeadcount(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const s = buildScopeWhereEmployees(scope, "e");
  const active = await scalar(
    `SELECT COUNT(*) FROM employees e
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status,'active')) = 'active'
        AND ${s.sql}`,
    s.params,
  );
  return [
    compare("HEADCOUNT", "active", detail(m, "active") ?? m.value, active, active),
  ];
}

export async function validateOnboarding(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("ats_onboarding_bridge");
  const s = buildScopeWhere(scope, "bm.id", "pm.id");
  const base = `
    FROM ats_onboarding_bridge b
    LEFT JOIN ats_candidate cand ON cand.id = b.candidate_id
    LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
    LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
    WHERE ${s.sql}`;

  const pending = await scalar(`SELECT COUNT(*) ${base} AND b.status IN ('pending','initiated')`, s.params);
  const submitted = await scalar(`SELECT COUNT(*) ${base} AND b.status = 'profile_submitted'`, s.params);
  const joined = await scalar(`SELECT COUNT(*) ${base} AND b.status = 'joined'`, s.params);
  const scopedTotal = await scalar(`SELECT COUNT(*) ${base}`, s.params);

  return [
    compare("ONBOARDING", "pending", detail(m, "pending"), pending, total),
    compare("ONBOARDING", "submitted", detail(m, "submitted"), submitted, total),
    compare("ONBOARDING", "joined", detail(m, "joined"), joined, total),
    compare("ONBOARDING", "total", detail(m, "total"), scopedTotal, total),
  ];
}

export async function validateAttendance(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("attendance_daily_record");
  const day = await latestAttendanceDate();
  if (!day) {
    return [{
      metric: "ATTENDANCE", datapoint: "*", serviceValue: m.value, expectedValue: null,
      outcome: "NO_DATA", note: "no attendance day with >10 records",
    }];
  }
  const s = buildScopeWhereEmployees(scope, "e");
  const base = `
    FROM attendance_daily_record a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.record_date = ? AND ${s.sql}`;
  const params = [day, ...s.params];

  const present = await scalar(`SELECT COUNT(*) ${base} AND a.attendance_status='present'`, params);
  const absent = await scalar(`SELECT COUNT(*) ${base} AND a.attendance_status='absent'`, params);
  const missing = await scalar(`SELECT COUNT(*) ${base} AND a.attendance_status='missing_punch'`, params);
  const half = await scalar(`SELECT COUNT(*) ${base} AND a.attendance_status='half_day'`, params);
  const late = await scalar(`SELECT COUNT(*) ${base} AND a.late_mark=1`, params);

  // The service anchors on today (IST). If that differs from the latest day with data,
  // every datapoint below will legitimately mismatch — which is the finding, not noise.
  const todayRows = await scalar(
    `SELECT COUNT(*) FROM attendance_daily_record
      WHERE record_date = DATE(CONVERT_TZ(NOW(),'+00:00','+05:30'))`,
  );

  const note = `latest day with data = ${day}; rows dated today = ${todayRows ?? 0}`;
  return [
    compare("ATTENDANCE", "present", detail(m, "present"), present, total, note),
    compare("ATTENDANCE", "absent", detail(m, "absent"), absent, total, note),
    compare("ATTENDANCE", "missedPunch", detail(m, "missedPunch"), missing, total, note),
    compare("ATTENDANCE", "halfDay", detail(m, "halfDay"), half, total, note),
    compare("ATTENDANCE", "late", detail(m, "late"), late, total,
      "service counts attendance_status='late', which is not a member of the ENUM; " +
      "lateness lives in late_mark"),
  ];
}

export async function validatePayrollReadiness(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const s = buildScopeWhereEmployees(scope, "e");
  const total = await scalar(
    `SELECT COUNT(*) FROM employees e WHERE e.active_status = 1 AND ${s.sql}`,
    s.params,
  );
  return [compare("PAYROLL_READINESS", "total", detail(m, "total"), total, total)];
}

export async function validateBgv(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("candidate_bgv_check");
  const s = buildScopeWhere(scope, "bm.id", "pm.id");
  const base = `
    FROM candidate_bgv_check bgv
    LEFT JOIN ats_candidate cand ON cand.id = bgv.candidate_id
    LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
    LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
    WHERE ${s.sql}`;

  const pending = await scalar(
    `SELECT COUNT(*) ${base} AND (bgv.status IS NULL OR bgv.status IN ('pending','not_started','queued','manual_review','in_progress'))`, s.params);
  const cleared = await scalar(
    `SELECT COUNT(*) ${base} AND bgv.status IN ('cleared','verified','passed')`, s.params);
  const flagged = await scalar(
    `SELECT COUNT(*) ${base} AND bgv.status IN ('flagged','failed','mismatch','discrepancy')`, s.params);
  const scoped = await scalar(`SELECT COUNT(*) ${base}`, s.params);

  const checks = [
    compare("BGV", "pending", detail(m, "pending"), pending, total),
    compare("BGV", "cleared", detail(m, "cleared"), cleared, total),
    compare("BGV", "flagged", detail(m, "flagged"), flagged, total),
  ];
  // Every record must land in exactly one bucket; a gap means statuses are being dropped.
  const bucketed = (pending ?? 0) + (cleared ?? 0) + (flagged ?? 0);
  checks.push({
    metric: "BGV",
    datapoint: "buckets cover all rows",
    serviceValue: bucketed,
    expectedValue: scoped,
    outcome: bucketed === scoped ? "MATCH" : "MISMATCH",
    note: bucketed === scoped ? "" : "some BGV statuses fall into no bucket and are invisible",
  });
  return checks;
}

export async function validateResignation(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("exit_request");
  const s = buildScopeWhere(scope, "e.branch_id", "e.process_id");
  const active = await scalar(
    `SELECT COUNT(*) FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
      WHERE er.status NOT IN ('completed','cancelled') AND ${s.sql}`,
    s.params,
  );
  return [compare("RESIGNATION", "totalActive", detail(m, "totalActive") ?? m.value, active, total)];
}

/** Metrics whose source table is empty in production — validated as NO_DATA, not 0. */
const EMPTY_SOURCE_METRICS: Record<string, string> = {
  TAT: "task_tat_instance",
  NAME_MISMATCH: "candidate_name_match_summary",
  DPDP_WITHDRAWAL: "dpdp_consent_withdrawal",
  INCENTIVE: "incentive_upload_batch",
};

export async function validateEmptySourceMetric(
  metricCode: string,
  m: MetricResult,
): Promise<DatapointCheck[]> {
  const table = EMPTY_SOURCE_METRICS[metricCode];
  if (!table) return [];
  const rows = await rowCount(table);
  return [{
    metric: metricCode,
    datapoint: "value",
    serviceValue: m.value,
    expectedValue: rows === null ? null : 0,
    outcome: rows === null ? "QUERY_FAILED" : rows === 0 ? "NO_DATA" : "SKIPPED",
    note: rows === null ? `${table} does not exist` : `${table} has ${rows} rows`,
  }];
}

export function summarise(checks: DatapointCheck[]): Record<CheckOutcome, number> {
  const out: Record<CheckOutcome, number> = {
    MATCH: 0, MISMATCH: 0, NO_DATA: 0, QUERY_FAILED: 0, SKIPPED: 0,
  };
  for (const c of checks) out[c.outcome]++;
  return out;
}
