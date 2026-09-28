import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { emailService } from "../communication/email.service.js";

/** Who is told when an import needs a human: active super_admins and admins. */
const ALERT_ROLES = ["super_admin", "admin"];
export const RECOVERY_ALERT_TYPE = "bulk_import_recovery";

export interface RecoveryAlert {
  /** One alert per (type, dedupeKey): a batch that keeps failing must not spam anyone. */
  dedupeKey: string;
  title: string;
  message: string;
  actionUrl?: string;
}

interface AdminRow extends RowDataPacket {
  user_id: string;
  email: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Puts the alert in each admin's work inbox and emails it. Skipped entirely when an unactioned
 * inbox item with the same dedupeKey already exists, so the email also goes out once. Never
 * throws: an alert failing to send must not stop the recovery that triggered it.
 */
export async function alertAdmins(alert: RecoveryAlert): Promise<boolean> {
  try {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM work_inbox_item
        WHERE type = ? AND entity_id = ? AND is_actioned = 0 LIMIT 1`,
      [RECOVERY_ALERT_TYPE, alert.dedupeKey],
    );
    if (existing.length > 0) return false;

    const [admins] = await db.execute<AdminRow[]>(
      `SELECT DISTINCT ur.user_id, au.email
         FROM user_roles ur
         JOIN auth_user au ON au.id = ur.user_id
        WHERE ur.active_status = 1 AND ur.role_key IN (${ALERT_ROLES.map(() => "?").join(",")})`,
      ALERT_ROLES,
    );
    for (const admin of admins) {
      await db.execute(
        `INSERT INTO work_inbox_item
           (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
         VALUES (UUID(), ?, ?, ?, ?, 'upload_batch', ?, ?, 'high')`,
        [
          admin.user_id,
          RECOVERY_ALERT_TYPE,
          alert.title,
          alert.message,
          alert.dedupeKey,
          alert.actionUrl ?? "/bulk-upload",
        ],
      );
    }

    const emails = [
      ...new Set(admins.map((a) => a.email).filter((e): e is string => !!e)),
    ];
    if (emails.length > 0 && emailService.isConfigured()) {
      await emailService.send({
        to: emails[0],
        bcc: emails.slice(1).join(",") || undefined,
        subject: alert.title,
        html: `<p>${escapeHtml(alert.message)}</p><p>Open Bulk Upload Hub to review the batch.</p>`,
      });
    }
    return true;
  } catch (error) {
    console.error(
      "[batch-recovery-alert] could not alert admins:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
