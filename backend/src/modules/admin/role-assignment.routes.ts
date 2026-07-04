import { Router } from "express";
import type { NextFunction, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { assignRole, getUserRoles, listRoleCatalog, revokeRole } from "../access/access.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

router.use(requireAuth);
router.use(requireRole("admin"));

function actorCanManageRole(req: AuthenticatedRequest, roleKey: string) {
  const roles = ((req as AuthenticatedRequest & { userRoles?: string[] }).userRoles ?? []);
  return roleKey !== "super_admin" || roles.includes("super_admin");
}

router.get("/roles", h(async (_req: AuthenticatedRequest, res: Response) => {
  return res.json({ success: true, data: await listRoleCatalog() });
}));

router.get("/users/:userId/roles", h(async (req: AuthenticatedRequest, res: Response) => {
  return res.json({ success: true, data: await getUserRoles(req.params.userId) });
}));

router.post("/users/:userId/roles", h(async (req: AuthenticatedRequest, res: Response) => {
  const roleKey = String(req.body?.roleKey ?? "");
  if (!roleKey) {
    return res.status(400).json({ success: false, message: "roleKey is required" });
  }
  if (!actorCanManageRole(req, roleKey)) {
    return res.status(403).json({ success: false, message: "Only a super administrator can assign super_admin" });
  }

  await assignRole(req.params.userId, roleKey, req.authUser!.id, req);
  const roles = await getUserRoles(req.params.userId);
  return res.json({
    success: true,
    data: roles.find((role) => role.role_key === roleKey) ?? null,
    message: `Role '${roleKey}' assigned successfully`,
  });
}));

router.delete("/users/:userId/roles/:roleKey", h(async (req: AuthenticatedRequest, res: Response) => {
  const { userId, roleKey } = req.params;
  if (userId === req.authUser!.id) {
    return res.status(400).json({ success: false, message: "You cannot revoke your own role" });
  }
  if (!actorCanManageRole(req, roleKey)) {
    return res.status(403).json({ success: false, message: "Only a super administrator can revoke super_admin" });
  }

  await revokeRole(userId, roleKey, req.authUser!.id, req);
  return res.json({ success: true, message: `Role '${roleKey}' revoked successfully` });
}));

router.get("/role-audit", h(async (req: AuthenticatedRequest, res: Response) => {
  const { userId, roleKey, fromDate, toDate } = req.query as Record<string, string | undefined>;
  const limit = Math.max(1, Math.min(Number(req.query.limit ?? 200), 500));
  const conditions = ["sal.module_key = 'ACCESS_CONTROL'", "sal.action_type IN ('ROLE_ASSIGNED', 'ROLE_REVOKED')"];
  const params: unknown[] = [];
  if (userId) { conditions.push("sal.entity_id = ?"); params.push(userId); }
  if (roleKey) { conditions.push("JSON_UNQUOTE(JSON_EXTRACT(sal.change_summary, '$.role_key')) = ?"); params.push(roleKey); }
  if (fromDate) { conditions.push("sal.acted_at >= ?"); params.push(fromDate); }
  if (toDate) { conditions.push("sal.acted_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(toDate); }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sal.id, sal.entity_id AS user_id, au.email AS user_email,
            sal.action_type, sal.change_summary, sal.actor_user_id,
            actor.email AS actor_email, sal.acted_at
       FROM sensitive_action_log sal
       LEFT JOIN auth_user au ON au.id = sal.entity_id
       LEFT JOIN auth_user actor ON actor.id = sal.actor_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY sal.acted_at DESC
      LIMIT ${limit}`,
    params
  );
  return res.json({ success: true, data: rows });
}));

router.post("/users/bulk-assign", h(async (req: AuthenticatedRequest, res: Response) => {
  const assignments = req.body?.assignments as Array<{ userId: string; roleKey: string }> | undefined;
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ success: false, message: "assignments array is required" });
  }
  if (assignments.some(({ roleKey }) => !actorCanManageRole(req, roleKey))) {
    return res.status(403).json({ success: false, message: "Only a super administrator can assign super_admin" });
  }

  const results = { success: 0, failed: 0, errors: [] as string[] };
  for (const assignment of assignments) {
    try {
      await assignRole(assignment.userId, assignment.roleKey, req.authUser!.id, req);
      results.success += 1;
    } catch (error) {
      results.failed += 1;
      results.errors.push(`User ${assignment.userId}: ${(error as Error).message}`);
    }
  }
  return res.json({ success: true, data: results });
}));

export { router as roleAssignmentRouter };
