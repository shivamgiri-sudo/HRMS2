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

router.get("/", h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM org_settings ORDER BY setting_key");
  res.json({ success: true, data: rows });
}));

router.get("/:key", h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM org_settings WHERE setting_key = ? LIMIT 1", [req.params.key]
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return res.status(404).json({ error: "Setting not found" });
  res.json({ success: true, data: row });
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
