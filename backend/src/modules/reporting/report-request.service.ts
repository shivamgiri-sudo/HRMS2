import { createHash, randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { REPORT_CATALOG } from './report-catalog.js';
import {
  resolveRegisteredOfficialEmail,
  maskEmail,
  ReportEmailResolutionError,
} from './report-email-resolver.js';
import { resolveBranchScope } from './reporting.scope.js';
import { generateRequestReference } from './report-request-ref.js';
import {
  recordReportAuditEvent,
  REPORT_AUDIT_EVENTS,
} from './report-audit.service.js';
import { ensureReportingSchemaAvailable } from './report-schema-availability.js';

const MAX_REQUESTS_PER_HOUR = 5;
const DUPLICATE_WINDOW_MINUTES = 30;
const DEFAULT_RETENTION_DAYS = 7;
const SENSITIVE_RETENTION_DAYS = 2;

const SENSITIVE_CATEGORIES = ['payroll', 'statutory', 'hr_sensitive'];

function getRetentionDays(reportCode: string): number {
  const def = REPORT_CATALOG.find(r => r.code === reportCode);
  if (!def) return DEFAULT_RETENTION_DAYS;
  if (SENSITIVE_CATEGORIES.some(c => def.category?.toLowerCase().includes(c))) {
    return SENSITIVE_RETENTION_DAYS;
  }
  return DEFAULT_RETENTION_DAYS;
}

function dedupeKey(userId: string, reportCode: string, filters: Record<string, unknown>): string {
  const sorted = Object.keys(filters).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = filters[k];
    return acc;
  }, {});
  return createHash('sha256')
    .update(`${userId}:${reportCode}:${JSON.stringify(sorted)}`)
    .digest('hex');
}

export interface CreateReportRequestResult {
  requestReference: string;
  requestId: string;
  status: string;
  recipientEmailMasked: string;
  isDuplicate: boolean;
  message: string;
}

export interface PreviewRequestResult {
  reportName: string;
  reportCode: string;
  reportCategory: string;
  description: string;
  selectedFilters: Record<string, unknown>;
  resolvedScope: {
    isSuperAdmin: boolean;
    branchIds: string[];
  };
  officialEmailMasked: string;
  retentionDays: number;
  outputFormat: string;
  sensitivityWarning: string;
}

export async function previewReportRequest(
  userId: string,
  reportCode: string,
  filters: Record<string, unknown>
): Promise<PreviewRequestResult> {
  await ensureReportingSchemaAvailable();
  const def = REPORT_CATALOG.find(r => r.code === reportCode);
  if (!def) throw Object.assign(new Error(`Report '${reportCode}' not found`), { statusCode: 404 });

  const emailResolution = await resolveRegisteredOfficialEmail(userId);
  const scope = await resolveBranchScope(userId);

  const isSensitive = SENSITIVE_CATEGORIES.some(c => def.category?.toLowerCase().includes(c));

  return {
    reportName: def.name,
    reportCode: def.code,
    reportCategory: def.category,
    description: def.description,
    selectedFilters: filters,
    resolvedScope: scope,
    officialEmailMasked: maskEmail(emailResolution.officialEmail),
    retentionDays: getRetentionDays(reportCode),
    outputFormat: 'xlsx',
    sensitivityWarning: isSensitive
      ? 'This report contains sensitive HR or payroll data. The attachment will be deleted from our servers after 2 days.'
      : 'The report attachment will be deleted from our servers after 7 days.',
  };
}

export async function createReportRequest(
  userId: string,
  reportCode: string,
  filters: Record<string, unknown>,
  meta: { ip: string; userAgent: string; correlationId?: string }
): Promise<CreateReportRequestResult> {
  await ensureReportingSchemaAvailable();
  // 1. Validate report exists in catalog
  const def = REPORT_CATALOG.find(r => r.code === reportCode);
  if (!def) {
    throw Object.assign(new Error(`Report '${reportCode}' not found in catalog`), { statusCode: 404 });
  }

  // 2. Rate limit check
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM report_request
     WHERE requested_by_user_id = ?
       AND requested_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
       AND status NOT IN ('CANCELLED', 'REJECTED')`,
    [userId]
  );
  const requestCount = Number((countRows[0] as { cnt: number }).cnt);
  if (requestCount >= MAX_REQUESTS_PER_HOUR) {
    await recordReportAuditEvent({
      eventType: REPORT_AUDIT_EVENTS.REQUEST_REJECTED,
      actorUserId: userId,
      reportCode,
      reportName: def.name,
      ipAddress: meta.ip,
      message: `Rate limit exceeded: ${requestCount} requests in last hour`,
      errorCode: 'RATE_LIMIT_EXCEEDED',
    });
    throw Object.assign(
      new Error(`You have reached the maximum of ${MAX_REQUESTS_PER_HOUR} report requests per hour. Please try again later.`),
      { statusCode: 429 }
    );
  }

  // 3. Resolve official email — fail loudly if not configured
  let emailResolution;
  try {
    emailResolution = await resolveRegisteredOfficialEmail(userId);
  } catch (err) {
    const code = err instanceof ReportEmailResolutionError ? err.code : 'UNKNOWN';
    await recordReportAuditEvent({
      eventType: REPORT_AUDIT_EVENTS.EMAIL_RESOLUTION_FAILED,
      actorUserId: userId,
      reportCode,
      reportName: def.name,
      ipAddress: meta.ip,
      message: err instanceof Error ? err.message : String(err),
      errorCode: code,
    });
    throw err;
  }

  // 4. Resolve scope snapshot (stored at request time, immutable after)
  const scope = await resolveBranchScope(userId);

  // 5. Get requester role
  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [userId]
  );
  const requesterRole = (roleRows[0] as { role_key?: string } | undefined)?.role_key ?? 'employee';

  // 6. Duplicate detection
  const inputHash = dedupeKey(userId, reportCode, filters);
  const [dupRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, request_reference, status FROM report_request
     WHERE requested_by_user_id = ?
       AND report_code = ?
       AND requested_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
       AND status NOT IN ('CANCELLED', 'REJECTED', 'GENERATION_FAILED', 'DELIVERY_FAILED', 'EXPIRED')
     ORDER BY requested_at DESC LIMIT 1`,
    [userId, reportCode, DUPLICATE_WINDOW_MINUTES]
  );
  if (dupRows.length > 0) {
    const dup = dupRows[0] as { id: string; request_reference: string; status: string };
    await recordReportAuditEvent({
      reportRequestId: dup.id,
      eventType: REPORT_AUDIT_EVENTS.DUPLICATE_DETECTED,
      actorUserId: userId,
      actorEmployeeId: emailResolution.employeeId,
      actorEmployeeCode: emailResolution.employeeCode,
      actorName: emailResolution.employeeName,
      actorRole: requesterRole,
      reportCode,
      reportName: def.name,
      recipientEmail: emailResolution.officialEmail,
      ipAddress: meta.ip,
      message: `Duplicate request detected within ${DUPLICATE_WINDOW_MINUTES} minutes`,
      metadataJson: { inputHash },
    });
    return {
      requestReference: dup.request_reference,
      requestId: dup.id,
      status: dup.status,
      recipientEmailMasked: maskEmail(emailResolution.officialEmail),
      isDuplicate: true,
      message: `An identical report request (${dup.request_reference}) is already in progress. Your report will be sent to your official email once ready.`,
    };
  }

  // 7. Generate IDs and reference
  const requestId = randomUUID();
  const correlationId = meta.correlationId ?? randomUUID();
  const requestReference = await generateRequestReference();
  const retentionDays = getRetentionDays(reportCode);
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

  // 8. Insert report_request row
  await db.execute(
    `INSERT INTO report_request (
       id, request_reference, report_code, report_name_snapshot,
       requested_by_user_id, requested_by_employee_id, requested_by_employee_code,
       requested_by_employee_name, requester_role_snapshot,
       official_email, official_email_source, official_email_verified,
       requested_filters_json, resolved_scope_json,
       requested_format, request_source, request_ip, request_user_agent,
       correlation_id, status, requested_at, queued_at, expires_at
     ) VALUES (?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?, ?,?,?,?, ?,?,NOW(),NOW(),?)`,
    [
      requestId,
      requestReference,
      reportCode,
      def.name,
      userId,
      emailResolution.employeeId,
      emailResolution.employeeCode,
      emailResolution.employeeName,
      requesterRole,
      emailResolution.officialEmail,
      `${emailResolution.sourceTable}.${emailResolution.sourceColumn}`,
      emailResolution.verified ? 1 : 0,
      JSON.stringify(filters),
      JSON.stringify(scope),
      'xlsx',
      'portal',
      meta.ip,
      meta.userAgent ? String(meta.userAgent).slice(0, 512) : null,
      correlationId,
      'QUEUED',
      expiresAt,
    ]
  );

  // 9. Audit events
  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.REQUEST_SUBMITTED,
    actorUserId: userId,
    actorEmployeeId: emailResolution.employeeId,
    actorEmployeeCode: emailResolution.employeeCode,
    actorName: emailResolution.employeeName,
    actorRole: requesterRole,
    reportCode,
    reportName: def.name,
    recipientEmail: emailResolution.officialEmail,
    filtersSnapshotJson: filters,
    scopeSnapshotJson: scope,
    correlationId,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
    message: `Report request submitted: ${requestReference}`,
  });
  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.REQUEST_QUEUED,
    actorType: 'system',
    reportCode,
    reportName: def.name,
    correlationId,
    message: `Request ${requestReference} queued for generation`,
  });

  return {
    requestReference,
    requestId,
    status: 'QUEUED',
    recipientEmailMasked: maskEmail(emailResolution.officialEmail),
    isDuplicate: false,
    message: `Your report request has been queued and will be sent to your registered official email.`,
  };
}

export interface MyRequestRow {
  id: string;
  requestReference: string;
  reportCode: string;
  reportName: string;
  requestedFilters: Record<string, unknown>;
  officialEmailMasked: string;
  status: string;
  requestedAt: string;
  generationCompletedAt: string | null;
  emailSentAt: string | null;
  failureMessage: string | null;
}

export async function getMyReportRequests(
  userId: string,
  page = 1,
  pageSize = 20
): Promise<{ rows: MyRequestRow[]; total: number }> {
  await ensureReportingSchemaAvailable();
  // Ensure page/pageSize are valid integers — NaN from query params causes ER_WRONG_ARGUMENTS
  const safePage = Math.max(1, Math.floor(Number.isFinite(page) ? page : 1));
  const safePageSize = Math.max(1, Math.min(Math.floor(Number.isFinite(pageSize) ? pageSize : 20), 200));
  const offset = (safePage - 1) * safePageSize;
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM report_request WHERE requested_by_user_id = ?`,
    [userId]
  );
  const total = parseInt(String((countRows[0] as { total: unknown }).total ?? 0), 10);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, request_reference, report_code, report_name_snapshot,
            requested_filters_json, official_email, status,
            requested_at, generation_completed_at, email_sent_at, failure_message
     FROM report_request
     WHERE requested_by_user_id = ?
     ORDER BY requested_at DESC
     LIMIT ? OFFSET ?`,
    [userId, parseInt(String(safePageSize), 10), parseInt(String(offset), 10)]
  );

  return {
    total,
    rows: (rows as Array<Record<string, unknown>>).map(r => ({
      id: String(r.id),
      requestReference: String(r.request_reference),
      reportCode: String(r.report_code),
      reportName: String(r.report_name_snapshot),
      requestedFilters: r.requested_filters_json
        ? (typeof r.requested_filters_json === 'string'
            ? JSON.parse(r.requested_filters_json)
            : r.requested_filters_json) as Record<string, unknown>
        : {},
      officialEmailMasked: maskEmail(String(r.official_email)),
      status: String(r.status),
      requestedAt: String(r.requested_at),
      generationCompletedAt: r.generation_completed_at ? String(r.generation_completed_at) : null,
      emailSentAt: r.email_sent_at ? String(r.email_sent_at) : null,
      failureMessage: r.failure_message ? String(r.failure_message) : null,
    })),
  };
}

export async function getMyReportRequestDetail(
  userId: string,
  requestId: string
): Promise<Record<string, unknown>> {
  await ensureReportingSchemaAvailable();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rr.*, rgf.file_size_bytes, rgf.generated_row_count, rgf.expires_at AS file_expires_at,
            rgf.deletion_status
     FROM report_request rr
     LEFT JOIN report_generated_file rgf ON rgf.report_request_id = rr.id
     WHERE rr.id = ? AND rr.requested_by_user_id = ?`,
    [requestId, userId]
  );

  if (!rows.length) {
    throw Object.assign(new Error('Report request not found'), { statusCode: 404 });
  }

  const row = rows[0] as Record<string, unknown>;
  // Never return file storage paths or raw sensitive data
  return {
    id: row.id,
    requestReference: row.request_reference,
    reportCode: row.report_code,
    reportName: row.report_name_snapshot,
    requestedFilters: row.requested_filters_json,
    officialEmailMasked: maskEmail(String(row.official_email)),
    status: row.status,
    priority: row.priority,
    requestedAt: row.requested_at,
    queuedAt: row.queued_at,
    processingStartedAt: row.processing_started_at,
    generationCompletedAt: row.generation_completed_at,
    emailSentAt: row.email_sent_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    cancelledAt: row.cancelled_at,
    failureStage: row.failure_stage,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    retryCount: row.retry_count,
    fileSizeBytes: row.file_size_bytes,
    generatedRowCount: row.generated_row_count,
    fileExpiresAt: row.file_expires_at,
    fileDeletionStatus: row.deletion_status,
  };
}

export async function cancelReportRequest(userId: string, requestId: string): Promise<void> {
  await ensureReportingSchemaAvailable();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM report_request WHERE id = ? AND requested_by_user_id = ?`,
    [requestId, userId]
  );
  if (!rows.length) {
    throw Object.assign(new Error('Report request not found'), { statusCode: 404 });
  }

  const row = rows[0] as { id: string; status: string };
  if (!['REQUESTED', 'QUEUED'].includes(row.status)) {
    throw Object.assign(
      new Error(`Cannot cancel a request in status '${row.status}'. Only QUEUED requests can be cancelled.`),
      { statusCode: 409 }
    );
  }

  await db.execute(
    `UPDATE report_request SET status = 'CANCELLED', cancelled_at = NOW() WHERE id = ?`,
    [requestId]
  );
  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.REQUEST_CANCELLED,
    actorUserId: userId,
    message: 'Request cancelled by user',
  });
}

export interface AdminRequestFilter {
  requestReference?: string;
  reportCode?: string;
  employeeCode?: string;
  employeeName?: string;
  officialEmail?: string;
  status?: string;
  failureStage?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export async function adminListReportRequests(f: AdminRequestFilter): Promise<{
  rows: Record<string, unknown>[];
  total: number;
}> {
  await ensureReportingSchemaAvailable();
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (f.requestReference) { conditions.push('rr.request_reference LIKE ?'); params.push(`%${f.requestReference}%`); }
  if (f.reportCode)        { conditions.push('rr.report_code = ?');          params.push(f.reportCode); }
  if (f.employeeCode)      { conditions.push('rr.requested_by_employee_code LIKE ?'); params.push(`%${f.employeeCode}%`); }
  if (f.employeeName)      { conditions.push('rr.requested_by_employee_name LIKE ?'); params.push(`%${f.employeeName}%`); }
  if (f.officialEmail)     { conditions.push('rr.official_email LIKE ?');     params.push(`%${f.officialEmail}%`); }
  if (f.status)            { conditions.push('rr.status = ?');                params.push(f.status); }
  if (f.failureStage)      { conditions.push('rr.failure_stage = ?');         params.push(f.failureStage); }
  if (f.fromDate)          { conditions.push('rr.requested_at >= ?');         params.push(f.fromDate); }
  if (f.toDate)            { conditions.push('rr.requested_at <= ?');         params.push(f.toDate + ' 23:59:59'); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM report_request rr ${where}`,
    params
  );
  const total = Number((countRows[0] as { total: number }).total);

  // Try full query with all columns; fall back to minimal set if prod schema is older
  let rows: RowDataPacket[];
  try {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT rr.id, rr.request_reference, rr.report_code, rr.report_name_snapshot,
              rr.requested_by_employee_code, rr.requested_by_employee_name,
              rr.requester_role_snapshot, rr.official_email, rr.status,
              rr.requested_at, rr.processing_started_at, rr.generation_completed_at,
              rr.email_sent_at, rr.completed_at, rr.failed_at,
              rr.failure_stage, rr.failure_code, rr.failure_message,
              rr.retry_count, rr.requested_filters_json,
              rgf.file_size_bytes, rgf.generated_row_count, rgf.sha256_checksum,
              rgf.expires_at AS file_expires_at, rgf.deletion_status
       FROM report_request rr
       LEFT JOIN report_generated_file rgf ON rgf.report_request_id = rr.id
       ${where}
       ORDER BY rr.requested_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    rows = r;
  } catch {
    // Older prod schema missing some columns — fall back to safe minimal query
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT rr.id, rr.request_reference, rr.report_code, rr.report_name_snapshot,
              rr.requested_by_employee_code, rr.requested_by_employee_name,
              rr.official_email, rr.status,
              rr.requested_at, rr.generation_completed_at, rr.failed_at,
              rr.failure_message, rr.requested_filters_json
       FROM report_request rr
       ${where}
       ORDER BY rr.requested_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    rows = r;
  }

  return { total, rows: rows as Record<string, unknown>[] };
}

export async function adminGetReportRequestDetail(requestId: string): Promise<Record<string, unknown>> {
  await ensureReportingSchemaAvailable();
  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT rr.*, rgf.storage_key, rgf.file_size_bytes, rgf.generated_row_count,
            rgf.sha256_checksum, rgf.expires_at AS file_expires_at,
            rgf.deletion_status, rgf.generated_at
     FROM report_request rr
     LEFT JOIN report_generated_file rgf ON rgf.report_request_id = rr.id
     WHERE rr.id = ?`,
    [requestId]
  );
  if (!reqRows.length) {
    throw Object.assign(new Error('Report request not found'), { statusCode: 404 });
  }

  const [deliveryRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, delivery_attempt_number, recipient_email, email_subject,
            email_provider, provider_message_id, attachment_filename, attachment_size_bytes,
            status, queued_at, sending_started_at, sent_at, delivered_at, bounced_at, failed_at,
            failure_code, failure_message, next_retry_at
     FROM report_email_delivery
     WHERE report_request_id = ?
     ORDER BY delivery_attempt_number ASC`,
    [requestId]
  );

  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, event_type, event_status, activity_at, actor_type, actor_employee_code,
            actor_name, actor_role, message, error_code, error_detail
     FROM report_audit_event
     WHERE report_request_id = ?
     ORDER BY id ASC`,
    [requestId]
  );

  const req = reqRows[0] as Record<string, unknown>;
  // storage_key intentionally omitted from admin response — not needed for UI
  return {
    ...req,
    storage_key: undefined,
    deliveryAttempts: deliveryRows,
    auditTimeline: auditRows,
  };
}

export async function adminRetryEmailDelivery(
  requestId: string,
  actorUserId: string,
  reason: string
): Promise<void> {
  await ensureReportingSchemaAvailable();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM report_request WHERE id = ?`,
    [requestId]
  );
  if (!rows.length) {
    throw Object.assign(new Error('Report request not found'), { statusCode: 404 });
  }

  const req = rows[0] as { id: string; status: string };
  if (!['DELIVERY_FAILED', 'GENERATED'].includes(req.status)) {
    throw Object.assign(
      new Error(`Cannot retry request in status '${req.status}'. Only DELIVERY_FAILED or GENERATED requests can be retried.`),
      { statusCode: 409 }
    );
  }

  // Check file not expired
  const [fileRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, expires_at, deletion_status FROM report_generated_file WHERE report_request_id = ?`,
    [requestId]
  );
  if (!fileRows.length) {
    throw Object.assign(new Error('No generated file found for this request'), { statusCode: 409 });
  }
  const file = fileRows[0] as { id: string; expires_at: string; deletion_status: string | null };
  if (file.deletion_status === 'deleted' || new Date(file.expires_at) < new Date()) {
    throw Object.assign(new Error('The generated report file has expired and cannot be re-delivered. Please submit a new report request.'), { statusCode: 409 });
  }

  // Insert a new delivery attempt
  const deliveryId = randomUUID();
  const [prevRows] = await db.execute<RowDataPacket[]>(
    `SELECT MAX(delivery_attempt_number) AS max_attempt FROM report_email_delivery WHERE report_request_id = ?`,
    [requestId]
  );
  const nextAttempt = Number((prevRows[0] as { max_attempt: number | null }).max_attempt ?? 0) + 1;

  await db.execute(
    `INSERT INTO report_email_delivery (id, report_request_id, delivery_attempt_number, status, queued_at)
     SELECT ?, ?, ?, 'QUEUED', NOW() FROM report_request WHERE id = ?`,
    [deliveryId, requestId, nextAttempt, requestId]
  );
  await db.execute(
    `UPDATE report_request SET status = 'GENERATED', retry_count = retry_count + 1, last_retry_at = NOW()
     WHERE id = ?`,
    [requestId]
  );

  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.SUPER_ADMIN_RETRIED,
    actorType: 'admin',
    actorUserId,
    deliveryId,
    message: `Admin retry initiated. Reason: ${reason}`,
    metadataJson: { reason, nextAttempt },
  });
}
