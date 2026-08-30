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
  // campaign_master.campaign_name is VARCHAR(255); dialler_source.display_name is also
  // VARCHAR(255), so "Default campaign for " + displayName can reach 275 chars and overflow
  // under strict mode. Truncated defensively.
  const campaignName = `Default campaign for ${displayName}`.slice(0, 255);

  // is_sentinel = 0 (not 1): criterion 16.8's sentinel flag marks a campaign EXCLUDED from
  // Canonical_Productive_Minutes (the old system-wide 'MANUAL_UPLOAD' catch-all this default
  // replaces). This default campaign carries real uploaded data and must count — is_sentinel
  // stays 0 deliberately, despite this function's own docstring calling it "one sentinel per
  // source" in the loose, everyday sense of "one designated default," not Requirement 16's
  // is_sentinel flag.
  await db.execute(
    `INSERT INTO campaign_master (id, campaign_code, campaign_name, dialler_source_id, is_sentinel, active_status)
     VALUES (?, ?, ?, ?, 0, 1)
     ON DUPLICATE KEY UPDATE campaign_name = campaign_name`,
    [randomUUID(), defaultCode, campaignName, diallerSourceId],
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
  writeErrors: string[];
}

interface ExistingBatchRow extends RowDataPacket {
  id: string;
  batch_reference: string;
  accepted_row_count: number;
  rejected_row_count: number;
}

export async function commitUploadBatch(params: CommitBatchParams): Promise<CommitBatchResult> {
  // Duplicate-submission guard (Global Constraints: "a retried request never double-writes").
  //
  // Three earlier review rounds tried to solve this by auto-detecting "safe to skip vs safe to
  // retry" from content-digest + row-count matching, and each attempt broke something else:
  // matching only a fully-succeeded prior batch permanently blocked recovery from a genuine
  // failure; loosening that to also match a partially-failed prior batch caused a retry to
  // re-insert rows that had already landed on the first attempt (apr_manual_upload has no
  // natural unique key — nothing stops a duplicate); and either version silently swallowed a
  // deliberate supersedesBatchId re-upload of an unchanged file, because the short-circuit fired
  // before the supersede branch below ever ran.
  //
  // The only version of this check that cannot reintroduce any of those three bugs is one that
  // never tries to guess the caller's intent: an identical (scope + file) resubmission that does
  // NOT declare itself a deliberate re-upload is rejected outright, naming the prior batch so a
  // human can explicitly choose what happens next. This cannot double-write (nothing proceeds
  // past this guard without either genuinely new content or an explicit supersede instruction),
  // cannot permanently strand a failed upload (the error tells the caller exactly what to pass —
  // supersedesBatchId — to force it through), and cannot defeat a real supersede
  // (supersedesBatchId always bypasses this guard entirely and goes straight to the supersede
  // logic below, unconditionally).
  if (!params.supersedesBatchId) {
    const [existingBatch] = await db.execute<ExistingBatchRow[]>(
      `SELECT id, batch_reference, accepted_row_count, rejected_row_count
         FROM productivity_upload_batch
        WHERE dialler_source_id = ? AND branch_id = ? AND process_id = ?
          AND date_from = ? AND date_to = ? AND content_digest = ?
          AND status <> 'superseded'
        LIMIT 1`,
      [params.diallerSourceId, params.branchId, params.processId, params.dateFrom, params.dateTo, params.contentDigest],
    );
    if (existingBatch.length > 0) {
      const row = existingBatch[0];
      throw new Error(
        `A batch (${row.batch_reference}) already exists for this exact file and scope ` +
        `(dialler_source ${params.diallerSourceId}, branch ${params.branchId}, process ${params.processId}, ` +
        `${params.dateFrom} to ${params.dateTo}). If this is a deliberate re-upload, resubmit with ` +
        `supersedesBatchId set to ${row.id}.`,
      );
    }
  }

  const { campaignCode } = await resolveOrCreateDefaultCampaign(params.diallerSourceId);

  const batchId = randomUUID();
  const batchReference = batchId; // simplest guaranteed-unique reference; no human-readable
                                   // scheme is specified anywhere in requirements.md

  if (params.supersedesBatchId) {
    // Checked and resolved BEFORE the new batch row is written, so an invalid
    // supersedesBatchId aborts the whole commit rather than leaving a new batch pointing at
    // nothing (1638 deliberately carries no FK to enforce this at the schema level).
    const [updateResult]: any = await db.execute(
      `UPDATE productivity_upload_batch
          SET status = 'superseded', superseded_at = NOW(), superseded_by_batch_id = ?
        WHERE id = ? AND status <> 'superseded'`,
      [batchId, params.supersedesBatchId],
    );
    if (updateResult.affectedRows === 0) {
      const [check] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM productivity_upload_batch WHERE id = ? LIMIT 1`,
        [params.supersedesBatchId],
      );
      if (check.length === 0) {
        throw new Error(`supersedesBatchId ${params.supersedesBatchId} does not name an existing Upload_Batch`);
      }
      // Row exists but was already superseded by something else — idempotent no-op is
      // acceptable here (a retried "supersede" request should not itself error).
    }
  }

  // No transaction spans the writes below, matching this codebase's established convention
  // (attendance-apr-bulk.routes.ts) — each chunk is one multi-row INSERT, atomic in itself, but
  // chunks are independent of each other and a later chunk's failure never rolls back an
  // earlier one that already landed. Every chunk is caught individually so one bad chunk cannot
  // crash the request or silently misreport what actually landed; actualAccepted/actualRejected
  // track ground truth, and the batch row is written LAST, with real counts and a status that
  // reflects what happened — never the optimistic "everything requested succeeded" the first
  // draft of this function assumed.
  //
  // Two accepted, no-transaction trade-offs worth naming rather than hiding:
  //  - If a supersedesBatchId was given, the prior batch is already marked 'superseded' by this
  //    point (above), before this batch's own row exists. If the final productivity_upload_batch
  //    INSERT below throws, the prior batch is left superseded with a superseded_by_batch_id
  //    pointing at a row that was never created — no FK catches this (1638 deliberately carries
  //    none). A caller seeing that error should treat the whole commit as failed and investigate,
  //    not assume the supersession itself is safe to ignore.
  //  - Rows land in apr_manual_upload carrying upload_batch_id = batchId before the batch row
  //    itself exists; the same final-INSERT failure would leave them referencing a batch id that
  //    was never created. Inherent to "write the batch row last so its counts are honest" — the
  //    alternative (write it first, optimistically) is the bug this very function was fixed to
  //    stop doing.
  //  - criterion 17.11's "accepted + rejected = submitted" therefore holds for
  //    accepted_row_count + rejected_row_count against what ACTUALLY landed, but
  //    submitted_row_count still records what was requested — the two only disagree when
  //    writeErrors is non-empty, which is the signal a caller should watch instead of the raw
  //    counts alone.
  const writeErrors: string[] = [];
  let actualAccepted = 0;
  let actualRejected = 0;

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
    try {
      await db.execute(
        `INSERT INTO apr_manual_upload
           (id, employee_code, process_id, campaign_id, report_date,
            calls_handled, aht_seconds, login_minutes,
            bio_minutes, lunch_minutes, qa_minutes, training_minutes,
            uploaded_by, upload_batch_id, created_at)
         VALUES ${valuesSql}`,
        flatParams,
      );
      actualAccepted += chunk.length;
    } catch (err) {
      writeErrors.push(
        `${chunk.length} accepted row(s) (rows ${chunk[0]!.rowNumber}-${chunk[chunk.length - 1]!.rowNumber}) failed to save: ${
          err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const chunk of chunkArray(params.rejectedRows, INSERT_CHUNK_SIZE)) {
    const valuesSql = chunk.map(() => `(?, ?, ?, ?, ?)`).join(',\n         ');
    const flatParams = chunk.flatMap((r) => [
      randomUUID(), batchId, r.rowNumber, r.employeeCode, r.reason,
    ]);
    try {
      await db.execute(
        `INSERT INTO productivity_upload_rejection (id, batch_id, source_row_number, employee_code, reason)
         VALUES ${valuesSql}`,
        flatParams,
      );
      actualRejected += chunk.length;
    } catch (err) {
      writeErrors.push(
        `${chunk.length} rejection record(s) (rows ${chunk[0]!.rowNumber}-${chunk[chunk.length - 1]!.rowNumber}) failed to save: ${
          err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // NOT `writeErrors.length > 0 || actualAccepted > 0` — that disjunct is backwards and was a
  // real bug caught in a second review round: it marks a batch 'accepted' whenever ANY write
  // error occurred, even a total failure (actualAccepted: 0, every row lost). Status must
  // reflect what actually landed, nothing else.
  const status = actualAccepted > 0 ? 'accepted' : 'rejected';

  await db.execute(
    `INSERT INTO productivity_upload_batch
       (id, batch_reference, dialler_source_id, branch_id, process_id, date_from, date_to,
        file_name, content_digest, uploaded_by, submitted_row_count, accepted_row_count,
        rejected_row_count, mapping_version_used, supersedes_batch_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      batchId, batchReference, params.diallerSourceId, params.branchId, params.processId,
      params.dateFrom, params.dateTo, params.fileName, params.contentDigest, params.uploadedBy,
      params.acceptedRows.length + params.rejectedRows.length,
      actualAccepted, actualRejected, params.mappingVersionUsed,
      params.supersedesBatchId ?? null, status,
    ],
  );

  return { batchId, batchReference, acceptedCount: actualAccepted, rejectedCount: actualRejected, writeErrors };
}
