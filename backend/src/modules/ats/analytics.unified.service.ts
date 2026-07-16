import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';

/**
 * ATS Analytics Service
 * Real queries against ats_candidate, ats_interview_submission, ats_recruiter_roster.
 * Old-system cross-DB queries removed — mas_hrms is the single source of truth.
 */

interface CountRow extends RowDataPacket {
  count: number;
  earliest: string | null;
  latest: string | null;
}

interface TrendRow extends RowDataPacket {
  month_year: string;
  year: number;
  month: number;
  registrations: number;
  interviews: number;
  selections: number;
}

interface SourceRow extends RowDataPacket {
  source_channel: string;
  total_candidates: number;
  total_hired: number;
  conversion_rate: number;
  avg_time_to_hire_days: number | null;
}

interface RecruiterTrendRow extends RowDataPacket {
  month: string;
  interviews_conducted: number;
  selections_made: number;
  selection_rate: number;
  avg_rating: number;
}

interface MonthlyHireRow extends RowDataPacket {
  month: string;
  hires: number;
}

interface StageRow extends RowDataPacket {
  current_stage: string;
  stuck_count: number;
  avg_days_stuck: number;
}

interface AvgRow extends RowDataPacket {
  avg_days: number | null;
}

interface RoleDayRow extends RowDataPacket {
  role: string;
  avg_days: number | null;
}

interface SourceDayRow extends RowDataPacket {
  source: string;
  avg_days: number | null;
}

interface BranchDayRow extends RowDataPacket {
  branch: string;
  avg_days: number | null;
}

interface MinMaxRow extends RowDataPacket {
  fastest: number | null;
  slowest: number | null;
}

// ── Historical Data Integration ────────────────────────────────────────────────

/**
 * Get unified candidate count (old + new)
 */
export async function getUnifiedCandidateCount(): Promise<{
  total: number;
  date_range: { earliest: string; latest: string };
}> {
  const [rows] = await db.execute<CountRow[]>(
    'SELECT COUNT(*) as count, MIN(created_at) as earliest, MAX(created_at) as latest FROM ats_candidate WHERE active_status = 1'
  );
  return {
    total: rows[0]?.count || 0,
    date_range: {
      earliest: rows[0]?.earliest || new Date().toISOString(),
      latest: rows[0]?.latest || new Date().toISOString(),
    },
  };
}

/**
 * Get hiring trends over time (monthly aggregation)
 */
export async function getHiringTrends(months: number = 12): Promise<{
  month: string;
  year: number;
  registrations: number;
  interviews: number;
  selections: number;
}[]> {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const startDateStr = startDate.toISOString().split('T')[0];

  // New system data
  const [newData] = await db.execute<TrendRow[]>(
    `SELECT
      DATE_FORMAT(created_at, '%Y-%m') as month_year,
      YEAR(created_at) as year,
      MONTH(created_at) as month,
      COUNT(*) as registrations,
      0 as interviews,
      SUM(CASE WHEN current_stage IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_accepted', 'joined') THEN 1 ELSE 0 END) as selections
    FROM ats_candidate
    WHERE created_at >= ?
    GROUP BY month_year, year, month
    ORDER BY month_year`,
    [startDateStr]
  );

  return newData.map(row => ({
    month: row.month_year,
    year: row.year,
    registrations: row.registrations,
    interviews: row.interviews,
    selections: row.selections,
  }));
}

/**
 * Get source channel performance (lifetime)
 */
export async function getSourceChannelROI(): Promise<{
  source_channel: string;
  total_candidates: number;
  total_hired: number;
  conversion_rate: number;
  avg_time_to_hire_days: number;
  cost_per_hire?: number; // TODO: Add when cost data available
}[]> {
  // New system data
  const [newData] = await db.execute<SourceRow[]>(
    `SELECT
      COALESCE(sourcing_channel, 'Walk-in') as source_channel,
      COUNT(*) as total_candidates,
      SUM(CASE WHEN current_stage = 'joined' THEN 1 ELSE 0 END) as total_hired,
      ROUND((SUM(CASE WHEN current_stage = 'joined' THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as conversion_rate,
      AVG(DATEDIFF(updated_at, created_at)) as avg_time_to_hire_days
    FROM ats_candidate
    WHERE active_status = 1
    GROUP BY sourcing_channel
    ORDER BY total_candidates DESC`
  );

  return newData.map((row) => ({
    source_channel: row.source_channel,
    total_candidates: Number(row.total_candidates ?? 0),
    total_hired: Number(row.total_hired ?? 0),
    conversion_rate: Number(row.conversion_rate ?? 0),
    avg_time_to_hire_days: Number(row.avg_time_to_hire_days ?? 0),
  }));
}

/**
 * Get recruiter performance trends
 */
export async function getRecruiterTrends(recruiterId?: string): Promise<{
  month: string;
  interviews_conducted: number;
  selections_made: number;
  selection_rate: number;
  avg_rating: number;
}[]> {
  const [results] = await db.execute<RecruiterTrendRow[]>(
    `SELECT
      DATE_FORMAT(interviewed_at, '%Y-%m') as month,
      COUNT(*) as interviews_conducted,
      SUM(CASE WHEN interview_status = 'selected' THEN 1 ELSE 0 END) as selections_made,
      ROUND((SUM(CASE WHEN interview_status = 'selected' THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as selection_rate,
      ROUND(AVG((communication_rating + technical_rating + cultural_fit_rating) / 3), 2) as avg_rating
    FROM ats_interview_result
    WHERE interviewed_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    ${recruiterId ? 'AND recruiter_id = ?' : ''}
    GROUP BY month
    ORDER BY month`,
    recruiterId ? [recruiterId] : []
  );

  return results;
}

/**
 * Get predictive hiring analytics
 */
export async function getPredictiveAnalytics(): Promise<{
  forecasted_hires_next_month: number;
  recommended_recruiters_needed: number;
  peak_hiring_months: string[];
  bottleneck_stage: string;
  avg_candidate_journey_days: number;
}> {
  // Historical pattern analysis
  const [monthlyHires] = await db.execute<MonthlyHireRow[]>(
    `SELECT
      DATE_FORMAT(created_at, '%Y-%m') as month,
      COUNT(*) as hires
    FROM ats_candidate
    WHERE current_stage = 'joined'
    AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
    GROUP BY month
    ORDER BY month`
  );

  // Calculate average
  const avgHires = monthlyHires.length > 0
    ? monthlyHires.reduce((sum, row) => sum + Number(row.hires || 0), 0) / monthlyHires.length
    : 0;

  // Find bottleneck
  const [bottleneck] = await db.execute<StageRow[]>(
    `SELECT
      current_stage,
      COUNT(*) as stuck_count,
      AVG(DATEDIFF(CURDATE(), updated_at)) as avg_days_stuck
    FROM ats_candidate
    WHERE current_stage NOT IN ('joined', 'rejected', 'rejected_by_branch_head')
    AND active_status = 1
    GROUP BY current_stage
    ORDER BY avg_days_stuck DESC
    LIMIT 1`
  );

  // Average journey time
  const [journeyTime] = await db.execute<AvgRow[]>(
    `SELECT AVG(DATEDIFF(updated_at, created_at)) as avg_days
    FROM ats_candidate
    WHERE current_stage = 'joined'`
  );

  // Calculate actual peak months from data (top 3 months by hire volume)
  const [peakMonths] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(created_at, '%M') AS month_name, COUNT(*) AS cnt
     FROM ats_candidate
     WHERE profile_status IN ('onboarded', 'selected')
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
     GROUP BY DATE_FORMAT(created_at, '%M')
     ORDER BY cnt DESC
     LIMIT 3`
  );
  const peakMonthNames = (peakMonths as any[]).map(r => r.month_name as string);

  return {
    forecasted_hires_next_month: Math.round(avgHires * 1.1),
    recommended_recruiters_needed: Math.max(1, Math.ceil(avgHires / 20)),
    peak_hiring_months: peakMonthNames.length > 0 ? peakMonthNames : ['Data insufficient'],
    bottleneck_stage: bottleneck[0]?.current_stage || 'None',
    avg_candidate_journey_days: Math.round(journeyTime[0]?.avg_days || 0),
  };
}

/**
 * Get time-to-hire metrics
 */
export async function getTimeToHireMetrics(): Promise<{
  overall_avg_days: number;
  by_role: { role: string; avg_days: number }[];
  by_source: { source: string; avg_days: number }[];
  by_branch: { branch: string; avg_days: number }[];
  fastest_hire_days: number;
  slowest_hire_days: number;
}> {
  // Overall average
  const [overall] = await db.execute<AvgRow[]>(
    `SELECT AVG(DATEDIFF(updated_at, created_at)) as avg_days
    FROM ats_candidate
    WHERE current_stage = 'joined'`
  );

  // By role
  const [byRole] = await db.execute<RoleDayRow[]>(
    `SELECT
      applied_for_role as role,
      ROUND(AVG(DATEDIFF(updated_at, created_at))) as avg_days
    FROM ats_candidate
    WHERE current_stage = 'joined'
    GROUP BY applied_for_role
    ORDER BY avg_days`
  );

  // By source
  const [bySource] = await db.execute<SourceDayRow[]>(
    `SELECT
      COALESCE(sourcing_channel, 'Walk-in') as source,
      ROUND(AVG(DATEDIFF(updated_at, created_at))) as avg_days
    FROM ats_candidate
    WHERE current_stage = 'joined'
    GROUP BY sourcing_channel
    ORDER BY avg_days`
  );

  // By branch
  const [byBranch] = await db.execute<BranchDayRow[]>(
    `SELECT
      branch_display_name as branch,
      ROUND(AVG(DATEDIFF(updated_at, created_at))) as avg_days
    FROM ats_candidate
    WHERE current_stage = 'joined'
    GROUP BY branch_display_name
    ORDER BY avg_days`
  );

  // Min/Max
  const [minMax] = await db.execute<MinMaxRow[]>(
    `SELECT
      MIN(DATEDIFF(updated_at, created_at)) as fastest,
      MAX(DATEDIFF(updated_at, created_at)) as slowest
    FROM ats_candidate
    WHERE current_stage = 'joined'`
  );

  return {
    overall_avg_days: Math.round(overall[0]?.avg_days || 0),
    by_role: byRole.map((row) => ({ role: row.role, avg_days: Math.round(Number(row.avg_days || 0)) })),
    by_source: bySource.map((row) => ({ source: row.source, avg_days: Math.round(Number(row.avg_days || 0)) })),
    by_branch: byBranch.map((row) => ({ branch: row.branch, avg_days: Math.round(Number(row.avg_days || 0)) })),
    fastest_hire_days: minMax[0]?.fastest || 0,
    slowest_hire_days: minMax[0]?.slowest || 0,
  };
}

// Whitelist: only these column names may appear in filter keys or groupBy
const ALLOWED_FILTER_COLUMNS = new Set([
  'applied_for_branch', 'applied_for_role', 'current_stage', 'sourcing_channel',
  'years_of_experience', 'gender', 'branch_display_name', 'active_status',
]);

const ALLOWED_GROUP_BY = new Set([
  'applied_for_branch', 'applied_for_role', 'current_stage', 'sourcing_channel',
  'years_of_experience', 'gender', 'branch_display_name',
  'MONTH(created_at)', 'YEAR(created_at)', 'DATE(created_at)',
]);

/**
 * Get custom report data
 */
export async function getCustomReport(params: {
  metrics: string[];
  groupBy: string;
  dateFrom?: string;
  dateTo?: string;
  filters?: Record<string, unknown>;
}): Promise<Record<string, unknown>[]> {
  const { metrics, groupBy, dateFrom, dateTo, filters } = params;

  // Validate groupBy against whitelist
  if (!ALLOWED_GROUP_BY.has(groupBy)) {
    throw new Error(`Invalid groupBy column: ${groupBy}`);
  }

  // Build metric SELECT clauses (hardcoded — never interpolated from user input)
  const metricClauses: string[] = [groupBy];
  metrics.forEach(metric => {
    switch (metric) {
      case 'count':
        metricClauses.push('COUNT(*) as total_count');
        break;
      case 'avg_time_to_hire':
        metricClauses.push('AVG(DATEDIFF(updated_at, created_at)) as avg_time_to_hire');
        break;
      case 'conversion_rate':
        metricClauses.push('ROUND((SUM(CASE WHEN current_stage = "joined" THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as conversion_rate');
        break;
    }
  });

  if (metricClauses.length === 1) {
    // Only groupBy added — no metric selected; return empty rather than a bare GROUP BY
    return [];
  }

  const queryParts: string[] = [`SELECT ${metricClauses.join(', ')} FROM ats_candidate WHERE active_status = 1`];
  const queryParams: unknown[] = [];

  // Date filters — values go through parameterized placeholders
  if (dateFrom) { queryParts.push('AND created_at >= ?'); queryParams.push(dateFrom); }
  if (dateTo)   { queryParts.push('AND created_at <= ?'); queryParams.push(dateTo); }

  // Custom filters — keys validated against whitelist, values parameterized
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (!ALLOWED_FILTER_COLUMNS.has(key)) {
        throw new Error(`Invalid filter column: ${key}`);
      }
      queryParts.push(`AND \`${key}\` = ?`);
      queryParams.push(String(value));
    }
  }

  queryParts.push(`GROUP BY ${groupBy}`);

  const [results] = await db.execute<RowDataPacket[]>(queryParts.join(' '), queryParams);
  return results as Record<string, unknown>[];
}
