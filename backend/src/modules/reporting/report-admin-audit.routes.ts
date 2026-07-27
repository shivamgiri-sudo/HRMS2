import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import {
  adminListReportRequests,
  adminGetReportRequestDetail,
  adminRetryEmailDelivery,
} from './report-request.service.js';
import { recordReportAuditEvent, REPORT_AUDIT_EVENTS } from './report-audit.service.js';

export const reportAdminAuditRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<void>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// All routes in this file require super_admin
reportAdminAuditRouter.use(requireAuth, requireRole('super_admin'));

// GET /api/admin/report-requests — list with full filters
reportAdminAuditRouter.get('/', h(async (req, res) => {
  const q = req.query as Record<string, string>;
  const result = await adminListReportRequests({
    requestReference: q.requestReference,
    reportCode: q.reportCode,
    employeeCode: q.employeeCode,
    employeeName: q.employeeName,
    officialEmail: q.officialEmail,
    status: q.status,
    failureStage: q.failureStage,
    fromDate: q.fromDate,
    toDate: q.toDate,
    page: q.page ? Number(q.page) : 1,
    pageSize: q.pageSize ? Math.min(Number(q.pageSize), 200) : 50,
  });
  return res.json({ success: true, data: result.rows, total: result.total });
}));

// GET /api/admin/report-requests/overview-stats — KPI tiles for admin dashboard
reportAdminAuditRouter.get('/overview-stats', h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_all_time,
       SUM(CASE WHEN DATE(requested_at) = CURDATE() THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN status = 'EMAILED' THEN 1 ELSE 0 END) AS emailed,
       SUM(CASE WHEN status IN ('GENERATION_FAILED','DELIVERY_FAILED') THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) AS retried,
       COUNT(DISTINCT requested_by_user_id) AS unique_users,
       ROUND(AVG(CASE WHEN generation_completed_at IS NOT NULL AND processing_started_at IS NOT NULL
                 THEN TIMESTAMPDIFF(SECOND, processing_started_at, generation_completed_at) END), 1) AS avg_generation_seconds,
       ROUND(AVG(CASE WHEN email_sent_at IS NOT NULL AND email_queued_at IS NOT NULL
                 THEN TIMESTAMPDIFF(SECOND, email_queued_at, email_sent_at) END), 1) AS avg_delivery_seconds
     FROM report_request`
  );

  const [topReports] = await db.execute<RowDataPacket[]>(
    `SELECT report_code, report_name_snapshot, COUNT(*) AS request_count
     FROM report_request
     WHERE requested_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY report_code, report_name_snapshot
     ORDER BY request_count DESC
     LIMIT 10`
  );

  return res.json({ success: true, data: { stats: rows[0], topReports } });
}));

// GET /api/admin/report-requests/:requestId — full detail with audit timeline
reportAdminAuditRouter.get('/:requestId', h(async (req, res) => {
  const requestId = String(req.params.requestId);
  const detail = await adminGetReportRequestDetail(requestId);

  // Record admin viewed event
  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.SUPER_ADMIN_VIEWED_REQUEST,
    actorType: 'admin',
    actorUserId: req.authUser!.id,
    actorRole: 'super_admin',
    message: `Super Admin viewed request detail`,
  });

  return res.json({ success: true, data: detail });
}));

// POST /api/admin/report-requests/:requestId/retry — retry email delivery
reportAdminAuditRouter.post('/:requestId/retry', h(async (req, res) => {
  const requestId = String(req.params.requestId);
  const reason = String(req.body?.reason ?? '').trim();

  if (!reason) {
    return res.status(400).json({ success: false, error: 'A retry reason is required.' });
  }

  await adminRetryEmailDelivery(requestId, req.authUser!.id, reason);
  return res.json({ success: true, message: 'Email delivery retry queued successfully.' });
}));

// POST /api/admin/report-requests/:requestId/cancel — admin cancel
reportAdminAuditRouter.post('/:requestId/cancel', h(async (req, res) => {
  const requestId = String(req.params.requestId);
  const reason = String(req.body?.reason ?? 'Cancelled by administrator').trim();

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM report_request WHERE id = ?`,
    [requestId]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, error: 'Report request not found.' });
  }

  const req_ = rows[0] as { id: string; status: string };
  if (['EMAILED', 'CANCELLED', 'EXPIRED'].includes(req_.status)) {
    return res.status(409).json({ success: false, error: `Cannot cancel a request in status '${req_.status}'.` });
  }

  await db.execute(
    `UPDATE report_request SET status = 'CANCELLED', cancelled_at = NOW() WHERE id = ?`,
    [requestId]
  );
  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.SUPER_ADMIN_CANCELLED,
    actorType: 'admin',
    actorUserId: req.authUser!.id,
    actorRole: 'super_admin',
    message: `Admin cancelled request. Reason: ${reason}`,
  });

  return res.json({ success: true, message: 'Request cancelled.' });
}));
