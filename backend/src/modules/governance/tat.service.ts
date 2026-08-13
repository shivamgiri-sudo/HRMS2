import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getUserRoleContext } from "../../shared/roleResolver.js";

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
    // INTERVAL ? HOUR silently ROUNDS a fractional value: INTERVAL 0.50 HOUR is 60 minutes,
    // not 30. Migration 1042 widened default_tat_hours to DECIMAL so a 30-minute SLA could
    // be stored, but storing it was only half the job — this expression rounded it straight
    // back to an hour, so the walk-in queue SLA was still firing at 60 minutes. Converting to
    // whole minutes is what actually makes a sub-hour TAT take effect.
    `INSERT INTO task_tat_instance
       (id, task_type, entity_type, entity_id, assigned_to, branch_id, process_id, due_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 'open', NOW(), NOW())`,
    [id, taskType, entityType, entityId, assignedTo, branchId ?? null, processId ?? null, Math.round(tatHours * 60)]
  );

  // Insert a work item for the assignee
  await db.execute(
    // Same rounding trap as the TAT instance above — the work item must expire on the same
    // clock as the SLA it represents, or a 30-minute SLA shows the assignee an hour.
    `INSERT INTO work_item
       (id, item_type, entity_type, entity_id, assigned_to_user_id, due_at, priority, status, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 'high', 'pending', NOW(), NOW())`,
    [taskType, entityType, entityId, assignedTo, Math.round(tatHours * 60)]
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

/** One escalation that is due to fire. */
export interface DueEscalation {
  tatInstanceId: string;
  taskType: string;
  entityType: string;
  entityId: string;
  assignedTo: string | null;
  ownerUserId: string | null;
  branchId: string | null;
  processId: string | null;
  dueAt: Date;
  escalationLevel: number;
  notifyRole: string | null;
  notifyUserId: string | null;
  escalationAction: string;
  hoursOverdue: number;
}

/**
 * Escalations that are due right now and have not already been logged.
 *
 * Three things this deliberately does that the previous implementation did not:
 *
 *  - It honours `trigger_after_hours`. The old loop walked EVERY level for a breached task
 *    in a single pass, so a task one minute overdue immediately notified the owner, their
 *    manager and the branch head at once. That alone was a storm.
 *  - It excludes levels already present in task_escalation_log, so a 15-minute poll does
 *    not re-notify the same level forever.
 *  - It respects a backfill floor. Without one, the first run after deployment sees every
 *    overdue task in the system's history — the shape of the 43,943-alert incident.
 */
export async function findDueEscalations(opts: {
  backfillFloor: Date | string;
  limit?: number;
}): Promise<DueEscalation[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.id            AS tat_instance_id,
            t.task_type, t.entity_type, t.entity_id,
            t.assigned_to, t.owner_user_id, t.branch_id, t.process_id, t.due_at,
            e.escalation_level, e.notify_role, e.notify_user_id, e.escalation_action,
            TIMESTAMPDIFF(HOUR, t.due_at, NOW()) AS hours_overdue
       FROM task_tat_instance t
       JOIN escalation_matrix_master e
         ON e.task_type = t.task_type
        AND e.is_active = 1
        -- the level is due only once this many hours have passed since due_at
        AND NOW() >= DATE_ADD(t.due_at, INTERVAL e.trigger_after_hours HOUR)
      WHERE t.status IN ('open', 'in_progress', 'sla_breached')
        AND t.due_at < NOW()
        AND t.due_at >= ?
        AND NOT EXISTS (
              SELECT 1 FROM task_escalation_log l
               WHERE l.tat_instance_id = t.id
                 AND l.escalation_level = e.escalation_level
            )
      ORDER BY t.due_at ASC, e.escalation_level ASC
      LIMIT ${Math.max(1, Math.min(500, opts.limit ?? 50))}`,
    [opts.backfillFloor],
  );

  return (rows as RowDataPacket[]).map((r) => ({
    tatInstanceId: r.tat_instance_id,
    taskType: r.task_type,
    entityType: r.entity_type,
    entityId: r.entity_id,
    assignedTo: r.assigned_to ?? null,
    ownerUserId: r.owner_user_id ?? null,
    branchId: r.branch_id ?? null,
    processId: r.process_id ?? null,
    dueAt: r.due_at,
    escalationLevel: Number(r.escalation_level),
    notifyRole: r.notify_role ?? null,
    notifyUserId: r.notify_user_id ?? null,
    escalationAction: r.escalation_action ?? 'notify',
    hoursOverdue: Number(r.hours_overdue ?? 0),
  }));
}

/**
 * Record that a level has been escalated. Returns false when another worker got there
 * first — uq_tel_level (migration 1024) makes that a duplicate-key error rather than a
 * second notification.
 *
 * Column names here are the REAL ones: tat_instance_id, triggered_at, notified_user_id,
 * action_taken. The previous code used task_tat_instance_id / created_at / notify_user_id
 * / action, none of which exist, so every call threw.
 */
export async function recordEscalation(esc: DueEscalation): Promise<boolean> {
  try {
    await db.execute(
      `INSERT INTO task_escalation_log
         (id, tat_instance_id, escalation_level, triggered_at, notified_user_id, notify_role, action_taken)
       VALUES (?, ?, ?, NOW(), ?, ?, ?)`,
      [randomUUID(), esc.tatInstanceId, esc.escalationLevel, esc.notifyUserId, esc.notifyRole, esc.escalationAction],
    );
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}

/** Flag the instance as breached. Idempotent — safe to call on every escalation level. */
export async function markBreached(tatInstanceId: string): Promise<void> {
  await db.execute(
    `UPDATE task_tat_instance
        SET status = 'sla_breached', current_escalation_level = GREATEST(COALESCE(current_escalation_level,0), 1),
            updated_at = NOW()
      WHERE id = ? AND status <> 'completed'`,
    [tatInstanceId],
  );
}

/**
 * Legacy entry point, still routed from POST /api/governance/tat/tasks/recalculate.
 *
 * Kept so the existing route keeps working (CLAUDE.md rule 3), but it now only marks
 * overdue instances as breached. It deliberately does NOT notify: notification belongs to
 * tat-escalation.worker.ts, which owns the kill switch, the backfill floor and the caps.
 * An HTTP endpoint that can email hundreds of people is not something to leave lying around.
 */
export async function checkAndEscalate(): Promise<number> {
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE task_tat_instance
        SET status = 'sla_breached', updated_at = NOW()
      WHERE status = 'open' AND due_at < NOW()`,
  );
  return res.affectedRows ?? 0;
}

/**
 * Authorization gate for completing a TAT task. Previously the route (`requireAuth` only)
 * and `completeTatInstance` (bare `UPDATE ... WHERE id=?`) had no ownership or role check
 * at all — any authenticated user who knew or enumerated a task_tat_instance id could
 * complete anyone else's task. Mirrors `assertWorkItemAccess` in
 * modules/work-inbox/work-inbox.service.ts, the equivalent gate for the sibling `work_item`
 * table, so the two tables that make up the Work Inbox enforce access the same way.
 */
export async function assertTatTaskAccess(userId: string, taskId: string): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT assigned_to, owner_user_id, owner_role, status FROM task_tat_instance WHERE id = ? LIMIT 1",
    [taskId]
  );
  const task = (rows as RowDataPacket[])[0];
  if (!task) {
    throw Object.assign(new Error("TAT task not found"), { statusCode: 404 });
  }
  if (task.status === "completed" || task.status === "cancelled") {
    throw Object.assign(new Error("TAT task already " + task.status), { statusCode: 400 });
  }
  const { roleKeys } = await getUserRoleContext(userId);
  const isPrivileged = roleKeys.some((r) =>
    ["super_admin", "admin", "ho_hr", "hr_branch", "branch_head", "operations_head"].includes(r)
  );
  const isOwner = task.assigned_to === userId || task.owner_user_id === userId;
  const hasOwnerRole = task.owner_role && roleKeys.includes(task.owner_role);
  if (!isOwner && !hasOwnerRole && !isPrivileged) {
    throw Object.assign(new Error("Not authorized to complete this task"), { statusCode: 403 });
  }
}

/**
 * Mark a TAT instance as completed and log the completion in task_escalation_log.
 *
 * The UPDATE is conditioned on status here (not just in assertTatTaskAccess above) so two
 * concurrent completions of the same task can't both succeed and both write a completion
 * row to task_escalation_log — the second call's affectedRows is 0 and it throws rather
 * than silently duplicating the audit trail, the same race class fixed on completeWorkItem
 * in modules/work-inbox/work-inbox.service.ts.
 */
export async function completeTatInstance(id: string, completedBy: string): Promise<void> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE task_tat_instance
     SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = ? AND status NOT IN ('completed', 'cancelled')`,
    [id]
  );
  if (!result.affectedRows) {
    throw Object.assign(new Error("TAT task not found or already completed"), { statusCode: 409 });
  }

  // Real columns: tat_instance_id / triggered_at / notified_user_id / action_taken.
  // The previous names (task_tat_instance_id, action, notify_user_id, created_at) do not
  // exist, so completing a task threw after the status update had already committed.
  // Level 0 marks a completion row and cannot collide with escalation levels 1..3 under
  // uq_tel_level.
  await db.execute(
    `INSERT INTO task_escalation_log
       (id, tat_instance_id, escalation_level, triggered_at, notified_user_id, action_taken, resolved_at)
     VALUES (UUID(), ?, 0, NOW(), ?, 'completed', NOW())`,
    [id, completedBy]
  );
}
