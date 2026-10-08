import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  getAhmDashboard, getAhmDetail, normalizeAhmFilters, type AhmDetailKind,
} from "./ahm-dashboard.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

/** Same viewer role set as the other Process Performance V2 dashboards. */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

const DETAIL_KINDS: readonly string[] = ["telesales", "deliveredBy", "zone", "town"];

router.get("/ahm/dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const filters = normalizeAhmFilters(req.query);
  const data = await getAhmDashboard(filters);
  res.json({ success: true, data });
}));

/** Row drill-down -- a dedicated endpoint rather than a slice of the list payload,
 * scoped by the same filters so the drawer's totals equal the row that was opened. */
router.get("/ahm/detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const kind = String(req.query.kind ?? "");
  const key = String(req.query.key ?? "").trim();
  if (!DETAIL_KINDS.includes(kind) || !key || key.length > 150) {
    return res.status(400).json({ success: false, error: "kind must be telesales, deliveredBy, zone or town, and key is required" });
  }
  const data = await getAhmDetail(kind as AhmDetailKind, key, normalizeAhmFilters(req.query));
  if (!data) return res.status(404).json({ success: false, error: "No orders found for that selection and date range" });
  return res.json({ success: true, data });
}));

export { router as ahmDashboardRouter };
