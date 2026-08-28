import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { excludeEmployeeShapedCandidatesSql } from './ats-reporting-scope.js';

const EXCLUDE_EMPLOYEE_SHAPED = excludeEmployeeShapedCandidatesSql('ats_candidate');

/**
 * The stages that mean "this candidate became an employee".
 *
 * Nine queries in this file were keyed to a stage literal spelled "joined". No row in
 * ats_candidate has ever held that value — the live vocabulary is Onboarded (28),
 * converted (16) and payroll_validated (4), verified against production 2026-08-27 on
 * 38,191 candidates.
 *
 * So these were not merely inaccurate, they were arithmetically incapable of returning
 * anything but zero or null on any dataset: conversion rate always 0.00%, and the whole
 * of getTimeToHireMetrics() (overall, by role, by source, by branch, fastest, slowest)
 * plus the hiring forecast's monthly-hires and candidate-journey figures always empty.
 * A permanent zero on a conversion rate reads as "nothing converts" rather than "this is
 * not being measured", and it shipped beside a funnel showing 1,272 live offers.
 *
 * Matched case-insensitively because the column is free varchar and mixes conventions
 * ('Onboarded' vs 'converted'). Kept as one constant so a future stage rename breaks in
 * one place instead of silently zeroing every one of these again.
 */
export const JOINED_STAGES = ['onboarded', 'converted', 'payroll_validated'] as const;
const JOINED_STAGE_LIST = JOINED_STAGES.map(s => `'${s}'`).join(', ');
/**
 * Boolean form, for a WHERE clause. Exported so other "did this candidate become an
 * employee" queries — e.g. ats.service.ts's getDashboardStats, which is the query the
 * live Sourcing Analysis page actually calls — use the same vocabulary instead of a
 * second hand-copied list that drifts from this one. That drift was real: getDashboardStats
 * used ('converted','Onboarded','Selected'), missing 'payroll_validated' and wrongly
 * including 'Selected' — an offer/selection stage, not an actual hire, on a card labelled
 * "Conversion Rate". Fixed 2026-08-28 by switching it to this constant.
 */
export const JOINED_STAGE_PREDICATE = `LOWER(TRIM(current_stage)) IN (${JOINED_STAGE_LIST})`;
/** 1/0 form, for SUM() inside an aggregate. */
const JOINED_STAGE_SQL = `CASE WHEN ${JOINED_STAGE_PREDICATE} THEN 1 ELSE 0 END`;

/**
 * "Became an employee" beyond what current_stage tracks.
 *
 * Verified against production 2026-08-28: of 8,253 genuine candidates (record_type =
 * 'candidate'), only 6 carry a terminal stage above (0.07%). But 643 more are
 * demonstrably on payroll today — matched by mobile number to an employees row whose
 * date_of_joining is on/after the candidate's created_at — and were simply never moved
 * past their interview stage. The stage field is not maintained; this is a second,
 * independent signal for the same underlying fact, not a replacement for it (2 rows are
 * staged but have no identity match at all — no mobile on file — so the two signals are
 * OR'd, not swapped).
 *
 * Time-ordered on purpose: an employee who joined BEFORE this candidate applied and
 * happens to share a mobile (rehire, family number reused for a fresh application) is
 * not this application's conversion. Without the ordering check, mobile-only matching
 * over-counts by roughly 2x (measured: 1,377 raw matches vs 814 time-ordered, against a
 * broader multi-column match set than the mobile-only version below produces).
 *
 * Matched on mobile only, not email: employees carry a mobile on 58,410/58,929 rows
 * (99.1%) against 21,300 distinct emails spread across four differently-named columns,
 * and only `employees.mobile` is indexed — an email match would need an unindexed scan
 * of a column that still misses over half the roster.
 */
const MOBILE_JOIN_MAP_TTL_MS = 15 * 60 * 1000;
let _mobileJoinMapCache: { value: Map<string, string>; at: number } | null = null;

/**
 * Cached rather than joined into the query it feeds: grouping the whole employees table
 * by mobile takes ~6.4s on this remote DB (measured 2026-08-28, isolated from every other
 * part of the query) — by far the slowest thing on the ATS analytics page if paid on every
 * request. The mapping changes only as fast as people join, so a 15-minute TTL is coarse
 * on purpose; force a refresh with `{ force: true }`, same pattern as
 * loadBgvDbConfig() in bgv-config.store.ts.
 */
async function getEmployeeMobileJoinMap(opts?: { force?: boolean }): Promise<Map<string, string>> {
  const now = Date.now();
  if (!opts?.force && _mobileJoinMapCache && now - _mobileJoinMapCache.at < MOBILE_JOIN_MAP_TTL_MS) {
    return _mobileJoinMapCache.value;
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT mobile, MAX(date_of_joining) as doj
       FROM employees
      WHERE mobile IS NOT NULL AND mobile <> ''
      GROUP BY mobile`
  );
  const value = new Map<string, string>();
  for (const row of rows as RowDataPacket[]) {
    if (row.doj) value.set(String(row.mobile), String(row.doj));
  }
  _mobileJoinMapCache = { value, at: now };
  return value;
}

/** Test-only escape hatch — mirrors resetBgvDbConfigCache(). */
export function resetEmployeeMobileJoinMapCacheForTest(): void {
  _mobileJoinMapCache = null;
}

/**
 * Pure combine step, kept separate from both queries above so it is unit-testable
 * without a database: did this one candidate become an employee, by stage OR identity?
 */
export function candidateBecameEmployee(
  candidate: { current_stage: string | null; mobile: string | null; created_at: string | Date },
  mobileJoinMap: Map<string, string>,
): boolean {
  const stage = String(candidate.current_stage ?? '').trim().toLowerCase();
  if ((JOINED_STAGES as readonly string[]).includes(stage)) return true;

  if (!candidate.mobile) return false;
  const doj = mobileJoinMap.get(candidate.mobile);
  if (!doj) return false;

  const createdAt = candidate.created_at instanceof Date ? candidate.created_at : new Date(candidate.created_at);
  return new Date(doj) >= createdAt;
}

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

// total_hired / conversion_rate are computed in JS via candidateBecameEmployee() now,
// not selected by this query — see getSourceChannelROI().
interface SourceRow extends RowDataPacket {
  source_channel: string;
  total_candidates: number;
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
    `SELECT COUNT(*) as count, MIN(created_at) as earliest, MAX(created_at) as latest FROM ats_candidate WHERE active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED}`
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
    WHERE created_at >= ? AND ${EXCLUDE_EMPLOYEE_SHAPED}
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
  // Per-channel totals and avg_time_to_hire_days — unchanged from before this fix, and
  // deliberately left as AVG(DATEDIFF) over every candidate in the channel, not just the
  // hired ones (that was already this metric's definition; not this change's concern).
  const [newData] = await db.execute<SourceRow[]>(
    `SELECT
      COALESCE(sourcing_channel, 'Walk-in') as source_channel,
      COUNT(*) as total_candidates,
      AVG(DATEDIFF(updated_at, created_at)) as avg_time_to_hire_days
    FROM ats_candidate
    WHERE active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED}
    GROUP BY sourcing_channel
    ORDER BY total_candidates DESC`
  );

  // total_hired / conversion_rate go through candidateBecameEmployee() instead of a bare
  // SQL SUM, because that determination needs the cached employees-by-mobile map — see
  // its comment above for why this is two cheap queries plus a cache hit rather than one
  // query with the match folded in as a correlated subquery or JOIN.
  const [candidateRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(sourcing_channel, 'Walk-in') as source_channel,
            current_stage, mobile, created_at
       FROM ats_candidate
      WHERE active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED}`
  );
  const mobileJoinMap = await getEmployeeMobileJoinMap();
  const hiredByChannel = new Map<string, number>();
  for (const row of candidateRows as RowDataPacket[]) {
    if (candidateBecameEmployee(row as { current_stage: string | null; mobile: string | null; created_at: string }, mobileJoinMap)) {
      const channel = String(row.source_channel);
      hiredByChannel.set(channel, (hiredByChannel.get(channel) ?? 0) + 1);
    }
  }

  return newData.map((row) => {
    const totalCandidates = Number(row.total_candidates ?? 0);
    const totalHired = hiredByChannel.get(row.source_channel) ?? 0;
    return {
      source_channel: row.source_channel,
      total_candidates: totalCandidates,
      total_hired: totalHired,
      conversion_rate: totalCandidates > 0 ? Math.round((totalHired / totalCandidates) * 10000) / 100 : 0,
      avg_time_to_hire_days: Number(row.avg_time_to_hire_days ?? 0),
    };
  });
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
      ROUND(AVG((communication_rating + stability_rating) / 2), 2) as avg_rating
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
    WHERE ${JOINED_STAGE_PREDICATE}
    AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
    AND ${EXCLUDE_EMPLOYEE_SHAPED}
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
    WHERE NOT (${JOINED_STAGE_PREDICATE})
    AND LOWER(TRIM(current_stage)) NOT IN ('rejected', 'rejected_by_branch_head')
    AND active_status = 1
    AND ${EXCLUDE_EMPLOYEE_SHAPED}
    GROUP BY current_stage
    ORDER BY avg_days_stuck DESC
    LIMIT 1`
  );

  // Average journey time
  const [journeyTime] = await db.execute<AvgRow[]>(
    `SELECT AVG(DATEDIFF(updated_at, created_at)) as avg_days
    FROM ats_candidate
    WHERE ${JOINED_STAGE_PREDICATE} AND ${EXCLUDE_EMPLOYEE_SHAPED}`
  );

  // Calculate actual peak months from data (top 3 months by hire volume)
  const [peakMonths] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(created_at, '%M') AS month_name, COUNT(*) AS cnt
     FROM ats_candidate
     WHERE profile_status IN ('onboarded', 'selected')
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
       AND ${EXCLUDE_EMPLOYEE_SHAPED}
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
    WHERE ${JOINED_STAGE_PREDICATE} AND ${EXCLUDE_EMPLOYEE_SHAPED}`
  );

  // By role
  const [byRole] = await db.execute<RoleDayRow[]>(
    `SELECT
      COALESCE(role_applied, applied_for_process) as role,
      ROUND(AVG(DATEDIFF(updated_at, created_at))) as avg_days
    FROM ats_candidate
    WHERE ${JOINED_STAGE_PREDICATE} AND ${EXCLUDE_EMPLOYEE_SHAPED}
    GROUP BY COALESCE(role_applied, applied_for_process)
    ORDER BY avg_days`
  );

  // By source
  const [bySource] = await db.execute<SourceDayRow[]>(
    `SELECT
      COALESCE(sourcing_channel, 'Walk-in') as source,
      ROUND(AVG(DATEDIFF(updated_at, created_at))) as avg_days
    FROM ats_candidate
    WHERE ${JOINED_STAGE_PREDICATE} AND ${EXCLUDE_EMPLOYEE_SHAPED}
    GROUP BY sourcing_channel
    ORDER BY avg_days`
  );

  // By branch
  const [byBranch] = await db.execute<BranchDayRow[]>(
    `SELECT
      branch_display_name as branch,
      ROUND(AVG(DATEDIFF(updated_at, created_at))) as avg_days
    FROM ats_candidate
    WHERE ${JOINED_STAGE_PREDICATE} AND ${EXCLUDE_EMPLOYEE_SHAPED}
    GROUP BY branch_display_name
    ORDER BY avg_days`
  );

  // Min/Max
  const [minMax] = await db.execute<MinMaxRow[]>(
    `SELECT
      MIN(DATEDIFF(updated_at, created_at)) as fastest,
      MAX(DATEDIFF(updated_at, created_at)) as slowest
    FROM ats_candidate
    WHERE ${JOINED_STAGE_PREDICATE} AND ${EXCLUDE_EMPLOYEE_SHAPED}`
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
  'applied_for_branch', 'current_stage', 'sourcing_channel',
  'experience', 'gender', 'branch_display_name', 'active_status',
]);

const ALLOWED_GROUP_BY = new Set([
  'applied_for_branch', 'current_stage', 'sourcing_channel',
  'experience', 'gender', 'branch_display_name',
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
        // Same dead literal as getSourceChannelROI had (double-quoted here, which is why
        // the guard test for that one — a single-quote regex — didn't already catch this
        // site). Routed through JOINED_STAGE_SQL, not candidateBecameEmployee()'s identity
        // match: this is a generic, arbitrarily-grouped/filtered ad-hoc report builder, and
        // the identity match needs the cached mobile map joined in application code, which
        // doesn't compose with a dynamic SQL string built from a metrics/groupBy whitelist.
        // So this metric is stage-only — consistent and no longer arithmetically zero, but
        // narrower than the source-channel ROI figure above.
        metricClauses.push(`ROUND((SUM(${JOINED_STAGE_SQL}) / COUNT(*)) * 100, 2) as conversion_rate`);
        break;
    }
  });

  if (metricClauses.length === 1) {
    // Only groupBy added — no metric selected; return empty rather than a bare GROUP BY
    return [];
  }

  const queryParts: string[] = [`SELECT ${metricClauses.join(', ')} FROM ats_candidate WHERE active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED}`];
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
