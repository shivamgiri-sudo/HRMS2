import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getRosterGrid } from "./roster-builder.service.js";

const WFM_ROLES = ["wfm", "admin", "super_admin"];

export const rosterBuilderRouter = Router();
rosterBuilderRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

rosterBuilderRouter.get(
  "/grid",
  requireRole(...WFM_ROLES),
  h(async (req, res) => {
    const cycleId = String(req.query.cycleId ?? "").trim();
    if (!cycleId) {
      res.status(400).json({ error: "cycleId is required" });
      return;
    }
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const employeeSearch = req.query.employeeSearch ? String(req.query.employeeSearch) : undefined;
    const rows = await getRosterGrid({ cycleId, branchId, employeeSearch });
    res.json({ rows });
  })
);
