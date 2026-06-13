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
import {
  listRolePageAccessByRole, upsertRolePageAccess, deleteRolePageAccess,
  listDesignationRoleMap, upsertDesignationRoleMap, deleteDesignationRoleMap,
  createAccessRequest, listAccessRequests, approveAccessRequest, denyAccessRequest,
} from "./role-page-access.service.js";
import {
  listPageCatalog,
  listUsersForAccess,
  getUserPageAccess,
  getUserEffectivePageAccess,
  assignUserPageAccess,
  revokeUserPageAccess,
  bulkAssignUserPageAccess,
  getUserPageAccessAuditLog,
  listAllUserPageAccess,
} from "./user-page-access.service.js";
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
 * GET /api/access/pages/my-catalog
 * User-safe page catalog for module launcher and role-based navigation.
 * Unlike /pages/catalog, this does not expose pages the current user cannot view.
 */
router.get("/pages/my-catalog", h(async (req: AuthenticatedRequest, res: Response) => {
  const access = await getAccessMe(req.authUser!.id);
  const allowedCodes = new Set(access.pages.filter((page) => page.can_view).map((page) => page.page_code));

  if (allowedCodes.size === 0) {
    return res.json({ success: true, data: [] });
  }

  const catalog = await listPageCatalog();
  const data = catalog.filter((page: { page_code: string }) => allowedCodes.has(page.page_code));
  return res.json({ success: true, data });
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

// ============ USER PAGE ACCESS MANAGEMENT (ADMIN ONLY) ============

// GET /api/access/pages/catalog — list all available pages
router.get("/pages/catalog", requireRole("admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const pages = await listPageCatalog();
  res.json({ success: true, data: pages });
}));

// GET /api/access/users-for-access — list all users for assignment
router.get("/users-for-access", requireRole("admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const users = await listUsersForAccess();
  res.json({ success: true, data: users });
}));

// GET /api/access/user-page-access/:userId — get user's direct page assignments
router.get("/user-page-access/:userId", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const access = await getUserPageAccess(req.params.userId);
  res.json({ success: true, data: access });
}));

// GET /api/access/user-page-access/:userId/effective — get user's effective page access (role + user overrides)
router.get("/user-page-access/:userId/effective", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const access = await getUserEffectivePageAccess(req.params.userId);
  res.json({ success: true, data: access });
}));

// POST /api/access/user-page-access/assign — assign page access to user (expires_at optional)
router.post("/user-page-access/assign", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, page_code, permissions, notes, expires_at } = req.body;

  if (!user_id || !page_code || !permissions) {
    return res.status(400).json({ success: false, error: "user_id, page_code, and permissions required" });
  }

  await assignUserPageAccess(user_id, page_code, permissions, req.authUser!.id, notes, expires_at ?? null);
  res.json({ success: true, message: "Page access assigned successfully" });
}));

// POST /api/access/user-page-access/bulk-assign — bulk assign multiple pages to user
router.post("/user-page-access/bulk-assign", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, assignments, notes } = req.body;

  if (!user_id || !assignments || !Array.isArray(assignments)) {
    return res.status(400).json({ success: false, error: "user_id and assignments array required" });
  }

  await bulkAssignUserPageAccess(user_id, assignments, req.authUser!.id, notes);
  res.json({ success: true, message: `${assignments.length} page(s) assigned successfully` });
}));

// POST /api/access/user-page-access/revoke — revoke user's page access
router.post("/user-page-access/revoke", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, page_code, notes } = req.body;

  if (!user_id || !page_code) {
    return res.status(400).json({ success: false, error: "user_id and page_code required" });
  }

  await revokeUserPageAccess(user_id, page_code, req.authUser!.id, notes);
  res.json({ success: true, message: "Page access revoked successfully" });
}));

// GET /api/access/user-page-access-audit — get audit log for page access assignments
router.get("/user-page-access-audit", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, page_code, limit } = req.query as Record<string, string>;
  const auditLog = await getUserPageAccessAuditLog(
    user_id,
    page_code,
    limit ? parseInt(limit, 10) : 100
  );
  res.json({ success: true, data: auditLog });
}));

// GET /api/access/user-page-access-all — list all user page access assignments
router.get("/user-page-access-all", requireRole("admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const assignments = await listAllUserPageAccess();
  res.json({ success: true, data: assignments });
}));

// ============ ROLE → PAGE ACCESS MANAGEMENT (ADMIN ONLY) ============

// GET /api/access/role-page-access/:roleKey — list all page perms for a role
router.get("/role-page-access/:roleKey", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = await listRolePageAccessByRole(req.params.roleKey);
  res.json({ success: true, data: rows });
}));

// PUT /api/access/role-page-access — upsert a role→page permission entry
router.put("/role-page-access", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { role_key, page_code, permissions } = req.body;
  if (!role_key || !page_code || !permissions) {
    return res.status(400).json({ success: false, error: "role_key, page_code, and permissions required" });
  }
  await upsertRolePageAccess(role_key, page_code, permissions, req.authUser!.id);
  res.json({ success: true });
}));

// DELETE /api/access/role-page-access/:roleKey/:pageCode — soft-delete a role→page permission entry
router.delete("/role-page-access/:roleKey/:pageCode", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { roleKey, pageCode } = req.params;
  if (!roleKey || !pageCode) {
    return res.status(400).json({ success: false, error: "roleKey and pageCode URL params required" });
  }
  await deleteRolePageAccess(roleKey, pageCode, req.authUser!.id);
  res.json({ success: true });
}));

// ============ DESIGNATION → ROLE MAP (ADMIN ONLY) ============

// GET /api/access/designation-role-map
router.get("/designation-role-map", requireRole("admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await listDesignationRoleMap() });
}));

// POST /api/access/designation-role-map — add a mapping
router.post("/designation-role-map", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { designation_id, role_key } = req.body;
  if (!designation_id || !role_key) {
    return res.status(400).json({ success: false, error: "designation_id and role_key required" });
  }
  await upsertDesignationRoleMap(designation_id, role_key, req.authUser!.id);
  res.json({ success: true });
}));

// DELETE /api/access/designation-role-map/:id
router.delete("/designation-role-map/:id", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  await deleteDesignationRoleMap(req.params.id, req.authUser!.id);
  res.json({ success: true });
}));

// ============ ACCESS REQUEST WORKFLOW ============

// GET /api/access/access-requests — admin lists requests
router.get("/access-requests", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const status = req.query.status as "pending" | "approved" | "denied" | undefined;
  res.json({ success: true, data: await listAccessRequests(status) });
}));

// POST /api/access/access-requests — any user submits a request
router.post("/access-requests", h(async (req: AuthenticatedRequest, res: Response) => {
  const { page_code, reason } = req.body;
  if (!page_code) {
    return res.status(400).json({ success: false, error: "page_code required" });
  }
  const id = await createAccessRequest(req.authUser!.id, page_code, reason ?? "");
  res.json({ success: true, id });
}));

// POST /api/access/access-requests/:id/approve
router.post("/access-requests/:id/approve", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  await approveAccessRequest(req.params.id, req.authUser!.id);
  res.json({ success: true });
}));

// POST /api/access/access-requests/:id/deny
router.post("/access-requests/:id/deny", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { reason } = req.body;
  await denyAccessRequest(req.params.id, req.authUser!.id, reason ?? "");
  res.json({ success: true });
}));

export { router as accessRouter };
