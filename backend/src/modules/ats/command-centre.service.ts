import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { excludeEmployeeShapedCandidatesSql } from './ats-reporting-scope.js';
import { canonicalChannel, CANONICAL_CHANNEL_LABEL } from "./ats-source-channel-model.js";
import {
  type DashboardScope,
} from '../../shared/dashboardScope.js';

const EXCLUDE_EMPLOYEE_SHAPED = excludeEmployeeShapedCandidatesSql('ats_candidate');
const EXCLUDE_EMPLOYEE_SHAPED_C = excludeEmployeeShapedCandidatesSql('c');

/**
 * ATS Command Centre Service
 * Provides comprehensive metrics and analytics for ATS operations.
 *
 * SECURITY FIX (2026-08-23): All service functions now require a DashboardScope
 * parameter. Previously every role saw org-wide data identical to super_admin.
 * Now queries are filtered by the caller's branch/process scope using the same
 * resolveDashboardScope + buildScopeWhere pattern used across dashboards, payroll,
 * and WFM modules.
 */

export interface DashboardMetrics {
  total_candidates: number;
  active_candidates: number;
  selected_candidates: number;
  rejected_candidates: number;
  total_interviews_today: number;
  pending_approvals: number;
  employees_joined_this_month: number;
  conversion_rate: number;
}

export interface SourceMetrics {
  source_channel: string;
  total_candidates: number;
  selected_count: number;
  conversion_rate: number;
  /**
   * Raw sourcing_channel spellings merged into this row — e.g. ["WALKIN", "Walk-In"].
   * Declared rather than cast on at the return, so a caller can show why a channel's number
   * differs from the raw value it used to display.
   */
  merged_from?: string[];
}

export interface BranchMetrics {
  branch_name: string;
  branch_display_name: string;
  total_candidates: number;
  selected_count: number;
  pending_interviews: number;
  active_recruiters: number;
}

export interface RecruiterPerformance {
  recruiter_id: string;
  recruiter_code: string;
  recruiter_name: string;
  total_interviews: number;
  selected_count: number;
  rejected_count: number;
  hold_count: number;
  selection_rate: number;
  avg_communication_rating: number;
  avg_stability_rating: number;
}

export interface TimelineData {
  date: string;
  registrations: number;
  interviews: number;
  selections: number;
  rejections: number;
}

export interface StageDistribution {
  stage: string;
  count: number;
  percentage: number;
}

// ── Scope Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a scope WHERE fragment for ats_candidate rows.
 *
 * ats_candidate uses `applied_for_branch` as the branch column (stores branch_master.id
 * or branch name/code). There is no process_id on ats_candidate, so PROCESS_ALL scopes
 * fall through to branch filtering via the branch IDs already resolved by
 * resolveDashboardScope (which unions process -> branch mapping).
 *
 * TEAM_ONLY and SELF_ONLY levels return 1=0 for aggregate views — those roles should
 * not access the Command Centre at all, but fail-closed is safer than fail-open.
 */
function buildAtsCandidateScope(
  scope: DashboardScope,
  alias = 'ats_candidate',
): { sql: string; params: string[] } {
  // SECURITY: ORG_ALL sees everything — this is super_admin, admin, CEO, etc.
  if (scope.level === 'ORG_ALL') return { sql: '1=1', params: [] };

  // SECURITY: TEAM_ONLY / SELF_ONLY should not reach Command Centre analytics.
  // Fail closed rather than leaking org-wide data.
  if (scope.level === 'TEAM_ONLY' || scope.level === 'SELF_ONLY') {
    return { sql: '1=0', params: [] };
  }

  // BRANCH_ALL, PROCESS_ALL, CUSTOM_SCOPE: filter on applied_for_branch
  // resolveDashboardScope already resolved process -> branch mapping for PROCESS_ALL,
  // so branchIds always contains the correct set.
  const branchIds = scope.branchIds;
  if (branchIds.length === 0) return { sql: '1=0', params: [] };

  const placeholders = branchIds.map(() => '?').join(',');
  return {
    sql: `${alias}.applied_for_branch IN (${placeholders})`,
    params: [...branchIds],
  };
}

/**
 * Build scope for interview results. ats_interview_result has no direct branch column,
 * so we scope via a subquery joining back to ats_candidate.
 */
function buildInterviewScopeSubquery(
  scope: DashboardScope,
): { sql: string; params: string[] } {
  if (scope.level === 'ORG_ALL') return { sql: '1=1', params: [] };
  if (scope.level === 'TEAM_ONLY' || scope.level === 'SELF_ONLY') {
    return { sql: '1=0', params: [] };
  }

  const branchIds = scope.branchIds;
  if (branchIds.length === 0) return { sql: '1=0', params: [] };

  const placeholders = branchIds.map(() => '?').join(',');
  return {
    sql: `candidate_id IN (SELECT id FROM ats_candidate WHERE applied_for_branch IN (${placeholders}) AND active_status = 1)`,
    params: [...branchIds],
  };
}

// ── Service Functions ─────────────────────────────────────────────────────────

/**
 * Get dashboard metrics — all 7 counts fetched in parallel via Promise.all.
 * SECURITY: Scoped to the caller's branch/process assignment.
 */
export async function getDashboardMetrics(scope: DashboardScope): Promise<DashboardMetrics> {
  const candidateScope = buildAtsCandidateScope(scope);
  const candidateScopeC = buildAtsCandidateScope(scope, 'c');
  const interviewScope = buildInterviewScopeSubquery(scope);

  const [
    [totalRes],
    [activeRes],
    [selectedRes],
    [rejectedRes],
    [todayRes],
    [pendingRes],
    [joinedRes],
  ] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM ats_candidate WHERE active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED} AND ${candidateScope.sql}`,
      [...candidateScope.params]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as active FROM ats_candidate
       WHERE active_status = 1
       AND current_stage NOT IN ('rejected', 'joined', 'rejected_by_branch_head')
       AND ${EXCLUDE_EMPLOYEE_SHAPED}
       AND ${candidateScope.sql}`,
      [...candidateScope.params]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as selected FROM ats_candidate
       WHERE active_status = 1
       AND current_stage IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_pending', 'offer_accepted')
       AND ${EXCLUDE_EMPLOYEE_SHAPED}
       AND ${candidateScope.sql}`,
      [...candidateScope.params]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as rejected FROM ats_candidate
       WHERE active_status = 1
       AND current_stage IN ('rejected', 'rejected_by_branch_head')
       AND ${EXCLUDE_EMPLOYEE_SHAPED}
       AND ${candidateScope.sql}`,
      [...candidateScope.params]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as today_interviews FROM ats_interview_result
       WHERE DATE(interviewed_at) = CURDATE()
       AND ${interviewScope.sql}`,
      [...interviewScope.params]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as pending FROM ats_payroll_hr_validation
       WHERE validation_status NOT IN ('approved', 'rejected')
       AND candidate_id IN (
         SELECT id FROM ats_candidate
          WHERE current_stage = 'payroll_validated' AND ${EXCLUDE_EMPLOYEE_SHAPED}
          AND ${candidateScope.sql}
       )`,
      [...candidateScope.params]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT sl.candidate_id) as joined
       FROM ats_candidate_stage_log sl
       JOIN ats_candidate c ON c.id = sl.candidate_id
       WHERE sl.to_stage = 'joined'
         AND MONTH(sl.stage_date) = MONTH(CURRENT_DATE())
         AND YEAR(sl.stage_date) = YEAR(CURRENT_DATE())
         AND ${EXCLUDE_EMPLOYEE_SHAPED_C}
         AND ${candidateScopeC.sql}`,
      [...candidateScopeC.params]
    ),
  ]);

  const totalCandidates = totalRes[0]?.total || 0;
  const selectedCandidates = selectedRes[0]?.selected || 0;
  const conversionRate = totalCandidates > 0
    ? (selectedCandidates / totalCandidates) * 100
    : 0;

  return {
    total_candidates: totalCandidates,
    active_candidates: activeRes[0]?.active || 0,
    selected_candidates: selectedCandidates,
    rejected_candidates: rejectedRes[0]?.rejected || 0,
    total_interviews_today: todayRes[0]?.today_interviews || 0,
    pending_approvals: pendingRes[0]?.pending || 0,
    employees_joined_this_month: joinedRes[0]?.joined || 0,
    conversion_rate: parseFloat(conversionRate.toFixed(2)),
  };
}

/**
 * Get source channel metrics.
 * SECURITY: Scoped to the caller's branch/process assignment.
 */
export async function getSourceMetrics(scope: DashboardScope): Promise<SourceMetrics[]> {
  const candidateScope = buildAtsCandidateScope(scope);

  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      sourcing_channel as source_channel,
      COUNT(*) as total_candidates,
      SUM(CASE WHEN current_stage IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_pending', 'offer_accepted', 'joined') THEN 1 ELSE 0 END) as selected_count
    FROM ats_candidate
    WHERE active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED}
    AND ${candidateScope.sql}
    GROUP BY sourcing_channel`,
    [...candidateScope.params]
  );

  /**
   * Merge the raw spellings into canonical channels.
   */
  const merged = new Map<string, { label: string; total: number; selected: number; merged_from: string[] }>();
  const unmapped: Array<{ channel: string; total: number; selected: number }> = [];

  for (const row of results as Array<Record<string, unknown>>) {
    const raw = row.source_channel == null ? "" : String(row.source_channel);
    const total = Number(row.total_candidates) || 0;
    const selected = Number(row.selected_count) || 0;
    const canonical = canonicalChannel(raw);

    if (!canonical) {
      unmapped.push({ channel: raw, total, selected });
      continue;
    }
    const key = canonical;
    const entry = merged.get(key) ?? { label: CANONICAL_CHANNEL_LABEL[canonical], total: 0, selected: 0, merged_from: [] };
    entry.total += total;
    entry.selected += selected;
    if (raw) entry.merged_from.push(raw);
    merged.set(key, entry);
  }

  for (const u of unmapped) {
    merged.set(`raw:${u.channel}`, { label: u.channel || "Unspecified", total: u.total, selected: u.selected, merged_from: [u.channel] });
  }

  return [...merged.entries()]
    .map(([, e]) => ({
      source_channel: e.label,
      total_candidates: e.total,
      selected_count: e.selected,
      conversion_rate: e.total > 0 ? Number(((e.selected / e.total) * 100).toFixed(2)) : 0,
      merged_from: e.merged_from,
    }))
    .sort((a, b) => b.total_candidates - a.total_candidates);
}

/**
 * Get branch metrics.
 * SECURITY: Scoped to the caller's branch/process assignment.
 */
export async function getBranchMetrics(scope: DashboardScope): Promise<BranchMetrics[]> {
  const candidateScope = buildAtsCandidateScope(scope, 'c');

  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.applied_for_branch as branch_name,
      c.branch_display_name,
      COUNT(DISTINCT c.id) as total_candidates,
      COUNT(DISTINCT CASE WHEN c.current_stage IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_pending', 'offer_accepted', 'joined') THEN c.id END) as selected_count,
      COUNT(DISTINCT CASE WHEN c.current_stage IN ('selected', 'bgv_pending') THEN c.id END) as pending_interviews,
      COUNT(DISTINCT qt.recruiter_id) as active_recruiters
    FROM ats_candidate c
    LEFT JOIN ats_queue_token qt ON qt.candidate_id = c.id AND DATE(qt.created_at) = CURDATE()
    WHERE c.active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED_C}
    AND ${candidateScope.sql}
    GROUP BY c.applied_for_branch, c.branch_display_name
    ORDER BY total_candidates DESC`,
    [...candidateScope.params]
  );

  return results as BranchMetrics[];
}

/**
 * Get recruiter performance.
 * SECURITY: Scoped to the caller's branch/process assignment via candidate branch.
 */
function getIstDateString(offsetDays = 0): string {
  const d = new Date(Date.now() + (5.5 * 60 - offsetDays * 24 * 60) * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function getRecruiterPerformance(
  scope: DashboardScope,
  fromDate?: string,
  toDate?: string
): Promise<RecruiterPerformance[]> {
  const from = fromDate || getIstDateString(30);
  const to = toDate || getIstDateString(0);
  const interviewScope = buildInterviewScopeSubquery(scope);

  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      ir.recruiter_id,
      e.employee_code as recruiter_code,
      CONCAT(e.first_name, ' ', e.last_name) as recruiter_name,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN ir.interview_status = 'selected' THEN 1 ELSE 0 END) as selected_count,
      SUM(CASE WHEN ir.interview_status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
      SUM(CASE WHEN ir.interview_status = 'hold' THEN 1 ELSE 0 END) as hold_count,
      ROUND((SUM(CASE WHEN ir.interview_status = 'selected' THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as selection_rate,
      ROUND(AVG(ir.communication_rating), 2) as avg_communication_rating,
      ROUND(AVG(ir.stability_rating), 2) as avg_stability_rating
    FROM ats_interview_result ir
    LEFT JOIN employees e ON e.id = ir.recruiter_id
    WHERE DATE(ir.interviewed_at) BETWEEN ? AND ?
    AND ${interviewScope.sql}
    GROUP BY ir.recruiter_id, e.employee_code, e.first_name, e.last_name
    HAVING total_interviews > 0
    ORDER BY total_interviews DESC
    LIMIT 20`,
    [from, to, ...interviewScope.params]
  );

  return results as RecruiterPerformance[];
}

/**
 * Get timeline data (max 30 days).
 * SECURITY: Scoped to the caller's branch/process assignment.
 */
export async function getTimelineData(scope: DashboardScope, days: number = 30): Promise<TimelineData[]> {
  const safeDays = Math.min(days, 30);
  const candidateScope = buildAtsCandidateScope(scope);
  const interviewScope = buildInterviewScopeSubquery(scope);

  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      DATE(date_series.date) as date,
      COALESCE(reg.registrations, 0) as registrations,
      COALESCE(int.interviews, 0) as interviews,
      COALESCE(sel.selections, 0) as selections,
      COALESCE(rej.rejections, 0) as rejections
    FROM (
      SELECT DATE(DATE_SUB(CURDATE(), INTERVAL seq.seq DAY)) as date
      FROM (
        SELECT 0 AS seq UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL
        SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL
        SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL
        SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL
        SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL
        SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29
      ) seq
      WHERE seq.seq < ?
    ) date_series
    LEFT JOIN (
      SELECT DATE(created_at) as date, COUNT(*) as registrations
      FROM ats_candidate
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND ${EXCLUDE_EMPLOYEE_SHAPED}
      AND ${candidateScope.sql}
      GROUP BY DATE(created_at)
    ) reg ON date_series.date = reg.date
    LEFT JOIN (
      SELECT DATE(interviewed_at) as date, COUNT(*) as interviews
      FROM ats_interview_result
      WHERE interviewed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND ${interviewScope.sql}
      GROUP BY DATE(interviewed_at)
    ) int ON date_series.date = int.date
    LEFT JOIN (
      SELECT DATE(interviewed_at) as date, COUNT(*) as selections
      FROM ats_interview_result
      WHERE interview_status = 'selected' AND interviewed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND ${interviewScope.sql}
      GROUP BY DATE(interviewed_at)
    ) sel ON date_series.date = sel.date
    LEFT JOIN (
      SELECT DATE(interviewed_at) as date, COUNT(*) as rejections
      FROM ats_interview_result
      WHERE interview_status = 'rejected' AND interviewed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND ${interviewScope.sql}
      GROUP BY DATE(interviewed_at)
    ) rej ON date_series.date = rej.date
    ORDER BY date_series.date ASC`,
    [
      safeDays,
      safeDays, ...candidateScope.params,
      safeDays, ...interviewScope.params,
      safeDays, ...interviewScope.params,
      safeDays, ...interviewScope.params,
    ]
  );

  return results as TimelineData[];
}

/**
 * Get stage distribution.
 * SECURITY: Scoped to the caller's branch/process assignment.
 */
export async function getStageDistribution(scope: DashboardScope): Promise<StageDistribution[]> {
  const candidateScope = buildAtsCandidateScope(scope);

  // The denominator for percentage must use the same scope filter as the numerator,
  // otherwise percentages won't add up to 100%.
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      current_stage as stage,
      COUNT(*) as count,
      ROUND((COUNT(*) / (
        SELECT COUNT(*) FROM ats_candidate
        WHERE active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED} AND ${candidateScope.sql}
      )) * 100, 2) as percentage
    FROM ats_candidate
    WHERE active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED}
    AND ${candidateScope.sql}
    GROUP BY current_stage
    ORDER BY count DESC`,
    [...candidateScope.params, ...candidateScope.params]
  );

  return results as StageDistribution[];
}

/**
 * Get role-wise applications.
 * SECURITY: Scoped to the caller's branch/process assignment.
 */
export async function getRoleMetrics(scope: DashboardScope): Promise<{ role: string; count: number }[]> {
  const candidateScope = buildAtsCandidateScope(scope);

  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      COALESCE(role_applied, applied_for_process) as role,
      COUNT(*) as count
    FROM ats_candidate
    WHERE active_status = 1 AND ${EXCLUDE_EMPLOYEE_SHAPED}
    AND ${candidateScope.sql}
    GROUP BY COALESCE(role_applied, applied_for_process)
    ORDER BY count DESC
    LIMIT 10`,
    [...candidateScope.params]
  );

  return results as { role: string; count: number }[];
}

/**
 * Get experience-wise distribution.
 * SECURITY: Scoped to the caller's branch/process assignment.
 */
export async function getExperienceDistribution(scope: DashboardScope): Promise<{ experience: string; count: number }[]> {
  const candidateScope = buildAtsCandidateScope(scope);

  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      experience,
      COUNT(*) as count
    FROM ats_candidate
    WHERE active_status = 1 AND experience IS NOT NULL AND ${EXCLUDE_EMPLOYEE_SHAPED}
    AND ${candidateScope.sql}
    GROUP BY experience
    ORDER BY
      CASE
        WHEN experience = 'Fresher' THEN 0
        WHEN experience LIKE '%-%' THEN CAST(SUBSTRING_INDEX(experience, '-', 1) AS UNSIGNED)
        WHEN experience LIKE '%+%' THEN CAST(SUBSTRING_INDEX(experience, '+', 1) AS UNSIGNED)
        ELSE 999
      END`,
    [...candidateScope.params]
  );

  return results as { experience: string; count: number }[];
}
