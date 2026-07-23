import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * Create a TAT-tracked task instance and a corresponding work item.
 * Looks up the default_tat_hours from tat_matrix_master, calculates due_at,
 * inserts the task_tat_instance and a high-priority work_item for assignedTo.
 */
export async function createTatInstance(
  taskType: string,
  entityType: string,
  entityId: string,
  assignedTo: string,
  branchId?: string,
  processId?: string
): Promise<string> {
  // Look up TAT hours — prefer branch-specific, fall back to global
  const [matrixRows] = await db.execute<RowDataPacket[]>(
    `SELECT default_tat_hours
     FROM tat_matrix_master
     WHERE task_type = ?
       AND is_active = 1
       AND (branch_id = ? OR branch_id IS NULL)
     ORDER BY branch_id IS NULL ASC
     LIMIT 1`,
    [taskType, branchId ?? null]
  );

  const tatHours: number = (matrixRows[0] as any)?.default_tat_hours ?? 24;
  const id = randomUUID();

  await db.execute(
    `INSERT INTO task_tat_instance
       (id, task_type, entity_type, entity_id, assigned_to, branch_id, process_id, due_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), 'open', NOW(), NOW())`,
    [id, taskType, entityType, entityId, assignedTo, branchId ?? null, processId ?? null, tatHours]
  );

  // Insert a work item for the assignee
  await db.execute(
    `INSERT INTO work_item
       (id, item_type, entity_type, entity_id, assigned_to_user_id, due_at, priority, status, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), 'high', 'pending', NOW(), NOW())`,
    [taskType, entityType, entityId, assignedTo, tatHours]
  );

  return id;
}

/**
 * Check for open tasks that have breached SLA (due_at < NOW()).
 * Marks them as sla_breached, looks up escalation rules, inserts escalation
 * log entries and work items for the notify_role.
 * Returns the count of newly breached tasks.
 */
export async function checkAndEscalateTat(): Promise<number> {
  return checkAndEscalate();
}

export async function checkAndEscalate(): Promise<number> {
  // Step 1: Mark overdue open tasks as sla_breached and capture their ids
  const [breachedRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, task_type, entity_type, entity_id, assigned_to, branch_id
     FROM task_tat_instance
     WHERE status = 'open' AND due_at < NOW()`
  );

  if (!breachedRows.length) return 0;

  // Batch-update status
  const breachedIds = breachedRows.map((r: any) => r.id);
  await db.execute(
    `UPDATE task_tat_instance
     SET status = 'sla_breached', updated_at = NOW()
     WHERE id IN (${breachedIds.map(() => "?").join(",")})`,
    breachedIds
  );

  // Step 2: For each breached task, look up escalation matrix and insert log + work item
  for (const task of breachedRows) {
    const [escRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM escalation_matrix_master
       WHERE task_type = ? AND is_active = 1
       ORDER BY escalation_level ASC`,
      [(task as any).task_type]
    );

    for (const esc of escRows) {
      const logId = randomUUID();
      await db.execute(
        `INSERT INTO task_escalation_log
           (id, task_tat_instance_id, escalation_level, action, notify_role, notify_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          logId,
          (task as any).id,
          (esc as any).escalation_level ?? 1,
          (esc as any).escalation_action ?? "notify",
          (esc as any).notify_role ?? null,
          (esc as any).notify_user_id ?? null,
        ]
      );

      // Insert work item for the notify_role if set
      if ((esc as any).notify_role) {
        await db.execute(
          `INSERT INTO work_item
             (id, item_type, entity_type, entity_id, assigned_to_role, due_at, priority, status, created_at, updated_at)
           VALUES (UUID(), 'TAT_BREACH', ?, ?, ?, NOW(), 'high', 'pending', NOW(), NOW())`,
          [(task as any).entity_type, (task as any).entity_id, (esc as any).notify_role]
        );
      }
    }
  }

  return breachedRows.length;
}

/**
 * Mark a TAT instance as completed and log the completion in task_escalation_log.
 */
export async function completeTatInstance(id: string, completedBy: string): Promise<void> {
  await db.execute(
    `UPDATE task_tat_instance
     SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [id]
  );

  await db.execute(
    `INSERT INTO task_escalation_log
       (id, task_tat_instance_id, escalation_level, action, notify_user_id, created_at)
     VALUES (UUID(), ?, 0, 'completed', ?, NOW())`,
    [id, completedBy]
  );
}
