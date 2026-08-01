import { Router, type Response } from "express";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getProcessMetricDefinitions } from "./process-metric-definition.service.js";
import {
  upsertProcessMetricDefinition,
  retireProcessMetricDefinition,
  MetricDefinitionError,
} from "./process-metric-definition.write.js";

/**
 * Per-process metric definitions.
 *
 * All 97 processes carrying KPI config hold the identical three metrics with one
 * distinct target between them, because kpi_metric_master.metric_code is
 * globally unique and nothing let a process name its own. Migration 1047 added
 * the table; this is how somebody fills it in.
 */

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(requireAuth);

/**
 * Deciding what a process is measured on is a configuration act, not an
 * operational one. process_manager is included because they own the process;
 * quality_analyst is not, for the same reason they cannot author a QA form.
 */
const CONFIG_ROLES = ["super_admin", "admin", "qa", "tq_head", "process_manager"] as const;

function handleError(res: Response, err: unknown): Response {
  if (err instanceof MetricDefinitionError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  throw err;
}

/** GET /api/kpi/process-metrics/:processId?asOf=YYYY-MM-DD */
router.get("/:processId", requireRole(...CONFIG_ROLES), h(async (req, res) => {
  const asOf = String(req.query.asOf ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const definitions = await getProcessMetricDefinitions(String(req.params.processId), asOf);
  return res.json({ success: true, data: definitions, asOf });
}));

/**
 * GET /api/kpi/process-metrics/:processId/catalog
 * Canonical metrics available to attach, so the UI is not asking anyone to
 * remember metric codes.
 */
router.get("/:processId/catalog", requireRole(...CONFIG_ROLES), h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, metric_code, metric_name, unit, direction, family
       FROM kpi_metric_master
      WHERE active_status = 1
      ORDER BY family, metric_name`,
  );
  return res.json({ success: true, data: rows });
}));

/** POST /api/kpi/process-metrics/:processId — add or supersede a definition. */
router.post("/:processId", requireRole(...CONFIG_ROLES), h(async (req, res) => {
  const { metricId, localCode, displayName, unit, direction, weightage, isFatal, displayOrder, effectiveFrom } =
    req.body ?? {};

  if (!displayName || !effectiveFrom) {
    return res.status(400).json({
      success: false, message: "displayName and effectiveFrom are required",
    });
  }

  try {
    const result = await upsertProcessMetricDefinition({
      processId: String(req.params.processId),
      metricId: metricId ? String(metricId) : null,
      localCode: localCode ? String(localCode) : null,
      displayName: String(displayName),
      unit: unit ? String(unit) : null,
      direction: direction ?? null,
      weightage: weightage === undefined ? undefined : Number(weightage),
      isFatal: Boolean(isFatal),
      displayOrder: displayOrder === undefined ? undefined : Number(displayOrder),
      effectiveFrom: String(effectiveFrom).slice(0, 10),
      createdBy: req.authUser!.id,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err);
  }
}));

/** DELETE /api/kpi/process-metrics/definition/:id?effectiveTo= — retire, never delete. */
router.delete("/definition/:id", requireRole(...CONFIG_ROLES), h(async (req, res) => {
  const effectiveTo = String(req.query.effectiveTo ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  try {
    await retireProcessMetricDefinition(String(req.params.id), effectiveTo);
    return res.json({ success: true, data: { retiredFrom: effectiveTo } });
  } catch (err) {
    return handleError(res, err);
  }
}));

export { router as processMetricDefinitionRouter };
