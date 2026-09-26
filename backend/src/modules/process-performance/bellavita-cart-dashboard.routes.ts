import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getBellavitaCartDashboard, getBellavitaCartSummary, getBellavitaCartDailyTargets } from "./bellavita-cart-dashboard.service.js";
import { getBellavitaCartSnapshot, getBellavitaCartAgents, getBellavitaCartAgentDetail } from "./bellavita-cart-snapshot.service.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { TARGET_ADMIN_ROLES } from "./dashboard-monthly-target.shared.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

/** Short-lived cache + in-flight sharing: the same range is opened by several tabs/users at once and the aggregate is expensive
 * (it scans bb_cart's text call_date), while the data only changes on an upload. */
const CART_CACHE_MS = 60_000;
const cartDashboardCache = new Map<string, { at: number; p: ReturnType<typeof getBellavitaCartDashboard> }>();
function cachedCartDashboard(from: string, to: string) {
  const key = `${from}|${to}`;
  const hit = cartDashboardCache.get(key);
  if (hit && Date.now() - hit.at < CART_CACHE_MS) return hit.p;
  const p = getBellavitaCartDashboard(from, to);
  cartDashboardCache.set(key, { at: Date.now(), p });
  p.catch(() => { if (cartDashboardCache.get(key)?.p === p) cartDashboardCache.delete(key); }); // never cache a failure
  if (cartDashboardCache.size > 50) for (const k of cartDashboardCache.keys()) { cartDashboardCache.delete(k); break; }
  return p;
}

router.get("/bellavita-cart-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await cachedCartDashboard(from, to);
  const canSetTarget = await hasAnyRole(req.authUser!.id, ...TARGET_ADMIN_ROLES);
  res.json({ success: true, data: { ...data, canSetTarget } });
}));

router.get("/bellavita-cart-dashboard/summary", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaCartSummary(String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

// Retired: Bellavita Abandon Cart targets are automatic now (bellavita-auto-targets.shared.ts) --
// Allocation x fixed Conv Tgt % x 500 per date -- so there is nothing to set or upload by hand.
// Kept as an explicit 410 (not deleted) so an old client gets a clear answer.
const targetsAreAutomatic = (_req: AuthenticatedRequest, res: Response) => {
  res.status(410).json({ success: false, error: "Abandon Cart targets are automatic and can no longer be set or uploaded by hand." });
};
router.put("/bellavita-cart-dashboard/monthly-target", requireRole(...TARGET_ADMIN_ROLES), targetsAreAutomatic);

router.get("/bellavita-cart-dashboard/daily-targets", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaCartDailyTargets(String(req.query.from ?? ""), String(req.query.to ?? ""));
  const canSetTarget = await hasAnyRole(req.authUser!.id, ...TARGET_ADMIN_ROLES);
  res.json({ success: true, data: { ...data, canSetTarget } });
}));

router.put("/bellavita-cart-dashboard/daily-target", requireRole(...TARGET_ADMIN_ROLES), targetsAreAutomatic);
router.post("/bellavita-cart-dashboard/daily-targets/upload", requireRole(...TARGET_ADMIN_ROLES), targetsAreAutomatic);

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
