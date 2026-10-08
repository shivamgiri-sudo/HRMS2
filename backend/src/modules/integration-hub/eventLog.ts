import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface IntegrationEvent {
  id: string;
  integration_key: string;
  event_type: string;
  triggered_by: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function appendEvent(
  integrationKey: string,
  eventType: string,
  triggeredBy: string,
  description?: string,
  metadata?: Record<string, unknown>
): Promise<IntegrationEvent> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO integration_event_log (id, integration_key, event_type, triggered_by, description, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, integrationKey, eventType, triggeredBy, description ?? null, metadata ? JSON.stringify(metadata) : null]
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM integration_event_log WHERE id = ? LIMIT 1",
    [id]
  );
  return (rows as IntegrationEvent[])[0];
}

export async function listEvents(
  integrationKey: string,
  eventType?: string
): Promise<IntegrationEvent[]> {
  let sql = "SELECT * FROM integration_event_log WHERE integration_key = ?";
  const params: unknown[] = [integrationKey];

  if (eventType) {
    sql += " AND event_type = ?";
    params.push(eventType);
  }

  sql += " ORDER BY created_at DESC LIMIT 100";

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows as IntegrationEvent[];
}
