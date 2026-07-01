import { Router } from 'express';
import type { Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { db } from '../../db/mysql.js';

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── GET /api/payroll/runs/:id/window-status ───────────────────────────────────
// Returns window_close_date and whether the run is within the editable window.
router.get('/runs/:id/window-status', requireRole('payroll', 'super_admin', 'finance', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status, window_close_date, auto_closed_at, closed_by
     FROM salary_prep_run WHERE id = ? LIMIT 1`,
    [req.params.id]
  );
  const run = (rows[0] as any);
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });

  const today = new Date();
  const isClosed = run.window_close_date
    ? today > new Date(run.window_close_date as string)
    : false;

  return res.json({
    success: true,
    data: {
      run_id: run.id,
      run_month: run.run_month,
      status: run.status,
      window_close_date: run.window_close_date,
      auto_closed_at: run.auto_closed_at,
      is_window_open: !isClosed && !['locked', 'disbursed'].includes(run.status),
      days_remaining: run.window_close_date
        ? Math.max(0, Math.ceil((new Date(run.window_close_date as string).getTime() - today.getTime()) / 86400000))
        : null,
    },
  });
}));

// ── GET /api/payroll/runs/:id/tds-mode ───────────────────────────────────────
router.get('/runs/:id/tds-mode', requireRole('payroll', 'super_admin', 'finance'), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, tds_mode FROM salary_prep_run WHERE id = ? LIMIT 1`,
    [req.params.id]
  );
  const run = (rows[0] as any);
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  return res.json({ success: true, data: { run_id: run.id, run_month: run.run_month, tds_mode: run.tds_mode ?? 'manual' } });
}));

// ── PATCH /api/payroll/runs/:id/tds-mode ─────────────────────────────────────
// Toggle TDS mode for a run.
router.patch('/runs/:id/tds-mode', requireRole('payroll', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { tds_mode } = req.body as { tds_mode: 'auto' | 'manual' };
  if (!['auto', 'manual'].includes(tds_mode)) {
    return res.status(400).json({ success: false, message: 'tds_mode must be auto or manual' });
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM salary_prep_run WHERE id = ? LIMIT 1`, [req.params.id]
  );
  const run = (rows[0] as any);
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  if (['locked', 'disbursed'].includes(run.status)) {
    return res.status(409).json({ success: false, message: `Cannot change TDS mode on a ${run.status} run` });
  }
  await db.execute(`UPDATE salary_prep_run SET tds_mode = ? WHERE id = ?`, [tds_mode, req.params.id]);
  return res.json({ success: true, message: `TDS mode set to ${tds_mode}` });
}));

// ── POST /api/payroll/runs/:id/manual-tds ────────────────────────────────────
// Upsert manual TDS amounts for employees in a run. Body: array of { employee_id, tds_amount, remarks? }
router.post('/runs/:id/manual-tds', requireRole('payroll', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;
  const actorUserId = req.authUser!.id;
  const entries = req.body as Array<{ employee_id: string; tds_amount: number; remarks?: string }>;

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ success: false, message: 'Body must be a non-empty array of {employee_id, tds_amount}' });
  }

  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM salary_prep_run WHERE id = ? LIMIT 1`, [runId]
  );
  const run = (runRows[0] as any);
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  if (['locked', 'disbursed'].includes(run.status)) {
    return res.status(409).json({ success: false, message: `Run is ${run.status}` });
  }

  let upserted = 0;
  for (const entry of entries) {
    const amt = Math.max(0, Number(entry.tds_amount) || 0);
    await db.execute(
      `INSERT INTO salary_run_manual_tds (id, run_id, employee_id, tds_amount, remarks, uploaded_by)
       VALUES (UUID(), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE tds_amount = VALUES(tds_amount), remarks = VALUES(remarks),
                               uploaded_by = VALUES(uploaded_by), updated_at = NOW()`,
      [runId, entry.employee_id, amt, entry.remarks ?? null, actorUserId]
    );
    upserted++;
  }

  return res.json({ success: true, message: `${upserted} TDS entries saved. Recalculate the run to apply them.` });
}));

// ── GET /api/payroll/runs/:id/manual-tds ─────────────────────────────────────
router.get('/runs/:id/manual-tds', requireRole('payroll', 'super_admin', 'finance'), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT srmt.*, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name, e.employee_code
     FROM salary_run_manual_tds srmt
     JOIN employees e ON e.id = srmt.employee_id
     WHERE srmt.run_id = ?
     ORDER BY e.employee_code`,
    [req.params.id]
  );
  return res.json({ success: true, data: rows });
}));

// ── PATCH /api/payroll/runs/:id/manual-tds/:employeeId ───────────────────────
router.patch('/runs/:id/manual-tds/:employeeId', requireRole('payroll', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { tds_amount, remarks } = req.body as { tds_amount: number; remarks?: string };
  const amt = Math.max(0, Number(tds_amount) || 0);
  await db.execute(
    `UPDATE salary_run_manual_tds SET tds_amount = ?, remarks = ?, updated_at = NOW()
     WHERE run_id = ? AND employee_id = ?`,
    [amt, remarks ?? null, req.params.id, req.params.employeeId]
  );
  return res.json({ success: true, message: 'TDS entry updated' });
}));

// ── GET /api/payroll/bank-change-requests ────────────────────────────────────
// Payroll HO queue for bank account change approvals routed to payroll.
router.get('/bank-change-requests', requireRole('payroll', 'super_admin'), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pua.*,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
            e.employee_code,
            bpdl.penny_drop_status, bpdl.beneficiary_name_returned
     FROM profile_update_approval pua
     JOIN employees e ON e.id = pua.employee_id
     LEFT JOIN bank_penny_drop_log bpdl ON bpdl.id = pua.penny_drop_log_id
     WHERE pua.request_type = 'bank_details'
       AND COALESCE(pua.routed_to_role,'payroll') = 'payroll'
       AND pua.status = 'pending'
     ORDER BY pua.requested_at ASC`
  );
  return res.json({ success: true, data: rows });
}));

// ── PATCH /api/payroll/bank-change-requests/:id ──────────────────────────────
// Payroll HO approves or rejects a bank account change.
router.patch('/bank-change-requests/:id', requireRole('payroll', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const actorUserId = req.authUser!.id;
  const { decision, note } = req.body as { decision: 'approved' | 'rejected'; note?: string };

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, new_values, status FROM profile_update_approval WHERE id = ? LIMIT 1`,
    [req.params.id]
  );
  const rec = (rows[0] as any);
  if (!rec) return res.status(404).json({ success: false, message: 'Request not found' });
  if (rec.status !== 'pending') {
    return res.status(409).json({ success: false, message: `Request already ${rec.status}` });
  }

  if (decision === 'approved') {
    // Determine effective run month: lowest draft run month, or next calendar month
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT run_month FROM salary_prep_run WHERE status = 'draft' ORDER BY run_month ASC LIMIT 1`
    );
    const nextRunMonth = (runRows[0] as any)?.run_month ?? (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    // Parse new bank details from JSON
    const newValues = typeof rec.new_values === 'string' ? JSON.parse(rec.new_values) : rec.new_values;

    // Mark old primary bank record inactive
    await db.execute(
      `UPDATE employee_bank_detail SET is_primary = 0 WHERE employee_id = ? AND is_primary = 1`,
      [rec.employee_id]
    );

    // Insert new primary bank record
    await db.execute(
      `INSERT INTO employee_bank_detail
         (id, employee_id, bank_name, account_holder_name, ifsc_code, account_type, is_primary, active_status)
       VALUES (UUID(), ?, ?, ?, ?, ?, 1, 1)`,
      [
        rec.employee_id,
        newValues.bank_name ?? null,
        newValues.account_holder_name ?? null,
        newValues.ifsc_code ?? null,
        newValues.account_type ?? 'savings',
      ]
    );

    await db.execute(
      `UPDATE profile_update_approval
          SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(),
              reviewer_note = ?, effective_run_month = ?
        WHERE id = ?`,
      [actorUserId, note ?? null, nextRunMonth, req.params.id]
    );
  } else {
    await db.execute(
      `UPDATE profile_update_approval
          SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), reviewer_note = ?
        WHERE id = ?`,
      [actorUserId, note ?? null, req.params.id]
    );
  }

  return res.json({ success: true, message: `Bank change request ${decision}` });
}));

// ── GET /api/payroll/employee-salary-history ─────────────────────────────────
// Bulk salary history view for Payroll HO with optional branch/process filters.
router.get('/employee-salary-history', requireRole('payroll', 'super_admin', 'finance'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { branch_id, employee_id, from, to } = req.query as Record<string, string | undefined>;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (branch_id)   { conditions.push('e.branch_id = ?'); params.push(branch_id); }
  if (employee_id) { conditions.push('esa.employee_id = ?'); params.push(employee_id); }
  if (from)        { conditions.push('esa.effective_from >= ?'); params.push(from); }
  if (to)          { conditions.push('esa.effective_from <= ?'); params.push(to); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT esa.id, esa.employee_id, esa.ctc_annual,
            ROUND(esa.ctc_annual / 12, 2) AS ctc_monthly,
            esa.effective_from, esa.effective_to, esa.active_status,
            esa.assignment_reason,
            ssm.structure_name, ssm.basic_pct, ssm.hra_pct,
            CONCAT(au.first_name,' ',COALESCE(au.last_name,'')) AS assigned_by_name,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
            e.employee_code,
            bm.branch_name
     FROM employee_salary_assignment esa
     JOIN employees e ON e.id = esa.employee_id
     LEFT JOIN salary_structure_master ssm ON ssm.id = esa.structure_id
     LEFT JOIN auth_user au ON au.id = esa.assigned_by
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     ${where}
     ORDER BY esa.employee_id, esa.effective_from DESC
     LIMIT 500`,
    params
  );
  return res.json({ success: true, data: rows });
}));

export { router as payrollWindowCronRouter };
