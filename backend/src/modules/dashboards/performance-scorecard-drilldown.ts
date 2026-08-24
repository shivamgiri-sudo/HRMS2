import { db } from "../../db/mysql.js";
import type { DrilldownResult } from "./dashboard-drilldown.service.js";
import type { DashboardScope } from "../../shared/dashboardScope.js";
import type { MetricResult } from "./dashboard-metric.service.js";

interface ScorecardFilters {
  employeeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

function requireRange(
  filters: Record<string, unknown> | undefined,
): { employeeId: string; dateFrom: string; dateTo: string } {
  const f = (filters ?? {}) as ScorecardFilters;
  if (!f.employeeId || !f.dateFrom || !f.dateTo) {
    throw Object.assign(new Error("employeeId, dateFrom and dateTo are required"), { status: 400 });
  }
  return { employeeId: f.employeeId, dateFrom: f.dateFrom, dateTo: f.dateTo };
}

async function fetchSnapshotRows(employeeId: string, dateFrom: string, dateTo: string) {
  const [rows] = (await db.execute(
    `SELECT e.employee_code AS employeeCode, e.full_name AS employeeName,
            s.snapshot_date AS snapshotDate, s.attendance_status AS attendanceStatus,
            s.late_by_minutes AS lateByMinutes, s.unplanned_leave_flag AS unplannedLeaveFlag,
            s.pip_status AS pipStatus, s.quality_score AS qualityScore,
            s.team_attrition_pct AS teamAttritionPct, s.team_shrinkage_pct AS teamShrinkagePct,
            s.team_revenue AS teamRevenue
       FROM employee_performance_daily_snapshot s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.employee_id = ? AND s.snapshot_date BETWEEN ? AND ?
      ORDER BY s.snapshot_date ASC`,
    [employeeId, dateFrom, dateTo],
  )) as any;
  return rows as Array<Record<string, unknown>>;
}

export async function drillAttendanceStatus(
  _scope: unknown,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return {
    metricCode: "ATTENDANCE_STATUS",
    records: rows.map((r) => ({
      employeeCode: r.employeeCode,
      employeeName: r.employeeName,
      snapshotDate: r.snapshotDate,
      attendanceStatus: r.attendanceStatus,
    })),
    totalCount: rows.length,
  };
}

export async function drillLatecoming(
  _scope: unknown,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return {
    metricCode: "LATECOMING",
    records: rows.map((r) => ({
      employeeCode: r.employeeCode,
      employeeName: r.employeeName,
      snapshotDate: r.snapshotDate,
      lateByMinutes: Number(r.lateByMinutes ?? 0),
    })),
    totalCount: rows.length,
  };
}

export async function drillUnplannedLeave(
  _scope: unknown,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = (await fetchSnapshotRows(employeeId, dateFrom, dateTo)).filter((r) => Boolean(r.unplannedLeaveFlag));
  return {
    metricCode: "UNPLANNED_LEAVE",
    records: rows.map((r) => ({
      employeeCode: r.employeeCode,
      employeeName: r.employeeName,
      snapshotDate: r.snapshotDate,
      attendanceStatus: r.attendanceStatus,
    })),
    totalCount: rows.length,
  };
}

export async function drillPipStatus(
  _scope: unknown,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  const { employeeId } = requireRange(filters);
  const [rows] = (await db.execute(
    `SELECT pr.status, pr.start_date, pr.end_date, pr.reason, pc.checkpoint_date, pc.rating, pc.notes
       FROM pip_record pr LEFT JOIN pip_checkpoint pc ON pc.pip_id = pr.id
      WHERE pr.employee_id = ? ORDER BY pr.start_date DESC, pc.checkpoint_date DESC LIMIT 100`,
    [employeeId],
  )) as any;
  return { metricCode: "PIP_STATUS", records: rows, totalCount: rows.length };
}

export async function drillQualityBaseline(
  _scope: unknown,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return {
    metricCode: "QUALITY_BASELINE",
    records: rows.map((r) => ({
      employeeCode: r.employeeCode,
      employeeName: r.employeeName,
      snapshotDate: r.snapshotDate,
      qualityScore: r.qualityScore === null ? null : Number(r.qualityScore),
    })),
    totalCount: rows.length,
  };
}

export async function drillAttrition(
  _scope: unknown,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return {
    metricCode: "ATTRITION",
    records: rows.map((r) => ({
      employeeCode: r.employeeCode,
      snapshotDate: r.snapshotDate,
      teamAttritionPct: r.teamAttritionPct === null ? null : Number(r.teamAttritionPct),
    })),
    totalCount: rows.length,
    note: "Team-level rollup for this employee's managed team",
  };
}

export async function drillShrinkage(
  _scope: unknown,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return {
    metricCode: "SHRINKAGE",
    records: rows.map((r) => ({
      employeeCode: r.employeeCode,
      snapshotDate: r.snapshotDate,
      teamShrinkagePct: r.teamShrinkagePct === null ? null : Number(r.teamShrinkagePct),
    })),
    totalCount: rows.length,
    note: "Team-level rollup for this employee's managed team",
  };
}

export async function drillRevenue(
  _scope: unknown,
  filters?: Record<string, unknown>,
): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return {
    metricCode: "REVENUE",
    records: rows.map((r) => ({
      employeeCode: r.employeeCode,
      snapshotDate: r.snapshotDate,
      teamRevenue: r.teamRevenue === null ? null : Number(r.teamRevenue),
    })),
    totalCount: rows.length,
    note: "Team-level rollup for this employee's managed team",
  };
}

// ─── Tile-summary stubs ───────────────────────────────────────────────────────
// Consumed by dashboard-definition.service.ts's METRICS entries (wired in a later task).
// These match MetricDefinition["execute"]'s real signature/return shape (MetricResult from
// dashboard-metric.service.ts) rather than a placeholder — no live computation yet, so every
// stub reports status "unknown" with a null value, identical in shape to nullResult() there.
function stubMetricResult(metricCode: string): MetricResult {
  return {
    value: null,
    previousValue: null,
    target: null,
    variance: null,
    variancePct: null,
    changePct: null,
    status: "unknown",
    trend: null,
    drilldownApi: `/api/dashboards/:dashboardCode/metric/${metricCode}/drilldown`,
    actionUrl: null,
    detail: {},
    errorCode: null,
    errorMessage: null,
    sourceRowCount: null,
  };
}

export async function getAttendanceStatusMetric(_scope: DashboardScope): Promise<MetricResult> {
  return stubMetricResult("ATTENDANCE_STATUS");
}
export async function getLatecomingMetric(_scope: DashboardScope): Promise<MetricResult> {
  return stubMetricResult("LATECOMING");
}
export async function getUnplannedLeaveMetric(_scope: DashboardScope): Promise<MetricResult> {
  return stubMetricResult("UNPLANNED_LEAVE");
}
export async function getPipStatusMetric(_scope: DashboardScope): Promise<MetricResult> {
  return stubMetricResult("PIP_STATUS");
}
export async function getQualityBaselineMetric(_scope: DashboardScope): Promise<MetricResult> {
  return stubMetricResult("QUALITY_BASELINE");
}
export async function getAttritionMetric(_scope: DashboardScope): Promise<MetricResult> {
  return stubMetricResult("ATTRITION");
}
export async function getShrinkageMetric(_scope: DashboardScope): Promise<MetricResult> {
  return stubMetricResult("SHRINKAGE");
}
export async function getRevenueMetric(_scope: DashboardScope): Promise<MetricResult> {
  return stubMetricResult("REVENUE");
}
