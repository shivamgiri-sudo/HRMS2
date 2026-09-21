import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getBellavitaSaleDashboard, currentMonthRange, setBellavitaSaleMonthlyTarget, getBellavitaSaleDateLobMatrix } from "./bellavita-sale-dashboard.service.js";
import { getBellavitaAgentPerformance } from "./bellavita-agent-performance.service.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { TARGET_ADMIN_ROLES } from "./dashboard-monthly-target.shared.js";

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
  const canSetTarget = await hasAnyRole(req.authUser!.id, ...TARGET_ADMIN_ROLES);
  res.json({ success: true, data: { ...data, canSetTarget } });
}));

router.get("/bellavita-sale-dashboard/date-lob-matrix", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaSaleDateLobMatrix(String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

router.put("/bellavita-sale-dashboard/monthly-target", requireRole(...TARGET_ADMIN_ROLES), h(async (req, res) => {
  const body = (req.body ?? {}) as { lob?: string; month?: string; target?: number | string; reason?: string };
  const lob = String(body.lob ?? "").trim();
  if (!lob) return res.status(400).json({ success: false, error: "lob is required" });
  let change;
  try {
    change = await setBellavitaSaleMonthlyTarget(lob, String(body.month ?? ""), Number(body.target), req.authUser!.id);
  } catch (err) {
    return res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Invalid target" });
  }
  await writeAuditLog({
    actor_user_id: req.authUser!.id,
    action_type: "BB_SALE_MONTHLY_TARGET_SET",
    module_key: "process-performance",
    entity_type: "dashboard_metric_target",
    entity_id: `bellavita_sale:${lob}:${change.month}`,
    reason: body.reason ? String(body.reason) : undefined,
    old_value_json: { target: change.oldValue },
    new_value_json: { target: change.newValue, lob, month: change.month },
    req,
  });
  res.json({ success: true, data: change });
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
