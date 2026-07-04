import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { businessCommandService } from "./business-command.service.js";
import { revenueRiskService } from "../revenue-risk/revenue-risk.service.js";

export const businessCommandRouter = Router();
businessCommandRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

interface LatestDateRow extends RowDataPacket {
  latest_date: string | null;
}

businessCommandRouter.get("/overview", h(async (_req, res) => {
  res.json({ success: true, data: await businessCommandService.overview() });
}));

businessCommandRouter.get("/revenue-risk/options", h(async (_req, res) => {
  const clients = await tableExists("client_master")
    ? (await db.execute<RowDataPacket[]>(
        `SELECT id, client_name AS name
           FROM client_master
          WHERE COALESCE(active_status, 1) = 1
          ORDER BY client_name
          LIMIT 500`
      ))[0]
    : [];

  const processes = await tableExists("process_master")
    ? (await db.execute<RowDataPacket[]>(
        `SELECT p.id,
                p.process_name AS name,
                p.client_id,
                cm.client_name
           FROM process_master p
           LEFT JOIN client_master cm ON cm.id = p.client_id
          WHERE COALESCE(p.active_status, 1) = 1
          ORDER BY cm.client_name, p.process_name
          LIMIT 1000`
      ))[0]
    : [];

  res.json({ success: true, data: { clients, processes } });
}));

businessCommandRouter.get("/revenue-risk/contracts", h(async (_req, res) => {
  res.json({ success: true, data: await revenueRiskService.listContracts() });
}));

businessCommandRouter.post("/revenue-risk/contracts", h(async (req, res) => {
  res.status(201).json({ success: true, data: await revenueRiskService.createContract(req.body, req.authUser!.id) });
}));

businessCommandRouter.get("/revenue-risk/snapshot", h(async (req, res) => {
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  res.json({ success: true, data: await revenueRiskService.snapshot(date) });
}));

businessCommandRouter.post("/revenue-risk/generate-daily", h(async (req, res) => {
  // Default to latest date that has attendance data (COSEC may lag 1-2 days behind today)
  let date = String(req.body?.date ?? "");
  if (!date || date === "today") {
      const [latestRows] = await db.execute<LatestDateRow[]>(
        "SELECT DATE_FORMAT(MAX(record_date), '%Y-%m-%d') AS latest_date FROM attendance_daily_record"
      );
      date = latestRows[0]?.latest_date ?? new Date().toISOString().slice(0, 10);
    }
  res.json({ success: true, data: await revenueRiskService.calculate(date, true) });
}));

// GET /api/business-command/workforce-mandates — list mandates
businessCommandRouter.get("/workforce-mandates", h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wm.*, pm.process_name, cm.client_name
       FROM workforce_mandate wm
       LEFT JOIN process_master pm ON pm.id = wm.process_id
       LEFT JOIN client_master cm ON cm.id = wm.client_id
      WHERE wm.active_status = 1
      ORDER BY pm.process_name ASC, wm.effective_from DESC
      LIMIT 500`
  );
  res.json({ success: true, data: rows });
}));

// POST /api/business-command/workforce-mandates — create/update mandate for a process
businessCommandRouter.post("/workforce-mandates", h(async (req, res) => {
  const { process_id, client_id, mandated_hc, effective_from, effective_to, hc_type } = req.body;
  if (!process_id) return res.status(400).json({ success: false, error: "process_id is required" });
  if (!mandated_hc || Number(mandated_hc) < 1) return res.status(400).json({ success: false, error: "mandated_hc must be >= 1" });
  if (!effective_from) return res.status(400).json({ success: false, error: "effective_from is required" });

  const { randomUUID } = await import("crypto");
  const id = randomUUID();
  await db.execute(
    `INSERT INTO workforce_mandate
       (id, process_id, client_id, mandated_hc, hc_type, effective_from, effective_to, active_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      process_id,
      client_id ?? null,
      Number(mandated_hc),
      hc_type ?? "production",
      effective_from,
      effective_to ?? null,
      req.authUser!.id,
    ]
  );
  res.status(201).json({ success: true, data: { id } });
}));
