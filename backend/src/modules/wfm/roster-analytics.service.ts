/**
 * Roster Analytics Service — Phase 2
 *
 * 1. Weekly Shrinkage Intelligence — detailed breakdown with cost impact
 * 2. Roster-Quality Correlation — does low adherence = low quality?
 * 3. Cost of Non-Adherence — revenue/productivity impact calculation
 * 4. Shrinkage Forecasting — pattern detection for proactive planning
 */
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { lobAnd, type LobFilter } from "../../shared/lobFilter.js";
import {
  DEFAULT_HOURLY_COST_INR,
  INDUSTRY_AVG_SHRINKAGE,
  addDays,
  buildForecast,
  classifyRow,
  dayNameOf,
  localDateStr,
  realRosterSql,
  round1,
  mondayOf,
  type RosterRow,
} from "./roster-analytics.calc.js";

export { getQualityAdherenceCorrelation } from "./roster-analytics-quality.service.js";
export { getCostOfNonAdherence } from "./roster-analytics-quality.service.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShrinkageBreakdown {
  plannedLeave: { count: number; pct: number };
  unplannedAbsence: { count: number; pct: number };
  lateArrival: { count: number; pct: number };
  earlyDeparture: { count: number; pct: number };
  training: { count: number; pct: number };
  total: { count: number; pct: number };
}

export interface WeeklyShrinkageIntelligence {
  branchId: string;
  branchName: string;
  weekStart: string;
  weekEnd: string;
  breakdown: ShrinkageBreakdown;
  budgetPct: number;
  varianceFromBudget: number;
  trendVsPrevWeek: number;
  /** Previous-week shrinkage % on the same definition (additive). */
  prevWeekPct?: number;
  costImpact: {
    hoursLost: number;
    estimatedCostINR: number;
    productivityLossPct: number;
  };
  dayOfWeekPattern: Array<{
    day: string;
    /** YYYY-MM-DD (additive; drives the day drill-down). */
    date?: string;
    shrinkagePct: number;
    isHighRisk: boolean;
  }>;
  managerRanking: Array<{
    managerId: string;
    managerName: string;
    teamSize: number;
    shrinkagePct: number;
    unplannedCount: number;
    rank: number;
  }>;
  processRanking: Array<{
    processId: string;
    processName: string;
    planned: number;
    shrinkagePct: number;
  }>;
}

export interface QualityCorrelation {
  period: string;
  branchId?: string;
  processId?: string;
  /** Employees with both adherence and quality data (additive). */
  sampleSize?: number;
  /** True when sampleSize < 5, so coefficient is not meaningful (additive). */
  insufficientData?: boolean;
  correlation: {
    coefficient: number;
    interpretation:
      | "STRONG_NEGATIVE"
      | "MODERATE_NEGATIVE"
      | "WEAK"
      | "MODERATE_POSITIVE"
      | "STRONG_POSITIVE";
    insight: string;
  };
  segments: {
    highAdherence: {
      count: number;
      avgQuality: number;
      adherenceRange: string;
    };
    mediumAdherence: {
      count: number;
      avgQuality: number;
      adherenceRange: string;
    };
    lowAdherence: { count: number; avgQuality: number; adherenceRange: string };
  };
  outliers: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    adherencePct: number;
    qualityPct: number;
    category:
      | "HIGH_QUALITY_LOW_ATTENDANCE"
      | "LOW_QUALITY_HIGH_ATTENDANCE"
      | "BOTH_LOW"
      | "BOTH_HIGH";
  }>;
  actionableInsights: string[];
}

export interface CostOfNonAdherence {
  period: string;
  scope: { branchId?: string; processId?: string };
  /** How the figures were built (additive; shown in the UI so the assumption is visible). */
  assumptions?: {
    hourlyCostINR: number;
    costSource: "default_constant";
    shortShiftPct: number;
  };
  metrics: {
    totalPlannedHours: number;
    actualWorkedHours: number;
    hoursLost: number;
    avgHourlyCostINR: number;
    directCostLossINR: number;
    productivityImpactPct: number;
  };
  breakdown: {
    unplannedAbsenceCost: number;
    lateCost: number;
    earlyDepartureCost: number;
    incompleteShiftCost: number;
  };
  projectedAnnual: {
    currentTrend: number;
    ifImproved5Pct: number;
    potentialSavings: number;
  };
  benchmarks: {
    industryAvgShrinkage: number;
    currentShrinkage: number;
    gapPct: number;
  };
}

export interface ShrinkageForecast {
  branchId: string;
  nextWeek: {
    weekStart: string;
    predictedShrinkagePct: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    riskDays: Array<{
      date: string;
      day: string;
      predictedPct: number;
      reason: string;
    }>;
  };
  patterns: {
    mondayEffect: number;
    fridayEffect: number;
    monthEndEffect: number;
    festivalProximity: boolean;
  };
  recommendations: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

export { DEFAULT_HOURLY_COST_INR, INDUSTRY_AVG_SHRINKAGE };

// ── Weekly Shrinkage Intelligence ────────────────────────────────────────────

const DEFAULT_BUDGET_PCT = 8;

/** Roster + attendance rows for one branch over [from, to]; shared by the week, prev-week and drill-down paths. */
export async function fetchBranchRosterRows(
  branchId: string,
  from: string,
  to: string,
  lob: LobFilter,
  processId?: string,
): Promise<Array<Record<string, any>>> {
  const lobSql = lobAnd(lob);
  const proc = processId
    ? { sql: " AND e.process_id = ?", params: [processId] }
    : { sql: "", params: [] as string[] };
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       e.full_name AS employee_name,
       e.reporting_manager_id,
       e.process_id,
       mgr.full_name AS manager_name,
       pm.process_name,
       ra.roster_date,
       ra.assignment_type,
       ra.shift_start_time,
       ra.shift_end_time,
       st.start_time AS template_start,
       st.end_time AS template_end,
       att.clock_in_time AS first_in,
       att.clock_out_time AS last_out,
       att.raw_minutes / 60 AS total_hours
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
     LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
     LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
     LEFT JOIN process_master pm ON pm.id = e.process_id
     WHERE e.branch_id = ?
       AND e.active_status = 1${lobSql.sql}${proc.sql}
       AND ra.roster_date BETWEEN ? AND ?
       AND ${realRosterSql("ra")}`,
    [branchId, ...lobSql.params, ...proc.params, from, to],
  );
  return rows as Array<Record<string, any>>;
}

interface Bucket {
  base: number;
  shrink: number;
  planned: number;
  unplanned: number;
  name: string;
}
const newBucket = (name: string): Bucket => ({
  base: 0,
  shrink: 0,
  planned: 0,
  unplanned: 0,
  name,
});

/** Tally a set of roster rows into the weekly breakdown (pure; `now` injectable for tests). */
export function tallyWeek(
  rows: Array<Record<string, any>>,
  dates: string[],
  now: Date = new Date(),
) {
  let plannedLeave = 0,
    unplannedAbsence = 0,
    lateArrival = 0,
    earlyDeparture = 0,
    training = 0;
  let totalPlanned = 0,
    plannedHours = 0,
    hoursLost = 0;
  const day = new Map<string, { base: number; shrink: number }>(
    dates.map((d) => [d, { base: 0, shrink: 0 }]),
  );
  const mgr = new Map<string, Bucket>();
  const proc = new Map<string, Bucket>();

  for (const r of rows) {
    const o = classifyRow(r as RosterRow, now);
    if (!o.inBase) continue;
    const dateKey = String(r.roster_date).slice(0, 10);
    const mId = r.reporting_manager_id
      ? String(r.reporting_manager_id)
      : "unknown";
    const pId = r.process_id ? String(r.process_id) : "unknown";
    if (!mgr.has(mId))
      mgr.set(
        mId,
        newBucket(r.manager_name ? String(r.manager_name) : "Unknown"),
      );
    if (!proc.has(pId))
      proc.set(
        pId,
        newBucket(r.process_name ? String(r.process_name) : "Unknown"),
      );
    const m = mgr.get(mId)!,
      p = proc.get(pId)!,
      d = day.get(dateKey);

    // Every counted row is in the denominator of its day / manager / process AND of the headline
    // (previously leave/training were in the numerator but not the per-day/manager/process denominator, so those % could exceed 100).
    m.base++;
    p.base++;
    if (d) d.base++;
    if (o.isShrinkage) {
      m.shrink++;
      p.shrink++;
      if (d) d.shrink++;
    }

    if (o.status === "LEAVE") plannedLeave++;
    else if (o.status === "TRAINING") training++;
    else {
      totalPlanned++;
      plannedHours += o.expectedHours;
      hoursLost += o.hoursLost;
      m.planned++;
      p.planned++;
      if (o.status === "ABSENT") {
        unplannedAbsence++;
        m.unplanned++;
      } else {
        if (o.late) lateArrival++;
        if (o.short) earlyDeparture++;
      }
    }
  }

  const shrinkCount = plannedLeave + unplannedAbsence + training;
  const base = totalPlanned + plannedLeave + training;
  const pct = (n: number, den: number) =>
    den > 0 ? round1((n / den) * 100) : 0;
  const breakdown: ShrinkageBreakdown = {
    plannedLeave: { count: plannedLeave, pct: pct(plannedLeave, base) },
    unplannedAbsence: {
      count: unplannedAbsence,
      pct: pct(unplannedAbsence, base),
    },
    lateArrival: { count: lateArrival, pct: pct(lateArrival, totalPlanned) },
    earlyDeparture: {
      count: earlyDeparture,
      pct: pct(earlyDeparture, totalPlanned),
    },
    training: { count: training, pct: pct(training, base) },
    total: { count: shrinkCount, pct: pct(shrinkCount, base) },
  };
  return {
    breakdown,
    totalPlanned,
    plannedHours,
    hoursLost,
    day,
    mgr,
    proc,
    base,
  };
}

export async function getWeeklyShrinkageIntelligence(
  branchId: string,
  weekStartDate: string,
  lob: LobFilter = { kind: "none" },
  processId?: string,
): Promise<WeeklyShrinkageIntelligence> {
  const start = weekStartDate;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const end = dates[6];
  const prevStart = addDays(start, -7);

  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name FROM branch_master WHERE id = ?`,
    [branchId],
  );
  const branchName = branchRows[0]?.branch_name
    ? String(branchRows[0].branch_name)
    : "Unknown";

  const [rows, prevRows, budgetPct] = await Promise.all([
    fetchBranchRosterRows(branchId, start, end, lob, processId),
    fetchBranchRosterRows(
      branchId,
      prevStart,
      addDays(prevStart, 6),
      lob,
      processId,
    ).catch(() => null),
    loadBudgetPct(branchId),
  ]);

  const now = new Date();
  const t = tallyWeek(rows, dates, now);
  const { breakdown } = t;

  // Previous week on the SAME definition (was a separate SQL that ignored the not-due guard, NULL types and the synthetic-roster guard).
  let trendVsPrevWeek = 0;
  let prevWeekPct: number | undefined;
  if (prevRows) {
    const p = tallyWeek(
      prevRows,
      Array.from({ length: 7 }, (_, i) => addDays(prevStart, i)),
      now,
    );
    if (p.base > 0) {
      prevWeekPct = p.breakdown.total.pct;
      trendVsPrevWeek = round1(breakdown.total.pct - p.breakdown.total.pct);
    }
  }

  const dayOfWeekPattern = dates.map((d) => {
    const s = t.day.get(d)!;
    const pct = s.base > 0 ? round1((s.shrink / s.base) * 100) : 0;
    return {
      day: dayNameOf(d),
      date: d,
      shrinkagePct: pct,
      isHighRisk: pct > budgetPct * 1.5,
    };
  });

  const managerRanking = [...t.mgr.entries()]
    .filter(([, s]) => s.base > 0)
    .map(([id, s]) => ({
      managerId: id,
      managerName: s.name,
      teamSize: s.base,
      shrinkagePct: round1((s.shrink / s.base) * 100),
      unplannedCount: s.unplanned,
      rank: 0,
    }))
    .sort((a, b) => b.shrinkagePct - a.shrinkagePct || b.teamSize - a.teamSize);
  managerRanking.forEach((m, i) => {
    m.rank = i + 1;
  });

  const processRanking = [...t.proc.entries()]
    .filter(([, s]) => s.base > 0)
    .map(([id, s]) => ({
      processId: id,
      processName: s.name,
      planned: s.base,
      shrinkagePct: round1((s.shrink / s.base) * 100),
    }))
    .sort((a, b) => b.shrinkagePct - a.shrinkagePct || b.planned - a.planned);

  return {
    branchId,
    branchName,
    weekStart: start,
    weekEnd: end,
    breakdown,
    budgetPct,
    varianceFromBudget: round1(breakdown.total.pct - budgetPct),
    trendVsPrevWeek,
    prevWeekPct,
    costImpact: {
      hoursLost: round1(t.hoursLost),
      estimatedCostINR: Math.round(t.hoursLost * DEFAULT_HOURLY_COST_INR),
      // Denominator is the planned hours actually scheduled (was totalPlanned * 8, wrong for 9h / 4h shifts).
      productivityLossPct:
        t.plannedHours > 0 ? round1((t.hoursLost / t.plannedHours) * 100) : 0,
    },
    dayOfWeekPattern,
    managerRanking: managerRanking.slice(0, 10),
    processRanking: processRanking.slice(0, 10),
  };
}

export async function loadBudgetPct(branchId: string): Promise<number> {
  try {
    const [mandateRows] = await db.execute<RowDataPacket[]>(
      `SELECT SUM(mandated_hc * shrinkage_pct) / NULLIF(SUM(mandated_hc), 0) AS shrinkage_buffer_pct
         FROM workforce_mandate WHERE branch_id = ? AND active_status = 1`,
      [branchId],
    );
    const v = mandateRows[0]?.shrinkage_buffer_pct;
    // A configured 0% budget is valid (was treated as "unset" by a truthiness check).
    if (v !== null && v !== undefined && Number.isFinite(Number(v)))
      return Number(v);
  } catch {
    /* use default */
  }
  return DEFAULT_BUDGET_PCT;
}

// ── Shrinkage Forecast ───────────────────────────────────────────────────────

export async function getShrinkageForecast(
  branchId: string,
  lob: LobFilter = { kind: "none" },
  processId?: string,
): Promise<ShrinkageForecast> {
  const lobSql = lobAnd(lob);
  const proc = processId
    ? { sql: " AND e.process_id = ?", params: [processId] }
    : { sql: "", params: [] as string[] };
  const now = new Date();
  const today = localDateStr(now);
  const weekStart = addDays(mondayOf(now), 7);
  // History ends YESTERDAY: today's rows have no final attendance yet and read as absent.
  const histTo = addDays(today, -1);
  const histFrom = addDays(today, -56);

  const [patternRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       DAYOFWEEK(ra.roster_date) AS dow,
       DAY(ra.roster_date) AS dom,
       COUNT(CASE WHEN COALESCE(ra.assignment_type, '') NOT IN ('WEEK_OFF', 'HOLIDAY') THEN 1 END) AS planned,
       COUNT(CASE WHEN COALESCE(ra.assignment_type, '') NOT IN ('WEEK_OFF', 'HOLIDAY', 'LEAVE', 'TRAINING')
                   AND att.clock_in_time IS NULL AND COALESCE(att.raw_minutes, 0) = 0 THEN 1 END) AS absent
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
     WHERE e.branch_id = ?
       AND e.active_status = 1${lobSql.sql}${proc.sql}
       AND ra.roster_date BETWEEN ? AND ?
       AND ${realRosterSql("ra")}
     GROUP BY DAYOFWEEK(ra.roster_date), DAY(ra.roster_date)`,
    [branchId, ...lobSql.params, ...proc.params, histFrom, histTo],
  );

  const dow = new Map<number, { planned: number; absent: number }>();
  const dom = new Map<number, { planned: number; absent: number }>();
  const add = (
    m: Map<number, { planned: number; absent: number }>,
    k: number,
    p: number,
    a: number,
  ) => {
    const b = m.get(k) ?? { planned: 0, absent: 0 };
    b.planned += p;
    b.absent += a;
    m.set(k, b);
  };
  for (const r of patternRows) {
    const p = Number(r.planned) || 0,
      a = Number(r.absent) || 0;
    add(dow, Number(r.dow) - 1, p, a); // MySQL DAYOFWEEK 1=Sunday -> JS 0=Sunday
    add(dom, Number(r.dom), p, a);
  }

  const f = buildForecast({ dow, dom }, weekStart);
  const riskDays = f.days
    .filter((d) => d.reasons.length > 0 || d.predictedPct > f.baseRate * 1.3)
    .map((d) => ({
      date: d.date,
      day: d.day,
      predictedPct: d.predictedPct,
      reason: d.reasons.join(", ") || "Historical pattern",
    }));

  const recommendations: string[] = [];
  if (f.mondayEffect > 3)
    recommendations.push(
      "Consider Monday motivation initiatives — historically higher absence.",
    );
  if (f.fridayEffect > 3)
    recommendations.push(
      "Friday attendance drops significantly — review scheduling and half-day options.",
    );
  if (f.monthEndEffect > 3)
    recommendations.push(
      "Month-end sees higher absence — may correlate with salary disbursement.",
    );
  if (riskDays.length >= 3)
    recommendations.push(
      "Multiple high-risk days next week — pre-emptive manager outreach recommended.",
    );

  return {
    branchId,
    nextWeek: {
      weekStart,
      predictedShrinkagePct: f.avgPredicted,
      confidence:
        patternRows.length >= 30
          ? "HIGH"
          : patternRows.length >= 15
            ? "MEDIUM"
            : "LOW",
      riskDays,
    },
    patterns: {
      mondayEffect: f.mondayEffect,
      fridayEffect: f.fridayEffect,
      monthEndEffect: f.monthEndEffect,
      festivalProximity: false, // Would need festival calendar integration
    },
    recommendations,
  };
}
