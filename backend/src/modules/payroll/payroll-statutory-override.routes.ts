import { Router } from 'express';
import type { Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { db } from '../../db/mysql.js';
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

  // Resolve employee_id: employees submit for themselves; hr/admin can submit on behalf
  let empId = employee_id;
  if (!empId) {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
      [actorUserId]
    );
    empId = (empRows[0] as any)?.id;
  }
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

  return res.json({ success: true, message: 'Override revoked. PF/ESI will resume from next payroll run.' });
}));

export { router as payrollStatutoryOverrideRouter };
