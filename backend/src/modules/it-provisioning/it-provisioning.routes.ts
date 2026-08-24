import { Router } from 'express';
import type { Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import path from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { hasRole } from '../../shared/accessGuard.js';
import { narrowDashboardScope, resolveDashboardScope } from '../../shared/dashboardScope.js';
import { getUserRoleContext } from '../../shared/roleResolver.js';
import { db } from '../../db/mysql.js';
import {
  listProvisioningRequests,
  getProvisioningRequest,
  actionProvisioningRequest,
  waiveProvisioningRequest,
  confirmAndLockRequest,
  getProvisioningStats,
  OFFICIAL_EMAIL_REGEX,
} from './it-provisioning.service.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { parseAdEventLog } from './ad-log-parser.js';
import { dispatchTaskCompletion } from './task-completion-handlers.service.js';

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const PROVISIONING_ROLES = ['admin', 'super_admin', 'it', 'wfm', 'hr', 'branch_admin'];

// Multer for AD log evidence uploads — stored under uploads/provisioning-evidence/
const EVIDENCE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'provisioning-evidence');
try { mkdirSync(EVIDENCE_UPLOAD_DIR, { recursive: true }); } catch { /* dir already exists */ }
const ALLOWED_EVIDENCE_EXTS = new Set(['.txt', '.log', '.pdf', '.evtx']);
const evidenceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, EVIDENCE_UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EVIDENCE_EXTS.has(ext)) return cb(null, true);
    cb(new Error('Only .txt, .log, .pdf, or .evtx files are allowed for AD evidence'));
  },
});

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

async function persistStructuredFields(taskId: string, body: Record<string, unknown>) {
  const officialEmail   = clean(body.official_email)    || null;
  const domainAccount   = clean(body.domain_account)    || null;
  const assetTag        = clean(body.asset_tag)         || null;
  const evidenceFileUrl = clean(body.evidence_file_url) || null;
  const biometricDone   = body.biometric_enrolled != null ? (body.biometric_enrolled ? 1 : 0) : null;
  const idCardDone      = body.id_card_printed    != null ? (body.id_card_printed    ? 1 : 0) : null;

  // Only UPDATE if at least one structured field was sent
  if (!officialEmail && !domainAccount && !assetTag && !evidenceFileUrl && biometricDone == null && idCardDone == null) return;

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (officialEmail   !== null) { sets.push('official_email = ?');      vals.push(officialEmail); }
  if (domainAccount   !== null) { sets.push('domain_account = ?');      vals.push(domainAccount); }
  if (assetTag        !== null) { sets.push('asset_tag = ?');           vals.push(assetTag); }
  if (evidenceFileUrl !== null) { sets.push('evidence_file_url = ?');   vals.push(evidenceFileUrl); }
  if (biometricDone   != null)  { sets.push('biometric_enrolled = ?'); vals.push(biometricDone); }
  if (idCardDone      != null)  { sets.push('id_card_printed = ?');    vals.push(idCardDone); }

  if (sets.length) {
    vals.push(taskId);
    await db.execute(`UPDATE it_provisioning_request SET ${sets.join(', ')} WHERE id = ?`, vals);
  }
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
router.get('/stats', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdmin = await hasRole(userId, 'admin', 'hr', 'super_admin');
  const filters: { assignedRole?: string; branchIds?: string[]; processIds?: string[] } = {
    assignedRole: isAdmin ? String(req.query.assigned_role ?? 'it') : 'it',
  };

  if (isAdmin) {
    if (req.query.branch_id) filters.branchIds = [String(req.query.branch_id)];
    if (req.query.process_id) filters.processIds = [String(req.query.process_id)];
  } else {
    const roleContext = await getUserRoleContext(userId);
    const baseScope = await resolveDashboardScope(userId, roleContext.primaryRole);
    const scoped = await narrowDashboardScope(
      baseScope,
      String(req.query.branch_id ?? ''),
      String(req.query.process_id ?? ''),
    );
    filters.branchIds = scoped.branchIds;
    filters.processIds = scoped.processIds;
  }

  return res.json({ success: true, data: await getProvisioningStats(filters) });
}));

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
    const isIT       = await hasRole(userId, 'it');
    const isWFM      = await hasRole(userId, 'wfm');
    const isBranchAdmin = await hasRole(userId, 'branch_admin');

    if (isIT) filters.assignedRole = 'it';
    else if (isWFM) filters.assignedRole = 'wfm';
    else if (isBranchAdmin) filters.assignedRole = 'admin';

    const roleContext = await getUserRoleContext(userId);
    const baseScope = await resolveDashboardScope(userId, roleContext.primaryRole);
    const scoped = await narrowDashboardScope(
      baseScope,
      String(req.query.branch_id ?? ''),
      String(req.query.process_id ?? ''),
    );
    filters.branchIds = scoped.branchIds;
    filters.processIds = scoped.processIds;
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
    createdFrom: req.query.created_from as string | undefined,
    page: req.query.page ? Number(req.query.page) : 1,
    limit: req.query.limit ? Number(req.query.limit) : 50,
  };
  if (req.path.endsWith('/my')) filters.assignedUserId = userId;
  if (!isAdmin && !filters.assignedRole) {
    if (await hasRole(userId, 'it')) filters.assignedRole = 'it';
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
  // Persist structured IT/Admin fields if provided
  await persistStructuredFields(req.params.id, req.body);
  const data = await getProvisioningRequest(req.params.id);
  return res.json({ success: true, data });
}));

router.post('/tasks/:id/complete', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const taskId = req.params.id;
  const actorUserId = req.authUser!.id;
  const body = req.body as Record<string, unknown>;

  // Dispatch to role-specific handler that syncs master data
  // IT: syncs employees.official_email + creates auth_user
  // Admin: creates biometric + ID card records
  // WFM: updates employees.process_id + creates roster config
  // Others: falls through to existing actionProvisioningRequest
  await dispatchTaskCompletion(taskId, body, actorUserId);

  // Always persist structured fields to task record and mark actioned
  // (dispatchTaskCompletion marks actioned for IT/Admin/WFM;
  //  this handles APPOINTMENT_LETTER and any other task codes)
  const [taskRows] = await db.execute<RowDataPacket[]>(
    `SELECT task_code, status FROM it_provisioning_request WHERE id = ? LIMIT 1`,
    [taskId],
  );
  const taskCode: string = (taskRows as RowDataPacket[])[0]?.task_code ?? '';
  const alreadyActioned = (taskRows as RowDataPacket[])[0]?.status === 'actioned';

  if (!alreadyActioned) {
    await persistStructuredFields(taskId, body);
    await actionProvisioningRequest({ requestId: taskId, actionedBy: actorUserId, evidenceNote: String(body.evidence_note ?? 'Completed from provisioning queue') });
  }

  const data = await getProvisioningRequest(taskId);
  return res.json({ success: true, data, taskCode });
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

// ── GET /api/it-provisioning/tasks/:id/candidate-report ──────────────────────
router.get('/tasks/:id/candidate-report', requireRole(...PROVISIONING_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       ipr.id AS task_id, ipr.task_code, ipr.status, ipr.locked,
       ipr.official_email, ipr.domain_account, ipr.asset_tag,
       ipr.biometric_enrolled, ipr.id_card_printed, ipr.evidence_note,
       ipr.evidence_file_url,
       ipr.requested_at, ipr.actioned_at,
       e.id AS employee_id, e.employee_code, e.first_name, e.last_name,
       e.personal_email, e.mobile, dm.designation_name AS designation, e.date_of_joining,
       b.branch_name AS branch_name, p.process_name AS process_name
     FROM it_provisioning_request ipr
     JOIN employees e ON e.id = ipr.employee_id
     LEFT JOIN designation_master dm ON dm.id = e.designation_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
     LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ipr.id = ?
     LIMIT 1`,
    [req.params.id],
  );
  if (!(rows as RowDataPacket[]).length) return res.status(404).json({ success: false, message: 'Task not found' });
  const row = (rows as RowDataPacket[])[0];
  // Mask mobile
  if (row.mobile && row.mobile.length >= 6) {
    row.mobile = row.mobile.slice(0, 3) + 'XXXXX' + row.mobile.slice(-3);
  }
  return res.json({ success: true, data: row });
}));

// ── POST /api/it-provisioning/tasks/bulk-complete ────────────────────────────
router.post('/tasks/bulk-complete', requireRole('it', 'admin', 'super_admin', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = req.body.rows as Array<{ employee_code: string; official_email?: string; domain_account?: string; asset_tag?: string }>;
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ success: false, message: 'rows array required' });
  }
  const results: { employee_code: string; status: 'ok' | 'error'; message?: string }[] = [];

  for (const row of rows) {
    try {
      if (!row.employee_code?.trim()) { results.push({ employee_code: '', status: 'error', message: 'Missing employee_code' }); continue; }
      const [taskRows] = await db.execute<RowDataPacket[]>(
        `SELECT ipr.id, ipr.task_code FROM it_provisioning_request ipr
           JOIN employees e ON e.id = ipr.employee_id
          WHERE e.employee_code = ? AND ipr.task_code = 'IT_EMAIL_DOMAIN_ASSET' AND ipr.status = 'pending'
          LIMIT 1`,
        [row.employee_code.trim()],
      );
      const task = (taskRows as RowDataPacket[])[0];
      if (!task) { results.push({ employee_code: row.employee_code, status: 'error', message: 'No pending IT task found' }); continue; }

      if (!row.official_email?.trim() || !row.domain_account?.trim()) {
        results.push({ employee_code: row.employee_code, status: 'error', message: 'official_email and domain_account required' }); continue;
      }
      await persistStructuredFields(task.id, row);
      await actionProvisioningRequest({ requestId: task.id, actionedBy: req.authUser!.id, evidenceNote: `Bulk completed: ${row.official_email}` });
      results.push({ employee_code: row.employee_code, status: 'ok' });
    } catch (err: unknown) {
      results.push({ employee_code: row.employee_code, status: 'error', message: (err as Error)?.message ?? 'Unknown error' });
    }
  }

  const okCount = results.filter(r => r.status === 'ok').length;
  return res.json({ success: true, processed: results.length, completed: okCount, results });
}));

// ── POST /api/it-provisioning/tasks/:id/upload-evidence ──────────────────────
// Accepts multipart/form-data field "file" (.txt/.log/.pdf/.evtx, max 10 MB).
// Saves the file, records it in document_vault_inventory, and persists the URL
// on the provisioning task row. Does NOT mark the task as actioned.

router.post(
  '/tasks/:id/upload-evidence',
  requireRole(...PROVISIONING_ROLES),
  (req: any, res: any, next: any) => evidenceUpload.single('file')(req, res, (err: any) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  }),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const taskId = req.params.id;
    if (!(req as any).file) {
      return res.status(400).json({ success: false, message: 'No file uploaded. Send a multipart/form-data request with field "file".' });
    }

    const file = (req as any).file as { filename: string; originalname: string; size: number; mimetype: string };
    const fileUrl = `/api/files/provisioning-evidence/${file.filename}`;

    // Persist URL on the task row
    await db.execute(
      `UPDATE it_provisioning_request SET evidence_file_url = ?, updated_at = NOW() WHERE id = ?`,
      [fileUrl, taskId],
    );

    // Register in document vault for audit trail (non-fatal)
    try {
      const { registerUpload } = await import('../document-vault/documentVault.service.js');
      await registerUpload({
        uploadedByUser: req.authUser!.id,
        category: 'provisioning-evidence',
        storedFilename: file.filename,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        accessLevel: 'internal',
      });
    } catch (err) {
      console.error('[upload-evidence] document vault registration failed:', err);
    }

    // Parse AD Security Event Log if it's a .txt or .log file (non-fatal)
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.txt' || ext === '.log') {
      try {
        const parsed = await parseAdEventLog(
          path.resolve(EVIDENCE_UPLOAD_DIR, file.filename)
        );
        if (parsed) {
          await db.execute(
            `UPDATE it_provisioning_request
                SET ad_log_type       = ?,
                    ad_account_name   = ?,
                    ad_event_id       = ?,
                    ad_actioned_by_it = ?,
                    ad_event_time     = ?
              WHERE id = ?`,
            [
              parsed.logType,
              parsed.accountName   ?? null,
              parsed.eventId,
              parsed.actionedByIt  ?? null,
              parsed.eventTime     ?? null,
              taskId,
            ],
          );
        }
      } catch (err) {
        console.error('[upload-evidence] AD log parsing failed:', err);
      }
    }

    return res.json({ success: true, url: fileUrl, filename: file.filename });
  }),
);

// ── SLA Violations Dashboard ──────────────────────────────────────────────────
router.get('/sla/violations', requireRole('admin', 'super_admin', 'hr'), h(async (_req: AuthenticatedRequest, res: Response) => {
  const { findSlaViolations } = await import('../employees/employee-activation.service.js');
  const violations = await findSlaViolations();
  return res.json({ success: true, data: violations, count: violations.length });
}));

router.get('/sla/summary', requireRole('admin', 'super_admin', 'hr', 'it', 'wfm'), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [summary] = await db.execute<RowDataPacket[]>(
    `SELECT
       task_code,
       COUNT(*) AS total,
       SUM(CASE WHEN status IN ('actioned','verified','waived') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN sla_due_at IS NOT NULL AND sla_due_at < NOW()
                 AND status NOT IN ('actioned','verified','waived','cancelled') THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN assignment_exception = 1 THEN 1 ELSE 0 END) AS unassigned,
       AVG(CASE
         WHEN sla_due_at IS NOT NULL AND status IN ('actioned','verified')
         THEN TIMESTAMPDIFF(HOUR, created_at, actioned_at)
       END) AS avg_completion_hours
     FROM it_provisioning_request
     WHERE request_type = 'join'
       AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY task_code
     ORDER BY task_code`,
    []
  );
  return res.json({ success: true, data: summary });
}));

// ── POST /api/it-provisioning/bulk-sync ──────────────────────────────────────
// Upserts existing IT data (email, domain, asset) onto employee records.
// Works whether or not a provisioning task exists — handles both:
//   a) employees with a pending IT task  → marks it actioned
//   b) employees already provisioned / no task → just updates employee record
router.post('/bulk-sync', requireRole('it', 'admin', 'super_admin', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = req.body.rows as Array<{
    employee_code: string;
    official_email?: string;
    domain_account?: string;
    asset_tag?: string;
    biometric_enrolled?: string;
    id_card_printed?: string;
  }>;
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ success: false, message: 'rows array required' });
  }

  const results: {
    employee_code: string;
    employee_name?: string;
    status: 'updated' | 'task_completed' | 'skipped' | 'error';
    actions: string[];
    message?: string;
  }[] = [];

  for (const row of rows) {
    const empCode = String(row.employee_code ?? '').trim();
    const actions: string[] = [];
    try {
      if (!empCode) {
        results.push({ employee_code: '', status: 'skipped', actions, message: 'Missing employee_code' });
        continue;
      }

      // Look up the employee
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.id, e.official_email,
                CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name
           FROM employees e WHERE e.employee_code = ? AND e.active_status = 1 LIMIT 1`,
        [empCode],
      );
      const emp = (empRows as any[])[0];
      if (!emp) {
        results.push({ employee_code: empCode, status: 'error', actions, message: 'Employee not found or inactive' });
        continue;
      }

      const officialEmail  = String(row.official_email  ?? '').trim() || null;
      const domainAccount  = String(row.domain_account  ?? '').trim() || null;
      const assetTag       = String(row.asset_tag       ?? '').trim() || null;
      const bioEnrolled    = String(row.biometric_enrolled ?? '').trim().toLowerCase();
      const idCardPrinted  = String(row.id_card_printed  ?? '').trim().toLowerCase();

      // 1. Update employees.official_email if provided and different
      if (officialEmail && officialEmail !== emp.official_email) {
        await db.execute(
          `UPDATE employees SET official_email = ?, updated_at = NOW() WHERE id = ?`,
          [officialEmail, emp.id],
        );
        actions.push(`official_email set to ${officialEmail}`);
      }

      // 2. Find any provisioning task for this employee
      const [taskRows] = await db.execute<RowDataPacket[]>(
        `SELECT id, task_code, status FROM it_provisioning_request
          WHERE employee_id = ? AND task_code = 'IT_EMAIL_DOMAIN_ASSET'
          ORDER BY created_at DESC LIMIT 1`,
        [emp.id],
      );
      const task = (taskRows as any[])[0];

      let taskStatus: 'updated' | 'task_completed' | 'skipped' | 'error' = 'updated';

      if (task) {
        // Persist structured fields on the provisioning task row
        const fieldsToSet: string[] = [];
        const fieldVals: unknown[] = [];
        if (officialEmail)  { fieldsToSet.push('official_email = ?');  fieldVals.push(officialEmail); }
        if (domainAccount)  { fieldsToSet.push('domain_account = ?');  fieldVals.push(domainAccount); }
        if (assetTag)       { fieldsToSet.push('asset_tag = ?');       fieldVals.push(assetTag); }
        if (bioEnrolled === '1' || bioEnrolled === 'yes' || bioEnrolled === 'true') {
          fieldsToSet.push('biometric_enrolled = 1');
        }
        if (idCardPrinted === '1' || idCardPrinted === 'yes' || idCardPrinted === 'true') {
          fieldsToSet.push('id_card_printed = 1');
        }
        if (fieldsToSet.length) {
          fieldVals.push(task.id);
          await db.execute(
            `UPDATE it_provisioning_request SET ${fieldsToSet.join(', ')}, updated_at = NOW() WHERE id = ?`,
            fieldVals,
          );
          if (domainAccount) actions.push(`domain_account set to ${domainAccount}`);
          if (assetTag)      actions.push(`asset_tag set to ${assetTag}`);
        }

        // If task is still pending, mark it actioned
        if (task.status === 'pending' || task.status === 'pending_unassigned') {
          if (!officialEmail || !domainAccount) {
            actions.push('task NOT completed — official_email and domain_account both required');
          } else {
            await actionProvisioningRequest({
              requestId: task.id,
              actionedBy: req.authUser!.id,
              evidenceNote: `Bulk sync: email=${officialEmail}, domain=${domainAccount}${assetTag ? `, asset=${assetTag}` : ''}`,
            });
            actions.push('provisioning task marked completed');
            taskStatus = 'task_completed';
          }
        } else {
          actions.push(`provisioning task already ${task.status} — data updated only`);
        }
      } else {
        // No task — just log what was done
        if (domainAccount) actions.push(`domain_account noted (${domainAccount}) — no provisioning task to update`);
        if (assetTag)      actions.push(`asset_tag noted (${assetTag}) — no provisioning task to update`);
      }

      if (actions.length === 0) actions.push('no changes — all fields already match');

      await logSensitiveAction({
        actor_user_id: req.authUser!.id,
        action_type: 'it_bulk_sync',
        module_key: 'it_provisioning',
        entity_type: 'employee',
        entity_id: emp.id,
        change_summary: { employee_code: empCode, official_email: officialEmail, domain_account: domainAccount, asset_tag: assetTag },
      });

      results.push({ employee_code: empCode, employee_name: emp.employee_name, status: taskStatus, actions });
    } catch (err: unknown) {
      results.push({ employee_code: empCode, status: 'error', actions, message: (err as Error)?.message ?? 'Unknown error' });
    }
  }

  const completed = results.filter(r => r.status === 'task_completed').length;
  const updated   = results.filter(r => r.status === 'updated').length;
  const errors    = results.filter(r => r.status === 'error').length;
  return res.json({ success: true, processed: results.length, completed, updated, errors, results });
}));

// ── IT Dashboard Summary (comprehensive) ─────────────────────────────────────
router.get('/it-dashboard-summary', requireRole('admin', 'super_admin', 'it', 'branch_it', 'ho_it', 'hr'), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdmin = await hasRole(userId, 'admin', 'hr', 'super_admin');

  const provFilters: { assignedRole?: string; branchIds?: string[]; processIds?: string[] } = {
    assignedRole: 'it',
  };
  if (isAdmin) {
    if (req.query.branch_id) provFilters.branchIds = [String(req.query.branch_id)];
    if (req.query.process_id) provFilters.processIds = [String(req.query.process_id)];
  } else {
    const roleContext = await getUserRoleContext(userId);
    const baseScope = await resolveDashboardScope(userId, roleContext.primaryRole);
    const scoped = await narrowDashboardScope(
      baseScope,
      String(req.query.branch_id ?? ''),
      String(req.query.process_id ?? ''),
    );
    provFilters.branchIds = scoped.branchIds;
    provFilters.processIds = scoped.processIds;
  }

  const [
    provisioning,
    [ticketStatsRows],
    [ticketListRows],
    [assetSummaryRows],
    [empDirectoryRows],
  ] = await Promise.all([
    getProvisioningStats(provFilters),

    db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*)                                                                     AS total_tickets,
         SUM(status NOT IN ('resolved','closed','cancelled'))                         AS open_tickets,
         SUM(priority = 'urgent' AND status NOT IN ('resolved','closed','cancelled')) AS urgent_tickets,
         SUM(sla_breached = 1)                                                        AS sla_breached_total,
         SUM(sla_breached = 1 AND status NOT IN ('resolved','closed','cancelled'))    AS sla_breached_open,
         ROUND(AVG(CASE WHEN resolved_at IS NOT NULL
           THEN TIMESTAMPDIFF(MINUTE, created_at, resolved_at) END), 0)               AS avg_resolution_minutes,
         SUM(status IN ('resolved','closed') AND sla_breached = 0)                   AS resolved_on_time
       FROM helpdesk_ticket
       WHERE category = 'it'`,
      [],
    ),

    db.execute<RowDataPacket[]>(
      `SELECT t.id, t.ticket_code AS ticket_number, t.subject, t.status, t.priority,
              t.created_at, t.resolved_at, t.sla_due_at, t.sla_breached,
              t.assigned_to, t.closure_rating,
              CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS raised_by_name,
              e.employee_code,
              bm.branch_name, pm.process_name,
              -- auth_user has no display_name column, so this endpoint returned
              -- HTTP 500 ("Unknown column 'au.display_name'") on every IT dashboard
              -- load. Resolve the assignee's name from their employee record, falling
              -- back to the login email.
              COALESCE(
                assignee.full_name,
                NULLIF(TRIM(CONCAT_WS(' ', assignee.first_name, assignee.last_name)), ''),
                au.email
              ) AS resolved_by_name
         FROM helpdesk_ticket t
         LEFT JOIN employees e ON e.id = t.employee_id
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
         LEFT JOIN process_master pm ON pm.id = e.process_id
         LEFT JOIN auth_user au ON au.id = t.assigned_to
         LEFT JOIN employees assignee ON assignee.auth_user_id = au.id AND assignee.active_status = 1
        WHERE t.category = 'it'
        ORDER BY t.created_at DESC
        LIMIT 50`,
      [],
    ),

    db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*)                                                                              AS total_assets,
         SUM(status = 'available')                                                            AS available,
         SUM(status = 'assigned')                                                             AS assigned,
         SUM(status = 'maintenance')                                                          AS in_maintenance,
         SUM(warranty_expiry IS NOT NULL AND warranty_expiry BETWEEN NOW()
             AND DATE_ADD(NOW(), INTERVAL 90 DAY))                                            AS expiring_soon
       FROM asset_master
       WHERE active_status = 1`,
      [],
    ),

    db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code,
              CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
              e.official_email,
              bm.branch_name, pm.process_name, dm.dept_name,
              ipr.domain_account, ipr.asset_tag,
              ipr.status AS it_provision_status,
              ipr.actioned_at AS it_provisioned_at,
              am.asset_name, am.asset_category, am.serial_number
         FROM employees e
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
         LEFT JOIN process_master pm ON pm.id = e.process_id
         LEFT JOIN department_master dm ON dm.id = e.department_id
         LEFT JOIN it_provisioning_request ipr
                ON ipr.employee_id = e.id
               AND ipr.task_code = 'IT_EMAIL_DOMAIN_ASSET'
               AND ipr.id = (SELECT id FROM it_provisioning_request
                              WHERE employee_id = e.id AND task_code = 'IT_EMAIL_DOMAIN_ASSET'
                              ORDER BY created_at DESC LIMIT 1)
         LEFT JOIN asset_assignment aa ON aa.employee_id = e.id AND aa.returned_date IS NULL
         LEFT JOIN asset_master am ON am.id = aa.asset_id
        WHERE e.active_status = 1
        ORDER BY e.employee_code
        LIMIT 200`,
      [],
    ),
  ]);

  return res.json({
    success: true,
    data: {
      provisioning,
      helpdesk: {
        stats: (ticketStatsRows as any[])[0] ?? {},
        tickets: ticketListRows as any[],
      },
      assets: (assetSummaryRows as any[])[0] ?? {},
      employees: empDirectoryRows as any[],
      generatedAt: new Date().toISOString(),
    },
  });
}));

// ── POST /api/it-provisioning/redispatch/:employeeId ─────────────────────────
// Recovery endpoint: re-dispatch join provisioning tasks for an employee whose
// tasks were lost (e.g., failed fire-and-forget during employee creation).
// Only dispatches task codes that have NO existing row — idempotent.
router.post('/redispatch/:employeeId', requireRole('hr', 'super_admin', 'admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.branch_id, e.date_of_joining, e.legacy_emp_id
       FROM employees e WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = (empRows as RowDataPacket[])[0];
  if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });
  if (emp.legacy_emp_id) return res.status(400).json({ success: false, message: 'Cannot dispatch IT provisioning for a legacy (pre-HRMS) employee' });
  if (!emp.employee_code) return res.status(400).json({ success: false, message: 'Employee has no employee_code — cannot dispatch provisioning' });

  // Find which task codes already exist so we skip them
  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT task_code FROM it_provisioning_request WHERE employee_id = ? AND request_type = 'join'`,
    [employeeId],
  );
  const existingCodes = new Set((existingRows as RowDataPacket[]).map(r => String(r.task_code)));

  const JOIN_TASK_CODES = ['WFM_PROCESS_ALIGNMENT', 'IT_EMAIL_DOMAIN_ASSET', 'ADMIN_BIOMETRIC_ID_CARD', 'APPOINTMENT_LETTER_ESIGN'];
  const missingCodes = JOIN_TASK_CODES.filter(code => !existingCodes.has(code));

  if (missingCodes.length === 0) {
    return res.json({ success: true, dispatched: 0, skipped: JOIN_TASK_CODES.length, message: 'All provisioning tasks already exist — nothing to redispatch' });
  }

  const { dispatchJoinProvisioningTasks } = await import('./it-provisioning.service.js');
  await dispatchJoinProvisioningTasks({
    employeeId: emp.id,
    employeeCode: emp.employee_code,
    employeeName: emp.full_name,
    branchId: emp.branch_id ?? null,
    actorUserId: req.authUser!.id,
    joiningDate: emp.date_of_joining ?? null,
  });

  await logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: 'provisioning_redispatched',
    module_key: 'it_provisioning',
    entity_type: 'employee',
    entity_id: employeeId,
    employee_id: employeeId,
    change_summary: { redispatched_codes: missingCodes, skipped_codes: Array.from(existingCodes) },
  });

  return res.json({
    success: true,
    dispatched: missingCodes.length,
    skipped: existingCodes.size,
    redispatched_codes: missingCodes,
    message: `Provisioning redispatched for ${missingCodes.length} task(s)`,
  });
}));

export { router as itProvisioningRouter };
