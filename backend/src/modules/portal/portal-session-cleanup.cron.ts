import { db } from "../../db/mysql.js";

/**
 * portal_user_sessions has an insert on every OTP login, password login, and
 * impersonation grant, and `revoked_at` is only ever SET on logout/revoke -- rows are
 * never deleted anywhere in the codebase. A live check found 58 accumulated rows after
 * a single day of this session's own testing alone; left unattended this grows forever.
 *
 * portal_otp already has adequate lazy cleanup (portalAuthService.purgeExpiredOtps(),
 * called inline on every request-otp/verify-otp call), which is fine for a table that's
 * only ever touched during an active login attempt. portal_user_sessions has no
 * equivalent, because nothing reads it except the one EXISTS-by-jti lookup in
 * requireClientAuth.ts, so there was never a "touch point" to hang a purge off of --
 * hence a real interval-based job instead, same pattern as it-provisioning.cron.ts's
 * hourly auto-lock sweep.
 *
 * Deletes sessions that are either revoked OR expired, and only once they are also more
 * than 24h past whichever of those happened -- keeping a short forensic window (e.g. "was
 * this token revoked an hour ago or a week ago") without keeping every session forever.
 */
const RETENTION_HOURS_AFTER_END = 24;

let _timer: ReturnType<typeof setInterval> | null = null;

export async function cleanupPortalSessions(): Promise<{ deleted: number }> {
  const [result] = await db.execute(
    `DELETE FROM portal_user_sessions
      WHERE (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
         OR (expires_at < DATE_SUB(NOW(), INTERVAL ? HOUR))`,
    [RETENTION_HOURS_AFTER_END, RETENTION_HOURS_AFTER_END]
  );
  const deleted = (result as { affectedRows?: number }).affectedRows ?? 0;
  return { deleted };
}

export function startPortalSessionCleanupScheduler(): void {
  if (_timer) return;
  // Hourly, same cadence as it-provisioning.cron.ts's auto-lock sweep -- this table is
  // low-write-volume enough that a tighter interval would add nothing.
  _timer = setInterval(async () => {
    try {
      const { deleted } = await cleanupPortalSessions();
      if (deleted > 0) {
        console.log(`[portal-session-cleanup] removed ${deleted} stale portal_user_sessions row(s)`);
      }
    } catch (err) {
      console.error("[portal-session-cleanup] cron error:", err);
    }
  }, 60 * 60 * 1000);

  console.log("[portal-session-cleanup] scheduler started (hourly)");
}

export function stopPortalSessionCleanupScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  console.log("[portal-session-cleanup] Stopped");
}
