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
  await db.execute(
    `UPDATE employee_document_esign_transaction
        SET next_poll_at = NULL
      WHERE id = ?`,
    [String(tx.id)],
  );

  const { syncEsignStatus } = await import("../integrations/luckpay/luckpay-status.service.js");
  const outcome = await syncEsignStatus(String(tx.client_transaction_id));

  return {
    synced: true,
    message: outcome.message ?? "Status checked from provider.",
    providerStatus: outcome.providerStatus ?? undefined,
  };
}
