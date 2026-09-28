/**
 * Self-healing for bulk-upload imports that die on a database lock, so nobody has to notice,
 * end a database session or re-run anything by hand.
 *
 * THE INCIDENT (BATCH-1790414059915, GS1_EMAIL_DAILY, 26,924 rows, 2026-09-26). The import wrote
 * its 690 summary rows, then flagged all 26,924 staged rows with ONE `UPDATE ... WHERE id IN (...)`.
 * That statement ran for over two hours holding row locks on upload_batch_row, every other upload
 * behind it failed with "Lock wait timeout exceeded", and the batch ended 'failed' with
 * imported_rows = 0 although its data was already in. Someone had to find it and KILL the session.
 * (The statement is now chunked - see batch-row-status.ts - this is the safety net for the next
 * thing that goes wrong the same way.)
 *
 * WHAT THIS DOES, on every sweep of the stale-batch worker:
 *   1. Ends a database session that has been writing upload_batch_row for far longer than any
 *      healthy statement (killStuckRowSessions). That releases the locks everything else waits on.
 *   2. Re-queues a batch that failed for a transient reason when its import is safe to run twice,
 *      at most MAX_AUTO_RETRIES times.
 *   3. Tells the super_admins (work inbox + email) when it killed a session, or when a batch
 *      needs a human because it cannot be retried automatically or retries ran out.
 *
 * WHY ONLY SOME IMPORTS ARE RETRIED. A failed import may already have written its target rows
 * before it failed (exactly what happened here). Running it again is harmless only when every write
 * is an upsert against a UNIQUE key. Anything that inserts plain rows, or moves money or leave,
 * would double-write, so it stays 'failed' with an alert. AUTO_RETRY_SAFE_RPCS lists the imports
 * checked against the live schema on 2026-09-26; to add one, confirm its target table has a UNIQUE
 * key that matches its ON DUPLICATE KEY UPDATE and that every INSERT in the importer is such an upsert.
 */

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { alertAdmins } from "./batch-recovery-alert.js";

export const AUTO_RETRY_SAFE_RPCS: ReadonlySet<string> = new Set([
  "import_bella_repeat_alignment_batch",
  "import_bla_bli_blu_after_hour_batch",
  "import_bla_bli_blu_auto_callback_batch",
  "import_bla_bli_blu_call_disposition_batch",
  "import_bla_bli_blu_overall_sales_batch",
  "import_bla_bli_blu_shopify_sales_batch",
  "import_clovia_chat_daily_batch",
  "import_clovia_crm_disposition_batch",
  "import_clovia_email_daily_batch",
  "import_clovia_feedback_batch",
  "import_clovia_quality_audit_batch",
  "import_clovia_rechurn_calls_batch",
  "import_clovia_team_alignment_batch",
  "import_domestic_billing_approved_hc_batch",
  "import_du_apr_korea_batch",
  "import_du_apr_thailand_batch",
  "import_du_team_mapping_korea_batch",
  "import_du_team_mapping_thailand_batch",
  "import_email_ticket_daily_batch",
  "import_gs1_approval_audit_batch",
  "import_gs1_datakart_daily_batch",
  "import_gs1_email_daily_batch",
  "import_housing_owner_incentive_batch",
  "import_housing_owner_lead_pipeline_batch",
  "import_housing_owner_sale_raw_batch",
  "import_housing_premium_agent_target_batch",
  "import_housing_premium_sale_raw_batch",
  "import_lp_apr_daily_batch",
  "import_lp_cr_report_non_regional_batch",
  "import_lp_cr_report_regional_batch",
  "import_lp_leads_non_regional_batch",
  "import_lp_leads_regional_batch",
  "import_process_delivery_batch",
  "import_process_manual_kpi_batch",
  "import_reginald_abandoned_cart_sales_batch",
]);

export const MAX_AUTO_RETRIES = 2;
/** Leave a failure alone this long first, so a person already retrying it is not raced. */
export const RETRY_AFTER_MINUTES = 3;
/** Older failures are history, not something to resurrect. */
export const RETRY_WINDOW_HOURS = 24;
/** No healthy upload_batch_row statement runs this long (a chunked one takes milliseconds). */
export const STUCK_SESSION_SECONDS = 15 * 60;

const TRANSIENT_FAILURE_PATTERNS: readonly RegExp[] = [
  /lock wait timeout/i,
  /deadlock found/i,
  /job tracking it was lost/i,
  /server has gone away/i,
];

export function isTransientFailure(
  errorSummary: string | null | undefined,
): boolean {
  const text = String(errorSummary ?? "");
  return TRANSIENT_FAILURE_PATTERNS.some((re) => re.test(text));
}

export function isAutoRetrySafe(rpcName: string | null | undefined): boolean {
  return !!rpcName && AUTO_RETRY_SAFE_RPCS.has(rpcName);
}

export interface RecoveryResult {
  killedSessions: number[];
  requeued: string[];
  needsHuman: Array<{ batch: string; reason: string }>;
}

/** Sessions of this app's own DB user stuck writing upload_batch_row. Ends them so locks free up. */
export async function killStuckRowSessions(
  thresholdSeconds = STUCK_SESSION_SECONDS,
): Promise<number[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ID, TIME FROM information_schema.PROCESSLIST
      WHERE USER = SUBSTRING_INDEX(USER(), '@', 1)
        AND COMMAND = 'Query'
        AND ID <> CONNECTION_ID()
        AND TIME > ?
        AND (INFO LIKE 'UPDATE upload_batch_row%' OR INFO LIKE 'INSERT INTO upload_batch_row%')`,
    [thresholdSeconds],
  );
  const killed: number[] = [];
  for (const row of rows) {
    const id = Number(row.ID);
    if (!Number.isInteger(id) || id <= 0) continue;
    try {
      // KILL cannot take a bound parameter; `id` is a validated integer.
      await db.query(`KILL ${id}`);
      killed.push(id);
      await alertAdmins({
        dedupeKey: `kill-${id}`,
        title: "Bulk upload: a stuck database session was ended automatically",
        message:
          `A database session (#${id}) had been writing bulk-upload rows for ${Math.round(Number(row.TIME) / 60)} ` +
          `minutes and was holding locks that block other uploads. It was ended automatically. Failed imports ` +
          `that are safe to repeat are re-run automatically; check Bulk Upload Hub for any others.`,
      });
    } catch (error) {
      console.error(
        `[batch-auto-recovery] could not kill session ${id}:`,
        error,
      );
    }
  }
  return killed;
}

interface FailedBatchRow extends RowDataPacket {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  error_summary: string | null;
  uploaded_by: string | null;
  rpc: string | null;
  import_user: string | null;
  retries: number | null;
}

/** Re-queues transient failures of retry-safe imports; alerts admins about the ones it cannot. */
export async function requeueTransientFailures(): Promise<
  Pick<RecoveryResult, "requeued" | "needsHuman">
> {
  const [rows] = await db.query<FailedBatchRow[]>(
    `SELECT id, upload_batch_no, upload_type_code, error_summary, uploaded_by,
            JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.import_rpc_name'))  AS rpc,
            JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.import_user_id'))   AS import_user,
            CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.auto_retry_count')) AS UNSIGNED) AS retries
       FROM upload_batch
      WHERE batch_status = 'failed'
        AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
        AND updated_at > DATE_SUB(NOW(), INTERVAL ? HOUR)`,
    [RETRY_AFTER_MINUTES, RETRY_WINDOW_HOURS],
  );

  const requeued: string[] = [];
  const needsHuman: Array<{ batch: string; reason: string }> = [];
  for (const b of rows) {
    if (!isTransientFailure(b.error_summary)) continue;
    const attempts = Number(b.retries ?? 0);
    let reason: string | null = null;
    if (!isAutoRetrySafe(b.rpc)) {
      reason = b.rpc
        ? "this import type is not marked safe to repeat automatically"
        : "it was started before automatic recovery existed, so its import function is unknown";
    } else if (attempts >= MAX_AUTO_RETRIES) {
      reason = `it already failed ${attempts + 1} times, including ${attempts} automatic retries`;
    }
    if (reason) {
      needsHuman.push({ batch: b.upload_batch_no, reason });
      await alertAdmins({
        dedupeKey: `needs-human-${b.id}`,
        title: `Bulk upload ${b.upload_batch_no} needs attention`,
        message:
          `${b.upload_batch_no} (${b.upload_type_code}) failed on a temporary database problem ` +
          `and was not re-run automatically because ${reason}. Last error: ${String(b.error_summary ?? "").slice(0, 200)}`,
      });
      continue;
    }
    if (await requeueOne(b, attempts + 1)) requeued.push(b.upload_batch_no);
  }
  return { requeued, needsHuman };
}

async function requeueOne(
  b: FailedBatchRow,
  attempt: number,
): Promise<boolean> {
  const note = `Auto-retry ${attempt}/${MAX_AUTO_RETRIES} after: ${String(b.error_summary ?? "").slice(0, 300)}`;
  const [claim] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch
        SET batch_status = 'importing', error_summary = ?, updated_at = NOW(),
            metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()), '$.auto_retry_count', ?)
      WHERE id = ? AND batch_status = 'failed'`,
    [note, attempt, b.id],
  );
  if (claim.affectedRows === 0) return false;

  const userId = b.import_user || b.uploaded_by;
  await db.execute(
    `INSERT INTO bulk_import_queue (id, batch_id, rpc_name, user_id, queued_at)
     VALUES (UUID(), ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE rpc_name = VALUES(rpc_name), user_id = VALUES(user_id),
                             queued_at = NOW(), claimed_at = NULL`,
    [b.id, b.rpc, userId],
  );
  return true;
}

export async function runBatchAutoRecovery(): Promise<RecoveryResult> {
  const killedSessions = await killStuckRowSessions();
  const { requeued, needsHuman } = await requeueTransientFailures();
  return { killedSessions, requeued, needsHuman };
}
