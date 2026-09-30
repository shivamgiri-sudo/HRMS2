import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Read-only view of upload_batch_snapshot (counts + error breakdown of batches whose rows were purged by the
 * retention worker). Mounted in bulk-upload.routes.ts behind requireRole(...HUB_ROLES) + denyLobOnly, so only the
 * Bulk Upload Hub's full-access roles reach it. It carries no row data.
 */
export const snapshotRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

snapshotRouter.get("/", h(async (req, res) => {
  const type = typeof req.query.type === "string" && req.query.type.trim() ? req.query.type.trim() : null;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  const where = type ? "WHERE upload_type_code = ?" : "";
  const params: unknown[] = type ? [type] : [];
  const [snapshots] = await db.query<RowDataPacket[]>(
    `SELECT * FROM upload_batch_snapshot ${where} ORDER BY batch_created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [count] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM upload_batch_snapshot ${where}`, params);
  res.json({ success: true, data: { snapshots, total: Number(count[0]?.total ?? 0) } });
}));

snapshotRouter.get("/:id", h(async (req, res) => {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM upload_batch_snapshot WHERE id = ? LIMIT 1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ success: false, error: "Snapshot not found" });
  res.json({ success: true, data: rows[0] });
}));
