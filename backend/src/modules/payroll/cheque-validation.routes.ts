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

// ── GET /api/payroll/cheque-validation/queue ─────────────────────────────────
// Payroll HO list of pending cheque name mismatch cases.
router.get('/queue', requireRole('payroll', 'payroll_head', 'super_admin', 'finance'), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cnv.*,
            ac.full_name AS candidate_full_name, ac.candidate_code, ac.mobile,
            cob.account_holder_name, cob.bank_name, cob.ifsc_code,
            doc.file_url AS cheque_file_url
     FROM cheque_name_validation cnv
     JOIN ats_candidate ac ON ac.id = cnv.candidate_id
     LEFT JOIN candidate_onboarding_bank_detail cob ON cob.id = cnv.bank_detail_id
     LEFT JOIN candidate_onboarding_document doc ON doc.id = cnv.cheque_document_id
       AND doc.deleted_at IS NULL
     WHERE cnv.match_status = 'mismatch'
     ORDER BY cnv.created_at ASC`
  );
  return res.json({ success: true, data: rows });
}));

// ── GET /api/payroll/cheque-validation/:id ───────────────────────────────────
// Single case detail — includes cheque image URL and all candidate/bank details.
router.get('/:id', requireRole('payroll', 'payroll_head', 'super_admin', 'finance'), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cnv.*,
            ac.full_name AS candidate_full_name, ac.candidate_code, ac.mobile, ac.email,
            cob.account_holder_name, cob.bank_name, cob.ifsc_code,
            cob.account_no_masked, cob.account_type,
            doc.file_url AS cheque_file_url, doc.mime_type AS cheque_mime_type
     FROM cheque_name_validation cnv
     JOIN ats_candidate ac ON ac.id = cnv.candidate_id
     LEFT JOIN candidate_onboarding_bank_detail cob ON cob.id = cnv.bank_detail_id
     LEFT JOIN candidate_onboarding_document doc ON doc.id = cnv.cheque_document_id
       AND doc.deleted_at IS NULL
     WHERE cnv.id = ?
     LIMIT 1`,
    [req.params.id]
  );
  const rec = (rows[0] as any);
  if (!rec) return res.status(404).json({ success: false, message: 'Validation case not found' });
  return res.json({ success: true, data: rec });
}));

// ── PATCH /api/payroll/cheque-validation/:id ─────────────────────────────────
// Payroll HO validates (or rejects) a cheque name mismatch case.
router.patch('/:id', requireRole('payroll', 'payroll_head', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const actorUserId = req.authUser!.id;
  const { decision, note } = req.body as {
    decision: 'manual_validated' | 'rejected';
    note?: string;
  };

  if (!['manual_validated', 'rejected'].includes(decision)) {
    return res.status(400).json({ success: false, message: 'decision must be manual_validated or rejected' });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, candidate_id, bank_detail_id, match_status FROM cheque_name_validation WHERE id = ? LIMIT 1`,
    [req.params.id]
  );
  const rec = (rows[0] as any);
  if (!rec) return res.status(404).json({ success: false, message: 'Case not found' });
  if (rec.match_status !== 'mismatch') {
    return res.status(409).json({ success: false, message: `Case already ${rec.match_status}` });
  }

  await db.execute(
    `UPDATE cheque_name_validation
        SET match_status = ?, validated_by = ?, validated_at = NOW(), validator_note = ?
      WHERE id = ?`,
    [decision, actorUserId, note ?? null, req.params.id]
  );

  // Update bank detail's validation status
  const bankStatus = decision === 'manual_validated' ? 'validated' : 'rejected';
  if (rec.bank_detail_id) {
    await db.execute(
      `UPDATE candidate_onboarding_bank_detail SET name_validation_status = ? WHERE id = ?`,
      [bankStatus, rec.bank_detail_id]
    );
  }

  await logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: `cheque_name_${decision}`,
    module_key: 'onboarding',
    entity_type: 'cheque_name_validation',
    entity_id: req.params.id,
    change_summary: { decision, candidate_id: rec.candidate_id, bank_detail_id: rec.bank_detail_id },
  });

  return res.json({ success: true, message: `Cheque name case ${decision.replace('_', ' ')}` });
}));

export { router as chequeValidationRouter };
