/**
 * Create a Work Inbox item, or refresh the open one that already covers the same thing.
 *
 * WHY THIS EXISTS
 *   Several producers wrote `INSERT INTO work_item (...) ON DUPLICATE KEY UPDATE updated_at = NOW()`.
 *   That clause can never fire: work_item carries no unique key beyond its primary key — verified
 *   against the live schema, whose only unique index is PRIMARY(id) — and the id is a fresh UUID()
 *   on every insert, so no duplicate key is ever detected. Every call appended a new row.
 *
 *   It had already happened: EMPLOYEE_CODE_PENDING was stacked twice on one candidate. The count
 *   is small only because these routes have barely been called (8 work items in total). At launch
 *   volume the same call site produces one row per invocation, and a Work Inbox that shows the
 *   same task five times is one people stop trusting.
 *
 * WHY NOT JUST ADD A UNIQUE KEY
 *   Because (item_type, entity_type, entity_id) is NOT unique over time, and making it so would be
 *   wrong. The same task legitimately recurs — a candidate can need employee-code review again
 *   after the first one is completed. What must not duplicate is an item that is still OPEN. That
 *   is a predicate, not a constraint, so it belongs here rather than in the schema.
 *
 * IDEMPOTENCY WINDOW
 *   Keyed on (item_type, entity_type, entity_id) restricted to items not yet completed or
 *   cancelled, which is the same window the exit follow-up recorder uses. A completed item does
 *   not suppress a genuinely new occurrence.
 *
 * THROWS
 *   Deliberately. Callers decide whether a failed work-item write should surface — the existing
 *   ATS producers swallow it with `.catch(() => {})` and keep that behaviour unchanged, while the
 *   exit recorder logs it. Swallowing inside here would remove that choice from both.
 */
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../db/mysql.js";

export interface WorkItemInput {
  itemType: string;
  title: string;
  moduleCode: string;
  entityType: string;
  entityId: string;
  assignedToRole: string;
  /** work_item.priority — 'critical' | 'high' | 'normal' | 'low' as used by existing producers. */
  priority: string;
  description?: string | null;
}

export type WorkItemOutcome = "created" | "refreshed";

export async function upsertOpenWorkItem(input: WorkItemInput): Promise<WorkItemOutcome> {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM work_item
      WHERE item_type = ? AND entity_type = ? AND entity_id = ?
        AND status NOT IN ('completed', 'cancelled')
      LIMIT 1`,
    [input.itemType, input.entityType, input.entityId],
  );

  if (existing[0]) {
    const id = String((existing[0] as { id: unknown }).id);
    if (input.description == null) {
      await db.execute<ResultSetHeader>("UPDATE work_item SET updated_at = NOW() WHERE id = ?", [id]);
    } else {
      await db.execute<ResultSetHeader>(
        "UPDATE work_item SET description = ?, updated_at = NOW() WHERE id = ?",
        [input.description, id],
      );
    }
    return "refreshed";
  }

  await db.execute<ResultSetHeader>(
    `INSERT INTO work_item
       (id, item_type, title, description, module_code, entity_type, entity_id,
        assigned_to_role, priority, status, created_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
    [
      input.itemType,
      input.title,
      input.description ?? null,
      input.moduleCode,
      input.entityType,
      input.entityId,
      input.assignedToRole,
      input.priority,
    ],
  );
  return "created";
}
