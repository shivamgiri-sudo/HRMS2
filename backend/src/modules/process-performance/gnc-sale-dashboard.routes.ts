import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getGncSaleDashboard, getGncAgentDetail, getGncCampaignDetail } from "./gnc-sale-dashboard.service.js";
import { getGncAbandonCartDashboard } from "./gnc-abandon-cart-dashboard.service.js";
import {
  resolveGncTargets, listGncTargets, setGncTarget, deleteGncTarget, getGncTargetDetail, actorEmails, decorateSaleWithTargets, decorateAbandonCartWithTargets, GNC_TARGET_LOBS,
} from "./gnc-targets.service.js";
import { writeAuditLog } from "../../shared/auditLog.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

/**
 * Same viewer role set the Bellavita sale dashboard route uses -- this
 * endpoint backs one dashboard on the same Process Performance V2 page.
 */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/gnc-sale-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  // Defaults to the current month (1st .. today) when from/to are absent
  // or malformed -- getGncSaleDashboard applies the same fallback itself,
  // so an invalid query string can never 500 or silently scan an unbounded
  // range.
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getGncSaleDashboard(from, to);
  const targets = await resolveGncTargets(data.from, data.to);
  res.json({ success: true, data: decorateSaleWithTargets(data, targets) });
}));

router.get("/gnc-sale-dashboard/agent-detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const empId = String(req.query.empId ?? "").trim();
  if (!empId) return res.status(400).json({ success: false, error: "empId is required" });
  const data = await getGncAgentDetail(empId, String(req.query.from ?? ""), String(req.query.to ?? ""));
  if (!data) return res.status(404).json({ success: false, error: "No records for this agent in the chosen date range" });
  res.json({ success: true, data });
}));

router.get("/gnc-sale-dashboard/campaign-detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const campaign = String(req.query.campaign ?? "").trim();
  if (!campaign) return res.status(400).json({ success: false, error: "campaign is required" });
  const data = await getGncCampaignDetail(campaign, String(req.query.from ?? ""), String(req.query.to ?? ""));
  if (!data) return res.status(404).json({ success: false, error: "No records for this LOB in the chosen date range" });
  res.json({ success: true, data });
}));

router.get("/gnc-abandon-cart-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getGncAbandonCartDashboard(from, to);
  const targets = await resolveGncTargets(data.from, data.to);
  res.json({ success: true, data: decorateAbandonCartWithTargets(data, targets) });
}));

/**
 * Editable LOB targets (Process Performance V2 > GNC > Targets). Reading is open to the dashboard
 * viewers; changing a target is a business commitment, so writes are limited to the roles that own
 * these dashboards. Every change is audited (audit_action_log).
 */
const TARGET_EDIT_ROLES = ["super_admin", "admin", "ceo", "coo", "management", "operations_manager", "process_manager"];

router.get("/gnc-targets", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const { tableAvailable, rows } = await listGncTargets();
  const emails = await actorEmails(rows.map((r) => r.updatedBy));
  res.json({ success: true, data: { tableAvailable, lobs: GNC_TARGET_LOBS, rows: rows.map((r) => ({ ...r, updatedByLabel: r.updatedBy ? emails.get(r.updatedBy) ?? r.updatedBy : null })) } });
}));

router.get("/gnc-targets/:id", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Invalid target id" });
  const data = await getGncTargetDetail(id);
  return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: "Target not found" });
}));

router.put("/gnc-targets", requireRole(...TARGET_EDIT_ROLES), h(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown> & { reason?: string };
  let change;
  try {
    change = await setGncTarget({
      lob: String(body.lob ?? ""), effectiveMonth: String(body.effectiveMonth ?? ""), basis: String(body.basis ?? ""),
      perAgentTarget: body.perAgentTarget as number | string | null | undefined, agentCount: body.agentCount as number | string | null | undefined,
      fixedTarget: body.fixedTarget as number | string | null | undefined,
    }, req.authUser!.id);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ER_NO_SUCH_TABLE") return res.status(409).json({ success: false, error: "The target table has not been created yet (migration 1870 is pending)." });
    return res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Invalid target" });
  }
  await writeAuditLog({
    actor_user_id: req.authUser!.id,
    action_type: change.oldValue ? "GNC_LOB_TARGET_UPDATE" : "GNC_LOB_TARGET_CREATE",
    module_key: "process-performance",
    entity_type: "gnc_lob_target",
    entity_id: `${change.newValue.lob}:${change.newValue.effectiveMonth}`,
    metadata: { reason: body.reason ? String(body.reason).slice(0, 500) : null, oldValue: change.oldValue, newValue: change.newValue },
    req,
  });
  res.json({ success: true, data: change });
}));

router.delete("/gnc-targets/:id", requireRole(...TARGET_EDIT_ROLES), h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Invalid target id" });
  const removed = await deleteGncTarget(id);
  if (!removed) return res.status(404).json({ success: false, error: "Target not found" });
  await writeAuditLog({
    actor_user_id: req.authUser!.id, action_type: "GNC_LOB_TARGET_DELETE", module_key: "process-performance",
    entity_type: "gnc_lob_target", entity_id: `${removed.lob}:${removed.effectiveMonth}`, metadata: { oldValue: removed, newValue: null, reason: "target row deleted" }, req,
  });
  res.json({ success: true, data: removed });
}));

export { router as gncSaleDashboardRouter };
