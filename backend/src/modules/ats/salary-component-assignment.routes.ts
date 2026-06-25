import { Router } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { requireWriteAccess } from '../../middleware/authMiddleware.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// GET /api/ats/salary-components/:candidateId
router.get('/:candidateId', requireAuth, requireRole('payroll_hr', 'payroll_head', 'admin', 'hr', 'ho_hr'), h(async (req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM salary_component_assignments WHERE candidate_id = ? ORDER BY assigned_at DESC LIMIT 1',
    [req.params.candidateId]
  );
  return res.json({ success: true, data: Array.isArray(rows) && rows.length ? rows[0] : null });
}));

// POST /api/ats/salary-components/:candidateId
router.post('/:candidateId', requireAuth, requireWriteAccess, requireRole('payroll_hr', 'payroll_head', 'admin'), h(async (req: any, res: any) => {
  const { candidateId } = req.params;
  const f = req.body as Record<string, any>;
  if (!f.effective_date) {
    return res.status(400).json({ success: false, message: 'effective_date required' });
  }
  await db.execute(
    `INSERT INTO salary_component_assignments (
       id, candidate_id, effective_date, salary_slab, basic, hra, conveyance,
       special_allowance, gross, pf_applicable, esi_applicable, employer_pf,
       employer_esi, ctc, net_estimate, assigned_by, assigned_at, approval_reference, status
     ) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?,'active')`,
    [
      candidateId,
      f.effective_date,
      f.salary_slab ?? null,
      f.basic != null ? Number(f.basic) : null,
      f.hra != null ? Number(f.hra) : null,
      f.conveyance != null ? Number(f.conveyance) : null,
      f.special_allowance != null ? Number(f.special_allowance) : null,
      f.gross != null ? Number(f.gross) : null,
      f.pf_applicable ? 1 : 0,
      f.esi_applicable ? 1 : 0,
      f.employer_pf != null ? Number(f.employer_pf) : null,
      f.employer_esi != null ? Number(f.employer_esi) : null,
      f.ctc != null ? Number(f.ctc) : null,
      f.net_estimate != null ? Number(f.net_estimate) : null,
      req.authUser.id,
      f.approval_reference ?? null,
    ]
  );
  // Update candidate status
  await db.execute(
    'UPDATE ats_candidate SET current_stage=\'salary_component_completed\', updated_at=NOW() WHERE id=? AND current_stage=\'salary_component_pending\'',
    [candidateId]
  );
  // Work item for employee code gate
  await db.execute(
    `INSERT INTO work_item (id,item_type,title,module_code,entity_type,entity_id,assigned_to_role,priority,status,created_at)
     VALUES (UUID(),'EMPLOYEE_CODE_PENDING','Ready for employee code generation','ats','candidate',?,
             'hr','high','pending',NOW())
     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [candidateId]
  ).catch(() => {});
  return res.json({ success: true, message: 'Salary components assigned' });
}));

export const salaryComponentAssignmentRouter = router;
