import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Public endpoint - must come BEFORE requireAuth middleware to bypass auth
router.get("/public/auto-logout-minutes", h(async (_req: any, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT setting_value FROM org_settings WHERE setting_key = 'auto_logout_minutes' LIMIT 1"
  );
  const minutes = rows[0]?.setting_value ? parseInt(String(rows[0].setting_value), 10) : 0;
  res.json({ success: true, minutes });
}));

// All other routes require authentication
router.use(requireAuth);

// SEC-03: org_settings can hold third-party secrets (API keys, client secrets —
// see backend/sql/311_bgv_provider_config.sql, 320_bgv_missing_tables.sql,
// 342_bgv_provider_config_labels.sql). A plain `requireAuth` on `SELECT *`
// let any authenticated employee read those values. Secret-shaped keys are
// now masked for everyone except admins, and admins get a "configured" flag
// rather than the live value, so the value never leaves the server at all.
const SECRET_KEY_PATTERN = /(secret|api_key|apikey|token|password|client_secret|private_key)/i;

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function maskRow(row: RowDataPacket, isAdmin: boolean): RowDataPacket {
  if (!isSecretKey(String(row.setting_key ?? ""))) return row;
  const hasValue = row.setting_value !== null && row.setting_value !== undefined && row.setting_value !== "";
  return {
    ...row,
    setting_value: isAdmin ? (hasValue ? "***configured***" : null) : null,
    is_secret: true,
    configured: hasValue,
  };
}

router.get("/", h(async (req: AuthenticatedRequest, res: Response) => {
  const isAdmin = (req.authUser?.role === "admin" || req.authUser?.role === "super_admin" || req.authUser?.roles?.includes("admin") || req.authUser?.roles?.includes("super_admin")) ?? false;
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM org_settings ORDER BY setting_key LIMIT 500");
  const data = (rows as RowDataPacket[]).map((row) => maskRow(row, isAdmin));
  res.json({ success: true, data });
}));

router.get("/:key", h(async (req: AuthenticatedRequest, res: Response) => {
  const isAdmin = (req.authUser?.role === "admin" || req.authUser?.role === "super_admin" || req.authUser?.roles?.includes("admin") || req.authUser?.roles?.includes("super_admin")) ?? false;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM org_settings WHERE setting_key = ? LIMIT 1", [req.params.key]
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return res.status(404).json({ error: "Setting not found" });
  if (isSecretKey(String(row.setting_key ?? "")) && !isAdmin) {
    return res.status(403).json({ success: false, error: "This setting is restricted to administrators" });
  }
  res.json({ success: true, data: maskRow(row, isAdmin) });
}));

router.put("/:key", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { setting_value } = req.body;
  const [result] = await db.execute(
    "UPDATE org_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?",
    [setting_value ?? null, req.authUser!.id, req.params.key]
  );
  if ((result as any).affectedRows === 0) {
    return res.status(404).json({ error: `Setting '${req.params.key}' not found` });
  }
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM org_settings WHERE setting_key = ? LIMIT 1", [req.params.key]);
  res.json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

export { router as orgSettingsRouter };
