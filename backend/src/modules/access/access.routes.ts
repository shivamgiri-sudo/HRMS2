import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  getRbacReconciliation, assignRole, revokeRole,
  getUserRoles, listRoleCatalog, querySensitiveActionLog,
  getAccessMe,
} from "./access.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

/**
 * GET /api/access/me
 * Returns the authenticated user's identity, MySQL roles, assignment scopes, and page permissions.
 * Used by useUserRole hook as the single source of truth for frontend RBAC.
 */
router.get("/me", h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await getAccessMe(req.authUser!.id);
  res.json({ success: true, data });
}));

/**
 * GET /api/access/rbac-reconciliation
 * Read-only mismatch report between MySQL user_roles (authority) and Supabase user_roles (UI mirror).
 * Admin only. No writes, no auto-fix, no backfill.
 */
router.get(
  "/rbac-reconciliation",
  requireRole("admin"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const report = await getRbacReconciliation();
    res.json({ data: report });
  })
);

// Role catalog (admin/hr)
router.get("/roles/catalog", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await listRoleCatalog() });
}));

// Get roles for a user (admin/hr)
router.get("/roles/user/:userId", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await getUserRoles(req.params.userId) });
}));

// Assign role (admin only — writes MySQL, audited)
router.post("/roles/assign", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, role_key } = req.body;
  if (!user_id || !role_key) return res.status(400).json({ error: "user_id and role_key required" });
  await assignRole(user_id, role_key, req.authUser!.id, req);
  res.json({ ok: true });
}));

// Revoke role (admin only — writes MySQL, audited)
router.post("/roles/revoke", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, role_key } = req.body;
  if (!user_id || !role_key) return res.status(400).json({ error: "user_id and role_key required" });
  await revokeRole(user_id, role_key, req.authUser!.id, req);
  res.json({ ok: true });
}));

// Sensitive action log query (admin only)
router.get("/audit-log", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { actor_user_id, module_key, action_type, entity_type, entity_id, limit } = req.query as Record<string, string>;
  const logs = await querySensitiveActionLog({
    actor_user_id, module_key, action_type, entity_type, entity_id,
    limit: limit ? parseInt(limit, 10) : undefined,
  });
  res.json({ data: logs });
}));

// GET /api/access/page-access — all role_page_access entries (admin only)
router.get("/page-access", requireRole("admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status FROM role_page_access ORDER BY role_key, page_code"
  );
  res.json({ data: rows });
}));

export { router as accessRouter };
