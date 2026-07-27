import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import {
  previewReportRequest,
  createReportRequest,
  getMyReportRequests,
  getMyReportRequestDetail,
  cancelReportRequest,
} from './report-request.service.js';
import { REPORT_CATALOG } from './report-catalog.js';
import { resolveRegisteredOfficialEmail, maskEmail } from './report-email-resolver.js';

export const reportRequestRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<void>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// GET /api/reports/available — catalog filtered by user role
reportRequestRouter.get('/available', requireAuth, h(async (req, res) => {
  const userRoles: string[] = req.authUser!.roles ?? [req.authUser!.role ?? 'employee'];
  const normalised = userRoles.map(r => r.toLowerCase());

  const available = REPORT_CATALOG
    .filter(r => {
      const viewRoles = r.viewRoles.map(vr => vr.toLowerCase());
      return normalised.some(role =>
        role === 'super_admin' || role === 'admin' || viewRoles.includes(role)
      );
    })
    .map(r => ({
      code: r.code,
      name: r.name,
      category: r.category,
      subcategory: r.subcategory,
      description: r.description,
      rowGrain: r.rowGrain,
      filters: r.filters,
      canRequest: true,
    }));

  return res.json({ success: true, data: available, total: available.length });
}));

// POST /api/reports/:reportCode/preview-request — scope preview without executing
reportRequestRouter.post('/:reportCode/preview-request', requireAuth, h(async (req, res) => {
  const reportCode = String(req.params.reportCode);
  const filters = req.body.filters as Record<string, unknown> ?? {};
  const userId = req.authUser!.id;

  const preview = await previewReportRequest(userId, reportCode, filters);
  return res.json({ success: true, data: preview });
}));

// POST /api/reports/:reportCode/request — submit a report request
reportRequestRouter.post('/:reportCode/request', requireAuth, h(async (req, res) => {
  const reportCode = String(req.params.reportCode);
  const filters = req.body.filters as Record<string, unknown> ?? {};
  const userId = req.authUser!.id;

  const result = await createReportRequest(userId, reportCode, filters, {
    ip: req.ip ?? '',
    userAgent: String(req.headers['user-agent'] ?? ''),
    correlationId: String(req.headers['x-request-id'] ?? ''),
  });

  return res.status(result.isDuplicate ? 200 : 202).json({
    success: true,
    requestReference: result.requestReference,
    requestId: result.requestId,
    status: result.status,
    recipientEmailMasked: result.recipientEmailMasked,
    isDuplicate: result.isDuplicate,
    message: result.message,
  });
}));

// GET /api/reports/my-requests — list the authenticated user's requests
reportRequestRouter.get('/my-requests', requireAuth, h(async (req, res) => {
  const userId = req.authUser!.id;
  const page = Number(req.query.page ?? 1);
  const pageSize = Math.min(Number(req.query.pageSize ?? 20), 100);

  const result = await getMyReportRequests(userId, page, pageSize);
  return res.json({ success: true, data: result.rows, total: result.total, page, pageSize });
}));

// GET /api/reports/my-requests/:requestId — single request detail
reportRequestRouter.get('/my-requests/:requestId', requireAuth, h(async (req, res) => {
  const userId = req.authUser!.id;
  const requestId = String(req.params.requestId);

  const detail = await getMyReportRequestDetail(userId, requestId);
  return res.json({ success: true, data: detail });
}));

// POST /api/reports/my-requests/:requestId/cancel — cancel if QUEUED
reportRequestRouter.post('/my-requests/:requestId/cancel', requireAuth, h(async (req, res) => {
  const userId = req.authUser!.id;
  const requestId = String(req.params.requestId);

  await cancelReportRequest(userId, requestId);
  return res.json({ success: true, message: 'Report request cancelled successfully.' });
}));

// GET /api/reports/my-email — show the current user's resolved official email (masked)
reportRequestRouter.get('/my-email', requireAuth, h(async (req, res) => {
  const userId = req.authUser!.id;
  try {
    const resolution = await resolveRegisteredOfficialEmail(userId);
    return res.json({
      success: true,
      officialEmailMasked: maskEmail(resolution.officialEmail),
      hasOfficialEmail: true,
    });
  } catch {
    return res.json({
      success: true,
      officialEmailMasked: null,
      hasOfficialEmail: false,
      message: 'No official company email address found for your account. Please contact HR or IT.',
    });
  }
}));
