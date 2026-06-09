import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

type AccountAction =
  | "password_reset_requested"
  | "force_change_set"
  | "account_locked"
  | "account_unlocked"
  | "account_disabled"
  | "account_enabled"
  | "session_revoked";

async function insertControlLog(
  userId: string,
  action: AccountAction,
  initiatedBy: string,
  ip: string,
  reason?: string
): Promise<void> {
  await db.execute(
    `INSERT INTO account_control_log (id, user_id, action, initiated_by, ip_address, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), userId, action, initiatedBy, ip, reason ?? null]
  );
}

export const accountControlService = {
  async requestPasswordReset(
    userId: string,
    email: string,
    initiatedBy: string,
    ip: string
  ): Promise<{ logged: true; message: string }> {
    await insertControlLog(userId, "password_reset_requested", initiatedBy, ip);
    await logSensitiveAction({
      actor_user_id: initiatedBy,
      action_type: "PASSWORD_RESET_REQUESTED",
      module_key: "ACCOUNT_CONTROL",
      entity_type: "user",
      entity_id: userId,
      change_summary: { email },
    });
    return { logged: true, message: "Reset request logged; Supabase Auth sends the reset link" };
  },

  async forcePasswordChange(
    userId: string,
    initiatedBy: string,
    reason: string,
    ip: string
  ): Promise<RowDataPacket> {
    // MySQL logs the intent. Auth-layer enforcement remains Supabase-owned until
    // the production auth bridge is connected; no plaintext credential is stored.
    await insertControlLog(userId, "force_change_set", initiatedBy, ip, reason);
    await logSensitiveAction({
      actor_user_id: initiatedBy,
      action_type: "FORCE_CHANGE_SET",
      module_key: "ACCOUNT_CONTROL",
      entity_type: "user",
      entity_id: userId,
      change_summary: { reason, enforcement: "supabase_auth_bridge_pending" },
    });
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT user_id, role_key, active_status
       FROM user_roles WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    return (rows as RowDataPacket[])[0] ?? { user_id: userId, force_change_requested: true };
  },

  async lockAccount(
    userId: string,
    initiatedBy: string,
    reason: string,
    ip: string
  ): Promise<{ logged: true }> {
    await insertControlLog(userId, "account_locked", initiatedBy, ip, reason);
    await logSensitiveAction({
      actor_user_id: initiatedBy,
      action_type: "ACCOUNT_LOCKED",
      module_key: "ACCOUNT_CONTROL",
      entity_type: "user",
      entity_id: userId,
      change_summary: { reason },
    });
    return { logged: true };
  },

  async unlockAccount(
    userId: string,
    initiatedBy: string,
    ip: string
  ): Promise<{ logged: true }> {
    await insertControlLog(userId, "account_unlocked", initiatedBy, ip);
    await logSensitiveAction({
      actor_user_id: initiatedBy,
      action_type: "ACCOUNT_UNLOCKED",
      module_key: "ACCOUNT_CONTROL",
      entity_type: "user",
      entity_id: userId,
    });
    return { logged: true };
  },

  async disableAccount(
    userId: string,
    initiatedBy: string,
    reason: string,
    ip: string
  ): Promise<{ logged: true }> {
    await insertControlLog(userId, "account_disabled", initiatedBy, ip, reason);
    await logSensitiveAction({
      actor_user_id: initiatedBy,
      action_type: "ACCOUNT_DISABLED",
      module_key: "ACCOUNT_CONTROL",
      entity_type: "user",
      entity_id: userId,
      change_summary: { reason },
    });
    return { logged: true };
  },

  async enableAccount(
    userId: string,
    initiatedBy: string,
    ip: string
  ): Promise<{ logged: true }> {
    await insertControlLog(userId, "account_enabled", initiatedBy, ip);
    await logSensitiveAction({
      actor_user_id: initiatedBy,
      action_type: "ACCOUNT_ENABLED",
      module_key: "ACCOUNT_CONTROL",
      entity_type: "user",
      entity_id: userId,
    });
    return { logged: true };
  },

  async logSessionRevoke(
    userId: string,
    initiatedBy: string,
    ip: string
  ): Promise<{ logged: true }> {
    await insertControlLog(userId, "session_revoked", initiatedBy, ip);
    await logSensitiveAction({
      actor_user_id: initiatedBy,
      action_type: "SESSION_REVOKED",
      module_key: "ACCOUNT_CONTROL",
      entity_type: "user",
      entity_id: userId,
    });
    return { logged: true };
  },

  async getAccountAuditLog(
    userId: string,
    limit = 50
  ): Promise<RowDataPacket[]> {
    const safeLimit = Math.min(Math.max(1, limit), 200);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, user_id, action, initiated_by, ip_address, reason, created_at
       FROM account_control_log
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, safeLimit]
    );
    return rows as RowDataPacket[];
  },
};
