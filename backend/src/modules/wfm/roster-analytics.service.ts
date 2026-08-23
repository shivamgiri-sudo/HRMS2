/**
 * Roster Analytics Service — Phase 2
 *
 * 1. Weekly Shrinkage Intelligence — detailed breakdown with cost impact
 * 2. Roster-Quality Correlation — does low adherence = low quality?
 * 3. Cost of Non-Adherence — revenue/productivity impact calculation
 * 4. Shrinkage Forecasting — pattern detection for proactive planning
 */
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

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
  costImpact: {
    hoursLost: number;
    estimatedCostINR: number;
    productivityLossPct: number;
  };
  dayOfWeekPattern: Array<{
    day: string;
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
  correlation: {
    coefficient: number;
    interpretation: 'STRONG_NEGATIVE' | 'MODERATE_NEGATIVE' | 'WEAK' | 'MODERATE_POSITIVE' | 'STRONG_POSITIVE';
    insight: string;
  };
  segments: {
    highAdherence: { count: number; avgQuality: number; adherenceRange: string };
    mediumAdherence: { count: number; avgQuality: number; adherenceRange: string };
    lowAdherence: { count: number; avgQuality: number; adherenceRange: string };
  };
  outliers: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    adherencePct: number;
    qualityPct: number;
    category: 'HIGH_QUALITY_LOW_ATTENDANCE' | 'LOW_QUALITY_HIGH_ATTENDANCE' | 'BOTH_LOW' | 'BOTH_HIGH';
  }>;
  actionableInsights: string[];
}

export interface CostOfNonAdherence {
  period: string;
  scope: { branchId?: string; processId?: string };
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
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    riskDays: Array<{ date: string; day: string; predictedPct: number; reason: string }>;
  };
  patterns: {
    mondayEffect: number;
    fridayEffect: number;
    monthEndEffect: number;
    festivalProximity: boolean;
  };
  recommendations: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeToMinutes(t: string): number {
  const parts = t.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getWeekDates(weekStart: string): { start: string; end: string; dates: string[] } {
  const start = new Date(weekStart);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(formatDate(d));
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start: weekStart, end: formatDate(end), dates };
}

function getDayName(dateStr: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date(dateStr).getDay()];
}

const GRACE_MINUTES = 5;
const INCOMPLETE_THRESHOLD_PCT = 80;
const DEFAULT_HOURLY_COST_INR = 150; // Average BPO agent cost per hour
const INDUSTRY_AVG_SHRINKAGE = 12; // BPO industry benchmark

// ── Weekly Shrinkage Intelligence ────────────────────────────────────────────

export async function getWeeklyShrinkageIntelligence(
  branchId: string,
  weekStartDate: string
): Promise<WeeklyShrinkageIntelligence> {
  const { start, end, dates } = getWeekDates(weekStartDate);

  // Get branch info
  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name FROM branch_master WHERE id = ?`,
    [branchId]
  );
  const branchName = branchRows[0]?.branch_name ? String(branchRows[0].branch_name) : 'Unknown';

  // Get roster + attendance data
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
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
       AND e.active_status = 1
       AND ra.roster_date BETWEEN ? AND ?`,
    [branchId, start, end]
  );

  // Initialize counters
  let plannedLeave = 0, unplannedAbsence = 0, lateArrival = 0, earlyDeparture = 0, training = 0;
  let totalPlanned = 0, totalPresent = 0;
  let totalHoursLost = 0;

  // Day-of-week tracking
  const dayStats = new Map<string, { planned: number; shrinkage: number }>();
  for (const d of dates) {
    dayStats.set(d, { planned: 0, shrinkage: 0 });
  }

  // Manager tracking
  const managerStats = new Map<string, { name: string; teamDays: number; shrinkageDays: number; unplanned: number }>();

  // Process tracking
  const processStats = new Map<string, { name: string; planned: number; shrinkage: number }>();

  for (const r of rows) {
    const type = String(r.assignment_type ?? '').toUpperCase();
    const dateKey = formatDate(new Date(r.roster_date));
    const managerId = r.reporting_manager_id ? String(r.reporting_manager_id) : 'unknown';
    const managerName = r.manager_name ? String(r.manager_name) : 'Unknown';
    const processId = r.process_id ? String(r.process_id) : 'unknown';
    const processName = r.process_name ? String(r.process_name) : 'Unknown';

    // Initialize manager stats
    if (!managerStats.has(managerId)) {
      managerStats.set(managerId, { name: managerName, teamDays: 0, shrinkageDays: 0, unplanned: 0 });
    }
    const mgrStat = managerStats.get(managerId)!;

    // Initialize process stats
    if (!processStats.has(processId)) {
      processStats.set(processId, { name: processName, planned: 0, shrinkage: 0 });
    }
    const procStat = processStats.get(processId)!;

    // Day stats
    const dayStat = dayStats.get(dateKey);

    if (type === 'LEAVE') {
      plannedLeave++;
      if (dayStat) dayStat.shrinkage++;
      mgrStat.shrinkageDays++;
      procStat.shrinkage++;
    } else if (type === 'TRAINING') {
      training++;
      if (dayStat) dayStat.shrinkage++;
      mgrStat.shrinkageDays++;
      procStat.shrinkage++;
    } else if (type === 'WEEK_OFF' || type === 'HOLIDAY') {
      // Not counted
    } else {
      // Working day
      totalPlanned++;
      if (dayStat) dayStat.planned++;
      mgrStat.teamDays++;
      procStat.planned++;

      const shiftStart = r.template_start || r.shift_start_time;
      const shiftEnd = r.template_end || r.shift_end_time;
      let expectedHours = 8;
      if (shiftStart && shiftEnd) {
        const startMin = timeToMinutes(String(shiftStart));
        const endMin = timeToMinutes(String(shiftEnd));
        expectedHours = (endMin >= startMin ? endMin - startMin : (24 * 60 - startMin) + endMin) / 60;
      }

      if (!r.first_in) {
        // Unplanned absence
        unplannedAbsence++;
        totalHoursLost += expectedHours;
        if (dayStat) dayStat.shrinkage++;
        mgrStat.shrinkageDays++;
        mgrStat.unplanned++;
        procStat.shrinkage++;
      } else {
        totalPresent++;
        const workedHours = Number(r.total_hours) || 0;
        const loginMin = timeToMinutes(String(r.first_in));
        const shiftStartMin = shiftStart ? timeToMinutes(String(shiftStart)) : 0;

        // Check late
        if (shiftStart && loginMin > shiftStartMin + GRACE_MINUTES) {
          lateArrival++;
          const lateHours = (loginMin - shiftStartMin) / 60;
          totalHoursLost += Math.min(lateHours, 2); // Cap at 2 hours
        }

        // Check early departure / incomplete
        if (workedHours < expectedHours * (INCOMPLETE_THRESHOLD_PCT / 100)) {
          earlyDeparture++;
          totalHoursLost += expectedHours - workedHours;
        }
      }
    }
  }

  const totalShrinkageCount = plannedLeave + unplannedAbsence + training;
  const totalBase = totalPlanned + plannedLeave + training;

  const breakdown: ShrinkageBreakdown = {
    plannedLeave: { count: plannedLeave, pct: totalBase > 0 ? round1(plannedLeave / totalBase * 100) : 0 },
    unplannedAbsence: { count: unplannedAbsence, pct: totalBase > 0 ? round1(unplannedAbsence / totalBase * 100) : 0 },
    lateArrival: { count: lateArrival, pct: totalPlanned > 0 ? round1(lateArrival / totalPlanned * 100) : 0 },
    earlyDeparture: { count: earlyDeparture, pct: totalPlanned > 0 ? round1(earlyDeparture / totalPlanned * 100) : 0 },
    training: { count: training, pct: totalBase > 0 ? round1(training / totalBase * 100) : 0 },
    total: { count: totalShrinkageCount, pct: totalBase > 0 ? round1(totalShrinkageCount / totalBase * 100) : 0 },
  };

  // Get budget from workforce_mandate
  let budgetPct = 8; // Default
  try {
    const [mandateRows] = await db.execute<RowDataPacket[]>(
      `SELECT shrinkage_buffer_pct FROM workforce_mandate WHERE branch_id = ? AND active_status = 1 LIMIT 1`,
      [branchId]
    );
    if (mandateRows[0]?.shrinkage_buffer_pct) {
      budgetPct = Number(mandateRows[0].shrinkage_buffer_pct);
    }
  } catch { /* use default */ }

  // Previous week comparison
  const prevWeekStart = new Date(start);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  let trendVsPrevWeek = 0;
  try {
    const [prevRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(CASE WHEN ra.assignment_type IN ('LEAVE', 'TRAINING') OR att.clock_in_time IS NULL THEN 1 END) AS shrinkage,
         COUNT(*) AS total
       FROM employees e
       JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
       LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
       WHERE e.branch_id = ?
         AND e.active_status = 1
         AND ra.roster_date BETWEEN ? AND ?
         AND ra.assignment_type NOT IN ('WEEK_OFF', 'HOLIDAY')`,
      [branchId, formatDate(prevWeekStart), formatDate(new Date(prevWeekStart.getTime() + 6 * 86400000))]
    );
    if (prevRows[0]?.total > 0) {
      const prevPct = (Number(prevRows[0].shrinkage) / Number(prevRows[0].total)) * 100;
      trendVsPrevWeek = round1(breakdown.total.pct - prevPct);
    }
  } catch { /* no trend data */ }

  // Day-of-week pattern
  const dayOfWeekPattern = dates.map(d => {
    const stat = dayStats.get(d)!;
    const pct = stat.planned > 0 ? round1(stat.shrinkage / stat.planned * 100) : 0;
    return {
      day: getDayName(d),
      shrinkagePct: pct,
      isHighRisk: pct > budgetPct * 1.5,
    };
  });

  // Manager ranking
  const managerRanking = [...managerStats.entries()]
    .filter(([_, s]) => s.teamDays > 0)
    .map(([id, s]) => ({
      managerId: id,
      managerName: s.name,
      teamSize: s.teamDays,
      shrinkagePct: round1(s.shrinkageDays / s.teamDays * 100),
      unplannedCount: s.unplanned,
      rank: 0,
    }))
    .sort((a, b) => b.shrinkagePct - a.shrinkagePct);
  managerRanking.forEach((m, i) => m.rank = i + 1);

  // Process ranking
  const processRanking = [...processStats.entries()]
    .filter(([_, s]) => s.planned > 0)
    .map(([id, s]) => ({
      processId: id,
      processName: s.name,
      planned: s.planned,
      shrinkagePct: round1(s.shrinkage / s.planned * 100),
    }))
    .sort((a, b) => b.shrinkagePct - a.shrinkagePct);

  return {
    branchId,
    branchName,
    weekStart: start,
    weekEnd: end,
    breakdown,
    budgetPct,
    varianceFromBudget: round1(breakdown.total.pct - budgetPct),
    trendVsPrevWeek,
    costImpact: {
      hoursLost: round1(totalHoursLost),
      estimatedCostINR: Math.round(totalHoursLost * DEFAULT_HOURLY_COST_INR),
      productivityLossPct: totalPlanned > 0 ? round1((totalHoursLost / (totalPlanned * 8)) * 100) : 0,
    },
    dayOfWeekPattern,
    managerRanking: managerRanking.slice(0, 10),
    processRanking: processRanking.slice(0, 10),
  };
}

// ── Quality-Adherence Correlation ────────────────────────────────────────────

export async function getQualityAdherenceCorrelation(
  period: string, // YYYY-MM
  branchId?: string,
  processId?: string
): Promise<QualityCorrelation> {
  const [year, month] = period.split('-').map(Number);
  const firstDay = `${period}-01`;
  const lastDay = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

  // Build WHERE clause
  const conditions = ['e.active_status = 1'];
  const params: unknown[] = [];
  if (branchId) {
    conditions.push('e.branch_id = ?');
    params.push(branchId);
  }
  if (processId) {
    conditions.push('e.process_id = ?');
    params.push(processId);
  }
  const whereClause = conditions.join(' AND ');

  // Get adherence data per employee
  const [adherenceRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       e.full_name AS employee_name,
       COUNT(CASE WHEN ra.assignment_type NOT IN ('WEEK_OFF', 'LEAVE', 'HOLIDAY', 'TRAINING') THEN 1 END) AS planned_shifts,
       COUNT(CASE WHEN ra.assignment_type NOT IN ('WEEK_OFF', 'LEAVE', 'HOLIDAY', 'TRAINING')
                   AND att.clock_in_time IS NOT NULL THEN 1 END) AS attended_shifts
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
     WHERE ${whereClause}
       AND ra.roster_date BETWEEN ? AND ?
     GROUP BY e.id, e.employee_code, e.full_name
     HAVING planned_shifts >= 10`,
    [...params, firstDay, lastDay]
  );

  // Get quality data per employee (from KPI scores)
  const [qualityRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       employee_id,
       AVG(score_value) AS avg_quality
     FROM kpi_score
     WHERE metric_code = 'QUALITY'
       AND score_date BETWEEN ? AND ?
     GROUP BY employee_id`,
    [firstDay, lastDay]
  );

  const qualityMap = new Map<string, number>();
  for (const q of qualityRows) {
    qualityMap.set(String(q.employee_id), Number(q.avg_quality) || 0);
  }

  // Combine data
  const employees: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    adherencePct: number;
    qualityPct: number;
  }> = [];

  for (const a of adherenceRows) {
    const empId = String(a.employee_id);
    const adherencePct = Number(a.planned_shifts) > 0
      ? round1((Number(a.attended_shifts) / Number(a.planned_shifts)) * 100)
      : 0;
    const qualityPct = qualityMap.get(empId) ?? 0;

    if (qualityPct > 0) { // Only include employees with quality data
      employees.push({
        employeeId: empId,
        employeeCode: String(a.employee_code),
        employeeName: String(a.employee_name),
        adherencePct,
        qualityPct: round1(qualityPct),
      });
    }
  }

  // Calculate correlation coefficient
  let coefficient = 0;
  if (employees.length >= 5) {
    const n = employees.length;
    const sumX = employees.reduce((s, e) => s + e.adherencePct, 0);
    const sumY = employees.reduce((s, e) => s + e.qualityPct, 0);
    const sumXY = employees.reduce((s, e) => s + e.adherencePct * e.qualityPct, 0);
    const sumX2 = employees.reduce((s, e) => s + e.adherencePct ** 2, 0);
    const sumY2 = employees.reduce((s, e) => s + e.qualityPct ** 2, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
    coefficient = denominator > 0 ? round2(numerator / denominator) : 0;
  }

  // Interpret correlation
  let interpretation: QualityCorrelation['correlation']['interpretation'];
  let insight: string;
  if (coefficient >= 0.7) {
    interpretation = 'STRONG_POSITIVE';
    insight = 'High attendance strongly correlates with high quality — attendance interventions will likely improve quality.';
  } else if (coefficient >= 0.4) {
    interpretation = 'MODERATE_POSITIVE';
    insight = 'Moderate positive correlation — improving attendance may help quality, but other factors are also significant.';
  } else if (coefficient >= -0.4) {
    interpretation = 'WEAK';
    insight = 'Weak correlation — quality and attendance appear largely independent. Focus on each separately.';
  } else if (coefficient >= -0.7) {
    interpretation = 'MODERATE_NEGATIVE';
    insight = 'Unusual negative correlation — high performers may be burning out. Investigate workload balance.';
  } else {
    interpretation = 'STRONG_NEGATIVE';
    insight = 'Strong negative correlation — critical anomaly. High performers with low attendance may indicate management issues.';
  }

  // Segment employees
  const highAdherence = employees.filter(e => e.adherencePct >= 90);
  const mediumAdherence = employees.filter(e => e.adherencePct >= 70 && e.adherencePct < 90);
  const lowAdherence = employees.filter(e => e.adherencePct < 70);

  const segments = {
    highAdherence: {
      count: highAdherence.length,
      avgQuality: round1(highAdherence.length > 0 ? highAdherence.reduce((s, e) => s + e.qualityPct, 0) / highAdherence.length : 0),
      adherenceRange: '90-100%',
    },
    mediumAdherence: {
      count: mediumAdherence.length,
      avgQuality: round1(mediumAdherence.length > 0 ? mediumAdherence.reduce((s, e) => s + e.qualityPct, 0) / mediumAdherence.length : 0),
      adherenceRange: '70-89%',
    },
    lowAdherence: {
      count: lowAdherence.length,
      avgQuality: round1(lowAdherence.length > 0 ? lowAdherence.reduce((s, e) => s + e.qualityPct, 0) / lowAdherence.length : 0),
      adherenceRange: '<70%',
    },
  };

  // Find outliers
  const avgAdherence = employees.length > 0 ? employees.reduce((s, e) => s + e.adherencePct, 0) / employees.length : 0;
  const avgQuality = employees.length > 0 ? employees.reduce((s, e) => s + e.qualityPct, 0) / employees.length : 0;

  const outliers = employees
    .map(e => {
      let category: QualityCorrelation['outliers'][0]['category'];
      if (e.qualityPct >= avgQuality + 10 && e.adherencePct < avgAdherence - 10) {
        category = 'HIGH_QUALITY_LOW_ATTENDANCE';
      } else if (e.qualityPct < avgQuality - 10 && e.adherencePct >= avgAdherence + 10) {
        category = 'LOW_QUALITY_HIGH_ATTENDANCE';
      } else if (e.qualityPct < avgQuality - 10 && e.adherencePct < avgAdherence - 10) {
        category = 'BOTH_LOW';
      } else if (e.qualityPct >= avgQuality + 10 && e.adherencePct >= avgAdherence + 10) {
        category = 'BOTH_HIGH';
      } else {
        return null;
      }
      return { ...e, category };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .slice(0, 15);

  // Generate insights
  const actionableInsights: string[] = [];
  if (segments.lowAdherence.avgQuality < segments.highAdherence.avgQuality - 15) {
    actionableInsights.push(`Low-attendance employees have ${round1(segments.highAdherence.avgQuality - segments.lowAdherence.avgQuality)}% lower quality — attendance coaching could improve both metrics.`);
  }
  const highQualityLowAtt = outliers.filter(o => o.category === 'HIGH_QUALITY_LOW_ATTENDANCE');
  if (highQualityLowAtt.length > 0) {
    actionableInsights.push(`${highQualityLowAtt.length} high-quality employees have attendance issues — retention risk, consider 1:1 check-ins.`);
  }
  const bothLow = outliers.filter(o => o.category === 'BOTH_LOW');
  if (bothLow.length > 0) {
    actionableInsights.push(`${bothLow.length} employees are struggling on both metrics — candidate for intensive support or PIP review.`);
  }

  return {
    period,
    branchId,
    processId,
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
  processId?: string
): Promise<CostOfNonAdherence> {
  const [year, month] = period.split('-').map(Number);
  const firstDay = `${period}-01`;
  const lastDay = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

  const conditions = ['e.active_status = 1', "ra.assignment_type NOT IN ('WEEK_OFF', 'HOLIDAY')"];
  const params: unknown[] = [];
  if (branchId) {
    conditions.push('e.branch_id = ?');
    params.push(branchId);
  }
  if (processId) {
    conditions.push('e.process_id = ?');
    params.push(processId);
  }
  const whereClause = conditions.join(' AND ');

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
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
     WHERE ${whereClause}
       AND ra.roster_date BETWEEN ? AND ?`,
    [...params, firstDay, lastDay]
  );

  let totalPlannedHours = 0;
  let actualWorkedHours = 0;
  let unplannedAbsenceHours = 0;
  let lateHours = 0;
  let earlyDepartureHours = 0;
  let incompleteHours = 0;

  for (const r of rows) {
    const type = String(r.assignment_type ?? '').toUpperCase();
    if (type === 'LEAVE' || type === 'TRAINING') continue;

    const shiftStart = r.template_start || r.shift_start_time;
    const shiftEnd = r.template_end || r.shift_end_time;
    let expectedHours = 8;
    if (shiftStart && shiftEnd) {
      const startMin = timeToMinutes(String(shiftStart));
      const endMin = timeToMinutes(String(shiftEnd));
      expectedHours = (endMin >= startMin ? endMin - startMin : (24 * 60 - startMin) + endMin) / 60;
    }

    totalPlannedHours += expectedHours;

    if (!r.first_in) {
      unplannedAbsenceHours += expectedHours;
    } else {
      const workedHours = Number(r.total_hours) || 0;
      actualWorkedHours += workedHours;

      const loginMin = timeToMinutes(String(r.first_in));
      const shiftStartMin = shiftStart ? timeToMinutes(String(shiftStart)) : 0;

      if (shiftStart && loginMin > shiftStartMin + GRACE_MINUTES) {
        lateHours += Math.min((loginMin - shiftStartMin) / 60, 2);
      }

      if (workedHours < expectedHours * 0.9) {
        const lost = expectedHours - workedHours;
        if (workedHours < expectedHours * 0.5) {
          incompleteHours += lost;
        } else {
          earlyDepartureHours += lost;
        }
      }
    }
  }

  const hoursLost = totalPlannedHours - actualWorkedHours;
  const directCostLoss = Math.round(hoursLost * DEFAULT_HOURLY_COST_INR);

  const currentShrinkage = totalPlannedHours > 0 ? round1((hoursLost / totalPlannedHours) * 100) : 0;
  const annualProjection = directCostLoss * 12;
  const improvedProjection = Math.round(annualProjection * 0.95); // 5% improvement
  const potentialSavings = annualProjection - improvedProjection;

  return {
    period,
    scope: { branchId, processId },
    metrics: {
      totalPlannedHours: round1(totalPlannedHours),
      actualWorkedHours: round1(actualWorkedHours),
      hoursLost: round1(hoursLost),
      avgHourlyCostINR: DEFAULT_HOURLY_COST_INR,
      directCostLossINR: directCostLoss,
      productivityImpactPct: totalPlannedHours > 0 ? round1((hoursLost / totalPlannedHours) * 100) : 0,
    },
    breakdown: {
      unplannedAbsenceCost: Math.round(unplannedAbsenceHours * DEFAULT_HOURLY_COST_INR),
      lateCost: Math.round(lateHours * DEFAULT_HOURLY_COST_INR),
      earlyDepartureCost: Math.round(earlyDepartureHours * DEFAULT_HOURLY_COST_INR),
      incompleteShiftCost: Math.round(incompleteHours * DEFAULT_HOURLY_COST_INR),
    },
    projectedAnnual: {
      currentTrend: annualProjection,
      ifImproved5Pct: improvedProjection,
      potentialSavings,
    },
    benchmarks: {
      industryAvgShrinkage: INDUSTRY_AVG_SHRINKAGE,
      currentShrinkage,
      gapPct: round1(currentShrinkage - INDUSTRY_AVG_SHRINKAGE),
    },
  };
}

// ── Shrinkage Forecast ───────────────────────────────────────────────────────

export async function getShrinkageForecast(branchId: string): Promise<ShrinkageForecast> {
  const today = new Date();
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
  const weekStart = formatDate(nextMonday);

  // Get historical patterns (last 8 weeks)
  const eightWeeksAgo = new Date(today);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

  const [patternRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       DAYOFWEEK(ra.roster_date) AS dow,
       DAY(ra.roster_date) AS dom,
       COUNT(CASE WHEN ra.assignment_type NOT IN ('WEEK_OFF', 'HOLIDAY') THEN 1 END) AS planned,
       COUNT(CASE WHEN ra.assignment_type NOT IN ('WEEK_OFF', 'HOLIDAY', 'LEAVE', 'TRAINING')
                   AND att.clock_in_time IS NULL THEN 1 END) AS absent
     FROM employees e
     JOIN wfm_roster_assignment ra ON ra.employee_id = e.id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ra.roster_date
     WHERE e.branch_id = ?
       AND e.active_status = 1
       AND ra.roster_date BETWEEN ? AND ?
     GROUP BY DAYOFWEEK(ra.roster_date), DAY(ra.roster_date)`,
    [branchId, formatDate(eightWeeksAgo), formatDate(today)]
  );

  // Calculate day-of-week patterns (Monday=2, Friday=6 in MySQL)
  const dowPatterns = new Map<number, { planned: number; absent: number }>();
  const domPatterns = new Map<number, { planned: number; absent: number }>();

  for (const r of patternRows) {
    const dow = Number(r.dow);
    const dom = Number(r.dom);
    const planned = Number(r.planned) || 0;
    const absent = Number(r.absent) || 0;

    if (!dowPatterns.has(dow)) dowPatterns.set(dow, { planned: 0, absent: 0 });
    const dowP = dowPatterns.get(dow)!;
    dowP.planned += planned;
    dowP.absent += absent;

    if (!domPatterns.has(dom)) domPatterns.set(dom, { planned: 0, absent: 0 });
    const domP = domPatterns.get(dom)!;
    domP.planned += planned;
    domP.absent += absent;
  }

  // Monday effect (dow=2), Friday effect (dow=6)
  const mondayP = dowPatterns.get(2) || { planned: 1, absent: 0 };
  const fridayP = dowPatterns.get(6) || { planned: 1, absent: 0 };
  const avgP = [...dowPatterns.values()].reduce((s, p) => ({ planned: s.planned + p.planned, absent: s.absent + p.absent }), { planned: 0, absent: 0 });
  const avgRate = avgP.planned > 0 ? (avgP.absent / avgP.planned) * 100 : 0;

  const mondayEffect = mondayP.planned > 0 ? round1((mondayP.absent / mondayP.planned) * 100 - avgRate) : 0;
  const fridayEffect = fridayP.planned > 0 ? round1((fridayP.absent / fridayP.planned) * 100 - avgRate) : 0;

  // Month-end effect (last 5 days)
  const monthEndDays = [27, 28, 29, 30, 31].map(d => domPatterns.get(d) || { planned: 1, absent: 0 });
  const monthEndAbsent = monthEndDays.reduce((s, p) => s + p.absent, 0);
  const monthEndPlanned = monthEndDays.reduce((s, p) => s + p.planned, 0);
  const monthEndEffect = monthEndPlanned > 0 ? round1((monthEndAbsent / monthEndPlanned) * 100 - avgRate) : 0;

  // Predict next week
  const baseRate = avgRate;
  const riskDays: ShrinkageForecast['nextWeek']['riskDays'] = [];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (let i = 0; i < 7; i++) {
    const d = new Date(nextMonday);
    d.setDate(d.getDate() + i);
    const dow = d.getDay();
    const dom = d.getDate();
    const dayName = dayNames[dow];

    let predicted = baseRate;
    const reasons: string[] = [];

    if (dow === 1) { // Monday
      predicted += Math.max(mondayEffect, 0);
      if (mondayEffect > 2) reasons.push('Monday effect');
    }
    if (dow === 5) { // Friday
      predicted += Math.max(fridayEffect, 0);
      if (fridayEffect > 2) reasons.push('Friday effect');
    }
    if (dom >= 27) {
      predicted += Math.max(monthEndEffect, 0);
      if (monthEndEffect > 2) reasons.push('Month-end');
    }

    if (predicted > baseRate * 1.3 || reasons.length > 0) {
      riskDays.push({
        date: formatDate(d),
        day: dayName,
        predictedPct: round1(predicted),
        reason: reasons.join(', ') || 'Historical pattern',
      });
    }
  }

  const avgPredicted = round1(baseRate + (mondayEffect + fridayEffect) / 7);

  const recommendations: string[] = [];
  if (mondayEffect > 3) {
    recommendations.push('Consider Monday motivation initiatives — historically higher absence.');
  }
  if (fridayEffect > 3) {
    recommendations.push('Friday attendance drops significantly — review scheduling and half-day options.');
  }
  if (monthEndEffect > 3) {
    recommendations.push('Month-end sees higher absence — may correlate with salary disbursement.');
  }
  if (riskDays.length >= 3) {
    recommendations.push('Multiple high-risk days next week — pre-emptive manager outreach recommended.');
  }

  return {
    branchId,
    nextWeek: {
      weekStart,
      predictedShrinkagePct: avgPredicted,
      confidence: patternRows.length >= 30 ? 'HIGH' : patternRows.length >= 15 ? 'MEDIUM' : 'LOW',
      riskDays,
    },
    patterns: {
      mondayEffect,
      fridayEffect,
      monthEndEffect,
      festivalProximity: false, // Would need festival calendar integration
    },
    recommendations,
  };
}

// ── Utilities ────────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
