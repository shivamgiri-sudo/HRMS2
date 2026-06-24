import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { createTatInstance, checkAndEscalate, completeTatInstance } from "./tat.service.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── TAT Matrix CRUD ───────────────────────────────────────────────────────────

// GET /tat/matrix — list all active TAT matrix entries
router.get("/matrix", h(async (_req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM tat_matrix_master WHERE is_active = 1 ORDER BY task_type`
  );
  return res.json({ success: true, data: rows });
}));

// POST /tat/matrix — create or upsert a TAT matrix entry
router.post("/matrix", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { taskType, taskDescription, defaultTatHours, branchId, roleCode } = req.body as {
    taskType: string;
    taskDescription?: string;
    defaultTatHours?: number;
    branchId?: string;
    roleCode?: string;
  };
  if (!taskType) {
    return res.status(400).json({ success: false, message: "taskType is required" });
  }
  const id = randomUUID();
  await db.execute(
    `INSERT INTO tat_matrix_master
       (id, task_type, task_description, default_tat_hours, branch_id, role_code, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       default_tat_hours = VALUES(default_tat_hours),
       task_description = VALUES(task_description),
       updated_at = NOW()`,
    [id, taskType, taskDescription ?? null, defaultTatHours ?? 24, branchId ?? null, roleCode ?? null, req.authUser!.id]
  );
  return res.status(201).json({ success: true, id });
}));

// PUT /tat/matrix/:id — update a TAT matrix entry
router.put("/matrix/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { defaultTatHours, taskDescription, isActive } = req.body as {
    defaultTatHours?: number;
    taskDescription?: string;
    isActive?: number;
  };
  await db.execute(
    `UPDATE tat_matrix_master
     SET default_tat_hours = COALESCE(?, default_tat_hours),
         task_description = COALESCE(?, task_description),
         is_active = COALESCE(?, is_active),
         updated_at = NOW()
     WHERE id = ?`,
    [defaultTatHours ?? null, taskDescription ?? null, isActive ?? null, req.params.id]
  );
  return res.json({ success: true });
}));

// ── Escalation Matrix ─────────────────────────────────────────────────────────

// GET /tat/escalation-matrix — list all active escalation matrix entries
router.get("/escalation-matrix", h(async (_req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM escalation_matrix_master WHERE is_active = 1 ORDER BY task_type, escalation_level`
  );
  return res.json({ success: true, data: rows });
}));

// POST /tat/escalation-matrix — create an escalation matrix entry
router.post("/escalation-matrix", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { taskType, escalationLevel, triggerAfterHours, notifyRole, notifyUserId, escalationAction } = req.body as {
    taskType: string;
    escalationLevel?: number;
    triggerAfterHours: number;
    notifyRole?: string;
    notifyUserId?: string;
    escalationAction?: string;
  };
  if (!taskType || triggerAfterHours === undefined) {
    return res.status(400).json({ success: false, message: "taskType and triggerAfterHours are required" });
  }
  await db.execute(
    `INSERT INTO escalation_matrix_master
       (id, task_type, escalation_level, trigger_after_hours, notify_role, notify_user_id, escalation_action)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
    [taskType, escalationLevel ?? 1, triggerAfterHours, notifyRole ?? null, notifyUserId ?? null, escalationAction ?? "notify"]
  );
  return res.status(201).json({ success: true });
}));

// ── TAT Instances / Tasks ─────────────────────────────────────────────────────

// GET /tat/tasks — list tasks with optional filters
router.get("/tasks", h(async (req: AuthenticatedRequest, res: any) => {
  const { status, taskType, branchId } = req.query as Record<string, string>;
  const params: unknown[] = [];
  let where = "1=1";
  if (status) { where += " AND t.status = ?"; params.push(status); }
  if (taskType) { where += " AND t.task_type = ?"; params.push(taskType); }
  if (branchId) { where += " AND t.branch_id = ?"; params.push(branchId); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.*,
            TIMESTAMPDIFF(HOUR, t.created_at, NOW()) AS age_hours,
            CASE WHEN t.due_at < NOW() AND t.status = 'open' THEN 1 ELSE 0 END AS is_overdue
     FROM task_tat_instance t
     WHERE ${where}
     ORDER BY t.due_at ASC
     LIMIT 200`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// POST /tat/tasks — create a new TAT instance
router.post("/tasks", h(async (req: AuthenticatedRequest, res: any) => {
  const { taskType, entityType, entityId, assignedTo, branchId } = req.body as {
    taskType: string;
    entityType: string;
    entityId: string;
    assignedTo: string;
    branchId?: string;
  };
  if (!taskType || !entityType || !entityId || !assignedTo) {
    return res.status(400).json({ success: false, message: "taskType, entityType, entityId and assignedTo are required" });
  }
  const id = await createTatInstance(taskType, entityType, entityId, assignedTo, branchId);
  return res.status(201).json({ success: true, id });
}));

// POST /tat/tasks/recalculate — check and escalate SLA-breached tasks (admin/hr only)
router.post("/tasks/recalculate", requireRole("admin", "hr"), h(async (_req: any, res: any) => {
  const affected = await checkAndEscalate();
  return res.json({ success: true, affected });
}));

// POST /tat/tasks/:id/complete — mark a task as completed
router.post("/tasks/:id/complete", h(async (req: AuthenticatedRequest, res: any) => {
  await completeTatInstance(req.params.id, req.authUser!.id);
  return res.json({ success: true });
}));

// GET /tat/dashboard — aggregated TAT stats by task type and status
router.get("/dashboard", h(async (_req: any, res: any) => {
  const [stats] = await db.execute<RowDataPacket[]>(
    `SELECT
       task_type,
       status,
       COUNT(*) AS count,
       SUM(CASE WHEN due_at < NOW() AND status IN ('open', 'in_progress') THEN 1 ELSE 0 END) AS overdue_count,
       AVG(TIMESTAMPDIFF(HOUR, created_at, COALESCE(completed_at, NOW()))) AS avg_age_hours
     FROM task_tat_instance
     GROUP BY task_type, status
     ORDER BY task_type`
  );
  return res.json({ success: true, data: stats });
}));

export { router as tatRouter };
