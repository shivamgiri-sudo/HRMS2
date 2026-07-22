import { Router } from "express";
import type { NextFunction, Response } from "express";
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
  setPageCatalogActiveStatus,
} from "./user-page-access.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

type UserListRow = {
  id: string;
  email: string;
  full_name: string | null;
  employee_code: string | null;
  roles: string | null;
};

type RoleSummaryRow = {
  module_name: string | null;
  page_count: number | string | null;
  min_level: number | string | null;
};

type PermissionRow = {
  page_code: string;
  page_name: string | null;
  module: string | null;
  can_view: number | boolean;
  can_create: number | boolean;
  can_edit: number | boolean;
  can_delete: number | boolean;
  can_export: number | boolean;
};

type ActivityRow = {
  id: string;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  acted_at: string;
};

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
 * Read-only mismatch report for MySQL user_roles.
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

// Fast searchable users endpoint for the redesigned access-control page.
router.get("/users", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const search = String(req.query.search ?? "").trim();
  const limit = Math.max(1, Math.min(Number(req.query.limit ?? 20), 50));
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  const like = `%${search}%`;

  const where = search
    ? `WHERE au.is_blocked = 0 AND (
         au.email LIKE ?
         OR e.full_name LIKE ?
         OR e.employee_code LIKE ?
       )`
    : "WHERE au.is_blocked = 0";
  const params: unknown[] = search ? [like, like, like] : [];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       au.id,
       au.email,
       COALESCE(e.full_name, au.email) AS full_name,
       e.employee_code,
       GROUP_CONCAT(DISTINCT ur.role_key ORDER BY ur.role_key) AS roles
     FROM auth_user au
     LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
     LEFT JOIN user_roles ur ON ur.user_id = au.id AND ur.active_status = 1
     ${where}
     GROUP BY au.id, au.email, e.full_name, e.employee_code
     ORDER BY COALESCE(e.full_name, au.email)
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  res.json({
    success: true,
    data: (rows as UserListRow[]).map((row) => ({
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      employee_code: row.employee_code,
      roles: row.roles ? String(row.roles).split(",") : [],
    })),
  });
}));

router.get("/roles/:roleKey/summary", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const roleKey = req.params.roleKey;
  const [[role]] = await db.execute<RowDataPacket[]>(
    `SELECT role_key, role_name, description
     FROM workforce_role_catalog
     WHERE role_key = ? AND active_status = 1
     LIMIT 1`,
    [roleKey]
  );

  if (!role) {
    return res.status(404).json({ success: false, error: "Role not found" });
  }

  const [[counts]] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(DISTINCT user_id) FROM user_roles WHERE role_key = ? AND active_status = 1) AS user_count,
       (SELECT COUNT(DISTINCT page_code) FROM role_page_access WHERE role_key = ? AND active_status = 1 AND can_view = 1) AS page_count`,
    [roleKey, roleKey]
  );

  const [modules] = await db.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(pc.module, rpa.page_code, 'Unassigned') AS module_name,
       COUNT(DISTINCT rpa.page_code) AS page_count,
       MIN(CASE
         WHEN rpa.can_view = 1 AND rpa.can_create = 1 AND rpa.can_edit = 1 AND rpa.can_delete = 1 AND rpa.can_export = 1 THEN 5
         WHEN rpa.can_view = 1 AND rpa.can_create = 1 AND rpa.can_edit = 1 THEN 4
         WHEN rpa.can_view = 1 AND rpa.can_edit = 1 THEN 3
         WHEN rpa.can_view = 1 THEN 2
         ELSE 1
       END) AS min_level
     FROM role_page_access rpa
     LEFT JOIN page_catalog pc ON pc.page_code = rpa.page_code
     WHERE rpa.role_key = ? AND rpa.active_status = 1
     GROUP BY COALESCE(pc.module, rpa.page_code, 'Unassigned')
     ORDER BY module_name`,
    [roleKey]
  );

  const levelName = (level: number) => {
    if (level >= 5) return "full-access";
    if (level === 4) return "creator";
    if (level === 3) return "editor";
    if (level === 2) return "view-only";
    return "no-access";
  };

  res.json({
    success: true,
    data: {
      role_key: role.role_key,
      role_name: role.role_name,
      role_description: role.description,
      user_count: Number(counts?.user_count ?? 0),
      page_count: Number(counts?.page_count ?? 0),
      modules: (modules as RoleSummaryRow[]).map((module) => ({
        module_name: module.module_name,
        page_count: Number(module.page_count ?? 0),
        access_level: levelName(Number(module.min_level ?? 1)),
      })),
    },
  });
}));

router.get("/roles/:roleKey/permissions", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = await listRolePageAccessByRole(req.params.roleKey);
  res.json({
    success: true,
    data: (rows as PermissionRow[]).map((row) => ({
      page_code: row.page_code,
      page_name: row.page_name,
      module: row.module,
      permissions: {
        can_view: Boolean(row.can_view),
        can_create: Boolean(row.can_create),
        can_edit: Boolean(row.can_edit),
        can_delete: Boolean(row.can_delete),
        can_export: Boolean(row.can_export),
      },
    })),
  });
}));

router.put("/roles/:roleKey/permissions", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const roleKey = req.params.roleKey;
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
  if (updates.length === 0) {
    return res.status(400).json({ success: false, error: "updates array required" });
  }

  for (const update of updates) {
    if (!update?.page_code || !update?.permissions) continue;
    await upsertRolePageAccess(roleKey, update.page_code, update.permissions, req.authUser!.id);
  }

  res.json({ success: true, updated_count: updates.length });
}));

router.get("/rbac/status", requireRole("admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const report = await getRbacReconciliation();
  res.json({
    success: true,
    data: {
      synced: report.mismatches.length === 0,
      last_sync: report.checked_at,
      conflicts_count: report.mismatches.length,
      mysql_count: report.total_mysql_users,
    },
  });
}));

router.post("/rbac/sync", requireRole("admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const report = await getRbacReconciliation();
  res.json({
    success: true,
    data: {
      synced: report.mismatches.length === 0,
      conflicts_count: report.mismatches.length,
      checked_at: report.checked_at,
    },
  });
}));

router.get("/activity", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit ?? 10), 100));
  const logs = await querySensitiveActionLog({ module_key: "ACCESS_CONTROL", limit });
  res.json({
    success: true,
    data: (logs as ActivityRow[]).map((log) => ({
      id: log.id,
      action: log.action_type,
      user_email: null,
      description: `${log.action_type} on ${log.entity_type ?? "record"} ${log.entity_id ?? ""}`.trim(),
      created_at: log.acted_at,
    })),
  });
}));

// Get roles for a user (admin/hr)
router.get("/roles/user/:userId", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await getUserRoles(req.params.userId) });
}));

// Assign role (admin only — writes MySQL, audited)
router.post("/roles/assign", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, role_key } = req.body;
  if (!user_id || !role_key) return res.status(400).json({ error: "user_id and role_key required" });
  const actorRoles = ((req as AuthenticatedRequest & { userRoles?: string[] }).userRoles ?? []);
  if (role_key === "super_admin" && !actorRoles.includes("super_admin")) {
    return res.status(403).json({ error: "Only a super administrator can assign the super_admin role" });
  }
  await assignRole(user_id, role_key, req.authUser!.id, req);
  res.json({ ok: true });
}));

// Revoke role (admin only — writes MySQL, audited)
router.post("/roles/revoke", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, role_key } = req.body;
  if (!user_id || !role_key) return res.status(400).json({ error: "user_id and role_key required" });
  if (user_id === req.authUser!.id) {
    return res.status(400).json({ error: "You cannot revoke your own role" });
  }
  const actorRoles = ((req as AuthenticatedRequest & { userRoles?: string[] }).userRoles ?? []);
  if (role_key === "super_admin" && !actorRoles.includes("super_admin")) {
    return res.status(403).json({ error: "Only a super administrator can revoke the super_admin role" });
  }
  await revokeRole(user_id, role_key, req.authUser!.id, req);
  res.json({ ok: true });
}));

// GET /api/access/branches — lightweight branch list for scope picker (admin/hr)
router.get("/branches", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name, branch_code FROM branch_master WHERE active_status = 1 ORDER BY branch_name`
  );
  res.json({ success: true, data: rows });
}));

// GET /api/access/processes — lightweight process list for scope picker (admin/hr)
router.get("/processes", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const branchId = String(req.query.branchId ?? "").trim();
  const where = branchId
    ? `WHERE pm.active_status = 1 AND EXISTS (SELECT 1 FROM employees e WHERE e.process_id = pm.id AND e.branch_id = ? AND e.active_status = 1)`
    : `WHERE pm.active_status = 1`;
  const params = branchId ? [branchId] : [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pm.id, pm.process_name, pm.process_code FROM process_master pm ${where} ORDER BY pm.process_name`,
    params
  );
  res.json({ success: true, data: rows });
}));

// GET /api/access/roles/user-scopes/:userId — get all scope assignments for a user (admin)
router.get("/roles/user-scopes/:userId", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT uas.id, uas.role_key, uas.scope_type, uas.branch_id, uas.process_id,
            uas.department_id, uas.active_status, uas.assigned_at,
            b.branch_name, pm.process_name,
            wrc.role_name
     FROM user_assignment_scope uas
     LEFT JOIN branch_master b ON b.id = uas.branch_id
     LEFT JOIN process_master pm ON pm.id = uas.process_id
     LEFT JOIN workforce_role_catalog wrc ON wrc.role_key = uas.role_key
     WHERE uas.user_id = ? AND uas.active_status = 1
     ORDER BY uas.role_key, uas.assigned_at DESC`,
    [req.params.userId]
  );
  res.json({ success: true, data: rows });
}));

// POST /api/access/roles/assign-scope — assign a branch/process scope to a user's role (admin)
router.post("/roles/assign-scope", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, role_key, scope_type, branch_id, process_id } = req.body;
  if (!user_id || !role_key || !scope_type) {
    return res.status(400).json({ error: "user_id, role_key and scope_type are required" });
  }
  // Verify the user actually has this role active
  const [[roleRow]] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM user_roles WHERE user_id = ? AND role_key = ? AND active_status = 1 LIMIT 1`,
    [user_id, role_key]
  );
  if (!roleRow) {
    return res.status(400).json({ error: `User does not have active role '${role_key}'. Assign the role first.` });
  }
  // Avoid exact duplicates (same user+role+scope_type+branch+process active)
  const [[existing]] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM user_assignment_scope
     WHERE user_id = ? AND role_key = ? AND scope_type = ?
       AND (branch_id <=> ?) AND (process_id <=> ?) AND active_status = 1
     LIMIT 1`,
    [user_id, role_key, scope_type, branch_id ?? null, process_id ?? null]
  );
  if (existing) {
    return res.json({ ok: true, note: "scope already exists" });
  }
  await db.execute(
    `INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, branch_id, process_id, active_status, assigned_by_user_id, assigned_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, 1, ?, NOW())`,
    [user_id, role_key, scope_type, branch_id ?? null, process_id ?? null, req.authUser!.id]
  );
  res.json({ ok: true });
}));

// DELETE /api/access/roles/remove-scope/:scopeId — remove a scope row (admin)
router.delete("/roles/remove-scope/:scopeId", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  await db.execute(
    `UPDATE user_assignment_scope SET active_status = 0 WHERE id = ?`,
    [req.params.scopeId]
  );
  res.json({ ok: true });
}));

// Sensitive action log query (admin only)
// Import getAuditLogExtended from audit.log.routes
// This endpoint now supports rich filtering via audit.log.routes.getAuditLogExtended
router.get("/audit-log", requireAuth, h(async (req: AuthenticatedRequest, res: Response) => {
  // Delegate to extended audit log function with role-based filtering
  const { getAuditLogExtended: getAuditFn } = await import("../../modules/audit/audit.log.routes.js");
  return getAuditFn(req as AuthenticatedRequest & { authUser: NonNullable<AuthenticatedRequest["authUser"]> }, res);
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
router.get("/pages/catalog", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const includeDisabled = req.query.include_disabled === "true" || req.query.includeDisabled === "true";
  const pages = await listPageCatalog(includeDisabled);
  res.json({ success: true, data: pages });
}));

// PATCH /api/access/pages/catalog/:pageCode/status - global compliance page availability switch
router.patch("/pages/catalog/:pageCode/status", requireRole("super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const pageCode = String(req.params.pageCode || "").trim();
  const rawStatus = req.body?.active_status ?? req.body?.active;

  if (!pageCode) {
    return res.status(400).json({ success: false, error: "pageCode required" });
  }

  const active = typeof rawStatus === "boolean"
    ? rawStatus
    : rawStatus === 1 || rawStatus === "1" || rawStatus === "true";

  if (![true, false, 1, 0, "1", "0", "true", "false"].includes(rawStatus)) {
    return res.status(400).json({ success: false, error: "active_status must be true/false or 1/0" });
  }

  if (pageCode === "ACCESS_CONTROL" && !active) {
    return res.status(400).json({
      success: false,
      error: "ACCESS_CONTROL cannot be globally disabled because it is required to re-enable pages.",
    });
  }

  await setPageCatalogActiveStatus(pageCode, active, req.authUser!.id, req.body?.notes ?? null);
  res.json({ success: true, data: { page_code: pageCode, active_status: active ? 1 : 0 } });
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

// GET /api/access/requests — redesign alias for access request queue
router.get("/requests", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const status = req.query.status as "pending" | "approved" | "denied" | undefined;
  res.json({ success: true, data: await listAccessRequests(status) });
}));

// POST /api/access/requests/:id/approve — redesign alias
router.post("/requests/:id/approve", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  await approveAccessRequest(req.params.id, req.authUser!.id);
  res.json({ success: true });
}));

// POST /api/access/requests/:id/deny — redesign alias
router.post("/requests/:id/deny", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { reason, review_note } = req.body;
  await denyAccessRequest(req.params.id, req.authUser!.id, review_note ?? reason ?? "");
  res.json({ success: true });
}));

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
