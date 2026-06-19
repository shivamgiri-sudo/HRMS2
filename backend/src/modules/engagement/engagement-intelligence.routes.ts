import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, selfOrAdminHr } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { RowDataPacket } from "mysql2";
import type { Response, NextFunction } from "express";
import {
  calculateEmployeeEngagementHealth,
  scanEngagementHealth,
  getFilterOptions,
} from "./engagement-health.service.js";
import { resolvePeopleExperienceScope } from "../people-experience/people-experience.scope.js";
import { getPeopleExperienceCommandCenter } from "../people-experience/people-experience.service.js";

export const engagementIntelligenceRouter = Router();
engagementIntelligenceRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

// ── Command center with filter support ───────────────────────────────────────
engagementIntelligenceRouter.get(
  "/command-center",
  requireRole("admin", "hr", "manager", "process_manager", "ceo"),
  h(async (req, res) => {
    const scope = await resolvePeopleExperienceScope(req);
    const data = await getPeopleExperienceCommandCenter(scope, req.query as Record<string, string | undefined>);
    return res.json({ success: true, data });
  })
);

// ── Filter options (scoped dropdowns) ───────────────────────────────────────
engagementIntelligenceRouter.get(
  "/filter-options",
  requireRole("admin", "hr", "manager", "process_manager", "ceo"),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    // Determine roles for scoping
    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT r.role_key FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?`,
      [userId]
    );
    const userRoles = (roleRows as any[]).map(r => r.role_key as string);
    const data = await getFilterOptions(userId, userRoles);
    return res.json({ success: true, data });
  })
);

// ── Scan ─────────────────────────────────────────────────────────────────────
engagementIntelligenceRouter.post(
  "/scan",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const limit = Math.min(Number(req.body?.limit ?? 500), 2000);
    const data = await scanEngagementHealth(limit);
    return res.json({ success: true, data });
  })
);

// ── Per-employee health ───────────────────────────────────────────────────────
engagementIntelligenceRouter.get(
  "/health/me",
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ success: false, message: "No employee mapped" });
    const data = await calculateEmployeeEngagementHealth(emp.id);
    return res.json({ success: true, data });
  })
);

engagementIntelligenceRouter.get(
  "/health/:employeeId",
  selfOrAdminHr("employeeId"),
  h(async (req, res) => {
    const data = await calculateEmployeeEngagementHealth(req.params.employeeId);
    return res.json({ success: true, data });
  })
);

// ── People Experience Actions ─────────────────────────────────────────────────

// List actions (admin/hr see all; manager sees their team; employee sees own)
engagementIntelligenceRouter.get(
  "/actions",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT r.role_key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
      [userId]
    );
    const roles = (roleRows as any[]).map(r => r.role_key as string);
    const isAdminHr = roles.some(r => ["admin", "hr", "super_admin"].includes(r));

    const conds: string[] = [];
    const params: unknown[] = [];

    if (isAdminHr) {
      if (req.query.employee_id) { conds.push("a.employee_id = ?"); params.push(req.query.employee_id); }
      if (req.query.status)      { conds.push("a.status = ?");      params.push(req.query.status); }
      if (req.query.priority)    { conds.push("a.priority = ?");    params.push(req.query.priority); }
      if (req.query.owner_user_id) { conds.push("a.owner_user_id = ?"); params.push(req.query.owner_user_id); }
    } else {
      const emp = await getEmployeeForUser(userId);
      if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
      conds.push("(a.employee_id = ? OR a.owner_user_id = ?)");
      params.push(emp.id, userId);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.*,
              e.full_name AS employee_name,
              e.employee_code
         FROM people_experience_action a
         JOIN employees e ON e.id = a.employee_id
        ${where}
        ORDER BY a.due_date ASC, a.priority DESC
        LIMIT 200`,
      params
    );
    return res.json({ success: true, data: rows });
  })
);

// Create action
engagementIntelligenceRouter.post(
  "/actions",
  requireRole("admin", "hr", "manager", "process_manager"),
  h(async (req, res) => {
    const { employee_id, action_type, priority, owner_user_id, due_date, notes, source_type, source_id } = req.body;
    if (!employee_id || !action_type) return res.status(400).json({ error: "employee_id and action_type required" });

    const id = randomUUID();
    await db.execute(
      `INSERT INTO people_experience_action
         (id, employee_id, source_type, source_id, action_type, priority, owner_user_id, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, employee_id, source_type ?? "manual", source_id ?? null, action_type, priority ?? "medium",
       owner_user_id ?? null, due_date ?? null, notes ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM people_experience_action WHERE id = ? LIMIT 1`, [id]
    );
    return res.status(201).json({ success: true, data: (rows as any[])[0] });
  })
);

// Update / complete action
engagementIntelligenceRouter.patch(
  "/actions/:id",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { status, notes, completed_at } = req.body;

    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM people_experience_action WHERE id = ? LIMIT 1`, [req.params.id]
    );
    const action = (existing as any[])[0];
    if (!action) return res.status(404).json({ error: "Not found" });

    // Owner can complete their own; admin/hr can update any
    const isAdminHr = await (async () => {
      const [rr] = await db.execute<RowDataPacket[]>(
        `SELECT r.role_key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`, [userId]
      );
      return (rr as any[]).some(r => ["admin", "hr", "super_admin"].includes(r.role_key));
    })();

    if (!isAdminHr && action.owner_user_id !== userId) {
      return res.status(403).json({ success: false, message: "Not your action" });
    }

    const isCompleting = status === "completed";
    await db.execute(
      `UPDATE people_experience_action SET
         status = COALESCE(?, status),
         notes = COALESCE(?, notes),
         completed_at = IF(? = 'completed', COALESCE(completed_at, NOW()), completed_at),
         updated_at = NOW()
       WHERE id = ?`,
      [status ?? null, notes ?? null, status ?? "", req.params.id]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM people_experience_action WHERE id = ? LIMIT 1`, [req.params.id]
    );
    return res.json({ success: true, data: (rows as any[])[0], completed: isCompleting });
  })
);

// ── Kudos reactions ───────────────────────────────────────────────────────────
engagementIntelligenceRouter.post(
  "/kudos/:kudosId/reactions",
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ success: false, message: "No employee mapped" });
    const reactionType = String(req.body?.reactionType ?? "like");
    const allowed = new Set(["like", "celebrate", "inspire", "thanks", "comment"]);
    if (!allowed.has(reactionType)) return res.status(400).json({ success: false, message: "Invalid reaction type" });
    const comment = req.body?.comment ? String(req.body.comment).slice(0, 700) : null;
    await db.execute(
      `INSERT INTO kudos_reaction (id, kudos_id, employee_id, reaction_type, comment_text)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE comment_text = VALUES(comment_text), created_at = NOW()`,
      [randomUUID(), req.params.kudosId, emp.id, reactionType, comment]
    );
    return res.status(201).json({ success: true, message: "Reaction saved" });
  })
);

engagementIntelligenceRouter.post(
  "/kudos/:kudosId/moderate",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const action = String(req.body?.action ?? "reviewed");
    const allowed = new Set(["flagged", "hidden", "restored", "reviewed"]);
    if (!allowed.has(action)) return res.status(400).json({ success: false, message: "Invalid moderation action" });
    await db.execute(
      `INSERT INTO kudos_moderation_log (id, kudos_id, action, reason, action_by)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), req.params.kudosId, action, req.body?.reason ?? null, req.authUser!.id]
    );
    return res.json({ success: true, message: "Moderation saved" });
  })
);
