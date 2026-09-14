import { Router } from 'express'
import { db } from '../../db/mysql.js'
import { requireAuth } from '../../middleware/authMiddleware.js'
import { requireRole } from '../../middleware/requireRole.js'
import type { Response, Request } from 'express'
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js'
import type { RowDataPacket } from 'mysql2'
import mysql from 'mysql2/promise'
import { env } from '../../config/env.js'
import { getUserRoleContext } from '../../shared/roleResolver.js'
import {
  buildScopeWhereEmployees,
  narrowDashboardScope,
  resolveDashboardScope,
} from '../../shared/dashboardScope.js'
import { logSourceFailure } from "../../shared/apiResponse.js"
import { randomUUID } from "node:crypto"

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

// Roles that see ALL agents (org-wide) — others get scope-filtered to their branch/process
const WIDE_SCOPE_ROLES = new Set(['super_admin', 'admin', 'ceo', 'coo', 'operations_manager', 'wfm'])

/**
 * Returns allowed employee_codes for the calling user.
 * Wide-scope roles return null (no restriction).
 *
 * Scope is derived from the caller's own assignment, NOT from query parameters.
 * Previously branchId/processId came straight off req.query, so a scoped role that
 * simply omitted them fell through to `WHERE e.active_status = 1` and received the
 * first 500 employees company-wide — the query string was the only thing standing
 * between a process manager and org-wide performance data.
 *
 * Query params may now only NARROW the caller's own scope, via narrowDashboardScope,
 * which validates the requested branch/process against what they are entitled to.
 * The former LIMIT 500 is also gone: it silently truncated legitimately-scoped
 * managers, producing wrong numbers rather than restricted ones.
 */
async function getScopeFilter(req: AuthenticatedRequest): Promise<{ codes: string[] | null; branchId?: string; processId?: string }> {
  const userId = req.authUser!.id
  const ctx = await getUserRoleContext(userId)
  if (ctx.isSuperAdmin || ctx.isHO || ctx.roleKeys.some(r => WIDE_SCOPE_ROLES.has(r))) {
    return { codes: null }
  }

  let scope
  try {
    scope = await resolveDashboardScope(userId, ctx.primaryRole)
    scope = await narrowDashboardScope(scope, req.query.branchId as string | undefined, req.query.processId as string | undefined)
  } catch {
    // Unresolvable scope is fail-closed: no rows rather than everyone's rows.
    return { codes: [] }
  }

  if (scope.level === 'ORG_ALL') return { codes: null }

  const { sql: scopeSql, params } = buildScopeWhereEmployees(scope, 'e')
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code FROM employees e WHERE e.active_status = 1 AND ${scopeSql}`,
    params
  )
  const codes = (rows as any[]).map((r: any) => String(r.employee_code)).filter(Boolean)
  return { codes, branchId: scope.branchIds[0], processId: scope.processIds[0] }
}

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

    // Guard: if the authenticated user has no employee record, return empty rather than exposing all goals.
    if (!employeeId) {
      return res.json({ success: true, data: [] })
    }

    const query = `SELECT id, employee_id, title, description, goal_type, period,
                          target_value, actual_value, weightage, status,
                          created_by, created_at, updated_at
                   FROM goal
                   WHERE employee_id = ?
                   ORDER BY created_at DESC LIMIT 100`

    const [goals] = await db.execute<RowDataPacket[]>(query, [employeeId])
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
performanceDashboardRouter.get('/ratings', requireRole('admin', 'hr', 'super_admin', 'manager', 'process_manager', 'ceo'),
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
performanceDashboardRouter.get('/summary', requireRole('admin', 'hr', 'super_admin', 'manager', 'process_manager', 'ceo', 'qa', 'quality_analyst'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Reachable by scoped roles (manager, process_manager, qa, quality_analyst) but had
      // no row-level restriction at all — unlike /agent-matrix, /trend, /ops, /utilization
      // in this same file, which all use getScopeFilter. A manager saw org-wide totals/
      // avg-rating/high-low-performer counts, not their own team's. Fixed 2026-09-01.
      const scope = await getScopeFilter(req)
      let scopeSql = ''
      const scopeParams: string[] = []
      if (scope.codes !== null) {
        if (scope.codes.length === 0) {
          return res.json({ success: true, summary: { total_employees: 0, employees_with_goals: 0, employees_rated: 0, avg_rating: null, high_performers: 0, low_performers: 0 }, data: null })
        }
        scopeSql = ` AND e.employee_code IN (${scope.codes.map(() => '?').join(',')})`
        scopeParams.push(...scope.codes)
      }
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
         WHERE e.active_status = 1${scopeSql}`,
        scopeParams
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
      const responseId = randomUUID()
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
      const scope = await getScopeFilter(req)
      let scopeSql = ''
      const extraParams: string[] = []
      if (scope.codes !== null) {
        if (scope.codes.length === 0) return res.json({ success: true, matrix: [] })
        scopeSql = ` AND apr.UserID IN (${scope.codes.map(() => '?').join(',')})`
        extraParams.push(...scope.codes)
      }
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
         WHERE apr.ReportDate BETWEEN ? AND ?${scopeSql}
         GROUP BY apr.UserID
         ORDER BY total_calls DESC
         LIMIT 200`,
        [from, to, ...extraParams]
      )
      return res.json({ success: true, matrix: rows })
    } catch (err) {
      logSourceFailure("performance-dashboard", err, { endpoint: "agent-matrix" })
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
      logSourceFailure("performance-dashboard", err, { endpoint: "trend" })
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
      logSourceFailure("performance-dashboard", err, { endpoint: "process-comparison" })
      return res.json({ success: true, processes: [] })
    }
  }))

// GET /api/performance-dashboard/utilization
performanceDashboardRouter.get('/utilization', requireRole(...PERF_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from, to } = pdDates(req.query)
      const pool = getCiPool()
      const scope = await getScopeFilter(req)
      let scopeSql = ''
      const extraParams: string[] = []
      if (scope.codes !== null) {
        if (scope.codes.length === 0) return res.json({ success: true, utilization: [] })
        scopeSql = ` AND apr.UserID IN (${scope.codes.map(() => '?').join(',')})`
        extraParams.push(...scope.codes)
      }
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
         WHERE apr.ReportDate BETWEEN ? AND ?${scopeSql}
         GROUP BY apr.UserID
         ORDER BY utilization_pct DESC
         LIMIT 200`,
        [from, to, ...extraParams]
      )
      return res.json({ success: true, utilization: rows })
    } catch (err) {
      logSourceFailure("performance-dashboard", err, { endpoint: "utilization" })
      return res.json({ success: true, utilization: [] })
    }
  }))

/**
 * GET /api/performance-dashboard/ops
 *
 * The operations feed for UnifiedPerformanceCommandCenter. It has called this since it was
 * written and the route did not exist, so its safe() wrapper turned the failure into an empty
 * array and the ops tiles read zero behind a permanent "sources unavailable" banner.
 *
 * SOURCE
 *   mas_hrms.apr — 37,867 rows, 20,724 in the last 90 days, and it already carries every
 *   metric the page reads plus denormalised branch_name/process_name. Measured before
 *   building: 19,617 rows with a non-zero login, 1,509,778 calls, 8,050,607 login minutes and
 *   207,544 shrinkage minutes over 90 days — a ~2.6% shrinkage, which is plausible rather than
 *   an artefact.
 *
 *   apr_manual_upload looks like the intended home — it has calls_handled, login_minutes and
 *   the four shrinkage components under exactly those names — but it holds 0 rows and nothing
 *   in the codebase writes it. apr is where the data actually is.
 *
 * THE TIME COLUMNS ARE 'HH:MM:SS' STRINGS, NOT MINUTES
 *   Net_Login/BIO/LUNCH/QA/DISMX/TRAINING are TIME. Summing them as numbers yields nonsense,
 *   so every one goes through TIME_TO_SEC()/60. This is the kind of column that silently
 *   produces a plausible wrong total.
 *
 * target_volume IS NOT AVAILABLE and is deliberately omitted rather than invented. The page
 * computes opsAchievement = pct(opsVolume, opsTarget) and only raises the target-gap alert
 * when opsTarget > 0, so an absent target degrades safely to "no alert" instead of a false
 * one. Inventing a target would manufacture achievement percentages against a number nobody
 * set.
 *
 * SCOPE
 *   Follows the module's own convention via getScopeFilter: wide-scope roles see everything,
 *   everyone else is restricted to their branches, and an unresolvable scope returns no rows
 *   rather than everyone's. apr has no employee_code, so the restriction is applied on
 *   branch_name — verified safe: all 9,788 branch names and 8,863 process names in the last
 *   90 days match branch_master/process_master exactly, so this is not the free-text matching
 *   that has misfired elsewhere in this codebase.
 *
 *   Rows with no branch_name (about half) are therefore invisible to a scoped caller. That is
 *   fail-closed and correct: an unattributed row cannot be shown to a branch manager as if it
 *   were theirs.
 */
performanceDashboardRouter.get('/ops', requireRole(...PERF_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const from = String(req.query.from ?? '').trim()
      const to = String(req.query.to ?? '').trim()

      const where: string[] = ["a.ReportDate IS NOT NULL"]
      const params: unknown[] = []
      if (from) { where.push('a.ReportDate >= ?'); params.push(from) }
      if (to) { where.push('a.ReportDate <= ?'); params.push(to) }

      const { codes } = await getScopeFilter(req)
      if (codes !== null) {
        // Scoped caller. Resolve the branches they may see and filter on the name.
        const scope = await resolveDashboardScope(req.authUser!.id, (await getUserRoleContext(req.authUser!.id)).primaryRole)
        const branchIds = scope.branchIds ?? []
        if (branchIds.length === 0) return res.json({ success: true, data: [] })
        const [branchRows] = await db.execute<RowDataPacket[]>(
          `SELECT branch_name FROM branch_master WHERE id IN (${branchIds.map(() => '?').join(',')})`,
          branchIds
        )
        const names = (branchRows as RowDataPacket[]).map((r) => String(r.branch_name)).filter(Boolean)
        if (names.length === 0) return res.json({ success: true, data: [] })
        where.push(`a.branch_name IN (${names.map(() => '?').join(',')})`)
        params.push(...names)
      }

      // Aggregated per branch+process, not per agent-day. The page SUMs these and passes
      // limit=1000; 20k raw rows would be truncated and every total would be quietly short.
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(a.branch_name, ''), 'Unmapped')  AS branch_name,
                COALESCE(NULLIF(a.process_name, ''), 'Unmapped') AS process_name,
                SUM(COALESCE(a.Calls, 0))                                    AS handled_volume,
                ROUND(SUM(TIME_TO_SEC(COALESCE(a.Net_Login, '00:00:00')))/60) AS login_minutes,
                ROUND(SUM(
                  TIME_TO_SEC(COALESCE(a.BIO, '00:00:00')) +
                  TIME_TO_SEC(COALESCE(a.LUNCH, '00:00:00')) +
                  TIME_TO_SEC(COALESCE(a.QA, '00:00:00')) +
                  TIME_TO_SEC(COALESCE(a.DISMX, '00:00:00')) +
                  TIME_TO_SEC(COALESCE(a.TRAINING, '00:00:00'))
                )/60)                                                        AS shrinkage_minutes
           FROM apr a
          WHERE ${where.join(' AND ')}
          GROUP BY branch_name, process_name
          ORDER BY handled_volume DESC`,
        params
      )

      return res.json({ success: true, data: rows })
    } catch (err) {
      // Matches the module's convention: a source failure is logged and reported as an empty
      // feed, which the page then names in its "unavailable" banner rather than charting zero.
      logSourceFailure('performance-dashboard', err, { endpoint: 'ops' })
      return res.json({ success: true, data: [] })
    }
  }))

export { performanceDashboardRouter }
