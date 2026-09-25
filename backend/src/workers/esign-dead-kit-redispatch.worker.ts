/**
 * Finds joining kits whose eMudhra session has died (session is no longer usable)
 * and automatically redispatches them so the candidate receives a fresh signing link.
 *
 * Why this exists: eMudhra sessions expire after 24-72 hours. When that happens, the
 * candidate clicks the link in their email and sees "Invalid Page!" — they cannot sign.
 * The esign-reconciliation worker polls the provider and marks transactions as 'failed'
 * or leaves them 'pending', but neither action sends the candidate a working link.
 * kitEsignSessionIsAlive (joiningKitDispatch.service.ts) now classifies old failed/pending
 * sessions as dead, enabling redispatch — this worker does the actual recovery.
 *
 * Cost: each redispatch creates a new billed Luckpay session. Controlled by
 * ESIGN_AUTO_REDISPATCH_ENABLED=true. Defaults off to prevent surprise billing.
 *
 * Rate: one kit per tick (conservative — each redispatch hits Luckpay). Runs every
 * 10 minutes. 163 backlogged kits clear in ~27 hours; ongoing the queue stays near zero.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { env } from "../config/env.js";

const TICK_MS = 10 * 60 * 1000;
const BATCH_SIZE = 1; // one per tick — each redispatch is a billed provider call

type DeadKitRow = RowDataPacket & {
  id: string;
  employee_id: string;
};

async function findOneDeadKit(): Promise<DeadKitRow | null> {
  // A kit is dead-session if: status='sent', open_marker='Y', and the most recent
  // transaction is either:
  //   (a) status='failed' AND initiated > SESSION_DEAD_AFTER_DAYS (3) days ago, OR
  //   (b) status in ('pending','initiated') AND initiated > 7 days ago
  // This mirrors the kitEsignSessionIsAlive logic in joiningKitDispatch.service.ts.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT k.id, k.employee_id
       FROM employee_joining_esign_kit k
       JOIN employee_document_esign_transaction t
         ON t.kit_id = k.id
            AND t.initiated_at = (
              SELECT MAX(t2.initiated_at)
              FROM employee_document_esign_transaction t2
              WHERE t2.kit_id = k.id
            )
      WHERE k.status = 'sent'
        AND k.open_marker = 'Y'
        AND k.employee_id IS NOT NULL
        AND (
          (t.status = 'failed'   AND DATEDIFF(NOW(), t.initiated_at) >= 3)
          OR
          (t.status IN ('pending','initiated') AND DATEDIFF(NOW(), t.initiated_at) >= 7)
        )
      ORDER BY t.initiated_at ASC
      LIMIT ?`,
    [BATCH_SIZE],
  );
  return (rows as DeadKitRow[])[0] ?? null;
}

export async function runDeadKitRedispatchOnce(): Promise<{
  found: boolean;
  employeeId?: string;
  outcome?: string;
}> {
  const kit = await findOneDeadKit();
  if (!kit) {
    return { found: false };
  }

  const employeeId = String(kit.employee_id);
  try {
    const { redispatchDeadKit } =
      await import("../modules/employees/joiningKitDispatch.service.js");
    const result = await redispatchDeadKit(employeeId, null);
    console.log(
      `[esign-dead-kit-redispatch] employee=${employeeId} kit=${kit.id} -> ${result.status}: ${result.message}`,
    );
    return { found: true, employeeId, outcome: result.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[esign-dead-kit-redispatch] employee=${employeeId} kit=${kit.id} redispatch failed: ${message}`,
    );
    return { found: true, employeeId, outcome: `error: ${message}` };
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startDeadKitRedispatchWorker(): void {
  if (!env.ESIGN_AUTO_REDISPATCH_ENABLED) {
    console.log(
      "[esign-dead-kit-redispatch] disabled (ESIGN_AUTO_REDISPATCH_ENABLED is not true)",
    );
    return;
  }
  if (intervalHandle) return;

  intervalHandle = setInterval(() => {
    if (running) return;
    running = true;
    void runDeadKitRedispatchOnce()
      .then(({ found, employeeId, outcome }) => {
        if (found) {
          console.log(
            `[esign-dead-kit-redispatch] tick: employee=${employeeId} outcome=${outcome}`,
          );
        }
      })
      .catch((error) =>
        console.warn("[esign-dead-kit-redispatch] tick failed:", error),
      )
      .finally(() => {
        running = false;
      });
  }, TICK_MS);

  console.log(
    `[esign-dead-kit-redispatch] started (every ${TICK_MS / 60000}m, batch ${BATCH_SIZE})`,
  );
}

export function stopDeadKitRedispatchWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
