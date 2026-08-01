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
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { env } from "../config/env.js";
import { syncEsignStatus } from "../modules/integrations/luckpay/luckpay-status.service.js";

/** How long to wait before the Nth attempt. The last value repeats. */
const BACKOFF_MINUTES = [2, 10, 30, 120, 360, 1440];

const TICK_MS = 5 * 60 * 1000;
const BATCH_SIZE = 25;
/** Stop chasing a transaction the provider clearly never completed. */
const GIVE_UP_AFTER_DAYS = 30;

const TERMINAL = ["signed", "completed", "failed", "expired", "cancelled"];

function nextDelayMinutes(attempts: number) {
  return BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)];
}

type PendingRow = RowDataPacket & {
  id: string;
  client_transaction_id: string | null;
  poll_attempts: number;
};

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

async function clearSchedule(id: string) {
  await db.execute(
    `UPDATE employee_document_esign_transaction
        SET next_poll_at = NULL, last_polled_at = NOW(), updated_at = updated_at
      WHERE id = ?`,
    [id],
  );
}

export async function runEsignReconciliationOnce(): Promise<{
  examined: number;
  completed: number;
  stillPending: number;
  errors: number;
}> {
  const rows = await claimBatch();
  let completed = 0;
  let stillPending = 0;
  let errors = 0;

  for (const row of rows) {
    const attempts = Number(row.poll_attempts ?? 0) + 1;
    try {
      const outcome = await syncEsignStatus(String(row.client_transaction_id));
      if (outcome.state === "completed" || outcome.state === "failed") {
        await clearSchedule(row.id);
        completed += 1;
        console.log(`[esign-reconciliation] ${row.client_transaction_id} -> ${outcome.state}`);
      } else {
        await scheduleNext(row.id, attempts);
        stillPending += 1;
      }
    } catch (error) {
      // A provider outage must not burn the backoff budget faster than a real
      // pending signature would, so this is scheduled the same way.
      errors += 1;
      await scheduleNext(row.id, attempts).catch(() => undefined);
      console.warn(
        `[esign-reconciliation] ${row.client_transaction_id} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (rows.length) {
    console.log(
      `[esign-reconciliation] examined=${rows.length} completed=${completed} pending=${stillPending} errors=${errors}`,
    );
  }
  return { examined: rows.length, completed, stillPending, errors };
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
