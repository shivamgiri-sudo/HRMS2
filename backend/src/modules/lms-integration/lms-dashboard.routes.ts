import { Router, type Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
router.use(requireAuth);

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) =>
  fn(req, res).catch(next);

// GET /api/lms/learner-progress/:employee_id
router.get('/learner-progress/:employee_id', h(async (req: any, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM lms_learner_progress WHERE employee_id = ? LIMIT 1`,
    [req.params.employee_id]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, error: 'No LMS record found' });
  }
  return res.json({ success: true, data: rows[0] });
}));

// GET /api/lms/batch-progress/:batch_no
router.get('/batch-progress/:batch_no', h(async (req: any, res: Response) => {
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
  `, [req.params.batch_no]);
  return res.json({ success: true, data: summary[0] || {} });
}));

// GET /api/lms/assessment-history/:employee_id
router.get('/assessment-history/:employee_id', h(async (req: any, res: Response) => {
  const [attempts] = await db.execute<RowDataPacket[]>(`
    SELECT id, employee_id, employee_code, assessment_name, attempt_no,
           score, percentage, result, time_taken_seconds, attempted_at, synced_at
    FROM lms_assessment_scores
    WHERE employee_id = ?
    ORDER BY attempted_at DESC
    LIMIT 50
  `, [req.params.employee_id]);
  return res.json({ success: true, data: attempts });
}));

// GET /api/lms/sync-status
router.get('/sync-status', h(async (_req: any, res: Response) => {
  const [audits] = await db.execute<RowDataPacket[]>(`
    SELECT id, sync_type, status, rows_synced, rows_failed, error_message, started_at, completed_at
    FROM lms_sync_audit
    ORDER BY started_at DESC
    LIMIT 20
  `);
  return res.json({ success: true, data: audits });
}));

export const lmsDashboardRouter = router;
