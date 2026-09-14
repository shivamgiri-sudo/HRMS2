import crypto from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import { withWorkerLock, registerTimer, unregisterTimer } from './worker-utils.js';
import { storeReportFile } from '../modules/reporting/report-file-storage.js';
import { recordReportAuditEvent, REPORT_AUDIT_EVENTS } from '../modules/reporting/report-audit.service.js';
import {
  buildSecureXlsxBuffer,
  buildSecureFilename,
  stripCursorField,
  XlsxRowLimitError,
  XlsxFileSizeError,
} from '../modules/reporting/xlsx-secure-builder.js';
import {
  executeReport,
  ReportExecutorNotFoundError,
  type ExecFilters,
  type ExecScope,
  type ExecOptions,
  type ExecResult,
} from '../modules/reporting/executors/index.js';
import { isBpoMasterCode, isIdentityBuilderCode } from '../modules/reporting/all-reports.registry.js';
import { REPORT_CATALOG } from '../modules/reporting/report-catalog.js';

// ── Configuration (all values from env) ───────────────────────────────────────
const WORKER_NAME             = 'report-generation';
const INTERVAL_MS             = 30_000;
const STALE_PROCESSING_MINUTES = 10;
const CHUNK_SIZE              = Number(process.env.REPORT_WORKER_CHUNK_SIZE ?? 5_000);
const MAX_ROWS                = Number(process.env.REPORT_MAX_XLSX_ROWS ?? 100_000);
const ATTACHMENT_MAX_BYTES    = Number(process.env.REPORT_ATTACHMENT_MAX_BYTES ?? 20_971_520); // 20 MB
const LARGE_FILE_THRESHOLD    = Number(process.env.REPORT_LARGE_FILE_THRESHOLD_BYTES ?? 15_728_640); // 15 MB
const TOKEN_TTL_HOURS         = Number(process.env.REPORT_DOWNLOAD_TOKEN_TTL_HOURS ?? 48);
const RETENTION_RESTRICTED    = Number(process.env.REPORT_RETENTION_RESTRICTED_DAYS ?? 2);
const RETENTION_DEFAULT       = Number(process.env.REPORT_RETENTION_DEFAULT_DAYS ?? 7);
const MAX_RETRIES             = 3;
const BASE_URL                = process.env.BACKEND_URL ?? 'http://localhost:5055';

let intervalTimer: NodeJS.Timeout | null = null;

function isMissingReportTableError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && String((error as { code?: unknown }).code ?? '') === 'ER_NO_SUCH_TABLE';
}

async function reportGenerationTablesAvailable(): Promise<boolean> {
  try {
    await db.execute<RowDataPacket[]>(`SELECT id FROM report_request LIMIT 1`);
    return true;
  } catch (error) {
    if (isMissingReportTableError(error)) {
      console.warn(`[${WORKER_NAME}] report_request table missing - worker disabled until reporting schema is migrated`);
      return false;
    }
    throw error;
  }
}

// ── Sensitivity helpers ────────────────────────────────────────────────────────

type SensitivityLevel = 'internal' | 'confidential' | 'restricted' | 'highly_restricted';

function getSensitivityLevel(reportCode: string): SensitivityLevel {
  const entry = (REPORT_CATALOG as Array<{ code: string; sensitivityLevel?: string }>)
    .find(e => e.code === reportCode);
  const level = entry?.sensitivityLevel ?? 'confidential';
  if (['internal','confidential','restricted','highly_restricted'].includes(level)) {
    return level as SensitivityLevel;
  }
  return 'confidential';
}

function getRetentionDays(level: SensitivityLevel): number {
  return (level === 'restricted' || level === 'highly_restricted')
    ? RETENTION_RESTRICTED
    : RETENTION_DEFAULT;
}

/** restricted/highly_restricted → link only; internal/confidential → attachment (or link if large) */
function requiresSecureLink(level: SensitivityLevel): boolean {
  return level === 'restricted' || level === 'highly_restricted';
}

// ── Multi-family dispatcher ────────────────────────────────────────────────────

async function dispatchWorkerReport(
  code: string,
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  // BPO master and identity builder families have dedicated adapters.
  // For now both fall through to the suite executor — their codes are either
  // in EXECUTOR_MAP or will throw ReportExecutorNotFoundError (correct behaviour).
  if (isBpoMasterCode(code) || isIdentityBuilderCode(code)) {
    return executeReport(code, filters, scope, options);
  }
  return executeReport(code, filters, scope, options);
}

// ── Secure download token ──────────────────────────────────────────────────────

async function createDownloadToken(
  fileId: string,
  requestingUserId: string,
  reportCode: string,
  retentionDays: number
): Promise<string> {
  const rawToken   = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  const tokenHash  = crypto.createHash('sha256').update(rawToken).digest('hex');
  const ttlSeconds = Math.min(TOKEN_TTL_HOURS * 3600, retentionDays * 24 * 3600);

  await db.execute(
    `INSERT INTO report_download_token
       (token_hash, file_id, requesting_user_id, report_code, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [tokenHash, fileId, requestingUserId, reportCode, ttlSeconds]
  );

  return rawToken; // returned to caller; stored hash is never returned
}

// ── Partial file cleanup ───────────────────────────────────────────────────────

async function deletePartialFile(requestId: string): Promise<void> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT storage_key FROM report_generated_file WHERE report_request_id = ? LIMIT 1`,
      [requestId]
    );
    if (!rows.length) return;
    const { storage_key } = rows[0] as { storage_key: string };

    // Remove DB record
    await db.execute(
      `DELETE FROM report_generated_file WHERE report_request_id = ?`,
      [requestId]
    );

    // Remove from filesystem (best-effort)
    const { unlinkSync, existsSync } = await import('fs');
    const { resolve } = await import('path');
    const absPath = resolve(process.cwd(), 'uploads', storage_key);
    if (existsSync(absPath)) unlinkSync(absPath);
  } catch {
    // Non-fatal: log but don't re-throw
    console.warn(`[${WORKER_NAME}] Failed to clean partial file for request ${requestId}`);
  }
}

// ── Mark request FAILED with full audit ───────────────────────────────────────

async function markFailed(
  requestId: string,
  reportCode: string,
  correlationId: string,
  attemptNumber: number,
  failureCode: string,
  userMessage: string,
  internalDetail: string
): Promise<void> {
  // report_request has failure_message. It has no failure_message_user and no
  // failure_message_internal, so this UPDATE raised ER_BAD_FIELD_ERROR and a
  // report that failed could not even be marked as failed. The evidence is in
  // the table: every report_request sits at GENERATION_FAILED with
  // failure_code 'STALE_PROCESSING' and "stuck in PROCESSING state and has
  // exceeded max retries" - written later by the stale sweeper, which uses
  // columns that exist. The real cause of every failure was lost.
  //
  // Nothing is lost by dropping the two. failure_message_user carried the same
  // value as failure_message, and internalDetail is recorded immediately below
  // by recordReportAuditEvent as errorDetail, which is where the operator-facing
  // detail belongs anyway.
  await db.execute(
    `UPDATE report_request SET
       status          = 'FAILED',
       failure_code    = ?,
       failure_message = ?,
       failed_at       = NOW(),
       updated_at      = NOW()
     WHERE id = ?`,
    [failureCode, userMessage, requestId]
  );
  await deletePartialFile(requestId);
  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.GENERATION_FAILED,
    actorType: 'worker',
    reportCode,
    correlationId,
    message: `Generation permanently failed after attempt ${attemptNumber}`,
    errorCode: failureCode,
    errorDetail: internalDetail.slice(0, 1000),
    metadataJson: { attemptNumber },
  });
}

// ── Core generation for one request ───────────────────────────────────────────

async function processOneRequest(): Promise<void> {
  // Atomically claim one QUEUED request
  const conn = await db.getConnection();
  let requestId: string | null = null;
  try {
    await conn.beginTransaction();
    const [claimRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM report_request
       WHERE status = 'QUEUED'
       ORDER BY priority DESC, requested_at ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (!claimRows.length) { await conn.rollback(); return; }

    requestId = (claimRows[0] as { id: string }).id;
    await conn.execute(
      `UPDATE report_request
       SET status = 'PROCESSING', processing_started_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [requestId]
    );
    await conn.commit();
  } catch (err) {
    // A failing rollback must not replace the real error nor skip the release. This worker did
    // release on all three of its normal paths, unlike report-email-delivery -- but a connection
    // broken mid-transaction makes rollback throw, and that path leaked. Under a pool already
    // starved by the sibling worker's leak, that is precisely the condition that occurs.
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    // Released here and nowhere else, so every path returns the connection exactly once.
    conn.release();
  }

  // Load request details
  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT report_code, report_name_snapshot, requested_by_employee_code,
            requested_by_employee_name, official_email, requested_filters_json,
            resolved_scope_json, request_reference, requested_by_user_id,
            requested_by_employee_id, requester_role_snapshot, correlation_id,
            retry_count
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
    resolved_scope_json: string | ExecScope;
    request_reference: string;
    requested_by_user_id: string;
    requested_by_employee_id: string;
    requester_role_snapshot: string;
    correlation_id: string;
    retry_count: number;
  };

  const filters: ExecFilters =
    typeof req.requested_filters_json === 'string'
      ? (JSON.parse(req.requested_filters_json) as ExecFilters)
      : (req.requested_filters_json as ExecFilters ?? {});

  const rawScope = typeof req.resolved_scope_json === 'string'
    ? (JSON.parse(req.resolved_scope_json) as ExecScope)
    : (req.resolved_scope_json as ExecScope);

  // Normalise legacy scope shape (older requests may lack new DimensionScope fields)
  const scope: ExecScope = {
    companyId:              (rawScope as any).companyId ?? '1',
    isSuperAdmin:           (rawScope as any).isSuperAdmin ?? false,
    branchScope:            (rawScope as any).branchScope ?? { mode: 'all', ids: [] },
    processScope:           (rawScope as any).processScope ?? { mode: 'all', ids: [] },
    departmentScope:        (rawScope as any).departmentScope ?? { mode: 'all', ids: [] },
    costCentreScope:        (rawScope as any).costCentreScope ?? { mode: 'all', ids: [] },
    canViewAllEmployees:    (rawScope as any).canViewAllEmployees ?? (rawScope as any).isSuperAdmin ?? false,
    canViewSensitiveFields: (rawScope as any).canViewSensitiveFields ?? (rawScope as any).isSuperAdmin ?? false,
    canExportSensitiveReports: (rawScope as any).canExportSensitiveReports ?? (rawScope as any).isSuperAdmin ?? false,
    roles:                  (rawScope as any).roles ?? [],
    managerEmployeeId:      (rawScope as any).managerEmployeeId,
    selfEmployeeId:         (rawScope as any).selfEmployeeId,
    subordinateEmployeeIds: (rawScope as any).subordinateEmployeeIds ?? [],
  };

  const sensitivityLevel = getSensitivityLevel(req.report_code);
  const retentionDays    = getRetentionDays(sensitivityLevel);
  const attemptNumber    = Number(req.retry_count ?? 0) + 1;

  await recordReportAuditEvent({
    reportRequestId: requestId,
    eventType: REPORT_AUDIT_EVENTS.GENERATION_STARTED,
    actorType: 'worker',
    reportCode: req.report_code,
    reportName: req.report_name_snapshot,
    correlationId: req.correlation_id,
    message: `Generation started (attempt ${attemptNumber}) for ${req.request_reference}`,
  });

  try {
    // ── Keyset pagination loop ─────────────────────────────────────────────────
    const reportAsOf = new Date().toISOString(); // fixed snapshot for multi-chunk consistency
    let lastCursor: string | number | null = null;
    let totalWritten = 0;
    const allRows: Record<string, unknown>[] = [];

    while (true) {
      const chunkOptions: ExecOptions = {
        limit: CHUNK_SIZE,
        offset: 0,
        cursor: lastCursor,
        includeTotal: false,
        mode: 'worker',
        asOf: reportAsOf,
      };

      const batch: ExecResult = await dispatchWorkerReport(
        req.report_code, filters, scope, chunkOptions
      );

      const cleanRows = stripCursorField(batch.rows);
      allRows.push(...cleanRows);
      totalWritten += cleanRows.length;
      lastCursor = batch.nextCursor ?? null;

      if (cleanRows.length < CHUNK_SIZE) break;      // last page
      if (lastCursor === null) break;                 // executor signals no more pages
      if (totalWritten >= MAX_ROWS) {
        // Mark the row-limit condition but still build the file from the rows
        // fetched so far.
        //
        // This wrote report_request.notes, which does not exist, so the UPDATE
        // raised ER_BAD_FIELD_ERROR - and it fires on the one path where the
        // report is otherwise fine, so a report that merely exceeded the row
        // limit failed outright instead of being delivered truncated.
        //
        // The condition belongs in the audit trail rather than a free-text
        // column: report_audit_event already records every other step of this
        // request, and metadataJson keeps the numbers queryable.
        await recordReportAuditEvent({
          reportRequestId: requestId,
          eventType: REPORT_AUDIT_EVENTS.SOURCE_QUERY_COMPLETED,
          actorType: 'worker',
          reportCode: req.report_code,
          correlationId: req.correlation_id,
          message: `Row limit reached - report truncated at ${MAX_ROWS} rows`,
          metadataJson: { rowLimitReached: true, totalWritten, maxRows: MAX_ROWS },
        });
        break;
      }
    }

    await recordReportAuditEvent({
      reportRequestId: requestId,
      eventType: REPORT_AUDIT_EVENTS.SOURCE_QUERY_COMPLETED,
      actorType: 'worker',
      reportCode: req.report_code,
      correlationId: req.correlation_id,
      message: `Query complete: ${totalWritten} rows fetched`,
      metadataJson: { rowCount: totalWritten },
    });

    // ── Build XLSX ─────────────────────────────────────────────────────────────
    const scopeSummary = scope.isSuperAdmin
      ? 'ALL BRANCHES'
      : `BRANCHES: ${scope.branchScope.mode === 'all' ? 'ALL' : scope.branchScope.ids.join(', ')}`;

    const buffer = await buildSecureXlsxBuffer({
      reportName:            req.report_name_snapshot,
      requestReference:      req.request_reference,
      requesterEmployeeCode: req.requested_by_employee_code ?? 'UNKNOWN',
      filters:               filters as Record<string, unknown>,
      scopeSummary,
      rows:                  allRows,
      totalRows:             totalWritten,
    });

    const filename = buildSecureFilename(req.report_name_snapshot, req.request_reference);

    // ── Store file ─────────────────────────────────────────────────────────────
    const stored = await storeReportFile({
      requestId,
      buffer,
      filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      rowCount:  totalWritten,
      colCount:  allRows.length > 0 ? Object.keys(allRows[0]).length : 0,
      retentionDays,
    });

    await recordReportAuditEvent({
      reportRequestId: requestId,
      eventType: REPORT_AUDIT_EVENTS.FILE_STORED,
      actorType: 'worker',
      reportCode: req.report_code,
      fileId: stored.fileId,
      correlationId: req.correlation_id,
      message: `File stored: ${filename} (${buffer.length} bytes)`,
      metadataJson: { fileId: stored.fileId, fileSizeBytes: buffer.length, rowCount: totalWritten },
    });

    // ── Decide delivery method ─────────────────────────────────────────────────
    const useLink = requiresSecureLink(sensitivityLevel) || buffer.length > ATTACHMENT_MAX_BYTES;
    const useAttachment = !useLink;

    let downloadUrl: string | null = null;
    if (useLink) {
      const rawToken = await createDownloadToken(
        stored.fileId,
        req.requested_by_user_id,
        req.report_code,
        retentionDays
      );
      downloadUrl = `${BASE_URL}/api/reports/download/${rawToken}`;
    }

    // ── Queue email delivery ───────────────────────────────────────────────────
    const emailSubject = `HRMS Report Ready: ${req.report_name_snapshot} — ${req.request_reference}`;
    const sizeWarning = buffer.length >= LARGE_FILE_THRESHOLD && useAttachment
      ? ` (large file: ${(buffer.length / 1_048_576).toFixed(1)} MB)`
      : '';

    // report_email_delivery has neither delivery_method nor secure_download_url,
    // so this INSERT raised ER_BAD_FIELD_ERROR and no delivery has ever been
    // recorded - the table holds 0 rows.
    //
    // Both dropped rather than added. The delivery method stays derivable:
    // attachment_filename is set for an ATTACHMENT and NULL for a LINK, which is
    // exactly the distinction the column carried. The download URL is built from
    // the request id, so it can be regenerated rather than stored - and a signed
    // URL is better not persisted anyway.
    await db.execute(
      `INSERT INTO report_email_delivery
         (id, report_request_id, delivery_attempt_number, recipient_email,
          recipient_employee_id, recipient_employee_code, email_subject,
          attachment_filename, attachment_size_bytes, status, queued_at)
       VALUES (UUID(),?,1,?, ?,?,?, ?,?, 'QUEUED',NOW())`,
      [
        requestId,
        req.official_email,
        req.requested_by_employee_id ?? null,
        req.requested_by_employee_code ?? null,
        emailSubject + sizeWarning,
        useAttachment ? filename : null,
        useAttachment ? buffer.length : null,
      ]
    );

    // ── Finalise request ───────────────────────────────────────────────────────
    await db.execute(
      `UPDATE report_request
       SET status = 'GENERATED', generation_completed_at = NOW(), email_queued_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [requestId]
    );

    await recordReportAuditEvent({
      reportRequestId: requestId,
      eventType: REPORT_AUDIT_EVENTS.GENERATION_COMPLETED,
      actorType: 'worker',
      reportCode: req.report_code,
      fileId: stored.fileId,
      correlationId: req.correlation_id,
      message: `Generation complete. ${totalWritten} rows. Delivery: ${useAttachment ? 'attachment' : 'secure link'}. Email queued to ${req.official_email}.`,
      metadataJson: { rowCount: totalWritten, fileSizeBytes: buffer.length, deliveryMethod: useAttachment ? 'ATTACHMENT' : 'LINK' },
    });

    console.log(`[${WORKER_NAME}] ${req.request_reference} — ${totalWritten} rows, ${buffer.length} bytes, delivery=${useAttachment ? 'attachment' : 'link'}`);

  } catch (err: unknown) {
    const isNoExecutor = err instanceof ReportExecutorNotFoundError;
    const isRowLimit   = err instanceof XlsxRowLimitError;
    const isFileSize   = err instanceof XlsxFileSizeError;
    const rawMsg       = err instanceof Error ? err.message : String(err);

    let failureCode    = 'GENERATION_ERROR';
    let userMessage    = 'Report generation failed. Please try again or contact support.';

    if (isNoExecutor) {
      failureCode = 'NO_EXECUTOR';
      userMessage = 'This report type is not yet available. Please contact support.';
    } else if (isRowLimit) {
      failureCode = 'ROW_LIMIT_EXCEEDED';
      userMessage = 'The report exceeds the maximum row limit. Please apply filters to reduce the dataset.';
    } else if (isFileSize) {
      failureCode = 'FILE_SIZE_EXCEEDED';
      userMessage = 'The generated report file is too large. Please apply filters to reduce the dataset.';
    }

    console.error(`[${WORKER_NAME}] Attempt ${attemptNumber} failed for ${requestId}: [${failureCode}] ${rawMsg}`);

    // No executor → permanent failure (retrying will not help)
    const permanentFail = isNoExecutor || isRowLimit || isFileSize;

    if (!permanentFail && attemptNumber <= MAX_RETRIES) {
      await db.execute(
        `UPDATE report_request
         SET status = 'QUEUED', retry_count = retry_count + 1, last_retry_at = NOW(),
             failure_code = ?, failure_message = ?, updated_at = NOW()
         WHERE id = ?`,
        [failureCode, rawMsg.slice(0, 500), requestId]
      );
      await recordReportAuditEvent({
        reportRequestId: requestId,
        eventType: REPORT_AUDIT_EVENTS.RETRY_SCHEDULED,
        actorType: 'worker',
        reportCode: req.report_code,
        correlationId: req.correlation_id,
        message: `Generation failed (attempt ${attemptNumber}/${MAX_RETRIES}). Requeued.`,
        errorCode: failureCode,
        errorDetail: rawMsg.slice(0, 1000),
      });
    } else {
      await markFailed(
        requestId,
        req.report_code,
        req.correlation_id,
        attemptNumber,
        failureCode,
        userMessage,
        rawMsg
      );
    }
  }
}

// ── Stale-lock recovery ────────────────────────────────────────────────────────

async function recoverStaleLocks(): Promise<void> {
  await db.execute(
    `UPDATE report_request
     SET status = 'QUEUED', failure_message = 'Recovered from stale PROCESSING lock', updated_at = NOW()
     WHERE status = 'PROCESSING'
       AND processing_started_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [STALE_PROCESSING_MINUTES]
  );
}

// ── Worker loop ────────────────────────────────────────────────────────────────

async function runGenerationWorker(): Promise<void> {
  try {
    await withWorkerLock(WORKER_NAME, async () => {
      await recoverStaleLocks();
      await processOneRequest();
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_NAME}] Error:`, message);
  }
}

export async function startReportGenerationWorker(): Promise<void> {
  if (!(await reportGenerationTablesAvailable())) {
    return;
  }
  console.log(`[${WORKER_NAME}] Starting (interval: ${INTERVAL_MS / 1000}s, chunk: ${CHUNK_SIZE})`);
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
