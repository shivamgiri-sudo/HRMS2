import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Audit row for the appointment-letter acceptance flow.
 *
 * Best-effort by design, like the issuance audit next to it: an audit failure
 * must not undo a signature or block an employee from signing. Failures are
 * logged rather than swallowed silently.
 */
export async function auditAppointmentLetter(
  issueId: string | null,
  action: string,
  actorUserId: string | null,
  detail: unknown,
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO appointment_letter_issue_audit (id, issue_id, action, actor_user_id, detail_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
      [randomUUID(), issueId, action, actorUserId, JSON.stringify(detail ?? {})],
    );
  } catch (error) {
    console.warn(`[appointment-letter] audit ${action} failed:`, error instanceof Error ? error.message : error);
  }
}
