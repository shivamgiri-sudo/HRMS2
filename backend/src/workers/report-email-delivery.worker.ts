import fs from 'fs';
import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import { emailService } from '../modules/communication/email.service.js';
import { withWorkerLock, registerTimer, unregisterTimer } from './worker-utils.js';
import { resolveStoragePath } from '../modules/reporting/report-file-storage.js';
import { recordReportAuditEvent, REPORT_AUDIT_EVENTS } from '../modules/reporting/report-audit.service.js';

const WORKER_NAME = 'report-email-delivery';
const INTERVAL_MS = 30_000;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB

// Retry delays in minutes for each attempt number
const RETRY_DELAYS_MINUTES = [0, 5, 30, 120];

let intervalTimer: NodeJS.Timeout | null = null;

function isMissingReportTableError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && String((error as { code?: unknown }).code ?? '') === 'ER_NO_SUCH_TABLE';
}

async function reportEmailTablesAvailable(): Promise<boolean> {
  try {
    await db.execute<RowDataPacket[]>(`SELECT id FROM report_email_delivery LIMIT 1`);
    return true;
  } catch (error) {
    if (isMissingReportTableError(error)) {
      console.warn(`[${WORKER_NAME}] report_email_delivery table missing - worker disabled until reporting schema is migrated`);
      return false;
    }
    throw error;
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  return `${local[0]}***@${domain}`;
}

function buildEmailHtml(params: {
  employeeName: string;
  reportName: string;
  requestReference: string;
  requestedAt: string;
  generatedAt: string;
  filters: Record<string, unknown>;
  rowCount: number;
  retentionDays: number;
}): string {
  const filterLines = Object.entries(params.filters)
    .map(([k, v]) => `<tr><td style="padding:4px 12px;color:#666;">${k.toUpperCase()}</td><td style="padding:4px 12px;">${String(v ?? '—')}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>HRMS Report Ready</title></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#333;margin:0;padding:0;">
<div style="max-width:600px;margin:32px auto;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
  <div style="background:#1e3a5f;color:#fff;padding:20px 28px;">
    <h2 style="margin:0;font-size:18px;">HRMS Report Ready</h2>
    <p style="margin:4px 0 0;font-size:13px;opacity:.8;">MAS Callnet PeopleOS</p>
  </div>
  <div style="padding:24px 28px;">
    <p>Dear <strong>${params.employeeName}</strong>,</p>
    <p>Your requested HRMS report has been generated and is attached to this email.</p>

    <table style="border-collapse:collapse;width:100%;margin:16px 0;">
      <tr style="background:#f5f7fa;">
        <td style="padding:8px 12px;font-weight:bold;width:200px;">Report</td>
        <td style="padding:8px 12px;">${params.reportName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:bold;">Request Reference</td>
        <td style="padding:8px 12px;font-family:monospace;">${params.requestReference}</td>
      </tr>
      <tr style="background:#f5f7fa;">
        <td style="padding:8px 12px;font-weight:bold;">Requested At</td>
        <td style="padding:8px 12px;">${params.requestedAt}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:bold;">Generated At</td>
        <td style="padding:8px 12px;">${params.generatedAt}</td>
      </tr>
      <tr style="background:#f5f7fa;">
        <td style="padding:8px 12px;font-weight:bold;">Total Rows</td>
        <td style="padding:8px 12px;">${params.rowCount.toLocaleString()}</td>
      </tr>
      ${filterLines ? `<tr><td colspan="2" style="padding:8px 12px;font-weight:bold;background:#f0f4f9;">Filters Applied</td></tr>${filterLines}` : ''}
    </table>

    <div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;">
      <p style="margin:0;font-size:13px;">
        <strong>Confidentiality Notice:</strong> This report contains confidential company information.
        Please do not forward it outside authorised recipients.
        The attachment will be automatically deleted from our servers after <strong>${params.retentionDays} days</strong>.
      </p>
    </div>

    <p style="font-size:13px;color:#666;">
      If you did not request this report or believe this was sent in error, please contact the HR or IT team immediately.
    </p>
  </div>
  <div style="background:#f5f7fa;padding:16px 28px;font-size:12px;color:#888;border-top:1px solid #e0e0e0;">
    <p style="margin:0;">MAS Callnet HRMS Reporting System — This is an automated message. Do not reply to this email.</p>
  </div>
</div>
</body>
</html>`;
}

async function processOneDelivery(): Promise<void> {
  // Claim one QUEUED delivery row atomically
  const conn = await db.getConnection();
  let deliveryId: string | null = null;
  let requestId: string | null = null;

  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, report_request_id FROM report_email_delivery
       WHERE status = 'QUEUED'
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY queued_at ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (!rows.length) {
      await conn.rollback();
      return;
    }
    const row = rows[0] as { id: string; report_request_id: string };
    deliveryId = row.id;
    requestId = row.report_request_id;

    await conn.execute(
      `UPDATE report_email_delivery SET status = 'SENDING', sending_started_at = NOW() WHERE id = ?`,
      [deliveryId]
    );
    await conn.commit();
  } catch (err) {
    // Never let a failing rollback replace the real error, or skip the release below. A broken
    // connection is exactly when rollback throws, and exactly when the release matters most.
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    // Released HERE and nowhere else, so every path returns the connection exactly once.
    // The "no queued deliveries" branch above used to `return` without releasing -- and that is
    // the branch that runs on almost every poll, so the worker leaked one connection a minute
    // until the pool of 25 was entirely checked out and idle. From then on every query in the
    // whole workers process failed with "Queue limit reached", because all 45 workers share
    // this pool. Measured on production 2026-08-12: 26 connections held by the workers process,
    // 31 of 33 server-side connections asleep, the oldest idle for 7,967s -- almost exactly the
    // process uptime -- while MySQL itself was using 33 of 300 available connections.
    conn.release();
  }

  // Load all required data
  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT rr.report_name_snapshot, rr.official_email, rr.request_reference,
            rr.requested_at, rr.status AS req_status,
            rr.requested_filters_json, rr.requested_by_employee_name,
            rr.cancelled_at,
            rgf.id AS file_id, rgf.storage_key, rgf.sha256_checksum,
            rgf.original_filename, rgf.file_size_bytes, rgf.generated_row_count,
            rgf.generated_at, rgf.expires_at, rgf.deletion_status
     FROM report_request rr
     LEFT JOIN report_generated_file rgf ON rgf.report_request_id = rr.id
     WHERE rr.id = ?`,
    [requestId]
  );

  if (!reqRows.length) {
    await db.execute(
      `UPDATE report_email_delivery SET status = 'FAILED', failed_at = NOW(),
       failure_code = 'REQUEST_NOT_FOUND', failure_message = 'Report request record missing'
       WHERE id = ?`,
      [deliveryId]
    );
    return;
  }

  const req = reqRows[0] as {
    report_name_snapshot: string;
    official_email: string;
    request_reference: string;
    requested_at: string;
    req_status: string;
    requested_filters_json: string | Record<string, unknown>;
    requested_by_employee_name: string;
    cancelled_at: string | null;
    file_id: string | null;
    storage_key: string | null;
    sha256_checksum: string | null;
    original_filename: string | null;
    file_size_bytes: number | null;
    generated_row_count: number | null;
    generated_at: string | null;
    expires_at: string | null;
    deletion_status: string | null;
  };

  // Pre-flight checks
  if (req.cancelled_at || req.req_status === 'CANCELLED') {
    await db.execute(
      `UPDATE report_email_delivery SET status = 'CANCELLED', failed_at = NOW(),
       failure_code = 'REQUEST_CANCELLED', failure_message = 'Request was cancelled'
       WHERE id = ?`,
      [deliveryId]
    );
    return;
  }

  if (!req.file_id || !req.storage_key) {
    await markDeliveryFailed(deliveryId!, requestId!, 'FILE_NOT_FOUND', 'No generated file found for this request');
    return;
  }

  if (req.deletion_status === 'deleted') {
    await markDeliveryFailed(deliveryId!, requestId!, 'FILE_DELETED', 'The report file has already been deleted');
    return;
  }

  if (req.expires_at && new Date(req.expires_at) < new Date()) {
    await markDeliveryFailed(deliveryId!, requestId!, 'FILE_EXPIRED', 'The report file has expired');
    return;
  }

  const storagePath = resolveStoragePath(req.storage_key);
  if (!fs.existsSync(storagePath)) {
    await markDeliveryFailed(deliveryId!, requestId!, 'FILE_MISSING_ON_DISK', `File not found at storage path`);
    return;
  }

  if (req.file_size_bytes && req.file_size_bytes > MAX_ATTACHMENT_BYTES) {
    await markDeliveryFailed(deliveryId!, requestId!, 'ATTACHMENT_TOO_LARGE',
      `File size ${req.file_size_bytes} bytes exceeds limit ${MAX_ATTACHMENT_BYTES} bytes`);
    return;
  }

  const filters: Record<string, unknown> =
    typeof req.requested_filters_json === 'string'
      ? (JSON.parse(req.requested_filters_json) as Record<string, unknown>)
      : (req.requested_filters_json ?? {});

  const retentionDays = 7; // Default; could be read from report definition
  const emailSubject = `HRMS Report Ready: ${req.report_name_snapshot} — ${req.request_reference}`;

  const html = buildEmailHtml({
    employeeName: req.requested_by_employee_name ?? 'Employee',
    reportName: req.report_name_snapshot,
    requestReference: req.request_reference,
    requestedAt: req.requested_at ? String(req.requested_at) : '—',
    generatedAt: req.generated_at ? String(req.generated_at) : new Date().toISOString(),
    filters,
    rowCount: req.generated_row_count ?? 0,
    retentionDays,
  });

  await recordReportAuditEvent({
    reportRequestId: requestId!,
    eventType: REPORT_AUDIT_EVENTS.EMAIL_SEND_STARTED,
    actorType: 'worker',
    recipientEmail: req.official_email,
    deliveryId: deliveryId!,
    message: `Sending to ${maskEmail(req.official_email)}`,
  });

  try {
    if (!emailService.isConfigured()) {
      throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.');
    }

    const result = await emailService.send({
      to: req.official_email,
      subject: emailSubject,
      html,
      attachments: [{
        filename: req.original_filename ?? `${req.request_reference}.xlsx`,
        path: storagePath,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    });

    // Mark delivery sent
    await db.execute(
      `UPDATE report_email_delivery
       SET status = 'SENT', sent_at = NOW(), provider_message_id = ?, email_subject = ?
       WHERE id = ?`,
      [result.messageId ?? null, emailSubject, deliveryId]
    );

    // Mark request emailed
    await db.execute(
      `UPDATE report_request SET status = 'EMAILED', email_sent_at = NOW(), completed_at = NOW()
       WHERE id = ?`,
      [requestId]
    );

    await recordReportAuditEvent({
      reportRequestId: requestId!,
      eventType: REPORT_AUDIT_EVENTS.EMAIL_SENT,
      actorType: 'worker',
      recipientEmail: req.official_email,
      deliveryId: deliveryId!,
      message: `Email sent to ${maskEmail(req.official_email)}. MessageId: ${result.messageId ?? 'unknown'}`,
      metadataJson: { messageId: result.messageId },
    });

    await recordReportAuditEvent({
      reportRequestId: requestId!,
      eventType: REPORT_AUDIT_EVENTS.REQUEST_COMPLETED,
      actorType: 'worker',
      recipientEmail: req.official_email,
      message: `Request ${req.request_reference} completed successfully`,
    });

    console.log(`[${WORKER_NAME}] Delivered ${req.request_reference} to ${maskEmail(req.official_email)}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_NAME}] Delivery failed for ${deliveryId}:`, message);

    const [attemptRows] = await db.execute<RowDataPacket[]>(
      `SELECT delivery_attempt_number FROM report_email_delivery WHERE id = ?`,
      [deliveryId]
    );
    const attemptNumber = Number((attemptRows[0] as { delivery_attempt_number: number } | undefined)?.delivery_attempt_number ?? 1);
    const maxAttempts = RETRY_DELAYS_MINUTES.length;

    if (attemptNumber < maxAttempts) {
      const nextDelayMinutes = RETRY_DELAYS_MINUTES[attemptNumber] ?? 120;
      const nextRetryAt = new Date(Date.now() + nextDelayMinutes * 60 * 1000);
      await db.execute(
        `UPDATE report_email_delivery
         SET status = 'QUEUED', failed_at = NOW(), failure_code = 'SMTP_ERROR',
             failure_message = ?, next_retry_at = ?
         WHERE id = ?`,
        [message.slice(0, 500), nextRetryAt, deliveryId]
      );

      // Insert next attempt row
      const nextDeliveryId = (await import('crypto')).randomUUID();
      await db.execute(
        `INSERT INTO report_email_delivery
           (id, report_request_id, delivery_attempt_number, recipient_email,
            recipient_employee_id, recipient_employee_code, email_subject,
            attachment_filename, status, queued_at, next_retry_at)
         SELECT ?, report_request_id, ?, recipient_email,
                recipient_employee_id, recipient_employee_code, email_subject,
                attachment_filename, 'QUEUED', NOW(), ?
         FROM report_email_delivery WHERE id = ?`,
        [nextDeliveryId, attemptNumber + 1, nextRetryAt, deliveryId]
      );

      // Mark current attempt as failed
      await db.execute(
        `UPDATE report_email_delivery SET status = 'FAILED' WHERE id = ?`,
        [deliveryId]
      );

      await recordReportAuditEvent({
        reportRequestId: requestId!,
        eventType: REPORT_AUDIT_EVENTS.RETRY_SCHEDULED,
        actorType: 'worker',
        deliveryId: deliveryId!,
        message: `Delivery attempt ${attemptNumber} failed. Retry scheduled in ${nextDelayMinutes} minutes.`,
        errorCode: 'SMTP_ERROR',
        errorDetail: message.slice(0, 1000),
      });
    } else {
      await db.execute(
        `UPDATE report_email_delivery SET status = 'FAILED', failed_at = NOW(),
         failure_code = 'MAX_RETRIES_EXCEEDED', failure_message = ? WHERE id = ?`,
        [message.slice(0, 500), deliveryId]
      );
      await db.execute(
        `UPDATE report_request SET status = 'DELIVERY_FAILED', failed_at = NOW(),
         failure_stage = 'email_delivery', failure_code = 'MAX_RETRIES_EXCEEDED',
         failure_message = ? WHERE id = ?`,
        [message.slice(0, 500), requestId]
      );
      await recordReportAuditEvent({
        reportRequestId: requestId!,
        eventType: REPORT_AUDIT_EVENTS.EMAIL_FAILED,
        actorType: 'worker',
        deliveryId: deliveryId!,
        message: `All ${maxAttempts} delivery attempts exhausted.`,
        errorCode: 'MAX_RETRIES_EXCEEDED',
        errorDetail: message.slice(0, 1000),
      });
    }
  }
}

async function markDeliveryFailed(
  deliveryId: string,
  requestId: string,
  code: string,
  msg: string
): Promise<void> {
  await db.execute(
    `UPDATE report_email_delivery SET status = 'FAILED', failed_at = NOW(),
     failure_code = ?, failure_message = ? WHERE id = ?`,
    [code, msg, deliveryId]
  );
  await db.execute(
    `UPDATE report_request SET status = 'DELIVERY_FAILED', failed_at = NOW(),
     failure_stage = 'email_delivery', failure_code = ?, failure_message = ? WHERE id = ?`,
    [code, msg, requestId]
  );
  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.EMAIL_FAILED,
    actorType: 'worker',
    deliveryId,
    message: msg,
    errorCode: code,
  });
}

async function runDeliveryWorker(): Promise<void> {
  try {
    await withWorkerLock(WORKER_NAME, processOneDelivery);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_NAME}] Error:`, message);
  }
}

export async function startReportEmailDeliveryWorker(): Promise<void> {
  if (!(await reportEmailTablesAvailable())) {
    return;
  }
  console.log(`[${WORKER_NAME}] Starting (interval: ${INTERVAL_MS / 1000}s)`);
  void runDeliveryWorker();
  intervalTimer = setInterval(() => void runDeliveryWorker(), INTERVAL_MS);
  registerTimer(`${WORKER_NAME}-interval`, intervalTimer);
}

export function stopReportEmailDeliveryWorker(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    unregisterTimer(`${WORKER_NAME}-interval`);
    intervalTimer = null;
  }
  console.log(`[${WORKER_NAME}] stopped`);
}
