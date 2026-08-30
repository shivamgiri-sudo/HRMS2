//
// The write path for the WFM manual upload pipeline (requirements.md Requirement 17). Two
// pieces: resolveOrCreateDefaultCampaign() closes the campaign_id gap apr_manual_upload's schema
// has and Requirement 17 never addresses (see this plan's header) — every manual_upload
// Dialler_Source gets exactly one auto-created default campaign, idempotently. commitUploadBatch()
// writes productivity_upload_batch, apr_manual_upload (the accepted rows, criterion 17.3) and
// productivity_upload_rejection (criterion 17.2), and marks a prior batch superseded when this
// submission declares itself a re-upload (criterion 17.7).

import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type { PreviewAcceptedRow, PreviewRejectedRow } from './productivity-upload-preview.service.js';

const INSERT_CHUNK_SIZE = 300; // matches attendance-apr-bulk.routes.ts's proven chunk size

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface CampaignRow extends RowDataPacket {
  id: string;
  campaign_code: string;
}

/**
 * Resolves the one default campaign for a manual_upload Dialler_Source, creating it on first
 * use. Idempotent and race-safe: the INSERT is a no-op ON DUPLICATE KEY (campaign_code is
 * UNIQUE), then a fresh SELECT returns whichever row actually won the race.
 */
export async function resolveOrCreateDefaultCampaign(
  diallerSourceId: string,
): Promise<{ campaignId: string; campaignCode: string }> {
  const defaultCode = `DEFAULT_${diallerSourceId}`;

  const [existing] = await db.execute<CampaignRow[]>(
    `SELECT id, campaign_code FROM campaign_master WHERE campaign_code = ? LIMIT 1`,
    [defaultCode],
  );
  if (existing.length > 0) {
    return { campaignId: existing[0].id, campaignCode: existing[0].campaign_code };
  }

  const [sourceRows] = await db.execute<RowDataPacket[]>(
    `SELECT display_name FROM dialler_source WHERE id = ? LIMIT 1`,
    [diallerSourceId],
  );
  const displayName = sourceRows.length > 0 ? (sourceRows[0] as any).display_name : diallerSourceId;

  await db.execute(
    `INSERT INTO campaign_master (id, campaign_code, campaign_name, dialler_source_id, is_sentinel, active_status)
     VALUES (?, ?, ?, ?, 0, 1)
     ON DUPLICATE KEY UPDATE campaign_name = campaign_name`,
    [randomUUID(), defaultCode, `Default campaign for ${displayName}`, diallerSourceId],
  );

  const [rows] = await db.execute<CampaignRow[]>(
    `SELECT id, campaign_code FROM campaign_master WHERE campaign_code = ? LIMIT 1`,
    [defaultCode],
  );
  return { campaignId: rows[0].id, campaignCode: rows[0].campaign_code };
}

export interface CommitBatchParams {
  diallerSourceId: string;
  branchId: string;
  processId: string;
  dateFrom: string;
  dateTo: string;
  fileName: string;
  contentDigest: string;
  uploadedBy: string;
  mappingVersionUsed: number;
  supersedesBatchId?: string;
  acceptedRows: PreviewAcceptedRow[];
  rejectedRows: PreviewRejectedRow[];
}

export interface CommitBatchResult {
  batchId: string;
  batchReference: string;
  acceptedCount: number;
  rejectedCount: number;
}

export async function commitUploadBatch(params: CommitBatchParams): Promise<CommitBatchResult> {
  const { campaignCode } = await resolveOrCreateDefaultCampaign(params.diallerSourceId);

  const batchId = randomUUID();
  const batchReference = batchId; // simplest guaranteed-unique reference; no human-readable
                                   // scheme is specified anywhere in requirements.md

  await db.execute(
    `INSERT INTO productivity_upload_batch
       (id, batch_reference, dialler_source_id, branch_id, process_id, date_from, date_to,
        file_name, content_digest, uploaded_by, submitted_row_count, accepted_row_count,
        rejected_row_count, mapping_version_used, supersedes_batch_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')`,
    [
      batchId, batchReference, params.diallerSourceId, params.branchId, params.processId,
      params.dateFrom, params.dateTo, params.fileName, params.contentDigest, params.uploadedBy,
      params.acceptedRows.length + params.rejectedRows.length,
      params.acceptedRows.length, params.rejectedRows.length, params.mappingVersionUsed,
      params.supersedesBatchId ?? null,
    ],
  );

  if (params.supersedesBatchId) {
    await db.execute(
      `UPDATE productivity_upload_batch
          SET status = 'superseded', superseded_at = NOW(), superseded_by_batch_id = ?
        WHERE id = ? AND status <> 'superseded'`,
      [batchId, params.supersedesBatchId],
    );
  }

  for (const chunk of chunkArray(params.acceptedRows, INSERT_CHUNK_SIZE)) {
    // Plain multi-row VALUES, matching the proven pattern in attendance-apr-bulk.routes.ts —
    // 14 bound params per row (id..upload_batch_id) plus the literal NOW() for created_at,
    // matching apr_manual_upload's 15-column shape exactly. An earlier draft of this function
    // used a `SELECT t.*, ? FROM (VALUES ...) AS t` wrapper to append upload_batch_id, which
    // undercounted by one column against created_at — a real column-count SQL error that the
    // mocked unit tests below cannot catch, since a mock does not validate SQL syntax. Caught
    // in self-review before this was ever dispatched; kept this note so the next person who is
    // tempted to "simplify" the INSERT back to that shape knows why it was rejected.
    const valuesSql = chunk
      .map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`)
      .join(',\n         ');
    const flatParams = chunk.flatMap((r) => [
      randomUUID(), r.employeeCode, params.processId, campaignCode, r.reportDate,
      r.callsHandled ?? null, r.ahtSeconds ?? null, r.loginMinutes,
      r.bioMinutes ?? null, r.lunchMinutes ?? null, r.qaMinutes ?? null, r.trainingMinutes ?? null,
      params.uploadedBy, batchId,
    ]);
    await db.execute(
      `INSERT INTO apr_manual_upload
         (id, employee_code, process_id, campaign_id, report_date,
          calls_handled, aht_seconds, login_minutes,
          bio_minutes, lunch_minutes, qa_minutes, training_minutes,
          uploaded_by, upload_batch_id, created_at)
       VALUES ${valuesSql}`,
      flatParams,
    );
  }

  for (const chunk of chunkArray(params.rejectedRows, INSERT_CHUNK_SIZE)) {
    const valuesSql = chunk.map(() => `(?, ?, ?, ?, ?)`).join(',\n         ');
    const flatParams = chunk.flatMap((r) => [
      randomUUID(), batchId, r.rowNumber, r.employeeCode, r.reason,
    ]);
    await db.execute(
      `INSERT INTO productivity_upload_rejection (id, batch_id, row_number, employee_code, reason)
       VALUES ${valuesSql}`,
      flatParams,
    );
  }

  return {
    batchId,
    batchReference,
    acceptedCount: params.acceptedRows.length,
    rejectedCount: params.rejectedRows.length,
  };
}
