import { Router, type Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { RowDataPacket } from 'mysql2';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';

const router = Router();
router.use(requireAuth);

// Roles that may access LMS data for any employee
const LMS_MANAGER_ROLES = ['admin', 'hr', 'super_admin', 'manager', 'process_manager', 'trainer', 'ceo'] as const;

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) =>
  fn(req, res).catch(next);

/**
 * Returns the employee_id linked to the calling user.
 * Returns null if the user has no employee record.
 */
async function getCallerEmployeeId(userId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  return (rows as any[])[0]?.id ?? null;
}

function isManagerRole(roleKeys: string[]): boolean {
  return roleKeys.some(r => (LMS_MANAGER_ROLES as readonly string[]).includes(r));
}

// GET /api/lms/learner-progress/:employee_id
router.get('/learner-progress/:employee_id',
  requireRole(...LMS_MANAGER_ROLES, 'employee', 'agent', 'trainee'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.employee_id;
    const userId = req.authUser!.id;
    const roleKeys: string[] = (req as any).authUser?.roleKeys ?? [req.authUser!.role ?? 'employee'];

    // Non-manager roles may only view their own record
    if (!isManagerRole(roleKeys)) {
      const selfId = await getCallerEmployeeId(userId);
      if (!selfId || selfId !== targetId) {
        return res.status(403).json({ success: false, error: 'Access denied: you may only view your own LMS progress' });
      }
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM lms_learner_progress WHERE employee_id = ? LIMIT 1`,
      [targetId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'No LMS record found' });
    }
    return res.json({ success: true, data: rows[0] });
  }));

// GET /api/lms/batch-progress/:batch_no
router.get('/batch-progress/:batch_no',
  requireRole(...LMS_MANAGER_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [summary] = await db.execute<RowDataPacket[]>(`
      SELECT
        batch_no,
        COUNT(DISTINCT employee_id) AS total_learners,
        AVG(mcq_best_score) AS avg_score,
        AVG(readiness_score) AS avg_readiness,
        SUM(CASE WHEN ops_handover_ready = 1 THEN 1 ELSE 0 END) AS ready_count,
        SUM(CASE WHEN attrition_risk_signal = 'red' THEN 1 ELSE 0 END) AS high_risk_count
      FROM lms_learner_progress
      WHERE batch_no = ?
      GROUP BY batch_no
    `, [(_req as any).params.batch_no]);
    return res.json({ success: true, data: summary[0] || {} });
  }));

// GET /api/lms/assessment-history/:employee_id
router.get('/assessment-history/:employee_id',
  requireRole(...LMS_MANAGER_ROLES, 'employee', 'agent', 'trainee'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.employee_id;
    const userId = req.authUser!.id;
    const roleKeys: string[] = (req as any).authUser?.roleKeys ?? [req.authUser!.role ?? 'employee'];

    // Non-manager roles may only view their own record
    if (!isManagerRole(roleKeys)) {
      const selfId = await getCallerEmployeeId(userId);
      if (!selfId || selfId !== targetId) {
        return res.status(403).json({ success: false, error: 'Access denied: you may only view your own assessment history' });
      }
    }

    const [attempts] = await db.execute<RowDataPacket[]>(`
      SELECT id, employee_id, employee_code, assessment_name, attempt_no,
             score, percentage, result, time_taken_seconds, attempted_at, synced_at
      FROM lms_assessment_scores
      WHERE employee_id = ?
      ORDER BY attempted_at DESC
      LIMIT 50
    `, [targetId]);
    return res.json({ success: true, data: attempts });
  }));

// GET /api/lms/sync-status
router.get('/sync-status',
  requireRole('admin', 'super_admin', 'hr', 'ceo'),
  h(async (_req: any, res: Response) => {
    const [audits] = await db.execute<RowDataPacket[]>(`
      SELECT id, sync_type, status, rows_synced, rows_failed, error_message, started_at, completed_at
      FROM lms_sync_audit
      ORDER BY started_at DESC
      LIMIT 20
    `);
    return res.json({ success: true, data: audits });
  }));

export const lmsDashboardRouter = router;
