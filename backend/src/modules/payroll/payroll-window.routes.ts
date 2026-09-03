import { Router } from 'express';
import type { Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { db } from '../../db/mysql.js';
import { isRunClosed } from './run-status.js';
import { encryptField } from '../../shared/fieldEncryption.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { validateBankFields } from '../../shared/statutoryFormat.js';
import { computeAccountBlindIndex, findDuplicateAccountOwner } from '../../shared/bankAccountDuplicate.js';

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── GET /api/payroll/runs/:id/window-status ───────────────────────────────────
// Returns window_close_date and whether the run is within the editable window.
// admin/payroll_head added 2026-08-25: HO Queues' Run Window tab grants both roles page access
// but this read-only status check excluded them.
router.get('/runs/:id/window-status', requireRole('payroll', 'super_admin', 'finance', 'hr', 'admin', 'payroll_head'), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status, window_close_date, auto_closed_at, closed_by, tds_mode
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
      tds_mode: run.tds_mode ?? 'manual',
      is_window_open: !isClosed && !isRunClosed(run.status),
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
// payroll_head/finance added 2026-08-25: matches the GET on the same resource above, which
// already allowed finance. Payroll.tsx's TDS Mode panel shows the toggle to payroll_head and
// finance, both of which 403'd on the actual write.
router.patch('/runs/:id/tds-mode', requireRole('payroll', 'super_admin', 'payroll_head', 'finance'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { tds_mode } = req.body as { tds_mode: 'auto' | 'manual' };
  if (!['auto', 'manual'].includes(tds_mode)) {
    return res.status(400).json({ success: false, message: 'tds_mode must be auto or manual' });
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM salary_prep_run WHERE id = ? LIMIT 1`, [req.params.id]
  );
  const run = (rows[0] as any);
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  if (isRunClosed(run.status)) {
    return res.status(409).json({ success: false, message: `Cannot change TDS mode on a ${run.status} run` });
  }
  await db.execute(`UPDATE salary_prep_run SET tds_mode = ? WHERE id = ?`, [tds_mode, req.params.id]);
  return res.json({ success: true, message: `TDS mode set to ${tds_mode}` });
}));

// ── GET /api/payroll/runs/:id/tds-upload-template ────────────────────────────
// Download CSV template: Emp Code, Employee Name, Branch, Tax Amount
router.get('/runs/:id/tds-upload-template', requireRole('payroll', 'super_admin', 'finance'), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1`, [runId]
  );
  const run = (runRows[0] as any);
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            COALESCE(bm.branch_name, '') AS branch,
            COALESCE(srmt.tds_amount, 0) AS tax_amount
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     LEFT JOIN salary_run_manual_tds srmt ON srmt.run_id = spl.run_id AND srmt.employee_id = spl.employee_id
     WHERE spl.run_id = ?
     ORDER BY e.employee_code`,
    [runId]
  );

  const lines = ['Emp Code,Employee Name,Branch,Tax Amount'];
  for (const r of rows as RowDataPacket[]) {
    const name = String(r.employee_name ?? '').replace(/,/g, ' ');
    const branch = String(r.branch ?? '').replace(/,/g, ' ');
    lines.push(`${r.employee_code},${name},${branch},${r.tax_amount}`);
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="tds_upload_${run.run_month}.csv"`);
  return res.send(lines.join('\n'));
}));

// ── POST /api/payroll/runs/:id/manual-tds ────────────────────────────────────
// Upsert manual TDS amounts. Body: array of { employee_id | employee_code, tds_amount, remarks? }
router.post('/runs/:id/manual-tds', requireRole('payroll', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;
  const actorUserId = req.authUser!.id;
  const entries = req.body as Array<{ employee_id?: string; employee_code?: string; tds_amount: number; remarks?: string }>;

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ success: false, message: 'Body must be a non-empty array of {employee_id|employee_code, tds_amount}' });
  }

  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM salary_prep_run WHERE id = ? LIMIT 1`, [runId]
  );
  const run = (runRows[0] as any);
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  if (isRunClosed(run.status)) {
    return res.status(409).json({ success: false, message: `Run is ${run.status}` });
  }

  // Resolve employee_codes to employee_ids for CSV-uploaded rows
  const codeEntries = entries.filter((e) => !e.employee_id && e.employee_code);
  const codeToId = new Map<string, string>();
  if (codeEntries.length > 0) {
    const codes = [...new Set(codeEntries.map((e) => e.employee_code!.toUpperCase()))];
    const placeholders = codes.map(() => '?').join(',');
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, UPPER(employee_code) AS code FROM employees WHERE UPPER(employee_code) IN (${placeholders})`,
      codes,
    );
    for (const r of empRows as RowDataPacket[]) codeToId.set(r.code, r.id);
  }

  let upserted = 0;
  const notFound: string[] = [];
  for (const entry of entries) {
    const employeeId = entry.employee_id ?? codeToId.get((entry.employee_code ?? '').toUpperCase());
    if (!employeeId) {
      notFound.push(entry.employee_code ?? 'unknown');
      continue;
    }
    const amt = Math.max(0, Number(entry.tds_amount) || 0);
    await db.execute(
      `INSERT INTO salary_run_manual_tds (id, run_id, employee_id, tds_amount, remarks, uploaded_by)
       VALUES (UUID(), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE tds_amount = VALUES(tds_amount), remarks = VALUES(remarks),
                               uploaded_by = VALUES(uploaded_by), updated_at = NOW()`,
      [runId, employeeId, amt, entry.remarks ?? null, actorUserId]
    );
    upserted++;
  }

  const msg = notFound.length
    ? `${upserted} saved; ${notFound.length} employee codes not found: ${notFound.slice(0, 5).join(', ')}`
    : `${upserted} TDS entries saved. Recalculate the run to apply them.`;
  return res.json({ success: true, message: msg });
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
            e.full_name AS employee_name,
            e.employee_code,
            bpdl.penny_drop_status,
            bpdl.beneficiary_name_returned,
            bpdl.name_match_tier,
            bpdl.name_match_score,
            bpdl.employee_name_at_request
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

  const { force_override } = req.body as { decision: 'approved' | 'rejected'; note?: string; force_override?: boolean };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pua.id, pua.employee_id, pua.old_values, pua.new_values, pua.status,
            bpdl.penny_drop_status, bpdl.name_match_tier, bpdl.beneficiary_name_returned,
            bpdl.employee_name_at_request
     FROM profile_update_approval pua
     LEFT JOIN bank_penny_drop_log bpdl ON bpdl.id = pua.penny_drop_log_id
     WHERE pua.id = ? LIMIT 1`,
    [req.params.id]
  );
  const rec = (rows[0] as any);
  if (!rec) return res.status(404).json({ success: false, message: 'Request not found' });
  if (rec.status !== 'pending') {
    return res.status(409).json({ success: false, message: `Request already ${rec.status}` });
  }

  // Name mismatch is a warning only — approval is always permitted.
  // The mismatch is recorded in bank_penny_drop_log and the audit log so
  // Payroll HO's override decision is fully traceable.

  // Never write a raw account number into an audit log — mask to last 4 digits,
  // same convention used for the pending-request submission's own audit entry
  // (see the masked_account_number helper in employee.routes.ts POST /me/bank-change-request).
  const maskAccountNumber = (values: Record<string, any> | undefined | null): Record<string, unknown> => {
    if (!values) return {};
    const { account_number, ...rest } = values;
    return {
      ...rest,
      masked_account_number: account_number ? `****${String(account_number).slice(-4)}` : null,
    };
  };
  const oldValues = typeof rec.old_values === 'string' ? JSON.parse(rec.old_values || '{}') : (rec.old_values ?? {});

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
    if (typeof newValues.ifsc_code === 'string') newValues.ifsc_code = newValues.ifsc_code.trim().toUpperCase();

    // Neither the employee's original submission (POST /me/bank-change-request)
    // nor this approve step validated format before this fix — Payroll HO could
    // approve, and the request could carry, a malformed IFSC/account number that
    // would then be silently stored.
    const formatErrors = validateBankFields({ ifsc_code: newValues.ifsc_code, account_number: newValues.account_number });
    if (formatErrors.length) {
      return res.status(400).json({ success: false, message: 'Invalid format in submitted values', details: formatErrors });
    }

    // Cross-employee duplicate check, via the blind index added in migration 1136.
    // Migration applied to production (dc1c5e88, 2026-08-16); the one-time backfill of
    // existing rows has not run yet, so this only catches a duplicate against another
    // account written (or re-saved) AFTER that migration, not yet against every
    // historical row. That is a real, narrower guarantee than "no duplicate accounts
    // exist" — but it is strictly better than the no-check status quo it replaces, and
    // every row this route itself writes computes and stores its index below, which is
    // exactly what shrinks the backfill's remaining scope. See bankAccountDuplicate.ts's
    // header for the full lifecycle.
    if (newValues.account_number) {
      const dup = await findDuplicateAccountOwner(String(newValues.account_number), rec.employee_id);
      if (dup) {
        return res.status(409).json({
          success: false,
          message: `This account number is already on file for another employee (${dup.employeeCode}). `
            + `Verify the account number before approving.`,
        });
      }
    }

    // Archive the existing primary account (kept for history, not deleted) —
    // matches profile-approval.service.ts's approveBankDetailsUpdate archival shape.
    await db.execute(
      `UPDATE employee_bank_detail SET is_primary = 0, active_status = 0 WHERE employee_id = ? AND is_primary = 1`,
      [rec.employee_id]
    );

    // account_seq has a UNIQUE KEY (employee_id, account_seq) and a DEFAULT of 1 —
    // hardcoding 1 here would collide with the just-archived row (still present,
    // only deactivated) on any employee's second-ever approved bank change.
    const [seqRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(account_seq), 0) + 1 AS next_seq FROM employee_bank_detail WHERE employee_id = ?`,
      [rec.employee_id]
    );
    const nextSeq = Number((seqRows[0] as any)?.next_seq ?? 1);

    const encAccountNumber = newValues.account_number
      ? encryptField(String(newValues.account_number))
      : null;
    const accountBlindIndex = newValues.account_number
      ? computeAccountBlindIndex(String(newValues.account_number))
      : null;

    // Insert new primary bank record — account_number_enc was previously never
    // written here, so an approved bank change silently discarded the account
    // number the employee submitted. account_number_blind_index is written on every
    // row from here on so the backfill's remaining scope only shrinks.
    await db.execute(
      `INSERT INTO employee_bank_detail
         (id, employee_id, is_primary, account_seq, bank_name, account_holder_name,
          bank_branch, account_number_enc, account_number_blind_index, ifsc_code, account_type, verified, active_status)
       VALUES (UUID(), ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [
        rec.employee_id,
        nextSeq,
        newValues.bank_name ?? null,
        newValues.account_holder_name ?? null,
        newValues.bank_branch ?? null,
        encAccountNumber,
        accountBlindIndex,
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

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: 'BANK_DETAILS_APPROVED',
      module_key: 'PAYROLL',
      entity_type: 'profile_update_approval',
      entity_id: req.params.id,
      employee_id: rec.employee_id,
      reason: note ?? undefined,
      old_value_json: maskAccountNumber(oldValues),
      new_value_json: maskAccountNumber(newValues),
    });
  } else {
    await db.execute(
      `UPDATE profile_update_approval
          SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), reviewer_note = ?
        WHERE id = ?`,
      [actorUserId, note ?? null, req.params.id]
    );

    const rejectedValues = typeof rec.new_values === 'string' ? JSON.parse(rec.new_values || '{}') : (rec.new_values ?? {});
    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: 'BANK_DETAILS_REJECTED',
      module_key: 'PAYROLL',
      entity_type: 'profile_update_approval',
      entity_id: req.params.id,
      employee_id: rec.employee_id,
      reason: note ?? undefined,
      old_value_json: maskAccountNumber(oldValues),
      new_value_json: maskAccountNumber(rejectedValues),
    });
  }

  return res.json({ success: true, message: `Bank change request ${decision}` });
}));

// ── GET /api/payroll/employee-salary-history ─────────────────────────────────
// Bulk salary history view for Payroll HO with optional branch/process filters.
// admin/hr/payroll_head added 2026-08-25: HO Queues' Salary History tab grants these roles
// page access but this read-only lookup excluded them.
router.get('/employee-salary-history', requireRole('payroll', 'super_admin', 'finance', 'admin', 'hr', 'payroll_head'), h(async (req: AuthenticatedRequest, res: Response) => {
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
            ROUND(esa.ctc_annual / 12, 2) AS gross_monthly_ctc,
            esa.effective_from, esa.effective_to, esa.active_status,
            esa.assignment_reason,
            ssm.structure_name, ssm.basic_pct, ssm.hra_pct,
            -- auth_user holds no name, only email; resolve it through employees.user_id
            COALESCE(NULLIF(TRIM(CONCAT(COALESCE(ae.first_name,''),' ',COALESCE(ae.last_name,''))),''), au.email)
              AS assigned_by_name,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
            e.employee_code,
            bm.branch_name
     FROM employee_salary_assignment esa
     JOIN employees e ON e.id = esa.employee_id
     LEFT JOIN salary_structure_master ssm ON ssm.id = esa.structure_id
     LEFT JOIN auth_user au ON au.id = esa.assigned_by
    LEFT JOIN employees ae ON ae.user_id = au.id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     ${where}
     ORDER BY esa.employee_id, esa.effective_from DESC
     LIMIT 500`,
    params
  );
  return res.json({ success: true, data: rows });
}));

export { router as payrollWindowCronRouter };
