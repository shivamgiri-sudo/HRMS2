import { randomUUID } from "crypto";
import type { Request } from "express";
import { db } from "../db/mysql.js";

export interface AuditLogEntry {
  actor_user_id: string;
  action_type: string;
  module_key: string;
  entity_type?: string;
  entity_id?: string;
  // Structured before/after values (preferred over change_summary for new code)
  old_value_json?: Record<string, unknown>;
  new_value_json?: Record<string, unknown>;
  // Legacy generic summary (still supported; merged when old/new not set)
  change_summary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  // Subject of the action (the employee affected, not necessarily the actor)
  employee_id?: string;
  // Role of the actor at the time of action
  actor_role?: string;
  // Mandatory reason for sensitive/override actions
  reason?: string;
  request_id?: string;
  req?: Request;
  ip_address?: string;
  user_agent?: string | string[];
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
    console.error("[audit] Failed to write audit_action_log:", err);
  }
}

/**
 * Write a sensitive action to sensitive_action_log.
 * Supports both legacy change_summary and structured old_value_json/new_value_json.
 * Non-throwing — audit failures must never break the primary operation.
 */
export async function writeSensitiveActionLog(entry: AuditLogEntry): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id,
          ip_address, user_agent, change_summary, request_id,
          old_value_json, new_value_json, employee_id, actor_role, reason)
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
        // Legacy: change_summary = old+new merged, or metadata fallback
        jsonOrNull(
          entry.change_summary ?? entry.metadata ??
          (entry.old_value_json || entry.new_value_json
            ? { before: entry.old_value_json, after: entry.new_value_json }
            : undefined)
        ),
        requestIdFrom(entry),
        // New structured fields (written to dedicated columns via migration 237)
        entry.old_value_json ? JSON.stringify(entry.old_value_json) : null,
        entry.new_value_json ? JSON.stringify(entry.new_value_json) : null,
        entry.employee_id ?? null,
        entry.actor_role ?? null,
        entry.reason ?? null,
      ]
    );
  } catch (err) {
    console.error("[audit] Failed to write sensitive_action_log:", err);
  }
}

export const logSensitiveAction = writeSensitiveActionLog;
