import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getUserRoleContext } from "../../shared/roleResolver.js";

export type WorkItemInput = {
  itemType: string;
  title: string;
  description?: string;
  moduleCode: string;
  entityType: string;
  entityId: string;
  assignedToUserId?: string;
  assignedToRole?: string;
  branchId?: string;
  processId?: string;
  priority?: "low" | "medium" | "high" | "critical";
  dueAt?: string;
  createdBy?: string;
};

export async function assertWorkItemAccess(
  userId: string,
  workItemId: string,
  action: 'complete' | 'escalate' | 'reassign'
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT assigned_to_user_id, assigned_to_role, status FROM work_item WHERE id = ? LIMIT 1',
    [workItemId]
  );
  if (!(rows as any[]).length) {
    throw Object.assign(new Error('Work item not found'), { statusCode: 404 });
  }
  const item = (rows as any)[0];
  if (item.status === 'completed' || item.status === 'cancelled') {
    throw Object.assign(new Error('Work item already ' + item.status), { statusCode: 400 });
  }
  const { roleKeys } = await getUserRoleContext(userId);
  const isPrivileged = roleKeys.some(r =>
    ['super_admin', 'admin', 'ho_hr', 'hr_branch', 'branch_head', 'operations_head'].includes(r)
  );
  if (item.assigned_to_user_id !== userId && !isPrivileged) {
    throw Object.assign(new Error('Not authorized to ' + action + ' this work item'), { statusCode: 403 });
  }
}

export async function createWorkItem(input: WorkItemInput): Promise<string> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO work_item (id, item_type, title, description, module_code, entity_type, entity_id,
       assigned_to_user_id, assigned_to_role, branch_id, process_id, priority, status, due_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id, input.itemType, input.title, input.description ?? null, input.moduleCode,
      input.entityType, input.entityId, input.assignedToUserId ?? null,
      input.assignedToRole ?? null, input.branchId ?? null, input.processId ?? null,
      input.priority ?? "medium", input.dueAt ?? null, input.createdBy ?? null,
    ]
  );
  return id;
}

export async function getMyWorkItems(userId: string, role: string, limit = 50, offset = 0) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wi.*, e.full_name as assigned_employee_name
     FROM work_item wi
     LEFT JOIN employees e ON e.auth_user_id = wi.assigned_to_user_id
     WHERE (wi.assigned_to_user_id = ? OR wi.assigned_to_role = ?)
       AND wi.status NOT IN ('completed', 'cancelled')
     ORDER BY FIELD(wi.priority,'critical','high','medium','low'), wi.due_at ASC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [userId, role]
  );
  return rows;
}

export async function getTeamWorkItems(userId: string, limit = 100) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wi.* FROM work_item wi
     WHERE wi.created_by = ?
        OR wi.branch_id IN (SELECT branch_id FROM employees WHERE auth_user_id = ?)
     ORDER BY wi.created_at DESC LIMIT ?`,
    [userId, userId, limit]
  );
  return rows;
}

export async function completeWorkItem(id: string, userId: string, remarks?: string): Promise<void> {
  await db.execute(
    `UPDATE work_item SET status='completed', completed_at=NOW(), completed_by=?, updated_at=NOW() WHERE id=?`,
    [userId, id]
  );
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by)
     VALUES (UUID(), ?, 'complete', 'pending', 'completed', ?, ?)`,
    [id, remarks ?? null, userId]
  );
}

export async function escalateWorkItem(id: string, userId: string, remarks?: string): Promise<void> {
  await db.execute(
    `UPDATE work_item SET escalation_level = escalation_level + 1, status='escalated', updated_at=NOW() WHERE id=?`,
    [id]
  );
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by)
     VALUES (UUID(), ?, 'escalate', 'pending', 'escalated', ?, ?)`,
    [id, remarks ?? null, userId]
  );
}

export async function reassignWorkItem(id: string, toUserId: string, byUserId: string, remarks?: string): Promise<void> {
  await db.execute(
    `UPDATE work_item SET assigned_to_user_id=?, updated_at=NOW() WHERE id=?`,
    [toUserId, id]
  );
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by)
     VALUES (UUID(), ?, 'reassign', 'pending', 'pending', ?, ?)`,
    [id, remarks ?? null, byUserId]
  );
}

export async function createWorkItemIfNotExists(
  input: WorkItemInput & { dedupKey?: string }
): Promise<string | null> {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM work_item WHERE entity_type=? AND entity_id=? AND item_type=? AND status='pending' LIMIT 1`,
    [input.entityType, input.entityId, input.itemType]
  );
  if ((existing as RowDataPacket[]).length > 0) {
    return (existing as RowDataPacket[])[0].id as string;
  }
  return createWorkItem(input);
}

export async function getWorkItemStats(userId: string, role: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT module_code,
            COUNT(*) as count,
            SUM(CASE WHEN priority='critical' THEN 1 ELSE 0 END) as critical_count,
            SUM(CASE WHEN due_at < NOW() AND status='pending' THEN 1 ELSE 0 END) as overdue_count
     FROM work_item
     WHERE (assigned_to_user_id=? OR assigned_to_role=?) AND status='pending'
     GROUP BY module_code`,
    [userId, role]
  );
  const byModule: Record<string, number> = {};
  let pending = 0;
  let critical = 0;
  let overdue = 0;
  for (const row of rows as RowDataPacket[]) {
    byModule[row.module_code] = Number(row.count);
    pending += Number(row.count);
    critical += Number(row.critical_count);
    overdue += Number(row.overdue_count);
  }
  return { pending, overdue, critical, byModule };
}

export async function getOverdueItems(userId: string, role: string, limit = 50) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM work_item
     WHERE (assigned_to_user_id=? OR assigned_to_role=?)
       AND due_at < NOW()
       AND status='pending'
     ORDER BY due_at ASC
     LIMIT ?`,
    [userId, role, limit]
  );
  return rows;
}

export async function getDashboardWorkItems(branchId?: string, processId?: string) {
  const params: string[] = [];
  let where = "wi.status NOT IN ('completed','cancelled')";
  if (branchId) { where += " AND wi.branch_id = ?"; params.push(branchId); }
  if (processId) { where += " AND wi.process_id = ?"; params.push(processId); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wi.item_type, wi.priority, COUNT(*) as count,
            SUM(CASE WHEN wi.due_at < NOW() THEN 1 ELSE 0 END) as overdue_count
     FROM work_item wi WHERE ${where}
     GROUP BY wi.item_type, wi.priority
     ORDER BY wi.priority`,
    params
  );
  return rows;
}
