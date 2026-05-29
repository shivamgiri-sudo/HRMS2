import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  getRbacReconciliation, assignRole, revokeRole,
  getUserRoles, listRoleCatalog, querySensitiveActionLog,
} from "./access.service.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

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

export { router as accessRouter };
