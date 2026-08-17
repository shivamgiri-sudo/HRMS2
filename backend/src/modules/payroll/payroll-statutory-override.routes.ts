import { Router } from 'express';
import type { Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { db } from '../../db/mysql.js';
import { hasRole } from '../../shared/accessGuard.js';
import { logSensitiveAction } from '../../shared/auditLog.js';

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── POST /api/payroll/statutory-overrides/request ────────────────────────────
// Employee submits a voluntary opt-out request for PF or ESI.
router.post('/request', requireRole('employee', 'hr', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const actorUserId = req.authUser!.id;
  const { override_type, declaration_text, employee_id } = req.body as {
    override_type: 'pf_opt_out' | 'esic_opt_out';
    declaration_text?: string;
    employee_id?: string;
  };

  if (!['pf_opt_out', 'esic_opt_out'].includes(override_type)) {
    return res.status(400).json({ success: false, message: 'override_type must be pf_opt_out or esic_opt_out' });
  }

  // Resolve employee_id: employees submit for themselves; hr/admin can submit on behalf.
  //
  // The on-behalf path must be role-checked, and was not. employee_id was taken straight
  // from the body whenever it was present, so any caller holding the plain `employee` role
  // this route allows could file a PF/ESI opt-out in a colleague's name. That is not just a
  // spurious row: the duplicate guard below would then refuse that colleague's own genuine
  // request with a 409, and an approval by Payroll HO would change their statutory
  // deduction. Same shape as the tax-declaration routes in payroll.routes.ts — privileged
  // role, or your own record.
  const [selfRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [actorUserId]
  );
  const selfEmpId = (selfRows[0] as any)?.id as string | undefined;

  if (employee_id && employee_id !== selfEmpId && !(await hasRole(actorUserId, 'hr', 'super_admin'))) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: you may only submit a statutory opt-out for yourself',
    });
  }

  const empId = employee_id ?? selfEmpId;
  if (!empId) {
    return res.status(400).json({ success: false, message: 'Employee record not found for this user' });
  }

  // Check for existing active request
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM employee_statutory_override
     WHERE employee_id = ? AND override_type = ? AND status IN ('pending','approved')`,
    [empId, override_type]
  );
  if ((existing as any[]).length > 0) {
    const ex = (existing[0] as any);
    return res.status(409).json({
      success: false,
      message: `An ${override_type} request already exists with status: ${ex.status}`,
    });
  }

  await db.execute(
    `INSERT INTO employee_statutory_override
       (id, employee_id, override_type, status, requested_by, declaration_text)
     VALUES (UUID(), ?, ?, 'pending', ?, ?)`,
    [empId, override_type, actorUserId, declaration_text ?? null]
  );

  await logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: 'statutory_override_requested',
    module_key: 'payroll',
    entity_type: 'employee_statutory_override',
    entity_id: empId,
    change_summary: { override_type, employee_id: empId },
  });

  return res.status(201).json({ success: true, message: 'Opt-out request submitted. Pending Payroll HO approval.' });
}));

// ── GET /api/payroll/statutory-overrides/my ──────────────────────────────────
// Employee self-view of their own opt-out requests.
router.get('/my', requireRole('employee', 'hr', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const actorUserId = req.authUser!.id;
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [actorUserId]
  );
  const empId = (empRows[0] as any)?.id;
  if (!empId) return res.json({ success: true, data: [] });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, override_type, status, declaration_text, requested_at,
            effective_from_month, approved_at, revoked_at, audit_note
     FROM employee_statutory_override
     WHERE employee_id = ?
     ORDER BY requested_at DESC`,
    [empId]
  );
  return res.json({ success: true, data: rows });
}));

// ── GET /api/payroll/statutory-overrides/pending ─────────────────────────────
// Payroll HO sees all pending opt-out requests.
router.get('/pending', requireRole('payroll', 'super_admin', 'finance'), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT eso.*,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.employee_code, e.branch_id,
            bm.branch_name
     FROM employee_statutory_override eso
     JOIN employees e ON e.id = eso.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     WHERE eso.status = 'pending'
     ORDER BY eso.requested_at ASC`
  );
  return res.json({ success: true, data: rows });
}));

// ── GET /api/payroll/statutory-overrides/all ─────────────────────────────────
// Full list for audit, filterable by status/employee.
router.get('/all', requireRole('payroll', 'super_admin', 'finance'), h(async (req: AuthenticatedRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const empId  = req.query.employee_id as string | undefined;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) { conditions.push('eso.status = ?'); params.push(status); }
  if (empId)  { conditions.push('eso.employee_id = ?'); params.push(empId); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT eso.*,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.employee_code
     FROM employee_statutory_override eso
     JOIN employees e ON e.id = eso.employee_id
     ${where}
     ORDER BY eso.requested_at DESC
     LIMIT 200`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// ── PATCH /api/payroll/statutory-overrides/:id/approve ───────────────────────
// Payroll HO approves or rejects an opt-out request.
router.patch('/:id/approve', requireRole('payroll', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const actorUserId = req.authUser!.id;
  const { id } = req.params;
  const { decision, effective_from_month, note } = req.body as {
    decision: 'approved' | 'rejected';
    effective_from_month?: string;  // YYYY-MM
    note?: string;
  };

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, override_type, status FROM employee_statutory_override WHERE id = ? LIMIT 1`,
    [id]
  );
  const rec = (rows[0] as any);
  if (!rec) return res.status(404).json({ success: false, message: 'Override request not found' });
  if (rec.status !== 'pending') {
    return res.status(409).json({ success: false, message: `Request is already ${rec.status}` });
  }

  const newStatus = decision === 'approved' ? 'approved' : 'rejected';
  await db.execute(
    `UPDATE employee_statutory_override
     SET status = ?, approved_by = ?, approved_at = NOW(),
         effective_from_month = ?, audit_note = ?
     WHERE id = ?`,
    [newStatus, actorUserId, effective_from_month ?? null, note ?? null, id]
  );

  await logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: `statutory_override_${newStatus}`,
    module_key: 'payroll',
    entity_type: 'employee_statutory_override',
    entity_id: id,
    change_summary: { decision, override_type: rec.override_type, employee_id: rec.employee_id, effective_from_month },
  });

  // Salary history revision: when approved, write a new employee_salary_history row
  // reflecting the zeroed deduction so payslips and salary reports show the correct
  // post-opt-out structure. Uses increment_request_id = override row id so revoke can
  // find and close this row exactly. Non-critical — failure here does not undo the approval.
  if (decision === 'approved') {
    try {
      const effDate = effective_from_month
        ? `${effective_from_month}-01`
        : new Date().toISOString().substring(0, 10);

      const [histRows] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM employee_salary_history
         WHERE employee_id = ? AND is_current = 1
         ORDER BY effective_from DESC LIMIT 1`,
        [rec.employee_id]
      );
      const cur = histRows[0] as any;

      if (cur) {
        const isPf   = rec.override_type === 'pf_opt_out';
        const isEsic = rec.override_type === 'esic_opt_out';
        const newEpfEmp  = isPf   ? 0 : +(cur.epf_employee  ?? 0);
        const newEsicEmp = isEsic ? 0 : +(cur.esic_employee ?? 0);
        const newEpfEmr  = isPf   ? 0 : +(cur.epf_employer  ?? 0);
        const newEsicEmr = isEsic ? 0 : +(cur.esic_employer ?? 0);
        const gross = +(cur.gross ?? 0);
        const pt    = +(cur.professional_tax ?? 0);
        const adm   = +(cur.admin_charges ?? 0);
        const grat  = +(cur.gratuity_monthly ?? 0);
        // Net in-hand = gross minus employee-side deductions
        const newNet = Math.round((gross - newEpfEmp - newEsicEmp - pt) * 100) / 100;
        // CTC = gross + employer-side costs
        const newCtc = Math.round((gross + newEpfEmr + newEsicEmr + adm + grat) * 100) / 100;
        const prevDed = isPf ? +(cur.epf_employee ?? 0) : +(cur.esic_employee ?? 0);
        const label   = isPf ? 'PF' : 'ESIC';

        // Close the current salary history row
        await db.execute(
          `UPDATE employee_salary_history
             SET is_current = 0, effective_to = DATE_SUB(?, INTERVAL 1 DAY)
           WHERE employee_id = ? AND is_current = 1`,
          [effDate, rec.employee_id]
        );

        // Insert revised row; increment_request_id stores the override id for revoke lookup
        await db.execute(
          `INSERT INTO employee_salary_history
             (id, employee_id, effective_from, source, increment_request_id,
              basic, hra, conveyance, portfolio_allowance, medical_allowance,
              special_allowance, other_allowance, bonus, pli, lta,
              gross, net_in_hand, ctc,
              epf_employee, esic_employee, professional_tax,
              epf_employer, esic_employer, admin_charges, gratuity_monthly,
              branch_name, department_name, designation_name, cost_centre_name,
              is_current, notes, created_by)
           VALUES (UUID(), ?, ?, 'hrms_manual', ?,
                   ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?,
                   ?, ?, ?,
                   ?, ?, ?,
                   ?, ?, ?, ?,
                   ?, ?, ?, ?,
                   1, ?, ?)`,
          [
            rec.employee_id, effDate, id,
            cur.basic ?? 0, cur.hra ?? 0, cur.conveyance ?? 0,
            cur.portfolio_allowance ?? 0, cur.medical_allowance ?? 0,
            cur.special_allowance ?? 0, cur.other_allowance ?? 0,
            cur.bonus ?? 0, cur.pli ?? 0, cur.lta ?? 0,
            gross, newNet, newCtc,
            newEpfEmp, newEsicEmp, pt,
            newEpfEmr, newEsicEmr, adm, grat,
            cur.branch_name ?? null, cur.department_name ?? null,
            cur.designation_name ?? null, cur.cost_centre_name ?? null,
            `${label} opt-out approved — ₹${prevDed}/month ${label} deduction zeroed from ` +
            `${effective_from_month ?? effDate.substring(0, 7)}. ` +
            `Net take-home increased by ₹${prevDed}/month.`,
            actorUserId,
          ]
        );
      }
    } catch (histErr: any) {
      console.error('[StatutoryOverride] Salary history update failed (approval still stands):', histErr.message);
    }
  }

  return res.json({ success: true, message: `Override request ${newStatus}` });
}));

// ── PATCH /api/payroll/statutory-overrides/:id/revoke ────────────────────────
// Revoke a previously approved opt-out (e.g., employee opts back in).
router.patch('/:id/revoke', requireRole('payroll', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const actorUserId = req.authUser!.id;
  const { id } = req.params;
  const { note } = req.body as { note?: string };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, override_type, status FROM employee_statutory_override WHERE id = ? LIMIT 1`,
    [id]
  );
  const rec = (rows[0] as any);
  if (!rec) return res.status(404).json({ success: false, message: 'Override not found' });
  if (rec.status !== 'approved') {
    return res.status(409).json({ success: false, message: 'Can only revoke an approved override' });
  }

  await db.execute(
    `UPDATE employee_statutory_override
     SET status = 'revoked', revoked_by = ?, revoked_at = NOW(), audit_note = ?
     WHERE id = ?`,
    [actorUserId, note ?? null, id]
  );

  await logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: 'statutory_override_revoked',
    module_key: 'payroll',
    entity_type: 'employee_statutory_override',
    entity_id: id,
    change_summary: { override_type: rec.override_type, employee_id: rec.employee_id },
  });

  // Salary history revert: close the opt-out history row and re-open the row that
  // preceded it so salary history stays consistent with the resumed deduction.
  try {
    const [optOutRows] = await db.execute<RowDataPacket[]>(
      `SELECT effective_from FROM employee_salary_history
       WHERE employee_id = ? AND increment_request_id = ? LIMIT 1`,
      [rec.employee_id, id]
    );
    const optOutHist = optOutRows[0] as any;
    if (optOutHist) {
      // Close the opt-out history row (effective up to yesterday)
      await db.execute(
        `UPDATE employee_salary_history
           SET is_current = 0, effective_to = CURDATE()
         WHERE employee_id = ? AND increment_request_id = ?`,
        [rec.employee_id, id]
      );
      // Re-open the row that was closed when opt-out was applied: its effective_to
      // was set to one day before the opt-out effective_from at approval time
      await db.execute(
        `UPDATE employee_salary_history
           SET is_current = 1, effective_to = NULL
         WHERE employee_id = ?
           AND effective_to = DATE_SUB(?, INTERVAL 1 DAY)
           AND (increment_request_id IS NULL OR increment_request_id != ?)
         ORDER BY effective_from DESC
         LIMIT 1`,
        [rec.employee_id, optOutHist.effective_from, id]
      );
    }
  } catch (histErr: any) {
    console.error('[StatutoryOverride] Salary history revert failed (revoke still stands):', histErr.message);
  }

  return res.json({ success: true, message: 'Override revoked. PF/ESI will resume from next payroll run.' });
}));

export { router as payrollStatutoryOverrideRouter };
