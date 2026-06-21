import { db } from '../../db/mysql.js'
import type { RowDataPacket } from 'mysql2'

/**
 * Get performance goals for a user
 */
export async function getUserGoals(userId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.* FROM goal g
     JOIN employees e ON g.employee_id = e.id
     WHERE e.user_id = ?
     LIMIT 20`,
    [userId]
  )
  return rows as RowDataPacket[]
}

/**
 * Get performance feedback requests for a user
 */
export async function getUserFeedbackRequests(userId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pfr.* FROM performance_feedback_request pfr
     JOIN employees e ON pfr.reviewer_id = e.id OR pfr.employee_id = e.id
     WHERE e.user_id = ? AND pfr.status IN ('pending', 'completed')
     LIMIT 50`,
    [userId]
  )
  return rows as RowDataPacket[]
}

/**
 * Get performance summary for dashboards
 */
export async function getPerformanceSummary(): Promise<Record<string, unknown>> {
  const [summary] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT e.id) AS total_employees,
       COUNT(DISTINCT g.employee_id) AS employees_with_goals,
       COUNT(DISTINCT ar.employee_id) AS employees_rated,
       ROUND(AVG(ar.final_rating), 2) AS avg_rating,
       SUM(CASE WHEN ar.final_rating >= 4 THEN 1 ELSE 0 END) AS high_performers,
       SUM(CASE WHEN ar.final_rating < 2.5 THEN 1 ELSE 0 END) AS low_performers
     FROM employees e
     LEFT JOIN goal g ON e.id = g.employee_id AND g.status = 'active'
     LEFT JOIN appraisal_rating ar ON e.id = ar.employee_id
     WHERE e.active_status = 1`
  )
  return summary[0] as Record<string, unknown>
}

/**
 * Get all competencies from the master list
 */
export async function getCompetencies(): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT competency_id, competency_name, description, category, is_active
     FROM competency_master
     WHERE is_active = 1
     ORDER BY category, competency_name`
  )
  return rows as RowDataPacket[]
}

/**
 * Get active feedback cycles
 */
export async function getActiveCycles(): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cycle_id, cycle_name, period, start_date, end_date, deadline,
            feedback_type, status, created_at
     FROM performance_feedback_cycle
     WHERE status IN ('draft', 'active')
     ORDER BY start_date DESC
     LIMIT 50`
  )
  return rows as RowDataPacket[]
}

/**
 * Submit a feedback response
 */
export async function submitFeedbackResponse(
  requestId: string,
  competencyId: number,
  rating: number,
  comments?: string
): Promise<{ responseId: string }> {
  const responseId = require('crypto').randomUUID()
  await db.execute(
    `INSERT INTO performance_feedback_response
     (response_id, request_id, competency_id, rating, comments, submitted_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [responseId, requestId, competencyId, rating, comments || null]
  )

  // Update the feedback request status
  await db.execute(
    `UPDATE performance_feedback_request SET status = 'completed', completed_at = NOW()
     WHERE request_id = ?`,
    [requestId]
  )

  return { responseId }
}
