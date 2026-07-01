import { Router } from "express";
import { randomUUID } from "crypto";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

router.get("/", h(async (req: AuthenticatedRequest, res: Response) => {
  const { start, end, is_holiday } = req.query as Record<string, string>;
  const conds = ["active_status = 1"];
  const params: unknown[] = [];
  if (start) { conds.push("event_date >= ?"); params.push(start); }
  if (end)   { conds.push("event_date <= ?"); params.push(end); }
  if (is_holiday !== undefined) { conds.push("is_holiday = ?"); params.push(is_holiday === "true" ? 1 : 0); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM company_event_master WHERE ${conds.join(" AND ")} ORDER BY event_date ASC`,
    params
  );
  res.json({ success: true, data: rows });
}));

router.get("/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM company_event_master WHERE id = ? AND active_status = 1 LIMIT 1",
    [req.params.id]
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, data: row });
}));

router.post("/", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { title, event_date, end_date, event_type, is_holiday, description, branch_id } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: "title and event_date required" });
  const id = randomUUID();
  await db.execute(
    `INSERT INTO company_event_master (id, title, event_date, end_date, event_type, is_holiday, description, branch_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, event_date, end_date ?? null, event_type ?? "general", is_holiday ? 1 : 0, description ?? null, branch_id ?? null, req.authUser!.id]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM company_event_master WHERE id = ? LIMIT 1", [id]);
  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

router.put("/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { title, event_date, end_date, event_type, is_holiday, description } = req.body;
  await db.execute(
    `UPDATE company_event_master SET
       title = COALESCE(?, title),
       event_date = COALESCE(?, event_date),
       end_date = COALESCE(?, end_date),
       event_type = COALESCE(?, event_type),
       is_holiday = COALESCE(?, is_holiday),
       description = COALESCE(?, description)
     WHERE id = ?`,
    [title ?? null, event_date ?? null, end_date ?? null, event_type ?? null,
     is_holiday != null ? Number(is_holiday) : null, description ?? null, req.params.id]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM company_event_master WHERE id = ? LIMIT 1", [req.params.id]);
  res.json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

router.delete("/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await db.execute("UPDATE company_event_master SET active_status = 0 WHERE id = ?", [req.params.id]);
  res.json({ success: true });
}));

export { router as eventsRouter };
