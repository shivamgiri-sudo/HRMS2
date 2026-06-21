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
    `SELECT * FROM lms_learner_progress WHERE employee_id = ? OR employee_code = ? LIMIT 1`,
    [req.params.employee_id, req.params.employee_id]
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
      batch_no,
      COUNT(DISTINCT employee_id) as total_learners,
      AVG(course_completion_pct) as avg_completion,
      AVG(mcq_best_score) as avg_score,
      COUNT(CASE WHEN certification_status = 'certified' THEN 1 END) as certified_count,
      COUNT(CASE WHEN attrition_risk_signal = 'red' THEN 1 END) as at_risk_count,
      COUNT(CASE WHEN ops_handover_ready = 1 THEN 1 END) as ops_ready_count
    FROM lms_learner_progress
    WHERE batch_no = ?
    GROUP BY batch_no
  `, [req.params.batch_no]);

  return res.json({ success: true, data: summary[0] || {} });
}));

// GET /api/lms-dashboard/assessment-history/:employee_id
router.get('/assessment-history/:employee_id', h(async (req: any, res: Response) => {
  const [attempts] = await db.execute<RowDataPacket[]>(`
    SELECT * FROM lms_assessment_scores
    WHERE employee_id = ? OR employee_code = ?
    ORDER BY attempted_at DESC
    LIMIT 50
  `, [req.params.employee_id, req.params.employee_id]);

  return res.json({ success: true, data: attempts });
}));

// GET /api/lms-dashboard/sync-status
router.get('/sync-status', h(async (req: any, res: Response) => {
  const [audits] = await db.execute<RowDataPacket[]>(`
    SELECT sync_type, status, rows_synced, error_message, completed_at
    FROM lms_sync_audit
    ORDER BY completed_at DESC
    LIMIT 20
  `);

  return res.json({ success: true, data: audits });
}));

export const lmsDashboardRouter = router;
