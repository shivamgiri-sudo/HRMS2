import { Router, Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  syncMandateSeatsFromDbBill,
  getMandateSeatTrend,
  getClientMandateSummary,
  getClientCostCenterDetails,
  updateMandateSeats,
  getBranchMandateSummary,
  getMultiPeriodTrend,
} from "./mandate-seat-tracking.service.js";

const router = Router();

const READ_ROLES = [
  "super_admin", "hr_admin", "finance_admin", "finance_manager",
  "payroll_head", "branch_head", "coo", "cfo", "ceo",
] as const;

const WRITE_ROLES = [
  "super_admin", "finance_admin", "finance_manager", "cfo",
] as const;

/**
 * POST /api/finance/mandate-seats/sync
 * Sync mandate seat data from db_bill for a period
 */
router.post("/sync", requireAuth, requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const { financeYear, month } = req.body;
    if (!financeYear || !month) {
      return res.status(400).json({ error: "financeYear and month required" });
    }

    const result = await syncMandateSeatsFromDbBill(financeYear, month);
    res.json({
      success: true,
      synced: result.synced,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/finance/mandate-seats/trend/:costCenter
 * Get seat trend for a specific cost center (for line graph)
 */
router.get("/trend/:costCenter", requireAuth, requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  try {
    const { costCenter } = req.params;
    const months = Number(req.query.months) || 12;

    const trend = await getMandateSeatTrend(costCenter, months);
    res.json({ costCenter, trend });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/finance/mandate-seats/clients
 * Get client-level mandate summary for drill-down
 */
router.get("/clients", requireAuth, requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  try {
    const periodMonth = (req.query.period as string) || getCurrentPeriod();
    const clients = await getClientMandateSummary(periodMonth);
    res.json({ period: periodMonth, clients });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/finance/mandate-seats/client/:clientName
 * Get cost center details for a client (drill-down)
 */
router.get("/client/:clientName", requireAuth, requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  try {
    const clientName = decodeURIComponent(req.params.clientName);
    const periodMonth = (req.query.period as string) || getCurrentPeriod();

    const details = await getClientCostCenterDetails(clientName, periodMonth);
    res.json({ client: clientName, period: periodMonth, costCenters: details });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/finance/mandate-seats/branches
 * Get branch-level mandate summary (for P&L integration)
 */
router.get("/branches", requireAuth, requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  try {
    const periodMonth = (req.query.period as string) || getCurrentPeriod();
    const branches = await getBranchMandateSummary(periodMonth);
    res.json({ period: periodMonth, branches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/finance/mandate-seats/multi-trend
 * Get trend data for multiple cost centers (for comparison charts)
 */
router.post("/multi-trend", requireAuth, requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  try {
    const { costCenters, periods } = req.body;
    if (!Array.isArray(costCenters) || costCenters.length === 0) {
      return res.status(400).json({ error: "costCenters array required" });
    }

    const trends = await getMultiPeriodTrend(costCenters, periods || 6);
    const result: Record<string, any> = {};
    trends.forEach((v, k) => {
      result[k] = v;
    });

    res.json({ trends: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/finance/mandate-seats/:costCenter
 * Update mandate seats manually
 */
router.put("/:costCenter", requireAuth, requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const costCenter = decodeURIComponent(req.params.costCenter);
    const { periodMonth, mandateSeats, changeReason } = req.body;

    if (!periodMonth || mandateSeats === undefined) {
      return res.status(400).json({ error: "periodMonth and mandateSeats required" });
    }

    const userId = (req as any).user?.id || "system";
    const result = await updateMandateSeats(
      costCenter,
      periodMonth,
      Number(mandateSeats),
      changeReason || "",
      userId
    );

    res.json({
      success: true,
      previous: result.previous,
      new: mandateSeats,
      change: mandateSeats - result.previous,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default router;
