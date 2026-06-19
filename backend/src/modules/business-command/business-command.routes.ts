import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { businessCommandService } from "./business-command.service.js";
import { revenueRiskService } from "../revenue-risk/revenue-risk.service.js";

export const businessCommandRouter = Router();
businessCommandRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [tableName]
  );
  return rows.length > 0;
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
  const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
  res.json({ success: true, data: await revenueRiskService.calculate(date, true) });
}));
