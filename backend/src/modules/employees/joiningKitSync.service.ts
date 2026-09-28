/**
 * Force-pull eSign status from Luckpay for a joining kit on HR demand.
 *
 * The reconciliation worker (esign-reconciliation.worker.ts) does this
 * automatically on a backoff schedule, but after several attempts the
 * interval grows to 60 minutes. When an employee has just signed, HR
 * needs the status immediately — this is the manual trigger for that.
 *
 * Deliberately scoped to kit-level transactions (scope = 'kit'): the kit
 * signing session is a single provider call that covers all member documents,
 * so one sync is enough to unblock the entire checklist.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export async function syncKitEsignStatus(
  kitId: string,
  employeeId: string,
  _actorUserId: string | null,
): Promise<{ synced: boolean; message: string; providerStatus?: string }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, client_transaction_id, status
       FROM employee_document_esign_transaction
      WHERE kit_id = ? AND scope = 'kit' AND provider = 'luckpay'
        AND client_transaction_id IS NOT NULL
      ORDER BY initiated_at DESC
      LIMIT 1`,
    [kitId],
  );
  const tx = rows[0];
  if (!tx) {
    return { synced: false, message: "No eSign transaction found for this kit." };
  }

  const alreadyTerminal = ["signed", "completed", "expired", "cancelled", "abandoned_unresolved"];
  if (alreadyTerminal.includes(String(tx.status).toLowerCase())) {
    return { synced: false, message: `Transaction is already in terminal state: ${String(tx.status)}.`, providerStatus: String(tx.status) };
  }

  // Reset next_poll_at so the reconciliation worker picks this up in its very
  // next tick (≤ 5 min) even if it was pushed far into the future by backoff.
  // This write is the safety net: even if the live Luckpay call below times out,
  // the worker will still reconcile within a few minutes.
  await db.execute(
    `UPDATE employee_document_esign_transaction
        SET next_poll_at = NULL
      WHERE id = ?`,
    [String(tx.id)],
  );

  // Race the Luckpay call against a 20s timeout so nginx (30s proxy_read_timeout)
  // never kills this connection. If Luckpay is slow the worker handles it instead.
  try {
    const { syncEsignStatus } = await import("../integrations/luckpay/luckpay-status.service.js");
    const outcome = await Promise.race([
      syncEsignStatus(String(tx.client_transaction_id)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000)),
    ]);
    if (outcome !== null) {
      return {
        synced: true,
        message: outcome.message ?? "Status checked from provider.",
        providerStatus: outcome.providerStatus ?? undefined,
      };
    }
  } catch (err) {
    console.warn("[syncKitEsignStatus] Luckpay call failed:", (err as Error)?.message ?? err);
  }

  // Luckpay timed out or errored; next_poll_at is already NULL so the
  // reconciliation worker will complete the check within ~5 minutes.
  return {
    synced: true,
    message: "Status check queued. The page will update automatically once the provider responds (usually within 5 minutes).",
    providerStatus: undefined,
  };
}
