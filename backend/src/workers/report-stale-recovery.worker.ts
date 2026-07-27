import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import { withWorkerLock, registerTimer, unregisterTimer } from './worker-utils.js';
import { deleteReportFile } from '../modules/reporting/report-file-storage.js';
import { recordReportAuditEvent, REPORT_AUDIT_EVENTS } from '../modules/reporting/report-audit.service.js';

const WORKER_NAME = 'report-stale-recovery';
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const STALE_PROCESSING_MINUTES = 10;
const STALE_SENDING_MINUTES = 5;

let intervalTimer: NodeJS.Timeout | null = null;

function isMissingReportTableError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && String((error as { code?: unknown }).code ?? '') === 'ER_NO_SUCH_TABLE';
}

async function reportRecoveryTablesAvailable(): Promise<boolean> {
  try {
    await db.execute<RowDataPacket[]>(`SELECT id FROM report_request LIMIT 1`);
    return true;
  } catch (error) {
    if (isMissingReportTableError(error)) {
      console.warn(`[${WORKER_NAME}] reporting tables missing - worker disabled until reporting schema is migrated`);
      return false;
    }
    throw error;
  }
}

async function runRecovery(): Promise<void> {
  let recoveredCount = 0;
  let expiredCount = 0;

  // 1. Reset stuck PROCESSING requests
  const [staleProc] = await db.execute<RowDataPacket[]>(
    `SELECT id, request_reference, retry_count FROM report_request
     WHERE status = 'PROCESSING'
       AND processing_started_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [STALE_PROCESSING_MINUTES]
  );

  for (const row of staleProc as Array<{ id: string; request_reference: string; retry_count: number }>) {
    const maxRetries = 3;
    if (row.retry_count < maxRetries) {
      await db.execute(
        `UPDATE report_request
         SET status = 'QUEUED', retry_count = retry_count + 1, last_retry_at = NOW(),
             failure_stage = 'stale_recovery', failure_message = 'Recovered from stale PROCESSING state'
         WHERE id = ?`,
        [row.id]
      );
      await recordReportAuditEvent({
        reportRequestId: row.id,
        eventType: REPORT_AUDIT_EVENTS.STALE_JOB_RECOVERED,
        actorType: 'system',
        message: `Stale PROCESSING request ${row.request_reference} reset to QUEUED`,
        metadataJson: { reason: 'stale_processing', retryCount: row.retry_count + 1 },
      });
      recoveredCount++;
    } else {
      await db.execute(
        `UPDATE report_request
         SET status = 'GENERATION_FAILED', failed_at = NOW(),
             failure_stage = 'stale_recovery', failure_code = 'STALE_PROCESSING',
             failure_message = 'Request was stuck in PROCESSING state and has exceeded max retries'
         WHERE id = ?`,
        [row.id]
      );
      await recordReportAuditEvent({
        reportRequestId: row.id,
        eventType: REPORT_AUDIT_EVENTS.GENERATION_FAILED,
        actorType: 'system',
        message: `Stale PROCESSING request ${row.request_reference} failed (max retries exceeded)`,
        errorCode: 'STALE_PROCESSING',
      });
    }
  }

  // 2. Reset stuck EMAIL_SENDING delivery rows
  const [staleSend] = await db.execute<RowDataPacket[]>(
    `SELECT id, report_request_id FROM report_email_delivery
     WHERE status = 'SENDING'
       AND sending_started_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [STALE_SENDING_MINUTES]
  );

  for (const row of staleSend as Array<{ id: string; report_request_id: string }>) {
    await db.execute(
      `UPDATE report_email_delivery SET status = 'QUEUED', next_retry_at = NOW() WHERE id = ?`,
      [row.id]
    );
    await recordReportAuditEvent({
      reportRequestId: row.report_request_id,
      eventType: REPORT_AUDIT_EVENTS.STALE_JOB_RECOVERED,
      actorType: 'system',
      deliveryId: row.id,
      message: 'Stale SENDING delivery row reset to QUEUED',
    });
    recoveredCount++;
  }

  // 3. Find GENERATED requests with no QUEUED delivery row (orphaned)
  const [orphaned] = await db.execute<RowDataPacket[]>(
    `SELECT rr.id, rr.official_email, rr.requested_by_employee_id,
            rr.requested_by_employee_code, rr.report_name_snapshot,
            rgf.original_filename, rgf.file_size_bytes,
            rgf.expires_at, rgf.deletion_status
     FROM report_request rr
     LEFT JOIN report_generated_file rgf ON rgf.report_request_id = rr.id
     WHERE rr.status = 'GENERATED'
       AND NOT EXISTS (
         SELECT 1 FROM report_email_delivery red
         WHERE red.report_request_id = rr.id
           AND red.status IN ('QUEUED', 'SENDING', 'SENT')
       )`
  );

  for (const row of orphaned as Array<{
    id: string;
    official_email: string;
    requested_by_employee_id: string;
    requested_by_employee_code: string;
    report_name_snapshot: string;
    original_filename: string | null;
    file_size_bytes: number | null;
    expires_at: string | null;
    deletion_status: string | null;
  }>) {
    // Skip if file expired
    if (row.expires_at && new Date(row.expires_at) < new Date()) continue;
    if (row.deletion_status === 'deleted') continue;

    const { randomUUID } = await import('crypto');
    const deliveryId = randomUUID();
    const emailSubject = `HRMS Report Ready: ${row.report_name_snapshot}`;

    await db.execute(
      `INSERT INTO report_email_delivery
         (id, report_request_id, delivery_attempt_number, recipient_email,
          recipient_employee_id, recipient_employee_code, email_subject,
          attachment_filename, attachment_size_bytes, status, queued_at)
       VALUES (?,?,1,?, ?,?,?, ?,?,'QUEUED',NOW())`,
      [
        deliveryId, row.id,
        row.official_email,
        row.requested_by_employee_id ?? null,
        row.requested_by_employee_code ?? null,
        emailSubject,
        row.original_filename ?? null,
        row.file_size_bytes ?? null,
      ]
    );

    await db.execute(
      `UPDATE report_request SET email_queued_at = NOW() WHERE id = ?`,
      [row.id]
    );

    await recordReportAuditEvent({
      reportRequestId: row.id,
      eventType: REPORT_AUDIT_EVENTS.EMAIL_QUEUED,
      actorType: 'system',
      deliveryId,
      message: 'Orphaned GENERATED request: re-queued email delivery',
    });
    recoveredCount++;
  }

  // 4. Delete expired files
  const [expired] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM report_generated_file
     WHERE expires_at <= NOW()
       AND (deletion_status IS NULL OR deletion_status != 'deleted')
     LIMIT 50`
  );

  for (const row of expired as Array<{ id: string }>) {
    const [linkRows] = await db.execute<RowDataPacket[]>(
      `SELECT report_request_id FROM report_generated_file WHERE id = ?`,
      [row.id]
    );
    const requestId = (linkRows[0] as { report_request_id: string } | undefined)?.report_request_id;

    await deleteReportFile(row.id);

    if (requestId) {
      await db.execute(
        `UPDATE report_request SET status = 'EXPIRED' WHERE id = ? AND status IN ('EMAILED', 'GENERATED')`,
        [requestId]
      );
      await recordReportAuditEvent({
        reportRequestId: requestId,
        eventType: REPORT_AUDIT_EVENTS.FILE_DELETED,
        actorType: 'system',
        fileId: row.id,
        message: 'Report file deleted after retention period expired',
      });
    }
    expiredCount++;
  }

  if (recoveredCount > 0 || expiredCount > 0) {
    console.log(`[${WORKER_NAME}] Recovery complete: ${recoveredCount} jobs recovered, ${expiredCount} files expired/deleted`);
  }
}

async function runStaleRecovery(): Promise<void> {
  try {
    await withWorkerLock(WORKER_NAME, runRecovery);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_NAME}] Error:`, message);
  }
}

export async function startReportStaleRecoveryWorker(): Promise<void> {
  if (!(await reportRecoveryTablesAvailable())) {
    return;
  }
  console.log(`[${WORKER_NAME}] Starting (interval: ${INTERVAL_MS / 60000}m)`);
  void runStaleRecovery();
  intervalTimer = setInterval(() => void runStaleRecovery(), INTERVAL_MS);
  registerTimer(`${WORKER_NAME}-interval`, intervalTimer);
}

export function stopReportStaleRecoveryWorker(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    unregisterTimer(`${WORKER_NAME}-interval`);
    intervalTimer = null;
  }
  console.log(`[${WORKER_NAME}] stopped`);
}
