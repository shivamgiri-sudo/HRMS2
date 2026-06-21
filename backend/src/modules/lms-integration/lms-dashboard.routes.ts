import { Router } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { Response, RowDataPacket } from 'mysql2';

const router = Router();
router.use(requireAuth);

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) =>
  fn(req, res).catch(next);

// GET /api/lms-dashboard/learner-progress/:employee_id
router.get('/learner-progress/:employee_id', h(async (req: any, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM lms_learning_progress_snapshot WHERE employee_id = ? LIMIT 1`,
    [req.params.employee_id]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, error: 'No LMS record found' });
  }

  return res.json({ success: true, data: rows[0] });
}));

// GET /api/lms-dashboard/batch-progress/:batch_no
router.get('/batch-progress/:batch_no', h(async (req: any, res: Response) => {
  const [summary] = await db.execute<RowDataPacket[]>(`
    SELECT
      course_id,
      COUNT(DISTINCT employee_id) as total_learners,
      AVG(completion_pct) as avg_completion,
      AVG(score) as avg_score
    FROM lms_learning_progress_snapshot
    WHERE course_id = ?
    GROUP BY course_id
  `, [req.params.batch_no]);

  return res.json({ success: true, data: summary[0] || {} });
}));

// GET /api/lms-dashboard/assessment-history/:employee_id
router.get('/assessment-history/:employee_id', h(async (req: any, res: Response) => {
  const [attempts] = await db.execute<RowDataPacket[]>(`
    SELECT id, employee_id, course_id, course_name, score, status, synced_at
    FROM lms_learning_progress_snapshot
    WHERE employee_id = ?
    ORDER BY synced_at DESC
    LIMIT 50
  `, [req.params.employee_id]);

  return res.json({ success: true, data: attempts });
}));

// GET /api/lms-dashboard/sync-status
router.get('/sync-status', h(async (req: any, res: Response) => {
  const [audits] = await db.execute<RowDataPacket[]>(`
    SELECT id, sync_type, records_synced, errors_count, status, created_at
    FROM lms_sync_audit_log
    ORDER BY created_at DESC
    LIMIT 20
  `);

  return res.json({ success: true, data: audits });
}));

export const lmsDashboardRouter = router;
