import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface ActiveHold {
  id: string;
  withdrawal_id: string;
  hold_reason: string | null;
  applied_at: Date;
}

/**
 * Returns truthy if there is an active processing hold for the given entity.
 * Fails CLOSED on DB error — throws so callers handle appropriately.
 */
export async function isHoldActive(
  entityType: string,
  entityId: string
): Promise<ActiveHold | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, withdrawal_id, hold_reason, held_at AS applied_at
     FROM dpdp_processing_hold
     WHERE entity_type = ? AND entity_id = ? AND is_active = 1
     LIMIT 1`,
    [entityType, entityId]
  );
  if (rows.length > 0) return rows[0] as ActiveHold;

  // Also check withdrawal-level holds via requester mapping
  const [wrows] = await db.execute<RowDataPacket[]>(
    `SELECT dph.id, dph.withdrawal_id, dph.hold_reason, dph.held_at AS applied_at
     FROM dpdp_processing_hold dph
     JOIN dpdp_consent_withdrawal dcw ON dcw.id = dph.withdrawal_id
     WHERE dph.is_active = 1
       AND dcw.processing_hold_active = 1
       AND (dcw.requester_id = ? OR dcw.requester_id IN (
         SELECT e.user_id FROM employees e WHERE e.id = ? LIMIT 1
       ))
     LIMIT 1`,
    [entityId, entityId]
  );
  return wrows.length > 0 ? (wrows[0] as ActiveHold) : null;
}

export async function applyHold(
  withdrawalId: string,
  entityType: string,
  entityId: string,
  holdReason: string,
  appliedBy: string
): Promise<void> {
  await db.execute(
    `INSERT INTO dpdp_processing_hold
       (id, withdrawal_id, entity_type, entity_id, hold_reason, is_active, held_by, held_at)
     VALUES (UUID(), ?, ?, ?, ?, 1, ?, NOW())`,
    [withdrawalId, entityType, entityId, holdReason, appliedBy]
  );
}

export async function releaseHold(
  withdrawalId: string,
  releasedBy: string,
  releaseReason: string
): Promise<void> {
  await db.execute(
    `UPDATE dpdp_processing_hold
     SET is_active = 0, released_at = NOW(), released_by = ?, release_reason = ?
     WHERE withdrawal_id = ? AND is_active = 1`,
    [releasedBy, releaseReason, withdrawalId]
  );
}
