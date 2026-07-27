import * as XLSX from 'xlsx';
import type { RowDataPacket } from 'mysql2';
import { randomUUID } from 'crypto';
import { db } from '../db/mysql.js';
import { withWorkerLock, registerTimer, unregisterTimer } from './worker-utils.js';
import { executeReportForWorker } from '../modules/reporting/report-worker-executor.js';
import { storeReportFile } from '../modules/reporting/report-file-storage.js';
import { recordReportAuditEvent, REPORT_AUDIT_EVENTS } from '../modules/reporting/report-audit.service.js';
import type { ResolvedScope } from '../modules/reporting/report-worker-executor.js';

const WORKER_NAME = 'report-generation';
const INTERVAL_MS = 30_000;
const STALE_PROCESSING_MINUTES = 10;
const DEFAULT_RETENTION_DAYS = 7;
const SENSITIVE_RETENTION_DAYS = 2;
const SENSITIVE_CATEGORY_KEYWORDS = ['payroll', 'statutory', 'salary'];

let intervalTimer: NodeJS.Timeout | null = null;

function getRetentionDays(reportCode: string): number {
  const lower = reportCode.toLowerCase();
  return SENSITIVE_CATEGORY_KEYWORDS.some(k => lower.includes(k))
    ? SENSITIVE_RETENTION_DAYS
    : DEFAULT_RETENTION_DAYS;
}

function buildXlsx(
  reportName: string,
  requestReference: string,
  rows: Record<string, unknown>[],
  filters: Record<string, unknown>,
  scope: ResolvedScope,
  requesterCode: string
): Buffer {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: REPORT DATA ──────────────────────────────────────────────────
  if (rows.length > 0) {
    // Uppercase all header keys
    const upperRows = rows.map(r => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        out[k.toUpperCase()] = v;
      }
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(upperRows);

    // Column widths: 18 chars default
    const headers = Object.keys(upperRows[0] ?? {});
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length, 18) }));

    // Freeze first row
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };

    XLSX.utils.book_append_sheet(wb, ws, 'REPORT DATA');
  } else {
    const ws = XLSX.utils.aoa_to_sheet([['NO DATA RETURNED FOR THE SELECTED FILTERS']]);
    XLSX.utils.book_append_sheet(wb, ws, 'REPORT DATA');
  }

  // ── Sheet 2: REPORT METADATA ─────────────────────────────────────────────
  const now = new Date().toISOString();
  const metaRows = [
    ['FIELD', 'VALUE'],
    ['REPORT NAME', reportName],
    ['REQUEST REFERENCE', requestReference],
    ['REQUESTER EMPLOYEE CODE', requesterCode],
    ['GENERATED AT (UTC)', now],
    ['ROW COUNT', rows.length],
    ['CONFIDENTIALITY', 'CONFIDENTIAL — DO NOT FORWARD OUTSIDE AUTHORISED RECIPIENTS'],
  ];
  const filterEntries = Object.entries(filters);
  if (filterEntries.length > 0) {
    metaRows.push(['', '']);
    metaRows.push(['FILTERS APPLIED', '']);
    for (const [k, v] of filterEntries) {
      metaRows.push([k.toUpperCase(), String(v ?? '')]);
    }
  }
  metaRows.push(['', '']);
  metaRows.push(['DATA SCOPE', scope.isSuperAdmin ? 'ALL BRANCHES' : `BRANCHES: ${scope.branchIds.join(', ') || 'ALL'}`]);

  const metaWs = XLSX.utils.aoa_to_sheet(metaRows);
  metaWs['!cols'] = [{ wch: 35 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, metaWs, 'REPORT METADATA');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function buildReportFilename(reportCode: string, requestReference: string): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const code = reportCode.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return `${code}_${requestReference}_${dateStr}.xlsx`;
}

async function processOneRequest(): Promise<void> {
  // Claim one QUEUED request atomically
  const conn = await db.getConnection();
  let requestId: string | null = null;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM report_request
       WHERE status = 'QUEUED'
       ORDER BY priority DESC, requested_at ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (!rows.length) {
      await conn.rollback();
      return;
    }

    requestId = (rows[0] as { id: string }).id;
    await conn.execute(
      `UPDATE report_request SET status = 'PROCESSING', processing_started_at = NOW() WHERE id = ?`,
      [requestId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
  conn.release();

  // Load request details
  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT report_code, report_name_snapshot, requested_by_employee_code,
            requested_by_employee_name, official_email, requested_filters_json,
            resolved_scope_json, request_reference, requested_by_user_id,
            requested_by_employee_id, requester_role_snapshot, correlation_id
     FROM report_request WHERE id = ?`,
    [requestId]
  );

  if (!reqRows.length) return;

  const req = reqRows[0] as {
    report_code: string;
    report_name_snapshot: string;
    requested_by_employee_code: string;
    requested_by_employee_name: string;
    official_email: string;
    requested_filters_json: string | Record<string, unknown>;
    resolved_scope_json: string | ResolvedScope;
    request_reference: string;
    requested_by_user_id: string;
    requested_by_employee_id: string;
    requester_role_snapshot: string;
    correlation_id: string;
  };

  const filters: Record<string, unknown> =
    typeof req.requested_filters_json === 'string'
      ? (JSON.parse(req.requested_filters_json) as Record<string, unknown>)
      : (req.requested_filters_json ?? {});

  const scope: ResolvedScope =
    typeof req.resolved_scope_json === 'string'
      ? (JSON.parse(req.resolved_scope_json) as ResolvedScope)
      : (req.resolved_scope_json ?? { isSuperAdmin: false, branchIds: [] });

  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.GENERATION_STARTED,
    actorType: 'worker',
    reportCode: req.report_code,
    reportName: req.report_name_snapshot,
    correlationId: req.correlation_id,
    message: `Generation started for ${req.request_reference}`,
  });

  try {
    // Execute report query
    const { rows, rowCount } = await executeReportForWorker(req.report_code, filters, scope);

    await recordReportAuditEvent({
      reportRequestId: requestId,
      eventType: REPORT_AUDIT_EVENTS.SOURCE_QUERY_COMPLETED,
      actorType: 'worker',
      reportCode: req.report_code,
      correlationId: req.correlation_id,
      message: `Query returned ${rowCount} rows`,
      metadataJson: { rowCount },
    });

    // Build XLSX
    const buffer = buildXlsx(
      req.report_name_snapshot,
      req.request_reference,
      rows,
      filters,
      scope,
      req.requested_by_employee_code ?? 'UNKNOWN'
    );
    const filename = buildReportFilename(req.report_code, req.request_reference);
    const retentionDays = getRetentionDays(req.report_code);

    // Store file
    const stored = await storeReportFile({
      requestId,
      buffer,
      filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      rowCount,
      colCount: rows.length > 0 ? Object.keys(rows[0]).length : 0,
      retentionDays,
    });

    await recordReportAuditEvent({
      reportRequestId: requestId,
      eventType: REPORT_AUDIT_EVENTS.FILE_STORED,
      actorType: 'worker',
      reportCode: req.report_code,
      fileId: stored.fileId,
      correlationId: req.correlation_id,
      message: `File stored: ${filename} (${buffer.length} bytes, sha256: ${stored.sha256.slice(0, 16)}...)`,
      metadataJson: { fileId: stored.fileId, fileSizeBytes: buffer.length, rowCount },
    });

    // Create email delivery row
    const deliveryId = randomUUID();
    const emailSubject = `HRMS Report Ready: ${req.report_name_snapshot} — ${req.request_reference}`;
    await db.execute(
      `INSERT INTO report_email_delivery
         (id, report_request_id, delivery_attempt_number, recipient_email,
          recipient_employee_id, recipient_employee_code, email_subject,
          attachment_filename, attachment_size_bytes, status, queued_at)
       VALUES (?,?,1,?, ?,?,?, ?,?,'QUEUED',NOW())`,
      [
        deliveryId,
        requestId,
        req.official_email,
        req.requested_by_employee_id ?? null,
        req.requested_by_employee_code ?? null,
        emailSubject,
        filename,
        buffer.length,
      ]
    );

    // Update request status
    await db.execute(
      `UPDATE report_request
       SET status = 'GENERATED', generation_completed_at = NOW(), email_queued_at = NOW()
       WHERE id = ?`,
      [requestId]
    );

    await recordReportAuditEvent({
      reportRequestId: requestId,
      eventType: REPORT_AUDIT_EVENTS.GENERATION_COMPLETED,
      actorType: 'worker',
      reportCode: req.report_code,
      fileId: stored.fileId,
      deliveryId,
      correlationId: req.correlation_id,
      message: `Generation complete. ${rowCount} rows. Email delivery queued.`,
      metadataJson: { rowCount, fileSizeBytes: buffer.length, deliveryId },
    });

    await recordReportAuditEvent({
      reportRequestId: requestId,
      eventType: REPORT_AUDIT_EVENTS.EMAIL_QUEUED,
      actorType: 'worker',
      reportCode: req.report_code,
      deliveryId,
      correlationId: req.correlation_id,
      message: `Email delivery queued: ${req.official_email}`,
    });

    console.log(`[${WORKER_NAME}] Generated ${req.request_reference} — ${rowCount} rows, ${buffer.length} bytes`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_NAME}] Generation failed for ${requestId}:`, message);

    // Check retry eligibility
    const [retryRows] = await db.execute<RowDataPacket[]>(
      `SELECT retry_count FROM report_request WHERE id = ?`,
      [requestId]
    );
    const retryCount = Number((retryRows[0] as { retry_count: number } | undefined)?.retry_count ?? 0);
    const maxRetries = 3;

    if (retryCount < maxRetries) {
      await db.execute(
        `UPDATE report_request
         SET status = 'QUEUED', retry_count = retry_count + 1, last_retry_at = NOW(),
             failure_stage = 'generation', failure_message = ?
         WHERE id = ?`,
        [message.slice(0, 500), requestId]
      );
      await recordReportAuditEvent({
        reportRequestId: requestId,
        eventType: REPORT_AUDIT_EVENTS.RETRY_SCHEDULED,
        actorType: 'worker',
        message: `Generation failed (attempt ${retryCount + 1}/${maxRetries}). Requeued.`,
        errorCode: 'GENERATION_ERROR',
        errorDetail: message.slice(0, 1000),
      });
    } else {
      await db.execute(
        `UPDATE report_request
         SET status = 'GENERATION_FAILED', failed_at = NOW(),
             failure_stage = 'generation', failure_code = 'MAX_RETRIES_EXCEEDED',
             failure_message = ?
         WHERE id = ?`,
        [message.slice(0, 500), requestId]
      );
      await recordReportAuditEvent({
        reportRequestId: requestId,
        eventType: REPORT_AUDIT_EVENTS.GENERATION_FAILED,
        actorType: 'worker',
        message: `Generation permanently failed after ${maxRetries} attempts`,
        errorCode: 'MAX_RETRIES_EXCEEDED',
        errorDetail: message.slice(0, 1000),
      });
    }
  }
}

async function runGenerationWorker(): Promise<void> {
  try {
    await withWorkerLock(WORKER_NAME, processOneRequest);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_NAME}] Error:`, message);
  }
}

export async function startReportGenerationWorker(): Promise<void> {
  console.log(`[${WORKER_NAME}] Starting (interval: ${INTERVAL_MS / 1000}s)`);
  // Run immediately on start
  void runGenerationWorker();
  intervalTimer = setInterval(() => void runGenerationWorker(), INTERVAL_MS);
  registerTimer(`${WORKER_NAME}-interval`, intervalTimer);
}

export function stopReportGenerationWorker(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    unregisterTimer(`${WORKER_NAME}-interval`);
    intervalTimer = null;
  }
  console.log(`[${WORKER_NAME}] stopped`);
}
