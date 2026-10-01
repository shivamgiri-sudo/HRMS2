/**
 * KPI Catalogue HTTP surface, mounted at /api/kpi-catalogue.
 *
 * Reads expose KPI *definitions* (name, formula, source, freshness), never employee data, so they are open to any
 * signed-in user for their own role and to the VIEW roles for any role/department. Writes (seed sync, drift record,
 * resolve, apply-to-studio) are admin only.
 */
import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getUserRoleKeys } from "../../shared/roleResolver.js";
import {
  getProcessKpis, listConflicts, listProcesses, listRoleDepartments, resolveConflict, syncSeed,
} from "./kpi-catalogue.service.js";
import { computeDrift, recordDrift } from "./kpi-catalogue.drift.js";
import { linkAllUnlinkedDefinitions } from "./kpi-catalogue.studio-sync.js";
import { applyCatalogueTargetToStudio } from "./kpi-catalogue.studio-apply.js";

export const kpiCatalogueRouter = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

/** Roles that may browse the catalogue for any role / department. */
export const CATALOGUE_VIEW_ROLES = [
  "admin", "super_admin", "ceo", "coo", "management", "hr", "hr_admin", "ho_hr", "operations_head", "ho_operations",
  "operations_manager", "process_manager", "branch_head", "branch_manager", "bm", "qa", "quality_analyst", "qa_manager",
  "quality_lead", "tq_head", "wfm", "branch_wfm", "ho_wfm", "wfm_spoc", "rta", "trainer",
];

kpiCatalogueRouter.use(requireAuth);

const q = (req: AuthenticatedRequest, k: string) => (typeof req.query[k] === "string" ? String(req.query[k]).trim() : undefined);

kpiCatalogueRouter.get("/processes", h(async (_req, res) => {
  res.json({ success: true, data: await listProcesses() });
}));

kpiCatalogueRouter.get("/roles", h(async (_req, res) => {
  res.json({ success: true, data: await listRoleDepartments() });
}));

kpiCatalogueRouter.get("/process/:processKey", h(async (req, res) => {
  const userId = req.authUser!.id;
  const roles = await getUserRoleKeys(userId);
  const isViewer = roles.some((r) => CATALOGUE_VIEW_ROLES.includes(r));
  let role = q(req, "role");
  const department = q(req, "department");
  if (!isViewer) {
    // Everyone else sees only the KPIs of a role they hold.
    if (role && !roles.includes(role)) {
      return res.status(403).json({ success: false, message: "You can only view the KPIs of your own role" });
    }
    if (!role) role = roles.includes("agent") ? "agent" : roles.includes("employee") ? "employee" : roles[0];
  }
  const data = await getProcessKpis(String(req.params.processKey), {
    role, department, theme: q(req, "theme"), grain: q(req, "grain"), includeNoData: q(req, "includeNoData") === "1",
  });
  res.json({ success: true, data });
}));

kpiCatalogueRouter.get("/conflicts", requireRole("admin", "hr", "process_manager", "operations_manager"), h(async (req, res) => {
  res.json({ success: true, data: await listConflicts(q(req, "includeResolved") === "1") });
}));

kpiCatalogueRouter.get("/drift", requireRole("admin"), h(async (_req, res) => {
  const found = await computeDrift();
  const byType: Record<string, number> = {};
  for (const c of found) byType[c.type] = (byType[c.type] ?? 0) + 1;
  res.json({ success: true, data: { total: found.length, byType, conflicts: found.slice(0, 500) } });
}));

kpiCatalogueRouter.post("/drift/record", requireRole("admin"), h(async (_req, res) => {
  res.json({ success: true, data: await recordDrift() });
}));

/** Seeds / re-seeds the catalogue, links unlinked Studio definitions and records the reconciliation. Idempotent. */
kpiCatalogueRouter.post("/sync", requireRole("admin"), h(async (_req, res) => {
  const seed = await syncSeed();
  const studio = await linkAllUnlinkedDefinitions();
  const drift = await recordDrift();
  res.json({ success: true, data: { seed, studio, drift } });
}));

kpiCatalogueRouter.post("/conflicts/:id/resolve", requireRole("admin"), h(async (req, res) => {
  await resolveConflict(String(req.params.id));
  res.json({ success: true });
}));

kpiCatalogueRouter.post("/:id/apply-to-studio", requireRole("admin"), h(async (req, res) => {
  try {
    res.json({ success: true, data: await applyCatalogueTargetToStudio(String(req.params.id), req.authUser!.id) });
  } catch (err) {
    res.status(400).json({ success: false, message: err instanceof Error ? err.message : "Could not apply the target" });
  }
}));
