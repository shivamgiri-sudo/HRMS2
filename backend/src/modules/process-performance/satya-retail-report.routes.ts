import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  getSatyaReport, getSatyaDetail, normalizeFilters, type SatyaDetailType,
} from "./satya-retail-report.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

/** Same viewer role set as the other Process Performance V2 dashboards. */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

const DETAIL_TYPES: readonly string[] = ["agent", "beat", "warehouse"];

router.get("/satya-retail-report", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const filters = normalizeFilters(req.query);
  const data = await getSatyaReport(filters);
  res.json({ success: true, data });
}));

/** Row drill-down (agent / beat / warehouse) -- a dedicated endpoint rather
 * than a slice of the list payload, and scoped by the same filters as the
 * list so the drawer's totals equal the row that was opened. */
router.get("/satya-retail-report/detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const type = String(req.query.type ?? "");
  const key = String(req.query.key ?? "").trim();
  if (!DETAIL_TYPES.includes(type) || !key || key.length > 150) {
    return res.status(400).json({ success: false, error: "type must be agent, beat or warehouse, and key is required" });
  }
  const data = await getSatyaDetail(type as SatyaDetailType, key, normalizeFilters(req.query));
  if (!data) return res.status(404).json({ success: false, error: "No allocations found for that selection and date range" });
  return res.json({ success: true, data });
}));

export { router as satyaRetailReportRouter };
