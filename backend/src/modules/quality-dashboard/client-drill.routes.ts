import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./client-drill.service.js";

/**
 * /api/quality-dashboard/client-drill/* — the tabs of ClientQualityDrillModal.
 *
 * The modal has called these seven paths since it was written and none existed, so every tab
 * rendered blank rather than erroring.
 *
 * Same role set as inbound-quality.routes.ts: this exposes agent-level quality scores and
 * call transcripts for a client, which is the same sensitivity as the dashboards those roles
 * already reach.
 */
export const clientDrillRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

clientDrillRouter.use(
  requireAuth,
  requireRole(
    "super_admin", "admin", "ceo", "manager", "process_manager",
    "operations_manager", "qa", "quality_analyst"
  )
);

/**
 * clientId is required: without it every query would fall back to the whole estate, so a
 * modal opened for one client would quietly report figures for all of them.
 */
function filters(req: Request) {
  const clientId = String(req.query.clientId ?? "").trim();
  if (!clientId) {
    throw Object.assign(new Error("clientId is required"), { statusCode: 400 });
  }
  const now = new Date();
  const to = req.query.to ? String(req.query.to) : now.toISOString().slice(0, 10);
  const from = req.query.from
    ? String(req.query.from)
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return { clientId, from, to };
}

clientDrillRouter.get("/kpis", h(async (req, res) =>
  res.json({ success: true, data: await svc.getClientKpis(filters(req)) })));

clientDrillRouter.get("/daily", h(async (req, res) =>
  res.json({ success: true, data: await svc.getClientDaily(filters(req)) })));

clientDrillRouter.get("/agents", h(async (req, res) =>
  res.json({ success: true, data: await svc.getClientAgents(filters(req)) })));

clientDrillRouter.get("/fatal", h(async (req, res) =>
  res.json({ success: true, data: await svc.getClientFatal(filters(req)) })));

clientDrillRouter.get("/scenarios", h(async (req, res) =>
  res.json({ success: true, data: await svc.getClientScenarios(filters(req)) })));

clientDrillRouter.get("/repeat", h(async (req, res) =>
  res.json({ success: true, data: await svc.getClientRepeat(filters(req)) })));

clientDrillRouter.get("/transcript", h(async (req, res) => {
  // Fixed 2026-08-17 (Section M RBAC audit): this was the one endpoint in the file with no
  // clientId scope at all — every sibling above requires it via filters(). A leadId alone let
  // any caller with router access read another client's call transcript + agent name.
  const clientId = String(req.query.clientId ?? "").trim();
  if (!clientId) {
    throw Object.assign(new Error("clientId is required"), { statusCode: 400 });
  }
  const leadId = String(req.query.leadId ?? "").trim();
  if (!leadId) {
    throw Object.assign(new Error("leadId is required"), { statusCode: 400 });
  }
  const data = await svc.getClientTranscript(leadId, clientId);
  // null rather than 404: the modal opens on a row the user just clicked, and a missing
  // transcript is an empty panel, not a broken page.
  return res.json({ success: true, data });
}));
