/**
 * KPI & Performance module for the D-1 Daily Manager Briefing Engine.
 *
 * Sibling to daily-brief-aggregator.service.ts, NOT wired into it yet — a later
 * integration pass merges this module's output into ManagerDailyBrief. This file
 * owns its own result type rather than extending daily-brief.types.ts's
 * ManagerDailyBrief shape, to avoid coupling an unreviewed integration surface
 * into the MVP's reviewed types. It DOES reuse the MVP's public SourceHealth /
 * SourceHealthState / BriefSignal vocabulary (daily-brief.types.ts), since those
 * are the shared "how trustworthy is this section" contract the whole feature
 * is built on — see hrms2-silent-failure-patterns memory.
 *
 * Every query below is wrapped so a single failure yields SourceHealthState.ERROR
 * for that section only, never a silent zero folded into the rest of the payload,
 * matching daily-brief-aggregator.service.ts's error-handling convention exactly.
 *
 * Direction handling (higher_is_better / lower_is_better) mirrors the achievement
 * calculation already used in modules/kpi/kpi.service.ts (getEmployeeSummary /
 * getLeaderboard) rather than reinventing it: higher_is_better compares
 * actual/target, lower_is_better compares target/actual, and "at or above target"
 * is achievement >= 1.
 *
 * NO invented minimum-sample threshold for KPI observations: kpi_process_config
 * and kpi_metric_master (see backend/sql/010_kpi.sql, 033_kpi_process_config.sql)
 * carry target_value/min_threshold/max_achievement but no per-metric minimum
 * sample count. Where no kpi_process_config row exists for an employee's
 * process+metric, this module reports the observation + sample count only and
 * does NOT classify pass/fail — per the governing prompt for this module.
 *
 * Language is neutral throughout ("Below configured target",
 * "Declining vs 7-day baseline") — never a judgemental label like "poor performer".
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { SourceHealth, SourceHealthState } from "./daily-brief.types.js";

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type KpiDirection = "higher_is_better" | "lower_is_better";

export type KpiObservation =
  | "above_or_at_target"
  | "below_target"
  | "below_min_threshold"
  | "observation_only";

export type KpiTrend = "improved" | "declined" | "flat" | null;

export interface EmployeeKpiSignal {
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  metricId: string;
  metricCode: string;
  metricName: string;
  direction: KpiDirection;
  d1Value: number;
  targetValue: number | null;
  minThreshold: number | null;
  observation: KpiObservation;
  sevenDayBaselineAvg: number | null;
  sevenDayBaselineSampleCount: number;
  trendVsBaseline: KpiTrend;
  note: string;
}

export interface PerformanceAlertItem {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  alertType: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string | null;
  createdAt: string;
}

export interface CoachingItem {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  sessionDate: string;
  sessionType: string;
  status: "scheduled" | "completed" | "cancelled";
}

export interface TrainingNeedItem {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  needType: string;
  priority: "low" | "medium" | "high" | "critical";
  status: string;
}

export interface KpiPerformanceModuleResult {
  employeeSignals: EmployeeKpiSignal[];
  performanceAlerts: {
    unacknowledgedCount: number;
    items: PerformanceAlertItem[];
  };
  coaching: {
    dueOrOverdueCount: number;
    completedD1Count: number;
    dueOrOverdue: CoachingItem[];
    completedD1: CoachingItem[];
  };
  trainingNeeds: {
    openedD1Count: number;
    resolvedD1Count: number;
    openedD1: TrainingNeedItem[];
    resolvedD1: TrainingNeedItem[];
  };
  sourceHealth: SourceHealth[];
}

function emptyResult(): KpiPerformanceModuleResult {
  return {
    employeeSignals: [],
    performanceAlerts: { unacknowledgedCount: 0, items: [] },
    coaching: { dueOrOverdueCount: 0, completedD1Count: 0, dueOrOverdue: [], completedD1: [] },
    trainingNeeds: { openedD1Count: 0, resolvedD1Count: 0, openedD1: [], resolvedD1: [] },
    sourceHealth: [],
  };
}

function notApplicableHealth(module: string, asOfDate: string): SourceHealth {
  return { module, state: "NOT_APPLICABLE", detail: "No team members in scope", asOfDate };
}

/**
 * D-1 KPI actual values for the team, joined to their process's configured
 * target/min_threshold where one exists, plus a 7-day trailing baseline
 * (the 7 calendar days strictly before reportingDate) for comparison.
 */
async function buildKpiSignals(
  teamEmployeeIds: string[],
  reportingDate: string,
): Promise<{ signals: EmployeeKpiSignal[]; health: SourceHealth }> {
  if (teamEmployeeIds.length === 0) {
    return { signals: [], health: notApplicableHealth("kpi_performance", reportingDate) };
  }
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [d1Rows] = await db.execute<RowDataPacket[]>(
      `SELECT kda.employee_id, e.employee_code, e.full_name,
              kda.metric_id, m.metric_code, m.metric_name, m.direction,
              kda.actual_value AS d1_value,
              kpc.target_value, kpc.min_threshold
         FROM kpi_daily_actual kda
         JOIN kpi_metric_master m ON m.id = kda.metric_id
         JOIN employees e ON e.id = kda.employee_id
         LEFT JOIN kpi_process_config kpc
           ON kpc.process_id = e.process_id AND kpc.metric_id = kda.metric_id
        WHERE kda.score_date = ?
          AND kda.employee_id IN (${placeholders})
          AND kda.actual_value IS NOT NULL`,
      [reportingDate, ...teamEmployeeIds],
    );

    const [baselineRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id, metric_id, AVG(actual_value) AS avg_value, COUNT(*) AS sample_count
         FROM kpi_daily_actual
        WHERE score_date >= DATE_SUB(?, INTERVAL 7 DAY)
          AND score_date < ?
          AND employee_id IN (${placeholders})
          AND actual_value IS NOT NULL
        GROUP BY employee_id, metric_id`,
      [reportingDate, reportingDate, ...teamEmployeeIds],
    );

    const baselineMap = new Map<string, { avg: number; count: number }>();
    for (const row of baselineRows as RowDataPacket[]) {
      baselineMap.set(`${row.employee_id}:${row.metric_id}`, {
        avg: numberValue(row.avg_value),
        count: numberValue(row.sample_count),
      });
    }

    const signals: EmployeeKpiSignal[] = (d1Rows as RowDataPacket[]).map((row) => {
      const direction = row.direction as KpiDirection;
      const d1Value = numberValue(row.d1_value);
      const targetValue = row.target_value !== null && row.target_value !== undefined ? numberValue(row.target_value) : null;
      const minThreshold = row.min_threshold !== null && row.min_threshold !== undefined ? numberValue(row.min_threshold) : null;

      let observation: KpiObservation = "observation_only";
      let observationNote = "No configured target for this process/metric — value reported for observation only.";
      if (minThreshold !== null) {
        const belowMin = direction === "lower_is_better" ? d1Value > minThreshold : d1Value < minThreshold;
        if (belowMin) {
          observation = "below_min_threshold";
          observationNote = "Below the configured minimum threshold.";
        }
      }
      if (observation !== "below_min_threshold" && targetValue !== null && targetValue > 0) {
        // Achievement calc mirrors modules/kpi/kpi.service.ts getEmployeeSummary/getLeaderboard.
        const achievement = direction === "lower_is_better" ? targetValue / d1Value : d1Value / targetValue;
        if (Number.isFinite(achievement) && achievement >= 1) {
          observation = "above_or_at_target";
          observationNote = "At or above configured target.";
        } else {
          observation = "below_target";
          observationNote = "Below configured target.";
        }
      }

      const baseline = baselineMap.get(`${row.employee_id}:${row.metric_id}`) ?? null;
      let trendVsBaseline: KpiTrend = null;
      let trendNote = "";
      if (baseline && baseline.count > 0) {
        const diff = d1Value - baseline.avg;
        if (diff === 0) {
          trendVsBaseline = "flat";
          trendNote = " In line with the 7-day baseline.";
        } else {
          const improved = direction === "lower_is_better" ? diff < 0 : diff > 0;
          trendVsBaseline = improved ? "improved" : "declined";
          trendNote = improved ? " Improved vs 7-day baseline." : " Declining vs 7-day baseline.";
        }
      }

      return {
        employeeId: String(row.employee_id),
        employeeCode: row.employee_code ? String(row.employee_code) : null,
        fullName: row.full_name ? String(row.full_name) : null,
        metricId: String(row.metric_id),
        metricCode: String(row.metric_code),
        metricName: String(row.metric_name),
        direction,
        d1Value,
        targetValue,
        minThreshold,
        observation,
        sevenDayBaselineAvg: baseline ? baseline.avg : null,
        sevenDayBaselineSampleCount: baseline ? baseline.count : 0,
        trendVsBaseline,
        note: `${observationNote}${trendNote}`,
      };
    });

    return {
      signals,
      health: { module: "kpi_performance", state: signals.length > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      signals: [],
      health: {
        module: "kpi_performance",
        state: "ERROR",
        detail: `KPI performance query failed: ${errMessage(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildPerformanceAlerts(
  teamEmployeeIds: string[],
  reportingDate: string,
): Promise<{ result: KpiPerformanceModuleResult["performanceAlerts"]; health: SourceHealth }> {
  if (teamEmployeeIds.length === 0) {
    return { result: { unacknowledgedCount: 0, items: [] }, health: notApplicableHealth("performance_alerts", reportingDate) };
  }
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pa.id, pa.employee_id, e.employee_code, e.full_name,
              pa.alert_type, pa.severity, pa.message, pa.created_at
         FROM performance_alert pa
         JOIN employees e ON e.id = pa.employee_id
        WHERE pa.employee_id IN (${placeholders})
          AND pa.acknowledged = 0
        ORDER BY FIELD(pa.severity, 'critical', 'high', 'medium', 'low'), pa.created_at DESC`,
      teamEmployeeIds,
    );
    const all = rows as RowDataPacket[];
    const items: PerformanceAlertItem[] = all.slice(0, 10).map((r) => ({
      id: String(r.id),
      employeeId: String(r.employee_id),
      employeeCode: r.employee_code ? String(r.employee_code) : null,
      fullName: r.full_name ? String(r.full_name) : null,
      alertType: String(r.alert_type),
      severity: r.severity as PerformanceAlertItem["severity"],
      message: r.message ? String(r.message) : null,
      createdAt: String(r.created_at),
    }));
    return {
      result: { unacknowledgedCount: all.length, items },
      health: { module: "performance_alerts", state: all.length > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      result: { unacknowledgedCount: 0, items: [] },
      health: {
        module: "performance_alerts",
        state: "ERROR",
        detail: `Performance alert query failed: ${errMessage(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildCoaching(
  teamEmployeeIds: string[],
  reportingDate: string,
): Promise<{ result: KpiPerformanceModuleResult["coaching"]; health: SourceHealth }> {
  if (teamEmployeeIds.length === 0) {
    return {
      result: { dueOrOverdueCount: 0, completedD1Count: 0, dueOrOverdue: [], completedD1: [] },
      health: notApplicableHealth("coaching", reportingDate),
    };
  }
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cs.id, cs.employee_id, e.employee_code, e.full_name,
              cs.session_date, cs.session_type, cs.status
         FROM coaching_session cs
         JOIN employees e ON e.id = cs.employee_id
        WHERE cs.employee_id IN (${placeholders})
          AND (
            (cs.status = 'scheduled' AND cs.session_date <= ?)
            OR (cs.status = 'completed' AND cs.session_date = ?)
          )
        ORDER BY cs.session_date ASC`,
      [...teamEmployeeIds, reportingDate, reportingDate],
    );
    const toItem = (r: RowDataPacket): CoachingItem => ({
      id: String(r.id),
      employeeId: String(r.employee_id),
      employeeCode: r.employee_code ? String(r.employee_code) : null,
      fullName: r.full_name ? String(r.full_name) : null,
      sessionDate: String(r.session_date),
      sessionType: String(r.session_type),
      status: r.status as CoachingItem["status"],
    });
    const all = (rows as RowDataPacket[]).map(toItem);
    const dueOrOverdue = all.filter((c) => c.status === "scheduled");
    const completedD1 = all.filter((c) => c.status === "completed");
    return {
      result: {
        dueOrOverdueCount: dueOrOverdue.length,
        completedD1Count: completedD1.length,
        dueOrOverdue,
        completedD1,
      },
      health: { module: "coaching", state: all.length > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      result: { dueOrOverdueCount: 0, completedD1Count: 0, dueOrOverdue: [], completedD1: [] },
      health: {
        module: "coaching",
        state: "ERROR",
        detail: `Coaching session query failed: ${errMessage(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildTrainingNeeds(
  teamEmployeeIds: string[],
  reportingDate: string,
): Promise<{ result: KpiPerformanceModuleResult["trainingNeeds"]; health: SourceHealth }> {
  if (teamEmployeeIds.length === 0) {
    return {
      result: { openedD1Count: 0, resolvedD1Count: 0, openedD1: [], resolvedD1: [] },
      health: notApplicableHealth("training_needs", reportingDate),
    };
  }
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT tn.id, tn.employee_id, e.employee_code, e.full_name,
              tn.need_type, tn.priority, tn.status,
              DATE(tn.created_at) AS created_date,
              DATE(tn.updated_at) AS updated_date
         FROM training_need tn
         JOIN employees e ON e.id = tn.employee_id
        WHERE tn.employee_id IN (${placeholders})
          AND tn.priority IN ('high', 'critical')
          AND (
            DATE(tn.created_at) = ?
            OR (tn.status IN ('completed', 'closed') AND DATE(tn.updated_at) = ?)
          )`,
      [...teamEmployeeIds, reportingDate, reportingDate],
    );
    const toItem = (r: RowDataPacket): TrainingNeedItem => ({
      id: String(r.id),
      employeeId: String(r.employee_id),
      employeeCode: r.employee_code ? String(r.employee_code) : null,
      fullName: r.full_name ? String(r.full_name) : null,
      needType: String(r.need_type),
      priority: r.priority as TrainingNeedItem["priority"],
      status: String(r.status),
    });
    const all = rows as RowDataPacket[];
    const openedD1 = all.filter((r) => String(r.created_date) === reportingDate).map(toItem);
    const resolvedD1 = all
      .filter((r) => ["completed", "closed"].includes(String(r.status)) && String(r.updated_date) === reportingDate)
      .map(toItem);
    return {
      result: { openedD1Count: openedD1.length, resolvedD1Count: resolvedD1.length, openedD1, resolvedD1 },
      health: { module: "training_needs", state: all.length > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      result: { openedD1Count: 0, resolvedD1Count: 0, openedD1: [], resolvedD1: [] },
      health: {
        module: "training_needs",
        state: "ERROR",
        detail: `Training need query failed: ${errMessage(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

export async function buildKpiPerformanceModule(
  teamEmployeeIds: string[],
  reportingDate: string,
): Promise<KpiPerformanceModuleResult> {
  if (teamEmployeeIds.length === 0) {
    const result = emptyResult();
    result.sourceHealth = [
      notApplicableHealth("kpi_performance", reportingDate),
      notApplicableHealth("performance_alerts", reportingDate),
      notApplicableHealth("coaching", reportingDate),
      notApplicableHealth("training_needs", reportingDate),
    ];
    return result;
  }

  const [kpiResult, alertsResult, coachingResult, trainingResult] = await Promise.all([
    buildKpiSignals(teamEmployeeIds, reportingDate),
    buildPerformanceAlerts(teamEmployeeIds, reportingDate),
    buildCoaching(teamEmployeeIds, reportingDate),
    buildTrainingNeeds(teamEmployeeIds, reportingDate),
  ]);

  return {
    employeeSignals: kpiResult.signals,
    performanceAlerts: alertsResult.result,
    coaching: coachingResult.result,
    trainingNeeds: trainingResult.result,
    sourceHealth: [kpiResult.health, alertsResult.health, coachingResult.health, trainingResult.health],
  };
}

// Re-exported for tests that want to assert on the health-state vocabulary directly.
export type { SourceHealth, SourceHealthState };
