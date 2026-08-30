/**
 * Pulls eSign completion from the provider, because it is not reliably pushed.
 *
 * Luckpay's own integration notes (luckpay-status.service.ts) state the callback
 * is unreliable and completion is meant to be pull-based — but nothing ever called
 * syncEsignStatus. The result, verified on production: an employee completed a
 * genuine Aadhaar eSign and the transaction sat at PENDING with signed_file_id
 * NULL and no signed artefact anywhere. Every signature taken this way was lost.
 *
 * Deliberately NOT a fixed-interval poll of every open transaction. checkESignStatus
 * and downloadESignDocument may each be billed per call, so a naive poller can cost
 * more than the signing itself. Each transaction gets its own backoff schedule held
 * in DB columns (migration 1042) rather than an in-memory Map — the sibling
 * esign-compliance worker uses a Map, which resets on every restart and double-polls
 * under more than one instance.
 */
import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { env } from "../config/env.js";
import { syncEsignStatus } from "../modules/integrations/luckpay/luckpay-status.service.js";

/** How long to wait before the Nth attempt. The last value repeats. */
const BACKOFF_MINUTES = [2, 10, 30, 120, 360, 1440];

const TICK_MS = 5 * 60 * 1000;
const BATCH_SIZE = 25;
/** Stop chasing a transaction the provider clearly never completed. */
const GIVE_UP_AFTER_DAYS = 30;

/**
 * Status written when a transaction outlives GIVE_UP_AFTER_DAYS without the provider
 * ever reporting completion. Needs no DDL: employee_document_esign_transaction.status is
 * VARCHAR(80) NOT NULL DEFAULT 'initiated' (backend/sql/346_employee_joining_document_pack.sql:91),
 * not an ENUM, so a new value is a write and not a migration.
 */
const ABANDONED_STATUS = "abandoned_unresolved";

/** Action type on the abandonment Audit_Log row, so a sweep is never read as a real outcome. */
const ABANDONED_AUDIT_ACTION = "ESIGN_ABANDONED_UNRESOLVED";

// ABANDONED_STATUS is a member: the transition is a one-way door, which is what makes
// sweepAbandoned idempotent by construction — the `status NOT IN (TERMINAL)` guard it
// shares with claimBatch is the marker, so a second tick matches zero rows and no extra
// column or timestamp is needed.
const TERMINAL = ["signed", "completed", "failed", "expired", "cancelled", ABANDONED_STATUS];

function nextDelayMinutes(attempts: number) {
  return BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)];
}

type PendingRow = RowDataPacket & {
  id: string;
  client_transaction_id: string | null;
  poll_attempts: number;
};

type AbandonedCandidateRow = RowDataPacket & {
  id: string;
  employee_id: string | null;
  checklist_id: string | null;
  document_code: string | null;
  status: string | null;
  initiated_at: string | null;
};

/** Shared by the sweep's SELECT and its UPDATE, so the two can never drift apart. */
const ABANDONED_PREDICATE =
  `provider = 'luckpay'
     AND status NOT IN (${TERMINAL.map(() => "?").join(",")})
     AND initiated_at <= (NOW() - INTERVAL ? DAY)`;

/**
 * Write the Audit_Log row that says a transaction was abandoned unresolved.
 *
 * employee_joining_document_audit_log.employee_id is NOT NULL (sql/346_...:110), so a
 * transaction with no employee is logged and skipped rather than attempted — the same
 * decision the webhook rejection path makes at employee.compliance.routes.ts:577-580.
 * Failures here are reported, never swallowed: a silent .catch() is exactly how the kit
 * audit trail lost every row before joiningKitDispatch.service.ts:57-78 was fixed.
 */
async function recordAbandonmentAudit(row: AbandonedCandidateRow) {
  if (!row.employee_id) {
    console.error(
      `[esign-reconciliation] ${ABANDONED_AUDIT_ACTION} audit row skipped for transaction ${row.id}: ` +
        `employee_id is NULL and employee_joining_document_audit_log.employee_id is NOT NULL.`,
    );
    return;
  }
  try {
    await db.execute(
      `INSERT INTO employee_joining_document_audit_log
         (id, employee_id, checklist_id, document_code, action_type, old_value, new_value, remarks, actor_user_id, actor_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'system', NOW())`,
      [
        randomUUID(),
        row.employee_id,
        row.checklist_id ?? null,
        row.document_code ?? null,
        ABANDONED_AUDIT_ACTION,
        JSON.stringify({ status: row.status ?? null }),
        JSON.stringify({
          status: ABANDONED_STATUS,
          esignTransactionId: row.id,
          provider: "luckpay",
          giveUpAfterDays: GIVE_UP_AFTER_DAYS,
          initiatedAt: row.initiated_at ?? null,
        }),
        `Abandoned after ${GIVE_UP_AFTER_DAYS} days without provider completion`,
      ],
    );
  } catch (error) {
    console.error(
      `[esign-reconciliation] ${ABANDONED_AUDIT_ACTION} audit write failed for transaction ${row.id} (employee ${row.employee_id}):`,
      error,
    );
  }
}

/**
 * Record every transaction that has outlived the give-up window, and return how many moved.
 *
 * Runs first in each tick, before claimBatch, because claimBatch's
 * `initiated_at > (NOW() - INTERVAL ? DAY)` predicate makes the give-up window silent: a
 * transaction simply stops being selected, and nothing anywhere says it was abandoned
 * rather than still waiting (R1.7). The window is unchanged — this only makes leaving it
 * legible, in the transaction row and in the Audit_Log.
 *
 * The rows are SELECTed before the UPDATE on purpose: afterwards their status is terminal,
 * so the same predicate no longer matches them and there is nothing left to attribute the
 * audit rows to. The UPDATE's affectedRows is what is returned, so the count reports what
 * the database actually did rather than what was intended.
 *
 * error_message is deliberately written here and NOT cleared anywhere: on an abandoned
 * transaction the message is the record.
 */
async function sweepAbandoned(): Promise<number> {
  const [candidates] = await db.execute<AbandonedCandidateRow[]>(
    `SELECT id, employee_id, checklist_id, document_code, status, initiated_at
       FROM employee_document_esign_transaction
      WHERE ${ABANDONED_PREDICATE}`,
    [...TERMINAL, GIVE_UP_AFTER_DAYS],
  );
  if (!candidates.length) return 0;

  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE employee_document_esign_transaction
        SET status = '${ABANDONED_STATUS}',
            error_message = CONCAT('Abandoned after ', ?, ' days without provider completion'),
            next_poll_at = NULL,
            updated_at = NOW()
      WHERE ${ABANDONED_PREDICATE}`,
    [GIVE_UP_AFTER_DAYS, ...TERMINAL, GIVE_UP_AFTER_DAYS],
  );
  const swept = Number(result.affectedRows ?? 0);
  if (swept !== candidates.length) {
    // Not an error: a transaction may have settled between the SELECT and the UPDATE, in
    // which case its real outcome won, correctly. Logged because the alternative reading —
    // audit rows written for transactions that were never transitioned — matters to whoever
    // reconciles the two later.
    console.warn(
      `[esign-reconciliation] abandonment sweep selected ${candidates.length} transaction(s) but transitioned ${swept}`,
    );
  }

  for (const row of candidates) {
    await recordAbandonmentAudit(row);
  }
  return swept;
}

async function claimBatch(): Promise<PendingRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, client_transaction_id, poll_attempts
       FROM employee_document_esign_transaction
      WHERE provider = 'luckpay'
        AND status NOT IN (${TERMINAL.map(() => "?").join(",")})
        AND client_transaction_id IS NOT NULL
        AND provider_reference_id IS NOT NULL
        AND initiated_at > (NOW() - INTERVAL ? DAY)
        AND (next_poll_at IS NULL OR next_poll_at <= NOW())
      ORDER BY next_poll_at IS NOT NULL, next_poll_at
      LIMIT ${BATCH_SIZE}`,
    [...TERMINAL, GIVE_UP_AFTER_DAYS],
  );
  return rows as PendingRow[];
}

/** Push a transaction out to its next backoff slot so it is not re-polled immediately. */
async function scheduleNext(id: string, attempts: number) {
  await db.execute(
    `UPDATE employee_document_esign_transaction
        SET poll_attempts = ?,
            last_polled_at = NOW(),
            next_poll_at = (NOW() + INTERVAL ? MINUTE),
            updated_at = updated_at
      WHERE id = ?`,
    [attempts, nextDelayMinutes(attempts), id],
  );
}

/**
 * Longest failure text kept in error_message.
 *
 * The column is TEXT (backend/sql/346_employee_joining_document_pack.sql:96) so it is
 * not tight, but a provider outage can hand back an HTML error page or a whole stack
 * trace, and a row of that is worth nothing to whoever reads it. Trimmed to the part
 * that identifies the failure.
 */
const ERROR_MESSAGE_MAX = 1000;

function truncateFailureMessage(message: string) {
  const trimmed = message.trim();
  return trimmed.length > ERROR_MESSAGE_MAX ? trimmed.slice(0, ERROR_MESSAGE_MAX) : trimmed;
}

/**
 * Record a failed provider call against the transaction and reschedule it.
 *
 * One UPDATE, not two, and deliberately so: a failure must not be recordable without
 * also being rescheduled, and a reschedule must not silently drop the reason. Without
 * the error_message write a transaction that has failed six times reads in the database
 * exactly like one that has succeeded six times — same poll_attempts, same last_polled_at.
 *
 * The ladder step is the same nextDelayMinutes(attempts) scheduleNext uses: a provider
 * outage must not burn the backoff budget faster than a real pending signature would.
 */
async function recordPollFailure(id: string, attempts: number, message: string) {
  await db.execute(
    `UPDATE employee_document_esign_transaction
        SET error_message = ?,
            poll_attempts = ?,
            last_polled_at = NOW(),
            next_poll_at = (NOW() + INTERVAL ? MINUTE),
            updated_at = updated_at
      WHERE id = ?`,
    [truncateFailureMessage(message), attempts, nextDelayMinutes(attempts), id],
  );
}

/**
 * Settle a transaction that needs no further polling.
 *
 * `poll_attempts` is written here as well as in scheduleNext: a transaction that
 * completes on its first poll would otherwise record 0, indistinguishable from one
 * that was never polled at all. It also makes SUM(poll_attempts) an honest count of
 * billed checkESignStatus calls.
 *
 * A stale error_message is cleared here because recordPollFailure writes one and nothing
 * ever unset it: a transaction that failed two polls and then completed read as completed
 * while still carrying the text of a failure it had recovered from. On the kit path that
 * is the live case — finalizeKitEsign never touches error_message, and the document path's
 * own UPDATE (luckpay-status.service.ts:501) already nulls it, so clearing is a no-op there.
 *
 * Guarded by `status = 'failed'` rather than written flat, because the caller reaches this
 * function for BOTH settled outcomes. On the failure outcome syncEsignStatus has just
 * written the provider's own reason into error_message
 * (luckpay-status.service.ts:433-437), and a flat NULL here would erase it a moment later —
 * turning a recorded provider failure back into the silence gap 3 exists to close. The
 * abandonment sweep does not come through here at all: there the message IS the record.
 */
async function clearSchedule(id: string, attempts: number) {
  await db.execute(
    `UPDATE employee_document_esign_transaction
        SET poll_attempts = ?,
            error_message = IF(status = 'failed', error_message, NULL),
            next_poll_at = NULL,
            last_polled_at = NOW(),
            updated_at = updated_at
      WHERE id = ?`,
    [attempts, id],
  );
}

/**
 * Per-tick count of billable provider calls this run made (R11.6).
 *
 * In-memory and therefore per-tick only — the durable, invoice-comparable surfaces are
 * elsewhere and are the ones to reconcile a bill against:
 *   - status:   SUM(poll_attempts) over employee_document_esign_transaction.
 *   - download: rows in employee_joining_document_file with
 *               file_role IN ('signed','kit_signed') AND uploaded_by_type = 'system'.
 * Both survive a restart; this counter does not. It exists so a tick states its own spend
 * immediately, in the log line and in the return value.
 *
 * Deliberately NOT routed through candidate_bgv_api_request_log: writeBgvApiLog requires a
 * candidateId (bgv-api-log.service.ts:29) and a joining-kit transaction may carry a NULL
 * candidate_id, so logging kit polls there would either drop rows or fabricate a candidate.
 */
export type ProviderCallCounts = { status: number; download: number };

export async function runEsignReconciliationOnce(): Promise<{
  examined: number;
  completed: number;
  stillPending: number;
  errors: number;
  providerCalls: ProviderCallCounts;
}> {
  // First, before claimBatch: a transaction past the give-up window has to be recorded as
  // abandoned, because claimBatch's initiated_at predicate is about to stop selecting it
  // silently (R1.7). Wrapped rather than awaited bare — a sweep that cannot write must not
  // cost the batch its poll, which is the one thing this worker exists to do.
  let swept = 0;
  try {
    swept = await sweepAbandoned();
  } catch (error) {
    console.warn("[esign-reconciliation] abandonment sweep failed, continuing with the batch:", error);
  }

  const rows = await claimBatch();
  let completed = 0;
  let stillPending = 0;
  let errors = 0;
  const providerCalls: ProviderCallCounts = { status: 0, download: 0 };

  for (const row of rows) {
    const attempts = Number(row.poll_attempts ?? 0) + 1;
    try {
      // Counted before the await, not after, and counted for throws too: a call that
      // failed in transit was still made and may still be billed. Every row claimBatch
      // hands back reaches the provider — syncEsignStatus' two call-free early returns
      // are unreachable from here, since it short-circuits only on
      // `status IN ('signed','completed') AND signed_file_id IS NOT NULL` and bails on a
      // missing provider_reference_id, and claimBatch already excludes both by predicate.
      providerCalls.status += 1;
      const outcome = await syncEsignStatus(String(row.client_transaction_id));
      // Derived from the return value rather than observed: syncEsignStatus owns the
      // download and does not report it directly. On `state === 'completed'` BOTH of its
      // completion branches make exactly one downloadESignDocument call inside a
      // try/catch — the kit branch via finalizeKitEsign (joiningKitDispatch.service.ts:508)
      // and the document branch inline (luckpay-status.service.ts:461) — so a completed
      // outcome implies one download attempt, and a non-completed outcome implies none
      // (R11.3). `changed !== false` excludes the artefact-already-in-hand short-circuit,
      // which returns completed having called nothing.
      //
      // Note storedFiles is NOT used for this: it is only populated when the download
      // succeeded AND persisted, and the kit branch discards it entirely, so it would
      // undercount exactly the failed-download case that still costs money.
      if (outcome.state === "completed" && outcome.changed !== false) {
        providerCalls.download += 1;
      }
      if (outcome.state === "completed" || outcome.state === "failed") {
        await clearSchedule(row.id, attempts);
        completed += 1;
        console.log(`[esign-reconciliation] ${row.client_transaction_id} -> ${outcome.state}`);
      } else {
        await scheduleNext(row.id, attempts);
        stillPending += 1;
      }
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      // Swallowed on purpose: one transaction's failure — including a failure to write
      // down that failure — must not abort the batch (R1.6). The remaining rows are
      // still polled, and the console.warn below is unconditional so the failure is
      // never invisible even if the DB write is the thing that went wrong.
      await recordPollFailure(row.id, attempts, message).catch(() => undefined);
      // Kept alongside the DB row: the log serves whoever is watching the tick, the
      // row serves whoever queries the transaction later.
      console.warn(`[esign-reconciliation] ${row.client_transaction_id} failed:`, message);
    }
  }

  // Unconditional on purpose. Guarded by `if (rows.length)`, a running worker that
  // found nothing printed nothing, so "enabled and idle" read exactly like "never
  // started" — the state production sat in with last_polled_at NULL on every
  // transaction and no way to tell from the logs whether the worker existed.
  console.log(
    `[esign-reconciliation] enabled=${env.ESIGN_RECONCILIATION_ENABLED} swept=${swept} selected=${rows.length} ` +
      `completed=${completed} pending=${stillPending} errors=${errors} ` +
      `providerCalls=status:${providerCalls.status},download:${providerCalls.download}`,
  );
  // stillPending is kept under that name deliberately — the log line calls it `pending`,
  // but existing readers of the return value use `stillPending`.
  return { examined: rows.length, completed, stillPending, errors, providerCalls };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function startEsignReconciliationWorker(): Promise<void> {
  // Default off. Turn on only once per-call billing for checkESignStatus and
  // downloadESignDocument has been confirmed with the vendor.
  if (!env.ESIGN_RECONCILIATION_ENABLED) {
    console.log("[esign-reconciliation] disabled (ESIGN_RECONCILIATION_ENABLED is not true)");
    return;
  }
  if (intervalHandle) return;

  intervalHandle = setInterval(() => {
    // Never let a slow provider stack overlapping runs.
    if (running) return;
    running = true;
    void runEsignReconciliationOnce()
      .catch((error) => console.warn("[esign-reconciliation] tick failed:", error))
      .finally(() => { running = false; });
  }, TICK_MS);

  console.log(`[esign-reconciliation] started (every ${TICK_MS / 60000}m, batch ${BATCH_SIZE})`);
}

export function stopEsignReconciliationWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
