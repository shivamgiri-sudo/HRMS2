/**
 * Finishing DigiLocker sessions nobody came back to check.
 *
 * DigiLocker completion is learned by asking Luckpay (syncDigilockerStatus), and until now that
 * only happened while the joiner's onboarding page was open and polling, when HR pressed refresh,
 * or when the provider's callback arrived. A joiner who finished at DigiLocker and closed the tab
 * stayed 'initiated' on our side for good, listed as DigiLocker pending in the Ops Control Tower
 * (24 of the 79 listed on 2026-10-06 had started a session and never been checked again).
 *
 * This asks Luckpay about recent sessions that are still open, a small batch per tick, each
 * candidate at most once per tick window. Off by default (DIGILOCKER_RECONCILIATION_ENABLED),
 * like the eSign reconciler, until per-call billing of the status check is confirmed.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { env } from "../config/env.js";
import { syncDigilockerStatus } from "../modules/integrations/luckpay/luckpay-status.service.js";

const TICK_MS = 15 * 60 * 1000;
const BATCH_SIZE = 25;
const LOOKBACK_DAYS = 15;

/** Candidates whose latest Luckpay DigiLocker session is still open and was not touched recently. */
export async function findOpenDigilockerSessions(limit = BATCH_SIZE): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.candidate_id
       FROM ats_provider_transaction_log t
       JOIN (
         SELECT candidate_id, MAX(created_at) AS latest
           FROM ats_provider_transaction_log
          WHERE provider = 'luckpay' AND service_type = 'digilocker'
            AND created_at >= NOW() - INTERVAL ${LOOKBACK_DAYS} DAY
          GROUP BY candidate_id
       ) l ON l.candidate_id = t.candidate_id AND l.latest = t.created_at
      WHERE t.provider = 'luckpay' AND t.service_type = 'digilocker'
        AND COALESCE(t.provider_reference_id, '') <> ''
        AND COALESCE(t.status, '') NOT IN ('documents_received', 'completed', 'failed', 'expired')
        AND t.updated_at <= NOW() - INTERVAL 15 MINUTE
      ORDER BY t.updated_at ASC
      LIMIT ${Number(limit)}`,
  );
  return [...new Set((rows as RowDataPacket[]).map((r) => String(r.candidate_id)))];
}

export async function runDigilockerReconciliationOnce(limit = BATCH_SIZE): Promise<{
  examined: number; completed: number; stillPending: number; failed: number; errors: number;
}> {
  const candidateIds = await findOpenDigilockerSessions(limit);
  let completed = 0, stillPending = 0, failed = 0, errors = 0;
  for (const candidateId of candidateIds) {
    try {
      const outcome = await syncDigilockerStatus(candidateId);
      if (outcome.state === "completed") completed += 1;
      else if (outcome.state === "failed" || outcome.state === "expired") failed += 1;
      else stillPending += 1;
    } catch (error) {
      errors += 1;
      console.warn(`[digilocker-reconciliation] ${candidateId}:`, (error as Error)?.message);
    }
  }
  console.log(`[digilocker-reconciliation] examined=${candidateIds.length} completed=${completed} pending=${stillPending} failed=${failed} errors=${errors}`);
  return { examined: candidateIds.length, completed, stillPending, failed, errors };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function startDigilockerReconciliationWorker(): Promise<void> {
  if (!env.DIGILOCKER_RECONCILIATION_ENABLED) {
    console.log("[digilocker-reconciliation] disabled (DIGILOCKER_RECONCILIATION_ENABLED is not true)");
    return;
  }
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    if (running) return;
    running = true;
    void runDigilockerReconciliationOnce()
      .catch((error) => console.warn("[digilocker-reconciliation] tick failed:", error))
      .finally(() => { running = false; });
  }, TICK_MS);
  console.log(`[digilocker-reconciliation] started (every ${TICK_MS / 60000}m, batch ${BATCH_SIZE})`);
}

export function stopDigilockerReconciliationWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
