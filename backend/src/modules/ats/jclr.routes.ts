import { Router, type NextFunction, type Request, type Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { requireWriteAccess } from '../../middleware/authMiddleware.js';
import type { RowDataPacket } from 'mysql2';
import { randomUUID } from 'crypto';

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// GET /api/ats/jclr/:candidateId
router.get('/:candidateId', requireAuth, requireRole('payroll_hr', 'payroll_head', 'admin', 'branch_head', 'bm', 'hr', 'ho_hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM jclr_entries WHERE candidate_id = ? LIMIT 1',
    [req.params.candidateId]
  );
  return res.json({ success: true, data: Array.isArray(rows) && rows.length ? rows[0] : null });
}));

// POST /api/ats/jclr/:candidateId — upsert JCLR entry
router.post('/:candidateId', requireAuth, requireWriteAccess, requireRole('payroll_hr', 'payroll_head', 'admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { candidateId } = req.params;
  const f = req.body as Record<string, unknown>;
  await db.execute(
    `INSERT INTO jclr_entries (
       id, candidate_id, employee_location, kpi_applicable, billable_status,
       reporting_manager_id, employee_type, employment_type, epf_declaration,
       joining_date, salary_start_date, department, designation, process_id,
       cost_centre, band_grade, branch_id, shift_id, jclr_submitted_by, jclr_submitted_at, status
     ) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),'pending')
     ON DUPLICATE KEY UPDATE
       employee_location      = VALUES(employee_location),
       kpi_applicable         = VALUES(kpi_applicable),
       billable_status        = VALUES(billable_status),
       reporting_manager_id   = VALUES(reporting_manager_id),
       employee_type          = VALUES(employee_type),
       employment_type        = VALUES(employment_type),
       epf_declaration        = VALUES(epf_declaration),
       joining_date           = VALUES(joining_date),
       salary_start_date      = VALUES(salary_start_date),
       department             = VALUES(department),
       designation            = VALUES(designation),
       process_id             = VALUES(process_id),
       cost_centre            = VALUES(cost_centre),
       band_grade             = VALUES(band_grade),
       branch_id              = VALUES(branch_id),
       shift_id               = VALUES(shift_id),
       jclr_submitted_by      = VALUES(jclr_submitted_by),
       jclr_submitted_at      = NOW(),
       status                 = 'pending'`,
    [
      candidateId,
      f.employee_location ?? null,
      f.kpi_applicable ? 1 : 0,
      f.billable_status ?? null,
      f.reporting_manager_id ?? null,
      f.employee_type ?? null,
      f.employment_type ?? null,
      f.epf_declaration ? 1 : 0,
      f.joining_date ?? null,
      f.salary_start_date ?? null,
      f.department ?? null,
      f.designation ?? null,
      f.process_id ?? null,
      f.cost_centre ?? null,
      f.band_grade ?? null,
      f.branch_id ?? null,
      f.shift_id ?? null,
      req.authUser!.id,
    ]
  );
  // Create work item for BM approval
  await db.execute(
    `INSERT INTO work_item (id,item_type,title,module_code,entity_type,entity_id,assigned_to_role,priority,status,created_at)
     VALUES (UUID(),'JCLR_BM_APPROVAL','JCLR pending BM approval','ats','candidate',?,
             'branch_head','high','pending',NOW())
     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [candidateId]
  ).catch(() => {});
  return res.json({ success: true, message: 'JCLR entry saved' });
}));

// POST /api/ats/jclr/:candidateId/approve — BM approves
router.post('/:candidateId/approve', requireAuth, requireWriteAccess, requireRole('branch_head', 'bm', 'admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { candidateId } = req.params;
  const { remarks } = req.body as { remarks?: string };
  if (!remarks || remarks.trim().length < 3) {
    return res.status(400).json({ success: false, message: 'Approval remarks required (min 3 chars)' });
  }
  await db.execute(
    'UPDATE jclr_entries SET bm_approved_by=?, bm_approved_at=NOW(), bm_remarks=?, status=\'approved\' WHERE candidate_id=?',
    [req.authUser!.id, remarks, candidateId]
  );
  await db.execute(
    'UPDATE ats_candidate SET current_stage=\'bm_jclr_approved\', updated_at=NOW() WHERE id=?',
    [candidateId]
  );
  await db.execute(
    `INSERT INTO ats_candidate_stage_log (id,candidate_id,from_stage,to_stage,stage_date,remarks,updated_by)
     VALUES (UUID(),?,'bm_jclr_pending','bm_jclr_approved',NOW(),?,?)`,
    [candidateId, remarks, req.authUser!.id]
  ).catch(() => {});
  // Work item for JCLR entry
  await db.execute(
    `INSERT INTO work_item (id,item_type,title,module_code,entity_type,entity_id,assigned_to_role,priority,status,created_at)
     VALUES (UUID(),'JCLR_ENTRY','JCLR entry pending after BM approval','ats','candidate',?,
             'payroll_hr','high','pending',NOW())
     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [candidateId]
  ).catch(() => {});
  return res.json({ success: true, message: 'JCLR approved' });
}));

export const jclrRouter = router;
