import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  getBellavitaCartDashboard, setBellavitaCartMonthlyTarget,
  getBellavitaCartDailyTargets, setBellavitaCartDailyTarget, uploadBellavitaCartDailyTargets,
  type CartDailyTargetInput,
} from "./bellavita-cart-dashboard.service.js";
import { getBellavitaCartSnapshot, getBellavitaCartAgents, getBellavitaCartAgentDetail } from "./bellavita-cart-snapshot.service.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { TARGET_ADMIN_ROLES } from "./dashboard-monthly-target.shared.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/bellavita-cart-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getBellavitaCartDashboard(from, to);
  const canSetTarget = await hasAnyRole(req.authUser!.id, ...TARGET_ADMIN_ROLES);
  res.json({ success: true, data: { ...data, canSetTarget } });
}));

router.put("/bellavita-cart-dashboard/monthly-target", requireRole(...TARGET_ADMIN_ROLES), h(async (req, res) => {
  const body = (req.body ?? {}) as { month?: string; target?: number | string; reason?: string };
  let change;
  try {
    change = await setBellavitaCartMonthlyTarget(String(body.month ?? ""), Number(body.target), req.authUser!.id);
  } catch (err) {
    return res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Invalid target" });
  }
  await writeAuditLog({
    actor_user_id: req.authUser!.id,
    action_type: "BB_CART_MONTHLY_TARGET_SET",
    module_key: "process-performance",
    entity_type: "dashboard_metric_target",
    entity_id: `bellavita_cart:${change.month}`,
    reason: body.reason ? String(body.reason) : undefined,
    old_value_json: { target: change.oldValue },
    new_value_json: { target: change.newValue, month: change.month },
    req,
  });
  res.json({ success: true, data: change });
}));

router.get("/bellavita-cart-dashboard/daily-targets", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaCartDailyTargets(String(req.query.from ?? ""), String(req.query.to ?? ""));
  const canSetTarget = await hasAnyRole(req.authUser!.id, ...TARGET_ADMIN_ROLES);
  res.json({ success: true, data: { ...data, canSetTarget } });
}));

router.put("/bellavita-cart-dashboard/daily-target", requireRole(...TARGET_ADMIN_ROLES), h(async (req, res) => {
  const body = (req.body ?? {}) as { date?: string; target?: number | string; reason?: string };
  let change;
  try {
    change = await setBellavitaCartDailyTarget(String(body.date ?? ""), Number(body.target), req.authUser!.id);
  } catch (err) {
    return res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Invalid target" });
  }
  await writeAuditLog({
    actor_user_id: req.authUser!.id,
    action_type: "BB_CART_DAILY_TARGET_SET",
    module_key: "process-performance",
    entity_type: "dashboard_metric_target",
    entity_id: `bellavita_cart:${change.date}`,
    reason: body.reason ? String(body.reason) : undefined,
    old_value_json: { target: change.oldValue },
    new_value_json: { target: change.newValue, date: change.date },
    req,
  });
  res.json({ success: true, data: change });
}));

router.post("/bellavita-cart-dashboard/daily-targets/upload", requireRole(...TARGET_ADMIN_ROLES), h(async (req, res) => {
  const body = (req.body ?? {}) as { rows?: unknown; reason?: string };
  if (!Array.isArray(body.rows)) return res.status(400).json({ success: false, error: "rows must be an array" });
  const rows: CartDailyTargetInput[] = body.rows.map((r) => {
    const row = (r ?? {}) as { date?: unknown; convTgtPct?: unknown; allocation?: unknown };
    return { date: String(row.date ?? ""), convTgtPct: Number(row.convTgtPct), allocation: Number(row.allocation) };
  });
  let computed;
  try {
    computed = await uploadBellavitaCartDailyTargets(rows, req.authUser!.id);
  } catch (err) {
    return res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Invalid upload" });
  }
  await writeAuditLog({
    actor_user_id: req.authUser!.id,
    action_type: "BB_CART_DAILY_TARGET_UPLOAD",
    module_key: "process-performance",
    entity_type: "dashboard_metric_target",
    entity_id: `bellavita_cart:${computed[0]?.date ?? "?"}..${computed[computed.length - 1]?.date ?? "?"}`,
    reason: body.reason ? String(body.reason) : undefined,
    new_value_json: { rowCount: computed.length, dates: computed.map((c) => c.date) },
    req,
  });
  res.json({ success: true, data: computed });
}));

router.get("/bellavita-cart-dashboard/snapshot", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaCartSnapshot(String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

router.get("/bellavita-cart-dashboard/agents", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaCartAgents(String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

router.get("/bellavita-cart-dashboard/agent-detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const empId = String(req.query.empId ?? "").trim();
  if (!/^MAS\d+$/i.test(empId)) return res.status(400).json({ success: false, error: "empId must look like MAS12345" });
  const data = await getBellavitaCartAgentDetail(empId, String(req.query.from ?? ""), String(req.query.to ?? ""));
  if (!data) return res.status(404).json({ success: false, error: "No records for this agent in the chosen date range" });
  res.json({ success: true, data });
}));

export { router as bellavitaCartDashboardRouter };
