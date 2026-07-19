import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { getIstDateString } from '../../utils/dateUtils.js';

/**
 * Enhanced Queue Service
 * Provides real-time queue management with filters and metrics
 */

export interface QueueEntry {
  id: string;
  token_number: string;
  candidate_id: string;
  candidate_name: string;
  mobile: string;
  email: string;
  applied_role: string;
  branch_name: string;
  branch_display_name: string;
  queue_status: 'waiting' | 'called' | 'in_interview' | 'completed' | 'no_show';
  recruiter_id: string;
  recruiter_name: string;
  recruiter_employee_code: string;
  created_at: string;
  arrival_time: string;
  called_at: string | null;
  interview_started_at: string | null;
  interview_completed_at: string | null;
  estimated_wait_time: number | null;
  position_in_queue: number;
  // Score columns
  skilltest_typing: number | null;
  skilltest_ai: number | null;
  skilltest_result: string | null;
  assessment_percentage: number | null;
  typing_net_wpm: number | null;
}

export interface QueueFilters {
  branch?: string;
  date?: string;
  status?: string;
  recruiter_id?: string;
  search?: string;
}

export interface QueueMetrics {
  total_waiting: number;
  total_in_interview: number;
  total_completed_today: number;
  average_wait_time: number;
  average_interview_duration: number;
  active_recruiters: number;
}

interface AvgDurationRow extends RowDataPacket {
  branch_name?: string | null;
  avg_duration?: number | null;
}

const ROLE_EXPR = "COALESCE(NULLIF(c.role_applied, ''), NULLIF(pm.process_name, ''), NULLIF(c.applied_for_process, ''))";
const BRANCH_EXPR = "COALESCE(NULLIF(qt.branch_name, ''), NULLIF(c.branch_display_name, ''), NULLIF(bm.branch_name, ''), NULLIF(c.applied_for_branch, ''))";
const queueTimeExpr = (alias: string) => `COALESCE(${alias}.arrival_time, ${alias}.created_at)`;

/**
 * Get live queue with filters
 */
export async function getLiveQueue(filters: QueueFilters = {}): Promise<QueueEntry[]> {
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  // Date filter (default to today)
  const targetDate = filters.date || getIstDateString();
  conditions.push(`DATE(${queueTimeExpr('qt')}) = ?`);
  params.push(targetDate);

  // Branch filter
  if (filters.branch) {
    conditions.push(`${BRANCH_EXPR} = ?`);
    params.push(filters.branch);
  }

  // Status filter — fall back to legacy `status` column when queue_status is null
  if (filters.status) {
    conditions.push('COALESCE(qt.queue_status, IF(qt.status=\'active\',\'waiting\',qt.status)) = ?');
    params.push(filters.status);
  }

  // Recruiter filter
  if (filters.recruiter_id) {
    conditions.push('qt.recruiter_id = ?');
    params.push(filters.recruiter_id);
  }

  // Search filter (name, mobile, token)
  if (filters.search) {
    conditions.push(`(
      c.full_name LIKE ? OR
      c.mobile LIKE ? OR
      qt.token_number LIKE ? OR
      qt.token LIKE ?
    )`);
    const searchTerm = `%${filters.search}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      qt.id,
      COALESCE(qt.token_number, qt.token) as token_number,
      qt.candidate_id,
      c.full_name as candidate_name,
      c.mobile,
      c.email,
      ${ROLE_EXPR} as applied_role,
      ${BRANCH_EXPR} as branch_name,
      c.branch_display_name,
      COALESCE(qt.queue_status, IF(qt.status='active','waiting',qt.status)) AS queue_status,
      COALESCE(qt.recruiter_id, qt.assigned_recruiter_id) AS recruiter_id,
      COALESCE(e.full_name, 'Unassigned') as recruiter_name,
      COALESCE(e.employee_code, 'N/A') as recruiter_employee_code,
      qt.created_at,
      COALESCE(qt.arrival_time, qt.created_at) AS arrival_time,
      qt.called_at,
      qt.interview_started_at,
      qt.interview_completed_at,
      qt.estimated_wait_time,
      (
        SELECT COUNT(*) + 1
        FROM ats_queue_token qt2
        WHERE ${queueTimeExpr('qt2')} < ${queueTimeExpr('qt')}
          AND DATE(${queueTimeExpr('qt2')}) = DATE(${queueTimeExpr('qt')})
          AND (qt2.queue_status IN ('waiting', 'called') OR (qt2.queue_status IS NULL AND qt2.status = 'active'))
      ) as position_in_queue,
      c.skilltest_typing,
      c.skilltest_ai,
      c.skilltest_result,
      scores.assessment_percentage,
      scores.typing_net_wpm
    FROM ats_queue_token qt
    INNER JOIN ats_candidate c ON c.id = qt.candidate_id
    LEFT JOIN process_master pm ON pm.id = c.applied_for_process
    LEFT JOIN branch_master bm ON bm.id = c.applied_for_branch
    LEFT JOIN ats_recruiter_roster rr ON rr.id = COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)
    LEFT JOIN employees e ON e.id = rr.employee_id
    LEFT JOIN (
      SELECT aca.candidate_id,
             MAX(aca.percentage)  AS assessment_percentage,
             MAX(ata.net_wpm)     AS typing_net_wpm
      FROM ats_candidate_assessment aca
      LEFT JOIN ats_typing_test_attempt ata ON ata.assessment_id = aca.id
      GROUP BY aca.candidate_id
    ) scores ON scores.candidate_id = c.id
    WHERE ${conditions.join(' AND ')}
      AND (
        qt.queue_status IN ('waiting','called','in_interview')
        OR (qt.queue_status IS NULL AND qt.status = 'active')
      )
      ORDER BY
        CASE COALESCE(qt.queue_status, 'waiting')
        WHEN 'in_interview' THEN 1
        WHEN 'called' THEN 2
        WHEN 'waiting' THEN 3
        WHEN 'completed' THEN 4
        WHEN 'no_show' THEN 5
        ELSE 6
      END,
       ${queueTimeExpr('qt')} ASC`,
    params
  );

  return rows as QueueEntry[];
}

/**
 * Get queue metrics for dashboard
 */
export async function getQueueMetrics(branch?: string, date?: string): Promise<QueueMetrics> {
  const targetDate = date || getIstDateString();
  const branchCondition = branch ? `AND ${BRANCH_EXPR} = ?` : '';
  const params: unknown[] = branch ? [targetDate, branch] : [targetDate];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      SUM(CASE WHEN COALESCE(qt.queue_status, IF(qt.status='active','waiting',qt.status)) = 'waiting' THEN 1 ELSE 0 END) as total_waiting,
      SUM(CASE WHEN COALESCE(qt.queue_status, IF(qt.status='active','waiting',qt.status)) = 'in_interview' THEN 1 ELSE 0 END) as total_in_interview,
      SUM(CASE WHEN COALESCE(qt.queue_status, IF(qt.status='active','waiting',qt.status)) = 'completed' THEN 1 ELSE 0 END) as total_completed_today,
      ROUND(AVG(
        CASE WHEN qt.called_at IS NOT NULL
          AND COALESCE(qt.queue_status, IF(qt.status='active','waiting',qt.status)) IN ('called','in_interview','completed')
        THEN TIMESTAMPDIFF(MINUTE, COALESCE(qt.arrival_time, qt.created_at), qt.called_at)
        ELSE NULL END
      ), 2) as average_wait_time,
      ROUND(AVG(
        CASE WHEN qt.interview_completed_at IS NOT NULL
        THEN TIMESTAMPDIFF(MINUTE, qt.interview_started_at, qt.interview_completed_at)
        ELSE NULL END
      ), 2) as average_interview_duration,
      COUNT(DISTINCT COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)) as active_recruiters
    FROM ats_queue_token qt
    INNER JOIN ats_candidate c ON c.id = qt.candidate_id
    LEFT JOIN branch_master bm ON bm.id = c.applied_for_branch
    WHERE DATE(${queueTimeExpr('qt')}) = ? ${branchCondition}`,
    params
  );

  const metrics = rows[0] || {};

  return {
    total_waiting: metrics.total_waiting || 0,
    total_in_interview: metrics.total_in_interview || 0,
    total_completed_today: metrics.total_completed_today || 0,
    average_wait_time: metrics.average_wait_time || 0,
    average_interview_duration: metrics.average_interview_duration || 0,
    active_recruiters: metrics.active_recruiters || 0,
  };
}

/**
 * Get next candidate in queue for a recruiter
 */
export async function getNextCandidate(recruiterId: string, branch: string): Promise<QueueEntry | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      qt.id,
      COALESCE(qt.token_number, qt.token) as token_number,
      qt.candidate_id,
      c.full_name as candidate_name,
      c.mobile,
      c.email,
      ${ROLE_EXPR} as applied_role,
      ${BRANCH_EXPR} as branch_name,
      c.branch_display_name,
      COALESCE(qt.queue_status, IF(qt.status='active','waiting',qt.status)) AS queue_status,
      COALESCE(qt.recruiter_id, qt.assigned_recruiter_id) AS recruiter_id,
      e.full_name as recruiter_name,
      e.employee_code as recruiter_employee_code,
      qt.created_at,
      qt.called_at,
      qt.interview_started_at,
      qt.interview_completed_at,
      qt.estimated_wait_time,
      1 as position_in_queue
    FROM ats_queue_token qt
    INNER JOIN ats_candidate c ON c.id = qt.candidate_id
    LEFT JOIN process_master pm ON pm.id = c.applied_for_process
    LEFT JOIN branch_master bm ON bm.id = c.applied_for_branch
    LEFT JOIN ats_recruiter_roster rr ON rr.id = COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)
    LEFT JOIN employees e ON e.id = rr.employee_id
    WHERE (COALESCE(qt.recruiter_id, qt.assigned_recruiter_id) = ?
      OR qt.assigned_recruiter_id = ?)
      AND ${BRANCH_EXPR} = ?
      AND (qt.queue_status = 'waiting' OR (qt.queue_status IS NULL AND qt.status = 'active'))
      AND DATE(${queueTimeExpr('qt')}) = CURDATE()
    ORDER BY ${queueTimeExpr('qt')} ASC
    LIMIT 1`,
    [recruiterId, recruiterId, branch]
  );

  return rows.length > 0 ? (rows[0] as QueueEntry) : null;
}

/**
 * Update queue status with timestamps
 */
export async function updateQueueStatus(
  queueId: string,
  status: 'waiting' | 'called' | 'in_interview' | 'completed' | 'no_show'
): Promise<void> {
  const timestampFields: Record<string, string> = {
    called: 'called_at',
    in_interview: 'interview_started_at',
    completed: 'interview_completed_at',
  };

  const timestampField = timestampFields[status];

  if (timestampField) {
    await db.execute(
      `UPDATE ats_queue_token
       SET queue_status = ?, ${timestampField} = NOW()
       WHERE id = ?`,
      [status, queueId]
    );
  } else {
    await db.execute(
      `UPDATE ats_queue_token
       SET queue_status = ?
       WHERE id = ?`,
      [status, queueId]
    );
  }

  // Update estimated wait time for waiting candidates in same branch
  await updateEstimatedWaitTimes();
}

/**
 * Update estimated wait times for all waiting candidates.
 * Uses per-branch avg interview duration from today's completed interviews (fallback 15 min).
 */
async function updateEstimatedWaitTimes(): Promise<void> {
  await db.execute(
    `UPDATE ats_queue_token qt
     JOIN (
       SELECT
         qt1.id,
         COUNT(qt2.id) * COALESCE(
           (SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, q3.interview_started_at, q3.interview_completed_at)))
              FROM ats_queue_token q3
             WHERE q3.branch_name = qt1.branch_name
               AND q3.queue_status = 'completed'
               AND q3.interview_completed_at IS NOT NULL
               AND DATE(COALESCE(q3.arrival_time, q3.created_at)) = CURDATE()),
           15
         ) AS wait_time
       FROM ats_queue_token qt1
       LEFT JOIN ats_queue_token qt2
         ON qt2.branch_name = qt1.branch_name
         AND qt2.queue_status IN ('called', 'in_interview')
         AND COALESCE(qt2.arrival_time, qt2.created_at) < COALESCE(qt1.arrival_time, qt1.created_at)
         AND DATE(COALESCE(qt2.arrival_time, qt2.created_at)) = CURDATE()
       WHERE qt1.queue_status = 'waiting'
         AND DATE(COALESCE(qt1.arrival_time, qt1.created_at)) = CURDATE()
       GROUP BY qt1.id, qt1.branch_name
     ) AS sub ON sub.id = qt.id
     SET qt.estimated_wait_time = sub.wait_time`
  );
}

/**
 * Get recruiter's current queue
 */
export async function getRecruiterQueue(recruiterId: string): Promise<QueueEntry[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      qt.id,
      COALESCE(qt.token_number, qt.token) as token_number,
      qt.candidate_id,
      c.full_name as candidate_name,
      c.mobile,
      c.email,
      ${ROLE_EXPR} as applied_role,
      ${BRANCH_EXPR} as branch_name,
      c.branch_display_name,
      COALESCE(qt.queue_status, IF(qt.status='active','waiting',qt.status)) AS queue_status,
      COALESCE(qt.recruiter_id, qt.assigned_recruiter_id) AS recruiter_id,
      e.full_name as recruiter_name,
      e.employee_code as recruiter_employee_code,
      qt.created_at,
      qt.called_at,
      qt.interview_started_at,
      qt.interview_completed_at,
      qt.estimated_wait_time,
      (
        SELECT COUNT(*) + 1
        FROM ats_queue_token qt2
        WHERE COALESCE(qt2.recruiter_id, qt2.assigned_recruiter_id) = COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)
          AND (qt2.queue_status IN ('waiting', 'called') OR (qt2.queue_status IS NULL AND qt2.status = 'active'))
          AND ${queueTimeExpr('qt2')} < ${queueTimeExpr('qt')}
          AND DATE(${queueTimeExpr('qt2')}) = CURDATE()
      ) as position_in_queue
    FROM ats_queue_token qt
    INNER JOIN ats_candidate c ON c.id = qt.candidate_id
    LEFT JOIN process_master pm ON pm.id = c.applied_for_process
    LEFT JOIN branch_master bm ON bm.id = c.applied_for_branch
    LEFT JOIN ats_recruiter_roster rr ON rr.id = COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)
    LEFT JOIN employees e ON e.id = rr.employee_id
    WHERE COALESCE(qt.recruiter_id, qt.assigned_recruiter_id) = ?
      AND (
        qt.queue_status IN ('waiting', 'called', 'in_interview')
        OR (qt.queue_status IS NULL AND qt.status = 'active')
      )
      AND DATE(${queueTimeExpr('qt')}) = CURDATE()
    ORDER BY ${queueTimeExpr('qt')} ASC`,
    [recruiterId]
  );

  return rows as QueueEntry[];
}

/**
 * Call next candidate (update status to 'called')
 */
export async function callNextCandidate(queueId: string): Promise<void> {
  await updateQueueStatus(queueId, 'called');
}

/**
 * Mark candidate as no-show
 */
export async function markNoShow(queueId: string): Promise<void> {
  await updateQueueStatus(queueId, 'no_show');
}

/**
 * Get queue position for a candidate
 */
export async function getQueuePosition(candidateId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      (
        SELECT COUNT(*) + 1
        FROM ats_queue_token qt2
        WHERE ${queueTimeExpr('qt2')} < ${queueTimeExpr('qt')}
          AND DATE(${queueTimeExpr('qt2')}) = CURDATE()
          AND (qt2.queue_status IN ('waiting', 'called') OR (qt2.queue_status IS NULL AND qt2.status = 'active'))
      ) as position
    FROM ats_queue_token qt
    WHERE qt.candidate_id = ?
      AND DATE(${queueTimeExpr('qt')}) = CURDATE()
      AND (qt.queue_status IS NULL OR qt.queue_status NOT IN ('completed','no_show'))
      AND (qt.status IS NULL OR qt.status = 'active')
    LIMIT 1`,
    [candidateId]
  );

  return rows.length > 0 ? rows[0].position : 0;
}

/**
 * Cleanup stale in_interview tokens
 * Auto-transitions tokens that have been in_interview for more than 2 hours to no_show
 */
export async function cleanupStaleInterviews(): Promise<number> {
  const STALE_THRESHOLD_MINUTES = 120; // 2 hours

  const [result] = await db.execute(
    `UPDATE ats_queue_token
     SET queue_status = 'no_show',
         interview_completed_at = NOW()
     WHERE queue_status = 'in_interview'
       AND interview_started_at IS NOT NULL
       AND TIMESTAMPDIFF(MINUTE, interview_started_at, NOW()) > ?
       AND DATE(COALESCE(arrival_time, created_at)) = CURDATE()`,
    [STALE_THRESHOLD_MINUTES]
  );

  return (result as any).affectedRows || 0;
}
