/**
 * Routes for a campaign's requisitions (WS3 A2) and the HR relink (K7BK), mounted under /api/meta.
 * Reads: the campaign read roles; writes: CAMPAIGN_WRITE_ROLES. A campaign outside the caller's branch is 403 (as every /api/meta
 * campaign route); a requisition outside it is 403 too, an unknown one 400. Every write is audited.
 */
import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { canAccessCampaign, canAccessLead, canAccessRequisition, resolveBranchScope } from "./meta-access.js";
import { addCampaignRequisition, listCampaignRequisitions, removeCampaignRequisition, setPrimaryRequisition } from "./campaign-requisition.service.js";
import { applyRelink, previewRelink } from "./campaign-relink.service.js";
import { enrolMetaArrival } from "../selection/meta-arrival.service.js";
import { campaignRoutingSummary, overrideLeadRequisition } from "./lead-routing.service.js";
import { metaCampaignService } from "./meta-campaign.service.js";

export const campaignRequisitionRouter = Router();

const READ_ROLES = ["super_admin", "admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management", "manager", "assistant_manager", "recruiter", "ceo"] as const;
const WRITE_ROLES = ["super_admin", "admin", "hr", "recruitment_hr"] as const;
const ID = /^[0-9a-f-]{36}$/i;

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const handle = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  fn(req, res).catch((e: { statusCode?: number; message?: string }) => {
    if (e?.statusCode && e.statusCode < 500) return void res.status(e.statusCode).json({ success: false, message: e.message });
    next(e);
  });
};
const rolesOf = (req: AuthenticatedRequest) => (req.userRoles?.length ? req.userRoles : [req.authUser?.role ?? ""]).filter(Boolean);
const actorOf = (req: AuthenticatedRequest) => ({ id: req.authUser!.id, role: String(req.authUser?.role ?? "") });
const body = (req: AuthenticatedRequest): Record<string, unknown> => (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {});

/** 403 unless the campaign (and the requisition, when given) is in the caller's branch scope. */
async function inScope(req: AuthenticatedRequest, res: Response, campaignId: string, requisitionId?: string): Promise<boolean> {
  if (!ID.test(campaignId) || (requisitionId !== undefined && !ID.test(requisitionId))) { res.status(400).json({ success: false, message: "Invalid id" }); return false; }
  const scope = await resolveBranchScope(req.authUser!.id, rolesOf(req));
  if (!(await canAccessCampaign(campaignId, scope))) { res.status(403).json({ success: false, message: "Forbidden: this campaign belongs to another branch" }); return false; }
  if (requisitionId && !scope.all && !(await canAccessRequisition(requisitionId, scope))) {
    res.status(403).json({ success: false, message: "Forbidden: that requisition belongs to another branch" }); return false;
  }
  return true;
}
const audit = (req: AuthenticatedRequest, action: string, campaignId: string, metadata: Record<string, unknown>) =>
  writeAuditLog({ actor_user_id: req.authUser!.id, action_type: action, module_key: "meta_campaign", entity_type: "meta_campaign", entity_id: campaignId, metadata, req });

campaignRequisitionRouter.get("/campaigns/:id/requisitions", requireAuth, requireRole(...READ_ROLES), handle(async (req, res) => {
  const id = String(req.params.id);
  if (!(await inScope(req, res, id))) return;
  res.json({ success: true, data: await listCampaignRequisitions(id) });
}));

campaignRequisitionRouter.post("/campaigns/:id/requisitions", requireAuth, requireRole(...WRITE_ROLES), handle(async (req, res) => {
  const id = String(req.params.id), b = body(req);
  const requisitionId = typeof b.requisitionId === "string" ? b.requisitionId : "";
  const templateId = typeof b.templateId === "string" && b.templateId ? b.templateId : null;
  if (!requisitionId) return void res.status(400).json({ success: false, message: "requisitionId is required" });
  if (!(await inScope(req, res, id, requisitionId))) return;
  const r = await addCampaignRequisition({ campaignId: id, requisitionId, actor: actorOf(req), primary: b.primary === true, templateId });
  await audit(req, "META_CAMPAIGN_REQUISITION_ADD", id, { requisitionId, primary: r.isPrimary, templateId });
  res.status(201).json({ success: true, data: r });
}));

campaignRequisitionRouter.delete("/campaigns/:id/requisitions/:reqId", requireAuth, requireRole(...WRITE_ROLES), handle(async (req, res) => {
  const id = String(req.params.id), requisitionId = String(req.params.reqId);
  if (!(await inScope(req, res, id, requisitionId))) return;
  const r = await removeCampaignRequisition({ campaignId: id, requisitionId, actor: actorOf(req) });
  await audit(req, "META_CAMPAIGN_REQUISITION_REMOVE", id, { requisitionId, newPrimary: r.newPrimary });
  res.json({ success: true, data: r });
}));

campaignRequisitionRouter.put("/campaigns/:id/requisitions/:reqId/primary", requireAuth, requireRole(...WRITE_ROLES), handle(async (req, res) => {
  const id = String(req.params.id), requisitionId = String(req.params.reqId);
  if (!(await inScope(req, res, id, requisitionId))) return;
  await setPrimaryRequisition({ campaignId: id, requisitionId, actor: actorOf(req) });
  await audit(req, "META_CAMPAIGN_REQUISITION_PRIMARY", id, { requisitionId });
  res.json({ success: true, data: { primary: requisitionId } });
}));

campaignRequisitionRouter.get("/campaigns/:id/relink-preview", requireAuth, requireRole(...WRITE_ROLES), handle(async (req, res) => {
  const id = String(req.params.id), to = typeof req.query.to === "string" ? req.query.to : "";
  if (!to) return void res.status(400).json({ success: false, message: "Pick the requisition to link" });
  if (!(await inScope(req, res, id, to))) return;
  const { moveIds: _ids, ...preview } = await previewRelink(id, to);
  res.json({ success: true, data: preview });
}));

campaignRequisitionRouter.post("/campaigns/:id/relink", requireAuth, requireRole(...WRITE_ROLES), handle(async (req, res) => {
  const id = String(req.params.id), b = body(req);
  const to = typeof b.toRequisitionId === "string" ? b.toRequisitionId : "";
  if (!to || typeof b.previewHash !== "string" || b.confirm !== true) return void res.status(400).json({ success: false, message: "Preview first, then confirm" });
  if (!(await inScope(req, res, id, to))) return;
  const r = await applyRelink({ campaignId: id, toRequisitionId: to, previewHash: b.previewHash, reason: String(b.reason ?? ""), actor: actorOf(req) });
  await audit(req, "META_CAMPAIGN_RELINK", id, { to, moved: r.moved, kept: r.kept, relinkId: r.relinkId });
  res.json({ success: true, data: r });
}));

campaignRequisitionRouter.get("/campaigns/:id/routing", requireAuth, requireRole(...READ_ROLES), handle(async (req, res) => {
  const id = String(req.params.id);
  if (!(await inScope(req, res, id))) return;
  res.json({ success: true, data: await campaignRoutingSummary(id) });
}));

/** HR places a lead on one of its campaign's requisitions (B1 override); refused once the person was contacted. */
campaignRequisitionRouter.put("/leads/:id/requisition", requireAuth, requireRole(...WRITE_ROLES), handle(async (req, res) => {
  const id = String(req.params.id), b = body(req);
  const requisitionId = typeof b.requisitionId === "string" ? b.requisitionId : "";
  if (!ID.test(id) || !ID.test(requisitionId)) return void res.status(400).json({ success: false, message: "Invalid id" });
  const scope = await resolveBranchScope(req.authUser!.id, rolesOf(req));
  if (!(await canAccessLead(id, scope))) return void res.status(403).json({ success: false, message: "This lead belongs to another branch" });
  if (!scope.all && !(await canAccessRequisition(requisitionId, scope))) return void res.status(403).json({ success: false, message: "Forbidden: that requisition belongs to another branch" });
  await overrideLeadRequisition({ metaLeadId: id, requisitionId, actor: req.authUser!.id, rescreen: (leadId) => metaCampaignService.rescreenLead(leadId, { createCandidate: false }),
    enrol: (leadId) => enrolMetaArrival(leadId) });
  await writeAuditLog({ actor_user_id: req.authUser!.id, action_type: "META_LEAD_REQUISITION_OVERRIDE", module_key: "meta_campaign", entity_type: "meta_lead_raw", entity_id: id, metadata: { requisitionId }, req });
  res.json({ success: true, data: { requisitionId } });
}));
