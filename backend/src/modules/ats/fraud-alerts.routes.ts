import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();

router.get("/", requireAuth, requireRole("super_admin", "admin", "hr"), async (req: AuthenticatedRequest, res: Response) => {
  const status = req.query.status as string || "open";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT fa.*, c.full_name AS candidate_name, c.applied_for_branch, c.applied_for_process,
            mc.full_name AS matched_candidate_name
       FROM candidate_fraud_alert fa
       JOIN ats_candidate c ON c.id = fa.candidate_id
       LEFT JOIN ats_candidate mc ON mc.id = fa.matched_candidate_id
      WHERE fa.status = ?
      ORDER BY fa.created_at DESC
      LIMIT 100`,
    [status]
  );
  res.json({ alerts: rows });
});

router.get("/candidate/:candidateId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_fraud_alert WHERE candidate_id = ? ORDER BY created_at DESC`,
    [req.params.candidateId]
  );
  res.json({ alerts: rows });
});

router.patch("/:alertId/review", requireAuth, requireRole("super_admin", "admin", "hr"), async (req: AuthenticatedRequest, res: Response) => {
  const { status, notes } = req.body;
  const validStatuses = ["under_review", "resolved_fraud", "resolved_false_positive", "dismissed"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  await db.execute(
    `UPDATE candidate_fraud_alert SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
    [status, notes ?? null, req.authUser?.id ?? null, req.params.alertId]
  );
  res.json({ success: true });
});

router.get("/stats", requireAuth, requireRole("super_admin", "admin", "hr"), async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT alert_type, status, COUNT(*) as count FROM candidate_fraud_alert GROUP BY alert_type, status`
  );
  res.json({ stats: rows });
});

export default router;
