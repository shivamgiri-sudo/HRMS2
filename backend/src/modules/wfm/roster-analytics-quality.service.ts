/**
 * Roster Analytics — quality/adherence correlation and cost of non-adherence.
 * Split out of roster-analytics.service.ts (which re-exports both) to keep files small.
 */
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { lobCondition, type LobFilter } from "../../shared/lobFilter.js";
import type {
  QualityCorrelation,
  CostOfNonAdherence,
} from "./roster-analytics.service.js";
import {
  DEFAULT_HOURLY_COST_INR,
  INDUSTRY_AVG_SHRINKAGE,
  classifyRow,
  pearson,
  periodBounds,
  realRosterSql,
  round1,
  SHORT_SHIFT_PCT,
} from "./roster-analytics.calc.js";

/** Shared employee scope (branch / process / LOB) as a conditions array + params. */
export function employeeScope(
  branchId?: string,
  processId?: string,
  lob?: LobFilter,
) {
  const conditions = ["e.active_status = 1"];
  const params: unknown[] = [];
  if (branchId) {
    conditions.push("e.branch_id = ?");
    params.push(branchId);
  }
  if (processId) {
    conditions.push("e.process_id = ?");
    params.push(processId);
  }
  const lobCond = lob ? lobCondition(lob) : null;
  if (lobCond) {
    conditions.push(lobCond.sql);
    params.push(...lobCond.params);
  }
  return { conditions, params };
}

// ── Quality-Adherence Correlation ────────────────────────────────────────────

export async function getQualityAdherenceCorrelation(
  period: string, // YYYY-MM
  branchId?: string,
  processId?: string,
  lob: LobFilter = { kind: "none" },
): Promise<QualityCorrelation> {
  const { first, last, empty } = periodBounds(period);
  const { conditions, params } = employeeScope(branchId, processId, lob);
  const whereClause = conditions.join(" AND ");

  // Adherence = attended / planned working shifts over COMPLETED days (yesterday at most). A NULL assignment_type
  // is a working shift (COALESCE) — `NOT IN` on NULL used to drop those rows. Attended also honours worked minutes
  // (dialler-source rows have minutes but no punch).
  const adherenceP = empty
    ? Promise.resolve([[]] as unknown as [RowDataPacket[]])
    : db.execute<RowDataPacket[]>(
        `SELECT
       e.id AS employee_id,
       e.employee_code,
       e.full_name AS employee_name,
       COUNT(CASE WHEN COALESCE(ra.assignment_type, '') NOT IN ('WEEK_OFF', 'LEAVE', 'HOLIDAY', 'TRAINING') THEN 1 END) AS planned_shifts,
       COUNT(CASE WHEN COALESCE(ra.assignment_type, '') NOT IN ('WEEK_OFF', 'LEAVE', 'HOLIDAY', 'TRAINING')
                   AND (att.clock_in_time IS NOT NULL OR COALESCE(att.raw_minutes, 0) > 0) THEN 1 END) AS attended_shifts
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
     WHERE ${whereClause}
       AND ra.roster_date BETWEEN ? AND ?
       AND ${realRosterSql("ra")}
     GROUP BY e.id, e.employee_code, e.full_name
     HAVING planned_shifts >= 10`,
        [...params, first, last],
      );

  // Quality is role-specific (kpi_metric_master.family = 'quality'); kpi_score has metric_id, period char(7),
  // actual_value. Scoped to the same employees via a join (was an unscoped whole-company scan filtered in memory).
  const qualityP = db.execute<RowDataPacket[]>(
    `SELECT ks.employee_id, AVG(ks.actual_value) AS avg_quality
     FROM kpi_score ks
     JOIN kpi_metric_master km ON km.id = ks.metric_id
     JOIN employees e ON e.id = ks.employee_id
     WHERE km.family = 'quality'
       AND ks.period = ?
       AND ks.actual_value IS NOT NULL
       AND ${whereClause}
     GROUP BY ks.employee_id`,
    [period, ...params],
  );

  const [[adherenceRows], [qualityRows]] = await Promise.all([
    adherenceP,
    qualityP,
  ]);

  const qualityMap = new Map<string, number>();
  for (const q of qualityRows) {
    if (q.avg_quality !== null && q.avg_quality !== undefined)
      qualityMap.set(String(q.employee_id), Number(q.avg_quality));
  }

  const employees: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    adherencePct: number;
    qualityPct: number;
  }> = [];
  for (const a of adherenceRows) {
    const empId = String(a.employee_id);
    const planned = Number(a.planned_shifts);
    if (!(planned > 0) || !qualityMap.has(empId)) continue; // only employees with BOTH measures
    employees.push({
      employeeId: empId,
      employeeCode: String(a.employee_code),
      employeeName: String(a.employee_name),
      adherencePct: round1((Number(a.attended_shifts) / planned) * 100),
      qualityPct: round1(qualityMap.get(empId)!),
    });
  }

  const r = pearson(
    employees.map((e) => e.adherencePct),
    employees.map((e) => e.qualityPct),
    5,
  );
  const insufficientData = r === null;
  const coefficient = r ?? 0;

  let interpretation: QualityCorrelation["correlation"]["interpretation"];
  let insight: string;
  if (insufficientData) {
    interpretation = "WEAK";
    insight =
      employees.length < 5
        ? `Not enough data — need at least 5 employees with both attendance and quality scores (have ${employees.length}).`
        : "No variation in attendance or quality across employees — correlation cannot be computed.";
  } else if (coefficient >= 0.7) {
    interpretation = "STRONG_POSITIVE";
    insight =
      "High attendance strongly correlates with high quality — attendance interventions will likely improve quality.";
  } else if (coefficient >= 0.4) {
    interpretation = "MODERATE_POSITIVE";
    insight =
      "Moderate positive correlation — improving attendance may help quality, but other factors are also significant.";
  } else if (coefficient >= -0.4) {
    interpretation = "WEAK";
    insight =
      "Weak correlation — quality and attendance appear largely independent. Focus on each separately.";
  } else if (coefficient >= -0.7) {
    interpretation = "MODERATE_NEGATIVE";
    insight =
      "Unusual negative correlation — high performers may be burning out. Investigate workload balance.";
  } else {
    interpretation = "STRONG_NEGATIVE";
    insight =
      "Strong negative correlation — critical anomaly. High performers with low attendance may indicate management issues.";
  }

  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  const high = employees.filter((e) => e.adherencePct >= 90);
  const medium = employees.filter(
    (e) => e.adherencePct >= 70 && e.adherencePct < 90,
  );
  const low = employees.filter((e) => e.adherencePct < 70);
  const segments = {
    highAdherence: {
      count: high.length,
      avgQuality: round1(avg(high.map((e) => e.qualityPct))),
      adherenceRange: "90-100%",
    },
    mediumAdherence: {
      count: medium.length,
      avgQuality: round1(avg(medium.map((e) => e.qualityPct))),
      adherenceRange: "70-89%",
    },
    lowAdherence: {
      count: low.length,
      avgQuality: round1(avg(low.map((e) => e.qualityPct))),
      adherenceRange: "<70%",
    },
  };

  const avgAdherence = avg(employees.map((e) => e.adherencePct));
  const avgQuality = avg(employees.map((e) => e.qualityPct));
  const outliers = employees
    .map((e) => {
      const dq = e.qualityPct - avgQuality;
      const da = e.adherencePct - avgAdherence;
      let category: QualityCorrelation["outliers"][0]["category"];
      if (dq >= 10 && da < -10) category = "HIGH_QUALITY_LOW_ATTENDANCE";
      else if (dq < -10 && da >= 10) category = "LOW_QUALITY_HIGH_ATTENDANCE";
      else if (dq < -10 && da < -10) category = "BOTH_LOW";
      else if (dq >= 10 && da >= 10) category = "BOTH_HIGH";
      else return null;
      return { ...e, category, _dev: Math.abs(dq) + Math.abs(da) };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    // Most extreme first, THEN cap (the cap used to cut an arbitrary, unsorted slice).
    .sort((a, b) => b._dev - a._dev)
    .slice(0, 15)
    .map(({ _dev, ...rest }) => rest);

  const actionableInsights: string[] = [];
  if (
    segments.lowAdherence.count > 0 &&
    segments.highAdherence.count > 0 &&
    segments.lowAdherence.avgQuality < segments.highAdherence.avgQuality - 15
  ) {
    actionableInsights.push(
      `Low-attendance employees score ${round1(segments.highAdherence.avgQuality - segments.lowAdherence.avgQuality)} points lower on quality — attendance coaching could improve both metrics.`,
    );
  }
  const hqla = outliers.filter(
    (o) => o.category === "HIGH_QUALITY_LOW_ATTENDANCE",
  );
  if (hqla.length > 0)
    actionableInsights.push(
      `${hqla.length} high-quality employees have attendance issues — retention risk, consider 1:1 check-ins.`,
    );
  const bothLow = outliers.filter((o) => o.category === "BOTH_LOW");
  if (bothLow.length > 0)
    actionableInsights.push(
      `${bothLow.length} employees are struggling on both metrics — candidate for intensive support or PIP review.`,
    );

  return {
    period,
    branchId,
    processId,
    sampleSize: employees.length,
    insufficientData,
    correlation: { coefficient, interpretation, insight },
    segments,
    outliers,
    actionableInsights,
  };
}

// ── Cost of Non-Adherence ────────────────────────────────────────────────────

export async function getCostOfNonAdherence(
  period: string, // YYYY-MM
  branchId?: string,
  processId?: string,
  lob: LobFilter = { kind: "none" },
): Promise<CostOfNonAdherence> {
  const { first, last, empty } = periodBounds(period);
  const { conditions, params } = employeeScope(branchId, processId, lob);

  const rows = empty
    ? []
    : (
        await db.execute<RowDataPacket[]>(
          `SELECT
       ra.roster_date,
       ra.assignment_type,
       ra.shift_start_time,
       ra.shift_end_time,
       st.start_time AS template_start,
       st.end_time AS template_end,
       att.clock_in_time AS first_in,
       att.raw_minutes / 60 AS total_hours
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
     LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
     WHERE ${conditions.join(" AND ")}
       AND COALESCE(ra.assignment_type, '') NOT IN ('WEEK_OFF', 'HOLIDAY')
       AND ra.roster_date BETWEEN ? AND ?
       AND ${realRosterSql("ra")}`,
          [...params, first, last],
        )
      )[0];

  let planned = 0,
    worked = 0,
    absent = 0,
    late = 0,
    early = 0,
    incomplete = 0;
  // Leave / training are planned non-production time, not non-adherence — classifyRow excludes them from hours.
  for (const r of rows) {
    const o = classifyRow(r as any);
    if (!o.isPlanned) continue;
    planned += o.expectedHours;
    worked += o.workedCapped;
    absent += o.lostAbsent;
    late += o.lostLate;
    early += o.lostEarly;
    incomplete += o.lostIncomplete;
  }

  // planned = worked(capped) + lost, and lost = absent + late + early + incomplete exactly (no double counting).
  const hoursLost = absent + late + early + incomplete;
  const cost = (h: number) => Math.round(h * DEFAULT_HOURLY_COST_INR);
  const directCostLoss = cost(hoursLost);
  const currentShrinkage =
    planned > 0 ? round1((hoursLost / planned) * 100) : 0;
  const annualProjection = directCostLoss * 12;
  // "5% improvement" = 5 percentage points less shrinkage on the same planned hours (was 5% of the cost, i.e. ~0.6pp).
  const improvedLostHours = Math.max(0, hoursLost - planned * 0.05);
  const improvedProjection = cost(improvedLostHours) * 12;

  return {
    period,
    scope: { branchId, processId },
    assumptions: {
      hourlyCostINR: DEFAULT_HOURLY_COST_INR,
      costSource: "default_constant",
      shortShiftPct: SHORT_SHIFT_PCT,
    },
    metrics: {
      totalPlannedHours: round1(planned),
      actualWorkedHours: round1(worked),
      hoursLost: round1(hoursLost),
      avgHourlyCostINR: DEFAULT_HOURLY_COST_INR,
      directCostLossINR: directCostLoss,
      productivityImpactPct: currentShrinkage,
    },
    breakdown: {
      unplannedAbsenceCost: cost(absent),
      lateCost: cost(late),
      earlyDepartureCost: cost(early),
      incompleteShiftCost: cost(incomplete),
    },
    projectedAnnual: {
      currentTrend: annualProjection,
      ifImproved5Pct: improvedProjection,
      potentialSavings: annualProjection - improvedProjection,
    },
    benchmarks: {
      industryAvgShrinkage: INDUSTRY_AVG_SHRINKAGE,
      currentShrinkage,
      gapPct: round1(currentShrinkage - INDUSTRY_AVG_SHRINKAGE),
    },
  };
}
