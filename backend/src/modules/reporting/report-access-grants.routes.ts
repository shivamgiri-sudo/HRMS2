import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { REPORT_CATALOG } from "./report-catalog.js";

export const reportAccessGrantsRouter = Router();
reportAccessGrantsRouter.use(requireAuth);
reportAccessGrantsRouter.use(requireRole("super_admin", "admin"));

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<void>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// ── Catalog helper ─────────────────────────────────────────────────────────────

// GET /api/reports/access-grants/catalog
// Returns full report list for the grant picker (code + name + category).
reportAccessGrantsRouter.get("/catalog", h(async (_req, res) => {
  const data = REPORT_CATALOG
    .filter((r) => !["deprecated", "disabled"].includes(r.availabilityStatus ?? ""))
    .map((r) => ({ code: r.code, name: r.name, category: r.category }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return res.json({ success: true, data });
}));

// ── Per-employee grants ────────────────────────────────────────────────────────

// GET /api/reports/access-grants/user?userId=X
reportAccessGrantsRouter.get("/user", h(async (req, res) => {
  const userId = req.query.userId ? Number(req.query.userId) : null;
  if (!userId || Number.isNaN(userId)) {
    return res.status(400).json({ success: false, error: "userId query param required." });
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id, p.report_code, p.can_view, p.can_export,
            p.granted_at, p.expires_at,
            CONCAT(e.first_name, ' ', e.last_name) AS granted_by_name
     FROM user_report_permissions p
     LEFT JOIN employees e ON e.user_id = p.granted_by
     WHERE p.user_id = ? AND p.active_status = 1
     ORDER BY p.granted_at DESC`,
    [userId]
  );
  const data = (rows as any[]).map((row) => {
    const entry = REPORT_CATALOG.find((r) => r.code === row.report_code);
    return { ...row, report_name: entry?.name ?? row.report_code };
  });
  return res.json({ success: true, data });
}));

// POST /api/reports/access-grants/user
// Body: { userId, reportCode, canExport?, expiresAt? }
reportAccessGrantsRouter.post("/user", h(async (req, res) => {
  const { userId, reportCode, canExport = false, expiresAt = null } = req.body ?? {};
  if (!userId || !reportCode) {
    return res.status(400).json({ success: false, error: "userId and reportCode are required." });
  }
  if (!REPORT_CATALOG.find((r) => r.code === reportCode)) {
    return res.status(400).json({ success: false, error: "Unknown report code." });
  }
  await db.execute(
    `INSERT INTO user_report_permissions
       (user_id, report_code, can_view, can_export, granted_by, expires_at, active_status)
     VALUES (?, ?, 1, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       can_view = 1, can_export = VALUES(can_export),
       granted_by = VALUES(granted_by), granted_at = NOW(),
       expires_at = VALUES(expires_at), active_status = 1`,
    [userId, reportCode, canExport ? 1 : 0, req.authUser.id, expiresAt ?? null]
  );
  return res.json({ success: true });
}));

// DELETE /api/reports/access-grants/user/:id
reportAccessGrantsRouter.delete("/user/:id", h(async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id." });
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE user_report_permissions SET active_status = 0 WHERE id = ?`, [id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ success: false, error: "Grant not found." });
  return res.json({ success: true });
}));

// ── Role-based grants ──────────────────────────────────────────────────────────

// GET /api/reports/access-grants/role?roleKey=X
reportAccessGrantsRouter.get("/role", h(async (req, res) => {
  const roleKey = req.query.roleKey ? String(req.query.roleKey) : null;
  if (!roleKey) {
    // Return all role grants grouped by role
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT p.id, p.role_key, p.report_code, p.can_view, p.can_export, p.granted_at,
              CONCAT(e.first_name, ' ', e.last_name) AS granted_by_name
       FROM role_report_permissions p
       LEFT JOIN employees e ON e.user_id = p.granted_by
       WHERE p.active_status = 1
       ORDER BY p.role_key, p.report_code`
    );
    const data = (rows as any[]).map((row) => {
      const entry = REPORT_CATALOG.find((r) => r.code === row.report_code);
      return { ...row, report_name: entry?.name ?? row.report_code };
    });
    return res.json({ success: true, data });
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id, p.role_key, p.report_code, p.can_view, p.can_export, p.granted_at,
            CONCAT(e.first_name, ' ', e.last_name) AS granted_by_name
     FROM role_report_permissions p
     LEFT JOIN employees e ON e.user_id = p.granted_by
     WHERE p.role_key = ? AND p.active_status = 1
     ORDER BY p.report_code`,
    [roleKey]
  );
  const data = (rows as any[]).map((row) => {
    const entry = REPORT_CATALOG.find((r) => r.code === row.report_code);
    return { ...row, report_name: entry?.name ?? row.report_code };
  });
  return res.json({ success: true, data });
}));

// POST /api/reports/access-grants/role
// Body: { roleKey, reportCode, canExport? }
reportAccessGrantsRouter.post("/role", h(async (req, res) => {
  const { roleKey, reportCode, canExport = false } = req.body ?? {};
  if (!roleKey || !reportCode) {
    return res.status(400).json({ success: false, error: "roleKey and reportCode are required." });
  }
  if (!REPORT_CATALOG.find((r) => r.code === reportCode)) {
    return res.status(400).json({ success: false, error: "Unknown report code." });
  }
  await db.execute(
    `INSERT INTO role_report_permissions
       (role_key, report_code, can_view, can_export, granted_by, active_status)
     VALUES (?, ?, 1, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       can_view = 1, can_export = VALUES(can_export),
       granted_by = VALUES(granted_by), granted_at = NOW(), active_status = 1`,
    [roleKey, reportCode, canExport ? 1 : 0, req.authUser.id]
  );
  return res.json({ success: true });
}));

// DELETE /api/reports/access-grants/role/:id
reportAccessGrantsRouter.delete("/role/:id", h(async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id." });
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE role_report_permissions SET active_status = 0 WHERE id = ?`, [id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ success: false, error: "Grant not found." });
  return res.json({ success: true });
}));