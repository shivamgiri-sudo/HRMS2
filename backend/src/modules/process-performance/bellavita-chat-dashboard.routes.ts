import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getBellavitaChatDashboard, getBellavitaChatLobSnapshot, getBellavitaChatPeriodBreakdown } from "./bellavita-chat-dashboard.service.js";
import {
  getBellavitaChatOverview, getBellavitaChatPeriodDetail, setPlannedCapacity,
  parseUserType, CHAT_USER_TYPES, type ChatUserType,
} from "./bellavita-chat-overview.service.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { writeAuditLog } from "../../shared/auditLog.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/bellavita-chat-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const lob = req.query.lob ? String(req.query.lob) : undefined;
  const data = await getBellavitaChatDashboard(from, to, lob);
  res.json({ success: true, data });
}));

router.get("/bellavita-chat-dashboard/period-breakdown", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const lob = req.query.lob ? String(req.query.lob) : undefined;
  try {
    const data = await getBellavitaChatPeriodBreakdown(String(req.query.from ?? ""), String(req.query.to ?? ""), lob);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Invalid range" });
  }
}));

router.get("/bellavita-chat-dashboard/lob-snapshot", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await getBellavitaChatLobSnapshot();
  res.json({ success: true, data });
}));

/** Roles that may set a planned capacity -- a business commitment, so the same
 * narrow set the org-wide dashboard targets use. */
const CAPACITY_ADMIN_ROLES = ["super_admin", "admin", "ceo", "coo", "management"];

router.get("/bellavita-chat-dashboard/overview", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaChatOverview(
    String(req.query.from ?? ""), String(req.query.to ?? ""), parseUserType(req.query.userType),
  );
  const canSetCapacity = await hasAnyRole(req.authUser!.id, ...CAPACITY_ADMIN_ROLES);
  res.json({ success: true, data: { ...data, canSetCapacity } });
}));

router.get("/bellavita-chat-dashboard/overview/detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaChatPeriodDetail(
    String(req.query.from ?? ""), String(req.query.to ?? ""), parseUserType(req.query.userType),
  );
  res.json({ success: true, data });
}));

router.put("/bellavita-chat-dashboard/planned-capacity", requireRole(...CAPACITY_ADMIN_ROLES), h(async (req, res) => {
  const body = (req.body ?? {}) as { userType?: string; month?: string; capacity?: number | string; reason?: string };
  const userType = CHAT_USER_TYPES.find((t) => t.toLowerCase() === String(body.userType ?? "").toLowerCase()) as ChatUserType | undefined;
  if (!userType) {
    return res.status(400).json({ success: false, error: "userType must be Chat, Kenaz or Bevzilla" });
  }
  let change;
  try {
    change = await setPlannedCapacity(userType, String(body.month ?? ""), Number(body.capacity), req.authUser!.id);
  } catch (err) {
    return res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Invalid planned capacity" });
  }
  await writeAuditLog({
    actor_user_id: req.authUser!.id,
    action_type: "BB_CHAT_PLANNED_CAPACITY_SET",
    module_key: "process-performance",
    entity_type: "dashboard_metric_target",
    entity_id: `bellavita_chat:${userType}:${change.month}`,
    reason: body.reason ? String(body.reason) : undefined,
    old_value_json: { capacity: change.oldValue },
    new_value_json: { capacity: change.newValue, userType, month: change.month },
    req,
  });
  res.json({ success: true, data: change });
}));

export { router as bellavitaChatDashboardRouter };
