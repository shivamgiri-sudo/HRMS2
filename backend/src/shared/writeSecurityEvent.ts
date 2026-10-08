import { db } from "../db/mysql.js";

export interface SecurityEventPayload {
  event_type: string;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  module_key?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  actor_user_id?: string | null;
  actor_role?: string | null;
  target_employee_id?: string | null;
  title: string;
  description?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  reason?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

export async function writeSecurityEvent(payload: SecurityEventPayload): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO security_audit_event
         (event_type, severity, module_key, entity_type, entity_id,
          actor_user_id, actor_role, target_employee_id,
          title, description, old_value, new_value, reason, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.event_type,
        payload.severity ?? "info",
        payload.module_key ?? null,
        payload.entity_type ?? null,
        payload.entity_id ?? null,
        payload.actor_user_id ?? null,
        payload.actor_role ?? null,
        payload.target_employee_id ?? null,
        payload.title,
        payload.description ?? null,
        payload.old_value == null ? null : JSON.stringify(payload.old_value),
        payload.new_value == null ? null : JSON.stringify(payload.new_value),
        payload.reason ?? null,
        payload.ip_address ?? null,
        payload.user_agent ?? null,
      ],
    );
  } catch {
    // Non-fatal — security event write must not break the calling flow
  }
}
