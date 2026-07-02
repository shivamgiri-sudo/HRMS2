import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { logSensitiveAction } from "../shared/auditLog.js";

const RUN_HOUR = 2; // 2:00 AM daily
let nextRun: NodeJS.Timeout | undefined;

export function millisecondsUntilNextExpirySweep(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export async function runAccessExpirySweep(): Promise<{ expired: number }> {
  // Find all active user_page_access rows that are past their expires_at
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, user_id, page_code,
            can_view, can_create, can_edit, can_delete, can_export
     FROM user_page_access
     WHERE expires_at IS NOT NULL
       AND expires_at < NOW()
       AND active_status = 1`
  );

  if (!rows.length) {
    return { expired: 0 };
  }

  // Deactivate all expired rows in one UPDATE
  const ids = (rows as any[]).map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  await db.execute(
    `UPDATE user_page_access SET active_status = 0
     WHERE id IN (${placeholders})`,
    ids
  );

  // Write one audit record per expired row (REVOKE + auto-expired note)
  for (const row of rows as any[]) {
    try {
      await db.execute(
        `INSERT INTO user_page_access_audit
           (user_id, page_code, action, actor_user_id, old_permissions, notes)
         VALUES (?, ?, 'REVOKE', '00000000-0000-0000-0000-000000000000', ?, 'Auto-expired by access-expiry worker')`,
        [
          row.user_id,
          row.page_code,
          JSON.stringify({
            can_view: row.can_view,
            can_create: row.can_create,
            can_edit: row.can_edit,
            can_delete: row.can_delete,
            can_export: row.can_export,
          }),
        ]
      );
    } catch (err) {
      console.error(`[access-expiry] audit write failed for row ${String(row.id)}:`, err);
    }

    await logSensitiveAction({
      action_type: "USER_PAGE_ACCESS_EXPIRED",
      module_key: "access",
      actor_user_id: "system",
      entity_type: "user_page_access",
      entity_id: row.id,
      change_summary: { user_id: row.user_id, page_code: row.page_code },
    });
  }

  console.log(`[access-expiry] expired ${rows.length} user_page_access row(s)`);
  return { expired: rows.length };
}

export function startAccessExpiryScheduler(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      await runAccessExpirySweep();
    } catch (error) {
      console.error("[access-expiry] sweep failed:", error);
    } finally {
      nextRun = undefined;
      startAccessExpiryScheduler();
    }
  }, millisecondsUntilNextExpirySweep());
  nextRun.unref();
}

export function stopAccessExpiryScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
