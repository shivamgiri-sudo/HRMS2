import { Router } from 'express'
import { db } from '../../db/mysql.js'
import { requireAuth } from '../../middleware/authMiddleware.js'
import { requireRole } from '../../middleware/requireRole.js'
import type { Response, Request } from 'express'
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js'
import type { RowDataPacket } from 'mysql2'
import mysql from 'mysql2/promise'
import { env } from '../../config/env.js'

const performanceDashboardRouter = Router()
performanceDashboardRouter.use(requireAuth)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) =>
  fn(req, res).catch(next)

let _ciPool: mysql.Pool | null = null
function getCiPool(): mysql.Pool {
  if (!_ciPool) _ciPool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'Shivamgiri',
    waitForConnections: true,
    connectionLimit: 3,
    connectTimeout: 10000,
  })
  return _ciPool
}

function pdDates(q: Record<string, unknown>): { from: string; to: string } {
  const now = new Date()
  const to = q.to ? String(q.to) : now.toISOString().slice(0, 10)
  const from = q.from ? String(q.from) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  return { from, to }
}

const PERF_ROLES = ['admin', 'hr', 'super_admin', 'manager', 'process_manager', 'ceo', 'qa', 'wfm'] as const

/**
 * GET /api/performance-dashboard/goals
 * Retrieve performance goals for the current employee or all (if admin/hr)
 */
performanceDashboardRouter.get('/goals', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthenticated' })
  }

  try {
    // Get the employee_id for this user
    const [userEmps] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
      [userId]
    )

    const employeeId = (userEmps && userEmps[0]) ? (userEmps[0] as any).id : null

    let query = `SELECT id, employee_id, title, description, goal_type, period,
                        target_value, actual_value, weightage, status,
                        created_by, created_at, updated_at
                 FROM goal`
    const params: any[] = []

    if (employeeId) {
      query += ` WHERE employee_id = ?`
      params.push(employeeId)
    }

    query += ` ORDER BY created_at DESC LIMIT 100`

    const [goals] = await db.execute<RowDataPacket[]>(query, params)
    return res.json({ success: true, data: goals })
  } catch (err) {
    return res.status(500).json({ success: false, message: String(err) })
  }
}))

/**
 * GET /api/performance-dashboard/feedback
 * Retrieve performance feedback for the current employee
 */
performanceDashboardRouter.get('/feedback', h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthenticated' })
  }

  try {
    // Get the employee_id for this user
    const [userEmps] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
      [userId]
    )

    const employeeId = (userEmps && userEmps[0]) ? (userEmps[0] as any).id : null

    if (!employeeId) {
      return res.json({ success: true, data: [] })
    }

    const [feedback] = await db.execute<RowDataPacket[]>(
      `SELECT pfr.request_id, pfr.cycle_id, pfr.employee_id, pfr.reviewer_id,
              pfr.reviewer_type, pfr.status, pfr.requested_at, pfr.completed_at,
              pfc.cycle_name, pfc.period
       FROM performance_feedback_request pfr
       LEFT JOIN performance_feedback_cycle pfc ON pfr.cycle_id = pfc.cycle_id
       WHERE pfr.employee_id = ? OR pfr.reviewer_id = ?
       ORDER BY pfr.requested_at DESC LIMIT 100`,
      [employeeId, employeeId]
    )
    return res.json({ success: true, data: feedback })
  } catch (err) {
    return res.status(500).json({ success: false, message: String(err) })
  }
}))

/**
 * GET /api/performance-dashboard/ratings
 * Retrieve performance ratings (admin/manager view)
 */
performanceDashboardRouter.get('/ratings', requireRole('admin', 'hr', 'manager', 'process_manager', 'ceo'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const [ratings] = await db.execute<RowDataPacket[]>(
        `SELECT e.id, e.first_name, e.last_name, e.employee_code,
                ar.final_rating, ar.manager_comments, ac.cycle_name, ac.period
         FROM employees e
         LEFT JOIN appraisal_rating ar ON e.id = ar.employee_id
         LEFT JOIN appraisal_cycle ac ON ar.cycle_id = ac.id
         WHERE e.active_status = 1 AND ac.status = 'active'
         ORDER BY ar.final_rating DESC LIMIT 100`
      )
      return res.json({ success: true, data: ratings })
    } catch (err) {
      return res.status(500).json({ success: false, message: String(err) })
    }
  }))

/**
 * GET /api/performance-dashboard/summary
 * Get summary statistics for performance dashboard
 */
performanceDashboardRouter.get('/summary', requireRole('admin', 'hr', 'manager', 'process_manager', 'ceo', 'qa', 'analyst'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    try {
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
      return res.json({ success: true, summary: summary[0], data: summary[0] })
    } catch (err) {
      return res.status(500).json({ success: false, message: String(err) })
    }
  }))

/**
 * GET /api/performance-dashboard/competencies
 * Get competency framework
 */
performanceDashboardRouter.get('/competencies', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [competencies] = await db.execute<RowDataPacket[]>(
      `SELECT competency_id, competency_name, description, category, is_active
       FROM competency_master
       WHERE is_active = 1
       ORDER BY category, competency_name`
    )
    return res.json({ success: true, data: competencies })
  } catch (err) {
    return res.status(500).json({ success: false, message: String(err) })
  }
}))

/**
 * GET /api/performance-dashboard/cycles
 * Get active performance feedback cycles
 */
performanceDashboardRouter.get('/cycles', h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [cycles] = await db.execute<RowDataPacket[]>(
      `SELECT cycle_id, cycle_name, period, start_date, end_date, deadline,
              feedback_type, status, created_at
       FROM performance_feedback_cycle
       WHERE status IN ('draft', 'active')
       ORDER BY start_date DESC LIMIT 50`
    )
    return res.json({ success: true, data: cycles })
  } catch (err) {
    return res.status(500).json({ success: false, message: String(err) })
  }
}))

/**
 * POST /api/performance-dashboard/feedback-response
 * Submit feedback response for a competency
 */
performanceDashboardRouter.post('/feedback-response', requireRole('admin', 'hr', 'manager', 'process_manager', 'employee'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { requestId, competencyId, rating, comments } = req.body

    if (!requestId || !competencyId || !rating) {
      return res.status(400).json({ success: false, message: 'Missing required fields' })
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' })
    }

    try {
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

      return res.json({ success: true, message: 'Feedback submitted', responseId })
    } catch (err) {
      return res.status(500).json({ success: false, message: String(err) })
    }
  }))

// GET /api/performance-dashboard/agent-matrix
performanceDashboardRouter.get('/agent-matrix', requireRole(...PERF_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from, to } = pdDates(req.query)
      const pool = getCiPool()
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
           apr.UserID AS agent_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, e.last_name), apr.UserID) AS agent_name,
           SUM(apr.Calls) AS total_calls,
           ROUND(AVG(TIME_TO_SEC(apr.AHT)), 0) AS avg_aht_seconds,
           ROUND(AVG(
             CASE WHEN TIME_TO_SEC(IFNULL(apr.Login_Time,'00:00:00')) > 0 THEN
               (TIME_TO_SEC(IFNULL(apr.BIO,'00:00:00')) + TIME_TO_SEC(IFNULL(apr.LUNCH,'00:00:00')) +
                TIME_TO_SEC(IFNULL(apr.QA,'00:00:00')) + TIME_TO_SEC(IFNULL(apr.TRAINING,'00:00:00')))
               / TIME_TO_SEC(IFNULL(apr.Login_Time,'00:00:00')) * 100
             ELSE 0 END
           ), 2) AS shrinkage_pct,
           COUNT(*) AS days_present
         FROM Shivamgiri.apr apr
         LEFT JOIN mas_hrms.employees e ON e.employee_code = apr.UserID
         WHERE apr.ReportDate BETWEEN ? AND ?
         GROUP BY apr.UserID
         ORDER BY total_calls DESC
         LIMIT 200`,
        [from, to]
      )
      return res.json({ success: true, matrix: rows })
    } catch (err) {
      return res.json({ success: true, matrix: [] })
    }
  }))

// GET /api/performance-dashboard/trend
performanceDashboardRouter.get('/trend', requireRole(...PERF_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from, to } = pdDates(req.query)
      const pool = getCiPool()
      const [aprTrend] = await pool.execute<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(ReportDate, '%Y-%m-%d') AS date,
           ROUND(AVG(Calls), 1) AS avg_calls,
           ROUND(AVG(TIME_TO_SEC(AHT)), 0) AS avg_aht_seconds,
           ROUND(AVG(
             CASE WHEN TIME_TO_SEC(IFNULL(Login_Time,'00:00:00')) > 0 THEN
               (TIME_TO_SEC(IFNULL(BIO,'00:00:00')) + TIME_TO_SEC(IFNULL(LUNCH,'00:00:00')) +
                TIME_TO_SEC(IFNULL(QA,'00:00:00')) + TIME_TO_SEC(IFNULL(TRAINING,'00:00:00')))
               / TIME_TO_SEC(IFNULL(Login_Time,'00:00:00')) * 100
             ELSE 0 END
           ), 2) AS avg_shrinkage
         FROM Shivamgiri.apr
         WHERE ReportDate BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(ReportDate, '%Y-%m-%d')
         ORDER BY date ASC`,
        [from, to]
      )
      return res.json({
        success: true,
        apr_trend: aprTrend,
        audit_trend: [],
        sales_trend: [],
      })
    } catch (err) {
      return res.json({ success: true, apr_trend: [], audit_trend: [], sales_trend: [] })
    }
  }))

// GET /api/performance-dashboard/process-comparison
performanceDashboardRouter.get('/process-comparison', requireRole(...PERF_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from, to } = pdDates(req.query)
      const pool = getCiPool()
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
           COALESCE(pm.process_name, apr.campaign_id, 'Unknown') AS process,
           COUNT(DISTINCT apr.UserID) AS agent_count,
           ROUND(AVG(apr.Calls), 1) AS avg_calls,
           ROUND(AVG(TIME_TO_SEC(apr.AHT)), 0) AS avg_aht_seconds,
           ROUND(AVG(
             CASE WHEN TIME_TO_SEC(IFNULL(apr.Login_Time,'00:00:00')) > 0 THEN
               (TIME_TO_SEC(IFNULL(apr.BIO,'00:00:00')) + TIME_TO_SEC(IFNULL(apr.LUNCH,'00:00:00')) +
                TIME_TO_SEC(IFNULL(apr.QA,'00:00:00')) + TIME_TO_SEC(IFNULL(apr.TRAINING,'00:00:00')))
               / TIME_TO_SEC(IFNULL(apr.Login_Time,'00:00:00')) * 100
             ELSE 0 END
           ), 2) AS avg_shrinkage
         FROM Shivamgiri.apr apr
         LEFT JOIN mas_hrms.process_master pm ON pm.process_code = apr.campaign_id
         WHERE apr.ReportDate BETWEEN ? AND ?
         GROUP BY apr.campaign_id
         ORDER BY avg_calls DESC`,
        [from, to]
      )
      return res.json({ success: true, processes: rows })
    } catch (err) {
      return res.json({ success: true, processes: [] })
    }
  }))

// GET /api/performance-dashboard/utilization
performanceDashboardRouter.get('/utilization', requireRole(...PERF_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from, to } = pdDates(req.query)
      const pool = getCiPool()
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
           apr.UserID AS agent_code,
           COALESCE(NULLIF(e.full_name,''), apr.UserID) AS agent_name,
           ROUND(AVG(TIME_TO_SEC(IFNULL(apr.Login_Time,'00:00:00'))) / 3600, 2) AS login_hours,
           ROUND(AVG(TIME_TO_SEC(IFNULL(apr.Net_Login,'00:00:00'))) / 3600, 2) AS net_login_hours,
           ROUND(AVG(
             CASE WHEN TIME_TO_SEC(IFNULL(apr.Login_Time,'00:00:00')) > 0 THEN
               TIME_TO_SEC(IFNULL(apr.Net_Login,'00:00:00'))
               / TIME_TO_SEC(IFNULL(apr.Login_Time,'00:00:00')) * 100
             ELSE 0 END
           ), 2) AS utilization_pct,
           ROUND(AVG(TIME_TO_SEC(IFNULL(apr.BIO,'00:00:00'))) / 60, 1) AS bio_mins,
           ROUND(AVG(TIME_TO_SEC(IFNULL(apr.LUNCH,'00:00:00'))) / 60, 1) AS lunch_mins,
           ROUND(AVG(TIME_TO_SEC(IFNULL(apr.QA,'00:00:00'))) / 60, 1) AS qa_mins,
           ROUND(AVG(TIME_TO_SEC(IFNULL(apr.TRAINING,'00:00:00'))) / 60, 1) AS training_mins
         FROM Shivamgiri.apr apr
         LEFT JOIN mas_hrms.employees e ON e.employee_code = apr.UserID
         WHERE apr.ReportDate BETWEEN ? AND ?
         GROUP BY apr.UserID
         ORDER BY utilization_pct DESC
         LIMIT 200`,
        [from, to]
      )
      return res.json({ success: true, utilization: rows })
    } catch (err) {
      return res.json({ success: true, utilization: [] })
    }
  }))

export { performanceDashboardRouter }
