//
// Attribution for the LEGACY apr-bulk manual upload route (attendance-apr-bulk.routes.ts),
// closing requirements.md criterion 17.10: "reject any manual write to `apr` that carries no
// Dialler_Source attribution and no upload batch identifier, so that the unattributed path that
// produced the 3,810 existing 'MANUAL_UPLOAD' rows with empty process_name and empty branch_name
// is closed."
//
// That route's phase-3 evidence write used a hardcoded campaign_id = 'MANUAL_UPLOAD' and never set
// upload_batch_id. This module supplies the two things it was missing:
//
//   1. resolveAprBulkUploadAttribution() - one registered Dialler_Source (source_key
//      'APR_BULK_MANUAL', ingestion_mode 'manual_upload') and one campaign_master row owned by it,
//      both resolve-or-create, idempotent and race-safe.
//   2. createAprBulkUploadBatch() / finaliseAprBulkUploadBatch() - a real
//      productivity_upload_batch row (migration 1638) for every apr row the route writes, so
//      `apr.upload_batch_id` stops being NULL on every one of the table's 46,163 rows.
//
// WHY THIS IS NOT productivity-upload-commit.service.ts's resolveOrCreateDefaultCampaign()
//
// The idempotent pattern here is deliberately the same one that function proved (SELECT, then
// INSERT ... ON DUPLICATE KEY UPDATE as a no-op, then re-SELECT so whichever writer won the race
// is the one both callers read, then a named error rather than an unguarded rows[0] if the
// re-SELECT still finds nothing). Only the campaign CODE differs, and it differs for one specific
// reason worth stating rather than discovering later:
//
//   That function's code is `DEFAULT_<diallerSourceId>` - 8 + 36 = 44 characters. It writes into
//   `apr_manual_upload.campaign_id VARCHAR(100)` (verified live), which has room. THIS module
//   writes into `apr.campaign_id`, which is part of that legacy imported table's PRIMARY KEY
//   (ReportDate, UserID, campaign_id) and whose declared length cannot be verified from this
//   repository - backend/sql/schema-snapshot.json records column NAMES only, and CLAUDE.md forbids
//   running SQL to check. What IS known is that 3,810 rows hold the 13-character string
//   'MANUAL_UPLOAD', so any value of 13 characters or fewer provably fits. APR_BULK_CAMPAIGN_CODE
//   below is 8 characters. A 44-character code could be ER_DATA_TOO_LONG under strict mode on a
//   live route, which is not a risk worth taking to share one function.

import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

/**
 * The stable source_key of the one Dialler_Source that owns everything this legacy route uploads.
 *
 * One source, not one per branch: the route's CSV contract is exactly three columns
 * (employee_code, attendance_date, net_login_minutes) consumed by src/components/attendance/
 * AprBulkUpload.tsx, so a submission names no source, no branch and no process. Requirement 17's
 * real upload pipeline (productivity-upload.routes.ts) is where an uploader names a specific
 * registered source; this route's rows are honestly attributable only to "the hand-driven CSV
 * route", and inventing a per-branch source from an employee's branch_id would assert a
 * registration decision nobody made.
 */
export const APR_BULK_SOURCE_KEY = 'APR_BULK_MANUAL';

/**
 * The campaign_code every apr row this route writes carries, replacing the bare 'MANUAL_UPLOAD'
 * sentinel.
 *
 * `apr.campaign_id` holds a campaign CODE, not a CHAR(36) id. Three independent confirmations:
 * design.md's own resolution table ("`apr` source=`sync` | `campaign_id` |
 * `campaign_master.campaign_code` -> `campaign_master.dialler_source_id`"); two live production
 * queries that join it as a code (quality-dashboard.routes.ts and performance-dashboard.routes.ts
 * both do `LEFT JOIN mas_hrms.process_master pm ON pm.process_code = apr.campaign_id`); and the
 * 78 free-text values already in the column, which design.md says are to be seeded into
 * campaign_master as `campaign_code` rows. Writing the campaign UUID here instead would split an
 * employee's day across two campaign keys - the sync feed's code and this route's id - which
 * getAprNetMinutes would SUM as two separate campaigns and nothing would resolve back to a
 * Dialler_Source.
 *
 * Kept to 8 characters on purpose - see this file's header for why length matters here and not in
 * apr_manual_upload.
 */
export const APR_BULK_CAMPAIGN_CODE = 'APR_BULK';

interface IdRow extends RowDataPacket {
  id: string;
}

export interface AprBulkAttribution {
  diallerSourceId: string;
  campaignCode: string;
}

/**
 * Resolves (creating on first use) the Dialler_Source this route's uploads belong to.
 *
 * Idempotent and race-safe: the INSERT is a no-op ON DUPLICATE KEY (source_key is UNIQUE via
 * uq_dialler_source_key, migration 1636), and the re-SELECT afterwards returns whichever row
 * actually won a concurrent race rather than the id this call happened to generate.
 */
async function resolveOrCreateAprBulkSource(createdBy: string | null): Promise<string> {
  const [existing] = await db.execute<IdRow[]>(
    `SELECT id FROM dialler_source WHERE source_key = ? LIMIT 1`,
    [APR_BULK_SOURCE_KEY],
  );
  if (existing.length > 0) return existing[0]!.id;

  // metric_availability is JSON NOT NULL (1636) and is validated against PRODUCTIVITY_METRICS at
  // the application layer (dialler-source-registry.service.ts). This route's CSV can supply
  // exactly one of the fourteen controlled metrics - net login minutes - so declaring anything
  // else would claim coverage the file cannot provide and make a later aggregation read a metric
  // that is never populated.
  //
  // effective_from is DATE NOT NULL. It is set 90 days back, not to today, because parseCsv()
  // accepts an attendance_date up to 90 days old: a source effective only from today would fail
  // the effective-window check in resolveActiveDiallerSource() for exactly the backdated rows
  // this route exists to carry. The window is relative to the day the source is first created and
  // stays sufficient forever, since the route's own 90-day floor slides forward with the clock.
  await db.execute(
    `INSERT INTO dialler_source
       (id, source_key, display_name, ingestion_mode, integration_key,
        owning_branch_id, owning_process_id, metric_availability,
        effective_from, active_status, created_by)
     VALUES (?, ?, ?, 'manual_upload', NULL,
             NULL, NULL, ?,
             DATE_SUB(CURDATE(), INTERVAL 90 DAY), 1, ?)
     ON DUPLICATE KEY UPDATE source_key = source_key`,
    [
      randomUUID(),
      APR_BULK_SOURCE_KEY,
      'APR Bulk Manual Upload (attendance CSV route)',
      JSON.stringify(['net_login']),
      createdBy,
    ],
  );

  const [rows] = await db.execute<IdRow[]>(
    `SELECT id FROM dialler_source WHERE source_key = ? LIMIT 1`,
    [APR_BULK_SOURCE_KEY],
  );
  if (rows.length === 0) {
    throw new Error(
      `dialler_source ${APR_BULK_SOURCE_KEY} could not be resolved after its INSERT - refusing to write unattributed apr rows`,
    );
  }
  return rows[0]!.id;
}

/**
 * Resolves (creating on first use) the one campaign owned by that source.
 *
 * is_sentinel stays 0: criterion 16.8's sentinel flag marks a campaign the canonical aggregator
 * EXCLUDES, which is what the old system-wide 'MANUAL_UPLOAD' catch-all deserved. These rows carry
 * real uploaded minutes and must count.
 *
 * process_id and lob_id stay NULL. One apr-bulk file spans many processes (its rows are keyed by
 * employee code alone), so naming one process here would assert an ownership the file never
 * declared; both columns are nullable with ON DELETE SET NULL foreign keys (015_platform_
 * foundation.sql).
 */
async function resolveOrCreateAprBulkCampaign(diallerSourceId: string): Promise<string> {
  const [existing] = await db.execute<IdRow[]>(
    `SELECT id FROM campaign_master WHERE campaign_code = ? LIMIT 1`,
    [APR_BULK_CAMPAIGN_CODE],
  );

  if (existing.length === 0) {
    await db.execute(
      `INSERT INTO campaign_master
         (id, campaign_code, campaign_name, dialler_source_id, is_sentinel, active_status)
       VALUES (?, ?, ?, ?, 0, 1)
       ON DUPLICATE KEY UPDATE campaign_code = campaign_code`,
      [
        randomUUID(),
        APR_BULK_CAMPAIGN_CODE,
        'APR bulk manual upload (attendance CSV route)',
        diallerSourceId,
      ],
    );

    const [rows] = await db.execute<IdRow[]>(
      `SELECT id FROM campaign_master WHERE campaign_code = ? LIMIT 1`,
      [APR_BULK_CAMPAIGN_CODE],
    );
    if (rows.length === 0) {
      throw new Error(
        `campaign_master ${APR_BULK_CAMPAIGN_CODE} could not be resolved after its INSERT - refusing to write unattributed apr rows`,
      );
    }
  }

  return APR_BULK_CAMPAIGN_CODE;
}

/**
 * The whole attribution the route needs, resolved once per request rather than per row.
 *
 * Throws on any failure. The caller must treat a throw as "the evidence phase cannot run" and
 * report it per row - never as "write the row without attribution", which is the defect criterion
 * 17.10 exists to close and which the trigger in migration 1640 rejects at the database.
 */
export async function resolveAprBulkUploadAttribution(
  createdBy: string | null,
): Promise<AprBulkAttribution> {
  const diallerSourceId = await resolveOrCreateAprBulkSource(createdBy);
  const campaignCode = await resolveOrCreateAprBulkCampaign(diallerSourceId);
  return { diallerSourceId, campaignCode };
}

export interface AprBulkBatchScope {
  branchId: string;
  processId: string;
  dateFrom: string;
  dateTo: string;
  fileName: string;
  contentDigest: string;
  uploadedBy: string;
  submittedRowCount: number;
}

/**
 * Creates the productivity_upload_batch row a group of apr rows will point at, and returns its id.
 *
 * Written BEFORE the apr rows, and finalised after - the opposite order to
 * productivity-upload-commit.service.ts, deliberately. That service writes its batch row last so
 * its counts can be honest about what actually landed, accepting that its rows briefly reference a
 * batch id that does not exist yet. Here that trade is the wrong way round: `apr.upload_batch_id`
 * pointing at a row that was never created is precisely the unattributed state migration 1640's
 * trigger and criterion 17.10 exist to prevent, and it would be indistinguishable after the fact
 * from the 3,810 legacy rows. So the row is created first with 1638's own 'pending' status and
 * zero counts, and finaliseAprBulkUploadBatch() records the real outcome; a failure to finalise
 * leaves a visibly pending batch, which is a bookkeeping problem an operator can see and fix
 * rather than a silent hole in attribution.
 *
 * `mapping_version_used` stays NULL (nullable in 1638): criterion 17.14's Column_Mapping applies to
 * the new pipeline's configurable files. This route's CSV contract is three fixed columns, so there
 * is no mapping version to record - and recording 1 would claim a mapping that does not exist.
 */
export async function createAprBulkUploadBatch(
  diallerSourceId: string,
  scope: AprBulkBatchScope,
): Promise<string> {
  const batchId = randomUUID();
  // Prefixed rather than the bare uuid productivity-upload-commit.service.ts uses, so a batch from
  // this legacy CSV route is identifiable at a glance on the Upload_Batch history screen
  // (criterion 17.13) without joining back to dialler_source. 8 + 36 = 44 chars, inside
  // batch_reference VARCHAR(100).
  const batchReference = `APRBULK-${batchId}`;

  await db.execute(
    `INSERT INTO productivity_upload_batch
       (id, batch_reference, dialler_source_id, branch_id, process_id, date_from, date_to,
        file_name, content_digest, uploaded_by, submitted_row_count, accepted_row_count,
        rejected_row_count, mapping_version_used, supersedes_batch_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, 'pending')`,
    [
      batchId, batchReference, diallerSourceId, scope.branchId, scope.processId,
      scope.dateFrom, scope.dateTo,
      // file_name is VARCHAR(255) and content_digest is CHAR(64); multer's originalname is
      // caller-controlled, so it is truncated rather than allowed to fail the batch under strict
      // mode - the same defence productivity-upload-commit.service.ts applies.
      scope.fileName.slice(0, 255), scope.contentDigest,
      scope.uploadedBy, scope.submittedRowCount,
    ],
  );

  return batchId;
}

/**
 * Records what the batch actually achieved (criterion 17.11: accepted + rejected = submitted).
 *
 * status follows what landed, never what was attempted: 'accepted' only if at least one row saved,
 * otherwise 'rejected'. Never left at 'pending' by a completed request.
 */
export async function finaliseAprBulkUploadBatch(
  batchId: string,
  acceptedCount: number,
  rejectedCount: number,
): Promise<void> {
  await db.execute(
    `UPDATE productivity_upload_batch
        SET accepted_row_count = ?, rejected_row_count = ?, status = ?
      WHERE id = ?`,
    [acceptedCount, rejectedCount, acceptedCount > 0 ? 'accepted' : 'rejected', batchId],
  );
}
