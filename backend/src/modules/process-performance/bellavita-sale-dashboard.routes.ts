import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getBellavitaSaleDashboard, currentMonthRange } from "./bellavita-sale-dashboard.service.js";
import { getBellavitaAgentPerformance } from "./bellavita-agent-performance.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

/**
 * Same viewer role set Process Performance V2's own route already gates
 * on (see src/config/routes/performance.routes.tsx) -- this endpoint only
 * backs one dashboard on that page, so it stays consistent with who can
 * already reach it rather than inventing a narrower list.
 */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/bellavita-sale-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  // Defaults to the current month (1st .. today) when from/to are absent
  // or malformed -- getBellavitaSaleDashboard applies the same fallback
  // itself, so an invalid query string can never 500 or silently scan an
  // unbounded range.
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getBellavitaSaleDashboard(from, to);
  res.json({ success: true, data });
}));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/bellavita-agent-performance", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const fallback = currentMonthRange();
  const fromInput = String(req.query.from ?? "");
  const toInput = String(req.query.to ?? "");
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  const data = await getBellavitaAgentPerformance(from, to);
  res.json({ success: true, data, from, to });
}));

export { router as bellavitaSaleDashboardRouter };
