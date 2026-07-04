import { Router, type NextFunction, type Request, type Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { requireWriteAccess } from '../../middleware/authMiddleware.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

interface SlabRow extends RowDataPacket {
  id: string;
  slab_code?: string | null;
}

// GET /api/ats/salary-components/:candidateId
router.get('/:candidateId', requireAuth, requireRole('payroll_hr', 'payroll_head', 'admin', 'hr', 'ho_hr'), h(async (req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM salary_component_assignments WHERE candidate_id = ? ORDER BY assigned_at DESC LIMIT 1',
    [req.params.candidateId]
  );
  return res.json({ success: true, data: Array.isArray(rows) && rows.length ? rows[0] : null });
}));

// POST /api/ats/salary-components/:candidateId
router.post('/:candidateId', requireAuth, requireWriteAccess, requireRole('payroll_hr', 'payroll_head', 'admin'), h(async (req, res) => {
  const { candidateId } = req.params;
  const f = req.body as Record<string, unknown>;
  if (!f.effective_date) {
    return res.status(400).json({ success: false, message: 'effective_date required' });
  }

  // SALARY BYPASS GATE: Custom amounts require an approval_reference
  // OR amounts must come from an approved salary slab in payroll_salary_slabs/salary_grade_master.
  const hasCustomAmounts = [f.basic, f.hra, f.gross, f.ctc].some((v) => v != null);
  const hasSlab = !!f.salary_slab;
  const hasApprovalRef = !!f.approval_reference;

  if (hasCustomAmounts && !hasSlab && !hasApprovalRef) {
    return res.status(400).json({
      success: false,
      code: 'SALARY_BYPASS_BLOCKED',
      message: 'Manual salary amounts require either a salary_slab reference from the approved salary master or an approval_reference from an authorised approver. Direct custom amounts are not permitted without approval.',
    });
  }

  // If salary_slab provided, verify it exists in payroll masters (non-blocking if table not yet created)
  if (hasSlab) {
    let slabRows: SlabRow[] = [];
    try {
      [slabRows] = await db.execute<SlabRow[]>(
        `SELECT id FROM salary_grade_master WHERE grade_code = ? AND active_status = 1 LIMIT 1
         UNION
         SELECT id FROM payroll_salary_slabs WHERE slab_code = ? AND active_status = 1 LIMIT 1`,
        [f.salary_slab, f.salary_slab]
      );
    } catch {
      slabRows = [];
    }
    if (!Array.isArray(slabRows) || !slabRows.length) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SALARY_SLAB',
        message: `Salary slab '${f.salary_slab}' is not found in the approved salary master. Add the slab first or provide an approval_reference for custom amounts.`,
      });
    }
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
  // Audit
  await db.execute(
    `INSERT INTO sensitive_action_log
       (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, created_at)
     VALUES (UUID(), ?, 'SALARY_COMPONENTS_ASSIGNED', 'payroll', 'ats_candidate', ?, ?, NOW())`,
    [req.authUser.id, candidateId, JSON.stringify({
      salary_slab: f.salary_slab ?? null,
      approval_reference: f.approval_reference ?? null,
      gross: f.gross ?? null,
      ctc: f.ctc ?? null,
      custom_amounts: hasCustomAmounts,
    })]
  ).catch(() => {});
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
