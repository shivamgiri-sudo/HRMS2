import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// POST /api/push/subscribe — save or update a push subscription
router.post("/subscribe", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { endpoint, keys, userAgent } = req.body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    userAgent?: string;
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ success: false, error: "endpoint, keys.p256dh and keys.auth are required" });
  }

  await db.execute(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_key, user_agent)
     VALUES (UUID(), ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id    = VALUES(user_id),
       p256dh     = VALUES(p256dh),
       auth_key   = VALUES(auth_key),
       user_agent = VALUES(user_agent),
       updated_at = NOW()`,
    [userId, endpoint, keys.p256dh, keys.auth, userAgent || null],
  );

  return res.json({ success: true });
}));

// DELETE /api/push/subscribe — remove a push subscription
router.delete("/subscribe", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { endpoint } = req.body as { endpoint?: string };

  if (!endpoint) {
    return res.status(400).json({ success: false, error: "endpoint is required" });
  }

  await db.execute(
    `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`,
    [userId, endpoint],
  );

  return res.json({ success: true });
}));

// GET /api/push/subscription-status — check if current user has an active subscription
router.get("/subscription-status", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM push_subscriptions WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return res.json({ success: true, subscribed: rows.length > 0 });
}));

export const pushRouter = router;
