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

/**
 * Thrown by the duplicate-submission guard in commitUploadBatch(). Typed (not a plain Error) so
 * the route layer can map it to 409 by `instanceof`, not by matching a message substring that
 * either side could reword without the other noticing — see the guard's own comment for why
 * that distinction mattered.
 */
export class DuplicateUploadBatchError extends Error {
  constructor(public readonly priorBatchId: string, message: string) {
    super(message);
    this.name = 'DuplicateUploadBatchError';
  }
}

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
  // Not `rows[0].id` unguarded: if the INSERT succeeded but the re-select returns nothing
  // (replica lag, or the row renamed/removed between the two statements) that is a TypeError,
  // which is a much worse failure mode than a named error — every accepted row of the upload
  // would already be about to be written against a campaign code that could not be confirmed.
  if (rows.length === 0) {
    throw new Error(
      `default campaign ${defaultCode} could not be resolved after its INSERT — refusing to write upload rows against an unconfirmed campaign`,
    );
  }
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
  //
  // Thrown as a typed error, not a plain Error matched by message substring at the route layer:
  // a round-4 review found the original plain-Error version coupled the route's 409 mapping to
  // an untested string that both sides could independently reword without either test suite
  // noticing, silently degrading a real duplicate submission back into a masked 500 — exactly
  // this codebase's dominant defect class.
  //
  // The guard key deliberately does NOT include date_from/date_to. It used to, and that made the
  // whole guard bypassable by anyone who could retype a form field: upload july.csv declaring
  // 2026-07-01..2026-07-31, then resubmit the byte-identical file declaring 2026-07-02..07-31 and
  // the key differs, the guard stays silent, and every row lands a second time in
  // apr_manual_upload — which has no natural unique key to stop it. Doubled productive minutes in
  // a table that feeds attendance and, downstream, pay. The declared window is caller-supplied
  // metadata; the same bytes for the same (source, branch, process) are the same submission
  // whatever window is claimed for them, and the route now independently rejects any row whose
  // report_date falls outside the declared window, so a genuinely different window cannot carry
  // the same rows anyway.
  if (!params.supersedesBatchId) {
    const [existingBatch] = await db.execute<ExistingBatchRow[]>(
      `SELECT id, batch_reference, accepted_row_count, rejected_row_count
         FROM productivity_upload_batch
        WHERE dialler_source_id = ? AND branch_id = ? AND process_id = ?
          AND content_digest = ?
          AND status <> 'superseded'
        LIMIT 1`,
      [params.diallerSourceId, params.branchId, params.processId, params.contentDigest],
    );
    if (existingBatch.length > 0) {
      const row = existingBatch[0];
      throw new DuplicateUploadBatchError(
        row.id,
        `A batch (${row.id}) already exists for this exact file and scope ` +
        `(dialler_source ${params.diallerSourceId}, branch ${params.branchId}, process ${params.processId}). ` +
        `If this is a deliberate re-upload, resubmit with supersedesBatchId set to ${row.id}.`,
      );
    }
  }

  const { campaignCode } = await resolveOrCreateDefaultCampaign(params.diallerSourceId);

  const batchId = randomUUID();
  const batchReference = batchId; // simplest guaranteed-unique reference; no human-readable
                                   // scheme is specified anywhere in requirements.md

  // Set when a supersedesBatchId was given, names an existing batch in THIS submission's scope,
  // and is not already superseded. The UPDATE itself is deliberately deferred until after the
  // accepted rows have actually landed — see the comment at the supersede write below.
  let supersedeTargetId: string | null = null;

  if (params.supersedesBatchId) {
    // Looked up BEFORE any write, and checked against BOTH existence and scope. A round-4
    // review found that checking existence alone (the version this replaced) let a caller
    // supersede a batch from a completely different dialler_source/branch/process/date scope —
    // e.g. pasting the wrong id off the Upload_Batch history screen (criterion 17.13 lists many
    // batches per branch) — which would wrongly exclude an UNRELATED batch's rows from
    // Canonical_Productive_Minutes via 17.7, while this submission's own rows land as an
    // undetected duplicate for ITS scope (the guard above cannot catch this, since the batch it
    // would have matched on is a different one than the caller named). Both are real
    // double-write/undercount outcomes, not hypothetical.
    interface PriorBatchRow extends RowDataPacket {
      id: string;
      dialler_source_id: string;
      branch_id: string;
      process_id: string;
      date_from: string;
      date_to: string;
      status: string;
    }
    const [priorRows] = await db.execute<PriorBatchRow[]>(
      `SELECT id, dialler_source_id, branch_id, process_id, date_from, date_to, status
         FROM productivity_upload_batch
        WHERE id = ?
        LIMIT 1`,
      [params.supersedesBatchId],
    );
    if (priorRows.length === 0) {
      throw new Error(`supersedesBatchId ${params.supersedesBatchId} does not name an existing Upload_Batch`);
    }
    const prior = priorRows[0];
    const sameScope = prior.dialler_source_id === params.diallerSourceId
      && prior.branch_id === params.branchId
      && prior.process_id === params.processId
      && prior.date_from === params.dateFrom
      && prior.date_to === params.dateTo; // db pool has dateStrings:true, and the route validates
                                          // both sides to strict YYYY-MM-DD before calling, so a
                                          // plain string compare cannot false-negative on '2026-7-1'
    if (!sameScope) {
      throw new Error(
        `supersedesBatchId ${params.supersedesBatchId} names an Upload_Batch for a different ` +
        `dialler_source, branch, process or date range than this submission — refusing to ` +
        `supersede across scopes`,
      );
    }
    // else (already 'superseded'): leave supersedeTargetId null — idempotent no-op, a retried
    // "supersede" request should not itself error.
    if (prior.status !== 'superseded') {
      supersedeTargetId = params.supersedesBatchId;
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
  //
  // A third, KNOWN, NOT YET CLOSED gap a round-4 review surfaced and this note deliberately does
  // not paper over: the duplicate-submission guard above is advisory, not exclusive. It SELECTs,
  // then this function's writes happen over several seconds for a large file, and the new batch
  // row is only INSERTed at the very end — so two concurrent commit requests for the identical
  // (scope + digest) can both pass the guard's SELECT before either's batch row exists, and both
  // proceed to write. Nothing in the schema stops it: apr_manual_upload has no natural unique
  // key (noted above), and productivity_upload_batch (1638) carries no uniqueness on
  // (dialler_source_id, branch_id, process_id, date_from, date_to, content_digest) either. This
  // is a real double-click / retry-during-still-writing race, not a hypothetical — closing it
  // needs a schema change (1638 is still unexecuted, so it is still cheap to make one), most
  // plausibly reserving the batch row up front as 1638's already-declared 'pending' status
  // before any chunk writes, guarded by a uniqueness constraint that excludes superseded rows.
  // That is a deliberate scope decision for a future task, not an oversight here.
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
      // The raw driver message is logged, never returned. It carries schema internals verbatim
      // ("Unknown column 'campaign_id'", "Table 'mas_hrms.apr_manual_upload' doesn't exist"),
      // which errorHandler.ts exists specifically to stop leaking to a client. The row range is
      // the part the uploader can actually act on, so that is what the response carries.
      console.error('[productivity-upload] accepted-row chunk failed', err);
      writeErrors.push(
        `${chunk.length} accepted row(s) (rows ${chunk[0]!.rowNumber}-${chunk[chunk.length - 1]!.rowNumber}) could not be saved. Re-upload this range once the problem is resolved.`,
      );
    }
  }

  for (const chunk of chunkArray(params.rejectedRows, INSERT_CHUNK_SIZE)) {
    const valuesSql = chunk.map(() => `(?, ?, ?, ?, ?)`).join(',\n         ');
    // employee_code is VARCHAR(50) and reason is VARCHAR(500) in 1638. A misdelimited file (a
    // semicolon-separated export, say) puts a whole line into one cell, and under strict mode an
    // over-length value is ER_DATA_TOO_LONG, which fails the entire rejection chunk — losing the
    // very records that exist to tell the uploader what went wrong. Truncated instead.
    const flatParams = chunk.flatMap((r) => [
      randomUUID(), batchId, r.rowNumber, r.employeeCode.slice(0, 50), r.reason.slice(0, 500),
    ]);
    try {
      await db.execute(
        `INSERT INTO productivity_upload_rejection (id, batch_id, source_row_number, employee_code, reason)
         VALUES ${valuesSql}`,
        flatParams,
      );
      actualRejected += chunk.length;
    } catch (err) {
      console.error('[productivity-upload] rejection chunk failed', err);
      writeErrors.push(
        `${chunk.length} rejection record(s) (rows ${chunk[0]!.rowNumber}-${chunk[chunk.length - 1]!.rowNumber}) could not be saved.`,
      );
    }
  }

  // Supersede LAST, and only if this submission actually contributed something.
  //
  // This UPDATE used to run before the chunk writes, which meant a re-upload whose every row was
  // rejected (or whose every chunk failed) still retired the prior batch: criterion 17.7 excludes
  // a superseded batch's rows from Canonical_Productive_Minutes, so real prior data was replaced
  // by nothing at all, while the caller was told the request succeeded. Deferring it here means
  // the worst case is the opposite and much safer one — the prior batch stays live and the
  // operator sees two batches to reconcile, rather than a silent hole in productive minutes.
  if (supersedeTargetId !== null && actualAccepted > 0) {
    try {
      await db.execute(
        `UPDATE productivity_upload_batch
            SET status = 'superseded', superseded_at = NOW(), superseded_by_batch_id = ?
          WHERE id = ? AND status <> 'superseded'`,
        [batchId, supersedeTargetId],
      );
    } catch (err) {
      console.error('[productivity-upload] supersede update failed', err);
      writeErrors.push(
        `this batch's rows were saved, but the prior batch ${supersedeTargetId} could not be marked superseded — both batches are currently live and must be reconciled by hand`,
      );
    }
  } else if (supersedeTargetId !== null) {
    writeErrors.push(
      `no rows were saved, so the prior batch ${supersedeTargetId} was deliberately left live rather than superseded by an empty upload`,
    );
  }

  // NOT `writeErrors.length > 0 || actualAccepted > 0` — that disjunct is backwards and was a
  // real bug caught in a second review round: it marks a batch 'accepted' whenever ANY write
  // error occurred, even a total failure (actualAccepted: 0, every row lost). Status must
  // reflect what actually landed, nothing else.
  const status = actualAccepted > 0 ? 'accepted' : 'rejected';

  // Wrapped, unlike every earlier draft. This INSERT runs AFTER the row chunks have landed, so an
  // uncaught throw here reports a total failure to a caller whose rows are in fact already in
  // apr_manual_upload — the caller retries, and the retry double-writes (the duplicate guard
  // cannot see a batch row that was never created). Reporting it as a write error instead keeps
  // the response honest about what happened and names the manual step needed.
  // file_name is VARCHAR(255) in 1638; multer's originalname is attacker-controlled and can
  // exceed that, which under strict mode would be exactly the failure described above.
  try {
    await db.execute(
      `INSERT INTO productivity_upload_batch
         (id, batch_reference, dialler_source_id, branch_id, process_id, date_from, date_to,
          file_name, content_digest, uploaded_by, submitted_row_count, accepted_row_count,
          rejected_row_count, mapping_version_used, supersedes_batch_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchId, batchReference, params.diallerSourceId, params.branchId, params.processId,
        params.dateFrom, params.dateTo, params.fileName.slice(0, 255), params.contentDigest,
        params.uploadedBy,
        params.acceptedRows.length + params.rejectedRows.length,
        actualAccepted, actualRejected, params.mappingVersionUsed,
        params.supersedesBatchId ?? null, status,
      ],
    );
  } catch (err) {
    console.error('[productivity-upload] batch row insert failed', err);
    writeErrors.push(
      `${actualAccepted} row(s) were saved but the batch record ${batchId} itself could not be written. Do NOT re-upload this file — the rows are already in the system and a re-upload would duplicate them; have this batch record created by hand instead.`,
    );
  }

  return { batchId, batchReference, acceptedCount: actualAccepted, rejectedCount: actualRejected, writeErrors };
}
