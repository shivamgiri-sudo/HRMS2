import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { reportingService } from './reporting.service.js';
import { reportingAnalyticsV2Service } from './reporting.analytics-v2.service.js';
import { bpoMasterReportRouter } from './bpo-master-report.routes.js';
import { deepReportRouter } from './deep-report.routes.js';
import { journeyAuditReportRouter } from './journey-audit-report.routes.js';
import { reportSuiteHighRiskRouter } from "./report-suite-highrisk.routes.js";
import { reportSuiteRouter } from "./report-suite.routes.js";
import { reportRequestRouter } from "./report-request.routes.js";
import { reportAccessGrantsRouter } from "./report-access-grants.routes.js";
import { REPORT_CATALOG } from './report-catalog.js';
import type { SensitivityLevel, ReportAvailabilityStatus } from './report-catalog.js';
import { resolveFullScope } from './reporting.scope.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { recordReportAuditEvent, REPORT_AUDIT_EVENTS } from './report-audit.service.js';

const router = Router();
// Per-employee report access grants (admin only — must be before wildcard routes)
router.use("/access-grants", reportAccessGrantsRouter);
// Secure request → generate → email platform routes (must be mounted before :code wildcard routes)
router.use("/", reportRequestRouter);
router.use("/bpo-master", bpoMasterReportRouter);
router.use("/deep-sections", deepReportRouter);
router.use("/journey-audit", journeyAuditReportRouter);
router.use("/suite", reportSuiteHighRiskRouter);
router.use("/suite", reportSuiteRouter);
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<void>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// All authenticated roles may list and run reports — branch scope is enforced in the service.
router.get('/', requireAuth, h(async (req, res) => {
  const reports = await reportingService.listReports(req.authUser!.id);
  res.json({ data: reports });
}));

router.get('/analytics-overview', requireAuth, h(async (req, res) => {
  const year = Number(req.query.year ?? new Date().getFullYear());
  const data = await reportingAnalyticsV2Service.analyticsOverview(year, req.authUser!.id);
  res.json({ success: true, data });
}));

router.get('/leave-balances', requireAuth, h(async (req, res) => {
  const year = Number(req.query.year ?? new Date().getFullYear());
  const filters = {
    branchId:  req.query.branchId  as string | undefined,
    processId: req.query.processId as string | undefined,
  };
  const data = await reportingService.leaveBalanceOverview(year, req.authUser!.id, filters);
  res.json({ success: true, data });
}));

router.post('/:code/run', requireAuth, h(async (req, res) => {
  const filters = req.body.filters || {};
  const result = await reportingService.runReport(req.params.code, filters, req.authUser!.id);
  res.json({ data: result });
}));

// ── GET /api/reports/catalog ───────────────────────────────────────────────────
// Returns permission-filtered catalog with security metadata computed server-side.
// Frontend must read isSensitive, immediateExportAllowed, deliveryModes from this response —
// never maintain a local SENSITIVE_CATEGORIES list.
router.get('/catalog', requireAuth, h(async (req, res) => {
  const userId   = req.authUser!.id;
  const scope    = await resolveFullScope(userId);
  const userRoles = new Set(scope.roles);

  // Fetch all active per-user grants in one query for O(1) lookups below
  const [grantRows] = await db.execute<RowDataPacket[]>(
    `SELECT report_code, can_view, can_export FROM user_report_permissions
     WHERE user_id = ? AND active_status = 1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  );
  const grantMap = new Map<string, { can_view: number; can_export: number }>(
    (grantRows as any[]).map(g => [g.report_code as string, g])
  );

  // Fetch all active role-based grants for the user's roles
  const userRolesList = [...userRoles];
  let roleGrantMap = new Map<string, { can_view: number; can_export: number }>();
  if (userRolesList.length) {
    const placeholders = userRolesList.map(() => '?').join(',');
    const [roleGrantRows] = await db.execute<RowDataPacket[]>(
      `SELECT report_code, MAX(can_view) AS can_view, MAX(can_export) AS can_export
       FROM role_report_permissions
       WHERE role_key IN (${placeholders}) AND active_status = 1
       GROUP BY report_code`,
      userRolesList
    );
    roleGrantMap = new Map<string, { can_view: number; can_export: number }>(
      (roleGrantRows as any[]).map(g => [g.report_code as string, g])
    );
  }

  const EXCLUDED_STATUSES = new Set(['deprecated', 'disabled']);
  const SENSITIVE_LEVELS  = new Set<SensitivityLevel>(['restricted', 'highly_restricted']);
  const IMMEDIATE_LEVELS  = new Set<SensitivityLevel>(['internal', 'confidential']);
  const isSuperAdmin      = userRoles.has('super_admin');

  const data = REPORT_CATALOG
    .filter(r => !EXCLUDED_STATUSES.has((r.availabilityStatus ?? 'under_validation') as ReportAvailabilityStatus))
    .map(r => {
      const level         = (r.sensitivityLevel ?? 'confidential') as SensitivityLevel;
      const isSensitive   = SENSITIVE_LEVELS.has(level);
      const enabled       = ['validated', 'validated_with_limitations'].includes(r.availabilityStatus ?? 'under_validation');
      const userGrant     = grantMap.get(r.code);
      const roleGrant     = roleGrantMap.get(r.code);
      const viewAllowed   = isSuperAdmin || r.viewRoles.length === 0 || r.viewRoles.some(role => userRoles.has(role)) || Boolean(roleGrant?.can_view) || Boolean(userGrant?.can_view);
      const exportAllowed = isSuperAdmin || r.exportRoles.length === 0 || r.exportRoles.some(role => userRoles.has(role)) || Boolean(roleGrant?.can_export) || Boolean(userGrant?.can_export);

      // super_admin can immediately download ALL reports regardless of sensitivity.
      // All other roles: internal/confidential only.
      //
      // This deliberately does NOT gate on `enabled` (i.e. on availabilityStatus), for two
      // reasons measured on 2026-08-07:
      //
      //   1. It disagreed with the endpoint that actually serves the file.
      //      GET /api/reports/suite/:code/export gates on sensitivity and exportRoles and
      //      never looks at availabilityStatus. So the backend would return the workbook
      //      while this told the UI to hide the button — 108 of 117 reports were
      //      downloadable and invisible. That mismatch is the "no XLSX export exists,
      //      only Request by Email" finding from CEO UAT.
      //
      //   2. It protected nothing. `email` below is pushed on viewAllowed alone, so the
      //      same rows of the same report already left the building by email for exactly
      //      the same users. Gating the download while leaving email open withheld
      //      convenience, not data.
      //
      // availabilityStatus and `enabled` are still returned below so the UI can badge an
      // unvalidated report as such. Marking a report unvalidated should say "treat this
      // number with care", not silently remove the way to get it.
      const immediateExportAllowed = isSuperAdmin
        ? exportAllowed
        : IMMEDIATE_LEVELS.has(level) && exportAllowed;

      const deliveryModes: string[] = ['screen'];
      if (immediateExportAllowed)              deliveryModes.push('xlsx');
      if (viewAllowed)                         deliveryModes.push('email');

      return {
        code:                  r.code,
        name:                  r.name,
        category:              r.category,
        subcategory:           r.subcategory,
        description:           r.description,
        filters:               r.filters.map(f => f.key),
        sensitivityLevel:      level,
        containsPII:           r.containsPII ?? true,     // fail-safe: assume PII present if unset
        containsFinancialData: r.containsFinancialData ?? false,
        isSensitive,
        deliveryModes,
        viewAllowed,
        exportAllowed,
        immediateExportAllowed,
        availabilityStatus:    r.availabilityStatus ?? 'under_validation',
        enabled,
      };
    })
    .filter(r => r.viewAllowed); // exclude codes the user cannot see at all

  const activeTotal     = REPORT_CATALOG.filter(r => !EXCLUDED_STATUSES.has((r.availabilityStatus ?? 'under_validation') as ReportAvailabilityStatus)).length;
  const unavailableTotal = data.filter(r => !r.enabled).length;

  res.json({
    data,
    visibleTotal:     data.length,
    activeTotal,
    unavailableTotal,
  });
}));

// ── GET /api/reports/download/:token ──────────────────────────────────────────
// Secure single-use download for restricted report files.
// Requires authenticated session; token is personal and non-transferable.
const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

router.get('/download/:token', requireAuth, h(async (req, res) => {
  const rawToken  = req.params.token;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const userId    = req.authUser!.id;

  // Look up token record
  const [tokenRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, file_id, requesting_user_id, report_code, expires_at,
            download_status, used_at, revoked_at
     FROM report_download_token
     WHERE token_hash = ?`,
    [tokenHash]
  );
  if (!tokenRows.length) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

  const tok = tokenRows[0] as {
    id: number; file_id: string; requesting_user_id: number;
    report_code: string; expires_at: Date; download_status: string;
    used_at: Date | null; revoked_at: Date | null;
  };

  if (tok.download_status === 'EXPIRED' || new Date(tok.expires_at) < new Date()) {
    res.status(410).json({ error: 'EXPIRED' }); return;
  }
  if (tok.download_status === 'USED' || tok.used_at) {
    res.status(410).json({ error: 'ALREADY_USED' }); return;
  }
  if (tok.download_status === 'REVOKED' || tok.revoked_at) {
    res.status(410).json({ error: 'REVOKED' }); return;
  }
  if (String(tok.requesting_user_id) !== String(userId)) {
    res.status(403).json({ error: 'FORBIDDEN' }); return;
  }

  // Re-check current role still permits access to this report code
  const scope     = await resolveFullScope(userId);
  const catalogEntry = REPORT_CATALOG.find(r => r.code === tok.report_code);
  if (catalogEntry) {
    const userRoles = new Set(scope.roles);
    const isSuperAdmin = userRoles.has('super_admin');
    const catalogAllowed = catalogEntry.viewRoles.length === 0 ||
      catalogEntry.viewRoles.some(role => userRoles.has(role));
    if (!isSuperAdmin && !catalogAllowed) {
      // Check role_report_permissions and user_report_permissions as fallback
      const rolesList = [...userRoles];
      let grantAllowed = false;
      if (rolesList.length) {
        const placeholders = rolesList.map(() => '?').join(',');
        const [roleRows] = await db.execute<RowDataPacket[]>(
          `SELECT 1 FROM role_report_permissions
           WHERE role_key IN (${placeholders}) AND report_code = ? AND active_status = 1 LIMIT 1`,
          [...rolesList, tok.report_code]
        );
        grantAllowed = roleRows.length > 0;
      }
      if (!grantAllowed) {
        const [userRows] = await db.execute<RowDataPacket[]>(
          `SELECT 1 FROM user_report_permissions
           WHERE user_id = ? AND report_code = ? AND active_status = 1
             AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
          [userId, tok.report_code]
        );
        grantAllowed = userRows.length > 0;
      }
      if (!grantAllowed) { res.status(403).json({ error: 'FORBIDDEN_ROLE' }); return; }
    }
  }

  // Atomic claim: only proceed if exactly 1 row updated (prevents concurrent reuse)
  const [claimResult] = await db.execute(
    `UPDATE report_download_token
     SET download_status = 'IN_PROGRESS'
     WHERE id = ? AND download_status = 'AVAILABLE'`,
    [tok.id]
  );
  const claimRows = (claimResult as unknown as { affectedRows: number }).affectedRows;
  if (claimRows !== 1) {
    res.status(410).json({ error: 'ALREADY_USED' }); return;
  }

  // Fetch file metadata
  const [fileRows] = await db.execute<RowDataPacket[]>(
    `SELECT storage_key, original_filename, mime_type FROM report_generated_file WHERE id = ?`,
    [tok.file_id]
  );
  if (!fileRows.length) {
    await db.execute(`UPDATE report_download_token SET download_status = 'EXPIRED' WHERE id = ?`, [tok.id]);
    res.status(410).json({ error: 'FILE_EXPIRED' }); return;
  }
  const file = fileRows[0] as { storage_key: string; original_filename: string; mime_type: string };
  const absPath = path.join(UPLOADS_ROOT, file.storage_key);

  if (!fs.existsSync(absPath)) {
    await db.execute(`UPDATE report_download_token SET download_status = 'EXPIRED' WHERE id = ?`, [tok.id]);
    res.status(410).json({ error: 'FILE_EXPIRED' }); return;
  }

  // Stream file to response
  const sanitisedName = file.original_filename.replace(/[^a-zA-Z0-9._\-]/g, '_');
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitisedName}"`);
  res.setHeader('Cache-Control', 'no-store, no-cache');

  const stream = fs.createReadStream(absPath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'STREAM_ERROR' });
  });
  stream.pipe(res);

  // Mark used only after response finishes (prevents marking used on partial/aborted downloads)
  res.on('finish', () => {
    db.execute(
      `UPDATE report_download_token SET download_status = 'USED', used_at = NOW() WHERE id = ?`,
      [tok.id]
    ).catch(() => {});
    recordReportAuditEvent({
      reportRequestId: tok.file_id,
      eventType: REPORT_AUDIT_EVENTS.SECURE_DOWNLOAD ?? 'SECURE_DOWNLOAD',
      actorType: 'user',
      reportCode: tok.report_code,
      fileId: tok.file_id,
      message: `Secure download completed`,
      metadataJson: { userId, ip: req.ip, reportCode: tok.report_code },
    }).catch(() => {});
  });
}));

export { router as reportingRouter };
