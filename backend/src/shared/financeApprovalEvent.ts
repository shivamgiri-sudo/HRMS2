import { randomUUID } from "crypto";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../db/mysql.js";

/**
 * Append-only workflow history for finance entities (migration 1089).
 *
 * WHY THIS IS NOT writeAuditLog / logSensitiveAction
 * Those two are deliberately non-throwing: on failure they print to stderr and let the primary
 * operation continue. That is right for security telemetry and wrong for a workflow history,
 * because a history that can silently drop a row is not a history.
 * 1033_sensitive_action_log_entity_id_width.sql records what that costs in practice — 26
 * approved regularizations left no trail at all because entity_id overflowed and the write was
 * dropped without a sound. This function throws instead, and callers are expected to let it.
 *
 * WHY IT TAKES A CONNECTION
 * Pass the same PoolConnection as the status UPDATE so the event and the transition commit or
 * roll back together. A history row that survives a rolled-back approval is worse than none:
 * it says something happened that did not.
 *
 * Nothing here updates or deletes. A correction is a further event, never an edit of one.
 */
export type FinanceApprovalEvent = {
  /** grn | budget | budget_topup | imprest_allocation | vendor_payment */
  entityType: string;
  entityId: string;
  /** submit | approve | reject | return | resubmit | cancel | override | reverse | billing_cycle_set */
  action: string;
  fromStatus?: string | null;
  toStatus: string;
  decision?: string | null;
  actorUserId: string;
  /**
   * The role that OWNS the stage, from resolveFinanceStageRole — not necessarily the actor's
   * primary role. A super_admin acting at the Branch Head stage is recorded as branch_head,
   * because the question a reader asks later is "which stage was cleared", not "who happened
   * to be logged in".
   */
  actorRole: string;
  remarks?: string | null;
  details?: unknown;
};

export async function recordFinanceApprovalEvent(
  event: FinanceApprovalEvent,
  connection?: PoolConnection,
): Promise<void> {
  if (!event.entityType) throw new Error("An approval event needs an entity type");
  if (!event.entityId) throw new Error("An approval event needs an entity id");
  if (!event.toStatus) throw new Error("An approval event needs a target status");

  const executor = connection ?? db;
  await executor.execute(
    `INSERT INTO finance_approval_event
       (id, entity_type, entity_id, action, from_status, to_status, decision,
        actor_user_id, actor_role, remarks, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      randomUUID(),
      event.entityType,
      event.entityId,
      event.action,
      event.fromStatus ?? null,
      event.toStatus,
      event.decision ?? null,
      event.actorUserId,
      event.actorRole,
      event.remarks ?? null,
      event.details === undefined ? null : JSON.stringify(event.details),
    ],
  );
}

/** The timeline for one entity, oldest first — how a reviewer reconstructs what happened. */
export async function listFinanceApprovalEvents(entityType: string, entityId: string) {
  const [rows] = await db.execute(
    `SELECT id, entity_type, entity_id, action, from_status, to_status, decision,
            actor_user_id, actor_role, remarks, details_json, created_at
       FROM finance_approval_event
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at ASC, id ASC`,
    [entityType, entityId],
  );
  return rows;
}
