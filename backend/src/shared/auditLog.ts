import { randomUUID } from "crypto";
import type { Request } from "express";
import { db } from "../db/mysql.js";

export interface AuditLogEntry {
  actor_user_id: string;
  action_type: string;
  module_key: string;
  entity_type?: string;
  entity_id?: string;
  change_summary?: Record<string, unknown>;
  req?: Request;
  ip_address?: string;
  user_agent?: string | string[];
}

/**
 * Write a sensitive action to sensitive_action_log.
 * Non-throwing — audit failures must never break the primary operation.
 */
export async function logSensitiveAction(entry: AuditLogEntry): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id,
          ip_address, user_agent, change_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entry.actor_user_id,
        entry.action_type,
        entry.module_key,
        entry.entity_type ?? null,
        entry.entity_id ?? null,
        entry.ip_address ?? entry.req?.ip ?? null,
        String(entry.user_agent ?? entry.req?.headers["user-agent"] ?? "").slice(0, 512) || null,
        entry.change_summary ? JSON.stringify(entry.change_summary) : null,
      ]
    );
  } catch (err) {
    console.error("[audit] Failed to write sensitive_action_log:", err);
  }
}
