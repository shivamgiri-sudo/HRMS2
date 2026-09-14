import { db } from "../db/mysql.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { invalidateAuthContextCache } from "../middleware/authMiddleware.js";

export interface SessionRevocationResult {
  userId: string | null;
  refreshTokensRevoked: number;
  deviceSessionsRevoked: number;
}

/**
 * End every live session an employee holds.
 *
 * Deactivating an employee used to touch employees.active_status alone. That
 * stops the *next* refresh, but the access token already in the leaver's
 * browser keeps working until it expires — up to 24h — and requireAuth had no
 * reason to reject it. Revoking the refresh tokens as well closes the long tail,
 * and dropping the auth-context cache entry makes the per-request check in
 * isAccountRevoked() take effect immediately in this process instead of after
 * the 30s TTL.
 *
 * Non-throwing by design. Revocation is a follow-on to deactivation, not a
 * precondition for it: a failure here must never roll back or 500 the
 * deactivation the caller has already committed. Callers get the counts back so
 * they can log what actually happened rather than assume it worked.
 */
export async function revokeSessionsForEmployee(
  employeeId: string,
  reason: string
): Promise<SessionRevocationResult> {
  const result: SessionRevocationResult = {
    userId: null,
    refreshTokensRevoked: 0,
    deviceSessionsRevoked: 0,
  };

  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT user_id FROM employees WHERE id = ? LIMIT 1",
      [employeeId]
    );
    const userId = (rows[0] as { user_id: string | null } | undefined)?.user_id ?? null;

    // 121 of 1,115 active employees have no login account at all, so "no
    // user_id" is the ordinary case for a floor agent, not an error.
    if (!userId) return result;
    result.userId = userId;

    const [tokenRes] = await db.execute<ResultSetHeader>(
      "UPDATE auth_refresh_token SET revoked = 1 WHERE user_id = ? AND revoked = 0",
      [userId]
    );
    result.refreshTokensRevoked = tokenRes?.affectedRows ?? 0;

    // user_device_sessions is the surface the user sees under "active devices".
    // Leaving rows here unrevoked would show a leaver's laptop as a live session
    // long after the token behind it stopped working.
    const [deviceRes] = await db.execute<ResultSetHeader>(
      "UPDATE user_device_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
      [userId]
    );
    result.deviceSessionsRevoked = deviceRes?.affectedRows ?? 0;

    // Per-process cache only: pm2 runs more than one worker, so a sibling
    // process can still serve this user from its own cache for up to the 30s
    // TTL. Bounded and acceptable; a cross-process invalidation would need a
    // shared channel this app does not have yet.
    invalidateAuthContextCache(userId);

    process.stderr.write(
      JSON.stringify({
        level: "info",
        module: "sessionRevocation",
        event: "SESSIONS_REVOKED",
        employee_id: employeeId,
        user_id: userId,
        reason,
        refresh_tokens_revoked: result.refreshTokensRevoked,
        device_sessions_revoked: result.deviceSessionsRevoked,
        timestamp: new Date().toISOString(),
      }) + "\n"
    );
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: "critical",
        module: "sessionRevocation",
        event: "SESSION_REVOCATION_FAILED",
        employee_id: employeeId,
        reason,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }) + "\n"
    );
  }

  return result;
}
