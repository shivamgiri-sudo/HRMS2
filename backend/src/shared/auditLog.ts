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
  metadata?: Record<string, unknown>;
  request_id?: string;
  req?: Request;
  ip_address?: string;
  user_agent?: string | string[];
  actor_role?: string;
  reason?: string;
  old_value_json?: Record<string, unknown>;
  new_value_json?: Record<string, unknown>;
  employee_id?: string;
}

function requestIdFrom(entry: AuditLogEntry): string | null {
  const headerValue = entry.req?.headers["x-request-id"];
  if (entry.request_id) return entry.request_id;
  if (typeof headerValue === "string") return headerValue.slice(0, 100);
  if (Array.isArray(headerValue)) return String(headerValue[0] ?? "").slice(0, 100) || null;
  return null;
}

function userAgentFrom(entry: AuditLogEntry): string | null {
  return String(entry.user_agent ?? entry.req?.headers["user-agent"] ?? "").slice(0, 512) || null;
}

function ipAddressFrom(entry: AuditLogEntry): string | null {
  return entry.ip_address ?? entry.req?.ip ?? null;
}

function jsonOrNull(value: Record<string, unknown> | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

/**
 * Write a standard enterprise audit event to audit_action_log.
 * Non-throwing — audit failures must never break the primary operation.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO audit_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id,
          request_id, ip_address, user_agent, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entry.actor_user_id,
        entry.action_type,
        entry.module_key,
        entry.entity_type ?? null,
        entry.entity_id ?? null,
        requestIdFrom(entry),
        ipAddressFrom(entry),
        userAgentFrom(entry),
        jsonOrNull(entry.metadata ?? entry.change_summary),
      ]
    );
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: "critical",
        module: "auditLog",
        event: "AUDIT_ACTION_LOG_WRITE_FAILED",
        action_type: entry.action_type,
        actor_user_id: entry.actor_user_id,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }) + "\n"
    );
  }
}

/**
 * Write a sensitive action to sensitive_action_log.
 * Non-throwing — audit failures must never break the primary operation.
 */
export async function writeSensitiveActionLog(entry: AuditLogEntry): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id,
          ip_address, user_agent, change_summary, request_id,
          actor_role, reason, old_value_json, new_value_json, employee_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entry.actor_user_id,
        entry.action_type,
        entry.module_key,
        entry.entity_type ?? null,
        entry.entity_id ?? null,
        ipAddressFrom(entry),
        userAgentFrom(entry),
        jsonOrNull(entry.change_summary ?? entry.metadata),
        requestIdFrom(entry),
        entry.actor_role ?? null,
        entry.reason ?? null,
        entry.old_value_json ? JSON.stringify(entry.old_value_json) : null,
        entry.new_value_json ? JSON.stringify(entry.new_value_json) : null,
        entry.employee_id ?? null,
      ]
    );
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: "critical",
        module: "auditLog",
        event: "SENSITIVE_ACTION_LOG_WRITE_FAILED",
        action_type: entry.action_type,
        actor_user_id: entry.actor_user_id,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }) + "\n"
    );
  }
}

export const logSensitiveAction = writeSensitiveActionLog;
