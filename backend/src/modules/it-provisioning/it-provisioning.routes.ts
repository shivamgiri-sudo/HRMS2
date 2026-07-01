import { Router } from 'express';
import type { Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { hasRole } from '../../shared/accessGuard.js';
import { db } from '../../db/mysql.js';
import {
  listProvisioningRequests,
  getProvisioningRequest,
  actionProvisioningRequest,
  waiveProvisioningRequest,
  confirmAndLockRequest,
} from './it-provisioning.service.js';

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const PROVISIONING_ROLES = ['admin', 'super_admin', 'it', 'branch_it', 'wfm', 'hr', 'branch_admin'];

router.use(requireAuth);

type AppointmentRow = RowDataPacket & {
  id: string;
  employee_id: string;
  status: string;
  aadhaar_esign_status: string;
  company_signature_status: string;
};

type AppointmentAction = 'send' | 'aadhaar-signed' | 'company-signed' | 'complete';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function firstEvidence(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = clean(body[key]);
    if (value) return value;
  }
  return '';
}

function invalidTransition(res: Response, message: string) {
  return res.status(409).json({ success: false, message });
}

async function changeAppointmentStatus(
  req: AuthenticatedRequest,
  res: Response,
  action: AppointmentAction,
) {
  const requestId = req.params.id;
  const body = req.body as Record<string, unknown>;
  const evidenceUrl = firstEvidence(body, ['evidence_url', 'document_url', 'signed_artifact_url', 'signature_evidence_url', 'final_pdf_url']);
  const providerReference = clean(body.provider_reference);
  const remarks = clean(body.remarks);
  const signerUserId = clean(body.signer_user_id);
  const finalPdfUrl = clean(body.final_pdf_url);

  if (!evidenceUrl && !providerReference && !remarks) {
    return res.status(400).json({ success: false, message: 'evidence_url, provider_reference, document_url, final_pdf_url, or remarks required' });
  }

  if (action === 'aadhaar-signed' && !providerReference && !evidenceUrl) {
    return res.status(400).json({ success: false, message: 'provider_reference or signed artifact evidence required' });
  }
  if (action === 'company-signed' && (!signerUserId || !evidenceUrl)) {
    return res.status(400).json({ success: false, message: 'signer_user_id and signature evidence required' });
  }
  if (action === 'complete' && !finalPdfUrl) {
    return res.status(400).json({ success: false, message: 'final_pdf_url required' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<AppointmentRow[]>(
      `SELECT id, employee_id, status, aadhaar_esign_status, company_signature_status
         FROM appointment_letter_request
        WHERE id = ?
        LIMIT 1 FOR UPDATE`,
      [requestId],
    );
    const current = rows[0];
    if (!current) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Appointment letter request not found' });
    }

    const fromStatus = current.status;
    let toStatus = fromStatus;
    let updateSql = '';
    let updateParams: any[] = [];

    if (action === 'send') {
      if (fromStatus !== 'draft') {
        await conn.rollback();
        return invalidTransition(res, `Cannot send appointment letter from ${fromStatus}`);
      }
      toStatus = 'sent_for_esign';
      updateSql = `UPDATE appointment_letter_request
          SET template_id = COALESCE(?, template_id),
              document_url = COALESCE(?, document_url),
              status = 'sent_for_esign',
              aadhaar_esign_status = 'sent',
              sent_at = COALESCE(sent_at, NOW()),
              updated_at = NOW()
        WHERE id = ?`;
      updateParams = [body.template_id ?? null, evidenceUrl || null, requestId];
    } else if (action === 'aadhaar-signed') {
      if (!['sent_for_esign', 'candidate_signed', 'company_signed'].includes(fromStatus)) {
        await conn.rollback();
        return invalidTransition(res, `Cannot mark Aadhaar signed from ${fromStatus}`);
      }
      toStatus = current.company_signature_status === 'signed' ? 'company_signed' : 'candidate_signed';
      updateSql = `UPDATE appointment_letter_request
          SET aadhaar_esign_status = 'candidate_signed',
              document_url = COALESCE(?, document_url),
              status = ?,
              candidate_signed_at = COALESCE(candidate_signed_at, NOW()),
              updated_at = NOW()
        WHERE id = ?`;
      updateParams = [evidenceUrl || null, toStatus, requestId];
    } else if (action === 'company-signed') {
      if (!['sent_for_esign', 'candidate_signed', 'company_signed'].includes(fromStatus)) {
        await conn.rollback();
        return invalidTransition(res, `Cannot mark company signed from ${fromStatus}`);
      }
      toStatus = current.aadhaar_esign_status === 'candidate_signed' ? 'company_signed' : 'sent_for_esign';
      updateSql = `UPDATE appointment_letter_request
          SET company_signature_status = 'signed',
              final_pdf_url = COALESCE(?, final_pdf_url),
              status = ?,
              company_signed_at = COALESCE(company_signed_at, NOW()),
              updated_at = NOW()
        WHERE id = ?`;
      updateParams = [evidenceUrl || null, toStatus, requestId];
    } else {
      if (fromStatus === 'draft' || fromStatus === 'sent_for_esign') {
        await conn.rollback();
        return invalidTransition(res, `Cannot complete appointment letter from ${fromStatus}`);
      }
      if (current.aadhaar_esign_status !== 'candidate_signed' || current.company_signature_status !== 'signed') {
        await conn.rollback();
        return invalidTransition(res, 'Both candidate and company signatures are required before completion');
      }
      toStatus = 'completed';
      updateSql = `UPDATE appointment_letter_request
          SET status = 'completed',
              final_pdf_url = ?,
              completed_at = COALESCE(completed_at, NOW()),
              updated_at = NOW()
        WHERE id = ?`;
      updateParams = [finalPdfUrl, requestId];
    }

    await conn.execute(updateSql, updateParams);
    await conn.execute(
      `INSERT INTO appointment_letter_audit_log
         (id, appointment_letter_request_id, employee_id, action_type, from_status, to_status,
          evidence_url, provider_reference, remarks, actor_user_id, ip_address, user_agent)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestId,
        current.employee_id,
        action,
        fromStatus,
        toStatus,
        evidenceUrl || finalPdfUrl || null,
        providerReference || signerUserId || null,
        remarks || null,
        req.authUser!.id,
        req.ip ?? null,
        req.get('user-agent') ?? null,
      ],
    );
    await conn.commit();
    return res.json({ success: true, data: { id: requestId, status: toStatus } });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ── GET /api/it-provisioning/requests ─────────────────────────────────────────
// Functional teams default to their own queue; admin/hr/super_admin can inspect all.
router.get('/requests', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdmin = await hasRole(userId, 'admin', 'hr', 'super_admin');

  const filters: Record<string, any> = {
    status:      req.query.status as string | undefined,
    requestType: req.query.request_type as string | undefined,
    page:        req.query.page   ? Number(req.query.page)  : 1,
    limit:       req.query.limit  ? Number(req.query.limit) : 50,
  };

  if (!isAdmin) {
    // Scoped: functional roles see their own assigned queue by default.
    const isIT       = await hasRole(userId, 'it', 'branch_it');
    const isWFM      = await hasRole(userId, 'wfm');
    const isBranchAdmin = await hasRole(userId, 'branch_admin');

    if (isIT) filters.assignedRole = 'it';
    else if (isWFM) filters.assignedRole = 'wfm';
    else if (isBranchAdmin) filters.assignedRole = 'admin';

    if (req.query.branch_id) filters.branchId = req.query.branch_id as string;
  } else {
    if (req.query.branch_id)      filters.branchId     = req.query.branch_id as string;
    if (req.query.assigned_role)  filters.assignedRole = req.query.assigned_role as string;
  }

  const result = await listProvisioningRequests(filters);
  return res.json({ success: true, ...result });
}));

router.get(['/tasks', '/tasks/my'], requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdmin = await hasRole(userId, 'admin', 'hr', 'super_admin');
  const filters: Record<string, any> = {
    status: req.query.status as string | undefined,
    requestType: req.query.request_type as string | undefined,
    assignedRole: req.query.assigned_role as string | undefined,
    taskCode: req.query.task_code as string | undefined,
    page: req.query.page ? Number(req.query.page) : 1,
    limit: req.query.limit ? Number(req.query.limit) : 50,
  };
  if (req.path.endsWith('/my')) filters.assignedUserId = userId;
  if (!isAdmin && !filters.assignedRole) {
    if (await hasRole(userId, 'it', 'branch_it')) filters.assignedRole = 'it';
    else if (await hasRole(userId, 'wfm')) filters.assignedRole = 'wfm';
    else if (await hasRole(userId, 'branch_admin')) filters.assignedRole = 'admin';
  }
  const result = await listProvisioningRequests(filters);
  return res.json({ success: true, ...result });
}));

// ── GET /api/it-provisioning/requests/:id ─────────────────────────────────────
router.get('/requests/:id', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

// ── PATCH /api/it-provisioning/requests/:id/action ───────────────────────────
router.patch('/requests/:id/action', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const { evidence_note } = req.body as { evidence_note?: string };
  await actionProvisioningRequest({
    requestId:    req.params.id,
    actionedBy:   req.authUser!.id,
    evidenceNote: evidence_note,
  });
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

router.patch('/tasks/:id', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const note = req.body.evidence_note ?? req.body.remarks ?? null;
  if (note) {
    await actionProvisioningRequest({ requestId: req.params.id, actionedBy: req.authUser!.id, evidenceNote: String(note) });
  }
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

router.post('/tasks/:id/complete', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  await actionProvisioningRequest({ requestId: req.params.id, actionedBy: req.authUser!.id, evidenceNote: req.body.evidence_note ?? 'Completed from provisioning queue' });
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

// ── PATCH /api/it-provisioning/requests/:id/waive ────────────────────────────
router.patch('/requests/:id/waive', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const { evidence_note } = req.body as { evidence_note?: string };
  await waiveProvisioningRequest({
    requestId:    req.params.id,
    actionedBy:   req.authUser!.id,
    evidenceNote: evidence_note ?? '',
  });
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

router.post('/tasks/:id/waive', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  await waiveProvisioningRequest({ requestId: req.params.id, actionedBy: req.authUser!.id, evidenceNote: req.body.evidence_note ?? req.body.reason ?? '' });
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

router.post('/tasks/:id/block', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const reason = String(req.body.reason ?? req.body.evidence_note ?? '').trim();
  if (!reason) return res.status(400).json({ success: false, message: 'reason required' });
  await actionProvisioningRequest({ requestId: req.params.id, actionedBy: req.authUser!.id, evidenceNote: `BLOCKED: ${reason}` });
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

router.get('/appointment-letters', requireRole('admin', 'hr', 'super_admin'), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT alr.*, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name, c.candidate_code, c.full_name AS candidate_name
       FROM appointment_letter_request alr
       LEFT JOIN employees e ON e.id = alr.employee_id
       LEFT JOIN ats_candidate c ON c.id = alr.candidate_id
      ORDER BY alr.updated_at DESC
      LIMIT 100`,
  );
  return res.json({ success: true, data: rows });
}));

router.post('/appointment-letters/:id/send', requireRole('admin', 'hr', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  return changeAppointmentStatus(req, res, 'send');
}));

router.post('/appointment-letters/:id/aadhaar-signed', requireRole('admin', 'hr', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  return changeAppointmentStatus(req, res, 'aadhaar-signed');
}));

router.post('/appointment-letters/:id/company-signed', requireRole('admin', 'hr', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  return changeAppointmentStatus(req, res, 'company-signed');
}));

router.post('/appointment-letters/:id/complete', requireRole('admin', 'hr', 'super_admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  return changeAppointmentStatus(req, res, 'complete');
}));

// ── POST /api/it-provisioning/requests/:id/confirm ───────────────────────────
// Admin-only: manually lock a request immediately
router.post('/requests/:id/confirm', requireRole('admin', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  await confirmAndLockRequest(req.params.id, req.authUser!.id);
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

export { router as itProvisioningRouter };
