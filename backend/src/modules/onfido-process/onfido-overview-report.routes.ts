/**
 * Routes for the 23-Sep-26 Overview / Analyst Performance / Utilization formats and the
 * WFM inputs behind them. Mounted from onfido-process-dashboard.routes.ts via
 * mountOverviewReportRoutes(router, viewGuard), so every route inherits the router's auth
 * and Onfido process-scope check; reads add the viewer role guard, writes the WFM one.
 */
import type { NextFunction, RequestHandler, Response, Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { expandRoles, normalizeRoleInputs } from "../../platform/policy/index.js";
import { getAnalystReport, getAnalystWeekly } from "./onfido-analyst-report.service.js";
import { getAonBucketAnalysts, getOverviewReport } from "./onfido-overview-report.service.js";
import { getUtilizationReport } from "./onfido-utilization.service.js";
import { validateRange, type Granularity } from "./onfido-overview-report.pure.js";
import { listManpowerPlan, upsertManpowerPlan, upsertUtilizationInputs } from "./onfido-wfm-inputs.service.js";
import { parseManpowerPlanInput, parseUtilizationInputBatch } from "./onfido-wfm-inputs.validation.js";
import { clearOnfidoResponseCache } from "./onfido-response-cache.js";

/** Who may enter approved HC and utilization inputs (super_admin passes requireRole implicitly). */
export const WFM_INPUT_WRITE_ROLES = ["admin", "coo", "wfm", "process_manager"] as const;

const MAX_UTILIZATION_DAYS = 366;

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap = (fn: Handler): RequestHandler => (req, res, next: NextFunction) => {
  void fn(req as AuthenticatedRequest, res).catch(next);
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function readGranularity(v: unknown): Granularity {
  return v === "daily" || v === "weekly" ? v : "monthly";
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function mountOverviewReportRoutes(router: Router, viewGuard: RequestHandler[]): void {
  const writeGuard: RequestHandler[] = [requireAuth, requireRole(...WFM_INPUT_WRITE_ROLES)];
  const filters = (req: AuthenticatedRequest) => {
    const q = req.query as Record<string, unknown>;
    return { from: str(q.from), to: str(q.to), tlName: str(q.tlName), amName: str(q.amName) };
  };

  router.get("/overview-report", ...viewGuard, wrap(async (req, res) => {
    const f = filters(req);
    const bad = validateRange(f.from, f.to);
    if (bad) return res.status(400).json({ success: false, message: bad });
    const data = await getOverviewReport(f, readGranularity((req.query as Record<string, unknown>).granularity));
    res.json({ success: true, data });
  }));

  router.get("/overview-report/aon-analysts", ...viewGuard, wrap(async (req, res) => {
    const f = filters(req);
    const bad = validateRange(f.from, f.to);
    if (bad) return res.status(400).json({ success: false, message: bad });
    const bucket = str((req.query as Record<string, unknown>).bucket);
    if (!bucket) return res.status(400).json({ success: false, message: "bucket is required." });
    res.json({ success: true, data: await getAonBucketAnalysts(f, bucket) });
  }));

  router.get("/analyst-report", ...viewGuard, wrap(async (req, res) => {
    const f = filters(req);
    const bad = validateRange(f.from, f.to);
    if (bad) return res.status(400).json({ success: false, message: bad });
    res.json({ success: true, data: await getAnalystReport(f) });
  }));

  router.get("/analyst-report/weekly", ...viewGuard, wrap(async (req, res) => {
    const f = filters(req);
    const bad = validateRange(f.from, f.to);
    if (bad) return res.status(400).json({ success: false, message: bad });
    const analyst = str((req.query as Record<string, unknown>).analyst);
    if (!analyst) return res.status(400).json({ success: false, message: "analyst is required." });
    res.json({ success: true, data: await getAnalystWeekly(analyst, f) });
  }));

  router.get("/utilization-report", ...viewGuard, wrap(async (req, res) => {
    const { from, to } = filters(req);
    const bad = validateRange(from, to);
    if (bad) return res.status(400).json({ success: false, message: bad });
    if (daysBetween(from!, to!) > MAX_UTILIZATION_DAYS) {
      return res.status(400).json({ success: false, message: `Choose at most ${MAX_UTILIZATION_DAYS} days.` });
    }
    res.json({ success: true, data: await getUtilizationReport(from!, to!) });
  }));

  // The UI hides the entry forms from viewers; the PUT routes below enforce the same roles.
  router.get("/wfm-inputs/can-edit", ...viewGuard, wrap(async (req, res) => {
    const userRoles = normalizeRoleInputs((req as AuthenticatedRequest & { userRoles?: string[] }).userRoles ?? []);
    const canEdit = userRoles.includes("super_admin")
      || expandRoles(normalizeRoleInputs([...WFM_INPUT_WRITE_ROLES])).some((r) => expandRoles(userRoles).includes(r));
    res.json({ success: true, data: { canEdit } });
  }));

  router.get("/wfm-inputs/manpower-plan", ...viewGuard, wrap(async (_req, res) => {
    res.json({ success: true, data: await listManpowerPlan() });
  }));

  router.put("/wfm-inputs/manpower-plan", ...writeGuard, wrap(async (req, res) => {
    const parsed = parseManpowerPlanInput(req.body);
    if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.error });
    await upsertManpowerPlan(parsed.value, req.authUser!.id);
    clearOnfidoResponseCache();
    res.json({ success: true });
  }));

  router.put("/wfm-inputs/utilization", ...writeGuard, wrap(async (req, res) => {
    const parsed = parseUtilizationInputBatch((req.body as { rows?: unknown } | undefined)?.rows);
    if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.error });
    const saved = await upsertUtilizationInputs(parsed.value, req.authUser!.id);
    clearOnfidoResponseCache();
    res.json({ success: true, data: { saved } });
  }));
}
