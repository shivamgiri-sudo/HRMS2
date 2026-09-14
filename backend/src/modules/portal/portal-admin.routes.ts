import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.post(
  "/impersonate",
  requireAuth,
  requireRole("Super Admin", "HR Admin"),
  h(async (req, res) => {
    const { client_email, reason } = req.body as { client_email?: string; reason?: string };
    if (!client_email?.trim()) return res.status(400).json({ error: "client_email is required" });
    if (!reason?.trim()) return res.status(400).json({ error: "reason is required for audit" });

    // Look up the portal user
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, client_id FROM client_user WHERE email = ? AND is_active = 1 LIMIT 1",
      [client_email.trim()]
    );
    if (!(rows as RowDataPacket[]).length) {
      return res.status(404).json({ error: "No active portal user found for that email" });
    }
    const portalUser = (rows as RowDataPacket[])[0];

    const token = jwt.sign(
      { portal_user_id: portalUser.id, client_id: portalUser.client_id, impersonated_by: req.authUser?.id },
      env.PORTAL_JWT_SECRET,
      { expiresIn: "2h" }
    );

    // Insert session
    await db.execute(
      `INSERT INTO portal_sessions (portal_user_id, token_hash, expires_at, created_at)
       VALUES (?, SHA2(?, 256), DATE_ADD(NOW(), INTERVAL 2 HOUR), NOW())`,
      [portalUser.id, token]
    );

    // Audit log
    await db.execute(
      `INSERT INTO portal_admin_impersonation_log
         (admin_user_id, portal_user_id, client_email, reason, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [req.authUser?.id, portalUser.id, client_email.trim(), reason.trim()]
    );

    return res.json({ token, expires_in: 7200, message: "Impersonation session created" });
  })
);

export default router;
