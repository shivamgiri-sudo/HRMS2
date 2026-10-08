/**
 * Requisition criteria API (plan 2026-10-09, S5), mounted under /api/job-requisition after the requisition router.
 * One write path for every editor (criteria panel, campaign bulk edit, copy, templates). Row scope = the requisition
 * scope (isRequisitionVisible: a miss is 404); writers are CRITERIA_EDIT_ROLES, and branch_head only within their branches.
 */
import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { jobRequisitionService } from "../job-requisition/job-requisition.service.js";
import {
  applyTemplateToRequisition, bulkSaveCriteria, copyCriteria, CRITERIA_EDIT_ROLES, getRequisitionCriteria, listCriteriaAudit, saveRequisitionCriteria,
} from "./criteria.service.js";
import { previewCsv, previewRequisition } from "./preview.service.js";
import { whyNot } from "./why-not.service.js";
import { campaignRequisitions, listCriteriaRequisitions } from "./selection-ui.service.js";
import { RULE_KEYS, SOURCE_KINDS, SUB_SOURCES, type RuleKey, type SourceKind, type SubSource } from "./selection-types.js";
import { TEMPLATES, type CriteriaPatch } from "./templates.js";

export const criteriaRouter = Router();

export { CRITERIA_READ_ROLES, PREVIEW_EXPORT_ROLES } from "./selection-roles.js";
import { CRITERIA_READ_ROLES, PREVIEW_EXPORT_ROLES, permissionsFor } from "./selection-roles.js";
const MAX_IDS = 200;

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  fn(req, res).catch((e: Error & { statusCode?: number; issues?: unknown }) => {
    if (e.statusCode && e.statusCode < 500) return res.status(e.statusCode).json({ success: false, message: e.message, ...(e.issues ? { issues: e.issues } : {}) });
    return next(e);
  });
};
const visible = (req: AuthenticatedRequest, id: string) => jobRequisitionService.isRequisitionVisible(req.authUser!, { id });
const inScope = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  visible(req, req.params.id).then((ok) => (ok ? next() : res.status(404).json({ success: false, message: "Requisition not found" }))).catch(next);
};
const actorOf = (req: AuthenticatedRequest) => ({ id: req.authUser!.id, role: String(req.authUser!.role ?? "") });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const reasonOf = (v: unknown): string | null | false => (v === undefined || v === null ? null : typeof v === "string" && v.length <= 300 ? v : false);
const idsOf = (v: unknown): string[] | null => (Array.isArray(v) && v.length > 0 && v.length <= MAX_IDS && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64) ? [...new Set(v as string[])] : null);
const keysOf = (v: unknown): RuleKey[] | "all" | null => (v === "all" ? "all" : Array.isArray(v) && v.length && v.every((k) => (RULE_KEYS as readonly string[]).includes(k)) ? (v as RuleKey[]) : null);
const bad = (res: Response, message: string) => res.status(400).json({ success: false, message });

/** Every id must be inside the caller's scope; otherwise the whole request is refused (403) and nothing runs. */
async function allVisible(req: AuthenticatedRequest, ids: string[]): Promise<boolean> {
  for (const id of ids) if (!(await visible(req, id))) return false;
  return true;
}

criteriaRouter.get("/criteria/templates", requireAuth, requireRole(...CRITERIA_READ_ROLES), h(async (_req, res) =>
  res.json({ success: true, data: TEMPLATES.map((t) => ({ id: t.id, version: t.version, label: t.label, patch: t.patch })) })));

criteriaRouter.post("/criteria/bulk", requireAuth, requireRole(...CRITERIA_EDIT_ROLES), h(async (req, res) => {
  const b = req.body;
  const ids = idsOf(b?.requisitionIds);
  const reason = reasonOf(b?.reason);
  if (!ids || !isObj(b?.patch) || reason === false) return bad(res, "requisitionIds (1-200), patch (object) and an optional reason (<= 300 chars) are required");
  if (!(await allVisible(req, ids))) return res.status(403).json({ success: false, message: "One or more requisitions are outside your scope" });
  const data = await bulkSaveCriteria({ requisitionIds: ids, patch: b.patch as CriteriaPatch, replaceFilled: b.replaceFilled === true, actor: actorOf(req), reason, dryRun: b.dryRun !== false });
  return res.json({ success: true, data });
}));

criteriaRouter.post("/criteria/copy", requireAuth, requireRole(...CRITERIA_EDIT_ROLES), h(async (req, res) => {
  const b = req.body;
  const to = idsOf(b?.toRequisitionIds);
  const keys = keysOf(b?.keys ?? "all");
  const reason = reasonOf(b?.reason);
  if (typeof b?.fromRequisitionId !== "string" || !to || !keys || reason === false) return bad(res, "fromRequisitionId, toRequisitionIds (1-200), keys (rule keys or \"all\") and an optional reason are required");
  if (!(await allVisible(req, [b.fromRequisitionId, ...to]))) return res.status(403).json({ success: false, message: "One or more requisitions are outside your scope" });
  const data = await copyCriteria({ fromRequisitionId: b.fromRequisitionId, toRequisitionIds: to, keys, replaceFilled: b.replaceFilled === true, actor: actorOf(req), reason, dryRun: b.dryRun !== false });
  return res.json({ success: true, data });
}));

// Why-not lookup (S11): read roles; only open requisitions in the caller's scope are evaluated (inside whyNot).
criteriaRouter.get("/selection/why", requireAuth, requireRole(...CRITERIA_READ_ROLES), h(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rid = typeof req.query.requisitionId === "string" && req.query.requisitionId ? req.query.requisitionId : undefined;
  if (!q || q.length > 80) return bad(res, "q (a mobile, candidate code or at least 3 letters of a name) is required");
  return res.json({ success: true, data: await whyNot(q, { user: req.authUser!, requisitionId: rid }) });
}));

criteriaRouter.get("/:id/criteria", requireAuth, requireRole(...CRITERIA_READ_ROLES), inScope, h(async (req, res) =>
  res.json({ success: true, data: { ...(await getRequisitionCriteria(req.params.id)), permissions: permissionsFor(String(req.authUser!.role ?? "")) } })));

// Read models for the selection screens (S15-S20)
criteriaRouter.get("/selection/requisitions", requireAuth, requireRole(...CRITERIA_READ_ROLES), h(async (req, res) =>
  res.json({ success: true, data: await listCriteriaRequisitions(req.authUser!, { onlyIncomplete: req.query.onlyIncomplete === "1" }) })));
criteriaRouter.get("/selection/campaign/:campaignId/requisitions", requireAuth, requireRole(...CRITERIA_READ_ROLES), h(async (req, res) =>
  res.json({ success: true, data: await campaignRequisitions(req.authUser!, req.params.campaignId) })));

criteriaRouter.put("/:id/criteria", requireAuth, requireRole(...CRITERIA_EDIT_ROLES), inScope, h(async (req, res) => {
  const b = req.body;
  const reason = reasonOf(b?.reason);
  if (!isObj(b?.patch) || reason === false) return bad(res, "patch (object) and an optional reason (<= 300 chars) are required");
  const data = await saveRequisitionCriteria({ requisitionId: req.params.id, patch: b.patch as CriteriaPatch, actor: actorOf(req), source: "criteria_panel", reason, dryRun: b.dryRun === true });
  return res.json({ success: true, data });
}));

criteriaRouter.post("/:id/criteria/template", requireAuth, requireRole(...CRITERIA_EDIT_ROLES), inScope, h(async (req, res) => {
  const b = req.body;
  const reason = reasonOf(b?.reason);
  if (typeof b?.templateId !== "string" || reason === false) return bad(res, "templateId is required");
  const data = await applyTemplateToRequisition({ requisitionId: req.params.id, templateId: b.templateId, replaceFilled: b.replaceFilled === true, actor: actorOf(req), reason, dryRun: b.dryRun !== false });
  return res.json({ success: true, data });
}));

criteriaRouter.get("/:id/criteria/audit", requireAuth, requireRole(...CRITERIA_READ_ROLES), inScope, h(async (req, res) => {
  const c = Number(req.query.cursor);
  return res.json({ success: true, data: await listCriteriaAudit(req.params.id, Number.isInteger(c) && c > 0 ? c : null) });
}));

// ── Shortlist preview (S10): read roles, requisition scope; the CSV is masked and limited to the export roles ──
const sourceOf = (v: unknown): SourceKind | null => ((SOURCE_KINDS as readonly string[]).includes(String(v)) ? (v as SourceKind) : null);
const subOf = (v: unknown): SubSource | "all" | null => (v === undefined || v === "" || v === "all" ? "all" : (SUB_SOURCES as readonly string[]).includes(String(v)) ? (v as SubSource) : null);
const SOURCE_HELP = "source must be meta_live, meta_old or he; sub must be all or a sub-source";

criteriaRouter.get("/:id/selection/preview", requireAuth, requireRole(...CRITERIA_READ_ROLES), inScope, h(async (req, res) => {
  const source = sourceOf(req.query.source ?? "he"), sub = subOf(req.query.sub);
  if (!source || !sub) return bad(res, SOURCE_HELP);
  return res.json({ success: true, data: await previewRequisition({ requisitionId: req.params.id, sourceKind: source, subSource: sub }) });
}));

criteriaRouter.post("/:id/selection/preview", requireAuth, requireRole(...CRITERIA_READ_ROLES), inScope, h(async (req, res) => {
  const b = req.body ?? {};
  const source = sourceOf(b.source ?? "he"), sub = subOf(b.sub);
  if (!source || !sub || (b.draft !== undefined && b.draft !== null && !isObj(b.draft))) return bad(res, `${SOURCE_HELP}; draft must be an object`);
  return res.json({ success: true, data: await previewRequisition({ requisitionId: req.params.id, sourceKind: source, subSource: sub, draft: (b.draft ?? null) as CriteriaPatch | null }) });
}));

criteriaRouter.get("/:id/selection/preview.csv", requireAuth, requireRole(...PREVIEW_EXPORT_ROLES), inScope, h(async (req, res) => {
  const source = sourceOf(req.query.source ?? "he"), sub = subOf(req.query.sub);
  if (!source || !sub) return bad(res, SOURCE_HELP);
  const csv = await previewCsv({ requisitionId: req.params.id, sourceKind: source, subSource: sub });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="shortlist-preview-${source}.csv"`);
  return res.send(csv);
}));
