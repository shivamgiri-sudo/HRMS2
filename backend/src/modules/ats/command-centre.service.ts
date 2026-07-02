import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';

/**
 * ATS Command Centre Service
 * Provides comprehensive metrics and analytics for ATS operations
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

/**
 * Get dashboard metrics
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  // Total candidates
  const [totalRes] = await db.execute<RowDataPacket[]>(
    'SELECT COUNT(*) as total FROM ats_candidate WHERE active_status = 1'
  );

  // Active candidates (in process)
  const [activeRes] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as active FROM ats_candidate
     WHERE active_status = 1
     AND current_stage NOT IN ('rejected', 'joined', 'rejected_by_branch_head')`
  );

  // Selected candidates
  const [selectedRes] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as selected FROM ats_candidate
     WHERE current_stage IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_pending', 'offer_accepted')`
  );

  // Rejected candidates
  const [rejectedRes] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as rejected FROM ats_candidate
     WHERE current_stage IN ('rejected', 'rejected_by_branch_head')`
  );

  // Today's interviews
  const [todayRes] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as today_interviews FROM ats_interview_result
     WHERE DATE(interviewed_at) = CURDATE()`
  );

  // Pending approvals
  const [pendingRes] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as pending FROM ats_payroll_hr_validation
     WHERE validation_status = 'approved'
     AND candidate_id IN (
       SELECT id FROM ats_candidate WHERE current_stage = 'payroll_validated'
     )`
  );

  // Employees joined this month
  const [joinedRes] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as joined FROM ats_candidate
     WHERE current_stage = 'joined'
     AND MONTH(created_at) = MONTH(CURRENT_DATE())
     AND YEAR(created_at) = YEAR(CURRENT_DATE())`
  );

  // Calculate conversion rate
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
 * Get source channel metrics
 */
export async function getSourceMetrics(): Promise<SourceMetrics[]> {
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      COALESCE(sourcing_channel, 'Walk-in') as source_channel,
      COUNT(*) as total_candidates,
      SUM(CASE WHEN current_stage IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_pending', 'offer_accepted', 'joined') THEN 1 ELSE 0 END) as selected_count,
      ROUND((SUM(CASE WHEN current_stage IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_pending', 'offer_accepted', 'joined') THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as conversion_rate
    FROM ats_candidate
    WHERE active_status = 1
    GROUP BY sourcing_channel
    ORDER BY total_candidates DESC`
  );

  return results as SourceMetrics[];
}

/**
 * Get branch metrics
 */
export async function getBranchMetrics(): Promise<BranchMetrics[]> {
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.applied_for_branch as branch_name,
      c.branch_display_name,
      COUNT(DISTINCT c.id) as total_candidates,
      SUM(CASE WHEN c.current_stage IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_pending', 'offer_accepted', 'joined') THEN 1 ELSE 0 END) as selected_count,
      SUM(CASE WHEN c.current_stage IN ('selected', 'bgv_pending') THEN 1 ELSE 0 END) as pending_interviews,
      COUNT(DISTINCT qt.recruiter_id) as active_recruiters
    FROM ats_candidate c
    LEFT JOIN ats_queue_token qt ON qt.candidate_id = c.id AND DATE(qt.created_at) = CURDATE()
    WHERE c.active_status = 1
    GROUP BY c.applied_for_branch, c.branch_display_name
    ORDER BY total_candidates DESC`
  );

  return results as BranchMetrics[];
}

/**
 * Get recruiter performance
 */
export async function getRecruiterPerformance(
  fromDate?: string,
  toDate?: string
): Promise<RecruiterPerformance[]> {
  const from = fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const to = toDate || new Date().toISOString().split('T')[0];

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
    GROUP BY ir.recruiter_id, e.employee_code, e.first_name, e.last_name
    HAVING total_interviews > 0
    ORDER BY total_interviews DESC
    LIMIT 20`,
    [from, to]
  );

  return results as RecruiterPerformance[];
}

/**
 * Get timeline data (last 30 days)
 */
export async function getTimelineData(days: number = 30): Promise<TimelineData[]> {
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
      GROUP BY DATE(created_at)
    ) reg ON date_series.date = reg.date
    LEFT JOIN (
      SELECT DATE(interviewed_at) as date, COUNT(*) as interviews
      FROM ats_interview_result
      GROUP BY DATE(interviewed_at)
    ) int ON date_series.date = int.date
    LEFT JOIN (
      SELECT DATE(interviewed_at) as date, COUNT(*) as selections
      FROM ats_interview_result
      WHERE interview_status = 'selected'
      GROUP BY DATE(interviewed_at)
    ) sel ON date_series.date = sel.date
    LEFT JOIN (
      SELECT DATE(interviewed_at) as date, COUNT(*) as rejections
      FROM ats_interview_result
      WHERE interview_status = 'rejected'
      GROUP BY DATE(interviewed_at)
    ) rej ON date_series.date = rej.date
    ORDER BY date_series.date ASC`,
    [days]
  );

  return results as TimelineData[];
}

/**
 * Get stage distribution
 */
export async function getStageDistribution(): Promise<StageDistribution[]> {
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      current_stage as stage,
      COUNT(*) as count,
      ROUND((COUNT(*) / (SELECT COUNT(*) FROM ats_candidate WHERE active_status = 1)) * 100, 2) as percentage
    FROM ats_candidate
    WHERE active_status = 1
    GROUP BY current_stage
    ORDER BY count DESC`
  );

  return results as StageDistribution[];
}

/**
 * Get role-wise applications
 */
export async function getRoleMetrics(): Promise<{ role: string; count: number }[]> {
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      applied_for_role as role,
      COUNT(*) as count
    FROM ats_candidate
    WHERE active_status = 1
    GROUP BY applied_for_role
    ORDER BY count DESC
    LIMIT 10`
  );

  return results as { role: string; count: number }[];
}

/**
 * Get experience-wise distribution
 */
export async function getExperienceDistribution(): Promise<{ experience: string; count: number }[]> {
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      years_of_experience as experience,
      COUNT(*) as count
    FROM ats_candidate
    WHERE active_status = 1 AND years_of_experience IS NOT NULL
    GROUP BY years_of_experience
    ORDER BY
      CASE
        WHEN years_of_experience = 'Fresher' THEN 0
        WHEN years_of_experience LIKE '%-%' THEN CAST(SUBSTRING_INDEX(years_of_experience, '-', 1) AS UNSIGNED)
        WHEN years_of_experience LIKE '%+%' THEN CAST(SUBSTRING_INDEX(years_of_experience, '+', 1) AS UNSIGNED)
        ELSE 999
      END`
  );

  return results as { experience: string; count: number }[];
}
