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
router.get('/:candidateId', requireAuth, requireRole('payroll_hr', 'payroll_head', 'admin', 'hr'), h(async (req, res) => {
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

  // If salary_slab provided, verify it exists in the approved salary master.
  //
  // This was previously a single UNION across salary_grade_master + payroll_salary_slabs with
  // `LIMIT 1` placed before the UNION — invalid MySQL syntax, so the statement ALWAYS failed with
  // ER_PARSE_ERROR (verified against the live schema; it fails even when both tables exist). The
  // catch below then swallowed the error and left slabRows empty, so EVERY slab was rejected as
  // "not found in the approved salary master" — including the real, active slabs that do exist in
  // payroll_salary_slabs. Each table is now queried independently and guarded separately, so a
  // table missing on a given installation (salary_grade_master has no CREATE TABLE anywhere in
  // backend/sql) can no longer suppress the lookup against one that is present.
  if (hasSlab) {
    let slabRows: SlabRow[] = [];
    try {
      [slabRows] = await db.execute<SlabRow[]>(
        `SELECT id FROM payroll_salary_slabs WHERE slab_code = ? AND active_status = 1 LIMIT 1`,
        [f.salary_slab]
      );
    } catch {
      slabRows = [];
    }
    if (!Array.isArray(slabRows) || !slabRows.length) {
      try {
        [slabRows] = await db.execute<SlabRow[]>(
          `SELECT id FROM salary_grade_master WHERE grade_code = ? AND active_status = 1 LIMIT 1`,
          [f.salary_slab]
        );
      } catch {
        slabRows = [];
      }
    }
    if (!Array.isArray(slabRows) || !slabRows.length) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SALARY_SLAB',
        message: `Salary slab '${f.salary_slab}' is not found in the approved salary master. Add the slab first or provide an approval_reference for custom amounts.`,
      });
    }
  }

  // Record WHICH approved package this salary came from.
  //
  // This table stores only basic/hra/conveyance/special/gross/ctc — it has no
  // bonus or admin_charges column, while 223 of the 295 packages in
  // salary_package_master grant a bonus and 224 carry admin charges. Without the
  // link, an appointment letter built from these amounts prints "Bonus 0.00" for
  // an employee whose package actually grants one.
  let packageId: string | null = typeof f.package_id === 'string' && f.package_id ? f.package_id : null;
  if (!packageId && f.gross != null) {
    // No explicit choice sent: identify the package by its exact amounts.
    // Matching on salary_slab would not work — every existing row carries the
    // placeholder 'LEGACY', not a band code. Basic and HRA must agree too, so two
    // packages sharing a gross cannot be confused; ambiguity leaves the link null
    // and the letter resolver falls back to the stored amounts.
    try {
      const [pkgRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM salary_package_master
          WHERE active_status = 1 AND gross = ?
            AND (? IS NULL OR basic = ?) AND (? IS NULL OR hra = ?)
          LIMIT 2`,
        [Number(f.gross), f.basic ?? null, f.basic ?? null, f.hra ?? null, f.hra ?? null]
      );
      const matches = pkgRows as RowDataPacket[];
      packageId = matches.length === 1 ? String(matches[0].id) : null;
    } catch {
      packageId = null;
    }
  }

  await db.execute(
    `INSERT INTO salary_component_assignments (
       id, candidate_id, effective_date, salary_slab, package_id,
       basic, hra, conveyance, special_allowance,
       bonus, portfolio, medical_allowance, lta, other_allowance, pli,
       gross, pf_applicable, esi_applicable, employer_pf,
       employer_esi, ctc, net_estimate, assigned_by, assigned_at, approval_reference, status
     ) VALUES (UUID(),?,?,?,?,  ?,?,?,?,  ?,?,?,?,?,?,  ?,?,?,?,?,  ?,?,?,NOW(),?,'active')`,
    [
      candidateId,
      f.effective_date,
      f.salary_slab ?? null,
      packageId,
      f.basic != null ? Number(f.basic) : null,
      f.hra != null ? Number(f.hra) : null,
      f.conveyance != null ? Number(f.conveyance) : null,
      f.special_allowance != null ? Number(f.special_allowance) : null,
      f.bonus != null ? Number(f.bonus) : 0,
      f.portfolio != null ? Number(f.portfolio) : 0,
      f.medical != null ? Number(f.medical) : 0,
      f.lta != null ? Number(f.lta) : 0,
      f.other_allowance != null ? Number(f.other_allowance) : 0,
      f.pli != null ? Number(f.pli) : 0,
      f.gross != null ? Number(f.gross) : null,
      f.pf_applicable ? 1 : 0,
      f.esi_applicable ? 1 : 0,
      f.employer_pf != null ? Number(f.employer_pf) : null,
      f.employer_esi != null ? Number(f.employer_esi) : null,
      f.ctc != null ? Number(f.ctc) : null,
      f.net_estimate != null ? Number(f.net_estimate) : null,
      req.authUser!.id,
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
       (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at)
     VALUES (UUID(), ?, 'SALARY_COMPONENTS_ASSIGNED', 'payroll', 'ats_candidate', ?, ?, NOW())`,
    [req.authUser!.id, candidateId, JSON.stringify({
      salary_slab: f.salary_slab ?? null,
      package_id: packageId,
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
